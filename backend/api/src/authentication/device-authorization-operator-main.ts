// Host-local operator approval for an owner-controlled native release client.
//
// This command deliberately is not an HTTP route. It reads the same owner-only
// hosted configuration as the migration/backup operators, resolves an explicit
// canonical UserAccount through its ACTIVE authentication binding, and changes
// exactly one still-pending allow-listed device code to approved. The native
// client must still redeem it through Better Auth's normal token endpoint;
// this tool neither creates nor prints a session or token.

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import mysql, {
  type QueryResult,
  type ResultSetHeader,
  type RowDataPacket,
} from "mysql2/promise";

import {
  MK8DX_ANDROID_CLIENT_ID,
  MK8DX_DESKTOP_CLIENT_ID,
  MK8DX_PASSWORDLESS_ISSUER,
  MK8DX_TOURNAMENT_DESKTOP_CLIENT_ID,
} from "./embedded-passwordless-auth.js";
import { AuthenticationSubjectHmacProtector } from
  "./authentication-subject-hmac-protector.js";
import { MysqlEmbeddedAuthAuditSink } from "./mysql-embedded-auth-audit-sink.js";
import {
  loadHostedMysqlRuntimeConfig,
  type HostedRuntimeEnvironment,
} from "../composition/hosted-runtime-config.js";
import {
  extractPrivateEnvironmentArgument,
  loadHostedOperatorEnvironment,
} from "../composition/hosted-operator-environment.js";

const accountIdPattern = /^user_account\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const userCodePattern = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/;

export class DeviceAuthorizationOperatorError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "DeviceAuthorizationOperatorError";
  }
}

export type DeviceAuthorizationOperatorArguments = Readonly<{
  userCode: string;
  userAccountId: string;
  clientId: string;
}>;

const operatorClientIds = new Set([
  MK8DX_ANDROID_CLIENT_ID,
  MK8DX_DESKTOP_CLIENT_ID,
  MK8DX_TOURNAMENT_DESKTOP_CLIENT_ID,
]);

export function parseDeviceAuthorizationOperatorArguments(
  arguments_: readonly string[],
): DeviceAuthorizationOperatorArguments {
  const legacyAndroid = arguments_.length === 6;
  if ((!legacyAndroid && arguments_.length !== 10) ||
    arguments_[0] !== "--user-code" ||
    arguments_[2] !== "--user-account-id" ||
    arguments_[4] !== "--confirm-user-account-id" ||
    (!legacyAndroid && (arguments_[6] !== "--client-id" ||
      arguments_[8] !== "--confirm-client-id"))) {
    throw new DeviceAuthorizationOperatorError(
      "expected --user-code <8-character-code> --user-account-id <id> " +
      "--confirm-user-account-id <same-id> [--client-id <id> " +
      "--confirm-client-id <same-id>]",
    );
  }
  const userCode = arguments_[1]?.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  const userAccountId = arguments_[3];
  const confirmation = arguments_[5];
  if (!userCode || !userCodePattern.test(userCode)) {
    throw new DeviceAuthorizationOperatorError("the Android user code is invalid");
  }
  if (!userAccountId || !accountIdPattern.test(userAccountId) ||
    userAccountId !== confirmation) {
    throw new DeviceAuthorizationOperatorError(
      "UserAccount confirmation must exactly match a valid identifier",
    );
  }
  const clientId = legacyAndroid ? MK8DX_ANDROID_CLIENT_ID : arguments_[7];
  if (clientId === undefined || !operatorClientIds.has(clientId) ||
    (!legacyAndroid && clientId !== arguments_[9])) {
    throw new DeviceAuthorizationOperatorError(
      "native client confirmation must exactly match an allow-listed identifier",
    );
  }
  return { userCode, userAccountId, clientId };
}

interface BindingRow extends RowDataPacket {
  lookupKeyVersion: unknown;
  subjectLookupHmac: unknown;
}

interface AuthUserRow extends RowDataPacket {
  subjectId: unknown;
}

