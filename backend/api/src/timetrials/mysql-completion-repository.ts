import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";

import {
  TimeTrialCompletionError,
  planCompletion,
  type CurrentLap,
  type CurrentLoadout,
  type ProtectedCompletionEvidence,
  type TimeTrialCompletionRepository,
  type TimeTrialCompletionResult,
  type TimeTrialCompletionV1,
} from "./completion-service.js";
import { refreshTimeTrialPlayerBestsForRevisions } from "./time-trial-player-bests.js";

// One transaction (ADR-0210 rule 10): a new revision that is the previous one verbatim — source,
// timestamps, verification, capture layout, evidence — with only the empty fields filled, the
// reading's evidence added, the publication pointer moved without touching its date, rank, status
// or reason, and a `corrected` lifecycle event that names what was completed. No notification is
// produced: the time did not change, so nobody was overtaken.

type Row = RowDataPacket & Record<string, unknown>;

function integer(value: unknown, field: string, minimum = 0): number {
  const parsed = typeof value === "string" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isSafeInteger(parsed) || parsed < minimum) {
    throw new TimeTrialCompletionError("not_found", `${field} is invalid`);
  }
  return parsed;
}

function nullableText(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function nullableInteger(value: unknown): number | null {
  if (value === null || value === undefined) { return null; }
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isSafeInteger(parsed) ? parsed : null;
}

export class MysqlTimeTrialCompletionRepository implements TimeTrialCompletionRepository {
  public constructor(
    private readonly pool: Pool,
    private readonly clock: Readonly<{ nowMs(): number }> = { nowMs: () => Date.now() },
  ) {}

  public async complete(input: Readonly<{
    submissionId: string;
    actorUserAccountId: string;
    completion: TimeTrialCompletionV1;
    evidence: readonly ProtectedCompletionEvidence[];
  }>): Promise<TimeTrialCompletionResult> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const result = await this.completeIn(connection, input);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  private async completeIn(connection: PoolConnection, input: Readonly<{
    submissionId: string;
    actorUserAccountId: string;
    completion: TimeTrialCompletionV1;
    evidence: readonly ProtectedCompletionEvidence[];
  }>): Promise<TimeTrialCompletionResult> {
    const notFound = (): never => {
      throw new TimeTrialCompletionError("not_found", "That Time Trial was not found.");
    };
    const [accounts] = await connection.execute<Row[]>(
      `SELECT account.user_account_id AS accountInternalId, claim.player_id AS playerInternalId
       FROM user_accounts AS account
       INNER JOIN player_claims AS claim
         ON claim.user_account_id = account.user_account_id AND claim.claim_status = 'verified'
       INNER JOIN players AS player
         ON player.player_id = claim.player_id AND player.record_status = 'active'
       WHERE account.public_id = ? LIMIT 1`,
      [input.actorUserAccountId],
    );
    const account = accounts[0];
    if (account === undefined) { notFound(); }
    const accountInternalId = integer(account!["accountInternalId"], "account id", 1);
    const playerInternalId = integer(account!["playerInternalId"], "player id", 1);

    const [rows] = await connection.execute<Row[]>(
      `SELECT submission.time_trial_submission_id AS submissionInternalId,
              submission.retirement_state AS retirementState,
              publication.time_trial_publication_id AS publicationId,
              publication.publication_status AS publicationStatus,
              publication.publication_origin AS publicationOrigin,
              publication.reason_code AS publicationReason,
              publication.rank_at_publication AS rankAtPublication,
              revision.time_trial_submission_revision_id AS revisionInternalId,
              revision.revision_number AS revisionNumber,
              revision.player_id AS playerInternalId,
              revision.track_id AS trackId, revision.mode_cc AS modeCc,
              revision.total_time_ms AS totalTimeMs,
              revision.character_id AS characterId,
              revision.character_variant_id AS characterVariantId,
              revision.body_id AS bodyId, revision.body_variant_id AS bodyVariantId,
              revision.tire_id AS tireId, revision.glider_id AS gliderId,
              revision.glider_variant_id AS gliderVariantId
       FROM time_trial_submissions AS submission
       INNER JOIN time_trial_publications AS publication
         ON publication.time_trial_submission_id = submission.time_trial_submission_id
       INNER JOIN time_trial_submission_revisions AS revision
         ON revision.time_trial_submission_revision_id = publication.current_revision_id
       WHERE submission.public_id = ?
       LIMIT 1 FOR UPDATE`,
      [input.submissionId],
    );
    const row = rows[0];
    // Someone else's result is "not found", as in the lifecycle routes: an account may not probe ids.
    if (row === undefined || nullableInteger(row["playerInternalId"]) !== playerInternalId) { notFound(); }
    const current = row!;
    if (current["retirementState"] === "retired") {
      throw new TimeTrialCompletionError("revision_conflict", "A retired Time Trial is not completed.");
    }
    const currentRevision = integer(current["revisionNumber"], "revision", 1);
    if (currentRevision !== input.completion.expectedRevision) {
      throw new TimeTrialCompletionError("revision_conflict", "The result changed since it was read.");
    }
    // The same run: same track, same engine, the exact same time. Anything else is another result.
    if (current["trackId"] !== input.completion.trackId ||
      integer(current["modeCc"], "mode") !== input.completion.mode ||
      integer(current["totalTimeMs"], "total", 1) !== input.completion.totalTimeMs) {
      throw new TimeTrialCompletionError(
        "different_result", "The reading disagrees with the stored result, so it is not the same run.",
      );
    }
    const previousRevisionId = integer(current["revisionInternalId"], "revision id", 1);
    const submissionInternalId = integer(current["submissionInternalId"], "submission id", 1);

    const [lapRows] = await connection.execute<Row[]>(
      `SELECT lap_number AS lapNumber, time_ms AS timeMs,
              coins_collected AS coinsCollected, mushrooms_used AS mushroomsUsed
       FROM time_trial_laps WHERE time_trial_submission_revision_id = ?
       ORDER BY lap_number ASC`,
      [previousRevisionId],
    );
    const currentLaps: CurrentLap[] = lapRows.map((lap) => ({
      lapNumber: integer(lap["lapNumber"], "lap", 1),
      timeMs: integer(lap["timeMs"], "lap time", 1),
      coinsCollected: nullableInteger(lap["coinsCollected"]),
      mushroomsUsed: nullableInteger(lap["mushroomsUsed"]),
    }));
    const currentLoadout: CurrentLoadout = {
      characterId: nullableText(current["characterId"]),
      characterVariantId: nullableText(current["characterVariantId"]),
      bodyId: nullableText(current["bodyId"]),
      bodyVariantId: nullableText(current["bodyVariantId"]),
      tireId: nullableText(current["tireId"]),
      gliderId: nullableText(current["gliderId"]),
      gliderVariantId: nullableText(current["gliderVariantId"]),
    };
    const plan = planCompletion({ loadout: currentLoadout, laps: currentLaps }, input.completion);

    const nextRevision = currentRevision + 1;
    const [inserted] = await connection.execute<ResultSetHeader>(
      `INSERT INTO time_trial_submission_revisions (
         time_trial_submission_id, revision_number, schema_version, mode_cc,
         track_id, total_time_ms, participant_reference_kind, player_id,
         observed_player_name, character_id, character_variant_id, body_id,
         body_variant_id, tire_id, glider_id, glider_variant_id, country_id,
         source_kind, producer_version, local_record_id, occurred_at_ms,
         captured_at_ms, created_at_ms, submitted_at_ms, verification_status,
         verification_method, corrected_fields_json,
         verification_lap_sum_matches, verification_confidence,
         confidence_total_time, confidence_track, confidence_character,
         confidence_character_variant, confidence_body, confidence_tire,
         confidence_glider, confidence_country, confidence_player_name
       ) SELECT time_trial_submission_id, ?, schema_version, mode_cc,
           track_id, total_time_ms, participant_reference_kind, player_id,
           observed_player_name, ?, ?, ?, ?, ?, ?, ?, country_id,
           source_kind, producer_version, local_record_id, occurred_at_ms,
           captured_at_ms, created_at_ms, submitted_at_ms, verification_status,
           verification_method, corrected_fields_json,
           verification_lap_sum_matches, verification_confidence,
           confidence_total_time, confidence_track, confidence_character,
           confidence_character_variant, confidence_body, confidence_tire,
           confidence_glider, confidence_country, confidence_player_name
         FROM time_trial_submission_revisions
         WHERE time_trial_submission_revision_id = ?`,
      [
        nextRevision,
        plan.loadout.characterId, plan.loadout.characterVariantId, plan.loadout.bodyId,
        plan.loadout.bodyVariantId, plan.loadout.tireId, plan.loadout.gliderId,
        plan.loadout.gliderVariantId, previousRevisionId,
      ],
    );
    const revisionInternalId = integer(inserted.insertId, "revision id", 1);

    await connection.execute(
      `INSERT INTO time_trial_submission_capture_layouts (time_trial_submission_revision_id, capture_layout)
       SELECT ?, capture_layout FROM time_trial_submission_capture_layouts
       WHERE time_trial_submission_revision_id = ?`,
      [revisionInternalId, previousRevisionId],
    );
    if (currentLaps.length > 0) {
      // Carried forward verbatim (confidence included), then only the empty counts are filled.
      await connection.execute(
        `INSERT INTO time_trial_laps (
           time_trial_submission_revision_id, lap_number, time_ms, coins_collected, mushrooms_used, confidence
         ) SELECT ?, lap_number, time_ms, coins_collected, mushrooms_used, confidence
           FROM time_trial_laps WHERE time_trial_submission_revision_id = ?`,
        [revisionInternalId, previousRevisionId],
      );
      for (const lap of plan.laps) {
        await connection.execute(
          `UPDATE time_trial_laps SET coins_collected = ?, mushrooms_used = ?
           WHERE time_trial_submission_revision_id = ? AND lap_number = ?`,
          [lap.coinsCollected, lap.mushroomsUsed, revisionInternalId, lap.lapNumber],
        );
      }
    } else {
      for (const lap of plan.laps) {
        await connection.execute(
          `INSERT INTO time_trial_laps (
             time_trial_submission_revision_id, lap_number, time_ms, coins_collected, mushrooms_used
           ) VALUES (?, ?, ?, ?, ?)`,
          [revisionInternalId, lap.lapNumber, lap.timeMs, lap.coinsCollected, lap.mushroomsUsed],
        );
      }
    }
    await connection.execute(
      `INSERT INTO restricted_time_trial_participant_references (
         time_trial_submission_revision_id, reference_namespace, lookup_hmac, lookup_key_version,
         reference_ciphertext, encryption_key_version
       ) SELECT ?, reference_namespace, lookup_hmac, lookup_key_version,
           reference_ciphertext, encryption_key_version
         FROM restricted_time_trial_participant_references
         WHERE time_trial_submission_revision_id = ?`,
      [revisionInternalId, previousRevisionId],
    );
    await connection.execute(
      `INSERT INTO restricted_time_trial_evidence (
         time_trial_submission_revision_id, sequence_number, evidence_kind,
         reference_ciphertext, encryption_key_version, sha256, media_type
       ) SELECT ?, sequence_number, evidence_kind, reference_ciphertext, encryption_key_version,
           sha256, media_type
         FROM restricted_time_trial_evidence WHERE time_trial_submission_revision_id = ?`,
      [revisionInternalId, previousRevisionId],
    );
    const [sequences] = await connection.execute<Row[]>(
      `SELECT COALESCE(MAX(sequence_number), 0) AS lastSequence FROM restricted_time_trial_evidence
       WHERE time_trial_submission_revision_id = ?`,
      [revisionInternalId],
    );
    let sequence = integer(sequences[0]?.["lastSequence"] ?? 0, "evidence sequence");
    for (const evidence of input.evidence) {
      sequence += 1;
      if (sequence > 8) {
        throw new TimeTrialCompletionError("invalid_completion", "The result holds no room for more evidence.");
      }
      await connection.execute(
        `INSERT INTO restricted_time_trial_evidence (
           time_trial_submission_revision_id, sequence_number, evidence_kind,
           reference_ciphertext, encryption_key_version, sha256, media_type
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          revisionInternalId, sequence, evidence.kind,
          evidence.protectedReference.ciphertext, evidence.protectedReference.encryptionKeyVersion,
          evidence.sha256 ?? null, evidence.mediaType ?? null,
        ],
      );
    }

    const occurredAtMs = this.clock.nowMs();
    // The pointer moves; the publication keeps its date, rank, status, origin and reason, so the
    // result does not reappear as new anywhere and no overtaken notification is due.
    await connection.execute(
      `UPDATE time_trial_publications
       SET current_revision_id = ?, publication_revision = publication_revision + 1, updated_at_ms = ?
       WHERE time_trial_submission_id = ?`,
      [revisionInternalId, occurredAtMs, submissionInternalId],
    );
    const [publications] = await connection.execute<Row[]>(
      `SELECT publication_revision AS publicationRevision FROM time_trial_publications
       WHERE time_trial_submission_id = ? LIMIT 1`,
      [submissionInternalId],
    );
    const status = current["publicationStatus"] === "published" ? "published" : "withheld";
    await connection.execute(
      `INSERT INTO time_trial_publication_lifecycle (
         time_trial_publication_id, sequence_number, time_trial_submission_revision_id, event_type,
         publication_status_after, publication_origin, reason_code, rank_at_publication, occurred_at_ms
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        integer(current["publicationId"], "publication id", 1),
        integer(publications[0]?.["publicationRevision"], "publication revision", 1),
        revisionInternalId,
        status === "published" ? "revision_published" : "revision_withheld",
        status, current["publicationOrigin"], current["publicationReason"],
        nullableInteger(current["rankAtPublication"]), occurredAtMs,
      ],
    );
    await connection.execute(
      `INSERT INTO time_trial_lifecycle_events (
         time_trial_submission_id, sequence_number, event_type, retirement_state_after,
         time_trial_submission_revision_id, actor_role, actor_user_account_id, reason_code, note,
         occurred_at_ms
       ) SELECT ?, COALESCE(MAX(sequence_number), 0) + 1, 'corrected', 'active', ?, 'owner', ?,
           'other', ?, ?
         FROM time_trial_lifecycle_events WHERE time_trial_submission_id = ?`,
      [
        submissionInternalId, revisionInternalId, accountInternalId,
        `Completed from a LiveTrial ghost: ${plan.completedFields.join(", ")}`.slice(0, 256),
        occurredAtMs, submissionInternalId,
      ],
    );
    await refreshTimeTrialPlayerBestsForRevisions(connection, [revisionInternalId]);
    return { submissionId: input.submissionId, revision: nextRevision, completedFields: plan.completedFields };
  }
}
