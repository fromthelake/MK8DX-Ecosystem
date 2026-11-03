import { beforeEach, describe, expect, it, vi } from "vitest";

import { allByClass, byClass, descendants, FakeDocument, FakeNode } from "./dom-double.js";
import { setupPicker, useDocument } from "../src/ds-components.js";
import { CHARACTER_PARTS } from "../src/loadout-manifest.js";
import { mountPostTimeTask, partVariant, type PostTimeTaskOptions } from "../src/post-time-task.js";
import { POST_TIME_DRAFT_KEY } from "../src/post-time-model.js";
import type { WebManualTimeTrialSubmissionV1 } from "../src/manual-submission.js";

const TRACK = "track.mario_kart_stadium";
const SEVEN_LAP = "track.gcn_baby_park";

const contextDocument = {
  schemaVersion: "mk8dx.web-manual-context.v1",
  submissionId: "user_submission.time.abcdef",
  revision: 1,
  trackId: TRACK,
  playerReference: { namespace: "player", value: "player.ben" },
  producer: { version: "web-test" },
  timestamps: { createdAtMs: 1_700_000_000_000 },
};

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

const settle = async (): Promise<void> => {
  for (let step = 0; step < 12; step += 1) { await Promise.resolve(); }
};

type Harness = Readonly<{
  root: FakeNode;
  task: ReturnType<typeof mountPostTimeTask>;
  published: WebManualTimeTrialSubmissionV1[];
  storage: MemoryStorage;
  publish: ReturnType<typeof vi.fn>;
}>;

async function mount(
  overrides: Partial<PostTimeTaskOptions> = {},
  publishImpl?: (submission: WebManualTimeTrialSubmissionV1) => Promise<unknown>,
): Promise<Harness> {
  const document = new FakeDocument();
  useDocument(document as unknown as Document);
  const root = document.createElement("div");
  const storage = new MemoryStorage();
  const published: WebManualTimeTrialSubmissionV1[] = [];
  const publish = vi.fn(async (submission: WebManualTimeTrialSubmissionV1) => {
    published.push(submission);
    if (publishImpl !== undefined) { return publishImpl(submission); }
    return {
      submissionId: submission.submissionId,
      revision: submission.revision,
      feedback: {
        trackId: submission.trackId,
        modeCc: submission.mode,
        totalTimeMs: submission.totalTimeMs,
        personalBest: { previousBestMs: 109_000, deltaMs: -3_088, improved: true },
        rank: { after: 1, before: 3, passed: [], passedCount: 0, rivalsPassed: 0 },
      },
    };
  });
  const task = mountPostTimeTask(root as unknown as HTMLElement, {
    trackId: TRACK,
    mode: 150,
    playerId: "player.ben",
    storage,
    bootstrapClient: {
      async bootstrap() {
        return {
          contextJson: () => JSON.stringify(contextDocument),
          async csrfProof() { return { headerName: "X-CSRF", value: "proof" }; },
        };
      },
    },
    publicationClient: { publish: publish as never },
    boardClient: {
      async leaderboard() {
        return [
          { playerId: "player.evan", playerUsername: "evan", playerDisplayName: "Evan", totalTimeMs: 104_500 },
          { playerId: "player.ben", playerUsername: "ben", playerDisplayName: "Ben", totalTimeMs: 109_000 },
        ];
      },
      async ownBest() { return null; },
      async rivals() { return new Set<string>(["player.evan"]); },
    },
    ...overrides,
  });
  await settle();
  return { root, task, published, storage, publish };
}

function typeTotal(root: FakeNode, digits: string): void {
  const input = byClass(root, "ds-time-input__native")!;
  input.value = digits;
  input.dispatch("input");
}

function publishControl(root: FakeNode): FakeNode {
  return byClass(byClass(root, "ds-armed")!, "ds-button")!;
}

function readTexts(root: FakeNode): string {
  return descendants(root).map((node) => node.textContent ?? "").join(" | ");
}

beforeEach(() => { vi.restoreAllMocks(); });

