import { describe, expect, it } from "vitest";

import {
  buildIsRetired,
  clientSupportFor,
} from "../src/runtime/client-support-routes.js";
import {
  releaseBuildNumber,
  type AppDownloadEntry,
} from "../src/runtime/app-downloads.js";

function entry(overrides: Partial<AppDownloadEntry> = {}): AppDownloadEntry {
  return {
    id: "android-timetrials",
    platform: "android",
    title: "MK8DX Time Trials for Android",
    version: "2.44.0-build73",
    releasedOn: "2026-09-04",
    fileName: "mk8dx-timetrials-android-2.44.0.apk",
    bytes: 451_776_888,
    sha256: "a".repeat(64),
    requirements: [],
    installSteps: [],
    updateSteps: [],
    ...overrides,
  };
}

describe("which builds of the native client may still be used", () => {
  it("reads the build number out of a release version", () => {
    expect(releaseBuildNumber("2.44.0-build73")).toBe(73);
    expect(releaseBuildNumber("2.44.0")).toBeNull();
    expect(releaseBuildNumber("2.44.0-build0")).toBeNull();
  });

  it("retires nothing until an owner deliberately turns a build off", () => {
    const support = clientSupportFor(entry());
    expect(support.minimumSupportedBuild).toBe(1);
    expect(support.retiredBuilds).toEqual([]);
    for (const build of [1, 42, 72, 73]) {
      expect(buildIsRetired(support, build)).toBe(false);
    }
  });

  it("retires everything before a minimum", () => {
    const support = clientSupportFor(entry({ minimumSupportedBuild: 72 }));
    expect(buildIsRetired(support, 71)).toBe(true);
    expect(buildIsRetired(support, 72)).toBe(false);
    expect(buildIsRetired(support, 73)).toBe(false);
  });

  it("retires one named build without touching its neighbours", () => {
    const support = clientSupportFor(entry({ retiredBuilds: [71] }));
    expect(buildIsRetired(support, 70)).toBe(false);
    expect(buildIsRetired(support, 71)).toBe(true);
    expect(buildIsRetired(support, 72)).toBe(false);
  });

  it("applies both switches together", () => {
    const support = clientSupportFor(
      entry({ minimumSupportedBuild: 70, retiredBuilds: [72] }),
    );
    expect([69, 70, 71, 72, 73].map((build) => buildIsRetired(support, build)))
      .toEqual([true, false, false, true, false]);
  });

  it("carries the owner's own message and the page to open", () => {
    const support = clientSupportFor(entry({
      supportMessage: "Build 71 sent times to the wrong track.",
    }));
    expect(support.message).toBe("Build 71 sent times to the wrong track.");
    expect(support.downloadPagePath).toBe("/?apps=1");
    expect(support.currentVersion).toBe("2.44.0-build73");
    expect(support.currentBuild).toBe(73);
  });

  it("does not retire the build the manifest itself publishes", () => {
    // The manifest loader refuses that outright; this pins the arithmetic that
    // makes the common case - a minimum equal to the current build - safe.
    const support = clientSupportFor(entry({ minimumSupportedBuild: 73 }));
    expect(support.currentBuild).toBe(73);
    expect(buildIsRetired(support, 73)).toBe(false);
    expect(buildIsRetired(support, 72)).toBe(true);
  });
});
