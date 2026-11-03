import { describe, expect, it } from "vitest";

import { decideAdministratorRecovery } from "../src/administration/administrator-recovery-main.js";

const bootstrap = { userAccountId: "user_account.synthetic_first", origin: "bootstrap_cli",
  status: "active", accountStatus: "active" };
const target = "user_account.synthetic_second";

describe("operator administrator recovery decision", () => {
  it("requires an active bootstrap grant and uses the existing administrator actor", () => {
    expect(decideAdministratorRecovery([bootstrap], target)).toEqual({
      action: "grant", actorAccountId: bootstrap.userAccountId,
    });
    expect(decideAdministratorRecovery([bootstrap], bootstrap.userAccountId).action).toBe("unchanged");
    expect(() => decideAdministratorRecovery([], target)).toThrow();
    expect(() => decideAdministratorRecovery([{ ...bootstrap, status: "revoked" }], target)).toThrow();
    expect(() => decideAdministratorRecovery([{ ...bootstrap, accountStatus: "suspended" }], target)).toThrow();
  });

  it("allows only a repeat of the same recovered account after use", () => {
    const recovered = { userAccountId: target, origin: "administrator",
      status: "active", accountStatus: "active" };
    expect(decideAdministratorRecovery([bootstrap, recovered], target).action).toBe("unchanged");
    expect(() => decideAdministratorRecovery([bootstrap, recovered], "user_account.third")).toThrow();
    expect(() => decideAdministratorRecovery([bootstrap, { ...recovered, status: "revoked" }], target)).toThrow();
  });
});
