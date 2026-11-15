// Break-glass for the fresh e-mail confirmation (step-up) when this installation cannot send e-mail.
//
// Runs on the server only, with the private operator environment (host or container access is the
// authentication); there is no HTTP route for it. It never opens a window by itself: the signed-in
// person first asks for the confirmation on the website or in the app ("Send the link"), which stores a
// pending request bound to that one session even when the e-mail then fails. This tool replaces the link
// of that pending request with a new single-use link and prints it on the operator's terminal. Opening
// it and pressing Confirm works exactly like the e-mailed link: one session, the normal window, audited.
// It refuses when the account has no pending request, or pending requests from more than one session
// (the operator could not tell which session is the person's own).

import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import mysql from "mysql2/promise";
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";

import { loadHostedMysqlRuntimeConfig, type HostedRuntimeEnvironment } from "../composition/hosted-runtime-config.js";
import { extractPrivateEnvironmentArgument, loadHostedOperatorEnvironment } from "../composition/hosted-operator-environment.js";
import { STEP_UP_LINK_LIFETIME_SECONDS, stepUpLinkDigest } from "./step-up-service.js";

const emailPattern = /^[^\s@]{1,64}@[^\s@]{1,255}$/;
const linkTokenPattern = /^[A-Za-z0-9_-]{43}$/;

export type OperatorStepUpRefusal = "account_not_found" | "no_pending_request" | "several_sessions_pending";

export class OperatorStepUpError extends Error {
  public constructor(public readonly reason: OperatorStepUpRefusal | "invalid_input") {
    super(reason);
    this.name = "OperatorStepUpError";
  }
}

export type OperatorStepUpLink = Readonly<{
  stepUpLink: string;
  clientKind: "web" | "native";
  requestedAt: string;
  linkExpiresAt: string;
}>;

interface AuthUserRow extends RowDataPacket { id: unknown; emailVerified: unknown }
interface PendingRow extends RowDataPacket {
  id: unknown; sessionDigest: unknown; clientKind: unknown; requestedAtMs: unknown;
}

function integer(value: unknown): number {
  const number = typeof value === "string" ? Number(value) : value;
  if (typeof number !== "number" || !Number.isSafeInteger(number) || number < 0) {
    throw new Error("stored step-up value is invalid");
  }
  return number;
}

/** Replaces the link of the account's one pending request and returns the new link. */
export async function issueOperatorStepUpLink(
  pool: Pick<Pool, "execute" | "getConnection">,
  options: Readonly<{ email: string; linkOrigin: string; nowMs: number; newLinkToken?: () => string }>,
): Promise<OperatorStepUpLink> {
  if (!emailPattern.test(options.email)) { throw new OperatorStepUpError("invalid_input"); }
  const [users] = await pool.execute<AuthUserRow[]>(
    "SELECT id AS id, emailVerified AS emailVerified FROM mk8dx_auth_user WHERE email = ? LIMIT 2",
    [options.email],
  );
  const user = users.length === 1 ? users[0] : undefined;
  if (user === undefined || typeof user.id !== "string" ||
      !(user.emailVerified === 1 || user.emailVerified === true || user.emailVerified === "1")) {
    throw new OperatorStepUpError("account_not_found");
  }
  const authUserId = user.id;
  const token = options.newLinkToken?.() ?? randomBytes(32).toString("base64url");
  if (!linkTokenPattern.test(token)) { throw new Error("step-up link token is invalid"); }
  const linkExpiresAtMs = options.nowMs + STEP_UP_LINK_LIFETIME_SECONDS * 1_000;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [pending] = await connection.execute<PendingRow[]>(
      `SELECT step_up_challenge_id AS id, session_digest AS sessionDigest, client_kind AS clientKind,
              requested_at_ms AS requestedAtMs
         FROM api_step_up_challenges
        WHERE auth_user_id = ? AND confirmed_at_ms IS NULL AND link_expires_at_ms > ?
        ORDER BY requested_at_ms DESC, step_up_challenge_id DESC
        LIMIT 16 FOR UPDATE`,
      [authUserId, options.nowMs],
    );
    const sessions = new Set(pending.map((row) => Buffer.isBuffer(row.sessionDigest) ? row.sessionDigest.toString("hex") : ""));
    const newest = pending[0];
    if (newest === undefined) { throw new OperatorStepUpError("no_pending_request"); }
    if (sessions.size !== 1 || !Buffer.isBuffer(newest.sessionDigest)) {
      throw new OperatorStepUpError("several_sessions_pending");
    }
    const clientKind = newest.clientKind === "native" ? "native" : newest.clientKind === "web" ? "web" : null;
    if (clientKind === null) { throw new Error("stored step-up client kind is invalid"); }
    const [updated] = await connection.execute<ResultSetHeader>(
      `UPDATE api_step_up_challenges SET link_digest = ?, link_expires_at_ms = ?
        WHERE step_up_challenge_id = ? AND confirmed_at_ms IS NULL`,
      [stepUpLinkDigest(token), linkExpiresAtMs, integer(newest.id)],
    );
    if (updated.affectedRows !== 1) { throw new OperatorStepUpError("no_pending_request"); }
    await connection.execute(
      `INSERT INTO api_step_up_audit_events
         (event_kind, auth_user_id, session_digest, client_kind, route_pattern, occurred_at_ms)
       VALUES ('step_up_operator_link', ?, ?, ?, NULL, ?)`,
      [authUserId, newest.sessionDigest, clientKind, options.nowMs],
    );
    await connection.commit();
    const url = new URL("/", options.linkOrigin);
    url.searchParams.set("step-up", token);
    return {
      stepUpLink: url.toString(),
      clientKind,
      requestedAt: new Date(integer(newest.requestedAtMs)).toISOString(),
      linkExpiresAt: new Date(linkExpiresAtMs).toISOString(),
    };
  } catch (error) {
    await connection.rollback().catch(() => undefined);
    throw error;
  } finally {
    connection.release();
  }
}

