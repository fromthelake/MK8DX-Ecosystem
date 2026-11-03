// Public community Record Book: the notable extremes, derived on demand
// from published canonical results. Every category names its top
// holders with public Player identity only.

export type RecordHolder = Readonly<{
  playerId: string;
  displayName: string;
  avatarId?: string;
  value: number;
}>;

export type RecordCategory = Readonly<{
  key: "firsts" | "podiums" | "published" | "coverage";
  holders: readonly RecordHolder[];
}>;

export type RecordBook = Readonly<{
  categories: readonly RecordCategory[];
}>;

export class RecordBookError extends Error {
  public constructor(public readonly code: "unavailable") {
    super("The record book could not be loaded.");
    this.name = "RecordBookError";
  }
}

export interface RecordBookRepository {
  loadRecordBook(): Promise<RecordBook>;
}

export class RecordBookService {
  public constructor(private readonly repository: RecordBookRepository) {}

  public async loadRecordBook(): Promise<RecordBook> {
    try {
      return await this.repository.loadRecordBook();
    } catch {
      throw new RecordBookError("unavailable");
    }
  }
}

interface HolderRow {
  playerId?: unknown;
  displayName?: unknown;
  avatarId?: unknown;
  recordValue?: unknown;
}

const playerIdPattern = /^player\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const avatarIdPattern = /^character(_variant)?\.[a-z0-9_.]+$/;

const publishedResultJoin = `
  FROM time_trial_publications AS publication
  INNER JOIN time_trial_submission_revisions AS revision
    ON revision.time_trial_submission_revision_id =
       publication.current_revision_id
  INNER JOIN players AS player ON player.player_id = revision.player_id
  WHERE publication.publication_status = 'published'
    AND player.record_status = 'active'`;

const rankedBests = `
  WITH bests AS (
    SELECT revision.player_id, revision.track_id, revision.mode_cc,
           MIN(revision.total_time_ms) AS best_time
    FROM time_trial_publications AS publication
    INNER JOIN time_trial_submission_revisions AS revision
      ON revision.time_trial_submission_revision_id =
         publication.current_revision_id
    WHERE publication.publication_status = 'published'
      AND revision.player_id IS NOT NULL
    GROUP BY revision.player_id, revision.track_id, revision.mode_cc
  ),
  ranked AS (
    SELECT player_id,
           RANK() OVER (
             PARTITION BY track_id, mode_cc
             ORDER BY best_time ASC, player_id ASC
           ) AS position
    FROM bests
  )`;

export class MysqlRecordBookRepository implements RecordBookRepository {
  public constructor(
    private readonly executor: Pick<
      import("mysql2/promise").Pool,
      "execute"
    >,
  ) {}

  private parseHolders(rows: unknown): readonly RecordHolder[] {
    const holders: RecordHolder[] = [];
    for (const row of rows as readonly HolderRow[]) {
      const value = Number(row.recordValue);
      if (typeof row.playerId !== "string" ||
          !playerIdPattern.test(row.playerId) ||
          typeof row.displayName !== "string" ||
          !Number.isSafeInteger(value) || value <= 0) {
        continue;
      }
      holders.push({
        playerId: row.playerId,
        displayName: row.displayName,
        ...(typeof row.avatarId === "string" &&
          avatarIdPattern.test(row.avatarId)
          ? { avatarId: row.avatarId }
          : {}),
        value,
      });
    }
    return holders;
  }

  public async loadRecordBook(): Promise<RecordBook> {
    const [publishedRows] = await this.executor.execute(
      `SELECT player.public_id AS playerId,
              player.display_name AS displayName,
              player.avatar_id AS avatarId,
              COUNT(*) AS recordValue
       ${publishedResultJoin}
       GROUP BY player.player_id
       ORDER BY recordValue DESC, player.public_id ASC
       LIMIT 3`,
    );
    const [coverageRows] = await this.executor.execute(
      `SELECT player.public_id AS playerId,
              player.display_name AS displayName,
              player.avatar_id AS avatarId,
              COUNT(DISTINCT revision.track_id, revision.mode_cc)
                AS recordValue
       ${publishedResultJoin}
       GROUP BY player.player_id
       ORDER BY recordValue DESC, player.public_id ASC
       LIMIT 3`,
    );
    const [firstsRows] = await this.executor.execute(
      `${rankedBests}
       SELECT player.public_id AS playerId,
              player.display_name AS displayName,
              player.avatar_id AS avatarId,
              SUM(ranked.position = 1) AS recordValue
       FROM ranked
       INNER JOIN players AS player ON player.player_id = ranked.player_id
       WHERE player.record_status = 'active'
       GROUP BY player.player_id
       ORDER BY recordValue DESC, player.public_id ASC
       LIMIT 3`,
    );
    const [podiumRows] = await this.executor.execute(
      `${rankedBests}
       SELECT player.public_id AS playerId,
              player.display_name AS displayName,
              player.avatar_id AS avatarId,
              SUM(ranked.position <= 3) AS recordValue
       FROM ranked
       INNER JOIN players AS player ON player.player_id = ranked.player_id
       WHERE player.record_status = 'active'
       GROUP BY player.player_id
       ORDER BY recordValue DESC, player.public_id ASC
       LIMIT 3`,
    );
    return {
      categories: [
        { key: "firsts", holders: this.parseHolders(firstsRows) },
        { key: "podiums", holders: this.parseHolders(podiumRows) },
        { key: "published", holders: this.parseHolders(publishedRows) },
        { key: "coverage", holders: this.parseHolders(coverageRows) },
      ],
    };
  }
}
