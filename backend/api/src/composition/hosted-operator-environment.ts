import { readFileSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";

import type { HostedRuntimeEnvironment } from "./hosted-runtime-config.js";

export class HostedOperatorEnvironmentError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "HostedOperatorEnvironmentError";
  }
}

export type HostedOperatorEnvironmentIo = Readonly<{
  readFile(path: string): string;
  inspect(path: string): Readonly<{ isFile: boolean; mode: number }>;
  platform: NodeJS.Platform;
}>;

const defaultIo: HostedOperatorEnvironmentIo = {
  readFile: (path) => readFileSync(path, "utf8"),
  inspect: (path) => {
    const details = statSync(path);
    return { isFile: details.isFile(), mode: details.mode };
  },
  platform: process.platform,
};

export function loadHostedOperatorEnvironment(
  path: string,
  io: HostedOperatorEnvironmentIo = defaultIo,
): HostedRuntimeEnvironment {
  if (!isAbsolute(path)) {
    throw new HostedOperatorEnvironmentError(
      "the private environment file path must be absolute",
    );
  }
  let details: Readonly<{ isFile: boolean; mode: number }>;
  let document: string;
  try {
    details = io.inspect(path);
    document = io.readFile(path);
  } catch {
    throw new HostedOperatorEnvironmentError(
      "the private environment file could not be read",
    );
  }
  if (!details.isFile || (io.platform !== "win32" && (details.mode & 0o077) !== 0)) {
    throw new HostedOperatorEnvironmentError(
      "the private environment file must be a regular owner-only file",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(document);
  } catch {
    throw new HostedOperatorEnvironmentError(
      "the private environment file is not valid JSON",
    );
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new HostedOperatorEnvironmentError(
      "the private environment file must contain one JSON object",
    );
  }
  const environment: Record<string, string> = {};
  for (const [name, value] of Object.entries(parsed)) {
    if (!(name.startsWith("MK8DX_HOSTED_") || (name === "MK8DX_LOCAL_DEMO" && value === "true")) ||
        typeof value !== "string") {
      throw new HostedOperatorEnvironmentError(
        "the private environment file may contain only hosted string settings and the local demo flag",
      );
    }
    environment[name] = value;
  }
  return environment;
}

export function extractPrivateEnvironmentArgument(
  arguments_: readonly string[],
): Readonly<{ environmentPath: string; commandArguments: readonly string[] }> {
  if (arguments_[0] !== "--private-environment-file" || !arguments_[1]) {
    throw new HostedOperatorEnvironmentError(
      "expected --private-environment-file <absolute-owner-only-json-path>",
    );
  }
  return { environmentPath: arguments_[1], commandArguments: arguments_.slice(2) };
}
