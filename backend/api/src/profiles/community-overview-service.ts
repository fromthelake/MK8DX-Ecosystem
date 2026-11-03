// Public community overview: country-level distribution of Players
// (intentionally public countries only) plus aggregate community
// totals. Never more granular than country.

export type CommunityCountry = Readonly<{
  countryId: string;
  players: number;
}>;

export type CommunityOverview = Readonly<{
  players: number;
  countries: readonly CommunityCountry[];
  publishedTimeTrials: number;
  tournaments: number;
}>;

export class CommunityOverviewError extends Error {
  public constructor(public readonly code: "unavailable") {
    super("The community overview could not be loaded.");
    this.name = "CommunityOverviewError";
  }
}

export interface CommunityOverviewRepository {
  loadOverview(): Promise<CommunityOverview>;
}

export class CommunityOverviewService {
  public constructor(
    private readonly repository: CommunityOverviewRepository,
  ) {}

  public async loadOverview(): Promise<CommunityOverview> {
    try {
      return await this.repository.loadOverview();
    } catch {
      throw new CommunityOverviewError("unavailable");
    }
  }
}

interface CountRow {
  countValue?: unknown;
}

interface CountryRow {
  countryId?: unknown;
  playerCount?: unknown;
}

export class MysqlCommunityOverviewRepository
implements CommunityOverviewRepository {
  public constructor(
    private readonly executor: Pick<
      import("mysql2/promise").Pool,
      "execute"
    >,
  ) {}

  public async loadOverview(): Promise<CommunityOverview> {
    const [playerRows] = await this.executor.execute(
      `SELECT COUNT(*) AS countValue FROM players
       WHERE record_status = 'active' AND visibility = 'public'`,
    );
    const [countryRows] = await this.executor.execute(
      `SELECT country_id AS countryId, COUNT(*) AS playerCount
       FROM players
       WHERE record_status = 'active' AND visibility = 'public'
         AND country_id IS NOT NULL
       GROUP BY country_id
       ORDER BY playerCount DESC, country_id ASC
       LIMIT 200`,
    );
    const [trialRows] = await this.executor.execute(
      `SELECT COUNT(*) AS countValue FROM time_trial_publications
       WHERE publication_status = 'published'`,
    );
    const [tournamentRows] = await this.executor.execute(
      `SELECT COUNT(*) AS countValue FROM tournament_publications
       WHERE publication_status = 'published' AND public_visibility = 'public'`,
    );
    const count = (rows: unknown): number => {
      const value = Number((rows as readonly CountRow[])[0]?.countValue);
      return Number.isSafeInteger(value) && value >= 0 ? value : 0;
    };
    const countries: CommunityCountry[] = [];
    for (const row of countryRows as readonly CountryRow[]) {
      const players = Number(row.playerCount);
      if (typeof row.countryId === "string" &&
          /^country\.[a-z0-9_]+$/.test(row.countryId) &&
          Number.isSafeInteger(players) && players > 0) {
        countries.push({ countryId: row.countryId, players });
      }
    }
    return {
      players: count(playerRows),
      countries,
      publishedTimeTrials: count(trialRows),
      tournaments: count(tournamentRows),
    };
  }
}
