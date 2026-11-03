import { describe, expect, it } from "vitest";

import {
  AliasService,
  type AliasClock,
  type AliasIdGenerator,
  type AliasSnapshot,
  type AliasWriteRepository,
  type AliasWriteTransaction,
  type AppendAliasEventInput,
  type CreateAliasInput,
} from "../src/identity/alias-service.js";
import type { AccountStatus, ActorContext } from "../src/identity/types.js";

const playerId = "player.synthetic_alias_target_01";
const secondPlayerId = "player.synthetic_alias_target_02";
const adminAccountId = "user_account.synthetic_alias_admin_01";
const accountActor: ActorContext = {
  role: "account",
  userAccountId: "user_account.synthetic_alias_owner_01",
};
const administrator: ActorContext = {
  role: "administrator",
  userAccountId: adminAccountId,
};

class SyntheticIds implements AliasIdGenerator {
  private sequence = 0;

  newAliasId(): string {
    this.sequence += 1;
    return `alias.synthetic_generated_${this.sequence}`;
  }
}

class SyntheticClock implements AliasClock {
  private value = 2_000_000_000_000;

  nowMs(): number {
    this.value += 1;
    return this.value;
  }
}

class AliasStore implements AliasWriteRepository, AliasWriteTransaction {
  readonly playerStatuses = new Map<string, "active" | "archived">([
    [playerId, "active"],
    [secondPlayerId, "active"],
  ]);
  readonly accountStatuses = new Map<string, AccountStatus>([
    [adminAccountId, "active"],
    // The self-service profile path acts as an ordinary active account.
    ["user_account.synthetic_alias_owner_01", "active"],
  ]);
  readonly aliases = new Map<string, AliasSnapshot>();
  readonly creations: CreateAliasInput[] = [];
  readonly appends: AppendAliasEventInput[] = [];
  transactionCount = 0;

  async transaction<T>(
    work: (transaction: AliasWriteTransaction) => Promise<T>,
  ): Promise<T> {
    this.transactionCount += 1;
    return work(this);
  }

  // Claims held by the synthetic accounts, so the self-service alias path can
  // be exercised without a database.
  public verifiedClaims = new Map<string, Set<string>>();

  async hasVerifiedClaimOnPlayer(userAccountId: string, playerId: string): Promise<boolean> {
    return this.verifiedClaims.get(userAccountId)?.has(playerId) ?? false;
  }

  async findHumanPlayerStatus(
    requestedPlayerId: string,
  ): Promise<"active" | "archived" | null> {
    return this.playerStatuses.get(requestedPlayerId) ?? null;
  }

  async findUserAccountStatus(accountId: string): Promise<AccountStatus | null> {
    return this.accountStatuses.get(accountId) ?? null;
  }

  async findAliasForUpdate(aliasId: string): Promise<AliasSnapshot | null> {
    return this.aliases.get(aliasId) ?? null;
  }

  async createAlias(input: CreateAliasInput): Promise<void> {
    this.creations.push(input);
    this.aliases.set(input.snapshot.aliasId, input.snapshot);
  }

  async appendAliasEvent(input: AppendAliasEventInput): Promise<void> {
    const current = this.aliases.get(input.aliasId);
    if (current?.revision !== input.expectedRevision) {
      throw new Error("synthetic Alias revision conflict");
    }
    this.appends.push(input);
    this.aliases.set(input.aliasId, input.nextSnapshot);
  }
}

function harness() {
  const store = new AliasStore();
  return {
    store,
    service: new AliasService(store, new SyntheticIds(), new SyntheticClock()),
  };
}

/** What a Player may assert about themselves: a declaration, nothing more. */
function declareCommand(targetPlayerId = playerId) {
  return {
    playerId: targetPlayerId,
    aliasText: "Soudler",
    aliasType: "declared" as const,
    visibility: "public" as const,
    provenance: [
      {
        sourceType: "player_declaration" as const,
        sourceReference: "source.synthetic_declaration_01",
        observedAtMs: 1_900_000_000_000,
      },
    ],
  };
}

