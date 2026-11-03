// W17 the list and W19-W21 the night, on the design system (Phase 11).
//
// These are the cases `tournaments-view.test.ts` held before the views moved onto the system. They
// assert what a reader can see and do and the design-system contract the family now shares — the
// shelves and their words, the seat line, the ten steps, the boards, the report and the operator's
// own door — rather than the class names the legacy DOM happened to carry.

import { describe, expect, it, vi } from "vitest";

import { FakeDocument, FakeNode, allByClass, byClass, descendants, texts } from "./dom-double.js";
import {
  mountTournamentEvent,
  mountTournamentsList,
  renderPublicTournamentLiveGroups,
} from "../src/ds-tournaments.js";
import { tournamentGroupLabel, tournamentStageLabel } from "../src/tournaments-view.js";
import { formatTournamentStart } from "../src/tournament-start-clock.js";
import {
  TournamentOperationClientError,
  type PublicTournamentEvent,
  type TournamentOperationClient,
} from "../src/tournament-operation-client.js";
import { setProductLanguage } from "../src/product-language.js";
import { useDocument } from "../src/ds-components.js";

/** The list paints first; the reader's own answers follow on later turns. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 12; turn += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

/** A line built out of links and chips, read as the reader reads it. */
function lineText(root: FakeNode, className: string): string {
  const line = byClass(root, className);
  return (line?.textContent ?? "").replace(/\s+/gu, " ").trim();
}

const hrefs = (root: FakeNode): string[] =>
  descendants(root).filter((node) => node.tagName === "a").map((node) => node.getAttribute("href") ?? "");

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

function fakeClient(overrides: Partial<TournamentOperationClient> = {}): TournamentOperationClient {
  const unused = () => { throw new Error("unexpected call"); };
  return {
    listPublic: async () => [{ tournamentId: event.tournamentId, name: event.name, editionNumber: 13, eventDate: "2026-08-22", stage: "finalized", finalizedAtMs: event.finalizedAtMs!, participantCount: 3, updatedAtMs: 1 }],
    loadPublic: async () => event,
    listDirectors: unused, createRosterPlayers: unused,
    rosterCandidates: unused, rememberRosterAliases: unused, listForAdministrator: unused, load: unused, create: unused, update: unused, setWorkflowStep: unused, setParticipant: unused,
    addHistoricalParticipants: unused, addRecentParticipants: unused, importParticipants: unused, enterRaces: unused,
    removeParticipant: unused, generateGroups: unused, updateGroups: unused, importGroupLayout: unused, lockGroups: unused,
    attachRaces: unused, setManualScores: unused, setTieBreakOrder: unused, enterRace: unused,
    previewScoreWorkbook: unused, exportScoreWorkbook: unused, finalizationPreview: unused,
    finalize: unused, setResultsVisibility: unused, recordIncident: unused, createPlayer: unused,
    deleteDraft: unused, removeTournament: unused, reopenTournament: unused,
    ...overrides,
  };
}

function mount(): Readonly<{ document: FakeDocument; root: FakeNode }> {
  const document = new FakeDocument();
  const root = document.createElement("div");
  useDocument(document as unknown as Document);
  return { document, root };
}

