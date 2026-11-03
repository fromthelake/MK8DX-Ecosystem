// W07 Track leaderboard (Phase 9): behaviour, not class names. What a reader can see and do —
// references that take no rank, the viewer's own row, the gap direction, the per-row details, the
// engine switch replacing every dependent value, and the entry into the one Post-a-Time task.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { allByClass, byClass, descendants, FakeDocument, FakeNode, texts } from "./dom-double.js";
import { useDocument } from "../src/ds-components.js";
import { lapCoinGains, mountTrackBoard, type TrackBoardOptions } from "../src/ds-track-board.js";
import type { PublicTimeTrialClient, PublicTimeTrialResult } from "../src/public-time-trial-client.js";
import { trackBenchmarks } from "../src/benchmark-manifest.js";

const TRACK = "track.mario_kart_stadium";
const SEVEN_LAP = "track.gcn_baby_park";

const settle = async (): Promise<void> => {
  for (let step = 0; step < 12; step += 1) { await Promise.resolve(); }
};

function result(overrides: Partial<PublicTimeTrialResult> = {}): PublicTimeTrialResult {
  return {
    resultId: "user_submission.time.AAAAAA01",
    revision: 1,
    playerId: "player.one",
    playerUsername: "one",
    playerDisplayName: "One",
    trackId: TRACK,
    mode: 150,
    totalTimeMs: 104_689,
    laps: [
      { lapNumber: 1, timeMs: 35_000, coinsCollected: 2, mushroomsUsed: 1 },
      { lapNumber: 2, timeMs: 34_800, coinsCollected: 4, mushroomsUsed: 0 },
      { lapNumber: 3, timeMs: 34_889, coinsCollected: 6, mushroomsUsed: 0 },
    ],
    sourceKind: "web_manual",
    resultAtMs: 1_900_000_000_000,
    publishedAtMs: 1_900_000_001_000,
    ...overrides,
  };
}

type Harness = Readonly<{
  root: FakeNode;
  board: ReturnType<typeof mountTrackBoard>;
  leaderboard: ReturnType<typeof vi.fn>;
}>;

async function mount(
  rowsByMode: Readonly<Record<number, readonly PublicTimeTrialResult[]>>,
  overrides: Partial<TrackBoardOptions> = {},
  trackId: string = TRACK,
  mode: 150 | 200 = 150,
): Promise<Harness> {
  const document = new FakeDocument();
  useDocument(document as unknown as Document);
  const root = document.createElement("div");
  const leaderboard = vi.fn(async (_trackId: string, requested: 150 | 200) => ({
    schemaVersion: "mk8dx.public-time-trial-leaderboard.v1" as const,
    results: rowsByMode[requested] ?? [],
  }));
  const client = {
    leaderboard,
    async listPlayer() { throw new Error("unused"); },
    async activity() { throw new Error("unused"); },
  } as unknown as PublicTimeTrialClient;
  const board = mountTrackBoard(root as unknown as HTMLElement, trackId, mode, {
    client,
    claimClient: { listMine: async () => [] },
    loadWorldRecords: async () => [],
    currentTimeMs: () => 1_900_000_500_000,
    signedIn: async () => true,
    signInHref: (returnTo) => `/?signin=1&returnTo=${encodeURIComponent(returnTo)}`,
    ...overrides,
  });
  await board.ready;
  await settle();
  return { root, board, leaderboard };
}

const rowsOf = (root: FakeNode): FakeNode[] =>
  allByClass(root, "ds-table__row").filter((row) => row.getAttribute("data-head") === null);

const cellText = (row: FakeNode, index: number): string =>
  allByClass(row, "ds-table__cell")[index]?.textContent ?? "";

beforeEach(() => { useDocument(new FakeDocument() as unknown as Document); });

/** The TV-with-play mark is an SVG, whose class is an attribute rather than className. */
const videoMarks = (node: FakeNode): FakeNode[] =>
  descendants(node).filter((child) => (child.getAttribute("class") ?? "").split(" ").includes("ds-video-mark"));

