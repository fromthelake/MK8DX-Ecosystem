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
  carriedTimes: "off",
  revision: 0,
  updatedAtMs: null,
  carriedTimesAwaitingReview: 0,
  ratingRecompute: { needed: false, eligibilityChanged: false, claimChanges: 0, lastRecalculatedAtMs: null },
  ...overrides,
});

afterEach(() => { vi.unstubAllGlobals(); });

describe("the installation settings client", () => {
  it("reads the public settings key for key and rejects an unknown key or value", async () => {
    const client = createInstallationSettingsClient(async () => json({
      schemaVersion: "mk8dx.installation-settings.v1", playerCreation: "self_only", ratingEligibility: "claimed_only",
      carriedTimes: "review",
    }));
    expect(await client.current()).toEqual({ playerCreation: "self_only", ratingEligibility: "claimed_only", carriedTimes: "review" });
    const drifted = createInstallationSettingsClient(async () => json({
      schemaVersion: "mk8dx.installation-settings.v1", playerCreation: "self_only", ratingEligibility: "all_players",
      carriedTimes: "off", extra: 1,
    }));
    await expect(drifted.current()).rejects.toMatchObject({ code: "invalid_response" });
    // ADR-0225: the carried-times answer is required and bounded to its three values.
    const missing = createInstallationSettingsClient(async () => json({
      schemaVersion: "mk8dx.installation-settings.v1", playerCreation: "self_only", ratingEligibility: "all_players",
    }));
    await expect(missing.current()).rejects.toMatchObject({ code: "invalid_response" });
    const carriedUnknown = createInstallationSettingsClient(async () => json({
      schemaVersion: "mk8dx.installation-settings.v1", playerCreation: "self_only", ratingEligibility: "all_players",
      carriedTimes: "always",
    }));
    await expect(carriedUnknown.current()).rejects.toMatchObject({ code: "invalid_response" });
    const unknown = createInstallationSettingsClient(async () => json({
      schemaVersion: "mk8dx.installation-settings.v1", playerCreation: "everybody", ratingEligibility: "all_players",
      carriedTimes: "off",
    }));
    await expect(unknown.current()).rejects.toMatchObject({ code: "invalid_response" });
    // A page that only decides on a button falls back to the defaults; the server still refuses.
    expect(await loadInstallationSettings(unknown)).toEqual(DEFAULT_INSTALLATION_SETTINGS);
    expect(DEFAULT_INSTALLATION_SETTINGS.carriedTimes).toBe("off");
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
    await client.update({ expectedRevision: 1, carriedTimes: "allowed" });
    expect(calls.at(-1)!.path).toBe("/v1/administrator/installation-settings");
    expect(JSON.parse(String(calls.at(-1)!.init.body))).toEqual({ expectedRevision: 1, carriedTimes: "allowed" });
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
      async resolveCarriedWaiting() { throw new Error("unused"); },
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
    expect(selects).toHaveLength(3);
    expect(selects[1]!.children.map((option) => option.value)).toEqual(["all_players", "claimed_only"]);
    selects[0]!.value = "self_only";
    selects[0]!.dispatch("change");
    await settle();
    expect(saved).toEqual([{ expectedRevision: 2, playerCreation: "self_only" }]);
    // ADR-0225: carried times, one line per choice, saved at once like who creates Players.
    expect(page).toContain("Times from other communities");
    expect(selects[2]!.children.map((option) => option.value)).toEqual(["off", "review", "allowed"]);
    expect(selects[2]!.children.map((option) => option.textContent)).toEqual([
      "Off: times from other communities are refused (default)",
      "With approval: an administrator approves each carried time",
      "Allowed: carried times follow the normal publication rules",
    ]);
    selects[2]!.value = "review";
    selects[2]!.dispatch("change");
    await settle();
    expect(saved.at(-1)).toEqual({ expectedRevision: 3, carriedTimes: "review" });
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

describe("carried times still waiting when approval is no longer asked (ADR-0225)", () => {
  type Asked = Parameters<NonNullable<Parameters<typeof mountInstallationSettingsSection>[2]>>[0];

  function harness(initial: Partial<InstallationSettingsAdministration>, waitingAfterSave = initial.carriedTimesAwaitingReview ?? 0) {
    const document = new FakeDocument();
    const root = document.createElement("div");
    const asked: Asked[] = [];
    const resolved: [string, number][] = [];
    let current = administration(initial) as unknown as InstallationSettingsAdministration;
    const client: InstallationSettingsClient = {
      async current() { return current; },
      async administration() { return current; },
      async update(input) {
        current = { ...current, ...input, revision: current.revision + 1, carriedTimesAwaitingReview: waitingAfterSave } as InstallationSettingsAdministration;
        return current;
      },
      async recomputeRatings() { throw new Error("unused"); },
      async resolveCarriedWaiting(decision, expectedCount) {
        resolved.push([decision, expectedCount]);
        current = { ...current, carriedTimesAwaitingReview: 0 } as InstallationSettingsAdministration;
        return { decision, resolved: expectedCount, left: 0 };
      },
    };
    const mounted = mountInstallationSettingsSection(root as unknown as HTMLElement, client, (options) => { asked.push(options); });
    const choose = async (value: string) => {
      const select = descendants(root).filter((node) => node.tagName === "select")[2]!;
      select.value = value;
      select.dispatch("change");
      await settle();
    };
    return { root, mounted, asked, resolved, choose };
  }

  it("always says how many carried times wait, with a link to the waiting runs", async () => {
    const some = harness({ carriedTimes: "review", carriedTimesAwaitingReview: 3 });
    await some.mounted.ready;
    expect(texts(some.root)).toContain("3 carried time(s) waiting for review.");
    const link = descendants(some.root).find((node) => node.tagName === "a" && node.textContent === "Show them in Time Trials");
    expect(link?.getAttribute("href")).toBe("/?admin=time-trials&publication=withheld");
    const none = harness({ carriedTimes: "review" });
    await none.mounted.ready;
    expect(texts(none.root)).toContain("No carried times are waiting for review.");
    expect(descendants(none.root).some((node) => node.tagName === "a")).toBe(false);
  });

  it("asks to publish all of them when approval is switched to allowed", async () => {
    const { mounted, asked, resolved, choose, root } = harness({ carriedTimes: "review", carriedTimesAwaitingReview: 2 });
    await mounted.ready;
    await choose("allowed");
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({
      title: "2 carried times are still waiting.", confirmLabel: "Publish all 2", cancelLabel: "Leave them waiting",
    });
    asked[0]!.onConfirm();
    await settle();
    expect(resolved).toEqual([["publish", 2]]);
    expect(texts(root)).toContain("No carried times are waiting for review.");
  });

  it("asks to refuse all of them when carried times are turned off", async () => {
    const { mounted, asked, resolved, choose } = harness({ carriedTimes: "review", carriedTimesAwaitingReview: 4 });
    await mounted.ready;
    await choose("off");
    expect(asked[0]).toMatchObject({
      title: "4 carried times are still waiting.", confirmLabel: "Refuse all 4", cancelLabel: "Leave them waiting", tone: "danger",
    });
    asked[0]!.onConfirm();
    await settle();
    expect(resolved).toEqual([["refuse", 4]]);
  });

  it("does nothing when they are left waiting, and does not ask when nothing waits or approval was not on", async () => {
    const left = harness({ carriedTimes: "review", carriedTimesAwaitingReview: 2 });
    await left.mounted.ready;
    await left.choose("allowed");
    expect(left.asked).toHaveLength(1);
    // "Leave them waiting" is the dialog's cancel: onConfirm is never called.
    await settle();
    expect(left.resolved).toEqual([]);
    expect(texts(left.root)).toContain("2 carried time(s) waiting for review.");

    const empty = harness({ carriedTimes: "review" });
    await empty.mounted.ready;
    await empty.choose("off");
    expect(empty.asked).toHaveLength(0);

    const fromOff = harness({ carriedTimes: "off", carriedTimesAwaitingReview: 2 });
    await fromOff.mounted.ready;
    await fromOff.choose("allowed");
    expect(fromOff.asked).toHaveLength(0);
  });

  it("parses the count and posts the decision with the count on screen", async () => {
    const calls: { path: string; init: RequestInit }[] = [];
    const client = createInstallationSettingsClient(async (path, init) => {
      calls.push({ path, init });
      if (path === "/v1/session/csrf") {
        return json({ schemaVersion: "mk8dx.web-csrf.v1", headerName: "x-mk8dx-csrf", value: "synthetic-proof" });
      }
      if (path.endsWith("resolve-carried-waiting")) {
        return json({ schemaVersion: "mk8dx.carried-waiting-resolution.v1", decision: "refuse", resolved: 2, left: 0 });
      }
      return json(administration({ carriedTimesAwaitingReview: 2 }));
    });
    expect((await client.administration()).carriedTimesAwaitingReview).toBe(2);
    expect(await client.resolveCarriedWaiting("refuse", 2)).toEqual({ decision: "refuse", resolved: 2, left: 0 });
    expect(calls.at(-1)!.path).toBe("/v1/administrator/time-trials/actions/resolve-carried-waiting");
    expect(JSON.parse(String(calls.at(-1)!.init.body))).toEqual({ decision: "refuse", expectedCount: 2 });
    const missing = createInstallationSettingsClient(async () => json({ ...administration(), carriedTimesAwaitingReview: undefined }));
    await expect(missing.administration()).rejects.toMatchObject({ code: "invalid_response" });
    const conflict = createInstallationSettingsClient(async (path) => path === "/v1/session/csrf"
      ? json({ schemaVersion: "mk8dx.web-csrf.v1", headerName: "x-mk8dx-csrf", value: "synthetic-proof" })
      : json({ code: "time_trial_lifecycle_conflict", message: "changed" }, 409));
    await expect(conflict.resolveCarriedWaiting("publish", 2)).rejects.toMatchObject({ code: "conflict" });
  });
});