describe("W17 the tournaments list", () => {
  it("maps recovered tier keys to the English labels and stages to copy", () => {
    expect(tournamentGroupLabel("Kampioen", "champion")).toBe("Champion");
    expect(tournamentGroupLabel("Feest", "feest")).toBe("Party");
    expect(tournamentGroupLabel("Groep 1")).toBe("Groep 1");
    expect(tournamentStageLabel("qualifiers")).toBe("Qualifiers in progress");
    expect(tournamentStageLabel("finalized")).toBe("Final results");
  });

  it("renders the public Tournament surface in Dutch when selected", async () => {
    const previousStorage = globalThis.localStorage;
    vi.stubGlobal("localStorage", { getItem: () => "nl", setItem: () => undefined });
    setProductLanguage("nl");
    expect(tournamentGroupLabel("Kampioen", "champion")).toBe("Kampioen");
    expect(tournamentStageLabel("qualifiers")).toBe("Kwalificaties bezig");
    const { root } = mount();
    let bar: FakeNode | null = null;
    const mounted = mountTournamentsList(root as unknown as HTMLElement, fakeClient(), {
      administrator: true, requestGapMs: 0,
      onContextBar: (node) => { bar = node as unknown as FakeNode | null; },
    });
    await mounted.ready;
    expect(texts(root)).toContain("Toernooien");
    expect(bar).not.toBeNull();
    expect(texts(bar!)).toContain("Nieuw toernooi maken");
    mounted.unmount();
    vi.stubGlobal("localStorage", previousStorage);
    setProductLanguage("en");
  });

  it("keeps desktop role chrome and gives the phone an in-flow create action", async () => {
    const { root } = mount();
    let bar: FakeNode | null = null;
    const mounted = mountTournamentsList(root as unknown as HTMLElement, fakeClient(), {
      administrator: true, requestGapMs: 0,
      onContextBar: (node) => { bar = node as unknown as FakeNode | null; },
    });
    await mounted.ready;
    expect(hrefs(root)).toContain("/?tournaments=tournament.synthetic_event_0001");
    expect(hrefs(root)).toContain("/?tournaments=tournament.synthetic_event_0001&operate=1");
    expect(texts(root)).toContain("Edit this tournament");
    // CSS shows the in-flow action only on a phone and the role bar only at wider viewports.
    expect(hrefs(root)).toContain("/?tournaments=1&operate=1");
    expect(byClass(root, "ds-tournaments__mobile-create")).toBeDefined();
    expect(hrefs(bar!)).toContain("/?tournaments=1&operate=1");
    expect(texts(bar!)).toContain("Create new tournament");
    expect(texts(root).some((text) => text === "TN13 · Friday night")).toBe(true);
    expect(descendants(root).some((node) => node.tagName === "script")).toBe(false);
    mounted.unmount();
    expect(root.children).toHaveLength(0);
    // The bar is cleared with the route that set it.
    expect(bar).toBeNull();
  });

  it("lists what is being made apart from what is finished, names the Director and writes the month in letters", async () => {
    const { root } = mount();
    const mounted = mountTournamentsList(root as unknown as HTMLElement, fakeClient({
      listPublic: async () => [
        { tournamentId: "tournament.synthetic_event_0002", name: "Saturday", stage: "setup", participantCount: 0, updatedAtMs: 5, directorDisplayName: "Evan" },
        { tournamentId: event.tournamentId, name: event.name, editionNumber: 13, eventDate: "2026-08-22", stage: "finalized", finalizedAtMs: event.finalizedAtMs!, participantCount: 3, updatedAtMs: 1, directorDisplayName: "Ben", viewerParticipated: true },
      ],
    }), { administrator: true, requestGapMs: 0 });
    await mounted.ready;
    // A night in setup is being made, not being raced: the running shelf stays away and the draft
    // shelf carries it. Every shelf is a section of its own, and only the ones with a night on them
    // are drawn.
    const shelves = allByClass(root, "ds-tournaments__shelf")
      .map((node) => [node.getAttribute("data-shelf"), node.hidden]);
    expect(shelves).toEqual([
      ["running", true], ["soon", true], ["draft", false], ["stalled", true],
      ["finished", false], ["unpublished", true], ["removed", true],
    ]);
    const desktopMetas = allByClass(root, "ds-tournaments__row-meta--desktop").map((node) => node.textContent);
    expect(desktopMetas).toEqual([
      "Preparing · 0 players · Director: Evan",
      "Final results · 3 players · 2026-Aug-22 · Director: Ben",
    ]);
    const phoneMetas = allByClass(root, "ds-tournaments__row-meta--phone").map((node) => node.textContent);
    expect(phoneMetas).toEqual([
      "Preparing · 0 players",
      "Final results · 3 players · 2026-08-22",
    ]);
    expect(allByClass(root, "ds-tournaments__edit-mobile").map((node) => node.textContent))
      .toEqual(["Edit", "Edit"]);
    // The server says which nights the viewer raced in; the list does not read a document for it.
    expect(allByClass(root, "ds-tournaments__mine").map((node) => node.textContent))
      .toEqual(["You raced in this one"]);
    mounted.unmount();
  });

  it("tells a racer where they sit, who is beside them and how the night is going", async () => {
    const { root } = mount();
    const night = {
      ...event,
      stage: "finals",
      groups: [{
        ...event.groups[0]!,
        seating: [
          { playerId: "player.synthetic_alpha", displayName: "Alpha", seatOrder: 0, stationOwnerPlayerId: "player.synthetic_ben", stationOwnerDisplayName: "Ben", switchType: "ns1", seatNumber: 1, seedRank: 3 },
          { displayName: "Private Bravo", seatOrder: 1, stationOwnerPlayerId: "player.synthetic_ben", stationOwnerDisplayName: "Ben", switchType: "ns1", seatNumber: 2, seedRank: 40 },
          { displayName: "Elsewhere", seatOrder: 2, stationOwnerDisplayName: "Evan", switchType: "ns2", seatNumber: 1 },
        ],
      }],
    } as unknown as typeof event;
    const mounted = mountTournamentsList(
      root as unknown as HTMLElement,
      fakeClient({
        listPublic: async () => [{ tournamentId: night.tournamentId, name: night.name, stage: "finals", participantCount: 3, updatedAtMs: 5, viewerParticipated: true, workflowStep: 9 }],
        loadPublic: async () => night,
      }),
      { viewerPlayerId: "player.synthetic_alpha", requestGapMs: 0 },
    );
    await mounted.ready;
    await settle();
    // Where you sit, and who is on the same Switch - never yourself, never the other console.
    const seat = lineText(root, "ds-tournaments__seat");
    expect(seat).toContain("[NS1] Ben’s Switch");
    expect(seat).toContain("seat #1");
    expect(seat).toContain("next to Private Bravo");
    expect(seat).not.toContain("Elsewhere");
    expect(hrefs(root)).toContain("/?player=player.synthetic_ben");
    // Both of you carry the SP band the picture gives you, as a tier chip with its label on it.
    const seeds = allByClass(root, "ds-tier-chip");
    expect(seeds.map((node) => node.textContent)).toContain("#3");
    expect(seeds[0]?.style.getPropertyValue("--ds-tier-colour")).toBe("#F59E0B");
    // And how it is going so far - the group under its name in the reader's language, not the
    // stored Dutch "Kampioen".
    expect(seat).toContain("Champion");
    expect(seat).not.toContain("Kampioen");
    expect(texts(root).some((text) =>
      text.includes("1 of 2 in Champion") && text.includes("25 points from 2 races"))).toBe(true);
    // The card names the night; "Your tournament" is a chip on it, and the shelf above says which
    // shelf it is - the word is never printed twice.
    const card = byClass(root, "ds-panel");
    expect(byClass(card!, "ds-panel__title")?.textContent).toBe("Friday night");
    expect(allByClass(card!, "ds-chip").map((node) => node.textContent))
      .toContain("Your tournament");
    mounted.unmount();
  });

  it("says which of the ten steps the night is in, and which groups have scores", async () => {
    const { root } = mount();
    const night = {
      ...event,
      stage: "qualifiers",
      workflowStep: 5,
      groups: [
        { ...event.groups[0]!, stage: "qualifier", name: "Groep 1", races: [] },
        { ...event.groups[0]!, groupId: "group.two", stage: "qualifier", name: "Groep 3" },
      ],
    } as unknown as typeof event;
    const mounted = mountTournamentsList(
      root as unknown as HTMLElement,
      fakeClient({
        listPublic: async () => [{
          tournamentId: night.tournamentId, name: night.name, stage: "qualifiers",
          participantCount: 2, updatedAtMs: 5, viewerParticipated: true, workflowStep: 5,
        }],
        loadPublic: async () => night,
      }),
      { viewerPlayerId: "player.synthetic_alpha", requestGapMs: 0 },
    );
    await mounted.ready;
    await settle();
    const page = texts(root);
    expect(page).toContain("Step 5 of 10");
    expect(page.some((text) => text.includes("Qualifier layout ready"))).toBe(true);
    // The ten steps are chevrons, and the one being worked on says so rather than only showing a
    // colour: a done step carries ✓ and the current one is marked `aria-current="step"`.
    const steps = allByClass(root, "ds-steps__step");
    expect(steps).toHaveLength(10);
    expect(steps.filter((node) => node.getAttribute("data-state") === "done")).toHaveLength(4);
    expect(steps.find((node) => node.getAttribute("aria-current") === "step")?.textContent)
      .toContain("Qualifier scores");
    // And which group is holding the night up.
    expect(page).toContain("1 of 2 groups scored");
    expect(page).toContain("Groep 1: no races yet");
    expect(page.some((text) => /^Groep 3: \d+ races?$/u.test(text))).toBe(true);
    mounted.unmount();
  });

  it("reads only the nights the reader was actually at", async () => {
    const { root } = mount();
    const asked: string[] = [];
    const summaries = [0, 1, 2, 3, 4, 5].map((index) => ({
      tournamentId: `tournament.${index}`, name: `Night ${index}`,
      stage: index === 3 ? "qualifiers" : "finalized",
      participantCount: 2, updatedAtMs: 100 - index,
      ...(index === 3 ? { viewerParticipated: true, workflowStep: 5 } : {}),
    }));
    const mounted = mountTournamentsList(
      root as unknown as HTMLElement,
      fakeClient({
        listPublic: async () => summaries as never,
        loadPublic: async (tournamentId: string) => {
          asked.push(tournamentId);
          return { ...event, tournamentId } as never;
        },
      }),
      { viewerPlayerId: "player.synthetic_alpha", requestGapMs: 0 },
    );
    await mounted.ready;
    await settle();
    expect(asked).toEqual(["tournament.3"]);
    mounted.unmount();
  });

  it("calls a night on a later day 'coming up', with the day and a countdown", async () => {
    const { root } = mount();
    const threeDays = new Date(Date.now() + 3 * 86_400_000);
    const start = Date.UTC(
      threeDays.getUTCFullYear(), threeDays.getUTCMonth(), threeDays.getUTCDate(), 18, 0, 0);
    const friday = {
      ...event, tournamentId: "tournament.friday", name: "Toernooi 13v2",
      stage: "setup", startAtMs: start, timezone: "Europe/Amsterdam",
      groups: [], overall: [],
    } as unknown as typeof event;
    const mounted = mountTournamentsList(
      root as unknown as HTMLElement,
      fakeClient({
        listPublic: async () => [{
          tournamentId: friday.tournamentId, name: friday.name, stage: "setup",
          participantCount: 33, updatedAtMs: 5, viewerParticipated: true,
          workflowStep: 2, startAtMs: start, timezone: "Europe/Amsterdam",
        }],
        loadPublic: async () => friday,
      }),
      { viewerPlayerId: "player.synthetic_alpha", requestGapMs: 0 },
    );
    await mounted.ready;
    await settle();
    const page = texts(root);
    expect(page).not.toContain("You tonight");
    expect(page).toContain("Coming up");
    // The card's own line says when, with the countdown beside it.
    expect(byClass(root, "ds-tournaments__when")?.textContent ?? "")
      .toContain(formatTournamentStart(start, "Europe/Amsterdam"));
    // 18:00 UTC is 20:00 in summer and 19:00 in winter in Amsterdam: the night's own clock.
    const amsterdamWinter = new Date(start).toLocaleString("en-GB", { timeZone: "Europe/Amsterdam", timeZoneName: "short" })
      .endsWith("CET");
    expect(formatTournamentStart(start, "Europe/Amsterdam")).toMatch(amsterdamWinter ? / at 19:00$/u : / at 20:00$/u);
    // And the clock beside the name, counting down.
    const clock = byClass(root, "ds-tournaments__clock");
    expect(clock?.textContent ?? "").toMatch(/^⏳ (?:\d+d )?\d{2}:\d{2}:\d{2}$/u);
    // The reader is on the list but has no group yet, and is told so.
    expect(page.some((text) => text.includes("has not made the groups yet"))).toBe(true);
    mounted.unmount();
  });

  it("calls a night 'in progress' only once its scores are being entered", async () => {
    const { root } = mount();
    const mounted = mountTournamentsList(
      root as unknown as HTMLElement,
      fakeClient({
        listPublic: async () => [
          { tournamentId: "tournament.a", name: "Being made", stage: "qualifiers", participantCount: 12, updatedAtMs: 3, workflowStep: 4 },
          { tournamentId: "tournament.b", name: "Racing", stage: "qualifiers", participantCount: 12, updatedAtMs: 2, workflowStep: 5 },
          { tournamentId: "tournament.c", name: "Done", stage: "finalized", participantCount: 12, updatedAtMs: 1 },
        ] as never,
        loadPublic: async () => event,
      }),
    );
    await mounted.ready;
    await settle();
    expect(texts(root)).toContain("1 tournament in progress · 1 being prepared · 1 finished");
    const shelfOf = (name: string): string => {
      let node: FakeNode | null = descendants(root).find((candidate) => candidate.textContent === name) ?? null;
      while (node !== null && node.getAttribute("data-shelf") === null) { node = node.parentNode; }
      return node?.getAttribute("data-shelf") ?? "";
    };
    expect(shelfOf("Racing")).toBe("running");
    expect(shelfOf("Being made")).toBe("draft");
    expect(shelfOf("Done")).toBe("finished");
    // The page's one A4 is the night being raced (§4): exactly one filled Live tag, on the card
    // that night wears - the row it replaced carried the other.
    const live = descendants(root).filter((node) => node.getAttribute("data-tone") === "live");
    expect(live.map((node) => node.textContent)).toEqual(["Live"]);
    mounted.unmount();
  });

  it("shows a signed-out visitor the night that is coming, on its own shelf", async () => {
    const { root } = mount();
    const threeDays = new Date(Date.now() + 3 * 86_400_000);
    const start = Date.UTC(
      threeDays.getUTCFullYear(), threeDays.getUTCMonth(), threeDays.getUTCDate(), 18, 0, 0);
    const mounted = mountTournamentsList(
      root as unknown as HTMLElement,
      fakeClient({
        listPublic: async () => [{
          tournamentId: "tournament.friday", name: "Toernooi 13v2", stage: "qualifiers",
          participantCount: 36, updatedAtMs: 5, workflowStep: 4,
          startAtMs: start, timezone: "Europe/Amsterdam",
        }] as never,
        loadPublic: async () => event,
      }),
    );
    await mounted.ready;
    await settle();
    const page = texts(root);
    expect(page).toContain("Coming up");
    expect(page).toContain("1 coming up · 0 finished");
    const shelf = allByClass(root, "ds-tournaments__shelf").find((node) => node.getAttribute("data-shelf") === "soon");
    expect(shelf?.hidden).toBe(false);
    const row = allByClass(root, "ds-tournaments__item").find((node) => node.getAttribute("data-shelf") === "soon");
    expect(row).toBeDefined();
    // A night that is coming is not a night that is being raced: no Live tag on it.
    expect(descendants(row!).some((node) => node.getAttribute("data-tone") === "live")).toBe(false);
    // The row says when it starts, and never that its qualifiers are running.
    const meta = byClass(root, "ds-tournaments__row-meta")?.textContent ?? "";
    expect(meta).toContain(formatTournamentStart(start, "Europe/Amsterdam"));
    expect(meta).not.toContain("Qualifiers in progress");
    // And the clock is on the row, because a visitor has no card to read.
    expect(byClass(root, "ds-tournaments__clock")?.textContent ?? "").toMatch(/^⏳ \d+d \d{2}:\d{2}:\d{2}$/u);
    mounted.unmount();
  });

  it("promotes the latest finished night to the reader's full card", async () => {
    const { root } = mount();
    const loadPublic = vi.fn(async () => event);
    const loadPublicPlacements = vi.fn(async () => [{
      tournamentId: event.tournamentId, fieldSize: 2,
      placements: [{ playerId: "player.synthetic_alpha", placement: 1 }],
    }]);
    const mounted = mountTournamentsList(
      root as unknown as HTMLElement,
      fakeClient({
        listPublic: async () => [{
          tournamentId: event.tournamentId, name: event.name, stage: "finalized",
          participantCount: 2, updatedAtMs: 5, viewerParticipated: true,
        }],
        loadPublic,
        loadPublicPlacements,
      }),
      { viewerPlayerId: "player.synthetic_alpha", requestGapMs: 0 },
    );
    await mounted.ready;
    await settle();
    // The full event already carries this placement, so a second archive request is unnecessary.
    expect(loadPublicPlacements).not.toHaveBeenCalled();
    // As on Android, the latest finished night also becomes the viewer's full card.
    expect(loadPublic).toHaveBeenCalledOnce();
    expect(allByClass(root, "ds-chip").map((node) => node.textContent)).toContain("Your tournament");
    expect(texts(root).some((text) => text.includes("You finished 1 of 2"))).toBe(true);
    mounted.unmount();
  });

  it("links straight to the night, the way the router reads it", async () => {
    const { root } = mount();
    const night = { ...event, stage: "finals" } as unknown as typeof event;
    const mounted = mountTournamentsList(
      root as unknown as HTMLElement,
      fakeClient({
        listPublic: async () => [{ tournamentId: night.tournamentId, name: night.name, stage: "finals", participantCount: 2, updatedAtMs: 5 }],
        loadPublic: async () => night,
      }),
      { viewerPlayerId: "player.synthetic_alpha", requestGapMs: 0 },
    );
    await mounted.ready;
    await settle();
    expect(hrefs(root)).toContain(`/?tournaments=${encodeURIComponent(night.tournamentId)}`);
    expect(hrefs(root).some((href) => href.includes("event="))).toBe(false);
    mounted.unmount();
  });
});

