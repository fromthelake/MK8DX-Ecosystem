// The Step 3/7 group board model and drag semantics of the source Manager
// (`renderGroupBoard` / `setupGroupBoardDnD` in the original `assets/app.js`),
// expressed against the canonical server contract: every drag composes the
// complete desired stage layout and sends it through the atomic
// import-group-layout operation, which preserves exact seats. Only a
// population change (parking or unparking someone) needs the membership
// update first; the layout follows in the same action.

import type {
  TournamentDocument,
  TournamentGroupStage,
} from "./tournament-operation-client.js";

export const TOURNAMENT_BOARD_GROUP_SLOTS = 6;
export const TOURNAMENT_BOARD_GROUP_PLAYERS = 12;

// ---------------------------------------------------------------------------
// Colours: the source STEP3_SEAT_PALETTE, five group palettes of six slot
// tones. A group takes palette[groupIndex % 5]; a slot takes tone[slot % 6].
export type TournamentSeatTone = Readonly<{ hex: string; tone: "dark" | "light" }>;

export const TOURNAMENT_SEAT_PALETTE: readonly (readonly TournamentSeatTone[])[] = [
  [
    { hex: "#93C5FD", tone: "dark" }, { hex: "#60A5FA", tone: "dark" },
    { hex: "#3B82F6", tone: "light" }, { hex: "#2563EB", tone: "light" },
    { hex: "#4F46E5", tone: "light" }, { hex: "#3730A3", tone: "light" },
  ],
  [
    { hex: "#D9F99D", tone: "dark" }, { hex: "#BEF264", tone: "dark" },
    { hex: "#86EFAC", tone: "dark" }, { hex: "#4ADE80", tone: "dark" },
    { hex: "#16A34A", tone: "light" }, { hex: "#166534", tone: "light" },
  ],
  [
    { hex: "#FCA5A5", tone: "dark" }, { hex: "#F87171", tone: "dark" },
    { hex: "#EF4444", tone: "light" }, { hex: "#DC2626", tone: "light" },
    { hex: "#B91C1C", tone: "light" }, { hex: "#991B1B", tone: "light" },
  ],
  [
    { hex: "#E879F9", tone: "dark" }, { hex: "#D946EF", tone: "dark" },
    { hex: "#C026D3", tone: "light" }, { hex: "#A21CAF", tone: "light" },
    { hex: "#86198F", tone: "light" }, { hex: "#701A75", tone: "light" },
  ],
  [
    { hex: "#99F6E4", tone: "dark" }, { hex: "#5EEAD4", tone: "dark" },
    { hex: "#2DD4BF", tone: "dark" }, { hex: "#0D9488", tone: "light" },
    { hex: "#0F766E", tone: "light" }, { hex: "#134E4A", tone: "light" },
  ],
];

export function tournamentSeatTone(groupIndex: number, slotIndex: number): TournamentSeatTone {
  const palette = TOURNAMENT_SEAT_PALETTE[groupIndex % TOURNAMENT_SEAT_PALETTE.length]!;
  return palette[slotIndex % palette.length]!;
}

export function tournamentGroupGradient(groupIndex: number): Readonly<{ start: string; end: string }> {
  const palette = TOURNAMENT_SEAT_PALETTE[groupIndex % TOURNAMENT_SEAT_PALETTE.length]!;
  return { start: palette[0]!.hex, end: palette[palette.length - 1]!.hex };
}

// ---------------------------------------------------------------------------
// Tiers: the source FIXED_TIER_DEFINITIONS by SP rank band, plus Nieuw.
export type TournamentTier = Readonly<{ key: string; name: string }>;

const TIER_BANDS: readonly Readonly<{ key: string; name: string; min: number; max: number }>[] = [
  { key: "champion", name: "Kampioen", min: 1, max: 12 },
  { key: "talent", name: "Talent", min: 13, max: 24 },
  { key: "wild", name: "Wild", min: 25, max: 36 },
  { key: "adventure", name: "Avontuur", min: 37, max: 48 },
  { key: "feest", name: "Feest", min: 49, max: 60 },
];

