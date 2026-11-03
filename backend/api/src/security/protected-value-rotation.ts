import type { RowDataPacket, ResultSetHeader } from "mysql2";
import type { Pool } from "mysql2/promise";

import {
  TimeTrialProtectedValueAdapter,
  TimeTrialProtectedValueReader,
  TournamentProtectedValueAdapter,
  TournamentProtectedValueReader,
  type ProtectedValueDecryptionKeyring,
  type ProtectedValueKeyMaterial,
} from "./protected-value-adapters.js";

export class ProtectedValueRotationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ProtectedValueRotationError";
  }
}

interface ProtectedRow extends RowDataPacket {
  resourceId: unknown;
  namespace: unknown;
  dataKind: unknown;
  subtype: unknown;
  ciphertext: unknown;
  encryptionKeyVersion: unknown;
}

type ProductRotationKeys = Readonly<{
  active: ProtectedValueKeyMaterial;
  decrypt: ProtectedValueDecryptionKeyring;
}>;

export type ProtectedValueRotationKeys = Readonly<{
  timeTrial: ProductRotationKeys;
  tournament: ProductRotationKeys;
}>;

export type ProtectedValueRotationReport = Readonly<{
  mode: "dry_run" | "apply";
  scanned: Readonly<{
    legacyTimeTrialIdentifiers: number;
    timeTrialParticipants: number;
    timeTrialEvidence: number;
    tournamentValues: number;
  }>;
  rotated: Readonly<{
    legacyTimeTrialIdentifiers: number;
    timeTrialParticipants: number;
    timeTrialEvidence: number;
    tournamentValues: number;
  }>;
}>;

function id(value: unknown): number {
  const parsed = typeof value === "string" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isSafeInteger(parsed) || parsed < 1) {
    throw new ProtectedValueRotationError("protected row identifier is invalid");
  }
  return parsed;
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new ProtectedValueRotationError(`protected row ${field} is invalid`);
  }
  return value;
}

function bytes(value: unknown): Uint8Array {
  if (!(value instanceof Uint8Array) || value.byteLength === 0) {
    throw new ProtectedValueRotationError("protected row ciphertext is invalid");
  }
  return Uint8Array.from(value);
}

function timeTrialNamespace(value: unknown):
  "legacy_firebase_user" | "producer_local_profile" | "unresolved_observation" {
  if (value === "legacy_firebase_user" || value === "producer_local_profile" ||
    value === "unresolved_observation") {
    return value;
  }
  throw new ProtectedValueRotationError("Time Trial participant namespace is invalid");
}

function tournamentParticipantNamespace(value: unknown):
  "tournament_manager_player" | "producer_local_player" | "unresolved_observation" {
  if (value === "tournament_manager_player" || value === "producer_local_player" ||
    value === "unresolved_observation") {
    return value;
  }
  throw new ProtectedValueRotationError("Tournament participant namespace is invalid");
}

function current(row: ProtectedRow, keys: ProtectedValueKeyMaterial, lookup: boolean): boolean {
  return text(row.encryptionKeyVersion, "encryption version") === keys.encryptionKeyVersion &&
    (!lookup || text(row["lookupKeyVersion"], "lookup version") === keys.lookupKeyVersion);
}

function verifiedPlaintext(expected: string, actual: string): void {
  if (expected !== actual) {
    throw new ProtectedValueRotationError("new protected envelope verification failed");
  }
}

