import { describe, expect, it } from "vitest";
import type { QueryResult, ResultSetHeader } from "mysql2/promise";

import {
  approveAndroidDeviceAuthorization,
  DeviceAuthorizationOperatorError,
  parseDeviceAuthorizationOperatorArguments,
  resolveBoundAuthenticationSubject,
  type DeviceAuthorizationOperatorConnection,
} from "../src/authentication/device-authorization-operator-main.js";
import { AuthenticationSubjectHmacProtector } from
  "../src/authentication/authentication-subject-hmac-protector.js";

const nowMs = Date.parse("2026-08-23T12:00:00.000Z");
const protector = new AuthenticationSubjectHmacProtector({
  lookupHmacKey: new Uint8Array(32).fill(0x5a),
  lookupKeyVersion: "rotation_20260822_v2",
});

function hmac(subjectId: string): Buffer {
  return Buffer.from(protector.protectVerifiedSubject(
    "mk8dx_passwordless_v1",
    subjectId,
  ).subjectLookupHmac);
}

type FakeOptions = Readonly<{
  subjectIds?: readonly string[];
  bindingHmac?: Buffer;
  status?: string;
  clientId?: string;
  expiresAt?: Date;
  claimedUserId?: string | null;
}>;

function fakeConnection(options: FakeOptions = {}): DeviceAuthorizationOperatorConnection & {
  events: string[];
  writes: unknown[][];
} {
  const subjectIds = options.subjectIds ?? ["auth-owner"];
  const events: string[] = [];
  const writes: unknown[][] = [];
  return {
    events,
    writes,
    async beginTransaction() { events.push("begin"); },
    async commit() { events.push("commit"); },
    async rollback() { events.push("rollback"); },
    async execute<T extends QueryResult>(sql: string, values: unknown[] = []) {
      if (sql.includes("FROM restricted_authentication_bindings")) {
        return [[{
          lookupKeyVersion: "rotation_20260822_v2",
          subjectLookupHmac: options.bindingHmac ?? hmac("auth-owner"),
        }] as unknown as T, []];
      }
      if (sql.includes("FROM mk8dx_auth_user")) {
        return [subjectIds.map((subjectId) => ({ subjectId })) as unknown as T, []];
      }
      if (sql.includes("FROM mk8dx_auth_device_code")) {
        return [[{
          id: "device-record-1",
          userId: options.claimedUserId ?? null,
          expiresAt: options.expiresAt ?? new Date(nowMs + 60_000),
          status: options.status ?? "pending",
          clientId: options.clientId ?? "mk8dx.timetrials.android.v1",
        }] as unknown as T, []];
      }
      if (sql.includes("UPDATE mk8dx_auth_device_code")) {
        writes.push(values);
        return [{ affectedRows: 1 } as ResultSetHeader as T, []];
      }
      if (sql.includes("INSERT INTO mk8dx_auth_audit_event")) {
        events.push("audit");
        writes.push(values);
        return [{ affectedRows: 1 } as ResultSetHeader as T, []];
      }
      throw new Error(`unexpected query: ${sql.slice(0, 80)}`);
    },
  };
}

describe("host-local Android device authorization operator", () => {
  it("requires an explicit code and duplicated canonical account", () => {
    expect(parseDeviceAuthorizationOperatorArguments([
      "--user-code", "ABCD-EF23",
      "--user-account-id", "user_account.owner",
      "--confirm-user-account-id", "user_account.owner",
    ])).toEqual({
      userCode: "ABCDEF23",
      userAccountId: "user_account.owner",
      clientId: "mk8dx.timetrials.android.v1",
    });
    expect(parseDeviceAuthorizationOperatorArguments([
      "--user-code", "ABCD-EF23",
      "--user-account-id", "user_account.owner",
      "--confirm-user-account-id", "user_account.owner",
      "--client-id", "mk8dx.timetrials.desktop.v1",
      "--confirm-client-id", "mk8dx.timetrials.desktop.v1",
    ])).toMatchObject({ clientId: "mk8dx.timetrials.desktop.v1" });

    for (const bad of [
      [],
      ["--user-code", "AAAAAAAA", "--user-account-id", "user_account.owner",
        "--confirm-user-account-id", "user_account.someone_else"],
      ["--user-code", "SHORT", "--user-account-id", "user_account.owner",
        "--confirm-user-account-id", "user_account.owner"],
    ]) {
      expect(() => parseDeviceAuthorizationOperatorArguments(bad))
        .toThrow(DeviceAuthorizationOperatorError);
    }
  });

  it("resolves exactly one verified auth subject from the active binding", () => {
    expect(resolveBoundAuthenticationSubject(
      protector,
      hmac("auth-owner"),
      ["auth-friend", "auth-owner", "auth-child"],
    )).toBe("auth-owner");
    expect(() => resolveBoundAuthenticationSubject(
      protector,
      hmac("auth-missing"),
      ["auth-owner"],
    )).toThrow(/exactly once/);
  });

  it("approves only the pending Android code and records a private audit", async () => {
    const connection = fakeConnection();
    await expect(approveAndroidDeviceAuthorization(
      connection,
      protector,
      {
        userCode: "ABCDEF23",
        userAccountId: "user_account.owner",
        clientId: "mk8dx.timetrials.android.v1",
      },
      nowMs,
    )).resolves.toEqual({
      approved: true,
      clientId: "mk8dx.timetrials.android.v1",
      expiresAt: "2026-08-23T12:01:00.000Z",
    });
    expect(connection.events).toEqual(["begin", "audit", "commit"]);
    expect(connection.writes[0]).toEqual(["auth-owner", "device-record-1"]);
    expect(connection.writes[1]).toEqual([
      "device_authorization_operator_approved",
      "auth-owner",
      null,
      "mk8dx.timetrials.android.v1",
      nowMs,
    ]);
  });

  it("approves a twice-confirmed allow-listed desktop client", async () => {
    const connection = fakeConnection({ clientId: "mk8dx.timetrials.desktop.v1" });
    await expect(approveAndroidDeviceAuthorization(
      connection,
      protector,
      {
        userCode: "ABCDEF23",
        userAccountId: "user_account.owner",
        clientId: "mk8dx.timetrials.desktop.v1",
      },
      nowMs,
    )).resolves.toMatchObject({
      approved: true,
      clientId: "mk8dx.timetrials.desktop.v1",
    });
  });

  it("rolls back expired, mismatched-client, and differently claimed codes", async () => {
    for (const options of [
      { expiresAt: new Date(nowMs) },
      { clientId: "mk8dx.timetrials.desktop.v1" },
      { claimedUserId: "auth-other" },
    ]) {
      const connection = fakeConnection(options);
      await expect(approveAndroidDeviceAuthorization(
        connection,
        protector,
        {
          userCode: "ABCDEF23",
          userAccountId: "user_account.owner",
          clientId: "mk8dx.timetrials.android.v1",
        },
        nowMs,
      )).rejects.toBeInstanceOf(DeviceAuthorizationOperatorError);
      expect(connection.events).toEqual(["begin", "rollback"]);
      expect(connection.writes).toHaveLength(0);
    }
  });
});