export function tournamentTierForPlayer(
  participant: Readonly<{ seedRank?: number; isNew?: boolean }>,
): TournamentTier {
  if (participant.isNew ?? false) { return { key: "new", name: "Nieuw" }; }
  const rank = participant.seedRank;
  const band = rank === undefined ? undefined : TIER_BANDS.find((entry) => rank >= entry.min && rank <= entry.max);
  return band === undefined ? { key: "unknown", name: "Onbekend" } : { key: band.key, name: band.name };
}

// ---------------------------------------------------------------------------
// Board model.
export type TournamentBoardSeat = Readonly<{ playerId: string; displayName: string }> | null;

export type TournamentBoardStation = Readonly<{
  key: string;
  ownerPlayerId: string;
  ownerDisplayName: string;
  switchType: "ns1" | "ns2";
  utpCableNumber?: number;
  seats: readonly [TournamentBoardSeat, TournamentBoardSeat];
}>;

export type TournamentBoardGroup = Readonly<{
  groupId: string;
  name: string;
  index: number;
  slots: readonly (TournamentBoardStation | null)[];
  memberIds: readonly string[];
  unseated: readonly Readonly<{ playerId: string; displayName: string }>[];
}>;

export type TournamentBoardModel = Readonly<{
  stage: TournamentGroupStage;
  groups: readonly TournamentBoardGroup[];
  parkedPlayers: readonly Readonly<{ playerId: string; displayName: string }>[];
  parkedStations: readonly Readonly<{
    key: string; ownerPlayerId: string; ownerDisplayName: string; switchType: "ns1" | "ns2";
  }>[];
}>;

export function tournamentStationKey(ownerPlayerId: string, switchType: string): string {
  return `${ownerPlayerId}|${switchType.toLowerCase()}`;
}

/** The APK's UTP derivation: qualifier board order first, then final-only
 * stations appended, numbered 1..N for the whole Tournament. */
export function tournamentUtpByStation(document_: TournamentDocument): ReadonlyMap<string, number> {
  const ordered: string[] = [];
  for (const stage of ["qualifier", "final"] as const) {
    for (const group of document_.groups
      .filter((group) => group.stage === stage)
      .slice()
      .sort((left, right) => left.sequence - right.sequence)) {
      for (const member of [...group.members].sort((left, right) => left.seatOrder - right.seatOrder)) {
        if (member.station === undefined) { continue; }
        const key = tournamentStationKey(member.station.ownerPlayerId, member.station.switchType);
        if (!ordered.includes(key)) { ordered.push(key); }
      }
    }
  }
  return new Map(ordered.map((key, index) => [key, index + 1]));
}

