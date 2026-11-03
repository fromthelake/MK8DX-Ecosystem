// Owner decision 2026-08-28: removing a Tournament hides it rather than
// destroying it, so an administrator can always bring one back. The removal
// itself is offered on the race-day surface, where a director reaches for it;
// this is the other half - the emergency undo - and it belongs with the
// administrator, because putting a Tournament back changes what the public sees
// and what everybody's TrueSkill is.
//
// Those two are deliberately separate switches rather than one "restore
// everything": the results counting again and the rating counting again are
// different decisions, and the rating one replays every rated race from the
// seed baseline into a fresh epoch.

import {
  createTournamentOperationClient,
  type TournamentOperationClient,
  type TournamentSummary,
} from "./tournament-operation-client.js";
import { confirmDialog } from "./ds-components.js";

export type MountedAdministratorTournamentRemovalSection = Readonly<{
  element: HTMLElement;
  dispose: () => void;
}>;

export class TournamentRemovalClientError extends Error {
  public constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "TournamentRemovalClientError";
  }
}

export interface TournamentRemovalClient {
  remove(tournamentId: string, reason: string, signal?: AbortSignal): Promise<void>;
  restore(
    tournamentId: string,
    input: Readonly<{ reason: string; publicResults: boolean; affectsRating: boolean }>,
    signal?: AbortSignal,
  ): Promise<Readonly<{ wasRetracted: boolean; republished: boolean; ratingEpochId: number | null }>>;
}

const tournamentIdPattern = /^tournament\.[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function csrfToken(): string {
  const meta = document.querySelector('meta[name="mk8dx-csrf"]');
  return meta?.getAttribute("content") ?? "";
}

async function send(path: string, body: unknown, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", "x-mk8dx-csrf": csrfToken() },
    body: JSON.stringify(body),
    ...(signal === undefined ? {} : { signal }),
  });
  if (response.status === 403) {
    throw new TournamentRemovalClientError("not_authorized", "Administrator authority is required.");
  }
  if (response.status === 404) {
    throw new TournamentRemovalClientError("not_found", "That Tournament was not found.");
  }
  if (!response.ok) {
    throw new TournamentRemovalClientError("unavailable", "That action could not be completed.");
  }
  return response.json();
}

export function createTournamentRemovalClient(): TournamentRemovalClient {
  const base = (tournamentId: string): string =>
    `/v1/administrator/tournaments/${encodeURIComponent(tournamentId)}/actions`;
  return {
    async remove(tournamentId, reason, signal) {
      await send(`${base(tournamentId)}/remove`, { reason }, signal);
    },
    async restore(tournamentId, input, signal) {
      const value = await send(`${base(tournamentId)}/restore`, input, signal) as Record<string, unknown>;
      return {
        wasRetracted: value["wasRetracted"] === true,
        republished: value["republished"] === true,
        ratingEpochId: typeof value["ratingEpochId"] === "number" ? value["ratingEpochId"] : null,
      };
    },
  };
}

