import { isIP } from "node:net";
import { isAbsolute } from "node:path";

import {
  MK8DX_ANDROID_CLIENT_ID,
  MK8DX_DESKTOP_CLIENT_ID,
  MK8DX_TOURNAMENT_DESKTOP_CLIENT_ID,
  type EmbeddedAuthSecret,
} from "../authentication/embedded-passwordless-auth.js";
import type { ProtectedValueDecryptionKeyring, ProtectedValueKeyMaterial } from
  "../security/protected-value-adapters.js";
import type { WebCsrfKeyMaterial } from "../security/web-csrf-service.js";
import type { AuthenticationSubjectHmacKeyMaterial } from
  "../authentication/authentication-subject-hmac-protector.js";
import type { PasswordlessHostedRuntimeConfig } from "./hosted-runtime.js";

const keyVersionPattern = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const databasePattern = /^[A-Za-z0-9_]{1,64}$/;
const hostnamePattern = /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/;
const mysqlUserPattern = /^[A-Za-z0-9_@.-]{1,128}$/;
const producerVersionPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const forbiddenDatabases = new Set(["information_schema", "mysql", "performance_schema", "sys"]);

export type HostedRuntimeEnvironment = Readonly<Record<string, string | undefined>>;

export class HostedRuntimeConfigurationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "HostedRuntimeConfigurationError";
  }
}

function required(environment: HostedRuntimeEnvironment, name: string): string {
  const value = environment[name];
  if (value === undefined || value.length === 0) {
    throw new HostedRuntimeConfigurationError(`${name} is required`);
  }
  return value;
}

function integer(
  environment: HostedRuntimeEnvironment,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = environment[name];
  if (raw === undefined) { return fallback; }
  if (!/^[0-9]+$/.test(raw)) {
    throw new HostedRuntimeConfigurationError(`${name} is invalid`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new HostedRuntimeConfigurationError(`${name} is invalid`);
  }
  return value;
}

function boolean(environment: HostedRuntimeEnvironment, name: string): boolean {
  const value = required(environment, name);
  if (value !== "true" && value !== "false") {
    throw new HostedRuntimeConfigurationError(`${name} is invalid`);
  }
  return value === "true";
}

function key(environment: HostedRuntimeEnvironment, name: string): Uint8Array {
  const encoded = required(environment, name);
  const decoded = Buffer.from(encoded, "base64");
  if (decoded.byteLength !== 32 || decoded.toString("base64") !== encoded) {
    throw new HostedRuntimeConfigurationError(
      `${name} must be canonical base64 for 32 bytes`,
    );
  }
  return Uint8Array.from(decoded);
}

function keyVersion(environment: HostedRuntimeEnvironment, name: string): string {
  const value = required(environment, name);
  if (!keyVersionPattern.test(value) || value.length > 64) {
    throw new HostedRuntimeConfigurationError(`${name} is invalid`);
  }
  return value;
}

function parseObject(environment: HostedRuntimeEnvironment, name: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(required(environment, name));
  } catch {
    throw new HostedRuntimeConfigurationError(`${name} is invalid`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new HostedRuntimeConfigurationError(`${name} is invalid`);
  }
  return parsed as Record<string, unknown>;
}

function keyring(
  environment: HostedRuntimeEnvironment,
  name: string,
  active: ProtectedValueKeyMaterial,
): ProtectedValueDecryptionKeyring {
  const parsed = parseObject(environment, name);
  if (Object.keys(parsed).length > 16) {
    throw new HostedRuntimeConfigurationError(`${name} is invalid`);
  }
  const result: Record<string, Uint8Array> = {};
  for (const [version, encoded] of Object.entries(parsed)) {
    if (!keyVersionPattern.test(version) || version.length > 64 ||
      typeof encoded !== "string") {
      throw new HostedRuntimeConfigurationError(`${name} is invalid`);
    }
    const decoded = Buffer.from(encoded, "base64");
    if (decoded.byteLength !== 32 || decoded.toString("base64") !== encoded) {
      throw new HostedRuntimeConfigurationError(`${name} is invalid`);
    }
    result[version] = Uint8Array.from(decoded);
  }
  const configured = result[active.encryptionKeyVersion];
  if (configured !== undefined &&
    !Buffer.from(configured).equals(Buffer.from(active.encryptionKey))) {
    throw new HostedRuntimeConfigurationError(`${name} conflicts with its active key`);
  }
  result[active.encryptionKeyVersion] = Uint8Array.from(active.encryptionKey);
  return result;
}

function protectedKeys(
  environment: HostedRuntimeEnvironment,
  prefix: "MK8DX_HOSTED_TIME_TRIAL" | "MK8DX_HOSTED_TOURNAMENT",
): ProtectedValueKeyMaterial {
  return {
    encryptionKey: key(environment, `${prefix}_ENCRYPTION_KEY_BASE64`),
    encryptionKeyVersion: keyVersion(environment, `${prefix}_ENCRYPTION_KEY_VERSION`),
    lookupHmacKey: key(environment, `${prefix}_LOOKUP_HMAC_KEY_BASE64`),
    lookupKeyVersion: keyVersion(environment, `${prefix}_LOOKUP_KEY_VERSION`),
  };
}

function retainedAuthenticationLookupKeys(
  environment: HostedRuntimeEnvironment,
  active: AuthenticationSubjectHmacKeyMaterial,
): readonly AuthenticationSubjectHmacKeyMaterial[] {
  const raw = environment["MK8DX_HOSTED_AUTHENTICATION_RETAINED_LOOKUP_KEYS_JSON"];
  if (raw === undefined) { return []; }
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch {
    throw new HostedRuntimeConfigurationError(
      "MK8DX_HOSTED_AUTHENTICATION_RETAINED_LOOKUP_KEYS_JSON is invalid",
    );
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed) ||
    Object.keys(parsed).length > 7) {
    throw new HostedRuntimeConfigurationError(
      "MK8DX_HOSTED_AUTHENTICATION_RETAINED_LOOKUP_KEYS_JSON is invalid",
    );
  }
  const retained: AuthenticationSubjectHmacKeyMaterial[] = [];
  for (const [version, encoded] of Object.entries(parsed)) {
    if (!keyVersionPattern.test(version) || typeof encoded !== "string" ||
      version === active.lookupKeyVersion) {
      throw new HostedRuntimeConfigurationError(
        "MK8DX_HOSTED_AUTHENTICATION_RETAINED_LOOKUP_KEYS_JSON is invalid",
      );
    }
    const decoded = Buffer.from(encoded, "base64");
    if (decoded.byteLength !== 32 || decoded.toString("base64") !== encoded) {
      throw new HostedRuntimeConfigurationError(
        "MK8DX_HOSTED_AUTHENTICATION_RETAINED_LOOKUP_KEYS_JSON is invalid",
      );
    }
    retained.push({ lookupHmacKey: Uint8Array.from(decoded), lookupKeyVersion: version });
  }
  return retained;
}

