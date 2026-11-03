import type { Pool, RowDataPacket } from "mysql2/promise";

import type {
  RatingAdministrationOverview,
  RatingAdministrationReadRepository,
  RatingDecisionOverview,
} from "./rating-administration-routes.js";

function integer(value: unknown): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

export class MysqlRatingAdministrationRepository implements RatingAdministrationReadRepository {
  public constructor(private readonly pool: Pool) {}

  public async overview(): Promise<Omit<RatingAdministrationOverview, "schemaVersion">> {
    const [epochRows] = await this.pool.execute<RowDataPacket[]>(
      "SELECT COALESCE(MAX(rating_recalculation_id), 0) AS epoch FROM rating_recalculations",
    );
    const currentEpoch = integer(epochRows[0]?.["epoch"]);
    const [playerRows] = await this.pool.execute<RowDataPacket[]>(
      "SELECT COUNT(*) AS ratedPlayers FROM player_ratings",
    );
    const [publicationRows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT publication.public_id AS publicationId,
              publication.event_name AS eventName,
              publication.publication_status AS publicationStatus,
              publication.public_visibility AS publicVisibility,
              publication.published_at_ms AS publishedAtMs,
              (SELECT decision.rating_included FROM tournament_rating_decisions AS decision
               WHERE decision.tournament_publication_id = publication.tournament_publication_id
               ORDER BY decision.sequence_number DESC LIMIT 1) AS ratingIncluded,
              (SELECT decision.occurred_at_ms FROM tournament_rating_decisions AS decision
               WHERE decision.tournament_publication_id = publication.tournament_publication_id
               ORDER BY decision.sequence_number DESC LIMIT 1) AS decidedAtMs,
              (SELECT COUNT(DISTINCT event.tournament_race_result_revision_id)
               FROM player_rating_events AS event
               INNER JOIN tournament_publication_current_members AS member
                 ON member.tournament_race_result_revision_id = event.tournament_race_result_revision_id
               WHERE member.tournament_publication_id = publication.tournament_publication_id
                 AND event.rating_epoch = ?) AS appliedRaces
       FROM tournament_publications AS publication
       ORDER BY publication.updated_at_ms DESC, publication.tournament_publication_id DESC
       LIMIT 200`,
      [currentEpoch],
    );
    const [recalculationRows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT rating_recalculation_id AS epoch, reason_code AS reasonCode,
              included_publications AS includedPublications, applied_races AS appliedRaces,
              skipped_races AS skippedRaces, occurred_at_ms AS occurredAtMs
       FROM rating_recalculations ORDER BY rating_recalculation_id DESC LIMIT 50`,
    );
    const publications: RatingDecisionOverview[] = publicationRows.flatMap((row) => {
      if (typeof row["publicationId"] !== "string" || typeof row["eventName"] !== "string") {
        return [];
      }
      const publishedAtMs = row["publishedAtMs"] === null ? undefined : integer(row["publishedAtMs"]);
      const decidedAtMs = row["decidedAtMs"] === null || row["decidedAtMs"] === undefined
        ? undefined
        : integer(row["decidedAtMs"]);
      return [{
        publicationId: row["publicationId"],
        eventName: row["eventName"],
        publicationStatus: typeof row["publicationStatus"] === "string" ? row["publicationStatus"] : "unknown",
        publicVisibility: typeof row["publicVisibility"] === "string" ? row["publicVisibility"] : "public",
        ...(publishedAtMs === undefined ? {} : { publishedAtMs }),
        ratingIncluded: row["ratingIncluded"] === null || row["ratingIncluded"] === undefined
          ? true
          : integer(row["ratingIncluded"]) === 1,
        ...(decidedAtMs === undefined ? {} : { decidedAtMs }),
        appliedRaces: integer(row["appliedRaces"]),
      }];
    });
    return {
      currentEpoch,
      ratedPlayers: integer(playerRows[0]?.["ratedPlayers"]),
      publications,
      recalculations: recalculationRows.flatMap((row) => typeof row["reasonCode"] === "string"
        ? [{
            epoch: integer(row["epoch"]),
            reasonCode: row["reasonCode"],
            includedPublications: integer(row["includedPublications"]),
            appliedRaces: integer(row["appliedRaces"]),
            skippedRaces: integer(row["skippedRaces"]),
            occurredAtMs: integer(row["occurredAtMs"]),
          }]
        : []),
    };
  }
}
