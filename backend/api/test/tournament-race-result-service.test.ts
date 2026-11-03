import { describe, expect, it } from "vitest";

import {
  TournamentRaceResultService,
  type TournamentAssetCatalog,
  type TournamentProtectedLookupValue,
  type TournamentProtectedValue,
  type TournamentRevisionPersistenceInput,
  type TournamentSensitiveValueProtector,
  type TournamentWriteRepository,
  type TournamentWriteTransaction,
} from "../src/tournaments/race-result-service.js";
import type {
  TournamentAssetReferences,
  TournamentParticipantReference,
  TournamentRaceResultV1,
} from "../src/tournaments/race-result-validation.js";

const playerId = "player.synthetic_tournament_service_01";

function result(): TournamentRaceResultV1 {
  return {
    schemaVersion: "mk8dx.tournament-race-result.v1",
    raceResultId: "tournament_race_result.synthetic_service_001",
    revision: 1,
    raceNumber: 2,
    scoringSegment: 1,
    trackId: "track.water_park",
    countsTowardStandings: true,
    context: {
      groupReference: {
        namespace: "producer_local_group",
        value: "private-group-reference",
      },
      observedGroupLabel: "Group Alpha",
    },
    placements: [
      {
        finishPosition: 1,
        participantReference: { namespace: "player", value: playerId },
        observedPlayerName: "Central Racer",
        characterId: "character.mario",
        scoring: {
          racePoints: 15,
          totalBeforeRace: 10,
          totalAfterRace: 25,
          rankAfterRace: 1,
        },
      },
      {
        finishPosition: 2,
        participantReference: {
          namespace: "producer_local_player",
          value: "private-player-reference",
        },
        observedPlayerName: "Observed Racer",
        characterId: "character.luigi",
        scoring: {
          racePoints: 12,
          totalBeforeRace: 8,
          totalAfterRace: 20,
          rankAfterRace: 2,
        },
      },
    ],
    source: {
      kind: "tournament_live_capture",
      transport: "native_contract",
      localRecordId: "race-002",
    },
    timestamps: { createdAtMs: 1_900_000_000_000 },
    evidence: [{
      kind: "capture_session",
      reference: "private-evidence-reference",
      sha256: "44".repeat(32),
    }],
    verification: {
      status: "needs_review",
      issues: [{
        code: "capture.synthetic_review",
        message: "Private synthetic review message",
      }],
    },
  };
}

class SyntheticCatalog implements TournamentAssetCatalog {
  readonly calls: TournamentAssetReferences[] = [];
  issues: readonly string[] = [];

  async validateReferences(
    references: TournamentAssetReferences,
  ): Promise<readonly string[]> {
    this.calls.push(references);
    return this.issues;
  }
}

class SyntheticProtector implements TournamentSensitiveValueProtector {
  readonly plaintext: string[] = [];
  invalidLookup = false;
  throwOnEvidence = false;

  private lookup(value: string): TournamentProtectedLookupValue {
    this.plaintext.push(value);
    return {
      lookupHmac: new Uint8Array(this.invalidLookup ? 31 : 32).fill(1),
      lookupKeyVersion: "lookup-v1",
      ciphertext: new Uint8Array([1, 2, 3]),
      encryptionKeyVersion: "encryption-v1",
    };
  }

  async protectParticipantReference(
    _namespace: Exclude<TournamentParticipantReference["namespace"], "player">,
    value: string,
  ): Promise<TournamentProtectedLookupValue> { return this.lookup(value); }

  async protectContextReference(
    _namespace: string,
    value: string,
  ): Promise<TournamentProtectedLookupValue> { return this.lookup(value); }

  async protectEvidenceReference(reference: string): Promise<TournamentProtectedValue> {
    this.plaintext.push(reference);
    if (this.throwOnEvidence) {
      throw new Error(`provider leaked ${reference}`);
    }
    return {
      ciphertext: new Uint8Array([4, 5, 6]),
      encryptionKeyVersion: "encryption-v1",
    };
  }

  async protectVerificationIssueMessage(message: string): Promise<TournamentProtectedValue> {
    this.plaintext.push(message);
    return {
      ciphertext: new Uint8Array([7, 8, 9]),
      encryptionKeyVersion: "encryption-v1",
    };
  }
}

class SyntheticStore implements TournamentWriteRepository, TournamentWriteTransaction {
  readonly states = new Map<string, { firstCreatedAtMs: number; latestRevision: number }>();
  readonly activePlayers = new Set([playerId]);
  readonly writes: TournamentRevisionPersistenceInput[] = [];
  transactionCount = 0;
  resultInsertCount = 0;

  async transaction<T>(
    work: (transaction: TournamentWriteTransaction) => Promise<T>,
  ): Promise<T> {
    this.transactionCount += 1;
    return work(this);
  }

  async findRaceResultForUpdate(raceResultId: string) {
    return this.states.get(raceResultId) ?? null;
  }

  async findActiveHumanPlayersForUpdate(playerIds: readonly string[]) {
    return new Set(playerIds.filter((id) => this.activePlayers.has(id)));
  }

