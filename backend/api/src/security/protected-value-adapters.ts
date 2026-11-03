import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

import type {
  ProtectedLookupValue,
  ProtectedValue,
  TimeTrialPlayerReference,
  TimeTrialSensitiveValueProtector,
} from "../timetrials/submission-service.js";
import type {
  TournamentProtectedLookupValue,
  TournamentProtectedValue,
  TournamentSensitiveValueProtector,
} from "../tournaments/race-result-service.js";
import type { TournamentParticipantReference } from
  "../tournaments/race-result-validation.js";

const keyVersionPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const nonceLength = 12;
const tagLength = 16;
const envelopeVersion = 1;

export type ProtectedValueKeyMaterial = Readonly<{
  encryptionKey: Uint8Array;
  encryptionKeyVersion: string;
  lookupHmacKey: Uint8Array;
  lookupKeyVersion: string;
}>;

export type ProtectedValueNonceSource = (length: number) => Uint8Array;

export class ProtectedValueConfigurationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ProtectedValueConfigurationError";
  }
}

export class ProtectedValueDecryptionError extends Error {
  public constructor() {
    super("protected value could not be decrypted");
    this.name = "ProtectedValueDecryptionError";
  }
}

export type ProtectedValueDecryptionKeyring = Readonly<
  Record<string, Uint8Array>
>;

function encodeSegments(segments: readonly string[]): Buffer {
  const encoded: Buffer[] = [];
  for (const segment of segments) {
    const value = Buffer.from(segment, "utf8");
    const length = Buffer.alloc(4);
    length.writeUInt32BE(value.length);
    encoded.push(length, value);
  }
  return Buffer.concat(encoded);
}

class ProtectedValueCodec {
  private readonly encryptionKey: Buffer;
  private readonly lookupHmacKey: Buffer;
  private readonly encryptionKeyVersion: string;
  private readonly lookupKeyVersion: string;

  public constructor(
    keyMaterial: ProtectedValueKeyMaterial,
    private readonly nonceSource: ProtectedValueNonceSource,
  ) {
    if (keyMaterial.encryptionKey.length !== 32 || keyMaterial.lookupHmacKey.length !== 32) {
      throw new ProtectedValueConfigurationError(
        "encryption and lookup HMAC keys must each contain exactly 32 bytes",
      );
    }
    if (!keyVersionPattern.test(keyMaterial.encryptionKeyVersion) ||
      !keyVersionPattern.test(keyMaterial.lookupKeyVersion)) {
      throw new ProtectedValueConfigurationError("protected-value key version is invalid");
    }
    if (Buffer.from(keyMaterial.encryptionKey).equals(Buffer.from(keyMaterial.lookupHmacKey))) {
      throw new ProtectedValueConfigurationError(
        "encryption and lookup HMAC keys must be distinct",
      );
    }
    this.encryptionKey = Buffer.from(keyMaterial.encryptionKey);
    this.lookupHmacKey = Buffer.from(keyMaterial.lookupHmacKey);
    this.encryptionKeyVersion = keyMaterial.encryptionKeyVersion;
    this.lookupKeyVersion = keyMaterial.lookupKeyVersion;
  }

  public protect(domain: string, value: string): ProtectedValue {
    const plaintext = Buffer.from(value, "utf8");
    const nonce = Buffer.from(this.nonceSource(nonceLength));
    if (nonce.length !== nonceLength) {
      throw new ProtectedValueConfigurationError(
        "protected-value nonce source returned an invalid nonce",
      );
    }
    const aad = encodeSegments([
      "mk8dx.protected-value.v1",
      domain,
      this.encryptionKeyVersion,
    ]);
    const cipher = createCipheriv("aes-256-gcm", this.encryptionKey, nonce, {
      authTagLength: tagLength,
    });
    cipher.setAAD(aad);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    return {
      ciphertext: Uint8Array.from(Buffer.concat([
        Buffer.from([envelopeVersion]),
        nonce,
        tag,
        ciphertext,
      ])),
      encryptionKeyVersion: this.encryptionKeyVersion,
    };
  }

  public protectLookup(
    domain: string,
    namespace: string,
    value: string,
  ): ProtectedLookupValue {
    const protectedValue = this.protect(domain, value);
    const lookupInput = encodeSegments([
      "mk8dx.protected-lookup.v1",
      domain,
      namespace,
      value,
    ]);
    return {
      ...protectedValue,
      lookupHmac: Uint8Array.from(
        createHmac("sha256", this.lookupHmacKey).update(lookupInput).digest(),
      ),
      lookupKeyVersion: this.lookupKeyVersion,
    };
  }
}

class ProtectedValueDecoder {
  private readonly encryptionKeys = new Map<string, Buffer>();

  public constructor(keyring: ProtectedValueDecryptionKeyring) {
    const entries = Object.entries(keyring);
    if (entries.length === 0) {
      throw new ProtectedValueConfigurationError(
        "protected-value decryption keyring must not be empty",
      );
    }
    for (const [version, key] of entries) {
      if (!keyVersionPattern.test(version)) {
        throw new ProtectedValueConfigurationError(
          "protected-value key version is invalid",
        );
      }
      if (key.length !== 32) {
        throw new ProtectedValueConfigurationError(
          "protected-value decryption keys must each contain exactly 32 bytes",
        );
      }
      this.encryptionKeys.set(version, Buffer.from(key));
    }
  }

