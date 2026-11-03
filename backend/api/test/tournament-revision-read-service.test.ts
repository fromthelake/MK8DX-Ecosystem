import { describe, expect, it, vi } from "vitest";

import type { ActorContext } from "../src/identity/types.js";
import {
  TournamentRevisionReadService,
  type AuditedStoredTournamentRevision,
  type TournamentRestrictedValueReader,
  type TournamentRevisionReadRepository,
} from "../src/tournaments/race-result-read-service.js";

function value(seed: number) {
  return { ciphertext: Uint8Array.from([seed]), encryptionKeyVersion: "enc-v1" };
}

function stored(): AuditedStoredTournamentRevision {
  return {
    publicRevision: {
      schemaVersion: "mk8dx.tournament-race-result.v1",
      raceResultId: "tournament_race_result.synthetic1",
      revision: 1,
      raceNumber: 1,
      scoringSegment: 1,
      mode: 150,
      trackId: "track.mario_kart_stadium",
      countsTowardStandings: true,
      observedStageLabel: "Final",
      source: { kind: "tournament_live_capture" },
      timestamps: { createdAtMs: 1000 },
      verification: { status: "needs_review" },
    },
    placements: [{
      finishPosition: 1,
      playerId: null,
      restrictedParticipant: {
        namespace: "producer_local_player",
        protectedValue: value(1),
      },
      scoring: { racePoints: 15, totalBeforeRace: 0, totalAfterRace: 15, rankAfterRace: 1 },
    }],
    protectedContext: [{
      contextKind: "tournament",
      namespace: "tournament_slug",
      protectedValue: value(2),
    }],
    protectedEvidence: [{
      sequenceNumber: 1,
      kind: "race_score_screen",
      protectedReference: value(3),
      sha256: new Uint8Array(32).fill(0xcd),
      mediaType: "image/png",
    }],
    protectedIssues: [{
      sequenceNumber: 1,
      code: "ocr.name_uncertain",
      protectedMessage: value(4),
    }],
  };
}

function fixture(document: AuditedStoredTournamentRevision | null = stored()) {
  const events: string[] = [];
  const repository: TournamentRevisionReadRepository = {
    findRevisionAndAudit: vi.fn(async () => {
      events.push("audit-committed");
      return document;
    }),
  };
  const reader: TournamentRestrictedValueReader = {
    decryptParticipantReference: vi.fn(() => { events.push("participant"); return "local.7"; }),
    decryptContextReference: vi.fn(() => { events.push("context"); return "summer-cup"; }),
    decryptEvidenceReference: vi.fn(() => { events.push("evidence"); return "private/race.png"; }),
    decryptVerificationIssueMessage: vi.fn(() => { events.push("issue"); return "Review name"; }),
  };
  return {
    events, repository, reader,
    service: new TournamentRevisionReadService(repository, reader, { nowMs: () => 9000 }),
  };
}

describe("Tournament revision read service", () => {
  it("audits before decrypting and reconstructs canonical V1", async () => {
    const test = fixture();
    const result = await test.service.readRevision(
      { role: "administrator", userAccountId: "user_account.admin" },
      "tournament_race_result.synthetic1",
      1,
      "administrative_review",
    );

    expect(test.events).toEqual(["audit-committed", "participant", "context", "evidence", "issue"]);
    expect(test.repository.findRevisionAndAudit).toHaveBeenCalledWith({
      raceResultId: "tournament_race_result.synthetic1",
      revision: 1,
      accessorUserAccountId: "user_account.admin",
      purposeCode: "administrative_review",
      accessedAtMs: 9000,
    });
    expect(result.placements[0]?.participantReference).toEqual({
      namespace: "producer_local_player",
      value: "local.7",
    });
    expect(result.context).toEqual({
      tournamentReference: { namespace: "tournament_slug", value: "summer-cup" },
      observedStageLabel: "Final",
    });
    expect(result.evidence?.[0]).toEqual({
      kind: "race_score_screen",
      reference: "private/race.png",
      sha256: "cd".repeat(32),
      mediaType: "image/png",
    });
    expect(result.verification?.issues).toEqual([{
      code: "ocr.name_uncertain",
      message: "Review name",
    }]);
  });

  it.each<ActorContext>([
    { role: "anonymous" },
    { role: "account", userAccountId: "user_account.owner" },
    { role: "migration_operator" },
  ])("rejects $role before repository access", async (actor) => {
    const test = fixture();
    await expect(test.service.readRevision(
      actor,
      "tournament_race_result.synthetic1",
      1,
      "administrative_review",
    )).rejects.toMatchObject({ code: "forbidden" });
    expect(test.repository.findRevisionAndAudit).not.toHaveBeenCalled();
  });

  it("bounds missing and malformed persisted revisions", async () => {
    const missing = fixture(null);
    await expect(missing.service.readRevision(
      { role: "administrator", userAccountId: "user_account.admin" },
      "tournament_race_result.synthetic1", 1, "administrative_review",
    )).rejects.toMatchObject({ code: "not_found" });

    const malformed = fixture({ ...stored(), placements: [] });
    await expect(malformed.service.readRevision(
      { role: "administrator", userAccountId: "user_account.admin" },
      "tournament_race_result.synthetic1", 1, "administrative_review",
    )).rejects.toMatchObject({ code: "read_failed", message: "revision could not be read" });
  });

  it("rejects invalid requests and hides decryption failures", async () => {
    const invalid = fixture();
    await expect(invalid.service.readRevision(
      { role: "administrator", userAccountId: "user_account.admin" },
      "bad", 0, "Private review",
    )).rejects.toMatchObject({ code: "invalid_request" });
    expect(invalid.repository.findRevisionAndAudit).not.toHaveBeenCalled();

    const failed = fixture();
    vi.mocked(failed.reader.decryptContextReference).mockImplementation(() => {
      throw new Error("secret key detail");
    });
    await expect(failed.service.readRevision(
      { role: "administrator", userAccountId: "user_account.admin" },
      "tournament_race_result.synthetic1", 1, "administrative_review",
    )).rejects.toMatchObject({ code: "read_failed", message: "revision could not be read" });
  });
});
