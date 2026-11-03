import { describe, expect, it, vi } from "vitest";

import type { ActorContext } from "../src/identity/types.js";
import {
  TimeTrialRevisionReadError,
  TimeTrialRevisionReadService,
  type AuditedStoredTimeTrialRevision,
  type TimeTrialRevisionReadRepository,
  type TimeTrialRestrictedValueReader,
} from "../src/timetrials/revision-read-service.js";

const publicFields: AuditedStoredTimeTrialRevision["publicFields"] = {
  schemaVersion: "mk8dx.time-trial-submission.v1",
  submissionId: "user_submission.time.synthetic1",
  revision: 2,
  mode: 150,
  trackId: "track.mario_kart_stadium",
  totalTimeMs: 180000,
  laps: [
    { lapNumber: 1, timeMs: 60000 },
    { lapNumber: 2, timeMs: 60000 },
    { lapNumber: 3, timeMs: 60000 },
  ],
  source: { kind: "android_scan", producerVersion: "synthetic" },
  timestamps: { createdAtMs: 1000 },
};

function protectedValue(seed: number) {
  return {
    ciphertext: Uint8Array.from([seed]),
    encryptionKeyVersion: "enc-v1",
  };
}

function storedRevision(): AuditedStoredTimeTrialRevision {
  return {
    publicFields,
    playerId: null,
    restrictedParticipant: {
      namespace: "producer_local_profile",
      protectedValue: protectedValue(1),
    },
    protectedEvidence: [{
      sequenceNumber: 1,
      kind: "screenshot",
      protectedReference: protectedValue(2),
      sha256: new Uint8Array(32).fill(0xab),
      mediaType: "image/png",
    }],
  };
}

function service(
  stored: AuditedStoredTimeTrialRevision | null = storedRevision(),
  events: string[] = [],
) {
  const repository: TimeTrialRevisionReadRepository = {
    findRevisionAndAudit: vi.fn(async () => {
      events.push("audit-committed");
      return stored;
    }),
  };
  const reader: TimeTrialRestrictedValueReader = {
    decryptParticipantReference: vi.fn(() => {
      events.push("participant-decrypted");
      return "local-profile-7";
    }),
    decryptEvidenceReference: vi.fn(() => {
      events.push("evidence-decrypted");
      return "private/synthetic.png";
    }),
  };
  return {
    repository,
    reader,
    service: new TimeTrialRevisionReadService(repository, reader, { nowMs: () => 9000 }),
  };
}

describe("Time Trial revision read service", () => {
  it("audits before decrypting and reconstructs canonical V1", async () => {
    const events: string[] = [];
    const fixture = service(storedRevision(), events);

    const result = await fixture.service.readRevision(
      { role: "administrator", userAccountId: "user_account.admin" },
      "user_submission.time.synthetic1",
      2,
      "administrative_review",
    );

    expect(events).toEqual([
      "audit-committed",
      "participant-decrypted",
      "evidence-decrypted",
    ]);
    expect(fixture.repository.findRevisionAndAudit).toHaveBeenCalledWith({
      submissionId: "user_submission.time.synthetic1",
      revision: 2,
      accessorUserAccountId: "user_account.admin",
      purposeCode: "administrative_review",
      accessedAtMs: 9000,
    });
    expect(result.playerReference).toEqual({
      namespace: "producer_local_profile",
      value: "local-profile-7",
    });
    expect(result.evidence).toEqual([{
      kind: "screenshot",
      reference: "private/synthetic.png",
      sha256: "ab".repeat(32),
      mediaType: "image/png",
    }]);
  });

  it("does not decrypt or audit central-player revisions without protected rows", async () => {
    const fixture = service({
      publicFields,
      playerId: "player.synthetic",
      restrictedParticipant: null,
      protectedEvidence: [],
    });

    const result = await fixture.service.readRevision(
      { role: "administrator", userAccountId: "user_account.admin" },
      "user_submission.time.synthetic1",
      2,
      "administrative_review",
    );

    expect(result.playerReference).toEqual({ namespace: "player", value: "player.synthetic" });
    expect(result).not.toHaveProperty("evidence");
    expect(fixture.reader.decryptParticipantReference).not.toHaveBeenCalled();
    expect(fixture.reader.decryptEvidenceReference).not.toHaveBeenCalled();
  });

  it.each<ActorContext>([
    { role: "anonymous" },
    { role: "account", userAccountId: "user_account.owner" },
    { role: "migration_operator" },
  ])("rejects $role before storage access", async (actor) => {
    const fixture = service();
    await expect(fixture.service.readRevision(
      actor,
      "user_submission.time.synthetic1",
      2,
      "administrative_review",
    )).rejects.toMatchObject({ code: "forbidden" });
    expect(fixture.repository.findRevisionAndAudit).not.toHaveBeenCalled();
  });

  it.each([
    ["bad submission", "bad", 2, "administrative_review"],
    ["bad revision", "user_submission.time.synthetic1", 0, "administrative_review"],
    ["bad purpose", "user_submission.time.synthetic1", 2, "Private review"],
  ])("rejects %s before storage access", async (_label, id, revision, purpose) => {
    const fixture = service();
    await expect(fixture.service.readRevision(
      { role: "administrator", userAccountId: "user_account.admin" },
      id,
      revision,
      purpose,
    )).rejects.toMatchObject({ code: "invalid_request" });
    expect(fixture.repository.findRevisionAndAudit).not.toHaveBeenCalled();
  });

  it("returns a bounded missing error", async () => {
    const fixture = service(null);
    await expect(fixture.service.readRevision(
      { role: "administrator", userAccountId: "user_account.admin" },
      "user_submission.time.synthetic1",
      2,
      "administrative_review",
    )).rejects.toMatchObject({ code: "not_found" });
  });

  it("rejects malformed persisted shape after the audit boundary", async () => {
    const fixture = service({
      ...storedRevision(),
      playerId: "player.synthetic",
    });
    await expect(fixture.service.readRevision(
      { role: "administrator", userAccountId: "user_account.admin" },
      "user_submission.time.synthetic1",
      2,
      "administrative_review",
    )).rejects.toEqual(new TimeTrialRevisionReadError(
      "read_failed",
      "revision could not be read",
    ));
  });

  it("does not expose decryption failures", async () => {
    const fixture = service();
    vi.mocked(fixture.reader.decryptParticipantReference).mockImplementation(() => {
      throw new Error("key version enc-secret missing");
    });

    await expect(fixture.service.readRevision(
      { role: "administrator", userAccountId: "user_account.admin" },
      "user_submission.time.synthetic1",
      2,
      "administrative_review",
    )).rejects.toEqual(new TimeTrialRevisionReadError(
      "read_failed",
      "revision could not be read",
    ));
  });
});
