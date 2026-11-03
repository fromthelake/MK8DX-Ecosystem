import { describe, expect, it } from "vitest";

import {
  formatTimeToStart, formatTournamentStart, hasStartTime,
} from "../src/tournament-start-clock.js";
import {
  orderViewerNights, tournamentIsBeingRaced, tournamentIsTonight,
} from "../src/tournament-viewer-standing.js";
import type { PublicTournamentSummary } from "../src/tournament-operation-client.js";

// 2026-09-11T18:00:00Z is Friday 11 September at 20:00 in Amsterdam.
const FRIDAY_20_00 = Date.parse("2026-09-11T18:00:00.000Z");

describe("the start of a tournament night", () => {
  it("writes the day out in the night's own time zone", () => {
    const text = formatTournamentStart(FRIDAY_20_00, "Europe/Amsterdam");
    expect(text).toBe("Friday 11 September 2026 at 20:00");
  });

  it("writes the same day in Dutch, with the owner's own 'om'", () => {
    const store = { getItem: (key: string) => (key.includes("language") ? "nl" : null) };
    const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", { value: store, configurable: true });
    try {
      expect(formatTournamentStart(FRIDAY_20_00, "Europe/Amsterdam"))
        .toBe("Vrijdag 11 september 2026 om 20:00");
    } finally {
      if (previous === undefined) {
        Reflect.deleteProperty(globalThis, "localStorage");
      } else {
        Object.defineProperty(globalThis, "localStorage", previous);
      }
    }
  });

  it("says only the day for a night saved without a time of day", () => {
    // Midnight is what a date-only tournament lands on; "at 00:00" would be an
    // agreement nobody made.
    const midnight = Date.parse("2026-09-07T22:00:00.000Z");
    expect(formatTournamentStart(midnight, "Europe/Amsterdam"))
      .toBe("Tuesday 8 September 2026");
    expect(hasStartTime(midnight, "Europe/Amsterdam")).toBe(false);
    expect(hasStartTime(FRIDAY_20_00, "Europe/Amsterdam")).toBe(true);
  });

  it("falls back to the reader's own clock when the zone is not known", () => {
    // An unknown zone must not cost the reader the date.
    expect(formatTournamentStart(FRIDAY_20_00, "Mars/Olympus")).toContain("2026");
  });

  it("counts down as a clock, with the days only when there are any", () => {
    expect(formatTimeToStart(0)).toBe("00:00:00");
    expect(formatTimeToStart(-5000)).toBe("00:00:00");
    expect(formatTimeToStart(33_000)).toBe("00:00:33");
    expect(formatTimeToStart(9 * 3_600_000 + 12 * 60_000 + 33_000)).toBe("09:12:33");
    expect(formatTimeToStart(86_400_000 + 9 * 3_600_000 + 12 * 60_000 + 33_000))
      .toBe("1d 09:12:33");
  });

});