describe("W19-W21 the night", () => {
  // The mirror's snapshot holds no night that is still being raced, so W19's own view is asserted
  // here rather than observed in a browser (CHECKPOINT_6_NIGHT §6).
  it("shows an unpublished finished night as qualifier and final boards, like Android", async () => {
    const { root } = mount();
    const qualifier = {
      ...event.groups[0]!, groupId: "group.qualifier", stage: "qualifier", name: "Group 1", tierKey: undefined,
    };
    const justScored = {
      ...event, tournamentId: "tournament.synthetic_event_0009",
      finalizedAtMs: undefined, workflowStep: 9, groups: [qualifier, event.groups[0]!],
    } as unknown as typeof event;
    const mounted = mountTournamentEvent(root as unknown as HTMLElement, justScored.tournamentId,
      fakeClient({ loadPublic: async () => justScored }));
    await mounted.ready;
    const page = texts(root);
    expect(byClass(root, "ds-winner")).toBeUndefined();
    expect(page).toContain("Step 9 of 10");
    expect(page).toContain("Qualifier");
    expect(page).toContain("Final groups");
    expect(page).toContain("Name");
    expect(page).not.toContain("Overall result");
    expect(page).not.toContain("Share the picture");
    expect(page.some((text) => text.includes("has not been published yet"))).toBe(true);
    expect(allByClass(root, "ds-board")).toHaveLength(2);
    expect(allByClass(root, "ds-board__row").some((node) => node.getAttribute("data-wash") === "")).toBe(true);
    mounted.unmount();
  });

  it("shows public live totals with observed in-game names and no Player links", () => {
    const { document, root } = mount();
    renderPublicTournamentLiveGroups(document as unknown as Document, event, [{
      recordId: "record.live", groupId: event.groups[0]!.groupId, phase: "final", status: "live",
      streamRevision: 4, countedRaces: 2, receivedRaces: 3, lastReceivedAtMs: 100,
      controlPoints: ["1 connection reset", "1 excluded race"],
      standings: [{ rank: 1, observedPlayerName: "BEN★", total: 42,
        participantReference: { namespace: "producer_local_player", value: "local.ben" } }],
    }], root as unknown as HTMLElement);
    const page = texts(root);
    expect(page).toContain("BEN★");
    expect(page).toContain("42");
    // Live is the running night's own tag, and it is the only filled thing here.
    expect(descendants(root).filter((node) => node.getAttribute("data-tone") === "live").length)
      .toBeGreaterThanOrEqual(1);
    expect(descendants(root).filter((node) => node.tagName === "a")).toHaveLength(0);
    expect(page).toContain("1 connection reset · 1 excluded race");
    // The same GroupBoard the finished night and the report's index use.
    const board = byClass(root, "ds-board");
    expect(board).toBeDefined();
    expect(board!.getAttribute("aria-label")).toMatch(/^Live standings · /u);
    expect(board!.getAttribute("aria-label")).not.toBe(byClass(root, "ds-board__title")!.textContent);
    expect(descendants(root).some((node) => node.tagName === "h2" && node.textContent === "Live standings"))
      .toBe(true);
  });

  it("prints the character a Player drove, in the group board and in the report", async () => {
    const { root } = mount();
    const withCharacter = {
      ...event,
      groups: [{
        ...event.groups[0]!,
        standings: [
          { ...event.groups[0]!.standings[0]!, character: { key: "character.tanooki_mario", label: "Tanooki Mario" } },
          event.groups[0]!.standings[1]!,
        ],
      }],
    };
    const mounted = mountTournamentEvent(root as unknown as HTMLElement, withCharacter.tournamentId,
      fakeClient({ loadPublic: async () => withCharacter }));
    await mounted.ready;
    const characters = descendants(root)
      .filter((node) => node.tagName === "img" && node.src.includes("/characters/"));
    expect(characters.some((node) => node.getAttribute("title") === "Tanooki Mario")).toBe(true);
    mounted.unmount();
  });

  it("offers no operation link on a history edition and carries the report per Player", async () => {
    const { root } = mount();
    const history = { ...event, tournamentId: "tournament.history-tn7", editionNumber: 7 };
    const mounted = mountTournamentEvent(root as unknown as HTMLElement, history.tournamentId,
      fakeClient({ loadPublic: async () => history }), { administrator: true });
    await mounted.ready;
    expect(hrefs(root).some((href) => href.includes("operate=1"))).toBe(false);
    const page = texts(root);
    expect(page).toContain("Champion");
    expect(page.some((text) => text.includes("Position after race"))).toBe(true);
    // And nothing beside it. The operator's furniture belongs to a night that is still being run.
    expect(page).not.toContain("Overall result");
    expect(page).not.toContain("Share the picture");
    expect(page).not.toContain("Finals");
    // The standing is the index: every name links down to its own section.
    expect(hrefs(root)).toContain("#speler-alpha");
    mounted.unmount();
  });

  it("shows a catalog character in a published historical standing", async () => {
    const { root } = mount();
    const historical = {
      ...event,
      tournamentId: "tournament.synthetic_historical_0002",
      groups: [{
        ...event.groups[0]!,
        standings: [
          { ...event.groups[0]!.standings[0]!, character: { key: "character.waluigi", label: "Waluigi" } },
          event.groups[0]!.standings[1]!,
        ],
      }],
    } as typeof event;
    const mounted = mountTournamentEvent(root as unknown as HTMLElement, historical.tournamentId,
      fakeClient({ loadPublic: async () => historical }));
    await mounted.ready;
    const pictures = descendants(root).filter((node) => node.tagName === "img");
    expect(pictures.some((node) => node.src.includes("waluigi"))).toBe(true);
    expect(pictures.every((node) => !node.src.includes("tn12"))).toBe(true);
    mounted.unmount();
  });

  it("does not invent a portrait for a participant without a catalog character", async () => {
    const { root } = mount();
    const mounted = mountTournamentEvent(root as unknown as HTMLElement, event.tournamentId,
      fakeClient());
    await mounted.ready;
    expect(descendants(root).some((node) => node.src.includes("tn12"))).toBe(false);
    mounted.unmount();
  });

  it("turns a night of our own into the document once its report is published", async () => {
    const { root } = mount();
    const withReport = {
      ...event,
      report: {
        title: "TN13 'Full Send'",
        intro: ["Een lange avond."],
        summary: ["Kort samengevat."],
        topTracks: ["Baby Park weer."],
        groups: [{ name: "Kampioen", paragraphs: ["De kampioenengroep."] }],
        players: [{ name: "Alpha", paragraphs: ["Alpha reed sterk."] }],
        visibility: { topTracks: true, benchmark: true, duel: true, distribution: true },
        publishedAtMs: 1, revision: 2,
      },
    } as unknown as typeof event;
    const mounted = mountTournamentEvent(root as unknown as HTMLElement, withReport.tournamentId,
      fakeClient({ loadPublic: async () => withReport }));
    await mounted.ready;
    const page = texts(root);
    expect(page).toContain("TN13 'Full Send'");
    expect(page).toContain("Een lange avond.");
    expect(page).toContain("Alpha reed sterk.");
    expect(page).not.toContain("Overall result");
    expect(page).not.toContain("Share the picture");
    // The report's index is the same GroupBoard every other standing is drawn with.
    expect(byClass(root, "ds-board")).toBeDefined();
    mounted.unmount();
  });

  it("leaves the blocks out that the Director unticked", async () => {
    const { root } = mount();
    const hidden = {
      ...event,
      report: {
        title: "TN13", intro: ["Kort."], summary: [], topTracks: ["Baby Park weer."],
        groups: [], players: [],
        visibility: { topTracks: false, benchmark: true, duel: true, distribution: true },
        publishedAtMs: 1, revision: 1,
      },
    } as unknown as typeof event;
    const mounted = mountTournamentEvent(root as unknown as HTMLElement, hidden.tournamentId,
      fakeClient({ loadPublic: async () => hidden }));
    await mounted.ready;
    const page = texts(root);
    expect(page).toContain("TN13");
    expect(page).not.toContain("Top 5 tracks driven");
    expect(page).not.toContain("Baby Park weer.");
    mounted.unmount();
  });

  it("leaves out the intro and every group note when unticked, and never a Player note", async () => {
    const { root } = mount();
    const hidden = {
      ...event,
      report: {
        title: "TN13", intro: ["Een lange avond."], summary: ["Kort samengevat."], topTracks: [],
        groups: [{ name: "Kampioen", paragraphs: ["De kampioenengroep."] }],
        players: [{ name: "Alpha", paragraphs: ["Alpha reed sterk."] }],
        visibility: {
          topTracks: true, benchmark: true, duel: true, distribution: true,
          intro: false, summary: true, groupNotes: false,
        },
        publishedAtMs: 1, revision: 1,
      },
    } as unknown as typeof event;
    const mounted = mountTournamentEvent(root as unknown as HTMLElement, hidden.tournamentId,
      fakeClient({ loadPublic: async () => hidden }));
    await mounted.ready;
    const page = texts(root);
    expect(page).toContain("TN13");
    expect(page).toContain("Kort samengevat.");
    expect(page).toContain("Alpha reed sterk.");
    expect(page).not.toContain("Een lange avond.");
    expect(page).not.toContain("De kampioenengroep.");
    mounted.unmount();
  });

  it("shows a finished night as its standings until the report is published", async () => {
    const { root } = mount();
    const mounted = mountTournamentEvent(root as unknown as HTMLElement, event.tournamentId, fakeClient());
    await mounted.ready;
    const page = texts(root);
    // The boards are there, with the group's own name over them.
    expect(byClass(root, "ds-board")).toBeDefined();
    expect(page).toContain("Champion");
    // The operator's furniture is not.
    expect(page).not.toContain("Overall result");
    expect(page).not.toContain("Share the picture");
    // Neither is anything the report is made of.
    expect(descendants(root).some((node) => node.className.includes("tournament-report__player"))).toBe(false);
    expect(page.some((text) => text.includes("Position after race"))).toBe(false);
    // And the page says why the rest is not there yet.
    expect(page.some((text) => text.includes("has not been published yet"))).toBe(true);
    mounted.unmount();
  });

  it("is the night in display type over the art it drove most, with what it is under it", async () => {
    const { root } = mount();
    const mounted = mountTournamentEvent(root as unknown as HTMLElement, event.tournamentId, fakeClient());
    await mounted.ready;
    const hero = byClass(root, "ds-hero");
    expect(hero?.getAttribute("data-spectacle")).toBe("high");
    // Android uses display-2 here so the full night identity stays on one phone line.
    expect(byClass(root, "ds-hero__title")?.getAttribute("data-step")).toBe("display-2");
    expect(byClass(root, "ds-hero__title")?.textContent).toBe("TN13 · Friday night");
    expect(byClass(root, "ds-hero__eyebrow")?.textContent)
      .toContain("Final results · 3 players · 2026-08-22");
    // The backdrop is the track the night drove most, from the canonical catalogue (§16).
    expect(byClass(root, "ds-hero__backdrop")?.src).toContain("mario_kart_stadium");
    mounted.unmount();
  });

  it("names every Player in the standings; a private Player gets no profile link", async () => {
    const { root } = mount();
    const mounted = mountTournamentEvent(root as unknown as HTMLElement, event.tournamentId, fakeClient());
    await mounted.ready;
    const nodes = descendants(root);
    expect(texts(root)).toContain("TN13 · Friday night");
    expect(texts(root)).toContain("Champion");
    const alpha = nodes.find((node) => node.tagName === "a" && node.textContent === "Alpha");
    expect(alpha?.getAttribute("href")).toBe("/?player=player.synthetic_alpha");
    const bravo = nodes.filter((node) => (node.textContent ?? "").includes("Private Bravo"));
    expect(bravo.length).toBeGreaterThan(0);
    // A Player without a public profile is named, never linked to one.
    expect(bravo.filter((node) => node.tagName === "a")
      .every((node) => (node.getAttribute("href") ?? "").startsWith("#speler-"))).toBe(true);
    mounted.unmount();
  });

  it("explains an unpublished tournament instead of failing", async () => {
    const { root } = mount();
    const mounted = mountTournamentEvent(root as unknown as HTMLElement, event.tournamentId, fakeClient({
      loadPublic: async () => { throw new TournamentOperationClientError("not_found"); },
    }));
    await mounted.ready;
    expect(texts(root)).toContain("This tournament is not published, or does not exist.");
    mounted.unmount();
  });
});