interface DeviceCodeRow extends RowDataPacket {
  id: unknown;
  userId: unknown;
  expiresAt: unknown;
  status: unknown;
  clientId: unknown;
}

export type DeviceAuthorizationOperatorConnection = Readonly<{
  beginTransaction(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  execute<T extends QueryResult>(
    sql: string,
    values?: unknown[],
  ): Promise<[T, unknown]>;
}>;

function exactlyOne<T>(rows: readonly T[], label: string): T {
  if (rows.length !== 1 || rows[0] === undefined) {
    throw new DeviceAuthorizationOperatorError(
      `${label} did not resolve exactly once; refusing`,
    );
  }
  return rows[0];
}

export function resolveBoundAuthenticationSubject(
  protector: AuthenticationSubjectHmacProtector,
  bindingHmac: Buffer,
  subjectIds: readonly string[],
): string {
  const matching = subjectIds.filter((subjectId) => {
    const protectedSubject = protector.protectVerifiedSubject(
      MK8DX_PASSWORDLESS_ISSUER,
      subjectId,
    );
    const candidate = Buffer.from(protectedSubject.subjectLookupHmac);
    return candidate.length === bindingHmac.length &&
      candidate.equals(bindingHmac);
  });
  return exactlyOne(matching, "verified authentication subject");
}

export async function approveAndroidDeviceAuthorization(
  connection: DeviceAuthorizationOperatorConnection,
  protector: AuthenticationSubjectHmacProtector,
  input: DeviceAuthorizationOperatorArguments,
  nowMs: number,
): Promise<Readonly<{ approved: true; clientId: string; expiresAt: string }>> {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
    throw new DeviceAuthorizationOperatorError("operator clock is invalid");
  }
  await connection.beginTransaction();
  try {
    const [bindingRows] = await connection.execute<BindingRow[]>(
      `SELECT binding.active_lookup_key_version AS lookupKeyVersion,
              binding.active_subject_lookup_hmac AS subjectLookupHmac
       FROM restricted_authentication_bindings AS binding
       INNER JOIN user_accounts AS account
         ON account.user_account_id = binding.user_account_id
       WHERE account.public_id = ?
         AND binding.binding_status = 'active'
         AND binding.active_issuer_key = ?
       FOR UPDATE`,
      [input.userAccountId, MK8DX_PASSWORDLESS_ISSUER],
    );
    const binding = exactlyOne(bindingRows, "active authentication binding");
    if (typeof binding.lookupKeyVersion !== "string" ||
      !Buffer.isBuffer(binding.subjectLookupHmac)) {
      throw new DeviceAuthorizationOperatorError(
        "active authentication binding is malformed; refusing",
      );
    }

    const [authUserRows] = await connection.execute<AuthUserRow[]>(
      `SELECT id AS subjectId FROM mk8dx_auth_user
       WHERE emailVerified = TRUE ORDER BY id`,
    );
    const subjectIds = authUserRows.map((row) => row.subjectId).filter(
      (value): value is string => typeof value === "string" && value.length > 0,
    );
    if (subjectIds.length !== authUserRows.length) {
      throw new DeviceAuthorizationOperatorError(
        "verified authentication user data is malformed; refusing",
      );
    }
    const subjectId = resolveBoundAuthenticationSubject(
      protector,
      binding.subjectLookupHmac,
      subjectIds,
    );
    const protectedSubject = protector.protectVerifiedSubject(
      MK8DX_PASSWORDLESS_ISSUER,
      subjectId,
    );
    if (protectedSubject.lookupKeyVersion !== binding.lookupKeyVersion) {
      throw new DeviceAuthorizationOperatorError(
        "account binding is not on the active authentication lookup version",
      );
    }

    const [deviceRows] = await connection.execute<DeviceCodeRow[]>(
      `SELECT id, userId, expiresAt, status, clientId
       FROM mk8dx_auth_device_code WHERE userCode = ? FOR UPDATE`,
      [input.userCode],
    );
    const device = exactlyOne(deviceRows, "device authorization code");
    const expiresAt = device.expiresAt instanceof Date
      ? device.expiresAt
      : new Date(String(device.expiresAt));
    if (typeof device.id !== "string" || device.id.length === 0 ||
      expiresAt.toString() === "Invalid Date") {
      throw new DeviceAuthorizationOperatorError(
        "device authorization record is malformed; refusing",
      );
    }
    if (device.clientId !== input.clientId) {
      throw new DeviceAuthorizationOperatorError(
        "device code does not belong to the explicitly confirmed native client",
      );
    }
    if (device.status !== "pending") {
      throw new DeviceAuthorizationOperatorError(
        "device authorization code is not pending",
      );
    }
    if (expiresAt.getTime() <= nowMs) {
      throw new DeviceAuthorizationOperatorError(
        "device authorization code has expired",
      );
    }
    if (device.userId !== null && device.userId !== subjectId) {
      throw new DeviceAuthorizationOperatorError(
        "device authorization code is already claimed by another subject",
      );
    }

    const [updated] = await connection.execute<ResultSetHeader>(
      `UPDATE mk8dx_auth_device_code
       SET status = 'approved', userId = ?
       WHERE id = ? AND status = 'pending'`,
      [subjectId, device.id],
    );
    if (updated.affectedRows !== 1) {
      throw new DeviceAuthorizationOperatorError(
        "device authorization approval conflicted; refusing",
      );
    }
    await new MysqlEmbeddedAuthAuditSink(
      connection as unknown as Pick<mysql.Pool, "execute">,
      { nowMs: () => nowMs },
    )
      .record({
        kind: "device_authorization_operator_approved",
        subjectId,
        clientId: input.clientId,
      });
    await connection.commit();
    return {
      approved: true,
      clientId: input.clientId,
      expiresAt: expiresAt.toISOString(),
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  }
}

function activeProtector(environment: HostedRuntimeEnvironment): AuthenticationSubjectHmacProtector {
  const encoded = environment["MK8DX_HOSTED_AUTHENTICATION_LOOKUP_HMAC_KEY_BASE64"];
  const version = environment["MK8DX_HOSTED_AUTHENTICATION_LOOKUP_KEY_VERSION"];
  if (!encoded || !version) {
    throw new DeviceAuthorizationOperatorError(
      "the hosted active authentication lookup key is required",
    );
  }
  const decoded = Buffer.from(encoded, "base64");
  if (decoded.length !== 32 || decoded.toString("base64") !== encoded) {
    throw new DeviceAuthorizationOperatorError(
      "the hosted active authentication lookup key is invalid",
    );
  }
  return new AuthenticationSubjectHmacProtector({
    lookupHmacKey: Uint8Array.from(decoded),
    lookupKeyVersion: version,
  });
}

export async function runDeviceAuthorizationOperator(
  environment: HostedRuntimeEnvironment,
  arguments_: readonly string[],
): Promise<Readonly<{ approved: true; clientId: string; expiresAt: string }>> {
  const input = parseDeviceAuthorizationOperatorArguments(arguments_);
  const config = loadHostedMysqlRuntimeConfig(environment);
  const pool = mysql.createPool({
    ...config,
    connectionLimit: 1,
    multipleStatements: false,
    namedPlaceholders: false,
  });
  const connection = await pool.getConnection();
  try {
    return await approveAndroidDeviceAuthorization(
      connection as unknown as DeviceAuthorizationOperatorConnection,
      activeProtector(environment),
      input,
      Date.now(),
    );
  } finally {
    connection.release();
    await pool.end();
  }
}

async function main(): Promise<void> {
  try {
    const extracted = extractPrivateEnvironmentArgument(process.argv.slice(2));
    const environment = loadHostedOperatorEnvironment(extracted.environmentPath);
    const result = await runDeviceAuthorizationOperator(
      environment,
      extracted.commandArguments,
    );
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    const message = error instanceof DeviceAuthorizationOperatorError
      ? error.message
      : "device authorization operator failed";
    process.stderr.write(`Device authorization operator refused: ${message}\n`);
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined &&
  import.meta.url === pathToFileURL(resolve(invokedPath)).href) {
  void main();
}
