// What LiveTrial read from Nintendo staff and World Record ghosts (ADR-0212), as the website
// publishes it. The track board fills what a staff or World Record row is missing from a reading
// of exactly that time; nothing it already knows is replaced.

export type ReferenceGhostReading = Readonly<{
  kind: "nintendo_staff" | "world_record";
  trackId: string;
  mode: 150 | 200;
  totalTimeMs: number;
  lapTimesMs: readonly number[];
  coinsPerLap: readonly number[] | null;
  mushroomsPerLap: readonly number[] | null;
}>;

const READING_KEYS = ["kind", "trackId", "mode", "totalTimeMs", "observedName", "countryId", "loadout", "lapTimesMs",
  "coinsPerLap", "mushroomsPerLap", "events", "source", "confirmations", "conflicts", "updatedAtMs"] as const;

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) { throw new Error("reading is not an object"); }
  return value as Record<string, unknown>;
}

function counts(value: unknown, maximum: number): readonly number[] {
  if (!Array.isArray(value) || value.length > 7 ||
      !value.every((entry) => Number.isSafeInteger(entry) && entry >= 0 && entry <= maximum)) {
    throw new Error("per-lap values are invalid");
  }
  return value as number[];
}

/** Strict, like every web parser: an unexpected key means the API and the web disagree. */
export function parseReferenceGhostReadings(body: unknown): readonly ReferenceGhostReading[] {
  const document = record(body);
  if (Object.keys(document).sort().join(",") !== "readings,schemaVersion" ||
      document["schemaVersion"] !== "mk8dx.reference-ghost-readings.v1" || !Array.isArray(document["readings"])) {
    throw new Error("reference ghost readings document is invalid");
  }
  return document["readings"].map((entry) => {
    const row = record(entry);
    const keys = Object.keys(row);
    if (keys.length !== READING_KEYS.length || !READING_KEYS.every((key) => keys.includes(key))) {
      throw new Error("reference ghost reading keys are invalid");
    }
    const kind = row["kind"];
    const mode = row["mode"];
    const totalTimeMs = row["totalTimeMs"];
    if ((kind !== "nintendo_staff" && kind !== "world_record") || (mode !== 150 && mode !== 200) ||
        typeof row["trackId"] !== "string" || !Number.isSafeInteger(totalTimeMs) || (totalTimeMs as number) <= 0) {
      throw new Error("reference ghost reading is invalid");
    }
    return {
      kind, mode, trackId: row["trackId"], totalTimeMs: totalTimeMs as number,
      lapTimesMs: counts(row["lapTimesMs"], 3_599_999),
      coinsPerLap: row["coinsPerLap"] === null ? null : counts(row["coinsPerLap"], 10),
      mushroomsPerLap: row["mushroomsPerLap"] === null ? null : counts(row["mushroomsPerLap"], 3),
    };
  });
}

export async function fetchReferenceGhostReadings(
  trackId: string,
  mode: 150 | 200,
  signal?: AbortSignal,
): Promise<readonly ReferenceGhostReading[]> {
  const response = await fetch(
    `/v1/public/reference-ghost-readings?trackId=${encodeURIComponent(trackId)}&mode=${mode}`,
    { headers: { accept: "application/json" }, ...(signal === undefined ? {} : { signal }) },
  );
  if (!response.ok) { throw new Error(`reference ghost readings unavailable (${response.status})`); }
  return parseReferenceGhostReadings(await response.json());
}

/** The reading of exactly this reference: same kind and the same total time. */
export function readingFor(
  readings: readonly ReferenceGhostReading[],
  kind: ReferenceGhostReading["kind"],
  totalTimeMs: number | undefined,
): ReferenceGhostReading | undefined {
  return totalTimeMs === undefined
    ? undefined
    : readings.find((reading) => reading.kind === kind && reading.totalTimeMs === totalTimeMs);
}

/** Per-lap values: what the reference already has, else what the ghost reading adds. */
export function filledLaps(known: readonly number[] | undefined, read: readonly number[] | null | undefined): readonly number[] | undefined {
  if (known !== undefined && known.length > 0) { return known; }
  return read === null || read === undefined || read.length === 0 ? known : read;
}