function createCommand(targetPlayerId = playerId) {
  return {
    playerId: targetPlayerId,
    aliasText: "Shared Synthetic Alias",
    aliasType: "tournament_name" as const,
    visibility: "restricted" as const,
    provenance: [
      {
        sourceType: "tournament_workbook" as const,
        sourceReference: "source.synthetic_workbook_01",
        observedAtMs: 1_900_000_000_000,
      },
    ],
  };
}

describe("reviewed Alias application service", () => {
  it("creates an approved Alias with administrator and provenance audit", async () => {
    const { service, store } = harness();
    const alias = await service.createAlias(administrator, createCommand());

    expect(alias).toMatchObject({
      aliasId: "alias.synthetic_generated_1",
      playerId,
      aliasText: "Shared Synthetic Alias",
      visibility: "restricted",
      recordStatus: "active",
      revision: 1,
      lastSequence: 1,
      reviewedByUserAccountId: adminAccountId,
    });
    expect(store.creations[0]).toMatchObject({
      snapshot: alias,
      provenance: [
        {
          sourceType: "tournament_workbook",
          sourceReference: "source.synthetic_workbook_01",
        },
      ],
      initialEvent: {
        eventType: "alias_created",
        actorUserAccountId: adminAccountId,
      },
    });
  });

  it.each<ActorContext>([
    { role: "anonymous" },
    { role: "migration_operator" },
  ])("rejects actor $role before a transaction", async (actor) => {
    const { service, store } = harness();
    await expect(service.createAlias(actor, createCommand())).rejects.toMatchObject({
      code: "forbidden",
    });
    expect(store.transactionCount).toBe(0);
  });

  // Owner decision 2026-08-28: aliases are managed under the profile, by the
  // Player as well as by an administrator. An ordinary account may act, but
  // only on a Player it has claimed and only as a self-declaration.
  it("refuses an ordinary account an administrator-reviewed Alias type", async () => {
    const { service, store } = harness();
    await expect(service.createAlias(accountActor, createCommand())).rejects.toMatchObject({
      code: "forbidden",
    });
    // The vocabulary is checked before anything is read or written.
    expect(store.transactionCount).toBe(0);
  });

  it("lets an account declare an Alias on the Player it claimed", async () => {
    const { service, store } = harness();
    store.verifiedClaims.set(accountActor.userAccountId!, new Set([playerId]));
    const alias = await service.createAlias(accountActor, declareCommand());
    expect(alias).toMatchObject({
      playerId,
      aliasType: "declared",
      recordStatus: "active",
      reviewedByUserAccountId: accountActor.userAccountId,
    });
  });

  it("refuses an account an Alias on a Player it has not claimed", async () => {
    const { service, store } = harness();
    store.verifiedClaims.set(accountActor.userAccountId!, new Set([playerId]));
    await expect(
      service.createAlias(accountActor, declareCommand(secondPlayerId)),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("refuses an account provenance it cannot honestly assert", async () => {
    const { service } = harness();
    await expect(
      service.createAlias(accountActor, {
        ...declareCommand(),
        provenance: [{
          sourceType: "ocr" as const,
          sourceReference: "source.synthetic_scan_01",
          observedAtMs: 1_900_000_000_000,
        }],
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("lets an account retire its own declared Alias", async () => {
    const { service, store } = harness();
    store.verifiedClaims.set(accountActor.userAccountId!, new Set([playerId]));
    const created = await service.createAlias(accountActor, declareCommand());
    const retired = await service.updateAlias(accountActor, {
      aliasId: created.aliasId,
      action: "retire",
    });
    expect(retired.recordStatus).toBe("retired");
  });

  it("refuses an account a change to an Alias of a Player it has not claimed", async () => {
    const { service, store } = harness();
    const created = await service.createAlias(administrator, createCommand());
    store.verifiedClaims.set(accountActor.userAccountId!, new Set([secondPlayerId]));
    await expect(
      service.updateAlias(accountActor, { aliasId: created.aliasId, action: "retire" }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("allows identical Alias text on different Players without merging", async () => {
    const { service, store } = harness();
    const first = await service.createAlias(administrator, createCommand(playerId));
    const second = await service.createAlias(
      administrator,
      createCommand(secondPlayerId),
    );

    expect(first.aliasText).toBe(second.aliasText);
    expect(first.playerId).not.toBe(second.playerId);
    expect(first.aliasId).not.toBe(second.aliasId);
    expect(store.aliases).toHaveLength(2);
  });

  it("measures Alias text as Unicode code points at the contract limit", async () => {
    const accepted = harness();
    await expect(
      accepted.service.createAlias(administrator, {
        ...createCommand(),
        aliasText: "🏁".repeat(128),
      }),
    ).resolves.toMatchObject({ aliasText: "🏁".repeat(128) });

    const rejected = harness();
    await expect(
      rejected.service.createAlias(administrator, {
        ...createCommand(),
        aliasText: "🏁".repeat(129),
      }),
    ).rejects.toMatchObject({ code: "invalid_command" });
    expect(rejected.store.transactionCount).toBe(0);
  });

  it.each([
    [{ ...createCommand(), playerId: "NintendoStaff" }],
    [{ ...createCommand(), provenance: [] }],
    [
      {
        ...createCommand(),
        provenance: [
          {
            sourceType: "timetrial_firebase",
            sourceReference: "raw firebase uid",
            observedAtMs: 1,
          },
        ],
      },
    ],
  ])("rejects system/raw/unprovenanced commands", async (command) => {
    const { service, store } = harness();
    await expect(
      service.createAlias(
        administrator,
        command as ReturnType<typeof createCommand>,
      ),
    ).rejects.toMatchObject({ code: "invalid_command" });
    expect(store.transactionCount).toBe(0);
  });

  it("changes visibility and retires with expected revision and ordered audit", async () => {
    const { service, store } = harness();
    const created = await service.createAlias(administrator, createCommand());
    const visible = await service.updateAlias(administrator, {
      aliasId: created.aliasId,
      action: "set_visibility",
      visibility: "public",
      reasonCode: "reviewed_for_public_profile",
    });
    const retired = await service.updateAlias(administrator, {
      aliasId: created.aliasId,
      action: "retire",
      reasonCode: "superseded_observation",
    });

    expect(visible).toMatchObject({ visibility: "public", revision: 2 });
    expect(retired).toMatchObject({ recordStatus: "retired", revision: 3 });
    expect(store.appends.map((item) => item.expectedRevision)).toEqual([1, 2]);
    expect(store.appends.map((item) => item.event)).toMatchObject([
      { sequence: 2, eventType: "visibility_changed" },
      { sequence: 3, eventType: "alias_retired" },
    ]);
  });

  it("keeps retired Aliases immutable instead of destructively reusing them", async () => {
    const { service } = harness();
    const created = await service.createAlias(administrator, createCommand());
    await service.updateAlias(administrator, {
      aliasId: created.aliasId,
      action: "retire",
    });
    await expect(
      service.updateAlias(administrator, {
        aliasId: created.aliasId,
        action: "set_visibility",
        visibility: "public",
      }),
    ).rejects.toMatchObject({ code: "invalid_transition" });
  });

  it("rejects an unsupported runtime action before opening a transaction", async () => {
    const { service, store } = harness();
    await expect(
      service.updateAlias(administrator, {
        aliasId: "alias.synthetic_existing_01",
        action: "silently_merge",
      } as never),
    ).rejects.toMatchObject({ code: "invalid_command" });
    expect(store.transactionCount).toBe(0);
  });

  it("rejects inactive review targets without changing Alias state", async () => {
    const archived = harness();
    archived.store.playerStatuses.set(playerId, "archived");
    await expect(
      archived.service.createAlias(administrator, createCommand()),
    ).rejects.toMatchObject({ code: "conflict" });

    const suspended = harness();
    suspended.store.accountStatuses.set(adminAccountId, "suspended");
    await expect(
      suspended.service.createAlias(administrator, createCommand()),
    ).rejects.toMatchObject({ code: "conflict" });
  });
});
