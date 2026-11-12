import { describe, expect, it, vi } from "vitest";

import {
  attachOwnerTimeTrialManagement,
  correctionOf,
  editDraftOf,
  describeCarriedFrom,
  describeLifecycleEvent,
  describePresence,
  formatTimeMs,
  mountTimeTrialManagementPanel,
  parseTimeMs,
  prepareCorrection,
} from "../src/time-trial-management.js";
import {
  TimeTrialLifecycleClientError,
  type ManagedTimeTrial,
  type TimeTrialLifecycleClient,
} from "../src/time-trial-lifecycle-client.js";
import { mountAdministratorTimeTrialSection } from "../src/administrator-time-trial-section.js";
import { allByClass, byClass, descendants, FakeDocument, type FakeNode, texts } from "./dom-double.js";

function node(root: FakeNode, value: string): FakeNode {
  const found = descendants(root).find((candidate) => candidate.textContent === value);
  if (found === undefined) { throw new Error(`synthetic node missing: ${value}`); }
  return found;
}
async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

const submissionId = "user_submission.time.SYNTHETICLIFECYCLE01";

const result: ManagedTimeTrial = {
  submissionId,
  playerId: "player.synthetic_racer_001",
  playerUsername: "SyntheticRacer",
  playerDisplayName: "Synthetic Racer",
  retirementState: "active",
  publicationStatus: "published",
  publicationReason: "policy_public",
  current: {
    revision: 1,
    modeCc: 150,
    trackId: "track.mario_kart_stadium",
    totalTimeMs: 94_612,
    laps: [31_204, 31_704, 31_704],
    sourceKind: "web_manual",
    createdAtMs: 1_900_000_000_000,
  },
  revisions: [{
    revision: 1,
    modeCc: 150,
    trackId: "track.mario_kart_stadium",
    totalTimeMs: 94_612,
    laps: [31_204, 31_704, 31_704],
    sourceKind: "web_manual",
    createdAtMs: 1_900_000_000_000,
  }],
  events: [{
    sequenceNumber: 1,
    eventType: "retired",
    retirementStateAfter: "retired",
    revision: 1,
    actorRole: "owner",
    reasonCode: "incorrect_time",
    occurredAtMs: 1_900_000_100_000,
  }],
};

function client(
  overrides: Partial<TimeTrialLifecycleClient> = {},
): TimeTrialLifecycleClient {
  return {
    async read() { return result; },
    async correct() { return result; },
    async retire() { return { ...result, retirementState: "retired" }; },
    async restore() { return result; },
    async setVideo() { return result; },
    async listForAdministrator() { return [result]; },
    async publishReviewed() { return { ...result, publicationStatus: "published" }; },
    ...overrides,
  };
}

