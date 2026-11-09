import { createReadStream } from "node:fs";
import { lstat, readdir, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { FastifyInstance } from "fastify";

const types: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".woff2": "font/woff2", ".wasm": "application/wasm",
  ".onnx": "application/octet-stream", ".pack": "application/octet-stream",
  ".traineddata": "application/octet-stream", ".txt": "text/plain; charset=utf-8",
};

export class PublicBundleError extends Error {}

/** A closed startup inventory; no URL is ever interpreted as a filesystem path. */
export async function registerPublicBundleRoutes(
  app: FastifyInstance, bundleRoot: string, origin: string, offlineLan = false,
): Promise<void> {
  if (!isAbsolute(bundleRoot)) throw new PublicBundleError("public bundle root must be absolute");
  const root = await realpath(bundleRoot);
  const files = new Map<string, Readonly<{ path: string; type: string }>>();
  const addTree = async (directory: string, prefix: string): Promise<void> => {
    const folder = resolve(root, directory);
    if ((await realpath(folder)) !== folder) throw new PublicBundleError("linked public directory");
    const visit = async (path: string, url: string): Promise<void> => {
      for (const entry of await readdir(path, { withFileTypes: true })) {
        if (entry.isSymbolicLink() || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(entry.name)) {
          throw new PublicBundleError("linked or invalid public entry");
        }
        const file = join(path, entry.name);
        const route = `${url}/${entry.name}`;
        if (entry.isDirectory()) { await visit(file, route); continue; }
        if (!entry.isFile()) throw new PublicBundleError("unexpected public entry");
        const canonical = await realpath(file);
        if (relative(root, canonical).startsWith(`..${sep}`) || canonical === root ||
            (await lstat(file)).isSymbolicLink()) throw new PublicBundleError("public path escapes bundle");
        const extension = entry.name.slice(entry.name.lastIndexOf(".")).toLowerCase();
        // The scanner's packaged shared-icon masks use .bin; keep the allowance
        // inside that generated public tree, not for arbitrary bundle files.
        const type = extension === ".bin" && route.startsWith("/scanner/shared-icon/")
          ? "application/octet-stream" : types[extension];
        if (type === undefined) throw new PublicBundleError("unsupported public file type");
        files.set(route, { path: canonical, type });
      }
    };
    await visit(folder, prefix);
  };
  await addTree("assets", "/assets");
  await addTree("scanner", "/scanner");
  const scannerIndex = files.get("/scanner/index.html");
  if (!scannerIndex) throw new PublicBundleError("scanner index missing");
  files.set("/scanner/", scannerIndex);
  for (const [route, file] of files) {
    app.get(route, async (_request, reply) => {
      reply.header("x-content-type-options", "nosniff");
      reply.header("cache-control", route.endsWith(".html") || route.endsWith(".json") ? "no-cache" : "public, max-age=3600");
      if (route.startsWith("/scanner/")) {
        reply.header("cross-origin-opener-policy", "same-origin");
        reply.header("cross-origin-embedder-policy", "require-corp");
        reply.header("cross-origin-resource-policy", "same-origin");
      }
      return reply.type(file.type).send(createReadStream(file.path));
    });
  }
  app.get("/client-config.json", async (_request, reply) => {
    reply.header("cache-control", "no-store");
    return reply.send({ schemaVersion: "mk8dx.public-client.v1", websiteOrigin: origin,
      ...(offlineLan ? { authenticationMode: "offline-invitation" } : {}) });
  });
}