export function tournamentBoardModel(
  document_: TournamentDocument,
  stage: TournamentGroupStage,
): TournamentBoardModel {
  const utp = tournamentUtpByStation(document_);
  const groups = document_.groups
    .filter((group) => group.stage === stage)
    .slice()
    .sort((left, right) => left.sequence - right.sequence)
    .map((group, index) => {
      const stations = new Map<string, {
        ownerPlayerId: string; ownerDisplayName: string; switchType: "ns1" | "ns2";
        seats: [TournamentBoardSeat, TournamentBoardSeat];
      }>();
      // The stored slot order first - a Switch placed in an empty slot sits
      // here with nobody at it yet - then any console a seat still names.
      for (const station of [...(group.stations ?? [])].sort((left, right) => left.slotIndex - right.slotIndex)) {
        stations.set(tournamentStationKey(station.ownerPlayerId, station.switchType), {
          ownerPlayerId: station.ownerPlayerId,
          ownerDisplayName: station.ownerDisplayName,
          switchType: station.switchType,
          seats: [null, null] as [TournamentBoardSeat, TournamentBoardSeat],
        });
      }
      const unseated: { playerId: string; displayName: string }[] = [];
      for (const member of [...group.members].sort((left, right) => left.seatOrder - right.seatOrder)) {
        if (member.station === undefined) {
          unseated.push({ playerId: member.playerId, displayName: member.displayName });
          continue;
        }
        const key = tournamentStationKey(member.station.ownerPlayerId, member.station.switchType);
        const station = stations.get(key) ?? {
          ownerPlayerId: member.station.ownerPlayerId,
          ownerDisplayName: member.station.ownerDisplayName,
          switchType: member.station.switchType,
          seats: [null, null] as [TournamentBoardSeat, TournamentBoardSeat],
        };
        station.seats[member.station.seatNumber === 2 ? 1 : 0] =
          { playerId: member.playerId, displayName: member.displayName };
        stations.set(key, station);
      }
      const slots: (TournamentBoardStation | null)[] = [...stations.entries()].map(([key, station]) => ({
        key,
        ownerPlayerId: station.ownerPlayerId,
        ownerDisplayName: station.ownerDisplayName,
        switchType: station.switchType,
        ...(utp.has(key) ? { utpCableNumber: utp.get(key)! } : {}),
        seats: station.seats,
      }));
      while (slots.length < TOURNAMENT_BOARD_GROUP_SLOTS) { slots.push(null); }
      return {
        groupId: group.groupId,
        name: group.name,
        index,
        slots,
        memberIds: group.members.map((member) => member.playerId),
        unseated,
      };
    });
  const seatedIds = new Set(groups.flatMap((group) => group.memberIds));
  const parkedPlayers = document_.participants
    .filter((participant) => participant.attendance === "present" && !seatedIds.has(participant.playerId))
    .map((participant) => ({ playerId: participant.playerId, displayName: participant.displayName }));
  const usedStations = new Set(groups.flatMap((group) =>
    group.slots.flatMap((slot) => (slot === null ? [] : [slot.key]))));
  const parkedStations = document_.stations
    .map((station) => ({
      key: tournamentStationKey(station.ownerPlayerId, station.switchType),
      ownerPlayerId: station.ownerPlayerId,
      ownerDisplayName: station.ownerDisplayName,
      switchType: station.switchType,
    }))
    .filter((station) => !usedStations.has(station.key));
  return { stage, groups, parkedPlayers, parkedStations };
}

// ---------------------------------------------------------------------------
// Mutations. Every accepted drag yields the complete desired stage layout.
// `membershipChange` is set when a Player enters or leaves the stage, in
// which case the caller sends update-groups first and the layout second.
export type TournamentLayoutSeat = Readonly<{
  playerId: string;
  stationOwnerPlayerId: string | null;
  switchType: "ns1" | "ns2" | null;
  seatNumber: 1 | 2 | null;
}>;

export type TournamentLayoutStation = Readonly<{
  stationOwnerPlayerId: string;
  switchType: "ns1" | "ns2";
}>;

export type TournamentBoardMutation =
  | Readonly<{
    kind: "apply";
    membershipChange: boolean;
    members: readonly Readonly<{ groupId: string; members: readonly string[] }>[];
    layout: readonly Readonly<{
      name: string;
      seats: readonly TournamentLayoutSeat[];
      /** The consoles in slot order, including one with nobody seated yet. */
      stations: readonly TournamentLayoutStation[];
    }>[];
  }>
  | Readonly<{ kind: "denied"; message: string }>;

type MutableStation = {
  key: string; ownerPlayerId: string; ownerDisplayName: string; switchType: "ns1" | "ns2";
  seats: [TournamentBoardSeat, TournamentBoardSeat];
};
type MutableGroup = {
  groupId: string; name: string;
  slots: (MutableStation | null)[];
  unseated: { playerId: string; displayName: string }[];
};

function mutable(model: TournamentBoardModel): MutableGroup[] {
  return model.groups.map((group) => ({
    groupId: group.groupId,
    name: group.name,
    slots: group.slots.map((slot) => slot === null ? null : {
      key: slot.key,
      ownerPlayerId: slot.ownerPlayerId,
      ownerDisplayName: slot.ownerDisplayName,
      switchType: slot.switchType,
      seats: [slot.seats[0], slot.seats[1]] as [TournamentBoardSeat, TournamentBoardSeat],
    }),
    unseated: group.unseated.map((entry) => ({ ...entry })),
  }));
}

function memberCount(group: MutableGroup): number {
  return group.unseated.length + group.slots.reduce((sum, slot) =>
    sum + (slot === null ? 0 : slot.seats.filter((seat) => seat !== null).length), 0);
}

