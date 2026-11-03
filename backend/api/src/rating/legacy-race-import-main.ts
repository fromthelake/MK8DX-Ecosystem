// Operational CLI: import the restricted mariokart8.nl per-race history
// (TN4..TN12) as canonical legacy race placements, verified against the
// live seeded ratings before anything is written.
//
// Reads MK8DX_HOSTED_MYSQL_* from the environment. Inputs stay outside
// Git; output is privacy-safe aggregates only. Idempotent: existing
// races/placements are skipped by their unique keys.
//
// Usage: rating:import-legacy-races -- --history <restricted-json>
//        --mapping <restricted-json> --confirm-database <name>

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import mysql from "mysql2/promise";
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";

import { loadHostedMysqlRuntimeConfig } from
  "../composition/hosted-runtime-config.js";
import {
  buildLegacyRaces,
  verifyReplay,
  type LegacyHistoryDocument,
  type LegacyMappingRow,
} from "./legacy-race-history.js";

const EXPECTED_ARTIFACT_KIND = "mk8dx.private-mariokart8nl-race-history.v2";
const FINAL_RATING_TOLERANCE = 1e-9;

export type LegacyRaceImportReport = Readonly<{
  races: number;
  observations: number;
  trajectoryMismatches: number;
  playersVerified: number;
  worstFinalMuError: number;
  worstFinalSigmaError: number;
  racesInserted: number;
  racesExisting: number;
  placementsInserted: number;
  placementsExisting: number;
}>;

