// Operational CLI: backfill full-precision mu/sigma per legacy race
// placement by replaying the imported races (from the database itself)
// through the canonical engine. Verified before writing: the replayed
// display scores must match every stored score_after, and the final
// ratings must reproduce the live seeded player_ratings exactly.
//
// Reads MK8DX_HOSTED_MYSQL_* from the environment. Idempotent: a rerun
// rewrites identical values.
//
// Usage: rating:backfill-legacy-ratings -- --confirm-database <name>

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import mysql from "mysql2/promise";
import type { Pool, RowDataPacket } from "mysql2/promise";

import { loadHostedMysqlRuntimeConfig } from
  "../composition/hosted-runtime-config.js";
import {
  conservativeScore,
  initialRating,
  rateFreeForAllRace,
  type Rating,
} from "./trueskill-engine.js";

const FINAL_RATING_TOLERANCE = 1e-9;

export type LegacyRatingBackfillReport = Readonly<{
  races: number;
  placements: number;
  trajectoryMismatches: number;
  playersVerified: number;
  worstFinalMuError: number;
  worstFinalSigmaError: number;
  rowsUpdated: number;
}>;

export async function runLegacyRatingBackfill(
  environment: Readonly<Record<string, string | undefined>>,
  argv: readonly string[],
): Promise<LegacyRatingBackfillReport> {
  if (argv.length !== 2 || argv[0] !== "--confirm-database" ||
      argv[1] === undefined || argv[1].length === 0) {
    throw new Error("expected --confirm-database <name>");
  }
  const config = loadHostedMysqlRuntimeConfig(environment);
  if (config.database !== argv[1]) {
    throw new Error(`--confirm-database ${argv[1]} does not match the ` +
      "configured database");
  }
  const pool: Pool = mysql.createPool({
    ...config,
    multipleStatements: false,
    namedPlaceholders: false,
  });
  try {
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT race.race_sequence AS raceSequence,
              placement.legacy_race_placement_id AS placementId,
              placement.player_id AS playerId,
              placement.finish_position AS finishPosition,
              placement.score_after AS scoreAfter
       FROM legacy_race_placements AS placement
       INNER JOIN legacy_tournament_races AS race
         ON race.legacy_tournament_race_id =
            placement.legacy_tournament_race_id
       ORDER BY race.race_sequence ASC, placement.finish_position ASC`,
    );
    const races = new Map<number, {
      placementId: number;
      playerId: number;
      finishPosition: number;
      scoreAfter: number;
    }[]>();
    for (const row of rows) {
      const raceSequence = Number(row["raceSequence"]);
      const placementId = Number(row["placementId"]);
      const playerId = Number(row["playerId"]);
      const finishPosition = Number(row["finishPosition"]);
      const scoreAfter = Number(row["scoreAfter"]);
      if (!Number.isSafeInteger(raceSequence) ||
          !Number.isSafeInteger(placementId) ||
          !Number.isSafeInteger(playerId) ||
          !Number.isSafeInteger(finishPosition) ||
          !Number.isFinite(scoreAfter)) {
        throw new Error("invalid placement row - aborting");
      }
      const bucket = races.get(raceSequence) ?? [];
      bucket.push({ placementId, playerId, finishPosition, scoreAfter });
      races.set(raceSequence, bucket);
    }

    const ratings = new Map<number, Rating>();
    const updates: { placementId: number; rating: Rating }[] = [];
    let trajectoryMismatches = 0;
    for (const sequence of [...races.keys()].sort((a, b) => a - b)) {
      const race = races.get(sequence)!;
      const participants = race.map((placement) =>
        ratings.get(placement.playerId) ?? initialRating());
      const ranks = race.map((placement) => placement.finishPosition);
      const updated = rateFreeForAllRace(participants, ranks);
      for (const [index, placement] of race.entries()) {
        const rating = updated[index]!;
        ratings.set(placement.playerId, rating);
        updates.push({ placementId: placement.placementId, rating });
        const derived = Math.round(conservativeScore(rating) * 100) / 100;
        if (Math.abs(derived - placement.scoreAfter) > 0.005) {
          trajectoryMismatches += 1;
        }
      }
    }
    if (trajectoryMismatches > 0) {
      throw new Error(`replay trajectory mismatches: ${
        trajectoryMismatches} - refusing to backfill`);
    }

    const [ratingRows] = await pool.execute<RowDataPacket[]>(
      `SELECT player_id AS playerId, mu, sigma FROM player_ratings`,
    );
    let worstMu = 0;
    let worstSigma = 0;
    let playersVerified = 0;
    for (const [playerId, rating] of ratings) {
      const row = ratingRows.find(
        (candidate) => Number(candidate["playerId"]) === playerId);
      if (row === undefined) {
        throw new Error(`player ${playerId} has no seeded rating - aborting`);
      }
      worstMu = Math.max(
        worstMu, Math.abs(rating.mu - Number(row["mu"])));
      worstSigma = Math.max(
        worstSigma, Math.abs(rating.sigma - Number(row["sigma"])));
      playersVerified += 1;
    }
    if (worstMu > FINAL_RATING_TOLERANCE ||
        worstSigma > FINAL_RATING_TOLERANCE) {
      throw new Error(`replay does not reproduce the seeded ratings ` +
        `(worst mu error ${worstMu}, sigma ${worstSigma}) - aborting`);
    }

    let rowsUpdated = 0;
    for (const update of updates) {
      const [result] = await pool.execute(
        `UPDATE legacy_race_placements
         SET mu_after = ?, sigma_after = ?
         WHERE legacy_race_placement_id = ?`,
        [
          update.rating.mu.toFixed(18),
          update.rating.sigma.toFixed(18),
          update.placementId,
        ],
      );
      rowsUpdated += (result as { affectedRows: number }).affectedRows;
    }
    return {
      races: races.size,
      placements: updates.length,
      trajectoryMismatches,
      playersVerified,
      worstFinalMuError: worstMu,
      worstFinalSigmaError: worstSigma,
      rowsUpdated,
    };
  } finally {
    await pool.end();
  }
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined &&
    import.meta.url === pathToFileURL(resolve(invokedPath)).href) {
  runLegacyRatingBackfill(process.env, process.argv.slice(2)).then(
    (report) => {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    },
    (error: unknown) => {
      process.stderr.write(`legacy rating backfill failed: ${
        error instanceof Error ? error.message : "unknown error"}\n`);
      process.exitCode = 1;
    },
  );
}
