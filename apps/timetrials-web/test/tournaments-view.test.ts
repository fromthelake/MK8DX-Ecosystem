import { describe, expect, it, vi } from "vitest";

import {
  createTournamentOperationClient,
  type PublicTournamentEvent,
} from "../src/tournament-operation-client.js";
import {
  publicTournamentCheckpoints,
  publicTournamentCurrentCheckpoint,
  tournamentListShelf,
} from "../src/tournaments-view.js";
import {
  moveTournamentPlayer,
  hasCompleteTournamentStageScores,
  seatingCsv,
  seatingText,
  standingsCsv,
  standingsText,
  tournamentAnalytics,
  tournamentParkingPlayers,
  tournamentGroupBoardStats,
  tournamentGroupLayoutCsv,
  tournamentDetachMessage,
  tournamentRollbackMessage,
  tournamentRosterCsv,
  tournamentRosterGateMetrics,
  tournamentRosterRejectionMessage,
  tournamentRosterUsernameFor,
  tournamentExportCheckpoints,
  tournamentFinalLayoutAudit,
  isWorkbookTrackPlaceholder,
  tournamentWorkbookTrackId,
  utpCablePlan,
} from "../src/tournament-operation-view.js";
import type { TournamentDocument } from "../src/tournament-operation-client.js";
import { setProductLanguage } from "../src/product-language.js";

const event: PublicTournamentEvent = {
  tournamentId: "tournament.synthetic_event_0001",
  name: "Friday night",
  editionNumber: 13,
  eventDate: "2026-08-22",
  stage: "finalized",
  finalizedAtMs: 1_900_000_000_000,
  publicResults: true,
  participantCount: 3,
  groups: [{
    groupId: "tournament_group.synthetic_group_0001",
    stage: "final", sequence: 1, name: "Kampioen", tierKey: "champion",
    seating: [],
    standings: [
      { rank: 1, playerId: "player.synthetic_alpha", displayName: "Alpha", points: 25, races: 2, wins: 2, complete: true },
      { rank: 2, displayName: "Private Bravo", points: 20, races: 2, wins: 0, complete: true },
    ],
    races: [{
      raceNumber: 1, trackId: "track.mario_kart_stadium", mode: 150, countsTowardStandings: true,
      placements: [
        { finishPosition: 1, playerId: "player.synthetic_alpha", displayName: "Alpha", racePoints: 15 },
        { finishPosition: 2, displayName: "Private Bravo", racePoints: 12 },
      ],
    }],
  }],
  overall: [
    { placement: 1, playerId: "player.synthetic_alpha", displayName: "Alpha", groupName: "Kampioen", groupRank: 1, points: 25 },
    { placement: 2, displayName: "Private Bravo", groupName: "Kampioen", groupRank: 2, points: 20 },
  ],
};

describe("what a night is", () => {
  it("offers a results picture only once a race has been driven", () => {
    const unraced = {
      ...event,
      groups: [{
        ...event.groups[0]!,
        seating: [{ displayName: "Alpha", seatOrder: 0, stationOwnerDisplayName: "Ben", switchType: "ns1", seatNumber: 1 }],
        standings: event.groups[0]!.standings.map((row) => ({ ...row, races: 0, points: 0, wins: 0 })),
        races: [],
      }],
    } as unknown as typeof event;
    // A standing row exists as soon as somebody is placed; that is not a result.
    // The fixture's group is a final group, so only its layout is on offer.
    expect(publicTournamentCheckpoints(unraced).map((entry) => entry.key)).toEqual(["final-layout"]);
    expect(publicTournamentCheckpoints(event).map((entry) => entry.key)).toContain("final-results");
  });

  it("opens on the last picture that is actually complete", () => {
    // Two groups, one raced. The results drawing would be a column of noughts
    // beside a real standing, which reads as a finished qualifier.
    const half = {
      ...event,
      groups: [
        {
          ...event.groups[0]!, groupId: "tournament_group.q1", stage: "qualifier", sequence: 1, name: "Groep 1",
          seating: [{ displayName: "Alpha", seatOrder: 0, stationOwnerDisplayName: "Ben", switchType: "ns1", seatNumber: 1 }],
          standings: [{ rank: 1, displayName: "Alpha", points: 0, races: 0, wins: 0, complete: false }],
          races: [],
        },
        {
          ...event.groups[0]!, groupId: "tournament_group.q2", stage: "qualifier", sequence: 2, name: "Groep 2",
          seating: [{ displayName: "Bravo", seatOrder: 0, stationOwnerDisplayName: "Evan", switchType: "ns1", seatNumber: 1 }],
          standings: [{ rank: 1, displayName: "Bravo", points: 15, races: 1, wins: 1, complete: false }],
        },
      ],
    } as unknown as typeof event;
    expect(publicTournamentCheckpoints(half).map((entry) => entry.key))
      .toEqual(["qualifier-layout", "qualifier-results"]);
    // Both groups are seated, only one has raced: the layout is what is done.
    expect(publicTournamentCurrentCheckpoint(half)?.key).toBe("qualifier-layout");
  });
});