export async function rotateProtectedValues(
  pool: Pool,
  keys: ProtectedValueRotationKeys,
  apply: boolean,
): Promise<ProtectedValueRotationReport> {
  const connection = await pool.getConnection();
  const ttWriter = new TimeTrialProtectedValueAdapter(keys.timeTrial.active);
  const ttOldReader = new TimeTrialProtectedValueReader(keys.timeTrial.decrypt);
  const ttNewReader = new TimeTrialProtectedValueReader({
    [keys.timeTrial.active.encryptionKeyVersion]: keys.timeTrial.active.encryptionKey,
  });
  const tournamentWriter = new TournamentProtectedValueAdapter(keys.tournament.active);
  const tournamentOldReader = new TournamentProtectedValueReader(keys.tournament.decrypt);
  const tournamentNewReader = new TournamentProtectedValueReader({
    [keys.tournament.active.encryptionKeyVersion]: keys.tournament.active.encryptionKey,
  });
  const scanned = {
    legacyTimeTrialIdentifiers: 0,
    timeTrialParticipants: 0,
    timeTrialEvidence: 0,
    tournamentValues: 0,
  };
  const rotated = {
    legacyTimeTrialIdentifiers: 0,
    timeTrialParticipants: 0,
    timeTrialEvidence: 0,
    tournamentValues: 0,
  };
  try {
    await connection.beginTransaction();
    const [legacyIdentifiers] = await connection.query<ProtectedRow[]>(
      `SELECT legacy_identifier_id AS resourceId, 'legacy_firebase_user' AS namespace,
              lookup_key_version AS lookupKeyVersion,
              identifier_ciphertext AS ciphertext,
              encryption_key_version AS encryptionKeyVersion,
              '' AS dataKind, '' AS subtype
       FROM restricted_legacy_identity_identifiers
       WHERE source_system = 'timetrials_firebase'
         AND identifier_kind = 'firebase_auth_uid'
       ORDER BY legacy_identifier_id FOR UPDATE`,
    );
    scanned.legacyTimeTrialIdentifiers = legacyIdentifiers.length;
    for (const row of legacyIdentifiers) {
      const plaintext = ttOldReader.decryptParticipantReference({
        ciphertext: bytes(row.ciphertext),
        encryptionKeyVersion: text(row.encryptionKeyVersion, "encryption version"),
      });
      if (current(row, keys.timeTrial.active, true)) { continue; }
      const protectedValue = await ttWriter.protectParticipantReference(
        "legacy_firebase_user",
        plaintext,
      );
      verifiedPlaintext(plaintext, ttNewReader.decryptParticipantReference(protectedValue));
      if (apply) {
        const [result] = await connection.execute<ResultSetHeader>(
          `UPDATE restricted_legacy_identity_identifiers
           SET lookup_hash = ?, lookup_key_version = ?, identifier_ciphertext = ?,
               encryption_key_version = ?
           WHERE legacy_identifier_id = ?`,
          [Buffer.from(protectedValue.lookupHmac), protectedValue.lookupKeyVersion,
            Buffer.from(protectedValue.ciphertext), protectedValue.encryptionKeyVersion,
            id(row.resourceId)],
        );
        if (result.affectedRows !== 1) {
          throw new ProtectedValueRotationError("legacy identifier rotation conflicted");
        }
      }
      rotated.legacyTimeTrialIdentifiers += 1;
    }

    const [participants] = await connection.query<ProtectedRow[]>(
      `SELECT time_trial_participant_reference_id AS resourceId,
              reference_namespace AS namespace, lookup_key_version AS lookupKeyVersion,
              reference_ciphertext AS ciphertext,
              encryption_key_version AS encryptionKeyVersion,
              '' AS dataKind, '' AS subtype
       FROM restricted_time_trial_participant_references
       ORDER BY time_trial_participant_reference_id FOR UPDATE`,
    );
    scanned.timeTrialParticipants = participants.length;
    for (const row of participants) {
      const plaintext = ttOldReader.decryptParticipantReference({
        ciphertext: bytes(row.ciphertext),
        encryptionKeyVersion: text(row.encryptionKeyVersion, "encryption version"),
      });
      if (current(row, keys.timeTrial.active, true)) { continue; }
      const protectedValue = await ttWriter.protectParticipantReference(
        timeTrialNamespace(row.namespace),
        plaintext,
      );
      verifiedPlaintext(plaintext, ttNewReader.decryptParticipantReference(protectedValue));
      if (apply) {
        const [result] = await connection.execute<ResultSetHeader>(
          `UPDATE restricted_time_trial_participant_references
           SET lookup_hmac = ?, lookup_key_version = ?, reference_ciphertext = ?,
               encryption_key_version = ?
           WHERE time_trial_participant_reference_id = ?`,
          [Buffer.from(protectedValue.lookupHmac), protectedValue.lookupKeyVersion,
            Buffer.from(protectedValue.ciphertext), protectedValue.encryptionKeyVersion,
            id(row.resourceId)],
        );
        if (result.affectedRows !== 1) {
          throw new ProtectedValueRotationError("Time Trial participant rotation conflicted");
        }
      }
      rotated.timeTrialParticipants += 1;
    }

    const [evidenceRows] = await connection.query<ProtectedRow[]>(
      `SELECT time_trial_evidence_id AS resourceId, NULL AS namespace,
              NULL AS lookupKeyVersion, reference_ciphertext AS ciphertext,
              encryption_key_version AS encryptionKeyVersion,
              '' AS dataKind, '' AS subtype
       FROM restricted_time_trial_evidence
       ORDER BY time_trial_evidence_id FOR UPDATE`,
    );
    scanned.timeTrialEvidence = evidenceRows.length;
    for (const row of evidenceRows) {
      const plaintext = ttOldReader.decryptEvidenceReference({
        ciphertext: bytes(row.ciphertext),
        encryptionKeyVersion: text(row.encryptionKeyVersion, "encryption version"),
      });
      if (current(row, keys.timeTrial.active, false)) { continue; }
      const protectedValue = await ttWriter.protectEvidenceReference(plaintext);
      verifiedPlaintext(plaintext, ttNewReader.decryptEvidenceReference(protectedValue));
      if (apply) {
        const [result] = await connection.execute<ResultSetHeader>(
          `UPDATE restricted_time_trial_evidence
           SET reference_ciphertext = ?, encryption_key_version = ?
           WHERE time_trial_evidence_id = ?`,
          [Buffer.from(protectedValue.ciphertext), protectedValue.encryptionKeyVersion,
            id(row.resourceId)],
        );
        if (result.affectedRows !== 1) {
          throw new ProtectedValueRotationError("Time Trial evidence rotation conflicted");
        }
      }
      rotated.timeTrialEvidence += 1;
    }

    const [tournamentRows] = await connection.query<ProtectedRow[]>(
      `SELECT tournament_restricted_data_id AS resourceId,
              reference_namespace AS namespace, lookup_key_version AS lookupKeyVersion,
              data_kind AS dataKind, subtype, value_ciphertext AS ciphertext,
              encryption_key_version AS encryptionKeyVersion
       FROM restricted_tournament_race_data
       ORDER BY tournament_restricted_data_id FOR UPDATE`,
    );
    scanned.tournamentValues = tournamentRows.length;
    for (const row of tournamentRows) {
      const dataKind = text(row.dataKind, "data kind");
      const stored = {
        ciphertext: bytes(row.ciphertext),
        encryptionKeyVersion: text(row.encryptionKeyVersion, "encryption version"),
      };
      const lookup = dataKind === "participant_reference" || dataKind === "context_reference";
      let plaintext: string;
      let protectedValue:
        Awaited<ReturnType<TournamentProtectedValueAdapter["protectParticipantReference"]>> |
        Awaited<ReturnType<TournamentProtectedValueAdapter["protectEvidenceReference"]>>;
      if (dataKind === "participant_reference") {
        plaintext = tournamentOldReader.decryptParticipantReference(stored);
        protectedValue = await tournamentWriter.protectParticipantReference(
          tournamentParticipantNamespace(row.subtype), plaintext,
        );
        verifiedPlaintext(plaintext, tournamentNewReader.decryptParticipantReference(protectedValue));
      } else if (dataKind === "context_reference") {
        plaintext = tournamentOldReader.decryptContextReference(stored);
        protectedValue = await tournamentWriter.protectContextReference(
          text(row.namespace, "context namespace"), plaintext,
        );
        verifiedPlaintext(plaintext, tournamentNewReader.decryptContextReference(protectedValue));
      } else if (dataKind === "evidence_reference") {
        plaintext = tournamentOldReader.decryptEvidenceReference(stored);
        protectedValue = await tournamentWriter.protectEvidenceReference(plaintext);
        verifiedPlaintext(plaintext, tournamentNewReader.decryptEvidenceReference(protectedValue));
      } else if (dataKind === "verification_issue") {
        plaintext = tournamentOldReader.decryptVerificationIssueMessage(stored);
        protectedValue = await tournamentWriter.protectVerificationIssueMessage(plaintext);
        verifiedPlaintext(plaintext, tournamentNewReader.decryptVerificationIssueMessage(protectedValue));
      } else {
        throw new ProtectedValueRotationError("Tournament protected data kind is invalid");
      }
      if (current(row, keys.tournament.active, lookup)) { continue; }
      const lookupValue = "lookupHmac" in protectedValue
        ? Buffer.from(protectedValue.lookupHmac) : null;
      const lookupVersion = "lookupKeyVersion" in protectedValue
        ? protectedValue.lookupKeyVersion : null;
      if (apply) {
        const [result] = await connection.execute<ResultSetHeader>(
          `UPDATE restricted_tournament_race_data
           SET lookup_hmac = ?, lookup_key_version = ?, value_ciphertext = ?,
               encryption_key_version = ?
           WHERE tournament_restricted_data_id = ?`,
          [lookupValue, lookupVersion, Buffer.from(protectedValue.ciphertext),
            protectedValue.encryptionKeyVersion, id(row.resourceId)],
        );
        if (result.affectedRows !== 1) {
          throw new ProtectedValueRotationError("Tournament value rotation conflicted");
        }
      }
      rotated.tournamentValues += 1;
    }
    if (apply) { await connection.commit(); } else { await connection.rollback(); }
    return { mode: apply ? "apply" : "dry_run", scanned, rotated };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
