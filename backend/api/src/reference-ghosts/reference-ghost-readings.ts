// What LiveTrial read from a Nintendo staff ghost or a World Record ghost (ADR-0212).
//
// A reading describes Nintendo's fixed ghost or the public record, never the Player who sent it.
// The website proves it again against its own reference before keeping it: track + class + total
// equal a staff time (with its name and kart setup) or the current World Record (the daily mkwrs
// import). One reading per reference; a later one completes, confirms or conflicts with it.

import type { ActorContext } from "../identity/types.js";
import type { WorldRecordTimes } from "../timetrials/world-record-plausibility.js";
import { NINTENDO_STAFF_REFERENCES, type NintendoStaffReference } from "./nintendo-staff-references.js";

export const REFERENCE_GHOST_READING_SCHEMA = "mk8dx.reference-ghost-reading.v1";
export type ReferenceKind = "nintendo_staff" | "world_record";
export type ReadingSource = "ghost_panel" | "ghost_replay";

export type ReferenceGhostLoadout = Readonly<{ characterId: string; bodyId: string; tireId: string; gliderId: string }>;
export type ReferenceGhostEvents = Readonly<{
  status: "available";
  timeBase: "race_elapsed_ms";
  coinEvents: readonly Readonly<{ raceMs: number; lap: number; from: number; to: number }>[];
  mushroomEvents: readonly Readonly<{ raceMs: number; lap: number }>[];
}>;

export type ReferenceGhostReading = Readonly<{
  kind: ReferenceKind;
  trackId: string;
  mode: 150 | 200;
  totalTimeMs: number;
  observedName: string;
  countryId: string | null;
  loadout: ReferenceGhostLoadout | null;
  lapTimesMs: readonly number[];
  /** Coins gained per lap (mkwrs' count), present with `mushroomsPerLap` from a completed replay. */
  coinsPerLap: readonly number[] | null;
  mushroomsPerLap: readonly number[] | null;
  events: ReferenceGhostEvents | null;
  source: ReadingSource;
}>;

/** A stored reading as the website publishes it. */
export type PublishedReferenceGhostReading = ReferenceGhostReading & Readonly<{
  confirmations: number;
  conflicts: number;
  updatedAtMs: number;
}>;

export type ReadingOutcome = "recorded" | "completed" | "confirmed" | "conflict";

export type ReferenceGhostReadingErrorCode =
  | "invalid_reading" | "not_a_reference" | "not_authenticated" | "invalid_assets";

export class ReferenceGhostReadingError extends Error {
  public constructor(public readonly code: ReferenceGhostReadingErrorCode, message: string) {
    super(message);
    this.name = "ReferenceGhostReadingError";
  }
}

export interface ReferencePartCatalog {
  knowsTrack(trackId: string): boolean;
  /** The kart setup with every colour variant replaced by its base part; null when a part is unknown. */
  baseLoadout(loadout: ReferenceGhostLoadout): ReferenceGhostLoadout | null;
}

export interface ReferenceGhostReadingRepository {
  /** Merges the reading into the stored one under a row lock (`mergeReading`) and writes the result. */
  record(
    reading: ReferenceGhostReading,
    userAccountId: string,
    nowMs: number,
  ): Promise<ReadingOutcome>;
  list(filter: Readonly<{ trackId?: string; mode?: 150 | 200 }>): Promise<readonly PublishedReferenceGhostReading[]>;
}

const TRACK_ID = /^track\.[a-z0-9]+(?:_[a-z0-9]+)*$/;
const COUNTRY_ID = /^country\.[a-z0-9_]{2,40}$/;
// A part or one of its colour variants (character_variant.birdo.009_black).
const PART_ID = {
  characterId: /^character(?:_variant)?\.[a-z0-9_.]{2,80}$/, bodyId: /^body(?:_variant)?\.[a-z0-9_.]{2,80}$/,
  tireId: /^tire\.[a-z0-9_.]{2,80}$/, gliderId: /^glider(?:_variant)?\.[a-z0-9_.]{2,80}$/,
} as const;
const MAX_EVENTS = 400;

function invalid(message: string): never {
  throw new ReferenceGhostReadingError("invalid_reading", message);
}

