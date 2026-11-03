import {
  createTournamentPublicationClient,
  TournamentPublicationClientError,
  type CanonicalImportOutcome,
  type CanonicalRaceDocument,
  type TournamentPublicationClient,
} from "./tournament-publication-client.js";
import {
  createPlayerClaimClient,
  type ClaimablePlayerSummary,
  type PlayerClaimClient,
} from "./player-claim-client.js";
import { localized } from "./product-language.js";

// The recorded (Tournament Processor) and live (Tournament Live) products
// write canonical `TournamentRaceResultV1` documents locally. This is the
// administrator boundary that carries those documents into the platform.
// Producer participant references are observations, never identities, so
// every one of them must be reconciled to an explicit central Player here
// before the import is allowed (ADR-0147, Identity Policy V1). Nothing on
// this screen publishes anything: imported races become review candidates.

const MAXIMUM_DOCUMENT_BYTES = 2 * 1024 * 1024;
const CANONICAL_SCHEMA = "mk8dx.tournament-race-result.v1";
const playerIdPattern = /^player\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

export type MountedTournamentCanonicalImportSection = Readonly<{
  container: HTMLElement;
  unmount(): void;
}>;

type ParticipantKey = string;

type ParticipantRow = Readonly<{
  key: ParticipantKey;
  namespace: string;
  value: string;
  observedName: string | null;
  raceCount: number;
}>;

function clear(element: HTMLElement): void {
  while (element.firstChild !== null) { element.removeChild(element.firstChild); }
}

