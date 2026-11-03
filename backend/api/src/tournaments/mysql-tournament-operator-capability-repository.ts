import type { Pool, PoolConnection } from "mysql2/promise";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { TOURNAMENT_OPERATION_CAPABILITY, TournamentOperatorCapabilityError, type TournamentOperatorCapabilityRepository, type TournamentOperatorGrant } from "./tournament-operator-capability-service.js";

interface GrantRow extends RowDataPacket { accountCapabilityGrantId: number; grantId: string; userAccountId: string; grantStatus: "active" | "revoked"; revision: number | string; grantedAtMs: number | string; revokedAtMs: number | string | null }
const snapshot = (row: GrantRow): TournamentOperatorGrant => ({ grantId: row.grantId, userAccountId: row.userAccountId, status: row.grantStatus, revision: Number(row.revision), grantedAtMs: Number(row.grantedAtMs), ...(row.revokedAtMs === null ? {} : { revokedAtMs: Number(row.revokedAtMs) }) });

/**
 * The one way a tournament.operation grant is written: the grant row and its first lifecycle event,
 * inside the caller's transaction. An approved Director host request (ADR-0220) uses it too, so the
 * grant it creates is the same audited grant an administrator gives by hand.
 */
export async function insertTournamentOperationGrant(
  connection: PoolConnection,
  input: Readonly<{ grantId: string; userAccountId: string; actorUserAccountId: string; reasonCode: string; occurredAtMs: number }>,
): Promise<Readonly<{ grantInternalId: number; grant: TournamentOperatorGrant }>> {
  const [accounts] = await connection.execute<RowDataPacket[]>(`SELECT user_account_id FROM user_accounts WHERE public_id=? AND account_status='active' LIMIT 1 FOR UPDATE`, [input.userAccountId]); if (accounts.length !== 1) throw new TournamentOperatorCapabilityError("not_found", "UserAccount not found");
  const [result] = await connection.execute<ResultSetHeader>(`INSERT INTO account_capability_grants (public_id,revision,user_account_id,capability_code,grant_status,granted_by_user_account_id,granted_at_ms,revoked_at_ms,updated_at_ms) SELECT ?,1,subject.user_account_id,?,'active',actor.user_account_id,?,NULL,? FROM user_accounts subject INNER JOIN user_accounts actor WHERE subject.public_id=? AND actor.public_id=?`, [input.grantId, TOURNAMENT_OPERATION_CAPABILITY, input.occurredAtMs, input.occurredAtMs, input.userAccountId, input.actorUserAccountId]); if (result.affectedRows !== 1) throw new TournamentOperatorCapabilityError("conflict", "grant was not created");
  await connection.execute(`INSERT INTO account_capability_grant_lifecycle (account_capability_grant_id,sequence_number,event_type,actor_user_account_id,grant_status_after,reason_code,occurred_at_ms) SELECT ?,1,'granted',user_account_id,'active',?,? FROM user_accounts WHERE public_id=?`, [result.insertId, input.reasonCode, input.occurredAtMs, input.actorUserAccountId]);
  return {
    grantInternalId: Number(result.insertId),
    grant: { grantId: input.grantId, userAccountId: input.userAccountId, status: "active", revision: 1, grantedAtMs: input.occurredAtMs },
  };
}

export class MysqlTournamentOperatorCapabilityRepository implements TournamentOperatorCapabilityRepository {
  public constructor(private readonly pool: Pool) {}
  public async has(userAccountId: string): Promise<boolean> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(`SELECT 1 FROM account_capability_grants grant_record INNER JOIN user_accounts account ON account.user_account_id=grant_record.user_account_id WHERE account.public_id=? AND account.account_status='active' AND grant_record.capability_code=? AND grant_record.grant_status='active' LIMIT 1`, [userAccountId, TOURNAMENT_OPERATION_CAPABILITY]); return rows.length === 1;
  }
  public async list(): Promise<readonly TournamentOperatorGrant[]> {
    const [rows] = await this.pool.execute<GrantRow[]>(`SELECT grant_record.account_capability_grant_id AS accountCapabilityGrantId, grant_record.public_id AS grantId, account.public_id AS userAccountId, grant_record.grant_status AS grantStatus, grant_record.revision, grant_record.granted_at_ms AS grantedAtMs, grant_record.revoked_at_ms AS revokedAtMs FROM account_capability_grants grant_record INNER JOIN user_accounts account ON account.user_account_id=grant_record.user_account_id WHERE grant_record.capability_code=? AND grant_record.grant_status='active' ORDER BY grant_record.granted_at_ms`, [TOURNAMENT_OPERATION_CAPABILITY]); return rows.map(snapshot);
  }
  public grant(input: Parameters<TournamentOperatorCapabilityRepository["grant"]>[0]): Promise<TournamentOperatorGrant> {
    return this.transaction(async (connection) => (await insertTournamentOperationGrant(connection, input)).grant);
  }
  public revoke(input: Parameters<TournamentOperatorCapabilityRepository["revoke"]>[0]): Promise<TournamentOperatorGrant> { return this.transaction(async (connection) => {
    const [rows] = await connection.execute<GrantRow[]>(`SELECT grant_record.account_capability_grant_id AS accountCapabilityGrantId,grant_record.public_id AS grantId,account.public_id AS userAccountId,grant_record.grant_status AS grantStatus,grant_record.revision,grant_record.granted_at_ms AS grantedAtMs,grant_record.revoked_at_ms AS revokedAtMs FROM account_capability_grants grant_record INNER JOIN user_accounts account ON account.user_account_id=grant_record.user_account_id WHERE account.public_id=? AND grant_record.capability_code=? AND grant_record.grant_status='active' LIMIT 1 FOR UPDATE`, [input.userAccountId, TOURNAMENT_OPERATION_CAPABILITY]); const current=rows[0]; if (!current) throw new TournamentOperatorCapabilityError("not_found", "active capability not found"); const revision=Number(current.revision);
    await connection.execute(`UPDATE account_capability_grants SET grant_status='revoked',revision=revision+1,revoked_at_ms=?,updated_at_ms=? WHERE account_capability_grant_id=? AND revision=?`, [input.occurredAtMs,input.occurredAtMs,current.accountCapabilityGrantId,revision]); await connection.execute(`INSERT INTO account_capability_grant_lifecycle (account_capability_grant_id,sequence_number,event_type,actor_user_account_id,grant_status_after,reason_code,occurred_at_ms) SELECT ?,?,'revoked',user_account_id,'revoked',?,? FROM user_accounts WHERE public_id=?`, [current.accountCapabilityGrantId,revision+1,input.reasonCode,input.occurredAtMs,input.actorUserAccountId]); return {...snapshot(current),status:"revoked",revision:revision+1,revokedAtMs:input.occurredAtMs};
  }); }
  private async transaction<T>(work:(connection:PoolConnection)=>Promise<T>):Promise<T>{ const connection=await this.pool.getConnection(); try{await connection.beginTransaction();const value=await work(connection);await connection.commit();return value;}catch(error){await connection.rollback();if(error instanceof TournamentOperatorCapabilityError)throw error;throw new TournamentOperatorCapabilityError("conflict","capability persistence failed");}finally{connection.release();}}
}
