// W22 Legacy published Tournament (Phase 12): behaviour, not class names. The event name is still
// text and never markup, the Player link is still exact, the segments keep their own vocabulary
// (OD-04's safe default), and a race still says whether it counted.
import { describe, expect, it } from "vitest";

import { allByClass, byClass, descendants, FakeDocument, texts } from "./dom-double.js";
import { useDocument } from "../src/ds-components.js";
import type { TournamentPublicationClient } from
  "../src/tournament-publication-client.js";
import { mountPublicTournament } from "../src/ds-public-tournament.js";

describe("public Tournament view", () => {
  it("renders published standings and races with exact public Player links", async () => {
    const client = {
      async loadPublic() {
        return {
          publicationId: "tournament_publication.synthetic_event_001",
          eventName: "<script>Synthetic Cup</script>",
          publishedAtMs: 1_900_000_000_000,
          races: [{
            raceResultId: "tournament_race_result.synthetic_race_001",
            revision: 1, raceNumber: 1, scoringSegment: 1,
            trackId: "track.mario_kart_stadium", mode: 150 as const,
            countsTowardStandings: true, resultAtMs: 1_899_999_999_000,
            placements: [{
              finishPosition: 1, playerId: "player.synthetic_racer_001",
              playerUsername: "Racer", playerDisplayName: "Synthetic Racer",
              racePoints: 15, totalAfterRace: 15, rankAfterRace: 1,
            }],
          }],
          standings: [{
            scoringSegment: 1, playerId: "player.synthetic_racer_001",
            playerUsername: "Racer", playerDisplayName: "Synthetic Racer",
            totalPoints: 15, rank: 1,
          }],
        };
      },
    } as Pick<TournamentPublicationClient, "loadPublic">;
    const document = new FakeDocument();
    useDocument(document as unknown as Document);
    const root = document.createElement("div");
    const mounted = mountPublicTournament(
      root as unknown as HTMLElement,
      "tournament_publication.synthetic_event_001",
      client as TournamentPublicationClient,
    );
    await mounted.ready;
    const nodes = descendants(root);
    expect(texts(root)).toContain("<script>Synthetic Cup</script>");
    expect(nodes.some((node) => node.tagName === "script")).toBe(false);
    // The Player link is exact and now goes through the design system's own link style.
    const player = allByClass(root, "ds-table__name-text")
      .find((node) => node.textContent === "Synthetic Racer");
    expect(player?.attributes.get("href")).toBe("/?player=player.synthetic_racer_001");
    // OD-04: the old view keeps its own "Segment N" vocabulary.
    expect(texts(root).join(" ")).toContain("Segment 1 standings");
    expect(texts(root).join(" ")).toContain("Segment 1, race 1");
    // A race says whether it counted, in words as well as in a tone.
    expect(texts(root).join(" ")).toContain("Counted");
    expect(byClass(root, "ds-published")?.className).toContain("ds-root");
    // Two tables: the segment standing and the races.
    const tables = allByClass(root, "ds-table");
    expect(tables).toHaveLength(2);
    // The phone composition keeps the track alone on line one, the verbose race label on line two,
    // and the compact engine/counting values on line three. This prevents two valid-width strings
    // from painting over one another at 320 px.
    const raceCells = allByClass(tables[1]!, "ds-table__cell");
    const placement = (key: string) => raceCells
      .find((cell) => cell.attributes.get("data-key") === key)?.attributes.get("data-phone");
    expect(placement("track")).toBe("name");
    expect(placement("race")).toBe("2");
    expect(placement("engine")).toBe("3");
    expect(placement("counted")).toBe("3");
  });
});
