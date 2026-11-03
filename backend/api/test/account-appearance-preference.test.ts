import { describe, expect, it } from "vitest";

import {
  AccountAppearancePreferenceService,
  isAppearanceChoice,
  type AppearanceChoice,
} from "../src/profiles/account-appearance-preference.js";
import type { ActorContext } from "../src/identity/types.js";

const actor: ActorContext = { role: "account", userAccountId: "user_account.ben" };
const visitor = { role: "anonymous" } as unknown as ActorContext;

function service(initial: AppearanceChoice | null, options: { stored?: boolean } = {}) {
  let value = initial;
  const writes: { choice: AppearanceChoice; at: number }[] = [];
  const instance = new AccountAppearancePreferenceService({
    async read() { return value; },
    async update(_id, choice, nowMs) {
      writes.push({ choice, at: nowMs });
      if (options.stored === false) { return false; }
      value = choice;
      return true;
    },
  }, () => 4_242);
  return { instance, writes, current: () => value };
}

describe("the account appearance choice (ADR-0205)", () => {
  it("answers null for an account that never chose, and never writes on a read", async () => {
    const { instance, writes } = service(null);
    expect(await instance.readMine(actor)).toBeNull();
    expect(writes).toEqual([]);
  });

  it("stores exactly the three choices and stamps the write", async () => {
    const { instance, writes, current } = service(null);
    expect(await instance.updateMine(actor, "light")).toBe("light");
    expect(current()).toBe("light");
    expect(await instance.updateMine(actor, "system")).toBe("system");
    expect(writes).toEqual([
      { choice: "light", at: 4_242 },
      { choice: "system", at: 4_242 },
    ]);
  });

  it("rejects anything that is not a choice, including a resolved mode", async () => {
    const { instance, writes } = service(null);
    for (const bad of ["hc", "Dark", "", null, 1, "auto"]) {
      await expect(instance.updateMine(actor, bad)).rejects.toMatchObject({ code: "invalid_input" });
    }
    expect(writes).toEqual([]);
  });

  it("needs an account: a visitor can neither read nor write", async () => {
    const { instance } = service("dark");
    await expect(instance.readMine(visitor)).rejects.toMatchObject({ code: "not_authenticated" });
    await expect(instance.updateMine(visitor, "dark")).rejects.toMatchObject({ code: "not_authenticated" });
  });

  it("reports a write that matched no active account as not authenticated", async () => {
    const { instance } = service(null, { stored: false });
    await expect(instance.updateMine(actor, "dark")).rejects.toMatchObject({ code: "not_authenticated" });
  });

  it("turns a repository failure into an unavailable answer, not a wrong one", async () => {
    const failing = new AccountAppearancePreferenceService({
      async read() { throw new Error("pool"); },
      async update() { throw new Error("pool"); },
    });
    await expect(failing.readMine(actor)).rejects.toMatchObject({ code: "unavailable" });
    await expect(failing.updateMine(actor, "light")).rejects.toMatchObject({ code: "unavailable" });
  });

  it("recognises only the stored vocabulary", () => {
    expect(["system", "light", "dark"].every(isAppearanceChoice)).toBe(true);
    expect(isAppearanceChoice("hc")).toBe(false);
    expect(isAppearanceChoice(undefined)).toBe(false);
  });
});
