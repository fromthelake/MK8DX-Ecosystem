// ADR-0221 on the website: the installation-settings client's key-for-key parsing, the
// Administration section (who creates Players saves at once; the "ratings are out of date" notice),
// the operation client's per-night fields, and "new Player" giving way to an explanation when only
// self sign-up creates Players.

import { afterEach, describe, expect, it, vi } from "vitest";

import { FakeDocument, descendants, texts } from "./dom-double.js";
import {
  createInstallationSettingsClient,
  DEFAULT_INSTALLATION_SETTINGS,
  loadInstallationSettings,
  type InstallationSettingsAdministration,
  type InstallationSettingsClient,
} from "../src/installation-settings-client.js";
import { mountInstallationSettingsSection } from "../src/installation-settings-section.js";
import { seedingSourceOf } from "../src/tournament-operation-client.js";
import { rosterChoiceList } from "../src/tournament-roster-picker.js";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const administration = (overrides: Partial<InstallationSettingsAdministration> = {}) => ({
  schemaVersion: "mk8dx.installation-settings-administration.v1",
  playerCreation: "self_and_directors",
  ratingEligibility: "all_players",
  revision: 0,
  updatedAtMs: null,
  ratingRecompute: { needed: false, eligibilityChanged: false, claimChanges: 0, lastRecalculatedAtMs: null },
  ...overrides,
});

afterEach(() => { vi.unstubAllGlobals(); });

describe("the installation settings client", () => {
  it("reads the public settings key for key and rejects an unknown key or value", async () => {
    const client = createInstallationSettingsClient(async () => json({
      schemaVersion: "mk8dx.installation-settings.v1", playerCreation: "self_only", ratingEligibility: "claimed_only",
    }));
    expect(await client.current()).toEqual({ playerCreation: "self_only", ratingEligibility: "claimed_only" });
    const drifted = createInstallationSettingsClient(async () => json({
      schemaVersion: "mk8dx.installation-settings.v1", playerCreation: "self_only", ratingEligibility: "all_players", extra: 1,
    }));
    await expect(drifted.current()).rejects.toMatchObject({ code: "invalid_response" });
    const unknown = createInstallationSettingsClient(async () => json({
      schemaVersion: "mk8dx.installation-settings.v1", playerCreation: "everybody", ratingEligibility: "all_players",
    }));
    await expect(unknown.current()).rejects.toMatchObject({ code: "invalid_response" });
    // A page that only decides on a button falls back to the defaults; the server still refuses.
    expect(await loadInstallationSettings(unknown)).toEqual(DEFAULT_INSTALLATION_SETTINGS);
  });

  it("saves with the CSRF proof and starts the recalculation", async () => {
    const calls: { path: string; init: RequestInit }[] = [];
    const client = createInstallationSettingsClient(async (path, init) => {
      calls.push({ path, init });
      if (path === "/v1/session/csrf") {
        return json({ schemaVersion: "mk8dx.web-csrf.v1", headerName: "x-mk8dx-csrf", value: "synthetic-proof" });
      }
      if (path.endsWith("recompute-ratings")) {
        return json({ schemaVersion: "mk8dx.installation-rating-recompute.v1", epoch: 7, includedPublications: 2, appliedRaces: 40, skippedRaces: 1, ratedPlayers: 31 });
      }
      return json(administration({ playerCreation: "directors_only", revision: 1 }));
    });
    expect(await client.update({ expectedRevision: 0, playerCreation: "directors_only" }))
      .toMatchObject({ playerCreation: "directors_only", revision: 1 });
    expect(calls[1]!.path).toBe("/v1/administrator/installation-settings");
    expect(JSON.parse(String(calls[1]!.init.body))).toEqual({ expectedRevision: 0, playerCreation: "directors_only" });
    expect((calls[1]!.init.headers as Record<string, string>)["x-mk8dx-csrf"]).toBe("synthetic-proof");
    expect(await client.recomputeRatings()).toMatchObject({ epoch: 7, ratedPlayers: 31 });
    expect(calls.at(-1)!.path).toBe("/v1/administrator/installation-settings/actions/recompute-ratings");
  });

  it("names the server's refusal", async () => {
    const client = createInstallationSettingsClient(async (path) => path === "/v1/session/csrf"
      ? json({ schemaVersion: "mk8dx.web-csrf.v1", headerName: "x-mk8dx-csrf", value: "synthetic-proof" })
      : json({ code: "installation_settings_conflict", message: "changed" }, 409));
    await expect(client.update({ expectedRevision: 0, ratingEligibility: "claimed_only" }))
      .rejects.toMatchObject({ code: "conflict", serverCode: "installation_settings_conflict" });
  });
});

