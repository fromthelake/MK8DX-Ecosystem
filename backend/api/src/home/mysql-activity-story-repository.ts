import type { Pool, RowDataPacket } from "mysql2/promise";

import type {
  ActivityStoryLap,
  ActivityStoryLoadout,
  ActivityStoryRepository,
  StoryResult,
} from "./activity-story-service.js";

type PreparedQueryExecutor = Pick<Pool, "execute">;
const assetIdPattern = /^[a-z_]+\.[a-z0-9_.]+$/;

function correctionFields(value: unknown): readonly string[] | undefined {
  if (value === null) { return undefined; }
  let parsed = value;
  if (typeof value === "string") {
    try { parsed = JSON.parse(value); } catch { return undefined; }
  }
  if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > 15 ||
      parsed.some((field) => typeof field !== "string" || field.length > 32)) {
    return undefined;
  }
  return parsed;
}

type PreparedStoryResult = StoryResult & Readonly<{
  revisionInternalId: number;
}>;

const publishedJoin = `
  FROM time_trial_publications AS publication
  INNER JOIN time_trial_submission_revisions AS revision
    ON revision.time_trial_submission_revision_id =
       publication.current_revision_id
  INNER JOIN time_trial_submissions AS submission
    ON submission.time_trial_submission_id =
       publication.time_trial_submission_id
  INNER JOIN players AS player ON player.player_id = revision.player_id
  WHERE publication.publication_status = 'published'
    AND player.record_status = 'active'`;

export class MysqlActivityStoryRepository implements ActivityStoryRepository {
  public constructor(private readonly executor: PreparedQueryExecutor) {}

