import { describe, expect, it, vi } from "vitest";

import {
  buildGlobalFocus,
  buildRivalFocus,
  fallbackFocus,
  type FocusRow,
} from "../src/home-focus.js";
import {
  TOURNAMENT_RANKING_BANDS,
  TOURNAMENT_TIERS,
  tournamentTierByRank,
  tournamentTierLabel,
} from "../src/tournament-tiers.js";

const bests = (entries: [string, 150 | 200, number, number?][]) =>
  entries.map(([trackId, mode, totalTimeMs, rank]) => ({
    trackId, mode, totalTimeMs, rank: rank ?? 1,
  }));

describe("YOUR FOCUS - rivals context", () => {
  it("keeps lowest Mastery, closest and biggest gap distinct", () => {
    // Mount Wario: only 0.4s behind Floyd, but Floyd's 1:43.000 is an
    // elite Myth A time (also the smaller RELATIVE gap). Mario Circuit:
    // 1.5s behind a beatable Exp C time. BEST NEXT must pick the
    // realistic target - neither smallest absolute nor smallest
    // relative gap - while CLOSEST BATTLE honestly stays Mount Wario.
    const mine = bests([
      ["track.mount_wario", 150, 103_400],
      ["track.mario_circuit", 150, 116_500],
    ]);
    const rivals = [{
      playerId: "player.floyd",
      displayName: "Floyd",
      bests: bests([
        ["track.mount_wario", 150, 103_000],
        ["track.mario_circuit", 150, 115_000],
      ]),
    }];
    const set = buildRivalFocus(mine, rivals);
    expect(set.best?.trackId).toBe("track.mario_circuit");
    expect(set.best?.headline).toBe("Your lowest Mastery: Adv A");
    expect(set.best?.gapMs).toBeUndefined();
    expect(set.best?.context).toContain("to reach Exp C");
    // Closest battle: the raw smallest gap, flagged close-but-tough.
    expect(set.closest?.trackId).toBe("track.mount_wario");
    expect(set.closest?.gapMs).toBe(400);
    expect(set.closest?.context).toBe("Nearest faster time.");
    expect(set.closest?.targetMasteryLabel).toBe("Myth B");
    expect(set.closest?.bullets).toContain("#1");
    // Biggest gap: the largest deficit, never a recommendation.
    expect(set.biggest?.trackId).toBe("track.mario_circuit");
    expect(set.biggest?.gapMs).toBe(1_500);
    // Deterministic.
    expect(buildRivalFocus(mine, rivals)).toEqual(set);
  });

  it("falls back honestly without rivals ahead", () => {
    const set = buildRivalFocus(
      bests([["track.mount_wario", 150, 117_291]]), []);
    expect(set.best?.headline).toContain("lowest Mastery");
    expect(set.closest).toBeNull();
    expect(set.biggest).toBeNull();
    expect(fallbackFocus([])?.headline).toBe("Set your first time");
  });

  it("keeps the requested engine on a first-time fallback", () => {
    expect(buildRivalFocus([], [], 200).best).toMatchObject({
      trackId: "track.mario_kart_stadium",
      mode: 200,
    });
  });
});