function stringArray(
  environment: HostedRuntimeEnvironment,
  name: string,
  minimum: number,
  maximum: number,
): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(required(environment, name));
  } catch {
    throw new HostedRuntimeConfigurationError(`${name} is invalid`);
  }
  if (!Array.isArray(parsed) || parsed.length < minimum || parsed.length > maximum ||
    parsed.some((value) => typeof value !== "string" || value.length < 1) ||
    new Set(parsed).size !== parsed.length) {
    throw new HostedRuntimeConfigurationError(`${name} is invalid`);
  }
  return parsed as string[];
}

function authSecrets(
  environment: HostedRuntimeEnvironment,
): EmbeddedAuthSecret[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(required(environment, "MK8DX_HOSTED_AUTH_SECRETS_JSON"));
  } catch {
    throw new HostedRuntimeConfigurationError("MK8DX_HOSTED_AUTH_SECRETS_JSON is invalid");
  }
  if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > 4) {
    throw new HostedRuntimeConfigurationError("MK8DX_HOSTED_AUTH_SECRETS_JSON is invalid");
  }
  return parsed.map((candidate) => {
    if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate) ||
      Object.keys(candidate).sort().join(",") !== "value,version") {
      throw new HostedRuntimeConfigurationError("MK8DX_HOSTED_AUTH_SECRETS_JSON is invalid");
    }
    const { version, value } = candidate as Record<string, unknown>;
    if (!Number.isSafeInteger(version) || typeof version !== "number" ||
      version < 1 || version > 2_147_483_647 || typeof value !== "string") {
      throw new HostedRuntimeConfigurationError("MK8DX_HOSTED_AUTH_SECRETS_JSON is invalid");
    }
    const decoded = Buffer.from(value, "base64");
    if (decoded.byteLength !== 32 || decoded.toString("base64") !== value) {
      throw new HostedRuntimeConfigurationError("MK8DX_HOSTED_AUTH_SECRETS_JSON is invalid");
    }
    return { version, value };
  });
}

