import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import type { IdentityReadRepository } from "../src/identity/types.js";
import {
  loadStaticWebFiles,
  StaticWebConfigurationError,
  type StaticWebFile,
} from "../src/runtime/static-web.js";

const emptyRepository: IdentityReadRepository = {
  async findPublicPlayerById() { return null; },
  async findUserAccountSummaryById() { return null; },
  async findPlayerClaimSummaryById() { return null; },
};

let fixtureRoot: string;
let files: ReadonlyMap<string, StaticWebFile>;

beforeAll(async () => {
  fixtureRoot = mkdtempSync(join(tmpdir(), "mk8dx-static-web-"));
  writeFileSync(join(fixtureRoot, "index.html"), "<title>MK8DX</title>");
  writeFileSync(join(fixtureRoot, "manifest.webmanifest"), "{}");
  writeFileSync(join(fixtureRoot, "sw.js"), "self.addEventListener('fetch',()=>{});");
  writeFileSync(join(fixtureRoot, "assetlinks.json"), "[]");
  mkdirSync(join(fixtureRoot, "styles"));
  writeFileSync(join(fixtureRoot, "styles", "product.css"), "body{margin:0}");
  writeFileSync(join(fixtureRoot, "styles", "favicon.svg"), "<svg/>");
  writeFileSync(join(fixtureRoot, "styles", "ds-font-x-400-latin1.0123456789.woff2"), Buffer.from("wOF2"));
  writeFileSync(join(fixtureRoot, "styles", "ds-fonts-OFL-X.txt"), "SIL Open Font License 1.1");
  mkdirSync(join(fixtureRoot, "dist"));
  writeFileSync(join(fixtureRoot, "dist", "main.js"), "export {};");
  mkdirSync(join(fixtureRoot, "pages"));
  writeFileSync(join(fixtureRoot, "pages", "privacy.html"), "<title>Privacy</title>");
  writeFileSync(join(fixtureRoot, "pages", "terms.html"), "<title>Terms</title>");
  files = await loadStaticWebFiles(fixtureRoot);
});

afterAll(() => {
  rmSync(fixtureRoot, { recursive: true, force: true });
});

