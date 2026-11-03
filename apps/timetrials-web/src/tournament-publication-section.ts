import {
  createTournamentPublicationClient,
  TournamentPublicationClientError,
  type TournamentPublicationCandidate,
  type TournamentPublicationClient,
  type TournamentPublicationReview,
  type TournamentPublicationSnapshot,
} from "./tournament-publication-client.js";
import { tournamentRaceClassLabel } from "./tournament-race-class.js";

export type MountedTournamentPublicationSection = Readonly<{
  container: HTMLElement;
  ready: Promise<void>;
  unmount(): void;
}>;

function clear(element: HTMLElement): void {
  while (element.firstChild !== null) { element.removeChild(element.firstChild); }
}

export function mountTournamentPublicationSection(
  root: HTMLElement,
  client: TournamentPublicationClient = createTournamentPublicationClient(),
): MountedTournamentPublicationSection {
  const document = root.ownerDocument;
  const controller = new AbortController();
  let disposed = false;
  let operation = 0;
  const container = document.createElement("section");
  container.className = "tournament-publication ds-panel";
  container.setAttribute("aria-labelledby", "tournament-publication-heading");
  const heading = document.createElement("h2");
  heading.id = "tournament-publication-heading";
  heading.className = "ds-panel__title";
  heading.textContent = "Tournament publication";
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  status.textContent = "Checking Tournament publication work…";
  const content = document.createElement("div");
  container.append(heading, status, content);
  root.append(container);

  const load = async (): Promise<void> => {
    const current = ++operation;
    try {
      const next = await client.listReview(controller.signal);
      if (disposed || current !== operation) { return; }
      render(next);
    } catch (error) {
      if (disposed || current !== operation) { return; }
      if (error instanceof TournamentPublicationClientError && error.code === "not_authorized") {
        if (container.parentNode === root) { root.removeChild(container); }
        return;
      }
      status.textContent = "Tournament publication review is temporarily unavailable.";
    }
  };

  const render = (state: TournamentPublicationReview): void => {
    clear(content);
    status.textContent = `${state.candidates.length} current canonical race result${state.candidates.length === 1 ? "" : "s"} available for review.`;
    const form = document.createElement("form");
    form.className = "tournament-publication__form";
    const publicationLabel = document.createElement("label");
    publicationLabel.textContent = "Publication";
    const publicationSelect = document.createElement("select");
    const createOption = document.createElement("option");
    createOption.value = "";
    createOption.textContent = "Create a new published event";
    publicationSelect.append(createOption);
    for (const publication of state.publications) {
      const option = document.createElement("option");
      option.value = publication.publicationId;
      option.textContent = `${publication.eventName} · ${publication.status} · revision ${publication.revision}`;
      publicationSelect.append(option);
    }
    publicationLabel.append(publicationSelect);
    const nameLabel = document.createElement("label");
    nameLabel.textContent = "Public event name";
    const name = document.createElement("input");
    name.maxLength = 128;
    name.required = true;
    nameLabel.append(name);
    const reasonLabel = document.createElement("label");
    reasonLabel.textContent = "Audit reason code";
    const reason = document.createElement("input");
    reason.maxLength = 64;
    reason.pattern = "[a-z0-9]+([._\\-][a-z0-9]+)*";
    reason.required = true;
    reason.placeholder = "event_completed";
    reasonLabel.append(reason);
    const candidatesHeading = document.createElement("h3");
    candidatesHeading.textContent = "Exact current revisions";
    const candidates = document.createElement("fieldset");
    const selected = new Map<string, HTMLInputElement>();
    for (const candidate of state.candidates) {
      const label = document.createElement("label");
      label.className = "tournament-publication__candidate";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = candidate.raceResultId;
      checkbox.disabled = !candidate.publishable;
      selected.set(candidate.raceResultId, checkbox);
      const summary = document.createElement("span");
      summary.textContent = candidateSummary(candidate);
      label.append(checkbox, summary);
      candidates.append(label);
    }
    const controls = document.createElement("div");
    controls.className = "tournament-publication__controls";
    const publish = document.createElement("button");
    publish.type = "submit";
    publish.className = "tt-auth__button tt-auth__button--primary";
    publish.textContent = "Publish selected results";
    const retract = document.createElement("button");
    retract.type = "button";
    retract.className = "tt-auth__button";
    retract.textContent = "Retract publication";
    retract.hidden = true;
    controls.append(publish, retract);
    form.append(publicationLabel, nameLabel, reasonLabel, candidatesHeading, candidates, controls);
    content.append(form);

    const selectedPublication = (): TournamentPublicationSnapshot | undefined =>
      state.publications.find((item) => item.publicationId === publicationSelect.value);
    const applySelection = (): void => {
      const publication = selectedPublication();
      name.value = publication?.eventName ?? "";
      retract.hidden = publication?.status !== "published";
      publish.textContent = publication === undefined
        ? "Publish selected results"
        : publication.status === "published"
          ? "Publish corrected result set"
          : "Republish selected results";
      for (const candidate of state.candidates) {
        const checkbox = selected.get(candidate.raceResultId)!;
        const occupiedElsewhere = candidate.currentPublicationId !== undefined &&
          candidate.currentPublicationId !== publication?.publicationId;
        checkbox.disabled = !candidate.publishable || occupiedElsewhere;
        checkbox.checked = candidate.currentPublicationId === publication?.publicationId;
      }
    };
    publicationSelect.addEventListener("change", applySelection);
    applySelection();

    const busy = (value: boolean): void => {
      publish.disabled = value;
      retract.disabled = value;
      publicationSelect.disabled = value;
      name.disabled = value;
      reason.disabled = value;
      for (const checkbox of selected.values()) { checkbox.disabled = value || checkbox.disabled; }
    };
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (disposed) { return; }
      const targets = state.candidates.filter((candidate) =>
        selected.get(candidate.raceResultId)?.checked === true).map((candidate) => ({
          raceResultId: candidate.raceResultId,
          revision: candidate.currentRevision,
        }));
      if (targets.length === 0) {
        status.textContent = "Select at least one publishable current race revision.";
        return;
      }
      const publication = selectedPublication();
      busy(true);
      status.textContent = publication === undefined ? "Publishing Tournament…" : "Publishing corrected Tournament set…";
      const action = publication === undefined
        ? client.create(name.value, targets, reason.value, controller.signal)
        : client.republish(publication.publicationId, publication.revision, name.value, targets, reason.value, controller.signal);
      void action.then(() => load()).catch(handleMutationFailure);
    });
    retract.addEventListener("click", () => {
      const publication = selectedPublication();
      if (disposed || publication === undefined || publication.status !== "published") { return; }
      busy(true);
      status.textContent = "Retracting Tournament publication…";
      void client.retract(publication.publicationId, publication.revision, reason.value, controller.signal)
        .then(() => load()).catch(handleMutationFailure);
    });
    const handleMutationFailure = (error: unknown): void => {
      if (disposed) { return; }
      status.textContent = error instanceof TournamentPublicationClientError && error.code === "conflict"
        ? "Publication state or a current race revision changed. Reloading review data…"
        : "The Tournament publication action could not be completed. Check the selection and reason code.";
      void load();
    };
  };

  const candidateSummary = (candidate: TournamentPublicationCandidate): string => {
    const state = candidate.publishable ? "publishable" : "requires Player reconciliation";
    const occupied = candidate.currentPublicationId === undefined ? "" : " · currently published";
    const raceClass = tournamentRaceClassLabel(candidate.mode, candidate.mirror);
    return `segment ${candidate.scoringSegment}, race ${candidate.raceNumber} · ${candidate.trackId}${raceClass === null ? "" : ` · ${raceClass}`} · revision ${candidate.currentRevision} · ${candidate.placementCount} Players · ${state}${occupied}`;
  };

  const ready = load();
  return {
    container,
    ready,
    unmount(): void {
      if (disposed) { return; }
      disposed = true;
      operation += 1;
      controller.abort();
      if (container.parentNode === root) { root.removeChild(container); }
    },
  };
}
