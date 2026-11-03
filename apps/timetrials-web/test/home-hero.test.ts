import { describe, expect, it } from "vitest";

import {
  buildHomeLadder,
  comebackLines,
  homeCompetitiveCells,
  homeLadderCells,
  homeProgressState,
  HOME_SUBMIT_HREF,
  masteryLongLabel,
  recentKeyEvents,
  rivalHeadline,
  type HomeComeback,
} from "../src/home-hero.js";
import { benchmarksByKind } from "../src/benchmark-manifest.js";

describe("home comeback dashboard", () => {
  it("opens the one canonical Post-a-Time task from the Home action", () => {
    // Phase 7 made the task canonical; Phase 10 lets Home open it directly (with the task's own
    // TrackSelector) rather than sending the Player through the cup directory first.
    expect(HOME_SUBMIT_HREF).toBe("/?post=1");
  });

  it("derives the four timing-tower ladder cells from canonical bests", () => {
    const [staff, secondStaff] = benchmarksByKind("nintendo_staff", 150);
    expect(staff).toBeDefined();
    expect(secondStaff).toBeDefined();
    const metrics = buildHomeLadder([
      {
        trackId: staff!.trackId,
        mode: 150,
        totalTimeMs: staff!.timeMs - 1,
        rank: 1,
      },
      {
        trackId: secondStaff!.trackId,
        mode: 150,
        totalTimeMs: secondStaff!.timeMs + 500,
        rank: 2,
      },
      {
        trackId: staff!.trackId,
        mode: 200,
        totalTimeMs: 99_999,
        rank: 1,
      },
    ], [
      {
        trackId: staff!.trackId,
        mode: 150,
        myBestMs: staff!.timeMs - 1,
        myRank: 1,
        humanCount: 4,
        leaderBestMs: staff!.timeMs - 500,
      },
      {
        trackId: secondStaff!.trackId,
        mode: 150,
        myBestMs: secondStaff!.timeMs + 500,
        myRank: 2,
        humanCount: 4,
        leaderBestMs: secondStaff!.timeMs,
      },
    ], 150);
    expect(metrics).toEqual({
      staffGhostsBeaten: 1,
      withinOneSecond: 1,
      trackRecords: 1,
      tracksDriven: 2,
      topThreePositions: 2,
      outsideTopTen: 0,
      trackTotal: 96,
    });
  });

  it("projects progress as completed over available tracks", () => {
    expect(homeLadderCells({
      staffGhostsBeaten: 78,
      withinOneSecond: 1,
      trackRecords: 2,
      tracksDriven: 95,
      topThreePositions: 17,
      outsideTopTen: 8,
      trackTotal: 96,
    })).toEqual([
      { key: "driven", label: "Times set", value: "95/96", progress: 95 / 96, focus: "tracks-left" },
      { key: "staff", label: "Staff ghosts defeated", value: "78/96", progress: 78 / 96, focus: "staff-left" },
    ]);
  });

  it("keeps competitive status separate from completion bars", () => {
    const metrics = {
      staffGhostsBeaten: 96,
      withinOneSecond: 7,
      trackRecords: 2,
      tracksDriven: 96,
      topThreePositions: 19,
      outsideTopTen: 8,
      trackTotal: 96,
    } as const;
    expect(homeLadderCells(metrics)).toEqual([
      { key: "driven", label: "Times set", value: "96/96", progress: 1, focus: "tracks-left" },
      { key: "staff", label: "Staff ghosts defeated", value: "96/96", progress: 1, focus: "staff-left" },
    ]);
    expect(homeCompetitiveCells(metrics)).toEqual([
      { label: "Within 1s of #1", value: 7, focus: "near-record" },
      { label: "Top 3 positions", value: 19, focus: "top-three" },
      { label: "Current #1s", value: 2, focus: "current-records" },
      { label: "Outside top 10", value: 8, focus: "outside-top-ten" },
    ]);
  });

  it("reserves completion semantics for 100 percent", () => {
    expect(homeProgressState(0)).toEqual({
      percentage: 0, width: "0.0%", complete: false, empty: true,
    });
    expect(homeProgressState(30 / 48)).toEqual({
      percentage: 63, width: "62.5%", complete: false, empty: false,
    });
    expect(homeProgressState(1)).toEqual({
      percentage: 100, width: "100.0%", complete: true, empty: false,
    });
  });

  it("spells Mastery labels out for the hero presentation", () => {
    expect(masteryLongLabel("Adv B")).toBe("Advanced B");
    expect(masteryLongLabel("Exp A")).toBe("Expert A");
    expect(masteryLongLabel("Int C")).toBe("Intermediate C");
    expect(masteryLongLabel("Beg A")).toBe("Beginner A");
    // Already-clear labels stay untouched.
    expect(masteryLongLabel("Deity")).toBe("Deity");
    expect(masteryLongLabel("Myth A")).toBe("Myth A");
    expect(masteryLongLabel("Noob")).toBe("Noob");
  });

  it("interprets changes in Player language and stays quiet honestly", () => {
    const comeback: HomeComeback = {
      player: { playerId: "player.ben", displayName: "Ben" },
      timeTrials: { standing: 2, of: 12, totalMs: 1, previousStanding: 3 },
      rivals: [
        {
          playerId: "player.floyd",
          displayName: "Floyd",
          tracksAhead: 77,
          tracksBehind: 19,
          sharedCombos: 96,
          totalDeltaMs: 83_482,
          previous: {
            tracksAhead: 74,
            tracksBehind: 22,
            sharedCombos: 96,
            totalDeltaMs: 79_264,
          },
        },
        {
          // New rival: no previous baseline, therefore no delta lines.
          playerId: "player.gideon",
          displayName: "Gideon",
          tracksAhead: 10,
          tracksBehind: 80,
          sharedCombos: 90,
          totalDeltaMs: -500_000,
        },
      ],
      sinceMs: 1,
    };
    const lines = comebackLines(comeback);
    expect(lines).toEqual([
      "↑ You moved from #3 to #2 in Time Trials 150cc",
      "⚔ You gained 3 tracks on Floyd",
      "⏱ Your advantage over Floyd improved by 4.218s",
    ]);
    expect(rivalHeadline(comeback.rivals[1]!)).toBe(
      "VS Gideon: 10–80 tracks · " +
      "8:20.000 behind across 90 shared combos",
    );
    // Unchanged state produces no lines at all.
    expect(comebackLines({
      ...comeback,
      timeTrials: { standing: 2, of: 12, totalMs: 1, previousStanding: 2 },
      rivals: [{
        ...comeback.rivals[0]!,
        previous: {
          tracksAhead: 77,
          tracksBehind: 19,
          sharedCombos: 96,
          totalDeltaMs: 83_482,
        },
      }],
    })).toEqual([]);
  });

  it("turns a recent PB into track-specific current rival and ghost events", () => {
    const staff = benchmarksByKind("nintendo_staff", 150)[0]!;
    const now = 2_000_000_000_000;
    const comeback: HomeComeback = {
      player: { playerId: "player.ben", displayName: "Ben" },
      timeTrials: { standing: 1, of: 3, totalMs: 1 },
      rivals: [
        { playerId: "player.valerio", displayName: "Valerio", tracksAhead: 1, tracksBehind: 0, sharedCombos: 1, totalDeltaMs: 500 },
        { playerId: "player.matteo", displayName: "Matteo", tracksAhead: 0, tracksBehind: 1, sharedCombos: 1, totalDeltaMs: -2_000 },
      ],
    };
    const best = staff.timeMs - 500;
    const events = recentKeyEvents(comeback, [{
      player: comeback.player,
      trackId: staff.trackId,
      mode: 150,
      runs: 1,
      startMs: best,
      bestMs: best,
      personalBest: true,
      personalBestDeltaMs: 4_000,
      rank: {
        after: 2, before: 3, passedCount: 1,
        passed: [{ playerId: "player.valerio", displayName: "Valerio" }],
      },
      latestAtMs: now - 1_000,
      runDetails: [],
    }], new Map([
      ["player.ben", [{ trackId: staff.trackId, mode: 150, totalTimeMs: best, rank: 2 }]],
      ["player.valerio", [{ trackId: staff.trackId, mode: 150, totalTimeMs: best + 500, rank: 3 }]],
      ["player.matteo", [{ trackId: staff.trackId, mode: 150, totalTimeMs: best - 2_000, rank: 1 }]],
    ]), now);
    expect(events).toHaveLength(1);
    const outcomes = [events[0]!.primaryOutcome, ...events[0]!.secondaryOutcomes];
    expect(outcomes.map((outcome) => outcome.english)).toEqual(expect.arrayContaining([
      expect.stringContaining("passed Valerio ✓ · lead 0.500s"),
      expect.stringContaining("Nintendo Ghost defeated ✓"),
      expect.stringContaining("track rank: #3 → 🥈 #2"),
      expect.stringContaining("new PB by 4.000s"),
    ]));
    expect(events[0]?.primaryOutcome).toEqual(expect.objectContaining({
      kind: "passed", targetName: "Valerio", deltaMs: -500,
    }));
    expect(events[0]?.secondaryOutcomes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "ghost", deltaMs: -500 }),
      expect.objectContaining({ kind: "rank", beforeRank: 3, afterRank: 2 }),
      expect.objectContaining({ kind: "pb", deltaMs: -4_000, timeMs: best }),
    ]));
    expect(outcomes.some((outcome) => outcome.targetName === "Matteo")).toBe(false);
  });

  it("does not call an equal accepted run a key achievement", () => {
    const staff = benchmarksByKind("nintendo_staff", 150)[0]!;
    const now = 2_000_000_000_000;
    const comeback: HomeComeback = {
      player: { playerId: "player.ben", displayName: "Ben" },
      timeTrials: { standing: 1, of: 1, totalMs: staff.timeMs },
      rivals: [],
    };
    const events = recentKeyEvents(comeback, [{
      player: comeback.player,
      trackId: staff.trackId,
      mode: 150,
      runs: 1,
      startMs: staff.timeMs,
      bestMs: staff.timeMs,
      personalBest: true,
      playerDeltaMs: 0,
      latestAtMs: now - 1_000,
      runDetails: [],
    }], new Map([
      ["player.ben", [{
        trackId: staff.trackId, mode: 150, totalTimeMs: staff.timeMs, rank: 1,
      }]],
    ]), now);
    expect(events).toHaveLength(0);
  });

  it("groups outcomes per result while preserving genuinely different runs and engines", () => {
    const staff = benchmarksByKind("nintendo_staff", 150)[0]!;
    const now = 2_000_000_000_000;
    const comeback: HomeComeback = {
      player: { playerId: "player.ben", displayName: "Ben" },
      timeTrials: { standing: 1, of: 1, totalMs: staff.timeMs },
      rivals: [],
    };
    const best = staff.timeMs - 500;
    const story = {
      player: comeback.player,
      trackId: staff.trackId,
      mode: 150 as const,
      runs: 2,
      startMs: best + 500,
      bestMs: best,
      personalBest: true,
      personalBestDeltaMs: 1_000,
      latestAtMs: now - 1_000,
      runDetails: [
        { resultId: "result.first", timeMs: best + 500, atMs: now - 2_000, sourceKind: "manual" },
        { resultId: "result.second", timeMs: best, atMs: now - 1_000, sourceKind: "manual" },
      ],
    };
    const sameRunAgain = { ...story, runs: 1, runDetails: [story.runDetails[1]!] };
    const otherEngine = {
      ...story,
      mode: 200 as const,
      runs: 1,
      latestAtMs: now - 500,
      runDetails: [{
        resultId: "result.second", timeMs: best, atMs: now - 500, sourceKind: "manual",
      }],
    };
    const events = recentKeyEvents(
      comeback,
      [story, sameRunAgain, otherEngine],
      new Map(),
      now,
    );
    expect(events.map((event) => `${event.mode}:${event.runId}`)).toEqual([
      "200:result.second",
      "150:result.second",
      "150:result.first",
    ]);
    expect(events.every((event) => [event.primaryOutcome, ...event.secondaryOutcomes]
      .some((outcome) => outcome.kind === "pb"))).toBe(true);
    const ghostEvents = events.filter((event) => [event.primaryOutcome, ...event.secondaryOutcomes]
      .some((outcome) => outcome.kind === "ghost"));
    expect(ghostEvents.map((event) => event.runId)).toEqual(["result.second"]);
  });

  it("keeps only the newest 15 events from the last seven days", () => {
    const staff = benchmarksByKind("nintendo_staff", 150)[0]!;
    const now = 2_000_000_000_000;
    const comeback: HomeComeback = {
      player: { playerId: "player.ben", displayName: "Ben" },
      timeTrials: { standing: 1, of: 1, totalMs: staff.timeMs },
      rivals: [],
    };
    const story = (latestAtMs: number, mode: 150 | 200 = 150) => ({
      player: comeback.player,
      trackId: staff.trackId,
      mode,
      runs: 1,
      startMs: staff.timeMs,
      bestMs: staff.timeMs,
      personalBest: true,
      personalBestDeltaMs: 1_000,
      latestAtMs,
      runDetails: [],
    });
    const recent = Array.from({ length: 16 }, (_, index) => story(now - index * 1_000));
    const expired = story(now - 8 * 24 * 60 * 60 * 1_000, 200);
    const events = recentKeyEvents(comeback, [...recent, expired], new Map(), now);
    expect(events).toHaveLength(15);
    expect(events[0]?.atMs).toBe(now);
    expect(events.at(-1)?.atMs).toBe(now - 14_000);
    expect(events.some((event) => event.mode === 200)).toBe(false);
  });
});