describe("static web loading", () => {
  it("builds the closed route map with content types and strong etags", () => {
    expect([...files.keys()].sort()).toEqual([
      "/",
      "/.well-known/assetlinks.json",
      "/device",
      "/dist/main.js",
      "/index.html",
      "/manifest.webmanifest",
      "/privacy",
      "/styles/ds-font-x-400-latin1.0123456789.woff2",
      "/styles/ds-fonts-OFL-X.txt",
      "/styles/favicon.svg",
      "/styles/product.css",
      "/sw.js",
      "/terms",
    ]);
    // The plain pages are served as HTML without the app; one that is absent is simply not there.
    expect(files.get("/privacy")?.contentType).toBe("text/html; charset=utf-8");
    expect(files.has("/livetrial")).toBe(false);
    expect(files.get("/")?.contentType).toBe("text/html; charset=utf-8");
    expect(files.get("/dist/main.js")?.contentType)
      .toBe("text/javascript; charset=utf-8");
    expect(files.get("/styles/favicon.svg")?.contentType).toBe("image/svg+xml");
    expect(files.get("/styles/ds-font-x-400-latin1.0123456789.woff2")?.contentType).toBe("font/woff2");
    expect(files.get("/styles/ds-fonts-OFL-X.txt")?.contentType).toBe("text/plain; charset=utf-8");
    expect(files.get("/")?.etag).toMatch(/^"[a-f0-9]{32}"$/);
    expect(files.get("/")).toBe(files.get("/index.html"));
    expect(files.get("/device")).toBe(files.get("/index.html"));
    // Android fetches this exact path at install to verify the app may open
    // the site's links; it has to answer as JSON and it has to be there.
    expect(files.get("/.well-known/assetlinks.json")?.contentType)
      .toBe("application/json; charset=utf-8");
  });

  it("holds a bundle past 1 MiB and still bounds a runaway file", async () => {
    const big = mkdtempSync(join(tmpdir(), "mk8dx-static-big-"));
    try {
      writeFileSync(join(big, "index.html"), "<title>x</title>");
      writeFileSync(join(big, "manifest.webmanifest"), "{}");
      writeFileSync(join(big, "sw.js"), "self.x=1;");
      writeFileSync(join(big, "assetlinks.json"), "[]");
      mkdirSync(join(big, "styles"));
      mkdirSync(join(big, "dist"));
      writeFileSync(join(big, "dist", "main.js"), Buffer.alloc(1_572_864, 0x20));
      const files = await loadStaticWebFiles(big);
      expect(files.get("/dist/main.js")?.body.byteLength).toBe(1_572_864);
      writeFileSync(join(big, "dist", "main.js"), Buffer.alloc(5 * 1_048_576, 0x20));
      await expect(loadStaticWebFiles(big)).rejects.toThrow(/per-file bound/);
    } finally {
      rmSync(big, { recursive: true, force: true });
    }
  });

  it("fails closed on a root without index.html or with foreign files", async () => {
    const empty = mkdtempSync(join(tmpdir(), "mk8dx-static-empty-"));
    try {
      await expect(loadStaticWebFiles(empty)).rejects.toThrow(
        StaticWebConfigurationError,
      );
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }

    const foreign = mkdtempSync(join(tmpdir(), "mk8dx-static-foreign-"));
    try {
      writeFileSync(join(foreign, "index.html"), "<title>x</title>");
      writeFileSync(join(foreign, "manifest.webmanifest"), "{}");
      writeFileSync(join(foreign, "assetlinks.json"), "[]");
      writeFileSync(join(foreign, "sw.js"), "self.addEventListener('fetch',()=>{});");
      mkdirSync(join(foreign, "styles"));
      mkdirSync(join(foreign, "dist"));
      writeFileSync(join(foreign, "dist", "payload.exe"), "MZ");
      await expect(loadStaticWebFiles(foreign)).rejects.toThrow(
        /not on the whitelist/,
      );
    } finally {
      rmSync(foreign, { recursive: true, force: true });
    }
  });
});

describe("same-origin static web serving", () => {
  it("serves the product with security headers, etags, and 304 revalidation", async () => {
    const app = await buildApp({
      identityRepository: emptyRepository,
      staticWeb: { files },
    });
    try {
      const index = await app.inject({ method: "GET", url: "/" });
      expect(index.statusCode).toBe(200);
      expect(index.body).toContain("MK8DX");
      expect(index.headers["content-type"]).toBe("text/html; charset=utf-8");
      expect(index.headers["content-security-policy"]).toContain(
        "default-src 'self'",
      );
      expect(index.headers["x-content-type-options"]).toBe("nosniff");
      expect(index.headers["x-frame-options"]).toBe("DENY");
      expect(index.headers["cache-control"]).toBe("no-cache");

      const etag = index.headers["etag"] as string;
      const revalidated = await app.inject({
        method: "GET",
        url: "/",
        headers: { "if-none-match": etag },
      });
      expect(revalidated.statusCode).toBe(304);
      expect(revalidated.body).toBe("");

      const script = await app.inject({ method: "GET", url: "/dist/main.js" });
      expect(script.statusCode).toBe(200);
      expect(script.headers["content-type"]).toBe(
        "text/javascript; charset=utf-8",
      );

      // Unknown and traversal-shaped paths are simply unrouted.
      for (const url of [
        "/unknown.html",
        "/styles/absent.css",
        "/styles/..%2Findex.html",
        "/dist/../../package.json",
      ]) {
        const response = await app.inject({ method: "GET", url });
        expect(response.statusCode).toBe(404);
      }

      // The API surface is unaffected.
      const live = await app.inject({ method: "GET", url: "/health/live" });
      expect(live.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });
});