function findSeat(groups: MutableGroup[], playerId: string): Readonly<{
  group: MutableGroup; slot: MutableStation; seatIndex: 0 | 1;
}> | null {
  for (const group of groups) {
    for (const slot of group.slots) {
      if (slot === null) { continue; }
      const seatIndex = slot.seats.findIndex((seat) => seat?.playerId === playerId);
      if (seatIndex >= 0) { return { group, slot, seatIndex: seatIndex as 0 | 1 }; }
    }
  }
  return null;
}

function stripMember(groups: MutableGroup[], playerId: string): void {
  for (const group of groups) {
    group.unseated = group.unseated.filter((entry) => entry.playerId !== playerId);
    for (const slot of group.slots) {
      if (slot === null) { continue; }
      for (const index of [0, 1] as const) {
        if (slot.seats[index]?.playerId === playerId) { slot.seats[index] = null; }
      }
    }
  }
}

function applied(groups: MutableGroup[], membershipChange: boolean): TournamentBoardMutation {
  return {
    kind: "apply",
    membershipChange,
    members: groups.map((group) => ({
      groupId: group.groupId,
      members: [
        ...group.slots.flatMap((slot) => slot === null
          ? []
          : slot.seats.flatMap((seat) => (seat === null ? [] : [seat.playerId]))),
        ...group.unseated.map((entry) => entry.playerId),
      ],
    })),
    layout: groups.map((group) => ({
      name: group.name,
      stations: group.slots.flatMap((slot) => slot === null
        ? []
        : [{ stationOwnerPlayerId: slot.ownerPlayerId, switchType: slot.switchType }]),
      seats: [
        ...group.slots.flatMap((slot) => slot === null
          ? []
          : slot.seats.flatMap((seat, index) => (seat === null ? [] : [{
            playerId: seat.playerId,
            stationOwnerPlayerId: slot.ownerPlayerId,
            switchType: slot.switchType,
            seatNumber: (index + 1) as 1 | 2,
          }]))),
        ...group.unseated.map((entry) => ({
          playerId: entry.playerId,
          stationOwnerPlayerId: null,
          switchType: null,
          seatNumber: null,
        })),
      ],
    })),
  };
}

function fullMessage(group: MutableGroup): string {
  const unseatedCount = group.unseated.length;
  return unseatedCount > 0
    ? `${group.name} zit vol: maximaal 12 deelnemers (waarvan ${unseatedCount} nog niet geplaatst).`
    : `${group.name} zit vol: maximaal 12 deelnemers.`;
}

/** A player dropped on one specific seat. Occupied seat: a seated dragger
 * swaps with the occupant (the occupant takes the vacated seat); a dragger
 * from parking evicts the occupant to Deelnemersparking. */
export function tournamentSeatPlayerMutation(
  model: TournamentBoardModel,
  playerId: string,
  displayName: string,
  targetGroupId: string,
  stationKey: string,
  seatNumber: 1 | 2,
): TournamentBoardMutation {
  const groups = mutable(model);
  const target = groups.find((group) => group.groupId === targetGroupId);
  const slot = target?.slots.find((candidate) => candidate?.key === stationKey) ?? null;
  if (target === undefined || slot === null) {
    return { kind: "denied", message: "Deze zitplaats bestaat niet meer. Vernieuw het bord." };
  }
  const seatIndex = (seatNumber - 1) as 0 | 1;
  const occupant = slot.seats[seatIndex];
  if (occupant?.playerId === playerId) { return applied(groups, false); }
  const origin = findSeat(groups, playerId);
  const wasMember = groups.some((group) =>
    group.unseated.some((entry) => entry.playerId === playerId) ||
    group.slots.some((candidate) => candidate?.seats.some((seat) => seat?.playerId === playerId)));
  const alreadyInTarget = target.unseated.some((entry) => entry.playerId === playerId) ||
    target.slots.some((candidate) => candidate?.seats.some((seat) => seat?.playerId === playerId));
  if (!alreadyInTarget && memberCount(target) >= TOURNAMENT_BOARD_GROUP_PLAYERS && occupant === null) {
    return { kind: "denied", message: fullMessage(target) };
  }
  let membershipChange = !wasMember;
  stripMember(groups, playerId);
  if (occupant !== null) {
    if (origin !== null &&
      !(origin.group.groupId === targetGroupId && origin.slot.key === stationKey && origin.seatIndex === seatIndex)) {
      // True swap: the bumped player takes the dragged player's old seat.
      stripMember(groups, occupant.playerId);
      origin.slot.seats[origin.seatIndex] = occupant;
    } else if (origin === null) {
      // Dragged in from parking: the occupant is evicted to parking.
      stripMember(groups, occupant.playerId);
      membershipChange = true;
    }
  }
  slot.seats[seatIndex] = { playerId, displayName };
  return applied(groups, membershipChange);
}

