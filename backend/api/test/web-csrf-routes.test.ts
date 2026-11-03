import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

import { buildApp } from "../src/app.js";
import type { IdentityReadRepository } from "../src/identity/types.js";
import {
  WebCsrfConfigurationError,
  WebCsrfService,
} from "../src/security/web-csrf-service.js";


class NullIdentityReads implements IdentityReadRepository {
  async findPublicPlayerById(): Promise<null> { return null; }
  async findUserAccountSummaryById(): Promise<null> { return null; }
  async findPlayerClaimSummaryById(): Promise<null> { return null; }
}

function service(): WebCsrfService {
  return new WebCsrfService({
    activeKeyVersion: "csrf-test-v1",
    keys: { "csrf-test-v1": Uint8Array.from({ length: 32 }, () => 21) },
  }, {
    nowMs: () => 1_786_916_000_000,
  }, {
    newNonce: () => Uint8Array.from({ length: 24 }, () => 22),
  });
}

const openApps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
});

async function app(actor: "account" | "anonymous" | "migration_operator") {
  const csrf = service();
  const resolveActor = vi.fn(async () => actor === "account"
    ? {
        role: "account" as const,
        userAccountId: "user_account.web_csrf_owner_01",
      }
    : { role: actor });
  const instance = await buildApp({
    identityRepository: new NullIdentityReads(),
    resolveActor,
    webCsrf: { service: csrf },
  });
  openApps.push(instance);
  return { instance, csrf, resolveActor };
}

describe("authenticated web CSRF HTTP boundary", () => {
  it("returns one no-store proof for the resolved account", async () => {
    const test = await app("account");
    const response = await test.instance.inject({
      method: "GET",
      url: "/v1/session/csrf",
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    const document = response.json();
    expect(document).toMatchObject({
      schemaVersion: "mk8dx.web-csrf.v1",
      headerName: "X-MK8DX-CSRF",
    });
    expect(test.csrf.verify({
      role: "account",
      userAccountId: "user_account.web_csrf_owner_01",
    }, document.value)).toBe(true);
  });

  it("returns fixed authentication and authorization failures", async () => {
    for (const [actor, status, code] of [
      ["anonymous", 401, "csrf_authentication_required"],
      ["migration_operator", 403, "csrf_forbidden"],
    ] as const) {
      const test = await app(actor);
      const response = await test.instance.inject({
        method: "GET",
        url: "/v1/session/csrf",
      });
      expect(response.statusCode).toBe(status);
      expect(response.json()).toMatchObject({ code });
      expect(response.headers["cache-control"]).toBe("no-store");
    }
  });

  it("redacts actor and runtime dependency failures", async () => {
    const instance = await buildApp({
      identityRepository: new NullIdentityReads(),
      resolveActor: async () => {
        throw new Error("private provider session");
      },
      webCsrf: {
        service: {
          issue: () => {
            throw new WebCsrfConfigurationError("private key detail");
          },
        },
      },
    });
    openApps.push(instance);
    const response = await instance.inject({ method: "GET", url: "/v1/session/csrf" });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      code: "csrf_issuance_failed",
      message: "The CSRF proof could not be issued.",
    });
    expect(response.body).not.toMatch(/provider session|key detail/);
  });
});
