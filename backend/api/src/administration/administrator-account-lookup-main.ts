// Read-only operator CLI: resolve exactly one verified UserAccount from an
// explicitly supplied sign-in email, for administrator bootstrap targeting.
//
// This deliberately removes any "first account wins" assumption: the target
// account is identified through the exact verified email in the embedded
// authentication user table, protected into the same versioned subject-lookup
// HMAC the runtime uses, and matched against exactly one ACTIVE
// authentication binding. Zero matches, an unverified email, or anything
// ambiguous fails closed with a non-zero exit. The tool performs no write.

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import mysql from "mysql2/promise";
import type { RowDataPacket } from "mysql2";

import { MK8DX_PASSWORDLESS_ISSUER } from
  "../authentication/embedded-passwordless-auth.js";
import { AuthenticationSubjectHmacProtector } from
  "../authentication/authentication-subject-hmac-protector.js";
import {
  loadHostedMysqlRuntimeConfig,
  type HostedRuntimeEnvironment,
} from "../composition/hosted-runtime-config.js";

const emailPattern = /^[^\s@]{1,64}@[^\s@]{1,255}$/;
const userAccountIdPattern = /^user_account\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

export class AdministratorAccountLookupError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "AdministratorAccountLookupError";
  }
}

export function parseAccountLookupArguments(
  arguments_: readonly string[],
): string {
  if (arguments_.length !== 2 || arguments_[0] !== "--email" ||
    typeof arguments_[1] !== "string" || !emailPattern.test(arguments_[1])) {
    throw new AdministratorAccountLookupError(
      "expected --email <exact-sign-in-address>",
    );
  }
  return arguments_[1];
}

interface AuthUserRow extends RowDataPacket {
  subjectId: unknown;
  emailVerified: unknown;
}

interface AccountRow extends RowDataPacket {
  userAccountId: unknown;
}

export type AccountLookupQueryPort = Readonly<{
  execute(
    sql: string,
    values: readonly (string | Buffer)[],
  ): Promise<RowDataPacket[]>;
}>;

export async function lookupVerifiedAccountByEmail(
  queries: AccountLookupQueryPort,
  protector: AuthenticationSubjectHmacProtector,
  email: string,
): Promise<string> {
  const authUsers = (await queries.execute(
    `SELECT id AS subjectId, emailVerified AS emailVerified
     FROM mk8dx_auth_user
     WHERE email = ?`,
    [email],
  )) as AuthUserRow[];
  if (authUsers.length === 0) {
    throw new AdministratorAccountLookupError(
      "no authentication user exists for that exact email",
    );
  }
  if (authUsers.length > 1 || authUsers[0] === undefined) {
    throw new AdministratorAccountLookupError(
      "the email matched more than one authentication user; refusing",
    );
  }
  const authUser = authUsers[0];
  if (typeof authUser.subjectId !== "string" || authUser.subjectId.length === 0) {
    throw new AdministratorAccountLookupError(
      "the authentication user record is malformed; refusing",
    );
  }
  const verified = authUser.emailVerified === 1 || authUser.emailVerified === true;
  if (!verified) {
    throw new AdministratorAccountLookupError(
      "the authentication user's email is not verified; refusing",
    );
  }
  const subject = protector.protectVerifiedSubject(
    MK8DX_PASSWORDLESS_ISSUER,
    authUser.subjectId,
  );
  const accounts = (await queries.execute(
    `SELECT account.public_id AS userAccountId
     FROM restricted_authentication_bindings AS binding
     INNER JOIN user_accounts AS account
       ON account.user_account_id = binding.user_account_id
     WHERE binding.active_issuer_key = ?
       AND binding.active_lookup_key_version = ?
       AND binding.active_subject_lookup_hmac = ?`,
    [
      subject.issuerKey,
      subject.lookupKeyVersion,
      Buffer.from(subject.subjectLookupHmac),
    ],
  )) as AccountRow[];
  if (accounts.length === 0) {
    throw new AdministratorAccountLookupError(
      "no active authentication binding exists for that user under the " +
      "configured lookup key; refusing",
    );
  }
  if (accounts.length > 1 || accounts[0] === undefined) {
    throw new AdministratorAccountLookupError(
      "the binding lookup was ambiguous; refusing",
    );
  }
  const userAccountId = accounts[0].userAccountId;
  if (typeof userAccountId !== "string" ||
    !userAccountIdPattern.test(userAccountId)) {
    throw new AdministratorAccountLookupError(
      "the bound account identifier is malformed; refusing",
    );
  }
  return userAccountId;
}

export async function runAdministratorAccountLookup(
  environment: HostedRuntimeEnvironment,
  arguments_: readonly string[],
): Promise<string> {
  const email = parseAccountLookupArguments(arguments_);
  const lookupKeyEncoded =
    environment["MK8DX_HOSTED_AUTHENTICATION_LOOKUP_HMAC_KEY_BASE64"];
  const lookupKeyVersion =
    environment["MK8DX_HOSTED_AUTHENTICATION_LOOKUP_KEY_VERSION"];
  if (!lookupKeyEncoded || !lookupKeyVersion) {
    throw new AdministratorAccountLookupError(
      "the hosted authentication lookup key environment is required",
    );
  }
  const decoded = Buffer.from(lookupKeyEncoded, "base64");
  if (decoded.byteLength !== 32 ||
    decoded.toString("base64") !== lookupKeyEncoded) {
    throw new AdministratorAccountLookupError(
      "the hosted authentication lookup key must be canonical base64 for 32 bytes",
    );
  }
  const protector = new AuthenticationSubjectHmacProtector({
    lookupHmacKey: Uint8Array.from(decoded),
    lookupKeyVersion,
  });
  const config = loadHostedMysqlRuntimeConfig(environment);
  const pool = mysql.createPool({
    ...config,
    connectionLimit: 1,
    multipleStatements: false,
    namedPlaceholders: false,
  });
  try {
    return await lookupVerifiedAccountByEmail(
      {
        async execute(sql, values) {
          const [rows] = await pool.execute<RowDataPacket[]>(sql, [...values]);
          return rows;
        },
      },
      protector,
      email,
    );
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  try {
    const userAccountId = await runAdministratorAccountLookup(
      process.env,
      process.argv.slice(2),
    );
    process.stdout.write(`${JSON.stringify({ userAccountId })}\n`);
  } catch (error) {
    const message = error instanceof AdministratorAccountLookupError
      ? error.message
      : "administrator account lookup failed";
    process.stderr.write(`Administrator account lookup refused: ${message}\n`);
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined &&
    import.meta.url === pathToFileURL(resolve(invokedPath)).href) {
  void main();
}
