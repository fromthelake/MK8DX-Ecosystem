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
  AppDownloadLinkConfigurationError,
  prepareAppDownloadLinks,
  readAppDownloadLinkConfig,
  type AppDownloadLinks,
} from "../src/runtime/app-download-links.js";
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
    expect(readdirNames(prepared.linkDirectory)).toEqual([]);
    await app.close();
  });

  it("redirects a signed-in member to a fresh unguessable link to the stored file", async () => {
    const prepared = await links();
    const { app, root } = await instance(signedIn, prepared.links);
    const response = await app.inject({
      method: "GET", url: "/v1/app-downloads/android-timetrials/file",
    });
    expect(response.statusCode).toBe(302);
    expect(response.headers["cache-control"]).toBe("no-store");
    const location = String(response.headers["location"]);
    const matched = /^\/dl\/([0-9a-f]{64})\/mk8dx\.apk$/.exec(location);
    expect(matched).not.toBeNull();
    const linked = join(prepared.linkDirectory, matched![1]!, "mk8dx.apk");
    expect(readFileSync(linked, "utf8")).toBe("APK");
    // A symbolic link or a hard link: either way the same stored file.
    expect(statSync(linked).ino).toBe(statSync(join(root, "mk8dx.apk")).ino);
    expect(response.body).not.toContain(root);

    const second = await app.inject({
      method: "GET", url: "/v1/app-downloads/android-timetrials/file",
    });
    expect(second.headers["location"]).not.toBe(location);
    await app.close();
  });

  it("answers 404 for an id outside the manifest", async () => {
    const prepared = await links();
    const { app } = await instance(signedIn, prepared.links);
    const response = await app.inject({
      method: "GET", url: "/v1/app-downloads/unknown/file",
    });
    expect(response.statusCode).toBe(404);
    expect(readdirNames(prepared.linkDirectory)).toEqual([]);
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

    // And so does every request, once a folder has outlived its lifetime.
    utimesSync(join(linkDirectory, fresh), old, old);
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