/** A player dropped on the group itself: the first free seat, walking the
 * slots in order (seat 1 before seat 2), exactly like the source. */
export function tournamentSeatPlayerInGroupMutation(
  model: TournamentBoardModel,
  playerId: string,
  displayName: string,
  targetGroupId: string,
): TournamentBoardMutation {
  const target = model.groups.find((group) => group.groupId === targetGroupId);
  if (target === undefined) {
    return { kind: "denied", message: "Deze groep bestaat niet meer. Vernieuw het bord." };
  }
  for (const seatNumber of [1, 2] as const) {
    for (const slot of target.slots) {
      if (slot !== null && slot.seats[seatNumber - 1] === null) {
        return tournamentSeatPlayerMutation(model, playerId, displayName, targetGroupId, slot.key, seatNumber);
      }
    }
  }
  // No free seat: bring a parked Switch along (the player's own first), the
  // way a race night solves it physically. The canonical layout can only
  // hold a Switch through a seated Player, so the Switch arrives occupied.
  const parkedStation = model.parkedStations.find((station) => station.ownerPlayerId === playerId)
    ?? model.parkedStations[0];
  if (parkedStation !== undefined && target.slots.some((slot) => slot === null) &&
    memberCount(mutable(model).find((group) => group.groupId === targetGroupId)!) < TOURNAMENT_BOARD_GROUP_PLAYERS) {
    const groups = mutable(model);
    const grown = groups.find((group) => group.groupId === targetGroupId)!;
    const slotIndex = grown.slots.findIndex((slot) => slot === null);
    const wasMember = groups.some((group) =>
      group.unseated.some((entry) => entry.playerId === playerId) ||
      group.slots.some((candidate) => candidate?.seats.some((seat) => seat?.playerId === playerId)));
    stripMember(groups, playerId);
    grown.slots[slotIndex] = {
      key: parkedStation.key,
      ownerPlayerId: parkedStation.ownerPlayerId,
      ownerDisplayName: parkedStation.ownerDisplayName,
      switchType: parkedStation.switchType,
      seats: [{ playerId, displayName }, null],
    };
    return applied(groups, !wasMember);
  }
  return {
    kind: "denied",
    message: `Geen vrije zitplaats in ${target.name}. Voeg een Nintendo Switch toe of verplaats eerst een deelnemer.`,
  };
}

/** A player dropped on Deelnemersparking. */
export function tournamentParkPlayerMutation(
  model: TournamentBoardModel,
  playerId: string,
): TournamentBoardMutation {
  const groups = mutable(model);
  stripMember(groups, playerId);
  return applied(groups, true);
}

/** A Switch dropped on a slot or group. In the qualifier stage the seated
 * players travel with their Switch; a bumped Switch swaps to the vacated
 * slot. In the final stage a cross-group Switch move detaches every seated
 * player involved to Deelnemersparking, as the source demands. */
