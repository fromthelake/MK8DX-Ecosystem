import { describe, expect, it } from "vitest";

import {
  AuthenticationSubjectHmacConfigurationError,
  AuthenticationSubjectHmacInputError,
  AuthenticationSubjectHmacKeyringProtector,
  AuthenticationSubjectHmacProtector,
  type AuthenticationSubjectHmacKeyMaterial,
} from "../src/authentication/authentication-subject-hmac-protector.js";

function keyMaterial(): AuthenticationSubjectHmacKeyMaterial {
  return {
    lookupHmacKey: Uint8Array.from({ length: 32 }, (_, index) => index + 64),
    lookupKeyVersion: "auth_lookup_v1",
  };
}

function hex(value: Uint8Array): string {
  return Buffer.from(value).toString("hex");
}

describe("authentication subject HMAC protector", () => {
  it("matches the pinned domain-separated HMAC-SHA256 vector", () => {
    const protector = new AuthenticationSubjectHmacProtector(keyMaterial());
    const protectedSubject = protector.protectVerifiedSubject(
      "synthetic_issuer",
      "provider-subject-123",
    );

    expect(protectedSubject).toMatchObject({
      issuerKey: "synthetic_issuer",
      lookupKeyVersion: "auth_lookup_v1",
    });
    expect(hex(protectedSubject.subjectLookupHmac)).toBe(
      "23608eb58fc1d5ccdc677b9f5cb382d577007741180709e03d148faac4c145bb",
    );
    expect(protectedSubject.subjectLookupHmac).toHaveLength(32);
    expect(JSON.stringify(protectedSubject)).not.toContain("provider-subject-123");
  });

  it("is deterministic while separating issuer aliases and key versions", () => {
    const first = new AuthenticationSubjectHmacProtector(keyMaterial());
    const rotatedLabel = new AuthenticationSubjectHmacProtector({
      ...keyMaterial(),
      lookupKeyVersion: "auth_lookup_v2",
    });
    const value = "same-provider-subject";
    const digests = [
      first.protectVerifiedSubject("issuer_a", value),
      first.protectVerifiedSubject("issuer_a", value),
      first.protectVerifiedSubject("issuer_b", value),
      rotatedLabel.protectVerifiedSubject("issuer_a", value),
    ].map((subject) => hex(subject.subjectLookupHmac));

    expect(digests[0]).toBe(digests[1]);
    expect(new Set([digests[0], digests[2], digests[3]])).toHaveLength(3);
  });

  it("copies the caller key and returns independently owned digest bytes", () => {
    const material = keyMaterial();
    const protector = new AuthenticationSubjectHmacProtector(material);
    material.lookupHmacKey.fill(255);
    const first = protector.protectVerifiedSubject("synthetic_issuer", "stable-subject");
    const expected = hex(first.subjectLookupHmac);
    first.subjectLookupHmac.fill(0);
    const second = protector.protectVerifiedSubject("synthetic_issuer", "stable-subject");

    expect(hex(second.subjectLookupHmac)).toBe(expected);
    expect(hex(second.subjectLookupHmac)).not.toMatch(/^0+$/);
  });

  it.each([
    ["short key", { ...keyMaterial(), lookupHmacKey: new Uint8Array(31) }],
    ["long key", { ...keyMaterial(), lookupHmacKey: new Uint8Array(33) }],
    ["invalid version", { ...keyMaterial(), lookupKeyVersion: "bad version" }],
    ["uppercase version", { ...keyMaterial(), lookupKeyVersion: "AUTH_V1" }],
  ])("rejects %s configuration", (_label, material) => {
    expect(() => new AuthenticationSubjectHmacProtector(material)).toThrow(
      AuthenticationSubjectHmacConfigurationError,
    );
  });

  it.each([
    ["raw URL issuer", "https://issuer.example", "subject"],
    ["uppercase issuer", "Issuer", "subject"],
    ["empty subject", "synthetic_issuer", ""],
    ["oversized subject", "synthetic_issuer", "x".repeat(4_097)],
    ["unpaired surrogate", "synthetic_issuer", "private-\ud800-value"],
  ])("rejects %s without echoing input", (_label, issuer, subject) => {
    const protector = new AuthenticationSubjectHmacProtector(keyMaterial());
    let error: unknown;
    try {
      protector.protectVerifiedSubject(issuer, subject);
    } catch (candidate) {
      error = candidate;
    }
    expect(error).toBeInstanceOf(AuthenticationSubjectHmacInputError);
    if (subject.length > 0) {
      expect(String(error)).not.toContain(subject);
    }
  });

  it("hashes exact well-formed UTF-8 subject bytes without trimming or normalization", () => {
    const protector = new AuthenticationSubjectHmacProtector(keyMaterial());
    const values = ["subject", " subject", "subject ", "café", "cafe\u0301"];
    const digests = values.map((value) =>
      hex(
        protector.protectVerifiedSubject("synthetic_issuer", value)
          .subjectLookupHmac,
      ),
    );
    expect(new Set(digests)).toHaveLength(values.length);
  });

  it("produces active then retained lookup candidates for staged rotation", () => {
    const keyring = new AuthenticationSubjectHmacKeyringProtector({
      active: { lookupHmacKey: new Uint8Array(32).fill(2), lookupKeyVersion: "auth_v2" },
      retained: [{ lookupHmacKey: new Uint8Array(32).fill(1), lookupKeyVersion: "auth_v1" }],
    });
    const candidates = keyring.protectVerifiedSubjectCandidates(
      "synthetic_issuer",
      "provider-subject",
    );
    expect(candidates.map((candidate) => candidate.lookupKeyVersion))
      .toEqual(["auth_v2", "auth_v1"]);
    expect(hex(candidates[0]!.subjectLookupHmac))
      .not.toBe(hex(candidates[1]!.subjectLookupHmac));
  });
});
