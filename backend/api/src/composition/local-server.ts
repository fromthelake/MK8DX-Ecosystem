import {
  createLocalApiRuntime,
  type LocalApiRuntime,
  type LocalApiRuntimeConfig,
  type LocalApiRuntimeRoutePolicies,
  type LocalRuntimeEnvironment,
  type VerifiedProviderSubjectResolver,
} from "./local-runtime.js";

const loopbackHosts = new Set(["127.0.0.1", "localhost", "::1"]);

export class LocalServerConfigurationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "LocalServerConfigurationError";
  }
}

export type LocalApiServerConfig = Readonly<{
  host: "127.0.0.1" | "localhost" | "::1";
  port: number;
}>;

export function loadLocalApiServerConfig(
  environment: LocalRuntimeEnvironment,
): LocalApiServerConfig {
  const host = environment["MK8DX_LOCAL_API_HOST"] ?? "127.0.0.1";
  if (!loopbackHosts.has(host)) {
    throw new LocalServerConfigurationError("MK8DX_LOCAL_API_HOST must be loopback");
  }
  const rawPort = environment["MK8DX_LOCAL_API_PORT"] ?? "3108";
  if (!/^[0-9]+$/.test(rawPort)) {
    throw new LocalServerConfigurationError("MK8DX_LOCAL_API_PORT is invalid");
  }
  const port = Number(rawPort);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new LocalServerConfigurationError("MK8DX_LOCAL_API_PORT is invalid");
  }
  return { host: host as LocalApiServerConfig["host"], port };
}

export type ShutdownSignal = "SIGINT" | "SIGTERM";

export interface ShutdownSignalSource {
  once(signal: ShutdownSignal, listener: () => void): unknown;
  off(signal: ShutdownSignal, listener: () => void): unknown;
}

export type LocalApiServer = Readonly<{
  address: string;
  runtime: LocalApiRuntime;
  close(): Promise<void>;
}>;

export function bindGracefulShutdown(
  server: Pick<LocalApiServer, "close">,
  signals: ShutdownSignalSource,
  onFailure: (error: unknown) => void,
): () => void {
  let disposed = false;
  const shutdown = () => {
    if (disposed) { return; }
    disposed = true;
    signals.off("SIGINT", shutdown);
    signals.off("SIGTERM", shutdown);
    void server.close().catch(onFailure);
  };
  signals.once("SIGINT", shutdown);
  signals.once("SIGTERM", shutdown);
  return () => {
    if (disposed) { return; }
    disposed = true;
    signals.off("SIGINT", shutdown);
    signals.off("SIGTERM", shutdown);
  };
}

export async function startLocalApiServer(
  runtimeConfig: LocalApiRuntimeConfig,
  serverConfig: LocalApiServerConfig,
  resolveVerifiedProviderSubject: VerifiedProviderSubjectResolver,
  routePolicies: LocalApiRuntimeRoutePolicies = {},
): Promise<LocalApiServer> {
  if (!loopbackHosts.has(serverConfig.host) || !Number.isSafeInteger(serverConfig.port) ||
    serverConfig.port < 0 || serverConfig.port > 65535) {
    throw new LocalServerConfigurationError("local server address is invalid");
  }
  const runtime = await createLocalApiRuntime(
    runtimeConfig,
    resolveVerifiedProviderSubject,
    routePolicies,
  );
  try {
    const address = await runtime.app.listen({
      host: serverConfig.host,
      port: serverConfig.port,
    });
    let closed = false;
    return {
      address,
      runtime,
      async close(): Promise<void> {
        if (closed) { return; }
        closed = true;
        await runtime.close();
      },
    };
  } catch (error) {
    await runtime.close();
    throw error;
  }
}
