// The scan mapping, case by case (T-PAT-SCAN-*, T-PAT-LOWCONF, T-PROV).
//
// One file describes what a producer read and what the canonical draft makes of it, and this runner
// walks the whole route the product walks: the session-storage handoff the scanner writes, the scan
// service's mapping, applying it to a blank draft, and the provenance the publication then carries.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  applyScan, createPostTimeDraft, postTimeProvenance, validatePostTime,
} from "../src/post-time-model.js";
import {
  SCAN_HANDOFF_STORAGE_KEY, takeScanHandoff,
} from "../src/scan-handoff.js";
import {
  lastScanSource, rememberScanSource, scanFillFromHandoff,
} from "../src/scan-service.js";

type MappingCase = {
  id: string;
  note: string;
  handoff: Record<string, unknown>;
  fill: Record<string, unknown>;
  draft: {
    totalDigits: string;
    lapDigits: string[];
    scanned: string[];
    doubt: string[];
    captureLayout?: string;
    sourceKind: string;
    verificationStatus?: string;
    valid?: boolean;
  };
};

const cases = (JSON.parse(readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..",
    "tooling", "design-system", "fixtures", "scan-mapping-cases.json"),
  "utf8",
)) as { cases: MappingCase[] }).cases;

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

describe("the scan service maps what a producer read into the one draft", () => {
  it.each(cases.map((testCase) => [testCase.id, testCase] as const))("%s", (_id, testCase) => {
    // The wire: exactly what the scanner writes into session storage.
    const storage = new MemoryStorage();
    storage.setItem(SCAN_HANDOFF_STORAGE_KEY, JSON.stringify(testCase.handoff));
    const handoff = takeScanHandoff(storage, testCase.handoff["trackId"] as string);
    expect(handoff, "the handoff parses").not.toBeNull();
    // Read once: a reload never re-applies a result the Player has already seen.
    expect(storage.getItem(SCAN_HANDOFF_STORAGE_KEY)).toBeNull();

    expect(scanFillFromHandoff(handoff!)).toEqual(testCase.fill);

    const applied = applyScan(createPostTimeDraft(
      testCase.handoff["trackId"] as string,
      testCase.handoff["mode"] === 200 ? 200 : 150,
    ), scanFillFromHandoff(handoff!));
    expect(applied.conflicts, "a blank draft has nothing to conflict with").toEqual([]);
    expect(applied.draft.totalDigits).toBe(testCase.draft.totalDigits);
    expect(applied.draft.laps.map((lap) => lap.timeDigits)).toEqual(testCase.draft.lapDigits);
    expect(Object.keys(applied.draft.origin).sort()).toEqual([...testCase.draft.scanned].sort());
    expect([...applied.draft.doubt].sort()).toEqual([...testCase.draft.doubt].sort());

    const provenance = postTimeProvenance(applied.draft);
    expect(provenance.sourceKind).toBe(testCase.draft.sourceKind);
    expect(provenance.captureLayout).toBe(testCase.draft.captureLayout);
    expect(provenance.verificationStatus).toBe(testCase.draft.verificationStatus);
    expect(provenance.correctedFields).toBeUndefined();

    expect(validatePostTime(applied.draft).valid).toBe(testCase.draft.valid ?? true);
  });
});

describe("the source the Player used last", () => {
  it("is remembered and offered back, and an unknown value is ignored", () => {
    const storage = new MemoryStorage();
    expect(lastScanSource(storage)).toBeNull();
    rememberScanSource("ghost_detail", storage);
    expect(lastScanSource(storage)).toBe("ghost_detail");
    storage.setItem("mk8dx.scan-source.v1", "whatever");
    expect(lastScanSource(storage)).toBeNull();
  });

  it("survives a browser that refuses storage", () => {
    expect(() => rememberScanSource("endscreen", null)).not.toThrow();
    expect(lastScanSource(null)).toBeNull();
  });
});

describe("a scan never overwrites what the Player typed (POST_A_TIME §7)", () => {
  const filled = applyScan(createPostTimeDraft("track.mario_kart_stadium", 150), {
    totalDigits: "145912", laps: ["035392", "035300", "035220"], source: "endscreen",
  });

  it("asks before replacing a typed total, and leaves it alone until it may", () => {
    const typed = { ...filled.draft, totalDigits: "142500", origin: {} };
    const rescan = applyScan(typed, { totalDigits: "145999", laps: [], source: "endscreen" });
    expect(rescan.conflicts).toEqual(["totalDigits"]);
    expect(rescan.draft.totalDigits).toBe("142500");

    const replaced = applyScan(typed, { totalDigits: "145999", laps: [], source: "endscreen" },
      { replaceTyped: true });
    expect(replaced.conflicts).toEqual([]);
    expect(replaced.draft.totalDigits).toBe("145999");
  });

  it("re-scanning a value it filled itself is not a conflict", () => {
    const rescan = applyScan(filled.draft, { totalDigits: "145999", laps: [], source: "endscreen" });
    expect(rescan.conflicts).toEqual([]);
    expect(rescan.draft.totalDigits).toBe("145999");
  });
});
