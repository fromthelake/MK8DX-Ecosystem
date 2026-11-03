import { describe, expect, it } from "vitest";

import {
  ProtectedValueConfigurationError,
  ProtectedValueDecryptionError,
  TimeTrialProtectedValueAdapter,
  TimeTrialProtectedValueReader,
  TournamentProtectedValueAdapter,
  TournamentProtectedValueReader,
  type ProtectedValueKeyMaterial,
} from "../src/security/protected-value-adapters.js";

function keyMaterial(): ProtectedValueKeyMaterial {
  return {
    encryptionKey: Uint8Array.from({ length: 32 }, (_, index) => index),
    encryptionKeyVersion: "enc-v1",
    lookupHmacKey: Uint8Array.from({ length: 32 }, (_, index) => index + 32),
    lookupKeyVersion: "lookup-v1",
  };
}

function fixedNonce(length: number): Uint8Array {
  expect(length).toBe(12);
  return Uint8Array.from({ length }, (_, index) => 0xa0 + index);
}

function hex(value: Uint8Array): string {
  return Buffer.from(value).toString("hex");
}

type EnvelopeMutation = Readonly<{
  encryptionKeyVersion?: string;
  ciphertextPrefix?: number;
  truncate?: boolean;
  modifyLastByte?: boolean;
}>;

