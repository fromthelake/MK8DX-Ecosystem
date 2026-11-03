import { describe, expect, it, vi } from "vitest";
import { TournamentOperatorCapabilityError, TournamentOperatorCapabilityService } from "../src/tournaments/tournament-operator-capability-service.js";

describe("Tournament operator capability", () => {
  it("allows only an administrator to create an audited named grant", async () => {
    const repository = { has: vi.fn(async()=>false), list: vi.fn(async()=>[]), grant: vi.fn(async(input:any)=>({grantId:input.grantId,userAccountId:input.userAccountId,status:"active" as const,revision:1,grantedAtMs:input.occurredAtMs})), revoke: vi.fn() };
    const service = new TournamentOperatorCapabilityService(repository, { newGrantId:()=>"account_capability_grant.synthetic_operator" }, { nowMs:()=>42 });
    await expect(service.grant({role:"account",userAccountId:"user_account.ben"} as never,"user_account.evan","owner_approved_operator")).rejects.toBeInstanceOf(TournamentOperatorCapabilityError);
    await expect(service.grant({role:"administrator",userAccountId:"user_account.ben"} as never,"user_account.evan","owner_approved_operator")).resolves.toMatchObject({userAccountId:"user_account.evan",status:"active"});
    expect(repository.grant).toHaveBeenCalledWith(expect.objectContaining({actorUserAccountId:"user_account.ben",reasonCode:"owner_approved_operator"}));
  });
});
