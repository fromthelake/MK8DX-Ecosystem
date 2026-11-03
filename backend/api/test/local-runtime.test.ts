import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import {
  LocalRuntimeConfigurationError,
  createLocalApiRuntime,
  loadLocalApiRuntimeConfig,
  type LocalRuntimeEnvironment,
} from "../src/composition/local-runtime.js";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const key = (byte: number) => Buffer.alloc(32, byte).toString("base64");

function environment(
  overrides: LocalRuntimeEnvironment = {},
): LocalRuntimeEnvironment {
  return {
    MK8DX_LOCAL_MYSQL_DATABASE: "mk8dx_runtime_test",
    MK8DX_LOCAL_MYSQL_USER: "mk8dx_test",
    MK8DX_LOCAL_MYSQL_PASSWORD: "synthetic-password",
    MK8DX_LOCAL_AUTHENTICATION_LOOKUP_HMAC_KEY_BASE64: key(5),
    MK8DX_LOCAL_AUTHENTICATION_LOOKUP_KEY_VERSION: "auth-lookup-v1",
    MK8DX_LOCAL_SCHEMA9_CATALOG_PATH:
      `${repoRoot}packages/assets/schema9-asset-catalog-v1.json`,
    MK8DX_LOCAL_TIME_TRIAL_ENCRYPTION_KEY_BASE64: key(1),
    MK8DX_LOCAL_TIME_TRIAL_ENCRYPTION_KEY_VERSION: "tt-enc-v1",
    MK8DX_LOCAL_TIME_TRIAL_LOOKUP_HMAC_KEY_BASE64: key(2),
    MK8DX_LOCAL_TIME_TRIAL_LOOKUP_KEY_VERSION: "tt-lookup-v1",
    MK8DX_LOCAL_TOURNAMENT_ENCRYPTION_KEY_BASE64: key(3),
    MK8DX_LOCAL_TOURNAMENT_ENCRYPTION_KEY_VERSION: "tournament-enc-v1",
    MK8DX_LOCAL_TOURNAMENT_LOOKUP_HMAC_KEY_BASE64: key(4),
    MK8DX_LOCAL_TOURNAMENT_LOOKUP_KEY_VERSION: "tournament-lookup-v1",
    ...overrides,
  };
}

