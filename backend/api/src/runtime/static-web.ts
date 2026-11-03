// Same-origin static serving of the web product for the root-mounted
// Passenger deployment (checklist B4: the Application URL is the domain
// root, so every request reaches the Node application).
//
// Files are loaded into memory once at startup from a fixed whitelist
// (index.html plus the styles/ and dist/ directories with known text
// extensions) and served from that closed route map — request paths are
// never joined onto the filesystem, so traversal is structurally impossible.
// Responses carry the same restrictive security headers the validated HTTPS
// gateway used, plus strong ETags with 304 revalidation.

import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

const contentTypes: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  // Data the page fetches on demand rather than carries in its bundle: the
  // community's tournament stories (a quarter megabyte of prose).
  ".json": "application/json; charset=utf-8",
  // Self-hosted design-system fonts and their SIL OFL licence texts
  // (docs/design-system/DESIGN_SYSTEM.md §3.1).
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};
const fileNamePattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
// The rolled-up web bundle is one file that crossed 1 MiB minified on
// 2026-09-07 and took production down at startup; the bounds exist to
// keep the in-memory site sane, not to fit today's bundle exactly. The
// release builder validates a package against these same bounds.
const maximumFileBytes = 4 * 1_048_576;
const maximumTotalBytes = 16 * 1_048_576;

export const STATIC_WEB_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "content-security-policy":
    "default-src 'self'; connect-src 'self'; img-src 'self'; " +
    "style-src 'self'; script-src 'self'; base-uri 'none'; " +
    "form-action 'self'; object-src 'none'; frame-ancestors 'none'",
  "referrer-policy": "same-origin",
  "strict-transport-security": "max-age=31536000",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
};

export const PLAIN_PAGES: readonly (readonly [string, string])[] = [
  ["/privacy", "privacy.html"],
  ["/terms", "terms.html"],
  ["/livetrial", "livetrial.html"],
];

export type StaticWebFile = Readonly<{
  contentType: string;
  body: Buffer;
  etag: string;
}>;

export class StaticWebConfigurationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "StaticWebConfigurationError";
  }
}

function toFile(body: Buffer, extension: string): StaticWebFile {
  const contentType = contentTypes[extension];
  if (contentType === undefined) {
    throw new StaticWebConfigurationError(
      `static web extension is not on the whitelist: ${extension}`,
    );
  }
  if (body.byteLength < 1 || body.byteLength > maximumFileBytes) {
    throw new StaticWebConfigurationError(
      "a static web file is empty or exceeds the per-file bound",
    );
  }
  return {
    contentType,
    body,
    etag: `"${createHash("sha256").update(body).digest("hex").slice(0, 32)}"`,
  };
}

async function loadDirectory(
  rootDir: string,
  directory: "styles" | "dist",
  files: Map<string, StaticWebFile>,
): Promise<void> {
  const absolute = join(rootDir, directory);
  try {
    if (!(await stat(absolute)).isDirectory()) {
      throw new StaticWebConfigurationError(
        `static web ${directory} is not a directory`,
      );
    }
  } catch (error) {
    if (error instanceof StaticWebConfigurationError) {
      throw error;
    }
    throw new StaticWebConfigurationError(
      `static web ${directory} directory could not be read`,
    );
  }
  for (const name of await readdir(absolute)) {
    if (!fileNamePattern.test(name) || name.includes("..")) {
      throw new StaticWebConfigurationError(
        `static web file name is not on the whitelist: ${directory}`,
      );
    }
    const extension = name.slice(name.lastIndexOf("."));
    const body = await readFile(join(absolute, name));
    files.set(`/${directory}/${name}`, toFile(body, extension));
  }
}

export async function loadStaticWebFiles(
  rootDir: string,
): Promise<ReadonlyMap<string, StaticWebFile>> {
  const files = new Map<string, StaticWebFile>();
  let indexBody: Buffer;
  try {
    indexBody = await readFile(join(rootDir, "index.html"));
  } catch {
    throw new StaticWebConfigurationError(
      "static web root has no readable index.html",
    );
  }
  const index = toFile(indexBody, ".html");
  files.set("/", index);
  files.set("/index.html", index);
  // ADR-0137: native clients (Android, LiveTrial) send the user to the
  // same-origin `/device?user_code=...` approval page. Root-mounted hosted
  // deployments have no separate web-server rewrite, so the application
  // serves the same document there; the page itself reads `location.pathname`.
  files.set("/device", index);
  // Android App Links: the phone fetches this at install and checks the
  // release signing certificate in it against the installed package, which is
  // what lets a tap on a mk8dx.example link open the app instead of a
  // browser. A certificate fingerprint is public - it is inside every copy of
  // the APK - and this file is meaningless without one, so it is committed.
  // It must answer 200 on the exact path, with no redirect.
  try {
    files.set(
      "/.well-known/assetlinks.json",
      toFile(await readFile(join(rootDir, "assetlinks.json")), ".json"),
    );
  } catch (error) {
    if (error instanceof StaticWebConfigurationError) throw error;
    throw new StaticWebConfigurationError(
      "static web root has no readable assetlinks.json",
    );
  }
  for (const [name, extension] of [
    ["manifest.webmanifest", ".webmanifest"],
    ["sw.js", ".js"],
  ] as const) {
    try {
      files.set(`/${name}`, toFile(await readFile(join(rootDir, name)), extension));
    } catch (error) {
      if (error instanceof StaticWebConfigurationError) throw error;
      throw new StaticWebConfigurationError(`static web root has no readable ${name}`);
    }
  }
  // Plain pages that need no JavaScript: the privacy policy, the terms and the
  // LiveTrial page the home page's footer links to (Google's OAuth and YouTube
  // API reviews read them, ADR-0213). Optional, so an installation without
  // them still starts; a present page must pass the same bounds.
  for (const [route, name] of PLAIN_PAGES) {
    let body: Buffer;
    try {
      body = await readFile(join(rootDir, "pages", name));
    } catch {
      continue;
    }
    files.set(route, toFile(body, ".html"));
  }
  await loadDirectory(rootDir, "styles", files);
  await loadDirectory(rootDir, "dist", files);
  const totalBytes = [...files.values()]
    .reduce((sum, file) => sum + file.body.byteLength, 0);
  if (totalBytes > maximumTotalBytes) {
    throw new StaticWebConfigurationError(
      "static web content exceeds the total in-memory bound",
    );
  }
  return files;
}
