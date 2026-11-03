import type { TournamentAttendance, TournamentDocument, TournamentGroupStage } from "./tournament-operation-client.js";
import { tournamentBoardModel, tournamentStationKey } from "./tournament-group-board.js";
import { localized } from "./product-language.js";

/** A Switch selected for somebody who is not playing is allowed - the seating
 * pools it as a borrowed console - but it is easy to do by accident, so the
 * Director confirms it. Null when the owner plays. */
export function tournamentLenderWarning(displayName: string, attendance: TournamentAttendance, switchType: "NS1" | "NS2"): string | null {
  if (attendance === "present") { return null; }
  const state = attendance === "waiting" ? localized("Waiting list", "Wachtlijst") : localized("Absent", "Afwezig");
  return localized(
    `Note: ${displayName} is set to ${state}, but the Nintendo Switch ${switchType} of ${displayName} is being selected. It then counts as a borrowed console without a player. Are you sure?`,
    `Let op: ${displayName} staat op ${state}, maar de Nintendo Switch ${switchType} van ${displayName} wordt wel geselecteerd. De console telt dan mee als geleende Switch zonder speler. Weet je dit zeker?`,
  );
}

/** True when this participant lends a console without playing. */
export function tournamentLendsWithoutPlaying(participant: Readonly<{ attendance: TournamentAttendance; hasSwitch1: boolean; hasSwitch2: boolean }>): boolean {
  return participant.attendance !== "present" && (participant.hasSwitch1 || participant.hasSwitch2);
}

export type EquipmentSlotChoice = Readonly<{
  groupId: string;
  slotIndex: number;
  ownerPlayerId: string;
  switchType: "ns1" | "ns2";
}>;

export function tournamentLayoutInspectionStage(document: TournamentDocument, targetStep: number): TournamentGroupStage | null {
  const stage = targetStep === 3 ? "qualifier" : targetStep === 7 ? "final" : null;
  return stage !== null && document.groups.some((group) => group.stage === stage &&
    (group.races.length > 0 || group.manualScores.length > 0)) ? stage : null;
}

/** What a real return to the layout step detaches: the accepted races and
 * manual scores of that stage. Groups, seats and Switch owners stay, so the
 * Step 2/3 (or Step 7) layout is never rewritten by it; the detached scores
 * have to be entered or imported again. Null when nothing is attached. */
export function tournamentLayoutDetachment(document: TournamentDocument, targetStep: number): Readonly<{
  stage: TournamentGroupStage; groups: number; races: number; manualScores: number;
}> | null {
  const stage = tournamentLayoutInspectionStage(document, targetStep);
  if (stage === null) { return null; }
  const groups = document.groups.filter((group) => group.stage === stage);
  return {
    stage, groups: groups.length,
    races: groups.reduce((total, group) => total + group.races.length, 0),
    manualScores: groups.reduce((total, group) => total + group.manualScores.length, 0),
  };
}

/** Equipment can move without reseeding people or rewriting their results.
 * Existing seat numbers follow a replaced physical console within that group.
 * A newly filled empty slot seats only previously unseated group members. */
export function tournamentEquipmentCorrectionLayout(
  document: TournamentDocument,
  stage: TournamentGroupStage,
  choices: readonly EquipmentSlotChoice[],
) {
  const board = tournamentBoardModel(document, stage);
  return board.groups.map((group) => {
    const original = document.groups.find((candidate) => candidate.groupId === group.groupId)!;
    const selected = choices.filter((choice) => choice.groupId === group.groupId)
      .sort((left, right) => left.slotIndex - right.slotIndex);
    const replacement = new Map(group.slots.flatMap((slot, index) => slot === null ? [] : [
      [slot.key, selected.find((choice) => choice.slotIndex === index)] as const,
    ]));
    const seats = original.members.map((member) => {
      const station = member.station === undefined ? undefined
        : replacement.get(tournamentStationKey(member.station.ownerPlayerId, member.station.switchType));
      return {
        playerId: member.playerId,
        stationOwnerPlayerId: station?.ownerPlayerId ?? null,
        switchType: station?.switchType ?? null,
        seatNumber: station === undefined ? null : member.station!.seatNumber as 1 | 2,
      };
    });
    for (const choice of selected.filter((choice) => group.slots[choice.slotIndex] === null)) {
      for (const seatNumber of [1, 2] as const) {
        const unseated = seats.find((seat) => seat.stationOwnerPlayerId === null);
        if (unseated === undefined) { break; }
        unseated.stationOwnerPlayerId = choice.ownerPlayerId;
        unseated.switchType = choice.switchType;
        unseated.seatNumber = seatNumber;
      }
    }
    return { name: original.name, seats,
      stations: selected.map((choice) => ({ stationOwnerPlayerId: choice.ownerPlayerId, switchType: choice.switchType })),
    };
  });
}
