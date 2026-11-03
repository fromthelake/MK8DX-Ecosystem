import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import mysql from "mysql2/promise";
import type { Connection, RowDataPacket } from "mysql2/promise";

import { loadHostedMysqlRuntimeConfig, type HostedRuntimeEnvironment } from "./hosted-runtime-config.js";
import { extractPrivateEnvironmentArgument, loadHostedOperatorEnvironment } from "./hosted-operator-environment.js";

export class ReferenceSeedError extends Error {
  public constructor(message: string) { super(message); this.name = "ReferenceSeedError"; }
}

type SeedKind = "nintendo_staff" | "world_records";
type StaffRow = Readonly<{ trackId: string; mode: 150 | 200; playerName: string; timeMs: number; countryId: string }>;
type WorldRow = Readonly<{
  trackId: string; mode: 150 | 200; totalTimeMs: number; playerName: string; nationName?: string;
  recordDate: string; durationDays: number; characterName: string; bodyName: string;
  tireName: string; gliderName: string; lapTimesMs: readonly number[];
  coinsPerLap: readonly number[]; mushroomsPerLap: readonly number[];
  holders: readonly Record<string, unknown>[]; sourceUrl: string;
}>;
type Seed<T> = Readonly<{ kind: SeedKind; schemaVersion: string; digest: string; rows: readonly T[] }>;

const holderFields = new Set(["playerName", "nationName", "recordDate", "durationDays", "characterName", "bodyName", "tireName", "gliderName", "lapTimesMs", "coinsPerLap", "mushroomsPerLap"]);
const worldFields = new Set(["trackId", "mode", "totalTimeMs", "playerName", "nationName", "recordDate", "durationDays", "characterName", "bodyName", "tireName", "gliderName", "lapTimesMs", "coinsPerLap", "mushroomsPerLap", "holders", "sourceUrl"]);
const staffFields = new Set(["trackId", "mode", "playerName", "timeMs", "countryId"]);
const sha = (value: string | Uint8Array): string => createHash("sha256").update(value).digest("hex");
const object = (value: unknown): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new ReferenceSeedError("reference seed object is invalid");
  return value as Record<string, unknown>;
};
const exactFields = (row: Record<string, unknown>, allowed: Set<string>): void => {
  if (Object.keys(row).some((name) => !allowed.has(name))) throw new ReferenceSeedError("reference row contains an unreviewed field");
};
const positive = (value: unknown): value is number => Number.isSafeInteger(value) && typeof value === "number" && value > 0;
const nonnegative = (value: unknown): value is number => Number.isSafeInteger(value) && typeof value === "number" && value >= 0;
const vector = (value: unknown, length?: number): value is number[] =>
  Array.isArray(value) && (length === undefined ? [3, 7].includes(value.length) : value.length === length) && value.every(nonnegative);

// Coins and mushrooms are per lap, or empty when the source groups them differently.
const itemVector = (value: unknown, length: number): value is number[] =>
  (Array.isArray(value) && value.length === 0) || vector(value, length);