describe("local API runtime configuration", () => {
  it("loads an explicit loopback disposable schema and separate product keys", () => {
    const config = loadLocalApiRuntimeConfig(environment({
      MK8DX_LOCAL_MYSQL_HOST: "localhost",
      MK8DX_LOCAL_MYSQL_PORT: "33318",
      MK8DX_LOCAL_MYSQL_CONNECTION_LIMIT: "4",
    }));
    expect(config.mysql).toEqual({
      host: "localhost",
      port: 33318,
      user: "mk8dx_test",
      password: "synthetic-password",
      database: "mk8dx_runtime_test",
      connectionLimit: 4,
    });
    expect(config.timeTrialKeys.encryptionKey).toEqual(Uint8Array.from(Buffer.alloc(32, 1)));
    expect(config.tournamentKeys.lookupHmacKey).toEqual(Uint8Array.from(Buffer.alloc(32, 4)));
    expect(config.authenticationKeys).toEqual({
      lookupHmacKey: Uint8Array.from(Buffer.alloc(32, 5)),
      lookupKeyVersion: "auth-lookup-v1",
    });
  });

  it.each([
    ["non-loopback host", { MK8DX_LOCAL_MYSQL_HOST: "database.example.test" }],
    ["unclassified database", { MK8DX_LOCAL_MYSQL_DATABASE: "mk8dx_production" }],
    ["relative catalog", { MK8DX_LOCAL_SCHEMA9_CATALOG_PATH: "catalog.json" }],
    ["invalid port", { MK8DX_LOCAL_MYSQL_PORT: "0" }],
    ["invalid user", { MK8DX_LOCAL_MYSQL_USER: "bad user" }],
    ["non-canonical key", { MK8DX_LOCAL_TIME_TRIAL_ENCRYPTION_KEY_BASE64: "secret" }],
    ["invalid key version", { MK8DX_LOCAL_TOURNAMENT_LOOKUP_KEY_VERSION: "bad key" }],
    ["missing authentication key", {
      MK8DX_LOCAL_AUTHENTICATION_LOOKUP_HMAC_KEY_BASE64: undefined,
    }],
    ["invalid authentication key version", {
      MK8DX_LOCAL_AUTHENTICATION_LOOKUP_KEY_VERSION: "Bad Version",
    }],
  ])("rejects %s without echoing configuration values", (_label, overrides) => {
    let failure: unknown;
    try {
      loadLocalApiRuntimeConfig(environment(overrides));
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(LocalRuntimeConfigurationError);
    expect(String(failure)).not.toContain("database.example.test");
    expect(String(failure)).not.toContain("mk8dx_production");
    expect(String(failure)).not.toContain("synthetic-password");
  });

  it("rejects equal encryption and lookup keys within either product", () => {
    expect(() => loadLocalApiRuntimeConfig(environment({
      MK8DX_LOCAL_TIME_TRIAL_LOOKUP_HMAC_KEY_BASE64: key(1),
    }))).toThrow("MK8DX_LOCAL_TIME_TRIAL keys must be distinct");
    expect(() => loadLocalApiRuntimeConfig(environment({
      MK8DX_LOCAL_TOURNAMENT_ENCRYPTION_KEY_BASE64: key(1),
    }))).toThrow("local protected-value and authentication keys must be distinct");
    expect(() => loadLocalApiRuntimeConfig(environment({
      MK8DX_LOCAL_AUTHENTICATION_LOOKUP_HMAC_KEY_BASE64: key(4),
    }))).toThrow("local protected-value and authentication keys must be distinct");
  });

  it("retains explicit old decryption keys and rejects an active-key conflict", () => {
    const config = loadLocalApiRuntimeConfig(environment({
      MK8DX_LOCAL_TIME_TRIAL_DECRYPTION_KEYS_JSON: JSON.stringify({
        "tt-enc-v0": key(9),
      }),
    }));
    expect(config.timeTrialDecryptionKeys["tt-enc-v0"]).toEqual(
      Uint8Array.from(Buffer.alloc(32, 9)),
    );
    expect(config.timeTrialDecryptionKeys["tt-enc-v1"]).toEqual(
      Uint8Array.from(Buffer.alloc(32, 1)),
    );
    expect(() => loadLocalApiRuntimeConfig(environment({
      MK8DX_LOCAL_TIME_TRIAL_DECRYPTION_KEYS_JSON: JSON.stringify({
        "tt-enc-v1": key(9),
      }),
    }))).toThrow("conflicts with the active key");
  });

  it("composes every adapter/service while keeping result reads off HTTP", async () => {
    const resolveVerifiedProviderSubject = vi.fn(async () => null);
    const runtime = await createLocalApiRuntime(
      loadLocalApiRuntimeConfig(environment()),
      resolveVerifiedProviderSubject,
    );
    try {
      expect(runtime.timeTrialSubmissionService).toBeDefined();
      expect(runtime.timeTrialRevisionReadService).toBeDefined();
      expect(runtime.tournamentRaceResultService).toBeDefined();
      expect(runtime.tournamentRevisionReadService).toBeDefined();
      const routes = runtime.app.printRoutes();
      expect(routes).toContain(":playerId");
      expect(routes).not.toContain("timetrial");
      expect(routes).not.toContain("tournament");
    } finally {
      await runtime.close();
      await runtime.close();
    }
  });

  it("mounts web bootstrap, CSRF, and protected canonical POST only as one policy", async () => {
    const runtime = await createLocalApiRuntime(
      loadLocalApiRuntimeConfig(environment()),
      async () => null,
      {
        webManual: {
          producerVersion: "timetrials-web-local-test",
          csrfKeys: {
            activeKeyVersion: "csrf-v1",
            keys: { "csrf-v1": Uint8Array.from(Buffer.alloc(32, 6)) },
          },
        },
      },
    );
    try {
      const routes = runtime.app.printRoutes();
      expect(routes).toContain("manual-bootstrap");
      const submissionRoute = await runtime.app.inject({
        method: "POST",
        url: "/v1/time-trial-submissions",
      });
      expect(submissionRoute.statusCode).toBe(400);
      for (const url of [
        "/v1/time-trial-submissions/manual-bootstrap" +
          "?trackId=track.mario_kart_stadium",
        "/v1/session/csrf",
        "/v1/session/capabilities",
      ]) {
        const response = await runtime.app.inject({ method: "GET", url });
        expect(response.statusCode).toBe(401);
      }
    } finally {
      await runtime.close();
    }
  });

  it("rejects a reused web CSRF key and closes partial composition", async () => {
    await expect(createLocalApiRuntime(
      loadLocalApiRuntimeConfig(environment()),
      async () => null,
      {
        webManual: {
          producerVersion: "timetrials-web-local-test",
          csrfKeys: {
            activeKeyVersion: "csrf-v1",
            keys: { "csrf-v1": Uint8Array.from(Buffer.alloc(32, 5)) },
          },
        },
      },
    )).rejects.toThrow(
      "web CSRF keys must be distinct from all runtime keys",
    );
  });

  it("fails with a bounded error before pool composition when the catalog is absent", async () => {
    const config = loadLocalApiRuntimeConfig(environment({
      MK8DX_LOCAL_SCHEMA9_CATALOG_PATH: `${repoRoot}packages/assets/missing.json`,
    }));
    await expect(createLocalApiRuntime(
      config,
      async () => null,
    )).rejects.toMatchObject({
      name: "LocalRuntimeConfigurationError",
      message: "schema-9 catalog could not be loaded",
    });
  });

  it("does not echo malformed provider output or query MySQL", async () => {
    const privateSubject = "private-\ud800-subject";
    const runtime = await createLocalApiRuntime(
      loadLocalApiRuntimeConfig(environment()),
      async () => ({ issuerKey: "synthetic_issuer", subject: privateSubject }),
    );
    try {
      const response = await runtime.app.inject({
        method: "GET",
        url: "/v1/user-accounts/user_account.synthetic_target_01",
      });
      expect(response.statusCode).toBe(500);
      expect(response.body).not.toContain(privateSubject);
      expect(response.body).not.toContain("HMAC");
    } finally {
      await runtime.close();
    }
  });

  it("closes partial pool composition when a typed config is externally corrupted", async () => {
    const config = loadLocalApiRuntimeConfig(environment());
    await expect(createLocalApiRuntime({
      ...config,
      timeTrialKeys: {
        ...config.timeTrialKeys,
        encryptionKey: Uint8Array.from([1]),
      },
    }, async () => null)).rejects.toMatchObject({
      name: "ProtectedValueConfigurationError",
    });
    await expect(createLocalApiRuntime({
      ...config,
      authenticationKeys: {
        ...config.authenticationKeys,
        lookupHmacKey: Uint8Array.from([1]),
      },
    }, async () => null)).rejects.toMatchObject({
      name: "AuthenticationSubjectHmacConfigurationError",
    });
  });
});