  public decrypt(domain: string, value: ProtectedValue): string {
    try {
      const key = this.encryptionKeys.get(value.encryptionKeyVersion);
      const envelope = Buffer.from(value.ciphertext);
      if (key === undefined || envelope.length < 1 + nonceLength + tagLength ||
        envelope[0] !== envelopeVersion) {
        throw new ProtectedValueDecryptionError();
      }
      const nonceStart = 1;
      const tagStart = nonceStart + nonceLength;
      const ciphertextStart = tagStart + tagLength;
      const nonce = envelope.subarray(nonceStart, tagStart);
      const tag = envelope.subarray(tagStart, ciphertextStart);
      const ciphertext = envelope.subarray(ciphertextStart);
      const aad = encodeSegments([
        "mk8dx.protected-value.v1",
        domain,
        value.encryptionKeyVersion,
      ]);
      const decipher = createDecipheriv("aes-256-gcm", key, nonce, {
        authTagLength: tagLength,
      });
      decipher.setAAD(aad);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    } catch (error) {
      if (error instanceof ProtectedValueDecryptionError) {
        throw error;
      }
      throw new ProtectedValueDecryptionError();
    }
  }
}

export class TimeTrialProtectedValueAdapter
implements TimeTrialSensitiveValueProtector {
  private readonly codec: ProtectedValueCodec;

  public constructor(
    keyMaterial: ProtectedValueKeyMaterial,
    nonceSource: ProtectedValueNonceSource = (length) => randomBytes(length),
  ) {
    this.codec = new ProtectedValueCodec(keyMaterial, nonceSource);
  }

  public async protectParticipantReference(
    namespace: Exclude<TimeTrialPlayerReference["namespace"], "player">,
    value: string,
  ): Promise<ProtectedLookupValue> {
    return this.codec.protectLookup(
      "timetrial.participant-reference",
      namespace,
      value,
    );
  }

  public async protectEvidenceReference(reference: string): Promise<ProtectedValue> {
    return this.codec.protect("timetrial.evidence-reference", reference);
  }
}

export class TimeTrialProtectedValueReader {
  private readonly decoder: ProtectedValueDecoder;

  public constructor(keyring: ProtectedValueDecryptionKeyring) {
    this.decoder = new ProtectedValueDecoder(keyring);
  }

  public decryptParticipantReference(value: ProtectedValue): string {
    return this.decoder.decrypt("timetrial.participant-reference", value);
  }

  public decryptEvidenceReference(value: ProtectedValue): string {
    return this.decoder.decrypt("timetrial.evidence-reference", value);
  }
}

// Web Push subscription endpoints and keys are bearer capabilities. They use
// the existing protected-value envelope with a distinct authenticated domain;
// plaintext subscription JSON never reaches MySQL or operational logs.
export class WebPushProtectedValueAdapter {
  private readonly codec: ProtectedValueCodec;

  public constructor(
    keyMaterial: ProtectedValueKeyMaterial,
    nonceSource: ProtectedValueNonceSource = (length) => randomBytes(length),
  ) {
    this.codec = new ProtectedValueCodec(keyMaterial, nonceSource);
  }

  public protectSubscription(document: string): ProtectedValue {
    return this.codec.protect("web-push.subscription", document);
  }
}

export class WebPushProtectedValueReader {
  private readonly decoder: ProtectedValueDecoder;

  public constructor(keyring: ProtectedValueDecryptionKeyring) {
    this.decoder = new ProtectedValueDecoder(keyring);
  }

  public decryptSubscription(value: ProtectedValue): string {
    return this.decoder.decrypt("web-push.subscription", value);
  }
}

export class TournamentProtectedValueAdapter
implements TournamentSensitiveValueProtector {
  private readonly codec: ProtectedValueCodec;

  public constructor(
    keyMaterial: ProtectedValueKeyMaterial,
    nonceSource: ProtectedValueNonceSource = (length) => randomBytes(length),
  ) {
    this.codec = new ProtectedValueCodec(keyMaterial, nonceSource);
  }

  public async protectParticipantReference(
    namespace: Exclude<TournamentParticipantReference["namespace"], "player">,
    value: string,
  ): Promise<TournamentProtectedLookupValue> {
    return this.codec.protectLookup(
      "tournament.participant-reference",
      namespace,
      value,
    );
  }

  public async protectContextReference(
    namespace: string,
    value: string,
  ): Promise<TournamentProtectedLookupValue> {
    return this.codec.protectLookup(
      "tournament.context-reference",
      namespace,
      value,
    );
  }

  public async protectEvidenceReference(
    reference: string,
  ): Promise<TournamentProtectedValue> {
    return this.codec.protect("tournament.evidence-reference", reference);
  }

  public async protectVerificationIssueMessage(
    message: string,
  ): Promise<TournamentProtectedValue> {
    return this.codec.protect("tournament.verification-issue", message);
  }
}

export class TournamentProtectedValueReader {
  private readonly decoder: ProtectedValueDecoder;

  public constructor(keyring: ProtectedValueDecryptionKeyring) {
    this.decoder = new ProtectedValueDecoder(keyring);
  }

  public decryptParticipantReference(value: TournamentProtectedValue): string {
    return this.decoder.decrypt("tournament.participant-reference", value);
  }

  public decryptContextReference(value: TournamentProtectedValue): string {
    return this.decoder.decrypt("tournament.context-reference", value);
  }

  public decryptEvidenceReference(value: TournamentProtectedValue): string {
    return this.decoder.decrypt("tournament.evidence-reference", value);
  }

  public decryptVerificationIssueMessage(value: TournamentProtectedValue): string {
    return this.decoder.decrypt("tournament.verification-issue", value);
  }
}