describe("which of a reader's nights is theirs right now", () => {
  const night = (
    id: string, stage: string, updatedAtMs: number, startAtMs?: number,
  ): PublicTournamentSummary => ({
    tournamentId: id, name: id, stage, participantCount: 12, updatedAtMs,
    ...(startAtMs === undefined ? {} : { startAtMs }),
  } as unknown as PublicTournamentSummary);

  it("puts the night being raced ahead of the one last touched", () => {
    // A Director editing next Friday's roster made it the newest-touched, and
    // the night on the table tonight dropped behind it.
    const now = Date.parse("2026-09-09T09:00:00.000Z");
    const ordered = orderViewerNights([
      night("friday", "setup", 900, FRIDAY_20_00),
      night("tonight", "qualifiers", 100, Date.parse("2026-09-09T18:00:00.000Z")),
    ], now);
    expect(ordered.map((entry) => entry.tournamentId)).toEqual(["tonight", "friday"]);
  });

  it("does not count a night at Step 4 as being raced", () => {
    // The list shelf and the card have to agree: a night whose layout has been
    // made but whose scores have not started is still being prepared, so it
    // gets the countdown rather than "You tonight".
    const now = Date.parse("2026-09-09T09:00:00.000Z");
    const stepFour = { ...night("friday", "qualifiers", 900, FRIDAY_20_00), workflowStep: 4 };
    const stepFive = { ...night("tonight", "qualifiers", 100, Date.parse("2026-09-09T18:00:00.000Z")), workflowStep: 5 };
    expect(tournamentIsBeingRaced(stepFour.stage, 4)).toBe(false);
    expect(tournamentIsBeingRaced(stepFive.stage, 5)).toBe(true);
    const ordered = orderViewerNights([stepFour, stepFive], now);
    expect(ordered.map((entry) => entry.tournamentId)).toEqual(["tonight", "friday"]);
  });

  it("does not let a night left half-scored stand in front of the next one", () => {
    // Toernooi10_Simulatie: Step 5, never finished, a day and a half old. It
    // is not tonight, and it must not hide the night that is actually coming.
    const now = Date.parse("2026-09-09T12:00:00.000Z");
    const abandoned = {
      ...night("stale", "qualifiers", 900, Date.parse("2026-09-07T22:00:00.000Z")),
      workflowStep: 5,
    };
    const friday = { ...night("friday", "setup", 100, FRIDAY_20_00), workflowStep: 2 };
    const ordered = orderViewerNights([abandoned, friday], now);
    expect(ordered.map((entry) => entry.tournamentId)).toEqual(["friday", "stale"]);
    // An evening that runs past midnight is still tonight's, though.
    const lastNight = {
      ...night("running", "qualifiers", 50, Date.parse("2026-09-09T02:00:00.000Z")),
      workflowStep: 5,
    };
    expect(orderViewerNights([friday, lastNight], now).map((entry) => entry.tournamentId))
      .toEqual(["running", "friday"]);
  });

  it("keeps the night for a day after it starts, and lets it go after that", () => {
    // The evening runs past midnight; at half past one the same card is the
    // one wanted. A week later it is not.
    const night_ = { stage: "setup" as const, workflowStep: 2, startAtMs: FRIDAY_20_00 };
    expect(tournamentIsTonight(night_, FRIDAY_20_00 - 3_600_000)).toBe(false);
    expect(tournamentIsTonight(night_, FRIDAY_20_00 + 1000)).toBe(true);
    // 01:30, five and a half hours in.
    expect(tournamentIsTonight(night_, FRIDAY_20_00 + 5.5 * 3_600_000)).toBe(true);
    // Just inside a day, and just outside it.
    expect(tournamentIsTonight(night_, FRIDAY_20_00 + 86_399_000)).toBe(true);
    expect(tournamentIsTonight(night_, FRIDAY_20_00 + 86_401_000)).toBe(false);
  });

  it("puts the nearest night still to come ahead of a later one", () => {
    const now = Date.parse("2026-09-09T09:00:00.000Z");
    const ordered = orderViewerNights([
      night("later", "setup", 900, Date.parse("2026-09-25T18:00:00.000Z")),
      night("friday", "setup", 100, FRIDAY_20_00),
    ], now);
    expect(ordered.map((entry) => entry.tournamentId)).toEqual(["friday", "later"]);
  });

  it("holds the night for a day after it started, then hands over", () => {
    const now = Date.parse("2026-09-09T09:00:00.000Z");
    // Started fifteen hours ago: still the night on the card, even though the
    // calendar has turned over. Whoever opens the page in the morning after
    // gets the same tile they had at eight.
    const lastEvening = night("yesterday", "setup", 900, Date.parse("2026-09-08T18:00:00.000Z"));
    const friday = night("friday", "setup", 100, FRIDAY_20_00);
    expect(orderViewerNights([lastEvening, friday], now).map((entry) => entry.tournamentId))
      .toEqual(["yesterday", "friday"]);
    // Thirty hours ago: it has had its day, and the night to come takes over.
    const older = night("older", "setup", 900, Date.parse("2026-09-08T03:00:00.000Z"));
    expect(orderViewerNights([older, friday], now).map((entry) => entry.tournamentId))
      .toEqual(["friday", "older"]);
  });
});
