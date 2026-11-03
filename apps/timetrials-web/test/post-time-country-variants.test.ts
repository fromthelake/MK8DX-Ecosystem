// ADR-0215: Web and Android scans publish the same fields (country and colour variants).
import { describe, expect, it } from "vitest";

import {
  applyPayload, applyScan, createPostTimeDraft, loadDraft, saveDraft, setCountry, setLoadoutPart,
  setTotalDigits, validatePostTime,
} from "../src/post-time-model.js";
import { createWebManualSubmission } from "../src/manual-submission.js";
import { scanFillFromHandoff } from "../src/scan-service.js";
import { takeScanHandoff, SCAN_HANDOFF_STORAGE_KEY } from "../src/scan-handoff.js";

const TRACK = "track.mario_kart_stadium";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

function base() {
  return createWebManualSubmission({
    submissionId: "user_submission.time.abcdef", revision: 1, mode: 150, trackId: TRACK, timeDigits: "145912",
    playerReference: { namespace: "player", value: "player.ben" }, createdAtMs: 1_700_000_000_000,
    producerVersion: "web-1",
  });
}

function scanned() {
  return applyScan(createPostTimeDraft(TRACK, 150), {
    totalDigits: "145912", characterId: "character.yoshi", countryId: "country.de", source: "endscreen",
    variants: { characterId: "character_variant.yoshi.017_light_blue" },
  }).draft;
}

describe("ADR-0215 country and variants", () => {
  it("publishes the scanned flag silently and the variant with its base part", () => {
    const draft = scanned();
    expect(draft.countryId).toBe("country.de");
    const submission = applyPayload(base(), validatePostTime(draft).payload!, draft);
    expect(submission.countryId).toBe("country.de");
    expect(submission.loadout).toEqual({ characterId: "character.yoshi",
      characterVariantId: "character_variant.yoshi.017_light_blue" });
    expect(submission.verification?.correctedFields).toBeUndefined();
  });

  it("a changed base part drops the variant and records both corrections", () => {
    const draft = setLoadoutPart(scanned(), "characterId", "character.mario");
    const submission = applyPayload(base(), validatePostTime(draft).payload!, draft);
    expect(submission.loadout).toEqual({ characterId: "character.mario" });
    expect(submission.verification?.correctedFields).toEqual(["character", "characterVariant"]);
  });

  it("the Player may change or remove the flag; that is a correction", () => {
    const removed = setCountry(scanned(), null);
    const submission = applyPayload(base(), validatePostTime(removed).payload!, removed);
    expect(submission.countryId).toBeUndefined();
    expect(submission.verification?.correctedFields).toEqual(["country"]);
    expect(setCountry(scanned(), "country.nl").countryId).toBe("country.nl");
  });

  it("a typed time never carries a country", () => {
    const typed = setTotalDigits(createPostTimeDraft(TRACK, 150), "145912");
    expect(applyPayload(base(), validatePostTime(typed).payload!, typed).countryId).toBeUndefined();
  });

  it("the country survives a reload and reaches the form from the hand-off", () => {
    const store = new MemoryStorage();
    saveDraft("player.ben", scanned(), 1, store);
    expect(loadDraft("player.ben", TRACK, 150, store)?.countryId).toBe("country.de");
    store.setItem(SCAN_HANDOFF_STORAGE_KEY, JSON.stringify({ trackId: TRACK, mode: 150, totalDigits: "145912",
      laps: [], countryId: "country.de", tireId: "tire.monster", layout: "endscreen" }));
    const handoff = takeScanHandoff(store, TRACK)!;
    expect(handoff.countryId).toBe("country.de");
    expect(scanFillFromHandoff(handoff)).toMatchObject({ countryId: "country.de", tireId: "tire.monster" });
    store.setItem(SCAN_HANDOFF_STORAGE_KEY, JSON.stringify({ trackId: TRACK, mode: 150, totalDigits: "145912",
      laps: [], countryId: "country.zz" }));
    expect(takeScanHandoff(store, TRACK)!.countryId).toBeUndefined();
  });
});
