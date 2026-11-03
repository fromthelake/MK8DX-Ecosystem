import { describe, expect, it, vi } from "vitest";
import { SocialGroupError, SocialGroupService, type SocialGroupRepository } from "../src/social/social-group-service.js";

const repository = (): SocialGroupRepository => ({
  listMine: vi.fn(async () => ({ groups: [], rankScope: { global: true, rivals: false, groupIds: [] } })),
  create: vi.fn(async () => true), invite: vi.fn(async () => true), respond: vi.fn(async () => true),
  leave: vi.fn(async () => true), removeMember: vi.fn(async () => true), setRole: vi.fn(async () => true),
  archive: vi.fn(async () => true), saveRankScope: vi.fn(async () => true),
});
const actor = { role: "account", userAccountId: "user_account.owner" } as const;

describe("private social Groups", () => {
  it("creates an owner Group and validates persisted union scopes", async () => {
    const repo = repository(), service = new SocialGroupService(repo, () => "social_group.12345678", () => 42);
    await expect(service.create(actor, "  Fast   Friends ")).resolves.toBe("social_group.12345678");
    expect(repo.create).toHaveBeenCalledWith(actor.userAccountId, "social_group.12345678", "Fast Friends", 42);
    await service.saveRankScope(actor, { global: false, rivals: true, groupIds: ["social_group.12345678"] });
    expect(repo.saveRankScope).toHaveBeenCalled();
  });

  it("requires acceptance and prevents empty or duplicate scope selections", async () => {
    const service = new SocialGroupService(repository(), () => "social_group.12345678");
    await expect(service.saveRankScope(actor, { global: false, rivals: false, groupIds: [] })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(service.saveRankScope(actor, { global: false, rivals: false, groupIds: ["social_group.12345678", "social_group.12345678"] })).rejects.toBeInstanceOf(SocialGroupError);
  });
});
