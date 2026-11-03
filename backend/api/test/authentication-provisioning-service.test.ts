import { describe, expect, it } from "vitest";

import {
  AuthenticationProvisioningError,
  AuthenticationProvisioningService,
  type AuthenticationBindingSnapshot,
  type AuthenticationProvisioningDecision,
  type AuthenticationProvisioningTransaction,
  type CreateAuthenticationAccountInput,
  type CreateAuthenticationBindingInput,
} from "../src/authentication/authentication-provisioning-service.js";
import type { VerifiedAuthenticationSubject } from
  "../src/authentication/authentication-binding-resolver.js";

const subject: VerifiedAuthenticationSubject = {
  issuerKey: "synthetic_issuer",
  lookupKeyVersion: "lookup_key_v1",
  subjectLookupHmac: new Uint8Array(32).fill(19),
};

class SyntheticTransaction implements AuthenticationProvisioningTransaction {
  existing: AuthenticationBindingSnapshot | null = null;
  accountStatus: "active" | "suspended" | "closed" | null = "active";
  readonly accountCreates: CreateAuthenticationAccountInput[] = [];
  readonly bindingCreates: CreateAuthenticationBindingInput[] = [];

  async findActiveBindingForUpdate(): Promise<AuthenticationBindingSnapshot | null> {
    return this.existing;
  }

  async findUserAccountStatusForUpdate(): Promise<
    "active" | "suspended" | "closed" | null
  > {
    return this.accountStatus;
  }

  async createUserAccount(input: CreateAuthenticationAccountInput): Promise<void> {
    this.accountCreates.push(input);
  }

  async createAuthenticationBinding(
    input: CreateAuthenticationBindingInput,
  ): Promise<void> {
    this.bindingCreates.push(input);
  }
}

function harness(
  decision: AuthenticationProvisioningDecision,
  transaction = new SyntheticTransaction(),
) {
  let transactions = 0;
  const service = new AuthenticationProvisioningService(
    {
      async transaction<T>(
        work: (candidate: AuthenticationProvisioningTransaction) => Promise<T>,
      ): Promise<T> {
        transactions += 1;
        return work(transaction);
      },
    },
    { decide: async () => decision },
    {
      newUserAccountId: () => "user_account.synthetic_provisioned_01",
      newAuthenticationBindingId: () =>
        "restricted_auth_binding.synthetic_provisioned_01",
    },
    { nowMs: () => 2_100_000_000_000 },
    "authentication_provisioner.synthetic_test",
  );
  return { service, transaction, get transactions() { return transactions; } };
}

describe("authentication provisioning service", () => {
  it("creates only a private account boundary and first binding after policy approval", async () => {
    const { service, transaction } = harness({ action: "create_account" });

    await expect(service.provision(subject)).resolves.toEqual({
      authenticationBindingId: "restricted_auth_binding.synthetic_provisioned_01",
      userAccountId: "user_account.synthetic_provisioned_01",
      accountCreated: true,
      bindingCreated: true,
    });
    expect(transaction.accountCreates).toEqual([
      {
        userAccountId: "user_account.synthetic_provisioned_01",
        createdAtMs: 2_100_000_000_000,
      },
    ]);
    expect(transaction.bindingCreates).toEqual([
      {
        authenticationBindingId: "restricted_auth_binding.synthetic_provisioned_01",
        userAccountId: "user_account.synthetic_provisioned_01",
        subject,
        provisionerReference: "authentication_provisioner.synthetic_test",
        createdAtMs: 2_100_000_000_000,
      },
    ]);
    expect(JSON.stringify(transaction)).not.toMatch(/player|claim/i);
  });

  it("links a verified subject only to the exact active account selected by policy", async () => {
    const { service, transaction } = harness({
      action: "link_account",
      userAccountId: "user_account.synthetic_existing_01",
    });

    await expect(service.provision(subject)).resolves.toMatchObject({
      userAccountId: "user_account.synthetic_existing_01",
      accountCreated: false,
      bindingCreated: true,
    });
    expect(transaction.accountCreates).toHaveLength(0);
    expect(transaction.bindingCreates[0]?.userAccountId).toBe(
      "user_account.synthetic_existing_01",
    );
  });

  it("is idempotent for an active binding and never silently reassigns it", async () => {
    const transaction = new SyntheticTransaction();
    transaction.existing = {
      authenticationBindingId: "restricted_auth_binding.synthetic_existing_01",
      userAccountId: "user_account.synthetic_existing_01",
      accountStatus: "active",
    };
    const same = harness(
      {
        action: "link_account",
        userAccountId: "user_account.synthetic_existing_01",
      },
      transaction,
    );
    await expect(same.service.provision(subject)).resolves.toEqual({
      authenticationBindingId: "restricted_auth_binding.synthetic_existing_01",
      userAccountId: "user_account.synthetic_existing_01",
      accountCreated: false,
      bindingCreated: false,
    });

    const other = harness(
      {
        action: "link_account",
        userAccountId: "user_account.synthetic_other_01",
      },
      transaction,
    );
    await expect(other.service.provision(subject)).rejects.toMatchObject({
      code: "conflict",
    });
    expect(transaction.accountCreates).toHaveLength(0);
    expect(transaction.bindingCreates).toHaveLength(0);
  });

  it("rejects denied, malformed, missing, and inactive targets before mutation", async () => {
    const denied = harness({ action: "deny" });
    await expect(denied.service.provision(subject)).rejects.toBeInstanceOf(
      AuthenticationProvisioningError,
    );
    expect(denied.transactions).toBe(0);

    const malformed = harness({ action: "create_account" });
    await expect(
      malformed.service.provision({
        ...subject,
        subjectLookupHmac: new Uint8Array(31),
      }),
    ).rejects.toMatchObject({ code: "invalid_input" });
    expect(malformed.transactions).toBe(0);

    for (const status of [null, "suspended"] as const) {
      const target = harness({
        action: "link_account",
        userAccountId: "user_account.synthetic_target_01",
      });
      target.transaction.accountStatus = status;
      await expect(target.service.provision(subject)).rejects.toMatchObject({
        code: status === null ? "not_found" : "conflict",
      });
      expect(target.transaction.bindingCreates).toHaveLength(0);
    }
  });
});
