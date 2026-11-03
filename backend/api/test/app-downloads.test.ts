import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  AppDownloadConfigurationError,
  loadAppDownloads,
} from "../src/runtime/app-downloads.js";

const roots: string[] = [];

function root(): string {
  const created = mkdtempSync(join(tmpdir(), "mk8dx-downloads-"));
  roots.push(created);
  return created;
}

function manifest(
  directory: string,
  entries: readonly Record<string, unknown>[],
): void {
  writeFileSync(
    join(directory, "downloads.json"),
    JSON.stringify({ schemaVersion: "mk8dx.app-downloads.v1", entries }),
  );
}

const sha = "a".repeat(64);

afterEach(() => {
  for (const directory of roots.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("turning a build off", () => {
  const base = {
    id: "android-timetrials", platform: "android", title: "MK8DX Time Trials",
    version: "2.44.0-build73", releasedOn: "2026-09-04", fileName: "mk8dx.apk",
    bytes: 3, sha256: "a".repeat(64), requirements: [], installSteps: [],
    updateSteps: [],
  };

  it("reads the owner's two switches and their message", async () => {
    const directory = root();
    writeFileSync(join(directory, "mk8dx.apk"), "APK");
    manifest(directory, [{
      ...base, minimumSupportedBuild: 70, retiredBuilds: [72],
      supportMessage: "Build 72 published to the wrong track.",
    }]);
    const entry = (await loadAppDownloads(directory)).catalog().entries[0]!;
    expect(entry.minimumSupportedBuild).toBe(70);
    expect(entry.retiredBuilds).toEqual([72]);
    expect(entry.supportMessage).toBe("Build 72 published to the wrong track.");
  });

  it("leaves every build supported when the owner has said nothing", async () => {
    const directory = root();
    writeFileSync(join(directory, "mk8dx.apk"), "APK");
    manifest(directory, [base]);
    const entry = (await loadAppDownloads(directory)).catalog().entries[0]!;
    expect(entry.minimumSupportedBuild).toBeUndefined();
    expect(entry.retiredBuilds).toBeUndefined();
  });

  it("refuses a manifest that turns off the build it publishes", async () => {
    // Otherwise the whole community reads "Update Required" and the page it
    // sends them to offers the build that was just switched off.
    for (const broken of [{ minimumSupportedBuild: 74 }, { retiredBuilds: [73] }]) {
      const directory = root();
      writeFileSync(join(directory, "mk8dx.apk"), "APK");
      manifest(directory, [{ ...base, ...broken }]);
      await expect(loadAppDownloads(directory)).rejects.toBeInstanceOf(
        AppDownloadConfigurationError,
      );
    }
  });

  it("refuses a switch that is not a whole build number", async () => {
    for (const broken of [
      { minimumSupportedBuild: 0 },
      { minimumSupportedBuild: 1.5 },
      { retiredBuilds: [70, 70] },
      { retiredBuilds: ["70"] },
      { supportMessage: "" },
    ]) {
      const directory = root();
      writeFileSync(join(directory, "mk8dx.apk"), "APK");
      manifest(directory, [{ ...base, ...broken }]);
      await expect(loadAppDownloads(directory)).rejects.toBeInstanceOf(
        AppDownloadConfigurationError,
      );
    }
  });
});

describe("the LiveTrial floor", () => {
  const windows = {
    id: "livetrial-windows", platform: "windows", title: "LiveTrial",
    version: "3.24.1", releasedOn: "2026-09-28", fileName: "livetrial.zip",
    bytes: 3, sha256: "a".repeat(64), requirements: [], installSteps: [],
    updateSteps: [],
  };

  it("reads the oldest LiveTrial that may still send", async () => {
    const directory = root();
    writeFileSync(join(directory, "livetrial.zip"), "ZIP");
    manifest(directory, [{ ...windows, minimumSupportedVersion: "3.24" }]);
    const entry = (await loadAppDownloads(directory)).catalog().entries[0]!;
    expect(entry.minimumSupportedVersion).toBe("3.24");
  });

  it("refuses a floor above the version it publishes, on Android, or not dotted", async () => {
    for (const broken of [
      { minimumSupportedVersion: "3.24.2" },
      { minimumSupportedVersion: "3.25" },
      { minimumSupportedVersion: "latest" },
      { minimumSupportedVersion: 3 },
      { version: "3.24.1-build5", minimumSupportedVersion: "3.24" },
    ]) {
      const directory = root();
      writeFileSync(join(directory, "livetrial.zip"), "ZIP");
      manifest(directory, [{ ...windows, ...broken }]);
      await expect(loadAppDownloads(directory)).rejects.toBeInstanceOf(
        AppDownloadConfigurationError,
      );
    }
    const directory = root();
    writeFileSync(join(directory, "mk8dx.apk"), "APK");
    manifest(directory, [{
      id: "android-timetrials", platform: "android", title: "MK8DX Time Trials",
      version: "2.44.0-build73", releasedOn: "2026-09-04", fileName: "mk8dx.apk",
      bytes: 3, sha256: "a".repeat(64), requirements: [], installSteps: [],
      updateSteps: [], minimumSupportedVersion: "2.44",
    }]);
    await expect(loadAppDownloads(directory)).rejects.toBeInstanceOf(
      AppDownloadConfigurationError,
    );
  });
});

describe("owner-private application downloads", () => {
  it("serves only what the closed manifest advertises", async () => {
    const directory = root();
    writeFileSync(join(directory, "mk8dx.apk"), "APK");
    writeFileSync(join(directory, "not-listed.zip"), "SECRET");
    manifest(directory, [{
      id: "android", platform: "android", title: "MK8DX Time Trials",
      version: "1.0", releasedOn: "2026-08-21", fileName: "mk8dx.apk",
      bytes: 3, sha256: sha, requirements: ["Android 7 or newer"],
      installSteps: ["Allow installing from your browser"],
      updateSteps: ["Install the new file over the old one"],
    }]);

    const store = await loadAppDownloads(directory);
    expect(store.catalog().entries.map((row) => row.id)).toEqual(["android"]);
    const opened = await store.open("android");
    expect(opened?.entry.fileName).toBe("mk8dx.apk");
    expect(opened?.bytes).toBe(3);
    // Close the handle before the temporary directory is removed.
    await new Promise<void>((done) => {
      const stream = opened?.stream;
      if (stream === undefined) { done(); return; }
      stream.on("close", () => { done(); });
      stream.on("error", () => { done(); });
      stream.destroy();
    });
    // A file present on disk but absent from the manifest is not reachable.
    expect(await store.open("not-listed")).toBeNull();
    // Nor is anything that tries to escape the download directory.
    expect(await store.open("../secrets")).toBeNull();
  });

  it("serves the owner's Dutch guides when asked, and English otherwise", async () => {
    const directory = root();
    writeFileSync(join(directory, "mk8dx.apk"), "APK");
    manifest(directory, [{
      id: "android", platform: "android", title: "MK8DX Time Trials",
      version: "1.0", releasedOn: "2026-08-21", fileName: "mk8dx.apk",
      bytes: 3, sha256: sha, requirements: ["Android 7 or newer"],
      installSteps: ["Allow installing from your browser"],
      updateSteps: ["Install the new file over the old one"],
      translations: {
        nl: {
          requirements: ["Android 7 of nieuwer"],
          installSteps: ["Sta installeren vanuit je browser toe"],
          // No updateSteps: a partly translated entry keeps the English list.
        },
      },
    }]);
    const store = await loadAppDownloads(directory);
    const english = store.catalog().entries[0];
    const dutch = store.catalog("nl").entries[0];
    expect(english?.requirements).toEqual(["Android 7 or newer"]);
    expect(dutch?.requirements).toEqual(["Android 7 of nieuwer"]);
    expect(dutch?.installSteps).toEqual(["Sta installeren vanuit je browser toe"]);
    expect(dutch?.updateSteps).toEqual(["Install the new file over the old one"]);
    // The served document is one language at a time: the translations never
    // travel along, in either language.
    expect(english).not.toHaveProperty("translations");
    expect(dutch).not.toHaveProperty("translations");
    expect(dutch?.fileName).toBe("mk8dx.apk");
  });

  it("refuses a translation that is not a product language or not a guide", async () => {
    for (const translations of [
      { de: { installSteps: ["Schritt"] } },
      { en: { installSteps: ["Step"] } },
      { nl: { summary: "Niet een gids" } },
      { nl: { installSteps: "Geen lijst" } },
      { nl: ["Geen object"] },
    ]) {
      const directory = root();
      writeFileSync(join(directory, "a.apk"), "A");
      manifest(directory, [{
        id: "android", platform: "android", title: "A", version: "1",
        releasedOn: "2026-08-21", fileName: "a.apk", bytes: 1, sha256: sha,
        requirements: [], installSteps: [], updateSteps: [], translations,
      }]);
      await expect(loadAppDownloads(directory))
        .rejects.toBeInstanceOf(AppDownloadConfigurationError);
    }
  });

  it("refuses a manifest that does not match what is on disk", async () => {
    const directory = root();
    writeFileSync(join(directory, "mk8dx.apk"), "APK");
    manifest(directory, [{
      id: "android", platform: "android", title: "MK8DX Time Trials",
      version: "1.0", releasedOn: "2026-08-21", fileName: "mk8dx.apk",
      bytes: 99, sha256: sha, requirements: [], installSteps: [],
      updateSteps: [],
    }]);
    await expect(loadAppDownloads(directory))
      .rejects.toBeInstanceOf(AppDownloadConfigurationError);
  });

  it("refuses a manifest whose file is missing entirely", async () => {
    const directory = root();
    manifest(directory, [{
      id: "windows", platform: "windows", title: "LiveTrial",
      version: "1.0", releasedOn: "2026-08-21", fileName: "livetrial.zip",
      bytes: 3, sha256: sha, requirements: [], installSteps: [],
      updateSteps: [],
    }]);
    await expect(loadAppDownloads(directory))
      .rejects.toBeInstanceOf(AppDownloadConfigurationError);
  });

  it("refuses duplicate ids and malformed entries", async () => {
    const directory = root();
    writeFileSync(join(directory, "a.apk"), "A");
    manifest(directory, [
      {
        id: "android", platform: "android", title: "A", version: "1",
        releasedOn: "2026-08-21", fileName: "a.apk", bytes: 1, sha256: sha,
        requirements: [], installSteps: [], updateSteps: [],
      },
      {
        id: "android", platform: "android", title: "A", version: "1",
        releasedOn: "2026-08-21", fileName: "a.apk", bytes: 1, sha256: sha,
        requirements: [], installSteps: [], updateSteps: [],
      },
    ]);
    await expect(loadAppDownloads(directory))
      .rejects.toBeInstanceOf(AppDownloadConfigurationError);

    const second = root();
    writeFileSync(join(second, "a.apk"), "A");
    manifest(second, [{
      id: "Android Build", platform: "android", title: "A", version: "1",
      releasedOn: "2026-08-21", fileName: "a.apk", bytes: 1, sha256: sha,
      requirements: [], installSteps: [], updateSteps: [],
    }]);
    await expect(loadAppDownloads(second))
      .rejects.toBeInstanceOf(AppDownloadConfigurationError);
  });
});