describe("Time Trial management reading and checking", () => {
  it("round-trips the times a Player actually types", () => {
    expect(formatTimeMs(94_612)).toBe("1:34.612");
    expect(parseTimeMs("1:34.612")).toBe(94_612);
    expect(parseTimeMs("34.612")).toBe(34_612);
    expect(parseTimeMs("31.2")).toBe(31_200);
    expect(parseTimeMs("1:74.612")).toBeNull();
    expect(parseTimeMs("nonsense")).toBeNull();
    expect(parseTimeMs("0.000")).toBeNull();
  });

  it("refuses laps that do not add up to the total before sending anything", () => {
    const outcome = prepareCorrection({
      totalTime: "1:34.612",
      laps: ["31.204", "31.704", "31.000"],
      reasonCode: "incorrect_time",
      note: "",
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.ok ? "" : outcome.message)
      .toContain("add up to 1:33.908, not 1:34.612");
  });

  it("accepts no laps, three laps, and seven laps but nothing between", () => {
    expect(prepareCorrection({
      totalTime: "1:34.612", laps: ["", "", ""],
      reasonCode: "incorrect_time", note: "",
    })).toEqual({
      ok: true,
      correction: {
        totalTimeMs: 94_612, laps: [], reasonCode: "incorrect_time",
      },
    });
    expect(prepareCorrection({
      totalTime: "1:34.612", laps: ["31.204", "31.704", "31.704"],
      reasonCode: "incorrect_time", note: " Misread the screen. ",
    })).toEqual({
      ok: true,
      correction: {
        totalTimeMs: 94_612,
        laps: [31_204, 31_704, 31_704],
        reasonCode: "incorrect_time",
        note: "Misread the screen.",
      },
    });
    const twoLaps = prepareCorrection({
      totalTime: "1:34.612", laps: ["47.306", "47.306", ""],
      reasonCode: "incorrect_time", note: "",
    });
    expect(twoLaps.ok).toBe(false);
    expect(twoLaps.ok ? "" : twoLaps.message).toContain("3 laps");
  });

  it("tells the audit story in plain language", () => {
    expect(describeLifecycleEvent(
      result.events[0]!, true, "Synthetic Racer",
    )).toBe("You retired this result — the time was wrong");
    expect(describeLifecycleEvent(
      { ...result.events[0]!, actorRole: "administrator", note: "Duplicate run" },
      true,
      "Synthetic Racer",
    )).toBe(
      "An administrator retired this result — the time was wrong — “Duplicate run”",
    );
    expect(describeLifecycleEvent(
      { ...result.events[0]!, eventType: "restored" }, false, "Synthetic Racer",
    )).toBe("Synthetic Racer brought back this result — the time was wrong");
    expect(describePresence(result))
      .toBe("Public — visible on leaderboards and your profile.");
    expect(describePresence({ ...result, retirementState: "retired" }))
      .toContain("taken out of public views");
  });
});

describe("Time Trial management panel", () => {
  it("shows the current result, its source, its version and its history", async () => {
    const document = new FakeDocument();
    const root = document.createElement("div");
    const panel = mountTimeTrialManagementPanel(
      root as unknown as HTMLElement,
      submissionId,
      { client: client() },
    );
    await panel.ready;
    expect(panel.container.getAttribute("aria-label")).toContain(
      "Synthetic Racer's Mario Kart Stadium 150cc Time Trial",
    );
    const shown = texts(root);
    expect(shown).toContain("1:34.612");
    expect(shown).toContain("31.204 · 31.704 · 31.704");
    expect(shown).toContain("entered on the website");
    expect(shown).toContain("1 of 1");
    expect(shown).toContain("You retired this result — the time was wrong");
    panel.unmount();
    expect(root.children).toHaveLength(0);
  });

  it("fixes a result in the Post a Time form itself (owner 2026-09-28)", async () => {
    const document = new FakeDocument();
    const root = document.createElement("div");
    const panel = mountTimeTrialManagementPanel(root as unknown as HTMLElement, submissionId, { client: client() });
    await panel.ready;
    await settle();
    const page = texts(root).join(" | ");
    expect(page).toContain("Fix this result");
    expect(page).toContain("Video (YouTube)");
    expect(page).toContain("Why is it changing?");
    expect(allByClass(root, "ds-post").length).toBe(1);
    panel.unmount();
  });

  it("starts the form from what the result recorded: coin balances become changes per lap", () => {
    const draft = editDraftOf({
      ...result,
      current: {
        ...result.current, totalTimeMs: 104_689, laps: [35_000, 34_800, 34_889],
        lapDetails: [{ coinsCollected: 4, mushroomsUsed: 1 }, { coinsCollected: 8 }, {}],
        loadout: { characterId: "character.inkling_boy", bodyId: "body.buggybud", bodyVariantId: "body_variant.buggybud.000_blue" },
      },
    });
    expect(draft.totalDigits).toBe("144689");
    expect(draft.laps.map((lap) => [lap.timeDigits, lap.coinChange, lap.mushroomsUsed])).toEqual([
      ["035000", 4, 1], ["034800", 4, null], ["034889", null, null],
    ]);
    expect(draft.loadout).toEqual({ characterId: "character.inkling_boy", bodyId: "body.buggybud", tireId: null, gliderId: null });
  });

  it("sends only what changed, so the rest keeps what it recorded", () => {
    const payload = {
      trackId: "track.mario_kart_stadium", mode: 150 as const, totalTimeMs: 104_689,
      laps: [{ lapNumber: 1, timeMs: 35_000, coinsCollected: 4, mushroomsUsed: 1 },
        { lapNumber: 2, timeMs: 34_800 }, { lapNumber: 3, timeMs: 34_889 }],
      loadout: { characterId: "character.mario" },
    };
    expect(correctionOf({ payload: payload as never, lapCountsChanged: false, setupChanged: false,
      video: undefined, reasonCode: "incorrect_time", note: undefined }))
      .toEqual({ totalTimeMs: 104_689, laps: [35_000, 34_800, 34_889], reasonCode: "incorrect_time" });
    expect(correctionOf({ payload: payload as never, lapCountsChanged: true, setupChanged: true,
      video: undefined, reasonCode: "other", note: "coins" }))
      .toEqual({
        totalTimeMs: 104_689, laps: [35_000, 34_800, 34_889],
        lapDetails: [{ coinsCollected: 4, mushroomsUsed: 1 }, {}, {}],
        loadout: { characterId: "character.mario" }, reasonCode: "other", note: "coins",
      });
    expect(correctionOf({ payload: null, lapCountsChanged: false, setupChanged: false,
      video: "https://youtu.be/dQw4w9WgXcQ", reasonCode: "incorrect_time", note: undefined })).toBeNull();
  });

  it("retires with a reason and then offers to bring the result back", async () => {
    const retire = vi.fn(async () => ({
      ...result, retirementState: "retired" as const,
    }));
    const onChanged = vi.fn();
    const document = new FakeDocument();
    const root = document.createElement("div");
    const panel = mountTimeTrialManagementPanel(
      root as unknown as HTMLElement,
      submissionId,
      { client: client({ retire }), initial: result, onChanged },
    );
    await panel.ready;
    const forms = descendants(root).filter((candidate) =>
      candidate.classList.contains("ds-manage__form"));
    const retirement = forms[1]!;
    const reason = descendants(retirement).find((candidate) =>
      candidate.classList.contains("ds-manage__reason"))!;
    const note = descendants(retirement).find((candidate) =>
      candidate.name === "retirement_note")!;
    reason.value = "duplicate";
    note.value = "Recorded twice";
    retirement.dispatch("submit");
    await settle();
    expect(retire).toHaveBeenCalledWith(
      submissionId, "duplicate", "Recorded twice", expect.any(AbortSignal),
    );
    expect(onChanged).toHaveBeenCalledOnce();
    expect(node(root, "Bring it back")).toBeDefined();
    expect(texts(root).some((value) =>
      String(value).includes("Nothing was deleted"))).toBe(true);
  });

  it("explains a refused action in the Player's own terms", async () => {
    const document = new FakeDocument();
    const root = document.createElement("div");
    const panel = mountTimeTrialManagementPanel(
      root as unknown as HTMLElement,
      submissionId,
      {
        client: client({
          async read() {
            throw new TimeTrialLifecycleClientError("forbidden");
          },
        }),
      },
    );
    await panel.ready;
    expect(node(root, "You are not allowed to change this result."))
      .toBeDefined();
  });
});

describe("owner management affordance", () => {
  it("opens the management dialog and returns focus when it closes", async () => {
    const document = new FakeDocument();
    const row = document.createElement("li");
    const read = vi.fn(async () => result);
    const attached = attachOwnerTimeTrialManagement(
      row as unknown as HTMLElement,
      submissionId,
      { client: client({ read }) },
    );
    expect(read).not.toHaveBeenCalled();
    const toggle = byClass(row, "ds-button")!;
    toggle.focus();
    toggle.dispatch("click");
    await settle();
    expect(read).toHaveBeenCalledOnce();
    const opened = document.body.querySelector("dialog");
    expect(opened?.open).toBe(true);
    expect(texts(opened!)).toContain("1:34.612");
    descendants(opened!).find((candidate) =>
      candidate.tagName === "button" && candidate.textContent === "Close")!.dispatch("click");
    expect(opened?.open).toBe(false);
    expect(document.activeElement).toBe(toggle);
    attached.unmount();
  });
});

describe("a carried run (ADR-0225)", () => {
  const carriedFrom = {
    origin: "https://club.example.org",
    communityName: "Synthetic Club",
    originalSubmittedAtMs: Date.UTC(2026, 10, 3, 12),
  };

  it("names the community, or its address, and the original day", () => {
    expect(describeCarriedFrom(carriedFrom)).toMatch(/^Carried from Synthetic Club · originally .*2026$/);
    expect(describeCarriedFrom({ origin: "https://192.168.1.50:8443", originalSubmittedAtMs: carriedFrom.originalSubmittedAtMs }))
      .toMatch(/^Carried from 192\.168\.1\.50:8443 · originally /);
  });

  it("shows the marker on the run's detail and only for a carried run", async () => {
    const document = new FakeDocument();
    const root = document.createElement("div");
    const carried = { ...result, carriedFrom };
    const panel = mountTimeTrialManagementPanel(root as unknown as HTMLElement, submissionId, { client: client({ async read() { return carried; } }) });
    await panel.ready;
    const marker = byClass(root, "ds-carried-from");
    expect(marker?.textContent).toMatch(/^Carried from Synthetic Club · originally /);
    expect(marker?.getAttribute("title")).toBe("https://club.example.org");
    panel.unmount();

    const plainRoot = document.createElement("div");
    const plain = mountTimeTrialManagementPanel(plainRoot as unknown as HTMLElement, submissionId, { client: client() });
    await plain.ready;
    expect(allByClass(plainRoot, "ds-carried-from")).toHaveLength(0);
    plain.unmount();
  });

  it("shows the marker in the administrator's review list", async () => {
    const document = new FakeDocument();
    const root = document.createElement("div");
    const section = mountAdministratorTimeTrialSection(
      root as unknown as HTMLElement,
      client({ async listForAdministrator() { return [{ ...result, publicationStatus: "withheld", carriedFrom }]; } }),
      {
        async read() { throw new Error("unused"); },
        async setOwn() { throw new Error("unused"); },
        async setForPlayer() { throw new Error("unused"); },
      },
    );
    await section.ready;
    await settle();
    expect(allByClass(root, "ds-carried-from")).toHaveLength(1);
    section.unmount();
  });
});

describe("publishing a run that waits for review (ADR-0225)", () => {
  const waiting: ManagedTimeTrial = {
    ...result, events: [], publicationStatus: "withheld", publicationReason: "explicit_review_required",
    carriedFrom: { origin: "https://club.example.org", originalSubmittedAtMs: Date.UTC(2026, 10, 3, 12) },
  };
  const buttonNamed = (root: FakeNode, label: string) => descendants(root)
    .find((candidate) => candidate.tagName === "button" && candidate.textContent === label);

  it("offers Publish to an administrator, asks once, then publishes the revision on screen", async () => {
    const publishReviewed = vi.fn(async () => ({
      ...waiting, publicationStatus: "published" as const, publicationReason: "administrator_review_publication",
      events: [{
        sequenceNumber: 1, eventType: "published" as const, retirementStateAfter: "active" as const, revision: 1,
        actorRole: "administrator" as const, reasonCode: "review_approved", occurredAtMs: 1_900_000_200_000,
      }],
    }));
    const onChanged = vi.fn();
    const document = new FakeDocument();
    const root = document.createElement("div");
    const panel = mountTimeTrialManagementPanel(root as unknown as HTMLElement, submissionId, {
      client: client({ publishReviewed }), initial: waiting, viewerIsOwner: false, administrator: true, onChanged,
    });
    await panel.ready;
    expect(texts(root).some((value) => value.includes("This time was carried from another community."))).toBe(true);
    const confirmation = byClass(root, "ds-manage__confirmation")!;
    expect(confirmation.hidden).toBe(true);
    buttonNamed(root, "Publish")!.click();
    expect(confirmation.hidden).toBe(false);
    expect(texts(confirmation)).toContain("Publish this result as it is?");
    expect(publishReviewed).not.toHaveBeenCalled();
    buttonNamed(root, "Yes, publish")!.click();
    await settle();
    expect(publishReviewed).toHaveBeenCalledWith(submissionId, 1, expect.any(AbortSignal));
    expect(onChanged).toHaveBeenCalledOnce();
    // Published: the offer is gone and the history tells who did it.
    expect(buttonNamed(root, "Publish")).toBeUndefined();
    expect(texts(root).some((value) => value.includes("An administrator approved and published this result"))).toBe(true);
    panel.unmount();
  });

  it("can be cancelled, and is offered neither to the Player nor for a run that is not waiting", async () => {
    const publishReviewed = vi.fn(async () => waiting);
    const document = new FakeDocument();
    const root = document.createElement("div");
    const panel = mountTimeTrialManagementPanel(root as unknown as HTMLElement, submissionId, {
      client: client({ publishReviewed }), initial: waiting, viewerIsOwner: false, administrator: true,
    });
    await panel.ready;
    buttonNamed(root, "Publish")!.click();
    buttonNamed(root, "Cancel")!.click();
    expect(byClass(root, "ds-manage__confirmation")!.hidden).toBe(true);
    expect(publishReviewed).not.toHaveBeenCalled();
    panel.unmount();

    for (const options of [
      { initial: waiting },
      { initial: { ...waiting, publicationReason: "player_private" }, administrator: true },
      { initial: { ...waiting, publicationStatus: "published" as const }, administrator: true },
    ]) {
      const elsewhere = document.createElement("div");
      const other = mountTimeTrialManagementPanel(elsewhere as unknown as HTMLElement, submissionId, {
        client: client(), viewerIsOwner: false, ...options,
      });
      await other.ready;
      expect(allByClass(elsewhere, "ds-manage__review")).toHaveLength(0);
      other.unmount();
    }
  });

  it("offers Publish on a waiting row in Administration -> Time Trials", async () => {
    const document = new FakeDocument();
    const root = document.createElement("div");
    const section = mountAdministratorTimeTrialSection(
      root as unknown as HTMLElement,
      client({ async listForAdministrator() { return [waiting, result]; } }),
      {
        async read() { throw new Error("unused"); },
        async setOwn() { throw new Error("unused"); },
        async setForPlayer() { throw new Error("unused"); },
      },
    );
    await section.ready;
    await settle();
    expect(allByClass(root, "ds-manage__review")).toHaveLength(1);
    section.unmount();
  });
});

describe("the waiting runs link (ADR-0225)", () => {
  it("opens Administration -> Time Trials with the withheld filter chosen", async () => {
    const queries: unknown[] = [];
    const document = new FakeDocument();
    const root = document.createElement("div");
    const section = mountAdministratorTimeTrialSection(
      root as unknown as HTMLElement,
      client({ async listForAdministrator(query) { queries.push(query); return []; } }),
      {
        async read() { throw new Error("unused"); },
        async setOwn() { throw new Error("unused"); },
        async setForPlayer() { throw new Error("unused"); },
      },
      { publicationStatus: "withheld" },
    );
    await section.ready;
    expect(queries[0]).toMatchObject({ publicationStatus: "withheld" });
    section.unmount();
  });
});

describe("a run filled from an equal carried time (ADR-0225 amendment)", () => {
  it("tells the history in plain words with the community's address", () => {
    expect(describeLifecycleEvent({
      sequenceNumber: 2, eventType: "enriched", retirementStateAfter: "active", revision: 2, actorRole: "owner",
      reasonCode: "carried_fill", occurredAtMs: 1_900_000_200_000,
      carriedFrom: { origin: "https://club.example.org" }, filledFields: ["laps"],
    }, true, "Synthetic Racer")).toBe("Empty fields filled from a time carried from club.example.org");
  });
});