async function settle(): Promise<void> {
  for (let turn = 0; turn < 8; turn += 1) { await new Promise((resolve) => setTimeout(resolve, 0)); }
}

describe("Administration → Installation settings", () => {
  it("shows both choices, saves who creates Players at once and says when ratings are out of date", async () => {
    const document = new FakeDocument();
    const root = document.createElement("div");
    const saved: unknown[] = [];
    let current = administration({
      ratingEligibility: "claimed_only", revision: 2,
      ratingRecompute: { needed: true, eligibilityChanged: false, claimChanges: 3, lastRecalculatedAtMs: 1_790_000_000_000 },
    }) as unknown as InstallationSettingsAdministration;
    const client: InstallationSettingsClient = {
      async current() { return current; },
      async administration() { return current; },
      async update(input) {
        saved.push(input);
        current = { ...current, ...input, revision: current.revision + 1 } as InstallationSettingsAdministration;
        return current;
      },
      async recomputeRatings() { return { epoch: 1, includedPublications: 0, appliedRaces: 0, skippedRaces: 0, ratedPlayers: 0 }; },
    };
    const mounted = mountInstallationSettingsSection(root as unknown as HTMLElement, client);
    await mounted.ready;
    const page = texts(root).join("\n");
    expect(page).toContain("Installation settings");
    expect(page).toContain("Who creates Players");
    expect(page).toContain("Who counts for the rating");
    expect(page).toContain("3 claim change(s) of Players with races since the last recalculation");
    expect(descendants(root).some((node) => node.tagName === "button" && node.textContent === "Recalculate ratings now")).toBe(true);
    const selects = descendants(root).filter((node) => node.tagName === "select");
    expect(selects).toHaveLength(2);
    expect(selects[1]!.children.map((option) => option.value)).toEqual(["all_players", "claimed_only"]);
    selects[0]!.value = "self_only";
    selects[0]!.dispatch("change");
    await settle();
    expect(saved).toEqual([{ expectedRevision: 2, playerCreation: "self_only" }]);
    mounted.unmount();
    expect(root.children).toHaveLength(0);
  });

  it("removes itself for somebody who is not an administrator", async () => {
    const document = new FakeDocument();
    const root = document.createElement("div");
    const client = createInstallationSettingsClient(async () => json({ code: "installation_settings_forbidden", message: "no" }, 403));
    const mounted = mountInstallationSettingsSection(root as unknown as HTMLElement, client);
    await mounted.ready;
    expect(root.children).toHaveLength(0);
  });
});

describe("the night's seeding source on the website", () => {
  it("reads the seeding source the server serves (no seedOrder fallback, 2026-11-02)", () => {
    expect(seedingSourceOf({ seedingSource: "director_nights" })).toBe("director_nights");
    expect(seedingSourceOf({ seedingSource: "random" })).toBe("random");
  });
});

describe("\"new Player\" when only self sign-up creates Players", () => {
  it("shows the explanation instead of the button", () => {
    const document = new FakeDocument();
    const entry = { name: "Mal", sameNameInOwnNights: false, candidates: [] };
    const open = rosterChoiceList(document as unknown as Document, entry, {
      pickLabel: () => "Add", onPick: () => undefined, onCreate: () => undefined,
    });
    expect(texts(open as never).join("\n")).toContain("New Player \"Mal\"");
    const closed = rosterChoiceList(document as unknown as Document, entry, {
      pickLabel: () => "Add", onPick: () => undefined, onCreate: () => undefined, creationClosed: true,
    });
    const words = texts(closed as never).join("\n");
    expect(words).not.toContain("New Player \"Mal\"");
    expect(words).toContain("On this site Players create themselves when they sign up.");
  });
});
