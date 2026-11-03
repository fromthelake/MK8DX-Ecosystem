import { describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import type { IdentityReadRepository } from "../src/identity/types.js";
import {
  JsonLineOperationalLog,
  type OperationalEvent,
  type OperationalLogSink,
} from "../src/runtime/operational-log.js";

const emptyRepository: IdentityReadRepository = {
  async findPublicPlayerById() { return null; },
  async findUserAccountSummaryById() { return null; },
  async findPlayerClaimSummaryById() { return null; },
};

class CapturingLog implements OperationalLogSink {
  public events: OperationalEvent[] = [];

  public log(event: OperationalEvent): void {
    this.events.push(event);
  }
}

describe("JSON line operational log", () => {
  it("writes bounded structured lines and drops malformed fields", () => {
    const lines: string[] = [];
    const log = new JsonLineOperationalLog(
      { write: (chunk) => lines.push(chunk) },
      { nowMs: () => 1_900_000_300_000 },
    );
    log.log({
      event: "server_started",
      category: "lifecycle",
      detail: "http://127.0.0.1:3000",
    });
    log.log({
      event: "request_failed",
      category: "request",
      requestId: "abc123",
      method: "GET",
      route: "/api/players/:playerId",
      statusCode: 500,
      durationMs: 12.7,
      errorName: "TimeTrialPersistenceError",
    });
    log.log({ event: "NOT A VALID EVENT NAME!", category: "request" });
    log.log({
      event: "request_failed",
      category: "request",
      requestId: "…invalid…",
      route: "line\nbreak?query=secret-token",
      detail: "x".repeat(500),
    });

    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0] as string)).toEqual({
      timeMs: 1_900_000_300_000,
      event: "server_started",
      category: "lifecycle",
      detail: "http://127.0.0.1:3000",
    });
    expect(JSON.parse(lines[1] as string)).toEqual({
      timeMs: 1_900_000_300_000,
      event: "request_failed",
      category: "request",
      requestId: "abc123",
      method: "GET",
      route: "/api/players/:playerId",
      statusCode: 500,
      durationMs: 13,
      errorName: "TimeTrialPersistenceError",
    });
    // Malformed request id, unbounded detail, and newline routes are dropped
    // rather than written.
    expect(JSON.parse(lines[2] as string)).toEqual({
      timeMs: 1_900_000_300_000,
      event: "request_failed",
      category: "request",
    });
  });

  it("never throws when the stream fails", () => {
    const log = new JsonLineOperationalLog({
      write: () => { throw new Error("stream closed"); },
    });
    expect(() => log.log({ event: "server_closed", category: "lifecycle" }))
      .not.toThrow();
  });
});

describe("application error handling and operational events", () => {
  it("returns a fixed 500 body and logs only class name and route pattern", async () => {
    const log = new CapturingLog();
    class SyntheticAdapterFailure extends Error {
      public constructor() {
        super("private connection string mysql://user:pw@host");
        this.name = "SyntheticAdapterFailure";
      }
    }
    const app = await buildApp({
      identityRepository: {
        ...emptyRepository,
        async findPublicPlayerById(): Promise<never> {
          throw new SyntheticAdapterFailure();
        },
      },
      operationalLog: log,
    });
    try {
      const response = await app.inject({
        method: "GET",
        url: "/v1/players/player.synthetic_explodes?token=super-secret",
      });
      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({
        statusCode: 500,
        error: "Internal Server Error",
        message: "Internal Server Error",
      });
      expect(response.body).not.toContain("private");
      expect(response.body).not.toContain("mysql://");

      const serialized = JSON.stringify(log.events);
      expect(serialized).not.toContain("super-secret");
      expect(serialized).not.toContain("mysql://");
      expect(serialized).not.toContain("player.synthetic_explodes");
      const errorEvent = log.events.find(
        (event) => event.event === "request_error",
      );
      expect(errorEvent?.route).toBe("/v1/players/:playerId");
      expect(errorEvent?.errorName).toBe("SyntheticAdapterFailure");
      expect(errorEvent?.requestId).toMatch(/^[a-f0-9]{16}$/);
      const responseEvent = log.events.find(
        (event) => event.event === "request_failed",
      );
      expect(responseEvent?.statusCode).toBe(500);
      expect(responseEvent?.requestId).toBe(errorEvent?.requestId);
    } finally {
      await app.close();
    }
  });

  it("preserves the bounded schema-validation client error shape", async () => {
    const app = await buildApp({ identityRepository: emptyRepository });
    try {
      const response = await app.inject({
        method: "GET",
        url: "/v1/players/NOT_A_VALID_TYPED_ID",
      });
      expect(response.statusCode).toBe(400);
      const body = response.json() as Record<string, unknown>;
      expect(body["statusCode"]).toBe(400);
      expect(body["error"]).toBe("Bad Request");
      expect(body["code"]).toBe("FST_ERR_VALIDATION");
      expect(typeof body["message"]).toBe("string");
    } finally {
      await app.close();
    }
  });

  it("logs readiness failures without detail", async () => {
    const log = new CapturingLog();
    const app = await buildApp({
      identityRepository: emptyRepository,
      readinessProbe: {
        check: async () => { throw new Error("private probe detail"); },
        timeoutMs: 5,
      },
      operationalLog: log,
    });
    try {
      const response = await app.inject({ method: "GET", url: "/health/ready" });
      expect(response.statusCode).toBe(503);
      expect(log.events).toContainEqual({
        event: "readiness_failed",
        category: "readiness",
        statusCode: 503,
      });
      expect(JSON.stringify(log.events)).not.toContain("private");
    } finally {
      await app.close();
    }
  });
});
