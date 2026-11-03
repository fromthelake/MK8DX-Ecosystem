import { createHmac } from "node:crypto";

import type { VerifiedAuthenticationSubject } from
  "./authentication-binding-resolver.js";

const keyPattern = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const maximumSubjectBytes = 4_096;

export type AuthenticationSubjectHmacKeyMaterial = Readonly<{
  lookupHmacKey: Uint8Array;
  lookupKeyVersion: string;
}>;

export type AuthenticationSubjectHmacKeyringMaterial = Readonly<{
  active: AuthenticationSubjectHmacKeyMaterial;
  retained: readonly AuthenticationSubjectHmacKeyMaterial[];
}>;

export class AuthenticationSubjectHmacConfigurationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "AuthenticationSubjectHmacConfigurationError";
  }
}

export class AuthenticationSubjectHmacInputError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "AuthenticationSubjectHmacInputError";
  }
}

function encodeSegments(segments: readonly Buffer[]): Buffer {
  const encoded: Buffer[] = [];
  for (const segment of segments) {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(segment.length);
    encoded.push(length, segment);
  }
  return Buffer.concat(encoded);
}

function validKey(value: string): boolean {
  return value.length <= 64 && keyPattern.test(value);
}

function strictUtf8(value: string): Buffer | null {
  const encoded = Buffer.from(value, "utf8");
  return encoded.toString("utf8") === value ? encoded : null;
}

export class AuthenticationSubjectHmacProtector {
  private readonly lookupHmacKey: Buffer;
  private readonly lookupKeyVersion: string;

  public constructor(keyMaterial: AuthenticationSubjectHmacKeyMaterial) {
    if (keyMaterial.lookupHmacKey.byteLength !== 32) {
      throw new AuthenticationSubjectHmacConfigurationError(
        "authentication subject HMAC key must contain exactly 32 bytes",
      );
    }
    if (!validKey(keyMaterial.lookupKeyVersion)) {
      throw new AuthenticationSubjectHmacConfigurationError(
        "authentication subject lookup key version is invalid",
      );
    }
    this.lookupHmacKey = Buffer.from(keyMaterial.lookupHmacKey);
    this.lookupKeyVersion = keyMaterial.lookupKeyVersion;
  }

  public protectVerifiedSubject(
    issuerKey: string,
    verifiedProviderSubject: string,
  ): VerifiedAuthenticationSubject {
    if (!validKey(issuerKey)) {
      throw new AuthenticationSubjectHmacInputError(
        "authentication issuer key is invalid",
      );
    }
    const subjectBytes = strictUtf8(verifiedProviderSubject);
    if (
      subjectBytes === null ||
      subjectBytes.length < 1 ||
      subjectBytes.length > maximumSubjectBytes
    ) {
      throw new AuthenticationSubjectHmacInputError(
        "verified provider subject is invalid",
      );
    }
    const lookupInput = encodeSegments([
      Buffer.from("mk8dx.authentication-subject-lookup.v1", "ascii"),
      Buffer.from(issuerKey, "ascii"),
      Buffer.from(this.lookupKeyVersion, "ascii"),
      subjectBytes,
    ]);
    return {
      issuerKey,
      lookupKeyVersion: this.lookupKeyVersion,
      subjectLookupHmac: Uint8Array.from(
        createHmac("sha256", this.lookupHmacKey).update(lookupInput).digest(),
      ),
    };
  }
}

export class AuthenticationSubjectHmacKeyringProtector {
  private readonly protectors: readonly AuthenticationSubjectHmacProtector[];

  public constructor(material: AuthenticationSubjectHmacKeyringMaterial) {
    const entries = [material.active, ...material.retained];
    if (entries.length > 8 ||
      new Set(entries.map((entry) => entry.lookupKeyVersion)).size !== entries.length) {
      throw new AuthenticationSubjectHmacConfigurationError(
        "authentication subject HMAC keyring is invalid",
      );
    }
    this.protectors = entries.map((entry) => new AuthenticationSubjectHmacProtector(entry));
  }

  public protectVerifiedSubjectCandidates(
    issuerKey: string,
    verifiedProviderSubject: string,
  ): readonly VerifiedAuthenticationSubject[] {
    return this.protectors.map((protector) =>
      protector.protectVerifiedSubject(issuerKey, verifiedProviderSubject));
  }
}