function validateRows<T extends StaffRow | WorldRow>(rows: unknown, kind: SeedKind): readonly T[] {
  if (!Array.isArray(rows) || rows.length !== 192) throw new ReferenceSeedError("reference snapshot must contain 192 rows");
  const keys = new Set<string>();
  const counts = new Map<number, number>();
  for (const value of rows) {
    const row = object(value);
    exactFields(row, kind === "nintendo_staff" ? staffFields : worldFields);
    if ((row["mode"] !== 150 && row["mode"] !== 200) ||
        typeof row["trackId"] !== "string" || !/^track\.[a-z0-9_]+$/.test(row["trackId"])) {
      throw new ReferenceSeedError("reference key is invalid");
    }
    const key = `${row["mode"]}|${row["trackId"]}`;
    if (keys.has(key)) throw new ReferenceSeedError("duplicate reference key");
    keys.add(key);
    counts.set(row["mode"], (counts.get(row["mode"]) ?? 0) + 1);
    if (typeof row["playerName"] !== "string" || row["playerName"].length < 1 || row["playerName"].length > 384) {
      throw new ReferenceSeedError("reference attribution is invalid");
    }
    if (kind === "nintendo_staff") {
      if (!positive(row["timeMs"]) || typeof row["countryId"] !== "string" || !/^country\.[a-z]{2}$/.test(row["countryId"])) {
        throw new ReferenceSeedError("Staff reference is invalid");
      }
    } else {
      if (!positive(row["totalTimeMs"]) || !vector(row["lapTimesMs"]) ||
          !itemVector(row["coinsPerLap"], row["lapTimesMs"].length) || !itemVector(row["mushroomsPerLap"], row["lapTimesMs"].length) ||
          Math.abs(row["lapTimesMs"].reduce((sum: number, n: number) => sum + n, 0) - row["totalTimeMs"]) > 10 ||
          typeof row["recordDate"] !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(row["recordDate"]) ||
          !nonnegative(row["durationDays"]) ||
          !["characterName", "bodyName", "tireName", "gliderName"].every((name) => typeof row[name] === "string" && (row[name] as string).length > 0) ||
          !["https://mkwrs.com/mk8dx/wrs.php", "https://mkwrs.com/mk8dx/wrs_200.php"].includes(String(row["sourceUrl"]))) {
        throw new ReferenceSeedError("World Record reference is invalid");
      }
      if (!Array.isArray(row["holders"]) || row["holders"].length < 1 || row["holders"].length > 3) {
        throw new ReferenceSeedError("World Record holders are invalid");
      }
      for (const holderValue of row["holders"]) {
        const holder = object(holderValue);
        exactFields(holder, holderFields);
        if (typeof holder["playerName"] !== "string" || holder["playerName"].length < 1 ||
            typeof holder["recordDate"] !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(holder["recordDate"]) ||
            !nonnegative(holder["durationDays"]) ||
            !["characterName", "bodyName", "tireName", "gliderName"].every((name) => typeof holder[name] === "string" && (holder[name] as string).length > 0) ||
            !vector(holder["lapTimesMs"]) ||
            !itemVector(holder["coinsPerLap"], holder["lapTimesMs"].length) ||
            !itemVector(holder["mushroomsPerLap"], holder["lapTimesMs"].length)) {
          throw new ReferenceSeedError("World Record holder is invalid");
        }
      }
    }
  }
  if (counts.get(150) !== 96 || counts.get(200) !== 96) throw new ReferenceSeedError("reference modes are incomplete");
  return rows as readonly T[];
}

export async function readReferenceSeed<T extends StaffRow | WorldRow>(path: string, kind: SeedKind): Promise<Seed<T>> {
  const bytes = await readFile(resolve(path));
  const document = object(JSON.parse(bytes.toString("utf8")) as unknown);
  exactFields(document, new Set(kind === "nintendo_staff"
    ? ["schemaVersion", "provenance", "records"]
    : ["schemaVersion", "asOfUtc", "provenance", "records"]));
  if (document["schemaVersion"] !== `mk8dx.reference.${kind === "nintendo_staff" ? "staff" : "world-records"}.v1`) {
    throw new ReferenceSeedError("reference schema version is invalid");
  }
  if (document["provenance"] !== (kind === "nintendo_staff"
    ? "Historical Nintendo Staff snapshot; partial physical spot check only"
    : "Offline reviewed MKWRS snapshot; not live") ||
      (kind === "world_records" &&
       (typeof document["asOfUtc"] !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(document["asOfUtc"])))) {
    throw new ReferenceSeedError("reference provenance is invalid");
  }
  const rows = validateRows<T>(document["records"], kind);
  return { kind, schemaVersion: document["schemaVersion"] as string, digest: sha(bytes), rows };
}

interface VersionRow extends RowDataPacket { seedKind: string; seedSha256: string }
interface HashRow extends RowDataPacket { recordKey: string; rowSha256: string }
interface DataRow extends RowDataPacket {
  mode: unknown; trackId: unknown; totalTimeMs: unknown; playerName: unknown; nationName: unknown;
  recordDate: unknown; durationDays: unknown; characterName: unknown; bodyName: unknown;
  tireName: unknown; gliderName: unknown; videoUrl: unknown; lapTimesJson: unknown;
  coinsJson: unknown; mushroomsJson: unknown; holdersJson: unknown; sourceUrl: unknown;
}
const rowKey = (row: StaffRow | WorldRow): string => `${row.mode}|${row.trackId}`;
const parseJson = (value: unknown): unknown => typeof value === "string" ? JSON.parse(value) as unknown : value;
const databaseHash = (row: DataRow): string => sha(JSON.stringify([
  Number(row.mode), String(row.trackId), Number(row.totalTimeMs), String(row.playerName),
  row.nationName === null ? null : String(row.nationName), String(row.recordDate), Number(row.durationDays),
  String(row.characterName), String(row.bodyName), String(row.tireName), String(row.gliderName),
  row.videoUrl === null ? null : String(row.videoUrl), parseJson(row.lapTimesJson),
  parseJson(row.coinsJson), parseJson(row.mushroomsJson), parseJson(row.holdersJson), String(row.sourceUrl),
]));

