import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildApp } from "../src/app.js";
import type { ActorContext, IdentityReadRepository } from
  "../src/identity/types.js";
import { TournamentRevisionReadError } from
  "../src/tournaments/race-result-read-service.js";
import type { TournamentRaceResultV1 } from
  "../src/tournaments/race-result-validation.js";

class NullIdentityReads implements IdentityReadRepository {
  async findPublicPlayerById(): Promise<null> { return null; }
  async findUserAccountSummaryById(): Promise<null> { return null; }
  async findPlayerClaimSummaryById(): Promise<null> { return null; }
}

function revision(): TournamentRaceResultV1 {
  return {
    schemaVersion: "mk8dx.tournament-race-result.v1",
    raceResultId: "tournament_race_result.SYNTHETICREAD01",
    revision: 2,
    raceNumber: 4,
    scoringSegment: 1,
    mode: 150,
    trackId: "track.mario_kart_stadium",
    countsTowardStandings: true,
    context: {
      tournamentReference: { namespace: "tournament_slug", value: "private-cup" },
      stageReference: { namespace: "stage_slug", value: "private-final" },
      groupReference: { namespace: "group_slug", value: "private-group-a" },
      observedStageLabel: "Private Final",
      observedGroupLabel: "Private Group A",
    },
    placements: [
      {
        finishPosition: 1,
        participantReference: { namespace: "player", value: "player.synthetic_one" },
        observedPlayerName: "Private Player One",
        characterId: "character.mario",
        scoring: {
          racePoints: 15,
          totalBeforeRace: 30,
          totalAfterRace: 45,
          rankAfterRace: 1,
        },
        confidence: { finishPosition: 0.99, playerName: 0.8 },
      },
      {
        finishPosition: 2,
        participantReference: {
          namespace: "tournament_manager_player",
          value: "private-manager-player-2",
        },
        characterId: "character.luigi",
        scoring: {
          racePoints: 12,
          totalBeforeRace: 28,
          totalAfterRace: 40,
          rankAfterRace: 2,
        },
      },
    ],
    source: {
      kind: "tournament_spreadsheet_import",
      transport: "excel_workbook",
      producerVersion: "synthetic-test",
      localRecordId: "private-local-record",
      sessionId: "private-session",
      sourceMediaId: "private-workbook",
      raceOffsetMs: 1_234,
      frameIndex: 56,
    },
    timestamps: {
      occurredAtMs: 1_786_901_000_000,
      capturedAtMs: 1_786_901_010_000,
      createdAtMs: 1_786_901_020_000,
      submittedAtMs: 1_786_901_030_000,
    },
    evidence: [{
      kind: "workbook",
      reference: "private/results.xlsx",
      sha256: "cd".repeat(32),
      mediaType: "application/vnd.synthetic",
    }],
    verification: {
      status: "needs_review",
      method: "synthetic",
      confidence: 0.9,
      fieldConfidence: { track: 0.99, playerNames: 0.5 },
      issues: [{ code: "ocr.name_uncertain", message: "Private review message" }],
    },
  };
}

class SyntheticReadService {
  readonly calls: Array<Readonly<{
    actor: ActorContext;
    raceResultId: string;
    revision: number;
    purposeCode: string;
  }>> = [];
  error: unknown;
  output: unknown = revision();

  async readRevision(
    actor: ActorContext,
    raceResultId: string,
    targetRevision: number,
    purposeCode: string,
  ): Promise<TournamentRaceResultV1> {
    this.calls.push({ actor, raceResultId, revision: targetRevision, purposeCode });
    if (this.error !== undefined) { throw this.error; }
    return this.output as TournamentRaceResultV1;
  }
}

const openApps: FastifyInstance[] = [];

async function appHarness() {
  const service = new SyntheticReadService();
  const resolveActor = vi.fn(async () => ({
    role: "administrator" as const,
    userAccountId: "user_account.synthetic_admin_01",
  }));
  const app = await buildApp({
    identityRepository: new NullIdentityReads(),
    resolveActor,
    tournamentRevisionRead: { service },
  });
  openApps.push(app);
  return { app, service, resolveActor };
}

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
});

const validUrl =
  "/v1/tournament-race-results/tournament_race_result.SYNTHETICREAD01" +
  "/revisions/2?purposeCode=administrative_review";