describe("step 2 roster helpers (APK parity)", () => {
  const participant = (attendance: "present" | "waiting" | "absent", switches = 0) => ({
    playerId: `player.synthetic_${Math.random().toString(36).slice(2, 10)}`,
    username: "synthetic", displayName: "Synthetic",
    attendance, hasSwitch1: switches >= 1, hasSwitch2: switches >= 2,
  });
  const documentWith = (participants: unknown[], maxParticipants?: number) => ({
    summary: { maxParticipants } ,
    participants,
  }) as never;

  it("computes the APK readiness gate with the Dutch three-line reasons", () => {
    const previousStorage = globalThis.localStorage;
    vi.stubGlobal("localStorage", { getItem: () => "nl", setItem: () => undefined });
    setProductLanguage("nl");
    const empty = tournamentRosterGateMetrics(documentWith([participant("absent")]));
    expect(empty.isReady).toBe(false);
    expect(empty.seedButtonMode).toBe("disabled");
    expect(empty.readinessReason).toBe("Nog niet klaar: markeer minimaal 1 deelnemer als Aanwezig.");

    const shortOnConsoles = tournamentRosterGateMetrics(documentWith([
      participant("present", 1), participant("present"), participant("present"),
    ]));
    expect(shortOnConsoles.minConsoles).toBe(2);
    expect(shortOnConsoles.isReady).toBe(false);
    expect(shortOnConsoles.readinessReason).toBe(
      "Huidige status: 3 Aanwezige Deelnemers, 1 Nintendo Switches.\n" +
      "Benodigd: 2 Nintendo Switches (3/2, afgerond naar boven).\n" +
      "Oplossing 1: Voeg 1 Nintendo Switches toe (1 -> 2).\n" +
      "Oplossing 2: Verlaag Aanwezig met 1 Deelnemers (3 -> 2, want 1x2 = 2 max).",
    );

    const overLimit = tournamentRosterGateMetrics(documentWith([
      participant("present", 2), participant("present"), participant("present"),
    ], 2));
    expect(overLimit.isReady).toBe(false);
    expect(overLimit.readinessReason).toContain("limiet 2");
    expect(overLimit.readinessReason).toContain("Oplossing 2: Verhoog (of leeg) Max aantal plaatsen");
    vi.stubGlobal("localStorage", previousStorage);

    const ready = tournamentRosterGateMetrics(documentWith([
      participant("present", 2), participant("present"), participant("waiting"),
    ]));
    expect(ready.isReady).toBe(true);
    expect(ready.seedButtonMode).toBe("active");
    expect(ready.readinessReason).toBe("");
  });

  it("derives the ADR-0151 username preview exactly as the APK does", () => {
    expect(tournamentRosterUsernameFor("Wilbur Nieuw")).toBe("wilbur_nieuw");
    expect(tournamentRosterUsernameFor("Évan   van Δ Lake")).toBe("evan_van_lake");
    expect(tournamentRosterUsernameFor("Jan-Piet")).toBe("jan_piet");
    expect(tournamentRosterUsernameFor("Een Hele Erg Lange Naam Hier")).toBe("een_hele_erg_lan");
    expect(tournamentRosterUsernameFor("!!")).toBeNull();
    expect(tournamentRosterUsernameFor("ab")).toBeNull();
  });

  it("renders the Dutch rejection message per offending row", () => {
    expect(tournamentRosterRejectionMessage([
      { row: 4, displayName: "Jan Piet", reason: "duplicate_display_name_in_file" },
    ])).toBe('Er is niets geïmporteerd. regel 4 "Jan Piet": naam staat dubbel in het bestand.');
    expect(tournamentRosterRejectionMessage([])).toBe("De import is afgewezen.");
  });

  it("writes the source Manager Step 2 CSV shape, with the byte-order mark Excel wants", () => {
    const previousStorage = globalThis.localStorage;
    vi.stubGlobal("localStorage", { getItem: () => "nl", setItem: () => undefined });
    setProductLanguage("nl");
    const csv = tournamentRosterCsv([
      { playerId: "player.b", username: "b", displayName: "Ben; de Snelle", attendance: "present", hasSwitch1: true, hasSwitch2: false },
      { playerId: "player.a", username: "a", displayName: "Anna", attendance: "absent", hasSwitch1: false, hasSwitch2: false },
    ] as never);
    expect(csv).toBe(
      "\ufeffNaam;Status;NS1;NS2\r\n" +
      "Anna;Afwezig;nee;nee\r\n" +
      '"Ben; de Snelle";Aanwezig;ja;nee\r\n',
    );
    vi.stubGlobal("localStorage", previousStorage);
    setProductLanguage("en");
  });
});

