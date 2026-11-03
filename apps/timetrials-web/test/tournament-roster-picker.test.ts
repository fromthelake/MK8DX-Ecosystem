import { describe, expect, it, vi } from "vitest";

import { byClass, FakeDocument, type FakeNode } from "./dom-double.js";

import { createTournamentOperationClient, type RosterNameCandidates, type RosterPlayerCandidate } from "../src/tournament-operation-client.js";
import {
  rosterAliasesToRemember,
  rosterCandidateContext,
  rosterChoiceList,
  rosterImportSuggestion,
} from "../src/tournament-roster-picker.js";

// ADR-0218: a name is never an identity. The picker describes candidates;
// only the Director's choice links one.

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const mal: RosterPlayerCandidate = {
  playerId: "player.mal", username: "mal", displayName: "Mal", matchedBy: "display_name",
  claimed: true, inTournament: false, nights: 12, nightsWithDirector: 3,
  lastNightName: "TN13", lastNightDate: "2026-10-04", directorNames: ["Ben"],
  characterKey: "character.yoshi", characterLabel: "Yoshi",
};
const otherMal: RosterPlayerCandidate = {
  playerId: "player.mal_2", username: "mal-2", displayName: "Mal", matchedBy: "display_name",
  claimed: false, inTournament: false, nights: 2, nightsWithDirector: 0, directorNames: ["Evan"],
};

describe("roster candidate client (mk8dx.roster-player-candidates.v1)", () => {
  it("sends the names in order and parses every field the API promises", async () => {
    const calls: Array<{ url: string; body?: string }> = [];
    const fetchPort = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, ...(typeof init?.body === "string" ? { body: init.body } : {}) });
      if (url === "/v1/session/csrf") {
        return json({ schemaVersion: "mk8dx.web-csrf.v1", headerName: "x-mk8dx-csrf", value: "proof" });
      }
      return json({
        schemaVersion: "mk8dx.roster-player-candidates.v1",
        entries: [{ name: "Mal", sameNameInOwnNights: true, candidates: [mal, { ...otherMal, matchedBy: "alias", aliasText: "Malo", aliasScope: "director" }] }],
      });
    });
    const entries = await createTournamentOperationClient(fetchPort as never).rosterCandidates({
      names: [" Mal "], tournamentId: "tournament.synthetic_night", partial: true,
    });
    expect(calls[1]).toEqual({
      url: "/v1/administrator/roster-player-candidates",
      body: JSON.stringify({ names: ["Mal"], tournamentId: "tournament.synthetic_night", partial: true }),
    });
    expect(entries[0]!.candidates[0]).toEqual(mal);
    expect(entries[0]!.candidates[1]!.aliasScope).toBe("director");
  });

  it("refuses an unknown key instead of drawing half a picker", async () => {
    const fetchPort = vi.fn(async (url: string) => url === "/v1/session/csrf"
      ? json({ schemaVersion: "mk8dx.web-csrf.v1", headerName: "x-mk8dx-csrf", value: "proof" })
      : json({ schemaVersion: "mk8dx.roster-player-candidates.v1", entries: [{ name: "Mal", sameNameInOwnNights: false, candidates: [{ ...mal, rating: 3 }] }] }));
    await expect(createTournamentOperationClient(fetchPort as never).rosterCandidates({ names: ["Mal"] }))
      .rejects.toThrow();
  });

  it("asks the server to confirm a repeated name only when the Director said so", async () => {
    const bodies: string[] = [];
    const fetchPort = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/v1/session/csrf") {
        return json({ schemaVersion: "mk8dx.web-csrf.v1", headerName: "x-mk8dx-csrf", value: "proof" });
      }
      bodies.push(String(init?.body));
      return json({ schemaVersion: "mk8dx.native-roster-players.v1", created: [{ playerId: "player.mal_2", username: "mal-2", displayName: "Mal" }] }, 201);
    });
    const created = await createTournamentOperationClient(fetchPort as never).createRosterPlayers(
      [{ row: 1, displayName: "Mal", confirmSameName: true }, { row: 2, displayName: "Nova" }],
      undefined, { tournamentId: "tournament.synthetic_night" },
    );
    expect(created[0]!.username).toBe("mal-2");
    expect(JSON.parse(bodies[0]!)).toEqual({
      tournamentId: "tournament.synthetic_night",
      players: [{ row: 1, displayName: "Mal", confirmSameName: true }, { row: 2, displayName: "Nova" }],
    });
  });
});

describe("roster picker helpers", () => {
  it("tells two Mals apart in one line", () => {
    expect(rosterCandidateContext(mal)).toBe(
      "@mal · 12 nights, 3 with this Director · last: TN13 (2026-10-04) · Directors: Ben · has an account",
    );
    expect(rosterCandidateContext(otherMal)).toBe("@mal-2 · 2 nights · Directors: Evan · no account yet");
  });

  it("suggests only an unambiguous row and never a partial match", () => {
    const entry = (candidates: readonly RosterPlayerCandidate[]): RosterNameCandidates => ({ name: "Mal", sameNameInOwnNights: false, candidates });
    expect(rosterImportSuggestion(entry([]))).toEqual({ kind: "new" });
    expect(rosterImportSuggestion(entry([mal]))).toEqual({ kind: "player", playerId: "player.mal" });
    expect(rosterImportSuggestion(entry([otherMal]))).toBeNull();
    expect(rosterImportSuggestion(entry([mal, otherMal]))).toBeNull();
    expect(rosterImportSuggestion(entry([mal, { ...otherMal, inTournament: true }])))
      .toEqual({ kind: "player", playerId: "player.mal_2" });
    expect(rosterImportSuggestion(entry([{ ...mal, matchedBy: "partial" }]))).toEqual({ kind: "new" });
  });

  it("remembers a spelling only when it is not already one of the Player's names", () => {
    expect(rosterAliasesToRemember([
      { name: "Malie", candidate: { ...mal, matchedBy: "partial" } },
      { name: "MAL", candidate: mal },
      { name: "Malo", candidate: { ...otherMal, matchedBy: "alias", aliasText: "Malo", aliasScope: "installation" } },
      { name: "malie", candidate: { ...mal, matchedBy: "partial" } },
    ])).toEqual([{ playerId: "player.mal", name: "Malie" }]);
  });

  it("warns before another Mal and passes the confirmation on", () => {
    const picked: string[] = [];
    const created: boolean[] = [];
    const owner = new FakeDocument();
    const box = rosterChoiceList(owner as unknown as Document, { name: "Mal", sameNameInOwnNights: true, candidates: [mal, { ...otherMal, inTournament: true }] }, {
      blockOnNight: true,
      pickLabel: (candidate) => `Add ${candidate.username}`,
      onPick: (candidate) => picked.push(candidate.playerId),
      onCreate: (confirm) => created.push(confirm),
    }) as unknown as FakeNode;
    const buttons = box.querySelectorAll("button");
    expect(buttons.map((element) => [element.textContent, element.disabled])).toEqual([
      ["Add mal", false], ["Already on the list", true], ['Create another "Mal"', false],
    ]);
    const warning = byClass(box, "tournament-roster-choices__warning");
    expect(warning?.textContent).toContain('There is already a "Mal" in your nights');
    expect(warning?.getAttribute("role")).toBe("alert");
    expect(String((box.querySelector("img") as unknown as { src: string }).src)).toContain("yoshi");
    buttons[0]!.click();
    buttons[2]!.click();
    expect(picked).toEqual(["player.mal"]);
    expect(created).toEqual([true]);
  });
});
