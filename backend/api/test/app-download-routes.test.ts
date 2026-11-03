import Fastify from "fastify";
import { describe, expect, it } from "vitest";

import { registerAppDownloadRoutes } from "../src/runtime/app-download-routes.js";
import type {
  AppDownloadCatalog,
  AppDownloadLanguage,
  AppDownloadStore,
} from "../src/runtime/app-downloads.js";

// The catalog route hands the page the owner's guides in the language it
// asks for. The store already localizes; the route must pass the language
// through, default to English, and refuse anything that is not a product
// language before it reaches the store.

function catalog(language: AppDownloadLanguage): AppDownloadCatalog {
  return {
    schemaVersion: "mk8dx.app-downloads.v1",
    entries: [{
      id: "android", platform: "android", title: "MK8DX Time Trials",
      version: "1.0", releasedOn: "2026-08-21", fileName: "mk8dx.apk",
      bytes: 3, sha256: "a".repeat(64),
      requirements: language === "nl" ? ["Android 7 of nieuwer"] : ["Android 7 or newer"],
      installSteps: ["Step"], updateSteps: ["Step"],
    }],
  };
}

async function instance(): Promise<{ app: ReturnType<typeof Fastify>; asked: AppDownloadLanguage[] }> {
  const asked: AppDownloadLanguage[] = [];
  const store: AppDownloadStore = {
    catalog(language = "en") { asked.push(language); return catalog(language); },
    async open() { return null; },
  };
  const app = Fastify();
  await registerAppDownloadRoutes(app, {
    resolveActor: async () => ({ role: "account", userAccountId: "user.1" }),
    store,
  });
  return { app, asked };
}

describe("app download catalog route", () => {
  it("serves English when no language is asked for", async () => {
    const { app, asked } = await instance();
    const response = await app.inject({ method: "GET", url: "/v1/app-downloads" });
    expect(response.statusCode).toBe(200);
    expect(response.json().entries[0].requirements).toEqual(["Android 7 or newer"]);
    expect(asked).toEqual(["en"]);
  });

  it("serves the asked-for product language", async () => {
    const { app, asked } = await instance();
    const response = await app.inject({
      method: "GET", url: "/v1/app-downloads?language=nl",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().entries[0].requirements).toEqual(["Android 7 of nieuwer"]);
    expect(asked).toEqual(["nl"]);
  });

  it("refuses a language that is not a product language", async () => {
    const { app, asked } = await instance();
    const response = await app.inject({
      method: "GET", url: "/v1/app-downloads?language=de",
    });
    expect(response.statusCode).toBe(400);
    expect(asked).toEqual([]);
  });
});

describe("the LiveTrial floor on the catalog route", () => {
  it("passes minimumSupportedVersion through and nothing the schema does not name", async () => {
    const store: AppDownloadStore = {
      catalog() {
        return {
          schemaVersion: "mk8dx.app-downloads.v1",
          entries: [{
            id: "livetrial-windows", platform: "windows", title: "LiveTrial",
            version: "3.24.2", releasedOn: "2026-09-28", fileName: "livetrial.zip",
            bytes: 3, sha256: "a".repeat(64), requirements: [], installSteps: [], updateSteps: [],
            minimumSupportedVersion: "3.24.1", supportMessage: "internal",
          }],
        };
      },
      async open() { return null; },
    };
    const app = Fastify();
    await registerAppDownloadRoutes(app, {
      resolveActor: async () => ({ role: "account", userAccountId: "user.1" }),
      store,
    });
    const response = await app.inject({ method: "GET", url: "/v1/app-downloads" });
    expect(response.statusCode).toBe(200);
    const entry = response.json().entries[0];
    expect(entry.minimumSupportedVersion).toBe("3.24.1");
    expect(entry).not.toHaveProperty("supportMessage");
    await app.close();
  });
});
