import { describe, expect, it, vi } from "vitest";

import {
  EmbeddedAuthAuditPersistenceError,
  MysqlEmbeddedAuthAuditSink,
} from "../src/authentication/mysql-embedded-auth-audit-sink.js";

describe("MySQL embedded-auth audit sink", () => {
  it("persists only the closed private event projection", async () => {
    const calls: Array<[string, unknown[]]> = [];
    const execute = async (...args: [string, unknown[]]) => {
      calls.push(args);
      return [[], []];
    };
    const sink = new MysqlEmbeddedAuthAuditSink(
      { execute } as never,
      { nowMs: () => 2_000_000_000_000 },
    );
    await sink.record({
      kind: "auth_session_created",
      subjectId: "opaque_user_01",
      sessionId: "opaque_session_01",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]![1]).toEqual([
      "auth_session_created",
      "opaque_user_01",
      "opaque_session_01",
      null,
      2_000_000_000_000,
    ]);
    expect(calls[0]![0]).not.toMatch(/email|token|password/i);
  });

  it("rejects malformed shapes and clock values before persistence", async () => {
    const execute = vi.fn();
    const sink = new MysqlEmbeddedAuthAuditSink(
      { execute } as never,
      { nowMs: () => -1 },
    );
    await expect(sink.record({
      kind: "auth_user_created",
      subjectId: "bad subject",
    })).rejects.toBeInstanceOf(EmbeddedAuthAuditPersistenceError);
    await expect(sink.record({
      kind: "device_authorization_requested",
      clientId: "mk8dx.timetrials.android.v1",
    })).rejects.toThrow("auth audit clock is invalid");
    expect(execute).not.toHaveBeenCalled();
  });

  it("redacts adapter failures", async () => {
    const execute = vi.fn(async () => {
      throw new Error("private SQL detail and email player@example.test");
    });
    const sink = new MysqlEmbeddedAuthAuditSink(
      { execute } as never,
      { nowMs: () => 1 },
    );
    await expect(sink.record({
      kind: "auth_user_created",
      subjectId: "opaque_user_01",
    })).rejects.toMatchObject({
      name: "EmbeddedAuthAuditPersistenceError",
      message: "auth audit persistence failed",
    });
  });
  it("accepts the native email approval kinds only with a subject and a client", async () => {
    const calls: Array<[string, unknown[]]> = [];
    const execute = async (...args: [string, unknown[]]) => { calls.push(args); return [[], []]; };
    const sink = new MysqlEmbeddedAuthAuditSink({ execute } as never, { nowMs: () => 2_000_000_000_000 });
    for (const kind of ["native_email_approval_sent", "native_email_approval_approved", "native_email_approval_locked"] as const) {
      await sink.record({ kind, subjectId: "opaque_user_01", clientId: "mk8dx.timetrials.desktop.v1" });
      await expect(sink.record({ kind, subjectId: "opaque_user_01" })).rejects.toBeInstanceOf(EmbeddedAuthAuditPersistenceError);
      await expect(sink.record({ kind, subjectId: "opaque_user_01", sessionId: "opaque_session_01", clientId: "mk8dx.timetrials.desktop.v1" }))
        .rejects.toBeInstanceOf(EmbeddedAuthAuditPersistenceError);
    }
    expect(calls.map((call) => call[1][0])).toEqual([
      "native_email_approval_sent", "native_email_approval_approved", "native_email_approval_locked",
    ]);
  });
});