describe("provider-neutral protected value adapters", () => {
  it("matches the pinned AES-256-GCM and HMAC-SHA256 vector", async () => {
    const adapter = new TimeTrialProtectedValueAdapter(keyMaterial(), fixedNonce);
    const protectedValue = await adapter.protectParticipantReference(
      "producer_local_profile",
      "synthetic.profile",
    );

    expect(protectedValue).toMatchObject({
      encryptionKeyVersion: "enc-v1",
      lookupKeyVersion: "lookup-v1",
    });
    expect(hex(protectedValue.ciphertext)).toBe(
      "01a0a1a2a3a4a5a6a7a8a9aaabc5c86906ef192e38941049da549ee53c956112592dae76d6014bf7a1681ca9b215",
    );
    expect(hex(protectedValue.lookupHmac)).toBe(
      "68fcd62adb9241d3fcd556d71141077beaf00548c103cc6ce8a0d79e210a3a52",
    );
    expect(Buffer.from(protectedValue.ciphertext).includes(Buffer.from("synthetic.profile")))
      .toBe(false);
  });

  it("uses random nonces while keeping lookup HMAC deterministic", async () => {
    const adapter = new TimeTrialProtectedValueAdapter(keyMaterial());
    const first = await adapter.protectParticipantReference(
      "unresolved_observation",
      "same-private-value",
    );
    const second = await adapter.protectParticipantReference(
      "unresolved_observation",
      "same-private-value",
    );

    expect(hex(first.lookupHmac)).toBe(hex(second.lookupHmac));
    expect(hex(first.ciphertext)).not.toBe(hex(second.ciphertext));
    expect(first.ciphertext[0]).toBe(1);
    expect(second.ciphertext[0]).toBe(1);
  });

  it("domain-separates products, resource kinds, and namespaces", async () => {
    const timeTrial = new TimeTrialProtectedValueAdapter(keyMaterial(), fixedNonce);
    const tournament = new TournamentProtectedValueAdapter(keyMaterial(), fixedNonce);
    const value = "same-private-value";
    const ttParticipant = await timeTrial.protectParticipantReference(
      "unresolved_observation",
      value,
    );
    const tournamentParticipant = await tournament.protectParticipantReference(
      "unresolved_observation",
      value,
    );
    const tournamentContext = await tournament.protectContextReference(
      "unresolved_observation",
      value,
    );
    const otherNamespace = await tournament.protectParticipantReference(
      "producer_local_player",
      value,
    );

    const digests = [
      ttParticipant,
      tournamentParticipant,
      tournamentContext,
      otherNamespace,
    ].map((item) => hex(item.lookupHmac));
    expect(new Set(digests)).toHaveLength(4);
    expect(hex(ttParticipant.ciphertext)).not.toBe(
      hex(tournamentParticipant.ciphertext),
    );
    expect(hex(tournamentParticipant.ciphertext)).not.toBe(
      hex(tournamentContext.ciphertext),
    );
  });

  it("protects evidence and issue messages without adding lookup digests", async () => {
    const tournament = new TournamentProtectedValueAdapter(keyMaterial(), fixedNonce);
    const evidence = await tournament.protectEvidenceReference("private/evidence.png");
    const issue = await tournament.protectVerificationIssueMessage("Private review note");

    expect(evidence).not.toHaveProperty("lookupHmac");
    expect(issue).not.toHaveProperty("lookupHmac");
    expect(hex(evidence.ciphertext)).not.toBe(hex(issue.ciphertext));
    expect(evidence.encryptionKeyVersion).toBe("enc-v1");
  });

  it("copies caller keys so later mutation cannot change results", async () => {
    const material = keyMaterial();
    const adapter = new TimeTrialProtectedValueAdapter(material, fixedNonce);
    material.encryptionKey.fill(255);
    material.lookupHmacKey.fill(255);

    const protectedValue = await adapter.protectParticipantReference(
      "producer_local_profile",
      "synthetic.profile",
    );
    expect(hex(protectedValue.lookupHmac)).toBe(
      "68fcd62adb9241d3fcd556d71141077beaf00548c103cc6ce8a0d79e210a3a52",
    );
  });

  it.each([
    ["short encryption key", { ...keyMaterial(), encryptionKey: new Uint8Array(31) }],
    ["short HMAC key", { ...keyMaterial(), lookupHmacKey: new Uint8Array(31) }],
    ["invalid key version", { ...keyMaterial(), encryptionKeyVersion: "bad version" }],
    ["reused key", {
      ...keyMaterial(),
      lookupHmacKey: Uint8Array.from({ length: 32 }, (_, index) => index),
    }],
  ])("rejects %s configuration", (_label, material) => {
    expect(() => new TimeTrialProtectedValueAdapter(material)).toThrow(
      ProtectedValueConfigurationError,
    );
  });

  it("rejects a malformed injected nonce source", async () => {
    const adapter = new TimeTrialProtectedValueAdapter(
      keyMaterial(),
      () => new Uint8Array(11),
    );
    await expect(adapter.protectEvidenceReference("synthetic-evidence"))
      .rejects.toThrow("nonce source returned an invalid nonce");
  });

  it("decrypts each protected domain through a versioned keyring", async () => {
    const timeTrialWriter = new TimeTrialProtectedValueAdapter(keyMaterial(), fixedNonce);
    const tournamentWriter = new TournamentProtectedValueAdapter(keyMaterial(), fixedNonce);
    const timeTrialReader = new TimeTrialProtectedValueReader({
      "enc-v1": keyMaterial().encryptionKey,
    });
    const tournamentReader = new TournamentProtectedValueReader({
      "enc-v1": keyMaterial().encryptionKey,
    });

    expect(timeTrialReader.decryptParticipantReference(
      await timeTrialWriter.protectParticipantReference(
        "producer_local_profile",
        "synthetic.profile",
      ),
    )).toBe("synthetic.profile");
    expect(timeTrialReader.decryptEvidenceReference(
      await timeTrialWriter.protectEvidenceReference("private/tt.png"),
    )).toBe("private/tt.png");
    expect(tournamentReader.decryptParticipantReference(
      await tournamentWriter.protectParticipantReference(
        "producer_local_player",
        "synthetic.player",
      ),
    )).toBe("synthetic.player");
    expect(tournamentReader.decryptContextReference(
      await tournamentWriter.protectContextReference("tournament_slug", "private-cup"),
    )).toBe("private-cup");
    expect(tournamentReader.decryptEvidenceReference(
      await tournamentWriter.protectEvidenceReference("private/race.png"),
    )).toBe("private/race.png");
    expect(tournamentReader.decryptVerificationIssueMessage(
      await tournamentWriter.protectVerificationIssueMessage("review privately"),
    )).toBe("review privately");
  });

  it("copies decryption keys so caller mutation cannot change reads", async () => {
    const material = keyMaterial();
    const writer = new TimeTrialProtectedValueAdapter(material, fixedNonce);
    const protectedValue = await writer.protectEvidenceReference("stable private value");
    const key = Uint8Array.from(material.encryptionKey);
    const reader = new TimeTrialProtectedValueReader({ "enc-v1": key });
    key.fill(255);

    expect(reader.decryptEvidenceReference(protectedValue)).toBe("stable private value");
  });

  it.each<readonly [string, EnvelopeMutation]>([
    ["unknown key version", { encryptionKeyVersion: "enc-v2" }],
    ["unknown envelope version", { ciphertextPrefix: 2 }],
    ["truncated envelope", { truncate: true }],
    ["modified ciphertext", { modifyLastByte: true }],
  ])("rejects %s without exposing the cause", async (_label, mutation) => {
    const writer = new TimeTrialProtectedValueAdapter(keyMaterial(), fixedNonce);
    const original = await writer.protectEvidenceReference("private value");
    const ciphertext = mutation.truncate
      ? original.ciphertext.slice(0, 20)
      : Uint8Array.from(original.ciphertext);
    if (mutation.ciphertextPrefix !== undefined) {
      ciphertext[0] = mutation.ciphertextPrefix;
    }
    if (mutation.modifyLastByte) {
      const lastIndex = ciphertext.length - 1;
      ciphertext[lastIndex] = (ciphertext[lastIndex] ?? 0) ^ 1;
    }
    const reader = new TimeTrialProtectedValueReader({
      "enc-v1": keyMaterial().encryptionKey,
    });

    expect(() => reader.decryptEvidenceReference({
      ciphertext,
      encryptionKeyVersion:
        mutation.encryptionKeyVersion ?? original.encryptionKeyVersion,
    })).toThrowError(new ProtectedValueDecryptionError());
  });

  it.each([
    ["empty keyring", {}],
    ["invalid version", { "bad version": keyMaterial().encryptionKey }],
    ["short key", { "enc-v1": new Uint8Array(31) }],
  ])("rejects %s for decryption", (_label, keyring) => {
    expect(() => new TimeTrialProtectedValueReader(keyring)).toThrow(
      ProtectedValueConfigurationError,
    );
  });

  it("rejects decryption through the wrong protected domain", async () => {
    const writer = new TimeTrialProtectedValueAdapter(keyMaterial(), fixedNonce);
    const protectedValue = await writer.protectEvidenceReference("private value");
    const reader = new TournamentProtectedValueReader({
      "enc-v1": keyMaterial().encryptionKey,
    });

    expect(() => reader.decryptEvidenceReference(protectedValue)).toThrow(
      ProtectedValueDecryptionError,
    );
  });
});
