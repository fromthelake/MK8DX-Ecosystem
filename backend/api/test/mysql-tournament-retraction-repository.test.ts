import { describe, expect, it } from "vitest";
import type { FieldPacket, QueryResult, ResultSetHeader } from "mysql2";
import type { Pool, PoolConnection } from "mysql2/promise";

import { MysqlTournamentRetractionRepository } from
  "../src/tournaments/mysql-tournament-retraction-repository.js";

class SyntheticConnection {
  readonly calls: { sql: string; values: unknown[] }[] = [];
  committed = 0;
  rolledBack = 0;
  released = 0;

  public constructor(private readonly results: QueryResult[]) {}

  async beginTransaction(): Promise<void> {}
  async commit(): Promise<void> { this.committed += 1; }
  async rollback(): Promise<void> { this.rolledBack += 1; }
  release(): void { this.released += 1; }

  async execute<T extends QueryResult>(sql: string, values?: unknown[]): Promise<[T, FieldPacket[]]> {
    this.calls.push({ sql, values: values ?? [] });
    const result = this.results.shift();
    if (result === undefined) { throw new Error("synthetic connection has no queued result"); }
    return [result as T, []];
  }
}

const header = { affectedRows: 1 } as ResultSetHeader;

describe("MysqlTournamentRetractionRepository", () => {
  it("uses the canonical publication_revision column and returns a JSON-safe revision", async () => {
    const connection = new SyntheticConnection([
      [{
        public_id: "tournament.synthetic",
        lifecycle_status: "active",
        public_results: 1,
        affects_rating: 1,
        retraction_rating_epoch_id: null,
        publication_public_id: "tournament_publication.synthetic",
        publication_revision: "3",
        publication_status: "published",
      }] as never,
      header,
      header,
      header,
    ]);
    const repository = new MysqlTournamentRetractionRepository({
      getConnection: async () => connection as unknown as PoolConnection,
    } as unknown as Pool);

    const state = await repository.prepareRetraction({
      tournamentId: "tournament.synthetic",
      actorUserAccountId: "user_account.admin",
      reason: "Synthetic cleanup",
      nowMs: 1_900_000_000_000,
    });

    expect(connection.calls[0]?.sql).toContain(
      "p.publication_revision AS publication_revision",
    );
    expect(state?.publicationRevision).toBe(3);
    expect(connection.committed).toBe(1);
    expect(connection.rolledBack).toBe(0);
    expect(connection.released).toBe(1);
  });
});