export async function runLegacyRaceImport(
  environment: Readonly<Record<string, string | undefined>>,
  argv: readonly string[],
): Promise<LegacyRaceImportReport> {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if ((flag !== "--history" && flag !== "--mapping" &&
         flag !== "--confirm-database") ||
        value === undefined || value.length === 0 || values.has(flag)) {
      throw new Error("expected --history <path> --mapping <path> " +
        "--confirm-database <name>");
    }
    values.set(flag, value);
  }
  const historyPath = values.get("--history");
  const mappingPath = values.get("--mapping");
  const confirmDatabase = values.get("--confirm-database");
  if (historyPath === undefined || mappingPath === undefined ||
      confirmDatabase === undefined) {
    throw new Error(
      "--history, --mapping and --confirm-database are required");
  }

  const history = JSON.parse(
    await readFile(historyPath, "utf8")) as LegacyHistoryDocument;
  if (history.artifactKind !== EXPECTED_ARTIFACT_KIND) {
    throw new Error("the history file is not the expected artifact");
  }
  const mapping = JSON.parse(
    await readFile(mappingPath, "utf8")) as readonly LegacyMappingRow[];
  if (!Array.isArray(mapping)) {
    throw new Error("the mapping file must contain one JSON array");
  }

  const races = buildLegacyRaces(history, mapping);
  const verification = verifyReplay(races);
  if (verification.trajectoryMismatches > 0) {
    throw new Error(`replay trajectory mismatches: ${
      verification.trajectoryMismatches} - refusing to import`);
  }

  const config = loadHostedMysqlRuntimeConfig(environment);
  if (config.database !== confirmDatabase) {
    throw new Error(`--confirm-database ${confirmDatabase} does not match ` +
      "the configured database");
  }
  const pool: Pool = mysql.createPool({
    ...config,
    multipleStatements: false,
    namedPlaceholders: false,
  });
  try {
    // Resolve canonical players and verify the replay reproduces the
    // seeded live ratings BEFORE any write.
    const publicIds = [...verification.finalRatings.keys()];
    const placeholders = publicIds.map(() => "?").join(", ");
    const [playerRows] = await pool.execute<RowDataPacket[]>(
      `SELECT player.public_id AS publicId,
              player.player_id AS internalId,
              rating.mu AS mu, rating.sigma AS sigma
       FROM players AS player
       LEFT JOIN player_ratings AS rating
         ON rating.player_id = player.player_id
       WHERE player.public_id IN (${placeholders})`,
      publicIds,
    );
    const internalByPublic = new Map<string, number>();
    let worstMu = 0;
    let worstSigma = 0;
    let playersVerified = 0;
    for (const publicId of publicIds) {
      const row = playerRows.find((entry) => entry["publicId"] === publicId);
      if (row === undefined || typeof row["internalId"] !== "number") {
        throw new Error(`player ${publicId} does not exist - aborting`);
      }
      internalByPublic.set(publicId, row["internalId"]);
      const replayed = verification.finalRatings.get(publicId)!;
      const mu = Number(row["mu"]);
      const sigma = Number(row["sigma"]);
      if (!Number.isFinite(mu) || !Number.isFinite(sigma)) {
        throw new Error(`player ${publicId} has no seeded rating - aborting`);
      }
      worstMu = Math.max(worstMu, Math.abs(replayed.mu - mu));
      worstSigma = Math.max(worstSigma, Math.abs(replayed.sigma - sigma));
      playersVerified += 1;
    }
    if (worstMu > FINAL_RATING_TOLERANCE ||
        worstSigma > FINAL_RATING_TOLERANCE) {
      throw new Error(`replay does not reproduce the seeded ratings ` +
        `(worst mu error ${worstMu}, sigma ${worstSigma}) - aborting`);
    }

    let racesInserted = 0;
    let racesExisting = 0;
    let placementsInserted = 0;
    let placementsExisting = 0;
    for (const race of races) {
      const [raceResult] = await pool.execute<ResultSetHeader>(
        `INSERT IGNORE INTO legacy_tournament_races
           (race_sequence, tournament_number, section_label, race_index)
         VALUES (?, ?, ?, ?)`,
        [race.raceSequence, race.tournamentNumber, race.sectionLabel,
          race.raceIndex],
      );
      if (raceResult.affectedRows > 0) {
        racesInserted += 1;
      } else {
        racesExisting += 1;
      }
      const [idRows] = await pool.execute<RowDataPacket[]>(
        `SELECT legacy_tournament_race_id AS id FROM legacy_tournament_races
         WHERE tournament_number = ? AND section_label = ?
           AND race_index = ? LIMIT 1`,
        [race.tournamentNumber, race.sectionLabel, race.raceIndex],
      );
      const raceId = idRows[0]?.["id"];
      if (typeof raceId !== "number") {
        throw new Error("race row lookup failed - aborting");
      }
      for (const placement of race.placements) {
        const internalId = internalByPublic.get(placement.playerId);
        if (internalId === undefined) {
          throw new Error("unresolved player during insert - aborting");
        }
        const [placementResult] = await pool.execute<ResultSetHeader>(
          `INSERT IGNORE INTO legacy_race_placements
             (legacy_tournament_race_id, player_id, finish_position,
              score_after, score_delta)
           VALUES (?, ?, ?, ?, ?)`,
          [raceId, internalId,
            placement.finishPosition, placement.scoreAfter,
            placement.scoreDelta ?? null],
        );
        if (placementResult.affectedRows > 0) {
          placementsInserted += 1;
        } else {
          placementsExisting += 1;
        }
      }
    }
    return {
      races: verification.races,
      observations: verification.observations,
      trajectoryMismatches: verification.trajectoryMismatches,
      playersVerified,
      worstFinalMuError: worstMu,
      worstFinalSigmaError: worstSigma,
      racesInserted,
      racesExisting,
      placementsInserted,
      placementsExisting,
    };
  } finally {
    await pool.end();
  }
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined &&
    import.meta.url === pathToFileURL(resolve(invokedPath)).href) {
  runLegacyRaceImport(process.env, process.argv.slice(2)).then(
    (report) => {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    },
    (error: unknown) => {
      process.stderr.write(`legacy race import failed: ${
        error instanceof Error ? error.message : "unknown error"}\n`);
      process.exitCode = 1;
    },
  );
}
