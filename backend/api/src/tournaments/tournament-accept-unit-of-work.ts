import type { Pool, PoolConnection } from "mysql2/promise";

import type {
  ConnectedRaceResultService,
  ConnectedTournamentOperationService,
  TournamentConnectedRepository,
} from "./tournament-connected-service.js";

/**
 * The collaborators one Accept needs, all of them writing through the same
 * transaction.
 *
 * Accepting a pending contribution is several canonical writes: the race
 * result and its placements, the group attachment, the Tournament revision and
 * lifecycle entry, and the pending record's own state change. Each of those
 * lives behind a different repository, and each repository used to open a
 * transaction of its own. That made Accept a sequence of independent commits,
 * so a refusal partway through - the commonest being an imported race that
 * lists a Player who is not a member of the group - left the race result
 * already written, with no group, and a pending record that could never be
 * accepted afterwards because its race result id was taken.
 *
 * A scope hands out repositories bound to one connection, so every write in an
 * Accept commits together or not at all.
 */
export interface TournamentAcceptScope {
  repository: TournamentConnectedRepository;
  raceResults: ConnectedRaceResultService;
  operations: ConnectedTournamentOperationService;
}

export interface TournamentAcceptUnitOfWork {
  run<T>(work: (scope: TournamentAcceptScope) => Promise<T>): Promise<T>;
}

/**
 * A unit of work for tests and for callers that deliberately hold no
 * transaction: it hands out the collaborators it was given and runs the work
 * against them directly. It is honest about being non-transactional, which is
 * why it is named for what it does rather than for what it replaces.
 */
export function directTournamentAcceptUnitOfWork(
  scope: TournamentAcceptScope,
): TournamentAcceptUnitOfWork {
  return { run: (work) => work(scope) };
}

/**
 * Leases one connection, begins one transaction, and builds every collaborator
 * against it. On any failure the whole Accept rolls back, leaving canonical
 * state observationally identical to before the attempt.
 */
export class MysqlTournamentAcceptUnitOfWork implements TournamentAcceptUnitOfWork {
  public constructor(
    private readonly pool: Pool,
    private readonly bind: (connection: PoolConnection) => TournamentAcceptScope,
  ) {}

  public async run<T>(work: (scope: TournamentAcceptScope) => Promise<T>): Promise<T> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const result = await work(this.bind(connection));
      await connection.commit();
      return result;
    } catch (error) {
      try { await connection.rollback(); } catch { /* the original error wins */ }
      throw error;
    } finally {
      connection.release();
    }
  }
}