function csrfKeys(environment: HostedRuntimeEnvironment): WebCsrfKeyMaterial {
  const activeKeyVersion = keyVersion(
    environment,
    "MK8DX_HOSTED_WEB_CSRF_ACTIVE_KEY_VERSION",
  );
  const parsed = parseObject(environment, "MK8DX_HOSTED_WEB_CSRF_KEYS_JSON");
  if (Object.keys(parsed).length < 1 || Object.keys(parsed).length > 4) {
    throw new HostedRuntimeConfigurationError("MK8DX_HOSTED_WEB_CSRF_KEYS_JSON is invalid");
  }
  const keys: Record<string, Uint8Array> = {};
  for (const [version, encoded] of Object.entries(parsed)) {
    if (!keyVersionPattern.test(version) || typeof encoded !== "string") {
      throw new HostedRuntimeConfigurationError("MK8DX_HOSTED_WEB_CSRF_KEYS_JSON is invalid");
    }
    const decoded = Buffer.from(encoded, "base64");
    if (decoded.byteLength !== 32 || decoded.toString("base64") !== encoded) {
      throw new HostedRuntimeConfigurationError("MK8DX_HOSTED_WEB_CSRF_KEYS_JSON is invalid");
    }
    keys[version] = Uint8Array.from(decoded);
  }
  if (keys[activeKeyVersion] === undefined) {
    throw new HostedRuntimeConfigurationError(
      "MK8DX_HOSTED_WEB_CSRF_ACTIVE_KEY_VERSION is unavailable",
    );
  }
  return { activeKeyVersion, keys };
}

function ensureDistinctSecrets(values: readonly Uint8Array[]): void {
  const encoded = values.map((value) => Buffer.from(value).toString("base64"));
  if (new Set(encoded).size !== encoded.length) {
    throw new HostedRuntimeConfigurationError("hosted security keys must be distinct");
  }
}

function webPushConfiguration(
  environment: HostedRuntimeEnvironment,
): Readonly<{ subject: string; publicKey: string; privateKey: string }> | undefined {
  const subject = environment["MK8DX_HOSTED_WEB_PUSH_SUBJECT"];
  const publicKey = environment["MK8DX_HOSTED_WEB_PUSH_PUBLIC_KEY"];
  const privateKey = environment["MK8DX_HOSTED_WEB_PUSH_PRIVATE_KEY"];
  if (subject === undefined && publicKey === undefined && privateKey === undefined) {
    return undefined;
  }
  if (subject === undefined || publicKey === undefined || privateKey === undefined) {
    throw new HostedRuntimeConfigurationError(
      "all MK8DX_HOSTED_WEB_PUSH_* values must be supplied together",
    );
  }
  let parsedSubject: URL;
  try { parsedSubject = new URL(subject); } catch {
    throw new HostedRuntimeConfigurationError("MK8DX_HOSTED_WEB_PUSH_SUBJECT is invalid");
  }
  if (!new Set(["https:", "mailto:"]).has(parsedSubject.protocol) ||
      Buffer.from(publicKey, "base64url").byteLength !== 65 ||
      Buffer.from(privateKey, "base64url").byteLength !== 32 ||
      !/^[A-Za-z0-9_-]+$/.test(publicKey) || !/^[A-Za-z0-9_-]+$/.test(privateKey)) {
    throw new HostedRuntimeConfigurationError("MK8DX_HOSTED_WEB_PUSH_* configuration is invalid");
  }
  return { subject, publicKey, privateKey };
}

export type HostedMysqlRuntimeConfig = Readonly<{
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  connectionLimit: number;
}>;

