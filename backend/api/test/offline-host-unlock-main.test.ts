import { describe, expect, it } from "vitest";

import {
  offlineHostUnlockPath,
  parseOfflineHostUnlockArguments,
} from "../src/administration/offline-host-unlock-main.js";

describe("offline host operator command", () => {
  it("accepts only an explicit bootstrap or a canonical UserAccount ID", () => {
    expect(parseOfflineHostUnlockArguments(["--bootstrap"])).toBeNull();
    expect(parseOfflineHostUnlockArguments([
      "--user-account-id", "user_account.12345678-1234-1234-1234-123456789abc",
    ])).toBe("user_account.12345678-1234-1234-1234-123456789abc");
    expect(() => parseOfflineHostUnlockArguments([])).toThrow();
    expect(() => parseOfflineHostUnlockArguments(["--bootstrap", "extra"])).toThrow();
    expect(() => parseOfflineHostUnlockArguments(["--user-account-id", "user_account.other"])).toThrow();
  });

  it("does not open a host state path outside the offline profile", () => {
    expect(offlineHostUnlockPath({ MK8DX_OFFLINE_LAN: "true",
      MK8DX_OFFLINE_HOST_STATE_DIR: "/run/mk8dx/host-state" }))
      .toBe("/run/mk8dx/host-state/unlock.json");
    expect(() => offlineHostUnlockPath({ MK8DX_OFFLINE_HOST_STATE_DIR: "/run/mk8dx/host-state" })).toThrow();
    expect(() => offlineHostUnlockPath({ MK8DX_OFFLINE_LAN: "true",
      MK8DX_OFFLINE_HOST_STATE_DIR: "relative" })).toThrow();
  });
});
