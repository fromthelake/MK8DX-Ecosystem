// Same-origin serving of the private schema-9 game-asset pack.
//
// The pack (cup icons, track previews, flags, characters, …) is deployed to
// the host outside Git and outside the release package (production-only
// visual assets; public redistribution is a separate Phase 10 decision).
// Requests are validated fail-closed: a closed path grammar, resolution
// pinned under the configured root, and a raster extension whitelist plus
// one explicitly reviewed Nintendo wordmark SVG — traversal is structurally
// impossible. Files stream from disk with strong validators so the 31MB pack
// never has to live in process memory.

import { createReadStream, statSync } from "node:fs";
import { resolve, sep } from "node:path";

import type { FastifyInstance } from "fastify";

export const GAME_ASSET_ROUTE_PREFIX = "/assets/";

// e.g. images/cups/000_mushroom_cup.png
const assetPathPattern =
  /^(?:[a-z0-9_-]+\/){1,4}[a-z0-9_.-]{1,128}\.(png|jpg|webp|avif)$/;
const reviewedSvgAssets = new Set([
  "images/system/Nintendo_red_logo.svg",
]);

const contentTypes: Readonly<Record<string, string>> = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
};

export class GameAssetConfigurationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "GameAssetConfigurationError";
  }
}

export function validateGameAssetRoot(rootDirectory: string): string {
  const resolved = resolve(rootDirectory);
  let probe;
  try {
    probe = statSync(resolved);
  } catch {
    throw new GameAssetConfigurationError(
      "the configured game-asset root does not exist",
    );
  }
  if (!probe.isDirectory()) {
    throw new GameAssetConfigurationError(
      "the configured game-asset root is not a directory",
    );
  }
  return resolved;
}

export async function registerGameAssetRoutes(
  app: FastifyInstance,
  options: Readonly<{ rootDirectory: string }>,
): Promise<void> {
  const root = validateGameAssetRoot(options.rootDirectory);
  app.get<{ Params: { "*": string } }>(
    `${GAME_ASSET_ROUTE_PREFIX}*`,
    async (request, reply) => {
      const relative = request.params["*"];
      const match = typeof relative === "string"
        ? assetPathPattern.exec(relative)
        : null;
      const extension = match?.[1] ??
        (typeof relative === "string" && reviewedSvgAssets.has(relative)
          ? "svg"
          : null);
      if (extension === null) {
        return reply.code(404).send();
      }
      const absolute = resolve(root, relative);
      if (absolute !== root && !absolute.startsWith(root + sep)) {
        return reply.code(404).send();
      }
      let file;
      try {
        file = statSync(absolute);
      } catch {
        return reply.code(404).send();
      }
      if (!file.isFile()) {
        return reply.code(404).send();
      }
      const etag = `"${file.size.toString(16)}-${Math.trunc(file.mtimeMs)
        .toString(16)}"`;
      reply.header("etag", etag);
      reply.header("cache-control", "public, max-age=86400");
      reply.header("x-content-type-options", "nosniff");
      if (request.headers["if-none-match"] === etag) {
        return reply.code(304).send();
      }
      reply.header("content-length", String(file.size));
      return reply
        .type(contentTypes[extension] ?? "application/octet-stream")
        .send(createReadStream(absolute));
    },
  );
}
