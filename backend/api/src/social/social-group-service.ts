import type { ActorContext } from "../identity/types.js";

export type SocialGroupRole = "owner" | "admin" | "member";
export type SocialGroupMember = Readonly<{
  playerId: string; displayName: string; role: SocialGroupRole; status: "invited" | "active";
}>;
export type SocialGroupView = Readonly<{
  groupId: string; name: string; myRole: SocialGroupRole; myStatus: "invited" | "active";
  members: readonly SocialGroupMember[];
}>;
export type RankScopePreference = Readonly<{
  global: boolean; rivals: boolean; groupIds: readonly string[];
}>;
export type SocialGroupsDocument = Readonly<{
  groups: readonly SocialGroupView[]; rankScope: RankScopePreference;
}>;

export class SocialGroupError extends Error {
  public constructor(public readonly code: "invalid_input" | "not_authenticated" | "not_found" | "not_allowed" | "unavailable") {
    super("The social group action could not be completed."); this.name = "SocialGroupError";
  }
}

export interface SocialGroupRepository {
  listMine(userAccountId: string): Promise<SocialGroupsDocument>;
  create(userAccountId: string, groupId: string, name: string, nowMs: number): Promise<boolean>;
  invite(userAccountId: string, groupId: string, playerId: string, nowMs: number): Promise<boolean>;
  respond(userAccountId: string, groupId: string, accept: boolean, nowMs: number): Promise<boolean>;
  leave(userAccountId: string, groupId: string, nowMs: number): Promise<boolean>;
  removeMember(userAccountId: string, groupId: string, playerId: string, nowMs: number): Promise<boolean>;
  setRole(userAccountId: string, groupId: string, playerId: string, role: "admin" | "member", nowMs: number): Promise<boolean>;
  archive(userAccountId: string, groupId: string, nowMs: number): Promise<boolean>;
  saveRankScope(userAccountId: string, preference: RankScopePreference, nowMs: number): Promise<boolean>;
}

const groupIdPattern = /^social_group\.[a-z0-9-]{8,64}$/;
const playerIdPattern = /^player\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

export class SocialGroupService {
  public constructor(
    private readonly repository: SocialGroupRepository,
    private readonly newGroupId: () => string,
    private readonly now: () => number = () => Date.now(),
  ) {}
  private account(actor: ActorContext): string {
    if (actor.role !== "account" && actor.role !== "administrator") throw new SocialGroupError("not_authenticated");
    return actor.userAccountId;
  }
  private async action(work: () => Promise<boolean>): Promise<void> {
    let changed: boolean;
    try { changed = await work(); } catch { throw new SocialGroupError("unavailable"); }
    if (!changed) throw new SocialGroupError("not_allowed");
  }
  public async listMine(actor: ActorContext): Promise<SocialGroupsDocument> {
    try { return await this.repository.listMine(this.account(actor)); } catch (error) {
      if (error instanceof SocialGroupError) throw error; throw new SocialGroupError("unavailable");
    }
  }
  public async create(actor: ActorContext, name: string): Promise<string> {
    const account = this.account(actor), normalized = name.trim().replace(/\s+/g, " ");
    if (normalized.length < 2 || normalized.length > 80) throw new SocialGroupError("invalid_input");
    const groupId = this.newGroupId(); if (!groupIdPattern.test(groupId)) throw new SocialGroupError("unavailable");
    await this.action(() => this.repository.create(account, groupId, normalized, this.now())); return groupId;
  }
  public async invite(actor: ActorContext, groupId: string, playerId: string): Promise<void> {
    if (!groupIdPattern.test(groupId) || !playerIdPattern.test(playerId)) throw new SocialGroupError("invalid_input");
    const account = this.account(actor); await this.action(() => this.repository.invite(account, groupId, playerId, this.now()));
  }
  public async respond(actor: ActorContext, groupId: string, accept: boolean): Promise<void> {
    if (!groupIdPattern.test(groupId)) throw new SocialGroupError("invalid_input");
    const account = this.account(actor); await this.action(() => this.repository.respond(account, groupId, accept, this.now()));
  }
  public async leave(actor: ActorContext, groupId: string): Promise<void> {
    if (!groupIdPattern.test(groupId)) throw new SocialGroupError("invalid_input");
    const account = this.account(actor); await this.action(() => this.repository.leave(account, groupId, this.now()));
  }
  public async removeMember(actor: ActorContext, groupId: string, playerId: string): Promise<void> {
    if (!groupIdPattern.test(groupId) || !playerIdPattern.test(playerId)) throw new SocialGroupError("invalid_input");
    const account = this.account(actor); await this.action(() => this.repository.removeMember(account, groupId, playerId, this.now()));
  }
  public async setRole(actor: ActorContext, groupId: string, playerId: string, role: "admin" | "member"): Promise<void> {
    if (!groupIdPattern.test(groupId) || !playerIdPattern.test(playerId) || !["admin", "member"].includes(role)) throw new SocialGroupError("invalid_input");
    const account = this.account(actor); await this.action(() => this.repository.setRole(account, groupId, playerId, role, this.now()));
  }
  public async archive(actor: ActorContext, groupId: string): Promise<void> {
    if (!groupIdPattern.test(groupId)) throw new SocialGroupError("invalid_input");
    const account = this.account(actor); await this.action(() => this.repository.archive(account, groupId, this.now()));
  }
  public async saveRankScope(actor: ActorContext, preference: RankScopePreference): Promise<void> {
    if ((!preference.global && !preference.rivals && preference.groupIds.length === 0) || preference.groupIds.length > 20 ||
      new Set(preference.groupIds).size !== preference.groupIds.length || preference.groupIds.some((id) => !groupIdPattern.test(id))) throw new SocialGroupError("invalid_input");
    const account = this.account(actor); await this.action(() => this.repository.saveRankScope(account, preference, this.now()));
  }
}
