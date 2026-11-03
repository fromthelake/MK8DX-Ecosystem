import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  bindGracefulShutdown,
  loadLocalApiServerConfig,
  startLocalApiServer,
  type LocalApiServer,
  type ShutdownSignalSource,
} from "./local-server.js";
import {
  loadLocalApiRuntimeConfig,
  type LocalRuntimeEnvironment,
  type VerifiedProviderSubjectResolver,
} from "./local-runtime.js";

type StartLocalApiServer = typeof startLocalApiServer;

export type AnonymousLocalApiDependencies = Readonly<{
  startServer?: StartLocalApiServer;
  signals?: ShutdownSignalSource;
  onStarted?: (address: string) => void;
  onShutdownFailure?: () => void;
}>;

export type AnonymousLocalApi = Readonly<{
  address: string;
  server: LocalApiServer;
  close(): Promise<void>;
}>;

const anonymousSubject: VerifiedProviderSubjectResolver = async () => null;

export async function startAnonymousLocalApi(
  environment: LocalRuntimeEnvironment,
  dependencies: AnonymousLocalApiDependencies = {},
): Promise<AnonymousLocalApi> {
  const runtimeConfig = loadLocalApiRuntimeConfig(environment);
  const serverConfig = loadLocalApiServerConfig(environment);
  const server = await (dependencies.startServer ?? startLocalApiServer)(
    runtimeConfig,
    serverConfig,
    anonymousSubject,
  );
  const disposeSignals = bindGracefulShutdown(
    server,
    dependencies.signals ?? process,
    () => (dependencies.onShutdownFailure ?? defaultShutdownFailure)(),
  );
  (dependencies.onStarted ?? defaultStarted)(server.address);
  let closed = false;
  return {
    address: server.address,
    server,
    async close(): Promise<void> {
      if (closed) { return; }
      closed = true;
      disposeSignals();
      await server.close();
    },
  };
}

function defaultStarted(address: string): void {
  process.stdout.write(`MK8DX anonymous-only local API listening at ${address}\n`);
}

function defaultShutdownFailure(): void {
  process.stderr.write("MK8DX local API shutdown failed.\n");
  process.exitCode = 1;
}

export async function runAnonymousLocalApiCli(
  environment: LocalRuntimeEnvironment,
  dependencies: AnonymousLocalApiDependencies = {},
  onStartupFailure: () => void = () => {
    process.stderr.write("MK8DX local API startup failed.\n");
    process.exitCode = 1;
  },
): Promise<void> {
  try {
    await startAnonymousLocalApi(environment, dependencies);
  } catch {
    onStartupFailure();
  }
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined &&
  import.meta.url === pathToFileURL(resolve(invokedPath)).href) {
  void runAnonymousLocalApiCli(process.env);
}
