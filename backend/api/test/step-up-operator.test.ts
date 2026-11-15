// The host operator's break-glass for step-up (step-up-operator-main.ts), against a synthetic in-memory pool:
// it only replaces the link of the account's one pending request, never opens a window itself, and audits.
import { describe, expect, it } from "vitest";

import { issueOperatorStepUpLink, OperatorStepUpError } from "../src/security/step-up-operator-main.js";
import { stepUpLinkDigest } from "../src/security/step-up-service.js";

type Challenge = { id: number; authUserId: string; sessionDigest: Buffer; linkDigest: Buffer; clientKind: string;
  requestedAtMs: number; linkExpiresAtMs: number; confirmedAtMs: number | null };

function fakePool(users: Array<{ id: string; email: string; emailVerified: number }>, challenges: Challenge[]) {
  const audit: unknown[][] = [];
  const log: string[] = [];
  const execute = async (sql: string, values: unknown[]) => {
    if (sql.includes("FROM mk8dx_auth_user")) {
      return [users.filter((user) => user.email === values[0]).map((user) => ({ id: user.id, emailVerified: user.emailVerified }))];
    }
    if (sql.includes("FROM api_step_up_challenges")) {
      const [authUserId, nowMs] = values as [string, number];
      return [challenges
        .filter((row) => row.authUserId === authUserId && row.confirmedAtMs === null && row.linkExpiresAtMs > nowMs)
        .sort((a, b) => b.requestedAtMs - a.requestedAtMs)
        .map((row) => ({ id: row.id, sessionDigest: row.sessionDigest, clientKind: row.clientKind, requestedAtMs: row.requestedAtMs }))];
    }
    if (sql.startsWith("UPDATE api_step_up_challenges")) {
      const [digest, expires, id] = values as [Buffer, number, number];
      const row = challenges.find((candidate) => candidate.id === id && candidate.confirmedAtMs === null);
      if (row !== undefined) { row.linkDigest = digest; row.linkExpiresAtMs = expires; }
      return [{ affectedRows: row === undefined ? 0 : 1 }];
    }
    if (sql.includes("INSERT INTO api_step_up_audit_events")) { audit.push([sql, ...values]); return [{ affectedRows: 1 }]; }
    throw new Error(`unexpected SQL ${sql}`);
  };
  const connection = {
    execute: async (sql: string, values: unknown[]) => { log.push(sql.trim().split(/\s+/, 1)[0]!); return execute(sql, values); },
    beginTransaction: async () => { log.push("BEGIN"); },
    commit: async () => { log.push("COMMIT"); },
    rollback: async () => { log.push("ROLLBACK"); },
    release: () => undefined,
  };
  return { pool: { execute, getConnection: async () => connection } as never, audit, log };
}

const now = 1_800_000_000_000;
const session = (byte: number) => Buffer.alloc(32, byte);
const pending = (id: number, sessionByte: number, extra: Partial<Challenge> = {}): Challenge => ({
  id, authUserId: "authuser1", sessionDigest: session(sessionByte), linkDigest: Buffer.alloc(32, 99 - id),
  clientKind: "web", requestedAtMs: now - 60_000 + id, linkExpiresAtMs: now + 540_000, confirmedAtMs: null, ...extra,
});
const users = [{ id: "authuser1", email: "admin@example.test", emailVerified: 1 },
  { id: "authuser2", email: "unverified@example.test", emailVerified: 0 }];
const token = "A".repeat(43);
const options = (email: string) => ({ email, linkOrigin: "https://mk8dx.example.test", nowMs: now, newLinkToken: () => token });

describe("operator step-up link", () => {
  it("replaces the pending link of the one waiting session and audits it", async () => {
    const challenges = [pending(1, 7, { clientKind: "native" })];
    const { pool, audit, log } = fakePool(users, challenges);
    const issued = await issueOperatorStepUpLink(pool, options("admin@example.test"));
    expect(issued).toEqual({
      stepUpLink: `https://mk8dx.example.test/?step-up=${token}`,
      clientKind: "native",
      requestedAt: new Date(now - 60_000 + 1).toISOString(),
      linkExpiresAt: new Date(now + 600_000).toISOString(),
    });
    expect(challenges[0]!.linkDigest.equals(stepUpLinkDigest(token))).toBe(true);
    expect(challenges[0]!.confirmedAtMs).toBeNull(); // the person still presses Confirm
    expect(audit).toHaveLength(1);
    expect(String(audit[0]![0])).toContain("'step_up_operator_link'");
    expect(audit[0]!.slice(1)).toEqual(["authuser1", session(7), "native", now]);
    expect(log).toEqual(["BEGIN", "SELECT", "UPDATE", "INSERT", "COMMIT"]);
  });

  it("refuses an unknown or unverified address, no pending request and several waiting sessions", async () => {
    const refusal = async (email: string, challenges: Challenge[]) => {
      const { pool, audit } = fakePool(users, challenges);
      const error = await issueOperatorStepUpLink(pool, options(email)).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(OperatorStepUpError);
      expect(audit).toHaveLength(0);
      return (error as OperatorStepUpError).reason;
    };
    expect(await refusal("nobody@example.test", [pending(1, 7)])).toBe("account_not_found");
    expect(await refusal("unverified@example.test", [pending(1, 7, { authUserId: "authuser2" })])).toBe("account_not_found");
    expect(await refusal("admin@example.test", [])).toBe("no_pending_request");
    expect(await refusal("admin@example.test", [pending(1, 7, { linkExpiresAtMs: now - 1 })])).toBe("no_pending_request");
    expect(await refusal("admin@example.test", [pending(1, 7, { confirmedAtMs: now - 5 })])).toBe("no_pending_request");
    expect(await refusal("admin@example.test", [pending(1, 7), pending(2, 8)])).toBe("several_sessions_pending");
    expect(await refusal("not an address", [pending(1, 7)])).toBe("invalid_input");
  });
});
