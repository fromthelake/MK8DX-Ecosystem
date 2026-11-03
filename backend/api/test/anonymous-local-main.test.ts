import { EventEmitter } from "node:events";
import { fileURLToPath } from "node:url";

import type { FastifyRequest } from "fastify";
import { describe, expect, it, vi } from "vitest";

import {
  runAnonymousLocalApiCli,
  startAnonymousLocalApi,
} from "../src/composition/anonymous-local-main.js";
import {
  startLocalApiServer,
  type LocalApiServer,
  type ShutdownSignalSource,
} from "../src/composition/local-server.js";
import type { LocalRuntimeEnvironment } from
  "../src/composition/local-runtime.js";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const key = (byte: number) => Buffer.alloc(32, byte).toString("base64");

function environment(
  overrides: LocalRuntimeEnvironment = {},
): LocalRuntimeEnvironment {
  return {
    MK8DX_LOCAL_API_HOST: "127.0.0.1",
    MK8DX_LOCAL_API_PORT: "43108",
    MK8DX_LOCAL_MYSQL_DATABASE: "mk8dx_anonymous_test",
    MK8DX_LOCAL_MYSQL_USER: "mk8dx_test",
    MK8DX_LOCAL_MYSQL_PASSWORD: "synthetic-private-password",
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

function fakeServer(close = vi.fn(async () => undefined)): LocalApiServer {
  return {
    address: "http://127.0.0.1:43108",
    runtime: {} as LocalApiServer["runtime"],
    close,
  };
}

describe("anonymous-only local API executable composition", () => {
  it("loads validated environment and supplies only a null subject resolver", async () => {
    const signals = new EventEmitter() as EventEmitter & ShutdownSignalSource;
    const close = vi.fn(async () => undefined);
    const server = fakeServer(close);
    let received: Parameters<typeof startLocalApiServer> | undefined;
    const startServer = vi.fn(async (
      ...args: Parameters<typeof startLocalApiServer>
    ) => {
      received = args;
      return server;
    });
    const onStarted = vi.fn();

    const running = await startAnonymousLocalApi(environment(), {
      startServer,
      signals,
      onStarted,
    });

    expect(startServer).toHaveBeenCalledOnce();
    expect(received).toBeDefined();
    const call = received!;
    expect(call[0].mysql).toMatchObject({
      host: "127.0.0.1",
      port: 3306,
      user: "mk8dx_test",
      database: "mk8dx_anonymous_test",
    });
    expect(call[1]).toEqual({ host: "127.0.0.1", port: 43108 });
    expect(call).toHaveLength(3);
    expect(await call[2]({} as FastifyRequest)).toBeNull();
    expect(onStarted).toHaveBeenCalledWith("http://127.0.0.1:43108");

    await running.close();
    await running.close();
    expect(close).toHaveBeenCalledOnce();
    expect(signals.listenerCount("SIGINT")).toBe(0);
    expect(signals.listenerCount("SIGTERM")).toBe(0);
  });

  it("turns signal close failure into a detail-free callback", async () => {
    const signals = new EventEmitter() as EventEmitter & ShutdownSignalSource;
    const close = vi.fn(async () => {
      throw new Error("private pool shutdown detail");
    });
    const failure = vi.fn();
    await startAnonymousLocalApi(environment(), {
      startServer: vi.fn(async () => fakeServer(close)),
      signals,
      onStarted: vi.fn(),
      onShutdownFailure: failure,
    });

    signals.emit("SIGTERM");
    await vi.waitFor(() => expect(failure).toHaveBeenCalledOnce());
    expect(failure).toHaveBeenCalledWith();
    expect(signals.listenerCount("SIGINT")).toBe(0);
    expect(signals.listenerCount("SIGTERM")).toBe(0);
  });

  it("rejects invalid environment before attempting server composition", async () => {
    const startServer = vi.fn(async () => fakeServer());
    let failure: unknown;
    try {
      await startAnonymousLocalApi(environment({
        MK8DX_LOCAL_MYSQL_HOST: "private-database.example.test",
      }), { startServer });
    } catch (error) {
      failure = error;
    }
    expect(startServer).not.toHaveBeenCalled();
    expect(String(failure)).not.toContain("private-database.example.test");
    expect(String(failure)).not.toContain("synthetic-private-password");
  });

  it("redacts startup failures at the process-facing CLI boundary", async () => {
    const startupFailure = vi.fn();
    await runAnonymousLocalApiCli(
      environment(),
      {
        startServer: vi.fn(async () => {
          throw new Error("private connection or credential detail");
        }),
        onStarted: vi.fn(),
      },
      startupFailure,
    );
    expect(startupFailure).toHaveBeenCalledOnce();
    expect(startupFailure).toHaveBeenCalledWith();
  });
});