describe("step 3 group board helpers (APK parity)", () => {
  const station = (owner: string, type: "ns1" | "ns2", seat: 1 | 2) => ({
    ownerPlayerId: `player.${owner.toLowerCase()}`, ownerDisplayName: owner, switchType: type, seatNumber: seat,
  });
  const group = {
    groupId: "tournament_group.synthetic_board_01", stage: "qualifier", sequence: 1,
    name: "Groep 1", locked: false, manualScoreSegments: 1,
    stations: [],
    members: [
      { playerId: "player.ben", displayName: "Ben", seatOrder: 1, station: station("Ben", "ns1", 1) },
      { playerId: "player.evan", displayName: "Evan", seatOrder: 2, station: station("Ben", "ns1", 2) },
      { playerId: "player.nova", displayName: "Nova", seatOrder: 3 },
    ],
    races: [], manualScores: [], standings: { source: "none", rows: [] },
  } as never;
  const participants = [
    { playerId: "player.ben", username: "ben", displayName: "Ben", attendance: "present", hasSwitch1: true, hasSwitch2: false, seedScore: 28 },
    { playerId: "player.evan", username: "evan", displayName: "Evan", attendance: "present", hasSwitch1: false, hasSwitch2: false, seedScore: 20 },
    { playerId: "player.nova", username: "nova", displayName: "Nova", attendance: "present", hasSwitch1: false, hasSwitch2: false, seedScore: 24 },
  ] as never;

  it("computes the APK board stats: seats per Switch, unplaced and SP spread", () => {
    const stats = tournamentGroupBoardStats(group, participants);
    expect(stats).toEqual({
      switchesAssigned: 1, seatedCount: 2, seatCapacity: 2, memberCount: 3,
      unseatedCount: 1, averageSkill: 24, spreadPlus: 4, spreadMinus: 4,
    });
  });

  it("writes the source layout CSV that the import reads back", () => {
    const previousStorage = globalThis.localStorage;
    vi.stubGlobal("localStorage", { getItem: () => "nl", setItem: () => undefined });
    setProductLanguage("nl");
    expect(tournamentGroupLayoutCsv([group])).toBe(
      "\ufeffSwitcheigenaar;Console;Deelnemer 1;Deelnemer 2;Groep\r\n" +
      "Ben;NS1;Ben;Evan;Groep 1\r\n" +
      ";;Nova;;Groep 1\r\n",
    );
    // An English visitor's spreadsheet splits on the comma; the same reader
    // takes both, so the file only has to open without a wizard.
    vi.stubGlobal("localStorage", { getItem: () => "en", setItem: () => undefined });
    setProductLanguage("en");
    expect(tournamentGroupLayoutCsv([group]).split("\r\n")[0]).toBe("\ufeffSwitcheigenaar,Console,Deelnemer 1,Deelnemer 2,Groep");
    vi.stubGlobal("localStorage", previousStorage);
    setProductLanguage("en");
  });

  it("names exactly what each rollback destroys", () => {
    const previousStorage = globalThis.localStorage;
    vi.stubGlobal("localStorage", { getItem: () => "nl", setItem: () => undefined });
    setProductLanguage("nl");
    expect(tournamentRollbackMessage(2)).toContain("Kwalificatiegroepen en alle vervolgdata worden verwijderd");
    expect(tournamentRollbackMessage(3)).toBe("Terug naar Stap 3? De kwalificatie-indeling wordt heropend.");
    expect(tournamentDetachMessage(3, { groups: 3, races: 36, manualScores: 0 })).toBe(
      "Terug naar Stap 3 en 36 geaccepteerde race(s) en 0 handmatige score(s) van 3 groep(en) loskoppelen? De groepen, zitplaatsen en Switch-eigenaren blijven staan; de losgekoppelde scores moeten opnieuw worden ingevoerd of geïmporteerd voordat je verder kunt.",
    );
    expect(tournamentRollbackMessage(6)).toContain("Eindgroepen en eindgroepplaatsing worden verwijderd");
    expect(tournamentRollbackMessage(11)).toContain("Weet je zeker dat je terug wilt naar Stap 11?");
    vi.stubGlobal("localStorage", previousStorage);
  });
});

