import { describe, expect, it } from "vitest";

import {
  AuthenticationBindingLifecycleError,
  AuthenticationBindingLifecycleService,
  type AppendAuthenticationBindingLifecycleInput,
  type AuthenticationBindingLifecycleSnapshot,
  type AuthenticationBindingLifecycleTransaction,
} from "../src/authentication/authentication-binding-lifecycle-service.js";

class SyntheticTransaction implements AuthenticationBindingLifecycleTransaction {
  administratorStatus: "active" | "suspended" | "closed" | null = "active";
  binding: AuthenticationBindingLifecycleSnapshot | null = {
    authenticationBindingId: "restricted_auth_binding.synthetic_lifecycle_01",
    userAccountId: "user_account.synthetic_owner_01",
    bindingStatus: "active",
    revision: 1,
    lastSequence: 1,
    updatedAtMs: 10,
  };
  readonly appends: AppendAuthenticationBindingLifecycleInput[] = [];

  async findUserAccountStatusForUpdate() { return this.administratorStatus; }
  async findAuthenticationBindingForUpdate() { return this.binding; }
  async appendAuthenticationBindingLifecycle(
    input: AppendAuthenticationBindingLifecycleInput,
  ) { this.appends.push(input); }
}

function harness(transaction = new SyntheticTransaction()) {
  let transactions = 0;
  const service = new AuthenticationBindingLifecycleService(
    {
      async transaction<T>(
        work: (candidate: AuthenticationBindingLifecycleTransaction) => Promise<T>,
      ): Promise<T> {
        transactions += 1;
        return work(transaction);
      },
    },
    { nowMs: () => 2_200_000_000_000 },
  );
  return { service, transaction, get transactions() { return transactions; } };
}

const administrator = {
  role: "administrator",
  userAccountId: "user_account.synthetic_admin_01",
} as const;

describe("authentication binding lifecycle service", () => {
  it.each([
    ["release", "released", "binding_released"],
    ["revoke", "revoked", "binding_revoked"],
  ] as const)("ends an active binding through administrator %s", async (
    action,
    bindingStatus,
    eventType,
  ) => {
    const { service, transaction } = harness();
    await expect(
      service.endBinding(administrator, {
        authenticationBindingId: "restricted_auth_binding.synthetic_lifecycle_01",
        expectedRevision: 1,
        action,
        reasonCode: "administrator_security_review",
      }),
    ).resolves.toEqual({
      authenticationBindingId: "restricted_auth_binding.synthetic_lifecycle_01",
      userAccountId: "user_account.synthetic_owner_01",
      bindingStatus,
      revision: 2,
      lastSequence: 2,
      updatedAtMs: 2_200_000_000_000,
    });
    expect(transaction.appends).toEqual([
      {
        authenticationBindingId: "restricted_auth_binding.synthetic_lifecycle_01",
        expectedRevision: 1,
        nextSnapshot: expect.objectContaining({ bindingStatus, revision: 2 }),
        event: {
          sequence: 2,
          eventType,
          actorUserAccountId: "user_account.synthetic_admin_01",
          reasonCode: "administrator_security_review",
          occurredAtMs: 2_200_000_000_000,
        },
      },
    ]);
  });

  it("rejects non-administrators and malformed commands before persistence", async () => {
    const invalidActors = [
      { role: "anonymous" },
      { role: "account", userAccountId: "user_account.synthetic_owner_01" },
      { role: "migration_operator" },
    ] as const;
    for (const actor of invalidActors) {
      const candidate = harness();
      await expect(
        candidate.service.endBinding(actor, {
          authenticationBindingId: "restricted_auth_binding.synthetic_lifecycle_01",
          expectedRevision: 1,
          action: "revoke",
          reasonCode: "security_review",
        }),
      ).rejects.toMatchObject({ code: "forbidden" });
      expect(candidate.transactions).toBe(0);
    }
    const malformed = harness();
    await expect(
      malformed.service.endBinding(administrator, {
        authenticationBindingId: "restricted_auth_binding.synthetic_lifecycle_01",
        expectedRevision: 1,
        action: "release",
        reasonCode: "raw private detail is not a code",
      }),
    ).rejects.toBeInstanceOf(AuthenticationBindingLifecycleError);
    expect(malformed.transactions).toBe(0);
  });

  it("requires an active administrator and exact expected revision", async () => {
    const inactive = harness();
    inactive.transaction.administratorStatus = "suspended";
    await expect(
      inactive.service.endBinding(administrator, {
        authenticationBindingId: "restricted_auth_binding.synthetic_lifecycle_01",
        expectedRevision: 1,
        action: "revoke",
        reasonCode: "security_review",
      }),
    ).rejects.toMatchObject({ code: "conflict" });

    const stale = harness();
    await expect(
      stale.service.endBinding(administrator, {
        authenticationBindingId: "restricted_auth_binding.synthetic_lifecycle_01",
        expectedRevision: 2,
        action: "release",
        reasonCode: "assisted_rebind",
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(stale.transaction.appends).toHaveLength(0);

    const clockRegression = harness();
    clockRegression.transaction.binding = {
      ...clockRegression.transaction.binding!,
      updatedAtMs: 2_300_000_000_000,
    };
    await expect(
      clockRegression.service.endBinding(administrator, {
        authenticationBindingId: "restricted_auth_binding.synthetic_lifecycle_01",
        expectedRevision: 1,
        action: "revoke",
        reasonCode: "security_review",
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(clockRegression.transaction.appends).toHaveLength(0);
  });

  it("retains ended bindings as immutable lifecycle history", async () => {
    const candidate = harness();
    candidate.transaction.binding = {
      ...candidate.transaction.binding!,
      bindingStatus: "revoked",
      revision: 2,
      lastSequence: 2,
    };
    await expect(
      candidate.service.endBinding(administrator, {
        authenticationBindingId: "restricted_auth_binding.synthetic_lifecycle_01",
        expectedRevision: 2,
        action: "release",
        reasonCode: "assisted_rebind",
      }),
    ).rejects.toMatchObject({ code: "invalid_transition" });
    expect(candidate.transaction.appends).toHaveLength(0);
  });
});