describe("YOUR FOCUS - global context", () => {
  const rows: FocusRow[] = [
    {
      trackId: "track.wild_woods",
      mode: 150,
      myBestMs: 118_372,
      myRank: 3,
      humanCount: 8,
      leaderBestMs: 117_848,
      above: {
        playerId: "player.floyd",
        displayName: "Floyd",
        bestMs: 117_894,
        rank: 2,
      },
    },
    {
      trackId: "track.big_blue",
      mode: 150,
      myBestMs: 92_000,
      myRank: 5,
      humanCount: 9,
      leaderBestMs: 85_000,
      above: {
        playerId: "player.lex",
        displayName: "Lex",
        bestMs: 87_022,
        rank: 4,
      },
    },
    // Leader on this track: no one above, never a candidate.
    {
      trackId: "track.mute_city",
      mode: 150,
      myBestMs: 90_000,
      myRank: 1,
      humanCount: 7,
      leaderBestMs: 90_000,
    },
  ];

  it("battles the next human position above, not arbitrary players", () => {
    const set = buildGlobalFocus(rows);
    // Closest: Wild Woods, 0.478s to Floyd directly above (#2).
    expect(set.closest?.trackId).toBe("track.wild_woods");
    expect(set.closest?.gapMs).toBe(118_372 - 117_894);
    expect(set.closest?.context).toBe("Nearest faster time.");
    expect(set.closest?.bullets).toContain("#2 of 8 · you #3");
    expect(set.closest?.targetMasteryLabel).toBeDefined();
    // Biggest: Big Blue, 4.978s to the position above - the largest
    // hole to gain one place, not a useless gap-to-#1.
    expect(set.biggest?.trackId).toBe("track.big_blue");
    expect(set.biggest?.gapMs).toBe(92_000 - 87_022);
    expect(set.biggest?.context).toBe("Largest time deficit.");
    expect(set.biggest?.bullets).toContain("#4 of 9 · you #5");
    expect(set.best?.headline).toContain("lowest Mastery");
    expect(buildGlobalFocus(rows)).toEqual(set);
  });

  it("uses the fallback when leading everywhere", () => {
    const leadingRows: FocusRow[] = [{
      trackId: "track.mute_city",
      mode: 150,
      myBestMs: 90_000,
      myRank: 1,
      humanCount: 7,
      leaderBestMs: 90_000,
    }];
    const set = buildGlobalFocus(
      leadingRows,
      bests([["track.mount_wario", 150, 117_291]]),
    );
    expect(set.best?.headline).toContain("lowest Mastery");
    expect(set.closest).toBeNull();
  });
});

describe("tournament classification (recovered semantics)", () => {
  it("maps ranks to the canonical fixed groups of twelve", () => {
    expect(tournamentTierByRank(1)?.name).toBe("Champion");
    expect(tournamentTierByRank(4)?.name).toBe("Champion");
    expect(tournamentTierByRank(12)?.name).toBe("Champion");
    expect(tournamentTierByRank(13)?.name).toBe("Talent");
    expect(tournamentTierByRank(25)?.name).toBe("Wild");
    expect(tournamentTierByRank(37)?.name).toBe("Adventure");
    expect(tournamentTierByRank(60)?.name).toBe("Party");
    // The ranking goes on past the five group tiers in bands of twelve, to 132.
    expect(tournamentTierByRank(61)).toMatchObject({ key: "mushroom", name: "Mushroom", dutchName: "Paddenstoel" });
    expect(tournamentTierByRank(73)?.name).toBe("Squid");
    expect(tournamentTierByRank(85)?.name).toBe("Shield");
    expect(tournamentTierByRank(97)?.name).toBe("Cloud");
    expect(tournamentTierByRank(120)?.name).toBe("Tourist");
    expect(tournamentTierByRank(132)).toMatchObject({ key: "coin", name: "Coin", dutchName: "Munt" });
    // Outside the defined bands: no label (source: 'Onbekend').
    expect(tournamentTierByRank(133)).toBeNull();
    expect(tournamentTierByRank(0)).toBeNull();
    // Recovered badge colors travel with the tiers.
    expect(TOURNAMENT_TIERS[0]).toMatchObject({
      key: "champion", color: "#F59E0B",
    });
  });

  it("keeps the final groups at five tiers and gives every band one colour", () => {
    expect(TOURNAMENT_TIERS.map((tier) => tier.key)).toEqual(["champion", "talent", "wild", "adventure", "feest"]);
    expect(TOURNAMENT_RANKING_BANDS).toHaveLength(11);
    expect(TOURNAMENT_RANKING_BANDS.slice(0, 5)).toEqual(TOURNAMENT_TIERS);
    TOURNAMENT_RANKING_BANDS.forEach((band, index) => {
      expect(band.minRank).toBe(index * 12 + 1);
      expect(band.maxRank).toBe(index * 12 + 12);
      expect(band.color).toMatch(/^#[0-9A-F]{6}$/);
    });
  });

  it("names every band in the reader's language", () => {
    expect(tournamentTierLabel("champion")).toBe("Champion");
    expect(tournamentTierLabel("mushroom")).toBe("Mushroom");
    expect(tournamentTierLabel("coin")).toBe("Coin");
    expect(tournamentTierLabel("new")).toBeNull();
    vi.stubGlobal("localStorage", { getItem: () => "nl", setItem: () => undefined });
    try {
      expect(tournamentTierLabel("champion")).toBe("Kampioen");
      expect(tournamentTierLabel("mushroom")).toBe("Paddenstoel");
      expect(tournamentTierLabel("coin")).toBe("Munt");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