export function tournamentMoveStationMutation(
  model: TournamentBoardModel,
  stationKey: string,
  targetGroupId: string,
  slotIndex: number | null,
): TournamentBoardMutation {
  const groups = mutable(model);
  const target = groups.find((group) => group.groupId === targetGroupId);
  if (target === undefined) {
    return { kind: "denied", message: "Deze groep bestaat niet meer. Vernieuw het bord." };
  }
  const sourceGroup = groups.find((group) => group.slots.some((slot) => slot?.key === stationKey)) ?? null;
  const parkedStation = model.parkedStations.find((station) => station.key === stationKey);
  const moving: MutableStation | null = sourceGroup === null
    ? (parkedStation === undefined ? null : {
      key: parkedStation.key,
      ownerPlayerId: parkedStation.ownerPlayerId,
      ownerDisplayName: parkedStation.ownerDisplayName,
      switchType: parkedStation.switchType,
      seats: [null, null],
    })
    : sourceGroup.slots.find((slot) => slot?.key === stationKey) as MutableStation;
  if (moving === null) {
    return { kind: "denied", message: "Deze Nintendo Switch staat niet meer op het bord. Vernieuw het bord." };
  }
  const resolvedSlotIndex = slotIndex ?? target.slots.findIndex((slot) => slot === null);
  if (resolvedSlotIndex < 0 || resolvedSlotIndex >= TOURNAMENT_BOARD_GROUP_SLOTS) {
    return { kind: "denied", message: `Geen vrije Nintendo Switch-plek in ${target.name}.` };
  }
  const bumped = target.slots[resolvedSlotIndex] ?? null;
  const crossGroup = sourceGroup !== null && sourceGroup.groupId !== target.groupId;
  const switchesInTarget = target.slots.filter((slot) => slot !== null && slot.key !== stationKey).length;
  if ((sourceGroup === null || crossGroup) && bumped === null &&
    switchesInTarget >= TOURNAMENT_BOARD_GROUP_SLOTS) {
    return { kind: "denied", message: `${target.name} heeft het maximum van 6 Nintendo Switches bereikt.` };
  }
  const movingSeatCount = moving.seats.filter((seat) => seat !== null).length;
  const bumpedSeatCount = bumped === null ? 0 : bumped.seats.filter((seat) => seat !== null).length;
  if (crossGroup && model.stage === "qualifier" &&
    memberCount(target) - bumpedSeatCount + movingSeatCount > TOURNAMENT_BOARD_GROUP_PLAYERS) {
    return { kind: "denied", message: `Verplaatsen van deze Nintendo Switch zou ${target.name} boven 12 deelnemers brengen.` };
  }
  let membershipChange = false;
  const finalDetach = model.stage === "final" && (crossGroup || sourceGroup === null);
  const detach = (station: MutableStation): void => {
    for (const index of [0, 1] as const) {
      if (station.seats[index] !== null) { station.seats[index] = null; membershipChange = true; }
    }
  };
  if (sourceGroup !== null) {
    const sourceIndex = sourceGroup.slots.findIndex((slot) => slot?.key === stationKey);
    sourceGroup.slots[sourceIndex] = null;
    if (bumped !== null) {
      // The bumped Switch swaps to the vacated slot, players on board.
      sourceGroup.slots[sourceIndex] = bumped;
      if (finalDetach) { detach(bumped); }
    }
  } else if (bumped !== null) {
    // From parking into an occupied slot: the bumped Switch parks and its
    // players stay in the group without a seat.
    for (const index of [0, 1] as const) {
      const seat = bumped.seats[index];
      if (seat !== null) {
        target.unseated.push({ playerId: seat.playerId, displayName: seat.displayName });
        bumped.seats[index] = null;
      }
    }
  }
  if (finalDetach) { detach(moving); }
  target.slots[resolvedSlotIndex] = moving;
  return applied(groups, membershipChange);
}

/** A Switch dropped on Nintendo Switch-parking: the slot empties and both
 * occupants become parked players. */
export function tournamentParkStationMutation(
  model: TournamentBoardModel,
  stationKey: string,
): TournamentBoardMutation {
  const groups = mutable(model);
  const sourceGroup = groups.find((group) => group.slots.some((slot) => slot?.key === stationKey));
  if (sourceGroup === undefined) {
    return { kind: "denied", message: "Deze Nintendo Switch staat niet meer op het bord. Vernieuw het bord." };
  }
  const index = sourceGroup.slots.findIndex((slot) => slot?.key === stationKey);
  const station = sourceGroup.slots[index]!;
  sourceGroup.slots[index] = null;
  const membershipChange = station.seats.some((seat) => seat !== null);
  return applied(groups, membershipChange);
}