export function loadHostedMysqlRuntimeConfig(
  environment: HostedRuntimeEnvironment,
): HostedMysqlRuntimeConfig {
  const host = required(environment, "MK8DX_HOSTED_MYSQL_HOST");
  if (isIP(host) === 0 && !hostnamePattern.test(host)) {
    throw new HostedRuntimeConfigurationError("MK8DX_HOSTED_MYSQL_HOST is invalid");
  }
  const database = required(environment, "MK8DX_HOSTED_MYSQL_DATABASE");
  if (!databasePattern.test(database) || forbiddenDatabases.has(database.toLowerCase())) {
    throw new HostedRuntimeConfigurationError("MK8DX_HOSTED_MYSQL_DATABASE is invalid");
  }
  const user = required(environment, "MK8DX_HOSTED_MYSQL_USER");
  if (!mysqlUserPattern.test(user)) {
    throw new HostedRuntimeConfigurationError("MK8DX_HOSTED_MYSQL_USER is invalid");
  }
  const password = required(environment, "MK8DX_HOSTED_MYSQL_PASSWORD");
  if (password.length > 1024) {
    throw new HostedRuntimeConfigurationError("MK8DX_HOSTED_MYSQL_PASSWORD is invalid");
  }
  return {
    host,
    port: integer(environment, "MK8DX_HOSTED_MYSQL_PORT", 3306, 1, 65535),
    user,
    password,
    database,
    connectionLimit: integer(
      environment,
      "MK8DX_HOSTED_MYSQL_CONNECTION_LIMIT",
      10,
      1,
      32,
    ),
  };
}