async function storedWorldRows(connection: Connection): Promise<Map<string, string>> {
  const [rows] = await connection.query<DataRow[]>(
    `SELECT mode_cc AS mode,track_id AS trackId,total_time_ms AS totalTimeMs,player_name AS playerName,
       nation_name AS nationName,DATE_FORMAT(record_date,'%Y-%m-%d') AS recordDate,duration_days AS durationDays,
       character_name AS characterName,body_name AS bodyName,tire_name AS tireName,glider_name AS gliderName,
       video_url AS videoUrl,CAST(lap_times_json AS CHAR) AS lapTimesJson,
       CAST(coins_per_lap_json AS CHAR) AS coinsJson,CAST(mushrooms_per_lap_json AS CHAR) AS mushroomsJson,
       CAST(holders_json AS CHAR) AS holdersJson,source_url AS sourceUrl
     FROM world_records ORDER BY mode_cc,track_id FOR UPDATE`,
  );
  return new Map(rows.map((row) => [`${Number(row.mode)}|${String(row.trackId)}`, databaseHash(row)]));
}

async function applyWorldRows(connection: Connection, rows: readonly WorldRow[], nowMs: number): Promise<void> {
  for (const row of rows) {
    await connection.execute(
      `INSERT INTO world_records(mode_cc,track_id,total_time_ms,player_name,nation_name,record_date,duration_days,
         character_name,body_name,tire_name,glider_name,video_url,lap_times_json,coins_per_lap_json,
         mushrooms_per_lap_json,holders_json,source_url,imported_at_ms)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,NULL,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE total_time_ms=VALUES(total_time_ms),player_name=VALUES(player_name),
         nation_name=VALUES(nation_name),record_date=VALUES(record_date),duration_days=VALUES(duration_days),
         character_name=VALUES(character_name),body_name=VALUES(body_name),tire_name=VALUES(tire_name),
         glider_name=VALUES(glider_name),video_url=NULL,lap_times_json=VALUES(lap_times_json),
         coins_per_lap_json=VALUES(coins_per_lap_json),mushrooms_per_lap_json=VALUES(mushrooms_per_lap_json),
         holders_json=VALUES(holders_json),source_url=VALUES(source_url),imported_at_ms=VALUES(imported_at_ms)`,
      [row.mode, row.trackId, row.totalTimeMs, row.playerName, row.nationName ?? null, row.recordDate,
        row.durationDays, row.characterName, row.bodyName, row.tireName, row.gliderName,
        JSON.stringify(row.lapTimesMs), JSON.stringify(row.coinsPerLap), JSON.stringify(row.mushroomsPerLap),
        JSON.stringify(row.holders), row.sourceUrl, nowMs],
    );
  }
  await connection.execute(
    `INSERT INTO world_record_import_runs(imported_at_ms,records_150,records_200,changed_records) VALUES(?,96,96,0)`,
    [nowMs],
  );
}