function object(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) { invalid(`${field} must be an object`); }
  return value as Record<string, unknown>;
}

function exactKeys(row: Record<string, unknown>, required: readonly string[], optional: readonly string[], field: string): void {
  for (const key of required) { if (!(key in row)) { invalid(`${field}.${key} is required`); } }
  for (const key of Object.keys(row)) {
    if (!required.includes(key) && !optional.includes(key)) { invalid(`${field}.${key} is not allowed`); }
  }
}

function integer(value: unknown, minimum: number, maximum: number, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    invalid(`${field} must be an integer from ${minimum} to ${maximum}`);
  }
  return value;
}

function integers(value: unknown, length: number, minimum: number, maximum: number, field: string): number[] {
  if (!Array.isArray(value) || value.length !== length) { invalid(`${field} must have ${length} entries`); }
  return value.map((entry, index) => integer(entry, minimum, maximum, `${field}[${index}]`));
}

function events(value: unknown, laps: number, totalTimeMs: number): ReferenceGhostEvents {
  const row = object(value, "events");
  exactKeys(row, ["status", "timeBase", "coinEvents", "mushroomEvents"], [], "events");
  if (row["status"] !== "available" || row["timeBase"] !== "race_elapsed_ms") {
    invalid("events must be an available race_elapsed_ms timeline");
  }
  const raceMs = (entry: unknown, field: string) => integer(entry, 0, totalTimeMs + 5_000, field);
  const lap = (entry: unknown, field: string) => integer(entry, 1, laps, field);
  const coinEvents = row["coinEvents"];
  const mushroomEvents = row["mushroomEvents"];
  if (!Array.isArray(coinEvents) || coinEvents.length > MAX_EVENTS) { invalid("events.coinEvents is invalid"); }
  if (!Array.isArray(mushroomEvents) || mushroomEvents.length > 3) { invalid("events.mushroomEvents is invalid"); }
  return {
    status: "available",
    timeBase: "race_elapsed_ms",
    coinEvents: coinEvents.map((entry, index) => {
      const item = object(entry, `events.coinEvents[${index}]`);
      exactKeys(item, ["raceMs", "lap", "from", "to"], [], `events.coinEvents[${index}]`);
      return {
        raceMs: raceMs(item["raceMs"], `events.coinEvents[${index}].raceMs`),
        lap: lap(item["lap"], `events.coinEvents[${index}].lap`),
        from: integer(item["from"], 0, 10, `events.coinEvents[${index}].from`),
        to: integer(item["to"], 0, 10, `events.coinEvents[${index}].to`),
      };
    }),
    mushroomEvents: mushroomEvents.map((entry, index) => {
      const item = object(entry, `events.mushroomEvents[${index}]`);
      exactKeys(item, ["raceMs", "lap"], [], `events.mushroomEvents[${index}]`);
      return {
        raceMs: raceMs(item["raceMs"], `events.mushroomEvents[${index}].raceMs`),
        lap: lap(item["lap"], `events.mushroomEvents[${index}].lap`),
      };
    }),
  };
}