describe("tournament operation client", () => {
  it("fetches public events same-origin without credentials leakage and parses closed", async () => {
    const calls: [string, RequestInit][] = [];
    const fetchPort = vi.fn(async (input: string, init: RequestInit) => {
      calls.push([input, init]);
      return new Response(JSON.stringify({ schemaVersion: "mk8dx.public-tournament-events.v1", tournaments: [
        { tournamentId: "tournament.synthetic_event_0001", name: "Night", stage: "finalized", participantCount: 4, updatedAtMs: 5 },
      ] }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const client = createTournamentOperationClient(fetchPort);
    const events = await client.listPublic();
    expect(events).toHaveLength(1);
    expect(calls[0]![0]).toBe("/v1/public/tournament-events");
    expect(calls[0]![1].credentials).toBe("same-origin");
    expect(calls[0]![1].cache).toBe("no-store");
    const unknownField = vi.fn(async () => new Response(JSON.stringify({ schemaVersion: "mk8dx.public-tournament-events.v1", tournaments: [
      { tournamentId: "tournament.synthetic_event_0001", name: "Night", stage: "finalized", participantCount: 4, updatedAtMs: 5, surprise: 1 },
    ] }), { status: 200, headers: { "content-type": "application/json" } }));
    await expect(createTournamentOperationClient(unknownField).listPublic()).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("loads archive placements for several nights in one compact request", async () => {
    const fetchPort = vi.fn(async (_input: string) => new Response(JSON.stringify({
      schemaVersion: "mk8dx.public-tournament-placements.v1",
      tournaments: [{
        tournamentId: "tournament.synthetic_event_0001",
        fieldSize: 24,
        placements: [{ playerId: "player.ben", placement: 3 }],
      }],
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const client = createTournamentOperationClient(fetchPort);
    await expect(client.loadPublicPlacements!([
      "tournament.synthetic_event_0001", "tournament.synthetic_event_0002",
    ])).resolves.toEqual([{
      tournamentId: "tournament.synthetic_event_0001",
      fieldSize: 24,
      placements: [{ playerId: "player.ben", placement: 3 }],
    }]);
    expect(fetchPort).toHaveBeenCalledTimes(1);
    expect(fetchPort.mock.calls[0]![0]).toBe(
      "/v1/public/tournament-placements?ids=tournament.synthetic_event_0001,tournament.synthetic_event_0002",
    );
  });

  it("reads the points a late-started recording carries into its first race", async () => {
    const fetchPort = vi.fn(async (input: string) => {
      if (input === "/v1/session/csrf") {
        return new Response(JSON.stringify({ schemaVersion: "mk8dx.web-csrf.v1", headerName: "X-MK8DX-CSRF", value: "proof-1" }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ schemaVersion: "mk8dx.score-workbook-preview.v1", videos: [{
        videoName: "TN09_kwalificatie_groep-2",
        rows: [{ playerName: "Gideon", totalPoints: 57, pointSegments: [] }],
        races: [{ raceNumber: 1, trackName: "GCN DK Mountain", finishOrder: ["Gideon", "Dagmar"] }],
        carriedPoints: [{ playerName: "Gideon", points: 30 }],
      }] }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const client = createTournamentOperationClient(fetchPort);
    const preview = await client.previewScoreWorkbook("tournament.synthetic_event_0001", "eA==");
    expect(preview[0]?.carriedPoints).toEqual([{ playerName: "Gideon", points: 30 }]);
  });

  it("fetches a fresh CSRF proof before every write and validates input first", async () => {
    const seen: string[] = [];
    const fetchPort = vi.fn(async (input: string, init: RequestInit) => {
      seen.push(`${init.method ?? "GET"} ${input}`);
      if (input === "/v1/session/csrf") {
        return new Response(JSON.stringify({ schemaVersion: "mk8dx.web-csrf.v1", headerName: "X-MK8DX-CSRF", value: "proof-1" }), { status: 200, headers: { "content-type": "application/json" } });
      }
      expect((init.headers as Record<string, string>)["X-MK8DX-CSRF"]).toBe("proof-1");
      return new Response(JSON.stringify({
        tournamentId: "tournament.synthetic_event_0001", name: "Night", stage: "setup", workflowStep: 2, qualifierRounds: true, revision: 1,
        participantCount: 0, presentCount: 0, publicResults: true, affectsRating: true, updatedAtMs: 1,
        seedingSource: "community_rating", verifiedOnly: false,
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const client = createTournamentOperationClient(fetchPort);
    const created = await client.create({ name: "Night", editionNumber: 13 });
    expect(created.stage).toBe("setup");
    expect(seen).toEqual(["GET /v1/session/csrf", "POST /v1/tournaments"]);
    expect(() => client.previewScoreWorkbook("tournament.synthetic_event_0001", ""))
      .toThrow(expect.objectContaining({ code: "invalid_input" }));
    expect(seen).toHaveLength(2);
  });

  it("serves Step 0 directors closed and threads the acting director into list and create", async () => {
    const seen: string[] = [];
    const directorsBody = {
      schemaVersion: "mk8dx.administrator-tournament-directors.v1",
      canActForOthers: true,
      directors: [
        { userAccountId: "user_account.synthetic_admin", displayName: "Ben", isAdministrator: true },
        { userAccountId: "user_account.synthetic_director", displayName: "Evan", isAdministrator: false },
      ],
    };
    const fetchPort = vi.fn(async (input: string, init: RequestInit) => {
      seen.push(`${init.method ?? "GET"} ${input}`);
      if (input === "/v1/session/csrf") {
        return new Response(JSON.stringify({ schemaVersion: "mk8dx.web-csrf.v1", headerName: "X-MK8DX-CSRF", value: "p" }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (input.startsWith("/v1/administrator/tournament-directors")) {
        return new Response(JSON.stringify(directorsBody), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (input.startsWith("/v1/administrator/tournaments")) {
        return new Response(JSON.stringify({ schemaVersion: "mk8dx.administrator-tournaments.v1", tournaments: [] }), { status: 200, headers: { "content-type": "application/json" } });
      }
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      expect(body["directorUserAccountId"]).toBe("user_account.synthetic_director");
      return new Response(JSON.stringify({
        tournamentId: "tournament.synthetic_event_0001", name: "Night", stage: "setup", workflowStep: 2, qualifierRounds: true, revision: 1,
        participantCount: 0, presentCount: 0, publicResults: true, affectsRating: true, updatedAtMs: 1,
        seedingSource: "community_rating", verifiedOnly: false,
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const client = createTournamentOperationClient(fetchPort);
    const listed = await client.listDirectors();
    expect(listed.canActForOthers).toBe(true);
    expect(listed.directors.map((entry) => entry.displayName)).toEqual(["Ben", "Evan"]);
    await client.listForAdministrator({ directorUserAccountId: "user_account.synthetic_director" });
    expect(seen).toContain("GET /v1/administrator/tournaments?director=user_account.synthetic_director");
    await client.listForAdministrator();
    expect(seen).toContain("GET /v1/administrator/tournaments");
    await client.create({ name: "Night", directorUserAccountId: "user_account.synthetic_director" });
    expect(() => client.listForAdministrator({ directorUserAccountId: "player.not_an_account" }))
      .toThrow(expect.objectContaining({ code: "invalid_input" }));
    const unknownKey = vi.fn(async () => new Response(JSON.stringify({
      ...directorsBody,
      directors: [{ ...directorsBody.directors[0], surprise: 1 }],
    }), { status: 200, headers: { "content-type": "application/json" } }));
    await expect(createTournamentOperationClient(unknownKey).listDirectors())
      .rejects.toMatchObject({ code: "invalid_response" });
  });

  it("maps conflict responses with their server message", async () => {
    const fetchPort = vi.fn(async (input: string) => input === "/v1/session/csrf"
      ? new Response(JSON.stringify({ schemaVersion: "mk8dx.web-csrf.v1", headerName: "X-MK8DX-CSRF", value: "p" }), { status: 200, headers: { "content-type": "application/json" } })
      : new Response(JSON.stringify({ code: "tournament_operation_conflict", message: "the tournament changed; reload and retry" }), { status: 409, headers: { "content-type": "application/json" } }));
    const client = createTournamentOperationClient(fetchPort);
    await expect(client.lockGroups("tournament.synthetic_event_0001", { expectedRevision: 1, stage: "qualifier", locked: true }))
      .rejects.toMatchObject({ code: "conflict", detail: "the tournament changed; reload and retry" });
  });
});

describe("operation exports", () => {
  const document: TournamentDocument = {
    summary: { tournamentId: "tournament.synthetic_event_0001", name: "Night", stage: "finals", workflowStep: 9, qualifierRounds: true, revision: 9, participantCount: 3, presentCount: 3, publicResults: true, affectsRating: true, updatedAtMs: 1, seedingSource: "community_rating", verifiedOnly: false },
    participants: [],
    stations: [],
    groups: [{
      groupId: "tournament_group.synthetic_group_0001", stage: "qualifier", sequence: 1, name: "Groep 1", locked: true, manualScoreSegments: 1,
      stations: [],
      members: [
        { playerId: "player.a", displayName: "Alpha", seatOrder: 1, station: { ownerPlayerId: "player.a", ownerDisplayName: "Alpha", switchType: "ns1", seatNumber: 1 } },
        { playerId: "player.b", displayName: "Bravo", seatOrder: 2, station: { ownerPlayerId: "player.a", ownerDisplayName: "Alpha", switchType: "ns1", seatNumber: 2 } },
        { playerId: "player.c", displayName: "Charlie", seatOrder: 3 },
      ],
      races: [{
        raceNumber: 1, raceResultId: "tournament_race_result.synthetic_export_0001", revision: 1,
        scoringSegment: 1, sourceKind: "tournament_live",
        trackId: "track.mario_kart_stadium", countsTowardStandings: true,
        placements: [
          { finishPosition: 1, playerId: "player.a", displayName: "Alpha", racePoints: 15 },
          { finishPosition: 2, playerId: "player.b", displayName: "Bravo", racePoints: 12 },
        ],
      }], manualScores: [],
      standings: { source: "races", rows: [
        { rank: 1, playerId: "player.a", displayName: "Alpha", points: 30, races: 2, wins: 2, bestRace: 15, complete: true },
        { rank: 2, playerId: "player.b", displayName: "Bravo", points: 24, races: 2, wins: 0, bestRace: 12, complete: true },
      ] },
    }],
    overall: [],
    lifecycle: [],
  };
  // The exports are the source Manager's again, line for line: the group title
  // it uses, its seat line with the NS marker and the owner prefix stripped,
  // and its scores with the trailing zeros trimmed.
  it("produces the source Manager's seating text", () => {
    const text = seatingText(document, "qualifier");
    expect(text).toContain("Kwalificatiegroep 1");
    expect(text).toContain("— [NS1] Nintendo Switch van Alpha: #1 Alpha & #2 Bravo");
  });
  it("produces standings text and a CSV in the visitor's own delimiter", () => {
    const previousStorage = globalThis.localStorage;
    vi.stubGlobal("localStorage", { getItem: () => "nl", setItem: () => undefined });
    setProductLanguage("nl");
    expect(standingsText(document)).toContain("Uitslag:");
    expect(standingsText(document)).toContain("#1 Alpha (30 pt)");
    expect(standingsText(document)).toContain("#2 Bravo (24 pt)");
    expect(standingsCsv(document).split("\r\n")[1]).toBe("qualifier;Groep 1;1;Alpha;30;2;2");
    expect(seatingCsv(document, "qualifier").split("\r\n").slice(0, 4)).toEqual([
      "\ufeffFase;Groep;Switcheigenaar;Console;Stoel;Speler",
      "qualifier;Groep 1;Alpha;NS1;1;Alpha",
      "qualifier;Groep 1;Alpha;NS1;2;Bravo",
      "qualifier;Groep 1;;;;Charlie",
    ]);
    vi.stubGlobal("localStorage", previousStorage);
    setProductLanguage("en");
    expect(standingsCsv(document).split("\r\n")[1]).toBe("qualifier,Groep 1,1,Alpha,30,2,2");
  });
  it("knows a track by its European name, the one the Manager writes", () => {
    // The catalog shows the American name while its identifier keeps the
    // European one; the Manager's workbook writes European.
    expect(tournamentWorkbookTrackId("Toad Harbour")).toBe("track.toad_harbour");
    expect(tournamentWorkbookTrackId("3DS Piranha Plant Pipeway")).toBe("track.3ds_piranha_plant_pipeway");
    expect(tournamentWorkbookTrackId("3DS Koopa City")).toBe("track.3ds_koopa_city");
    expect(tournamentWorkbookTrackId("Wii DK's Snowboard Cross")).toBe("track.wii_dk_summit");
    // And still by the name it shows.
    expect(tournamentWorkbookTrackId("Toad Harbor")).toBe("track.toad_harbour");
    expect(tournamentWorkbookTrackId("Wii DK Summit")).toBe("track.wii_dk_summit");
    expect(tournamentWorkbookTrackId("Not A Track At All")).toBeNull();
  });

  it("treats the extractor's track placeholder as not filled in, never as a track", () => {
    expect(isWorkbookTrackPlaceholder("UNKNOWN")).toBe(true);
    expect(isWorkbookTrackPlaceholder(" unknown ")).toBe(true);
    expect(isWorkbookTrackPlaceholder("")).toBe(true);
    expect(isWorkbookTrackPlaceholder("Toad Harbour")).toBe(false);
    expect(tournamentWorkbookTrackId("UNKNOWN")).toBeNull();
  });

  it("keeps the source export history cumulative and accepts bounded track spelling drift", () => {
    expect(tournamentExportCheckpoints(4).map((entry) => entry.key)).toEqual(["qualifier-layout"]);
    expect(tournamentExportCheckpoints(10).map((entry) => entry.key)).toEqual([
      "qualifier-layout", "qualifier-results", "final-layout", "final-results",
    ]);
    expect(tournamentWorkbookTrackId("Mario Kart Stadium")).toBe("track.mario_kart_stadium");
    expect(tournamentWorkbookTrackId("Toad Harbour")).toBe("track.toad_harbour");
    expect(tournamentWorkbookTrackId("definitely not a course")).toBeNull();
  });
  it("audits final station moves and derives a deterministic UTP swap plan", () => {
    const participants: TournamentDocument["participants"] = [
      { playerId: "player.a", username: "alpha", displayName: "Alpha", attendance: "present", hasSwitch1: true, hasSwitch2: false },
      { playerId: "player.b", username: "bravo", displayName: "Bravo", attendance: "present", hasSwitch1: true, hasSwitch2: false },
    ];
    const station = (ownerPlayerId: string, ownerDisplayName: string, utpCableNumber: number) =>
      ({ ownerPlayerId, ownerDisplayName, switchType: "ns1" as const, seatNumber: 1, utpCableNumber });
    const auditDocument: TournamentDocument = {
      ...document, participants,
      groups: [
        { ...document.groups[0]!, groupId: "tournament_group.synthetic_qualifier_a", stage: "qualifier", name: "Groep 1",
          members: [
            { playerId: "player.a", displayName: "Alpha", seatOrder: 1, station: station("player.a", "Alpha", 1) },
            { playerId: "player.b", displayName: "Bravo", seatOrder: 2, station: { ...station("player.b", "Bravo", 2), seatNumber: 1 } },
          ] },
        { ...document.groups[0]!, groupId: "tournament_group.synthetic_final_a", stage: "final", name: "Kampioen",
          members: [
            { playerId: "player.a", displayName: "Alpha", seatOrder: 1, station: station("player.b", "Bravo", 2) },
            { playerId: "player.b", displayName: "Bravo", seatOrder: 2, station: station("player.a", "Alpha", 1) },
          ] },
      ],
    };
    const audit = tournamentFinalLayoutAudit(auditDocument);
    expect(audit.ownerGiveUps.map((entry) => entry.displayName)).toEqual(["Alpha", "Bravo"]);
    expect(audit.participantMoves).toHaveLength(2);
    expect(audit.weightedScore).toBe(8);
    expect(audit.utpPlan).toMatchObject({ swapCount: 0, moveCount: 0, unresolved: 0 });
  });
  it("keeps UTP numbers on stations and derives race analytics", () => {
    expect(utpCablePlan(document, "qualifier")).toEqual([expect.objectContaining({
      cableNumber: 1, groupName: "Groep 1", stationName: "Alpha · NS1", players: ["Alpha", "Bravo"],
    })]);
    const analytics = tournamentAnalytics(document);
    expect(analytics).toMatchObject({ raceCount: 1, voidedRaceCount: 0, participantCount: 0 });
    expect(analytics.rows).toHaveLength(2);
    expect(analytics.rows[0]).toMatchObject({
      displayName: "Alpha", points: 15, races: 1, wins: 1, averagePoints: 15,
    });
  });
  it("only completes a score step when every seated Player has a complete standing", () => {
    expect(hasCompleteTournamentStageScores(document.groups, "qualifier")).toBe(false);
    expect(hasCompleteTournamentStageScores(document.groups, "final")).toBe(false);
    const completeGroup = {
      ...document.groups[0]!,
      standings: {
        source: "races" as const,
        rows: [
          ...document.groups[0]!.standings.rows,
          { rank: 3, playerId: "player.c", displayName: "Charlie", points: 20, races: 2, wins: 0, bestRace: 10, complete: true },
        ],
      },
    };
    expect(hasCompleteTournamentStageScores([completeGroup], "qualifier")).toBe(true);
    expect(hasCompleteTournamentStageScores([{
      ...completeGroup,
      standings: { ...completeGroup.standings, rows: completeGroup.standings.rows.map((row) =>
        row.playerId === "player.c" ? { ...row, complete: false } : row) },
    }], "qualifier")).toBe(false);
  });
});

describe("source-first Tournament seating controls", () => {
  const groups: TournamentDocument["groups"] = [
    {
      groupId: "tournament_group.synthetic_group_0001", stage: "qualifier", sequence: 1,
      name: "Groep 1", locked: false, manualScoreSegments: 1,
      stations: [],
      members: [{ playerId: "player.a", displayName: "Alpha", seatOrder: 1 }],
      races: [], manualScores: [], standings: { source: "none", rows: [] },
    },
    {
      groupId: "tournament_group.synthetic_group_0002", stage: "qualifier", sequence: 2,
      name: "Groep 2", locked: false, manualScoreSegments: 1,
      stations: [],
      members: [{ playerId: "player.b", displayName: "Bravo", seatOrder: 1 }],
      races: [], manualScores: [], standings: { source: "none", rows: [] },
    },
  ];

  it("moves a Player between groups without duplicating them and supports parking", () => {
    expect(moveTournamentPlayer(groups, "qualifier", "player.a", groups[1]!.groupId)).toEqual([
      { groupId: groups[0]!.groupId, members: [] },
      { groupId: groups[1]!.groupId, members: ["player.b", "player.a"] },
    ]);
    expect(moveTournamentPlayer(groups, "qualifier", "player.a")).toEqual([
      { groupId: groups[0]!.groupId, members: [] },
      { groupId: groups[1]!.groupId, members: ["player.b"] },
    ]);
  });

  it("derives parking from present Players who are not assigned in the selected stage", () => {
    const document: TournamentDocument = {
      summary: { tournamentId: "tournament.synthetic_event_0001", name: "Night", stage: "qualifiers", workflowStep: 3, qualifierRounds: true, revision: 1, participantCount: 3, presentCount: 2, publicResults: false, affectsRating: false, updatedAtMs: 1, seedingSource: "community_rating", verifiedOnly: false },
      participants: [
        { playerId: "player.a", username: "alpha", displayName: "Alpha", attendance: "present", hasSwitch1: false, hasSwitch2: false },
        { playerId: "player.b", username: "bravo", displayName: "Bravo", attendance: "present", hasSwitch1: false, hasSwitch2: false },
        { playerId: "player.c", username: "charlie", displayName: "Charlie", attendance: "waiting", hasSwitch1: false, hasSwitch2: false },
      ],
      stations: [], groups, overall: [], lifecycle: [],
    };
    expect(tournamentParkingPlayers(document, "qualifier").map((player) => player.playerId)).toEqual([]);
    expect(tournamentParkingPlayers({ ...document, groups: [groups[0]!] }, "qualifier").map((player) => player.playerId)).toEqual(["player.b"]);
  });
});

describe("the four shelves, and the reader's own card above them", () => {
  const FRIDAY = Date.parse("2026-09-11T18:00:00.000Z");
  const summary = (extra: Record<string, unknown>) => ({
    tournamentId: "tournament.synthetic_event_0001", name: "Night",
    stage: "setup", participantCount: 12, updatedAtMs: FRIDAY, ...extra,
  } as unknown as Parameters<typeof tournamentListShelf>[0]);

  it("keeps a finished night nobody published off the archive", () => {
    // The server sends `published: false` only to somebody who may see that
    // row at all, so this shelf is empty for everybody else.
    const now = FRIDAY - 24 * 60 * 60 * 1000;
    expect(tournamentListShelf(summary({ stage: "finalized" }), now)).toBe("finished");
    expect(tournamentListShelf(summary({ stage: "finalized", published: false }), now))
      .toBe("unpublished");
    expect(tournamentListShelf(summary({ stage: "finalized", published: true }), now))
      .toBe("finished");
  });

  it("keeps a removed night out of everything, and findable by its Director", () => {
    // Removing a night takes it out of the lists, the results and the rating.
    // Its own administrator still has to be able to find it: restoring one is
    // done by id, and nothing else prints the id.
    const now = FRIDAY;
    expect(tournamentListShelf(summary({ stage: "setup", removed: true }), now)).toBe("removed");
    expect(tournamentListShelf(summary({ stage: "finalized", removed: true }), now)).toBe("removed");
  });

  it("puts a night on exactly one shelf", () => {
    const now = FRIDAY - 24 * 60 * 60 * 1000;
    expect(tournamentListShelf(summary({ stage: "finalized" }), now)).toBe("finished");
    expect(tournamentListShelf(summary({ stage: "finals", workflowStep: 8 }), now)).toBe("running");
    expect(tournamentListShelf(summary({ stage: "qualifiers", workflowStep: 4, startAtMs: FRIDAY }), now)).toBe("soon");
    expect(tournamentListShelf(summary({ stage: "setup", workflowStep: 2 }), now)).toBe("draft");
  });

  // "The card does not print the shelf's own word over itself" was a source-text assertion on the
  // legacy view. It is now read off the rendered card in `ds-tournaments.test.ts` ("tells a racer
  // where they sit…"): the panel's heading is the night's own name and "Your tournament" is a chip
  // on it, which is the guarantee that case was defending.
});