describe("Tournament revision read HTTP boundary", () => {
  it("passes the administrator target and purpose to the audited service", async () => {
    const { app, service } = await appHarness();
    const response = await app.inject({ method: "GET", url: validUrl });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(revision());
    expect(service.calls).toEqual([{
      actor: {
        role: "administrator",
        userAccountId: "user_account.synthetic_admin_01",
      },
      raceResultId: "tournament_race_result.SYNTHETICREAD01",
      revision: 2,
      purposeCode: "administrative_review",
    }]);
  });

  it("uses one non-enumerating response for forbidden and missing reads", async () => {
    const forbidden = await appHarness();
    forbidden.service.error = new TournamentRevisionReadError(
      "forbidden",
      "private authorization detail",
    );
    const missing = await appHarness();
    missing.service.error = new TournamentRevisionReadError(
      "not_found",
      "private storage detail",
    );

    const forbiddenResponse = await forbidden.app.inject({ method: "GET", url: validUrl });
    const missingResponse = await missing.app.inject({ method: "GET", url: validUrl });

    expect(forbiddenResponse.statusCode).toBe(404);
    expect(forbiddenResponse.json()).toEqual(missingResponse.json());
    expect(forbiddenResponse.json()).toEqual({
      code: "tournament_revision_not_found",
      message: "The Tournament revision was not found.",
    });
    expect(forbiddenResponse.body).not.toContain("authorization detail");
    expect(missingResponse.body).not.toContain("storage detail");
  });

  it.each([
    ["bad id", "/v1/tournament-race-results/bad/revisions/2?purposeCode=administrative_review"],
    ["bad revision", "/v1/tournament-race-results/tournament_race_result.SYNTHETICREAD01/revisions/0?purposeCode=administrative_review"],
    ["unsafe revision", "/v1/tournament-race-results/tournament_race_result.SYNTHETICREAD01/revisions/9999999999999999?purposeCode=administrative_review"],
    ["missing purpose", "/v1/tournament-race-results/tournament_race_result.SYNTHETICREAD01/revisions/2"],
    ["bad purpose", "/v1/tournament-race-results/tournament_race_result.SYNTHETICREAD01/revisions/2?purposeCode=Private%20review"],
    ["extra query", "/v1/tournament-race-results/tournament_race_result.SYNTHETICREAD01/revisions/2?purposeCode=administrative_review&private=1"],
  ])("rejects %s before identity or service access", async (_label, url) => {
    const { app, service, resolveActor } = await appHarness();
    const response = await app.inject({ method: "GET", url });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      code: "invalid_tournament_revision_read",
      message: "The Tournament revision read request is invalid.",
    });
    expect(resolveActor).not.toHaveBeenCalled();
    expect(service.calls).toHaveLength(0);
  });

  it("fails closed when service output is not exact canonical V1", async () => {
    const { app, service } = await appHarness();
    service.output = { ...revision(), decryptedKeyMaterial: "private-key-detail" };
    const response = await app.inject({ method: "GET", url: validUrl });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      code: "tournament_revision_read_failed",
      message: "The Tournament revision could not be read.",
    });
    expect(response.body).not.toContain("private-key-detail");
  });

  it("redacts resolver, read, and decryption failures", async () => {
    const resolver = await appHarness();
    resolver.resolveActor.mockRejectedValueOnce(new Error("private provider detail"));
    const read = await appHarness();
    read.service.error = new TournamentRevisionReadError(
      "read_failed",
      "private decryption detail",
    );
    const unexpected = await appHarness();
    unexpected.service.error = new Error("private SQL detail");

    for (const fixture of [resolver, read, unexpected]) {
      const response = await fixture.app.inject({ method: "GET", url: validUrl });
      expect(response.statusCode).toBe(500);
      expect(response.json()).toMatchObject({ code: "tournament_revision_read_failed" });
      expect(response.body).not.toMatch(/provider detail|decryption detail|SQL detail/);
    }
  });

  it("does not register without the explicit read service dependency", async () => {
    const app = await buildApp({ identityRepository: new NullIdentityReads() });
    openApps.push(app);
    const response = await app.inject({ method: "GET", url: validUrl });
    expect(response.statusCode).toBe(404);
  });
});
