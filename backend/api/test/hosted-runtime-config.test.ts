import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  HostedRuntimeConfigurationError,
  loadHostedMysqlRuntimeConfig,
  loadPasswordlessHostedRuntimeConfig,
  type HostedRuntimeEnvironment,
} from "../src/composition/hosted-runtime-config.js";
import {
  HostedServerConfigurationError,
  loadHostedServerConfig,
} from "../src/composition/hosted-server.js";

const key = (byte: number): string => Buffer.alloc(32, byte).toString("base64");

function environment(
  overrides: HostedRuntimeEnvironment = {},
): HostedRuntimeEnvironment {
  return {
    MK8DX_HOSTED_MYSQL_HOST: "mysql.example.test",
    MK8DX_HOSTED_MYSQL_PORT: "3306",
    MK8DX_HOSTED_MYSQL_USER: "mk8dx_runtime",
    MK8DX_HOSTED_MYSQL_PASSWORD: "private-mysql-password",
    MK8DX_HOSTED_MYSQL_DATABASE: "mk8dx_production",
    MK8DX_HOSTED_MYSQL_CONNECTION_LIMIT: "8",
    MK8DX_HOSTED_SCHEMA9_CATALOG_PATH: resolve(
      "runtime", "packages", "assets", "schema9-asset-catalog-v1.json",
    ),
    MK8DX_HOSTED_AUTHENTICATION_LOOKUP_HMAC_KEY_BASE64: key(1),
    MK8DX_HOSTED_AUTHENTICATION_LOOKUP_KEY_VERSION: "auth-lookup-v1",
    MK8DX_HOSTED_TIME_TRIAL_ENCRYPTION_KEY_BASE64: key(2),
    MK8DX_HOSTED_TIME_TRIAL_ENCRYPTION_KEY_VERSION: "tt-enc-v1",
    MK8DX_HOSTED_TIME_TRIAL_LOOKUP_HMAC_KEY_BASE64: key(3),
    MK8DX_HOSTED_TIME_TRIAL_LOOKUP_KEY_VERSION: "tt-lookup-v1",
    MK8DX_HOSTED_TIME_TRIAL_DECRYPTION_KEYS_JSON:
      JSON.stringify({ "tt-old-v1": key(9) }),
    MK8DX_HOSTED_TOURNAMENT_ENCRYPTION_KEY_BASE64: key(4),
    MK8DX_HOSTED_TOURNAMENT_ENCRYPTION_KEY_VERSION: "tournament-enc-v1",
    MK8DX_HOSTED_TOURNAMENT_LOOKUP_HMAC_KEY_BASE64: key(5),
    MK8DX_HOSTED_TOURNAMENT_LOOKUP_KEY_VERSION: "tournament-lookup-v1",
    MK8DX_HOSTED_TOURNAMENT_DECRYPTION_KEYS_JSON: "{}",
    MK8DX_HOSTED_WEB_CSRF_ACTIVE_KEY_VERSION: "csrf-v1",
    MK8DX_HOSTED_WEB_CSRF_KEYS_JSON: JSON.stringify({ "csrf-v1": key(6) }),
    MK8DX_HOSTED_AUTH_BASE_URL: "https://mk8dx.example",
    MK8DX_HOSTED_AUTH_TRUSTED_ORIGINS_JSON:
      JSON.stringify(["https://mk8dx.example"]),
    MK8DX_HOSTED_AUTH_SECRETS_JSON:
      JSON.stringify([{ version: 1, value: key(7) }]),
    MK8DX_HOSTED_AUTH_CLIENT_IP_HEADERS_JSON: JSON.stringify(["x-real-ip"]),
    MK8DX_HOSTED_AUTH_TRUSTED_PROXIES_JSON: JSON.stringify(["127.0.0.1"]),
    MK8DX_HOSTED_SMTP_HOST: "smtp.example.test",
    MK8DX_HOSTED_SMTP_PORT: "465",
    MK8DX_HOSTED_SMTP_SECURE: "true",
    MK8DX_HOSTED_SMTP_USERNAME: "auth@example.test",
    MK8DX_HOSTED_SMTP_PASSWORD: "private-smtp-password",
    MK8DX_HOSTED_SMTP_FROM_ADDRESS: "auth@example.test",
    MK8DX_HOSTED_WEB_PRODUCER_VERSION: "timetrials-web-v1",
    ...overrides,
  };
}

