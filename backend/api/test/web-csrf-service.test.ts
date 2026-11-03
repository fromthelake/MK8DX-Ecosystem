import { describe, expect, it } from "vitest";

import {
  WebCsrfConfigurationError,
  WebCsrfIssuanceError,
  WebCsrfService,
} from "../src/security/web-csrf-service.js";


const accountActor = {
  role: "account" as const,
  userAccountId: "user_account.web_csrf_owner_01",
};

function harness() {
  let nowMs = 1_786_915_000_000;
  let nonceByte = 1;
  const activeKey = Uint8Array.from({ length: 32 }, () => 11);
  const oldKey = Uint8Array.from({ length: 32 }, () => 12);
  const service = new WebCsrfService({
    activeKeyVersion: "csrf-v2",
    keys: {
      "csrf-v1": oldKey,
      "csrf-v2": activeKey,
    },
  }, {
    nowMs: () => nowMs,
  }, {
    newNonce: () => Uint8Array.from({ length: 24 }, () => nonceByte++),
  });
  return {
    service,
    activeKey,
    oldKey,
    setNow(value: number): void { nowMs = value; },
  };
}

describe("provider-neutral web CSRF service", () => {
  it("issues fresh account-bound proofs without embedding the account ID", () => {
    const test = harness();
    const first = test.service.issue(accountActor);
    const second = test.service.issue(accountActor);

    expect(first).toMatchObject({
      schemaVersion: "mk8dx.web-csrf.v1",
      headerName: "X-MK8DX-CSRF",
    });
    expect(first.value).toMatch(
      /^v1\.csrf-v2\.[0-9]+\.[A-Za-z0-9_-]{32}\.[A-Za-z0-9_-]{43}$/,
    );
    expect(first.value).not.toContain(accountActor.userAccountId);
    expect(second.value).not.toBe(first.value);
    expect(test.service.verify(accountActor, first.value)).toBe(true);
    expect(test.service.verify(accountActor, second.value)).toBe(true);
  });

  it("rejects a different account, actor class, or modified proof", () => {
    const test = harness();
    const proof = test.service.issue(accountActor).value;
    expect(test.service.verify({
      role: "account",
      userAccountId: "user_account.someone_else_01",
    }, proof)).toBe(false);
    expect(test.service.verify({ role: "anonymous" }, proof)).toBe(false);
    expect(test.service.verify({ role: "migration_operator" }, proof)).toBe(false);
    expect(test.service.verify(
      accountActor,
      `${proof.slice(0, -1)}${proof.endsWith("A") ? "B" : "A"}`,
    )).toBe(false);
  });

  it("enforces expiry and bounded future skew", () => {
    const test = harness();
    const proof = test.service.issue(accountActor).value;
    test.setNow(1_786_915_900_001);
    expect(test.service.verify(accountActor, proof)).toBe(false);
    test.setNow(1_786_914_939_999);
    expect(test.service.verify(accountActor, proof)).toBe(false);
    test.setNow(1_786_914_940_000);
    expect(test.service.verify(accountActor, proof)).toBe(true);
  });

  it("retains verification keys and copies caller-owned key bytes", () => {
    const test = harness();
    const proof = test.service.issue(accountActor).value;
    const oldIssuer = new WebCsrfService({
      activeKeyVersion: "csrf-v1",
      keys: { "csrf-v1": test.oldKey },
    }, {
      nowMs: () => 1_786_915_000_000,
    }, {
      newNonce: () => Uint8Array.from({ length: 24 }, () => 31),
    });
    const oldProof = oldIssuer.issue(accountActor).value;
    expect(test.service.verify(accountActor, oldProof)).toBe(true);
    test.activeKey.fill(0);
    test.oldKey.fill(0);
    expect(test.service.verify(accountActor, proof)).toBe(true);
    expect(test.service.verify(accountActor, oldProof)).toBe(true);
  });

  it("fails closed for malformed proofs", () => {
    const test = harness();
    for (const proof of [
      "",
      "v2.csrf-v2.1786915000000.nonce.signature",
      "v1.unknown.1786915000000.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA." +
        "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      "v1.csrf-v2.NaN.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA." +
        "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      "x".repeat(4_097),
    ]) {
      expect(test.service.verify(accountActor, proof)).toBe(false);
    }
  });

  it("distinguishes unauthenticated issuance from forbidden actor classes", () => {
    const service = harness().service;
    expect(() => service.issue({ role: "anonymous" })).toThrowError(
      new WebCsrfIssuanceError("not_authenticated"),
    );
    expect(() => service.issue({ role: "migration_operator" })).toThrowError(
      new WebCsrfIssuanceError("not_authorized"),
    );
  });

  it("rejects missing, malformed, or short key material and invalid TTL", () => {
    const clock = { nowMs: () => 1 };
    const nonce = { newNonce: () => new Uint8Array(24) };
    const invalid = [
      { activeKeyVersion: "missing", keys: {} },
      { activeKeyVersion: "BAD", keys: { BAD: new Uint8Array(32) } },
      { activeKeyVersion: "short", keys: { short: new Uint8Array(31) } },
    ];
    for (const keys of invalid) {
      expect(() => new WebCsrfService(keys, clock, nonce))
        .toThrow(WebCsrfConfigurationError);
    }
    expect(() => new WebCsrfService({
      activeKeyVersion: "valid",
      keys: { valid: new Uint8Array(32) },
    }, clock, nonce, 1)).toThrow(WebCsrfConfigurationError);
  });
});