  async insertRaceResult(raceResultId: string, firstCreatedAtMs: number): Promise<void> {
    this.resultInsertCount += 1;
    this.states.set(raceResultId, { firstCreatedAtMs, latestRevision: 0 });
  }

  async insertRevision(input: TournamentRevisionPersistenceInput): Promise<void> {
    this.writes.push(input);
    const current = this.states.get(input.revision.raceResultId);
    if (current === undefined) { throw new Error("synthetic result missing"); }
    this.states.set(input.revision.raceResultId, {
      ...current,
      latestRevision: input.revision.revision,
    });
  }
}

function harness() {
  const store = new SyntheticStore();
  const catalog = new SyntheticCatalog();
  const protector = new SyntheticProtector();
  return {
    store,
    catalog,
    protector,
    service: new TournamentRaceResultService(store, catalog, protector),
  };
}

describe("Tournament race result application service", () => {
  it("protects source/context/evidence/review values before persistence", async () => {
    const { service, store, catalog, protector } = harness();
    const input = result();

    await expect(service.submit(input)).resolves.toEqual({
      raceResultId: input.raceResultId,
      revision: 1,
    });
    expect(catalog.calls[0]).toEqual({
      trackId: input.trackId,
      placements: [
        { characterId: "character.mario" },
        { characterId: "character.luigi" },
      ],
    });
    expect(store.writes[0]).toMatchObject({
      revision: { observedGroupLabel: "Group Alpha" },
      placements: [
        { playerId, restrictedParticipant: null },
        {
          playerId: null,
          restrictedParticipant: { namespace: "producer_local_player" },
        },
      ],
      protectedContext: [{ contextKind: "group", namespace: "producer_local_group" }],
      protectedEvidence: [{ sequenceNumber: 1, kind: "capture_session" }],
      protectedIssues: [{ sequenceNumber: 1, code: "capture.synthetic_review" }],
    });
    const persisted = JSON.stringify(store.writes[0]);
    for (const raw of [
      "private-player-reference",
      "private-group-reference",
      "private-evidence-reference",
      "Private synthetic review message",
    ]) {
      expect(persisted).not.toContain(raw);
      expect(protector.plaintext).toContain(raw);
    }
    expect(store.writes[0]?.revision).not.toHaveProperty("context");
    expect(store.writes[0]?.revision).not.toHaveProperty("evidence");
    expect(store.writes[0]?.revision.verification).not.toHaveProperty("issues");
  });

  it("rejects asset-catalog issues before protection or transaction", async () => {
    const { service, store, catalog, protector } = harness();
    catalog.issues = ["character variant parent mismatch"];

    await expect(service.submit(result())).rejects.toMatchObject({
      code: "invalid_assets",
    });
    expect(protector.plaintext).toEqual([]);
    expect(store.transactionCount).toBe(0);
  });

  it("requires every central Player to be active under the transaction", async () => {
    const { service, store } = harness();
    store.activePlayers.clear();

    await expect(service.submit(result())).rejects.toMatchObject({
      code: "player_not_found",
    });
    expect(store.transactionCount).toBe(1);
    expect(store.writes).toHaveLength(0);
  });

  it("requires revision 1 then the strict next stable-result revision", async () => {
    const fresh = harness();
    await expect(fresh.service.submit({ ...result(), revision: 2 })).rejects
      .toMatchObject({ code: "revision_conflict" });

    const existing = harness();
    const input = result();
    existing.store.states.set(input.raceResultId, {
      firstCreatedAtMs: input.timestamps.createdAtMs,
      latestRevision: 1,
    });
    await expect(existing.service.submit({ ...input, revision: 1 })).rejects
      .toMatchObject({ code: "revision_conflict" });
    await expect(existing.service.submit({ ...input, revision: 3 })).rejects
      .toMatchObject({ code: "revision_conflict" });
    await expect(existing.service.submit({ ...input, revision: 2 })).resolves
      .toMatchObject({ revision: 2 });
    expect(existing.store.resultInsertCount).toBe(0);
    expect(existing.store.writes).toHaveLength(1);
  });

  it("redacts cryptographic failures before opening a transaction", async () => {
    const { service, store, protector } = harness();
    protector.throwOnEvidence = true;
    const failure = service.submit(result());

    await expect(failure).rejects.toMatchObject({
      code: "protection_failed",
      message: "evidence reference protection failed",
    });
    await expect(failure).rejects.not.toThrow("private-evidence-reference");
    expect(store.transactionCount).toBe(0);
  });

  it("rejects malformed protected lookup output", async () => {
    const { service, store, protector } = harness();
    protector.invalidLookup = true;

    await expect(service.submit(result())).rejects.toMatchObject({
      code: "protection_failed",
    });
    expect(store.transactionCount).toBe(0);
  });

  it("validates semantic failures before catalog, protection, or transaction", async () => {
    const { service, store, catalog, protector } = harness();
    const input: any = structuredClone(result());
    input.placements[0].scoring.rankAfterRace = 2;

    await expect(service.submit(input)).rejects.toMatchObject({
      code: "invalid_scoring",
    });
    expect(catalog.calls).toEqual([]);
    expect(protector.plaintext).toEqual([]);
    expect(store.transactionCount).toBe(0);
  });
});
