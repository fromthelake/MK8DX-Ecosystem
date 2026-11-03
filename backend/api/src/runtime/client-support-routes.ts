import type { FastifyInstance } from "fastify";

import {
  releaseBuildNumber,
  type AppDownloadEntry,
  type AppDownloadStore,
} from "./app-downloads.js";

// Which builds of the native client may still be used.
//
// The downloads themselves are for a signed-in account, but "your build has
// been turned off" is not something a Player should have to sign in to find
// out — the whole point is to reach somebody whose app may already be unable
// to do anything useful. So this one answer is public. It carries no file, no
// path and no hash: a version string, the builds that are out, and the page to
// open.
//
// Two switches, one rule, because the owner needs both shapes:
//
//   minimumSupportedBuild   everything before this build must update
//   retiredBuilds           these specific builds must update
//
// A build is retired when it is below the minimum or named in the list. Both
// are absent by default, which is the state every release is in until somebody
// deliberately turns a build off.

export type ClientSupport = Readonly<{
  currentVersion: string;
  currentBuild: number | null;
  minimumSupportedBuild: number;
  retiredBuilds: readonly number[];
  downloadPagePath: string;
  message?: string;
}>;

export function clientSupportFor(entry: AppDownloadEntry): ClientSupport {
  return {
    currentVersion: entry.version,
    currentBuild: releaseBuildNumber(entry.version),
    minimumSupportedBuild: entry.minimumSupportedBuild ?? 1,
    retiredBuilds: entry.retiredBuilds ?? [],
    downloadPagePath: "/?apps=1",
    ...(entry.supportMessage === undefined ? {} : { message: entry.supportMessage }),
  };
}

/**
 * Whether a specific build must update before it may be used. The server
 * decides this too, rather than only publishing the numbers, so a client that
 * reads the answer wrongly is a client bug and not a difference of opinion.
 */
export function buildIsRetired(support: ClientSupport, build: number): boolean {
  return build < support.minimumSupportedBuild || support.retiredBuilds.includes(build);
}

const supportSchema = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "android"],
  properties: {
    schemaVersion: { type: "string", const: "mk8dx.client-support.v1" },
    android: {
      type: "object",
      additionalProperties: false,
      required: [
        "currentVersion", "minimumSupportedBuild", "retiredBuilds", "downloadPagePath",
      ],
      properties: {
        currentVersion: { type: "string", minLength: 1, maxLength: 64 },
        currentBuild: { type: "integer", minimum: 1, maximum: 1_000_000 },
        minimumSupportedBuild: { type: "integer", minimum: 1, maximum: 1_000_000 },
        retiredBuilds: {
          type: "array", maxItems: 200,
          items: { type: "integer", minimum: 1, maximum: 1_000_000 },
        },
        downloadPagePath: { type: "string", minLength: 1, maxLength: 128 },
        message: { type: "string", minLength: 1, maxLength: 300 },
      },
    },
  },
} as const;

export async function registerClientSupportRoutes(
  app: FastifyInstance,
  store: AppDownloadStore,
): Promise<void> {
  app.get("/v1/public/client-support", {
    schema: { response: { 200: supportSchema } },
  }, async (_request, reply) => {
    const android = store.catalog().entries.find(
      (row) => row.id === "android-timetrials" && row.platform === "android",
    );
    void reply.header("cache-control", "no-store");
    return reply.send({
      schemaVersion: "mk8dx.client-support.v1",
      android: android === undefined
        // No Android artifact is published at all. Nothing is retired: an
        // absent manifest must never lock a Player out of their own app.
        ? {
          currentVersion: "0",
          minimumSupportedBuild: 1,
          retiredBuilds: [],
          downloadPagePath: "/?apps=1",
        }
        : (({ currentBuild, ...rest }) => ({
          ...rest,
          ...(currentBuild === null ? {} : { currentBuild }),
        }))(clientSupportFor(android)),
    });
  });
}
