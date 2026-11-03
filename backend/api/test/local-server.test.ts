import { EventEmitter } from "node:events";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import {
  LocalServerConfigurationError,
  bindGracefulShutdown,
  loadLocalApiServerConfig,
  startLocalApiServer,
  type ShutdownSignalSource,
} from "../src/composition/local-server.js";
import { loadLocalApiRuntimeConfig } from "../src/composition/local-runtime.js";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const key = (byte: number) => Buffer.alloc(32, byte).toString("base64");

function runtimeConfig() {
  return loadLocalApiRuntimeConfig({
    MK8DX_LOCAL_MYSQL_DATABASE: "mk8dx_server_test",
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
  });
}

describe("local API server", () => {
  it("loads only loopback host and a bounded explicit port", () => {
    expect(loadLocalApiServerConfig({})).toEqual({ host: "127.0.0.1", port: 3108 });
    expect(loadLocalApiServerConfig({
      MK8DX_LOCAL_API_HOST: "::1",
      MK8DX_LOCAL_API_PORT: "43108",
    })).toEqual({ host: "::1", port: 43108 });
    expect(() => loadLocalApiServerConfig({
      MK8DX_LOCAL_API_HOST: "0.0.0.0",
    })).toThrow(LocalServerConfigurationError);
    expect(() => loadLocalApiServerConfig({
      MK8DX_LOCAL_API_PORT: "0",
    })).toThrow(LocalServerConfigurationError);
  });

  it("listens on loopback and closes idempotently without a database connection", async () => {
    const server = await startLocalApiServer(
      runtimeConfig(),
      { host: "127.0.0.1", port: 0 },
      async () => null,
    );
    try {
      const response = await fetch(`${server.address}/health/live`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: "alive" });
    } finally {
      await server.close();
      await server.close();
    }
  });

  it("closes partial runtime composition when the requested port is occupied", async () => {
    const first = await startLocalApiServer(
      runtimeConfig(),
      { host: "127.0.0.1", port: 0 },
      async () => null,
    );
    try {
      const occupiedPort = Number(new URL(first.address).port);
      await expect(startLocalApiServer(
        runtimeConfig(),
        { host: "127.0.0.1", port: occupiedPort },
        async () => null,
      )).rejects.toMatchObject({ code: "EADDRINUSE" });
      const response = await fetch(`${first.address}/health/live`);
      expect(response.status).toBe(200);
    } finally {
      await first.close();
    }
  });

  it("turns SIGINT/SIGTERM into one graceful close and detaches listeners", async () => {
    const signals = new EventEmitter() as EventEmitter & ShutdownSignalSource;
    const close = vi.fn(async () => undefined);
    const failure = vi.fn();
    const dispose = bindGracefulShutdown({ close }, signals, failure);
    signals.emit("SIGTERM");
    signals.emit("SIGINT");
    await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(failure).not.toHaveBeenCalled();
    expect(signals.listenerCount("SIGINT")).toBe(0);
    expect(signals.listenerCount("SIGTERM")).toBe(0);
    dispose();
  });

  it("reports asynchronous shutdown failure through the injected handler", async () => {
    const signals = new EventEmitter() as EventEmitter & ShutdownSignalSource;
    const error = new Error("synthetic close failure");
    const failure = vi.fn();
    bindGracefulShutdown({ close: async () => { throw error; } }, signals, failure);
    signals.emit("SIGINT");
    await vi.waitFor(() => expect(failure).toHaveBeenCalledWith(error));
  });
});
