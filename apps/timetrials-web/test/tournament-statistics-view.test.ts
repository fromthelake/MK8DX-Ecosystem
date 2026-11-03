import { describe, expect, it, vi } from "vitest";

import {
  createTournamentStatisticsClient,
  parseTournamentStatistics,
} from "../src/tournament-statistics-client.js";
import {
  buildStatisticsRows,
  cupTotals,
  formatHours,
  formatLap,
  formatSpan,
  nintendoGhostMs,
  sortStatisticsRows,
  statisticsRowMatches,
} from "../src/tournament-statistics-view.js";

const answer = {
  schemaVersion: "mk8dx.public-tournament-statistics.v1",
  editions: [
    { editionNumber: 4, eventDate: "2023-05-19", heldAtMs: 1_684_000_000_000, participantCount: 16, races: 46, cumulativePlayers: 16 },
    { editionNumber: 12, eventDate: "2026-03-27", heldAtMs: 1_774_000_000_000, participantCount: 35, races: 132, cumulativePlayers: 61 },
  ],
  tracks: [
    { trackId: "track.mario_kart_stadium", races: 12, placements: 140, nights: 7, firstEdition: 4, lastEdition: 12, bestPlayerId: "player.ben", bestPlayerName: "Ben", bestScore: 21.5 },
    { trackId: "track.baby_park", races: 4, placements: 48, nights: 2, firstEdition: 6, lastEdition: 7, bestPlayerId: null, bestPlayerName: null, bestScore: null },
  ],
  totals: {
    editions: 2, races: 178, racesWithTrack: 16, placements: 188, players: 61, tracksRaced: 2,
  },
};

describe("what the community has raced", () => {
  it("reads the server's answer and refuses anything else", () => {
    const parsed = parseTournamentStatistics(answer);
    expect(parsed.totals.races).toBe(178);
    expect(parsed.tracks[0]!.placements).toBe(140);
    expect(() => parseTournamentStatistics({ ...answer, schemaVersion: "other" })).toThrow();
    expect(() => parseTournamentStatistics({
      ...answer,
      tracks: [{ ...answer.tracks[0]!, mysteryColumn: 1 }],
    })).toThrow();
  });

  it("asks the public endpoint once", async () => {
    const fetchPort = vi.fn(async () => new Response(JSON.stringify(answer), {
      status: 200, headers: { "Content-Type": "application/json" },
    }));
    const client = createTournamentStatisticsClient(fetchPort);
    await expect(client.load()).resolves.toMatchObject({ totals: { players: 61 } });
    expect(fetchPort).toHaveBeenCalledTimes(1);
    const [path] = (fetchPort.mock.calls as unknown as readonly [string][])[0]!;
    expect(path).toBe("/v1/public/tournament-statistics");
  });

  it("turns drivers into time with Nintendo's own ghost", () => {
    // Nobody recorded how long a race took. Nintendo's 150cc ghost on that
    // track is how long one lap of it takes, and a race is one lap *per
    // driver*: 140 drivers over twelve races is 140 of those ghosts, not 12.
    const ghost = nintendoGhostMs("track.mario_kart_stadium");
    expect(ghost).not.toBeNull();
    const rows = buildStatisticsRows(parseTournamentStatistics(answer));
    const stadium = rows.find((row) => row.trackId === "track.mario_kart_stadium")!;
    expect(stadium.timeMs).toBe((ghost ?? 0) * 140);
    expect(stadium.name).toBe("Mario Kart Stadium");
    expect(stadium.players).toBe(140);
    // Seven of the nine nights, counted - not the nine it spans.
    expect(stadium.nights).toBe(7);
  });

  it("sorts and filters every column the reader can", () => {
    const rows = buildStatisticsRows(parseTournamentStatistics(answer));
    expect(sortStatisticsRows(rows, "races", true).map((row) => row.trackId))
      .toEqual(["track.mario_kart_stadium", "track.baby_park"]);
    expect(sortStatisticsRows(rows, "races", false).map((row) => row.trackId))
      .toEqual(["track.baby_park", "track.mario_kart_stadium"]);
    // Sorting on the track sorts on its id, which keeps a console together.
    expect(sortStatisticsRows(rows, "track", false).map((row) => row.trackId))
      .toEqual(["track.baby_park", "track.mario_kart_stadium"]);
    expect(rows.filter((row) => statisticsRowMatches(row, { races: ">5" })).map((row) => row.trackId))
      .toEqual(["track.mario_kart_stadium"]);
    expect(rows.filter((row) => statisticsRowMatches(row, { track: "baby" })).map((row) => row.trackId))
      .toEqual(["track.baby_park"]);
    // A filter nobody can read filters nothing in rather than everything out.
    expect(rows.filter((row) => statisticsRowMatches(row, { races: "veel" }))).toEqual([]);
  });

  it("adds the cups up, most raced first", () => {
    const rows = buildStatisticsRows(parseTournamentStatistics(answer));
    const cups = cupTotals(rows);
    expect(cups[0]!.races).toBeGreaterThanOrEqual(cups[cups.length - 1]!.races);
    expect(cups.reduce((sum, cup) => sum + cup.races, 0)).toBe(16);
    // And what those cups took: every driver that raced them.
    expect(cups.reduce((sum, cup) => sum + cup.drivers, 0)).toBe(188);
  });

  it("writes a duration as a duration and a lap as a lap", () => {
    expect(formatHours(90 * 60_000)).toBe("1h 30m");
    expect(formatHours(20 * 60_000)).toBe("20 min");
    expect(formatLap(112_318)).toBe("1:52.318");
  });

  it("writes a total that has run past a day in days", () => {
    // 337 hours is a fortnight of racing; nobody reads that as hours.
    expect(formatSpan(337 * 3_600_000 + 52 * 60_000)).toBe("14d 1h 52m");
    expect(formatSpan(90 * 60_000)).toBe("1h 30m");
  });

  it("names the Player who owns a track", () => {
    const rows = buildStatisticsRows(parseTournamentStatistics(answer));
    const stadium = rows.find((row) => row.trackId === "track.mario_kart_stadium")!;
    expect(stadium.bestPlayerName).toBe("Ben");
    expect(stadium.bestScore).toBe(21.5);
    // A track nobody leads says so rather than inventing a name.
    expect(rows.find((row) => row.trackId === "track.baby_park")!.bestPlayerName).toBeNull();
  });
});
