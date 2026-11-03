import {
  createPasswordlessHostedRuntime,
  type PasswordlessHostedRuntime,
} from "./hosted-runtime.js";
import {
  loadPasswordlessHostedRuntimeConfig,
  type HostedRuntimeEnvironment,
} from "./hosted-runtime-config.js";
import {
  JsonLineOperationalLog,
  type OperationalLogSink,
} from "../runtime/operational-log.js";
import { loadAppDownloads } from "../runtime/app-downloads.js";
import type { AppDownloadStore } from "../runtime/app-downloads.js";
import { loadStaticWebFiles } from "../runtime/static-web.js";

const allowedHosts = new Set(["127.0.0.1", "::1", "0.0.0.0"]);

export class HostedServerConfigurationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "HostedServerConfigurationError";
  }
}

export type HostedServerConfig = Readonly<{
  host: "127.0.0.1" | "::1" | "0.0.0.0";
  port: number;
}>;

export function loadHostedServerConfig(
  environment: HostedRuntimeEnvironment,
): HostedServerConfig {
  const host = environment["MK8DX_HOSTED_API_HOST"] ?? "127.0.0.1";
  if (!allowedHosts.has(host)) {
    throw new HostedServerConfigurationError("MK8DX_HOSTED_API_HOST is invalid");
  }
  const platformPort = environment["PORT"];
  const configuredPort = environment["MK8DX_HOSTED_API_PORT"];
  if (platformPort !== undefined && configuredPort !== undefined &&
    platformPort !== configuredPort) {
    throw new HostedServerConfigurationError("hosted API port configuration conflicts");
  }
  const rawPort = platformPort ?? configuredPort;
  if (rawPort === undefined || !/^[0-9]+$/.test(rawPort)) {
    throw new HostedServerConfigurationError("a hosted API port is required");
  }
  const port = Number(rawPort);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new HostedServerConfigurationError("hosted API port is invalid");
  }
  return { host: host as HostedServerConfig["host"], port };
}

export type PasswordlessHostedServer = Readonly<{
  address: string;
  runtime: PasswordlessHostedRuntime;
  close(): Promise<void>;
}>;

export async function startPasswordlessHostedServer(
  environment: HostedRuntimeEnvironment,
  operationalLog: OperationalLogSink = new JsonLineOperationalLog(process.stdout),
): Promise<PasswordlessHostedServer> {
  const runtimeConfig = loadPasswordlessHostedRuntimeConfig(environment);
  const serverConfig = loadHostedServerConfig(environment);
  const staticWebRoot = environment["MK8DX_HOSTED_STATIC_WEB_ROOT"];
  const gameAssetRoot = environment["MK8DX_HOSTED_GAME_ASSET_ROOT"];
  // Optional: when configured, the owner's private app builds are offered to
  // signed-in community members from outside the document root.
  const downloadRoot = environment["MK8DX_HOSTED_APP_DOWNLOAD_ROOT"];
  const runtime = await createPasswordlessHostedRuntime({
    ...runtimeConfig,
    operationalLog,
    // Root-mounted Passenger deployments must serve the static web product
    // same-origin; loading fails closed when the configured root is invalid.
    ...(staticWebRoot === undefined || staticWebRoot.length === 0
      ? {}
      : { staticWeb: { files: await loadStaticWebFiles(staticWebRoot) } }),
    ...(environment["MK8DX_HOSTED_PUBLIC_BUNDLE_ROOT"]
      ? { publicBundle: { root: environment["MK8DX_HOSTED_PUBLIC_BUNDLE_ROOT"],
                          origin: runtimeConfig.authentication.baseUrl } }
      : {}),
    // The private schema-9 game-asset pack (production-only visuals) is
    // served same-origin when configured; route registration fails closed
    // on an invalid root.
    ...(gameAssetRoot === undefined || gameAssetRoot.length === 0
      ? {}
      : { gameAssets: { rootDirectory: gameAssetRoot } }),
    ...(await optionalAppDownloads(downloadRoot)),
  });
  try {
    const address = await runtime.app.listen(serverConfig);
    operationalLog.log({
      event: "server_started",
      category: "lifecycle",
      detail: address,
    });
    let closed = false;
    return {
      address,
      runtime,
      async close(): Promise<void> {
        if (closed) { return; }
        closed = true;
        await runtime.close();
        operationalLog.log({ event: "server_closed", category: "lifecycle" });
      },
    };
  } catch (error) {
    operationalLog.log({
      event: "server_start_failed",
      category: "lifecycle",
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    await runtime.close();
    throw error;
  }
}

// A download that is missing or does not match its manifest must never stop
// the platform from serving: the Apps page simply reports that there is
// nothing to install yet.
async function optionalAppDownloads(
  rootDirectory: string | undefined,
): Promise<Readonly<{ appDownloads?: { store: AppDownloadStore } }>> {
  if (rootDirectory === undefined || rootDirectory.length === 0) { return {}; }
  try {
    return { appDownloads: { store: await loadAppDownloads(rootDirectory) } };
  } catch {
    return {};
  }
}