export function loadPasswordlessHostedRuntimeConfig(
  environment: HostedRuntimeEnvironment,
): PasswordlessHostedRuntimeConfig {
  const mysql = loadHostedMysqlRuntimeConfig(environment);
  const schema9CatalogPath = required(
    environment,
    "MK8DX_HOSTED_SCHEMA9_CATALOG_PATH",
  );
  if (!isAbsolute(schema9CatalogPath)) {
    throw new HostedRuntimeConfigurationError(
      "MK8DX_HOSTED_SCHEMA9_CATALOG_PATH must be absolute",
    );
  }

  const authenticationLookupKey = key(
    environment,
    "MK8DX_HOSTED_AUTHENTICATION_LOOKUP_HMAC_KEY_BASE64",
  );
  const authenticationKeys = {
    lookupHmacKey: authenticationLookupKey,
    lookupKeyVersion: keyVersion(
      environment,
      "MK8DX_HOSTED_AUTHENTICATION_LOOKUP_KEY_VERSION",
    ),
  };
  const authenticationRetainedKeys = retainedAuthenticationLookupKeys(
    environment,
    authenticationKeys,
  );
  const timeTrialKeys = protectedKeys(environment, "MK8DX_HOSTED_TIME_TRIAL");
  const tournamentKeys = protectedKeys(environment, "MK8DX_HOSTED_TOURNAMENT");
  const configuredCsrfKeys = csrfKeys(environment);
  const secrets = authSecrets(environment);
  const configuredWebPush = webPushConfiguration(environment);
  ensureDistinctSecrets([
    authenticationLookupKey,
    ...authenticationRetainedKeys.map((entry) => entry.lookupHmacKey),
    timeTrialKeys.encryptionKey,
    timeTrialKeys.lookupHmacKey,
    tournamentKeys.encryptionKey,
    tournamentKeys.lookupHmacKey,
    ...Object.values(configuredCsrfKeys.keys),
    ...secrets.map(({ value }) => Buffer.from(value, "base64")),
  ]);

  const baseUrl = required(environment, "MK8DX_HOSTED_AUTH_BASE_URL");
  const trustedOrigins = stringArray(environment, "MK8DX_HOSTED_AUTH_TRUSTED_ORIGINS_JSON", 1, 8);
  const localDemo = environment["MK8DX_LOCAL_DEMO"] === "true";
  const offlineLan = environment["MK8DX_OFFLINE_LAN"] === "true";
  if (environment["MK8DX_OFFLINE_LAN"] !== undefined &&
      !["true", "false"].includes(environment["MK8DX_OFFLINE_LAN"]!)) {
    throw new HostedRuntimeConfigurationError("MK8DX_OFFLINE_LAN is invalid");
  }
  if (offlineLan) {
    let origin: URL;
    try { origin = new URL(baseUrl); } catch {
      throw new HostedRuntimeConfigurationError("offline LAN origin is invalid");
    }
    const octets = origin.hostname.split(".").map(Number);
    const privateIp = octets.length === 4 &&
      (octets[0] === 10 || (octets[0] === 172 && octets[1]! >= 16 && octets[1]! <= 31) ||
       (octets[0] === 192 && octets[1] === 168));
    if (localDemo || origin.protocol !== "https:" || isIP(origin.hostname) !== 4 ||
        !privateIp || origin.origin !== baseUrl || origin.pathname !== "/" ||
        origin.search || origin.hash || origin.username || origin.password ||
        trustedOrigins.length !== 1 || trustedOrigins[0] !== baseUrl ||
        configuredWebPush !== undefined ||
        ["MK8DX_HOSTED_SMTP_HOST", "MK8DX_HOSTED_SMTP_USERNAME",
         "MK8DX_HOSTED_SMTP_PASSWORD", "MK8DX_HOSTED_SMTP_FROM_ADDRESS"]
          .some((name) => (environment[name] ?? "").length > 0)) {
      throw new HostedRuntimeConfigurationError("offline LAN requires an exact private-IP HTTPS origin and no external delivery");
    }
  }
  if (environment["MK8DX_LOCAL_DEMO"] !== undefined &&
      environment["MK8DX_LOCAL_DEMO"] !== "true") {
    throw new HostedRuntimeConfigurationError("MK8DX_LOCAL_DEMO is invalid");
  }
  if (localDemo) {
    let origin: URL;
    try { origin = new URL(baseUrl); } catch {
      throw new HostedRuntimeConfigurationError("local demo origin is invalid");
    }
    if (origin.protocol !== "http:" ||
        !["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname) ||
        origin.pathname !== "/" || origin.search || origin.hash ||
        origin.username || origin.password || origin.origin !== baseUrl) {
      throw new HostedRuntimeConfigurationError("local demo requires an exact loopback HTTP origin");
    }
  }
  const producerVersion = required(
    environment,
    "MK8DX_HOSTED_WEB_PRODUCER_VERSION",
  );
  if (!producerVersionPattern.test(producerVersion)) {
    throw new HostedRuntimeConfigurationError(
      "MK8DX_HOSTED_WEB_PRODUCER_VERSION is invalid",
    );
  }
  return {
    ...(offlineLan ? { offlineLan: true } : {}),
    core: {
      mysql,
      schema9CatalogPath,
      authenticationKeys,
      ...(authenticationRetainedKeys.length === 0 ? {} : { authenticationRetainedKeys }),
      timeTrialKeys,
      timeTrialDecryptionKeys: keyring(
        environment,
        "MK8DX_HOSTED_TIME_TRIAL_DECRYPTION_KEYS_JSON",
        timeTrialKeys,
      ),
      tournamentKeys,
      tournamentDecryptionKeys: keyring(
        environment,
        "MK8DX_HOSTED_TOURNAMENT_DECRYPTION_KEYS_JSON",
        tournamentKeys,
      ),
    },
    authentication: {
      baseUrl,
      production: !localDemo,
      trustedOrigins,
      secrets,
      nativeClientIds: [
        MK8DX_ANDROID_CLIENT_ID,
        MK8DX_DESKTOP_CLIENT_ID,
        MK8DX_TOURNAMENT_DESKTOP_CLIENT_ID,
      ],
      clientIpHeaders: stringArray(
        environment,
        "MK8DX_HOSTED_AUTH_CLIENT_IP_HEADERS_JSON",
        1,
        4,
      ),
      trustedProxyAddresses: stringArray(
        environment,
        "MK8DX_HOSTED_AUTH_TRUSTED_PROXIES_JSON",
        1,
        16,
      ),
    },
    ...(offlineLan ? {} : { smtp: {
      host: required(environment, "MK8DX_HOSTED_SMTP_HOST"),
      port: integer(environment, "MK8DX_HOSTED_SMTP_PORT", 465, 1, 65535),
      secure: boolean(environment, "MK8DX_HOSTED_SMTP_SECURE"),
      username: localDemo ? environment["MK8DX_HOSTED_SMTP_USERNAME"] ?? "" :
        required(environment, "MK8DX_HOSTED_SMTP_USERNAME"),
      password: localDemo ? environment["MK8DX_HOSTED_SMTP_PASSWORD"] ?? "" :
        required(environment, "MK8DX_HOSTED_SMTP_PASSWORD"),
      fromAddress: required(environment, "MK8DX_HOSTED_SMTP_FROM_ADDRESS"),
      allowedLinkOrigin: baseUrl,
      localDemo,
    } }),
    webManual: { producerVersion, csrfKeys: configuredCsrfKeys },
    ...(configuredWebPush === undefined ? {} : { webPush: configuredWebPush }),
  };
}
