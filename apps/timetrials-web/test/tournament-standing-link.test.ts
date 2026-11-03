import { describe, expect, it } from "vitest";

import {
  readTournamentStandingLink,
  writeTournamentStandingLink,
  TRACK_FILTER_PARAMETERS,
} from "../src/tournament-standing-link.js";

/**
 * A reader who has set the table the way they want it wants to send that, not
 * describe it. So the address carries the view: whose record, who it is next
 * to, and how the 96-track table is sorted and filtered.
 */
describe("the Tournament Ranking, written down", () => {
  it("reads a view somebody sent", () => {
    const link = readTournamentStandingLink(
      "?ranking=tournament&player=ben&compare=evan,nova&tracks=open&sort=win&dir=asc&f_raced=>3",
    );
    expect(link.player).toBe("ben");
    expect(link.compare).toEqual(["evan", "nova"]);
    expect(link.tracksOpen).toBe(true);
    expect(link.sort).toBe("win");
    expect(link.descending).toBe(false);
    expect(link.filters).toEqual({ races: ">3" });
  });

  it("opens the table for a link that only makes sense with it open", () => {
    // Nobody types `tracks=open` by hand after typing a filter; a filter says
    // it plainly enough.
    expect(readTournamentStandingLink("?ranking=tournament&f_win=>=50").tracksOpen).toBe(true);
    expect(readTournamentStandingLink("?ranking=tournament&sort=raced").tracksOpen).toBe(true);
    expect(readTournamentStandingLink("?ranking=tournament").tracksOpen).toBe(false);
  });

  it("writes back only what was changed", () => {
    // An untouched page keeps the short address it was opened with.
    expect(writeTournamentStandingLink("?ranking=tournament", {
      player: null, compare: [], tracksOpen: false, sort: null, descending: null, filters: {},
    })).toBe("ranking=tournament");
  });

  it("survives the round trip", () => {
    const written = writeTournamentStandingLink("?ranking=tournament", {
      player: "ben",
      compare: ["evan", "nova"],
      tracksOpen: true,
      sort: "average",
      descending: true,
      filters: { races: ">3", cup: "Blad" },
    });
    const read = readTournamentStandingLink(`?${written}`);
    expect(read.player).toBe("ben");
    expect(read.compare).toEqual(["evan", "nova"]);
    expect(read.sort).toBe("average");
    expect(read.descending).toBe(true);
    expect(read.filters).toEqual({ races: ">3", cup: "Blad" });
  });

  it("refuses a name that is not a name", () => {
    // Everything in an address came from a stranger; a reference is a
    // username or a Player id and nothing else.
    const link = readTournamentStandingLink(
      "?ranking=tournament&player=%3Cscript%3E&compare=evan,%20drop%20table",
    );
    expect(link.player).toBeNull();
    expect(link.compare).toEqual(["evan"]);
  });

  it("names every column a reader can filter", () => {
    // The names are meant to be typed by hand as well as copied, so they are
    // the words on the page: raced, won, best, average, win.
    expect(TRACK_FILTER_PARAMETERS.map(([, name]) => name)).toEqual([
      "f_track", "f_cup", "f_raced", "f_won", "f_best", "f_average", "f_win",
    ]);
  });
});
