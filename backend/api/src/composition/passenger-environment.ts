import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { HostedRuntimeEnvironment } from "./hosted-runtime-config.js";

export class PassengerEnvironmentError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "PassengerEnvironmentError";
  }
}

export type PassengerEnvironmentIo = Readonly<{
  pathExists(path: string): boolean;
  readFile(path: string): string;
}>;

const defaultIo: PassengerEnvironmentIo = {
  pathExists: existsSync,
  readFile: (path) => readFileSync(path, "utf8"),
};

// Phusion Passenger (DirectAdmin/CloudLinux Node.js Selector) does not supply
// a PORT: it intercepts the application's listen() call and binds its own
// managed socket. The hosted configuration still requires an explicit port,
// so when neither the platform PORT nor MK8DX_HOSTED_API_PORT is present we
// default a loopback placeholder that Passenger's interception ignores. Any
// explicitly configured port always wins unchanged.
export const PASSENGER_PLACEHOLDER_PORT = "3000";

// The Selector exposes environment variables only through its panel UI, so
// the Passenger entry additionally reads a private JSON environment file in
// the application root (outside the document root, operator-created with
// 0600 permissions, never committed). Only MK8DX_HOSTED_* string values are
// accepted, and a variable already present in the real environment (for
// example set later through the panel) always wins over the file.
export const PASSENGER_PRIVATE_ENV_FILE = "mk8dx-hosted.env.json";

export function loadPrivateEnvironmentFile(
  workingDirectory: string,
  io: PassengerEnvironmentIo = defaultIo,
): Readonly<Record<string, string>> {
  const path = resolve(workingDirectory, PASSENGER_PRIVATE_ENV_FILE);
  if (!io.pathExists(path)) {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(io.readFile(path));
  } catch {
    throw new PassengerEnvironmentError(
      "the private hosted environment file is not valid JSON",
    );
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new PassengerEnvironmentError(
      "the private hosted environment file must contain one JSON object",
    );
  }
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (!key.startsWith("MK8DX_HOSTED_") || typeof value !== "string") {
      throw new PassengerEnvironmentError(
        "the private hosted environment file may contain only " +
        "MK8DX_HOSTED_* string values",
      );
    }
    result[key] = value;
  }
  return result;
}

// The confirmed Application URL is the domain root, so the application also
// serves the static web product; when MK8DX_HOSTED_STATIC_WEB_ROOT is not
// configured, the release package's web/ directory next to the application
// root is the default whenever it exists.
export function passengerEnvironment(
  environment: HostedRuntimeEnvironment,
  workingDirectory: string = process.cwd(),
  io: PassengerEnvironmentIo = defaultIo,
): HostedRuntimeEnvironment {
  const fileValues = loadPrivateEnvironmentFile(workingDirectory, io);
  let result: HostedRuntimeEnvironment = environment;
  const missingFileEntries = Object.entries(fileValues)
    .filter(([key]) => environment[key] === undefined);
  if (missingFileEntries.length > 0) {
    result = { ...result, ...Object.fromEntries(missingFileEntries) };
  }
  if (result["PORT"] === undefined &&
    result["MK8DX_HOSTED_API_PORT"] === undefined) {
    result = { ...result, MK8DX_HOSTED_API_PORT: PASSENGER_PLACEHOLDER_PORT };
  }
  if (result["MK8DX_HOSTED_STATIC_WEB_ROOT"] === undefined) {
    const packagedWebRoot = resolve(workingDirectory, "web");
    if (io.pathExists(packagedWebRoot)) {
      result = { ...result, MK8DX_HOSTED_STATIC_WEB_ROOT: packagedWebRoot };
    }
  }
  // The private game-asset pack is deployed next to the application root
  // (outside Git and outside the release package); serve it when present.
  if (result["MK8DX_HOSTED_GAME_ASSET_ROOT"] === undefined) {
    const deployedAssetRoot = resolve(workingDirectory, "game-assets");
    if (io.pathExists(deployedAssetRoot)) {
      result = { ...result, MK8DX_HOSTED_GAME_ASSET_ROOT: deployedAssetRoot };
    }
  }
  return result;
}
