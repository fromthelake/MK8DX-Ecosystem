// Where a player is strong and where they should practise, per track.
//
// A raw average finish cannot answer that. Finishing sixth means one thing in
// a group of twelve and another in a group of ten, and it means something else
// again depending on which division you were racing in that night. Ranking
// tracks by raw average would mostly rank the seasons a player happened to be
// in a weaker group.
//
// So each track is scored against the player's own normal: the difference
// between how they finish there and how they finish everywhere else, both
// expressed as a share of the field. A player who is mid-table overall but
// wins on Baby Park shows up as strong on Baby Park, whether they spent that
// season in Kampioen or in Wild.
//
// Only races that carry a track can say anything. TN4-TN6 were never recorded
// and never will be, so a sizeable part of every long career is simply absent;
// the service reports how much rather than quietly averaging over what is left.

export type TournamentTrackRow = Readonly<{
  trackId: string | null;
  modeCc: number | null;
  finishPosition: number;
  fieldSize: number;
  racePoints: number | null;
  heldAtMs: number;
}>;

export type TournamentTrackRecordRepository = Readonly<{
  listPlayerTrackRows(
    playerId: string,
  ): Promise<readonly TournamentTrackRow[]>;
}>;

export type TrackRecordEntry = Readonly<{
  trackId: string;
  races: number;
  wins: number;
  podiums: number;
  bestFinish: number;
  worstFinish: number;
  averageFinish: number;
  averagePoints: number | null;
  /**
   * Where the player lands in the field on this track, from 0 (always first)
   * to 1 (always last). Field-size independent, so a group of ten and a group
   * of twelve can be compared.
   */
  averageFieldShare: number;
  /**
   * How much better or worse than their own normal, in field shares.
   * Negative is better. This is what the ranking uses.
   */
  relativeToOwnAverage: number;
  lastRacedAtMs: number;
}>;

export type TournamentTrackRecord = Readonly<{
  playerId: string;
  racesWithTrack: number;
  racesWithoutTrack: number;
  overallFieldShare: number | null;
  tracks: readonly TrackRecordEntry[];
}>;

export class TournamentTrackRecordError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "TournamentTrackRecordError";
  }
}

/**
 * Position 1 of 12 is share 0; position 12 of 12 is share 1. A field of one
 * cannot place anybody, so it contributes nothing.
 */
export function fieldShare(
  finishPosition: number, fieldSize: number,
): number | null {
  if (fieldSize < 2) { return null; }
  return (finishPosition - 1) / (fieldSize - 1);
}

export function summarizeTrackRecord(
  playerId: string,
  rows: readonly TournamentTrackRow[],
): TournamentTrackRecord {
  const withTrack = rows.filter((row) => row.trackId !== null);
  const shares: number[] = [];
  for (const row of rows) {
    const share = fieldShare(row.finishPosition, row.fieldSize);
    if (share !== null) { shares.push(share); }
  }
  // The player's own normal is taken over every rated race, including the ones
  // with no track. Those races still say how they usually finish, and leaving
  // them out would make the baseline move with the recordings we happen to
  // have rather than with the player.
  const overallFieldShare = shares.length === 0
    ? null
    : shares.reduce((total, value) => total + value, 0) / shares.length;

  const grouped = new Map<string, TournamentTrackRow[]>();
  for (const row of withTrack) {
    const bucket = grouped.get(row.trackId!);
    if (bucket) { bucket.push(row); } else { grouped.set(row.trackId!, [row]); }
  }

  const tracks: TrackRecordEntry[] = [];
  for (const [trackId, group] of grouped) {
    const positions = group.map((row) => row.finishPosition);
    const trackShares = group
      .map((row) => fieldShare(row.finishPosition, row.fieldSize))
      .filter((share): share is number => share !== null);
    const pointRows = group.filter((row) => row.racePoints !== null);
    const averageFieldShare = trackShares.length === 0
      ? 0
      : trackShares.reduce((total, value) => total + value, 0)
        / trackShares.length;
    tracks.push({
      trackId,
      races: group.length,
      wins: positions.filter((position) => position === 1).length,
      podiums: positions.filter((position) => position <= 3).length,
      bestFinish: Math.min(...positions),
      worstFinish: Math.max(...positions),
      averageFinish:
        positions.reduce((total, value) => total + value, 0) / positions.length,
      averagePoints: pointRows.length === 0
        ? null
        : pointRows.reduce((total, row) => total + (row.racePoints ?? 0), 0)
          / pointRows.length,
      averageFieldShare,
      relativeToOwnAverage: overallFieldShare === null
        ? 0 : averageFieldShare - overallFieldShare,
      lastRacedAtMs: Math.max(...group.map((row) => row.heldAtMs)),
    });
  }

  // Strongest first. A tie on the relative measure is broken by the track the
  // player has raced most, because that is the one they know best.
  tracks.sort((left, right) =>
    left.relativeToOwnAverage - right.relativeToOwnAverage ||
    right.races - left.races ||
    left.trackId.localeCompare(right.trackId));

  return {
    playerId,
    racesWithTrack: withTrack.length,
    racesWithoutTrack: rows.length - withTrack.length,
    overallFieldShare,
    tracks,
  };
}

export class TournamentTrackRecordService {
  readonly #repository: TournamentTrackRecordRepository;

  public constructor(repository: TournamentTrackRecordRepository) {
    this.#repository = repository;
  }

  public async recordFor(playerId: string): Promise<TournamentTrackRecord> {
    if (!/^player\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/u.test(playerId)) {
      throw new TournamentTrackRecordError("player id is not well formed");
    }
    const rows = await this.#repository.listPlayerTrackRows(playerId);
    return summarizeTrackRecord(playerId, rows);
  }
}