describe("passwordless hosted runtime configuration", () => {
  it("loads the bootstrap CLI MySQL subset without authentication or SMTP settings", () => {
    expect(loadHostedMysqlRuntimeConfig({
      MK8DX_HOSTED_MYSQL_HOST: "mysql.example.test",
      MK8DX_HOSTED_MYSQL_USER: "mk8dx_runtime",
      MK8DX_HOSTED_MYSQL_PASSWORD: "private-mysql-password",
      MK8DX_HOSTED_MYSQL_DATABASE: "mk8dx_production",
    })).toEqual({
      host: "mysql.example.test",
      port: 3306,
      user: "mk8dx_runtime",
      password: "private-mysql-password",
      database: "mk8dx_production",
      connectionLimit: 10,
    });
  });

  it("loads one production-only MySQL, auth, SMTP, and web composition", () => {
    const config = loadPasswordlessHostedRuntimeConfig(environment({
      MK8DX_HOSTED_WEB_PUSH_SUBJECT: "mailto:operator@example.test",
      MK8DX_HOSTED_WEB_PUSH_PUBLIC_KEY: Buffer.alloc(65, 8).toString("base64url"),
      MK8DX_HOSTED_WEB_PUSH_PRIVATE_KEY: Buffer.alloc(32, 9).toString("base64url"),
    }));
    expect(config.core.mysql).toMatchObject({
      host: "mysql.example.test",
      database: "mk8dx_production",
      connectionLimit: 8,
    });
    expect(config.authentication).toMatchObject({
      baseUrl: "https://mk8dx.example",
      production: true,
      nativeClientIds: [
        "mk8dx.timetrials.android.v1",
        "mk8dx.timetrials.desktop.v1",
        "mk8dx.tournament.desktop.v1",
      ],
    });
    expect(Object.keys(config.core.timeTrialDecryptionKeys).sort()).toEqual([
      "tt-enc-v1",
      "tt-old-v1",
    ]);
    expect(config.smtp).toMatchObject({ secure: true, port: 465 });
    expect(config.webPush).toMatchObject({ subject: "mailto:operator@example.test" });
  });

  it("rejects unsafe database, path, JSON, key, boolean, and secret reuse", () => {
    for (const overrides of [
      { MK8DX_HOSTED_MYSQL_DATABASE: "mysql" },
      { MK8DX_HOSTED_SCHEMA9_CATALOG_PATH: "relative/catalog.json" },
      { MK8DX_HOSTED_AUTH_TRUSTED_ORIGINS_JSON: "not-json" },
      { MK8DX_HOSTED_TIME_TRIAL_ENCRYPTION_KEY_BASE64: "short" },
      { MK8DX_HOSTED_SMTP_SECURE: "yes" },
      { MK8DX_HOSTED_AUTH_SECRETS_JSON: JSON.stringify([{ version: 1, value: "short" }]) },
      { MK8DX_HOSTED_AUTH_SECRETS_JSON: JSON.stringify([{ version: 1, value: key(1) }]) },
      { MK8DX_HOSTED_WEB_PUSH_SUBJECT: "mailto:operator@example.test" },
      {
        MK8DX_HOSTED_WEB_PUSH_SUBJECT: "not-a-contact",
        MK8DX_HOSTED_WEB_PUSH_PUBLIC_KEY: Buffer.alloc(65, 8).toString("base64url"),
        MK8DX_HOSTED_WEB_PUSH_PRIVATE_KEY: Buffer.alloc(32, 9).toString("base64url"),
      },
    ]) {
      expect(() => loadPasswordlessHostedRuntimeConfig(
        environment(overrides),
      )).toThrow(HostedRuntimeConfigurationError);
    }
  });

  it("never includes configured password values in a configuration error", () => {
    const error = (() => {
      try {
        loadPasswordlessHostedRuntimeConfig(environment({
          MK8DX_HOSTED_SMTP_SECURE: "invalid-private-password-marker",
        }));
      } catch (candidate) {
        return candidate;
      }
      return null;
    })();
    expect(error).toBeInstanceOf(HostedRuntimeConfigurationError);
    expect(String(error)).not.toContain("private-mysql-password");
    expect(String(error)).not.toContain("private-smtp-password");
  });
});

describe("passwordless hosted server configuration", () => {
  it("uses the hosting platform port and a closed-list bind address", () => {
    expect(loadHostedServerConfig({ PORT: "3210" })).toEqual({
      host: "127.0.0.1",
      port: 3210,
    });
    expect(loadHostedServerConfig({
      MK8DX_HOSTED_API_HOST: "0.0.0.0",
      MK8DX_HOSTED_API_PORT: "8080",
    })).toEqual({ host: "0.0.0.0", port: 8080 });
  });

  it("rejects missing, conflicting, public-name, and invalid ports", () => {
    for (const candidate of [
      {},
      { PORT: "3000", MK8DX_HOSTED_API_PORT: "3001" },
      { PORT: "3000", MK8DX_HOSTED_API_HOST: "mk8dx.example" },
      { PORT: "0" },
    ]) {
      expect(() => loadHostedServerConfig(candidate)).toThrow(
        HostedServerConfigurationError,
      );
    }
  });
});
