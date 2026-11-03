import { describe, expect, it, vi } from "vitest";

import { buildApp } from "../src/app.js";
import type { IdentityReadRepository } from "../src/identity/types.js";

const emptyRepository: IdentityReadRepository = {
  async findPublicPlayerById() { return null; },
  async findUserAccountSummaryById() { return null; },
  async findPlayerClaimSummaryById() { return null; },
};

describe("health routes", () => {
  it("keeps liveness independent and fails readiness closed without a probe", async () => {
    const app = await buildApp({ identityRepository: emptyRepository });
    try {
      const live = await app.inject({ method: "GET", url: "/health/live" });
      expect(live.statusCode).toBe(200);
      expect(live.json()).toEqual({ status: "alive" });
      const ready = await app.inject({ method: "GET", url: "/health/ready" });
      expect(ready.statusCode).toBe(503);
      expect(ready.json()).toEqual({ status: "not_ready" });
    } finally {
      await app.close();
    }
  });

  it("reports ready only after the injected dependency probe succeeds", async () => {
    const check = vi.fn(async () => undefined);
    const app = await buildApp({
      identityRepository: emptyRepository,
      readinessProbe: { check, timeoutMs: 100 },
    });
    try {
      const response = await app.inject({ method: "GET", url: "/health/ready" });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ status: "ready" });
      expect(check).toHaveBeenCalledOnce();
    } finally {
      await app.close();
    }
  });

  it("bounds probe failure and timeout without exposing error details", async () => {
    for (const check of [
      async () => { throw new Error("private database detail"); },
      async () => new Promise<void>(() => undefined),
    ]) {
      const app = await buildApp({
        identityRepository: emptyRepository,
        readinessProbe: { check, timeoutMs: 5 },
      });
      try {
        const response = await app.inject({ method: "GET", url: "/health/ready" });
        expect(response.statusCode).toBe(503);
        expect(response.json()).toEqual({ status: "not_ready" });
        expect(response.body).not.toContain("private");
        expect(response.body).not.toContain("database");
      } finally {
        await app.close();
      }
    }
  });

  it("sheds excess ordinary requests while health remains reachable", async () => {
    let finish: (() => void) | undefined;
    const held = new Promise<void>((resolve) => { finish = resolve; });
    const app = await buildApp({
      identityRepository: {
        ...emptyRepository,
        async findPublicPlayerById() {
          await held;
          return null;
        },
      },
      requestConcurrencyLimit: 1,
    });
    try {
      const url = "/v1/players/player.synthetic_concurrency_01";
      const first = app.inject({ method: "GET", url });
      await new Promise((resolve) => setTimeout(resolve, 5));
      const rejected = await app.inject({ method: "GET", url });
      expect(rejected.statusCode).toBe(503);
      expect(rejected.headers["retry-after"]).toBe("1");
      expect(rejected.json()).toMatchObject({
        statusCode: 503,
        error: "Service Unavailable",
      });
      const live = await app.inject({ method: "GET", url: "/health/live" });
      expect(live.statusCode).toBe(200);
      finish?.();
      expect((await first).statusCode).toBe(404);
    } finally {
      finish?.();
      await app.close();
    }
  });
});
