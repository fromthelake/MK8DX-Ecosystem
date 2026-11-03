import { describe, expect, it } from "vitest";

import {
  TournamentTrackRecordError,
  TournamentTrackRecordService,
  fieldShare,
  summarizeTrackRecord,
  type TournamentTrackRow,
} from "../src/tournaments/tournament-track-record-service.js";

function row(
  trackId: string | null,
  finishPosition: number,
  fieldSize = 12,
  heldAtMs = 0,
): TournamentTrackRow {
  return {
    trackId, modeCc: 150, finishPosition, fieldSize,
    racePoints: null, heldAtMs,
  };
}

describe("fieldShare", () => {
  it("puts first at nothing and last at everything", () => {
    expect(fieldShare(1, 12)).toBe(0);
    expect(fieldShare(12, 12)).toBe(1);
    expect(fieldShare(6, 11)).toBeCloseTo(0.5, 12);
  });

  it("makes a group of ten comparable with a group of twelve", () => {
    // Mid-table is mid-table whatever the roster.
    expect(fieldShare(6, 11)).toBeCloseTo(fieldShare(7, 13) ?? 0, 12);
  });

  it("declines to place anybody in a field of one", () => {
    expect(fieldShare(1, 1)).toBeNull();
  });
});

describe("summarizeTrackRecord", () => {
  it("ranks a track a player is good at above their own normal", () => {
    const record = summarizeTrackRecord("player.test", [
      row("track.baby_park", 1), row("track.baby_park", 2),
      row("track.rainbow_road", 11), row("track.rainbow_road", 12),
      row("track.mario_circuit", 6), row("track.mario_circuit", 7),
    ]);
    expect(record.tracks[0]!.trackId).toBe("track.baby_park");
    expect(record.tracks.at(-1)!.trackId).toBe("track.rainbow_road");
    expect(record.tracks[0]!.relativeToOwnAverage).toBeLessThan(0);
    expect(record.tracks.at(-1)!.relativeToOwnAverage).toBeGreaterThan(0);
  });

  it("does not reward a weaker division", () => {
    // Two players with identical shapes: one always mid-table in a group of
    // twelve, one always mid-table in a group of ten. Neither should look
    // strong or weak anywhere.
    for (const size of [10, 12]) {
      const middle = Math.ceil((size + 1) / 2);
      const record = summarizeTrackRecord("player.test", [
        row("track.a", middle, size), row("track.b", middle, size),
      ]);
      for (const track of record.tracks) {
        expect(Math.abs(track.relativeToOwnAverage)).toBeLessThan(1e-12);
      }
    }
  });

  it("counts races with no track without averaging them away", () => {
    const record = summarizeTrackRecord("player.test", [
      row("track.baby_park", 1), row(null, 12), row(null, 11),
    ]);
    expect(record.racesWithTrack).toBe(1);
    expect(record.racesWithoutTrack).toBe(2);
    // The baseline uses all three races, so the one known track is measured
    // against how this player really finishes rather than against itself.
    expect(record.overallFieldShare).toBeCloseTo((0 + 1 + 10 / 11) / 3, 12);
    expect(record.tracks[0]!.relativeToOwnAverage).toBeLessThan(-0.5);
  });

  it("reports the plain facts alongside the relative measure", () => {
    const record = summarizeTrackRecord("player.test", [
      { ...row("track.baby_park", 1), racePoints: 15 },
      { ...row("track.baby_park", 3), racePoints: 10 },
      { ...row("track.baby_park", 9, 12, 5_000), racePoints: 4 },
    ]);
    const [track] = record.tracks;
    expect(track!.races).toBe(3);
    expect(track!.wins).toBe(1);
    expect(track!.podiums).toBe(2);
    expect(track!.bestFinish).toBe(1);
    expect(track!.worstFinish).toBe(9);
    expect(track!.averageFinish).toBeCloseTo(13 / 3, 12);
    expect(track!.averagePoints).toBeCloseTo(29 / 3, 12);
    expect(track!.lastRacedAtMs).toBe(5_000);
  });

  it("breaks a tie towards the track the player has raced most", () => {
    const record = summarizeTrackRecord("player.test", [
      row("track.a", 1), row("track.a", 12),
      row("track.b", 1), row("track.b", 12), row("track.b", 1), row("track.b", 12),
    ]);
    expect(record.tracks.map((track) => track.trackId))
      .toEqual(["track.b", "track.a"]);
  });

  it("says nothing rather than something wrong when there is no history", () => {
    const record = summarizeTrackRecord("player.test", []);
    expect(record.tracks).toEqual([]);
    expect(record.overallFieldShare).toBeNull();
    expect(record.racesWithTrack).toBe(0);
  });
});

describe("TournamentTrackRecordService", () => {
  it("refuses a player id that is not well formed", async () => {
    const service = new TournamentTrackRecordService({
      listPlayerTrackRows: async () => [],
    });
    await expect(service.recordFor("../../etc/passwd"))
      .rejects.toThrow(TournamentTrackRecordError);
  });

  it("hands the repository rows straight to the summary", async () => {
    const service = new TournamentTrackRecordService({
      listPlayerTrackRows: async () => [row("track.baby_park", 1)],
    });
    const record = await service.recordFor("player.test-one");
    expect(record.tracks).toHaveLength(1);
    expect(record.playerId).toBe("player.test-one");
  });
});