export async function runOperatorStepUpLink(
  environment: HostedRuntimeEnvironment, email: string,
): Promise<OperatorStepUpLink> {
  if (environment["MK8DX_OFFLINE_LAN"] === "true") {
    // An offline LAN installation sends no e-mail and asks for no confirmation.
    throw new OperatorStepUpError("no_pending_request");
  }
  const linkOrigin = environment["MK8DX_HOSTED_AUTH_BASE_URL"];
  if (linkOrigin === undefined || new URL(linkOrigin).origin !== linkOrigin) {
    throw new OperatorStepUpError("invalid_input");
  }
  const pool = mysql.createPool({ ...loadHostedMysqlRuntimeConfig(environment), connectionLimit: 1,
    multipleStatements: false });
  try {
    return await issueOperatorStepUpLink(pool, { email, linkOrigin, nowMs: Date.now() });
  } finally {
    await pool.end();
  }
}

const refusalText: Readonly<Record<OperatorStepUpRefusal, string>> = {
  account_not_found: "No single verified account uses that sign-in address.",
  no_pending_request: "That account has no pending confirmation. Ask the person to press Send the link on the " +
    "website or in the app first (within 10 minutes), then run this again.",
  several_sessions_pending: "Several sessions of that account are waiting for a confirmation. Ask the person to sign " +
    "out on all other devices, press Send the link again, and run this again.",
};

async function main(): Promise<void> {
  try {
    const extracted = extractPrivateEnvironmentArgument(process.argv.slice(2));
    if (extracted.commandArguments.length !== 1 || extracted.commandArguments[0] !== "--email-stdin") {
      throw new OperatorStepUpError("invalid_input");
    }
    let email = "";
    for await (const chunk of process.stdin) {
      email += String(chunk);
      if (email.length > 1024) { throw new OperatorStepUpError("invalid_input"); }
    }
    const issued = await runOperatorStepUpLink(
      loadHostedOperatorEnvironment(extracted.environmentPath), email.trim(),
    );
    process.stdout.write(`${JSON.stringify(issued)}\n`);
  } catch (error) {
    const reason = error instanceof OperatorStepUpError && error.reason !== "invalid_input" ? error.reason : null;
    process.stderr.write(reason === null
      ? "Step-up link refused; check the sign-in address and the private installation settings.\n"
      : `${refusalText[reason]}\n`);
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(resolve(invokedPath)).href) {
  void main();
}