  public async listRecentResults(
    sinceMs: number,
    limit: number,
  ): Promise<readonly StoryResult[]> {
    const [rows] = await this.executor.execute<RowDataPacket[]>(
      `SELECT submission.public_id AS resultId,
              player.public_id AS playerId,
              player.display_name AS displayName,
              player.country_id AS countryId,
              player.avatar_id AS avatarId,
              revision.time_trial_submission_revision_id AS revisionInternalId,
              revision.track_id AS trackId,
              revision.mode_cc AS mode,
              revision.total_time_ms AS totalTimeMs,
              revision.character_id AS characterId,
              revision.character_variant_id AS characterVariantId,
              revision.body_id AS bodyId,
              revision.body_variant_id AS bodyVariantId,
              revision.tire_id AS tireId,
              revision.glider_id AS gliderId,
              revision.glider_variant_id AS gliderVariantId,
              revision.source_kind AS sourceKind,
              revision.corrected_fields_json AS correctedFieldsJson,
              publication.rank_at_publication AS rankAtPublication,
              COALESCE(revision.occurred_at_ms, revision.submitted_at_ms,
                       revision.created_at_ms) AS resultAtMs
       ${publishedJoin}
         AND COALESCE(revision.occurred_at_ms, revision.submitted_at_ms,
                      revision.created_at_ms) >= ?
       ORDER BY resultAtMs DESC, resultId ASC
       LIMIT ${Math.max(1, Math.min(500, Math.trunc(limit)))}`,
      [sinceMs],
    );
    const prepared: PreparedStoryResult[] = [];
    for (const row of rows) {
      const revisionInternalId = Number(row["revisionInternalId"]);
      const mode = Number(row["mode"]);
      const totalTimeMs = Number(row["totalTimeMs"]);
      const resultAtMs = Number(row["resultAtMs"]);
      const rankAtPublication = row["rankAtPublication"] === null ||
        row["rankAtPublication"] === undefined
        ? undefined
        : Number(row["rankAtPublication"]);
      if (typeof row["resultId"] !== "string" ||
          typeof row["playerId"] !== "string" ||
          typeof row["displayName"] !== "string" ||
          typeof row["trackId"] !== "string" ||
          typeof row["sourceKind"] !== "string" ||
          (mode !== 150 && mode !== 200) ||
          !Number.isSafeInteger(revisionInternalId) || revisionInternalId <= 0 ||
          !Number.isSafeInteger(totalTimeMs) || totalTimeMs <= 0 ||
          !Number.isSafeInteger(resultAtMs) ||
          (rankAtPublication !== undefined &&
            (!Number.isSafeInteger(rankAtPublication) || rankAtPublication < 1))) {
        continue;
      }
      const loadout: Record<string, string> = {};
      const correctedFields = correctionFields(row["correctedFieldsJson"]);
      for (const field of [
        "characterId", "characterVariantId", "bodyId", "bodyVariantId",
        "tireId", "gliderId", "gliderVariantId",
      ] as const) {
        const value = row[field];
        if (typeof value === "string" && assetIdPattern.test(value)) {
          loadout[field] = value;
        }
      }
      prepared.push({
        revisionInternalId,
        resultId: row["resultId"],
        playerId: row["playerId"],
        displayName: row["displayName"],
        ...(typeof row["countryId"] === "string" && row["countryId"] !== ""
          ? { countryId: row["countryId"] }
          : {}),
        ...(typeof row["avatarId"] === "string" && row["avatarId"] !== ""
          ? { avatarId: row["avatarId"] }
          : {}),
        trackId: row["trackId"],
        mode,
        totalTimeMs,
        resultAtMs,
        sourceKind: row["sourceKind"],
        ...(rankAtPublication === undefined ? {} : { rankAtPublication }),
        ...(correctedFields === undefined ? {} : { correctedFields }),
        ...(Object.keys(loadout).length === 0
          ? {}
          : { loadout: loadout as ActivityStoryLoadout }),
      });
    }
    if (prepared.length === 0) { return []; }
    const placeholders = prepared.map(() => "?").join(", ");
    const [lapRows] = await this.executor.execute<RowDataPacket[]>(
      `SELECT time_trial_submission_revision_id AS revisionInternalId,
              lap_number AS lapNumber, time_ms AS timeMs,
              coins_collected AS coinsCollected,
              mushrooms_used AS mushroomsUsed
       FROM time_trial_laps
       WHERE time_trial_submission_revision_id IN (${placeholders})
       ORDER BY time_trial_submission_revision_id ASC, lap_number ASC`,
      prepared.map((result) => result.revisionInternalId),
    );
    const lapsByRevision = new Map<number, ActivityStoryLap[]>();
    for (const row of lapRows) {
      const revisionInternalId = Number(row["revisionInternalId"]);
      const lapNumber = Number(row["lapNumber"]);
      const timeMs = Number(row["timeMs"]);
      const coinsCollected = row["coinsCollected"] === null
        ? undefined : Number(row["coinsCollected"]);
      const mushroomsUsed = row["mushroomsUsed"] === null
        ? undefined : Number(row["mushroomsUsed"]);
      if (!Number.isSafeInteger(revisionInternalId) || revisionInternalId <= 0 ||
          !Number.isSafeInteger(lapNumber) || lapNumber < 1 || lapNumber > 7 ||
          !Number.isSafeInteger(timeMs) || timeMs <= 0 ||
          (coinsCollected !== undefined &&
            (!Number.isSafeInteger(coinsCollected) ||
             coinsCollected < 0 || coinsCollected > 10)) ||
          (mushroomsUsed !== undefined &&
            (!Number.isSafeInteger(mushroomsUsed) ||
             mushroomsUsed < 0 || mushroomsUsed > 3))) {
        continue;
      }
      const laps = lapsByRevision.get(revisionInternalId) ?? [];
      laps.push({
        lapNumber,
        timeMs,
        ...(coinsCollected === undefined ? {} : { coinsCollected }),
        ...(mushroomsUsed === undefined ? {} : { mushroomsUsed }),
      });
      lapsByRevision.set(revisionInternalId, laps);
    }
    return prepared.map(({ revisionInternalId, ...result }) => ({
      ...result,
      laps: lapsByRevision.get(revisionInternalId) ?? [],
    }));
  }

  public async listHumanBestsForCombos(combos: readonly Readonly<{
    key: string;
    trackId: string;
    mode: 150 | 200;
  }>[]): Promise<ReadonlyMap<string, readonly Readonly<{
    playerId: string;
    displayName: string;
    bestMs: number;
  }>[]>> {
    const grouped = new Map<string, Array<{
      playerId: string; displayName: string; bestMs: number;
    }>>();
    if (combos.length === 0) return grouped;
    const targets = combos.map(() =>
      "SELECT ? AS targetKey, ? AS trackId, ? AS mode").join(" UNION ALL ");
    const [rows] = await this.executor.execute<RowDataPacket[]>(
      `SELECT target.targetKey AS targetKey,
              player.public_id AS playerId,
              player.display_name AS displayName,
              MIN(revision.total_time_ms) AS bestMs
       FROM (${targets}) AS target
       INNER JOIN time_trial_submission_revisions AS revision
         ON revision.track_id = target.trackId
        AND revision.mode_cc = target.mode
       INNER JOIN time_trial_publications AS publication
         ON publication.current_revision_id =
            revision.time_trial_submission_revision_id
       INNER JOIN time_trial_submissions AS submission
         ON submission.time_trial_submission_id =
            publication.time_trial_submission_id
       INNER JOIN players AS player ON player.player_id = revision.player_id
       WHERE publication.publication_status = 'published'
         AND player.record_status = 'active'
       GROUP BY target.targetKey, player.player_id,
                player.public_id, player.display_name`,
      combos.flatMap((combo) => [combo.key, combo.trackId, combo.mode]),
    );
    for (const row of rows) {
      const bestMs = Number(row["bestMs"]);
      if (typeof row["targetKey"] === "string" &&
        typeof row["playerId"] === "string" &&
        typeof row["displayName"] === "string" &&
        Number.isSafeInteger(bestMs) && bestMs > 0) {
        const values = grouped.get(row["targetKey"]) ?? [];
        values.push({
          playerId: row["playerId"],
          displayName: row["displayName"],
          bestMs,
        });
        grouped.set(row["targetKey"], values);
      }
    }
    return grouped;
  }

