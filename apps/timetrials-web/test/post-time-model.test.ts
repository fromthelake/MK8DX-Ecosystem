import { describe, expect, it } from "vitest";

import {
  applyPayload, applyScan, clearDraft, clearLap, clearLaps, coinBalances, createPostTimeDraft, draftKey,
  hasMeaningfulData, hasScannedValue, loadDraft, maskTypedDigits, POST_TIME_DRAFT_KEY, saveDraft,
  setLapCoinChange, setLapDigits, setLapMushrooms, setLoadoutPart, setMode, setTotalDigits,
  setTrack, trackLapCount, validatePostTime,
} from "../src/post-time-model.js";
import { createWebManualSubmission } from "../src/manual-submission.js";

const THREE_LAP = "track.mario_kart_stadium";
const SEVEN_LAP = "track.gcn_baby_park";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

function complete(trackId: string, total: string, laps: readonly string[]) {
  let draft = createPostTimeDraft(trackId, 150);
  draft = setTotalDigits(draft, total);
  laps.forEach((digits, index) => { draft = setLapDigits(draft, index, digits); });
  return draft;
}

describe("the one submission model behind Post a time", () => {
  it("takes its lap count from the track catalogue, not from a free 1-7 (SPEC D1)", () => {
    expect(trackLapCount(THREE_LAP)).toBe(3);
    expect(trackLapCount(SEVEN_LAP)).toBe(7);
    expect(createPostTimeDraft(SEVEN_LAP, 200).laps).toHaveLength(7);
    // Choosing another track resizes the rows rather than sending a length the server refuses.
    expect(setTrack(createPostTimeDraft(THREE_LAP, 150), SEVEN_LAP).laps).toHaveLength(7);
  });

  it("publishes a total-only time, with no laps and no loadout", () => {
    const draft = setTotalDigits(createPostTimeDraft(THREE_LAP, 150), "145912");
    const result = validatePostTime(draft);
    expect(result.valid).toBe(true);
    expect(result.payload).toEqual({
      mode: 150, trackId: THREE_LAP, totalTimeMs: 105_912, laps: [],
    });
  });

  it("validates through the shared rules module and names the field that is wrong", () => {
    const draft = complete(THREE_LAP, "145912", ["035392", "035000", "035000"]);
    const result = validatePostTime(draft);
    expect(result.valid).toBe(false);
    expect(result.errors.map((error) => [error.field, error.rule])).toEqual([
      ["laps", "lap_sum_equals_total"],
    ]);
  });

  it("keeps the typed digit mask the web form has always had (SPEC D5)", () => {
    // Today's form clamps a tens-of-seconds digit above 5 as it is typed. Phase 7 keeps that: a
    // stricter refusal would be a regression for everyone who mistypes.
    expect(maskTypedDigits("178000")).toBe("158000");
    expect(setTotalDigits(createPostTimeDraft(THREE_LAP, 150), "178000").totalDigits)
      .toBe("158000");
  });

  it("does NOT mask a scanned value, so a misread is shown instead of silently changed", () => {
    const applied = applyScan(createPostTimeDraft(THREE_LAP, 150), { totalDigits: "178000" });
    expect(applied.draft.totalDigits).toBe("178000");
    const errors = validatePostTime(applied.draft).errors;
    expect(errors.map((error) => error.rule)).toContain("total_seconds_range");
  });

  it("enters coins as a signed change and stores the running balance (SPEC D2, D3)", () => {
    let draft = complete(THREE_LAP, "145912", ["035392", "035260", "035260"]);
    draft = setLapCoinChange(draft, 0, 4);
    draft = setLapCoinChange(draft, 1, -2);
    draft = setLapCoinChange(draft, 2, 3);
    expect(coinBalances(draft)).toEqual([4, 2, 5]);
    const payload = validatePostTime(draft).payload;
    // All-or-none on the wire, as today's form emits it, and the stored value is the balance.
    expect(payload?.laps.map((lap) => lap.coinsCollected)).toEqual([4, 2, 5]);
  });

  it("refuses a coin run that would leave the 0-10 race balance, at the offending lap", () => {
    let draft = complete(THREE_LAP, "145912", ["035392", "035260", "035260"]);
    draft = setLapCoinChange(draft, 0, 2);
    draft = setLapCoinChange(draft, 1, -5);
    const errors = validatePostTime(draft).errors;
    expect(errors[0]).toMatchObject({ field: "laps[1].coinChange", rule: "coin_balance_range" });
  });

  it("keeps coins and mushrooms tied to lap times, and a race to three mushrooms", () => {
    const detailsOnly = setLapMushrooms(createPostTimeDraft(THREE_LAP, 150), 0, 2);
    expect(validatePostTime(setTotalDigits(detailsOnly, "145912")).errors[0])
      .toMatchObject({ rule: "lap_details_require_lap_times" });

    let draft = complete(THREE_LAP, "145912", ["035392", "035260", "035260"]);
    draft = setLapMushrooms(draft, 0, 2);
    draft = setLapMushrooms(draft, 1, 2);
    expect(validatePostTime(draft).errors[0]).toMatchObject({ rule: "mushrooms_race_total" });
  });

  it("suggests the one missing lap from the total without ever filling it in", () => {
    let draft = complete(THREE_LAP, "145912", ["035392", "035260"]);
    draft = setLapDigits(draft, 2, "");
    const error = validatePostTime(draft).errors
      .find((candidate) => candidate.rule === "lap_missing");
    expect(error?.messageKey).toBe("tt.rules.lap_missing_suggested");
    expect(error?.params["suggestionDigits"]).toBe("035260");
    expect(draft.laps[2]?.timeDigits).toBe("");
    // The other half of the rule: clearing every lap is always a way out.
    expect(validatePostTime(clearLaps(draft)).valid).toBe(true);
  });

  it("clears all optional values in one lap and keeps the other laps", () => {
    let draft = complete(THREE_LAP, "145912", ["035392", "035260", "035260"]);
    draft = setLapCoinChange(draft, 0, 4);
    draft = setLapMushrooms(draft, 0, 2);
    const cleared = clearLap(draft, 0);
    expect(cleared.laps[0]).toEqual({ timeDigits: "", coinChange: null, mushroomsUsed: null });
    expect(cleared.laps[1]?.timeDigits).toBe("035260");
  });

  it("a scan fills empty fields and never silently replaces a typed one", () => {
    let draft = setTotalDigits(createPostTimeDraft(THREE_LAP, 150), "145912");
    const first = applyScan(draft, { totalDigits: "144000", laps: ["035392", "035260", "035260"] });
    expect(first.conflicts).toEqual(["totalDigits"]);
    expect(first.draft.totalDigits).toBe("145912");
    expect(first.draft.laps.map((lap) => lap.timeDigits))
      .toEqual(["035392", "035260", "035260"]);
    expect(first.draft.origin["laps[0].timeDigits"]).toBe("scanned");
    expect(hasScannedValue(first.draft)).toBe(true);

    // Only an explicit "Replace the values you typed?" overwrites it.
    const replaced = applyScan(draft, { totalDigits: "144000" }, { replaceTyped: true });
    expect(replaced.draft.totalDigits).toBe("144000");

    // Editing a scanned value makes it typed again: the dot goes, the doubt goes.
    draft = applyScan(createPostTimeDraft(THREE_LAP, 150), {
      totalDigits: "145912", doubt: ["totalDigits"],
    }).draft;
    expect(draft.doubt).toEqual(["totalDigits"]);
    draft = setTotalDigits(draft, "145913");
    expect(draft.origin["totalDigits"]).toBeUndefined();
    expect(draft.doubt).toEqual([]);
  });

  it("keeps a draft per (player, track, mode) and restores exactly that one", () => {
    const store = new MemoryStorage();
    let draft = complete(THREE_LAP, "145912", ["035392", "035260", "035260"]);
    draft = setLoadoutPart(draft, "characterId", "character.mario");
    saveDraft("player.ben", draft, 1_000, store);
    expect(store.getItem(POST_TIME_DRAFT_KEY)).toContain(draftKey("player.ben", THREE_LAP, 150));

    const back = loadDraft("player.ben", THREE_LAP, 150, store);
    expect(back?.totalDigits).toBe("145912");
    expect(back?.loadout.characterId).toBe("character.mario");
    // Another Player, another track or the other engine is a different draft, never this one.
    expect(loadDraft("player.evan", THREE_LAP, 150, store)).toBeNull();
    expect(loadDraft("player.ben", SEVEN_LAP, 150, store)).toBeNull();
    expect(loadDraft("player.ben", THREE_LAP, 200, store)).toBeNull();
    clearDraft(store);
    expect(loadDraft("player.ben", THREE_LAP, 150, store)).toBeNull();
  });

  it("stores nothing for an empty form, and survives a storage that refuses", () => {
    const store = new MemoryStorage();
    saveDraft("player.ben", createPostTimeDraft(THREE_LAP, 150), 1, store);
    expect(store.getItem(POST_TIME_DRAFT_KEY)).toBeNull();
    expect(hasMeaningfulData(createPostTimeDraft(THREE_LAP, 150))).toBe(false);
    expect(() => saveDraft("player.ben", createPostTimeDraft(THREE_LAP, 150), 1, null))
      .not.toThrow();
    expect(loadDraft("player.ben", THREE_LAP, 150, null)).toBeNull();
  });

  it("keeps the values on a mode switch and asks the engine question again", () => {
    const draft = setMode(complete(THREE_LAP, "145912", []), 200);
    expect(draft.mode).toBe(200);
    expect(draft.totalDigits).toBe("145912");
    expect(validatePostTime(draft).payload?.mode).toBe(200);
  });

  it("maps the validated payload into the unchanged TimeTrialSubmissionV1 envelope", () => {
    let draft = complete(THREE_LAP, "145912", ["035392", "035260", "035260"]);
    draft = setLapCoinChange(draft, 0, 4);
    draft = setLapMushrooms(draft, 1, 1);
    draft = setLoadoutPart(draft, "tireId", "tire.standard");
    const payload = validatePostTime(draft).payload!;
    const submission = applyPayload(createWebManualSubmission({
      submissionId: "user_submission.time.abcdef",
      revision: 1,
      mode: 150,
      trackId: THREE_LAP,
      timeDigits: "145912",
      playerReference: { namespace: "player", value: "player.ben" },
      createdAtMs: 1_700_000_000_000,
      producerVersion: "web-1",
    }), payload);
    // Phase 7 does not touch the contract or provenance: that is ADR-0204, Phase 8.
    expect(submission.schemaVersion).toBe("mk8dx.time-trial-submission.v1");
    expect(submission.source.kind).toBe("web_manual");
    expect(submission.totalTimeMs).toBe(105_912);
    expect(submission.laps).toEqual([
      { lapNumber: 1, timeMs: 35_392, coinsCollected: 4 },
      { lapNumber: 2, timeMs: 35_260, coinsCollected: 4, mushroomsUsed: 1 },
      { lapNumber: 3, timeMs: 35_260, coinsCollected: 4 },
    ]);
    expect(submission.loadout).toEqual({ tireId: "tire.standard" });
  });

  it("produces the same payload whether the values were typed or scanned (T-FORM-PARITY)", () => {
    const typed = complete(THREE_LAP, "145912", ["035392", "035260", "035260"]);
    const scanned = applyScan(createPostTimeDraft(THREE_LAP, 150), {
      totalDigits: "145912", laps: ["035392", "035260", "035260"],
    }).draft;
    expect(validatePostTime(scanned).payload).toEqual(validatePostTime(typed).payload);
  });
});

describe("scanned colour variants", () => {
  it("travel with the scan through a saved draft but are never published", () => {
    const store = new MemoryStorage();
    const variants = { characterId: "character_variant.yoshi.020_yellow" };
    const draft = applyScan(complete(THREE_LAP, "145912", ["035392", "035260", "035260"]), {
      characterId: "character.yoshi", variants,
    }).draft;
    expect(draft.scan?.variants).toEqual(variants);
    saveDraft("player.ben", draft, 1_000, store);
    expect(loadDraft("player.ben", THREE_LAP, 150, store)?.scan?.variants).toEqual(variants);
    expect(JSON.stringify(validatePostTime(draft).payload)).not.toContain("_variant.");
  });
});