export function mountAdministratorTournamentRemovalSection(
  root: HTMLElement,
  clients: Readonly<{
    removal?: TournamentRemovalClient;
    directory?: Pick<TournamentOperationClient, "listForAdministrator">;
  }> = {},
): MountedAdministratorTournamentRemovalSection {
  const ownerDocument = root.ownerDocument;
  let client = clients.removal;
  const removal = (): TournamentRemovalClient =>
    (client ??= createTournamentRemovalClient());
  const directory = clients.directory ?? createTournamentOperationClient();
  const controller = new AbortController();
  let disposed = false;

  const container = ownerDocument.createElement("section");
  container.className = "tournament-removal ds-panel";
  container.setAttribute("aria-labelledby", "tournament-removal-heading");

  const heading = ownerDocument.createElement("h2");
  heading.id = "tournament-removal-heading";
  heading.className = "ds-panel__title";
  heading.textContent = "Tournament removal";

  const explanation = ownerDocument.createElement("p");
  explanation.textContent =
    "Removing a Tournament hides it: it leaves the lists, the results and " +
    "TrueSkill, but the record survives. Restoring says what it counts towards " +
    "again - putting it back into TrueSkill replays every rated race from the " +
    "start.";

  const status = ownerDocument.createElement("p");
  status.setAttribute("role", "status");

  const form = ownerDocument.createElement("form");
  form.className = "tournament-removal__form";
  const tournamentSearch = ownerDocument.createElement("input");
  tournamentSearch.type = "search";
  tournamentSearch.placeholder = "Search by name, date or status";
  tournamentSearch.setAttribute("aria-label", "Find a Tournament");
  const tournamentChoice = ownerDocument.createElement("select");
  tournamentChoice.setAttribute("aria-label", "Tournament");
  const chooseTournament = ownerDocument.createElement("option");
  chooseTournament.value = "";
  chooseTournament.textContent = "Choose a Tournament";
  tournamentChoice.append(chooseTournament);
  const reasonInput = ownerDocument.createElement("input");
  reasonInput.type = "text";
  reasonInput.maxLength = 512;
  reasonInput.placeholder = "Reason";
  reasonInput.setAttribute("aria-label", "Reason");

  const toggle = (text: string): { label: HTMLElement; input: HTMLInputElement } => {
    const label = ownerDocument.createElement("label");
    const input = ownerDocument.createElement("input");
    input.type = "checkbox";
    input.checked = true;
    const caption = ownerDocument.createElement("span");
    caption.textContent = text;
    label.append(input, caption);
    return { label, input };
  };
  const results = toggle("Results count again");
  const rating = toggle("Counts for TrueSkill again");
  const resultsLabel = results.label;
  const resultsToggle = results.input;
  const ratingLabel = rating.label;
  const ratingToggle = rating.input;

  const removeButton = ownerDocument.createElement("button");
  removeButton.type = "button";
  removeButton.setAttribute("data-variant", "danger");
  removeButton.textContent = "Remove";
  const restoreButton = ownerDocument.createElement("button");
  restoreButton.type = "submit";
  restoreButton.textContent = "Restore";

  form.append(
    tournamentSearch, tournamentChoice, reasonInput,
    resultsLabel, ratingLabel, removeButton, restoreButton,
  );
  container.append(heading, explanation, status, form);
  root.append(container);

  let tournaments: readonly TournamentSummary[] = [];
  const optionLabel = (entry: TournamentSummary): string => [
    entry.name,
    entry.eventDate,
    entry.stage,
    `step ${entry.workflowStep}`,
  ].filter((part): part is string => typeof part === "string" && part.length > 0).join(" · ");
  const renderTournamentChoices = (): void => {
    const query = tournamentSearch.value.trim().toLocaleLowerCase();
    const previous = tournamentChoice.value;
    tournamentChoice.replaceChildren(chooseTournament);
    for (const entry of tournaments.filter((candidate) =>
      query === "" || optionLabel(candidate).toLocaleLowerCase().includes(query) ||
      candidate.tournamentId.toLocaleLowerCase().includes(query))) {
      const option = ownerDocument.createElement("option");
      option.value = entry.tournamentId;
      option.textContent = optionLabel(entry);
      tournamentChoice.append(option);
    }
    if (Array.from(tournamentChoice.querySelectorAll("option"))
      .some((option) => option.value === previous)) {
      tournamentChoice.value = previous;
    }
  };
  tournamentSearch.addEventListener("input", renderTournamentChoices);
  void directory.listForAdministrator({}, controller.signal).then((entries) => {
    if (disposed) { return; }
    tournaments = entries;
    renderTournamentChoices();
    status.textContent = entries.length === 0
      ? "No Tournaments are available to change."
      : `${entries.length} Tournaments available. Search and choose one before acting.`;
  }).catch(() => {
    if (!disposed) { status.textContent = "The Tournament list could not be loaded."; }
  });

  const describe = (error: unknown): string => {
    const code = (error as { code?: string } | null)?.code;
    if (code === "not_authorized") { return "Administrator authority is required."; }
    if (code === "not_found") { return "That Tournament was not found."; }
    return "That action could not be completed.";
  };

  const validate = (): { tournamentId: string; reason: string } | null => {
    const tournamentId = tournamentChoice.value;
    const reason = reasonInput.value.trim();
    if (!tournamentIdPattern.test(tournamentId)) {
      status.textContent = "Choose a Tournament.";
      return null;
    }
    if (reason.length < 3 || reason.length > 512) {
      status.textContent = "Give a reason of at least three characters.";
      return null;
    }
    return { tournamentId, reason };
  };
  const selectedTournamentLabel = (): string =>
    Array.from(tournamentChoice.querySelectorAll("option"))
      .find((option) => option.value === tournamentChoice.value)?.textContent ?? tournamentChoice.value;

  const busy = (value: boolean): void => {
    removeButton.disabled = value;
    restoreButton.disabled = value;
  };

  removeButton.addEventListener("click", () => {
    const input = validate();
    if (input === null) { return; }
    const selectedLabel = selectedTournamentLabel();
    const confirmation = confirmDialog({
      title: "Remove this Tournament?",
      description: `${selectedLabel} will disappear from public lists and its results and rating contribution will stop counting. The record remains available to restore.`,
      confirmLabel: "Remove Tournament",
      tone: "danger",
      onConfirm: () => {
        busy(true);
        removal().remove(input.tournamentId, input.reason, controller.signal)
          .then(() => { status.textContent = `${input.tournamentId} was removed and is now hidden.`; })
          .catch((error: unknown) => { status.textContent = describe(error); })
          .finally(() => { busy(false); });
      },
    });
    confirmation.open();
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const input = validate();
    if (input === null) { return; }
    const selectedLabel = selectedTournamentLabel();
    const counts = [
      resultsToggle.checked ? "publish its results" : "keep its results hidden",
      ratingToggle.checked ? "replay it into TrueSkill" : "keep it out of TrueSkill",
    ].join(" and ");
    const confirmation = confirmDialog({
      title: "Restore this Tournament?",
      description: `${selectedLabel} will return to the Tournament list. This will ${counts}.`,
      confirmLabel: "Restore Tournament",
      onConfirm: () => {
        busy(true);
        removal().restore(input.tournamentId, {
          reason: input.reason,
          publicResults: resultsToggle.checked,
          affectsRating: ratingToggle.checked,
        }, controller.signal)
          .then((state) => {
            const parts = [`${input.tournamentId} is back.`];
            if (state.republished) { parts.push("Its results are published again."); }
            if (state.ratingEpochId !== null) {
              parts.push(`TrueSkill was replayed into epoch ${state.ratingEpochId}.`);
            }
            status.textContent = parts.join(" ");
          })
          .catch((error: unknown) => { status.textContent = describe(error); })
          .finally(() => { busy(false); });
      },
    });
    confirmation.open();
  });

  return {
    element: container,
    dispose: () => {
      if (disposed) { return; }
      disposed = true;
      controller.abort();
      container.remove();
    },
  };
}
