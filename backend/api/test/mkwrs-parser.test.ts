import { describe, expect, it } from "vitest";
import { MKWRS_TRACKS } from "../src/world-records/mkwrs-track-map.js";
import { MkwrsParseError, parseCompleteMkwrsSnapshot, parseMkwrsPage } from "../src/world-records/mkwrs-parser.js";
import { WorldRecordService } from "../src/world-records/world-record-service.js";

type PageRow = Readonly<{ trackIndex: number; name?: string; playerName?: string; conflictingTime?: boolean; roundingDriftMs?: number; days?: string }>;
function page(input: readonly PageRow[] = MKWRS_TRACKS.map((_, trackIndex) => ({ trackIndex }))): string {
  const rows = input.map(({ trackIndex, name = MKWRS_TRACKS[trackIndex]!.name, playerName = `Player ${trackIndex}`, conflictingTime = false, roundingDriftMs = 0, days = "1" }) => {
    const index = trackIndex;
    const babyPark = MKWRS_TRACKS[index]?.trackId === "track.gcn_baby_park";
    const total = babyPark ? "1'10\"000" : conflictingTime ? "0'31\"000" : `0'30\"${String(roundingDriftMs).padStart(3, "0")}`;
    const splits = babyPark ? "'10.000','10.000','10.000','10.000','10.000','10.000','10.000','3-3-4-0-0-0-0','1-1-0-0-0-1-0'" : conflictingTime ? "'10.000','10.000','11.000','3-3-4','1-1-1'" : "'10.000','10.000','10.000','3-3-4','1-1-1'";
    return `<tr><td><a href="display.php?track=${index}">${name}</a></td>
    <td><a href="https://www.youtube.com/watch?v=test${index}">${total}</a></td><td>${playerName}</td>
    <td><img alt="Netherlands"></td><td>2026-08-24</td><td>${days}</td><td>Yoshi</td><td>Standard Kart</td><td>Roller</td><td>Paper Glider</td>
    <td><img onmouseover="show_splits${babyPark ? "_BP" : ""}('x',${splits});"></td></tr>`;
  }).join("");
  return `<html>${"<!-- bounded source -->".repeat(500)}<table>${rows}</table></html>`;
}