  public async preStoryBests(targets_: readonly Readonly<{
    key: string;
    playerId: string;
    trackId: string;
    mode: 150 | 200;
    beforeAtMs: number;
  }>[]): Promise<ReadonlyMap<string, number>> {
    const bests = new Map<string, number>();
    if (targets_.length === 0) return bests;
    const targets = targets_.map(() =>
      "SELECT ? AS targetKey, ? AS playerId, ? AS trackId, ? AS mode, ? AS beforeAtMs")
      .join(" UNION ALL ");
    const [rows] = await this.executor.execute<RowDataPacket[]>(
      `SELECT target.targetKey AS targetKey,
              MIN(revision.total_time_ms) AS bestMs
       FROM (${targets}) AS target
       INNER JOIN players AS player ON player.public_id = target.playerId
       INNER JOIN time_trial_submission_revisions AS revision
         ON revision.player_id = player.player_id
        AND revision.track_id = target.trackId
        AND revision.mode_cc = target.mode
        AND COALESCE(revision.occurred_at_ms, revision.submitted_at_ms,
                     revision.created_at_ms) < target.beforeAtMs
       INNER JOIN time_trial_publications AS publication
         ON publication.current_revision_id =
            revision.time_trial_submission_revision_id
       INNER JOIN time_trial_submissions AS submission
         ON submission.time_trial_submission_id =
            publication.time_trial_submission_id
       WHERE publication.publication_status = 'published'
         AND player.record_status = 'active'
       GROUP BY target.targetKey`,
      targets_.flatMap((target) => [
        target.key, target.playerId, target.trackId,
        target.mode, target.beforeAtMs,
      ]),
    );
    for (const row of rows) {
      const bestMs = Number(row["bestMs"]);
      if (typeof row["targetKey"] === "string" &&
          Number.isSafeInteger(bestMs) && bestMs > 0) {
        bests.set(row["targetKey"], bestMs);
      }
    }
    return bests;
  }

  public async reactionSummaries(
    resultIds: readonly string[],
  ): Promise<ReadonlyMap<
    string,
    Readonly<{ count: number; kinds: readonly string[] }>
  >> {
    const summaries = new Map<
      string,
      { count: number; kinds: string[] }
    >();
    if (resultIds.length === 0) { return summaries; }
    const placeholders = resultIds.map(() => "?").join(", ");
    const [rows] = await this.executor.execute<RowDataPacket[]>(
      `SELECT submission.public_id AS resultId,
              reaction.reaction_kind AS reactionKind,
              COUNT(*) AS reactionCount
       FROM time_trial_reactions AS reaction
       INNER JOIN time_trial_submissions AS submission
         ON submission.time_trial_submission_id =
            reaction.time_trial_submission_id
       WHERE submission.public_id IN (${placeholders})
       GROUP BY submission.public_id, reaction.reaction_kind
       ORDER BY reactionCount DESC, reactionKind ASC`,
      [...resultIds],
    );
    for (const row of rows) {
      const count = Number(row["reactionCount"]);
      if (typeof row["resultId"] !== "string" ||
          typeof row["reactionKind"] !== "string" ||
          !Number.isSafeInteger(count) || count <= 0) {
        continue;
      }
      const summary = summaries.get(row["resultId"]) ??
        { count: 0, kinds: [] };
      summary.count += count;
      if (!summary.kinds.includes(row["reactionKind"])) {
        summary.kinds.push(row["reactionKind"]);
      }
      summaries.set(row["resultId"], summary);
    }
    return summaries;
  }
}