describe("the canonical Post-a-Time task (T-PAT-DIRECT)", () => {
  it("opens straight on the form - there is no method choice to make", async () => {
    const { root } = await mount();
    const page = readTexts(root);
    expect(page).toContain("Total time");
    expect(page).not.toContain("Enter manually");
    expect(page).not.toContain("Scan result / Enter manually");
    // One form instance, one publish action.
    expect(allByClass(root, "ds-time-input")).toHaveLength(4); // total + three laps
    expect(allByClass(root, "ds-armed")).toHaveLength(1);
  });

  it("says why Publish is disabled, and never disables it silently", async () => {
    const { root } = await mount();
    expect(publishControl(root).getAttribute("aria-disabled")).toBe("true");
    expect(readTexts(root)).toContain("Enter a total time first.");
  });

  it("shows the rule that is failing at the field, and clears it on correction", async () => {
    const { root, task } = await mount();
    typeTotal(root, "145912");
    const lapInputs = allByClass(root, "ds-time-input__native");
    lapInputs[1]!.value = "035392";
    lapInputs[1]!.dispatch("input");
    expect(task.draft().laps[0]?.timeDigits).toBe("035392");
    // Two laps missing: the field-level message names the lap, and Publish stays disabled.
    expect(readTexts(root)).toContain("Lap 2 missing");
    expect(publishControl(root).getAttribute("aria-disabled")).toBe("true");
  });

  it("predicts the outcome from the loaded board before anything is published", async () => {
    const { root } = await mount();
    typeTotal(root, "145912");
    const page = readTexts(root);
    // Own row (1:49.000) leaves the field; Evan at 1:44.500 stays ahead.
    expect(page).toContain("Predicted position 2 of 2");
    expect(page).toContain("Personal best");
    expect(page).toContain("Evan");
  });

  it("makes clear that a slower scan keeps the existing PB standing", async () => {
    const { root } = await mount({
      boardClient: {
        async leaderboard() {
          return [
            { playerId: "player.matteo", playerUsername: "matteo", playerDisplayName: "Matteo", totalTimeMs: 67_124 },
            { playerId: "player.ben", playerUsername: "ben", playerDisplayName: "Ben", totalTimeMs: 67_302 },
            { playerId: "player.valerio", playerUsername: "valerio", playerDisplayName: "Valerio", totalTimeMs: 67_321 },
          ];
        },
        async ownBest() { return null; },
        async rivals() { return new Set<string>(["player.matteo"]); },
      },
    });
    typeTotal(root, "114723");
    const page = readTexts(root);
    expect(page).toContain("This time is +7.421 slower than your 1:07.302 PB.");
    expect(page).toContain("Your leaderboard position stays #2 of 3, based on your 1:07.302 PB.");
    expect(page).toContain("Matteo");
    expect(page).toContain("remains +0.178 · your PB is behind");
    expect(page).toContain("Valerio");
    expect(page).toContain("remains −0.019 · your PB is ahead");
  });

  it("shows the scanned PB's signed delta to the player it passes", async () => {
    const { root } = await mount({
      boardClient: {
        async leaderboard() {
          return [
            { playerId: "player.matteo", playerUsername: "matteo", playerDisplayName: "Matteo", totalTimeMs: 67_124 },
            { playerId: "player.ben", playerUsername: "ben", playerDisplayName: "Ben", totalTimeMs: 67_302 },
            { playerId: "player.valerio", playerUsername: "valerio", playerDisplayName: "Valerio", totalTimeMs: 67_321 },
          ];
        },
        async ownBest() { return null; },
        async rivals() { return new Set<string>(["player.matteo"]); },
      },
    });
    typeTotal(root, "106559");
    const page = readTexts(root);
    expect(page).toContain("Personal best — −0.743 faster than 1:07.302.");
    expect(page).toContain("Matteo");
    expect(page).toContain("Matteo: −0.565 · you would be ahead");
    expect(page).toContain("You would pass 1 player, 1 of them a rival.");
  });

  it("arms on the first press, publishes on the second, and any edit cancels", async () => {
    const { root, task, published } = await mount();
    typeTotal(root, "145912");
    const control = publishControl(root);
    control.click();
    expect(readTexts(root)).toContain("Confirm publication");
    expect(control.textContent).toContain("Confirm and publish · 150cc");
    expect(published).toHaveLength(0);

    // An edit disarms: nothing is published by a stray second press after a change.
    typeTotal(root, "145913");
    expect(publishControl(root).textContent).not.toContain("Confirm and publish");
    publishControl(root).click();
    await settle();
    expect(published).toHaveLength(0);

    publishControl(root).click();
    await settle();
    expect(published).toHaveLength(1);
    expect(published[0]?.totalTimeMs).toBe(105_913);
    expect(task.publicationState().kind).toBe("published");
  });

  it("shows a dedicated confirmation, clears the draft and finishes toward Home", async () => {
    const onComplete = vi.fn();
    const { root, task, storage, published } = await mount({ onComplete });
    typeTotal(root, "145912");
    publishControl(root).click();
    publishControl(root).click();
    await settle();

    expect(task.publicationState().kind).toBe("published");
    expect(storage.getItem(POST_TIME_DRAFT_KEY)).toBeNull();
    expect(readTexts(root)).toContain("Time posted");
    expect(readTexts(root)).toContain("Taking you back to Home");
    expect(published).toHaveLength(1);
    const home = allByClass(root, "ds-button").find((node) =>
      node.textContent?.includes("Go to Home now") === true);
    expect(home).toBeDefined();
    home!.click();
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("shows the server's feedback in place of the prediction once it answers", async () => {
    const { root } = await mount();
    typeTotal(root, "145912");
    publishControl(root).click();
    publishControl(root).click();
    await settle();
    const page = readTexts(root);
    expect(page).toContain("New personal best");
    expect(page).toContain("Now #1, up from #3.");
  });

  it("confirms that an equal time is the current enriched personal best", async () => {
    const { root } = await mount({}, async (submission) => ({
      submissionId: submission.submissionId,
      revision: submission.revision,
      feedback: {
        trackId: submission.trackId,
        modeCc: submission.mode,
        totalTimeMs: submission.totalTimeMs,
        personalBest: { previousBestMs: submission.totalTimeMs, deltaMs: 0, improved: true },
        rank: { after: 3, before: 3, passed: [], passedCount: 0, rivalsPassed: 0 },
      },
    }));
    typeTotal(root, "145912");
    publishControl(root).click();
    publishControl(root).click();
    await settle();

    const page = readTexts(root);
    expect(page).toContain("Personal best matched");
    expect(page).toContain("this run is now your current PB with its added details");
    expect(page).toContain("You stay #3.");
  });

  it("keeps the draft when publishing fails, and lets the Player try again (T-PAT-FAIL)", async () => {
    const { root, task, storage } = await mount({}, async () => {
      throw new Error("offline");
    });
    typeTotal(root, "145912");
    publishControl(root).click();
    publishControl(root).click();
    await settle();

    expect(task.publicationState()).toMatchObject({ kind: "failed", retryable: true });
    expect(task.draft().totalDigits).toBe("145912");
    expect(storage.getItem(POST_TIME_DRAFT_KEY)).toContain("145912");
    expect(readTexts(root)).toContain("Publishing failed");
    // The form is usable again: nothing is locked by a failure either.
    expect(publishControl(root).getAttribute("aria-disabled")).toBeNull();
  });

  it("restores an unfinished draft for this exact track and engine, and says so", async () => {
    const storage = new MemoryStorage();
    storage.setItem(POST_TIME_DRAFT_KEY, JSON.stringify({
      key: "player.ben|track.mario_kart_stadium|150",
      savedAtMs: 1,
      draft: {
        trackId: TRACK, mode: 150, totalDigits: "145912",
        laps: [
          { timeDigits: "", coinChange: null, mushroomsUsed: null },
          { timeDigits: "", coinChange: null, mushroomsUsed: null },
          { timeDigits: "", coinChange: null, mushroomsUsed: null },
        ],
        loadout: {}, origin: {}, doubt: [], scan: null,
      },
    }));
    const { root, task } = await mount({ storage });
    expect(task.draft().totalDigits).toBe("145912");
    expect(readTexts(root)).toContain("Your unfinished time is back.");
  });
});

describe("the kart setup is chosen through the one picker", () => {
  it("records the first option too - an empty picker starts on nothing", () => {
    const document = new FakeDocument();
    useDocument(document as unknown as Document);
    const root = document.createElement("div");
    let chosen: string | null = null;
    const picker = setupPicker<string>({
      label: "Character",
      choices: [
        { value: "character.mario", label: "Mario" },
        { value: "character.luigi", label: "Luigi" },
      ],
      value: null,
      onChange: (value) => { chosen = value; },
    });
    root.append(picker as unknown as FakeNode);
    const options = allByClass(root, "ds-picker__option");
    expect(options[0]!.getAttribute("aria-checked")).toBe("false");
    options[0]!.click();
    // Before this fix the group already held the first option, so choosing it changed nothing and
    // the Player's first choice was dropped on the floor.
    expect(chosen).toBe("character.mario");
  });

  it("puts the chosen part in the draft and shows it on the summary", async () => {
    const { root, task } = await mount();
    byClass(root, "ds-setup-part")!.click();
    await settle();
    const dialog = byClass(root.ownerDocument.body, "ds-dialog")!;
    allByClass(dialog, "ds-picker__option")[0]!.click();
    await settle();
    expect(task.draft().loadout.characterId).toBe(CHARACTER_PARTS[0]!.id);
    expect(readTexts(root)).toContain(CHARACTER_PARTS[0]!.name);
  });
});

describe("Post a time on the engine class (T-ENG-POST)", () => {
  it("switches every dependent value, tells the route, and disarms", async () => {
    const modes: number[] = [];
    const { root, task } = await mount({ onModeChanged: (mode) => { modes.push(mode); } });
    typeTotal(root, "145912");
    publishControl(root).click();
    expect(readTexts(root)).toContain("Confirm publication");

    const option200 = allByClass(root, "ds-engine-option")
      .find((node) => node.getAttribute("data-engine") === "200")!;
    option200.click();
    await settle();

    expect(task.draft().mode).toBe(200);
    expect(modes).toEqual([200]);
    // The armed state cannot survive a switch, and the Publish label follows the engine.
    expect(readTexts(root)).not.toContain("Confirm and publish · 150cc");
    expect(readTexts(root)).toContain("Publish · 200cc");
  });
});

describe("Post a time without a track (T-PAT-UNKNOWN-TRACK)", () => {
  it("uses the shared Tracks & Cups screen and opens the chosen track in this task", async () => {
    const chosen: string[] = [];
    const { root } = await mount({
      trackId: null,
      onTrackChosen: (trackId) => { chosen.push(trackId); },
    });
    expect(readTexts(root)).toContain("Tracks & Cups");
    expect(allByClass(root, "ds-cups__cup")).toHaveLength(24);
    allByClass(root, "ds-cups__cup")[10]!.click();
    const option = allByClass(root, "ds-card")
      .find((node) => node.getAttribute("href")?.includes(encodeURIComponent(SEVEN_LAP)))!;
    expect(option).toBeDefined();
    option.click();
    await settle();
    expect(chosen).toEqual([SEVEN_LAP]);
    // The 7-lap track brings seven lap rows, from the catalogue.
    expect(allByClass(root, "ds-time-input")).toHaveLength(8);
  });
});

describe("Post a time owner-review controls", () => {
  it("shows the selected track art and gives Scan result a camera icon", async () => {
    const { root } = await mount({ scanHref: "/scanner", onScan: () => undefined });
    const context = byClass(root, "ds-post__track-context")!;
    expect(byClass(context, "ds-thumb__art")?.getAttribute("src")).toContain("mario_kart_stadium");
    expect(byClass(context, "ds-thumb__badge")).toBeDefined();
    const scan = byClass(root, "ds-scan")!;
    expect(descendants(scan).some((node) => node.tagName === "svg")).toBe(true);
    expect(byClass(scan, "ds-button")?.textContent).toContain("Scan result");
  });

  it("clears one optional lap or all optional laps", async () => {
    const { root, task } = await mount({});
    byClass(root, "ds-post__disclosure")!.click();
    const inputs = allByClass(root, "ds-time-input__native");
    inputs[1]!.value = "035392";
    inputs[1]!.dispatch("input");
    inputs[2]!.value = "035260";
    inputs[2]!.dispatch("input");

    const firstClear = descendants(root).find((node) =>
      node.getAttribute("aria-label") === "Clear lap 1")!;
    firstClear.click();
    expect(task.draft().laps[0]?.timeDigits).toBe("");
    expect(task.draft().laps[1]?.timeDigits).toBe("035260");

    const clearAll = allByClass(root, "ds-button")
      .find((node) => node.textContent === "Clear all")!;
    clearAll.click();
    expect(task.draft().laps.every((lap) =>
      lap.timeDigits === "" && lap.coinChange === null && lap.mushroomsUsed === null)).toBe(true);
    expect(byClass(root, "ds-post__laps")?.hidden).toBe(false);
  });

  it("shows the typed total in the confirmation, not the empty draft it was built with", async () => {
    const { root } = await mount();
    typeTotal(root, "145912");
    publishControl(root).click();
    const confirmation = byClass(root, "ds-post__confirmation")!;
    expect(confirmation.hidden).toBe(false);
    const summary = readTexts(confirmation);
    expect(summary).toContain("1:45.912");
    expect(summary).not.toContain("_:__.___");
  });

  it("opens a compact confirmation with the complete publication and can go back", async () => {
    const { root, published } = await mount({
      trackId: SEVEN_LAP,
      scanFill: {
        totalDigits: "114723",
        laps: ["012068", "012154", "010512", "010608", "010443", "009999", "008939"],
        characterId: "character.inkling_boy",
        bodyId: "body.buggybud",
        tireId: "tire.roller",
        gliderId: "glider.super_glider",
      },
    });
    publishControl(root).click();
    const confirmation = byClass(root, "ds-post__confirmation")!;
    expect(confirmation.hidden).toBe(false);
    const summary = readTexts(confirmation);
    expect(summary).toContain("1:14.723");
    expect(summary).toContain("150cc");
    expect(summary).toContain("Lap 1");
    expect(summary).toContain("Coins — · Mushrooms —");
    expect(summary).toContain("Biddybuggy · Blue");
    expect(descendants(confirmation).some((node) =>
      node.getAttribute("src")?.includes("body_variant.buggybud.000_blue"))).toBe(true);
    expect(descendants(confirmation).some((node) =>
      node.getAttribute("src")?.includes("glider_variant.super_glider.012_inkling_m"))).toBe(true);
    expect(published).toHaveLength(0);

    const back = allByClass(confirmation, "ds-button")
      .find((node) => node.textContent === "Back to adjust")!;
    back.click();
    expect(confirmation.hidden).toBe(true);
    expect(publishControl(root).textContent).toContain("Publish · 150cc");
  });
});

describe("a returning scan fills the SAME form (T-PAT-SCAN/EDIT)", () => {
  it("marks the scanned fields, keeps them editable, and publishes the same contract", async () => {
    const { root, task, published } = await mount({
      scanFill: {
        totalDigits: "145912",
        laps: ["035392", "035260", "035260"],
        characterId: "character.mario",
        doubt: ["loadout.characterId"],
      },
    });
    // The same one form, with source marks - not a scan review screen.
    expect(allByClass(root, "ds-armed")).toHaveLength(1);
    const page = readTexts(root);
    expect(page).toContain("Scanned");
    expect(page).toContain("Check this one.");
    expect(task.draft().origin["totalDigits"]).toBe("scanned");

    // Editing a scanned value makes it the Player's own.
    const lapInputs = allByClass(root, "ds-time-input__native");
    lapInputs[1]!.value = "035393";
    lapInputs[1]!.dispatch("input");
    expect(task.draft().origin["laps[0].timeDigits"]).toBeUndefined();
    expect(readTexts(root)).toContain("Edited");

    // And the correction is what is published, through the same boundary.
    lapInputs[0]!.value = "145913";
    lapInputs[0]!.dispatch("input");
    publishControl(root).click();
    publishControl(root).click();
    await settle();
    expect(published).toHaveLength(1);
    expect(published[0]?.laps[0]?.timeMs).toBe(35_393);
    // ADR-0204: it stays a scan after the corrections, and says which groups were changed. The
    // status is `not_checked`, never a failed or needs-review check, so nothing about publication
    // changes - this is the same contract the typed form publishes on.
    expect(published[0]?.source.kind).toBe("web_scan");
    expect(published[0]?.source.captureLayout).toBe("time_trial_result");
    expect(published[0]?.verification?.status).toBe("not_checked");
    expect(published[0]?.verification?.correctedFields).toEqual(["totalTime", "laps"]);
  });

  it("publishes an untouched scan as a passed producer check", async () => {
    const { root, published } = await mount({
      scanFill: {
        totalDigits: "145912",
        laps: ["035392", "035260", "035260"],
        source: "ghost_detail",
        producerVersion: "tt-scan-web/0.4.1-web.2",
        lapSumMatches: true,
        confidence: { totalTime: 0.97 },
      },
    });
    publishControl(root).click();
    publishControl(root).click();
    await settle();
    expect(published).toHaveLength(1);
    expect(published[0]?.source.kind).toBe("web_scan");
    expect(published[0]?.source.captureLayout).toBe("ghost_details");
    expect(published[0]?.source.producerVersion).toBe("tt-scan-web/0.4.1-web.2");
    expect(published[0]?.verification?.status).toBe("producer_check_passed");
    expect(published[0]?.verification?.method).toBe("tt_scan_web_v1");
    expect(published[0]?.verification?.fieldConfidence).toEqual({ totalTime: 0.97 });
    expect(published[0]?.verification?.correctedFields).toBeUndefined();
  });

  it("publishes a typed time as web_manual, with no verification at all", async () => {
    const { root, published } = await mount({});
    const inputs = allByClass(root, "ds-time-input__native");
    inputs[0]!.value = "145912";
    inputs[0]!.dispatch("input");
    publishControl(root).click();
    publishControl(root).click();
    await settle();
    expect(published).toHaveLength(1);
    expect(published[0]?.source.kind).toBe("web_manual");
    expect(published[0]?.source.captureLayout).toBeUndefined();
    expect(published[0]?.verification).toBeUndefined();
  });
});

describe("the colour a part is shown in (same rule as the APK)", () => {
  const loadout = (characterId: string | null, bodyId: string | null = "body.pipe_frame",
    gliderId: string | null = "glider.super_glider") =>
    ({ characterId, bodyId, tireId: "tire.standard", gliderId });

  it("follows the character's own colour without a scan", () => {
    expect(partVariant("bodyId", "body.pipe_frame", loadout("character.yoshi"), undefined)?.id)
      .toBe("body_variant.pipe_frame.010_lightgreen");
    expect(partVariant("characterId", "character.yoshi", loadout("character.yoshi"), undefined))
      .toBeUndefined();
  });

  it("shows a scanned yellow Yoshi, and the body and glider follow its colour", () => {
    const scanned = { characterId: "character_variant.yoshi.020_yellow" };
    const parts = loadout("character.yoshi");
    expect(partVariant("characterId", "character.yoshi", parts, scanned)?.id)
      .toBe("character_variant.yoshi.020_yellow");
    expect(partVariant("bodyId", "body.pipe_frame", parts, scanned)?.id)
      .toBe("body_variant.pipe_frame.022_yellow");
    expect(partVariant("gliderId", "glider.super_glider", parts, scanned)?.id)
      .toBe("glider_variant.super_glider.043_yellow");
  });

  it("shows a scanned glider colour while the Player keeps that glider", () => {
    const scanned = { gliderId: "glider_variant.super_glider.001_blue" };
    expect(partVariant("gliderId", "glider.super_glider", loadout("character.yoshi"), scanned)?.id)
      .toBe("glider_variant.super_glider.001_blue");
  });

  it("drops a scanned colour once the Player picks another part", () => {
    const scanned = { characterId: "character_variant.yoshi.020_yellow",
      bodyId: "body_variant.pipe_frame.022_yellow" };
    // Another character: neither the yellow Yoshi nor its colour carries over.
    expect(partVariant("characterId", "character.mario", loadout("character.mario"), scanned))
      .toBeUndefined();
    expect(partVariant("bodyId", "body.pipe_frame", loadout("character.mario"), scanned)?.id)
      .toBe("body_variant.pipe_frame.022_yellow");
    // Another body: it follows the scanned character's colour, not the scanned body.
    expect(partVariant("bodyId", "body.standard_kart",
      loadout("character.yoshi", "body.standard_kart"), scanned)?.id)
      .toBe("body_variant.standard_kart.045_yellow");
  });
});
