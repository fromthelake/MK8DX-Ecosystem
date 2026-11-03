// Tournament operation board (ADR-0160): the administrator runs a whole
// tournament night here - create, participants and attendance, Switches,
// qualifier groups with seating, race entry or import, live standings,
// finals, and an auditable finalization with two independent settings
// (Public Results / Affects TrueSkill). Every action re-authorizes on the
// server; this board only arranges the calls and shows the document.
import { mountTournamentSignupBoard, type MountedTournamentSignupBoard } from "./tournament-signup-board-section.js";
import {
  loadTournamentExportIcons,
  renderTournamentExportImage,
  tournamentExportFileName,
  tournamentExportShareCaption,
  tournamentExportImageBlob,
  tournamentExportImageModel,
  tournamentExportSourceFromDocument,
} from "./tournament-export-image.js";

import { trackAsset } from "./asset-manifest.js";
import { createPlayerClaimClient, type ClaimablePlayerSummary, type PlayerClaimClient } from "./player-claim-client.js";
import { mountTournamentCanonicalImportSection } from "./tournament-canonical-import-section.js";
import {
  createTournamentOperationClient,
  PLAYER_CREATION_CLOSED,
  seedingSourceOf,
  TournamentOperationClientError,
  TournamentRosterRejectionError,
  type TournamentSeedingSource,
  type RosterNameCandidates,
  type TournamentAttendance,
  type TournamentDocument,
  type TournamentGroup,
  type TournamentGroupStage,
  type ScoreWorkbookPreview,
  type TournamentOperationClient,
  type TournamentSummary,
  type PublicTournamentEvent,
} from "./tournament-operation-client.js";
import {
  scoreConfidencePercent,
  scoreMatchLabel,
  suggestScoreMapping,
} from "./tournament-score-matching.js";
import { TOURNAMENT_TIERS, tournamentTierLabel as tierNameLabel } from "./tournament-tiers.js";
import { tournamentGroupLabel } from "./tournaments-view-labels.js";
import { findSchema9WebTrack, schema9WebTrackCatalog } from "./schema9-track-catalog.js";
import { buildTournamentInsights } from "./tournament-insights.js";
import { localized, productLocaleTag } from "./product-language.js";
import { createTournamentReportClient, TournamentReportClientError, type TournamentReportDocument } from "./tournament-report-client.js";
import { renderReportGrants } from "./tournament-report-grants.js";
import { buildClassicWordpressReport, type ClassicGroups } from "./tournament-report-classic.js";
import { buildWordpressReport, type WordpressReportExport } from "./tournament-report-wordpress.js";
import { tournamentStoryFromReport } from "./tournament-stories.js";
import { TOURNAMENT_STEP_LABELS } from "./tournament-step-progress.js";
import { tournamentCharacterIcon, tournamentCharacterKey } from "./tournament-character.js";
import {
  rosterAliasesToRemember,
  rosterCandidateOptionText,
  rosterChoiceList,
  rosterCreationClosedText,
  rosterImportSuggestion,
  type RosterRowChoice,
} from "./tournament-roster-picker.js";
import {
  createInstallationSettingsClient,
  loadInstallationSettings,
  type InstallationSettingsClient,
} from "./installation-settings-client.js";
import { tournamentEquipmentCorrectionLayout, tournamentLayoutDetachment, tournamentLayoutInspectionStage, tournamentLenderWarning, tournamentLendsWithoutPlaying, type EquipmentSlotChoice } from "./tournament-equipment-review.js";
import {
  ATTENDANCE_ABSENT_WORDS,
  ATTENDANCE_PRESENT_WORDS,
  ATTENDANCE_WAITING_WORDS,
  BOOLEAN_FALSE_WORDS,
  BOOLEAN_TRUE_WORDS,
  CONSOLE_WORDS,
  csvAttendanceOrNull,
  csvBooleanOrNull,
  csvDocument,
  csvMissingColumns,
  csvRecords,
  csvSwitchTypeOrNull,
  csvValue,
  LAYOUT_COLUMNS,
  ROSTER_COLUMNS,
  type CsvIssue,
} from "./tournament-csv.js";
import {
  TOURNAMENT_BOARD_GROUP_SLOTS,
  tournamentBoardModel,
  tournamentGroupGradient,
  tournamentMoveStationMutation,
  tournamentParkPlayerMutation,
  tournamentParkStationMutation,
  tournamentSeatPlayerInGroupMutation,
  tournamentSeatPlayerMutation,
  tournamentSeatTone,
  tournamentStationKey,
  tournamentTierForPlayer,
  tournamentUtpByStation,
  type TournamentBoardMutation,
} from "./tournament-group-board.js";

export type MountedTournamentOperation = Readonly<{
  container: HTMLElement;
  ready: Promise<void>;
  unmount(): void;
}>;

export type TournamentOperationOptions = Readonly<{
  client?: TournamentOperationClient;
  players?: PlayerClaimClient;
  tournamentId?: string | null;
  directorUserAccountId?: string | null;
  /** Only administrators may make the explicit cross-final-group swap. */
  administrator?: boolean;
  onNavigate?: (href: string) => void;
  confirm?: (message: string) => boolean;
  /** ADR-0221: who may create Players; the default reads /v1/installation-settings. */
  installationSettings?: Pick<InstallationSettingsClient, "current">;
  /** ADR-0222: the Step 2 sign-up panel; replaced in tests. */
  mountSignupBoard?: (root: HTMLElement, tournamentId: string, onRosterChanged: () => void) => MountedTournamentSignupBoard;
}>;

function clear(element: HTMLElement): void {
  while (element.firstChild !== null) { element.removeChild(element.firstChild); }
}

function groupLabel(group: Pick<TournamentGroup, "name" | "tierKey">): string {
  return tournamentGroupLabel(group.name, group.tierKey);
}

function displayGroupLabel(group: Pick<TournamentGroup, "name" | "tierKey">): string {
  const label = groupLabel(group);
  const generatedGroup = /^Groep (\d+)$/i.exec(label.trim());
  return generatedGroup === null ? label : localized(`Group ${generatedGroup[1]}`, `Groep ${generatedGroup[1]}`);
}

function tournamentTierLabel(tier: Readonly<{ key: string; name: string }>): string {
  if (tier.key === "new") { return localized("New", "Nieuw"); }
  if (tier.key === "unknown") { return localized("Unknown", "Onbekend"); }
  return tierNameLabel(tier.key) ?? tier.name;
}

function localizedFinalizationWarning(warning: string): string {
  const incomplete = /^(\d+) group\(s\) have no complete results yet\.$/.exec(warning);
  if (incomplete !== null) {
    return localized(warning, `${incomplete[1]} groep(en) hebben nog geen complete uitslag.`);
  }
  const manual = /^(\d+) group\(s\) hold manual totals only; those groups cannot affect TrueSkill\.$/.exec(warning);
  if (manual !== null) {
    return localized(warning, `${manual[1]} groep(en) bevatten alleen handmatige totalen; deze groepen kunnen TrueSkill niet beïnvloeden.`);
  }
  if (warning === "There are no canonical races, so finalizing cannot move any rating.") {
    return localized(warning, "Er zijn geen canonieke races, dus afronden kan geen rating wijzigen.");
  }
  if (warning === "No final groups were generated; the overall result follows the qualifier groups.") {
    return localized(warning, "Er zijn geen eindgroepen gemaakt; het eindklassement volgt de kwalificatiegroepen.");
  }
  if (warning === "No edition number is set; the rating graph and the statistics leave out a public night without one.") {
    return localized(warning, "Er is geen editienummer ingesteld; de rating-grafiek en de statistieken laten een openbare avond zonder nummer weg.");
  }
  return warning;
}

export type TournamentGroupMembershipUpdate = Readonly<{
  groupId: string;
  members: readonly string[];
}>;

// One canonical membership transformation powers the select fallback and
// drag-and-drop board. A missing target is the recovered "parking" state:
// the Player stays present in the event, but is deliberately not seated in
// any group of this stage.
export function moveTournamentPlayer(
  groups: readonly TournamentGroup[],
  stage: TournamentGroupStage,
  playerId: string,
  targetGroupId?: string,
): readonly TournamentGroupMembershipUpdate[] {
  const stageGroups = groups.filter((group) => group.stage === stage);
  if (stageGroups.length === 0) { throw new RangeError("this stage has no groups"); }
  const target = targetGroupId === undefined
    ? undefined
    : stageGroups.find((group) => group.groupId === targetGroupId);
  if (targetGroupId !== undefined && target === undefined) { throw new RangeError("the target group does not exist"); }
  const alreadyInTarget = target?.members.some((member) => member.playerId === playerId) ?? false;
  if (!alreadyInTarget && target !== undefined && target.members.length >= 12) {
    throw new RangeError("the target group already has twelve Players");
  }
  return stageGroups.map((group) => ({
    groupId: group.groupId,
    members: group.groupId === targetGroupId && alreadyInTarget
      ? group.members.map((member) => member.playerId)
      : [
        ...group.members.map((member) => member.playerId).filter((candidate) => candidate !== playerId),
        ...(group.groupId === targetGroupId ? [playerId] : []),
      ],
  }));
}

// -- Step 2 roster helpers, ported verbatim from the APK ---------------------

export const TOURNAMENT_SYSTEM_MAX_ACTIVE = 60;

export type TournamentRosterGateMetrics = Readonly<{
  activeCount: number;
  waitingCount: number;
  absentCount: number;
  ns1Count: number;
  ns2Count: number;
  totalConsoles: number;
  minConsoles: number;
  maxParticipants: number | null;
  isReady: boolean;
  seedButtonMode: "disabled" | "ready" | "active";
  readinessReason: string;
}>;

/** Port of the APK's androidRosterGateMetrics: same numbers, same Dutch
 * three-line readiness explanation, same green/red gate. */
export function tournamentRosterGateMetrics(document_: TournamentDocument): TournamentRosterGateMetrics {
  const participants = document_.participants;
  const activeCount = participants.filter((entry) => entry.attendance === "present").length;
  const waitingCount = participants.filter((entry) => entry.attendance === "waiting").length;
  const absentCount = participants.filter((entry) => entry.attendance === "absent").length;
  const ns1Count = participants.filter((entry) => entry.hasSwitch1).length;
  const ns2Count = participants.filter((entry) => entry.hasSwitch2).length;
  const totalConsoles = ns1Count + ns2Count;
  const minConsoles = Math.floor((activeCount + 1) / 2);
  const maxParticipants = document_.summary.maxParticipants !== undefined && document_.summary.maxParticipants > 0
    ? document_.summary.maxParticipants
    : null;
  const maxParticipantsExceeded = maxParticipants !== null && activeCount > maxParticipants;
  const enoughPlayers = activeCount > 0;
  const withinSystemCap = activeCount <= TOURNAMENT_SYSTEM_MAX_ACTIVE;
  const enoughConsoles = totalConsoles >= minConsoles;
  const isReady = enoughPlayers && withinSystemCap && enoughConsoles && !maxParticipantsExceeded;
  let reason = "";
  if (!isReady) {
    if (!enoughPlayers) {
      reason = localized(
        "Not ready: mark at least 1 participant as Present.",
        "Nog niet klaar: markeer minimaal 1 deelnemer als Aanwezig.",
      );
    } else if (!withinSystemCap) {
      const reduceBy = Math.max(0, activeCount - TOURNAMENT_SYSTEM_MAX_ACTIVE);
      reason = localized(
        `Current status: ${activeCount} Present participants.\n` +
          `Required: at most ${TOURNAMENT_SYSTEM_MAX_ACTIVE} Present participants.\n` +
          `Solution: move ${reduceBy} participants from Present to Waiting list or Absent.`,
        `Huidige status: ${activeCount} Aanwezige Deelnemers.\n` +
          `Benodigd: maximaal ${TOURNAMENT_SYSTEM_MAX_ACTIVE} Aanwezige Deelnemers.\n` +
          `Oplossing: verplaats ${reduceBy} deelnemers van Aanwezig naar Wachtlijst of Afwezig.`,
      );
    } else if (maxParticipantsExceeded) {
      const limit = maxParticipants!;
      const reduceBy = Math.max(0, activeCount - limit);
      reason = localized(
        `Current status: ${activeCount} Present participants, limit ${limit}.\n` +
          `Required: Present must be <= ${limit}.\n` +
          `Solution 1: move ${reduceBy} participants from Present to Waiting list or Absent.\n` +
          "Solution 2: raise (or clear) Maximum places if the venue permits it.",
        `Huidige status: ${activeCount} Aanwezige Deelnemers, limiet ${limit}.\n` +
          `Benodigd: Aanwezig moet <= ${limit} zijn.\n` +
          `Oplossing 1: Verplaats ${reduceBy} deelnemers van Aanwezig naar Wachtlijst of Afwezig.\n` +
          "Oplossing 2: Verhoog (of leeg) Max aantal plaatsen als de locatie dit toelaat.",
      );
    } else {
      const missing = Math.max(0, minConsoles - totalConsoles);
      const capacity = totalConsoles * 2;
      const reduceBy = Math.max(0, activeCount - capacity);
      reason = localized(
        `Current status: ${activeCount} Present participants, ${totalConsoles} Nintendo Switches.\n` +
          `Required: ${minConsoles} Nintendo Switches (${activeCount}/2, rounded up).\n` +
          `Solution 1: add ${missing} Nintendo Switches (${totalConsoles} -> ${minConsoles}).\n` +
          `Solution 2: reduce Present by ${reduceBy} participants (${activeCount} -> ${capacity}, ` +
          `because ${totalConsoles}x2 = ${capacity} max).`,
        `Huidige status: ${activeCount} Aanwezige Deelnemers, ${totalConsoles} Nintendo Switches.\n` +
          `Benodigd: ${minConsoles} Nintendo Switches (${activeCount}/2, afgerond naar boven).\n` +
          `Oplossing 1: Voeg ${missing} Nintendo Switches toe (${totalConsoles} -> ${minConsoles}).\n` +
          `Oplossing 2: Verlaag Aanwezig met ${reduceBy} Deelnemers (${activeCount} -> ${capacity}, ` +
          `want ${totalConsoles}x2 = ${capacity} max).`,
      );
    }
  }
  return {
    activeCount, waitingCount, absentCount, ns1Count, ns2Count, totalConsoles,
    minConsoles, maxParticipants, isReady,
    seedButtonMode: !enoughPlayers ? "disabled" : isReady ? "active" : "ready",
    readinessReason: reason,
  };
}

export const TOURNAMENT_GROUP_SEATS = 12;
export const TOURNAMENT_GROUP_SWITCHES = 6;

export type TournamentGroupBoardStats = Readonly<{
  switchesAssigned: number;
  seatedCount: number;
  seatCapacity: number;
  memberCount: number;
  unseatedCount: number;
  averageSkill: number;
  spreadPlus: number;
  spreadMinus: number;
}>;

/** Port of the APK's androidGroupBoardStats: two seats per assigned Switch,
 * never more than a full group of twelve, and the SP average with spread. */
export function tournamentGroupBoardStats(
  group: TournamentGroup,
  participants: TournamentDocument["participants"],
): TournamentGroupBoardStats {
  const switches = new Set(group.members.flatMap((member) => member.station === undefined
    ? [] : [`${member.station.ownerPlayerId}|${member.station.switchType}`])).size;
  const seated = group.members.filter((member) => member.station !== undefined).length;
  const byId = new Map(participants.map((participant) => [participant.playerId, participant]));
  const scores = group.members
    .map((member) => byId.get(member.playerId)?.seedScore)
    .filter((score): score is number => score !== undefined);
  const average = scores.length === 0 ? 0 : scores.reduce((sum, value) => sum + value, 0) / scores.length;
  return {
    switchesAssigned: switches,
    seatedCount: seated,
    seatCapacity: Math.min(TOURNAMENT_GROUP_SEATS, switches * 2),
    memberCount: group.members.length,
    unseatedCount: group.members.length - seated,
    averageSkill: average,
    spreadPlus: scores.length === 0 ? 0 : Math.max(...scores) - average,
    spreadMinus: scores.length === 0 ? 0 : average - Math.min(...scores),
  };
}

/** Port of the APK's androidGroupBoardCsv: the source layout file that the
 * import route reads back (Switcheigenaar;Console;Deelnemer 1;Deelnemer 2;
 * Groep), one row per Switch plus a row per unseated member. */
export function tournamentGroupLayoutCsv(groups: readonly TournamentGroup[]): string {
  const rows: string[][] = [["Switcheigenaar", "Console", "Deelnemer 1", "Deelnemer 2", "Groep"]];
  for (const group of groups) {
    const stations = [...new Set(group.members.flatMap((member) => member.station === undefined
      ? [] : [`${member.station.ownerPlayerId}|${member.station.switchType}`]))];
    for (const key of stations) {
      const [ownerId, switchType] = key.split("|") as [string, "ns1" | "ns2"];
      const seats = group.members
        .filter((member) => member.station?.ownerPlayerId === ownerId && member.station?.switchType === switchType)
        .sort((left, right) => (left.station?.seatNumber ?? 0) - (right.station?.seatNumber ?? 0));
      const owner = seats[0]?.station?.ownerDisplayName ?? ownerId;
      rows.push([
        owner, switchType.toUpperCase(),
        seats[0]?.displayName ?? "", seats[1]?.displayName ?? "",
        group.name,
      ]);
    }
    for (const member of group.members.filter((candidate) => candidate.station === undefined)) {
      rows.push(["", "", member.displayName, "", group.name]);
    }
  }
  return csvDocument(rows);
}

export type TournamentLayoutImportPlan = Readonly<{
  rows: number;
  groups: readonly Readonly<{
    name: string;
    seats: readonly Readonly<{
      playerId: string; stationOwnerPlayerId: string | null;
      switchType: "ns1" | "ns2" | null; seatNumber: 1 | 2 | null;
    }>[];
  }>[];
}> | Readonly<{
  rejected: Readonly<{
    unknownGroups: readonly string[]; unknownPlayers: readonly string[];
    invalidConsoles: readonly string[]; duplicatePlayers: readonly string[];
  }>;
}>;

/** The layout file read back the way the APK reads it: a console row seats
 * Deelnemer 1 and, when filled in, Deelnemer 2; a row without a console
 * (`;;Naam;;Groep`, as the export writes an unseated member) parks its
 * Players in the group without a seat; empty cells are not names. */
export function tournamentLayoutImportPlan(
  records: readonly Readonly<Record<string, string>>[],
  participants: ReadonlyMap<string, string>,
  groups: readonly Readonly<{ name: string }>[],
): TournamentLayoutImportPlan {
  const byName = new Map(groups.map((group) => [historicalName(group.name), group]));
  const nameOf = (record: Readonly<Record<string, string>>, column: string): string => (record[column] ?? "").trim();
  const seatedRows = records.filter((record) => nameOf(record, "Switcheigenaar") !== "" || nameOf(record, "Console") !== "");
  const unknownGroups = [...new Set(records.map((record) => nameOf(record, "Groep"))
    .filter((name) => !byName.has(historicalName(name))))];
  const names = records.flatMap((record) => [nameOf(record, "Deelnemer 1"), nameOf(record, "Deelnemer 2")])
    .filter((name) => name !== "");
  const unknownPlayers = [...new Set(names.filter((name) => !participants.has(historicalName(name))))];
  const unknownOwners = [...new Set(seatedRows.map((record) => nameOf(record, "Switcheigenaar"))
    .filter((name) => !participants.has(historicalName(name))))];
  const invalidConsoles = [...new Set(seatedRows.map((record) => nameOf(record, "Console"))
    .filter((name) => !["ns1", "ns2"].includes(name.toLocaleLowerCase("nl"))))];
  const duplicatePlayers = [...new Set(names.filter((name, index) =>
    names.findIndex((candidate) => historicalName(candidate) === historicalName(name)) !== index))];
  if (unknownGroups.length > 0 || unknownPlayers.length > 0 || unknownOwners.length > 0 ||
      invalidConsoles.length > 0 || duplicatePlayers.length > 0) {
    return { rejected: {
      unknownGroups, unknownPlayers: [...new Set([...unknownPlayers, ...unknownOwners])], invalidConsoles, duplicatePlayers,
    } };
  }
  return {
    rows: records.length,
    groups: groups.map((group) => ({
      name: group.name,
      seats: records.filter((record) => historicalName(nameOf(record, "Groep")) === historicalName(group.name))
        .flatMap((record) => {
          const seated = nameOf(record, "Switcheigenaar") !== "" || nameOf(record, "Console") !== "";
          const stationOwnerPlayerId = seated ? participants.get(historicalName(nameOf(record, "Switcheigenaar")))! : null;
          const switchType = !seated ? null : nameOf(record, "Console").toLocaleLowerCase("nl") === "ns2" ? "ns2" as const : "ns1" as const;
          return ([["Deelnemer 1", 1], ["Deelnemer 2", 2]] as const)
            .filter(([column]) => nameOf(record, column) !== "")
            .map(([column, seatNumber]) => ({
              playerId: participants.get(historicalName(nameOf(record, column)))!,
              stationOwnerPlayerId, switchType, seatNumber: seated ? seatNumber : null,
            }));
        }),
    })),
  };
}

/** The canonical rollback confirmations from the APK's
 * rollbackConfirmationMessage - they name exactly what is destroyed. */
export function tournamentRollbackMessage(targetStep: number): string {
  switch (targetStep) {
    case 2: return localized(
      "Return to Step 2? Qualifier groups and all later data will be removed. The participant list, attendance and Switch owners remain.",
      "Terug naar Stap 2? Kwalificatiegroepen en alle vervolgdata worden verwijderd. De deelnemerslijst, aanwezigheid en Switch-eigenaren blijven staan.",
    );
    case 3: return localized("Return to Step 3? The qualifier layout will reopen.", "Terug naar Stap 3? De kwalificatie-indeling wordt heropend.");
    case 4: return localized("Return to Step 4? You can review the qualifier export again.", "Terug naar Stap 4? Je kunt de kwalificatie-export opnieuw controleren.");
    case 5: return localized("Return to Step 5? You can adjust the qualifier scores again.", "Terug naar Stap 5? Je kunt de kwalificatiescores opnieuw aanpassen.");
    case 6: return localized(
      "Return to Step 6? Final groups and final-group placement will be removed so you can adjust qualifier scores and the qualifier result export.",
      "Terug naar Stap 6? Eindgroepen en eindgroepplaatsing worden verwijderd zodat je kwalificatiescores en kwalificatie-uitslag export kunt aanpassen.",
    );
    case 7: return localized("Return to Step 7? The final-group layout will reopen.", "Terug naar Stap 7? De eindgroep-indeling wordt heropend.");
    case 8: return localized("Return to Step 8? Review the final-group layout export checkpoint first.", "Terug naar Stap 8? Controleer eerst de export-checkpoint van de eindgroep-indeling.");
    case 9: return localized("Return to Step 9? You can adjust the final scores again.", "Terug naar Stap 9? Je kunt de eindgroepscores opnieuw aanpassen.");
    default: return localized(
      `Are you sure you want to return to Step ${targetStep}? Later step data will be rolled back.`,
      `Weet je zeker dat je terug wilt naar Stap ${targetStep}? Latere stapdata wordt teruggedraaid.`,
    );
  }
}

/** The confirmation for a real return to a result-bearing layout step. It
 * names exactly what is detached and what stays, because the Director asked
 * for it under the assumption that the coupling breaks and can be redone. */
export function tournamentDetachMessage(targetStep: number, detachment: Readonly<{ groups: number; races: number; manualScores: number }>): string {
  return localized(
    `Return to Step ${targetStep} and detach ${detachment.races} accepted race(s) and ${detachment.manualScores} manual score entr${detachment.manualScores === 1 ? "y" : "ies"} from ${detachment.groups} group(s)? The groups, seats and Switch owners stay as they are; the detached scores must be entered or imported again before you can continue.`,
    `Terug naar Stap ${targetStep} en ${detachment.races} geaccepteerde race(s) en ${detachment.manualScores} handmatige score(s) van ${detachment.groups} groep(en) loskoppelen? De groepen, zitplaatsen en Switch-eigenaren blijven staan; de losgekoppelde scores moeten opnieuw worden ingevoerd of geïmporteerd voordat je verder kunt.`,
  );
}

/** Port of the APK's androidRosterRows: hide inactive absentees on demand,
 * then order inactive last, unknown rank last, then by name. */
export function tournamentRosterRows(
  participants: TournamentDocument["participants"],
  hideInactiveAbsent: boolean,
): TournamentDocument["participants"] {
  return participants
    .filter((entry) => !(hideInactiveAbsent && (entry.inactive ?? false) && entry.attendance === "absent"))
    .slice()
    .sort((left, right) =>
      Number(left.inactive ?? false) - Number(right.inactive ?? false)
      || (left.seedRank ?? Number.MAX_SAFE_INTEGER) - (right.seedRank ?? Number.MAX_SAFE_INTEGER)
      || left.displayName.toLocaleLowerCase().localeCompare(right.displayName.toLocaleLowerCase()));
}

/** Port of the APK's formatSkillScore: the conservative SP with a Dutch
 * decimal comma, and a dash when no rating row exists (ADR-0177). */
export function tournamentSkillScoreLabel(value: number | undefined): string {
  return value === undefined ? "-" : value.toFixed(2).replace(".", ",");
}

/** Port of the APK's androidRosterUsernameFor: the ADR-0151 preview of the
 * username a reviewed display name derives. The server stays authoritative. */
export function tournamentRosterUsernameFor(displayName: string): string | null {
  const normalized = displayName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "_")
    .replace(/_+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .slice(0, 16);
  return /^[a-z0-9_-]{3,16}$/.test(normalized) ? normalized : null;
}

export type RosterFileRow = Readonly<{
  row: number;
  displayName: string;
  attendance: TournamentAttendance;
  hasSwitch1: boolean;
  hasSwitch2: boolean;
}>;

export type CsvFileReport<TRow> =
  | Readonly<{ ok: true; rows: readonly TRow[] }>
  | Readonly<{ ok: false; issues: readonly CsvIssue[] }>;

/** What a Step 2 file may contain, in the operator's own language. */
export function tournamentRosterFileRules(): readonly Readonly<{ column: string; allowed: readonly string[] }>[] {
  return [
    { column: `${ROSTER_COLUMNS.name[0]} / ${ROSTER_COLUMNS.name[1]}`, allowed: [localized("the Player's name as the site spells it", "de naam van de speler zoals de site die schrijft")] },
    { column: ROSTER_COLUMNS.status[0], allowed: [...ATTENDANCE_PRESENT_WORDS, ...ATTENDANCE_WAITING_WORDS, ...ATTENDANCE_ABSENT_WORDS] },
    { column: "NS1 / NS2", allowed: [...BOOLEAN_TRUE_WORDS, ...BOOLEAN_FALSE_WORDS] },
  ];
}

/**
 * A Step 2 roster file, in whichever shape it arrives: `;`, `,` or tab, Dutch
 * or English headers, `Aanwezig` or `Present`, `ja` or `yes`. A cell that says
 * something else is named with its row and its column rather than guessed at.
 */
export function tournamentRosterFile(text: string): CsvFileReport<RosterFileRow> {
  const records = csvRecords(text);
  if (records.length === 0) {
    return { ok: false, issues: [{
      row: 1, column: localized("file", "bestand"), value: "",
      problem: localized(
        "no rows were found. Expected a header line and one row per Player.",
        "er zijn geen regels gevonden. Verwacht een kopregel en daaronder één regel per speler.",
      ),
    }] };
  }
  const columns = [
    { label: ROSTER_COLUMNS.name[0], names: ROSTER_COLUMNS.name },
    { label: ROSTER_COLUMNS.status[0], names: ROSTER_COLUMNS.status },
    { label: ROSTER_COLUMNS.switch1[0], names: ROSTER_COLUMNS.switch1 },
    { label: ROSTER_COLUMNS.switch2[0], names: ROSTER_COLUMNS.switch2 },
  ];
  const missing = csvMissingColumns(records[0]!, columns);
  if (missing.length > 0) {
    return { ok: false, issues: missing.map((column) => ({
      row: 1, column: column.label, value: "",
      problem: localized("this column is missing.", "deze kolom ontbreekt."),
      allowed: column.names,
    })) };
  }
  const issues: CsvIssue[] = [];
  const rows: RosterFileRow[] = [];
  const seen = new Map<string, number>();
  for (const [index, record] of records.entries()) {
    // The row number an operator sees in their spreadsheet.
    const row = index + 2;
    const displayName = (csvValue(record, ROSTER_COLUMNS.name) ?? "").trim();
    if (displayName.length === 0) { continue; }
    const nameKey = historicalName(displayName);
    const first = seen.get(nameKey);
    if (first !== undefined) {
      issues.push({
        row, column: ROSTER_COLUMNS.name[0], value: displayName,
        problem: localized(`this name is already on row ${first}.`, `deze naam staat al op regel ${first}.`),
      });
    } else { seen.set(nameKey, row); }
    const statusValue = csvValue(record, ROSTER_COLUMNS.status) ?? "";
    const attendance = csvAttendanceOrNull(statusValue);
    if (attendance === null) {
      issues.push({
        row, column: ROSTER_COLUMNS.status[0], value: statusValue,
        problem: localized("this is not an attendance.", "dit is geen aanwezigheid."),
        allowed: [...ATTENDANCE_PRESENT_WORDS, ...ATTENDANCE_WAITING_WORDS, ...ATTENDANCE_ABSENT_WORDS],
      });
    }
    const switches: boolean[] = [];
    for (const column of [ROSTER_COLUMNS.switch1, ROSTER_COLUMNS.switch2]) {
      const raw = csvValue(record, column) ?? "";
      const value = csvBooleanOrNull(raw);
      if (value === null) {
        issues.push({
          row, column: column[0], value: raw,
          problem: localized("this is not a yes or a no.", "dit is geen ja of nee."),
          allowed: [...BOOLEAN_TRUE_WORDS, ...BOOLEAN_FALSE_WORDS],
        });
      }
      switches.push(value ?? false);
    }
    if (attendance !== null) {
      rows.push({ row, displayName, attendance, hasSwitch1: switches[0]!, hasSwitch2: switches[1]! });
    }
  }
  if (issues.length > 0) { return { ok: false, issues }; }
  if (rows.length === 0) {
    return { ok: false, issues: [{
      row: 1, column: ROSTER_COLUMNS.name[0], value: "",
      problem: localized("the file holds no Players.", "het bestand bevat geen spelers."),
    }] };
  }
  return { ok: true, rows };
}

export type LayoutFileRecord = Readonly<{
  "Switcheigenaar": string; "Console": string;
  "Deelnemer 1": string; "Deelnemer 2": string; "Groep": string;
}>;

/** What a Step 3/7 layout file may contain. */
export function tournamentLayoutFileRules(): readonly Readonly<{ column: string; allowed: readonly string[] }>[] {
  return [
    { column: `${LAYOUT_COLUMNS.owner[0]} / ${LAYOUT_COLUMNS.owner[1]}`, allowed: [localized("the name of the Player whose Switch it is; empty for a Player without a seat", "de naam van de speler van wie de Switch is; leeg voor een speler zonder stoel")] },
    { column: LAYOUT_COLUMNS.console[0], allowed: [...CONSOLE_WORDS, localized("(empty)", "(leeg)")] },
    { column: `${LAYOUT_COLUMNS.first[0]} / ${LAYOUT_COLUMNS.second[0]}`, allowed: [localized("a Player of this Tournament, or empty", "een speler van dit toernooi, of leeg")] },
    { column: `${LAYOUT_COLUMNS.group[0]} / ${LAYOUT_COLUMNS.group[1]}`, allowed: [localized("the name of a group in this stage", "de naam van een groep in deze fase")] },
  ];
}

/**
 * A Step 3/7 layout file, in whichever shape it arrives, with every cell that
 * does not belong named by its row and its column.
 */
export function tournamentLayoutFile(text: string): CsvFileReport<LayoutFileRecord> {
  const parsed = csvRecords(text);
  if (parsed.length === 0) {
    return { ok: false, issues: [{
      row: 1, column: localized("file", "bestand"), value: "",
      problem: localized(
        "no rows were found. Expected a header line and one row per console.",
        "er zijn geen regels gevonden. Verwacht een kopregel en daaronder één regel per console.",
      ),
    }] };
  }
  const columns = [
    { label: LAYOUT_COLUMNS.owner[0], names: LAYOUT_COLUMNS.owner },
    { label: LAYOUT_COLUMNS.console[0], names: LAYOUT_COLUMNS.console },
    { label: LAYOUT_COLUMNS.first[0], names: LAYOUT_COLUMNS.first },
    { label: LAYOUT_COLUMNS.second[0], names: LAYOUT_COLUMNS.second },
    { label: LAYOUT_COLUMNS.group[0], names: LAYOUT_COLUMNS.group },
  ];
  const missing = csvMissingColumns(parsed[0]!, columns);
  if (missing.length > 0) {
    return { ok: false, issues: missing.map((column) => ({
      row: 1, column: column.label, value: "",
      problem: localized("this column is missing.", "deze kolom ontbreekt."),
      allowed: column.names,
    })) };
  }
  const issues: CsvIssue[] = [];
  const rows: LayoutFileRecord[] = [];
  for (const [index, record] of parsed.entries()) {
    const row = index + 2;
    const owner = csvValue(record, LAYOUT_COLUMNS.owner) ?? "";
    const console_ = csvValue(record, LAYOUT_COLUMNS.console) ?? "";
    const group = csvValue(record, LAYOUT_COLUMNS.group) ?? "";
    const first = csvValue(record, LAYOUT_COLUMNS.first) ?? "";
    const second = csvValue(record, LAYOUT_COLUMNS.second) ?? "";
    if (group.trim().length === 0) {
      issues.push({
        row, column: LAYOUT_COLUMNS.group[0], value: "",
        problem: localized("every row needs a group.", "elke regel heeft een groep nodig."),
      });
      continue;
    }
    if (console_.trim().length > 0 && csvSwitchTypeOrNull(console_) === null) {
      issues.push({
        row, column: LAYOUT_COLUMNS.console[0], value: console_,
        problem: localized("this is not a console.", "dit is geen console."),
        allowed: [...CONSOLE_WORDS],
      });
    }
    if (owner.trim().length > 0 && console_.trim().length === 0) {
      issues.push({
        row, column: LAYOUT_COLUMNS.console[0], value: "",
        problem: localized("a row with a Switch owner needs its console.", "een regel met een Switcheigenaar heeft ook de console nodig."),
        allowed: [...CONSOLE_WORDS],
      });
    }
    if (owner.trim().length === 0 && console_.trim().length > 0) {
      issues.push({
        row, column: LAYOUT_COLUMNS.owner[0], value: "",
        problem: localized("a row with a console needs its Switch owner.", "een regel met een console heeft ook de Switcheigenaar nodig."),
      });
    }
    if (first.trim().length === 0 && second.trim().length > 0) {
      issues.push({
        row, column: LAYOUT_COLUMNS.first[0], value: "",
        problem: localized("seat 2 is filled while seat 1 is empty.", "stoel 2 is gevuld terwijl stoel 1 leeg is."),
      });
    }
    rows.push({
      "Switcheigenaar": owner, "Console": console_,
      "Deelnemer 1": first, "Deelnemer 2": second, "Groep": group,
    });
  }
  if (issues.length > 0) { return { ok: false, issues }; }
  if (rows.length === 0) {
    return { ok: false, issues: [{
      row: 1, column: LAYOUT_COLUMNS.group[0], value: "",
      problem: localized("the file holds no rows.", "het bestand bevat geen regels."),
    }] };
  }
  return { ok: true, rows };
}

/** Kept for the callers that only want the rows. */
export function tournamentRosterFileRows(text: string): readonly RosterFileRow[] | null {
  const report = tournamentRosterFile(text);
  return report.ok ? report.rows : null;
}

/** "Regel 7, kolom Status: …" - one line per thing that is wrong. */
export function tournamentCsvIssueLines(issues: readonly CsvIssue[]): readonly string[] {
  return issues.map((issue) => {
    const where = localized(`Row ${issue.row}, column ${issue.column}`, `Regel ${issue.row}, kolom ${issue.column}`);
    const what = issue.value.length > 0 ? `"${issue.value}": ` : "";
    const allowed = issue.allowed === undefined || issue.allowed.length === 0
      ? ""
      : localized(` Allowed: ${issue.allowed.join(", ")}.`, ` Toegestaan: ${issue.allowed.join(", ")}.`);
    return `${where}: ${what}${issue.problem}${allowed}`;
  });
}

/** Port of the APK's androidRosterRejectionMessage. */
export function tournamentRosterRejectionMessage(
  rejections: readonly Readonly<{ row: number; displayName: string; reason: string }>[],
): string {
  if (rejections.length === 0) { return "De import is afgewezen."; }
  const detail = rejections.map((rejection) => {
    const reason = rejection.reason === "invalid_display_name" ? "onbruikbare naam"
      : rejection.reason === "duplicate_display_name_in_file" ? "naam staat dubbel in het bestand"
        : rejection.reason === "display_name_taken" ? "naam bestaat al"
          : rejection.reason === "username_taken" ? "gebruikersnaam is bezet"
            : rejection.reason;
    return `regel ${rejection.row} "${rejection.displayName}": ${reason}`;
  }).join("; ");
  return `Er is niets geïmporteerd. ${detail}.`;
}

/** The source Manager's own Step 2 file: Naam;Status;NS1;NS2, CRLF, Dutch
 * statuses and ja/nee booleans, quoted only when a value needs it. */
/** The rows that are wrong, as the operator's own list, with what is allowed. */
export function csvIssueList(
  document: Document,
  issues: readonly CsvIssue[],
  lead: string,
): HTMLElement {
  const box = document.createElement("div");
  box.className = "tournament-op__csv-issues";
  const heading = document.createElement("p");
  heading.className = "tournament-op__csv-issues-lead";
  heading.textContent = issues.length === 1
    ? lead
    : localized(`${lead} ${issues.length} problems:`, `${lead} ${issues.length} problemen:`);
  const list = document.createElement("ul");
  // A long file with a long list is unreadable; the first ten name the shape
  // of the problem and the count says how much more of it there is.
  for (const line of tournamentCsvIssueLines(issues.slice(0, 10))) {
    const item = document.createElement("li");
    item.textContent = line;
    list.append(item);
  }
  box.append(heading, list);
  if (issues.length > 10) {
    const more = document.createElement("p");
    more.className = "tournament-op__csv-issues-more";
    more.textContent = localized(
      `And ${issues.length - 10} more.`, `En nog ${issues.length - 10}.`,
    );
    box.append(more);
  }
  return box;
}

/** "Wat mag er in het bestand?" - the columns and the words each one takes. */
export function csvRulesPanel(
  document: Document,
  rules: readonly Readonly<{ column: string; allowed: readonly string[] }>[],
): HTMLElement {
  const details = document.createElement("details");
  details.className = "tournament-op__csv-rules";
  const summary = document.createElement("summary");
  summary.textContent = localized("What may the file contain?", "Wat mag er in het bestand?");
  const intro = document.createElement("p");
  intro.textContent = localized(
    "Columns may be separated by ; , or a tab, in any order, with Dutch or English headers. Dutch and English Excel both work.",
    "Kolommen mogen gescheiden zijn door ; , of een tab, in willekeurige volgorde, met Nederlandse of Engelse kopregels. Nederlandse en Engelse Excel werken allebei.",
  );
  const list = document.createElement("ul");
  for (const rule of rules) {
    const item = document.createElement("li");
    const name = document.createElement("strong");
    name.textContent = `${rule.column}: `;
    item.append(name, document.createTextNode(rule.allowed.join(", ")));
    list.append(item);
  }
  details.append(summary, intro, list);
  return details;
}

export function tournamentRosterCsv(participants: TournamentDocument["participants"]): string {
  const collator = new Intl.Collator("nl");
  const rows = [...participants]
    .sort((left, right) => collator.compare(left.displayName, right.displayName))
    .map((entry) => [
      entry.displayName,
      entry.attendance === "present" ? "Aanwezig" : entry.attendance === "waiting" ? "Wachtlijst" : "Afwezig",
      entry.hasSwitch1 ? "ja" : "nee",
      entry.hasSwitch2 ? "ja" : "nee",
    ]);
  return csvDocument([["Naam", "Status", "NS1", "NS2"], ...rows]);
}

export function tournamentParkingPlayers(
  document_: TournamentDocument,
  stage: TournamentGroupStage,
): TournamentDocument["participants"] {
  const seated = new Set(document_.groups
    .filter((group) => group.stage === stage)
    .flatMap((group) => group.members.map((member) => member.playerId)));
  return document_.participants.filter((participant) =>
    participant.attendance === "present" && !seated.has(participant.playerId));
}

export function hasCompleteTournamentStageScores(
  groups: readonly TournamentGroup[],
  stage: TournamentGroupStage,
): boolean {
  const stageGroups = groups.filter((group) => group.stage === stage);
  return stageGroups.length > 0 && stageGroups.every((group) =>
    group.standings.source !== "none"
    && group.standings.rows.length === group.members.length
    && group.standings.rows.every((row) => row.complete));
}

function trackName(trackId: string): string {
  return findSchema9WebTrack(trackId)?.displayName ?? trackId;
}

function normalizedWorkbookName(value: string): string {
  return value.trim().normalize("NFKD").replace(/[\u0300-\u036f]/gu, "")
    .toLocaleLowerCase("nl").replace(/[^a-z0-9]/gu, "");
}

function withinWorkbookEditDistance(left: string, right: string, allowed = 2): boolean {
  if (Math.abs(left.length - right.length) > allowed) { return false; }
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row];
    let best = row;
    for (let column = 1; column <= right.length; column += 1) {
      const substitution = previous[column - 1]! + (left[row - 1] === right[column - 1] ? 0 : 1);
      const value = Math.min(previous[column]! + 1, current[column - 1]! + 1, substitution);
      current[column] = value;
      best = Math.min(best, value);
    }
    if (best > allowed) { return false; }
    previous = current;
  }
  return previous[right.length]! <= allowed;
}

/**
 * Every name one track answers to. The catalog shows the American name while
 * its identifier keeps the European one, and the Manager writes the European
 * one: "Toad Harbour" is `track.toad_harbour` is "Toad Harbor", and
 * "3DS Piranha Plant Pipeway" is "3DS Piranha Plant Slide".
 */
const WORKBOOK_TRACK_ALIASES: Readonly<Record<string, readonly string[]>> = {
  // The one European name that neither the catalog's own name nor its
  // identifier carries.
  "track.wii_dk_summit": ["Wii DK's Snowboard Cross"],
};

function workbookTrackKeys(track: Readonly<{ id: string; displayName: string }>): readonly string[] {
  return [
    normalizedWorkbookName(track.displayName),
    normalizedWorkbookName(track.id.replace(/^track\./u, "").replace(/_/gu, " ")),
    ...(WORKBOOK_TRACK_ALIASES[track.id] ?? []).map(normalizedWorkbookName),
  ].filter((key, index, all) => key.length > 0 && all.indexOf(key) === index);
}

/** What the extractors write as Track for a race without a readable track card. */
export const WORKBOOK_TRACK_PLACEHOLDER = "UNKNOWN";

export function isWorkbookTrackPlaceholder(value: string): boolean {
  const text = value.trim();
  return text === "" || text.toUpperCase() === WORKBOOK_TRACK_PLACEHOLDER;
}

function unfilledTrackMessage(races: readonly number[]): string {
  const list = races.join(", ");
  return localized(
    `Race ${list}: track not filled in yet (${WORKBOOK_TRACK_PLACEHOLDER}; no track card in the recording, e.g. it started later). Fill in the track in the file and upload it again.`,
    `Race ${list}: baan nog niet ingevuld (${WORKBOOK_TRACK_PLACEHOLDER}; geen baankaart in de opname, bijvoorbeeld omdat die later begon). Vul de baan in het bestand in en laad het opnieuw.`,
  );
}

export function tournamentWorkbookTrackId(value: string): string | null {
  if (findSchema9WebTrack(value) !== undefined) { return value; }
  const wanted = normalizedWorkbookName(value);
  if (wanted === "") { return null; }
  const exact = schema9WebTrackCatalog.find((track) => workbookTrackKeys(track).includes(wanted));
  if (exact !== undefined) { return exact.id; }
  const fuzzy = schema9WebTrackCatalog.filter((track) =>
    workbookTrackKeys(track).some((key) => withinWorkbookEditDistance(key, wanted)));
  return fuzzy.length === 1 ? fuzzy[0]!.id : null;
}

export type TournamentExportCheckpoint = Readonly<{
  key: string; label: string; stage: TournamentGroupStage; mode: "layout" | "results";
}>;

export function tournamentExportCheckpoints(step: 4 | 6 | 8 | 10): readonly TournamentExportCheckpoint[] {
  const qualifierLayout = { key: "qualifier-layout", label: localized("Qualifier layout", "Kwalificatie-indeling"), stage: "qualifier", mode: "layout" } as const;
  const qualifierResults = { key: "qualifier-results", label: localized("Qualifier results", "Kwalificatie-uitslag"), stage: "qualifier", mode: "results" } as const;
  const finalLayout = { key: "final-layout", label: localized("Final group layout", "Eindgroep-indeling"), stage: "final", mode: "layout" } as const;
  const finalResults = { key: "final-results", label: localized("Final group results", "Eindgroep-uitslag"), stage: "final", mode: "results" } as const;
  if (step === 4) { return [qualifierLayout]; }
  if (step === 6) { return [qualifierLayout, qualifierResults]; }
  if (step === 8) { return [qualifierLayout, qualifierResults, finalLayout]; }
  return [qualifierLayout, qualifierResults, finalLayout, finalResults];
}

type UtpPlanStep = Readonly<{ type: "swap" | "move"; cableX: number; cableY?: number; from: string; to: string }>;

function planUtpSwaps(start: ReadonlyMap<number, string>, target: ReadonlyMap<number, string>): Readonly<{
  steps: readonly UtpPlanStep[]; swapCount: number; moveCount: number; unresolved: number;
}> {
  const current = new Map([...target.keys()].map((cable) => [cable, start.get(cable) ?? "__unassigned__"]));
  const steps: UtpPlanStep[] = [];
  const needs = (): Map<string, Map<string, number[]>> => {
    const matrix = new Map<string, Map<string, number[]>>();
    for (const [cable, targetGroup] of target) {
      const from = current.get(cable) ?? "__unassigned__";
      if (from === targetGroup) { continue; }
      const row = matrix.get(from) ?? new Map<string, number[]>();
      const cables = row.get(targetGroup) ?? [];
      cables.push(cable);
      row.set(targetGroup, cables.sort((left, right) => left - right));
      matrix.set(from, row);
    }
    return matrix;
  };
  for (let iteration = 0; iteration < Math.max(16, target.size * 8); iteration += 1) {
    const matrix = needs();
    const pairs = [...matrix].flatMap(([from, row]) => [...row].flatMap(([to, cables]) =>
      cables.length === 0 ? [] : [{ from, to, cables }]))
      .sort((left, right) => `${left.from}|${left.to}`.localeCompare(`${right.from}|${right.to}`));
    if (pairs.length === 0) { break; }
    const reciprocal = pairs.map((pair) => {
      const cableX = pair.cables[0];
      const cableY = matrix.get(pair.to)?.get(pair.from)?.[0];
      if (cableX === undefined || cableY === undefined || cableX === cableY) { return null; }
      const fromX = current.get(cableX) ?? "__unassigned__";
      const fromY = current.get(cableY) ?? "__unassigned__";
      if (fromX === fromY || fromX === "__unassigned__" || fromY === "__unassigned__") { return null; }
      return { type: "swap", cableX, cableY, from: fromX, to: fromY } as const;
    }).find((entry) => entry !== null);
    if (reciprocal !== undefined && reciprocal !== null) {
      current.set(reciprocal.cableX, reciprocal.to);
      current.set(reciprocal.cableY, reciprocal.from);
      steps.push(reciprocal);
      continue;
    }
    const pair = pairs[0]!;
    const cableX = pair.cables[0]!;
    const fromX = current.get(cableX) ?? "__unassigned__";
    const toX = target.get(cableX)!;
    const cableY = [...current.keys()].filter((candidate) => candidate !== cableX &&
      current.get(candidate) === toX && target.get(candidate) !== toX).sort((left, right) => left - right)[0];
    if (cableY !== undefined && current.get(cableY) !== fromX && fromX !== "__unassigned__") {
      const fromY = current.get(cableY) ?? "__unassigned__";
      current.set(cableX, fromY); current.set(cableY, fromX);
      steps.push({ type: "swap", cableX, cableY, from: fromX, to: fromY });
    } else {
      current.set(cableX, toX);
      steps.push({ type: "move", cableX, from: fromX, to: toX });
    }
  }
  return {
    steps,
    swapCount: steps.filter((step) => step.type === "swap").length,
    moveCount: steps.filter((step) => step.type === "move").length,
    unresolved: [...target].filter(([cable, group]) => current.get(cable) !== group).length,
  };
}

export function tournamentFinalLayoutAudit(document_: TournamentDocument) {
  const stationKey = (station: NonNullable<TournamentGroup["members"][number]["station"]>) =>
    `${station.ownerPlayerId}\u0000${station.switchType}`;
  const seats = (stage: TournamentGroupStage) => new Map(document_.groups.filter((group) => group.stage === stage)
    .flatMap((group) => group.members.flatMap((member) => member.station === undefined ? [] : [[member.playerId, {
      groupName: groupLabel(group), groupKey: `G${group.sequence}`, station: member.station,
    }] as const])));
  const qualifier = seats("qualifier");
  const finals = seats("final");
  const participants = new Map(document_.participants.map((participant) => [participant.playerId, participant]));
  const cableByStation = new Map<string, number>();
  for (const stage of ["qualifier", "final"] as const) {
    for (const group of document_.groups.filter((candidate) => candidate.stage === stage).sort((a, b) => a.sequence - b.sequence)) {
      for (const member of [...group.members].sort((a, b) => a.seatOrder - b.seatOrder)) {
        if (member.station !== undefined && !cableByStation.has(stationKey(member.station))) {
          cableByStation.set(stationKey(member.station), cableByStation.size + 1);
        }
      }
    }
  }
  const stationLabel = (station: NonNullable<TournamentGroup["members"][number]["station"]>) =>
    `UTP ${cableByStation.get(stationKey(station)) ?? "?"} · ${station.switchType.toUpperCase()} ${station.ownerDisplayName}`;
  const participantMoves = [...finals].flatMap(([playerId, finalSeat]) => {
    const first = qualifier.get(playerId);
    if (first === undefined || stationKey(first.station) === stationKey(finalSeat.station)) { return []; }
    return [{ displayName: participants.get(playerId)?.displayName ?? playerId,
      fromGroup: first.groupName, fromStation: stationLabel(first.station),
      toGroup: finalSeat.groupName, toStation: stationLabel(finalSeat.station) }];
  }).sort((left, right) => left.displayName.localeCompare(right.displayName, "nl"));
  const ownerGiveUps = [...finals].flatMap(([playerId, finalSeat]) => {
    const participant = participants.get(playerId);
    if (participant === undefined || (!participant.hasSwitch1 && !participant.hasSwitch2) ||
        finalSeat.station.ownerPlayerId === playerId) { return []; }
    return [{ displayName: participant.displayName, groupName: finalSeat.groupName,
      seatedStation: stationLabel(finalSeat.station) }];
  }).sort((left, right) => left.displayName.localeCompare(right.displayName, "nl"));
  const cableGroups = (stage: TournamentGroupStage) => new Map<number, string>(document_.groups
    .filter((group) => group.stage === stage).flatMap((group) => group.members.flatMap((member) => {
      if (member.station === undefined) { return []; }
      const cable = cableByStation.get(stationKey(member.station));
      return cable === undefined ? [] : [[cable, `G${group.sequence}`] as const];
    })));
  return {
    ownerGiveUps, participantMoves, weightedScore: ownerGiveUps.length * 3 + participantMoves.length,
    utpPlan: planUtpSwaps(cableGroups("qualifier"), cableGroups("final")),
  };
}

export function tournamentConflictMessage(detail: string): string {
  const normalized = detail.trim().toLocaleLowerCase("en");
  if (normalized.includes("groups with entered races stay locked")) {
    return localized(
      "The group layout stays locked because races have already been entered. No results were removed. Continue to the score step to review them.",
      "De groepsindeling blijft vergrendeld omdat er al races zijn ingevoerd. Er zijn geen uitslagen verwijderd. Ga verder naar de scorestap om ze te controleren.",
    );
  }
  if (normalized.includes("tournament changed") || normalized.includes("reload and retry")) {
    return localized(
      "The tournament changed in the meantime. The latest data was loaded; check the current step and try again.",
      "Het toernooi is intussen gewijzigd. De nieuwste gegevens zijn geladen; controleer de actuele stap en probeer daarna opnieuw.",
    );
  }
  return detail.length > 0 ? localized(
    `The server blocked this change because of a Tournament rule: ${detail}`,
    `De server heeft deze wijziging door een toernooiregel geblokkeerd: ${detail}`,
  ) : localized(
    "The tournament state blocks this change. Refresh and check the current step.",
    "De toernooitoestand blokkeert deze wijziging. Vernieuw en controleer de actuele stap.",
  );
}

interface TournamentDraftControl {
  readonly key: string;
  readonly value: string;
  readonly checked: boolean;
  readonly firstPass: boolean;
}

export interface TournamentDraftSnapshot {
  readonly controls: readonly TournamentDraftControl[];
  readonly scrollY: number;
}

function draftControls(root: HTMLElement): { element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement; key: string }[] {
  const counts = new Map<string, number>();
  return [...root.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input, select, textarea")]
    .flatMap((element) => {
      const semantic = element.getAttribute("aria-label") ?? element.getAttribute("name") ?? element.id;
      if (semantic.trim().length === 0) { return []; }
      const base = `${element.tagName}|${element instanceof HTMLInputElement ? element.type : ""}|${semantic}`;
      const occurrence = counts.get(base) ?? 0;
      counts.set(base, occurrence + 1);
      return [{ element, key: `${base}|${occurrence}` }];
    });
}

/** Keep unsaved score/name choices through a conflict-triggered safe reload. */
export function captureTournamentDraft(root: HTMLElement): TournamentDraftSnapshot {
  return {
    controls: draftControls(root).map(({ element, key }) => ({
      key,
      value: element.value,
      checked: element instanceof HTMLInputElement && element.checked,
      firstPass: element instanceof HTMLSelectElement ||
        (element instanceof HTMLInputElement && element.type === "range"),
    })),
    scrollY: root.ownerDocument.defaultView?.scrollY ?? 0,
  };
}

export function restoreTournamentDraft(root: HTMLElement, snapshot: TournamentDraftSnapshot): void {
  for (const firstPass of [true, false]) {
    for (const saved of snapshot.controls.filter((control) => control.firstPass === firstPass)) {
      const target = draftControls(root).find((control) => control.key === saved.key)?.element;
      if (target === undefined) { continue; }
      if (target instanceof HTMLInputElement && target.type === "checkbox") {
        target.checked = saved.checked;
      } else {
        target.value = saved.value;
      }
      target.dispatchEvent(new Event(firstPass ? "change" : "input", { bubbles: true }));
    }
  }
  root.ownerDocument.defaultView?.scrollTo(0, snapshot.scrollY);
}

function errorText(error: unknown, fallback: string): string {
  if (error instanceof TournamentOperationClientError) {
    if (error.code === "conflict") { return tournamentConflictMessage(error.detail); }
    if (error.code === "invalid_input") { return error.detail.length > 0 ? error.detail : "That input is not valid."; }
    if (error.code === "not_authorized" && error.detail === PLAYER_CREATION_CLOSED) { return rosterCreationClosedText(); }
    if (error.code === "not_authorized") { return "Administrator access is required."; }
    if (error.code === "not_found") { return error.detail.length > 0 ? error.detail : "Not found."; }
  }
  return fallback;
}

function button(document: Document, label: string, primary = false): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.className = primary ? "tt-auth__button tt-auth__button--primary" : "tt-auth__button";
  element.textContent = label;
  return element;
}

function field(document: Document, label: string, input: HTMLElement): HTMLLabelElement {
  const wrapper = document.createElement("label");
  wrapper.className = "tournament-op__field";
  const caption = document.createElement("span");
  caption.textContent = label;
  wrapper.append(caption, input);
  return wrapper;
}

function fileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Excel-bestand kon niet worden gelezen.")));
    reader.addEventListener("error", () => reject(reader.error ?? new Error("Excel-bestand kon niet worden gelezen.")));
    reader.readAsDataURL(file);
  });
}

function downloadBlob(blob: Blob, fileName: string): void {
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(href);
}

function base64Blob(value: string, mediaType: string): Blob {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) { bytes[index] = binary.charCodeAt(index); }
  return new Blob([bytes], { type: mediaType });
}

/** Kept as the name the rest of this module uses; any delimiter is accepted. */
export const semicolonRecords = csvRecords;

function historicalName(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("nl").replace(/[^a-z0-9]/g, "");
}

// The WhatsApp export the Manager has always produced. This is a faithful port
// of `RulesEngine::exportWhatsApp` from the original project - the group title,
// the em-dash seat lines with their [NS1]/[NS2] marker and "Nintendo Switch van
// <owner>", the blank line before "Uitslag:", the `#n Name (score pt)` rows and
// the Dutch empty-state sentences. The text is pasted into a group chat where
// people already know this shape by heart, so it is not ours to restyle.
type TournamentExportMode = "layout" | "results" | "auto";

// The original writes the score without trailing zeros: 42, 38.5, 7.25.
function exportScoreText(points: number | null | undefined): string {
  if (points === null || points === undefined) { return "-"; }
  return points.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function exportGroupTitle(group: TournamentGroup): string {
  const index = group.name.replace(/\D+/g, "");
  const prefix = group.stage === "final" ? "Eindgroep " : "Kwalificatiegroep ";
  return prefix + (index !== "" ? index : group.name);
}

// "Nintendo Switch van Bas" - the owner's own name, with any stored prefix
// removed first so it is never written twice.
function exportStationLabel(ownerDisplayName: string): string {
  const owner = ownerDisplayName
    .replace(/^(Nintendo Switch van|Switch van|Console)\s+/i, "")
    .trim();
  return owner === "" ? "Nintendo Switch" : `Nintendo Switch van ${owner}`;
}

export function tournamentWhatsAppText(
  document_: TournamentDocument,
  stage: TournamentGroupStage | null,
  mode: TournamentExportMode = "auto",
): string {
  const includeSeating = mode === "layout" || mode === "auto";
  const includeResults = mode === "results" || mode === "auto";
  const groups = stage === null
    ? document_.groups
    : document_.groups.filter((group) => group.stage === stage);
  const chunks: string[] = [];
  for (const group of groups) {
    const lines: string[] = [exportGroupTitle(group)];
    let hasSeatingLines = false;
    if (includeSeating) {
      const stations = new Map<string, { label: string; marker: string; seats: string[] }>();
      for (const member of group.members) {
        if (member.station === undefined) { continue; }
        const key = `${member.station.ownerDisplayName}|${member.station.switchType}`;
        const station = stations.get(key) ?? {
          label: exportStationLabel(member.station.ownerDisplayName),
          marker: member.station.switchType.toLowerCase() === "ns2" ? "[NS2]" : "[NS1]",
          seats: [],
        };
        station.seats[member.station.seatNumber - 1] = member.displayName;
        stations.set(key, station);
      }
      for (const station of stations.values()) {
        const entries = station.seats
          .map((name, index) => (name === undefined ? null : `#${index + 1} ${name}`))
          .filter((entry): entry is string => entry !== null);
        if (entries.length === 0) { continue; }
        lines.push(`— ${station.marker} ${station.label}: ${entries.join(" & ")}`);
        hasSeatingLines = true;
      }
      if (!hasSeatingLines && mode === "layout") { lines.push("— Nog geen plaatsing"); }
    }
    if (includeResults) {
      const rows = group.standings.rows;
      if (rows.length > 0) {
        if (hasSeatingLines && includeSeating) { lines.push(""); }
        lines.push("Uitslag:");
        rows.forEach((row, index) => {
          lines.push(`#${index + 1} ${row.displayName} (${exportScoreText(row.points)} pt)`);
        });
      } else if (mode === "results") {
        lines.push("Uitslag: nog niet beschikbaar");
      }
    }
    chunks.push(lines.join("\n"));
  }
  if (chunks.length === 0) {
    const isFinal = stage === "final";
    const isQualifier = stage === "qualifier";
    if (mode === "layout") {
      return isFinal
        ? "Geen eindgroep-indeling gevonden."
        : isQualifier ? "Geen kwalificatie-indeling gevonden." : "Geen indelingen gevonden.";
    }
    if (mode === "results") {
      return isFinal
        ? "Geen eindgroep-uitslagen gevonden."
        : isQualifier ? "Geen kwalificatie-uitslagen gevonden." : "Geen uitslagen gevonden.";
    }
    return isFinal
      ? "Geen eindgroepen gevonden."
      : isQualifier ? "Geen kwalificatiegroepen gevonden." : "Geen groepen gevonden.";
  }
  return chunks.join("\n\n");
}

export function seatingText(document_: TournamentDocument, stage: TournamentGroupStage): string {
  return tournamentWhatsAppText(document_, stage, "layout");
}

export function standingsText(document_: TournamentDocument): string {
  return tournamentWhatsAppText(document_, null, "results");
}

export function standingsCsv(document_: TournamentDocument): string {
  const rows: string[][] = [[
    localized("Stage", "Fase"), localized("Group", "Groep"), localized("Rank", "Positie"),
    localized("Player", "Speler"), localized("Points", "Punten"),
    localized("Races", "Races"), localized("Wins", "Overwinningen"),
  ]];
  for (const group of document_.groups) {
    for (const row of group.standings.rows) {
      rows.push([group.stage, groupLabel(group), `${row.rank}`, row.displayName, `${row.points}`, `${row.races}`, `${row.wins}`]);
    }
  }
  return csvDocument(rows);
}

export function seatingCsv(document_: TournamentDocument, stage: TournamentGroupStage): string {
  const rows: string[][] = [[
    localized("Stage", "Fase"), localized("Group", "Groep"),
    localized("Switch owner", "Switcheigenaar"), localized("Console", "Console"),
    localized("Seat", "Stoel"), localized("Player", "Speler"),
  ]];
  for (const group of document_.groups.filter((candidate) => candidate.stage === stage)) {
    for (const member of group.members) {
      rows.push([
        stage,
        groupLabel(group),
        member.station?.ownerDisplayName ?? "",
        member.station?.switchType.toUpperCase() ?? "",
        `${member.station?.seatNumber ?? ""}`,
        member.displayName,
      ]);
    }
  }
  return csvDocument(rows);
}

export type UtpCablePlanRow = Readonly<{
  stage: TournamentGroupStage;
  groupName: string;
  cableNumber: number;
  stationName: string;
  players: readonly string[];
}>;

// Cable numbers stay bound to the physical Switch owner/type across stages.
// That makes the final-stage list an explicit swap plan rather than a fresh,
// unrelated numbering pass. They are this Tournament's positions 1..N in
// board order (ADR-0176), never the server's lifetime number for a console.
export function utpCablePlan(document_: TournamentDocument, stage: TournamentGroupStage): readonly UtpCablePlanRow[] {
  const cableByStation = new Map<string, number>();
  let nextCable = 1;
  const rows: UtpCablePlanRow[] = [];
  const orderedGroups = [...document_.groups].sort((left, right) =>
    (left.stage === right.stage ? left.sequence - right.sequence : left.stage === "qualifier" ? -1 : 1));
  for (const group of orderedGroups) {
    const stations = new Map<string, { name: string; players: string[]; cableNumber?: number }>();
    for (const member of group.members) {
      if (member.station === undefined) { continue; }
      const key = `${member.station.ownerPlayerId}|${member.station.switchType}`;
      const station = stations.get(key) ?? {
        name: `${member.station.ownerDisplayName} · ${member.station.switchType.toUpperCase()}`,
        players: [],
      };
      station.players[member.station.seatNumber - 1] = member.displayName;
      stations.set(key, station);
      if (!cableByStation.has(key)) { cableByStation.set(key, nextCable++); }
    }
    if (group.stage !== stage) { continue; }
    for (const [key, station] of stations) {
      rows.push({
        stage,
        groupName: groupLabel(group),
        cableNumber: cableByStation.get(key)!,
        stationName: station.name,
        players: station.players.filter((name) => name !== undefined),
      });
    }
  }
  return rows;
}

export type TournamentAnalytics = Readonly<{
  raceCount: number;
  voidedRaceCount: number;
  participantCount: number;
  rows: readonly Readonly<{
    playerId: string;
    displayName: string;
    points: number;
    races: number;
    wins: number;
    averagePoints: number;
  }>[];
}>;

export function tournamentAnalytics(document_: TournamentDocument): TournamentAnalytics {
  const players = new Map<string, { displayName: string; points: number; races: number; wins: number }>();
  let raceCount = 0;
  let voidedRaceCount = 0;
  for (const group of document_.groups) {
    for (const race of group.races) {
      if (!race.countsTowardStandings) { voidedRaceCount += 1; continue; }
      raceCount += 1;
      for (const placement of race.placements) {
        const row = players.get(placement.playerId) ?? { displayName: placement.displayName, points: 0, races: 0, wins: 0 };
        row.points += placement.racePoints;
        row.races += 1;
        if (placement.finishPosition === 1) { row.wins += 1; }
        players.set(placement.playerId, row);
      }
    }
  }
  const rows = [...players].map(([playerId, row]) => ({
    playerId,
    ...row,
    averagePoints: row.races === 0 ? 0 : row.points / row.races,
  })).sort((left, right) => right.points - left.points || right.wins - left.wins || left.displayName.localeCompare(right.displayName));
  return { raceCount, voidedRaceCount, participantCount: document_.participants.length, rows };
}

export function mountTournamentOperation(
  root: HTMLElement,
  options: TournamentOperationOptions = {},
): MountedTournamentOperation {
  const document = root.ownerDocument;
  const client = options.client ?? createTournamentOperationClient();
  const reportClient = createTournamentReportClient();
  const players = options.players ?? createPlayerClaimClient();
  const navigate = options.onNavigate ?? ((href: string) => {
    globalThis.history?.pushState?.(null, "", href);
    globalThis.dispatchEvent?.(new PopStateEvent("popstate"));
  });
  const confirm = options.confirm ?? ((message: string) => globalThis.confirm?.(message) ?? true);
  const controller = new AbortController();
  let disposed = false;
  let current: TournamentDocument | null = null;
  // Inspection is local view state, never a destructive workflow rollback.
  let equipmentReviewStage: TournamentGroupStage | null = null;
  let busy = false;
  let signupBoard: MountedTournamentSignupBoard | undefined;
  let hideInactiveAbsentPlayers = true;
  // What the last roster import said, so a re-render does not swallow it.
  let lastRosterImportMessage: string | HTMLElement | null = null;
  // The score workbook stays loaded after a group is imported: a night has
  // three groups in one file and re-picking the file for each one is the
  // owner's "only the last group can be loaded".
  let scoreWorkbook: Readonly<{ step: 5 | 9; fileName: string; videos: ScoreWorkbookPreview }> | null = null;
  // What each group's import last said, kept the same way.
  const scoreImportMessages = new Map<string, string>();
  /**
   * What the operator matched, per group: the name in the workbook to the
   * Player they chose. Importing re-renders the step, and a re-render used to
   * rebuild every select from the suggestion - so a hand-made correction was
   * thrown away the moment it was used.
   */
  const scoreImportChoices = new Map<string, Map<string, string>>();
  /** Groups already imported from the loaded workbook; their block folds away. */
  const scoreImportedGroups = new Set<string>();
  let importSection: ReturnType<typeof mountTournamentCanonicalImportSection> | null = null;
  let incomingController: AbortController | null = null;
  // Every name a participant answers to, read once per Tournament. Step 5 and
  // Step 9 both match Excel names through these, so the map lives beside the
  // view rather than inside the section that happens to fetch it first.
  let participantAliases = new Map<string, readonly string[]>();
  const confirmedIncomingMappings = new Map<string, string>();
  let selectedDirector: Readonly<{ userAccountId: string; displayName: string }> | null = null;
  // Whether the signed-in operator is an administrator: the Director list says
  // so, and the actions that move the rating for everybody need it.
  let operatorIsAdministrator = false;
  // ADR-0221: whether Directors may create Players on this installation. Open
  // until the settings say otherwise; the server refuses a closed path anyway.
  let directorCreationAllowed = true;
  // The APK's mobile board interaction: tap a player card to select it and
  // move it with buttons. Cleared whenever a mutation lands.
  let selectedBoardPlayer: Readonly<{ playerId: string; displayName: string }> | null = null;
  let selectedMoveTargetGroupId: string | null = null;
  /** The "Toevoegen" sheet an empty seat or an empty Switch slot opens. */
  let addSheet:
    | Readonly<{ kind: "seat"; groupId: string; stationKey: string; seatNumber: 1 | 2; tab: "parking" | "known" | "new" }>
    | Readonly<{ kind: "station"; groupId: string; slotIndex: number; tab: "parking" | "new" }>
    | null = null;
  void loadInstallationSettings(options.installationSettings ?? createInstallationSettingsClient(), controller.signal)
    .then((settings) => {
      const allowed = settings.playerCreation !== "self_only";
      if (disposed || allowed === directorCreationAllowed) { return; }
      directorCreationAllowed = allowed;
      if (current !== null) { renderDocument(); }
    });
  const directorQuery = (): string => selectedDirector === null
    ? ""
    : `&director=${encodeURIComponent(selectedDirector.userAccountId)}`;

  const mobilePhaseLabel = (step: number): string => {
    const labels: Readonly<Record<number, readonly [string, string]>> = {
      2: ["Step 2 · Select participants", "Stap 2 · Deelnemers selecteren"],
      3: ["Step 3 · Create qualifier layout", "Stap 3 · Kwalificatie-indeling maken"],
      4: ["Step 4 · Export qualifier layout", "Stap 4 · Kwalificatie-indeling exporteren"],
      5: ["Step 5 · Enter qualifier scores", "Stap 5 · Kwalificatiescores invullen"],
      6: ["Step 6 · Export results", "Stap 6 · Uitslag exporteren"],
      7: ["Step 7 · Check final groups", "Stap 7 · Eindgroepen controleren"],
      8: ["Step 8 · Export final groups", "Stap 8 · Eindgroepen exporteren"],
      9: ["Step 9 · Enter final-group scores", "Stap 9 · Eindgroepscores invullen"],
      10: ["Step 10 · Share results", "Stap 10 · Uitslag delen"],
    };
    const label = labels[step] ?? labels[10]!;
    return localized(label[0], label[1]);
  };

  const container = document.createElement("section");
  container.className = "ds-root ds-race-direction tournament-op";
  container.setAttribute("data-spectacle", "minimal");
  container.setAttribute("aria-labelledby", "tournament-op-heading");
  const heading = document.createElement("h1");
  heading.className = "ds-display-4";
  heading.id = "tournament-op-heading";
  heading.textContent = localized("Tournament operation", "Toernooibediening");
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  status.className = "tournament-op__status";
  status.textContent = "Loading…";
  const content = document.createElement("div");
  content.className = "tournament-op__content";
  container.append(heading, status, content);
  root.append(container);

  const say = (message: string): void => { status.textContent = message; };

  const run = async (label: string, work: () => Promise<TournamentDocument | TournamentSummary | void>): Promise<void> => {
    if (busy) { return; }
    busy = true;
    const draft = captureTournamentDraft(content);
    say(`${label}…`);
    try {
      const result = await work();
      if (disposed) { return; }
      if (result !== undefined && "participants" in result) {
        current = result;
      } else if (current !== null) {
        current = await client.load(current.summary.tournamentId, controller.signal);
      }
      say(localized(`${label} done.`, `${label} voltooid.`));
      if (current !== null) { renderDocument(); }
    } catch (error) {
      if (disposed) { return; }
      const message = errorText(error, localized(`${label} failed.`, `${label} mislukt.`));
      if (error instanceof TournamentOperationClientError && error.code === "conflict" && current !== null) {
        try {
          current = await client.load(current.summary.tournamentId, controller.signal);
          renderDocument();
          restoreTournamentDraft(content, draft);
        } catch { /* keep the stale view; the message explains */ }
      }
      say(message);
    } finally {
      busy = false;
    }
  };

  // -- list / create ---------------------------------------------------------

  // ADR-0177 decisions 1-3, mirrored from the APK's TournamentDirectorStep:
  // the server decides who may direct, an ordinary director skips Step 0
  // entirely, only an administrator picks, and neither a PIN nor free text
  // exists.
  const renderDirectorStep = async (autoSkip = true): Promise<void> => {
    clear(content);
    heading.textContent = localized("Step 0: Tournament Director", "Stap 0: Toernooidirecteur");
    say("");
    let listed: Awaited<ReturnType<typeof client.listDirectors>>;
    try {
      listed = await client.listDirectors(controller.signal);
    } catch (error) {
      if (disposed) { return; }
      const message = error instanceof TournamentOperationClientError && error.code === "not_authorized"
        ? localized("This account cannot operate tournaments.", "Dit account mag geen toernooi bedienen.")
        : localized("The Tournament Director list could not be loaded.", "De lijst met toernooidirecteuren kon niet worden geladen.");
      say(message);
      const retry = button(document, localized("Try again", "Opnieuw proberen"));
      retry.addEventListener("click", () => { void renderDirectorStep(); });
      content.append(retry);
      return;
    }
    if (disposed) { return; }
    // A director who cannot act for anyone else has exactly one choice, so
    // Step 0 has nothing to ask: preselect them and go straight to Step 1.
    operatorIsAdministrator = listed.canActForOthers;
    if (!listed.canActForOthers && autoSkip) {
      const self = listed.directors[0];
      if (self !== undefined) {
        selectedDirector = { userAccountId: self.userAccountId, displayName: self.displayName };
        await renderList();
        return;
      }
    }
    const step = document.createElement("section");
    step.className = "tournament-director-step";
    const phase = document.createElement("p");
    phase.className = "tournament-director-step__phase";
    phase.textContent = localized("Step 0 · Choose director", "Stap 0 · Directeur kiezen");
    const title = document.createElement("h2");
    title.textContent = localized("Step 0: Tournament Director", "Stap 0: Toernooidirecteur");
    const intro = document.createElement("p");
    intro.className = "tournament-director-step__intro";
    intro.textContent = localized(
      "First choose which Tournament Director is operating these tournaments.",
      "Kies eerst welke toernooidirecteur met deze toernooien werkt.",
    );
    const card = document.createElement("section");
    card.className = "tournament-director-step__card";
    const cardTitle = document.createElement("h3");
    cardTitle.textContent = localized("Step 0: Tournament Director", "Stap 0: Toernooidirecteur");
    const selectLabel = document.createElement("label");
    selectLabel.className = "tournament-director-step__label";
    selectLabel.textContent = listed.canActForOthers
      ? localized("Choose the director you are operating for", "Kies de directeur voor wie je werkt")
      : localized("You are operating as yourself", "Je werkt als jezelf");
    const select = document.createElement("select");
    select.setAttribute("aria-label", localized("Choose director", "Kies directeur"));
    select.disabled = listed.directors.length === 0;
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = localized("Choose director", "Kies directeur");
    select.append(placeholder);
    for (const director of listed.directors) {
      const option = document.createElement("option");
      option.value = director.userAccountId;
      option.textContent = director.displayName;
      select.append(option);
    }
    const hint = document.createElement("p");
    hint.className = "tournament-director-step__hint";
    hint.textContent = localized(
      "Choose a director first. Step 1 will then show only that director's tournaments.",
      "Kies eerst een directeur. Stap 1 toont daarna alleen toernooien van die directeur.",
    );
    const proceed = button(document, localized("Continue to Step 1", "Verder naar Stap 1"), true);
    proceed.disabled = true;
    const accessNote = document.createElement("p");
    accessNote.className = "tournament-director-step__hint";
    accessNote.textContent = localized(
      "Being a Director is linked to your signed-in account, not to a PIN.",
      "Directeur zijn hangt aan je ingelogde account, niet aan een PIN.",
    );
    const sync = (): void => {
      const existing = listed.directors.find((director) => director.userAccountId === select.value);
      selectedDirector = existing === undefined
        ? null
        : { userAccountId: existing.userAccountId, displayName: existing.displayName };
      proceed.disabled = selectedDirector === null;
      hint.textContent = selectedDirector === null
        ? localized(
          "Choose a director first. Step 1 will then show only that director's tournaments.",
          "Kies eerst een directeur. Stap 1 toont daarna alleen toernooien van die directeur.",
        )
        : localized(
          `Active director: ${selectedDirector.displayName}. Step 1 shows only this director's tournaments.`,
          `Actieve directeur: ${selectedDirector.displayName}. Stap 1 toont alleen toernooien van deze directeur.`,
        );
    };
    select.addEventListener("change", sync);
    proceed.addEventListener("click", () => { if (selectedDirector !== null) { void renderList(); } });
    card.append(cardTitle, selectLabel, select, hint, proceed, accessNote);
    step.append(phase, title, intro, card);
    content.append(step);
  };

  // Stap 1, mirrored from the APK's TournamentStartStep: two routes only -
  // start a new Tournament or load an existing one of the Step 0 director.
  // Date and time are optional; blank means today and 00:00, exactly as the
  // APK submits them.
  const renderList = async (): Promise<void> => {
    clear(content);
    heading.textContent = localized("Step 1: Start tournament", "Stap 1: Toernooi starten");
    say("");
    const step = document.createElement("section");
    step.className = "tournament-director-step tournament-director-step--start";
    const phase = document.createElement("p");
    phase.className = "tournament-director-step__phase";
    phase.textContent = localized("Step 1 · Start tournament", "Stap 1 · Toernooi starten");
    const title = document.createElement("h2");
    title.textContent = localized("Step 1: Start tournament", "Stap 1: Toernooi starten");
    const intro = document.createElement("p");
    intro.className = "tournament-director-step__intro";
    intro.textContent = localized(
      "Choose one route: start a new tournament or load an existing tournament for this director.",
      "Kies één route om verder te gaan: start een nieuw toernooi of laad een bestaand toernooi van deze directeur.",
    );
    const active = document.createElement("p");
    active.className = "tournament-director-step__hint";
    active.textContent = selectedDirector === null
      ? localized("First choose a Tournament Director in Step 0.", "Kies eerst in Stap 0 een toernooidirecteur.")
      : localized(`Active director: ${selectedDirector.displayName}.`, `Actieve directeur: ${selectedDirector.displayName}.`);
    const back = button(document, localized("← Step 0", "← Stap 0"));
    back.addEventListener("click", () => { void renderDirectorStep(false); });
    step.append(phase, title, intro, active, back);

    const createCard = document.createElement("section");
    createCard.className = "tournament-director-step__card";
    const createTitle = document.createElement("h3");
    createTitle.textContent = localized("New tournament", "Nieuw toernooi");
    const form = document.createElement("form");
    form.className = "tournament-op__create";
    const name = document.createElement("input");
    name.required = true;
    name.maxLength = 96;
    name.setAttribute("name", "name");
    const date = document.createElement("input");
    date.type = "date";
    date.setAttribute("name", "date");
    const startTime = document.createElement("input");
    startTime.type = "time";
    startTime.setAttribute("name", "startTime");
    const submit = document.createElement("button");
    submit.type = "submit";
    submit.className = "tt-auth__button tt-auth__button--primary";
    submit.textContent = localized("Start new tournament", "Nieuw toernooi starten");
    submit.disabled = true;
    name.addEventListener("input", () => { submit.disabled = name.value.trim().length === 0; });
    form.append(
      field(document, localized("Tournament name", "Toernooinaam"), name),
      field(document, localized("Tournament date (optional)", "Toernooidatum (optioneel)"), date),
      field(document, localized("Start time (optional)", "Starttijd (optioneel)"), startTime),
      submit,
    );
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (name.value.trim().length === 0) { return; }
      const today = new Date();
      const eventDate = date.value !== "" ? date.value :
        `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
      const eventTime = startTime.value !== "" ? startTime.value : "00:00";
      const localStart = new Date(`${eventDate}T${eventTime}:00`);
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      void run(localized("Creating tournament", "Toernooi aanmaken"), async () => {
        const created = await client.create({
          name: name.value.trim(),
          eventDate,
          startAtMs: localStart.getTime(),
          timezone,
          seedingSource: "community_rating",
          placementStrategy: "balanced",
          qualifierRounds: true,
          ...(selectedDirector === null ? {} : { directorUserAccountId: selectedDirector.userAccountId }),
        }, controller.signal);
        navigate(`/?tournaments=${encodeURIComponent(created.tournamentId)}&operate=1${directorQuery()}`);
        return undefined;
      });
    });
    createCard.append(createTitle, form);

    const loadCard = document.createElement("section");
    loadCard.className = "tournament-director-step__card";
    const loadTitle = document.createElement("h3");
    loadTitle.textContent = localized("Load existing tournament", "Bestaand toernooi laden");
    const chooser = document.createElement("select");
    chooser.setAttribute("aria-label", localized("Choose existing tournament", "Kies bestaand toernooi"));
    const load = button(document, localized("Load selected tournament", "Laad geselecteerd toernooi"), true);
    load.disabled = true;
    loadCard.append(loadTitle, chooser, load);
    step.append(createCard, loadCard);
    content.append(step);

    try {
      const tournaments = await client.listForAdministrator(
        selectedDirector === null ? undefined : { directorUserAccountId: selectedDirector.userAccountId },
        controller.signal,
      );
      if (disposed) { return; }
      if (tournaments.length === 0) {
        chooser.disabled = true;
        const empty = document.createElement("option");
        empty.value = "";
        empty.textContent = localized("No tournaments available", "Geen toernooien beschikbaar");
        chooser.append(empty);
      } else {
        for (const entry of tournaments) {
          const option = document.createElement("option");
          option.value = entry.tournamentId;
          option.textContent = `${entry.name} · ${selectedDirector?.displayName ?? "?"} (v${entry.revision})`;
          chooser.append(option);
        }
        load.disabled = false;
      }
      load.addEventListener("click", () => {
        if (chooser.value === "") { return; }
        navigate(`/?tournaments=${encodeURIComponent(chooser.value)}&operate=1${directorQuery()}`);
      });
    } catch (error) {
      if (disposed) { return; }
      say(errorText(error, localized("Tournaments are temporarily unavailable.", "Toernooien zijn tijdelijk niet beschikbaar.")));
    }
  };

  // -- board -----------------------------------------------------------------

  const renderEquipmentReview = (document_: TournamentDocument, stage: TournamentGroupStage): void => {
    const section = document.createElement("section");
    section.className = "tournament-op__section";
    section.setAttribute("data-equipment-review", stage);
    const title = document.createElement("h3");
    title.textContent = localized("Inspect layout and review equipment", "Indeling bekijken en materiaal controleren");
    const explanation = document.createElement("p");
    explanation.textContent = localized(
      `You remain at Step ${document_.summary.workflowStep}. Inspection changes nothing. An explicit equipment correction keeps every group's Players and order, accepted races, manual scores, characters and locks. It updates this stage's physical seating and exports, not results or another stage's layout. A Switch owner does not have to play.`,
      `Je blijft bij Stap ${document_.summary.workflowStep}. Bekijken verandert niets. Een expliciete materiaalcorrectie behoudt de spelers en volgorde per groep, geaccepteerde races, handmatige scores, personages en vergrendeling. Alleen de fysieke zitplaatsen en exports van deze fase veranderen, niet de uitslagen of een andere fase. Een Switch-eigenaar hoeft niet mee te spelen.`,
    );
    const close = button(document, localized("Return to current step", "Terug naar huidige stap"));
    close.addEventListener("click", () => { equipmentReviewStage = null; renderDocument(); });
    section.append(title, explanation, close);
    const board = tournamentBoardModel(document_, stage);
    const picks: { groupId: string; slotIndex: number; select: HTMLSelectElement }[] = [];
    const stationOptions = document_.participants.flatMap((participant) => (["ns1", "ns2"] as const).map((switchType) => ({
      key: tournamentStationKey(participant.playerId, switchType), ownerPlayerId: participant.playerId, switchType,
      label: `${participant.displayName} · ${switchType.toUpperCase()}${participant.attendance === "present" ? "" : localized(" (not playing)", " (speelt niet mee)")}`,
    })));
    for (const group of board.groups) {
      const original = document_.groups.find((candidate) => candidate.groupId === group.groupId)!;
      const panel = document.createElement("section");
      panel.className = "tournament-op__panel";
      const groupTitle = document.createElement("h4");
      groupTitle.textContent = `${displayGroupLabel(original)} · ${original.members.length} ${localized("Players", "spelers")} · ${original.races.length} ${localized("accepted races", "geaccepteerde races")}`;
      panel.append(groupTitle);
      for (const [slotIndex, slot] of group.slots.entries()) {
        const field = document.createElement("label");
        field.className = "tournament-equipment-review__field";
        const caption = document.createElement("span");
        caption.textContent = localized(`Switch slot ${slotIndex + 1}`, `Switchplek ${slotIndex + 1}`);
        const pick = document.createElement("select");
        pick.className = "tt-auth__input";
        pick.setAttribute("aria-label", `${displayGroupLabel(original)} · ${caption.textContent}`);
        const empty = document.createElement("option");
        empty.value = ""; empty.textContent = localized("No Switch", "Geen Switch");
        pick.append(empty);
        for (const entry of stationOptions) {
          const option = document.createElement("option");
          option.value = entry.key; option.textContent = entry.label;
          pick.append(option);
        }
        pick.value = slot?.key ?? "";
        const occupants = document.createElement("span");
        occupants.textContent = slot?.seats.map((seat, index) => `${index + 1}: ${seat?.displayName ?? "—"}`).join(" · ") ?? "—";
        field.append(caption, pick, occupants);
        panel.append(field);
        picks.push({ groupId: group.groupId, slotIndex, select: pick });
      }
      if (group.unseated.length > 0) {
        const unseated = document.createElement("p");
        unseated.textContent = `${localized("Unseated", "Zonder zitplaats")}: ${group.unseated.map((player) => player.displayName).join(", ")}`;
        panel.append(unseated);
      }
      section.append(panel);
    }
    const notice = document.createElement("p");
    notice.className = "tournament-op__hint";
    notice.textContent = localized(
      "Saving confirms the selected Switches are available. Removing one from a slot parks it; it does not mark it unavailable. No participant is added or moved to another group. Review the physical setup before saving.",
      "Opslaan bevestigt dat de gekozen Switches beschikbaar zijn. Een Switch uit een plek halen parkeert hem; hij wordt niet als onbeschikbaar gemarkeerd. Geen deelnemer wordt toegevoegd of naar een andere groep verplaatst. Controleer de fysieke opstelling vóór opslaan.",
    );
    const reasonField = document.createElement("label");
    reasonField.className = "tournament-equipment-review__field";
    const reasonLabel = document.createElement("span");
    reasonLabel.textContent = localized("Reason for equipment correction", "Reden voor materiaalcorrectie");
    const reason = document.createElement("input");
    reason.className = "tt-auth__input";
    reason.setAttribute("aria-label", reasonLabel.textContent);
    reason.maxLength = 160;
    reasonField.append(reasonLabel, reason);
    const save = button(document, localized("Save equipment correction; keep scores", "Materiaalcorrectie opslaan; scores behouden"));
    save.className = "tt-auth__button tt-auth__button--primary";
    save.disabled = true;
    reason.addEventListener("input", () => { save.disabled = busy || reason.value.trim().length < 3; });
    save.addEventListener("click", () => {
      if (reason.value.trim().length < 3) { return; }
      const choices: EquipmentSlotChoice[] = picks.flatMap((pick) => {
        const selected = stationOptions.find((option) => option.key === pick.select.value);
        return selected === undefined ? [] : [{ groupId: pick.groupId, slotIndex: pick.slotIndex,
          ownerPlayerId: selected.ownerPlayerId, switchType: selected.switchType }];
      });
      if (!confirm(localized("Save this explicit equipment correction? Accepted scores and the current step stay unchanged.",
        "Deze expliciete materiaalcorrectie opslaan? Geaccepteerde scores en de huidige stap blijven ongewijzigd."))) { return; }
      void run(localized("Saving equipment correction", "Materiaalcorrectie opslaan"), () => client.importGroupLayout(
        document_.summary.tournamentId, { expectedRevision: document_.summary.revision, stage,
          equipmentCorrectionReason: reason.value.trim(), groups: tournamentEquipmentCorrectionLayout(document_, stage, choices) }, controller.signal,
      ));
    });
    section.append(notice, reasonField, save);
    content.append(section);
  };

  const renderDocument = (): void => {
    if (current === null) { return; }
    const document_ = current;
    const summary = document_.summary;
    const series = summary.seriesLabel === undefined ? "" : summary.seriesLabel;
    heading.textContent = `${summary.editionNumber === undefined ? "" : `${series}${series === "" ? "" : " "}${summary.editionNumber} · `}${summary.name}`;
    clear(content);
    importSection?.unmount();
    importSection = null;
    incomingController?.abort();
    incomingController = null;

    const toolbar = document.createElement("div");
    toolbar.className = "tournament-op__toolbar tournament-op__main-toolbar";
    toolbar.id = "tournament-op-admin-menu";
    toolbar.dataset.mobileOpen = "false";
    let workflowStepBack: HTMLButtonElement | null = null;
    const back = document.createElement("a");
    back.className = "tt-auth__link";
    back.setAttribute("href", "/?tournaments=1&operate=1");
    back.textContent = localized("← All tournaments", "← Alle toernooien");
    const publicLink = document.createElement("a");
    publicLink.className = "tt-auth__link";
    publicLink.setAttribute("href", `/?tournaments=${encodeURIComponent(summary.tournamentId)}`);
    publicLink.textContent = localized("Public page", "Openbare pagina");
    const stage = document.createElement("span");
    stage.className = "tournament-op__stage";
    const stageLabel = summary.stage === "setup"
      ? localized("Setup", "Voorbereiding")
      : summary.stage === "qualifiers"
        ? localized("Qualifiers", "Kwalificaties")
        : summary.stage === "finals"
          ? localized("Finals", "Finales")
          : localized("Finalized", "Afgerond");
    stage.textContent = localized(`Stage: ${stageLabel}`, `Fase: ${stageLabel}`);
    toolbar.append(back, publicLink, stage);
    // Going a step back is a workflow action an operator reaches for under
    // pressure, so it belongs at the top beside the step rail and it says
    // where it goes - the source labels it "Terug naar Stap 8". It used to be
    // an unstyled "← Stap 4" at the very bottom of a 7000 px page, which is
    // the same as not having it.
    if (summary.stage !== "finalized" && summary.workflowStep > 2) {
      const target = summary.workflowStep - 1;
      const inspectionStage = tournamentLayoutInspectionStage(document_, target);
      const stepBack = button(document, inspectionStage !== null
        ? localized(`Inspect Step ${target} layout`, `Indeling Stap ${target} bekijken`)
        : localized(
        `Back to Step ${target}`, `Terug naar Stap ${target}`,
      ));
      stepBack.className = "tt-auth__button tournament-op__step-back";
      stepBack.title = inspectionStage !== null ? localized("Inspect without unlocking or resetting accepted scores.", "Bekijk zonder ontgrendelen of geaccepteerde scores te wissen.") : localized(
        "Reopen the previous step. Work that depends on this step is reset.",
        "Heropen de vorige stap. Werk dat van deze stap afhangt wordt teruggezet.",
      );
      stepBack.addEventListener("click", () => {
        if (inspectionStage !== null) {
          equipmentReviewStage = inspectionStage;
          renderDocument();
          return;
        }
        if (!confirm(tournamentRollbackMessage(target))) { return; }
        void run(
          localized(`Returning to Step ${target}`, `Terug naar Stap ${target}`),
          () => target === 3 || target === 7
            ? client.lockGroups(
              summary.tournamentId,
              { expectedRevision: summary.revision, stage: target === 3 ? "qualifier" : "final", locked: false },
              controller.signal,
            )
            : client.setWorkflowStep(
              summary.tournamentId,
              { expectedRevision: summary.revision, targetStep: target, direction: "rollback" },
              controller.signal,
            ),
        );
      });
      workflowStepBack = stepBack;
      toolbar.append(stepBack);
      const detachment = tournamentLayoutDetachment(document_, target);
      if (detachment !== null) {
        const detach = button(document, localized(`Back to Step ${target} (detach scores)`, `Terug naar Stap ${target} (scores loskoppelen)`));
        detach.className = "tt-auth__button tournament-op__step-back tournament-op__step-back--detach";
        detach.title = localized(
          "Really reopen the layout step: accepted scores of this stage are detached and must be entered again. Groups and seats stay.",
          "Heropen de indelingstap echt: geaccepteerde scores van deze fase worden losgekoppeld en moeten opnieuw worden ingevoerd. Groepen en zitplaatsen blijven staan.",
        );
        detach.addEventListener("click", () => {
          if (!confirm(tournamentDetachMessage(target, detachment))) { return; }
          void run(
            localized(`Returning to Step ${target}`, `Terug naar Stap ${target}`),
            () => client.setWorkflowStep(
              summary.tournamentId,
              { expectedRevision: summary.revision, targetStep: target, direction: "rollback" },
              controller.signal,
            ),
          );
        });
        toolbar.append(detach);
      }
    }
    if (summary.stage !== "finalized") {
      for (const reviewStage of ["qualifier", "final"] as const) {
        if (!document_.groups.some((group) => group.stage === reviewStage)) { continue; }
        const review = button(document, reviewStage === "qualifier"
          ? localized("Inspect qualifier layout / equipment", "Kwalificatie-indeling / materiaal bekijken")
          : localized("Inspect final layout / equipment", "Finale-indeling / materiaal bekijken"));
        review.addEventListener("click", () => { equipmentReviewStage = reviewStage; renderDocument(); });
        toolbar.append(review);
      }
    }
    // A night's name is written once at Step 1 and then stands on the public
    // page, in the report, in the export picture and in every WhatsApp message
    // about it. A typo in it used to need somebody with database access; the
    // API has always accepted the change, so the console asks for it here.
    const rename = button(document, localized("Rename", "Naam wijzigen"));
    rename.className = "tt-auth__button";
    rename.title = localized(
      "Change the tournament's name. Everything that shows it follows.",
      "Wijzig de naam van het toernooi. Alles wat de naam toont volgt.",
    );
    rename.addEventListener("click", () => {
      const wanted = prompt(
        localized("New tournament name:", "Nieuwe toernooinaam:"),
        summary.name,
      );
      if (wanted === null) { return; }
      const next = wanted.trim();
      if (next.length === 0 || next === summary.name) { return; }
      void run(localized("Renaming tournament", "Toernooi hernoemen"), async () => {
        await client.update(
          summary.tournamentId,
          { expectedRevision: summary.revision, name: next },
          controller.signal,
        );
        return client.load(summary.tournamentId, controller.signal);
      });
    });
    // The edition number is how the rating graph, the statistics and the
    // report name the night ("TN13"); a night without one is left out of the
    // first two. It is a label like the name, so it stays editable after
    // finalization - the owner found TN13 pinned without one.
    const edition = button(document, summary.editionNumber === undefined
      ? localized("Set edition number", "Editienummer instellen")
      : localized(`Edition number: TN${summary.editionNumber}`, `Editienummer: TN${summary.editionNumber}`));
    edition.className = `tt-auth__button tournament-op__edition${summary.editionNumber === undefined ? " tournament-op__edition--missing" : ""}`;
    edition.title = localized(
      "The number after TN. The rating graph, the statistics and the report name the night by it; without one the night is missing from the graph and the statistics.",
      "Het getal na TN. De rating-grafiek, de statistieken en het verslag noemen de avond ermee; zonder nummer ontbreekt de avond in de grafiek en de statistieken.",
    );
    edition.addEventListener("click", () => {
      const wanted = prompt(
        localized("Edition number (the number after TN):", "Editienummer (het getal na TN):"),
        summary.editionNumber === undefined ? "" : String(summary.editionNumber),
      );
      if (wanted === null) { return; }
      const next = Number.parseInt(wanted.trim(), 10);
      if (!Number.isSafeInteger(next) || next < 1 || next > 9999 || next === summary.editionNumber) { return; }
      void run(localized("Setting edition number", "Editienummer instellen"), async () => {
        await client.update(
          summary.tournamentId,
          { expectedRevision: summary.revision, editionNumber: next },
          controller.signal,
        );
        return client.load(summary.tournamentId, controller.signal);
      });
    });
    toolbar.append(rename, edition);

    const remove = button(document, localized("Remove tournament", "Toernooi verwijderen"));
    remove.className = "tt-auth__button tournament-op__delete";
    remove.addEventListener("click", () => {
      const reason = prompt(localized(
        `Remove "${summary.name}" from active and public history? Ratings are fully recalculated when this Tournament affected TrueSkill. Enter a reason:`,
        `"${summary.name}" uit de actieve en openbare geschiedenis verwijderen? Ratings worden volledig herberekend wanneer dit toernooi TrueSkill beïnvloedde. Voer een reden in:`,
      ));
      if (reason === null || reason.trim().length < 3) { return; }
      if (!confirm(localized(
        "Confirm removal. Audit evidence is retained; this is not a physical erase.",
        "Bevestig verwijdering. Auditbewijs blijft behouden; dit is geen fysieke vernietiging.",
      ))) { return; }
      void run(localized(
        "Removing tournament and recalculating ratings where needed",
        "Toernooi verwijderen en ratings waar nodig herberekenen",
      ), async () => {
        await client.removeTournament(summary.tournamentId, { reason }, controller.signal);
        current = null;
        navigate("/?tournaments=1&operate=1");
        return undefined;
      });
    });
    toolbar.append(remove);

    const mobileHeader = document.createElement("header");
    mobileHeader.className = "tournament-op__mobile-header";
    const mobileTop = document.createElement("div");
    mobileTop.className = "tournament-op__mobile-top";
    const mobileBack = document.createElement("a");
    mobileBack.className = "tt-auth__link tournament-op__mobile-back";
    mobileBack.href = `/?tournaments=1&operate=1${directorQuery()}`;
    mobileBack.textContent = localized("← Tournaments", "← Toernooien");
    const mobileTitle = document.createElement("strong");
    mobileTitle.className = "tournament-op__mobile-title";
    mobileTitle.textContent = localized("MK8DX LAN Tournament Board", "MK8DX LAN Toernooibord");
    const mobileMenu = button(document, "☰");
    mobileMenu.className = "tt-auth__button tournament-op__mobile-menu";
    mobileMenu.setAttribute("aria-label", localized("Admin menu", "Admin-menu"));
    mobileMenu.setAttribute("aria-controls", toolbar.id);
    mobileMenu.setAttribute("aria-expanded", "false");
    mobileMenu.addEventListener("click", () => {
      const open = toolbar.dataset.mobileOpen !== "true";
      toolbar.dataset.mobileOpen = String(open);
      mobileMenu.setAttribute("aria-expanded", String(open));
    });
    mobileTop.append(mobileBack, mobileTitle, mobileMenu);

    const mobileControls = document.createElement("div");
    mobileControls.className = "tournament-op__mobile-controls";
    const mobileHome = document.createElement("a");
    mobileHome.className = "tt-auth__button tournament-op__mobile-square";
    mobileHome.href = `/?tournaments=1&operate=1${directorQuery()}`;
    mobileHome.setAttribute("aria-label", localized("Tournament home", "Toernooioverzicht"));
    mobileHome.textContent = "🏠";
    const activeStep = summary.stage === "finalized" ? 10 : summary.workflowStep;
    let mobilePrevious: HTMLAnchorElement | HTMLButtonElement;
    if (activeStep <= 2 || workflowStepBack === null) {
      mobilePrevious = document.createElement("a");
      mobilePrevious.className = "tt-auth__button tournament-op__mobile-previous";
      mobilePrevious.href = `/?tournaments=1&operate=1${directorQuery()}`;
      mobilePrevious.textContent = localized("Back to Step 1", "Terug naar Stap 1");
    } else {
      mobilePrevious = button(document, localized(`Back to Step ${activeStep - 1}`, `Terug naar Stap ${activeStep - 1}`));
      mobilePrevious.className = "tt-auth__button tournament-op__mobile-previous";
      mobilePrevious.addEventListener("click", () => { workflowStepBack?.click(); });
    }
    const mobileSave = document.createElement("span");
    mobileSave.className = "tournament-op__mobile-square tournament-op__mobile-save";
    mobileSave.setAttribute("aria-hidden", "true");
    mobileSave.textContent = "💾";
    const mobileSaved = document.createElement("span");
    mobileSaved.className = "tournament-op__mobile-saved";
    mobileSaved.textContent = localized("✓ Saved", "✓ Opgeslagen");
    mobileControls.append(mobileHome, mobilePrevious, mobileSave, mobileSaved);

    const mobilePhase = document.createElement("p");
    mobilePhase.className = "tournament-op__mobile-phase";
    mobilePhase.textContent = mobilePhaseLabel(activeStep);
    mobileHeader.append(mobileTop, mobileControls, mobilePhase);
    content.append(mobileHeader, toolbar);
    const steps = document.createElement("ol");
    steps.className = "tournament-op__steps";
    steps.tabIndex = 0;
    steps.setAttribute("aria-label", localized("Tournament workflow steps", "Stappen van het toernooi"));
    const stepItem = (number: number, label: string): void => {
      const item = document.createElement("li");
      item.className = number < summary.workflowStep
        ? "tournament-op__step tournament-op__step--done"
        : number === summary.workflowStep
          ? "tournament-op__step"
          : "tournament-op__step";
      item.textContent = `${number} ${label}`;
      if (number === summary.workflowStep) {
        item.setAttribute("aria-current", "step");
        requestAnimationFrame(() => item.scrollIntoView?.({ block: "nearest", inline: "center" }));
      }
      steps.append(item);
    };
    // The same list the Tournaments page prints, so the two never drift.
    for (const [number, en, nl] of TOURNAMENT_STEP_LABELS) { stepItem(number, localized(en, nl)); }
    content.append(steps);
    if (equipmentReviewStage !== null && summary.stage !== "finalized") {
      renderEquipmentReview(document_, equipmentReviewStage);
      return;
    }

    const mountIncoming = (parent: HTMLElement = content): void => {
      const incoming = document.createElement("div");
      incoming.className = "tournament-op__incoming";
      parent.append(incoming);
      incomingController = new AbortController();
      controller.signal.addEventListener("abort", () => incomingController?.abort(), { once: true });
      const signal = incomingController.signal;
      void (async () => {
        const directory = await (players.listAll?.(signal) ?? Promise.resolve([])).catch(() => []);
        if (signal.aborted) return;
        const participantIds = new Set(document_.participants.map((participant) => participant.playerId));
        participantAliases = new Map(directory.filter((player) => participantIds.has(player.playerId))
          .map((player) => [player.playerId, player.aliases] as const));
        await mountTournamentIncomingSection({
          document,
          container: incoming,
          tournament: document_,
          signal,
          participantAliases,
          confirmedMappings: confirmedIncomingMappings,
          onChanged: async () => {
            current = await client.load(summary.tournamentId, controller.signal);
            renderDocument();
          },
        });
      })();
    };

    const renderScoreSourceGuide = (step: 5 | 9): void => {
      const qualifier = step === 5;
      const guide = document.createElement("section");
      guide.className = "tournament-op__section tournament-op__score-guide";
      const recommended = document.createElement("h4");
      recommended.textContent = localized(
        "Recommended on race day: Tournament Live",
        "Aanbevolen op de toernooiavond: Tournament Live",
      );
      const route = document.createElement("p");
      route.textContent = localized(
        `Before Start, the capture operator selects this Tournament and maps every sticker-named card to a different ${qualifier ? "qualifier" : "final"} group. After race 1, a strong exact roster match may open the public View. Scores count only after Stop, Player matching and complete group approval here.`,
        `Vóór START selecteert de capture-operator dit toernooi en koppelt iedere card met stickernaam aan een andere ${qualifier ? "kwalificatiegroep" : "finalegroep"}. Na race 1 kan een sterke exacte rostermatch de openbare View openen. Scores tellen pas na STOP, Player-koppeling en volledige groepscontrole hier.`,
      );
      const alternatives = document.createElement("p");
      alternatives.className = "tournament-op__hint";
      alternatives.textContent = localized(
        "Linking creates pending evidence only. Scores count after Player, Track, order and group are reviewed and accepted. Excel and manual entry remain available.",
        "Koppelen maakt alleen bewijs in afwachting. Scores tellen mee nadat speler, circuit, volgorde en groep zijn gecontroleerd en geaccepteerd. Excel en handmatige invoer blijven beschikbaar.",
      );
      guide.append(recommended, route, alternatives);
      content.append(guide);
    };

    if (summary.stage === "finalized" || summary.workflowStep === 10) {
      renderStepTen(document_);
    } else if (summary.workflowStep === 2) {
      renderParticipants(document_);
    } else if (summary.workflowStep === 3) {
      renderGroupDraftStep(document_, "qualifier");
    } else if (summary.workflowStep === 4) {
      renderLayoutExportCheckpoint(document_, "qualifier", 4);
    } else if (summary.workflowStep === 5) {
      renderScoreSourceGuide(5);
      mountIncoming();
      renderScoreEntryStep(document_, "qualifier", 5);
    } else if (summary.workflowStep === 6) {
      renderResultsExportCheckpoint(document_, "qualifier", 6);
    } else if (summary.workflowStep === 7) {
      renderGroupDraftStep(document_, "final");
    } else if (summary.workflowStep === 8) {
      renderLayoutExportCheckpoint(document_, "final", 8);
    } else if (summary.workflowStep === 9) {
      renderScoreSourceGuide(9);
      mountIncoming();
      renderScoreEntryStep(document_, "final", 9);
    }
    // Each tool sits on the step where it is used, not in a catch-all at
    // the foot of every step: incidents where scores are entered, and the
    // Tournament's history under "Admin Acties" on every step.
    const step = summary.stage === "finalized" ? 10 : summary.workflowStep;
    if (step === 5 || step === 9) { renderIncidents(document_); }
    if (step !== 3 && step !== 4 && step !== 5 && step !== 6 && step !== 7 && step !== 8 && step !== 9 &&
      !(step === 10 && summary.stage !== "finalized")) { renderAdminActions(document_, null); }
  };

  // The source layout CSV row, shared by the Step 3 and Step 7 boards and
  // folded under the title the phone uses: "Importeer / exporteer CSV".
  const renderLayoutCsv = (document_: TournamentDocument, stage: TournamentGroupStage): void => {
    const groups = document_.groups.filter((group) => group.stage === stage);
    const stepNumber = stage === "qualifier" ? 3 : 7;
      const layoutImport = document.createElement("details");
      layoutImport.className = "tournament-op__import tournament-op__csv";
      const layoutSummary = document.createElement("summary");
      layoutSummary.className = "tournament-op__csv-summary";
      const csvIcon = document.createElement("span");
      csvIcon.className = "tournament-op__csv-icon";
      csvIcon.setAttribute("aria-hidden", "true");
      const csvTitle = document.createElement("span");
      csvTitle.textContent = localized("Import / export CSV", "Importeer / exporteer CSV");
      const csvStep = document.createElement("span");
      csvStep.className = "tournament-op__csv-step";
      csvStep.textContent = ` (${localized(`Step ${stepNumber}`, `Stap ${stepNumber}`)})`;
      layoutSummary.append(csvIcon, csvTitle, csvStep);
      const layoutFile = document.createElement("input");
      layoutFile.type = "file";
      layoutFile.accept = ".csv,text/csv";
      layoutFile.hidden = true;
      layoutFile.setAttribute("aria-label", stage === "qualifier"
        ? localized("Historical qualifier layout CSV", "Historische CSV met kwalificatie-indeling")
        : localized("Historical final layout CSV", "Historische CSV met eindgroepindeling"));
      const csvActions = document.createElement("div");
      csvActions.className = "tournament-op__csv-actions";
      const importButton = button(document, localized(`Import CSV (Step ${stepNumber})`, `Importeer CSV (Stap ${stepNumber})`));
      importButton.addEventListener("click", () => layoutFile.click());
      const exportButton = button(document, localized(`Export CSV (Step ${stepNumber})`, `Exporteer CSV (Stap ${stepNumber})`));
      exportButton.addEventListener("click", () => {
        const blob = new Blob([tournamentGroupLayoutCsv(groups)], { type: "text/csv" });
        const anchorElement = document.createElement("a");
        anchorElement.href = URL.createObjectURL(blob);
        anchorElement.download = `${document_.summary.name} ${"\u00b7"} Stap ${stepNumber} indeling.csv`;
        anchorElement.click();
        URL.revokeObjectURL(anchorElement.href);
      });
      csvActions.append(importButton, exportButton);
      const columns = document.createElement("p");
      columns.className = "tournament-op__hint";
      columns.textContent = localized(
        "CSV columns: Switcheigenaar/Switch owner, Console (NS1/NS2), Deelnemer 1, Deelnemer 2, Groep/Group. Separated by ; or , - Dutch and English Excel both work.",
        "CSV kolommen: Switcheigenaar, Console (NS1/NS2), Deelnemer 1, Deelnemer 2, Groep. Gescheiden door ; of , - Nederlandse en Engelse Excel werken allebei.",
      );
      const layoutStatus = document.createElement("div");
      layoutStatus.className = "tournament-op__hint";
      layoutStatus.setAttribute("role", "status");
      layoutImport.append(layoutSummary, csvActions, layoutFile, columns,
        csvRulesPanel(document, tournamentLayoutFileRules()), layoutStatus);
      layoutFile.addEventListener("change", () => {
        const selected = layoutFile.files?.[0];
        if (selected === undefined) return;
        void selected.text().then((text) => {
          const report = tournamentLayoutFile(text);
          if (!report.ok) {
            layoutStatus.replaceChildren(csvIssueList(document, report.issues, localized(
              "Nothing imported.", "Niets geïmporteerd.",
            )));
            return;
          }
          const records = report.rows;
          const participants = new Map(document_.participants.flatMap((participant) => [
            [historicalName(participant.displayName), participant.playerId],
            [historicalName(participant.username), participant.playerId],
          ] as const));
          const plan = tournamentLayoutImportPlan(records, participants, groups);
          if ("rejected" in plan) {
            const { unknownGroups, unknownPlayers, invalidConsoles, duplicatePlayers } = plan.rejected;
            const line = document.createElement("p");
            // "Unknown groups" without saying which ones exist sends the
            // operator looking in the file; the groups of this stage have to
            // exist before a layout can be laid into them.
            const existing = groups.map((candidate) => candidate.name).join(", ");
            const groupHelp = unknownGroups.length === 0 ? "" : localized(
              ` This stage has: ${existing.length === 0 ? "no groups yet - create them first" : existing}.`,
              ` Deze fase heeft: ${existing.length === 0 ? "nog geen groepen - maak die eerst aan" : existing}.`,
            );
            line.textContent = localized(
              `Nothing imported.${unknownGroups.length > 0 ? ` Unknown groups: ${unknownGroups.join(", ")}.${groupHelp}` : ""}${unknownPlayers.length > 0 ? ` Unknown Players: ${unknownPlayers.join(", ")}.` : ""}${invalidConsoles.length > 0 ? ` Unknown consoles: ${invalidConsoles.join(", ")}.` : ""}${duplicatePlayers.length > 0 ? ` Duplicate Players: ${duplicatePlayers.join(", ")}.` : ""}`,
              `Niets geïmporteerd.${unknownGroups.length > 0 ? ` Onbekende groepen: ${unknownGroups.join(", ")}.${groupHelp}` : ""}${unknownPlayers.length > 0 ? ` Onbekende spelers: ${unknownPlayers.join(", ")}.` : ""}${invalidConsoles.length > 0 ? ` Onbekende consoles: ${invalidConsoles.join(", ")}.` : ""}${duplicatePlayers.length > 0 ? ` Dubbele spelers: ${duplicatePlayers.join(", ")}.` : ""}`,
            );
            layoutStatus.replaceChildren(line);
            return;
          }
          const progress = document.createElement("p");
          progress.textContent = localized(
            `${plan.rows} Switch rows recognized. Importing the exact group order…`,
            `${plan.rows} Switch-rijen herkend. De exacte groepsvolgorde wordt geïmporteerd…`,
          );
          layoutStatus.replaceChildren(progress);
          void run(localized("Importing historical Tournament layout", "Historische toernooi-indeling importeren"), () => client.importGroupLayout(
            document_.summary.tournamentId,
            { expectedRevision: document_.summary.revision, stage, groups: plan.groups },
            controller.signal,
          ));
        }).catch(() => {
          const failed = document.createElement("p");
          failed.textContent = localized(
            "The layout CSV could not be read.",
            "De CSV met de indeling kon niet worden gelezen.",
          );
          layoutStatus.replaceChildren(failed);
        });
      });
      content.append(layoutImport);
  };

  // Steps 3 and 7 of the source Manager share one board; only the stage,
  // labels and confirm target differ. This mirrors the APK's
  // TournamentGroupDraftStep: the status line counts the unplaced present
  // Players, and confirming locks the stage - the server advances the step,
  // so no extra workflow call is sent (doing both would skip the export).
  // Steps 3 and 7 of the source Manager share one board; only the stage,
  // labels and confirm target differ. The board below is the source
  // `renderGroupBoard`: per-group gradient borders and seat tones from the
  // STEP3_SEAT_PALETTE, seat-level drag & drop with true swaps, Switch drag
  // that carries its players in the qualifier, and the two parking zones.
  // Confirming locks the stage - the server advances the step, so no extra
  // workflow call is sent (doing both would skip the export checkpoint).
  const renderGroupDraftStep = (document_: TournamentDocument, stage: TournamentGroupStage): void => {
    const phase = document.createElement("p");
    phase.className = "tournament-director-step__phase tournament-board__phase";
    phase.textContent = stage === "qualifier"
      ? localized(`Step 3 ${"\u00b7"} Create qualifier layout`, `Stap 3 ${"\u00b7"} Kwalificatie-indeling maken`)
      : localized(`Step 7 ${"\u00b7"} Review final groups`, `Stap 7 ${"\u00b7"} Eindgroepen controleren`);
    content.append(phase);
    const boardHint = document.createElement("p");
    boardHint.className = "tournament-board__hint";
    const boardHintBadge = document.createElement("span");
    boardHintBadge.className = "tournament-board__hint-badge";
    boardHintBadge.setAttribute("aria-hidden", "true");
    boardHintBadge.textContent = "⇄";
    boardHint.append(
      document.createTextNode(localized("Tap ", "Tik ")),
      boardHintBadge,
      document.createTextNode(stage === "final"
        ? localized(
          " on a card to swap two participants between final groups as an administrator.",
          " op een kaart om als admin twee deelnemers tussen eindgroepen te wisselen.",
        )
        : localized(
          " on a card to place, swap, or park it.",
          " op een kaart om in te delen, te wisselen of te parkeren.",
        )),
    );
    content.append(boardHint);

    const board = tournamentBoardModel(document_, stage);
    const stageGroups = document_.groups.filter((group) => group.stage === stage);
    const locked = stageGroups.length > 0 && stageGroups.every((group) => group.locked);
    const editable = !locked && stageGroups.every((group) =>
      group.races.length === 0 && group.standings.source !== "manual");
    const participantsById = new Map(document_.participants.map((participant) => [participant.playerId, participant]));

    const applyMutation = (mutation: TournamentBoardMutation, label: string): void => {
      if (mutation.kind === "denied") { say(mutation.message); return; }
      selectedBoardPlayer = null;
      selectedMoveTargetGroupId = null;
      void run(label, async () => {
        let revision = document_.summary.revision;
        if (mutation.membershipChange) {
          const next = await client.updateGroups(document_.summary.tournamentId, {
            expectedRevision: revision,
            stage,
            groups: mutation.members,
          }, controller.signal);
          revision = next.summary.revision;
        }
        return client.importGroupLayout(document_.summary.tournamentId, {
          expectedRevision: revision,
          stage,
          groups: mutation.layout,
        }, controller.signal);
      });
    };

    const draggedPlayer = { id: "", name: "" };
    const draggedStation = { key: "" };
    const playerDropTarget = (element: HTMLElement, resolve: () => TournamentBoardMutation, label: string): void => {
      if (!editable) { return; }
      element.addEventListener("dragover", (event) => {
        if (draggedPlayer.id === "") { return; }
        event.preventDefault();
        event.stopPropagation();
        element.classList.add("tournament-board__drop-hover");
      });
      element.addEventListener("dragleave", () => element.classList.remove("tournament-board__drop-hover"));
      element.addEventListener("drop", (event) => {
        event.preventDefault();
        event.stopPropagation();
        element.classList.remove("tournament-board__drop-hover");
        if (draggedPlayer.id === "") { return; }
        applyMutation(resolve(), label);
      });
    };
    const stationDropTarget = (element: HTMLElement, resolve: () => TournamentBoardMutation, label: string): void => {
      if (!editable) { return; }
      element.addEventListener("dragover", (event) => {
        if (draggedStation.key === "") { return; }
        event.preventDefault();
        event.stopPropagation();
        element.classList.add("tournament-board__drop-hover");
      });
      element.addEventListener("dragleave", () => element.classList.remove("tournament-board__drop-hover"));
      element.addEventListener("drop", (event) => {
        event.preventDefault();
        event.stopPropagation();
        element.classList.remove("tournament-board__drop-hover");
        if (draggedStation.key === "") { return; }
        applyMutation(resolve(), label);
      });
    };
    const playerCard = (playerId: string, displayName: string, seated: boolean): HTMLElement => {
      const card = document.createElement("div");
      card.className = `tournament-board__player${seated ? " tournament-board__player--seat" : ""}`;
      card.draggable = editable;
      const participant = participantsById.get(playerId);
      const badges = document.createElement("span");
      badges.className = "tournament-board__player-badges";
      const tier = tournamentTierForPlayer(participant ?? {});
      const tierBadge = document.createElement("span");
      tierBadge.className = `tournament-board__tier tournament-board__tier--${tier.key}`;
      tierBadge.title = localized("Label based on rank", "Label op basis van rang");
      tierBadge.textContent = tournamentTierLabel(tier);
      badges.append(tierBadge);
      if (participant?.inactive ?? false) {
        const inactiveBadge = document.createElement("span");
        inactiveBadge.className = "tournament-board__tier tournament-board__tier--new";
        inactiveBadge.title = localized(
          "SP uncertain: Player has missed more than 3 tournaments.",
          "SP onzeker: speler heeft meer dan 3 toernooien niet meegedaan.",
        );
        inactiveBadge.textContent = localized("Inactive", "Inactief");
        badges.append(inactiveBadge);
      }
      const info = document.createElement("span");
      info.className = "tournament-board__player-info";
      const main = document.createElement("strong");
      main.className = "tournament-board__player-name";
      main.title = displayName;
      main.textContent = displayName;
      const meta = document.createElement("small");
      meta.className = "tournament-board__player-meta";
      const rankText = participant?.seedRank === undefined ? "#?" : `#${participant.seedRank}`;
      const spText = participant?.seedScore === undefined ? "?" : tournamentSkillScoreLabel(participant.seedScore);
      meta.title = localized("Rank and Skill Points", "Rang en Skill Points");
      meta.textContent = localized(
        `Rank ${rankText} - ${spText}${(participant?.inactive ?? false) ? " SP*" : " SP"}`,
        `Rang ${rankText} - ${spText}${(participant?.inactive ?? false) ? " SP*" : " SP"}`,
      );
      info.append(main, meta);
      card.append(badges, info);
      card.dataset.selected = selectedBoardPlayer?.playerId === playerId ? "true" : "false";
      if (editable) {
        const toggleSelection = (): void => {
          selectedBoardPlayer = selectedBoardPlayer?.playerId === playerId
            ? null
            : { playerId, displayName };
          selectedMoveTargetGroupId = null;
          renderDocument();
        };
        card.addEventListener("click", (event) => {
          if ((event.target as HTMLElement).closest("button") !== null) { return; }
          toggleSelection();
        });
        const swapBadge = document.createElement("button");
        swapBadge.type = "button";
        swapBadge.className = "tournament-board__swap-badge";
        swapBadge.setAttribute("aria-label", localized(`Move ${displayName}`, `Verplaats ${displayName}`));
        swapBadge.setAttribute("aria-pressed", selectedBoardPlayer?.playerId === playerId ? "true" : "false");
        swapBadge.title = localized(`Move or swap ${displayName}`, `Verplaats of wissel ${displayName}`);
        swapBadge.textContent = "⇄";
        swapBadge.addEventListener("click", toggleSelection);
        card.append(swapBadge);
        const park = document.createElement("button");
        park.type = "button";
        park.className = "tournament-board__park";
        park.title = localized("Move participant to parking", "Deelnemer naar parking");
        park.textContent = localized("Park", "Parkeer");
        park.addEventListener("click", () => {
          applyMutation(tournamentParkPlayerMutation(board, playerId), localized(`Parking ${displayName}`, `${displayName} parkeren`));
        });
        card.append(park);
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "tournament-board__remove";
        remove.title = localized("Remove participant", "Deelnemer verwijderen");
        remove.setAttribute("aria-label", localized(`Remove ${displayName} from the tournament`, `${displayName} uit het toernooi halen`));
        remove.textContent = "✕";
        remove.addEventListener("click", () => {
          if (!confirm(localized(
            `Are you sure you want to take ${displayName} out of Present? The participant is set to Absent.`,
            `Weet je zeker dat je deelnemer ${displayName} uit Aanwezig wilt halen? Deelnemer wordt naar Afwezig gezet.`,
          ))) { return; }
          const ownsSwitch = (participant?.hasSwitch1 ?? false) || (participant?.hasSwitch2 ?? false);
          const dropSwitches = ownsSwitch && confirm(localized(
            `Also take ${displayName}'s Nintendo Switch 1 and/or Nintendo Switch 2 out of the tournament?`,
            `Wil je Nintendo Switch 1 en/of Nintendo Switch 2 van ${displayName} ook uit het toernooi halen?`,
          ));
          const parked = tournamentParkPlayerMutation(board, playerId);
          const seatedHere = board.groups.some((group) => group.memberIds.includes(playerId));
          if (seatedHere && parked.kind === "denied") { say(parked.message); return; }
          void run(localized(`Removing ${displayName}`, `${displayName} verwijderen`), async () => {
            let revision = document_.summary.revision;
            if (seatedHere && parked.kind === "apply") {
              const next = await client.updateGroups(document_.summary.tournamentId, {
                expectedRevision: revision, stage, groups: parked.members,
              }, controller.signal);
              const laid = await client.importGroupLayout(document_.summary.tournamentId, {
                expectedRevision: next.summary.revision, stage, groups: parked.layout,
              }, controller.signal);
              revision = laid.summary.revision;
            }
            return client.setParticipant(document_.summary.tournamentId, {
              expectedRevision: revision,
              playerId,
              attendance: "absent",
              ...(dropSwitches ? { hasSwitch1: false, hasSwitch2: false } : {}),
            }, controller.signal);
          });
        });
        card.append(remove);
        card.addEventListener("dragstart", (event) => {
          event.stopPropagation();
          draggedPlayer.id = playerId;
          draggedPlayer.name = displayName;
          draggedStation.key = "";
          event.dataTransfer?.setData("text/plain", `player:${playerId}`);
          if (event.dataTransfer !== null) { event.dataTransfer.effectAllowed = "move"; }
          card.classList.add("tournament-board__dragging");
        });
        card.addEventListener("dragend", () => {
          draggedPlayer.id = "";
          card.classList.remove("tournament-board__dragging");
        });
      }
      return card;
    };
    const stationCard = (station: NonNullable<ReturnType<typeof tournamentBoardModel>["groups"][number]["slots"][number]>, groupIndex: number, slotIndex: number, inGroupId: string | null): HTMLElement => {
      const card = document.createElement("div");
      card.className = "tournament-board__station";
      const title = document.createElement("h4");
      title.className = "tournament-board__station-title";
      if (editable) {
        const handle = document.createElement("button");
        handle.type = "button";
        handle.className = "tournament-board__handle";
        handle.title = localized("Drag Nintendo Switch", "Sleep Nintendo Switch");
        handle.textContent = "\u22ee\u22ee";
        handle.draggable = true;
        handle.addEventListener("dragstart", (event) => {
          event.stopPropagation();
          draggedStation.key = station.key;
          draggedPlayer.id = "";
          event.dataTransfer?.setData("text/plain", `station:${station.key}`);
          if (event.dataTransfer !== null) { event.dataTransfer.effectAllowed = "move"; }
        });
        handle.addEventListener("dragend", () => { draggedStation.key = ""; });
        title.append(handle);
      }
      const chip = document.createElement("span");
      chip.className = "tournament-board__station-chip";
      const icon = document.createElement("img");
      icon.src = station.switchType === "ns2" ? "/styles/mk8dx_ns2.png" : "/styles/mk8dx_ns1.png";
      icon.alt = station.switchType.toUpperCase();
      const chipLabel = document.createElement("span");
      chipLabel.textContent = `${station.ownerDisplayName} (${station.switchType.toUpperCase()})`;
      chip.append(icon, chipLabel);
      title.append(chip);
      if (station.utpCableNumber !== undefined) {
        const utp = document.createElement("span");
        utp.className = "tournament-board__utp";
        utp.title = localized("UTP cable number for this tournament", "UTP-kabelnummer voor dit toernooi");
        utp.textContent = `UTP ${station.utpCableNumber}`;
        title.append(utp);
      }
      if (editable && inGroupId !== null) {
        const park = document.createElement("button");
        park.type = "button";
        park.className = "tournament-board__park";
        park.title = localized("Move Nintendo Switch to parking", "Nintendo Switch naar parking");
        park.textContent = localized("Park", "Parkeer");
        park.addEventListener("click", () => {
          applyMutation(tournamentParkStationMutation(board, station.key), localized("Parking Nintendo Switch", "Nintendo Switch parkeren"));
        });
        title.append(park);
      }
      if (editable) {
        // The source's ✕: the console leaves the Tournament, and its owner's
        // profile no longer says they bring it. Seated Players go to parking.
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "tournament-board__remove";
        remove.title = localized("Remove Nintendo Switch", "Nintendo Switch verwijderen");
        remove.setAttribute("aria-label", localized(
          `Remove ${station.ownerDisplayName}'s ${station.switchType.toUpperCase()} from the tournament`,
          `${station.switchType.toUpperCase()} van ${station.ownerDisplayName} uit het toernooi verwijderen`,
        ));
        remove.textContent = "✕";
        remove.addEventListener("click", () => {
          const label = station.switchType === "ns2" ? "Nintendo Switch 2" : "Nintendo Switch 1";
          if (!confirm(localized(
            `Are you sure you want to remove ${label} from the tournament?`,
            `Weet je zeker dat je ${label} wilt verwijderen uit het toernooi?`,
          ))) { return; }
          if (!confirm(localized(
            `${label} is registered to ${station.ownerDisplayName}. It is removed from their profile as well. Continue?`,
            `${label} staat op naam van ${station.ownerDisplayName}. Deze wordt ook uit diens profiel gehaald. Doorgaan?`,
          ))) { return; }
          const parked = inGroupId === null ? null : tournamentParkStationMutation(board, station.key);
          if (parked !== null && parked.kind === "denied") { say(parked.message); return; }
          void run(localized(`Removing ${label}`, `${label} verwijderen`), async () => {
            let revision = document_.summary.revision;
            if (parked !== null && parked.kind === "apply") {
              if (parked.membershipChange) {
                const next = await client.updateGroups(document_.summary.tournamentId, {
                  expectedRevision: revision, stage, groups: parked.members,
                }, controller.signal);
                revision = next.summary.revision;
              }
              const next = await client.importGroupLayout(document_.summary.tournamentId, {
                expectedRevision: revision, stage, groups: parked.layout,
              }, controller.signal);
              revision = next.summary.revision;
            }
            return client.setParticipant(document_.summary.tournamentId, {
              expectedRevision: revision,
              playerId: station.ownerPlayerId,
              ...(station.switchType === "ns2" ? { hasSwitch2: false } : { hasSwitch1: false }),
            }, controller.signal);
          });
        });
        title.append(remove);
      }
      card.append(title);
      if (inGroupId === null) {
        const note = document.createElement("p");
        note.className = "tournament-op__hint";
        note.textContent = localized("In Nintendo Switch parking", "In Nintendo Switch-parking");
        card.append(note);
        return card;
      }
      const tone = tournamentSeatTone(groupIndex, slotIndex);
      for (const seatNumber of [1, 2] as const) {
        const seat = document.createElement("div");
        seat.className = `tournament-board__seat tournament-board__seat--${tone.tone}`;
        seat.style.setProperty("--seat-tone-bg", tone.hex);
        const occupant = station.seats[seatNumber - 1] ?? null;
        if (occupant === null) {
          if (editable) {
            const add = document.createElement("button");
            add.type = "button";
            add.className = "tournament-board__add tournament-board__add--seat";
            add.setAttribute("aria-label", localized(
              `Add participant to seat ${seatNumber} of ${station.ownerDisplayName} (${station.switchType.toUpperCase()})`,
              `Deelnemer toevoegen op plek ${seatNumber} van ${station.ownerDisplayName} (${station.switchType.toUpperCase()})`,
            ));
            const plus = document.createElement("span");
            plus.className = "tournament-board__add-plus";
            plus.textContent = "+";
            add.append(plus, document.createTextNode(localized("Participant", "Deelnemer")));
            add.addEventListener("click", () => {
              addSheet = { kind: "seat", groupId: inGroupId, stationKey: station.key, seatNumber, tab: board.parkedPlayers.length > 0 ? "parking" : "known" };
              selectedBoardPlayer = null;
              renderDocument();
            });
            seat.append(add);
          } else {
            const empty = document.createElement("span");
            empty.className = "tournament-board__seat-hint";
            empty.textContent = localized("Empty seat", "Lege plek");
            seat.append(empty);
          }
        } else {
          seat.append(playerCard(occupant.playerId, occupant.displayName, true));
        }
        playerDropTarget(seat, () => tournamentSeatPlayerMutation(
          board, draggedPlayer.id, draggedPlayer.name, inGroupId, station.key, seatNumber,
        ), localized("Placing participant", "Deelnemer plaatsen"));
        card.append(seat);
      }
      return card;
    };

    // Android only renders parking categories that contain something. Keeping
    // them as separate panels also leaves their controls immediately visible.
    if (board.parkedStations.length > 0 || board.parkedPlayers.length > 0) {
      const parkingPanels = document.createElement("div");
      parkingPanels.className = "tournament-board__parking-panels";
      if (board.parkedStations.length > 0) {
        const stationZone = document.createElement("section");
        stationZone.className = "tournament-board__parking-zone";
        const stationZoneTitle = document.createElement("h4");
        stationZoneTitle.textContent = localized(
          `Parked Nintendo Switches (${board.parkedStations.length})`,
          `Geparkeerde Nintendo Switches (${board.parkedStations.length})`,
        );
        const stationZoneHint = document.createElement("p");
        stationZoneHint.className = "tournament-op__hint";
        stationZoneHint.textContent = localized(
          "Use the drag handle to move a Nintendo Switch to an empty group slot.",
          "Sleep een Nintendo Switch via de sleepknop naar een lege plek in een groep.",
        );
        stationZone.append(stationZoneTitle, stationZoneHint);
        for (const parked of board.parkedStations) {
          stationZone.append(stationCard({ ...parked, seats: [null, null] }, 0, 0, null));
        }
        parkingPanels.append(stationZone);
      }
      if (board.parkedPlayers.length > 0) {
        const playerZone = document.createElement("section");
        playerZone.className = "tournament-board__parking-zone";
        const playerZoneTitle = document.createElement("h4");
        playerZoneTitle.textContent = localized(
          `Parked participants (${board.parkedPlayers.length})`,
          `Geparkeerde deelnemers (${board.parkedPlayers.length})`,
        );
        const playerZoneHint = document.createElement("p");
        playerZoneHint.className = "tournament-op__hint";
        playerZoneHint.textContent = localized(
          "Drag participants to seats, the parking area, or a group header.",
          "Sleep deelnemers naar zitplaatsen, parkeerzone of de groepskop.",
        );
        playerZone.append(playerZoneTitle, playerZoneHint);
        const playerZoneList = document.createElement("div");
        playerZoneList.className = "tournament-board__parking-players";
        for (const parked of board.parkedPlayers) {
          playerZoneList.append(playerCard(parked.playerId, parked.displayName, false));
        }
        playerZone.append(playerZoneList);
        playerDropTarget(
          playerZone,
          () => tournamentParkPlayerMutation(board, draggedPlayer.id),
          localized("Parking participant", "Deelnemer parkeren"),
        );
        parkingPanels.append(playerZone);
      }
      content.append(parkingPanels);
    }

    const stageHead = document.createElement("div");
    stageHead.className = "tournament-board__stage-head";
    const sectionTitle = document.createElement("h4");
    sectionTitle.className = "tournament-board__section-title";
    sectionTitle.textContent = stage === "qualifier"
      ? localized("Qualifier Groups layout", "Kwalificatie Groepen indeling")
      : localized("Final Groups layout", "Eindgroepen indeling");
    const stageSwitches = board.groups.reduce(
      (count, group) => count + group.slots.filter((slot) => slot !== null).length,
      board.parkedStations.length,
    );
    const stageParticipants = board.groups.reduce(
      (count, group) => count + group.memberIds.length,
      board.parkedPlayers.length,
    );
    const stageTotal = document.createElement("p");
    stageTotal.className = "tournament-board__stage-total";
    stageTotal.textContent = localized(
      `${stageSwitches} Switches & ${stageParticipants} participants`,
      `${stageSwitches} Switches & ${stageParticipants} deelnemers`,
    );
    stageHead.append(sectionTitle, stageTotal);
    content.append(stageHead);

    // Android puts the folded interchange row before the group cards.
    if (editable) { renderLayoutCsv(document_, stage); }

    const boardGrid = document.createElement("div");
    boardGrid.className = "tournament-board";
    boardGrid.style.setProperty("--group-cols", String(Math.max(1, board.groups.length)));
    const stageTierTotals = new Map<string, number>();
    for (const group of board.groups) {
      for (const memberId of group.memberIds) {
        const tier = tournamentTierForPlayer(participantsById.get(memberId) ?? {});
        stageTierTotals.set(tier.key, (stageTierTotals.get(tier.key) ?? 0) + 1);
      }
    }
    const tierSymbol = (key: string): string => ({
      champion: "★︎", talent: "♦︎", wild: "♠︎", adventure: "♣︎",
      feest: "♥︎", new: "★︎", unknown: "●︎",
    }[key] ?? "●︎");
    for (const group of board.groups) {
      const column = document.createElement("article");
      column.className = "tournament-board__group";
      const gradient = tournamentGroupGradient(group.index);
      column.style.setProperty("--group-border-start", gradient.start);
      column.style.setProperty("--group-border-end", gradient.end);
      const header = document.createElement("header");
      header.className = "tournament-board__group-header";
      const titleRow = document.createElement("div");
      titleRow.className = "tournament-board__group-title";
      const groupIdentity = document.createElement("div");
      groupIdentity.className = "tournament-board__group-identity";
      const groupDot = document.createElement("span");
      groupDot.className = "tournament-board__group-dot";
      groupDot.style.backgroundColor = gradient.start;
      groupDot.setAttribute("aria-hidden", "true");
      const name = document.createElement("h3");
      name.textContent = displayGroupLabel(group);
      groupIdentity.append(groupDot, name);
      const domainGroup = stageGroups.find((candidate) => candidate.groupId === group.groupId)!;
      const stats = tournamentGroupBoardStats(domainGroup, document_.participants);
      const countBadge = document.createElement("span");
      countBadge.className = "tournament-board__badge";
      countBadge.textContent = localized(
        `${stats.switchesAssigned}/${TOURNAMENT_BOARD_GROUP_SLOTS} Switch ${"\u00b7"} ${stats.seatedCount}/${stats.seatCapacity} seats`,
        `${stats.switchesAssigned}/${TOURNAMENT_BOARD_GROUP_SLOTS} Switch ${"\u00b7"} ${stats.seatedCount}/${stats.seatCapacity} plek`,
      );
      titleRow.append(groupIdentity, countBadge);
      header.append(titleRow);
      const legend = document.createElement("div");
      legend.className = "tournament-board__legend";
      const tierCounts = new Map<string, { name: string; count: number }>();
      for (const memberId of group.memberIds) {
        const tier = tournamentTierForPlayer(participantsById.get(memberId) ?? {});
        const entry = tierCounts.get(tier.key) ?? { name: tournamentTierLabel(tier), count: 0 };
        entry.count += 1;
        tierCounts.set(tier.key, entry);
      }
      if (tierCounts.size === 0) {
        const none = document.createElement("span");
        none.className = "tournament-board__legend-pill tournament-board__legend-pill--inactive";
        none.textContent = localized("No labels", "Geen labels");
        legend.append(none);
      } else {
        for (const [key, entry] of tierCounts) {
          const pill = document.createElement("span");
          pill.className = `tournament-board__legend-pill tournament-board__legend-pill--${key}`;
          pill.title = localized(`${entry.name} in this group`, `${entry.name} in deze groep`);
          pill.textContent = `${tierSymbol(key)} ${entry.name} ${entry.count}/${stageTierTotals.get(key) ?? entry.count}`;
          legend.append(pill);
        }
      }
      header.append(legend);
      if (stats.unseatedCount > 0) {
        const unplaced = document.createElement("p");
        unplaced.className = "tournament-op__hint tournament-op__gate-reason";
        unplaced.textContent = localized(
          `Not yet seated: ${stats.unseatedCount}`,
          `Nog niet geplaatst: ${stats.unseatedCount}`,
        );
        header.append(unplaced);
      }
      const skillLine = document.createElement("p");
      skillLine.className = "tournament-op__hint";
      skillLine.textContent = localized(
        `Avg. SP: ${tournamentSkillScoreLabel(stats.averageSkill)} ${"\u00b7"} Spread: +${tournamentSkillScoreLabel(stats.spreadPlus)} / -${tournamentSkillScoreLabel(stats.spreadMinus)}`,
        `Gem. SP: ${tournamentSkillScoreLabel(stats.averageSkill)} ${"\u00b7"} Spreiding: +${tournamentSkillScoreLabel(stats.spreadPlus)} / -${tournamentSkillScoreLabel(stats.spreadMinus)}`,
      );
      header.append(skillLine);
      playerDropTarget(header, () => tournamentSeatPlayerInGroupMutation(
        board, draggedPlayer.id, draggedPlayer.name, group.groupId,
      ), localized("Placing participant", "Deelnemer plaatsen"));
      stationDropTarget(header, () => tournamentMoveStationMutation(
        board, draggedStation.key, group.groupId, null,
      ), localized("Moving Nintendo Switch", "Nintendo Switch verplaatsen"));
      column.append(header);

      const slots = document.createElement("div");
      slots.className = "tournament-board__slots";
      for (const [slotIndex, slot] of group.slots.entries()) {
        const slotElement = document.createElement("div");
        slotElement.className = `tournament-board__slot${slot === null ? " tournament-board__slot--empty" : ""}`;
        if (slot === null) {
          if (editable) {
            const add = document.createElement("button");
            add.type = "button";
            add.className = "tournament-board__add tournament-board__add--slot";
            add.setAttribute("aria-label", localized(
              `Add a Nintendo Switch to ${group.name}, slot ${slotIndex + 1}`,
              `Nintendo Switch toevoegen aan ${group.name}, plek ${slotIndex + 1}`,
            ));
            const plus = document.createElement("span");
            plus.className = "tournament-board__add-plus";
            plus.textContent = "+";
            add.append(plus, document.createTextNode(localized("Add Switch", "Switch toevoegen")));
            add.addEventListener("click", () => {
              addSheet = { kind: "station", groupId: group.groupId, slotIndex, tab: board.parkedStations.length > 0 ? "parking" : "new" };
              selectedBoardPlayer = null;
              renderDocument();
            });
            slotElement.append(add);
          } else {
            const empty = document.createElement("span");
            empty.textContent = localized("Empty slot", "Lege plek");
            slotElement.append(empty);
          }
        } else {
          slotElement.append(stationCard(slot, group.index, slotIndex, group.groupId));
        }
        stationDropTarget(slotElement, () => tournamentMoveStationMutation(
          board, draggedStation.key, group.groupId, slotIndex,
        ), localized("Moving Nintendo Switch", "Nintendo Switch verplaatsen"));
        slots.append(slotElement);
      }
      column.append(slots);
      if (group.unseated.length > 0) {
        const unseatedRow = document.createElement("div");
        unseatedRow.className = "tournament-board__unseated";
        const label = document.createElement("strong");
        label.textContent = localized(
          `Not yet seated ${"\u00b7"} ${group.unseated.length}`,
          `Nog niet geplaatst ${"\u00b7"} ${group.unseated.length}`,
        );
        unseatedRow.append(label);
        for (const entry of group.unseated) {
          unseatedRow.append(playerCard(entry.playerId, entry.displayName, false));
        }
        column.append(unseatedRow);
      }
      boardGrid.append(column);
    }
    content.append(boardGrid);

    // The source phone interaction is a short sheet: choose a group, then a
    // specific seat.  It is intentionally not a generic group-action list:
    // a full seat means a true swap and an empty one a precise placement.
    if (editable && selectedBoardPlayer !== null) {
      const selected = selectedBoardPlayer;
      const stillKnown = document_.participants.some((participant) =>
        participant.playerId === selected.playerId && participant.attendance === "present");
      if (stillKnown) {
        const sheet = document.createElement("section");
        sheet.className = "tournament-move-sheet";
        sheet.setAttribute("role", "dialog");
        sheet.setAttribute("aria-modal", "true");
        const inGroupId = board.groups.find((group) => group.memberIds.includes(selected.playerId))?.groupId ?? null;
        const title = document.createElement("h3");
        title.textContent = selectedMoveTargetGroupId === null
          ? localized(`Move ${selected.displayName}`, `Verplaats ${selected.displayName}`)
          : localized(
            `Choose a seat in ${board.groups.find((group) => group.groupId === selectedMoveTargetGroupId)?.name ?? "group"}`,
            `Kies plek in ${board.groups.find((group) => group.groupId === selectedMoveTargetGroupId)?.name ?? "groep"}`,
          );
        sheet.append(title);
        const intro = document.createElement("p");
        intro.textContent = selectedMoveTargetGroupId === null
          ? localized(
            "Choose a group, then choose the exact seat: an occupied seat swaps and an empty seat places.",
            "Kies een groep. Daarna kies je de exacte stoel: een volle plek wisselt, een lege plek plaatst.",
          )
          : localized(
            "Choose an empty seat to place or an occupied seat to swap.",
            "Kies een lege plek om te plaatsen of een bezette plek om te wisselen.",
          );
        sheet.append(intro);
        if (selectedMoveTargetGroupId === null) {
          for (const group of board.groups) {
            const free = group.slots.reduce((count, slot) => count + (slot === null ? 0 : slot.seats.filter((seat) => seat === null).length), 0);
            const target = button(document, localized(
              `${group.name} · ${free > 0 ? `${free} free` : "full · swap"}`,
              `${group.name} · ${free > 0 ? `${free} vrij` : "vol · wissel"}`,
            ));
            const crossFinal = stage === "final" && group.groupId !== inGroupId;
            if (crossFinal && options.administrator !== true) {
              target.disabled = true;
              target.title = localized(
                "Only an administrator can swap between final groups.",
                "Alleen een administrator kan tussen eindgroepen wisselen.",
              );
            }
            target.addEventListener("click", () => {
              selectedMoveTargetGroupId = group.groupId;
              renderDocument();
            });
            sheet.append(target);
          }
          if (inGroupId !== null) {
            const park = button(document, localized("Park", "Parkeer"));
            park.addEventListener("click", () => {
              applyMutation(
                tournamentParkPlayerMutation(board, selected.playerId),
                localized(`Parking ${selected.displayName}`, `${selected.displayName} parkeren`),
              );
            });
            sheet.append(park);
          }
        } else {
          const targetGroup = board.groups.find((group) => group.groupId === selectedMoveTargetGroupId);
          if (targetGroup !== undefined) {
            for (const slot of targetGroup.slots) {
              if (slot === null) { continue; }
              const station = document.createElement("p");
              station.className = "tournament-move-sheet__station";
              station.textContent = `${slot.ownerDisplayName} (${slot.switchType.toUpperCase()})`;
              sheet.append(station);
              for (const seatNumber of [1, 2] as const) {
                const occupant = slot.seats[seatNumber - 1] ?? null;
                const exactSeat = button(document, occupant === null
                  ? localized("Empty seat · place", "Lege plek · plaats")
                  : localized(`${occupant.displayName} · swap`, `${occupant.displayName} · wissel`));
                const crossFinal = stage === "final" && targetGroup.groupId !== inGroupId;
                const allowed = occupant?.playerId !== selected.playerId && (!crossFinal || (options.administrator === true && occupant !== null));
                exactSeat.disabled = !allowed;
                exactSeat.addEventListener("click", () => {
                  applyMutation(tournamentSeatPlayerMutation(
                    board, selected.playerId, selected.displayName, targetGroup.groupId, slot.key, seatNumber,
                  ), occupant === null
                    ? localized(`Placing ${selected.displayName}`, `${selected.displayName} plaatsen`)
                    : localized(
                      `Swapping ${selected.displayName} with ${occupant.displayName}`,
                      `${selected.displayName} wisselen met ${occupant.displayName}`,
                    ));
                });
                sheet.append(exactSeat);
              }
            }
          }
          const back = button(document, localized("← Groups", "← Groepen"));
          back.addEventListener("click", () => { selectedMoveTargetGroupId = null; renderDocument(); });
          sheet.append(back);
        }
        const cancel = button(document, localized("Cancel", "Annuleren"));
        cancel.addEventListener("click", () => {
          selectedBoardPlayer = null;
          selectedMoveTargetGroupId = null;
          renderDocument();
        });
        sheet.append(cancel);
        content.append(sheet);
      }
    }

    if (editable && addSheet !== null) { renderAddSheet(document_, stage, board, addSheet, applyMutation); }

    const parked = tournamentParkingPlayers(document_, stage);
    const presentCount = document_.participants.filter((participant) => participant.attendance === "present").length;
    const footer = document.createElement("section");
    footer.className = "tournament-op__checkpoint";
    const status = document.createElement("p");
    status.className = parked.length === 0
      ? "tournament-board__status tournament-board__status--ready"
      : "tournament-board__status tournament-board__status--warning";
    status.textContent = parked.length === 0
      ? localized(
        `All ${presentCount} participants are placed - ready to continue.`,
        `Alle ${presentCount} deelnemers ingedeeld - klaar om door te gaan.`,
      )
      : localized(
        `${parked.length} participants are not yet placed. Review the groups before continuing.`,
        `Nog ${parked.length} deelnemers niet ingedeeld. Controleer de groepen voordat je doorgaat.`,
      );
    const confirmLabel = locked
      ? (stage === "final"
        ? localized("Reopen layout (Step 7)", "Indeling heropenen (Stap 7)")
        : localized("Reopen layout", "Indeling heropenen"))
      : (stage === "final"
        ? localized("Confirm layout and go to Step 8", "Indeling bevestigen en ga naar Stap 8")
        : localized("Confirm layout and continue", "Indeling bevestigen en doorgaan"));
    const confirmAction = button(document, confirmLabel, !locked);
    confirmAction.disabled = !locked && parked.length > 0;
    if (confirmAction.disabled) {
      confirmAction.title = localized(
        `You cannot confirm yet: ${parked.length} participant(s) are still outside the groups.`,
        `Je kunt nog niet bevestigen: er staan nog ${parked.length} deelnemer(s) buiten de groepen.`,
      );
    }
    confirmAction.addEventListener("click", () => {
      if (locked && !confirm(localized(
        "Reopen the layout? This can affect later stages and exports.",
        "Indeling heropenen? Dit kan invloed hebben op volgende fases en exports.",
      ))) { return; }
      if (!locked && !confirm(localized(
        "Lock the layout and continue to the next step?",
        "Indeling vergrendelen en doorgaan naar de volgende stap?",
      ))) { return; }
      void run(locked
        ? localized("Reopening layout", "Indeling heropenen")
        : localized("Confirming layout", "Indeling bevestigen"), () => client.lockGroups(
        document_.summary.tournamentId,
        { expectedRevision: document_.summary.revision, stage, locked: !locked },
        controller.signal,
      ));
    });
    footer.append(status, confirmAction);
    renderAdminActions(document_, stage);
    content.append(footer);
  };

  /**
   * "Toevoegen": the sheet an empty seat or an empty Switch slot opens. A
   * seat takes a parked Player, a known Player who is not present tonight
   * (they become present, with the Switches they bring) or a new Player; a
   * slot takes a parked Switch or a new one on a present Player's name.
   * "naar parkeerzone" does the same without the placement.
   */
  const renderAddSheet = (
    document_: TournamentDocument,
    stage: TournamentGroupStage,
    board: ReturnType<typeof tournamentBoardModel>,
    sheet: NonNullable<typeof addSheet>,
    applyMutation: (mutation: TournamentBoardMutation, label: string) => void,
  ): void => {
    const group = board.groups.find((candidate) => candidate.groupId === sheet.groupId);
    if (group === undefined) { addSheet = null; return; }
    const panel = document.createElement("section");
    panel.className = "tournament-add-sheet";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-label", localized("Add", "Toevoegen"));
    const close = (): void => { addSheet = null; renderDocument(); };

    const head = document.createElement("header");
    head.className = "tournament-add-sheet__head";
    const plus = document.createElement("span");
    plus.className = "tournament-add-sheet__plus";
    plus.textContent = "+";
    const title = document.createElement("h3");
    title.textContent = localized("Add", "Toevoegen");
    const kind = document.createElement("span");
    kind.className = "tournament-add-sheet__kind";
    kind.textContent = sheet.kind === "seat" ? localized("participant", "deelnemer") : "Nintendo Switch";
    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "tournament-add-sheet__close";
    closeButton.textContent = localized("Close ✕", "Sluiten ✕");
    closeButton.addEventListener("click", close);
    head.append(plus, title, kind, closeButton);
    panel.append(head);

    const body = document.createElement("div");
    body.className = "tournament-add-sheet__body";
    const target = document.createElement("div");
    target.className = "tournament-add-sheet__target";
    const arrow = document.createElement("span");
    arrow.textContent = "→";
    const groupPill = document.createElement("span");
    groupPill.className = "tournament-add-sheet__group";
    groupPill.textContent = group.name;
    const place = document.createElement("span");
    place.className = "tournament-add-sheet__place";
    place.textContent = sheet.kind === "seat"
      ? localized(`seat ${sheet.seatNumber}`, `plek ${sheet.seatNumber}`)
      : localized("Nintendo Switch slot", "Nintendo Switch-plek");
    target.append(arrow, groupPill, place);
    const toParking = document.createElement("button");
    toParking.type = "button";
    toParking.className = "tournament-add-sheet__to-parking";
    toParking.textContent = localized("to parking", "naar parkeerzone");
    target.append(toParking);
    body.append(target);

    const tabs = document.createElement("div");
    tabs.className = "tournament-add-sheet__tabs";
    const tab = (key: string, label: string, icon: string, active: boolean, onPick: () => void): HTMLButtonElement => {
      const element = document.createElement("button");
      element.type = "button";
      element.className = "tournament-add-sheet__tab";
      element.dataset.tab = key;
      element.setAttribute("aria-pressed", active ? "true" : "false");
      const glyph = document.createElement("span");
      glyph.className = "tournament-add-sheet__tab-icon";
      glyph.textContent = icon;
      element.append(glyph, document.createTextNode(label));
      element.addEventListener("click", onPick);
      return element;
    };
    body.append(tabs);
    const form = document.createElement("div");
    form.className = "tournament-add-sheet__form";
    body.append(form);
    const label = (text: string): HTMLElement => {
      const element = document.createElement("span");
      element.className = "tournament-add-sheet__label";
      element.textContent = text;
      return element;
    };
    const select = (): HTMLSelectElement => {
      const element = document.createElement("select");
      element.className = "tournament-add-sheet__select";
      return element;
    };
    const primary = (text: string): HTMLButtonElement => {
      const element = document.createElement("button");
      element.type = "button";
      element.className = "tournament-add-sheet__primary";
      element.textContent = text;
      return element;
    };
    const switchBox = (): Readonly<{ box: HTMLElement; ns1: HTMLInputElement; ns2: HTMLInputElement }> => {
      const box = document.createElement("div");
      box.className = "tournament-add-sheet__switches";
      box.append(label(localized("Nintendo Switch available", "Nintendo Switch beschikbaar")));
      const make = (text: string): HTMLInputElement => {
        const row = document.createElement("label");
        row.className = "tournament-add-sheet__check";
        const input = document.createElement("input");
        input.type = "checkbox";
        row.append(input, document.createTextNode(text));
        box.append(row);
        return input;
      };
      return { box, ns1: make(localized("Has NS1", "Heeft NS1")), ns2: make(localized("Has NS2", "Heeft NS2")) };
    };
    // Every action ends in the same two steps: make the Player present (or
    // the Switch known), reload, then seat what was asked for.
    const seatAfter = async (
      playerId: string, displayName: string, next: TournamentDocument, park: boolean,
    ): Promise<TournamentDocument> => {
      if (park || sheet.kind !== "seat") { return next; }
      const fresh = tournamentBoardModel(next, stage);
      const mutation = tournamentSeatPlayerMutation(fresh, playerId, displayName, sheet.groupId, sheet.stationKey, sheet.seatNumber);
      if (mutation.kind === "denied") { say(mutation.message); return next; }
      let revision = next.summary.revision;
      if (mutation.membershipChange) {
        const updated = await client.updateGroups(next.summary.tournamentId, { expectedRevision: revision, stage, groups: mutation.members }, controller.signal);
        revision = updated.summary.revision;
      }
      return client.importGroupLayout(next.summary.tournamentId, { expectedRevision: revision, stage, groups: mutation.layout }, controller.signal);
    };
    const finish = (): void => { addSheet = null; selectedBoardPlayer = null; };

    if (sheet.kind === "seat") {
      const seatSheet = sheet;
      const setTab = (next: "parking" | "known" | "new"): void => { addSheet = { ...seatSheet, tab: next }; renderDocument(); };
      tabs.append(
        tab("parking", localized(`Parking (${board.parkedPlayers.length})`, `Parkeerzone (${board.parkedPlayers.length})`), "P", seatSheet.tab === "parking", () => setTab("parking")),
        tab("known", localized("Known Player", "Bekende speler"), "👤", seatSheet.tab === "known", () => setTab("known")),
        tab("new", localized("New Player", "Nieuwe speler"), "+", seatSheet.tab === "new", () => setTab("new")),
      );
      if (seatSheet.tab === "parking") {
        form.append(label(localized("Participant from parking", "Deelnemer uit parkeerzone")));
        const pick = select();
        for (const parked of board.parkedPlayers) {
          const option = document.createElement("option");
          option.value = parked.playerId;
          option.textContent = parked.displayName;
          pick.append(option);
        }
        pick.disabled = board.parkedPlayers.length === 0;
        form.append(pick);
        const go = primary(localized("Place on this seat", "Plaats op deze plek"));
        go.disabled = board.parkedPlayers.length === 0;
        const chosen = (): Readonly<{ playerId: string; displayName: string }> | null =>
          board.parkedPlayers.find((parked) => parked.playerId === pick.value) ?? null;
        go.addEventListener("click", () => {
          const player = chosen();
          if (player === null) { return; }
          finish();
          applyMutation(tournamentSeatPlayerMutation(board, player.playerId, player.displayName, seatSheet.groupId, seatSheet.stationKey, seatSheet.seatNumber),
            localized(`Placing ${player.displayName}`, `${player.displayName} plaatsen`));
        });
        toParking.disabled = true;
        form.append(go);
      } else if (seatSheet.tab === "known") {
        // The source: "Bekende speler (niet actief in dit toernooi)" - on the
        // roster, not present tonight.
        const known = document_.participants
          .filter((participant) => participant.attendance !== "present")
          .sort((left, right) => left.displayName.localeCompare(right.displayName, "nl"));
        form.append(label(localized("Known Player (not active in this tournament)", "Bekende speler (niet actief in dit toernooi)")));
        const pick = select();
        for (const participant of known) {
          const option = document.createElement("option");
          option.value = participant.playerId;
          const state = participant.attendance === "waiting" ? localized("Waiting list", "Wachtlijst") : localized("Absent", "Afwezig");
          option.textContent = `${participant.displayName} (${state}${(participant.inactive ?? false) ? ` · ${localized("Inactive", "Inactief")}` : ""})`;
          pick.append(option);
        }
        pick.disabled = known.length === 0;
        form.append(pick);
        const switches = switchBox();
        const syncSwitches = (): void => {
          const participant = known.find((candidate) => candidate.playerId === pick.value);
          switches.ns1.checked = participant?.hasSwitch1 ?? false;
          switches.ns2.checked = participant?.hasSwitch2 ?? false;
        };
        pick.addEventListener("change", syncSwitches);
        syncSwitches();
        form.append(switches.box);
        const go = primary(localized("Place on this seat", "Plaats op deze plek"));
        go.disabled = known.length === 0;
        const act = (park: boolean): void => {
          const participant = known.find((candidate) => candidate.playerId === pick.value);
          if (participant === undefined) { return; }
          finish();
          void run(localized(`Adding ${participant.displayName}`, `${participant.displayName} toevoegen`), async () => {
            const next = await client.setParticipant(document_.summary.tournamentId, {
              expectedRevision: document_.summary.revision, playerId: participant.playerId,
              attendance: "present", hasSwitch1: switches.ns1.checked, hasSwitch2: switches.ns2.checked,
            }, controller.signal);
            return seatAfter(participant.playerId, participant.displayName, next, park);
          });
        };
        go.addEventListener("click", () => act(false));
        toParking.disabled = known.length === 0;
        toParking.addEventListener("click", () => act(true));
        form.append(go);
      } else if (!directorCreationAllowed) {
        // ADR-0221: only self sign-up creates Players here.
        const closed = document.createElement("p");
        closed.className = "tournament-add-sheet__hint";
        closed.textContent = rosterCreationClosedText();
        form.append(closed);
      } else {
        form.append(label(localized("New Player", "Nieuwe speler")));
        const name = document.createElement("input");
        name.type = "text";
        name.className = "tournament-add-sheet__input";
        name.placeholder = localized("e.g. New Player", "Bijv. Nieuwe Deelnemer");
        name.setAttribute("aria-label", localized("New Player name", "Naam nieuwe speler"));
        form.append(name);
        const hint = document.createElement("p");
        hint.className = "tournament-add-sheet__hint";
        hint.textContent = localized(
          "A new Player is created on the roster and stays claimable.",
          "Een nieuwe speler wordt aangemaakt op de spelerslijst en blijft claimbaar.",
        );
        form.append(hint);
        const switches = switchBox();
        form.append(switches.box);
        const go = primary(localized("Place on this seat", "Plaats op deze plek"));
        const choices = document.createElement("div");
        choices.className = "tournament-add-sheet__choices";
        // ADR-0218: a typed name that Players already carry shows them, with
        // context, before anything is created; the Director picks one of
        // them or creates someone new.
        const seatExisting = (candidate: Readonly<{ playerId: string; displayName: string }>, park: boolean): void => {
          finish();
          void run(localized(`Adding ${candidate.displayName}`, `${candidate.displayName} toevoegen`), async () => {
            const next = await client.setParticipant(document_.summary.tournamentId, {
              expectedRevision: document_.summary.revision, playerId: candidate.playerId,
              attendance: "present", hasSwitch1: switches.ns1.checked, hasSwitch2: switches.ns2.checked,
            }, controller.signal);
            return seatAfter(candidate.playerId, candidate.displayName, next, park);
          });
        };
        const act = (park: boolean): void => {
          const displayName = name.value.trim();
          if (displayName.length < 2) { say(localized("Enter a name of at least two characters.", "Vul een naam van minstens twee tekens in.")); return; }
          clear(choices);
          void client.rosterCandidates({ names: [displayName], tournamentId: document_.summary.tournamentId }, controller.signal)
            .then((entries) => {
              const entry = entries[0];
              if (entry === undefined || entry.candidates.length === 0) { createAndSeat(displayName, park, false); return; }
              choices.append(rosterChoiceList(document, entry, {
                blockOnNight: true,
                pickLabel: (candidate) => localized(`Seat ${candidate.displayName}`, `${candidate.displayName} plaatsen`),
                onPick: (candidate) => seatExisting(candidate, park),
                onCreate: (confirmSameName) => createAndSeat(displayName, park, confirmSameName),
                creationClosed: !directorCreationAllowed,
              }));
            })
            .catch(() => say(localized(
              "The Players with this name could not be looked up. Try again.",
              "De spelers met deze naam konden niet worden opgezocht. Probeer het opnieuw.",
            )));
        };
        const createAndSeat = (displayName: string, park: boolean, confirmSameName: boolean): void => {
          finish();
          void run(localized(`Creating ${displayName}`, `${displayName} aanmaken`), async () => {
            try {
              const created = await client.createRosterPlayers(
                [{ row: 1, displayName, ...(confirmSameName ? { confirmSameName: true } : {}) }],
                controller.signal, { tournamentId: document_.summary.tournamentId },
              );
              const player = created[0];
              if (player === undefined) { return undefined; }
              const loaded = await client.load(document_.summary.tournamentId, controller.signal);
              const next = await client.setParticipant(loaded.summary.tournamentId, {
                expectedRevision: loaded.summary.revision, playerId: player.playerId,
                attendance: "present", hasSwitch1: switches.ns1.checked, hasSwitch2: switches.ns2.checked,
              }, controller.signal);
              return await seatAfter(player.playerId, player.displayName, next, park);
            } catch (error) {
              if (error instanceof TournamentRosterRejectionError) {
                say(tournamentRosterRejectionMessage(error.rejections));
                return undefined;
              }
              throw error;
            }
          });
        };
        go.addEventListener("click", () => act(false));
        toParking.addEventListener("click", () => act(true));
        form.append(go, choices);
      }
    } else {
      const slotSheet = sheet;
      const setTab = (next: "parking" | "new"): void => { addSheet = { ...slotSheet, tab: next }; renderDocument(); };
      tabs.append(
        tab("parking", localized(`From parking (${board.parkedStations.length})`, `Uit parkeerzone (${board.parkedStations.length})`), "P", slotSheet.tab === "parking", () => setTab("parking")),
        tab("new", localized("New Switch", "Nieuwe Switch"), "🎮", slotSheet.tab === "new", () => setTab("new")),
      );
      if (slotSheet.tab === "parking") {
        form.append(label(localized("Switch from parking", "Switch uit parkeerzone")));
        const pick = select();
        for (const station of board.parkedStations) {
          const option = document.createElement("option");
          option.value = station.key;
          option.textContent = `${station.ownerDisplayName} · ${station.switchType.toUpperCase()}`;
          pick.append(option);
        }
        pick.disabled = board.parkedStations.length === 0;
        form.append(pick);
        const go = primary(localized("Place Switch on this slot", "Plaats Switch op deze plek"));
        go.disabled = board.parkedStations.length === 0;
        go.addEventListener("click", () => {
          const key = pick.value;
          if (key === "") { return; }
          finish();
          applyMutation(tournamentMoveStationMutation(board, key, slotSheet.groupId, slotSheet.slotIndex), localized("Placing Nintendo Switch", "Nintendo Switch plaatsen"));
        });
        toParking.disabled = true;
        form.append(go);
      } else {
        // A physical Switch can be lent by somebody who is not playing.
        const owners = [...document_.participants]
          .sort((left, right) => left.displayName.localeCompare(right.displayName, "nl"));
        form.append(label(localized("Switch owner (does not need to play)", "Switch-eigenaar (hoeft niet mee te spelen)")));
        const pick = select();
        for (const participant of owners) {
          const option = document.createElement("option");
          option.value = participant.playerId;
          option.textContent = participant.displayName;
          pick.append(option);
        }
        form.append(pick);
        const typeRow = document.createElement("div");
        typeRow.className = "tournament-add-sheet__switches";
        typeRow.append(label(localized("Which Switch", "Welke Switch")));
        const typePick = document.createElement("select");
        typePick.className = "tournament-add-sheet__select";
        for (const [value, text] of [["ns1", "NS1"], ["ns2", "NS2"]] as const) {
          const option = document.createElement("option");
          option.value = value;
          option.textContent = text;
          typePick.append(option);
        }
        typeRow.append(typePick);
        form.append(typeRow);
        const go = primary(localized("Place Switch on this slot", "Plaats Switch op deze plek"));
        go.disabled = owners.length === 0;
        const act = (park: boolean): void => {
          const owner = owners.find((candidate) => candidate.playerId === pick.value);
          if (owner === undefined) { return; }
          const switchType = typePick.value === "ns2" ? "ns2" : "ns1";
          const warning = tournamentLenderWarning(owner.displayName, owner.attendance, switchType === "ns2" ? "NS2" : "NS1");
          if (warning !== null && !confirm(warning)) { return; }
          finish();
          void run(localized("Adding Nintendo Switch", "Nintendo Switch toevoegen"), async () => {
            const next = await client.setParticipant(document_.summary.tournamentId, {
              expectedRevision: document_.summary.revision, playerId: owner.playerId,
              ...(switchType === "ns2" ? { hasSwitch2: true } : { hasSwitch1: true }),
            }, controller.signal);
            if (park) { return next; }
            const fresh = tournamentBoardModel(next, stage);
            const mutation = tournamentMoveStationMutation(fresh, tournamentStationKey(owner.playerId, switchType), slotSheet.groupId, slotSheet.slotIndex);
            if (mutation.kind === "denied") { say(mutation.message); return next; }
            let revision = next.summary.revision;
            if (mutation.membershipChange) {
              const updated = await client.updateGroups(next.summary.tournamentId, { expectedRevision: revision, stage, groups: mutation.members }, controller.signal);
              revision = updated.summary.revision;
            }
            return client.importGroupLayout(next.summary.tournamentId, { expectedRevision: revision, stage, groups: mutation.layout }, controller.signal);
          });
        };
        go.addEventListener("click", () => act(false));
        toParking.disabled = owners.length === 0;
        toParking.addEventListener("click", () => act(true));
        form.append(go);
      }
    }
    panel.append(body);
    content.append(panel);
  };

  /**
   * The source footer "Admin Acties", carried at the foot of every step:
   * the Step 7 override (two Players swapped between final groups, an
   * administrator's move), the data actions (back a step, remove the
   * Tournament) and the Tournament's own history.
   */
  const renderAdminActions = (document_: TournamentDocument, stage: TournamentGroupStage | null): void => {
    const summary = document_.summary;
    const panel = document.createElement("details");
    panel.className = "tournament-op__admin";
    const head = document.createElement("summary");
    head.textContent = localized("Admin actions", "Admin Acties");
    panel.append(head);
    const body = document.createElement("div");
    body.className = "tournament-op__admin-content";
    const hint = document.createElement("p");
    hint.className = "tournament-op__hint tournament-op__admin-hint";
    hint.textContent = localized(
      "Management actions for tournament days. Unavailable actions always show the reason.",
      "Beheer- en testacties voor toernooidagen. Niet-beschikbare acties tonen altijd de reden.",
    );
    body.append(hint);
    const card = (title: string, badge: string | null): HTMLElement => {
      const section = document.createElement("section");
      section.className = "tournament-op__admin-section";
      const heading = document.createElement("h4");
      heading.textContent = title;
      if (badge !== null) {
        const chip = document.createElement("span");
        chip.className = "tournament-op__admin-badge";
        chip.textContent = badge;
        heading.append(chip);
      }
      section.append(heading);
      body.append(section);
      return section;
    };
    const reason = (parent: HTMLElement, text: string): void => {
      const element = document.createElement("p");
      element.className = "tournament-op__hint tournament-op__admin-reason";
      element.textContent = text;
      parent.append(element);
    };

    // Stap 7 Admin Override.
    if (stage === "final" && summary.stage !== "finalized") {
      const override = card(localized("Step 7 Admin Override", "Stap 7 Admin Override"), localized("Active in Step 7", "Actief in Stap 7"));
      const intro = document.createElement("p");
      intro.className = "tournament-op__hint";
      intro.textContent = localized(
        "Swap two Players between different final groups. Only meant as a manual admin override; it changes nothing about the ordinary drag behaviour.",
        "Wissel twee spelers tussen verschillende eindgroepen. Dit is alleen bedoeld als handmatige admin-override en verandert niets aan het normale sleepgedrag.",
      );
      override.append(intro);
      const board = tournamentBoardModel(document_, "final");
      const seated = board.groups.flatMap((group) => group.slots.flatMap((slot) => slot === null ? [] : slot.seats.flatMap((seat, index) =>
        seat === null ? [] : [{ groupId: group.groupId, groupName: group.name, stationKey: slot.key, seatNumber: (index + 1) as 1 | 2, ...seat }])));
      const pickA = document.createElement("select");
      const pickB = document.createElement("select");
      for (const [pick, text] of [[pickA, localized("Player from final group A", "Speler uit eindgroep A")], [pickB, localized("Player from final group B", "Speler uit eindgroep B")]] as const) {
        const field = document.createElement("label");
        field.className = "tournament-op__admin-field";
        field.append(document.createTextNode(text));
        for (const entry of seated) {
          const option = document.createElement("option");
          option.value = entry.playerId;
          option.textContent = `${entry.displayName} · ${displayGroupLabel({ name: entry.groupName })}`;
          pick.append(option);
        }
        field.append(pick);
        override.append(field);
      }
      const swap = button(document, localized("Swap Players between final groups", "Wissel spelers tussen eindgroepen"));
      const canOverride = options.administrator === true;
      const editable = board.groups.length > 0 && document_.groups.filter((group) => group.stage === "final").every((group) => !group.locked && group.races.length === 0);
      const check = (): string | null => {
        if (!canOverride) { return localized("Only an administrator can swap between final groups.", "Alleen een administrator kan tussen eindgroepen wisselen."); }
        if (!editable) { return localized("This action is only available while the final layout is open.", "Deze actie is alleen beschikbaar zolang de eindgroep-indeling open staat."); }
        if (board.groups.filter((group) => group.memberIds.length > 0).length < 2) { return localized("At least two final groups with Players are needed.", "Minimaal twee eindgroepen met deelnemers nodig."); }
        const a = seated.find((entry) => entry.playerId === pickA.value);
        const b = seated.find((entry) => entry.playerId === pickB.value);
        if (a === undefined || b === undefined) { return localized("Choose two participants.", "Kies twee deelnemers."); }
        if (a.playerId === b.playerId) { return localized("Choose two different participants.", "Kies twee verschillende deelnemers."); }
        if (a.groupId === b.groupId) { return localized("Choose Players from two different final groups.", "Kies spelers uit twee verschillende eindgroepen."); }
        return null;
      };
      const reasonLine = document.createElement("p");
      reasonLine.className = "tournament-op__hint tournament-op__admin-reason";
      const refresh = (): void => {
        const blocked = check();
        swap.disabled = blocked !== null;
        reasonLine.textContent = blocked ?? "";
      };
      pickA.addEventListener("change", refresh);
      pickB.addEventListener("change", refresh);
      refresh();
      swap.addEventListener("click", () => {
        if (check() !== null) { return; }
        const a = seated.find((entry) => entry.playerId === pickA.value)!;
        const b = seated.find((entry) => entry.playerId === pickB.value)!;
        const mutation = tournamentSeatPlayerMutation(board, a.playerId, a.displayName, b.groupId, b.stationKey, b.seatNumber);
        if (mutation.kind === "denied") { say(mutation.message); return; }
        void run(localized(`Swapping ${a.displayName} and ${b.displayName}`, `${a.displayName} en ${b.displayName} wisselen`), async () => {
          let revision = summary.revision;
          if (mutation.membershipChange) {
            const next = await client.updateGroups(summary.tournamentId, { expectedRevision: revision, stage: "final", groups: mutation.members }, controller.signal);
            revision = next.summary.revision;
          }
          return client.importGroupLayout(summary.tournamentId, { expectedRevision: revision, stage: "final", groups: mutation.layout }, controller.signal);
        });
      });
      override.append(swap, reasonLine);
    }

    // Toernooibeheer.
    const manage = card(localized("Tournament management", "Toernooibeheer"), localized("Data actions", "Data-acties"));
    if (summary.stage !== "finalized" && summary.workflowStep > 2) {
      const target = summary.workflowStep - 1;
      const inspectionStage = tournamentLayoutInspectionStage(document_, target);
      const stepBack = button(document, inspectionStage !== null
        ? localized(`Inspect Step ${target} layout`, `Indeling Stap ${target} bekijken`)
        : localized(`Back to Step ${target}`, `Terug naar Stap ${target}`));
      stepBack.addEventListener("click", () => {
        if (inspectionStage !== null) {
          equipmentReviewStage = inspectionStage;
          renderDocument();
          return;
        }
        if (!confirm(tournamentRollbackMessage(target))) { return; }
        void run(localized(`Returning to Step ${target}`, `Terug naar Stap ${target}`), () => target === 3 || target === 7
          ? client.lockGroups(summary.tournamentId, { expectedRevision: summary.revision, stage: target === 3 ? "qualifier" : "final", locked: false }, controller.signal)
          : client.setWorkflowStep(summary.tournamentId, { expectedRevision: summary.revision, targetStep: target, direction: "rollback" }, controller.signal));
      });
      manage.append(stepBack);
      const detachment = tournamentLayoutDetachment(document_, target);
      if (detachment !== null) {
        const detach = button(document, localized(`Back to Step ${target} (detach scores)`, `Terug naar Stap ${target} (scores loskoppelen)`));
        detach.className = "tt-auth__button tournament-op__step-back tournament-op__step-back--detach";
        detach.addEventListener("click", () => {
          if (!confirm(tournamentDetachMessage(target, detachment))) { return; }
          void run(localized(`Returning to Step ${target}`, `Terug naar Stap ${target}`), () => client.setWorkflowStep(summary.tournamentId, { expectedRevision: summary.revision, targetStep: target, direction: "rollback" }, controller.signal));
        });
        manage.append(detach);
        reason(manage, localized(
          `Detaching removes ${detachment.races} accepted race(s) and ${detachment.manualScores} manual score entr${detachment.manualScores === 1 ? "y" : "ies"} from this stage; the layout stays.`,
          `Loskoppelen verwijdert ${detachment.races} geaccepteerde race(s) en ${detachment.manualScores} handmatige score(s) uit deze fase; de indeling blijft staan.`,
        ));
      }
      reason(manage, inspectionStage !== null ? localized("Inspection keeps accepted scores and the current step.", "Bekijken behoudt geaccepteerde scores en de huidige stap.") : localized(
        "Reopens the previous step. Work that depends on this step is reset.",
        "Heropent de vorige stap. Werk dat van deze stap afhangt wordt teruggezet.",
      ));
    }
    const remove = button(document, localized("Remove selected tournament", "Verwijder geselecteerd toernooi"));
    remove.className = "tt-auth__button tournament-op__delete";
    remove.addEventListener("click", () => {
      const why = prompt(localized(
        `Remove "${summary.name}" from active and public history? Ratings are fully recalculated when this Tournament affected TrueSkill. Enter a reason:`,
        `"${summary.name}" uit de actieve en openbare geschiedenis verwijderen? Ratings worden volledig herberekend wanneer dit toernooi TrueSkill beïnvloedde. Voer een reden in:`,
      ));
      if (why === null || why.trim().length < 3) { return; }
      if (!confirm(localized(
        "Confirm removal. Audit evidence is retained; this is not a physical erase.",
        "Bevestig verwijdering. Auditbewijs blijft behouden; dit is geen fysieke vernietiging.",
      ))) { return; }
      void run(localized("Removing tournament and recalculating ratings where needed", "Toernooi verwijderen en ratings waar nodig herberekenen"), async () => {
        await client.removeTournament(summary.tournamentId, { reason: why }, controller.signal);
        current = null;
        navigate("/?tournaments=1&operate=1");
        return undefined;
      });
    });
    manage.append(remove);
    reason(manage, localized(
      "Removal can be undone by an administrator; the audit trail stays.",
      "Verwijderen kan een administrator ongedaan maken; het auditspoor blijft.",
    ));

    // Geschiedenis.
    const history = card(localized("History", "Geschiedenis"), null);
    const list = document.createElement("ul");
    list.className = "tournament-op__admin-history";
    for (const event of document_.lifecycle.slice(0, 12)) {
      const item = document.createElement("li");
      item.textContent = `${new Date(event.occurredAtMs).toLocaleString(productLocaleTag())} · ${event.eventType}${event.detail === undefined ? "" : ` · ${event.detail}`}`;
      list.append(item);
    }
    if (document_.lifecycle.length === 0) { reason(history, localized("Nothing has happened yet.", "Er is nog niets gebeurd.")); }
    history.append(list);

    panel.append(body);
    content.append(panel);
  };


  const renderParticipants = (document_: TournamentDocument): void => {
    const section = document.createElement("section");
    section.className = "tournament-op__panel tournament-op__step-two";
    const title = document.createElement("h2");
    title.textContent = localized("Step 2: Participants and consoles", "Stap 2: Deelnemers en consoles");
    section.append(title);

    const explanation = document.createElement("p");
    explanation.className = "tournament-op__intro";
    explanation.textContent = localized(
      "Follow this step to prepare the participant list. You can only continue once the Create qualifier groups button is green.",
      "Volg deze stap om de deelnemerslijst klaar te zetten. Je kunt pas verder als de knop Maak kwalificatiegroepen groen is.",
    );
    section.append(explanation);

    const stepHelp = document.createElement("details");
    stepHelp.className = "tournament-op__step-help";
    const stepHelpSummary = document.createElement("summary");
    stepHelpSummary.textContent = localized("How does this step work?", "Hoe werkt deze stap?");
    const stepHelpBody = document.createElement("p");
    stepHelpBody.className = "tournament-op__hint";
    stepHelpBody.textContent = localized(
      "Set every Player to Present, Waiting list, or Absent, then mark the Nintendo Switches they bring. The readiness box at the bottom explains anything still missing.",
      "Zet iedere speler op Aanwezig, Wachtlijst of Afwezig en geef daarna aan welke Nintendo Switches zij meenemen. Onderaan staat wat nog ontbreekt.",
    );
    stepHelp.append(stepHelpSummary, stepHelpBody);
    section.append(stepHelp);

    // ADR-0222: open sign-up and its waiting list, above the roster it writes.
    signupBoard?.unmount();
    const signupRoot = document.createElement("div");
    section.append(signupRoot);
    const reloadRoster = (): void => { void run(localized("Reloading the list", "De lijst opnieuw laden"), async () => undefined); };
    signupBoard = (options.mountSignupBoard ?? ((target, id, changed) =>
      mountTournamentSignupBoard(target, id, { onRosterChanged: changed })))(
      signupRoot, document_.summary.tournamentId, reloadRoster,
    );

    const switchLegend = document.createElement("div");
    switchLegend.className = "tournament-op__switch-legend";
    for (const [source, alternative, label] of [
      ["/styles/mk8dx_ns1.png", "NS1", "Nintendo Switch 1"],
      ["/styles/mk8dx_ns2.png", "NS2", "Nintendo Switch 2."],
    ] as const) {
      const item = document.createElement("span");
      item.className = "tournament-op__switch-legend-item";
      const icon = document.createElement("img");
      icon.src = source;
      icon.alt = alternative;
      icon.width = 20;
      icon.height = 20;
      const abbreviation = document.createElement("strong");
      abbreviation.textContent = alternative;
      item.append(icon, abbreviation, document.createTextNode(label));
      switchLegend.append(item);
    }
    section.append(switchLegend);

    const mobileTip = document.createElement("p");
    mobileTip.className = "tournament-op__step-tip";
    mobileTip.textContent = localized(
      "Tip: tap A / W / X for each Player for Present, Waiting list, or Absent. Tournament setup and bulk actions are at the bottom under Settings and the ☰ Admin menu.",
      "Tip: tik per speler op A / W / X voor Aanwezig, Wachtlijst of Afwezig. Toernooi-opzet en bulk-acties staan onderaan bij Instellingen en het ☰ Admin-menu.",
    );
    section.append(mobileTip);

    const rosterImport = document.createElement("details");
    rosterImport.className = "tournament-op__import tournament-op__csv tournament-op__step-two-csv";
    const rosterImportSummary = document.createElement("summary");
    rosterImportSummary.className = "tournament-op__csv-summary";
    const csvIcon = document.createElement("span");
    csvIcon.className = "tournament-op__csv-icon";
    csvIcon.setAttribute("aria-hidden", "true");
    const csvTitle = document.createElement("span");
    csvTitle.textContent = localized("Import / export CSV", "Importeer / exporteer CSV");
    const csvStep = document.createElement("span");
    csvStep.className = "tournament-op__csv-step";
    csvStep.textContent = localized(" (Step 2)", " (Stap 2)");
    rosterImportSummary.append(csvIcon, csvTitle, csvStep);
    const rosterFile = document.createElement("input");
    rosterFile.type = "file";
    rosterFile.accept = ".csv,text/csv";
    rosterFile.setAttribute("aria-label", localized("Historical participants CSV", "Historische deelnemers-CSV"));
    const rosterImportStatus = document.createElement("div");
    rosterImportStatus.setAttribute("role", "status");
    rosterImport.append(rosterImportSummary, rosterFile, csvRulesPanel(document, tournamentRosterFileRules()), rosterImportStatus);
    // A finished import re-renders this step, which would wipe what the
    // import just said. The last word is kept and put back.
    const sayRoster = (message: string | HTMLElement | null): void => {
      lastRosterImportMessage = message;
      if (message === null) { rosterImportStatus.replaceChildren(); return; }
      if (typeof message === "string") {
        const line = document.createElement("p");
        line.textContent = message;
        rosterImportStatus.replaceChildren(line);
        return;
      }
      rosterImportStatus.replaceChildren(message);
    };
    if (lastRosterImportMessage !== null) {
      const kept = lastRosterImportMessage;
      rosterImportStatus.replaceChildren(typeof kept === "string"
        ? (() => { const line = document.createElement("p"); line.textContent = kept; return line; })()
        : kept);
      if (typeof kept !== "string") { rosterImport.open = true; }
    }
    // ADR-0177 decision 8 with ADR-0218, as on the APK: a roster file names
    // people, never Players. Every row shows the Players its name may mean,
    // with context, beside "new Player" and "skip". Only an unambiguous row
    // starts with a suggestion - the one Player of this night's list, or of
    // this Director's own nights, who carries the name - and nothing is
    // written until the Director applies the whole table. New Players still
    // take two confirmations and a collision rejects the file. A spelling the
    // Director chose a Player for becomes their own alias of that Player.
    const applyRosterChoices = async (
      fileRows: readonly RosterFileRow[],
      chosen: ReadonlyMap<number, string>,
    ): Promise<TournamentDocument> => {
      const next = await client.load(document_.summary.tournamentId, controller.signal);
      const rows: { playerId: string; attendance: TournamentAttendance; hasSwitch1: boolean; hasSwitch2: boolean }[] = [];
      for (const fileRow of fileRows) {
        const playerId = chosen.get(fileRow.row);
        if (playerId === undefined) { continue; }
        const existing = next.participants.find((candidate) => candidate.playerId === playerId);
        if (existing !== undefined && existing.attendance === fileRow.attendance &&
          existing.hasSwitch1 === fileRow.hasSwitch1 && existing.hasSwitch2 === fileRow.hasSwitch2) { continue; }
        if (rows.some((row) => row.playerId === playerId)) { continue; }
        rows.push({
          playerId, attendance: fileRow.attendance,
          hasSwitch1: fileRow.hasSwitch1, hasSwitch2: fileRow.hasSwitch2,
        });
      }
      if (rows.length === 0) { return next; }
      return client.importParticipants(next.summary.tournamentId, {
        expectedRevision: next.summary.revision,
        rows,
      }, controller.signal);
    };
    const attendanceWord = (attendance: TournamentAttendance): string => attendance === "present"
      ? localized("Present", "Aanwezig")
      : attendance === "waiting" ? localized("Waiting list", "Wachtlijst") : localized("Absent", "Afwezig");
    const reviewRosterFile = (records: readonly RosterFileRow[], entries: readonly RosterNameCandidates[]): HTMLElement => {
      const box = document.createElement("div");
      box.className = "tournament-roster-review";
      const intro = document.createElement("p");
      intro.textContent = localized(
        `Choose who each of the ${records.length} rows is. A name is never an identity: nothing is linked or created until you apply the list.`,
        `Kies wie elk van de ${records.length} regels is. Een naam is nooit een identiteit: er wordt niets gekoppeld of aangemaakt tot je de lijst toepast.`,
      );
      box.append(intro);
      if (!directorCreationAllowed) {
        const closed = document.createElement("p");
        closed.className = "tournament-op__hint";
        closed.textContent = rosterCreationClosedText();
        box.append(closed);
      }
      const choices = new Map<number, RosterRowChoice | null>();
      const table = document.createElement("table");
      table.className = "tournament-roster-review__table";
      const head = document.createElement("tr");
      for (const title of [localized("Row", "Regel"), localized("Name in the file", "Naam in het bestand"), localized("Status", "Status"), localized("Player", "Speler")]) {
        const cell = document.createElement("th");
        cell.scope = "col";
        cell.textContent = title;
        head.append(cell);
      }
      const headGroup = document.createElement("thead");
      headGroup.append(head);
      const body = document.createElement("tbody");
      const apply = button(document, "", true);
      let secondConfirmation = false;
      const summary = document.createElement("p");
      summary.className = "tournament-op__hint";
      summary.setAttribute("role", "status");
      const refresh = (): void => {
        secondConfirmation = false;
        const open = [...choices.values()].filter((choice) => choice === null).length;
        const creating = [...choices.values()].filter((choice) => choice?.kind === "new").length;
        apply.disabled = open > 0;
        apply.textContent = creating > 0
          ? localized(`Apply the list (creates ${creating} new Players)`, `Lijst toepassen (maakt ${creating} nieuwe spelers aan)`)
          : localized("Apply the list", "Lijst toepassen");
        summary.textContent = open > 0
          ? localized(`${open} rows still need a choice.`, `${open} regels wachten nog op een keuze.`)
          : "";
      };
      records.forEach((record, index) => {
        const entry = entries[index] ?? { name: record.displayName, sameNameInOwnNights: false, candidates: [] };
        const suggested = rosterImportSuggestion(entry);
        // ADR-0221: with creation closed a name nobody carries waits for a choice (a Player or skip).
        const suggestion = !directorCreationAllowed && suggested?.kind === "new" ? null : suggested;
        choices.set(record.row, suggestion);
        const row = document.createElement("tr");
        const number = document.createElement("td");
        number.textContent = String(record.row);
        const name = document.createElement("td");
        name.textContent = record.displayName;
        const status = document.createElement("td");
        status.textContent = attendanceWord(record.attendance);
        const pickCell = document.createElement("td");
        const pick = document.createElement("select");
        pick.className = "tournament-roster-review__pick";
        pick.setAttribute("aria-label", localized(`Player for row ${record.row}`, `Speler voor regel ${record.row}`));
        const option = (value: string, label: string): void => {
          const element = document.createElement("option");
          element.value = value;
          element.textContent = label;
          pick.append(element);
        };
        if (suggestion === null) { option("", localized("Choose…", "Kies…")); }
        for (const candidate of entry.candidates) { option(`player:${candidate.playerId}`, rosterCandidateOptionText(candidate)); }
        if (directorCreationAllowed) {
          option("new", entry.sameNameInOwnNights
            ? localized(`Another "${record.displayName}" (new Player)`, `Nog een "${record.displayName}" (nieuwe speler)`)
            : localized(`New Player "${record.displayName}"`, `Nieuwe speler "${record.displayName}"`));
        }
        option("skip", localized("Skip this row", "Regel overslaan"));
        pick.value = suggestion === null ? "" : suggestion.kind === "player" ? `player:${suggestion.playerId}` : suggestion.kind;
        const warning = document.createElement("small");
        warning.className = "tournament-roster-choices__warning";
        warning.hidden = true;
        warning.textContent = localized(
          `There is already a "${record.displayName}" in your nights; this creates someone else.`,
          `Er is al een "${record.displayName}" in jouw avonden; dit maakt iemand anders aan.`,
        );
        pick.addEventListener("change", () => {
          const value = pick.value;
          const choice: RosterRowChoice | null = value === "" ? null
            : value === "new" ? { kind: "new" }
              : value === "skip" ? { kind: "skip" }
                : { kind: "player", playerId: value.slice("player:".length) };
          choices.set(record.row, choice);
          warning.hidden = !(choice?.kind === "new" && entry.sameNameInOwnNights);
          refresh();
        });
        pickCell.append(pick, warning);
        row.append(number, name, status, pickCell);
        body.append(row);
      });
      table.append(headGroup, body);
      const scroller = document.createElement("div");
      scroller.className = "tournament-roster-review__scroll";
      scroller.append(table);
      box.append(scroller, summary, apply);
      refresh();
      apply.addEventListener("click", () => {
        const picked = [...choices.entries()];
        if (picked.some(([, choice]) => choice === null)) { refresh(); return; }
        const playerRows = picked.filter(([, choice]) => choice?.kind === "player")
          .map(([row, choice]) => [row, (choice as Readonly<{ kind: "player"; playerId: string }>).playerId] as const);
        if (new Set(playerRows.map(([, playerId]) => playerId)).size !== playerRows.length) {
          summary.textContent = localized(
            "The same Player is chosen for two rows. A Player may appear once.",
            "Dezelfde speler is voor twee regels gekozen. Een speler mag één keer voorkomen.",
          );
          return;
        }
        const creating = records.filter((record) => choices.get(record.row)?.kind === "new");
        if (creating.length > 0 && !secondConfirmation) {
          secondConfirmation = true;
          apply.textContent = localized(
            `Confirm again: create ${creating.length} new Players`,
            `Bevestig nogmaals: maak ${creating.length} nieuwe spelers aan`,
          );
          return;
        }
        apply.disabled = true;
        void run(localized("Importing participants", "Deelnemers importeren"), async () => {
          try {
            const chosen = new Map<number, string>(playerRows);
            const created = creating.length === 0 ? [] : await client.createRosterPlayers(
              creating.map((record) => ({
                row: record.row, displayName: record.displayName,
                ...(entries[records.indexOf(record)]?.sameNameInOwnNights === true ? { confirmSameName: true } : {}),
              })),
              controller.signal,
              { tournamentId: document_.summary.tournamentId },
            );
            // The batch answers in the order it was asked, one Player per row.
            creating.forEach((record, index) => {
              const player = created[index];
              if (player !== undefined) { chosen.set(record.row, player.playerId); }
            });
            const next = await applyRosterChoices(records, chosen);
            const remember = rosterAliasesToRemember(records.flatMap((record, index) => {
              const choice = choices.get(record.row);
              if (choice?.kind !== "player") { return []; }
              const candidate = entries[index]?.candidates.find((entry) => entry.playerId === choice.playerId);
              return candidate === undefined ? [] : [{ name: record.displayName, candidate }];
            }));
            const remembered = remember.length === 0 ? 0 : await client.rememberRosterAliases(
              document_.summary.tournamentId, remember, controller.signal,
            ).then((outcome) => outcome.created.length).catch(() => 0);
            sayRoster(localized(
              `${chosen.size} rows applied; ${created.length} new Players created; ${remembered} names remembered for your nights.`,
              `${chosen.size} regels toegepast; ${created.length} nieuwe spelers aangemaakt; ${remembered} namen onthouden voor jouw avonden.`,
            ));
            return next;
          } catch (error) {
            if (error instanceof TournamentRosterRejectionError) {
              sayRoster(tournamentRosterRejectionMessage(error.rejections));
              return undefined;
            }
            throw error;
          }
        });
      });
      return box;
    };
    rosterFile.addEventListener("change", () => {
      const selected = rosterFile.files?.[0];
      if (selected === undefined) return;
      void selected.text().then(async (text) => {
        const report = tournamentRosterFile(text);
        if (!report.ok) {
          sayRoster(csvIssueList(document, report.issues, localized("Nothing imported.", "Niets geïmporteerd.")));
          return;
        }
        const records = report.rows;
        const seenNames = new Map<string, number>();
        for (const record of records) {
          const nameKey = historicalName(record.displayName);
          const firstRow = seenNames.get(nameKey);
          if (firstRow !== undefined) {
            sayRoster(tournamentRosterRejectionMessage([
              { row: record.row, displayName: record.displayName, reason: "duplicate_display_name_in_file" },
            ]));
            return;
          }
          seenNames.set(nameKey, record.row);
        }
        sayRoster(localized("Looking up the names in the file…", "Namen uit het bestand opzoeken…"));
        const entries = await client.rosterCandidates({
          names: records.map((record) => record.displayName),
          tournamentId: document_.summary.tournamentId,
          partial: true,
        }, controller.signal);
        if (disposed) { return; }
        sayRoster(reviewRosterFile(records, entries));
        rosterImport.open = true;
      }).catch(() => {
        sayRoster(localized(
          "The participant file could not be read.",
          "Het deelnemersbestand kon niet worden gelezen.",
        ));
      });
    });
    section.append(rosterImport);

    const inactiveCount = document_.participants.filter((participant) => participant.inactive && participant.attendance === "absent").length;
    const hideInactiveLabel = document.createElement("label");
    hideInactiveLabel.className = "tournament-op__inactive-filter";
    const hideInactive = document.createElement("input");
    hideInactive.type = "checkbox";
    hideInactive.checked = hideInactiveAbsentPlayers;
    hideInactive.setAttribute("aria-label", localized("Hide inactive absent Players", "Inactieve afwezige spelers verbergen"));
    hideInactiveLabel.append(hideInactive, document.createTextNode(localized(
      `Hide inactive absent Players (${inactiveCount})`,
      `Inactieve afwezige spelers verbergen (${inactiveCount})`,
    )));

    const rosterFilter = document.createElement("input");
    rosterFilter.type = "search";
    rosterFilter.className = "tournament-op__roster-filter";
    rosterFilter.placeholder = localized("Filter the Player roster…", "Spelerslijst filteren…");
    rosterFilter.setAttribute("aria-label", localized("Filter the Player roster", "Spelerslijst filteren"));

    const recentAction = document.createElement("div");
    recentAction.className = "tournament-op__recent-roster";
    const addHistorical = button(document, localized("Synchronize Tournament history", "Toernooigeschiedenis synchroniseren"));
    addHistorical.addEventListener("click", () => {
      void run(localized("Synchronizing historical Tournament Players", "Historische toernooispelers synchroniseren"), () => client.addHistoricalParticipants(
        document_.summary.tournamentId,
        { expectedRevision: document_.summary.revision },
        controller.signal,
      ));
    });
    const addRecent = button(document, localized("Add Players from latest 3 TNs", "Spelers uit laatste 3 TN's toevoegen"));
    addRecent.addEventListener("click", () => {
      void run(localized("Adding recent TN Players as absent", "Recente TN-spelers als Afwezig toevoegen"), () => client.addRecentParticipants(
        document_.summary.tournamentId,
        { expectedRevision: document_.summary.revision },
        controller.signal,
      ));
    });
    const recentHint = document.createElement("p");
    recentHint.className = "tournament-op__hint";
    recentHint.textContent = localized(
      "Uses Players who were present in the latest three finalized TN4+ events. New rows start Absent, ordered by current TrueSkill rank.",
      "Gebruikt spelers die aanwezig waren bij de laatste drie afgeronde TN4+-toernooien. Nieuwe rijen starten als Afwezig, gesorteerd op de huidige TrueSkill-rang.",
    );
    recentAction.append(addHistorical, addRecent, recentHint);

    // New tournaments already contain the historical Tournament roster. Keep the
    // exceptional add/guest tools available without making them the primary
    // Step 2 workflow.
    const exceptional = document.createElement("details");
    exceptional.className = "tournament-op__guest tournament-op__exceptional-roster";
    const exceptionalSummary = document.createElement("summary");
    exceptionalSummary.textContent = localized("Missing Player or legacy roster?", "Ontbrekende speler of historische lijst?");
    exceptional.append(exceptionalSummary, recentAction);

    // Add by directory search.
    const search = document.createElement("form");
    search.className = "tournament-op__search";
    const query = document.createElement("input");
    query.type = "search";
    query.placeholder = localized("Find a Player by name…", "Zoek een speler op naam…");
    query.setAttribute("aria-label", localized("Find a Player", "Zoek een speler"));
    query.maxLength = 64;
    const searchButton = document.createElement("button");
    searchButton.type = "submit";
    searchButton.className = "tt-auth__button";
    searchButton.textContent = localized("Search", "Zoeken");
    const results = document.createElement("ul");
    results.className = "tournament-op__results";
    let directory: readonly ClaimablePlayerSummary[] = [];
    const renderCandidates = (candidates: typeof directory): void => {
      clear(results);
      const known = new Set(document_.participants.map((participant) => participant.playerId));
      const available = candidates.filter((candidate) => !known.has(candidate.playerId));
      if (available.length === 0) {
        const empty = document.createElement("li");
        empty.textContent = localized("No new Players match.", "Geen nieuwe spelers gevonden.");
        results.append(empty);
      }
      for (const candidate of available) {
        const item = document.createElement("li");
        const add = button(document, localized(
          `Add ${candidate.displayName} (@${candidate.username})`,
          `${candidate.displayName} (@${candidate.username}) toevoegen`,
        ));
        add.addEventListener("click", () => {
          void run(localized(`${candidate.displayName} adding`, `${candidate.displayName} toevoegen`), () => client.setParticipant(
            document_.summary.tournamentId,
            { expectedRevision: document_.summary.revision, playerId: candidate.playerId, attendance: "present" },
            controller.signal,
          ));
        });
        item.append(add);
        results.append(item);
      }
    };
    search.append(query, searchButton);
    search.addEventListener("submit", (event) => {
      event.preventDefault();
      const normalized = query.value.trim().toLocaleLowerCase();
      if (directory.length > 0) {
        renderCandidates(directory.filter((candidate) =>
          candidate.displayName.toLocaleLowerCase().includes(normalized) ||
          candidate.username.toLocaleLowerCase().includes(normalized)));
        return;
      }
      void players.search(query.value, controller.signal).then((found) => {
        if (disposed) { return; }
        renderCandidates(found);
      }).catch(() => {
        if (disposed) { return; }
        const failed = document.createElement("li");
        failed.textContent = localized("Search needs at least two characters.", "Zoeken vereist minimaal twee tekens.");
        results.append(failed);
      });
    });
    exceptional.append(search, results);
    if (players.listAll !== undefined) {
      const loading = document.createElement("li");
      loading.textContent = localized("Loading all known Players…", "Alle bekende spelers laden…");
      results.append(loading);
      void players.listAll(controller.signal).then((found) => {
        if (disposed) { return; }
        directory = found;
        renderCandidates(directory);
      }).catch(() => {
        if (disposed) { return; }
        clear(results);
        const failed = document.createElement("li");
        failed.textContent = localized(
          "The complete Player list is unavailable; search by name.",
          "De volledige spelerslijst is niet beschikbaar; zoek op naam.",
        );
        results.append(failed);
      });
    }

    // ADR-0177 decision 11 with ADR-0218, as on the APK: one field shows the
    // Players a typed name may mean, with context, beside "new Player"; the
    // Director's click adds one as waiting. Creation shows the display name
    // and the username it derives once (twice for a name already in this
    // Director's nights) and goes through the all-or-nothing roster batch.
    const addRow = document.createElement("form");
    addRow.className = "tournament-op__search";
    const addName = document.createElement("input");
    addName.maxLength = 96;
    addName.placeholder = localized("Add participant…", "Deelnemer toevoegen…");
    addName.setAttribute("aria-label", localized("Add participant", "Deelnemer toevoegen"));
    const addButton = document.createElement("button");
    addButton.type = "submit";
    addButton.className = "tt-auth__button";
    addButton.textContent = localized("Add participant", "Deelnemer toevoegen");
    addButton.disabled = true;
    addName.addEventListener("input", () => { addButton.disabled = addName.value.trim().length < 2; });
    const addReport = document.createElement("p");
    addReport.className = "tournament-op__hint";
    addReport.setAttribute("role", "status");
    const addConfirm = document.createElement("div");
    addConfirm.hidden = true;
    addRow.append(addName, addButton);
    const clearConfirm = (): void => { addConfirm.hidden = true; clear(addConfirm); };
    const offerCreation = (requestedName: string, derivedUsername: string, confirmSameName: boolean): void => {
      clearConfirm();
      addConfirm.hidden = false;
      const question = document.createElement("p");
      question.textContent = confirmSameName
        ? localized(
          `Create another Player called "${requestedName}"?`,
          `Nog een speler met de naam "${requestedName}" aanmaken?`,
        )
        : localized(
          `"${requestedName}" is not a Player yet.`,
          `"${requestedName}" is nog geen speler.`,
        );
      const consequence = document.createElement("p");
      consequence.className = "tournament-op__hint";
      consequence.textContent = localized(
        `Creation assigns username @${derivedUsername}, or the next free one (@${derivedUsername}-2). The Player remains claimable by that person.`,
        `Aanmaken geeft de gebruikersnaam @${derivedUsername}, of de eerstvolgende vrije (@${derivedUsername}-2). De speler blijft claimbaar door de persoon zelf.`,
      );
      const confirmCreate = button(document, localized("Create and add", "Aanmaken en toevoegen"), true);
      confirmCreate.addEventListener("click", () => {
        clearConfirm();
        void run(localized(`Creating ${requestedName}`, `${requestedName} aanmaken`), async () => {
          try {
            const [created] = await client.createRosterPlayers(
              [{ row: 1, displayName: requestedName, ...(confirmSameName ? { confirmSameName: true } : {}) }],
              controller.signal, { tournamentId: document_.summary.tournamentId },
            );
            const fresh = await client.load(document_.summary.tournamentId, controller.signal);
            const next = await client.setParticipant(fresh.summary.tournamentId, {
              expectedRevision: fresh.summary.revision,
              playerId: created!.playerId,
              attendance: "waiting",
              hasSwitch1: false,
              hasSwitch2: false,
            }, controller.signal);
            addReport.textContent = localized(
              `${created!.displayName} was created as @${created!.username} and added.`,
              `${created!.displayName} is aangemaakt als @${created!.username} en toegevoegd.`,
            );
            return next;
          } catch (error) {
            if (error instanceof TournamentRosterRejectionError) {
              addReport.textContent = tournamentRosterRejectionMessage(error.rejections);
              return undefined;
            }
            throw error;
          }
        });
      });
      const cancelCreate = button(document, localized("Cancel", "Annuleren"));
      cancelCreate.addEventListener("click", () => { clearConfirm(); });
      addConfirm.append(question, consequence, confirmCreate, cancelCreate);
    };
    addRow.addEventListener("submit", (event) => {
      event.preventDefault();
      const requestedName = addName.value.trim();
      if (requestedName.length < 2) { return; }
      clearConfirm();
      addReport.textContent = "";
      // ADR-0218: a typed name never adds anybody by itself. The candidates
      // it may mean are shown with their context next to "new Player", and
      // only the Director's click links one of them to this night.
      const create = (confirmSameName: boolean): void => {
        const derivedUsername = tournamentRosterUsernameFor(requestedName);
        if (derivedUsername === null) {
          addReport.textContent = localized(
            `"${requestedName}" does not produce a usable username. Use letters and numbers.`,
            `"${requestedName}" levert geen bruikbare gebruikersnaam op. Gebruik letters en cijfers.`,
          );
          return;
        }
        offerCreation(requestedName, derivedUsername, confirmSameName);
      };
      addReport.textContent = localized("Looking for Players with this name…", "Spelers met deze naam zoeken…");
      void client.rosterCandidates(
        { names: [requestedName], tournamentId: document_.summary.tournamentId, partial: true },
        controller.signal,
      ).then((entries) => {
        if (disposed) { return; }
        addReport.textContent = "";
        const entry = entries[0] ?? { name: requestedName, sameNameInOwnNights: false, candidates: [] };
        clearConfirm();
        addConfirm.hidden = false;
        addConfirm.append(rosterChoiceList(document, entry, {
          blockOnNight: true,
          pickLabel: (candidate) => localized(`Add ${candidate.displayName}`, `${candidate.displayName} toevoegen`),
          onPick: (candidate) => {
            clearConfirm();
            void run(localized(`Adding ${candidate.displayName}`, `${candidate.displayName} toevoegen`), () => client.setParticipant(
              document_.summary.tournamentId,
              { expectedRevision: document_.summary.revision, playerId: candidate.playerId, attendance: "waiting" },
              controller.signal,
            ));
          },
          onCreate: create,
          creationClosed: !directorCreationAllowed,
        }));
        const cancel = button(document, localized("Cancel", "Annuleren"));
        cancel.addEventListener("click", () => { clearConfirm(); });
        addConfirm.append(cancel);
      }).catch(() => {
        if (disposed) { return; }
        addReport.textContent = localized(
          "The Players with this name could not be looked up. Try again.",
          "De spelers met deze naam konden niet worden opgezocht. Probeer het opnieuw.",
        );
      });
    });
    // The source Manager deliberately uses different interaction models by
    // viewport. Desktop is a three-column status board: every player stays on
    // one horizontal line, so clicking another status cell moves that player.
    // On a phone that interaction is ambiguous, therefore the source keeps the
    // player card and its compact A/W/X segmented control together in one row.
    const rows = tournamentRosterRows(document_.participants, false);
    const statuses = [
      ["present", localized("Present", "Aanwezig")],
      ["waiting", localized("Waiting list", "Wachtlijst")],
      ["absent", localized("Absent", "Afwezig")],
    ] as const;
    const makeParticipantCard = (
      participant: (typeof rows)[number],
      includeAttendance: boolean,
    ): HTMLElement => {
      const card = document.createElement("article");
      card.className = `tournament-op__participant-card tournament-op__participant-card--${participant.attendance} tournament-op__participant-card--row`;

      const identity = document.createElement("span");
      identity.className = "tournament-op__participant-identity";
      const nameRow = document.createElement("span");
      nameRow.className = "tournament-op__participant-name-row";
      const name = document.createElement("strong");
      name.textContent = participant.displayName;
      nameRow.append(name);
      if (participant.isNew ?? false) {
        const isNewBadge = document.createElement("span");
        isNewBadge.className = "tournament-op__roster-badge tournament-op__roster-badge--new";
        isNewBadge.textContent = localized("New", "Nieuw");
        nameRow.append(isNewBadge);
      }
      if (participant.inactive ?? false) {
        const inactive = document.createElement("span");
        inactive.className = "tournament-op__roster-badge tournament-op__roster-badge--inactive";
        inactive.textContent = localized("Inactive", "Inactief");
        nameRow.append(inactive);
      }
      if (tournamentLendsWithoutPlaying(participant)) {
        const lender = document.createElement("span");
        lender.className = "tournament-op__roster-badge tournament-op__roster-badge--lender";
        lender.textContent = localized("Lends a Switch, not playing", "Leent Switch, speelt niet mee");
        lender.title = localized("This console counts for the seating even though its owner is not playing.", "Deze console telt mee voor de indeling, ook al speelt de eigenaar niet mee.");
        nameRow.append(lender);
      }
      const rankPill = document.createElement("span");
      rankPill.className = "tournament-op__roster-badge tournament-op__roster-badge--rank";
      rankPill.textContent = localized(
        `RANK ${participant.seedRank === undefined ? "#?" : `#${participant.seedRank}`}`,
        `RANG ${participant.seedRank === undefined ? "#?" : `#${participant.seedRank}`}`,
      );
      nameRow.append(rankPill);
      const skill = document.createElement("small");
      skill.textContent = `SP${(participant.inactive ?? false) ? "*" : ""}: ${tournamentSkillScoreLabel(participant.seedScore)}`;
      identity.append(nameRow, skill);

      const actions = document.createElement("div");
      actions.className = "tournament-op__participant-actions";
      for (const [key, checked] of [["hasSwitch1", participant.hasSwitch1], ["hasSwitch2", participant.hasSwitch2]] as const) {
        const wrapper = document.createElement("label");
        wrapper.className = "tournament-op__switch";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = checked;
        checkbox.setAttribute("aria-label", localized(
          `${participant.displayName} brings ${key === "hasSwitch1" ? "NS1" : "NS2"}`,
          `${participant.displayName} neemt ${key === "hasSwitch1" ? "NS1" : "NS2"} mee`,
        ));
        checkbox.addEventListener("change", () => {
          const warning = checkbox.checked ? tournamentLenderWarning(participant.displayName, participant.attendance, key === "hasSwitch1" ? "NS1" : "NS2") : null;
          if (warning !== null && !confirm(warning)) { checkbox.checked = false; return; }
          void run(localized(`Updating ${participant.displayName}`, `${participant.displayName} bijwerken`), () => client.setParticipant(
            document_.summary.tournamentId,
            { expectedRevision: document_.summary.revision, playerId: participant.playerId, [key]: checkbox.checked },
            controller.signal,
          ));
        });
        const switchType = key === "hasSwitch1" ? "NS1" : "NS2";
        const icon = document.createElement("img");
        icon.src = key === "hasSwitch1" ? "/styles/mk8dx_ns1.png" : "/styles/mk8dx_ns2.png";
        icon.alt = switchType;
        icon.width = 20;
        icon.height = 20;
        wrapper.append(checkbox, icon);
        actions.append(wrapper);
      }
      card.append(identity, actions);

      if (includeAttendance) {
        const attendance = document.createElement("div");
        attendance.className = "tournament-op__attendance-toggle";
        attendance.setAttribute("role", "group");
        attendance.setAttribute("aria-label", localized(
          `Status of ${participant.displayName}`,
          `Status van ${participant.displayName}`,
        ));
        for (const [value, label] of statuses) {
          const choice = button(document, value === "present" ? "A" : value === "waiting" ? "W" : "X");
          choice.className = `tournament-op__attendance-choice tournament-op__attendance-choice--${value}`;
          choice.title = label;
          choice.setAttribute("aria-label", `${participant.displayName} · ${label}`);
          choice.setAttribute("aria-pressed", participant.attendance === value ? "true" : "false");
          choice.addEventListener("click", () => {
            if (participant.attendance === value) { return; }
            void run(localized(`${participant.displayName} to ${label}`, `${participant.displayName} naar ${label}`), () => client.setParticipant(
              document_.summary.tournamentId,
              { expectedRevision: document_.summary.revision, playerId: participant.playerId, attendance: value },
              controller.signal,
            ));
          });
          attendance.append(choice);
        }
        card.append(attendance);
      }
      return card;
    };

    const desktopBoard = document.createElement("div");
    desktopBoard.className = "tournament-op__status-board";
    const desktopHead = document.createElement("div");
    desktopHead.className = "tournament-op__status-board-head";
    for (const [value, label] of statuses) {
      const count = rows.filter((participant) => participant.attendance === value).length;
      const ns1 = rows.filter((participant) => participant.attendance === value && participant.hasSwitch1).length;
      const ns2 = rows.filter((participant) => participant.attendance === value && participant.hasSwitch2).length;
      const heading = document.createElement("div");
      heading.className = `tournament-op__status-board-title tournament-op__status-board-title--${value}`;
      heading.append(document.createTextNode(`${label} (${count})`));
      const consoles = document.createElement("small");
      for (const [switchType, switchCount] of [["ns1", ns1], ["ns2", ns2]] as const) {
        const counter = document.createElement("span");
        const icon = document.createElement("img");
        icon.src = switchType === "ns1" ? "/styles/mk8dx_ns1.png" : "/styles/mk8dx_ns2.png";
        icon.alt = switchType.toUpperCase();
        icon.width = 14;
        icon.height = 14;
        counter.append(icon, document.createTextNode(` ${switchCount}`));
        consoles.append(counter);
      }
      heading.append(consoles);
      desktopHead.append(heading);
    }
    const desktopBody = document.createElement("div");
    desktopBody.className = "tournament-op__status-board-body";
    for (const participant of rows) {
      const row = document.createElement("div");
      row.className = "tournament-op__status-board-row";
      row.dataset.rosterFilterable = "true";
      row.dataset.rosterSearch = `${participant.displayName} ${participant.username}`.toLocaleLowerCase();
      row.dataset.inactiveAbsent = String((participant.inactive ?? false) && participant.attendance === "absent");
      for (const [value, label] of statuses) {
        const cell = document.createElement("div");
        cell.className = `tournament-op__status-board-cell tournament-op__status-board-cell--${value}`;
        cell.setAttribute("aria-label", localized(
          `${participant.displayName} to ${label}`,
          `${participant.displayName} naar ${label}`,
        ));
        if (participant.attendance === value) {
          cell.classList.add("tournament-op__status-board-cell--filled");
          cell.append(makeParticipantCard(participant, false));
        } else {
          cell.textContent = `→ ${label}`;
          cell.setAttribute("role", "button");
          cell.tabIndex = 0;
          const move = (): void => {
            void run(localized(`${participant.displayName} to ${label}`, `${participant.displayName} naar ${label}`), () => client.setParticipant(
              document_.summary.tournamentId,
              { expectedRevision: document_.summary.revision, playerId: participant.playerId, attendance: value },
              controller.signal,
            ));
          };
          cell.addEventListener("click", move);
          cell.addEventListener("keydown", (event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              move();
            }
          });
        }
        row.append(cell);
      }
      desktopBody.append(row);
    }
    desktopBoard.append(desktopHead, desktopBody);

    const mobileBoard = document.createElement("div");
    mobileBoard.className = "tournament-op__roster-rows tournament-op__roster-rows--mobile";
    const mobileHead = document.createElement("div");
    mobileHead.className = "tournament-op__roster-mobile-head";
    for (const [value, label] of statuses) {
      const count = rows.filter((participant) => participant.attendance === value).length;
      const summary = document.createElement("strong");
      summary.className = `tournament-op__roster-mobile-count tournament-op__roster-mobile-count--${value}`;
      summary.textContent = `${label} ${count}`;
      mobileHead.append(summary);
    }
    mobileBoard.append(mobileHead);
    for (const participant of rows) {
      const row = document.createElement("div");
      row.className = "tournament-op__roster-mobile-row";
      row.dataset.rosterFilterable = "true";
      row.dataset.rosterSearch = `${participant.displayName} ${participant.username}`.toLocaleLowerCase();
      row.dataset.inactiveAbsent = String((participant.inactive ?? false) && participant.attendance === "absent");
      row.append(makeParticipantCard(participant, true));
      mobileBoard.append(row);
    }
    section.append(desktopBoard, mobileBoard, hideInactiveLabel, rosterFilter, exceptional);
    const applyRosterVisibility = (): void => {
      const normalized = rosterFilter.value.trim().toLocaleLowerCase();
      for (const row of section.querySelectorAll<HTMLElement>("[data-roster-filterable]")) {
        const hiddenInactive = hideInactive.checked && row.dataset.inactiveAbsent === "true";
        const hiddenBySearch = normalized.length > 0 && !(row.dataset.rosterSearch ?? "").includes(normalized);
        row.hidden = hiddenInactive || hiddenBySearch;
      }
    };
    rosterFilter.addEventListener("input", applyRosterVisibility);
    hideInactive.addEventListener("change", () => {
      hideInactiveAbsentPlayers = hideInactive.checked;
      applyRosterVisibility();
    });
    applyRosterVisibility();
    section.append(addRow, addConfirm, addReport);

    // ADR-0177 decision 7: the qualification layout settings stay editable
    // exactly while the Tournament has no groups, with the APK's labels.
    const settingsLocked = document_.groups.length > 0;
    const settings = document.createElement("details");
    settings.className = "tournament-op__guest";
    const settingsSummary = document.createElement("summary");
    settingsSummary.textContent = localized("⚙️ Qualifier layout settings", "⚙️ Instellingen kwalificatie-indeling");
    const settingsIntro = document.createElement("p");
    settingsIntro.className = "tournament-op__hint";
    settingsIntro.textContent = localized(
      "Controls what happens when qualifier groups are created. The defaults work for most tournaments.",
      "Bepaalt wat er gebeurt bij Maak kwalificatiegroepen. De standaardwaarden werken voor de meeste toernooien.",
    );
    settings.append(settingsSummary, settingsIntro);
    const metrics = tournamentRosterGateMetrics(document_);
    const applySettings = (patch: Readonly<{
      seedingSource?: TournamentSeedingSource;
      verifiedOnly?: boolean;
      placementStrategy?: "balanced" | "minimal_move";
      ownerSeatingMode?: "owner_strict" | "owner_soft";
      maxParticipants?: number | null;
    }>): void => {
      void run(localized("Saving settings", "Instellingen opslaan"), async () => {
        await client.update(document_.summary.tournamentId, {
          expectedRevision: document_.summary.revision,
          placementStrategy: document_.summary.placementStrategy ?? "balanced",
          ownerSeatingMode: document_.summary.ownerSeatingMode ?? "owner_strict",
          maxParticipants: metrics.maxParticipants,
          ...patch,
        }, controller.signal);
        return client.load(document_.summary.tournamentId, controller.signal);
      });
    };
    const limitLabel = document.createElement("label");
    limitLabel.className = "tournament-director-step__label";
    limitLabel.textContent = localized("Maximum places", "Maximaal aantal plaatsen");
    const limitInput = document.createElement("input");
    limitInput.type = "number";
    limitInput.min = "1";
    limitInput.max = "60";
    limitInput.placeholder = localized("E.g. 36", "Bijv. 36");
    limitInput.disabled = settingsLocked;
    limitInput.value = metrics.maxParticipants === null ? "" : String(metrics.maxParticipants);
    limitInput.addEventListener("change", () => {
      const parsed = limitInput.value.trim() === "" ? null : Number.parseInt(limitInput.value, 10);
      if (parsed !== null && (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 60)) { return; }
      applySettings({ maxParticipants: parsed });
    });
    limitLabel.append(limitInput);
    const qualifierReadout = document.createElement("p");
    qualifierReadout.className = "tournament-op__hint";
    qualifierReadout.textContent = localized(
      "Play qualifier rounds first? Yes — qualifiers first, then final groups. Fixed: the shortened workflow without qualifiers is historical only.",
      "Kwalificatierondes eerst spelen? Ja — eerst kwalificatie, dan eindgroepen. Vast: de verkorte werkwijze zonder kwalificatie is alleen historisch.",
    );
    settings.append(limitLabel, qualifierReadout);
    const settingChoices: readonly Readonly<{
      label: string;
      options: readonly (readonly [string, string])[];
      selected: string;
      apply: (value: string) => void;
    }>[] = [
      {
        label: localized("Distribution across groups", "Verdeling over groepen"),
        options: [["balanced", localized("Balanced (default)", "Gebalanceerd (standaard)")], ["minimal_move", localized("Minimal movement", "Minimale verschuiving")]],
        selected: document_.summary.placementStrategy ?? "balanced",
        apply: (value) => applySettings({ placementStrategy: value as "balanced" | "minimal_move" }),
      },
      {
        // ADR-0221: the seeding source. "ranked" became the community rating;
        // the Director's own nights and by hand are new.
        label: localized("Placement order", "Plaatsingsvolgorde"),
        options: [
          ["community_rating", localized("By community rating (default)", "Op communityrating (standaard)")],
          ["director_nights", localized("By rating from my own nights", "Op rating uit mijn eigen avonden")],
          ["manual", localized("By hand: I arrange the groups", "Met de hand: ik deel de groepen in")],
          ["random", localized("Fully random", "Volledig willekeurig")],
        ],
        selected: seedingSourceOf(document_.summary),
        apply: (value) => applySettings({ seedingSource: value as TournamentSeedingSource }),
      },
      {
        label: localized("Own Nintendo Switch", "Eigen Nintendo Switch"),
        options: [["owner_strict", localized("Strict (default)", "Strikt (standaard)")], ["owner_soft", localized("Flexible", "Flexibel")]],
        selected: document_.summary.ownerSeatingMode ?? "owner_strict",
        apply: (value) => applySettings({ ownerSeatingMode: value as "owner_strict" | "owner_soft" }),
      },
    ];
    for (const choice of settingChoices) {
      const choiceLabel = document.createElement("label");
      choiceLabel.className = "tournament-director-step__label";
      choiceLabel.textContent = choice.label;
      const select = document.createElement("select");
      select.disabled = settingsLocked;
      select.setAttribute("aria-label", choice.label);
      for (const [value, optionLabel] of choice.options) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = optionLabel;
        option.selected = value === choice.selected;
        select.append(option);
      }
      select.addEventListener("change", () => { choice.apply(select.value); });
      choiceLabel.append(select);
      settings.append(choiceLabel);
    }
    const seedingHint = document.createElement("p");
    seedingHint.className = "tournament-op__hint";
    const source = seedingSourceOf(document_.summary);
    seedingHint.textContent = source === "director_nights"
      ? localized(
        "Ranks by a rating from your own published nights only; Players new to your nights come last.",
        "Rangschikt op een rating uit alleen je eigen gepubliceerde avonden; spelers die nieuw zijn in jouw avonden komen achteraan.",
      )
      : source === "manual"
        ? localized(
          "The draw ignores ratings; move Players between groups on the board afterwards.",
          "De loting negeert ratings; verplaats spelers daarna op het bord tussen de groepen.",
        )
        : source === "random"
          ? localized("Everybody is drawn at random.", "Iedereen wordt willekeurig ingedeeld.")
          : localized(
            "Ranks by the community rating everybody sees on the Ranking page.",
            "Rangschikt op de communityrating die iedereen op de ranglijst ziet.",
          );
    settings.append(seedingHint);
    // ADR-0221: only verified Players count for the rating from this night. A
    // rating setting, not a layout one: it stays editable until the night is finalized.
    const verifiedOnly = document.createElement("input");
    verifiedOnly.type = "checkbox";
    verifiedOnly.checked = document_.summary.verifiedOnly === true;
    verifiedOnly.disabled = document_.summary.stage === "finalized";
    verifiedOnly.addEventListener("change", () => { applySettings({ verifiedOnly: verifiedOnly.checked }); });
    const verifiedLabel = document.createElement("label");
    verifiedLabel.className = "tournament-op__toggle";
    verifiedLabel.append(verifiedOnly, document.createTextNode(localized(
      " Only verified Players count for the rating",
      " Alleen geverifieerde spelers tellen mee voor de rating",
    )));
    const verifiedHint = document.createElement("p");
    verifiedHint.className = "tournament-op__hint";
    verifiedHint.textContent = localized(
      "Players without a verified claim still play and appear in the standings, but this night does not change their rating.",
      "Spelers zonder geverifieerde claim spelen mee en staan in de uitslag, maar deze avond verandert hun rating niet.",
    );
    settings.append(verifiedLabel, verifiedHint);
    if (settingsLocked) {
      const lockedNote = document.createElement("p");
      lockedNote.className = "tournament-op__hint";
      lockedNote.textContent = localized(
        "The setup is locked once groups are created. Return to Step 2 and remove the groups to change it.",
        "De opzet ligt vast zodra de groepen gemaakt zijn. Ga terug naar Stap 2 en verwijder de groepen om dit nog te wijzigen.",
      );
      settings.append(lockedNote);
    }
    section.append(settings);

    const exportCsv = button(document, localized("Export CSV (Step 2)", "Exporteer CSV (Stap 2)"));
    exportCsv.addEventListener("click", () => {
      const blob = new Blob([tournamentRosterCsv(document_.participants)], { type: "text/csv" });
      const anchorElement = document.createElement("a");
      anchorElement.href = URL.createObjectURL(blob);
      anchorElement.download = `${document_.summary.name} · Stap 2 deelnemers.csv`;
      anchorElement.click();
      URL.revokeObjectURL(anchorElement.href);
    });
    rosterImport.append(exportCsv);

    // The APK's readiness gate: same numbers, same Dutch explanation, and
    // the button opens only when the board is genuinely ready.
    const gate = document.createElement("div");
    gate.className = "tournament-op__gate";
    const gateStatus = document.createElement("p");
    gateStatus.className = "tournament-op__hint";
    gateStatus.textContent = localized(
      `Present ${metrics.activeCount} · Waiting list ${metrics.waitingCount} · Absent ${metrics.absentCount} · Nintendo Switches: ${metrics.totalConsoles}/${metrics.minConsoles}`,
      `Aanwezig ${metrics.activeCount} · Wachtlijst ${metrics.waitingCount} · Afwezig ${metrics.absentCount} · Nintendo Switches: ${metrics.totalConsoles}/${metrics.minConsoles}`,
    );
    gate.append(gateStatus);
    if (!metrics.isReady && metrics.readinessReason !== "") {
      const reason = document.createElement("p");
      reason.className = "tournament-op__hint tournament-op__gate-reason";
      reason.style.whiteSpace = "pre-line";
      reason.textContent = metrics.readinessReason;
      gate.append(reason);
    }
    const makeGroups = button(
      document,
      metrics.isReady
        ? localized("Create qualifier groups", "Maak kwalificatiegroepen")
        : localized("Create qualifier groups (not ready)", "Maak kwalificatiegroepen (nog niet klaar)"),
      true,
    );
    makeGroups.classList.add(metrics.isReady ? "tournament-op__gate--ready" : "tournament-op__gate--blocked");
    makeGroups.disabled = !metrics.isReady;
    makeGroups.addEventListener("click", () => {
      void run(localized("Creating qualifier groups", "Kwalificatiegroepen maken"), () => client.generateGroups(
        document_.summary.tournamentId,
        { expectedRevision: document_.summary.revision, stage: "qualifier" },
        controller.signal,
      ));
    });
    gate.append(makeGroups);
    section.append(gate);
    content.append(section);
  };

  const renderGroups = (document_: TournamentDocument, stage: TournamentGroupStage, showResults: boolean, hideLockControls = false): void => {
    const groups = document_.groups.filter((group) => group.stage === stage);
    const section = document.createElement("section");
    section.className = "tournament-op__panel";
    const title = document.createElement("h2");
    title.textContent = stage === "qualifier"
      ? localized("Qualifier groups", "Kwalificatiegroepen")
      : localized("Final groups", "Eindgroepen");
    section.append(title);
    const controls = document.createElement("div");
    controls.className = "tournament-op__controls";
    const hasRaces = groups.some((group) => group.races.length > 0 || group.standings.source === "manual");
    const generate = button(document, groups.length === 0
      ? (stage === "qualifier" ? "Generate qualifier groups & seating" : "Generate final groups from the qualifier results")
      : "Regenerate groups", groups.length === 0);
    generate.disabled = hasRaces || groups.some((group) => group.locked);
    generate.addEventListener("click", () => {
      void run("Generating groups", () => client.generateGroups(
        document_.summary.tournamentId,
        { expectedRevision: document_.summary.revision, stage },
        controller.signal,
      ));
    });
    if (groups.length === 0) controls.append(generate);
    if (groups.length > 0) {
      const locked = groups.every((group) => group.locked);
      const lock = button(document, locked ? "Unlock groups" : "Lock groups");
      lock.disabled = locked && hasRaces;
      lock.addEventListener("click", () => {
        void run(locked ? "Unlocking groups" : "Locking groups", () => client.lockGroups(
          document_.summary.tournamentId,
          { expectedRevision: document_.summary.revision, stage, locked: !locked },
          controller.signal,
        ));
      });
      if (!hideLockControls) { controls.append(lock); }
    }
    section.append(controls);
    if (groups.length === 0) {
      const hint = document.createElement("p");
      hint.className = "tournament-op__hint";
      hint.textContent = stage === "qualifier"
        ? "Groups of up to twelve, seeded by the current rating; Switch owners keep seat 1 of their own console."
        : "Every qualifier group is sliced into tiers: the top band of each group meets in Kampioen, the next in Talent, and so on.";
      section.append(hint);
    }
    const grid = document.createElement("div");
    grid.className = "tournament-op__groups";
    for (const group of groups) {
      grid.append(renderGroup(document_, group, showResults));
    }
    section.append(grid);
    if (groups.length > 0) {
      const editable = groups.every((group) => !group.locked && group.races.length === 0 && group.standings.source !== "manual");
      const parked = tournamentParkingPlayers(document_, stage);
      const parking = document.createElement("section");
      parking.className = "tournament-op__parking";
      parking.dataset.parkingTarget = stage;
      const parkingTitle = document.createElement("h4");
      parkingTitle.textContent = `Player parking · ${parked.length}`;
      const parkingHint = document.createElement("p");
      parkingHint.className = "tournament-op__hint";
      parkingHint.textContent = editable
        ? "Present Players without a group stay safe here. Drag a Player to a group, or use the Move controls."
        : "Present Players not currently seated in this stage.";
      parking.append(parkingTitle, parkingHint);
      if (editable) {
        parking.addEventListener("dragover", (event) => { event.preventDefault(); parking.dataset["dropActive"] = "true"; });
        parking.addEventListener("dragleave", () => { delete parking.dataset["dropActive"]; });
        parking.addEventListener("drop", (event) => {
          event.preventDefault();
          delete parking.dataset["dropActive"];
          const playerId = event.dataTransfer?.getData("application/x-mk8dx-player-id") ?? "";
          if (!document_.participants.some((participant) => participant.playerId === playerId)) { return; }
          void run("Parking Player", () => client.updateGroups(
            document_.summary.tournamentId,
            { expectedRevision: document_.summary.revision, stage, groups: moveTournamentPlayer(document_.groups, stage, playerId) },
            controller.signal,
          ));
        });
      }
      const parkedList = document.createElement("div");
      parkedList.className = "tournament-op__parking-list";
      for (const participant of parked) {
        const chip = document.createElement("span");
        chip.className = "tournament-op__parked-player";
        chip.textContent = participant.displayName;
        chip.draggable = editable;
        chip.addEventListener("dragstart", (event) => {
          event.dataTransfer?.setData("application/x-mk8dx-player-id", participant.playerId);
          if (event.dataTransfer !== null) { event.dataTransfer.effectAllowed = "move"; }
        });
        parkedList.append(chip);
      }
      if (parked.length === 0) {
        const empty = document.createElement("span");
        empty.className = "tournament-op__hint";
        empty.textContent = "Everyone present has a group.";
        parkedList.append(empty);
      }
      parking.append(parkedList);
      section.append(parking);
    }
    content.append(section);
  };

  const renderGroup = (document_: TournamentDocument, group: TournamentGroup, showResults: boolean): HTMLElement => {
    const card = document.createElement("article");
    card.className = "tournament-op__group";
    const stageGroups = document_.groups.filter((candidate) => candidate.stage === group.stage);
    const editable = stageGroups.every((candidate) =>
      !candidate.locked && candidate.races.length === 0 && candidate.standings.source !== "manual");
    const stats = tournamentGroupBoardStats(group, document_.participants);
    const title = document.createElement("h3");
    title.textContent = `${displayGroupLabel(group)} · ${stats.switchesAssigned}/${TOURNAMENT_GROUP_SWITCHES} Switch · ` +
      `${stats.seatedCount}/${stats.seatCapacity} plek${group.locked ? " · vergrendeld" : ""}`;
    card.append(title);
    if (stats.unseatedCount > 0) {
      const unplaced = document.createElement("p");
      unplaced.className = "tournament-op__hint tournament-op__gate-reason";
      unplaced.textContent = `Nog niet geplaatst: ${stats.unseatedCount}`;
      card.append(unplaced);
    }
    const skillLine = document.createElement("p");
    skillLine.className = "tournament-op__hint";
    skillLine.textContent = `Gem. SP: ${tournamentSkillScoreLabel(stats.averageSkill)} · Spreiding: ` +
      `+${tournamentSkillScoreLabel(stats.spreadPlus)} / -${tournamentSkillScoreLabel(stats.spreadMinus)}`;
    card.append(skillLine);

    if (editable) {
      card.dataset.groupTarget = group.groupId;
      card.addEventListener("dragover", (event) => {
        if (!(event.dataTransfer?.types.includes("application/x-mk8dx-player-id") ?? false) || group.members.length >= 12) { return; }
        event.preventDefault();
        card.dataset["dropActive"] = "true";
      });
      card.addEventListener("dragleave", (event) => {
        if (!card.contains(event.relatedTarget as Node | null)) { delete card.dataset["dropActive"]; }
      });
      card.addEventListener("drop", (event) => {
        event.preventDefault();
        delete card.dataset["dropActive"];
        const playerId = event.dataTransfer?.getData("application/x-mk8dx-player-id") ?? "";
        if (playerId.length === 0 || group.members.some((member) => member.playerId === playerId)) { return; }
        let groups: readonly TournamentGroupMembershipUpdate[];
        try { groups = moveTournamentPlayer(document_.groups, group.stage, playerId, group.groupId); }
        catch (error) { say(error instanceof Error ? error.message : "That Player cannot be moved there."); return; }
        void run(localized(
          `Moving Player to ${displayGroupLabel(group)}`,
          `Speler verplaatsen naar ${displayGroupLabel(group)}`,
        ), () => client.updateGroups(
          document_.summary.tournamentId,
          { expectedRevision: document_.summary.revision, stage: group.stage, groups },
          controller.signal,
        ));
      });
    }

    // Compact per-Switch cards recover the two-seat mental model from the
    // historical Manager while keeping canonical seating server-owned.
    const stationGrid = document.createElement("div");
    stationGrid.className = "tournament-op__stations";
    const stations = new Map<string, { owner: string; type: "ns1" | "ns2"; seats: (TournamentGroup["members"][number] | undefined)[] }>();
    for (const member of group.members) {
      if (member.station === undefined) { continue; }
      const key = `${member.station.ownerPlayerId}|${member.station.switchType}`;
      const station = stations.get(key) ?? {
        owner: member.station.ownerDisplayName,
        type: member.station.switchType,
        seats: [],
      };
      station.seats[member.station.seatNumber - 1] = member;
      stations.set(key, station);
    }
    const cables = tournamentUtpByStation(document_);
    for (const [key, station] of stations) {
      const stationCard = document.createElement("section");
      stationCard.className = "tournament-op__station";
      const stationTitle = document.createElement("h5");
      const utp = cables.get(key);
      stationTitle.textContent = `${utp === undefined ? "" : `UTP ${utp} · `}${station.type.toUpperCase()} · ${station.owner}`;
      stationCard.append(stationTitle);
      for (const [index, member] of station.seats.entries()) {
        const seat = document.createElement("div");
        seat.className = "tournament-op__seat";
        if (member === undefined) {
          seat.textContent = `Seat ${index + 1} · available`;
        } else {
          const player = document.createElement("span");
          player.className = "tournament-op__seated-player";
          player.textContent = `${index + 1}. ${member.displayName}`;
          player.draggable = editable;
          player.title = editable ? `Drag ${member.displayName} to another group or Player parking` : member.displayName;
          player.addEventListener("dragstart", (event) => {
            event.stopPropagation();
            event.dataTransfer?.setData("application/x-mk8dx-player-id", member.playerId);
            if (event.dataTransfer !== null) { event.dataTransfer.effectAllowed = "move"; }
          });
          seat.append(player);
        }
        stationCard.append(seat);
      }
      if (station.seats.length < 2) {
        const seat = document.createElement("div");
        seat.className = "tournament-op__seat";
        seat.textContent = "Seat 2 · available";
        stationCard.append(seat);
      }
      stationGrid.append(stationCard);
    }
    if (stations.size === 0) {
      const empty = document.createElement("p");
      empty.className = "tournament-op__hint";
      empty.textContent = "No Nintendo Switch assigned yet.";
      stationGrid.append(empty);
    }
    card.append(stationGrid);

    const unseatedMembers = group.members.filter((member) => member.station === undefined);
    if (unseatedMembers.length > 0) {
      const unseated = document.createElement("div");
      unseated.className = "tournament-op__unseated";
      const label = document.createElement("strong");
      label.textContent = `Needs a seat · ${unseatedMembers.length}`;
      unseated.append(label);
      for (const member of unseatedMembers) {
        const player = document.createElement("span");
        player.className = "tournament-op__parked-player";
        player.textContent = member.displayName;
        player.draggable = editable;
        player.addEventListener("dragstart", (event) => {
          event.dataTransfer?.setData("application/x-mk8dx-player-id", member.playerId);
          if (event.dataTransfer !== null) { event.dataTransfer.effectAllowed = "move"; }
        });
        unseated.append(player);
      }
      card.append(unseated);
    }

    // Move a member to another group (only before races exist and unlocked).
    if (editable && group.members.length > 0) {
      const move = document.createElement("form");
      move.className = "tournament-op__move";
      const who = document.createElement("select");
      for (const member of group.members) {
        const option = document.createElement("option");
        option.value = member.playerId;
        option.textContent = member.displayName;
        who.append(option);
      }
      const where = document.createElement("select");
      const park = document.createElement("option");
      park.value = "__parking__";
      park.textContent = "→ Player parking";
      where.append(park);
      for (const candidate of stageGroups) {
        if (candidate.groupId === group.groupId) { continue; }
        const option = document.createElement("option");
        option.value = candidate.groupId;
        option.textContent = localized(
          `→ ${displayGroupLabel(candidate)}${candidate.members.length >= 12 ? " · full" : ""}`,
          `→ ${displayGroupLabel(candidate)}${candidate.members.length >= 12 ? " · vol" : ""}`,
        );
        option.disabled = candidate.members.length >= 12;
        where.append(option);
      }
      const moveButton = document.createElement("button");
      moveButton.type = "submit";
      moveButton.className = "tt-auth__button";
      moveButton.textContent = "Move";
      move.append(who, where, moveButton);
      move.addEventListener("submit", (event) => {
        event.preventDefault();
        const playerId = who.value;
        const targetId = where.value;
        void run("Moving player", () => client.updateGroups(
          document_.summary.tournamentId,
          {
            expectedRevision: document_.summary.revision,
            stage: group.stage,
            groups: moveTournamentPlayer(document_.groups, group.stage, playerId, targetId === "__parking__" ? undefined : targetId),
          },
          controller.signal,
        ));
      });
      card.append(move);
    }

    if (!showResults) { return card; }

    // Standings.
    const standingsTitle = document.createElement("h5");
    standingsTitle.textContent = group.standings.source === "none"
      ? localized("No results yet", "Nog geen uitslagen")
      : localized("Standings", "Stand")
    ;
    const standings = document.createElement("ol");
    standings.className = "tournament-op__standings";
    // The character each Player drove arrives with the workbook import, so the
    // standing of Step 5 and Step 9 can show it straight away - the Director
    // sees there and then whether it came along (owner, 2026-09-16).
    const charactersOf = new Map(group.members.map((member) => [member.playerId, member.character]));
    for (const row of group.standings.rows) {
      const item = document.createElement("li");
      const drove = charactersOf.get(row.playerId);
      const icon = tournamentCharacterIcon(drove);
      if (icon !== null) {
        const picture = document.createElement("img");
        picture.className = "tournament-op__standing-character";
        picture.src = icon;
        picture.alt = drove?.label ?? "";
        picture.title = drove?.label ?? "";
        picture.loading = "lazy";
        picture.decoding = "async";
        item.append(picture);
      }
      item.append(localized(
        `${row.rank}. ${row.displayName} — ${row.points} pts${row.races > 0 ? ` · ${row.races} races · ${row.wins} wins` : ""}${row.complete ? "" : " · incomplete"}`,
        `${row.rank}. ${row.displayName} — ${row.points} pnt${row.races > 0 ? ` · ${row.races} races · ${row.wins} overwinningen` : ""}${row.complete ? "" : " · onvolledig"}`,
      ));
      standings.append(item);
    }
    card.append(standingsTitle, standings);

    // Races.
    if (group.races.length > 0) {
      const races = document.createElement("ol");
      races.className = "tournament-op__races";
      for (const race of group.races) {
        const item = document.createElement("li");
        const raceClass = tournamentRaceClassLabel(race.mode, race.mirror);
        const track = raceClass === null ? trackName(race.trackId) : `${trackName(race.trackId)} (${raceClass})`;
        item.textContent = localized(
          `Segment ${race.scoringSegment} · race ${race.raceNumber} · ${track} · ${race.sourceKind.replaceAll("_", " ")}${race.countsTowardStandings ? "" : " · does not count"}: ${race.placements.map((placement) => placement.displayName).join(" › ")}${race.scoringNote === undefined ? "" : ` · ${race.scoringNote}`}`,
          `Segment ${race.scoringSegment} · race ${race.raceNumber} · ${track} · ${race.sourceKind.replaceAll("_", " ")}${race.countsTowardStandings ? "" : " · telt niet mee"}: ${race.placements.map((placement) => placement.displayName).join(" › ")}${race.scoringNote === undefined ? "" : ` · ${race.scoringNote}`}`,
        );
        races.append(item);
      }
      card.append(races);
    }

    // Import from Processor / Live output into this group.
    const importDetails = document.createElement("details");
    importDetails.className = "tournament-op__import";
    const importSummary = document.createElement("summary");
    importSummary.textContent = localized(
      "Offline fallback: import a saved Live / Processor result file",
      "Offline terugval: opgeslagen Live-/Processor-uitslagbestand importeren",
    );
    const importRoot = document.createElement("div");
    importDetails.append(importSummary, importRoot);
    importDetails.addEventListener("toggle", () => {
      if (!importDetails.open || importRoot.firstChild !== null) { return; }
      importSection?.unmount();
      importSection = mountTournamentCanonicalImportSection(importRoot, {
        onImported: (accepted) => {
          if (accepted.length === 0) { return; }
          void run(`Attaching ${accepted.length} race${accepted.length === 1 ? "" : "s"}`, () => client.attachRaces(
            document_.summary.tournamentId,
            { expectedRevision: document_.summary.revision, groupId: group.groupId, raceResultIds: accepted },
            controller.signal,
          ));
        },
      });
    });
    card.append(importDetails);

    if (group.races.length > 0) {
      const excelGuard = document.createElement("p");
      excelGuard.className = "tournament-op__warning";
      excelGuard.textContent = localized(
        "Excel totals are locked because this group already has accepted per-race results. Review or replace the existing races; scores are never added twice.",
        "Excel-totalen zijn geblokkeerd omdat deze groep al geaccepteerde race-uitslagen heeft. Controleer of vervang de bestaande races; scores worden nooit dubbel opgeteld.",
      );
      card.append(excelGuard);
    }

    // Manual totals (fallback when no per-race data exists).
    if (group.races.length === 0) {
      const excel = document.createElement("details");
      excel.className = "tournament-op__import";
      const excelSummary = document.createElement("summary");
      excelSummary.textContent = localized("Import Excel score workbook", "Excel-scorebestand importeren");
      const excelBody = document.createElement("div");
      const excelHint = document.createElement("p");
      excelHint.className = "tournament-op__hint";
      excelHint.textContent = localized(
        'Select Tournament_Results.xlsx with the "Final Standings" sheet. Review the video/group and explicitly match every Excel name to a Player.',
        'Selecteer Tournament_Results.xlsx met het tabblad "Final Standings". Controleer de video/groep en koppel iedere Excel-naam expliciet aan een speler.',
      );
      const excelFile = document.createElement("input");
      excelFile.type = "file";
      excelFile.accept = ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      excelFile.setAttribute("aria-label", localized(`Excel scores for ${group.name}`, `Excel-scores voor ${group.name}`));
      const excelPreview = document.createElement("div");
      excelBody.append(excelHint, excelFile, excelPreview);
      excel.append(excelSummary, excelBody);
      excelFile.addEventListener("change", () => {
        const selected = excelFile.files?.[0];
        if (selected === undefined) { return; }
        clear(excelPreview);
        say(localized("Reviewing Excel score workbook…", "Excel-scorebestand controleren…"));
        void fileAsDataUrl(selected)
          .then(async (workbookBase64) => {
            // The suggestion is only as good as the names it can see, so make
            // sure the aliases are loaded even when the incoming section that
            // usually fetches them was never rendered.
            if (participantAliases.size === 0) {
              const directory = await (players.listAll?.(controller.signal) ?? Promise.resolve([])).catch(() => []);
              const participantIds = new Set(document_.participants.map((participant) => participant.playerId));
              participantAliases = new Map(directory.filter((player) => participantIds.has(player.playerId))
                .map((player) => [player.playerId, player.aliases] as const));
            }
            return client.previewScoreWorkbook(document_.summary.tournamentId, workbookBase64, controller.signal);
          })
          .then((videos) => {
            if (disposed) { return; }
            const videoSelect = document.createElement("select");
            videoSelect.setAttribute("aria-label", `Excel video voor ${group.name}`);
            for (const video of videos) {
              const option = document.createElement("option");
              option.value = video.videoName;
              option.textContent = localized(
                `${video.videoName} · ${video.rows.length} Players`,
                `${video.videoName} · ${video.rows.length} spelers`,
              );
              videoSelect.append(option);
            }
            const preferred = videos.find((video) => video.videoName.toLocaleLowerCase("nl").includes(group.name.toLocaleLowerCase("nl")));
            if (preferred !== undefined) { videoSelect.value = preferred.videoName; }
            const mapping = document.createElement("div");
            const renderMapping = (): void => {
              clear(mapping);
              const video = videos.find((candidate) => candidate.videoName === videoSelect.value) ?? videos[0];
              if (video === undefined) { return; }
              const selectors: HTMLSelectElement[] = [];
              // Suggest through every name a participant answers to, not just
              // the display name, and say which name did it.
              const targets = group.members.map((member) => ({
                playerId: member.playerId,
                displayName: member.displayName,
                aliases: participantAliases.get(member.playerId) ?? [],
              }));
              const suggestions = suggestScoreMapping(
                video.rows.map((score) => ({ playerName: score.playerName, totalPoints: score.totalPoints })),
                targets,
              );
              for (const [index, score] of video.rows.entries()) {
                const suggestion = suggestions[index];
                const row = document.createElement("div");
                row.className = "tournament-op__manual-row tournament-op__match-row";
                const source = document.createElement("div");
                source.className = "tournament-op__match-source";
                const sourceName = document.createElement("strong");
                sourceName.textContent = score.playerName;
                const sourcePoints = document.createElement("span");
                sourcePoints.className = "tournament-op__hint";
                sourcePoints.textContent = localized(
                  `Points: ${score.totalPoints}`, `Punten: ${score.totalPoints}`,
                );
                source.append(sourceName, sourcePoints);
                const meta = scoreMatchLabel(suggestion?.confidence ?? null, suggestion?.viaAlias ?? false, false);
                const badgeRow = document.createElement("div");
                badgeRow.className = "tournament-op__match-meta";
                const badge = document.createElement("span");
                badge.className = `tournament-op__match-badge tournament-op__match-badge--${meta.tone}`;
                badge.textContent = meta.label;
                badgeRow.append(badge);
                const percent = scoreConfidencePercent(suggestion?.confidence ?? null);
                if (percent !== null) {
                  const similarity = document.createElement("span");
                  similarity.className = "tournament-op__hint";
                  similarity.textContent = percent;
                  badgeRow.append(similarity);
                }
                source.append(badgeRow);
                if (suggestion?.viaAlias === true && suggestion.matchedName !== null) {
                  const via = document.createElement("p");
                  via.className = "tournament-op__hint";
                  const matched = targets.find((candidate) => candidate.playerId === suggestion.playerId);
                  via.textContent = `via alias "${suggestion.matchedName}"${
                    matched === undefined ? "" : ` van ${matched.displayName}`}`;
                  source.append(via);
                }
                const target = document.createElement("select");
                target.setAttribute("aria-label", localized(`Match ${score.playerName}`, `Koppel ${score.playerName}`));
                const unresolved = document.createElement("option");
                unresolved.value = "";
                unresolved.textContent = localized("— choose Player —", "— kies speler —");
                target.append(unresolved);
                for (const member of targets) {
                  const option = document.createElement("option");
                  option.value = member.playerId;
                  // Naming the aliases in the option makes a hand-made choice
                  // as informed as the suggestion.
                  option.textContent = member.aliases.length === 0
                    ? member.displayName
                    : `${member.displayName} (${member.aliases.join(", ")})`;
                  target.append(option);
                }
                if (suggestion?.playerId != null) { target.value = suggestion.playerId; }
                selectors.push(target);
                row.append(source, target);
                mapping.append(row);
              }
              const apply = button(document, localized("Save reviewed Excel scores", "Gecontroleerde Excel-scores opslaan"), true);
              apply.addEventListener("click", () => {
                const playerIds = selectors.map((select) => select.value);
                if (playerIds.some((playerId) => playerId === "")) {
                  say(localized("Match every Excel name to a Player first.", "Koppel eerst iedere Excel-naam aan een speler.")); return;
                }
                if (new Set(playerIds).size !== playerIds.length) {
                  say(localized("Each Player can only be matched once.", "Iedere speler kan maar één keer gekoppeld worden.")); return;
                }
                const segmentCount = Math.max(1, ...video.rows.map((score) => score.pointSegments.length));
                if (video.rows.some((score) => score.pointSegments.length > 0 && score.pointSegments.length !== segmentCount)) {
                  say(localized(
                    "All Excel rows must have the same number of score segments.",
                    "Alle Excel-rijen moeten hetzelfde aantal scoredelen hebben.",
                  )); return;
                }
                void run(localized("Saving Excel scores", "Excel-scores opslaan"), () => client.setManualScores(document_.summary.tournamentId, {
                  expectedRevision: document_.summary.revision,
                  groupId: group.groupId,
                  segments: segmentCount,
                  scores: video.rows.map((score, index) => ({
                    playerId: playerIds[index]!,
                    segmentPoints: score.pointSegments.length === 0 ? [score.totalPoints] : score.pointSegments,
                  })),
                }, controller.signal));
              });
              mapping.append(apply);
            };
            videoSelect.addEventListener("change", renderMapping);
            excelPreview.append(field(document, localized("Excel video / group", "Excel-video / groep"), videoSelect), mapping);
            renderMapping();
            say(localized(
              "Excel reviewed. Check the matches before saving.",
              "Excel gecontroleerd. Controleer de koppelingen vóór opslaan.",
            ));
          })
          .catch((error: unknown) => say(error instanceof Error ? error.message : localized(
            "The Excel file could not be read.",
            "Excel-bestand kon niet worden gelezen.",
          )));
      });
      card.append(excel);

      const manual = document.createElement("section");
      manual.className = "tournament-op__manual";
      const manualSummary = document.createElement("h5");
      manualSummary.textContent = localized("Manual total scores", "Handmatige totaalscores");
      const manualHint = document.createElement("p");
      manualHint.className = "tournament-op__hint";
      manualHint.textContent = localized(
        "As in the original: choose 0–3 communication errors. Errors create separate score segments and the total is calculated automatically.",
        "Zoals in het origineel: kies 0–3 communication errors. Bij fouten verschijnen aparte scoredelen en wordt het totaal automatisch opgeteld.",
      );
      const manualForm = document.createElement("form");
      manualForm.className = "tournament-op__manual-form";
      const segments = document.createElement("input");
      segments.type = "range";
      segments.min = "1";
      segments.max = "4";
      segments.value = `${Math.min(4, group.manualScoreSegments)}`;
      const segmentField = field(document, `Communication errors: ${Number(segments.value) - 1}`, segments);
      manualForm.append(segmentField);
      const inputs = new Map<string, HTMLInputElement[]>();
      const grid = document.createElement("div");
      grid.className = "tournament-op__manual-grid";
      const liveTitle = document.createElement("h6");
      liveTitle.textContent = localized("Live standings while entering scores", "Tussenstand tijdens invoer");
      const liveStandings = document.createElement("ol");
      liveStandings.className = "tournament-op__standings";
      const updateLiveStandings = (): void => {
        clear(liveStandings);
        const ranked = group.members.map((member) => ({
          displayName: member.displayName,
          total: (inputs.get(member.playerId) ?? []).reduce((sum, input) => sum + (Number(input.value) || 0), 0),
        })).sort((left, right) => right.total - left.total || left.displayName.localeCompare(right.displayName, "nl"));
        for (const row of ranked) {
          const item = document.createElement("li");
          item.textContent = `${row.displayName} — ${row.total} pts`;
          liveStandings.append(item);
        }
      };
      const renderManualRows = (): void => {
        clear(grid);
        inputs.clear();
        const count = Math.max(1, Math.min(4, Number(segments.value) || 1));
        segmentField.firstChild!.textContent = `Communication errors: ${count - 1}`;
        for (const member of group.members) {
          const row = document.createElement("div");
          row.className = "tournament-op__manual-row";
          const name = document.createElement("span");
          name.textContent = member.displayName;
          row.append(name);
          const existing = group.manualScores.find((score) => score.playerId === member.playerId);
          const parts: HTMLInputElement[] = [];
          for (let index = 0; index < count; index += 1) {
            const input = document.createElement("input");
            input.type = "number";
            input.min = "0";
            input.max = "10000";
            input.setAttribute("aria-label", `${member.displayName} part ${index + 1}`);
            const value = existing?.segmentPoints[index];
            if (value !== undefined && value !== null) { input.value = `${value}`; }
            parts.push(input);
            row.append(input);
          }
          const total = document.createElement("strong");
          total.textContent = "0";
          total.setAttribute("aria-label", `${member.displayName} total`);
          const updateTotal = (): void => {
            total.textContent = `${parts.reduce((sum, input) => sum + (Number(input.value) || 0), 0)}`;
            updateLiveStandings();
          };
          parts.forEach((input) => input.addEventListener("input", updateTotal));
          updateTotal();
          row.append(total);
          inputs.set(member.playerId, parts);
          grid.append(row);
        }
        updateLiveStandings();
      };
      segments.addEventListener("change", renderManualRows);
      renderManualRows();
      const saveManual = document.createElement("button");
      saveManual.type = "submit";
      saveManual.className = "tt-auth__button";
      saveManual.textContent = localized("Save totals", "Totalen opslaan");
      manualForm.append(grid, liveTitle, liveStandings, saveManual);
      manualForm.addEventListener("submit", (event) => {
        event.preventDefault();
        const count = Math.max(1, Math.min(4, Number(segments.value) || 1));
        void run(localized("Saving totals", "Totalen opslaan"), () => client.setManualScores(
          document_.summary.tournamentId,
          {
            expectedRevision: document_.summary.revision,
            groupId: group.groupId,
            segments: count,
            scores: [...inputs.entries()].map(([playerId, parts]) => ({
              playerId,
              segmentPoints: parts.map((input) => input.value.trim() === "" ? null : Number(input.value)),
            })),
          },
          controller.signal,
        ));
      });
      manual.append(manualSummary, manualHint, manualForm);
      card.append(manual);
    }
    return card;
  };

  // Keep the compact legacy renderer available while finalized historical
  // documents still depend on its full race-editing controls.
  void renderGroups;

  const renderScoreEntryStep = (
    document_: TournamentDocument,
    stage: TournamentGroupStage,
    stepNumber: 5 | 9,
  ): void => {
    const qualifier = stage === "qualifier";
    const groups = document_.groups.filter((group) => group.stage === stage)
      .sort((left, right) => left.sequence - right.sequence);
    const scoreLabel = qualifier
      ? localized("qualifier scores", "kwalificatiescores")
      : localized("final scores", "eindgroepscores");
    const section = document.createElement("section");
    section.className = "tournament-score-step";

    const tieDetails = document.createElement("details");
    tieDetails.className = "tournament-score-step__details";
    const tieSummary = document.createElement("summary");
    tieSummary.textContent = localized(
      `Tie-break setting for equal ${scoreLabel} (Step ${stepNumber})`,
      `Instelling voor gelijke ${scoreLabel} (Stap ${stepNumber})`,
    );
    const tieBody = document.createElement("div");
    tieBody.className = "tournament-score-step__details-body";
    const tieIntro = document.createElement("p");
    tieIntro.className = "tournament-op__hint";
    tieIntro.textContent = localized(
      "For equal total scores, only the selected method decides. Wins and best race are shown only as context.",
      "Na een gelijke totaalscore beslist alleen de gekozen methode. Overwinningen en beste race worden uitsluitend als context getoond.",
    );
    const tieQuestion = document.createElement("strong");
    tieQuestion.textContent = localized("How do we resolve an exact tie?", "Wat doen we bij exact gelijke stand?");
    const tieModes = document.createElement("div");
    tieModes.className = "tournament-score-step__tie-modes";
    const selectedMode = qualifier ? document_.summary.qualifierTieBreakMode : document_.summary.finalTieBreakMode;
    for (const [mode, label] of [
      ["sp", localized("SP · highest SP, then SP Rank", "SP · hoogste SP, daarna SP-rang")],
      ["lottery", localized("Lottery · random and fixed for this tournament", "Loting · willekeurig en vast voor dit toernooi")],
      ["manual", localized("Manual · set the order for each tie", "Handmatig · bepaal de volgorde per gelijk spel")],
    ] as const) {
      const choice = button(document, label);
      choice.classList.toggle("is-selected", selectedMode === mode);
      choice.disabled = selectedMode === mode;
      choice.addEventListener("click", () => void run(localized("Setting tie-break", "Tie-break instellen"), () => client.update(
        document_.summary.tournamentId,
        {
          expectedRevision: document_.summary.revision,
          ...(qualifier ? { qualifierTieBreakMode: mode } : { finalTieBreakMode: mode }),
        },
        controller.signal,
      )));
      tieModes.append(choice);
    }
    tieBody.append(tieIntro, tieQuestion, tieModes);
    tieDetails.append(tieSummary, tieBody);
    section.append(tieDetails);

    const unresolved = groups.flatMap((group) => (group.standings.tieGroups ?? [])
      .filter((tie) => !tie.resolved).map((tie) => ({ group, tie })));
    if (selectedMode === "manual") {
      for (const { group, tie } of groups.flatMap((candidate) => (candidate.standings.tieGroups ?? [])
        .map((tie) => ({ group: candidate, tie })))) {
        const card = document.createElement("section");
        card.className = `tournament-score-step__tie-card${tie.resolved ? " is-resolved" : ""}`;
        const title = document.createElement("h4");
        title.textContent = localized(
          `${displayGroupLabel(group)} · ${tie.points} points · ${tie.resolved ? "resolved" : "choice needed"}`,
          `${displayGroupLabel(group)} · ${tie.points} punten · ${tie.resolved ? "opgelost" : "keuze nodig"}`,
        );
        const hint = document.createElement("p");
        hint.className = "tournament-op__hint";
        hint.textContent = localized(
          "Put the Player who should finish higher at the top. Wins and best race are informational only.",
          "Zet de speler die hoger moet eindigen bovenaan. Winst en beste race zijn alleen informatie.",
        );
        const order = [...tie.players];
        const list = document.createElement("ol");
        const renderOrder = (): void => {
          clear(list);
          order.forEach((player, index) => {
            const row = document.createElement("li");
            const name = document.createElement("span");
            name.textContent = localized(
              `${player.displayName} · ${player.wins} wins · best race ${player.bestRace}`,
              `${player.displayName} · ${player.wins} winst · beste race ${player.bestRace}`,
            );
            const up = button(document, "↑"); up.disabled = index === 0;
            const down = button(document, "↓"); down.disabled = index === order.length - 1;
            up.setAttribute("aria-label", localized(`${player.displayName} up`, `${player.displayName} omhoog`));
            down.setAttribute("aria-label", localized(`${player.displayName} down`, `${player.displayName} omlaag`));
            up.addEventListener("click", () => { order.splice(index - 1, 0, order.splice(index, 1)[0]!); renderOrder(); });
            down.addEventListener("click", () => { order.splice(index + 1, 0, order.splice(index, 1)[0]!); renderOrder(); });
            row.append(name, up, down); list.append(row);
          });
        };
        renderOrder();
        const save = button(document, localized("Save order", "Volgorde opslaan"), true);
        save.addEventListener("click", () => void run(localized("Saving tie-break order", "Tie-breakvolgorde opslaan"), () => client.setTieBreakOrder(
          document_.summary.tournamentId,
          { expectedRevision: document_.summary.revision, groupId: group.groupId,
            points: tie.points, playerIds: order.map((player) => player.playerId) },
          controller.signal,
        )));
        card.append(title, hint, list, save); section.append(card);
      }
    }

    const excel = document.createElement("details");
    excel.className = "tournament-score-step__details tournament-score-step__excel";
    const excelSummary = document.createElement("summary");
    excelSummary.textContent = localized("Import scores from Excel (optional)", "Scores importeren uit Excel (optioneel)");
    const excelBody = document.createElement("div");
    excelBody.className = "tournament-score-step__details-body";
    const excelTitle = document.createElement("h3");
    excelTitle.textContent = localized("Import Tournament_Results.xlsx", "Importeer Tournament_Results.xlsx");
    const excelHint = document.createElement("p");
    excelHint.className = "tournament-op__hint";
    excelHint.textContent = localized(
      `Read Final Standings and Results, match one video per group, review the suggested matches, and import races into Step ${stepNumber}. Clear matches are preselected.`,
      `Lees Final Standings en Results, koppel per groep een video, controleer de voorgestelde matches en importeer de races gefaseerd in Stap ${stepNumber}. Duidelijke matches worden alvast voorgeselecteerd.`,
    );
    const excelFile = document.createElement("input");
    excelFile.type = "file";
    excelFile.accept = ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    excelFile.setAttribute("aria-label", localized("Choose score workbook", "Kies scorewerkboek"));
    const excelPreview = document.createElement("div");
    excelPreview.className = "tournament-score-step__excel-preview";
    const loadedLine = document.createElement("p");
    loadedLine.className = "tournament-op__hint tournament-score-step__excel-loaded";
    loadedLine.setAttribute("role", "status");
    excelFile.addEventListener("change", () => {
      const selected = excelFile.files?.[0];
      if (selected === undefined) { return; }
      clear(excelPreview);
      say(localized("Reviewing Excel score workbook…", "Excel-scorebestand controleren…"));
      void fileAsDataUrl(selected)
        .then(async (workbookBase64) => {
          // The suggestion is only as good as the names it can see, so make
          // sure the aliases are loaded even when the incoming section that
          // usually fetches them was never rendered.
          if (participantAliases.size === 0) {
            const directory = await (players.listAll?.(controller.signal) ?? Promise.resolve([])).catch(() => []);
            const participantIds = new Set(document_.participants.map((participant) => participant.playerId));
            participantAliases = new Map(directory.filter((player) => participantIds.has(player.playerId))
              .map((player) => [player.playerId, player.aliases] as const));
          }
          return client.previewScoreWorkbook(document_.summary.tournamentId, workbookBase64, controller.signal);
        })
        .then((videos) => {
          scoreWorkbook = { step: stepNumber, fileName: selected.name, videos };
          scoreImportMessages.clear();
          scoreImportChoices.clear();
          scoreImportedGroups.clear();
          renderWorkbookReview(videos, selected.name);
        })
        .catch((error: unknown) => say(errorText(error, localized(
          "The Excel file could not be read.",
          "Excel-bestand kon niet worden gelezen.",
        ))));
    });

    /** Everything a group's block would send, or the reason it cannot. */
    type BuiltImport =
      | Readonly<{
        ok: true;
        races: readonly Readonly<{ raceNumber?: number; trackId: string; mode?: TournamentRaceMode; mirror?: true; finishOrder: readonly string[] }>[];
        characters: readonly Readonly<{
          playerId: string; characterKey?: string; characterLabel: string; characterRoster?: string;
        }>[];
        /** Points from before the recording, to add to the race totals as a correction. */
        carried: readonly Readonly<{ playerId: string; points: number }>[];
      }>
      | Readonly<{ ok: false; message: string }>;
    /** What each block tells the line above the review about itself. */
    type ReadyGroup = Readonly<{
      groupId: string; name: string; raceCount: number; ready: boolean; imported: boolean;
      build: () => BuiltImport; say: (message: string) => void;
    }>;
    const importable = new Map<string, ReadyGroup>();
    // Three groups in order meant three presses and three waits. One button
    // takes every reviewed group that is left, in order (owner, 2026-09-16).
    const importAllBox = document.createElement("div");
    importAllBox.className = "tournament-score-step__excel-all";
    importAllBox.hidden = true;
    const importAllLine = document.createElement("p");
    importAllLine.className = "tournament-op__hint";
    importAllLine.setAttribute("role", "status");
    const importAllButton = button(document, localized("Import all groups", "Alle groepen inladen"), true);
    importAllButton.disabled = true;
    importAllBox.append(importAllLine, importAllButton);

    /**
     * Send these groups one after another and refresh the view once, at the
     * end: every call answers with the whole document, so the next group rides
     * on the revision the previous one returned. A group either lands whole or
     * not at all, and the one that failed says so by name.
     */
    const importGroups = (entries: readonly ReadyGroup[]): void => {
      if (entries.length === 0) { return; }
      const startedAt = Date.now();
      const seconds = (): number => Math.round((Date.now() - startedAt) / 1000);
      const sending: Readonly<{
        entry: ReadyGroup;
        races: readonly Readonly<{ raceNumber?: number; trackId: string; mode?: TournamentRaceMode; mirror?: true; finishOrder: readonly string[] }>[];
        characters: readonly Readonly<{
          playerId: string; characterKey?: string; characterLabel: string; characterRoster?: string;
        }>[];
        carried: readonly Readonly<{ playerId: string; points: number }>[];
      }>[] = [];
      for (const entry of entries) {
        const built = entry.build();
        if (built.ok) { sending.push({ entry, races: built.races, characters: built.characters, carried: built.carried }); }
        else { entry.say(built.message); }
      }
      if (sending.length === 0) { paintImportAll(); return; }
      const waiting = new Set(sending.map((item) => item.entry.groupId));
      // Without a clock ticking, a long import reads as a hang.
      const tick = (): void => {
        for (const item of sending) {
          if (!waiting.has(item.entry.groupId)) { continue; }
          item.entry.say(localized(
            `Importing ${item.entry.raceCount} races into ${item.entry.name}… ${seconds()}s`,
            `${item.entry.raceCount} races overnemen in ${item.entry.name}… ${seconds()}s`,
          ));
        }
      };
      tick();
      const ticking = setInterval(tick, 1000);
      importAllButton.disabled = true;
      const total = sending.reduce((sum, item) => sum + item.entry.raceCount, 0);
      void run(
        sending.length === 1
          ? localized("Importing Excel races", "Excel-races overnemen")
          : localized(
            `Importing ${total} Excel races from ${sending.length} groups`,
            `${total} Excel-races uit ${sending.length} groepen overnemen`,
          ),
        async () => {
          let updated: TournamentDocument | undefined;
          let revision = document_.summary.revision;
          try {
            for (const item of sending) {
              updated = await client.enterRaces(
                document_.summary.tournamentId,
                {
                  expectedRevision: revision, groupId: item.entry.groupId, races: item.races,
                  ...(item.characters.length === 0 ? {} : { characters: item.characters }),
                },
                controller.signal,
              );
              revision = updated.summary.revision;
              // A recording that started after race 1: the races hold only
              // the recorded part, so the earlier points become a correction
              // on top of what the races add up to (never on a correction).
              let carriedNote = { en: "", nl: "" };
              if (item.carried.length > 0) {
                const standing = new Map((updated.groups.find((entry) => entry.groupId === item.entry.groupId)?.standings.rows ?? [])
                  .map((row) => [row.playerId, row.correctedFromRaces ?? row.points] as const));
                const scores = item.carried.flatMap((entry) => {
                  const fromRaces = standing.get(entry.playerId);
                  return fromRaces === undefined ? [] : [{ playerId: entry.playerId, segmentPoints: [fromRaces + entry.points] }];
                });
                if (scores.length > 0) {
                  updated = await client.setManualScores(
                    document_.summary.tournamentId,
                    { expectedRevision: revision, groupId: item.entry.groupId, segments: 1, scores },
                    controller.signal,
                  );
                  revision = updated.summary.revision;
                  carriedNote = {
                    en: ` Points from before the recording added as a correction for ${scores.length} Player(s).`,
                    nl: ` Punten van vóór de opname als correctie opgeteld bij ${scores.length} speler(s).`,
                  };
                }
              }
              waiting.delete(item.entry.groupId);
              scoreImportedGroups.add(item.entry.groupId);
              // The tick is the server's answer, not the click: a block that
              // folded away on the click would say "imported" even when the
              // call had failed.
              item.entry.say(localized(
                `\u2713 ${item.entry.raceCount} races imported into ${item.entry.name}${item.characters.length === 0 ? "" : `, with ${item.characters.length} character(s)`}, in ${seconds()}s.${carriedNote.en}`,
                `\u2713 ${item.entry.raceCount} races overgenomen in ${item.entry.name}${item.characters.length === 0 ? "" : `, met ${item.characters.length} personage(s)`}, in ${seconds()}s.${carriedNote.nl}`,
              ));
            }
          } catch (error) {
            const stuck = sending.find((item) => waiting.has(item.entry.groupId));
            if (stuck !== undefined) {
              stuck.entry.say(errorText(error, localized(
                `${stuck.entry.name} was not imported.`,
                `${stuck.entry.name} is niet overgenomen.`,
              )));
            }
            throw error;
          } finally {
            clearInterval(ticking);
          }
          return updated;
        },
      );
    };

    /** The line above the blocks: how many groups are left, and are they ready. */
    const paintImportAll = (): void => {
      const entries = [...importable.values()];
      const remaining = entries.filter((entry) => !entry.imported);
      const ready = remaining.filter((entry) => entry.ready);
      const waitingOn = remaining.filter((entry) => !entry.ready).map((entry) => entry.name);
      const races = ready.reduce((sum, entry) => sum + entry.raceCount, 0);
      importAllBox.hidden = entries.length < 2;
      if (entries.length < 2) { return; }
      const one = remaining.length === 1;
      importAllLine.textContent = remaining.length === 0
        ? localized(
          `All ${entries.length} groups imported.`,
          `Alle ${entries.length} groepen zijn overgenomen.`,
        )
        : waitingOn.length === 0
          ? localized(
            one
              ? `One group left, reviewed: ${races} races ready.`
              : `${remaining.length} groups left, all reviewed: ${races} races ready.`,
            one
              ? `Nog één groep te gaan, gecontroleerd: ${races} races klaar.`
              : `Nog ${remaining.length} groepen te gaan, allemaal gecontroleerd: ${races} races klaar.`,
          )
          : localized(
            `${ready.length} of ${remaining.length} remaining ${one ? "group" : "groups"} ready. Still to match: ${waitingOn.join(", ")}.`,
            `${ready.length} van de ${remaining.length} resterende ${one ? "groep" : "groepen"} klaar. Nog koppelen: ${waitingOn.join(", ")}.`,
          );
      importAllButton.hidden = remaining.length === 0;
      importAllButton.disabled = remaining.length === 0 || ready.length !== remaining.length;
      importAllButton.textContent = one
        ? localized(`Import the last group · ${races} races`, `Laatste groep inladen · ${races} races`)
        : localized(
          `Import all ${remaining.length} groups · ${races} races`,
          `Alle ${remaining.length} groepen inladen · ${races} races`,
        );
      importAllButton.title = waitingOn.length === 0 ? "" : localized(
        `Match these groups first: ${waitingOn.join(", ")}`,
        `Koppel eerst deze groepen: ${waitingOn.join(", ")}`,
      );
    };
    importAllButton.addEventListener("click", () => {
      importGroups([...importable.values()].filter((entry) => !entry.imported && entry.ready));
    });

    /**
     * One review block per group: which Excel video it takes, how many names
     * are matched, what still stands in the way, and its own answer after the
     * button is pressed. The file stays loaded so the other groups follow
     * without picking it again.
     */
    function renderWorkbookReview(videos: ScoreWorkbookPreview, fileName: string): void {
      clear(excelPreview);
      importable.clear();
      paintImportAll();
      loadedLine.textContent = localized(
        `Loaded: ${fileName} · ${videos.length} video${videos.length === 1 ? "" : "s"}. The file stays loaded until you choose another one.`,
        `Geladen: ${fileName} · ${videos.length} video${videos.length === 1 ? "" : "'s"}. Het bestand blijft geladen tot je een ander kiest.`,
      );
      {
          for (const group of groups) {
            const review = document.createElement("section");
            review.className = "tournament-score-step__excel-group";
            const title = document.createElement("h4"); title.textContent = displayGroupLabel(group);
            const videoSelect = document.createElement("select");
            videoSelect.setAttribute("aria-label", localized(`Excel video for ${group.name}`, `Excel-video voor ${group.name}`));
            for (const video of videos) {
              const option = document.createElement("option"); option.value = video.videoName;
              option.textContent = localized(
                `${video.videoName} · ${video.rows.length} Players · ${video.races.length} races`,
                `${video.videoName} · ${video.rows.length} spelers · ${video.races.length} races`,
              );
              videoSelect.append(option);
            }
            const preferred = videos.find((video) => normalizedWorkbookName(video.videoName)
              .includes(normalizedWorkbookName(group.name)));
            if (preferred !== undefined) { videoSelect.value = preferred.videoName; }
            const mapping = document.createElement("div");
            const renderMapping = (): void => {
              clear(mapping);
              const video = videos.find((candidate) => candidate.videoName === videoSelect.value) ?? videos[0];
              if (video === undefined) { return; }
              const targets = new Map<string, HTMLSelectElement>();
              const selects: HTMLSelectElement[] = [];
              // The source's own answer to "did I pick this Player twice?":
              // every option carries how often it is currently taken and is
              // coloured by it - green at exactly one, red at two or more.
              // A participant belongs to exactly one workbook row, so the
              // counter is the check, not a decoration.
              const paintSelectionCounts = (): void => {
                const counts = new Map<string, number>();
                for (const select of selects) {
                  if (select.value === "") { continue; }
                  counts.set(select.value, (counts.get(select.value) ?? 0) + 1);
                }
                for (const select of selects) {
                  for (const option of [...select.options]) {
                    if (option.value === "") { continue; }
                    const member = candidates.find((candidate) => candidate.playerId === option.value);
                    const count = counts.get(option.value) ?? 0;
                    option.textContent = `${member?.displayName ?? option.value} [${count}]${
                      member === undefined || member.aliases.length === 0
                        ? ""
                        : ` (${member.aliases.join(", ")})`}`;
                    option.className = count >= 2
                      ? "tournament-op__match-option tournament-op__match-option--duplicate"
                      : count === 1
                        ? "tournament-op__match-option tournament-op__match-option--taken"
                        : "tournament-op__match-option";
                  }
                  // A native select on some platforms ignores option colours,
                  // so the control itself carries the state where the operator
                  // is looking: green once it names exactly one Player of this
                  // group, red while it names nobody or the same Player as
                  // another row (owner, 2026-09-16).
                  const own = select.value === "" ? 0 : counts.get(select.value) ?? 0;
                  select.classList.toggle("is-duplicate", own >= 2);
                  select.classList.toggle("is-once", own === 1);
                  select.classList.toggle("is-open", select.value === "");
                }
              };
              // Suggest through every name a participant answers to - the
              // display name and the public aliases - and say which name did
              // it. Exact display-name matching alone left an in-game handle
              // like "Sounder" unmatched, and every row had to be pointed by
              // hand.
              const candidates = group.members.map((member) => ({
                playerId: member.playerId,
                displayName: member.displayName,
                aliases: participantAliases.get(member.playerId) ?? [],
              }));
              const suggestions = suggestScoreMapping(
                video.rows.map((score) => ({ playerName: score.playerName, totalPoints: score.totalPoints })),
                candidates,
              );
              for (const [index, score] of video.rows.entries()) {
                const suggestion = suggestions[index];
                const row = document.createElement("div");
                row.className = "tournament-op__manual-row tournament-op__match-row";
                const source = document.createElement("div");
                source.className = "tournament-op__match-source";
                const sourceName = document.createElement("strong");
                sourceName.textContent = score.playerName;
                const sourcePoints = document.createElement("span");
                sourcePoints.className = "tournament-op__hint";
                // A recording split by a connection error scores in parts,
                // and the workbook keeps them: `Points Segment 1`, `2`, ... The
                // original writes the sum out, so a Director can see at a
                // glance that the halves add up to the total they expect.
                const segments = score.pointSegments;
                const summed = segments.reduce((total, part) => total + part, 0);
                sourcePoints.textContent = segments.length < 2
                  ? localized(`Points: ${score.totalPoints}`, `Punten: ${score.totalPoints}`)
                  : localized(
                    `Points: ${segments.join(" + ")} = ${summed}`,
                    `Punten: ${segments.join(" + ")} = ${summed}`,
                  );
                if (segments.length >= 2 && summed !== score.totalPoints) {
                  // The parts and the total disagreeing is the file's own
                  // problem, and saying so beats importing it quietly.
                  sourcePoints.textContent += localized(
                    ` — the file says ${score.totalPoints}`,
                    ` — het bestand zegt ${score.totalPoints}`,
                  );
                  sourcePoints.className = "tournament-op__hint tournament-score-step__segment-mismatch";
                }
                source.append(sourceName, sourcePoints);
                const meta = scoreMatchLabel(suggestion?.confidence ?? null, suggestion?.viaAlias ?? false, false);
                const badgeRow = document.createElement("div");
                badgeRow.className = "tournament-op__match-meta";
                const badge = document.createElement("span");
                badge.className = `tournament-op__match-badge tournament-op__match-badge--${meta.tone}`;
                badge.textContent = meta.label;
                badgeRow.append(badge);
                const percent = scoreConfidencePercent(suggestion?.confidence ?? null);
                if (percent !== null) {
                  const similarity = document.createElement("span");
                  similarity.className = "tournament-op__hint";
                  similarity.textContent = percent;
                  badgeRow.append(similarity);
                }
                source.append(badgeRow);
                if (suggestion?.viaAlias === true && suggestion.matchedName !== null) {
                  const via = document.createElement("p");
                  via.className = "tournament-op__hint";
                  const matched = candidates.find((candidate) => candidate.playerId === suggestion.playerId);
                  via.textContent = `via alias "${suggestion.matchedName}"${
                    matched === undefined ? "" : ` van ${matched.displayName}`}`;
                  source.append(via);
                }
                const target = document.createElement("select"); target.setAttribute("aria-label", localized(`Match ${score.playerName}`, `Koppel ${score.playerName}`));
                const unresolvedOption = document.createElement("option"); unresolvedOption.value = "";
                unresolvedOption.textContent = localized("— choose Player —", "— kies speler —"); target.append(unresolvedOption);
                for (const member of candidates) {
                  const option = document.createElement("option"); option.value = member.playerId;
                  // Naming the aliases in the option makes a hand-made choice
                  // as informed as the suggestion.
                  option.textContent = member.aliases.length === 0
                    ? member.displayName
                    : `${member.displayName} (${member.aliases.join(", ")})`;
                  target.append(option);
                }
                const workbookName = normalizedWorkbookName(score.playerName);
                // What the operator chose beats what the suggestion guessed:
                // they have already looked at this row once.
                const remembered = scoreImportChoices.get(group.groupId)?.get(workbookName);
                if (remembered !== undefined && candidates.some((candidate) => candidate.playerId === remembered)) {
                  target.value = remembered;
                } else if (suggestion?.playerId != null) {
                  target.value = suggestion.playerId;
                }
                targets.set(workbookName, target);
                selects.push(target);
                target.addEventListener("change", () => {
                  const chosen = scoreImportChoices.get(group.groupId) ?? new Map<string, string>();
                  if (target.value === "") { chosen.delete(workbookName); } else { chosen.set(workbookName, target.value); }
                  scoreImportChoices.set(group.groupId, chosen);
                });
                target.addEventListener("change", paintSelectionCounts);
                row.append(source, target); mapping.append(row);
              }
              paintSelectionCounts();
              const raceStatus = document.createElement("p"); raceStatus.className = "tournament-op__hint";
              // The answer to "is everybody matched, and will this work?",
              // beside the button that does it, refreshed on every change.
              const readiness = document.createElement("p");
              readiness.className = "tournament-score-step__excel-readiness";
              readiness.setAttribute("role", "status");
              // Races the extractor left without a track (placeholder): the
              // file needs the track before it can be imported.
              // The recording started after race 1: the file's first race
              // already shows totals the races in it do not contain.
              const carriedPoints = video.carriedPoints ?? [];
              const carriedExample = `${carriedPoints.slice(0, 3).map((entry) => `${entry.playerName} ${entry.points}`).join(", ")}${carriedPoints.length > 3 ? ", …" : ""}`;
              const carriedChoice = document.createElement("label");
              carriedChoice.className = "tournament-score-step__excel-carried";
              const carriedBox = document.createElement("input");
              carriedBox.type = "checkbox";
              carriedBox.checked = true;
              carriedChoice.append(carriedBox, ` ${localized(
                `Recording started after race 1: count the points from before it (${carriedExample}) as a correction on the race totals`,
                `Opname begon na race 1: tel de punten van vóór de opname (${carriedExample}) als correctie bij de race-totalen op`,
              )}`);
              carriedChoice.hidden = carriedPoints.length === 0;
              const unfilledTrackRaces = video.races.filter((race) => isWorkbookTrackPlaceholder(race.trackName))
                .map((race) => race.raceNumber);
              const unrecognizedTracks = [...new Set(video.races.map((race) => race.trackName)
                .filter((track) => !isWorkbookTrackPlaceholder(track) && tournamentWorkbookTrackId(track) === null))];
      /**
       * What still stands between this group and the button. The owner pressed
       * it on two groups that could never accept it and saw nothing happen
       * (2026-09-16): the only sign was a bullet instead of a tick at the head
       * of a long line. This is the same check the button itself performs, so
       * the two can never disagree.
       */
              const blockers = (): Readonly<{ names: readonly string[]; duplicates: readonly string[]; unfilled: readonly number[]; tracks: readonly string[]; hasRaces: boolean }> => {
                const matched = new Map([...targets].flatMap(([name, target]) =>
                  target.value === "" ? [] : [[name, target.value] as const]));
                const counts = new Map<string, number>();
                for (const select of selects) {
                  if (select.value === "") { continue; }
                  counts.set(select.value, (counts.get(select.value) ?? 0) + 1);
                }
                return {
                  names: [...new Set(video.races.flatMap((race) => race.finishOrder)
                    .filter((name) => !matched.has(normalizedWorkbookName(name))))],
                  duplicates: [...counts].filter(([, count]) => count >= 2)
                    .map(([playerId]) => candidates.find((candidate) => candidate.playerId === playerId)?.displayName ?? playerId),
                  unfilled: unfilledTrackRaces,
                  tracks: unrecognizedTracks,
                  hasRaces: video.races.length > 0,
                };
              };
              const paintReadiness = (): void => {
                const chosen = selects.filter((select) => select.value !== "").length;
                const counts = new Map<string, number>();
                for (const select of selects) {
                  if (select.value === "") { continue; }
                  counts.set(select.value, (counts.get(select.value) ?? 0) + 1);
                }
                const twice = [...counts.values()].filter((count) => count >= 2).length;
                const parts = [
                  localized(`${chosen} of ${selects.length} names matched`, `${chosen} van de ${selects.length} namen gekoppeld`),
                  ...(twice > 0 ? [localized(`${twice} Player${twice === 1 ? "" : "s"} chosen twice`, `${twice} speler${twice === 1 ? "" : "s"} dubbel gekozen`)] : []),
                  localized(`${video.races.length} races in the file`, `${video.races.length} races in het bestand`),
                  ...(unfilledTrackRaces.length > 0
                    ? [localized(`track not filled in: race ${unfilledTrackRaces.join(", ")}`, `baan nog niet ingevuld: race ${unfilledTrackRaces.join(", ")}`)]
                    : []),
                  ...(carriedPoints.length > 0
                    ? [localized(
                      `recording started late: ${carriedPoints.length} Player(s) have points from before it`,
                      `opname begon later: ${carriedPoints.length} speler(s) hebben punten van vóór de opname`,
                    )]
                    : []),
                  ...(unrecognizedTracks.length > 0
                    ? [localized(`unknown tracks: ${unrecognizedTracks.join(", ")}`, `onbekende banen: ${unrecognizedTracks.join(", ")}`)]
                    : []),
                  ...(group.races.length > 0
                    ? [localized(`${group.races.length} races already imported`, `${group.races.length} races al overgenomen`)]
                    : []),
                  ...(video.rows.some((score) => (score.character ?? "").trim().length > 0)
                    ? [localized("characters recorded", "personages vastgelegd")]
                    : []),
                ];
                const stop = blockers();
                const ready = stop.hasRaces && stop.names.length === 0 && stop.duplicates.length === 0 && stop.unfilled.length === 0 && stop.tracks.length === 0;
                readiness.className = `tournament-score-step__excel-readiness tournament-score-step__excel-readiness--${ready ? "ready" : "blocked"}`;
                readiness.textContent = `${ready ? "✓" : "•"} ${parts.join(" · ")}`;
                // The button either says what it will do, or is out and says why.
                const few = (list: readonly string[]): string => `${list.slice(0, 3).join(", ")}${list.length > 3 ? "…" : ""}`;
                const why = !stop.hasRaces
                  ? localized("The file holds no races for this group.", "Het bestand bevat geen races voor deze groep.")
                  : stop.unfilled.length > 0
                    ? unfilledTrackMessage(stop.unfilled)
                  : stop.names.length > 0
                    ? localized(
                      `Match ${stop.names.length} more name(s) first: ${few(stop.names)}`,
                      `Koppel eerst nog ${stop.names.length} ${stop.names.length === 1 ? "naam" : "namen"}: ${few(stop.names)}`,
                    )
                    : stop.duplicates.length > 0
                      ? localized(`Each Player once. Chosen twice: ${few(stop.duplicates)}`, `Elke speler één keer. Dubbel gekozen: ${few(stop.duplicates)}`)
                      : stop.tracks.length > 0
                        ? localized(`These tracks are not recognised: ${few(stop.tracks)}`, `Deze banen zijn niet herkend: ${few(stop.tracks)}`)
                        : "";
                blocked.textContent = why;
                blocked.hidden = ready;
                apply.disabled = !ready;
                apply.textContent = ready
                  ? localized(`Import ${video.races.length} reviewed races`, `${video.races.length} gecontroleerde races overnemen`)
                  : localized("Import reviewed races", "Gecontroleerde races overnemen");
                apply.title = why;
                importable.set(group.groupId, {
                  groupId: group.groupId, name: displayGroupLabel(group), raceCount: video.races.length,
                  ready, imported: false, build, say: sayGroup,
                });
                paintImportAll();
              };
              for (const select of selects) { select.addEventListener("change", paintReadiness); }
              const importMessage = document.createElement("p");
              importMessage.className = "tournament-score-step__excel-message";
              importMessage.setAttribute("role", "status");
              const kept = scoreImportMessages.get(group.groupId);
              if (kept !== undefined) { importMessage.textContent = kept; }
              const sayGroup = (message: string): void => {
                scoreImportMessages.set(group.groupId, message);
                importMessage.textContent = message;
              };
              raceStatus.textContent = video.races.length === 0
                ? localized(
                  "The Results sheet has no importable races for this video. Nothing will be applied.",
                  "Het tabblad Results bevat voor deze video geen importeerbare races. Er wordt niets toegepast.",
                )
                : localized(
                  `${video.races.length} races from Results will be imported after full review.`,
                  `${video.races.length} races uit Results worden na volledige controle overgenomen.`,
                );
              const apply = button(document, localized("Import reviewed races", "Gecontroleerde races overnemen"), true);
              apply.disabled = true;
              const blocked = document.createElement("p");
              blocked.className = "tournament-score-step__excel-blocked";
              blocked.setAttribute("role", "status");
              blocked.hidden = true;
              // Once a group is in, its matching block has nothing left to ask.
              // It says what happened and folds itself away; the workbook stays
              // loaded because the other groups still need it.
              if (scoreImportedGroups.has(group.groupId)) {
                clear(mapping);
                const done = document.createElement("p");
                done.className = "tournament-score-step__excel-message tournament-score-step__excel-message--done";
                done.setAttribute("role", "status");
                done.textContent = scoreImportMessages.get(group.groupId)
                  ?? localized("Imported.", "Overgenomen.");
                const again = button(document, localized("Match again", "Opnieuw koppelen"));
                again.addEventListener("click", () => {
                  scoreImportedGroups.delete(group.groupId);
                  renderMapping();
                });
                mapping.append(done, again);
                // It still counts for the line above: "all three imported".
                importable.set(group.groupId, {
                  groupId: group.groupId, name: displayGroupLabel(group), raceCount: video.races.length,
                  ready: false, imported: true, build: () => ({ ok: false, message: "" }), say: sayGroup,
                });
                paintImportAll();
                return;
              }
              /**
               * Everything this group would send, or the reason it cannot. It
               * asks the same `blockers()` the readiness line does, so the two
               * can never disagree about whether the group may go.
               */
              const build = (): BuiltImport => {
                const playerByName = new Map([...targets].flatMap(([name, target]) =>
                  target.value === "" ? [] : [[name, target.value] as const]));
                const stop = blockers();
                if (stop.duplicates.length > 0) {
                  return { ok: false, message: localized(
                    `Not imported. Each Player may be matched once. Chosen more than once: ${stop.duplicates.join(", ")}.`,
                    `Niet overgenomen. Elke speler mag één keer gekoppeld worden. Dubbele spelerkeuze: ${stop.duplicates.join(", ")}.`,
                  ) };
                }
                if (stop.names.length > 0) {
                  return { ok: false, message: localized(
                    `Not imported. Match these names from the file first: ${stop.names.join(", ")}.`,
                    `Niet overgenomen. Koppel eerst deze namen uit het bestand: ${stop.names.join(", ")}.`,
                  ) };
                }
                if (stop.unfilled.length > 0) {
                  return { ok: false, message: `${localized("Not imported.", "Niet overgenomen.")} ${unfilledTrackMessage(stop.unfilled)}` };
                }
                if (stop.tracks.length > 0) {
                  return { ok: false, message: localized(
                    `Not imported. These tracks were not recognized: ${stop.tracks.join(", ")}.`,
                    `Niet overgenomen. Deze banen zijn niet herkend: ${stop.tracks.join(", ")}.`,
                  ) };
                }
                if (!stop.hasRaces) {
                  return { ok: false, message: localized(
                    "Not imported. The file holds no races for this group.",
                    "Niet overgenomen. Het bestand bevat geen races voor deze groep.",
                  ) };
                }
                return {
                  ok: true,
                  races: video.races.map((race) => ({
                    raceNumber: race.raceNumber, trackId: tournamentWorkbookTrackId(race.trackName)!,
                    ...(race.mode === undefined ? {} : { mode: race.mode }),
                    ...(race.mirror === true ? { mirror: true as const } : {}),
                    finishOrder: race.finishOrder.map((name) => playerByName.get(normalizedWorkbookName(name))!),
                  })),
                  carried: carriedBox.checked
                    ? carriedPoints.flatMap((entry) => {
                      const chosen = playerByName.get(normalizedWorkbookName(entry.playerName));
                      return chosen === undefined ? [] : [{ playerId: chosen, points: entry.points }];
                    })
                    : [],
                  // The workbook also says which character each Player drove;
                  // the report prints that picture, so it travels with the races.
                  characters: video.rows.flatMap((score) => {
                    const chosen = playerByName.get(normalizedWorkbookName(score.playerName));
                    const label = (score.character ?? "").trim();
                    if (chosen === undefined || label.length === 0) { return []; }
                    const key = tournamentCharacterKey(label, score.characterRoster);
                    return [{
                      playerId: chosen, characterLabel: label.slice(0, 64),
                      ...(key === null ? {} : { characterKey: key }),
                      ...(score.characterRoster === undefined ? {} : { characterRoster: score.characterRoster.slice(0, 64) }),
                    }];
                  }),
                };
              };
              apply.addEventListener("click", () => {
                apply.disabled = true;
                importGroups([{
                  groupId: group.groupId, name: displayGroupLabel(group), raceCount: video.races.length,
                  ready: true, imported: false, build, say: sayGroup,
                }]);
              });
              paintReadiness();
              mapping.append(raceStatus, readiness, carriedChoice, blocked, apply, importMessage);
            };
            videoSelect.addEventListener("change", renderMapping);
            review.append(title, videoSelect, mapping); excelPreview.append(review); renderMapping();
          }
          say(localized(
            "Excel reviewed. Check every match before importing.",
            "Excel gecontroleerd. Controleer alle koppelingen vóór overnemen.",
          ));
      }
    }

    // A group imported a moment ago re-rendered this step; the workbook that
    // was loaded for it belongs to the other groups too.
    if (scoreWorkbook !== null && scoreWorkbook.step === stepNumber) {
      excel.open = true;
      renderWorkbookReview(scoreWorkbook.videos, scoreWorkbook.fileName);
    }
    excelBody.append(excelTitle, excelHint, excelFile, loadedLine, importAllBox, excelPreview);
    excel.append(excelSummary, excelBody); section.append(excel);

    const hasScores = groups.some((group) => group.races.length > 0 ||
      group.manualScores.some((score) => score.segmentPoints.some((points) => points !== null)));
    const exportButton = button(document, localized(
      `Export scores as Excel (Step ${stepNumber})`,
      `Exporteer scores als Excel (Stap ${stepNumber})`,
    ));
    exportButton.disabled = !hasScores;
    exportButton.addEventListener("click", () => void exportScoreWorkbook(document_, stepNumber));
    section.append(exportButton);
    if (!hasScores) {
      const exportHint = document.createElement("p");
      exportHint.className = "tournament-op__hint tournament-score-step__export-hint";
      exportHint.textContent = localized(
        "Enter scores first before exporting.",
        "Vul eerst scores in om te kunnen exporteren.",
      );
      section.append(exportHint);
    }

    for (const group of groups) {
      const card = document.createElement("section");
      card.className = "tournament-score-step__group";
      const header = document.createElement("div"); header.className = "tournament-score-step__group-header";
      const title = document.createElement("h3"); title.textContent = displayGroupLabel(group);
      const badge = document.createElement("span"); badge.textContent = localized(
        `${group.members.length} participants`,
        `${group.members.length} deelnemers`,
      );
      header.append(title, badge);
      const label = document.createElement("h4"); label.textContent = qualifier
        ? localized("Qualifier scores", "Kwalificatiescores")
        : localized("Final scores", "Eindgroepscores");
      const hint = document.createElement("p"); hint.className = "tournament-op__hint";
      hint.textContent = localized(
        "Enter each Player's total score. The table updates automatically when you leave the field or press Enter.",
        "Vul per speler de totaalscore in. De tabel werkt automatisch bij zodra je het veld verlaat of op Enter drukt.",
      );
      card.append(header, label, hint);
      if (group.races.length > 0) {
        const supplied = document.createElement("p"); supplied.className = "tournament-score-step__supplied";
        supplied.textContent = localized(
          `${group.races.length} races supplied by Live, Processor, or Excel. The canonical race order determines these standings.`,
          `${group.races.length} races aangeleverd via Live, Processor of Excel. De canonieke racevolgorde bepaalt deze stand.`,
        );
        card.append(supplied);
      }
      const errorsLabel = document.createElement("div"); errorsLabel.className = "tournament-score-step__errors";
      const errorsTitle = document.createElement("strong");
      errorsTitle.textContent = "Connection errors (groep):";
      const errors = document.createElement("select");
      errors.setAttribute("aria-label", `Connection errors ${group.name}`);
      for (let count = 0; count <= 3; count += 1) {
        const option = document.createElement("option"); option.value = `${count}`; option.textContent = `${count}`; errors.append(option);
      }
      errors.value = `${Math.max(0, Math.min(3, group.manualScoreSegments - 1))}`;
      errors.disabled = group.races.length > 0;
      errors.hidden = true;
      const errorChoices = document.createElement("div");
      errorChoices.className = "tournament-score-step__error-choices";
      errorChoices.setAttribute("role", "group");
      errorChoices.setAttribute("aria-label", errorsTitle.textContent);
      const paintErrorChoices = (): void => {
        for (const choice of Array.from(errorChoices.querySelectorAll("button"))) {
          choice.setAttribute("aria-pressed", String(choice.dataset["errors"] === errors.value));
        }
      };
      for (let count = 0; count <= 3; count += 1) {
        const choice = button(document, `${count}`);
        choice.dataset["errors"] = `${count}`;
        choice.disabled = group.races.length > 0;
        choice.addEventListener("click", () => {
          errors.value = `${count}`;
          paintErrorChoices();
          renderRows();
        });
        errorChoices.append(choice);
      }
      paintErrorChoices();
      errorsLabel.append(errorsTitle, errorChoices, errors); card.append(errorsLabel);
      if (group.races.length > 0) {
        // A group with races can still be corrected - a missed race, a dropped
        // lap, somebody scored under the wrong name - so the totals stay
        // editable. What the races add up to is shown beside the field, and a
        // number that differs is marked as a correction rather than quietly
        // replacing them.
        const correctionHint = document.createElement("p");
        correctionHint.className = "tournament-op__hint";
        correctionHint.textContent = localized(
          "The totals below come from the races. Change one to correct it; the races themselves are left as they were, and the standing says it was corrected.",
          "De totalen hieronder komen uit de races. Pas er een aan om te corrigeren; de races zelf blijven zoals ze waren en de stand vermeldt dat er gecorrigeerd is.",
        );
        card.append(correctionHint);
      }
      const rows = document.createElement("div"); rows.className = "tournament-score-step__rows";
      const inputs = new Map<string, HTMLInputElement[]>();
      let updateSaveState = (): void => {};
      const renderRows = (): void => {
        clear(rows); inputs.clear();
        const segmentCount = Number(errors.value) + 1;
        const ordered = group.members.map((member) => {
          const existing = group.manualScores.find((score) => score.playerId === member.playerId)?.segmentPoints ?? [];
          const standing = group.standings.rows.find((row) => row.playerId === member.playerId);
          return { member, existing, standing, total: standing?.points ?? existing.reduce((sum: number, value) => sum + (value ?? 0), 0) };
        }).sort((left, right) => right.total - left.total || left.member.displayName.localeCompare(right.member.displayName, "nl"));
        ordered.forEach((entry, index) => {
          const row = document.createElement("div"); row.className = "tournament-score-step__row";
          const rank = document.createElement("span"); rank.className = "tournament-score-step__rank"; rank.textContent = `#${index + 1}`;
          const name = document.createElement("strong");
          // The character the workbook brought, beside the name, so the
          // Director sees straight after an import whether it came along
          // (owner, 2026-09-16).
          const drove = tournamentCharacterIcon(entry.member.character);
          if (drove !== null) {
            const picture = document.createElement("img");
            picture.className = "tournament-op__standing-character";
            picture.src = drove;
            picture.alt = entry.member.character?.label ?? "";
            picture.title = entry.member.character?.label ?? "";
            picture.loading = "lazy";
            picture.decoding = "async";
            name.append(picture);
          }
          name.append(entry.member.displayName);
          const fields = document.createElement("span"); fields.className = "tournament-score-step__parts";
          const parts: HTMLInputElement[] = [];
          for (let part = 0; part < segmentCount; part += 1) {
            const input = document.createElement("input"); input.type = "number"; input.min = "0"; input.max = "10000";
            input.setAttribute("aria-label", localized(
              `${entry.member.displayName} part ${part + 1}`,
              `${entry.member.displayName} deel ${part + 1}`,
            ));
            const value = group.races.length > 0 && part === 0 ? entry.standing?.points : entry.existing[part];
            if (value !== undefined && value !== null) { input.value = `${value}`; }
            parts.push(input); fields.append(input);
          }
          const total = document.createElement("output"); total.textContent = `${entry.total}`;
          const sync = (): void => { total.textContent = `${parts.reduce((sum, input) => sum + (Number(input.value) || 0), 0)}`; };
          parts.forEach((input) => input.addEventListener("input", () => { sync(); updateSaveState(); })); sync();
          inputs.set(entry.member.playerId, parts);
          row.append(rank, name, fields, total);
          // A standing the Director already corrected says what the races said.
          const fromRaces = entry.standing?.correctedFromRaces;
          if (fromRaces !== undefined) {
            const corrected = document.createElement("span");
            corrected.className = "tournament-score-step__corrected";
            corrected.textContent = localized(
              `corrected \u00b7 races: ${fromRaces}`,
              `gecorrigeerd \u00b7 races: ${fromRaces}`,
            );
            row.append(corrected);
          }
          rows.append(row);
        });
        updateSaveState();
      };
      errors.addEventListener("change", renderRows); card.append(rows);
      {
        const save = button(document, group.races.length > 0
          ? localized("Save corrections", "Correcties opslaan")
          : localized("Update table now", "Update tabel nu"));
        save.classList.add("tournament-score-step__save");
        updateSaveState = () => {
          save.disabled = [...inputs.values()].flat().some((input) => input.value.trim() === "");
        };
        save.addEventListener("click", () => void run(localized(
          `Saving ${group.name} scores`,
          `Scores ${group.name} opslaan`,
        ), () => client.setManualScores(
          document_.summary.tournamentId,
          { expectedRevision: document_.summary.revision, groupId: group.groupId, segments: Number(errors.value) + 1,
            scores: [...inputs].map(([playerId, parts]) => ({ playerId,
              segmentPoints: parts.map((input) => input.value.trim() === "" ? null : Number(input.value)) })) },
          controller.signal,
        )));
        card.append(save);
        renderRows();
      }
      section.append(card);
    }

    const complete = hasCompleteTournamentStageScores(groups, stage);
    const checkpoint = document.createElement("section");
    checkpoint.className = `tournament-score-step__checkpoint tournament-score-step__checkpoint--${complete && unresolved.length === 0 ? "ready" : "blocked"}`;
    const continueLabel = qualifier
      ? localized("Continue to Step 6: Qualifier results export", "Ga door naar Stap 6: Kwalificatie-uitslag export")
      : localized("Continue to Step 10: Final group results export", "Ga door naar Stap 10: Eindgroep-uitslag export");
    const next = button(document, complete && unresolved.length === 0
      ? continueLabel
      : `${continueLabel} ${localized("(not ready)", "(nog niet klaar)")}`, true);
    next.disabled = !complete || unresolved.length > 0;
    next.addEventListener("click", () => void run(localized("Confirming scores", "Scores bevestigen"), () => client.setWorkflowStep(
      document_.summary.tournamentId,
      { expectedRevision: document_.summary.revision, targetStep: stepNumber + 1, direction: "advance" },
      controller.signal,
    )));
    const checkpointHint = document.createElement("p"); checkpointHint.className = "tournament-op__hint";
    checkpointHint.textContent = !complete
      ? localized(
        `Enter and save all ${scoreLabel} for every group first.`,
        `Vul eerst voor elke groep alle ${scoreLabel} in en sla ze op.`,
      )
      : unresolved.length > 0
        ? localized("Resolve every manual tie first.", "Los eerst iedere handmatige gelijke eindscore op.")
        : localized(
          `All ${scoreLabel} are complete. Continue to Step ${stepNumber + 1}.`,
          `Alle ${scoreLabel} zijn ingevuld. Klik om naar Stap ${stepNumber + 1} te gaan.`,
        );
    checkpoint.append(next, checkpointHint); section.append(checkpoint);
    content.append(section);
  };

  const stamp = (ms: number): string => new Date(ms).toLocaleString(productLocaleTag());
  const caption = (text: string): HTMLParagraphElement => {
    const line = document.createElement("p");
    line.className = "tournament-op__hint tournament-op__caption";
    line.textContent = text;
    return line;
  };
  /**
   * One line the operator reads, with the long version one click away. The
   * owner found Step 10 had become a wall of captions: every button explained
   * itself in full, so nothing stood out. The short line stays; the paragraph
   * that used to sit under the button moves into the fold under it.
   */
  const captionWithDetail = (short: string, long: string): DocumentFragment => {
    const fragment = document.createDocumentFragment();
    fragment.append(caption(short));
    const fold = document.createElement("details");
    fold.className = "tournament-op__detail";
    const head = document.createElement("summary");
    head.textContent = localized("What happens exactly?", "Wat gebeurt er precies?");
    const body = document.createElement("p");
    body.className = "tournament-op__hint tournament-op__caption";
    body.textContent = long;
    fold.append(head, body);
    fragment.append(fold);
    return fragment;
  };
  const checklistStatus = (text: string, kind: "todo" | "done" | "optional" | "blocked"): HTMLElement => {
    const badge = document.createElement("span");
    badge.className = `tournament-op__checklist-status tournament-op__checklist-status--${kind}`;
    badge.textContent = text;
    return badge;
  };
  const checklistItem = (heading: string, status: HTMLElement, ...body: Node[]): HTMLLIElement => {
    const item = document.createElement("li");
    item.className = "tournament-op__checklist-item";
    const head = document.createElement("div");
    head.className = "tournament-op__checklist-head";
    const title = document.createElement("h3");
    title.textContent = heading;
    head.append(title, status);
    item.append(head, ...body);
    return item;
  };

  /** What each group brings to the finalization: its source, its races, and whether it is complete. */
  const groupReadiness = (document_: TournamentDocument): HTMLElement => {
    const list = document.createElement("ul");
    list.className = "tournament-op__readiness";
    for (const group of document_.groups) {
      const rateable = group.races.filter((race) => race.countsTowardStandings && race.placements.length >= 2).length;
      const complete = group.standings.source !== "none" && group.standings.rows.every((row) => row.complete) &&
        (group.standings.tieGroups ?? []).every((tie) => tie.resolved);
      const source = group.standings.source === "manual"
        ? localized("totals only", "alleen totalen")
        : group.standings.source === "none" ? localized("no result", "geen uitslag") : localized("races", "races");
      const item = document.createElement("li");
      item.className = complete ? "tournament-op__readiness--complete" : "tournament-op__readiness--incomplete";
      item.textContent = localized(
        `${displayGroupLabel(group)}: ${source} · ${group.races.length} race(s) · ${rateable} count for TrueSkill · ${complete ? "complete" : "incomplete"}`,
        `${displayGroupLabel(group)}: ${source} · ${group.races.length} race(s) · ${rateable} tellen voor TrueSkill · ${complete ? "compleet" : "onvolledig"}`,
      );
      list.append(item);
    }
    return list;
  };

  const standingsList = (rows: readonly Readonly<{ placement: number; displayName: string; groupName: string; points: number }>[]): HTMLOListElement => {
    const list = document.createElement("ol");
    list.className = "tournament-op__standings";
    for (const row of rows) {
      const item = document.createElement("li");
      item.textContent = localized(
        `${row.placement}. ${row.displayName} — ${displayGroupLabel({ name: row.groupName })} · ${row.points} pts`,
        `${row.placement}. ${row.displayName} — ${displayGroupLabel({ name: row.groupName })} · ${row.points} pnt`,
      );
      list.append(item);
    }
    return list;
  };

  /** Item 2 before the night is finalized: the two choices, a check that changes nothing, then the one button that does. */
  const renderFinalizeItem = (document_: TournamentDocument): HTMLLIElement => {
    const box = document.createElement("div");
    box.className = "tournament-op__finalize";
    const publicResults = document.createElement("input");
    publicResults.type = "checkbox";
    publicResults.checked = document_.summary.publicResults;
    const publicLabel = document.createElement("label");
    publicLabel.className = "tournament-op__toggle";
    publicLabel.append(publicResults, document.createTextNode(localized(" Public results", " Openbare uitslagen")));
    const publicCaption = captionWithDetail(localized("On: the community sees the night. Off: finalized but hidden.", "Aan: de community ziet de avond. Uit: afgerond maar verborgen."), localized(
      "On: the Tournament appears on the site, in Player histories and in the app, and its report can be read. Off: finalized but invisible to the community. Can be switched later with one button.",
      "Aan: het toernooi verschijnt op de site, in de spelersgeschiedenis en in de app, en het verslag kan gelezen worden. Uit: afgerond maar onzichtbaar voor de community. Later met één knop om te zetten.",
    ));
    const affectsRating = document.createElement("input");
    affectsRating.type = "checkbox";
    affectsRating.checked = document_.summary.affectsRating;
    const ratingLabel = document.createElement("label");
    ratingLabel.className = "tournament-op__toggle";
    ratingLabel.append(affectsRating, document.createTextNode(localized(" Affects TrueSkill", " Beïnvloedt TrueSkill")));
    const ratingCaption = captionWithDetail(localized("On: the rating is updated once, now. Off: this night does not count.", "Aan: de rating wordt nu één keer bijgewerkt. Uit: deze avond telt niet mee."), localized(
      "On: at the moment of finalizing, the races with a placement per Player update the rating exactly once. Off: an exclusion is recorded; undoing that goes through Administration → Rating. Groups with totals only never count.",
      "Aan: op het moment van afronden werken de races met een plaatsing per speler de rating precies één keer bij. Uit: er wordt een uitsluiting vastgelegd; terugdraaien gaat via Beheer → Rating. Groepen met alleen totalen tellen nooit mee.",
    ));

    const editionLine = editionCaption(document_);
    const preview = button(document, localized("Check", "Controleren"));
    const previewCaption = captionWithDetail(localized("Shows what finalizing would do. Changes nothing.", "Toont wat afronden zou doen. Verandert niets."), localized(
      "Shows per group the source, the races and whether the result is complete, the whole standing, and what finalizing with these choices would do. Changes nothing.",
      "Toont per groep de bron, de races en of de uitslag compleet is, het hele klassement, en wat afronden met deze keuzes doet. Verandert niets.",
    ));
    const previewBox = document.createElement("div");
    previewBox.className = "tournament-op__preview";
    const finalize = button(document, localized("Finalize tournament", "Toernooi afronden"), true);
    finalize.hidden = true;
    const finalizeCaption = caption("");
    finalizeCaption.hidden = true;
    let rateableRaceCount = 0;
    const describeFinalize = (): void => {
      finalizeCaption.textContent = localized(
        `Pressing this pins the result as a result set. ${affectsRating.checked ? `${rateableRaceCount} race(s) update the rating once, right now.` : "The rating stays as it is."} ${publicResults.checked ? "The Tournament goes on the site." : "The Tournament stays invisible until you show its results."} Nothing is deleted; going back to an earlier step is no longer possible from this screen.`,
        `Drukken zet de uitslag vast als resultatenset. ${affectsRating.checked ? `${rateableRaceCount} race(s) werken de rating nu één keer bij.` : "De rating blijft zoals hij is."} ${publicResults.checked ? "Het toernooi komt op de site." : "Het toernooi blijft onzichtbaar tot je de uitslagen openbaar zet."} Er wordt niets verwijderd; terug naar een eerdere stap kan hierna niet meer vanuit dit scherm.`,
      );
    };
    publicResults.addEventListener("change", describeFinalize);
    affectsRating.addEventListener("change", describeFinalize);
    preview.addEventListener("click", () => {
      clear(previewBox);
      finalize.hidden = true;
      finalizeCaption.hidden = true;
      void client.finalizationPreview(document_.summary.tournamentId, controller.signal).then((result) => {
        if (disposed) { return; }
        rateableRaceCount = result.rateableRaceCount;
        const lines = [
          localized(
            `${result.name}: ${result.presentCount} present players, ${result.qualifierGroups} qualifier group(s), ${result.finalGroups} final group(s).`,
            `${result.name}: ${result.presentCount} aanwezige spelers, ${result.qualifierGroups} kwalificatiegroep(en), ${result.finalGroups} eindgroep(en).`,
          ),
          localized(
            `${result.raceCount} races recorded, ${result.rateableRaceCount} can be rated, ${result.manualOnlyGroups} group(s) with totals only, ${result.incompleteGroups} incomplete.`,
            `${result.raceCount} races geregistreerd, ${result.rateableRaceCount} kunnen worden beoordeeld, ${result.manualOnlyGroups} groep(en) met alleen totalen, ${result.incompleteGroups} onvolledig.`,
          ),
          ...result.warnings.map(localizedFinalizationWarning),
        ];
        for (const line of lines) {
          const paragraph = document.createElement("p");
          paragraph.textContent = line;
          previewBox.append(paragraph);
        }
        const groupsTitle = document.createElement("h4");
        groupsTitle.textContent = localized("Per group", "Per groep");
        previewBox.append(groupsTitle, groupReadiness(document_));
        if (result.overall.length > 0) {
          const overallTitle = document.createElement("h4");
          overallTitle.textContent = localized("Overall result, complete", "Eindklassement, volledig");
          previewBox.append(overallTitle, standingsList(result.overall));
        }
        const complete = result.incompleteGroups === 0 && result.qualifierGroups > 0 && !result.alreadyFinalized;
        // A public night without an edition number is refused by the API;
        // say so here, before the button, in the words of the fix.
        const unnumbered = publicResults.checked && document_.summary.editionNumber === undefined;
        const ready = complete && !unnumbered;
        const verdict = document.createElement("p");
        verdict.className = ready ? "tournament-op__readiness--complete" : "tournament-op__readiness--incomplete";
        verdict.textContent = ready
          ? localized("Everything is complete. The button below finalizes.", "Alles is compleet. De knop hieronder rondt af.")
          : !complete
            ? localized("Not ready: complete the groups above first (Step 9).", "Nog niet klaar: maak eerst de groepen hierboven compleet (Stap 9).")
            : localized(
              "Not ready: a public night needs an edition number first (button \"Set edition number\" at the top).",
              "Nog niet klaar: een openbare avond heeft eerst een editienummer nodig (knop \"Editienummer instellen\" bovenaan).",
            );
        previewBox.append(verdict);
        finalize.hidden = !ready;
        finalizeCaption.hidden = !ready;
        describeFinalize();
      }).catch((error: unknown) => {
        if (disposed) { return; }
        say(errorText(error, localized("The check is unavailable.", "De controle is niet beschikbaar.")));
      });
    });
    finalize.addEventListener("click", () => {
      if (!confirm(localized(
        `Finalize "${document_.summary.name}" with public results ${publicResults.checked ? "ON" : "OFF"} and TrueSkill ${affectsRating.checked ? "ON" : "OFF"}?`,
        `Toernooi "${document_.summary.name}" afronden met openbare uitslagen ${publicResults.checked ? "AAN" : "UIT"} en TrueSkill ${affectsRating.checked ? "AAN" : "UIT"}?`,
      ))) { return; }
      void run(localized("Finalizing", "Afronden"), async () => {
        const result = await client.finalize(
          document_.summary.tournamentId,
          { expectedRevision: document_.summary.revision, publicResults: publicResults.checked, affectsRating: affectsRating.checked, reasonCode: "tournament_finalized" },
          controller.signal,
        );
        say(result.rating === undefined
          ? localized("Finalized.", "Afgerond.")
          : localized(
            `Finalized · ${result.rating.appliedRaces} race(s) applied to the rating${result.rating.alreadyApplied ? " (already applied before)" : ""}.`,
            `Afgerond · ${result.rating.appliedRaces} race(s) toegepast op de rating${result.rating.alreadyApplied ? " (eerder al toegepast)" : ""}.`,
          ));
        return undefined;
      });
    });
    box.append(publicLabel, publicCaption, ratingLabel, ratingCaption, editionLine, preview, previewCaption, previewBox, finalize, finalizeCaption);
    return checklistItem(
      localized("Finalize the Tournament", "Toernooi afronden"),
      checklistStatus(localized("Not finalized yet", "Nog niet afgerond"), "todo"),
      box,
    );
  };
  /** One line on the edition number: the night's name in the graph and the statistics, or the gap. */
  const editionCaption = (document_: TournamentDocument): HTMLElement => {
    const number = document_.summary.editionNumber;
    const line = caption(number === undefined
      ? localized(
        "No edition number yet. A public night needs one.",
        "Nog geen editienummer. Een openbare avond heeft er een nodig.",
      )
      : localized(
        `Edition number TN${number}: this is how the rating graph, the statistics and the report name the night.`,
        `Editienummer TN${number}: zo noemen de rating-grafiek, de statistieken en het verslag de avond.`,
      ));
    line.classList.add("tournament-op__edition-line");
    if (number === undefined) { line.classList.add("tournament-op__readiness--incomplete"); }
    if (number !== undefined) { return line; }
    // Why it matters is a click away, so the line itself stays a line.
    const wrapper = document.createElement("div");
    const why = document.createElement("details");
    why.className = "tournament-op__detail";
    const whyHead = document.createElement("summary");
    whyHead.textContent = localized("Why does this matter?", "Waarom is dit van belang?");
    const whyBody = document.createElement("p");
    whyBody.className = "tournament-op__hint tournament-op__caption";
    whyBody.textContent = localized(
      "The rating graph, the statistics and the report name the night by this number, and leave a public night without one out of the graph and the statistics. Button \"Set edition number\" at the top.",
      "De rating-grafiek, de statistieken en het verslag noemen de avond met dit nummer, en laten een openbare avond zonder nummer weg uit de grafiek en de statistieken. Knop \"Editienummer instellen\" bovenaan.",
    );
    why.append(whyHead, whyBody);
    wrapper.append(line, why);
    return wrapper;
  };

  /** Item 2 once the night is finalized: what was chosen, the one switch that remains, and the pinned standing. */
  const renderFinalizedItem = (document_: TournamentDocument): HTMLLIElement => {
    const box = document.createElement("div");
    box.className = "tournament-op__finalize";
    const summary = document.createElement("p");
    summary.textContent = localized(
      `Public results ${document_.summary.publicResults ? "ON" : "OFF"} · Affects TrueSkill ${document_.summary.affectsRating ? "ON" : "OFF"}${document_.summary.publicationId === undefined ? "" : ` · result set ${document_.summary.publicationId}`}`,
      `Openbare uitslagen ${document_.summary.publicResults ? "AAN" : "UIT"} · Beïnvloedt TrueSkill ${document_.summary.affectsRating ? "AAN" : "UIT"}${document_.summary.publicationId === undefined ? "" : ` · resultatenset ${document_.summary.publicationId}`}`,
    );
    const toggle = button(document, document_.summary.publicResults
      ? localized("Hide public results", "Openbare uitslagen verbergen")
      : localized("Show public results", "Openbare uitslagen tonen"));
    toggle.addEventListener("click", () => {
      void run(localized("Updating visibility", "Zichtbaarheid bijwerken"), () => client.setResultsVisibility(
        document_.summary.tournamentId,
        { expectedRevision: document_.summary.revision, publicResults: !document_.summary.publicResults, reasonCode: "owner_visibility_change" },
        controller.signal,
      ));
    });
    const toggleCaption = captionWithDetail(document_.summary.publicResults
      ? localized(
        "Takes the Tournament and its report off the site. Scores and rating stay.",
        "Haalt het toernooi en het verslag van de site. Scores en rating blijven.",
      )
      : localized(
        "Puts the Tournament on the site. Scores and rating stay.",
        "Zet het toernooi op de site. Scores en rating blijven.",
      ), document_.summary.publicResults
      ? localized(
        "Pressing this takes the Tournament and its report off the site, Player histories and the app. Scores and rating stay as they are; you can show it again at any time.",
        "Drukken haalt het toernooi en het verslag van de site, uit de spelersgeschiedenis en uit de app. Scores en rating blijven zoals ze zijn; tonen kan altijd weer.",
      )
      : localized(
        "Pressing this puts the Tournament on the site, in Player histories and in the app, and lets the community read a published report. Scores and rating stay as they are.",
        "Drukken zet het toernooi op de site, in de spelersgeschiedenis en in de app, en laat de community een gepubliceerd verslag lezen. Scores en rating blijven zoals ze zijn.",
      ));
    const ratingHint = captionWithDetail(localized("Changing whether it counts for TrueSkill goes through Administration → Rating.", "Meetellen voor TrueSkill wijzigen gaat via Beheer → Rating."), localized(
      "Changing whether a finalized tournament counts for TrueSkill is an audited rating decision followed by a recalculation: Administration → Rating.",
      "Wijzigen of een afgerond toernooi meetelt voor TrueSkill is een gecontroleerde ratingbeslissing, gevolgd door een herberekening: Beheer → Rating.",
    ));
    const overallTitle = document.createElement("h4");
    overallTitle.textContent = localized("Overall result", "Eindklassement");
    const grid = document.createElement("div");
    grid.className = "tournament-op__groups";
    for (const group of document_.groups) {
      const card = document.createElement("article");
      card.className = "tournament-op__group";
      const groupTitle = document.createElement("h5");
      groupTitle.textContent = displayGroupLabel(group);
      const standings = document.createElement("ol");
      standings.className = "tournament-op__standings";
      for (const row of group.standings.rows) {
        const item = document.createElement("li");
        item.textContent = `${row.rank}. ${row.displayName} — ${row.points} pts`;
        standings.append(item);
      }
      card.append(groupTitle, standings);
      grid.append(card);
    }
    box.append(summary, editionCaption(document_), toggle, toggleCaption, ratingHint);
    if (operatorIsAdministrator) {
      const reopen = button(document, localized("Undo finalization", "Afronding terugdraaien"));
      reopen.className = "tt-auth__button tournament-op__delete";
      reopen.addEventListener("click", () => {
        const why = prompt(localized(
          `Undo the finalization of "${document_.summary.name}"? Enter the reason (kept in the Tournament's history):`,
          `De afronding van "${document_.summary.name}" terugdraaien? Voer de reden in (blijft in de geschiedenis van het toernooi staan):`,
        ));
        if (why === null || why.trim().length < 3) { return; }
        if (!confirm(localized(
          `The result set is retracted${document_.summary.affectsRating ? ", the rating is recalculated without this night" : ""}, a published report goes back to draft, and the Tournament returns to Step 10. Continue?`,
          `De resultatenset wordt ingetrokken${document_.summary.affectsRating ? ", de rating wordt zonder deze avond herberekend" : ""}, een gepubliceerd verslag gaat terug naar concept, en het toernooi staat weer op Stap 10. Doorgaan?`,
        ))) { return; }
        // The replay takes seconds; the button says so where the operator is looking.
        const label = reopen.textContent;
        reopen.disabled = true;
        reopen.textContent = localized("Undoing… the rating is being replayed", "Bezig… de rating wordt herberekend");
        void run(localized("Undoing the finalization", "Afronding terugdraaien"), async () => {
          await client.reopenTournament(document_.summary.tournamentId, { reason: why }, controller.signal);
          return undefined;
        }).finally(() => {
          // On success the step is redrawn and this button is gone; on a failure it comes back.
          if (reopen.isConnected) { reopen.disabled = false; reopen.textContent = label; }
        });
      });
      box.append(reopen, captionWithDetail(localized("Takes the night back to Step 10, not finalized. Administrators only.", "Zet de avond terug op Stap 10, niet afgerond. Alleen voor beheerders."), localized(
        "Pressing this takes the night back to Step 10, not finalized: the result set leaves the site and the app, the rating is recalculated without this night when it counted, and a published report goes back to draft. Groups, seats, scores and the report's text stay; after the correction, finalize again. Administrators only.",
        "Drukken zet de avond terug op Stap 10, niet afgerond: de uitslag verdwijnt van de site en uit de app, de rating wordt zonder deze avond herberekend als hij meetelde, en een gepubliceerd verslag gaat terug naar concept. Groepen, zitplaatsen, scores en de tekst van het verslag blijven staan; na de correctie rond je opnieuw af. Alleen voor beheerders.",
      )));
    }
    box.append(overallTitle, standingsList(document_.overall), grid);
    return checklistItem(
      localized("Finalize the Tournament", "Toernooi afronden"),
      checklistStatus(localized(
        `Finalized · public ${document_.summary.publicResults ? "ON" : "OFF"} · TrueSkill ${document_.summary.affectsRating ? "ON" : "OFF"}`,
        `Afgerond · openbaar ${document_.summary.publicResults ? "AAN" : "UIT"} · TrueSkill ${document_.summary.affectsRating ? "AAN" : "UIT"}`,
      ), "done"),
      box,
    );
  };

  const checkpointText = (document_: TournamentDocument, checkpoint: TournamentExportCheckpoint): string => {
    if (checkpoint.mode === "layout") { return seatingText(document_, checkpoint.stage); }
    const lines = [`${document_.summary.name} · ${checkpoint.label}`];
    for (const group of document_.groups.filter((candidate) => candidate.stage === checkpoint.stage)) {
      lines.push("", `*${groupLabel(group)}*`);
      for (const row of group.standings.rows) { lines.push(`${row.rank}. ${row.displayName} — ${row.points} pnt`); }
    }
    return lines.join("\n");
  };

  // The preview is the picture itself, as on the APK: what the operator sees
  // is byte-for-byte what the group chat gets. The HTML rendition below stays
  // as the fallback for a browser (or a test document) without a 2D canvas.
  const checkpointCanvas = (
    document_: TournamentDocument,
    checkpoint: TournamentExportCheckpoint,
    icons: Parameters<typeof renderTournamentExportImage>[2] = {},
  ): HTMLCanvasElement | null => {
    const probe = document.createElement("canvas");
    if (typeof probe.getContext !== "function") { return null; }
    const model = tournamentExportImageModel(
      tournamentExportSourceFromDocument(document_), checkpoint.stage, checkpoint.mode,
    );
    return renderTournamentExportImage(document, model, icons);
  };

  const renderCheckpointPreview = (
    document_: TournamentDocument,
    checkpoint: TournamentExportCheckpoint,
  ): HTMLElement => {
    const drawn = checkpointCanvas(document_, checkpoint);
    if (drawn !== null) {
      const picture = document.createElement("section");
      picture.className = "tournament-export-picture";
      picture.append(drawn);
      // The Switch marks arrive a moment later; redraw once with them.
      void loadTournamentExportIcons(document).then((icons) => {
        const withIcons = checkpointCanvas(document_, checkpoint, icons);
        if (withIcons !== null && picture.isConnected) { picture.replaceChildren(withIcons); }
      });
      return picture;
    }
    const preview = document.createElement("section");
    preview.className = `tournament-export-preview tournament-export-preview--${checkpoint.mode}`;
    const header = document.createElement("header");
    const title = document.createElement("h4");
    title.textContent = document_.summary.name;
    const subtitle = document.createElement("p");
    subtitle.textContent = checkpoint.label;
    header.append(title, subtitle);
    preview.append(header);
    const groups = document_.groups.filter((candidate) => candidate.stage === checkpoint.stage)
      .slice().sort((left, right) => left.sequence - right.sequence);
    const grid = document.createElement("div");
    grid.className = "tournament-export-preview__grid";
    for (const group of groups) {
      const card = document.createElement("article");
      card.className = "tournament-export-preview__group";
      const heading = document.createElement("h5");
      heading.textContent = `${displayGroupLabel(group)} · ${group.members.length}`;
      card.append(heading);
      if (checkpoint.mode === "layout") {
        const stations = new Map<string, { cable?: number; owner: string; switchType: string; seats: string[] }>();
        const cables = tournamentUtpByStation(document_);
        for (const member of group.members) {
          if (member.station === undefined) { continue; }
          const key = `${member.station.ownerPlayerId}|${member.station.switchType}`;
          const cable = cables.get(tournamentStationKey(member.station.ownerPlayerId, member.station.switchType));
          const station = stations.get(key) ?? {
            ...(cable === undefined ? {} : { cable }),
            owner: member.station.ownerDisplayName, switchType: member.station.switchType.toUpperCase(), seats: [],
          };
          station.seats[member.station.seatNumber - 1] = member.displayName;
          stations.set(key, station);
        }
        for (const station of stations.values()) {
          const row = document.createElement("div");
          row.className = "tournament-export-preview__station";
          const console = document.createElement("strong");
          const icon = document.createElement("img");
          icon.src = station.switchType === "NS2" ? "/styles/mk8dx_ns2.png" : "/styles/mk8dx_ns1.png";
          icon.alt = station.switchType;
          console.append(icon, document.createTextNode(
            `${station.cable === undefined ? "" : `UTP ${station.cable} · `}${station.owner}`,
          ));
          const racers = document.createElement("span");
          racers.textContent = station.seats.filter((seat) => seat !== undefined).join(" + ");
          row.append(console, racers);
          card.append(row);
        }
        const seated = new Set([...stations.values()].flatMap((station) => station.seats));
        const unseated = group.members.filter((member) => !seated.has(member.displayName));
        if (unseated.length > 0) {
          const row = document.createElement("p");
          row.className = "tournament-export-preview__warning";
          row.textContent = localized(
            `No seat yet: ${unseated.map((member) => member.displayName).join(", ")}`,
            `Nog geen plek: ${unseated.map((member) => member.displayName).join(", ")}`,
          );
          card.append(row);
        }
      } else {
        const table = document.createElement("ol");
        table.className = "tournament-export-preview__standings";
        for (const row of group.standings.rows) {
          const entry = document.createElement("li");
          const rank = document.createElement("strong"); rank.textContent = `${row.rank}.`;
          const name = document.createElement("span");
          const playerName = document.createElement("span"); playerName.textContent = row.displayName;
          const meta = document.createElement("small");
          const participant = document_.participants.find((candidate) => candidate.playerId === row.playerId);
          let target = "";
          if (checkpoint.stage === "qualifier") {
            const tierCount = Math.max(1, Math.min(groups.length, TOURNAMENT_TIERS.length));
            const base = Math.floor(group.members.length / tierCount);
            const extra = group.members.length % tierCount;
            let cursor = 0;
            let tierIndex = 0;
            for (let index = 0; index < tierCount; index += 1) {
              cursor += base + (index < extra ? 1 : 0);
              if (row.rank <= cursor) { tierIndex = index; break; }
            }
            const targetTier = TOURNAMENT_TIERS[tierIndex];
            const targetName = targetTier === undefined
              ? localized(`Group ${tierIndex + 1}`, `Groep ${tierIndex + 1}`)
              : groupLabel({ name: targetTier.dutchName, tierKey: targetTier.key });
            target = localized(` · To ${targetName}`, ` · Naar ${targetName}`);
          }
          meta.textContent = localized(
            `SP Rank #${participant?.seedRank ?? "?"}${target}`,
            `SP-rang #${participant?.seedRank ?? "?"}${target}`,
          );
          name.append(playerName, meta);
          const points = document.createElement("b"); points.textContent = localized(`${row.points} pts`, `${row.points} pnt`);
          entry.append(rank, name, points);
          table.append(entry);
        }
        card.append(table);
      }
      grid.append(card);
    }
    preview.append(grid);
    return preview;
  };

  const checkpointImage = async (document_: TournamentDocument, checkpoint: TournamentExportCheckpoint): Promise<Blob | null> => {
    const icons = await loadTournamentExportIcons(document);
    const canvas = checkpointCanvas(document_, checkpoint, icons);
    return canvas === null ? null : tournamentExportImageBlob(canvas);
  };
  const checkpointFileName = (document_: TournamentDocument, checkpoint: TournamentExportCheckpoint): string =>
    tournamentExportFileName(document_.summary.name, checkpoint.stage, checkpoint.mode);

  const renderCheckpointControls = (
    document_: TournamentDocument,
    checkpoint: TournamentExportCheckpoint,
  ): HTMLElement => {
    const controls = document.createElement("div");
    controls.className = "tournament-export-controls";
    const share = button(document, localized("📲 Share image in WhatsApp", "📲 Deel afbeelding in WhatsApp"), true);
    share.classList.add("tournament-export-controls__whatsapp");
    share.addEventListener("click", () => { void (async () => {
      const image = await checkpointImage(document_, checkpoint);
      if (image === null) {
        say(localized("Image export is unavailable in this browser.", "Afbeelding exporteren is niet beschikbaar in deze browser.")); return;
      }
      const file = new File([image], checkpointFileName(document_, checkpoint), { type: "image/png" });
      try {
        if (globalThis.navigator.share !== undefined &&
          (globalThis.navigator.canShare === undefined || globalThis.navigator.canShare({ files: [file] }))) {
          // The picture is the message; the text beside it only says which
          // board of which night this is. "Deel als tekst" is the other act.
          await globalThis.navigator.share({
            title: document_.summary.name,
            text: tournamentExportShareCaption(
              tournamentExportSourceFromDocument(document_), checkpoint.stage, checkpoint.mode),
            files: [file],
          });
        } else {
          await globalThis.navigator.clipboard.writeText(checkpointText(document_, checkpoint));
          say(localized(
            "Image sharing is unsupported; the text was copied.",
            "Afbeelding delen wordt niet ondersteund; de tekst is gekopieerd.",
          ));
        }
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          say(localized("Sharing is unavailable.", "Delen is niet beschikbaar."));
        }
      }
    })(); });
    const png = button(document, "Download PNG");
    png.addEventListener("click", () => { void checkpointImage(document_, checkpoint).then((image) => {
      if (image === null) { say(localized("PNG export is unavailable.", "PNG exporteren is niet beschikbaar.")); return; }
      downloadBlob(image, checkpointFileName(document_, checkpoint));
    }); });
    const textShare = button(document, localized("Share as text", "Deel als tekst"));
    textShare.addEventListener("click", () => { void globalThis.navigator.clipboard.writeText(checkpointText(document_, checkpoint))
      .then(
        () => say(localized("Export text copied.", "Exporttekst gekopieerd.")),
        () => say(localized("Copying is unavailable.", "Kopiëren is niet beschikbaar.")),
      ); });
    controls.append(share, png, textShare);
    return controls;
  };

  // Steps 4 and 8 use the Manager's cumulative image-export hub. Step 8 adds
  // the exact operator-facing movement audit needed before final races start.
  const renderLayoutExportCheckpoint = (
    document_: TournamentDocument,
    stage: TournamentGroupStage,
    stepNumber: 4 | 8,
  ): void => {
    const qualifier = stage === "qualifier";
    const checkpoints = tournamentExportCheckpoints(stepNumber);
    let selected = checkpoints[checkpoints.length - 1]!;
    const section = document.createElement("section");
    section.className = "tournament-op__layout-export tournament-layout-step";
    const exportPanel = document.createElement("section");
    exportPanel.className = "tournament-layout-step__panel tournament-layout-step__export-panel";
    const title = document.createElement("h2");
    title.className = "tournament-layout-step__title";
    title.textContent = qualifier
      ? localized("Step 4: Qualifier layout export", "Stap 4: Kwalificatie-indeling export")
      : localized("Step 8: Final group layout export", "Stap 8: Eindgroep-indeling export");
    const tabs = document.createElement("div");
    tabs.className = "tournament-export-tabs";
    const shown = document.createElement("p");
    shown.className = "tournament-op__hint";
    const body = document.createElement("div");
    body.className = "tournament-layout-step__body";
    const draw = (): void => {
      shown.textContent = localized(`Showing: ${selected.label}`, `Toont: ${selected.label}`);
      clear(body);
      body.append(renderCheckpointPreview(document_, selected), renderCheckpointControls(document_, selected));
      for (const tab of Array.from(tabs.querySelectorAll("button"))) {
        tab.setAttribute("aria-pressed", tab.dataset["checkpoint"] === selected.key ? "true" : "false");
      }
    };
    for (const checkpoint of checkpoints) {
      const tab = button(document, checkpoint.label);
      tab.dataset["checkpoint"] = checkpoint.key;
      tab.addEventListener("click", () => { selected = checkpoint; draw(); });
      tabs.append(tab);
    }

    const audit = document.createElement("section");
    audit.className = "tournament-op__layout-export-audit tournament-layout-step__panel";
    const auditTitle = document.createElement("h4");
    auditTitle.textContent = localized(`Movement audit Step ${stepNumber}`, `Verplaatsingsaudit Stap ${stepNumber}`);
    if (qualifier) {
      const owners = new Set(document_.participants.filter((participant) => participant.attendance === "present" && (participant.hasSwitch1 || participant.hasSwitch2)).map((participant) => participant.playerId));
      const cables = tournamentUtpByStation(document_);
      const moved = document_.groups.filter((group) => group.stage === stage).flatMap((group) => group.members.flatMap((member) => {
        if (member.station === undefined || !owners.has(member.playerId) || member.station.ownerPlayerId === member.playerId) { return []; }
        const ownStation = document_.stations.find((station) => station.ownerPlayerId === member.playerId);
        const ownUsage = document_.groups.filter((candidate) => candidate.stage === stage)
          .flatMap((candidate) => candidate.members.map((candidateMember) => ({ candidate, candidateMember })))
          .find(({ candidateMember }) => candidateMember.station?.ownerPlayerId === member.playerId);
        const own = ownStation === undefined
          ? localized(
            "Own Nintendo Switch was not found in the current layout.",
            "Eigen Nintendo Switch is niet gevonden in de huidige indeling.",
          )
          : ownUsage === undefined
            ? localized(
              `${ownStation.switchType.toUpperCase()} ${ownStation.ownerDisplayName} is currently empty or in parking.`,
              `${ownStation.switchType.toUpperCase()} ${ownStation.ownerDisplayName} is momenteel onbezet of in parking.`,
            )
            : localized(
              `${ownStation.switchType.toUpperCase()} ${ownStation.ownerDisplayName} is assigned to ${displayGroupLabel(ownUsage.candidate)}.`,
              `${ownStation.switchType.toUpperCase()} ${ownStation.ownerDisplayName} is afgestaan aan ${displayGroupLabel(ownUsage.candidate)}.`,
            );
        const cable = cables.get(tournamentStationKey(member.station.ownerPlayerId, member.station.switchType));
        const seatedStation = `${cable === undefined ? "" : `UTP ${cable} ${"\u00b7"} `}${member.station.switchType.toUpperCase()} ${member.station.ownerDisplayName}`;
        return [{ member, detail: localized(
          `${member.displayName} is in ${displayGroupLabel(group)} on ${seatedStation}. ${own}`,
          `${member.displayName} zit in ${displayGroupLabel(group)} op ${seatedStation}. ${own}`,
        ) }];
      }));
      const auditSummary = document.createElement("p");
      auditSummary.textContent = localized(
        `Not on own Nintendo Switch: ${moved.length} · Score: ${moved.length}`,
        `Niet op eigen Nintendo Switch: ${moved.length} · Score: ${moved.length}`,
      );
      const auditList = document.createElement("ul");
      const lines = moved.map((entry) => { const line = document.createElement("li"); line.textContent = entry.detail; return line; });
      if (lines.length === 0) {
        const line = document.createElement("li");
        line.textContent = localized(
          "Everyone with their own Nintendo Switch is seated at their own station.",
          "Iedereen met eigen Nintendo Switch zit op een eigen station.",
        );
        lines.push(line);
      }
      auditList.append(...lines);
      audit.append(auditTitle, auditSummary, auditList);
    } else {
      const result = tournamentFinalLayoutAudit(document_);
      const summary = document.createElement("p");
      summary.textContent = localized(
        `Switch owners giving up: ${result.ownerGiveUps.length} · Participants changing stations: ${result.participantMoves.length} · Weighted score: ${result.weightedScore}`,
        `Switch-eigenaren die afstaan: ${result.ownerGiveUps.length} · Deelnemers met stationwissel: ${result.participantMoves.length} · Gewogen score: ${result.weightedScore}`,
      );
      const score = document.createElement("p");
      score.textContent = localized(
        `= ${result.ownerGiveUps.length}×3 give-up + ${result.participantMoves.length}×1 move`,
        `= ${result.ownerGiveUps.length}×3 afstaan + ${result.participantMoves.length}×1 wissel`,
      );
      const ownersTitle = document.createElement("h5"); ownersTitle.textContent = localized(
        "Switch owners giving up their Switch",
        "Switch-eigenaren die hun switch afstaan",
      );
      const owners = document.createElement("ul");
      for (const row of result.ownerGiveUps) { const line = document.createElement("li"); line.textContent = localized(
        `${row.displayName} is in ${row.groupName} on ${row.seatedStation}.`,
        `${row.displayName} zit in ${row.groupName} op ${row.seatedStation}.`,
      ); owners.append(line); }
      if (result.ownerGiveUps.length === 0) { const line = document.createElement("li"); line.textContent = localized(
        "Nobody needs to give up their own Nintendo Switch.",
        "Niemand hoeft een eigen Nintendo Switch af te staan.",
      ); owners.append(line); }
      const movesTitle = document.createElement("h5"); movesTitle.textContent = localized(
        "Participants changing stations",
        "Deelnemers die van station wisselen",
      );
      const moves = document.createElement("ul");
      for (const row of result.participantMoves) { const line = document.createElement("li"); line.textContent = `${row.displayName} · ${row.fromGroup} (${row.fromStation}) → ${row.toGroup} (${row.toStation})`; moves.append(line); }
      if (result.participantMoves.length === 0) { const line = document.createElement("li"); line.textContent = localized(
        "No participants need to change stations.",
        "Geen deelnemers hoeven van station te wisselen.",
      ); moves.append(line); }
      const utpTitle = document.createElement("h5"); utpTitle.textContent = localized("UTP 2-cable swap plan", "UTP 2-kabel wisselplan");
      const utpSummary = document.createElement("p");
      utpSummary.textContent = localized(
        `Swaps: ${result.utpPlan.swapCount} · Single moves: ${result.utpPlan.moveCount}${result.utpPlan.unresolved > 0 ? ` · Outstanding: ${result.utpPlan.unresolved}` : ""}`,
        `Swaps: ${result.utpPlan.swapCount} · Single moves: ${result.utpPlan.moveCount}${result.utpPlan.unresolved > 0 ? ` · Openstaand: ${result.utpPlan.unresolved}` : ""}`,
      );
      const utp = document.createElement("div");
      if (result.utpPlan.steps.length === 0) {
        const line = document.createElement("p");
        line.textContent = localized(
          "No UTP swaps needed; the layout already matches.",
          "Geen UTP-wissels nodig; indeling komt al overeen.",
        );
        utp.append(line);
      } else {
        result.utpPlan.steps.forEach((row, index) => {
          const line = document.createElement("p");
          line.textContent = row.type === "swap"
            ? localized(
              `Step ${index + 1}: swap UTP ${row.cableX} (${row.from} → ${row.to}) with UTP ${row.cableY} (${row.to} → ${row.from}).`,
              `Stap ${index + 1}: wissel UTP ${row.cableX} (${row.from} → ${row.to}) met UTP ${row.cableY} (${row.to} → ${row.from}).`,
            )
            : localized(
              `Step ${index + 1}: move UTP ${row.cableX} (${row.from} → ${row.to}).`,
              `Stap ${index + 1}: verplaats UTP ${row.cableX} (${row.from} → ${row.to}).`,
            );
          utp.append(line);
        });
      }
      audit.append(auditTitle, summary, score, ownersTitle, owners, movesTitle, moves, utpTitle, utpSummary, utp);
    }

    const continueSection = document.createElement("section");
    continueSection.className = "tournament-op__checkpoint tournament-layout-step__continue";
    const nextStep = qualifier ? 5 : 9;
    const next = button(document, qualifier
      ? localized("Continue to Step 5: Qualifier scores", "Ga door naar Stap 5: Kwalificatiescores")
      : localized("Continue to Step 9: Final scores", "Ga door naar Stap 9: Eindgroepscores"), true);
    next.addEventListener("click", () => void run(localized(`Going to Step ${nextStep}`, `Naar Stap ${nextStep}`), () => client.setWorkflowStep(
      document_.summary.tournamentId,
      { expectedRevision: document_.summary.revision, targetStep: nextStep, direction: "advance" },
      controller.signal,
    )));
    const hint = document.createElement("p");
    hint.className = "tournament-op__hint";
    hint.textContent = qualifier
      ? localized(
        "Export reviewed? Continue with the qualifier scores.",
        "Export gecontroleerd? Ga nu door met het invullen van kwalificatiescores.",
      )
      : localized(
        "Export reviewed? Continue with filling in final group scores.",
        "Export gecontroleerd? Ga nu door met het invullen van eindgroepscores.",
      );
    continueSection.append(next, hint);
    exportPanel.append(title, shown);
    if (checkpoints.length > 1) { exportPanel.append(tabs); }
    exportPanel.append(body);
    section.append(exportPanel, audit, continueSection);
    draw();
    content.append(section);
  };

  const exportScoreWorkbook = async (document_: TournamentDocument, step: 5 | 6 | 9 | 10): Promise<void> => {
    if (busy) { return; }
    busy = true;
    say(localized(`Creating Excel for Step ${step}…`, `Excel voor Stap ${step} maken…`));
    try {
      const result = await client.exportScoreWorkbook(document_.summary.tournamentId, {
        expectedRevision: document_.summary.revision,
        step,
        trackLabels: schema9WebTrackCatalog.map((track) => ({
          trackId: track.id, displayName: track.displayName,
          ...((): { cupName?: string } => { const cup = trackAsset(track.id)?.cup.name; return cup === undefined ? {} : { cupName: cup }; })(),
        })),
      }, controller.signal);
      downloadBlob(base64Blob(result.workbookBase64, result.mediaType), result.fileName);
      say(localized(`Excel for Step ${step} downloaded.`, `Excel voor Stap ${step} gedownload.`));
    } catch (error) {
      say(errorText(error, localized(
        `Excel for Step ${step} could not be created.`,
        `Excel voor Stap ${step} kon niet worden gemaakt.`,
      )));
    } finally {
      busy = false;
    }
  };

  /** The result picture and the workbooks, folded: one-off operator tools, used once and then done. */
  const renderExportFold = (document_: TournamentDocument, stepNumber: 6 | 10): HTMLDetailsElement => {
    const checkpoints = tournamentExportCheckpoints(stepNumber);
    let selected = checkpoints[checkpoints.length - 1]!;
    const tabs = document.createElement("div");
    tabs.className = "tournament-export-tabs";
    const shown = document.createElement("p");
    shown.className = "tournament-op__hint";
    const body = document.createElement("div");
    const draw = (): void => {
      shown.textContent = localized(`Showing: ${selected.label}`, `Toont: ${selected.label}`);
      clear(body);
      body.append(renderCheckpointPreview(document_, selected), renderCheckpointControls(document_, selected));
      for (const tab of Array.from(tabs.querySelectorAll("button"))) {
        tab.setAttribute("aria-pressed", tab.dataset["checkpoint"] === selected.key ? "true" : "false");
      }
    };
    for (const checkpoint of checkpoints) {
      const tab = button(document, checkpoint.label);
      tab.dataset["checkpoint"] = checkpoint.key;
      tab.addEventListener("click", () => { selected = checkpoint; draw(); });
      tabs.append(tab);
    }
    const excel = document.createElement("div");
    excel.className = "tournament-export-excel";
    const currentExcel = button(document, localized(
      `Download Excel Step ${stepNumber}`,
      `Download Excel Stap ${stepNumber}`,
    ));
    currentExcel.addEventListener("click", () => { void exportScoreWorkbook(document_, stepNumber); });
    excel.append(currentExcel);
    if (stepNumber === 10) {
      const qualifierExcel = button(document, localized("Download Excel Step 6", "Download Excel Stap 6"));
      qualifierExcel.addEventListener("click", () => { void exportScoreWorkbook(document_, 6); });
      excel.append(qualifierExcel);
    }
    // A summary cannot be a grid in Chromium, hence the inner row.
    const folded = document.createElement("details");
    folded.className = "tournament-export-fold";
    const summary = document.createElement("summary");
    const summaryRow = document.createElement("div");
    summaryRow.className = "tournament-export-fold__row";
    const summaryTitle = document.createElement("strong");
    summaryTitle.textContent = localized("Export and share", "Exporteren en delen");
    const summaryHint = document.createElement("span");
    summaryHint.className = "tournament-op__hint";
    summaryHint.textContent = stepNumber === 10
      ? localized(
        "The result picture for WhatsApp, and the Excel workbooks of Step 10 and Step 6.",
        "De uitslagafbeelding voor WhatsApp, en de Excel-werkboeken van Stap 10 en Stap 6.",
      )
      : localized(
        "The layout and result pictures for WhatsApp, and this step's Excel workbook.",
        "De indelings- en uitslagafbeelding voor WhatsApp, en het Excel-werkboek van deze stap.",
      );
    summaryRow.append(summaryTitle, summaryHint);
    summary.append(summaryRow);
    folded.append(summary, tabs, shown, body, excel);
    draw();
    return folded;
  };

  const renderResultsExportCheckpoint = (
    document_: TournamentDocument,
    stage: TournamentGroupStage,
    stepNumber: 6 | 10,
  ): void => {
    const checkpoints = tournamentExportCheckpoints(stepNumber);
    let selected = checkpoints[checkpoints.length - 1]!;
    const section = document.createElement("section");
    section.className = "tournament-op__layout-export tournament-layout-step tournament-results-step";
    const exportPanel = document.createElement("section");
    exportPanel.className = "tournament-layout-step__panel tournament-layout-step__export-panel tournament-results-step__export-panel";
    const title = document.createElement("h2");
    title.className = "tournament-layout-step__title";
    title.textContent = stage === "qualifier"
      ? localized("Step 6: Qualifier results export", "Stap 6: Kwalificatie-uitslag export")
      : localized("Step 10: Final group results export", "Stap 10: Eindgroep-uitslag export");
    const shown = document.createElement("p");
    shown.className = "tournament-op__hint";
    const tabs = document.createElement("div");
    tabs.className = "tournament-export-tabs";
    const body = document.createElement("div");
    body.className = "tournament-layout-step__body";
    const draw = (): void => {
      shown.textContent = localized(`Showing: ${selected.label}`, `Toont: ${selected.label}`);
      clear(body);
      body.append(renderCheckpointPreview(document_, selected), renderCheckpointControls(document_, selected));
      const excel = document.createElement("div");
      excel.className = "tournament-export-excel";
      const workbook = button(document, localized(`Download Excel Step ${stepNumber}`, `Download Excel stap ${stepNumber}`));
      workbook.addEventListener("click", () => { void exportScoreWorkbook(document_, stepNumber); });
      excel.append(workbook);
      if (stepNumber === 10) {
        const qualifierWorkbook = button(document, localized("Download Excel Step 6", "Download Excel stap 6"));
        qualifierWorkbook.addEventListener("click", () => { void exportScoreWorkbook(document_, 6); });
        excel.append(qualifierWorkbook);
      }
      body.append(excel);
      for (const tab of Array.from(tabs.querySelectorAll("button"))) {
        tab.setAttribute("aria-pressed", tab.dataset["checkpoint"] === selected.key ? "true" : "false");
      }
    };
    for (const checkpoint of checkpoints) {
      const tab = button(document, checkpoint.label);
      tab.dataset["checkpoint"] = checkpoint.key;
      tab.addEventListener("click", () => { selected = checkpoint; draw(); });
      tabs.append(tab);
    }
    exportPanel.append(title, shown, tabs, body);
    section.append(exportPanel);
    draw();
    if (stepNumber === 6) {
      const checkpoint = document.createElement("section");
      checkpoint.className = "tournament-op__checkpoint tournament-layout-step__continue";
      const next = button(document, localized(
        "Continue to Step 7: Create final groups",
        "Ga door naar Stap 7: Maak eindgroepen",
      ), true);
      next.addEventListener("click", () => { void run(localized("Creating final groups", "Eindgroepen maken"), () => client.generateGroups(
        document_.summary.tournamentId,
        { expectedRevision: document_.summary.revision, stage: "final" },
        controller.signal,
      )); });
      const hint = document.createElement("p");
      hint.className = "tournament-op__hint";
      hint.textContent = localized(
        "Results checked? Create the final groups now.",
        "Uitslag gecontroleerd? Maak nu de eindgroepen.",
      );
      checkpoint.append(next, hint);
      section.append(checkpoint);
    }
    content.append(section);
  };

  /**
   * Step 10 is one checklist: share the result, finalize, write the report,
   * publish it. Each item says what its button does when pressed and where
   * it stands; the writing and its publication are read from the server, so
   * a Director who saved a draft yesterday sees that here today. The report
   * page itself is a different kind of work and keeps its own page.
   */
  const renderStepTen = (document_: TournamentDocument): void => {
    const finalized = document_.summary.stage === "finalized";
    if (!finalized) {
      renderResultsExportCheckpoint(document_, "final", 10);

      // Android mounts one compact lifecycle card directly after the open
      // Step 10 export. The two choices are local until Finalize is pressed.
      const workflow = document.createElement("section");
      workflow.className = "tournament-op__panel tournament-op__lifecycle";
      const workflowTitle = document.createElement("h2");
      workflowTitle.textContent = "Tournament workflow";
      let publicResults = document_.summary.publicResults;
      let affectsRating = document_.summary.affectsRating;
      const choice = (label: string, selected: () => boolean, toggle: () => void): HTMLButtonElement => {
        const control = button(document, label);
        control.classList.add("tournament-op__lifecycle-choice");
        const refresh = (): void => control.setAttribute("aria-pressed", selected() ? "true" : "false");
        control.addEventListener("click", () => { toggle(); refresh(); });
        refresh();
        return control;
      };
      const publicChoice = choice("Public results", () => publicResults, () => { publicResults = !publicResults; });
      const ratingChoice = choice("Affects TrueSkill", () => affectsRating, () => { affectsRating = !affectsRating; });
      const review = button(document, "Review finalization");
      review.disabled = !hasCompleteTournamentStageScores(document_.groups, "final");
      const confirmation = document.createElement("div");
      confirmation.className = "tournament-op__lifecycle-confirmation";
      confirmation.hidden = true;
      const warning = document.createElement("p");
      warning.textContent = "Finalization pins the current results. Public visibility and rating inclusion are independent choices.";
      const finalize = button(document, "Finalize Tournament", true);
      const cancel = button(document, "Cancel");
      review.addEventListener("click", () => { review.hidden = true; confirmation.hidden = false; });
      cancel.addEventListener("click", () => { confirmation.hidden = true; review.hidden = false; });
      finalize.addEventListener("click", () => {
        if (!confirm(localized(
          `Finalize "${document_.summary.name}" with public results ${publicResults ? "ON" : "OFF"} and TrueSkill ${affectsRating ? "ON" : "OFF"}?`,
          `Toernooi "${document_.summary.name}" afronden met openbare uitslagen ${publicResults ? "AAN" : "UIT"} en TrueSkill ${affectsRating ? "AAN" : "UIT"}?`,
        ))) { return; }
        void run(localized("Finalizing", "Afronden"), async () => {
          const result = await client.finalize(
            document_.summary.tournamentId,
            { expectedRevision: document_.summary.revision, publicResults, affectsRating, reasonCode: "tournament_finalized" },
            controller.signal,
          );
          say(result.rating === undefined
            ? localized("Finalized.", "Afgerond.")
            : localized(
              `Finalized · ${result.rating.appliedRaces} race(s) applied to the rating${result.rating.alreadyApplied ? " (already applied before)" : ""}.`,
              `Afgerond · ${result.rating.appliedRaces} race(s) toegepast op de rating${result.rating.alreadyApplied ? " (eerder al toegepast)" : ""}.`,
            ));
          return undefined;
        });
      });
      confirmation.append(warning, finalize, cancel);
      workflow.append(workflowTitle, publicChoice, ratingChoice, review, confirmation);
      content.append(workflow);

      // Reporting is Web-only and remains available without interrupting the
      // Android sequence above.
      const reportTools = document.createElement("details");
      reportTools.className = "tournament-op__panel tournament-op__report-tools";
      const reportSummary = document.createElement("summary");
      reportSummary.textContent = localized("Report and publication", "Verslag en publicatie");
      const reportHint = caption(localized(
        "Write and publish the final report on its dedicated page after finalizing.",
        "Schrijf en publiceer het eindverslag na het afronden op de aparte verslagpagina.",
      ));
      const reportLink = document.createElement("a");
      reportLink.className = "tt-auth__button tt-auth__button--primary";
      reportLink.setAttribute("href", `/?night-report=${encodeURIComponent(document_.summary.tournamentId)}`);
      reportLink.textContent = localized("Write the final report", "Eindverslag opstellen");
      reportTools.append(reportSummary, reportHint, reportLink);
      content.append(reportTools);
      return;
    }

    const section = document.createElement("section");
    section.className = "tournament-op__panel tournament-op__step-ten";
    const title = document.createElement("h2");
    title.textContent = localized("Step 10 · Finalize and report", "Stap 10 · Afronden en verslag");
    const intro = document.createElement("p");
    intro.className = "tournament-op__hint";
    intro.textContent = localized(
      "Five parts, in this order. Each says what its button does and how far it is.",
      "Vijf onderdelen, in deze volgorde. Elk onderdeel zegt wat de knop doet en hoe ver het is.",
    );
    const list = document.createElement("ol");
    list.className = "tournament-op__checklist";

    // 1. Share the result.
    const shareCaption = captionWithDetail(localized("Downloads and shares. Nothing in the Tournament changes.", "Downloaden en delen. Er verandert niets aan het toernooi."), localized(
      "Opens the result picture for WhatsApp and the Excel workbooks. Downloads and shares only; nothing changes in the Tournament.",
      "Opent de uitslagafbeelding voor WhatsApp en de Excel-werkboeken. Alleen downloaden en delen; er verandert niets aan het toernooi.",
    ));
    list.append(checklistItem(
      localized("Share the result", "Uitslag delen"),
      checklistStatus(localized("Optional, also possible later", "Optioneel, kan ook later"), "optional"),
      renderExportFold(document_, 10), shareCaption, ...(finalized ? [renderExports(document_)] : []),
    ));

    // 2. Finalize.
    list.append(finalized ? renderFinalizedItem(document_) : renderFinalizeItem(document_));

    // 3. Write the report.
    const reportStatus = checklistStatus(localized("Loading status…", "Status laden…"), "todo");
    const link = document.createElement("div");
    link.className = "tournament-op__report-link";
    const open = document.createElement("a");
    open.className = "tt-auth__button tt-auth__button--primary";
    open.setAttribute("href", `/?night-report=${encodeURIComponent(document_.summary.tournamentId)}`);
    open.textContent = localized("Write the final report", "Eindverslag opstellen");
    link.append(open, captionWithDetail(localized("Opens the report page. Every block is kept as a draft.", "Opent de verslagpagina. Elk blok wordt als concept bewaard."), localized(
      "Opens the report page. You write in the page itself, block by block; every save keeps the draft on the server, also after closing the browser. The community sees nothing until the report is published.",
      "Opent de verslagpagina. Daar schrijf je in de pagina zelf, per blok; elke keer opslaan bewaart het concept op de server, ook als je de browser sluit. De community ziet niets tot het verslag gepubliceerd wordt.",
    )));
    const access = document.createElement("div");
    const figures = document.createElement("details");
    figures.className = "tournament-export-fold";
    const figuresSummary = document.createElement("summary");
    figuresSummary.textContent = localized("Figures for the report", "Cijfers voor het verslag");
    figures.append(figuresSummary, caption(localized(
      "The same figures the report page draws from; here only to read along.",
      "Dezelfde cijfers waar de verslagpagina uit put; hier alleen om mee te lezen.",
    )));
    const analytics = renderAnalytics(document_);
    if (analytics !== null) { figures.append(analytics); }
    list.append(checklistItem(localized("Write the final report", "Eindverslag schrijven"), reportStatus, link, access, figures));

    // 4. Publish.
    const publishStatus = checklistStatus(
      finalized ? localized("Loading status…", "Status laden…") : localized("Waits for part 2", "Wacht op onderdeel 2"),
      finalized ? "todo" : "blocked",
    );
    const publishCaption = captionWithDetail(localized("You publish on the report page, once the night is finalized.", "Publiceren doe je op de verslagpagina, zodra de avond is afgerond."), localized(
      "Publishing happens on the report page with the button \"Publish report\", only once the night is finalized. From then on the community reads that version; writing on and publishing again is always possible.",
      "Publiceren gebeurt op de verslagpagina met de knop \"Verslag publiceren\", pas als de avond is afgerond. Daarna leest de community die versie; verder schrijven en opnieuw publiceren kan altijd.",
    ));
    const publishNote = caption("");
    publishNote.hidden = true;
    if (finalized && !document_.summary.publicResults) {
      publishNote.hidden = false;
      publishNote.textContent = localized(
        "Note: public results are OFF, so the community will not see the report until you show the results in part 2.",
        "Let op: de openbare uitslagen staan UIT, dus de community ziet het verslag pas als je de uitslagen bij onderdeel 2 toont.",
      );
    }
    list.append(checklistItem(localized("Publish the report", "Verslag publiceren"), publishStatus, publishCaption, publishNote));

    // 5. The WordPress export of the published report: one file, everything inside it.
    const wordpressStatus = checklistStatus(
      finalized ? localized("Loading status…", "Status laden…") : localized("Waits for part 4", "Wacht op onderdeel 4"),
      finalized ? "todo" : "blocked",
    );
    const wordpressBox = document.createElement("div");
    wordpressBox.className = "tournament-op__report-link";
    const wordpressNote = caption("");
    wordpressNote.setAttribute("role", "status");
    wordpressNote.hidden = true;
    const wordpressButtons: HTMLButtonElement[] = [];
    // Two looks of the same published report: this site's, and the community's classic TN12
    // export made by the original Seating & Standings Manager code (tournament-report-classic.ts).
    const wordpressButton = (label: string, build: (event: PublicTournamentEvent) => Promise<WordpressReportExport>): HTMLButtonElement => {
      const control = document.createElement("button");
      control.type = "button";
      control.className = "tt-auth__button";
      control.textContent = label;
      control.disabled = true;
      control.addEventListener("click", () => {
        for (const other of wordpressButtons) { other.disabled = true; }
        wordpressNote.hidden = false;
        wordpressNote.textContent = localized(
          "Building the export: every chart, picture and font goes into the file. This takes a moment…",
          "Export wordt gemaakt: elke grafiek, afbeelding en elk lettertype gaat in het bestand. Dit duurt even…",
        );
        void (async () => {
          try {
            const event = await client.loadPublic(document_.summary.tournamentId, controller.signal);
            if (event.report === undefined) {
              wordpressNote.textContent = localized("Publish the report first (part 4).", "Publiceer eerst het verslag (onderdeel 4).");
              return;
            }
            const result = await build(event);
            downloadBlob(new Blob([result.html], { type: "text/html;charset=utf-8" }), result.fileName);
            const megabytes = localized((result.bytes / 1_048_576).toFixed(1), (result.bytes / 1_048_576).toFixed(1).replace(".", ","));
            wordpressNote.textContent = localized(
              `Downloaded ${result.fileName} · ${megabytes} MB · ${result.charts} charts. Open it in Notepad, select all (Ctrl+A), copy, and paste everything into the WordPress post (code editor or block editor); it becomes one Custom HTML block.`,
              `${result.fileName} gedownload · ${megabytes} MB · ${result.charts} grafieken. Open het in Kladblok, selecteer alles (Ctrl+A), kopieer en plak alles in het WordPress-bericht (code-editor of blok-editor); het wordt één blok Aangepaste HTML.`,
            );
          } catch (error: unknown) {
            if (disposed) { return; }
            wordpressNote.textContent = localized(
              `The export failed: ${error instanceof Error ? error.message : String(error)}`,
              `De export is mislukt: ${error instanceof Error ? error.message : String(error)}`,
            );
          } finally {
            if (!disposed) { for (const other of wordpressButtons) { other.disabled = false; } }
          }
        })();
      });
      wordpressButtons.push(control);
      return control;
    };
    // The old export page's "Groep" choice, for the classic file only.
    const classicGroups = document.createElement("select");
    classicGroups.className = "ds-select";
    classicGroups.setAttribute("aria-label", localized("Races in the classic export", "Races in de klassieke export"));
    for (const [value, english, dutch] of [
      ["__tabs__", "Final group / qualifier tab per Player (Top 5 counts every race)", "Tab eindgroep / kwalificatie per speler (Top 5 telt elke race)"],
      ["__all__", "All races in one chart", "Alle races in één grafiek"],
      ["__post_only__", "End groups only (as TN12)", "Alleen eindgroepen (zoals TN12)"],
      ["__qualifier_only__", "Qualifiers only", "Alleen kwalificatie"],
    ] as const) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = localized(english, dutch);
      classicGroups.append(option);
    }
    const classicButton = wordpressButton(
      localized("Classic look, as TN12 (.html)", "Klassieke opmaak, zoals TN12 (.html)"),
      (event) => buildClassicWordpressReport(document, event, classicGroups.value as ClassicGroups),
    );
    const siteButton = wordpressButton(
      localized("This site's look (.html)", "Opmaak van deze site (.html)"),
      (event) => buildWordpressReport(document, event, event.report === undefined ? null : tournamentStoryFromReport(event.report)),
    );
    wordpressBox.append(classicButton, classicGroups, siteButton, captionWithDetail(
      localized("One file with the published report, data embedded, to paste into WordPress: the classic TN12 look or this site's look.", "Eén bestand met het gepubliceerde verslag, data ingesloten, om in WordPress te plakken: in de klassieke TN12-opmaak of in die van deze site."),
      localized(
        "The classic look is made by the original export of the Seating & Standings Manager (the same code and layout as the TN12 post), fed with this night's published report. This site's look builds the report as the community reads it here, in the light appearance. Both are one HTML file: the stylesheet, every picture and every chart's readouts are inside it, with a small script for the readouts under the charts and the bar that says where the reader is. Open the file in Notepad, select everything, copy it and paste it into the WordPress post, in the code editor or the block editor: the file starts and ends with the wp:html block markers, so WordPress keeps it as one Custom HTML block. It always follows the published version; publish again first if you changed the draft.",
        "De klassieke opmaak wordt gemaakt door de oorspronkelijke export van de Seating & Standings Manager (dezelfde code en opmaak als het TN12-bericht), gevoed met het gepubliceerde verslag van deze avond. De opmaak van deze site maakt het verslag zoals de community het hier leest, in de lichte weergave. Beide zijn één HTML-bestand: de opmaak, elke afbeelding en de uitlezingen van elke grafiek zitten erin, met een klein script voor de uitlezing onder de grafieken en de balk die zegt waar de lezer is. Open het bestand in Kladblok, selecteer alles, kopieer het en plak het in het WordPress-bericht, in de code-editor of de blok-editor: het bestand begint en eindigt met de wp:html-blokmarkering, zodat WordPress het als één blok Aangepaste HTML bewaart. Het volgt altijd de gepubliceerde versie; publiceer eerst opnieuw als je het concept hebt aangepast.",
      ),
    ), wordpressNote);
    list.append(checklistItem(localized("WordPress export", "WordPress-export"), wordpressStatus, wordpressBox));

    section.append(title, intro, list);
    content.append(section);

    const showReport = (report: TournamentReportDocument): void => {
      const draft = report.draft;
      if (draft === null) {
        reportStatus.textContent = localized("Nothing written yet", "Nog niets geschreven");
      } else {
        reportStatus.textContent = localized(
          `Draft saved · revision ${draft.revision} · ${stamp(draft.updatedAtMs)}`,
          `Concept opgeslagen · revisie ${draft.revision} · ${stamp(draft.updatedAtMs)}`,
        );
        reportStatus.className = "tournament-op__checklist-status tournament-op__checklist-status--done";
      }
      if (finalized) {
        if (draft?.publishedRevision === undefined) {
          publishStatus.textContent = localized("Not published yet", "Nog niet gepubliceerd");
        } else {
          const newer = draft.revision > draft.publishedRevision;
          publishStatus.textContent = localized(
            `Published · revision ${draft.publishedRevision}${draft.publishedAtMs === undefined ? "" : ` · ${stamp(draft.publishedAtMs)}`}${newer ? " · the draft has changed since" : ""}`,
            `Gepubliceerd · revisie ${draft.publishedRevision}${draft.publishedAtMs === undefined ? "" : ` · ${stamp(draft.publishedAtMs)}`}${newer ? " · het concept is sindsdien gewijzigd" : ""}`,
          );
          publishStatus.className = `tournament-op__checklist-status tournament-op__checklist-status--${newer ? "todo" : "done"}`;
        }
        if (draft?.publishedRevision === undefined) {
          wordpressStatus.textContent = localized("Waits for part 4", "Wacht op onderdeel 4");
          wordpressStatus.className = "tournament-op__checklist-status tournament-op__checklist-status--blocked";
        } else {
          wordpressStatus.textContent = localized(
            `Ready · follows published revision ${draft.publishedRevision}`,
            `Klaar · volgt gepubliceerde revisie ${draft.publishedRevision}`,
          );
          wordpressStatus.className = "tournament-op__checklist-status tournament-op__checklist-status--optional";
          for (const control of wordpressButtons) { control.disabled = false; }
        }
      }
      if (report.mayManageAccess) {
        access.append(renderReportGrants(document, reportClient, async () => {
          const listed = await client.listDirectors(controller.signal);
          return listed.directors.map((director) => ({ userAccountId: director.userAccountId, displayName: director.displayName }));
        }, controller.signal));
      }
    };
    void reportClient.load(document_.summary.tournamentId, controller.signal).then((report) => {
      if (!disposed) { showReport(report); }
    }, (error: unknown) => {
      if (disposed) { return; }
      const forbidden = error instanceof TournamentReportClientError && error.status === 403;
      reportStatus.textContent = forbidden
        ? localized("This account may not write reports; an administrator grants that here", "Dit account mag geen verslag schrijven; een beheerder kent dat hier toe")
        : localized("Status unavailable", "Status niet beschikbaar");
      reportStatus.className = "tournament-op__checklist-status tournament-op__checklist-status--blocked";
      if (finalized) {
        publishStatus.textContent = reportStatus.textContent; publishStatus.className = reportStatus.className;
        wordpressStatus.textContent = reportStatus.textContent; wordpressStatus.className = reportStatus.className;
      }
    });
  };

  const renderExports = (document_: TournamentDocument): HTMLElement => {
    const section = document.createElement("div");
    section.className = "tournament-op__text-export";
    const title = document.createElement("h4");
    title.textContent = localized("Export as text", "Exporteren als tekst");
    const controls = document.createElement("div");
    controls.className = "tournament-op__controls";
    const area = document.createElement("textarea");
    area.className = "tournament-op__export";
    area.readOnly = true;
    area.rows = 8;
    area.setAttribute("aria-label", localized("Export text", "Exporttekst"));
    const exportKind: "qualifier" | "final" | "results" = document_.summary.workflowStep === 4
      ? "qualifier"
      : document_.summary.workflowStep === 8 ? "final" : "results";
    const refreshArea = (): void => {
      area.value = exportKind === "results" ? standingsText(document_) : seatingText(document_, exportKind);
    };
    refreshArea();
    const share = button(document, localized("Share / copy", "Delen / kopiëren"));
    share.addEventListener("click", () => {
      void (async () => {
        try {
          if (globalThis.navigator?.share !== undefined) {
            await globalThis.navigator.share({ title: document_.summary.name, text: area.value });
            say(localized("Shared.", "Gedeeld."));
          } else {
            await globalThis.navigator.clipboard.writeText(area.value);
            say(localized("Copied to the clipboard.", "Naar het klembord gekopieerd."));
          }
        } catch (error) {
          if (!(error instanceof DOMException && error.name === "AbortError")) {
            say(localized(
              "Sharing is unavailable. The text remains selected below.",
              "Delen is niet beschikbaar. De tekst blijft hieronder geselecteerd.",
            ));
            area.select();
          }
        }
      })();
    });
    const download = (blob: Blob, extension: string): void => {
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = `${document_.summary.name.replace(/[^A-Za-z0-9_-]+/g, "-") || "tournament"}.${extension}`;
      anchor.click();
      URL.revokeObjectURL(href);
    };
    const png = button(document, localized("Download PNG", "PNG downloaden"));
    png.addEventListener("click", () => {
      const lines = area.value.split("\n");
      const canvas = document.createElement("canvas");
      canvas.width = 1200;
      canvas.height = Math.max(420, 110 + lines.length * 32);
      const context = canvas.getContext("2d");
      if (context === null) { say(localized("Image export is unavailable in this browser.", "Afbeelding exporteren is niet beschikbaar in deze browser.")); return; }
      context.fillStyle = "#f5f0e6";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = "#17221b";
      context.font = "700 34px sans-serif";
      context.fillText(document_.summary.name, 52, 58);
      context.font = "22px sans-serif";
      lines.forEach((line, index) => context.fillText(line.replaceAll("*", ""), 52, 108 + index * 32, 1090));
      canvas.toBlob((blob) => {
        if (blob === null) { say(localized("Image export could not be created.", "De afbeelding kon niet worden gemaakt.")); return; }
        download(blob, "png");
      }, "image/png");
    });
    const csv = button(document, localized("Download CSV", "CSV downloaden"));
    csv.addEventListener("click", () => download(new Blob([
      exportKind === "results" ? standingsCsv(document_) : seatingCsv(document_, exportKind),
    ], { type: "text/csv;charset=utf-8" }), "csv"));
    controls.append(share, png, csv);
    section.append(title, controls, area);
    return section;
  };

  const renderIncidents = (document_: TournamentDocument): void => {
    const section = document.createElement("section");
    section.className = "tournament-op__panel";
    const title = document.createElement("h2");
    title.textContent = localized("Incidents", "Incidenten");
    const hint = document.createElement("p");
    hint.className = "tournament-op__hint";
    hint.textContent = localized(
      "Record the incident and, where applicable, apply its attendance or Switch consequence in the same action.",
      "Leg het incident vast en pas waar nodig de gevolgen voor aanwezigheid of Switch in dezelfde actie toe.",
    );
    const form = document.createElement("form");
    form.className = "tournament-op__incident-form";
    const category = document.createElement("select");
    category.setAttribute("aria-label", localized("Incident category", "Incidentcategorie"));
    for (const [value, label] of [
      ["attendance", localized("Attendance", "Aanwezigheid")],
      ["replacement", localized("Replacement", "Vervanging")],
      ["equipment", localized("Equipment", "Apparatuur")],
      ["scoring", localized("Scoring", "Score")],
      ["conduct", localized("Conduct", "Gedrag")],
      ["other", localized("Other", "Overig")],
    ] as const) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      category.append(option);
    }
    const related = document.createElement("select");
    related.setAttribute("aria-label", localized("Related Player", "Betrokken speler"));
    const tournament = document.createElement("option");
    tournament.value = "";
    tournament.textContent = localized("Whole tournament", "Hele toernooi");
    related.append(tournament);
    for (const participant of document_.participants) {
      const option = document.createElement("option");
      option.value = participant.playerId;
      option.textContent = participant.displayName;
      related.append(option);
    }
    const note = document.createElement("input");
    note.required = true;
    note.maxLength = 160;
    note.placeholder = localized("What happened?", "Wat is er gebeurd?");
    note.setAttribute("aria-label", localized("Incident note", "Incidentnotitie"));
    const consequence = document.createElement("select");
    consequence.setAttribute("aria-label", localized("Incident consequence", "Gevolg van incident"));
    for (const [value, label] of [
      ["log", localized("Log only", "Alleen vastleggen")],
      ["present", localized("Mark present", "Markeer Aanwezig")],
      ["waiting", localized("Move to waiting list", "Verplaats naar Wachtlijst")],
      ["absent", localized("Mark absent", "Markeer Afwezig")],
      ["ns1_unavailable", localized("NS1 unavailable", "NS1 niet beschikbaar")],
      ["ns2_unavailable", localized("NS2 unavailable", "NS2 niet beschikbaar")],
    ] as const) {
      const option = document.createElement("option"); option.value = value; option.textContent = label; consequence.append(option);
    }
    const submit = document.createElement("button");
    submit.type = "submit";
    submit.className = "tt-auth__button";
    submit.textContent = localized("Record incident", "Incident vastleggen");
    form.append(category, related, consequence, note, submit);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void run(localized("Recording incident", "Incident vastleggen"), async () => {
        let updated = document_;
        const participant = document_.participants.find((candidate) => candidate.playerId === related.value);
        if (consequence.value !== "log") {
          if (participant === undefined) { throw new TournamentOperationClientError("invalid_input", localized(
            "Choose a related Player for this consequence.",
            "Kies een betrokken speler voor dit gevolg.",
          )); }
          updated = await client.setParticipant(document_.summary.tournamentId, {
            expectedRevision: updated.summary.revision,
            playerId: participant.playerId,
            ...(consequence.value === "present" || consequence.value === "waiting" || consequence.value === "absent" ? { attendance: consequence.value } : {}),
            ...(consequence.value === "ns1_unavailable" ? { hasSwitch1: false } : {}),
            ...(consequence.value === "ns2_unavailable" ? { hasSwitch2: false } : {}),
          }, controller.signal);
        }
        return client.recordIncident(updated.summary.tournamentId, {
          expectedRevision: updated.summary.revision,
          category: category.value as "attendance" | "replacement" | "equipment" | "scoring" | "conduct" | "other",
          note: `${note.value}${consequence.value === "log" ? "" : ` [${consequence.value}]`}`,
          ...(related.value === "" ? {} : { playerId: related.value }),
        }, controller.signal);
      });
    });
    const list = document.createElement("ul");
    list.className = "tournament-op__incident-list";
    const names = new Map(document_.participants.map((participant) => [participant.playerId, participant.displayName]));
    for (const incident of document_.lifecycle.filter((event) => event.eventType === "incident_recorded").reverse()) {
      const [kind = "other", relatedId = "tournament", detail = ""] = incident.detail?.split("|") ?? [];
      const item = document.createElement("li");
      item.textContent = `${new Date(incident.occurredAtMs).toLocaleString()} · ${kind} · ${relatedId === "tournament" ? "Tournament" : names.get(relatedId) ?? relatedId} · ${detail}`;
      list.append(item);
    }
    section.append(title, hint, form, list);
    content.append(section);
  };

  const renderAnalytics = (document_: TournamentDocument): HTMLElement | null => {
    const analytics = buildTournamentInsights(document_);
    if (document_.groups.length === 0) { return null; }
    const section = document.createElement("section");
    section.className = "tournament-op__panel";
    const title = document.createElement("h2");
    title.textContent = localized("Tournament analytics", "Toernooianalyse");
    const summary = document.createElement("p");
    summary.className = "tournament-op__hint";
    summary.textContent = localized(
      `${analytics.participantCount} participants · ${analytics.raceCount} counted races · ${analytics.voidedRaceCount} voided races`,
      `${analytics.participantCount} deelnemers · ${analytics.raceCount} meetellende races · ${analytics.voidedRaceCount} ongeldig verklaarde races`,
    );
    const list = document.createElement("ol");
    list.className = "tournament-op__analytics";
    for (const row of analytics.players) {
      const item = document.createElement("li");
      item.textContent = localized(
        `${row.displayName} · ${row.points} pts · ${row.wins} wins · ${row.podiums} podiums · ${row.averageFinish.toFixed(2)} avg finish · consistency σ ${row.consistency.toFixed(2)} · closing ${row.closingDelta >= 0 ? "+" : ""}${row.closingDelta.toFixed(1)}`,
        `${row.displayName} · ${row.points} pnt · ${row.wins} overwinningen · ${row.podiums} podiums · ${row.averageFinish.toFixed(2)} gem. finish · consistentie σ ${row.consistency.toFixed(2)} · slot ${row.closingDelta >= 0 ? "+" : ""}${row.closingDelta.toFixed(1)}`,
      );
      list.append(item);
    }
    const tracks = document.createElement("ul"); tracks.className = "tournament-op__analytics";
    for (const row of analytics.tracks) { const item = document.createElement("li"); item.textContent = localized(
      `${trackName(row.trackId)} · ${row.races} races · top performer ${row.topPlayer}`,
      `${trackName(row.trackId)} · ${row.races} races · beste speler ${row.topPlayer}`,
    ); tracks.append(item); }
    const comparisons = document.createElement("ul"); comparisons.className = "tournament-op__analytics";
    for (const row of analytics.headToHead.slice(0, 8)) {
      const item = document.createElement("li");
      item.textContent = localized(
        `${row.left} ${row.leftWins}–${row.rightWins} ${row.right} · ${row.sharedRaces} shared races${row.ties > 0 ? ` · ${row.ties} ties` : ""}`,
        `${row.left} ${row.leftWins}–${row.rightWins} ${row.right} · ${row.sharedRaces} gezamenlijke races${row.ties > 0 ? ` · ${row.ties} gelijke standen` : ""}`,
      );
      comparisons.append(item);
    }
    section.append(title, summary, list, tracks, comparisons);
    return section;
  };


  const ready = (async () => {
    const tournamentId = options.tournamentId ?? null;
    // A deep link may carry the acting director; it is only honoured when
    // the server offers that account to this operator.
    if (options.directorUserAccountId !== undefined && options.directorUserAccountId !== null) {
      try {
        const listed = await client.listDirectors(controller.signal);
        operatorIsAdministrator = listed.canActForOthers;
        const director = listed.directors.find((entry) => entry.userAccountId === options.directorUserAccountId);
        if (director !== undefined) {
          selectedDirector = { userAccountId: director.userAccountId, displayName: director.displayName };
        }
      } catch { /* Step 0 explains */ }
      if (disposed) { return; }
    }
    if (selectedDirector === null && tournamentId === null) {
      await renderDirectorStep();
      return;
    }
    if (tournamentId === null) {
      await renderList();
      return;
    }
    try {
      current = await client.load(tournamentId, controller.signal);
      if (disposed) { return; }
      if (selectedDirector === null) {
        // A per-night edit link opens the requested Tournament immediately.
        // Resolve its Director in the background through the same authorized
        // lists Step 0 uses, so leaving the document returns to the right
        // Director's list instead of asking the administrator to search again.
        try {
          const listed = await client.listDirectors(controller.signal);
          operatorIsAdministrator = listed.canActForOthers;
          for (const director of listed.directors) {
            const owned = await client.listForAdministrator(
              { directorUserAccountId: director.userAccountId }, controller.signal,
            );
            if (owned.some((entry) => entry.tournamentId === tournamentId)) {
              selectedDirector = {
                userAccountId: director.userAccountId,
                displayName: director.displayName,
              };
              break;
            }
          }
        } catch { /* The loaded Tournament remains usable; Step 0 can recover. */ }
        if (disposed) { return; }
      }
      if (current.summary.workflowStep === 2 && current.participants.length === 0) {
        say(localized("Synchronizing historical Tournament Players…", "Historische toernooispelers synchroniseren…"));
        try {
          current = await client.addHistoricalParticipants(
            current.summary.tournamentId,
            { expectedRevision: current.summary.revision },
            controller.signal,
          );
        } catch (error) {
          if (disposed) { return; }
          say(errorText(error, localized(
            "Tournament history could not be synchronized automatically. Use the roster tool to retry.",
            "De toernooigeschiedenis kon niet automatisch worden gesynchroniseerd. Probeer opnieuw via het lijsthulpmiddel.",
          )));
          renderDocument();
          return;
        }
      }
      say("");
      renderDocument();
    } catch (error) {
      if (disposed) { return; }
      say(errorText(error, localized("The tournament could not be loaded.", "Het toernooi kon niet worden geladen.")));
    }
  })();

  return {
    container,
    ready,
    unmount(): void {
      if (disposed) { return; }
      disposed = true;
      controller.abort();
      incomingController?.abort();
      importSection?.unmount();
      signupBoard?.unmount();
      if (container.parentNode === root) { root.removeChild(container); }
    },
  };
}
import { mountTournamentIncomingSection } from "./tournament-incoming-section.js";
import { type TournamentRaceMode, tournamentRaceClassLabel } from "./tournament-race-class.js";