/** Reads and bounds a submitted reading; the reference proof comes after. */
export function parseReferenceGhostReading(body: unknown): ReferenceGhostReading {
  const row = object(body, "reading");
  exactKeys(row,
    ["schemaVersion", "kind", "trackId", "mode", "totalTimeMs", "observedName", "lapTimesMs"],
    ["countryId", "loadout", "coinsPerLap", "mushroomsPerLap", "events"], "reading");
  if (row["schemaVersion"] !== REFERENCE_GHOST_READING_SCHEMA) { invalid("schemaVersion is not supported"); }
  const kind = row["kind"];
  if (kind !== "nintendo_staff" && kind !== "world_record") { invalid("kind is invalid"); }
  const trackId = row["trackId"];
  if (typeof trackId !== "string" || !TRACK_ID.test(trackId)) { invalid("trackId is invalid"); }
  const mode = row["mode"];
  if (mode !== 150 && mode !== 200) { invalid("mode must be 150 or 200"); }
  const totalTimeMs = integer(row["totalTimeMs"], 1, 3_599_999, "totalTimeMs");
  const observedName = row["observedName"];
  if (typeof observedName !== "string" || observedName.trim().length === 0 || observedName.length > 64) {
    invalid("observedName is invalid");
  }
  const countryValue = row["countryId"] ?? null;
  if (countryValue !== null && (typeof countryValue !== "string" || !COUNTRY_ID.test(countryValue))) {
    invalid("countryId is invalid");
  }
  let loadout: ReferenceGhostLoadout | null = null;
  if (row["loadout"] !== undefined && row["loadout"] !== null) {
    const parts = object(row["loadout"], "loadout");
    exactKeys(parts, ["characterId", "bodyId", "tireId", "gliderId"], [], "loadout");
    for (const [key, pattern] of Object.entries(PART_ID)) {
      if (typeof parts[key] !== "string" || !pattern.test(parts[key] as string)) { invalid(`loadout.${key} is invalid`); }
    }
    loadout = {
      characterId: parts["characterId"] as string, bodyId: parts["bodyId"] as string,
      tireId: parts["tireId"] as string, gliderId: parts["gliderId"] as string,
    };
  }
  const lapValue = row["lapTimesMs"];
  if (!Array.isArray(lapValue) || lapValue.length < 3 || lapValue.length > 7) { invalid("lapTimesMs must have 3 to 7 laps"); }
  const lapTimesMs = lapValue.map((entry, index) => integer(entry, 1, 3_599_999, `lapTimesMs[${index}]`));
  if (lapTimesMs.reduce((sum, lap) => sum + lap, 0) !== totalTimeMs) { invalid("the laps do not add up to the total"); }
  const hasCoins = row["coinsPerLap"] !== undefined && row["coinsPerLap"] !== null;
  const hasMushrooms = row["mushroomsPerLap"] !== undefined && row["mushroomsPerLap"] !== null;
  if (hasCoins !== hasMushrooms) { invalid("coinsPerLap and mushroomsPerLap come together, from a replay"); }
  const coinsPerLap = hasCoins ? integers(row["coinsPerLap"], lapTimesMs.length, 0, 10, "coinsPerLap") : null;
  const mushroomsPerLap = hasMushrooms ? integers(row["mushroomsPerLap"], lapTimesMs.length, 0, 3, "mushroomsPerLap") : null;
  if (mushroomsPerLap !== null && mushroomsPerLap.reduce((sum, count) => sum + count, 0) > 3) {
    invalid("a race has at most three mushrooms");
  }
  const hasEvents = row["events"] !== undefined && row["events"] !== null;
  if (hasEvents && !hasCoins) { invalid("events come from a replay, with its coins and mushrooms"); }
  return {
    kind, trackId, mode, totalTimeMs,
    observedName: observedName.trim(),
    countryId: countryValue as string | null,
    loadout,
    lapTimesMs,
    coinsPerLap,
    mushroomsPerLap,
    events: hasEvents ? events(row["events"], lapTimesMs.length, totalTimeMs) : null,
    source: hasCoins ? "ghost_replay" : "ghost_panel",
  };
}

const nameKey = (name: string): string => name.toLowerCase().replace(/[^0-9a-z]/g, "");
const sameNumbers = (left: readonly number[] | null, right: readonly number[] | null): boolean =>
  left !== null && right !== null && left.length === right.length && left.every((value, index) => value === right[index]);

/** The stored row, as the merge rule sees it. */
export type StoredReferenceGhostReading = Readonly<{
  lapTimesMs: readonly number[];
  coinsPerLap: readonly number[] | null;
  mushroomsPerLap: readonly number[] | null;
  events: ReferenceGhostEvents | null;
  loadout: ReferenceGhostLoadout | null;
  countryId: string | null;
}>;

/**
 * What a new reading does to the stored one (ADR-0212 rule 3): nothing is ever overwritten.
 * Different laps, or different coins or mushrooms, are a conflict. Otherwise a replay completes a
 * panel reading, and anything else confirms it (filling only what is still missing).
 */
