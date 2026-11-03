import { describe, expect, it } from "vitest";

import {
  RATING_SEED_SOURCE_SYSTEM,
  RatingSeedImportError,
  RatingSeedImportService,
  type RatingSeedDocument,
  type RatingSeedImportTransaction,
} from "../src/rating/rating-seed-import-service.js";

const seedHash = "a".repeat(64);
const seed: RatingSeedDocument = {
  normalizedSeedSha256: seedHash,
  rows: [
    { legacyPlayerId: 22, mu: "29.018918163904146", sigma: "0.6220795922311986" },
    { legacyPlayerId: 21, mu: "30.575955486231237", sigma: "0.6364204858969642" },
    { legacyPlayerId: 9, mu: "28.655724628245057", sigma: "0.6215421605391754" },
  ],
};

type Store = {
  players: Record<string, number>;
  imported: unknown[];
  identities: Set<string>;
  ratings: Set<number>;
};

function service(overrides: Partial<Store> = {}) {
  const store: Store = {
    players: { "player.ben": 1, "player.matteo": 2 },
    imported: [],
    identities: new Set(),
    ratings: new Set(),
    ...overrides,
  };
  const transaction: RatingSeedImportTransaction = {
    async findActiveHumanPlayerInternalId(playerId) {
      return store.players[playerId] ?? null;
    },
    async hasSeedIdentity(input) {
      return store.identities.has(
        `${input.sourceSystem}:${input.sourcePlayerReference}`);
    },
    async hasRating(playerInternalId) {
      return store.ratings.has(playerInternalId);
    },
    async insertSeededRating(input) {
      store.imported.push(input);
      store.identities.add(
        `${input.sourceSystem}:${input.sourcePlayerReference}`);
      store.ratings.add(input.playerInternalId);
    },
  };
  const importer = new RatingSeedImportService(
    { async transaction(work) { return work(transaction); } },
    { nowMs: () => 7_000 },
  );
  return { importer, store };
}

describe("rating seed import", () => {
  it("imports exactly the mapped rows with full-precision values", async () => {
    const { importer, store } = service();
    const report = await importer.importSeed(seed, [
      { legacyPlayerId: 22, playerId: "player.ben" },
      { legacyPlayerId: 21, playerId: "player.matteo" },
    ]);
    expect(report).toMatchObject({
      seedRows: 3,
      mappedRows: 2,
      imported: 2,
      skippedAlreadyImported: 0,
      unmappedLegacyPlayerIds: [9],
    });
    expect(report.sourceReference)
      .toBe(`${RATING_SEED_SOURCE_SYSTEM}#${seedHash.slice(0, 16)}`);
    expect(store.imported[0]).toMatchObject({
      playerInternalId: 1,
      mu: "29.018918163904146",
      sigma: "0.6220795922311986",
      sourcePlayerReference: "22",
      sourceSnapshotSha256: seedHash,
      nowMs: 7_000,
    });
  });

  it("is idempotent: a second run skips already imported identities", async () => {
    const { importer } = service();
    const mapping = [{ legacyPlayerId: 22, playerId: "player.ben" }];
    const first = await importer.importSeed(seed, mapping);
    const second = await importer.importSeed(seed, mapping);
    expect(first.imported).toBe(1);
    expect(second.imported).toBe(0);
    expect(second.skippedAlreadyImported).toBe(1);
  });

  it("fails closed on unknown players and foreign existing ratings", async () => {
    const { importer } = service();
    await expect(importer.importSeed(seed, [
      { legacyPlayerId: 22, playerId: "player.ghost" },
    ])).rejects.toThrow(RatingSeedImportError);

    const occupied = service({ ratings: new Set([1]) });
    await expect(occupied.importer.importSeed(seed, [
      { legacyPlayerId: 22, playerId: "player.ben" },
    ])).rejects.toThrow(/already has a rating/);
  });

  it("rejects malformed seeds and mappings", async () => {
    const { importer } = service();
    await expect(importer.importSeed(
      { normalizedSeedSha256: "short", rows: [] }, [],
    )).rejects.toThrow(/hash/);
    await expect(importer.importSeed({
      normalizedSeedSha256: seedHash,
      rows: [{ legacyPlayerId: 1, mu: "25", sigma: "8.333" }],
    }, [])).rejects.toThrow(RatingSeedImportError);
    await expect(importer.importSeed(seed, [
      { legacyPlayerId: 99, playerId: "player.ben" },
    ])).rejects.toThrow(/unknown legacy id/);
    await expect(importer.importSeed(seed, [
      { legacyPlayerId: 22, playerId: "player.ben" },
      { legacyPlayerId: 21, playerId: "player.ben" },
    ])).rejects.toThrow(/duplicate/);
  });
});
