import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { registerAppDownloadRoutes } from "../src/runtime/app-download-routes.js";
import { loadAppDownloads } from "../src/runtime/app-downloads.js";
import {
  AppDownloadLinkCapacityError,
  AppDownloadLinkConfigurationError,
  linkFolderAccessRules,
  prepareAppDownloadLinks,
  readAppDownloadLinkConfig,
  webServerTimeStamp,
  type AppDownloadLinks,
} from "../src/runtime/app-download-links.js";
import { MutationRateLimitExceeded } from "../src/security/mysql-mutation-rate-limiter.js";
import type { ActorResolver } from "../src/identity/types.js";

// Shared LiteSpeed/Passenger hosts answer a large file streamed through Node
// with their own error page. The opt-in static-link mode redirects a signed-in
// browser to a short-lived link the web server serves itself.

const temporary: string[] = [];

function directory(prefix: string): string {
  const created = mkdtempSync(join(tmpdir(), prefix));
  temporary.push(created);
  return created;
}

afterEach(() => {
  for (const path of temporary.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

const signedIn: ActorResolver = async () => ({ role: "account", userAccountId: "user.1" });
const anonymous: ActorResolver = async () => ({ role: "anonymous" });

async function storeWith(fileName: string, content: string): Promise<{ root: string; store: Awaited<ReturnType<typeof loadAppDownloads>> }> {
  const root = directory("mk8dx-downloads-");
  writeFileSync(join(root, fileName), content);
  writeFileSync(join(root, "downloads.json"), JSON.stringify({
    schemaVersion: "mk8dx.app-downloads.v1",
    entries: [{
      id: "android-timetrials", platform: "android", title: "MK8DX Time Trials",
      version: "2.44.0-build73", releasedOn: "2026-09-04", fileName,
      bytes: Buffer.byteLength(content), sha256: "a".repeat(64),
      requirements: [], installSteps: [], updateSteps: [],
    }],
  }));
  return { root, store: await loadAppDownloads(root) };
}

async function instance(
  resolveActor: ActorResolver,
  staticLinks?: AppDownloadLinks,
): Promise<{ app: ReturnType<typeof Fastify>; root: string }> {
  const { root, store } = await storeWith("mk8dx.apk", "APK");
  const app = Fastify();
  await registerAppDownloadRoutes(app, {
    resolveActor, store, ...(staticLinks === undefined ? {} : { staticLinks }),
  });
  return { app, root };
}

function linkSetup(): { documentRoot: string; linkDirectory: string } {
  const documentRoot = directory("mk8dx-docroot-");
  return { documentRoot, linkDirectory: join(documentRoot, "dl") };
}

describe("reading the static-link settings", () => {
  it("is off when nothing is configured", () => {
    expect(readAppDownloadLinkConfig({})).toBeNull();
  });

  it("derives the URL path and the ten-minute default", () => {
    const { documentRoot, linkDirectory } = linkSetup();
    const config = readAppDownloadLinkConfig({
      MK8DX_HOSTED_APP_DOWNLOAD_LINK_DOCUMENT_ROOT: documentRoot,
      MK8DX_HOSTED_APP_DOWNLOAD_LINK_DIRECTORY: linkDirectory,
    });
    expect(config).toMatchObject({ urlPath: "/dl", ttlMilliseconds: 600_000 });
  });

  it("takes an explicit URL path and lifetime", () => {
    const { documentRoot, linkDirectory } = linkSetup();
    const config = readAppDownloadLinkConfig({
      MK8DX_HOSTED_APP_DOWNLOAD_LINK_DOCUMENT_ROOT: documentRoot,
      MK8DX_HOSTED_APP_DOWNLOAD_LINK_DIRECTORY: linkDirectory,
      MK8DX_HOSTED_APP_DOWNLOAD_LINK_URL_PATH: "/files/dl",
      MK8DX_HOSTED_APP_DOWNLOAD_LINK_TTL_SECONDS: "300",
    });
    expect(config).toMatchObject({ urlPath: "/files/dl", ttlMilliseconds: 300_000 });
  });

  it.each([
    ["a lone setting without the directory", { MK8DX_HOSTED_APP_DOWNLOAD_LINK_TTL_SECONDS: "600" }],
    ["the directory without the document root", { MK8DX_HOSTED_APP_DOWNLOAD_LINK_DIRECTORY: "/srv/www/dl" }],
    ["a relative directory", {
      MK8DX_HOSTED_APP_DOWNLOAD_LINK_DOCUMENT_ROOT: "/srv/www",
      MK8DX_HOSTED_APP_DOWNLOAD_LINK_DIRECTORY: "dl",
    }],
    ["a directory outside the document root", {
      MK8DX_HOSTED_APP_DOWNLOAD_LINK_DOCUMENT_ROOT: join(tmpdir(), "www"),
      MK8DX_HOSTED_APP_DOWNLOAD_LINK_DIRECTORY: join(tmpdir(), "private", "dl"),
    }],
    ["the document root itself", {
      MK8DX_HOSTED_APP_DOWNLOAD_LINK_DOCUMENT_ROOT: join(tmpdir(), "www"),
      MK8DX_HOSTED_APP_DOWNLOAD_LINK_DIRECTORY: join(tmpdir(), "www"),
    }],
    ["a URL path with a trailing slash", {
      MK8DX_HOSTED_APP_DOWNLOAD_LINK_DOCUMENT_ROOT: join(tmpdir(), "www"),
      MK8DX_HOSTED_APP_DOWNLOAD_LINK_DIRECTORY: join(tmpdir(), "www", "dl"),
      MK8DX_HOSTED_APP_DOWNLOAD_LINK_URL_PATH: "/dl/",
    }],
    ["a URL path that climbs", {
      MK8DX_HOSTED_APP_DOWNLOAD_LINK_DOCUMENT_ROOT: join(tmpdir(), "www"),
      MK8DX_HOSTED_APP_DOWNLOAD_LINK_DIRECTORY: join(tmpdir(), "www", "dl"),
      MK8DX_HOSTED_APP_DOWNLOAD_LINK_URL_PATH: "/dl/..",
    }],
    ["a lifetime that is not a number", {
      MK8DX_HOSTED_APP_DOWNLOAD_LINK_DOCUMENT_ROOT: join(tmpdir(), "www"),
      MK8DX_HOSTED_APP_DOWNLOAD_LINK_DIRECTORY: join(tmpdir(), "www", "dl"),
      MK8DX_HOSTED_APP_DOWNLOAD_LINK_TTL_SECONDS: "10m",
    }],
    ["a lifetime below one minute", {
      MK8DX_HOSTED_APP_DOWNLOAD_LINK_DOCUMENT_ROOT: join(tmpdir(), "www"),
      MK8DX_HOSTED_APP_DOWNLOAD_LINK_DIRECTORY: join(tmpdir(), "www", "dl"),
      MK8DX_HOSTED_APP_DOWNLOAD_LINK_TTL_SECONDS: "5",
    }],
  ])("refuses %s", (_name, environment) => {
    expect(() => readAppDownloadLinkConfig(environment))
      .toThrow(AppDownloadLinkConfigurationError);
  });

  it("refuses a link directory that is itself a symbolic link", async () => {
    const { documentRoot, linkDirectory } = linkSetup();
    const elsewhere = directory("mk8dx-elsewhere-");
    try {
      symlinkSync(elsewhere, linkDirectory, "junction");
    } catch {
      return; // This platform does not let the test make a link.
    }
    const config = readAppDownloadLinkConfig({
      MK8DX_HOSTED_APP_DOWNLOAD_LINK_DOCUMENT_ROOT: documentRoot,
      MK8DX_HOSTED_APP_DOWNLOAD_LINK_DIRECTORY: linkDirectory,
    })!;
    await expect(prepareAppDownloadLinks(config))
      .rejects.toThrow(AppDownloadLinkConfigurationError);
  });
});

describe("the file route with static links", () => {
  async function links(now: () => number = Date.now): Promise<{
    links: AppDownloadLinks; documentRoot: string; linkDirectory: string;
  }> {
    const { documentRoot, linkDirectory } = linkSetup();
    const config = readAppDownloadLinkConfig({
      MK8DX_HOSTED_APP_DOWNLOAD_LINK_DOCUMENT_ROOT: documentRoot,
      MK8DX_HOSTED_APP_DOWNLOAD_LINK_DIRECTORY: linkDirectory,
    })!;
    return { links: await prepareAppDownloadLinks(config, now), documentRoot, linkDirectory };
  }

  it("still refuses an anonymous visitor and makes no link", async () => {
    const prepared = await links();
    const { app } = await instance(anonymous, prepared.links);
    const response = await app.inject({
      method: "GET", url: "/v1/app-downloads/android-timetrials/file",
    });
    expect(response.statusCode).toBe(401);
    expect(linkFolders(prepared.linkDirectory)).toEqual([]);
    await app.close();
  });

  it("redirects a signed-in member to an unguessable link to the stored file", async () => {
    const prepared = await links();
    const { app, root } = await instance(signedIn, prepared.links);
    const response = await app.inject({
      method: "GET", url: "/v1/app-downloads/android-timetrials/file",
    });
    expect(response.statusCode).toBe(302);
    expect(response.headers["cache-control"]).toBe("no-store");
    const location = String(response.headers["location"]);
    const matched = /^\/dl\/([0-9]{10}-[0-9a-f]{64})\/mk8dx\.apk$/.exec(location);
    expect(matched).not.toBeNull();
    const linked = join(prepared.linkDirectory, matched![1]!, "mk8dx.apk");
    expect(readFileSync(linked, "utf8")).toBe("APK");
    // A symbolic link or a hard link: either way the same stored file.
    expect(statSync(linked).ino).toBe(statSync(join(root, "mk8dx.apk")).ino);
    expect(response.body).not.toContain(root);

    // The folder refuses requests on its own once expired (checked by the web server).
    const rules = readFileSync(join(prepared.linkDirectory, matched![1]!, ".htaccess"), "utf8");
    expect(rules).toMatch(/^RewriteEngine On$/m);
    expect(rules).toMatch(/^RewriteCond %\{TIME\} >[0-9]{14}$/m);
    expect(rules).toMatch(/^RewriteRule \^ - \[F\]$/m);
    expect(rules).not.toMatch(/IfModule mod_rewrite/);

    // A repeated click reuses the same folder instead of making a new one.
    const second = await app.inject({
      method: "GET", url: "/v1/app-downloads/android-timetrials/file",
    });
    expect(second.headers["location"]).toBe(location);
    expect(linkFolders(prepared.linkDirectory)).toHaveLength(1);
    await app.close();
  });

  it("answers 404 for an id outside the manifest", async () => {
    const prepared = await links();
    const { app } = await instance(signedIn, prepared.links);
    const response = await app.inject({
      method: "GET", url: "/v1/app-downloads/unknown/file",
    });
    expect(response.statusCode).toBe(404);
    expect(linkFolders(prepared.linkDirectory)).toEqual([]);
    await app.close();
  });

  it("removes expired link folders and leaves everything else alone", async () => {
    const { documentRoot, linkDirectory } = linkSetup();
    mkdirSync(linkDirectory);
    const stored = join(directory("mk8dx-stored-"), "kept.apk");
    writeFileSync(stored, "KEEP");
    const old = new Date(Date.now() - 60 * 60 * 1000);
    const expired = "b".repeat(64);
    mkdirSync(join(linkDirectory, expired));
    symlinkOrCopy(stored, join(linkDirectory, expired, "kept.apk"));
    utimesSync(join(linkDirectory, expired), old, old);
    const fresh = "c".repeat(64);
    mkdirSync(join(linkDirectory, fresh));
    const notOurs = "notes";
    mkdirSync(join(linkDirectory, notOurs));
    utimesSync(join(linkDirectory, notOurs), old, old);
    writeFileSync(join(linkDirectory, "index.html"), "x");
    utimesSync(join(linkDirectory, "index.html"), old, old);
    const nested = "d".repeat(64);
    mkdirSync(join(linkDirectory, nested, "inner"), { recursive: true });
    utimesSync(join(linkDirectory, nested), old, old);

    // Startup already cleans.
    const config = readAppDownloadLinkConfig({
      MK8DX_HOSTED_APP_DOWNLOAD_LINK_DOCUMENT_ROOT: documentRoot,
      MK8DX_HOSTED_APP_DOWNLOAD_LINK_DIRECTORY: linkDirectory,
    })!;
    const prepared = await prepareAppDownloadLinks(config);
    expect(existsSync(join(linkDirectory, expired))).toBe(false);
    expect(readFileSync(stored, "utf8")).toBe("KEEP");
    expect(existsSync(join(linkDirectory, fresh))).toBe(true);
    expect(existsSync(join(linkDirectory, notOurs))).toBe(true);
    expect(existsSync(join(linkDirectory, "index.html"))).toBe(true);
    expect(existsSync(join(linkDirectory, nested, "inner"))).toBe(true);

    // And so does every later sweep, once a folder has outlived its lifetime.
    utimesSync(join(linkDirectory, fresh), old, old);
    const sweep = await prepared.removeExpired();
    expect(sweep).toMatchObject({ removed: 1, complete: true });
    // The nested folder is not ours to remove: counted as a failure, left alone.
    expect(sweep.failed).toBe(1);
    const { app } = await instance(signedIn, prepared);
    const response = await app.inject({
      method: "GET", url: "/v1/app-downloads/android-timetrials/file",
    });
    expect(response.statusCode).toBe(302);
    expect(existsSync(join(linkDirectory, fresh))).toBe(false);
    expect(existsSync(join(linkDirectory, notOurs))).toBe(true);
    await app.close();
  });
});

describe("the file route without static links", () => {
  it("streams the file as before, typed as an Android package", async () => {
    const { app } = await instance(signedIn);
    const response = await app.inject({
      method: "GET", url: "/v1/app-downloads/android-timetrials/file",
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe("APK");
    expect(response.headers["content-type"]).toBe("application/vnd.android.package-archive");
    expect(response.headers["content-disposition"]).toBe('attachment; filename="mk8dx.apk"');
    expect(response.headers["location"]).toBeUndefined();
    await app.close();
  });

  it("keeps octet-stream for anything that is not an APK", async () => {
    const { store } = await storeWith("livetrial.zip", "ZIP");
    const app = Fastify();
    await registerAppDownloadRoutes(app, { resolveActor: signedIn, store });
    const response = await app.inject({
      method: "GET", url: "/v1/app-downloads/android-timetrials/file",
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("application/octet-stream");
    await app.close();
  });

  it("refuses an anonymous visitor", async () => {
    const { app } = await instance(anonymous);
    const response = await app.inject({
      method: "GET", url: "/v1/app-downloads/android-timetrials/file",
    });
    expect(response.statusCode).toBe(401);
    await app.close();
  });
});

function linkFolders(path: string): string[] {
  return readdirNames(path).filter((name) => /^[0-9]{10}-[0-9a-f]{64}$/.test(name));
}

function readdirNames(path: string): string[] {
  return existsSync(path) ? readdirSync(path).sort() : [];
}

function symlinkOrCopy(source: string, target: string): void {
  try {
    symlinkSync(source, target, "file");
  } catch {
    writeFileSync(target, readFileSync(source));
  }
}

describe("expiry, reuse and quotas of static links (F13, F04 part D)", () => {
  function config(maximumLinks?: number) {
    const { documentRoot, linkDirectory } = linkSetup();
    return readAppDownloadLinkConfig({
      MK8DX_HOSTED_APP_DOWNLOAD_LINK_DOCUMENT_ROOT: documentRoot,
      MK8DX_HOSTED_APP_DOWNLOAD_LINK_DIRECTORY: linkDirectory,
      ...(maximumLinks === undefined ? {} : { MK8DX_HOSTED_APP_DOWNLOAD_LINK_MAX_LINKS: String(maximumLinks) }),
    })!;
  }
  function stored(): string {
    const path = join(directory("mk8dx-stored-"), "kept.apk");
    writeFileSync(path, "KEEP");
    return path;
  }

  it("removes an expired link on its own timer while the API is otherwise idle", async () => {
    const settings = config();
    let now = 1_900_000_000_000;
    const links = await prepareAppDownloadLinks(settings, { now: () => now, sweepIntervalMs: 20 });
    try {
      const source = stored();
      const { location } = await links.create(source, "kept.apk", { subject: "user.1", downloadId: "android" });
      const folder = location.split("/")[2]!;
      expect(existsSync(join(settings.directory, folder))).toBe(true);
      now += settings.ttlMilliseconds + 1_000;
      await new Promise((resolve) => setTimeout(resolve, 120));
      expect(existsSync(join(settings.directory, folder))).toBe(false);
      // Cleanup never touches the stored artifact.
      expect(readFileSync(source, "utf8")).toBe("KEEP");
    } finally { links.close(); }
  });

  it("gives every link a lifetime between half and the whole configured TTL", async () => {
    const settings = config();
    let now = 1_900_000_000_000;
    const links = await prepareAppDownloadLinks(settings, { now: () => now, sweepIntervalMs: 0 });
    const source = stored();
    for (let step = 0; step < 6; step += 1) {
      const { location } = await links.create(source, "kept.apk", { subject: "user.1", downloadId: "android" });
      const expiresAtMs = Number(location.split("/")[2]!.slice(0, 10)) * 1_000;
      expect(expiresAtMs - now).toBeGreaterThan(settings.ttlMilliseconds / 2 - 1_000);
      expect(expiresAtMs - now).toBeLessThanOrEqual(settings.ttlMilliseconds);
      now += 97_000;
    }
  });

  it("keeps links per account apart and reuses them under concurrency", async () => {
    const settings = config();
    const links = await prepareAppDownloadLinks(settings, { sweepIntervalMs: 0 });
    const source = stored();
    const results = await Promise.all(Array.from({ length: 8 }, () =>
      links.create(source, "kept.apk", { subject: "user.1", downloadId: "android" })));
    expect(new Set(results.map((result) => result.location)).size).toBe(1);
    const other = await links.create(source, "kept.apk", { subject: "user.2", downloadId: "android" });
    expect(other.location).not.toBe(results[0]!.location);
    expect(linkFolders(settings.directory)).toHaveLength(2);
  });

  it("refuses new links beyond the installation cap and admits again after expiry", async () => {
    const settings = config(2);
    let now = 1_900_000_000_000;
    const links = await prepareAppDownloadLinks(settings, { now: () => now, sweepIntervalMs: 0 });
    const source = stored();
    await links.create(source, "kept.apk", { subject: "user.1", downloadId: "android" });
    await links.create(source, "kept.apk", { subject: "user.2", downloadId: "android" });
    await expect(links.create(source, "kept.apk", { subject: "user.3", downloadId: "android" }))
      .rejects.toBeInstanceOf(AppDownloadLinkCapacityError);
    // An existing link is still handed out at the cap.
    await expect(links.create(source, "kept.apk", { subject: "user.1", downloadId: "android" }))
      .resolves.toMatchObject({ created: false });
    now += settings.ttlMilliseconds + 1_000;
    await expect(links.create(source, "kept.apk", { subject: "user.3", downloadId: "android" }))
      .resolves.toMatchObject({ created: true });
  });

  it("answers 503 with Retry-After at the cap and 429 past the account budget", async () => {
    const settings = config(1);
    const links = await prepareAppDownloadLinks(settings, { sweepIntervalMs: 0 });
    const { store } = await storeWith("mk8dx.apk", "APK");
    let count = 0;
    const limiter = { async consume(_subject: string, _scope: string, windowSeconds: number, maximum: number) {
      count += 1;
      if (count > maximum) { throw new MutationRateLimitExceeded(windowSeconds); }
    } };
    let who = "user.1";
    const app = Fastify();
    await registerAppDownloadRoutes(app, {
      resolveActor: async () => ({ role: "account", userAccountId: who }), store, staticLinks: links, rateLimiter: limiter,
    });
    const get = () => app.inject({ method: "GET", url: "/v1/app-downloads/android-timetrials/file" });
    expect((await get()).statusCode).toBe(302);
    who = "user.2";
    const busy = await get();
    expect(busy.statusCode).toBe(503);
    expect(busy.headers["retry-after"]).toMatch(/^[0-9]+$/);
    count = 1_000;
    const limited = await get();
    expect(limited.statusCode).toBe(429);
    expect(limited.headers["retry-after"]).toMatch(/^[0-9]+$/);
    await app.close();
  });

  it("refuses to link a file that lies inside the link directory", async () => {
    const settings = config();
    const links = await prepareAppDownloadLinks(settings, { sweepIntervalMs: 0 });
    const inside = join(settings.directory, "planted.apk");
    writeFileSync(inside, "X");
    await expect(links.create(inside, "planted.apk", { subject: "user.1", downloadId: "android" }))
      .rejects.toBeInstanceOf(AppDownloadLinkConfigurationError);
  });

  it("writes an empty index page so the link directory never lists", async () => {
    const settings = config();
    await prepareAppDownloadLinks(settings, { sweepIntervalMs: 0 });
    expect(readFileSync(join(settings.directory, "index.html"), "utf8")).toBe("");
  });

  it("states the expiry in the web server's own time stamp format", () => {
    const expiresAtMs = new Date(2026, 10, 14, 12, 30, 0).getTime();
    expect(webServerTimeStamp(expiresAtMs)).toBe("20261114123000");
    expect(linkFolderAccessRules(expiresAtMs)).toContain("RewriteCond %{TIME} >20261114122959");
  });
});
