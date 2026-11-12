// Administrator view of recorded Time Trials.
//
// The same three actions a Player has over their own result — correct,
// retire, bring back — with the whole corpus in view and a reason recorded
// every time. Player presence (Public/Private Player) can be set from the
// row too, because "this Player asked to disappear from the boards" is an
// administrator request as often as a self-service one. The section removes
// itself for a non-administrator; the server is the real gate.

import {
  TimeTrialLifecycleClientError,
  createPlayerVisibilityClient,
  createTimeTrialLifecycleClient,
  type ManagedTimeTrial,
  type ManagedTimeTrialQuery,
  type PlayerVisibility,
  type PlayerVisibilityClient,
  type TimeTrialLifecycleClient,
} from "./time-trial-lifecycle-client.js";
import {
  describePresence,
  describeSourceKind,
  formatTimeMs,
  mountTimeTrialManagementPanel,
  trackName,
  type MountedTimeTrialManagementPanel,
} from "./time-trial-management.js";

export type MountedAdministratorTimeTrialSection = Readonly<{
  container: HTMLElement;
  ready: Promise<void>;
  unmount(): void;
}>;

const reasonPattern = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

function clear(element: HTMLElement): void {
  while (element.firstChild !== null) { element.removeChild(element.firstChild); }
}

function option(
  document: Document,
  value: string,
  label: string,
): HTMLOptionElement {
  const element = document.createElement("option");
  element.value = value;
  element.textContent = label;
  return element;
}

function field(
  document: Document,
  caption: string,
  control: HTMLElement,
): HTMLLabelElement {
  const label = document.createElement("label");
  label.className = "administrator-time-trials__field";
  const text = document.createElement("span");
  text.textContent = caption;
  label.append(text, control);
  return label;
}

// Exactly the filters the endpoint understands; a blank field is simply
// left out rather than sent as an empty string.
export function buildAdministratorQuery(
  raw: Readonly<Record<string, string>>,
): ManagedTimeTrialQuery {
  const playerId = (raw["playerId"] ?? "").trim();
  const trackId = (raw["trackId"] ?? "").trim();
  const mode = raw["mode"] ?? "";
  const retirementState = raw["retirementState"] ?? "";
  const publicationStatus = raw["publicationStatus"] ?? "";
  const sourceKind = raw["sourceKind"] ?? "";
  return {
    ...(playerId === "" ? {} : { playerId }),
    ...(trackId === "" ? {} : { trackId }),
    ...(mode === "150" || mode === "200"
      ? { mode: Number(mode) as 150 | 200 }
      : {}),
    ...(retirementState === "active" || retirementState === "retired"
      ? { retirementState }
      : {}),
    ...(publicationStatus === "published" || publicationStatus === "withheld"
      ? { publicationStatus }
      : {}),
    ...(sourceKind === "" ? {} : { sourceKind }),
    limit: 50,
  };
}

export function resultSummary(result: ManagedTimeTrial): string {
  return `${result.playerDisplayName} (@${result.playerUsername}) · ${
    trackName(result.current.trackId)} ${result.current.modeCc}cc · ${
    formatTimeMs(result.current.totalTimeMs)} · ${
    describeSourceKind(result.current.sourceKind)} · version ${
    result.current.revision} · ${describePresence(result)}`;
}

