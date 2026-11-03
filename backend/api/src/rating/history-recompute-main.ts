// Operational CLI: recompute every rating from the corrected tournament
// history under the measured parameters and the decay rule (ADR-0189).
//
// This rewrites what the whole product says about everybody's level, so it is
// deliberately awkward to run by accident: the database name has to be retyped
// and the parameter set named in full. `--dry-run` does the entire replay and
// reports what would change without writing a row, which is the form to use
// while deciding whether to adopt the measured parameters at all.
//
// A new rating epoch is opened rather than the old one edited. Every earlier
// epoch stays complete and auditable, so the previous timeline can still be
// read back after this has run (ADR-0155).
//
// Decay is not stored. The stored rating is the post-race rating; a reader
// sees it faded to today. Rerunning this from the same races and dates
// therefore reproduces identical rows.

import { pathToFileURL } from "node:url";

import mysql from "mysql2/promise";
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";

import { loadHostedMysqlRuntimeConfig } from
  "../composition/hosted-runtime-config.js";
import { replayHistory, type ReplayRace } from "./history-replay.js";
import {
  LEGACY_RATING_PARAMETERS,
  MEASURED_RATING_PARAMETERS,
  conservativeScore,
  type RatingParameters,
} from "./trueskill-engine.js";
import { DEFAULT_DECAY_PARAMETERS } from "./inactivity-decay.js";

export type RecomputeReport = Readonly<{
  parameters: "legacy" | "measured";
  decay: boolean;
  dryRun: boolean;
  racesRead: number;
  racesRated: number;
  racesSkipped: number;
  decayApplications: number;
  playersRated: number;
  epoch: number;
  biggestScoreMove: number;
}>;

export type RecomputeOptions = Readonly<{
  confirmDatabase: string;
  parameters: "legacy" | "measured";
  // Who is answerable for the new epoch. Required rather than optional: a
  // recalculation moves everybody's published Score, and an audit row nobody
  // signed is worse than no audit row at all.
  operator: string;
  decay: boolean;
  dryRun: boolean;
}>;

export function parseArguments(argv: readonly string[]): RecomputeOptions {
  let confirmDatabase: string | null = null;
  let parameters: "legacy" | "measured" | null = null;
  let operator: string | null = null;
  let decay = true;
  let dryRun = false;
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--dry-run") { dryRun = true; continue; }
    if (flag === "--no-decay") { decay = false; continue; }
    // The unknown-flag check comes first, so a typo says what is wrong with
    // it rather than complaining that it is missing a value.
    if (flag !== "--confirm-database" && flag !== "--parameters" &&
        flag !== "--operator") {
      throw new Error(`unexpected argument ${String(flag)}`);
    }
    const value = argv[index + 1];
    if (value === undefined) {
      throw new Error(`${String(flag)} needs a value`);
    }
    if (flag === "--confirm-database") {
      confirmDatabase = value; index += 1; continue;
    }
    if (flag === "--operator") { operator = value; index += 1; continue; }
    if (flag === "--parameters") {
      if (value !== "legacy" && value !== "measured") {
        throw new Error("--parameters is 'legacy' or 'measured'");
      }
      parameters = value;
      index += 1;
      continue;
    }
    operator = value;
    index += 1;
  }
  if (confirmDatabase === null || parameters === null ||
      (operator === null && !dryRun)) {
    throw new Error(
      "expected --confirm-database <name> --parameters legacy|measured " +
      "--operator <user-account-public-id> [--no-decay] [--dry-run]");
  }
  return { confirmDatabase, parameters, operator: operator ?? "", decay, dryRun };
}

