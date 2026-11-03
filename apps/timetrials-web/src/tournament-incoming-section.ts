import {
  TournamentIncomingClient,
  type IncomingTournamentResult,
  type TournamentEvidenceRecord,
} from "./tournament-incoming-client.js";
import type { TournamentDocument } from "./tournament-operation-client.js";
import { localized } from "./product-language.js";
import { displayTournamentGroupLabel } from "./tournaments-view-labels.js";

type MountOptions = Readonly<{
  document: Document;
  container: HTMLElement;
  tournament: TournamentDocument;
  signal?: AbortSignal;
  participantAliases?: ReadonlyMap<string, readonly string[]>;
  confirmedMappings?: Map<string, string>;
  onChanged(): Promise<void>;
}>;

export type ProvisionalIncomingGroupSummary = Readonly<{
  groupId: string;
  races: number;
  connectionErrors: number;
  blocked: boolean;
  totals: readonly Readonly<{ observedPlayer: string; points: number }>[];
}>;

function row(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function input(document: Document, type = "text"): HTMLInputElement {
  const element = document.createElement("input");
  element.type = type;
  return element;
}

function label(document: Document, text: string, control: HTMLElement): HTMLLabelElement {
  const element = document.createElement("label");
  const title = document.createElement("span");
  title.textContent = text;
  element.append(title, control);
  return element;
}

function normalizedName(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase().replace(/[^a-z0-9]/g, "");
}

function sourceName(sourceKind: string): string {
  if (sourceKind === "tournament_live_capture") return "Tournament Live";
  if (sourceKind === "recorded_video" || sourceKind === "tournament_recorded_video") return "Tournament Processor";
  if (sourceKind === "spreadsheet_import") return localized("Excel import", "Excel-import");
  return localized("Imported result", "Geïmporteerde uitslag");
}

function phaseForStep(step: number): "qualifier" | "final" {
  return step >= 7 ? "final" : "qualifier";
}

function suggestedGroupId(
  tournament: TournamentDocument,
  observedLabel: string,
  phase: "qualifier" | "final",
): string | null {
  const observed = normalizedName(observedLabel)
    .replace(/^groep/, "group")
    .replace(/^champion/, "kampioen");
  const eligible = tournament.groups.filter((group) => group.stage === phase);
  const exact = eligible.filter((group) => {
    const candidate = normalizedName(group.name)
      .replace(/^groep/, "group")
      .replace(/^champion/, "kampioen");
    return candidate === observed;
  });
  if (exact.length === 1) return exact[0]!.groupId;
  const number = observed.match(/(?:group)?(\d+)$/)?.[1];
  if (number !== undefined) {
    const numeric = eligible.filter((group) => normalizedName(group.name).match(/(\d+)$/)?.[1] === number);
    if (numeric.length === 1) return numeric[0]!.groupId;
  }
  return null;
}

function evidenceRecordCard(
  options: MountOptions,
  client: TournamentIncomingClient,
  evidence: TournamentEvidenceRecord,
): HTMLElement {
  const { document, tournament } = options;
  const card = document.createElement("article");
  card.className = "tournament-op__card tournament-op__evidence-card";
  const heading = document.createElement("h4");
  heading.textContent = `${sourceName(evidence.sourceKind)} · ${evidence.uploadedBy.displayName}`;
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  const times = document.createElement("p");
  const started = evidence.startedAtMs === null ? localized("start unknown", "start onbekend") : new Date(evidence.startedAtMs).toLocaleString();
  const stopped = evidence.stoppedAtMs === null ? localized("stop unknown", "stop onbekend") : new Date(evidence.stoppedAtMs).toLocaleString();
  times.textContent = localized(
    `Recording: ${started} – ${stopped} · analysis ${evidence.analysisCompletedAtMs === null ? "not completed" : "completed"}`,
    `Opname: ${started} – ${stopped} · analyse ${evidence.analysisCompletedAtMs === null ? "niet voltooid" : "voltooid"}`,
  );
  const suggestion = document.createElement("p");
  suggestion.className = "tournament-op__hint";
  suggestion.textContent = evidence.suggestedTournamentId === tournament.summary.tournamentId
    ? localized("The uploader suggested this Tournament. You remain responsible for the final link.", "De uploader stelde dit toernooi voor. Jij bepaalt de definitieve koppeling.")
    : evidence.suggestedTournamentName === null
      ? localized("No Tournament was suggested by the uploader.", "De uploader heeft geen toernooi voorgesteld.")
      : localized(`The uploader suggested “${evidence.suggestedTournamentName}”; you are viewing this record as an alternative.`, `De uploader stelde “${evidence.suggestedTournamentName}” voor; je bekijkt deze opname als alternatief.`);
  card.append(heading, times, suggestion);

  const phase = evidence.live?.mappings[0]?.phase === "final" || evidence.live?.mappings[0]?.phase === "qualifier"
    ? evidence.live.mappings[0].phase
    : phaseForStep(tournament.summary.workflowStep);
  const observedGroups = evidence.groups.length > 0 ? evidence.groups : (evidence.live?.mappings ?? []).map((mapping) => ({
    observedGroupLabel: mapping.observedGroupLabel, races: 0, connectionErrors: 0, topThree: [],
  }));
  const mappings: Array<{ observedGroupLabel: string; select: HTMLSelectElement; phase: string }> = [];
  for (const observed of observedGroups) {
    const block = document.createElement("section");
    const summary = document.createElement("p");
    summary.textContent = `${observed.observedGroupLabel} · ${observed.races} ${localized("races", "races")} · ${observed.connectionErrors} ${localized("connection errors", "verbindingsfouten")}`;
    const topThree = document.createElement("p");
    topThree.className = "tournament-op__hint";
    topThree.textContent = observed.topThree.length === 0
      ? localized("Top 3 unavailable", "Top 3 niet beschikbaar")
      : `${localized("Top 3", "Top 3")}: ${observed.topThree.map((score, index) => `${index + 1}. ${score.observedPlayer} (${score.points})`).join(" · ")}`;
    const select = document.createElement("select");
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = localized("Choose the matching group", "Kies de bijbehorende groep");
    select.append(placeholder);
    const existingMapping = evidence.live?.mappings.find((mapping) => mapping.observedGroupLabel === observed.observedGroupLabel);
    const proposed = existingMapping?.groupId ?? suggestedGroupId(tournament, observed.observedGroupLabel, phase);
    for (const group of tournament.groups.filter((candidate) => candidate.stage === phase)) {
      const option = document.createElement("option");
      option.value = group.groupId;
      const optionName = displayTournamentGroupLabel(group.name, group.tierKey);
      option.textContent = group.groupId === proposed
        ? `${optionName} — ${localized("suggested", "voorgesteld")}`
        : optionName;
      option.selected = group.groupId === proposed;
      select.append(option);
    }
    mappings.push({ observedGroupLabel: observed.observedGroupLabel, select, phase: existingMapping?.phase ?? phase });
    block.append(summary, topThree, label(document, localized("Link to group", "Koppelen aan groep"), select));
    card.append(block);
  }
  if (evidence.live?.status === "requested") {
    status.textContent = localized(
      "Waiting for race names to verify the sticker-to-group links. Nothing is public yet; the director can confirm manually as a fallback.",
      "Wacht op racenamen om de sticker-naar-groepkoppelingen te controleren. Er is nog niets openbaar; de toernooileider kan als terugval handmatig bevestigen.",
    );
  } else if (evidence.live?.status === "active") {
    status.textContent = localized(
      "Live now: public viewers see in-game names and Total. Player linking follows after Stop.",
      "Nu live: openbare kijkers zien ingamenamen en Total. Player-koppeling volgt na Stop.",
    );
  } else if (evidence.live?.status === "stopping") {
    status.textContent = localized("Stop received; waiting for the final upload.", "Stop ontvangen; de laatste upload wordt afgewacht.");
  } else if (evidence.live?.status === "complete") {
    status.textContent = localized(
      "Live feed complete. Check the final totals, then link the observed names to Players.",
      "Live-feed voltooid. Controleer de eindtotalen en koppel daarna de waargenomen namen aan Players.",
    );
  } else if (evidence.status === "linked") {
    status.textContent = localized(
      "This record is linked. Its races remain available for review. If the layout changed, review the suggestions below and update the group links.",
      "Deze opname is gekoppeld. De races blijven beschikbaar voor controle. Controleer na een gewijzigde indeling de voorstellen hieronder en werk de groepskoppelingen bij.",
    );
  } else if (!evidence.complete) {
    status.textContent = localized("The run is still uploading or analysing and cannot be linked yet.", "De run wordt nog geüpload of geanalyseerd en kan nog niet worden gekoppeld.");
  } else if (mappings.length === 0 || tournament.groups.filter((group) => group.stage === phase).length === 0) {
    status.textContent = localized("Create the relevant Tournament groups first; this recording remains safely available.", "Maak eerst de betreffende toernooigroepen; deze opname blijft veilig beschikbaar.");
  } else {
    status.textContent = "";
  }
  if (evidence.live !== undefined && evidence.live.status !== "invalidated" && mappings.length > 0) {
    const liveButton = document.createElement("button");
    liveButton.type = "button";
    liveButton.className = "tt-auth__button tt-auth__button--primary";
    liveButton.textContent = evidence.live.status === "requested"
      ? localized("Confirm live routing manually", "Live-koppeling handmatig bevestigen")
      : localized("Repair live group links", "Live-groepskoppelingen herstellen");
    liveButton.addEventListener("click", () => {
      if (mappings.some((mapping) => mapping.select.value === "")) {
        status.textContent = localized("Choose one Tournament group for every sticker feed.", "Kies voor iedere stickerfeed één toernooigroep.");
        return;
      }
      if (new Set(mappings.map((mapping) => mapping.select.value)).size !== mappings.length) {
        status.textContent = localized("A Tournament group cannot use two live feeds.", "Een toernooigroep kan niet twee live-feeds gebruiken.");
        return;
      }
      liveButton.disabled = true;
      status.textContent = localized("Saving the checked live routing…", "Gecontroleerde live-routering opslaan…");
      void client.approveLiveAssociation(tournament.summary.tournamentId, evidence, mappings.map((mapping) => ({
        observedGroupLabel: mapping.observedGroupLabel,
        groupId: mapping.select.value,
        phase: mapping.phase,
      })), options.signal).then(options.onChanged).catch((error: unknown) => {
        status.textContent = error instanceof Error ? error.message : localized("The live routing could not be saved.", "De live-routering kon niet worden opgeslagen.");
        liveButton.disabled = false;
      });
    });
    card.append(liveButton);
  }
  if (evidence.complete && mappings.length > 0 &&
      tournament.groups.filter((group) => group.stage === phase).length > 0 &&
      evidence.status !== "uploading" && evidence.status !== "blocked") {
    const linkButton = document.createElement("button");
    linkButton.type = "button";
    linkButton.className = "tt-auth__button tt-auth__button--primary";
    linkButton.textContent = evidence.status === "linked"
      ? localized("Update reviewed group links", "Gecontroleerde groepskoppelingen bijwerken")
      : localized("Link reviewed recording", "Gecontroleerde opname koppelen");
    linkButton.addEventListener("click", () => {
      if (mappings.some((mapping) => mapping.select.value === "")) {
        status.textContent = localized("Choose a Tournament group for every recorded feed.", "Kies voor iedere opgenomen feed een toernooigroep.");
        return;
      }
      if (new Set(mappings.map((mapping) => mapping.select.value)).size !== mappings.length) {
        status.textContent = localized("Every recorded feed must map to a different Tournament group.", "Iedere opgenomen feed moet aan een andere toernooigroep worden gekoppeld.");
        return;
      }
      linkButton.disabled = true;
      status.textContent = localized("Linking races as pending evidence…", "Races worden als bewijs in afwachting gekoppeld…");
      void client.linkEvidenceRecord(tournament.summary.tournamentId, evidence, mappings.map((mapping) => ({
        observedGroupLabel: mapping.observedGroupLabel,
        groupId: mapping.select.value,
        phase,
      })), options.signal).then(options.onChanged).catch((error: unknown) => {
        status.textContent = error instanceof Error ? error.message : localized("The recording could not be linked.", "De opname kon niet worden gekoppeld.");
        linkButton.disabled = false;
      });
    });
    card.append(linkButton);
  }
  card.append(status);
  return card;
}

function exactSuggestedPlayer(
  options: MountOptions,
  observed: string,
  groupId: string,
): string | null {
  const normalized = normalizedName(observed);
  const remembered = options.confirmedMappings?.get(normalized);
  const group = options.tournament.groups.find((candidate) => candidate.groupId === groupId);
  const eligible = new Set(group?.members.map((member) => member.playerId) ?? []);
  if (remembered !== undefined && eligible.has(remembered)) return remembered;
  const matches = options.tournament.participants.filter((participant) => {
    if (!eligible.has(participant.playerId)) return false;
    const names = [participant.username, participant.displayName,
      ...(options.participantAliases?.get(participant.playerId) ?? [])];
    return names.some((name) => normalizedName(name) === normalized);
  });
  return matches.length === 1 ? matches[0]!.playerId : null;
}

function correctedResult(
  pending: IncomingTournamentResult,
  track: HTMLInputElement,
  mappings: readonly HTMLSelectElement[],
): Readonly<Record<string, unknown>> {
  const result = { ...pending.result };
  const placementsValue = result["placements"];
  if (!Array.isArray(placementsValue)) throw new Error("The pending result has no placements.");
  result["trackId"] = track.value.trim();
  result["verification"] = {
    ...row(result["verification"]),
    status: "producer_check_passed",
    method: "tournament_manager_human_confirmation",
  };
  result["placements"] = placementsValue.map((value, index) => ({
    ...row(value),
    participantReference: { namespace: "player", value: mappings[index]!.value },
  }));
  return result;
}

export function provisionalIncomingGroupSummaries(
  incoming: readonly IncomingTournamentResult[],
): readonly ProvisionalIncomingGroupSummary[] {
  const groups = new Map<string, { races: number; maximumSegment: number; totals: Map<string, number> }>();
  for (const entry of incoming.filter((candidate) => candidate.status === "pending" && candidate.suggestedGroupId !== null)) {
    const groupId = entry.suggestedGroupId!;
    const aggregate = groups.get(groupId) ?? { races: 0, maximumSegment: 1, totals: new Map<string, number>() };
    aggregate.races += 1;
    const segment = Number(entry.result["scoringSegment"] ?? 1);
    if (Number.isSafeInteger(segment) && segment > aggregate.maximumSegment) aggregate.maximumSegment = segment;
    const placements = entry.result["placements"];
    if (Array.isArray(placements)) {
      for (const value of placements) {
        const placement = row(value);
        const reference = row(placement["participantReference"]);
        const scoring = row(placement["scoring"]);
        const observed = typeof placement["observedPlayerName"] === "string"
          ? placement["observedPlayerName"]
          : typeof reference["value"] === "string" ? reference["value"] : "Unknown Player";
        const points = Number(scoring["racePoints"] ?? 0);
        if (Number.isSafeInteger(points) && points >= 0) {
          aggregate.totals.set(observed, (aggregate.totals.get(observed) ?? 0) + points);
        }
      }
    }
    groups.set(groupId, aggregate);
  }
  return [...groups].map(([groupId, aggregate]) => ({
    groupId,
    races: aggregate.races,
    connectionErrors: aggregate.maximumSegment - 1,
    blocked: aggregate.maximumSegment - 1 > 3,
    totals: [...aggregate.totals].map(([observedPlayer, points]) => ({ observedPlayer, points }))
      .sort((left, right) => right.points - left.points || left.observedPlayer.localeCompare(right.observedPlayer)),
  }));
}

type PendingCardHandle = Readonly<{
  element: HTMLElement;
  group: HTMLSelectElement;
  draft(): Readonly<{
    incomingResultId: string;
    expectedRevision: number;
    raceNumber: number;
    correctedResult: Readonly<Record<string, unknown>>;
    occurredAtMs?: number;
  }>;
  rememberMappings(): void;
  setStatus(message: string): void;
}>;

function pendingCard(
  options: MountOptions,
  client: TournamentIncomingClient,
  pending: IncomingTournamentResult,
  blockedByResetLimit = false,
): PendingCardHandle {
  const { document, tournament } = options;
  const card = document.createElement("article");
  card.className = "tournament-op__card tournament-op__incoming-card";
  const title = document.createElement("h4");
  const result = pending.result;
  title.textContent = `${sourceName(pending.sourceKind)} · ${localized("race", "race")} ${String(result["raceNumber"] ?? "?")} · ${localized("Needs review", "Moet worden gecontroleerd")}`;
  const meta = document.createElement("p");
  meta.textContent = `${pending.capturedAtMs === null ? localized("Time unknown", "Tijd onbekend") : new Date(pending.capturedAtMs).toLocaleString()}${pending.duplicateWarning ? localized(" · Likely duplicate: review existing race", " · Waarschijnlijk dubbel: controleer de bestaande race") : ""}`;
  if (pending.duplicateWarning) meta.className = "tournament-op__warning";

  const group = document.createElement("select");
  const activePhase = phaseForStep(tournament.summary.workflowStep);
  for (const tournamentGroup of tournament.groups.filter((candidate) => candidate.stage === activePhase)) {
    const option = document.createElement("option");
    option.value = tournamentGroup.groupId;
    option.textContent = `${tournamentGroup.stage} · ${tournamentGroup.name}`;
    option.selected = pending.suggestedGroupId === tournamentGroup.groupId;
    group.append(option);
  }
  const raceNumber = input(document, "number");
  raceNumber.min = "1";
  raceNumber.max = "64";
  const selectedGroup = tournament.groups.find((candidate) => candidate.groupId === group.value) ??
    tournament.groups.find((candidate) => candidate.stage === activePhase);
  raceNumber.value = String(pending.suggestedRaceNumber ?? ((selectedGroup?.races.length ?? 0) + 1));
  const track = input(document);
  track.value = typeof result["trackId"] === "string" ? result["trackId"] : "";

  const placements = Array.isArray(result["placements"]) ? result["placements"] : [];
  const observedNames: string[] = [];
  const mappings = placements.map((placementValue, index) => {
    const placement = row(placementValue);
    const reference = row(placement["participantReference"]);
    const select = document.createElement("select");
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = localized("Choose Player", "Kies een speler");
    select.append(placeholder);
    const observed = typeof placement["observedPlayerName"] === "string"
      ? placement["observedPlayerName"]
      : typeof reference["value"] === "string" ? reference["value"] : `Position ${index + 1}`;
    observedNames.push(observed);
    const suggestion = exactSuggestedPlayer(options, observed, group.value);
    for (const participant of tournament.participants) {
      const option = document.createElement("option");
      option.value = participant.playerId;
      option.textContent = participant.playerId === suggestion
        ? `${participant.displayName} — ${localized("suggested match", "voorgestelde koppeling")}`
        : participant.displayName;
      option.selected = (reference["namespace"] === "player" && reference["value"] === participant.playerId) ||
        (reference["namespace"] !== "player" && participant.playerId === suggestion);
      select.append(option);
    }
    card.append(label(document, `${String(placement["finishPosition"] ?? index + 1)}. ${observed}`, select));
    return select;
  });

  const reason = input(document);
  reason.value = localized("Confirmed by the Director", "Bevestigd door de Directeur");
  const actions = document.createElement("div");
  actions.className = "tournament-op__toolbar";
  const accept = document.createElement("button");
  accept.type = "button";
  accept.className = "tt-auth__button tt-auth__button--primary";
  accept.textContent = localized("Accept confirmed result", "Bevestigde uitslag accepteren");
  accept.disabled = blockedByResetLimit;
  const reject = document.createElement("button");
  reject.type = "button";
  reject.className = "tt-auth__button";
  reject.textContent = localized("Reject", "Afwijzen");
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  if (blockedByResetLimit) {
    status.textContent = localized(
      "Confirmation is blocked because this group contains more than three connection resets. Correct the desktop session first; no segments were discarded.",
      "Bevestiging is geblokkeerd omdat deze groep meer dan drie verbindingsherstarts bevat. Corrigeer eerst de desktopsessie; er zijn geen scoredelen verwijderd.",
    );
  }
  const batchManaged = pending.suggestedGroupId !== null && tournament.groups.some(
    (candidate) => candidate.groupId === pending.suggestedGroupId && candidate.stage === activePhase,
  );
  if (batchManaged && !blockedByResetLimit) {
    status.textContent = localized(
      "Map and review this race, then confirm the complete group feed with the button above.",
      "Koppel en controleer deze race en bevestig daarna de volledige groepsfeed met de knop hierboven.",
    );
  }

  accept.addEventListener("click", () => {
    const selectedRace = Number(raceNumber.value);
    const groupPlayerIds = new Set(tournament.groups.find((candidate) => candidate.groupId === group.value)
      ?.members.map((member) => member.playerId) ?? []);
    if (group.value === "" || !Number.isSafeInteger(selectedRace) || track.value.trim() === "" ||
        mappings.some((mapping) => mapping.value === "" || !groupPlayerIds.has(mapping.value))) {
      status.textContent = localized(
        "Choose the group, race number, Track, and every Player from that group.",
        "Kies de groep, het racenummer, het circuit en elke speler uit die groep.",
      );
      return;
    }
    accept.disabled = true;
    void client.accept(pending, {
      tournamentRevision: tournament.summary.revision,
      groupId: group.value,
      raceNumber: selectedRace,
      correctedResult: correctedResult(pending, track, mappings),
      ...(pending.occurredAtMs === null ? {} : { occurredAtMs: pending.occurredAtMs }),
      reason: reason.value,
    }, options.signal).then(() => {
      mappings.forEach((mapping, index) => options.confirmedMappings?.set(
        normalizedName(observedNames[index]!), mapping.value,
      ));
      return options.onChanged();
    }).catch((error: unknown) => {
      status.textContent = error instanceof Error ? error.message : "The result could not be accepted.";
      accept.disabled = false;
    });
  });
  reject.addEventListener("click", () => {
    const rejectionReason = prompt(localized(
      "Why is this incoming result rejected?",
      "Waarom wordt deze binnenkomende uitslag afgewezen?",
    ));
    if (rejectionReason === null || rejectionReason.trim().length < 1) return;
    reject.disabled = true;
    void client.reject(pending, rejectionReason, options.signal).then(options.onChanged).catch((error: unknown) => {
      status.textContent = error instanceof Error ? error.message : "The result could not be rejected.";
      reject.disabled = false;
    });
  });

  if (!batchManaged) actions.append(accept);
  actions.append(reject);
  card.prepend(title, meta, label(document, localized("Group / phase", "Groep / fase"), group), label(document, localized("Race number", "Racenummer"), raceNumber), label(document, localized("Track", "Circuit"), track));
  card.append(label(document, localized("Review note", "Controlenotitie"), reason), actions, status);
  return {
    element: card,
    group,
    draft() {
      const selectedRace = Number(raceNumber.value);
      const groupPlayerIds = new Set(tournament.groups.find((candidate) => candidate.groupId === group.value)
        ?.members.map((member) => member.playerId) ?? []);
      if (group.value === "" || !Number.isSafeInteger(selectedRace) || track.value.trim() === "" ||
          mappings.some((mapping) => mapping.value === "" || !groupPlayerIds.has(mapping.value))) {
        throw new Error("Choose the group, race number, Track, and every Player from that group before confirming this feed.");
      }
      return {
        incomingResultId: pending.incomingResultId,
        expectedRevision: pending.revision,
        raceNumber: selectedRace,
        correctedResult: correctedResult(pending, track, mappings),
        ...(pending.occurredAtMs === null ? {} : { occurredAtMs: pending.occurredAtMs }),
      };
    },
    rememberMappings() {
      mappings.forEach((mapping, index) => options.confirmedMappings?.set(
        normalizedName(observedNames[index]!), mapping.value,
      ));
    },
    setStatus(message) { status.textContent = message; },
  };
}

export async function mountTournamentIncomingSection(options: MountOptions): Promise<void> {
  const { document, container, tournament } = options;
  const section = document.createElement("section");
  section.className = "tournament-op__section tournament-score-incoming";
  const scoreStep = tournament.summary.workflowStep >= 7 ? 9 : 5;
  const atScoreStep = tournament.summary.workflowStep === 5 || tournament.summary.workflowStep === 9;
  const step = scoreStep;
  const groupNameEnglish = step === 9 ? "final group" : "qualifier group";
  const groupNameDutch = step === 9 ? "finalegroep" : "kwalificatiegroep";
  const heading = document.createElement("h3");
  heading.textContent = localized(
    `Step ${step} · Tournament Live / Processor incoming results`,
    `Stap ${step} · Binnenkomende uitslagen van Tournament Live / Processor`,
  );
  const intro = document.createElement("p");
  intro.textContent = localized(
    "The capture operator selects this Tournament and a different current group for each sticker-named feed before Start. Race 1 can confirm the public View automatically; scores still wait for your Player and full group review after Stop.",
    "De capture-operator selecteert dit toernooi en vóór START voor iedere feed met stickernaam een andere actuele groep. Race 1 kan de openbare View automatisch bevestigen; scores wachten na STOP nog op jouw Player-koppeling en volledige groepscontrole.",
  );
  container.append(section);
  try {
    const client = new TournamentIncomingClient();
    const evidenceRecords = await client.listEvidenceRecords(tournament.summary.tournamentId, options.signal);
    const evidenceHeading = document.createElement("h4");
    evidenceHeading.textContent = localized(
      `Available Tournament Live recordings (${evidenceRecords.length})`,
      `Beschikbare Tournament Live-opnamen (${evidenceRecords.length})`,
    );
    section.append(evidenceHeading, intro);
    if (evidenceRecords.length === 0) {
      const evidenceEmpty = document.createElement("p");
      evidenceEmpty.className = "tournament-score-incoming__empty";
      evidenceEmpty.textContent = localized(
        "No completed recording is available yet.",
        "Er is nog geen voltooide opname beschikbaar.",
      );
      section.append(evidenceEmpty);
    } else {
      for (const evidenceRecord of evidenceRecords) section.append(evidenceRecordCard(options, client, evidenceRecord));
    }
    section.append(heading);
    const incoming = await client.list(tournament.summary.tournamentId, options.signal);
    const activeStage = phaseForStep(tournament.summary.workflowStep);
    const pending = incoming.filter((result) => result.status === "pending" &&
      (result.suggestedPhase === null || result.suggestedPhase === activeStage));
    if (!atScoreStep && pending.length > 0) {
      const deferred = document.createElement("p");
      deferred.className = "tournament-op__hint";
      deferred.textContent = localized(
        `These races remain available. Continue or return to Step ${scoreStep} to reconcile Players, Track and order and accept the scores.`,
        `Deze races blijven beschikbaar. Ga door of terug naar Stap ${scoreStep} om spelers, circuit en volgorde te controleren en de scores te accepteren.`,
      );
      section.append(deferred);
    }
    if (pending.length === 0) {
      const empty = document.createElement("p");
      empty.className = "tournament-score-incoming__empty";
      empty.textContent = localized(
        `Nothing is waiting yet. In Tournament Live connect to this Tournament and select the correct ${groupNameEnglish} for every feed. Connected results appear here automatically and do not count until accepted.`,
        `Er staat nog niets klaar. Verbind Tournament Live met dit toernooi en selecteer voor iedere feed de juiste ${groupNameDutch}. Verbonden uitslagen verschijnen hier automatisch en tellen pas mee na acceptatie.`,
      );
      section.append(empty);
    } else if (atScoreStep) {
      const count = document.createElement("strong");
      count.textContent = localized(`${pending.length} waiting`, `${pending.length} in afwachting`);
      section.append(count);
      const summaries = provisionalIncomingGroupSummaries(pending);
      for (const summary of summaries) {
        const group = tournament.groups.find((candidate) => candidate.groupId === summary.groupId);
        const provisional = document.createElement("p");
        provisional.className = summary.blocked ? "tournament-op__warning" : "tournament-op__hint";
        provisional.textContent = localized(
          `${group?.name ?? summary.groupId} · provisional feed: ${summary.races} race(s), ${summary.connectionErrors} connection error(s)`,
          `${group?.name ?? summary.groupId} · voorlopige feed: ${summary.races} race(s), ${summary.connectionErrors} verbindingsfout(en)`,
        ) +
          `${summary.totals.length === 0 ? "" : ` · ${summary.totals.map((row) => `${row.observedPlayer} ${row.points}`).join(" · ")}`}` +
          `${summary.blocked ? " · BLOCKED: more than 3 resets; review the desktop session instead of truncating it." : ""}`;
        section.append(provisional);
      }
      const blockedGroups = new Set(summaries.filter((summary) => summary.blocked).map((summary) => summary.groupId));
      const grouped = new Map<string | null, IncomingTournamentResult[]>();
      for (const result of pending) {
        const validSuggestion = tournament.groups.some((group) =>
          group.groupId === result.suggestedGroupId && group.stage === activeStage)
          ? result.suggestedGroupId : null;
        grouped.set(validSuggestion, [...(grouped.get(validSuggestion) ?? []), result]);
      }
      for (const [suggestedGroupId, results] of grouped) {
        const handles = results.map((result) => pendingCard(options, client, result,
          suggestedGroupId !== null && blockedGroups.has(suggestedGroupId)));
        if (suggestedGroupId !== null && !blockedGroups.has(suggestedGroupId) && handles.length > 0) {
          const existingGroup = tournament.groups.find((group) => group.groupId === suggestedGroupId);
          const existingMaximumRace = existingGroup?.races.reduce(
            (maximum, race) => Math.max(maximum, race.raceNumber), 0,
          ) ?? 0;
          const incomingRaceNumbers = results.map((result) => result.suggestedRaceNumber)
            .filter((raceNumber): raceNumber is number => raceNumber !== null)
            .sort((left, right) => left - right);
          const overlapsExisting = results.some((result) =>
            result.suggestedRaceNumber !== null && existingGroup?.races.some(
              (race) => race.raceNumber === result.suggestedRaceNumber,
            ));
          const completeReplacement = overlapsExisting && existingMaximumRace > 0 &&
            incomingRaceNumbers.length === results.length &&
            incomingRaceNumbers.length >= existingMaximumRace &&
            incomingRaceNumbers.every((raceNumber, index) => raceNumber === index + 1);
          const confirmGroup = document.createElement("button");
          confirmGroup.type = "button";
          confirmGroup.className = "tt-auth__button tt-auth__button--primary";
          const groupName = existingGroup === undefined ? localized("group", "groep") : displayTournamentGroupLabel(existingGroup.name, existingGroup.tierKey);
          confirmGroup.textContent = completeReplacement
            ? localized(`Replace complete ${groupName} feed (${handles.length})`, `Volledige feed van ${groupName} vervangen (${handles.length})`)
            : localized(`Confirm ${groupName} feed (${handles.length})`, `Feed van ${groupName} bevestigen (${handles.length})`);
          if (overlapsExisting && !completeReplacement) {
            confirmGroup.disabled = true;
            const warning = document.createElement("p");
            warning.className = "tournament-op__warning";
            warning.textContent = localized(
              "This feed overlaps accepted races but is not a complete replacement from race 1. Reject it or upload the complete group feed.",
              "Deze feed overlapt geaccepteerde races, maar is geen volledige vervanging vanaf race 1. Wijs hem af of upload de volledige groepsfeed.",
            );
            section.append(warning);
          }
          confirmGroup.addEventListener("click", () => {
            try {
              if (completeReplacement && !globalThis.confirm(localized(
                `Replace every accepted race in ${groupName} with this reviewed ${handles.length}-race feed? Existing races remain in the audit history but no longer count toward standings.`,
                `Alle geaccepteerde races in ${groupName} vervangen door deze gecontroleerde feed met ${handles.length} races? Bestaande races blijven in de auditgeschiedenis, maar tellen niet meer mee voor de stand.`,
              ))) return;
              const entries = handles.map((handle) => {
                if (handle.group.value !== suggestedGroupId) throw new Error("Every result in the batch must stay in the same group.");
                return handle.draft();
              });
              confirmGroup.disabled = true;
              void client.acceptGroup({
                tournamentRevision: tournament.summary.revision,
                groupId: suggestedGroupId,
                entries,
                ...(completeReplacement ? { replaceExisting: true } : {}),
                reason: completeReplacement
                  ? "Complete group feed replacement confirmed by Tournament operator"
                  : "Complete group feed confirmed by Tournament operator",
              }, options.signal).then(() => {
                handles.forEach((handle) => handle.rememberMappings());
                return options.onChanged();
              }).catch((error: unknown) => {
                handles[0]!.setStatus(error instanceof Error ? error.message : "The group feed could not be confirmed.");
                confirmGroup.disabled = false;
              });
            } catch (error) {
              handles[0]!.setStatus(error instanceof Error ? error.message : "Complete every mapping first.");
            }
          });
          section.append(confirmGroup);
        }
        for (const handle of handles) section.append(handle.element);
      }
    }
    let signature = [
      ...pending.map((result) => `result:${result.incomingResultId}:${result.revision}:${result.status}`),
      ...evidenceRecords.map((record) => `record:${record.recordId}:${record.revision}:${record.status}`),
    ].join("|");
    // The feed is polled because race-day results arrive from another client.
    // Two fixed 5 s calls for as long as the page is open cost 1440 requests an
    // hour per operator, most of them answering "nothing changed", and they
    // kept running while the operator was in Excel. So: nothing while the tab
    // is hidden, an immediate catch-up when it comes back, and a back-off from
    // 5 s to 20 s over quiet polls that any change resets. Race-day
    // responsiveness is unchanged - the first arrival snaps the interval back.
    const fastPeriodMs = 5_000;
    const slowPeriodMs = 20_000;
    const quietPollsBeforeBackOff = 6;
    let quietPolls = 0;
    let timer: ReturnType<typeof globalThis.setTimeout> | undefined;
    let stopped = false;
    const periodMs = (): number =>
      quietPolls >= quietPollsBeforeBackOff ? slowPeriodMs : fastPeriodMs;
    const schedule = (delayMs = periodMs()): void => {
      if (stopped) { return; }
      timer = globalThis.setTimeout(() => { void tick(); }, delayMs);
    };
    const tick = async (): Promise<void> => {
      if (stopped) { return; }
      if (globalThis.document?.visibilityState === "hidden") { schedule(); return; }
      try {
        const [latest, latestRecords] = await Promise.all([
          client.list(tournament.summary.tournamentId, options.signal),
          client.listEvidenceRecords(tournament.summary.tournamentId, options.signal),
        ]);
        const next = [
          ...latest.filter((result) => result.status === "pending" &&
            (result.suggestedPhase === null || result.suggestedPhase === activeStage))
            .map((result) => `result:${result.incomingResultId}:${result.revision}:${result.status}`),
          ...latestRecords.map((record) => `record:${record.recordId}:${record.revision}:${record.status}`),
        ].join("|");
        if (next !== signature) {
          signature = next;
          quietPolls = 0;
          await options.onChanged();
          return;
        }
        quietPolls += 1;
      } catch { /* a failed poll is not an operator-facing error */ }
      schedule();
    };
    const wake = (): void => {
      if (stopped || globalThis.document?.visibilityState === "hidden") { return; }
      // Coming back to the tab is exactly when the operator wants the truth.
      quietPolls = 0;
      if (timer !== undefined) { globalThis.clearTimeout(timer); }
      schedule(0);
    };
    globalThis.document?.addEventListener("visibilitychange", wake);
    schedule();
    options.signal?.addEventListener("abort", () => {
      stopped = true;
      if (timer !== undefined) { globalThis.clearTimeout(timer); }
      globalThis.document?.removeEventListener("visibilitychange", wake);
    }, { once: true });
  } catch (error) {
    if (options.signal?.aborted === true) return;
    const message = document.createElement("p");
    message.textContent = error instanceof Error
      ? error.message
      : localized("Incoming results could not be loaded.", "Binnenkomende uitslagen konden niet worden geladen.");
    section.append(message);
  }
}
