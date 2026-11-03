import { describe, expect, it } from "vitest";

import {
  AdministratorGrantService,
  type AdministratorGrantSnapshot,
  type AdministratorGrantWriteRepository,
  type AdministratorGrantWriteTransaction,
  type CreateAdministratorGrantInput,
  type RevokeAdministratorGrantInput,
} from "../src/administration/administrator-grant-service.js";
import type { AccountStatus, ActorContext } from "../src/identity/types.js";

const firstAccount = "user_account.synthetic_first";
const secondAccount = "user_account.synthetic_second";
const administrator: ActorContext = { role: "administrator", userAccountId: firstAccount };

class Store implements AdministratorGrantWriteRepository, AdministratorGrantWriteTransaction {
  readonly accounts = new Map<string, AccountStatus>([
    [firstAccount, "active"],
    [secondAccount, "active"],
  ]);
  readonly grants: AdministratorGrantSnapshot[] = [];
  readonly creations: CreateAdministratorGrantInput[] = [];
  readonly revocations: RevokeAdministratorGrantInput[] = [];
  transactionCount = 0;

  async transaction<T>(work: (transaction: AdministratorGrantWriteTransaction) => Promise<T>): Promise<T> {
    this.transactionCount += 1;
    return work(this);
  }
  async findUserAccountStatus(id: string): Promise<AccountStatus | null> {
    return this.accounts.get(id) ?? null;
  }
  async hasAnyGrantForUpdate(): Promise<boolean> { return this.grants.length > 0; }
  async findActiveGrantForUpdate(id: string): Promise<AdministratorGrantSnapshot | null> {
    return this.grants.find((grant) => grant.userAccountId === id && grant.status === "active") ?? null;
  }
  async countActiveGrantsForUpdate(): Promise<number> {
    return this.grants.filter((grant) => grant.status === "active").length;
  }
  async createGrant(input: CreateAdministratorGrantInput): Promise<void> {
    this.creations.push(input);
    this.grants.push(input.snapshot);
  }
  async revokeGrant(input: RevokeAdministratorGrantInput): Promise<void> {
    this.revocations.push(input);
    const index = this.grants.indexOf(input.current);
    this.grants[index] = {
      ...input.current,
      status: "revoked",
      revision: input.current.revision + 1,
      lastSequence: input.current.lastSequence + 1,
      revokedAtMs: input.revokedAtMs,
    };
  }
}

function harness() {
  const store = new Store();
  let sequence = 0;
  const service = new AdministratorGrantService(
    store,
    { newAdministratorGrantId: () => `administrator_grant.synthetic_${++sequence}` },
    { nowMs: () => 1_900_000_000_000 + sequence },
  );
  return { service, store };
}

describe("audited administrator grant service", () => {
  it("bootstraps exactly one active administrator with CLI provenance", async () => {
    const { service, store } = harness();
    const grant = await service.bootstrapFirstAdministrator(firstAccount);
    expect(grant).toMatchObject({
      userAccountId: firstAccount,
      status: "active",
      origin: "bootstrap_cli",
      revision: 1,
    });
    expect(store.creations[0]).toMatchObject({
      snapshot: grant,
      reasonCode: "initial_owner_bootstrap",
    });
    expect(store.creations[0]).not.toHaveProperty("actorUserAccountId");
    await expect(service.bootstrapFirstAdministrator(secondAccount)).rejects.toMatchObject({
      code: "conflict",
    });
  });

  it("allows an administrator to grant another active account with provenance", async () => {
    const { service, store } = harness();
    await service.bootstrapFirstAdministrator(firstAccount);
    const granted = await service.grantAdministrator(
      administrator,
      secondAccount,
      "owner_approved_operator",
    );
    expect(granted).toMatchObject({ userAccountId: secondAccount, origin: "administrator" });
    expect(store.creations[1]).toMatchObject({
      actorUserAccountId: firstAccount,
      reasonCode: "owner_approved_operator",
    });
  });

  it("revokes with optimistic revision and preserves at least one administrator", async () => {
    const { service, store } = harness();
    await service.bootstrapFirstAdministrator(firstAccount);
    await expect(
      service.revokeAdministrator(administrator, firstAccount, "owner_requested"),
    ).rejects.toMatchObject({ code: "conflict" });
    await service.grantAdministrator(administrator, secondAccount, "owner_approved_operator");
    const revoked = await service.revokeAdministrator(
      administrator,
      secondAccount,
      "operator_access_ended",
    );
    expect(revoked).toMatchObject({ status: "revoked", revision: 2, lastSequence: 2 });
    expect(store.revocations[0]).toMatchObject({
      expectedRevision: 1,
      actorUserAccountId: firstAccount,
      reasonCode: "operator_access_ended",
    });
  });

  it.each<ActorContext>([
    { role: "anonymous" },
    { role: "account", userAccountId: firstAccount },
    { role: "migration_operator" },
  ])("rejects $role grant mutation before a transaction", async (actor) => {
    const { service, store } = harness();
    await expect(
      service.grantAdministrator(actor, secondAccount, "owner_approved_operator"),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(store.transactionCount).toBe(0);
  });

  it("revalidates the administrator's active database grant inside mutation", async () => {
    const { service, store } = harness();
    await expect(
      service.grantAdministrator(administrator, secondAccount, "forged_actor_attempt"),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(store.creations).toHaveLength(0);
  });

  it("rejects missing, inactive, duplicate, and malformed grant targets", async () => {
    const missing = harness();
    await expect(
      missing.service.bootstrapFirstAdministrator("user_account.missing"),
    ).rejects.toMatchObject({ code: "not_found" });

    const inactive = harness();
    inactive.store.accounts.set(firstAccount, "suspended");
    await expect(
      inactive.service.bootstrapFirstAdministrator(firstAccount),
    ).rejects.toMatchObject({ code: "conflict" });

    const duplicate = harness();
    await duplicate.service.bootstrapFirstAdministrator(firstAccount);
    await expect(
      duplicate.service.grantAdministrator(administrator, firstAccount, "duplicate_attempt"),
    ).rejects.toMatchObject({ code: "conflict" });

    const malformed = harness();
    await expect(
      malformed.service.bootstrapFirstAdministrator("owner@example.com"),
    ).rejects.toMatchObject({ code: "invalid_command" });
    expect(malformed.store.transactionCount).toBe(0);
  });
});
