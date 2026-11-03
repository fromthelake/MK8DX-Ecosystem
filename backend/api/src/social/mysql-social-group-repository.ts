import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import type { RankScopePreference, SocialGroupRepository, SocialGroupsDocument, SocialGroupView } from "./social-group-service.js";

interface GroupRow extends RowDataPacket { groupInternalId: unknown; groupId: unknown; name: unknown; myRole: unknown; myStatus: unknown; }
interface MemberRow extends RowDataPacket { groupInternalId: unknown; playerId: unknown; displayName: unknown; memberRole: unknown; memberStatus: unknown; }
interface ScopeRow extends RowDataPacket { includeGlobal: unknown; includeRivals: unknown; }
interface GroupIdRow extends RowDataPacket { groupId: unknown; }
interface ActorRow extends RowDataPacket { accountInternalId: unknown; playerInternalId: unknown; }

export class MysqlSocialGroupRepository implements SocialGroupRepository {
  public constructor(private readonly pool: Pool) {}
  private async transaction<T>(work: (connection: PoolConnection) => Promise<T>): Promise<T> {
    const connection = await this.pool.getConnection();
    try { await connection.beginTransaction(); const value = await work(connection); await connection.commit(); return value; }
    catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  }
  private async actor(executor: Pool | PoolConnection, publicId: string): Promise<{ accountId: number; playerId: number } | null> {
    const [rows] = await executor.execute<ActorRow[]>(
      `SELECT account.user_account_id AS accountInternalId, claim.player_id AS playerInternalId
       FROM user_accounts account INNER JOIN player_claims claim ON claim.user_account_id=account.user_account_id AND claim.claim_status='verified'
       INNER JOIN players player ON player.player_id=claim.player_id AND player.record_status='active' AND player.player_kind='human'
       WHERE account.public_id=? LIMIT 1`, [publicId]);
    const accountId = Number(rows[0]?.accountInternalId), playerId = Number(rows[0]?.playerInternalId);
    return Number.isSafeInteger(accountId) && Number.isSafeInteger(playerId) ? { accountId, playerId } : null;
  }
  public async listMine(userAccountId: string): Promise<SocialGroupsDocument> {
    const actor = await this.actor(this.pool, userAccountId); if (!actor) return { groups: [], rankScope: { global: true, rivals: false, groupIds: [] } };
    const [groups] = await this.pool.execute<GroupRow[]>(
      `SELECT g.social_group_id groupInternalId,g.public_id groupId,g.name,m.member_role myRole,m.membership_status myStatus
       FROM social_group_memberships m INNER JOIN social_groups g ON g.social_group_id=m.social_group_id AND g.record_status='active'
       WHERE m.player_id=? AND m.membership_status IN ('invited','active') ORDER BY g.name,g.social_group_id`, [actor.playerId]);
    const ids = groups.map((row) => Number(row.groupInternalId)).filter(Number.isSafeInteger);
    const members = new Map<number, SocialGroupView["members"] extends readonly (infer T)[] ? T[] : never>();
    if (ids.length) {
      const [rows] = await this.pool.execute<MemberRow[]>(
        `SELECT m.social_group_id groupInternalId,p.public_id playerId,p.display_name displayName,m.member_role memberRole,m.membership_status memberStatus
         FROM social_group_memberships m INNER JOIN players p ON p.player_id=m.player_id AND p.record_status='active'
         WHERE m.social_group_id IN (${ids.map(() => "?").join(",")}) AND m.membership_status IN ('invited','active')
         ORDER BY FIELD(m.member_role,'owner','admin','member'),p.display_name`, ids);
      for (const row of rows) {
        const id = Number(row.groupInternalId), role = row.memberRole, status = row.memberStatus;
        if (typeof row.playerId !== "string" || typeof row.displayName !== "string" || !["owner","admin","member"].includes(String(role)) || !["invited","active"].includes(String(status))) continue;
        const list = members.get(id) ?? []; list.push({ playerId: row.playerId, displayName: row.displayName, role: role as "owner"|"admin"|"member", status: status as "invited"|"active" }); members.set(id, list);
      }
    }
    const [scopeRows] = await this.pool.execute<ScopeRow[]>(`SELECT include_global includeGlobal,include_rivals includeRivals FROM rank_scope_preferences WHERE user_account_id=?`, [actor.accountId]);
    const [groupRows] = await this.pool.execute<GroupIdRow[]>(
      `SELECT g.public_id groupId FROM rank_scope_group_preferences p INNER JOIN social_groups g ON g.social_group_id=p.social_group_id
       INNER JOIN social_group_memberships m ON m.social_group_id=g.social_group_id AND m.player_id=? AND m.membership_status='active'
       WHERE p.user_account_id=? AND g.record_status='active' ORDER BY g.public_id`, [actor.playerId, actor.accountId]);
    const views: SocialGroupView[] = groups.flatMap((row) => {
      const id = Number(row.groupInternalId);
      return typeof row.groupId === "string" && typeof row.name === "string" && ["owner","admin","member"].includes(String(row.myRole)) && ["invited","active"].includes(String(row.myStatus))
        ? [{ groupId: row.groupId, name: row.name, myRole: row.myRole as "owner"|"admin"|"member", myStatus: row.myStatus as "invited"|"active", members: row.myStatus === "active" ? members.get(id) ?? [] : [] }] : [];
    });
    return { groups: views, rankScope: { global: scopeRows[0] === undefined ? true : Boolean(scopeRows[0].includeGlobal), rivals: Boolean(scopeRows[0]?.includeRivals), groupIds: groupRows.flatMap((row) => typeof row.groupId === "string" ? [row.groupId] : []) } };
  }
  private async notify(connection: PoolConnection, recipientSql: string, params: readonly (string | number | null)[], kind: string, groupId: number, actorId: number, nowMs: number, detail?: string): Promise<void> {
    await connection.execute(
      `INSERT INTO notifications (user_account_id,notification_kind,aggregation_key,actor_player_id,social_group_id,detail,event_count,first_event_at_ms,last_event_at_ms)
       SELECT recipient.user_account_id,?,CONCAT(?, '|', ?, '|', recipient.user_account_id),?,?,?,1,?,? FROM (${recipientSql}) recipient
       ON DUPLICATE KEY UPDATE event_count=event_count+1,last_event_at_ms=VALUES(last_event_at_ms),actor_player_id=VALUES(actor_player_id),detail=VALUES(detail)`,
      [kind, kind, groupId, actorId, groupId, detail ?? null, nowMs, nowMs, ...params]);
  }
  public async create(userAccountId: string, groupId: string, name: string, nowMs: number): Promise<boolean> {
    return this.transaction(async (c) => { const actor = await this.actor(c, userAccountId); if (!actor) return false;
      const [result] = await c.execute<ResultSetHeader>(`INSERT INTO social_groups(public_id,name,created_at_ms,updated_at_ms) VALUES(?,?,?,?)`, [groupId,name,nowMs,nowMs]);
      await c.execute(`INSERT INTO social_group_memberships(social_group_id,player_id,member_role,membership_status,created_at_ms,updated_at_ms) VALUES(?,?,'owner','active',?,?)`, [result.insertId,actor.playerId,nowMs,nowMs]);
      await this.notify(c, `SELECT ? user_account_id`, [actor.accountId], "group_joined", result.insertId, actor.playerId, nowMs, "created"); return true; });
  }
  public async invite(userAccountId: string, groupId: string, playerId: string, nowMs: number): Promise<boolean> {
    return this.transaction(async (c) => { const actor = await this.actor(c,userAccountId); if (!actor) return false;
      const [result] = await c.execute<ResultSetHeader>(
        `INSERT INTO social_group_memberships(social_group_id,player_id,member_role,membership_status,invited_by_player_id,created_at_ms,updated_at_ms)
         SELECT g.social_group_id,target.player_id,'member','invited',?, ?, ? FROM social_groups g
         INNER JOIN social_group_memberships mine ON mine.social_group_id=g.social_group_id AND mine.player_id=? AND mine.membership_status='active' AND mine.member_role IN ('owner','admin')
         INNER JOIN players target ON target.public_id=? AND target.record_status='active' AND target.player_kind='human'
         WHERE g.public_id=? AND g.record_status='active' AND target.player_id<>?
         ON DUPLICATE KEY UPDATE membership_status=IF(membership_status='active','active','invited'),member_role=IF(membership_status='active',member_role,'member'),invited_by_player_id=IF(membership_status='active',invited_by_player_id,VALUES(invited_by_player_id)),updated_at_ms=IF(membership_status='active',updated_at_ms,VALUES(updated_at_ms))`,
        [actor.playerId,nowMs,nowMs,actor.playerId,playerId,groupId,actor.playerId]); if (!result.affectedRows) return false;
      const [g] = await c.execute<RowDataPacket[]>(`SELECT social_group_id id FROM social_groups WHERE public_id=?`,[groupId]); const gid=Number(g[0]?.id);
      await this.notify(c, `SELECT claim.user_account_id FROM player_claims claim INNER JOIN players p ON p.player_id=claim.player_id WHERE claim.claim_status='verified' AND p.public_id=?`, [playerId], "group_invited", gid, actor.playerId, nowMs); return true; });
  }
  public async respond(userAccountId: string, groupId: string, accept: boolean, nowMs: number): Promise<boolean> {
    return this.transaction(async (c) => { const actor=await this.actor(c,userAccountId); if(!actor)return false;
      const [result]=await c.execute<ResultSetHeader>(`UPDATE social_group_memberships m INNER JOIN social_groups g ON g.social_group_id=m.social_group_id SET m.membership_status=?,m.updated_at_ms=? WHERE g.public_id=? AND g.record_status='active' AND m.player_id=? AND m.membership_status='invited'`,[accept?'active':'declined',nowMs,groupId,actor.playerId]); if(!result.affectedRows)return false;
      const [g]=await c.execute<RowDataPacket[]>(`SELECT social_group_id id FROM social_groups WHERE public_id=?`,[groupId]); const gid=Number(g[0]?.id);
      await this.notify(c,`SELECT claim.user_account_id FROM social_group_memberships m INNER JOIN player_claims claim ON claim.player_id=m.player_id AND claim.claim_status='verified' WHERE m.social_group_id=? AND m.membership_status='active' AND m.member_role IN ('owner','admin')`,[gid],accept?'group_joined':'group_left',gid,actor.playerId,nowMs,accept?undefined:'declined'); return true; });
  }
  public async leave(userAccountId:string,groupId:string,nowMs:number):Promise<boolean>{return this.transaction(async(c)=>{const actor=await this.actor(c,userAccountId);if(!actor)return false;const [r]=await c.execute<ResultSetHeader>(`UPDATE social_group_memberships m INNER JOIN social_groups g ON g.social_group_id=m.social_group_id SET m.membership_status='left',m.updated_at_ms=? WHERE g.public_id=? AND m.player_id=? AND m.membership_status='active' AND m.member_role<>'owner'`,[nowMs,groupId,actor.playerId]);if(!r.affectedRows)return false;const [g]=await c.execute<RowDataPacket[]>(`SELECT social_group_id id FROM social_groups WHERE public_id=?`,[groupId]);const gid=Number(g[0]?.id);await this.notify(c,`SELECT claim.user_account_id FROM social_group_memberships m INNER JOIN player_claims claim ON claim.player_id=m.player_id AND claim.claim_status='verified' WHERE m.social_group_id=? AND m.membership_status='active' AND m.member_role IN ('owner','admin')`,[gid],"group_left",gid,actor.playerId,nowMs);return true;});}
  public async removeMember(userAccountId:string,groupId:string,playerId:string,nowMs:number):Promise<boolean>{return this.transaction(async(c)=>{const actor=await this.actor(c,userAccountId);if(!actor)return false;const [r]=await c.execute<ResultSetHeader>(`UPDATE social_group_memberships target INNER JOIN social_groups g ON g.social_group_id=target.social_group_id INNER JOIN social_group_memberships mine ON mine.social_group_id=g.social_group_id AND mine.player_id=? AND mine.membership_status='active' SET target.membership_status='removed',target.updated_at_ms=? WHERE g.public_id=? AND target.player_id=(SELECT player_id FROM players WHERE public_id=?) AND target.member_role='member' AND target.membership_status IN ('active','invited') AND mine.member_role IN ('owner','admin')`,[actor.playerId,nowMs,groupId,playerId]);if(!r.affectedRows)return false;const [g]=await c.execute<RowDataPacket[]>(`SELECT social_group_id id FROM social_groups WHERE public_id=?`,[groupId]);const gid=Number(g[0]?.id);await this.notify(c,`SELECT claim.user_account_id FROM player_claims claim INNER JOIN players p ON p.player_id=claim.player_id WHERE claim.claim_status='verified' AND p.public_id=?`,[playerId],"group_removed",gid,actor.playerId,nowMs);return true;});}
  public async setRole(userAccountId:string,groupId:string,playerId:string,role:"admin"|"member",nowMs:number):Promise<boolean>{return this.transaction(async(c)=>{const actor=await this.actor(c,userAccountId);if(!actor)return false;const [r]=await c.execute<ResultSetHeader>(`UPDATE social_group_memberships target INNER JOIN social_groups g ON g.social_group_id=target.social_group_id INNER JOIN social_group_memberships mine ON mine.social_group_id=g.social_group_id AND mine.player_id=? AND mine.member_role='owner' AND mine.membership_status='active' SET target.member_role=?,target.updated_at_ms=? WHERE g.public_id=? AND target.player_id=(SELECT player_id FROM players WHERE public_id=?) AND target.member_role<>'owner' AND target.membership_status='active'`,[actor.playerId,role,nowMs,groupId,playerId]);if(!r.affectedRows)return false;const [g]=await c.execute<RowDataPacket[]>(`SELECT social_group_id id FROM social_groups WHERE public_id=?`,[groupId]);const gid=Number(g[0]?.id);await this.notify(c,`SELECT claim.user_account_id FROM player_claims claim INNER JOIN players p ON p.player_id=claim.player_id WHERE claim.claim_status='verified' AND p.public_id=?`,[playerId],"group_role_changed",gid,actor.playerId,nowMs,role);return true;});}
  public async archive(userAccountId:string,groupId:string,nowMs:number):Promise<boolean>{return this.transaction(async(c)=>{const actor=await this.actor(c,userAccountId);if(!actor)return false;const [rows]=await c.execute<RowDataPacket[]>(`SELECT g.social_group_id id FROM social_groups g INNER JOIN social_group_memberships m ON m.social_group_id=g.social_group_id AND m.player_id=? AND m.member_role='owner' AND m.membership_status='active' WHERE g.public_id=? AND g.record_status='active' FOR UPDATE`,[actor.playerId,groupId]);const gid=Number(rows[0]?.id);if(!Number.isSafeInteger(gid))return false;await this.notify(c,`SELECT claim.user_account_id FROM social_group_memberships m INNER JOIN player_claims claim ON claim.player_id=m.player_id AND claim.claim_status='verified' WHERE m.social_group_id=? AND m.membership_status='active'`,[gid],"group_removed",gid,actor.playerId,nowMs,"archived");await c.execute(`UPDATE social_groups SET record_status='archived',updated_at_ms=? WHERE social_group_id=?`,[nowMs,gid]);return true;});}
  public async saveRankScope(userAccountId:string,p:RankScopePreference,nowMs:number):Promise<boolean>{return this.transaction(async(c)=>{const actor=await this.actor(c,userAccountId);if(!actor)return false;const [rows]=p.groupIds.length?await c.execute<RowDataPacket[]>(`SELECT g.social_group_id id FROM social_groups g INNER JOIN social_group_memberships m ON m.social_group_id=g.social_group_id AND m.player_id=? AND m.membership_status='active' WHERE g.public_id IN (${p.groupIds.map(()=>"?").join(",")}) AND g.record_status='active'`,[actor.playerId,...p.groupIds]):[[] as RowDataPacket[],[]];if((rows as RowDataPacket[]).length!==p.groupIds.length)return false;await c.execute(`INSERT INTO rank_scope_preferences(user_account_id,include_global,include_rivals,updated_at_ms) VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE include_global=VALUES(include_global),include_rivals=VALUES(include_rivals),updated_at_ms=VALUES(updated_at_ms)`,[actor.accountId,p.global,p.rivals,nowMs]);await c.execute(`DELETE FROM rank_scope_group_preferences WHERE user_account_id=?`,[actor.accountId]);for(const row of rows as RowDataPacket[])await c.execute(`INSERT INTO rank_scope_group_preferences(user_account_id,social_group_id) VALUES(?,?)`,[actor.accountId,Number(row.id)]);return true;});}
}