describe("atomic mkwrs import", () => {
  it("accepts only two complete ordered 96-track pages", () => {
    expect(parseMkwrsPage(150, page())).toHaveLength(96);
    expect(parseCompleteMkwrsSnapshot(page(), page())).toHaveLength(192);
    expect(() => parseMkwrsPage(200, page(MKWRS_TRACKS.slice(0, 95).map((_, trackIndex) => ({ trackIndex }))))).toThrow(MkwrsParseError);
    const wrong = MKWRS_TRACKS.map((_, trackIndex) => ({ trackIndex, ...(trackIndex === 12 ? { name: "Wrong Track" } : {}) }));
    expect(() => parseMkwrsPage(150, page(wrong))).toThrow(/order does not match/);
  });

  it("preserves one or two equal-time tie holders while still requiring 96 unique tracks", () => {
    const rows: PageRow[] = MKWRS_TRACKS.map((_, trackIndex) => ({ trackIndex }));
    rows.splice(72, 0, { trackIndex: 71, playerName: "Tie Player" });
    const records = parseMkwrsPage(200, page(rows));
    expect(records).toHaveLength(96);
    expect(records[71]!.playerName).toBe("Player 71 / Tie Player");
    expect(records[71]!.holders.map((holder) => holder.playerName)).toEqual(["Player 71", "Tie Player"]);
    rows.splice(73, 0, { trackIndex: 71, playerName: "Third Holder" });
    expect(parseMkwrsPage(200, page(rows))[71]!.holders).toHaveLength(3);
    rows.splice(74, 0, { trackIndex: 71, playerName: "Fourth Holder" });
    expect(() => parseMkwrsPage(200, page(rows))).toThrow(/at most two tie rows/);
  });

  it("rejects conflicting, misplaced and incomplete duplicate rows", () => {
    const conflicting: PageRow[] = MKWRS_TRACKS.map((_, trackIndex) => ({ trackIndex }));
    conflicting.splice(72, 0, { trackIndex: 71, playerName: "Not a tie", conflictingTime: true });
    expect(() => parseMkwrsPage(200, page(conflicting))).toThrow(/conflicting duplicate/);
    const misplaced: PageRow[] = MKWRS_TRACKS.map((_, trackIndex) => ({ trackIndex }));
    misplaced.push({ trackIndex: 71, playerName: "Misplaced" });
    expect(() => parseMkwrsPage(200, page(misplaced))).toThrow(/order does not match/);
    const only95WithDuplicate: PageRow[] = MKWRS_TRACKS.slice(0, 95).map((_, trackIndex) => ({ trackIndex }));
    only95WithDuplicate.splice(72, 0, { trackIndex: 71, playerName: "Tie Player" });
    expect(() => parseMkwrsPage(200, page(only95WithDuplicate))).toThrow(/96 unique tracks/);
    const repeatedHolder: PageRow[] = MKWRS_TRACKS.map((_, trackIndex) => ({ trackIndex }));
    repeatedHolder.splice(72, 0, { trackIndex: 71, playerName: "Player 71" });
    expect(() => parseMkwrsPage(200, page(repeatedHolder))).toThrow(/duplicate World Record holder/);
  });

  it("allows only the bounded source split rounding drift", () => {
    const rounded: PageRow[] = MKWRS_TRACKS.map((_, trackIndex) => ({ trackIndex, ...(trackIndex === 0 ? { roundingDriftMs: 10 } : {}) }));
    expect(parseMkwrsPage(200, page(rounded))).toHaveLength(96);
    rounded[0] = { trackIndex: 0, roundingDriftMs: 11 };
    expect(() => parseMkwrsPage(200, page(rounded))).toThrow(/splits do not total/);
  });

  it("reads a record set today, which the source lists as \"<1\" days old", () => {
    const today: PageRow[] = MKWRS_TRACKS.map((_, trackIndex) => ({ trackIndex, ...(trackIndex === 5 ? { days: "&lt;1" } : {}) }));
    expect(parseMkwrsPage(200, page(today))[5]!.durationDays).toBe(0);
    today[5] = { trackIndex: 5, days: "<1" };  // the page writes it unescaped
    expect(parseMkwrsPage(200, page(today))[5]!.durationDays).toBe(0);
    today[5] = { trackIndex: 5, days: "soon" };
    expect(() => parseMkwrsPage(200, page(today))).toThrow(/invalid record metadata/);
  });

  it("keeps item splits in another grouping than one per lap as unknown", () => {
    const html = page().replace("'3-3-4-0-0-0-0','1-1-0-0-0-1-0'", "'7-3-0','2-1-0'");
    const babyPark = parseMkwrsPage(200, html).find((record) => record.trackId === "track.gcn_baby_park")!;
    expect(babyPark.lapTimesMs).toHaveLength(7);
    expect(babyPark.coinsPerLap).toEqual([]);
    expect(babyPark.mushroomsPerLap).toEqual([]);
    expect(() => parseMkwrsPage(200, page().replace("'3-3-4-0-0-0-0'", "'3-x-4-0-0-0-0'"))).toThrow(/invalid split vector/);
  });

  it("does not write when the second page is incomplete", async () => {
    let writes = 0;
    const service = new WorldRecordService({
      latestImportAtMs: async () => null,
      list: async () => [],
      replaceComplete: async () => { writes += 1; return 0; },
    }, async (url) => url.includes("wrs_200") ? page(MKWRS_TRACKS.slice(0, 95).map((_, trackIndex) => ({ trackIndex }))) : page(), () => 1000);
    await expect(service.refreshIfDue()).rejects.toThrow();
    expect(writes).toBe(0);
  });
});