async function applyOne<T extends StaffRow | WorldRow>(connection: Connection, seed: Seed<T>, nowMs: number): Promise<"applied" | "unchanged"> {
  const [versions] = await connection.execute<VersionRow[]>(
    `SELECT seed_kind AS seedKind,seed_sha256 AS seedSha256 FROM reference_seed_versions WHERE seed_kind=? FOR UPDATE`,
    [seed.kind],
  );
  const current = versions[0];
  if (current?.seedSha256 === seed.digest) return "unchanged";
  const [stored] = await connection.execute<HashRow[]>(
    `SELECT record_key AS recordKey,row_sha256 AS rowSha256 FROM reference_seed_rows WHERE seed_kind=? FOR UPDATE`,
    [seed.kind],
  );
  const previousHashes = new Map(stored.map((row) => [row.recordKey, row.rowSha256]));
  if (current !== undefined && previousHashes.size !== 192) throw new ReferenceSeedError("reference baseline is incomplete");
  let nextHashes: Map<string, string>;
  if (seed.kind === "world_records") {
    const actual = await storedWorldRows(connection);
    if (current === undefined && actual.size !== 0) throw new ReferenceSeedError("existing World Records have no seed baseline");
    if (current !== undefined && (actual.size !== previousHashes.size ||
        [...previousHashes].some(([key, digest]) => actual.get(key) !== digest))) {
      throw new ReferenceSeedError("installed World Record was edited; review conflict before update");
    }
    await applyWorldRows(connection, seed.rows as readonly WorldRow[], nowMs);
    nextHashes = await storedWorldRows(connection);
  } else {
    nextHashes = new Map(seed.rows.map((row) => [rowKey(row), sha(JSON.stringify(row))]));
  }
  if (nextHashes.size !== 192) throw new ReferenceSeedError("reference write was incomplete");
  if (current === undefined) {
    await connection.execute(`INSERT INTO reference_seed_versions(seed_kind,seed_version,seed_sha256,applied_at_ms) VALUES(?,?,?,?)`,
      [seed.kind, seed.schemaVersion, seed.digest, nowMs]);
  } else {
    await connection.execute(`UPDATE reference_seed_versions SET seed_version=?,seed_sha256=?,applied_at_ms=? WHERE seed_kind=?`,
      [seed.schemaVersion, seed.digest, nowMs, seed.kind]);
    await connection.execute(`DELETE FROM reference_seed_rows WHERE seed_kind=?`, [seed.kind]);
  }
  for (const [key, digest] of nextHashes) {
    await connection.execute(`INSERT INTO reference_seed_rows(seed_kind,record_key,row_sha256) VALUES(?,?,?)`,
      [seed.kind, key, digest]);
  }
  return "applied";
}

export async function runReferenceSeed(
  environment: HostedRuntimeEnvironment,
  staffPath: string,
  worldPath: string,
): Promise<Readonly<{ staff: "applied" | "unchanged"; worldRecords: "applied" | "unchanged" }>> {
  const staff = await readReferenceSeed<StaffRow>(staffPath, "nintendo_staff");
  const world = await readReferenceSeed<WorldRow>(worldPath, "world_records");
  const config = loadHostedMysqlRuntimeConfig(environment);
  const connection = await mysql.createConnection({ ...config, multipleStatements: false });
  const lockName = `mk8dx.ref.${sha(config.database).slice(0, 32)}`;
  try {
    const [lockRows] = await connection.query<RowDataPacket[]>(`SELECT GET_LOCK(?,30) AS acquired`, [lockName]);
    if (Number(lockRows[0]?.["acquired"]) !== 1) throw new ReferenceSeedError("reference seed lock unavailable");
    await connection.beginTransaction();
    try {
      const nowMs = Date.now();
      const staffStatus = await applyOne(connection, staff, nowMs);
      const worldStatus = await applyOne(connection, world, nowMs);
      await connection.commit();
      return { staff: staffStatus, worldRecords: worldStatus };
    } catch (error) {
      await connection.rollback();
      throw error;
    }
  } finally {
    await connection.query(`SELECT RELEASE_LOCK(?)`, [lockName]).catch(() => undefined);
    await connection.end();
  }
}

async function main(): Promise<void> {
  try {
    const extracted = extractPrivateEnvironmentArgument(process.argv.slice(2));
    const args = extracted.commandArguments;
    if (args.length !== 4 || args[0] !== "--staff-seed" || !args[1] || args[2] !== "--world-record-seed" || !args[3]) {
      throw new ReferenceSeedError("expected --staff-seed <path> --world-record-seed <path>");
    }
    const result = await runReferenceSeed(loadHostedOperatorEnvironment(extracted.environmentPath), args[1], args[3]);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    const category = error instanceof ReferenceSeedError ? error.message : "reference seed operation failed";
    process.stderr.write(`${category}\n`);
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(resolve(invokedPath)).href) {
  void main();
}