function participantKey(namespace: string, value: string): ParticipantKey {
  return `${namespace}\u0000${value}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class CanonicalDocumentError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "CanonicalDocumentError";
  }
}

// A deliberately small structural check: the platform re-validates every
// field server-side. This exists so the operator sees an understandable
// message instead of a rejected upload, and so the participant list can be
// built at all.
export function parseCanonicalRaceDocuments(
  text: string,
): readonly CanonicalRaceDocument[] {
  if (text.length > MAXIMUM_DOCUMENT_BYTES) {
    throw new CanonicalDocumentError("That file is too large to import.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new CanonicalDocumentError("That file is not valid JSON.");
  }
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  if (rows.length < 1 || rows.length > 1000) {
    throw new CanonicalDocumentError("Expected between 1 and 1000 race results.");
  }
  return rows.map((row) => {
    if (!isRecord(row) || row["schemaVersion"] !== CANONICAL_SCHEMA) {
      throw new CanonicalDocumentError(
        "That file does not contain canonical Tournament race results.",
      );
    }
    const raceResultId = row["raceResultId"];
    const revision = row["revision"];
    const trackId = row["trackId"];
    const placements = row["placements"];
    if (typeof raceResultId !== "string" || raceResultId.length < 1 ||
      typeof trackId !== "string" || trackId.length < 1 ||
      typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 1 ||
      !Array.isArray(placements) || placements.length < 1 || placements.length > 12) {
      throw new CanonicalDocumentError("A race result is missing required fields.");
    }
    for (const placement of placements) {
      if (!isRecord(placement)) {
        throw new CanonicalDocumentError("A race placement is not an object.");
      }
      const reference = placement["participantReference"];
      if (!isRecord(reference) || typeof reference["namespace"] !== "string" ||
        typeof reference["value"] !== "string") {
        throw new CanonicalDocumentError("A race placement has no participant reference.");
      }
      const observed = placement["observedPlayerName"];
      if (observed !== undefined && typeof observed !== "string") {
        throw new CanonicalDocumentError("A race placement has an invalid observed name.");
      }
    }
    return row as unknown as CanonicalRaceDocument;
  });
}

export function collectParticipants(
  documents: readonly CanonicalRaceDocument[],
): readonly ParticipantRow[] {
  const rows = new Map<ParticipantKey, {
    namespace: string;
    value: string;
    observedName: string | null;
    raceCount: number;
  }>();
  for (const document of documents) {
    const seen = new Set<ParticipantKey>();
    for (const placement of document.placements) {
      const { namespace, value } = placement.participantReference;
      const key = participantKey(namespace, value);
      const existing = rows.get(key);
      if (existing === undefined) {
        rows.set(key, {
          namespace,
          value,
          observedName: placement.observedPlayerName ?? null,
          raceCount: 1,
        });
        seen.add(key);
        continue;
      }
      if (existing.observedName === null && placement.observedPlayerName !== undefined) {
        existing.observedName = placement.observedPlayerName;
      }
      if (!seen.has(key)) { existing.raceCount += 1; seen.add(key); }
    }
  }
  return [...rows.entries()].map(([key, row]) => ({ key, ...row }));
}

export function reconcileDocument(
  document: CanonicalRaceDocument,
  mapping: ReadonlyMap<ParticipantKey, string>,
): CanonicalRaceDocument {
  const placements = document.placements.map((placement) => {
    const { namespace, value } = placement.participantReference;
    if (namespace === "player") { return placement; }
    const playerId = mapping.get(participantKey(namespace, value));
    if (playerId === undefined) {
      throw new CanonicalDocumentError("Every participant must be reconciled first.");
    }
    return {
      ...placement,
      participantReference: { namespace: "player", value: playerId },
    };
  });
  return { ...document, placements } as CanonicalRaceDocument;
}

function outcomeText(outcome: CanonicalImportOutcome): string {
  switch (outcome) {
    case "imported": return localized("imported", "geïmporteerd");
    case "already_imported": return localized("already imported (unchanged)", "al geïmporteerd (ongewijzigd)");
    case "player_not_found": return localized("refused: a mapped Player is not active", "geweigerd: een gekoppelde speler is niet actief");
    default: return localized("failed", "mislukt");
  }
}

export function mountTournamentCanonicalImportSection(
  root: HTMLElement,
  options: Readonly<{
    client?: TournamentPublicationClient;
    directory?: PlayerClaimClient;
    // Receives the canonical ids the platform accepted (newly imported or
    // already imported unchanged), so a caller can bind them to a tournament
    // group (ADR-0160) without re-reading the file.
    onImported?: (acceptedRaceResultIds: readonly string[]) => void;
  }> = {},
): MountedTournamentCanonicalImportSection {
  const client = options.client ?? createTournamentPublicationClient();
  const directory = options.directory ?? createPlayerClaimClient();
  const document = root.ownerDocument;
  const controller = new AbortController();
  let documents: readonly CanonicalRaceDocument[] = [];
  let participants: readonly ParticipantRow[] = [];
  const mapping = new Map<ParticipantKey, string>();
  let importing = false;

  const container = document.createElement("section");
  container.className = "tournament-canonical-import ds-panel";
  container.setAttribute("aria-labelledby", "tournament-canonical-import-heading");
  const heading = document.createElement("h2");
  heading.id = "tournament-canonical-import-heading";
  heading.className = "ds-panel__title";
  heading.textContent = localized("Import canonical race results", "Canonieke race-uitslagen importeren");
  const explanation = document.createElement("p");
  explanation.textContent = localized(
    "Load the TournamentRaceResultsV1 file written by Tournament Processor or Tournament Live. Every observed participant must be matched to a Player before importing. Imported races stay private until you publish them below.",
    "Laad het TournamentRaceResultsV1-bestand van Tournament Processor of Tournament Live. Iedere waargenomen deelnemer moet vóór import aan een speler worden gekoppeld. Geïmporteerde races blijven privé totdat je ze hieronder publiceert.",
  );

  const sourceLabel = document.createElement("label");
  sourceLabel.textContent = localized("Canonical result file", "Canoniek uitslagbestand");
  const file = document.createElement("input");
  file.type = "file";
  file.accept = ".json,application/json";
  sourceLabel.append(file);

  const pasteLabel = document.createElement("label");
  pasteLabel.textContent = localized("…or paste the canonical JSON", "…of plak de canonieke JSON");
  const paste = document.createElement("textarea");
  paste.rows = 4;
  paste.spellcheck = false;
  pasteLabel.append(paste);
  const loadPasted = document.createElement("button");
  loadPasted.type = "button";
  loadPasted.className = "tt-auth__button";
  loadPasted.textContent = localized("Load pasted JSON", "Geplakte JSON laden");

  const status = document.createElement("p");
  status.setAttribute("role", "status");
  status.textContent = localized("No canonical race results loaded.", "Geen canonieke race-uitslagen geladen.");

  const participantsRoot = document.createElement("div");
  participantsRoot.className = "tournament-canonical-import__participants";

  const submit = document.createElement("button");
  submit.type = "button";
  submit.className = "tt-auth__button tt-auth__button--primary";
  submit.textContent = localized("Import reconciled races", "Gereconcilieerde races importeren");
  submit.disabled = true;

  const outcomes = document.createElement("ul");
  outcomes.className = "tournament-canonical-import__outcomes";

  container.append(
    heading, explanation, sourceLabel, pasteLabel, loadPasted,
    status, participantsRoot, submit, outcomes,
  );
  root.append(container);

  const refreshSubmitState = (): void => {
    const unresolved = participants.filter(
      (participant) => participant.namespace !== "player" &&
        mapping.get(participant.key) === undefined,
    ).length;
    submit.disabled = importing || documents.length === 0 || unresolved > 0;
    if (documents.length === 0) { return; }
    status.textContent = unresolved === 0
      ? localized(
        `${documents.length} race result${documents.length === 1 ? "" : "s"} ready to import.`,
        `${documents.length} race-uitslag${documents.length === 1 ? "" : "en"} klaar voor import.`,
      )
      : localized(
        `${documents.length} race result${documents.length === 1 ? "" : "s"} loaded · ${unresolved} participant${unresolved === 1 ? "" : "s"} still to match.`,
        `${documents.length} race-uitslag${documents.length === 1 ? "" : "en"} geladen · nog ${unresolved} deelnemer${unresolved === 1 ? "" : "s"} te koppelen.`,
      );
  };

  const renderParticipants = (): void => {
    clear(participantsRoot);
    if (participants.length === 0) { return; }
    const list = document.createElement("ul");
    for (const participant of participants) {
      const item = document.createElement("li");
      const summary = document.createElement("span");
      const observed = participant.observedName === null
        ? participant.value
        : `${participant.observedName} (${participant.value})`;
      summary.textContent = `${observed} · ${participant.namespace} · ` +
        `${participant.raceCount} race${participant.raceCount === 1 ? "" : "s"}`;
      item.append(summary);
      if (participant.namespace === "player") {
        const resolved = document.createElement("span");
        resolved.textContent = localized(" · already a central Player", " · al een centrale speler");
        item.append(resolved);
        list.append(item);
        continue;
      }
      const search = document.createElement("input");
      search.type = "search";
      search.placeholder = localized("Search Players", "Spelers zoeken");
      search.setAttribute("aria-label", localized(`Search a Player for ${observed}`, `Zoek een speler voor ${observed}`));
      const choice = document.createElement("select");
      choice.setAttribute("aria-label", localized(`Player for ${observed}`, `Speler voor ${observed}`));
      const empty = document.createElement("option");
      empty.value = "";
      empty.textContent = localized("Not matched", "Niet gekoppeld");
      choice.append(empty);
      const note = document.createElement("span");
      let timer: ReturnType<typeof setTimeout> | undefined;
      const runSearch = async (): Promise<void> => {
        const query = search.value.trim();
        if (query.length < 2) { return; }
        try {
          const found: readonly ClaimablePlayerSummary[] =
            await directory.search(query, controller.signal);
          const previous = choice.value;
          clear(choice);
          const none = document.createElement("option");
          none.value = "";
          none.textContent = localized("Not matched", "Niet gekoppeld");
          choice.append(none);
          for (const player of found) {
            const option = document.createElement("option");
            option.value = player.playerId;
            // The identifier is a UUID for every self-service Player; the
            // handle is the readable part, so the identifier stays out.
            option.textContent = `${player.displayName} (@${player.username})`;
            choice.append(option);
          }
          if (previous !== "" && found.some((p) => p.playerId === previous)) {
            choice.value = previous;
          } else if (previous !== "") {
            mapping.delete(participant.key);
            refreshSubmitState();
          }
          note.textContent = found.length === 0
            ? localized(" · no Player matched that search", " · geen speler gevonden voor deze zoekopdracht")
            : "";
        } catch {
          note.textContent = localized(" · Player search is unavailable", " · spelers zoeken is niet beschikbaar");
        }
      };
      search.addEventListener("input", () => {
        if (timer !== undefined) { clearTimeout(timer); }
        timer = setTimeout(() => { void runSearch(); }, 250);
      });
      choice.addEventListener("change", () => {
        const value = choice.value;
        if (value === "" || !playerIdPattern.test(value)) {
          mapping.delete(participant.key);
        } else {
          mapping.set(participant.key, value);
        }
        refreshSubmitState();
      });
      item.append(search, choice, note);
      list.append(item);
    }
    participantsRoot.append(list);
  };

  const load = (text: string): void => {
    clear(outcomes);
    mapping.clear();
    try {
      documents = parseCanonicalRaceDocuments(text);
    } catch (error) {
      documents = [];
      participants = [];
      renderParticipants();
      status.textContent = error instanceof CanonicalDocumentError
        ? error.message
        : localized("That file could not be read.", "Dat bestand kon niet worden gelezen.");
      submit.disabled = true;
      return;
    }
    participants = collectParticipants(documents);
    renderParticipants();
    refreshSubmitState();
  };

  file.addEventListener("change", () => {
    const chosen = file.files?.[0];
    if (chosen === undefined || chosen === null) { return; }
    void chosen.text().then(load).catch(() => {
      status.textContent = localized("That file could not be read.", "Dat bestand kon niet worden gelezen.");
    });
  });
  loadPasted.addEventListener("click", () => { load(paste.value); });

  submit.addEventListener("click", () => {
    if (importing || documents.length === 0) { return; }
    importing = true;
    submit.disabled = true;
    clear(outcomes);
    status.textContent = localized("Importing canonical race results…", "Canonieke race-uitslagen importeren…");
    void (async () => {
      let imported = 0;
      let failed = 0;
      const accepted: string[] = [];
      for (const document_ of documents) {
        let outcome: CanonicalImportOutcome;
        try {
          outcome = await client.submitRaceResult(
            reconcileDocument(document_, mapping),
            controller.signal,
          );
        } catch (error) {
          outcome = error instanceof TournamentPublicationClientError &&
            error.code === "not_authorized" ? "failed" : "failed";
        }
        if (outcome === "imported" || outcome === "already_imported") {
          imported += 1;
          accepted.push(document_.raceResultId);
        } else { failed += 1; }
        const row = document.createElement("li");
        row.textContent = `${document_.raceResultId} · ${outcomeText(outcome)}`;
        outcomes.append(row);
      }
      importing = false;
      refreshSubmitState();
      // The import summary is the last word on this panel: refreshSubmitState
      // above restores the "ready to import" line, so state it afterwards.
      status.textContent = localized(
        `${imported} of ${documents.length} race result${documents.length === 1 ? "" : "s"} accepted${failed === 0 ? "." : `, ${failed} refused.`}`,
        `${imported} van ${documents.length} race-uitslag${documents.length === 1 ? "" : "en"} geaccepteerd${failed === 0 ? "." : `, ${failed} geweigerd.`}`,
      );
      options.onImported?.(accepted);
    })();
  });

  return {
    container,
    unmount(): void {
      controller.abort();
      if (container.parentNode === root) { root.removeChild(container); }
    },
  };
}