/** A result's own Details control and panel (the references have theirs too). */
const detailsOf = (root: FakeNode, resultId: string): Readonly<{
  action: FakeNode | undefined; detail: FakeNode | undefined;
}> => {
  const key = `row-${resultId}-detail`;
  return {
    action: allByClass(root, "ds-button").find((node) => node.getAttribute("aria-controls") === key),
    detail: descendants(root).find((node) => node.getAttribute("data-detail-for") === key),
  };
};

describe("track board", () => {
  it("shows the track, its cup and lap count, and one engine selector", async () => {
    const { root } = await mount({ 150: [result()] });
    const page = texts(root).join(" | ");
    expect(page).toContain("Mario Kart Stadium");
    expect(page).toContain("Mushroom Cup");
    expect(page).toContain("3 laps");
    // One selector for the whole page: the duplicate mode links are gone.
    expect(allByClass(root, "ds-engine-selector")).toHaveLength(1);
    expect(allByClass(root, "ds-engine-option")).toHaveLength(2);
  });

  it("fills the staff ghost's laps, mushrooms and coins from a LiveTrial reading of exactly its time", async () => {
    const staff = trackBenchmarks(TRACK, 150).find((entry) => entry.kind === "nintendo_staff")!;
    const third = staff.timeMs - 2 * Math.floor(staff.timeMs / 3);
    const lapTimesMs = [Math.floor(staff.timeMs / 3), Math.floor(staff.timeMs / 3), third];
    const reading = (totalTimeMs: number) => ({
      kind: "nintendo_staff" as const, trackId: TRACK, mode: 150 as const, totalTimeMs,
      lapTimesMs, coinsPerLap: [5, 3, 2], mushroomsPerLap: [1, 1, 1],
    });
    const { root } = await mount({ 150: [result({ totalTimeMs: 104_689 })] }, {
      // A reading of another time (an older ghost) is ignored; the matching one fills the row.
      loadReferenceReadings: async () => [reading(staff.timeMs + 1), reading(staff.timeMs)],
    });
    const row = rowsOf(root).find((candidate) => cellText(candidate, 0) === "NG")!;
    expect(cellText(row, 3)).toBe("1-1-1");
    expect(cellText(row, 4)).toBe("5-3-2");
    allByClass(row, "ds-button").find((node) => node.textContent === "Details")?.click();
    const detail = descendants(root).find((node) => node.getAttribute("data-detail-for") === "row-staff-detail");
    expect(detail?.textContent).toContain("Coins 5 · Mushrooms 1");
  });

  it("puts the references among the times without giving them a rank", async () => {
    const rows = [result({ totalTimeMs: 104_689 }), result({
      resultId: "user_submission.time.AAAAAA02", playerId: "player.two",
      playerUsername: "two", playerDisplayName: "Two", totalTimeMs: 106_000, rank: 2,
    })];
    const { root } = await mount({ 150: rows });
    const benchmarks = trackBenchmarks(TRACK, 150);
    expect(benchmarks.some((entry) => entry.kind === "nintendo_staff")).toBe(true);
    const board = rowsOf(root).filter((row) => row.getAttribute("data-detail") === null);
    const kinds = board.map((row) => row.getAttribute("data-kind"));
    expect(kinds.filter((kind) => kind === "reference").length).toBeGreaterThanOrEqual(1);
    // Ranks belong to Players only: the human rows still read #1 and #2.
    const humanRanks = board
      .filter((row) => row.getAttribute("data-kind") !== "reference")
      .map((row) => cellText(row, 0));
    expect(humanRanks).toEqual(["#1", "#2"]);
    // The WR / NG mark in the rank column says it takes no position; the chip that repeated it is gone.
    const references = board.filter((row) => row.getAttribute("data-kind") === "reference");
    expect(references.map((row) => cellText(row, 0)).sort()).toEqual(["NG", "WR"]);
    for (const row of references) {
      expect(row.textContent).not.toContain("no rank");
    }
    // Both references show their combo; the World Record also its mushrooms and coins per lap. The
    // staff ghost's per-lap readings are not in the asset records, so they stay "–".
    const [wr, staff] = ["WR", "NG"].map((mark) => references.find((row) => cellText(row, 0) === mark)!);
    for (const row of [wr!, staff!]) {
      expect(allByClass(allByClass(row, "ds-table__cell")[2]!, "ds-combo__icon")).toHaveLength(4);
    }
    expect(cellText(wr!, 3)).toBe("1-1-1");
    expect(cellText(wr!, 4)).toBe("8-2-0");
    expect(cellText(staff!, 3)).toBe("–");
    // The staff name is the name alone; the NG mark and Nintendo's logo say what it is.
    expect(staff!.textContent).not.toContain("staff ghost");
    // Both references offer the same Details as a Player's row: the kart setup, and for the World
    // Record its laps with the coins gained and mushrooms used on each.
    for (const [row, key] of [[wr!, "row-wr-detail"], [staff!, "row-staff-detail"]] as const) {
      const action = allByClass(row, "ds-button").find((node) => node.textContent === "Details");
      expect(action?.getAttribute("aria-controls")).toBe(key);
      action?.click();
      const detail = descendants(root).find((node) => node.getAttribute("data-detail-for") === key);
      expect(detail?.hidden).toBe(false);
      expect(detail?.textContent).toContain("Kart setup");
    }
    const wrDetail = descendants(root).find((node) => node.getAttribute("data-detail-for") === "row-wr-detail");
    expect(wrDetail?.textContent).toContain("Lap 10:32.560");
    expect(wrDetail?.textContent).toContain("Coins 8 · Mushrooms 1");
    // They are sorted by time among the humans, not appended at the end.
    const times = board.map((row) => row.textContent ?? "");
    expect(times.length).toBeGreaterThan(2);
  });

  it("marks the viewer's own row", async () => {
    const rows = [
      result({ totalTimeMs: 104_689 }),
      result({
        resultId: "user_submission.time.AAAAAA04", playerId: "player.middle", playerUsername: "middle",
        playerDisplayName: "Middle", totalTimeMs: 105_500, rank: 2,
      }),
      result({
        resultId: "user_submission.time.AAAAAA03", playerId: "player.me", playerUsername: "me",
        playerDisplayName: "Me", totalTimeMs: 106_442, rank: 3,
      }),
    ];
    const { root } = await mount({ 150: rows }, {
      claimClient: { listMine: async () => [{ playerId: "player.me", claimStatus: "verified" } as never] },
    });
    const own = rowsOf(root).find((row) => row.getAttribute("data-kind") === "you");
    expect(own).toBeDefined();
    expect(own?.textContent).toContain("You");
    expect(own?.textContent).toContain("1:46.442");
    // The hero no longer repeats the board as figures (owner 02-11): no World Record / Leader / PB / next-up block.
    expect(allByClass(root, "ds-stat")).toHaveLength(0);
    expect(texts(root).join(" | ")).not.toContain("To next up");
  });

  it("puts the previous track, the cup and the next track on one navigation row", async () => {
    const { root } = await mount({ 150: [result()] });
    const nav = allByClass(root, "ds-track__nav")[0];
    expect(nav).toBeDefined();
    expect(allByClass(nav!, "ds-track__nav-all")[0]?.getAttribute("aria-label")).toBe("All tracks · Mushroom Cup");
    expect(allByClass(nav!, "ds-track__nav-short").map((node) => node.textContent)).toEqual(["All tracks", "Next →"]);
  });

  it("opens a row's own laps, coins and mushrooms as an A0 row action", async () => {
    const { root } = await mount({ 150: [result()] });
    const { action, detail } = detailsOf(root, "user_submission.time.AAAAAA01");
    expect(detail).toBeDefined();
    expect(detail?.hidden).toBe(true);
    expect(action?.textContent).toBe("Details");
    expect(action).toBeDefined();
    expect(action?.getAttribute("aria-expanded")).toBe("false");
    action?.click();
    expect(detail?.hidden).toBe(false);
    expect(action?.getAttribute("aria-expanded")).toBe("true");
    expect(detail?.textContent).toContain("Lap 10:35.000");
    expect(detail?.textContent).toContain("Coins 2");
    expect(detail?.textContent).toContain("Mushrooms 1");
    action?.click();
    expect(detail?.hidden).toBe(true);
    // Which client recorded it is in the Details; Evidence is only the video (owner 2026-09-29).
    expect(detail?.textContent).toContain("Recorded with");
    const row = rowsOf(root).find((candidate) => cellText(candidate, 0) === "#1")!;
    expect(allByClass(row, "ds-evidence")).toHaveLength(0);
  });

  it("offers Share run in a Player's Details, and a shared link opens that run's Details", async () => {
    const { root } = await mount({ 150: [result()] });
    const { detail } = detailsOf(root, "user_submission.time.AAAAAA01");
    const share = descendants(detail!).find((node) => node.getAttribute("data-share-run") !== null);
    expect(share?.textContent).toContain("Share run");
    const focused = await mount({ 150: [result()] }, { focusResultId: "user_submission.time.AAAAAA01" });
    const opened = detailsOf(focused.root, "user_submission.time.AAAAAA01");
    expect(opened.detail?.hidden).toBe(false);
    expect(opened.action?.getAttribute("aria-expanded")).toBe("true");
  });

  it("puts the Player's video, and only that, in the Evidence column", async () => {
    const { root } = await mount({ 150: [result({ videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" })] });
    const row = rowsOf(root).find((candidate) => cellText(candidate, 0) === "#1")!;
    const [evidence] = allByClass(row, "ds-evidence");
    const [link] = allByClass(evidence!, "ds-evidence__link");
    expect(link?.getAttribute("href")).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(link?.getAttribute("aria-label")).toBe("Watch One's run on YouTube");
    // The mark is a TV with a play button, not a text glyph (owner 2026-10-02).
    expect(videoMarks(link!)).toHaveLength(1);
    expect(evidence?.textContent).toBe("");
    expect(allByClass(evidence!, "platform-mark")).toHaveLength(0);
  });

  it("keeps the World Record's video reachable on a phone and in its Details", async () => {
    const url = "https://www.youtube.com/watch?v=WRvideo0001";
    const { root } = await mount({ 150: [result()] }, {
      loadWorldRecords: async () => [{
        mode: 150, trackId: TRACK, totalTimeMs: 93_635, playerName: "Byron",
        lapTimesMs: [], coinsPerLap: [], mushroomsPerLap: [],
        holders: [{ playerName: "Byron", videoUrl: url, lapTimesMs: [], coinsPerLap: [], mushroomsPerLap: [] }],
      }],
    });
    const wr = rowsOf(root).find((candidate) => cellText(candidate, 0) === "WR")!;
    const cell = allByClass(wr, "ds-table__cell").find((node) => node.getAttribute("data-key") === "evidence")!;
    // On a phone the Evidence sits above Details instead of being dropped.
    expect(cell.getAttribute("data-phone")).toBe("2");
    const details = allByClass(wr, "ds-table__cell").find((node) => node.getAttribute("data-key") === "details")!;
    expect(cell.getAttribute("data-phone-col")).toBe(details.getAttribute("data-phone-col"));
    const [link] = allByClass(cell, "ds-evidence__link");
    expect(link?.getAttribute("href")).toBe(url);
    expect(videoMarks(link!)).toHaveLength(1);
    allByClass(wr, "ds-button").find((node) => node.textContent === "Details")?.click();
    const detail = descendants(root).find((node) => node.getAttribute("data-detail-for") === "row-wr-detail");
    const watch = allByClass(detail!, "ds-link").find((node) => node.getAttribute("href") === url);
    expect(watch?.textContent).toBe("Watch the World Record on YouTube");
    expect(videoMarks(watch!)).toHaveLength(1);
  });

  it("compares another Player's total and laps with the signed-in Player and uses real setup art", async () => {
    const competitor = result({
      playerId: "player.other", playerUsername: "other", playerDisplayName: "Other",
      totalTimeMs: 104_689,
      loadout: {
        characterId: "character.bowser",
        bodyId: "body.buggybud",
        bodyVariantId: "body_variant.buggybud.003_yellow",
        tireId: "tire.azure_roller",
        gliderId: "glider.cloud_glider",
      },
    });
    const own = result({
      resultId: "user_submission.time.OWNBEST01",
      playerId: "player.me", playerUsername: "me", playerDisplayName: "Me",
      totalTimeMs: 106_442,
      laps: [
        { lapNumber: 1, timeMs: 35_500, coinsCollected: 1, mushroomsUsed: 0 },
        { lapNumber: 2, timeMs: 35_300, coinsCollected: 3, mushroomsUsed: 1 },
        { lapNumber: 3, timeMs: 35_642, coinsCollected: 5, mushroomsUsed: 2 },
      ],
    });
    const { root } = await mount({ 150: [competitor, own] }, {
      claimClient: { listMine: async () => [{ playerId: "player.me", claimStatus: "verified" } as never] },
    });
    const { action, detail } = detailsOf(root, "user_submission.time.AAAAAA01");
    action?.click();
    expect(detail?.hidden).toBe(false);
    expect(detail?.textContent).toContain("Compared with your PB−1.753");
    expect(detail?.textContent).toContain("Lap 10:35.000−0.500");
    expect(detail?.textContent).toContain("Lap 20:34.800−0.500");
    const images = descendants(detail!).filter((node) => node.tagName === "img");
    expect(images.map((node) => node.getAttribute("src"))).toContain(
      "/assets/images/vehicles/bodies/variants/body_variant.buggybud.003_yellow.png",
    );
  });

  it("replaces every engine-dependent value when the engine changes", async () => {
    const changed: number[] = [];
    const { root, board, leaderboard } = await mount({
      150: [result({ totalTimeMs: 104_689 })],
      200: [result({
        resultId: "user_submission.time.BBBBBB01", mode: 200, totalTimeMs: 84_123,
        playerDisplayName: "Two Hundred", playerId: "player.two", playerUsername: "two",
      })],
    }, { onEngineChange: (next) => { changed.push(next); } });
    expect(texts(root).join(" | ")).toContain("1:44.689");
    const option200 = allByClass(root, "ds-engine-option")
      .find((node) => node.getAttribute("data-engine") === "200");
    option200?.click();
    await settle();
    await settle();
    expect(changed).toEqual([200]);
    expect(board.engine()).toBe(200);
    expect(leaderboard).toHaveBeenLastCalledWith(TRACK, 200, expect.anything());
    const page = texts(root).join(" | ");
    expect(page).toContain("1:24.123");
    expect(page).not.toContain("1:44.689");
    // The entry follows the engine, so a time is never posted into the other class.
    const post = allByClass(root, "ds-button").find((node) => (node.href ?? "").includes("?post="));
    expect(post?.href).toBe(`/?post=${encodeURIComponent(TRACK)}&mode=200`);
    expect(post?.textContent).toContain("200cc");
  });

  it("carries the resolved engine into every outbound track link (W06 grammar)", async () => {
    const { root } = await mount({ 150: [result()], 200: [result({ mode: 200 })] }, {}, TRACK, 200);
    const links = allByClass(root, "ds-link").map((node) => node.href);
    expect(links.some((href) => href.includes("leaderboard=") && href.includes("mode=200"))).toBe(true);
    expect(links).toContain("/?cups=1");
  });

  it("offers the one canonical task to a Player and a sign-in with the way back to a visitor", async () => {
    const signedIn = await mount({ 150: [result()] });
    const post = allByClass(signedIn.root, "ds-button")
      .find((node) => (node.href ?? "").includes("?post="));
    expect(post?.href).toBe(`/?post=${encodeURIComponent(TRACK)}&mode=150`);
    expect(post?.textContent).toContain("Post your time · 150cc");

    const visitor = await mount({ 150: [result()] }, { signedIn: async () => false });
    const signIn = byClass(visitor.root, "ds-link");
    const prompt = descendants(visitor.root)
      .find((node) => (node.href ?? "").startsWith("/?signin=1"));
    expect(signIn).toBeDefined();
    expect(prompt?.href).toBe(`/?signin=1&returnTo=${encodeURIComponent(`/?leaderboard=${encodeURIComponent(TRACK)}&mode=150`)}`);
    expect(descendants(visitor.root).some((node) => (node.href ?? "").includes("?post="))).toBe(false);
  });

  it("says a track is empty rather than showing an empty table", async () => {
    // A track with no benchmarks either: nothing to compare against, so nothing to sort.
    const { root } = await mount({ 150: [] }, { loadWorldRecords: async () => [] }, "track.unknown_track");
    expect(texts(root).join(" | ")).toContain("No published times on this track yet.");
  });

  it("offers a retry when the leaderboard cannot be loaded", async () => {
    const document = new FakeDocument();
    useDocument(document as unknown as Document);
    const root = document.createElement("div");
    let attempts = 0;
    const client = {
      async leaderboard() {
        attempts += 1;
        if (attempts === 1) { throw new Error("offline"); }
        return { schemaVersion: "mk8dx.public-time-trial-leaderboard.v1" as const, results: [result()] };
      },
      async listPlayer() { throw new Error("unused"); },
      async activity() { throw new Error("unused"); },
    } as unknown as PublicTimeTrialClient;
    const board = mountTrackBoard(root as unknown as HTMLElement, TRACK, 150, {
      client,
      claimClient: { listMine: async () => [] },
      loadWorldRecords: async () => [],
      signedIn: async () => false,
    });
    await board.ready;
    await settle();
    expect(texts(root).join(" | ")).toContain("The leaderboard could not be loaded.");
    const retry = allByClass(root, "ds-button").find((node) => node.textContent === "Try again");
    retry?.click();
    await settle();
    await settle();
    expect(attempts).toBe(2);
    expect(texts(root).join(" | ")).toContain("1:44.689");
  });

  it("keeps the technical reading of the board, in plain words", async () => {
    const { root } = await mount({ 150: [result()] });
    const details = descendants(root).find((node) => node.className.includes("ds-disclosure"));
    expect(details).toBeDefined();
    expect(details?.textContent).toContain("Technical details");
    expect(details?.textContent).toContain(TRACK);
    expect(details?.textContent).toContain("150cc");
    // The jargon is gone; the information is not.
    expect(texts(root).join(" | ")).not.toContain("canonical");
    expect(texts(root).join(" | ")).not.toContain("TRACK CONTROL");
  });

  it("shows coins as the gain per lap, not the balance a result stores", async () => {
    // Balances 2, 4, 6 at the lap ends (ADR-0001) are 2 coins gained on every lap.
    const { root } = await mount({ 150: [result()] });
    const own = rowsOf(root).find((row) => cellText(row, 0) === "#1")!;
    expect(cellText(own, 4)).toBe("2-2-2");
    const { action, detail } = detailsOf(root, "user_submission.time.AAAAAA01");
    action?.click();
    expect(detail?.textContent).toContain("Lap 20:34.800Coins 2");
    // A lap without a balance hides its gain and the next one's.
    expect(lapCoinGains([3, undefined, 7, 9])).toEqual([3, undefined, undefined, 2]);
  });

  it("reads a seven-lap track from the catalogue", async () => {
    const { root } = await mount({
      150: [result({ trackId: SEVEN_LAP, totalTimeMs: 122_000, laps: Array.from({ length: 7 }, (_, index) => ({
        lapNumber: index + 1, timeMs: 17_000, coinsCollected: index + 1, mushroomsUsed: index === 0 ? 1 : 0,
      })) })],
    }, {}, SEVEN_LAP);
    expect(texts(root).join(" | ")).toContain("7 laps");
    const { action, detail } = detailsOf(root, "user_submission.time.AAAAAA01");
    action?.click();
    expect(detail?.textContent).toContain("Lap 7");
  });
});