export async function readHistoryForReplay(
  pool: Pool,
): Promise<readonly ReplayRace[]> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT race.race_sequence AS raceSequence,
            section.tournament_number AS tournamentNumber,
            event.held_at_ms AS heldAtMs,
            race.counts_toward_rating AS countsTowardRating,
            placement.player_id AS playerId,
            placement.finish_position AS finishPosition
     FROM tournament_history_races AS race
     JOIN tournament_history_sections AS section
       ON section.tournament_history_section_id
          = race.tournament_history_section_id
     JOIN legacy_tournament_events AS event
       ON event.tournament_number = section.tournament_number
     JOIN tournament_history_placements AS placement
       ON placement.tournament_history_race_id
          = race.tournament_history_race_id
     ORDER BY race.race_sequence, placement.finish_position`,
  );
  const races = new Map<number, {
    raceSequence: number; tournamentNumber: number; heldAtMs: number;
    countsTowardRating: boolean;
    placements: Array<{ playerId: number; finishPosition: number }>;
  }>();
  for (const row of rows) {
    const raceSequence = Number(row["raceSequence"]);
    let race = races.get(raceSequence);
    if (!race) {
      race = {
        raceSequence,
        tournamentNumber: Number(row["tournamentNumber"]),
        heldAtMs: Number(row["heldAtMs"]),
        countsTowardRating: Number(row["countsTowardRating"]) === 1,
        placements: [],
      };
      races.set(raceSequence, race);
    }
    race.placements.push({
      playerId: Number(row["playerId"]),
      finishPosition: Number(row["finishPosition"]),
    });
  }
  return [...races.values()];
}

async function currentEpoch(pool: Pool): Promise<number> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    "SELECT COALESCE(MAX(rating_epoch), 0) AS epoch FROM player_rating_events",
  );
  return Number(rows[0]?.["epoch"] ?? 0);
}

/** One recompute over a pool the caller owns: what the CLI runs, and what
 * the API runs when a finalized night is reopened (ADR-0155 addendum). */
export type RecomputeRun = Readonly<{
  parameters: "legacy" | "measured";
  decay: boolean;
  dryRun: boolean;
  /** The operator's user account public id; required unless dryRun. */
  operator: string;
  /** The recalculation's reason; the CLI's default names the parameters. */
  reasonCode?: string;
  /**
   * ADR-0221: when the installation counts only claimed Players, the Players
   * the history may rate. Everybody else is left out of every race (the rest
   * keep their finishing order) and keeps no rating, not even a seed.
   * Absent or null: everybody counts, as before.
   */
  eligiblePlayerIds?: ReadonlySet<number> | null;
}>;

/** ADR-0221: the history with only the eligible Players in each race. */
export function eligibleHistory(
  races: readonly ReplayRace[],
  eligible: ReadonlySet<number> | null | undefined,
): readonly ReplayRace[] {
  if (eligible === null || eligible === undefined) { return races; }
  return races.map((race) => {
    const placements = race.placements
      .filter((placement) => eligible.has(placement.playerId))
      .slice()
      .sort((left, right) => left.finishPosition - right.finishPosition)
      .map((placement, index) => ({ playerId: placement.playerId, finishPosition: index + 1 }));
    return {
      ...race,
      placements,
      countsTowardRating: race.countsTowardRating && placements.length >= 2,
    };
  });
}

export async function runHistoryRecompute(
  environment: Readonly<Record<string, string | undefined>>,
  argv: readonly string[],
): Promise<RecomputeReport> {
  const options = parseArguments(argv);
  const config = loadHostedMysqlRuntimeConfig(environment);
  if (config.database !== options.confirmDatabase) {
    throw new Error(`--confirm-database ${options.confirmDatabase} does not ` +
      "match the configured database");
  }
  const pool: Pool = mysql.createPool({
    ...config, multipleStatements: false, namedPlaceholders: false,
  });
  try {
    return await recomputeHistory(pool, options);
  } finally {
    await pool.end();
  }
}

export async function recomputeHistory(pool: Pool, options: RecomputeRun): Promise<RecomputeReport> {
  const parameters: RatingParameters = options.parameters === "measured"
    ? MEASURED_RATING_PARAMETERS : LEGACY_RATING_PARAMETERS;
  {
    const fullHistory = await readHistoryForReplay(pool);
    if (fullHistory.length === 0) {
      throw new Error("the corrected history is empty - build it first");
    }
    const races = eligibleHistory(fullHistory, options.eligiblePlayerIds);
    const result = replayHistory(races, {
      parameters,
      decay: options.decay ? DEFAULT_DECAY_PARAMETERS : null,
    });

    const [previous] = await pool.execute<RowDataPacket[]>(
      "SELECT player_id AS playerId, mu, sigma FROM player_ratings");
    let biggestScoreMove = 0;
    for (const row of previous) {
      const rating = result.finalRatings.get(Number(row["playerId"]));
      if (rating === undefined) { continue; }
      const before = conservativeScore({
        mu: Number(row["mu"]), sigma: Number(row["sigma"]),
      });
      biggestScoreMove = Math.max(
        biggestScoreMove, Math.abs(conservativeScore(rating) - before));
    }

    const epoch = await currentEpoch(pool) + 1;
    const report: RecomputeReport = {
      parameters: options.parameters,
      decay: options.decay,
      dryRun: options.dryRun,
      racesRead: races.length,
      racesRated: result.racesRated,
      racesSkipped: result.racesSkipped,
      decayApplications: result.decayApplications,
      playersRated: result.finalRatings.size,
      epoch: options.dryRun ? epoch - 1 : epoch,
      biggestScoreMove,
    };
    if (options.dryRun) { return report; }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [operators] = await connection.execute<RowDataPacket[]>(
        "SELECT user_account_id AS id FROM user_accounts WHERE public_id = ?",
        [options.operator]);
      const operatorId = operators[0]?.["id"];
      if (operatorId === undefined) {
        throw new Error(
          `--operator ${options.operator} is not an account in this database`);
      }
      await writeEpoch(connection, result, epoch, options, Number(operatorId));
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    return report;
  }
}

async function writeEpoch(
  connection: PoolConnection,
  result: ReturnType<typeof replayHistory>,
  epoch: number,
  options: RecomputeRun,
  operatorId: number,
): Promise<void> {
  const sequence = new Map<number, number>();
  for (const event of result.events) {
    const next = (sequence.get(event.playerId) ?? 0) + 1;
    sequence.set(event.playerId, next);
    await connection.execute(
      `INSERT INTO player_rating_events
         (player_id, sequence_number, event_type, mu_before, sigma_before,
          mu_after, sigma_after, source_reference, occurred_at_ms, rating_epoch)
       VALUES (?, ?, 'history_race', ?, ?, ?, ?, ?, ?, ?)`,
      [event.playerId, next, event.before.mu, event.before.sigma,
        event.after.mu, event.after.sigma,
        `history_race:${event.raceSequence}`, event.occurredAtMs, epoch],
    );
  }
  const now = Date.now();
  const upsert = async (playerId: number, rating: Readonly<{ mu: number; sigma: number }>): Promise<void> => {
    await connection.execute(
      `INSERT INTO player_ratings
         (player_id, revision, mu, sigma, updated_at_ms, created_at_ms)
       VALUES (?, 1, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         revision = revision + 1, mu = VALUES(mu), sigma = VALUES(sigma),
         updated_at_ms = VALUES(updated_at_ms)`,
      [playerId, rating.mu, rating.sigma, now, now],
    );
  };
  for (const [playerId, rating] of result.finalRatings) {
    await upsert(playerId, rating);
  }
  // A Player the history never rated starts the new epoch where every epoch
  // starts: at their seed (the engine's prior for a newcomer, ADR-0177/0047).
  // Without this, a night applied in the previous epoch and then retracted
  // would linger in `player_ratings` for exactly the Players the history does
  // not touch - found 2026-09-15 reopening TN13 on the mirror, where seven
  // newcomers kept the night's points after the replay.
  const [seedRows] = await connection.execute<RowDataPacket[]>(
    `SELECT player_id AS playerId, mu_after AS mu, sigma_after AS sigma
       FROM player_rating_events
      WHERE rating_epoch = 0 AND event_type = 'seed_import'
      ORDER BY player_id ASC, sequence_number ASC`,
  );
  const seeds = new Map<number, Readonly<{ mu: number; sigma: number }>>();
  for (const row of seedRows) {
    // ADR-0221: a Player who does not count keeps no rating, not even a seed.
    if (options.eligiblePlayerIds != null && !options.eligiblePlayerIds.has(Number(row["playerId"]))) { continue; }
    seeds.set(Number(row["playerId"]), { mu: Number(row["mu"]), sigma: Number(row["sigma"]) });
  }
  for (const [playerId, seed] of seeds) {
    if (!result.finalRatings.has(playerId)) { await upsert(playerId, seed); }
  }
  const kept = [...new Set([...result.finalRatings.keys(), ...seeds.keys()])];
  if (kept.length === 0) {
    await connection.execute("DELETE FROM player_ratings");
  } else {
    await connection.execute(
      `DELETE FROM player_ratings WHERE player_id NOT IN (${kept.map(() => "?").join(", ")})`,
      kept,
    );
  }
  await connection.execute(
    `INSERT INTO rating_recalculations
       (reason_code, triggered_by_user_account_id, included_publications,
        applied_races, skipped_races, occurred_at_ms)
     VALUES (?, ?, 0, ?, ?, ?)`,
    [options.reasonCode ?? `history_${options.parameters}${options.decay ? "_decay" : ""}`,
      operatorId, result.racesRated, result.racesSkipped, now],
  );
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined &&
    import.meta.url === pathToFileURL(invokedPath).href) {
  runHistoryRecompute(process.env, process.argv.slice(2))
    .then((report) => {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    })
    .catch((error: unknown) => {
      process.stderr.write(
        `rating recompute failed: ${(error as Error).message}\n`);
      process.exitCode = 1;
    });
}