export function mountAdministratorTimeTrialSection(
  root: HTMLElement,
  client: TimeTrialLifecycleClient = createTimeTrialLifecycleClient(),
  visibilityClient: PlayerVisibilityClient = createPlayerVisibilityClient(),
): MountedAdministratorTimeTrialSection {
  const document = root.ownerDocument;
  const controller = new AbortController();
  let disposed = false;
  let operation = 0;
  const panels: MountedTimeTrialManagementPanel[] = [];

  const container = document.createElement("section");
  container.className = "administrator-time-trials ds-panel";
  container.setAttribute("aria-labelledby", "administrator-time-trials-heading");
  const heading = document.createElement("h2");
  heading.id = "administrator-time-trials-heading";
  heading.className = "ds-panel__title";
  heading.textContent = "Time Trials";
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  status.textContent = "Loading recorded Time Trials…";

  const filters = document.createElement("form");
  filters.className = "administrator-time-trials__filters";
  const playerInput = document.createElement("input");
  playerInput.name = "player_id";
  playerInput.maxLength = 135;
  playerInput.autocomplete = "off";
  playerInput.placeholder = "player.example";
  const trackInput = document.createElement("input");
  trackInput.name = "track_id";
  trackInput.maxLength = 255;
  trackInput.autocomplete = "off";
  trackInput.placeholder = "track.mario_kart_stadium";
  const modeSelect = document.createElement("select");
  modeSelect.name = "mode";
  modeSelect.append(
    option(document, "", "Any speed"),
    option(document, "150", "150cc"),
    option(document, "200", "200cc"),
  );
  const retirementSelect = document.createElement("select");
  retirementSelect.name = "retirement_state";
  retirementSelect.append(
    option(document, "", "Active and retired"),
    option(document, "active", "Active only"),
    option(document, "retired", "Retired only"),
  );
  const publicationSelect = document.createElement("select");
  publicationSelect.name = "publication_status";
  publicationSelect.append(
    option(document, "", "Any publication state"),
    option(document, "published", "Published"),
    option(document, "withheld", "Withheld"),
  );
  const sourceSelect = document.createElement("select");
  sourceSelect.name = "source_kind";
  sourceSelect.append(option(document, "", "Any source"));
  for (const sourceKind of [
    "web_manual", "web_scan", "android_manual", "android_scan", "livetrial_capture",
    "livetrial_recorded_video",
  ]) {
    sourceSelect.append(option(document, sourceKind, describeSourceKind(sourceKind)));
  }
  const applyFilters = document.createElement("button");
  applyFilters.type = "submit";
  applyFilters.className = "tt-auth__button";
  applyFilters.textContent = "Show results";
  filters.append(
    field(document, "Player id", playerInput),
    field(document, "Track id", trackInput),
    field(document, "Speed", modeSelect),
    field(document, "Retirement", retirementSelect),
    field(document, "Publication", publicationSelect),
    field(document, "Source", sourceSelect),
    applyFilters,
  );

  const list = document.createElement("ol");
  list.className = "administrator-time-trials__list";
  container.append(heading, status, filters, list);
  root.append(container);

  const renderRow = (result: ManagedTimeTrial): HTMLLIElement => {
    const row = document.createElement("li");
    row.className = "administrator-time-trials__row";
    const summary = document.createElement("p");
    summary.className = "administrator-time-trials__summary";
    summary.textContent = resultSummary(result);
    const profile = document.createElement("a");
    profile.className = "tt-auth__link";
    profile.setAttribute(
      "href", `/?player=${encodeURIComponent(result.playerId)}`,
    );
    profile.textContent = "Open Player profile";
    row.append(summary, profile);

    // Presence of the PLAYER, set from the row that made it necessary.
    const presence = document.createElement("form");
    presence.className = "administrator-time-trials__presence";
    const presenceSelect = document.createElement("select");
    presenceSelect.name = "player_visibility";
    presenceSelect.append(
      option(document, "public", "Public Player"),
      option(document, "private", "Private Player"),
    );
    const presenceReason = document.createElement("input");
    presenceReason.name = "visibility_reason";
    presenceReason.maxLength = 64;
    presenceReason.autocomplete = "off";
    presenceReason.placeholder = "player_request";
    presenceReason.required = true;
    const presenceApply = document.createElement("button");
    presenceApply.type = "submit";
    presenceApply.className = "tt-auth__button";
    presenceApply.textContent = "Set Player visibility";
    const presenceStatus = document.createElement("span");
    presenceStatus.className = "administrator-time-trials__presence-status";
    presenceStatus.setAttribute("role", "status");
    presence.append(
      field(document, "Player visibility", presenceSelect),
      field(document, "Reason code", presenceReason),
      presenceApply,
      presenceStatus,
    );
    presence.addEventListener("submit", (submitEvent) => {
      submitEvent.preventDefault();
      if (disposed) { return; }
      const reasonCode = presenceReason.value.trim();
      if (!reasonPattern.test(reasonCode) || reasonCode.length > 64) {
        presenceStatus.textContent =
          "Enter a short lower-case reason code, such as player_request.";
        return;
      }
      presenceApply.disabled = true;
      presenceStatus.textContent = "Saving…";
      void visibilityClient.setForPlayer(
        result.playerId,
        presenceSelect.value as PlayerVisibility,
        reasonCode,
        controller.signal,
      ).then((state) => {
        if (disposed) { return; }
        presenceStatus.textContent = state.visibility === "public"
          ? `${state.displayName} is a Public Player.`
          : `${state.displayName} is a Private Player.`;
        presenceApply.disabled = false;
      }).catch(() => {
        if (disposed) { return; }
        presenceStatus.textContent =
          "The Player visibility could not be changed. Please retry.";
        presenceApply.disabled = false;
      });
    });
    row.append(presence);

    const panelRoot = document.createElement("div");
    row.append(panelRoot);
    panels.push(mountTimeTrialManagementPanel(panelRoot, result.submissionId, {
      client,
      initial: result,
      viewerIsOwner: false,
      administrator: true,
      onChanged: () => { void load(); },
    }));
    return row;
  };

  const load = async (): Promise<void> => {
    const current = ++operation;
    const query = buildAdministratorQuery({
      playerId: playerInput.value,
      trackId: trackInput.value,
      mode: modeSelect.value,
      retirementState: retirementSelect.value,
      publicationStatus: publicationSelect.value,
      sourceKind: sourceSelect.value,
    });
    try {
      const results = await client.listForAdministrator(
        query, controller.signal,
      );
      if (disposed || current !== operation) { return; }
      for (const panel of panels.splice(0)) { panel.unmount(); }
      clear(list);
      status.textContent = results.length === 0
        ? "No recorded Time Trial matches these filters."
        : `${results.length} recorded Time Trial${
          results.length === 1 ? "" : "s"}.`;
      for (const result of results) { list.append(renderRow(result)); }
    } catch (error) {
      if (disposed || current !== operation) { return; }
      if (error instanceof TimeTrialLifecycleClientError &&
          (error.code === "forbidden" || error.code === "not_authenticated")) {
        if (container.parentNode === root) { root.removeChild(container); }
        return;
      }
      status.textContent = error instanceof TimeTrialLifecycleClientError &&
        error.code === "invalid_input"
        ? "Check the Player id and Track id filters, then try again."
        : "Recorded Time Trials are temporarily unavailable.";
    }
  };

  filters.addEventListener("submit", (submitEvent) => {
    submitEvent.preventDefault();
    status.textContent = "Loading recorded Time Trials…";
    void load();
  });

  const ready = load();

  return {
    container,
    ready,
    unmount(): void {
      if (disposed) { return; }
      disposed = true;
      operation += 1;
      controller.abort();
      for (const panel of panels.splice(0)) { panel.unmount(); }
      if (container.parentNode === root) { root.removeChild(container); }
    },
  };
}
