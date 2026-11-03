import { afterEach, describe, expect, it } from "vitest";

import {
  AppDownloadsError,
  appDownloadPresentation,
  appDownloadsPath,
  formatAppDownloadMetadata,
  formatBytes,
  loadAppDownloads,
} from "../src/app-downloads-view.js";
import type { AppDownloadEntry } from "../src/app-downloads-view.js";
import { dutchPresentation } from "../src/dutch-ui-copy.js";
import { setProductLanguage } from "../src/product-language.js";

const storage = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string): string | null => storage.get(key) ?? null,
    setItem: (key: string, value: string): void => { storage.set(key, value); },
  },
});

function response(status: number, body: unknown): Response {
  const payload = JSON.stringify(body);
  return new Response(payload, {
    status,
    headers: {
      "content-type": "application/json",
      "content-length": String(payload.length),
    },
  });
}

const entry: AppDownloadEntry = {
  id: "android",
  platform: "android",
  title: "MK8DX Time Trials",
  version: "1.0",
  releasedOn: "2026-08-21",
  fileName: "mk8dx.apk",
  bytes: 431_844_639,
  sha256: "a".repeat(64),
  requirements: ["Android 7 or newer"],
  installSteps: ["Allow installing from your browser"],
  updateSteps: ["Install the new file over the old one"],
};

describe("app downloads", () => {
  afterEach(() => {
    storage.clear();
    setProductLanguage("en");
  });

  it("reads the published builds for a signed-in account", async () => {
    let seen = "";
    const entries = await loadAppDownloads(async (path, init) => {
      seen = path;
      expect(init.credentials).toBe("same-origin");
      expect(init.cache).toBe("no-store");
      return response(200, {
        schemaVersion: "mk8dx.app-downloads.v1", entries: [entry],
      });
    });
    expect(seen).toBe("/v1/app-downloads");
    expect(entries).toHaveLength(1);
    expect(entries[0]?.fileName).toBe("mk8dx.apk");
  });

  it("says plainly when the visitor is not signed in", async () => {
    await expect(loadAppDownloads(async () => response(401, {
      code: "not_authenticated", message: "Sign in.",
    }))).rejects.toMatchObject({ code: "not_authenticated" });
  });

  it("refuses anything that is not the expected document", async () => {
    for (const body of [
      { schemaVersion: "other.v1", entries: [] },
      { schemaVersion: "mk8dx.app-downloads.v1" },
      [],
    ]) {
      await expect(loadAppDownloads(async () => response(200, body)))
        .rejects.toBeInstanceOf(AppDownloadsError);
    }
    await expect(loadAppDownloads(async () => { throw new Error("offline"); }))
      .rejects.toMatchObject({ code: "unavailable" });
  });

  it("accepts the same twenty owner-written steps as the server manifest", async () => {
    const installSteps = Array.from({ length: 20 }, (_, index) => `Step ${index + 1}`);
    const entries = await loadAppDownloads(async () => response(200, {
      schemaVersion: "mk8dx.app-downloads.v1",
      entries: [{ ...entry, installSteps }],
    }));
    expect(entries[0]?.installSteps).toEqual(installSteps);
  });

  it("states a download size the way a person would", () => {
    expect(formatBytes(512)).toBe("512 bytes");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatBytes(431_844_639)).toBe("412 MB");
    expect(formatBytes(2 * 1024 * 1024 * 1024)).toBe("2.0 GB");
  });

  it("shows the last update date beside the download metadata", () => {
    expect(formatAppDownloadMetadata(entry)).toBe(
      "Version 1.0 · Last updated 2026-08-21 · 412 MB",
    );
  });

  it("labels Time Trials downloads by product and platform", () => {
    expect(appDownloadPresentation(entry)).toMatchObject({
      platformLabel: "ANDROID APP",
      productLabel: "MK8DX TIME TRIALS",
      deviceLabel: "For Android phones and tablets",
      downloadLabel: "Download Android app",
      fileKind: ".APK",
    });
    expect(appDownloadPresentation({
      ...entry,
      id: "livetrial-windows",
      platform: "windows",
    })).toMatchObject({
      platformLabel: "WINDOWS PC",
      productLabel: "MK8DX TIME TRIALS",
      downloadLabel: "Download Windows app",
      fileKind: ".ZIP",
    });
  });

  it("introduces each product in plain words before the install steps", () => {
    const products = [
      entry,
      { ...entry, id: "livetrial-windows", platform: "windows" as const },
      { ...entry, id: "tournament-tools", platform: "windows" as const },
    ].map((candidate) => appDownloadPresentation(candidate).intro);
    // Every product explains itself as input -> process -> output and names
    // the chore it removes; none of the three borrows another's text.
    for (const intro of products) {
      for (const part of [intro.summary, intro.input, intro.process, intro.output, intro.solves]) {
        expect(part.length).toBeGreaterThan(40);
        expect(part).not.toMatch(/\b(API|JSON|SHA|V1|OCR|SDK)\b/);
      }
    }
    expect(new Set(products.map((intro) => intro.summary)).size).toBe(3);
    expect(products[0]?.input).toMatch(/camera/);
    expect(products[1]?.input).toMatch(/capture card/);
    expect(products[2]?.output).toMatch(/import/);
  });

  it("introduces each product in Dutch when Dutch is the product language", async () => {
    const candidates = [
      entry,
      { ...entry, id: "livetrial-windows", platform: "windows" as const },
      { ...entry, id: "tournament-tools", platform: "windows" as const },
    ];
    setProductLanguage("nl");
    for (const candidate of candidates) {
      const english = appDownloadPresentation(candidate, "en");
      const dutch = appDownloadPresentation(candidate);
      expect(dutch.productLabel).toBe(english.productLabel);
      expect(dutch.fileKind).toBe(english.fileKind);
      for (const key of ["summary", "input", "process", "output", "solves"] as const) {
        expect(dutch.intro[key]).not.toBe(english.intro[key]);
        expect(dutch.intro[key].length).toBeGreaterThan(40);
        // A Dutch caption must pass the live word-substitution layer untouched:
        // nothing in it may still read as an English domain word.
        expect(dutchPresentation(dutch.intro[key])).toBe(dutch.intro[key]);
      }
      for (const label of [dutch.deviceLabel, dutch.downloadLabel, dutch.platformLabel]) {
        expect(dutchPresentation(label)).toBe(label);
      }
    }
    expect(appDownloadPresentation(entry).downloadLabel).toBe("Android-app downloaden");
    // The owner-written guides are asked for in the same language.
    expect(appDownloadsPath("en")).toBe("/v1/app-downloads");
    let seen = "";
    await loadAppDownloads(async (path) => {
      seen = path;
      return response(200, { schemaVersion: "mk8dx.app-downloads.v1", entries: [] });
    });
    expect(seen).toBe("/v1/app-downloads?language=nl");
    expect(appDownloadPresentation(entry).intro.input).toMatch(/camera van je telefoon/);
    expect(formatAppDownloadMetadata(entry)).toBe(
      "Versie 1.0 · Laatst bijgewerkt 2026-08-21 · 412 MB",
    );
  });
});