export function mergeReading(
  stored: StoredReferenceGhostReading | null,
  incoming: ReferenceGhostReading,
): Readonly<{ outcome: ReadingOutcome; next: StoredReferenceGhostReading | null }> {
  if (stored === null) {
    return {
      outcome: "recorded",
      next: {
        lapTimesMs: incoming.lapTimesMs, coinsPerLap: incoming.coinsPerLap, mushroomsPerLap: incoming.mushroomsPerLap,
        events: incoming.events, loadout: incoming.loadout, countryId: incoming.countryId,
      },
    };
  }
  if (!sameNumbers(stored.lapTimesMs, incoming.lapTimesMs)) { return { outcome: "conflict", next: null }; }
  const fill = {
    loadout: stored.loadout ?? incoming.loadout,
    countryId: stored.countryId ?? incoming.countryId,
  };
  if (incoming.coinsPerLap === null) {
    return { outcome: "confirmed", next: { ...stored, ...fill } };
  }
  if (stored.coinsPerLap === null) {
    return {
      outcome: "completed",
      next: {
        ...stored, ...fill,
        coinsPerLap: incoming.coinsPerLap, mushroomsPerLap: incoming.mushroomsPerLap, events: incoming.events,
      },
    };
  }
  if (!sameNumbers(stored.coinsPerLap, incoming.coinsPerLap) || !sameNumbers(stored.mushroomsPerLap, incoming.mushroomsPerLap)) {
    return { outcome: "conflict", next: null };
  }
  return { outcome: "confirmed", next: { ...stored, ...fill, events: stored.events ?? incoming.events } };
}

export class ReferenceGhostReadingService {
  private readonly staff: ReadonlyMap<string, NintendoStaffReference>;

  public constructor(
    private readonly repository: ReferenceGhostReadingRepository,
    private readonly worldRecords: WorldRecordTimes,
    private readonly catalog: ReferencePartCatalog,
    private readonly clock: Readonly<{ nowMs(): number }>,
    staff: readonly NintendoStaffReference[] = NINTENDO_STAFF_REFERENCES,
  ) {
    this.staff = new Map(staff.map((entry) => [`${entry.trackId}#${entry.mode}`, entry]));
  }

  public async record(actor: ActorContext, body: unknown): Promise<ReadingOutcome> {
    if (actor.role !== "account" && actor.role !== "administrator") {
      throw new ReferenceGhostReadingError("not_authenticated", "Authentication is required.");
    }
    const reading = parseReferenceGhostReading(body);
    if (!this.catalog.knowsTrack(reading.trackId)) {
      throw new ReferenceGhostReadingError("invalid_assets", "trackId is not a known track");
    }
    const base = reading.loadout === null ? null : this.catalog.baseLoadout(reading.loadout);
    if (reading.loadout !== null && base === null) {
      throw new ReferenceGhostReadingError("invalid_assets", "the kart setup has an unknown part");
    }
    await this.prove(reading, base);
    return this.repository.record(reading, actor.userAccountId, this.clock.nowMs());
  }

  public list(filter: Readonly<{ trackId?: string; mode?: 150 | 200 }>): Promise<readonly PublishedReferenceGhostReading[]> {
    return this.repository.list(filter);
  }

  /** `base`: the reading's kart setup by base part (a colour variant counts as its part). */
  private async prove(reading: ReferenceGhostReading, base: ReferenceGhostLoadout | null): Promise<void> {
    if (reading.kind === "nintendo_staff") {
      const staff = this.staff.get(`${reading.trackId}#${reading.mode}`);
      const setupMatches = base !== null &&
        base.characterId === staff?.loadout.characterId &&
        base.bodyId === staff.loadout.bodyId &&
        base.tireId === staff.loadout.tireId &&
        base.gliderId === staff.loadout.gliderId;
      if (staff === undefined || staff.timeMs !== reading.totalTimeMs ||
          nameKey(staff.name) !== nameKey(reading.observedName) || !setupMatches) {
        throw new ReferenceGhostReadingError("not_a_reference",
          "This is not the Nintendo staff ghost of that track and class.");
      }
      return;
    }
    const current = await this.worldRecords.timeMs(reading.trackId, reading.mode);
    if (current === null || current !== reading.totalTimeMs) {
      throw new ReferenceGhostReadingError("not_a_reference",
        "This is not the current World Record of that track and class.");
    }
  }
}
