import { describe, expect, it, vi } from "vitest";

import {
  PlayerClaimClientError,
  type ClaimCandidate,
  type PlayerClaimClient,
} from "../src/player-claim-client.js";
import type { PlayerVisibilityClient } from
  "../src/time-trial-lifecycle-client.js";
import type { PlayerProfilePreferenceClient } from
  "../src/player-profile-preference-settings.js";
import type { AccountTimeTrialPreferenceClient } from
  "../src/account-time-trial-settings.js";
import {
  deriveUsername,
  matchPlayers,
  missingHalf,
  mountWelcomeOnboarding,
  playerSearchKeys,
  possiblySamePersonNote,
  suggestAvailableUsername,
  timeTrialContextLine,
  tournamentContextLine,
} from "../src/welcome-onboarding.js";

class FakeNode {
  readonly children: FakeNode[] = [];
  readonly attributes = new Map<string, string>();
  readonly dataset: Record<string, string> = {};
  parentNode: FakeNode | null = null;
  className = "";
  id = "";
  textContent: string | null = null;
  type = "";
  name = "";
  value = "";
  href = "";
  src = "";
  target = "";
  rel = "";
  alt = "";
  placeholder = "";
  maxLength = -1;
  minLength = -1;
  required = false;
  noValidate = false;
  spellcheck = true;
  autocomplete = "";
  disabled = false;
  checked = false;
  hidden = false;
  focused = false;
  private readonly listeners = new Map<string, Set<(event: Event) => void>>();
  constructor(readonly tagName: string, readonly ownerDocument: FakeDocument) {}
  get firstChild(): FakeNode | null { return this.children[0] ?? null; }
  append(...nodes: FakeNode[]): void {
    for (const node of nodes) { node.parentNode = this; this.children.push(node); }
  }
  removeChild(node: FakeNode): FakeNode {
    const index = this.children.indexOf(node);
    if (index < 0) { throw new Error("synthetic child missing"); }
    this.children.splice(index, 1);
    node.parentNode = null;
    return node;
  }
  remove(): void { this.parentNode?.removeChild(this); }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  focus(): void { this.focused = true; }
  addEventListener(type: string, listener: (event: Event) => void): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }
  dispatch(type: string): void {
    const event = new Event(type, { cancelable: true });
    for (const listener of this.listeners.get(type) ?? []) { listener(event); }
  }
}

class FakeDocument {
  createElement(tagName: string): FakeNode { return new FakeNode(tagName, this); }
}

function descendants(root: FakeNode): FakeNode[] {
  return root.children.flatMap((child) => [child, ...descendants(child)]);
}

function text(root: FakeNode, value: string): FakeNode {
  const found = descendants(root).find((candidate) => candidate.textContent === value);
  if (found === undefined) {
    throw new Error(`synthetic node missing: ${value}`);
  }
  return found;
}

function has(root: FakeNode, fragment: string): boolean {
  return descendants(root).some((candidate) =>
    String(candidate.textContent ?? "").includes(fragment));
}

/** A result row is a button whose name sits in a child element. */
function result(root: FakeNode, name: string): FakeNode {
  const found = descendants(root).find((candidate) =>
    candidate.className === "welcome__result" &&
    candidate.children.some((child) => child.textContent === name));
  if (found === undefined) { throw new Error(`no result for ${name}`); }
  return found;
}

function field(root: FakeNode, className: string): FakeNode {
  const found = descendants(root).find((candidate) =>
    candidate.className.includes(className));
  if (found === undefined) { throw new Error(`no ${className}`); }
  return found;
}

async function settle(times = 4): Promise<void> {
  for (let index = 0; index < times; index += 1) { await Promise.resolve(); }
}

function answer(root: FakeNode, question: "timeTrials" | "tournaments", value: "yes" | "no"): void {
  const set = descendants(root).find((candidate) => candidate.attributes.get("data-welcome-question") === question);
  if (set === undefined) { throw new Error(`no question ${question}`); }
  const button = descendants(set).find((candidate) => candidate.attributes.get("data-welcome-answer") === value);
  if (button === undefined) { throw new Error(`no ${value} for ${question}`); }
  button.dispatch("click");
}

function continueButton(root: FakeNode): FakeNode {
  const found = descendants(root).find((candidate) => candidate.attributes.get("data-welcome-continue") === "true");
  if (found === undefined) { throw new Error("no Continue"); }
  return found;
}

function answers(root: FakeNode, timeTrials: "yes" | "no", tournaments: "yes" | "no"): void {
  answer(root, "timeTrials", timeTrials);
  answer(root, "tournaments", tournaments);
  continueButton(root).dispatch("click");
}

const directory = [
  { playerId: "player.evan", username: "evan", displayName: "Evan", aliases: [] },
  {
    playerId: "player.sadler",
    username: "sadler",
    displayName: "Sadler",
    aliases: ["Soudler"],
  },
] as const;

function claimClient(overrides: Partial<PlayerClaimClient> = {}): PlayerClaimClient {
  return {
    async listMine() { return []; },
    async listAll() { return directory; },
    async search() { return []; },
    async request() { throw new Error("unused"); },
    async createOwnPlayer() { throw new Error("unused"); },
    ...overrides,
  };
}

function visibilityClient(
  overrides: Partial<PlayerVisibilityClient> = {},
): PlayerVisibilityClient {
  return {
    async read() { throw new Error("unused"); },
    async setOwn() { throw new Error("must not set visibility"); },
    async setForPlayer() { throw new Error("unused"); },
    ...overrides,
  };
}

const profileClient: PlayerProfilePreferenceClient = {
  async read() {
    return {
      countryId: null, favoriteCharacterId: null, favoriteBodyId: null,
      favoriteTireId: null, favoriteGliderId: null,
    };
  },
  async save(value) { return value; },
};

const preferenceClient: AccountTimeTrialPreferenceClient = {
  async read() { return { modePreference: "all" as const, screenName: null, trackAccess: "unknown" as const }; },
  async save(value) { return value; },
};

function mount(
  overrides: Partial<Parameters<typeof mountWelcomeOnboarding>[1]> = {},
): Readonly<{ root: FakeNode; mounted: ReturnType<typeof mountWelcomeOnboarding>; visited: string[] }> {
  const document = new FakeDocument();
  const root = document.createElement("div");
  const visited: string[] = [];
  const mounted = mountWelcomeOnboarding(root as unknown as HTMLElement, {
    claims: claimClient(),
    visibility: visibilityClient(),
    profilePreferences: profileClient,
    timeTrialPreferences: preferenceClient,
    navigate: (href) => { visited.push(href); },
    ...overrides,
  });
  return { root, mounted, visited };
}

describe("welcome onboarding", () => {
  describe("the handle a person is shown while typing", () => {
    it("derives the same handle the server would", () => {
      expect(deriveUsername("Nova")).toBe("nova");
      expect(deriveUsername("Ben van der Berg")).toBe("ben_van_der_berg");
      expect(deriveUsername("Renée")).toBe("renee");
      // Too short, and nothing usable at all.
      expect(deriveUsername("Jo")).toBeNull();
      expect(deriveUsername("!!!")).toBeNull();
    });

    it("offers the next free handle rather than rejecting the name", () => {
      const taken = new Set(["nova", "nova2"]);
      expect(suggestAvailableUsername("nova", taken)).toBe("nova3");
      expect(suggestAvailableUsername("evan", taken)).toBe("evan");
      // A 16-character handle keeps room for the digit instead of overflowing.
      const long = "abcdefghijklmnop";
      expect(suggestAvailableUsername(long, new Set([long])))
        .toBe("abcdefghijklmno2");
    });
  });

  describe("finding a Player you already are", () => {
    it("matches display name, handle and in-game alias alike", () => {
      expect(playerSearchKeys(directory[1])).toContain("soudler");
      expect(matchPlayers(directory, "soud").map((row) => row.username))
        .toEqual(["sadler"]);
      expect(matchPlayers(directory, "eva").map((row) => row.username))
        .toEqual(["evan"]);
      expect(matchPlayers(directory, "zzz")).toEqual([]);
    });
  });

  it("asks two questions first: Time Trials and tournaments, separately", async () => {
    const { root, mounted } = mount();
    await mounted.ready;
    await settle();

    expect(text(root, "Are your Time Trial times already on this website?")).toBeDefined();
    expect(text(root, "Have you taken part in a tournament listed on this site?")).toBeDefined();
    expect(text(root, "Step 1 of 3")).toBeDefined();
    expect(has(root, "Not sure? Choose yes")).toBe(true);
    expect(root.children[0]?.className).toContain("ds-root ds-welcome");
    // Yes and No for each question, and one Continue.
    expect(descendants(root).filter((candidate) =>
      candidate.className.includes("welcome__button") &&
      candidate.className.includes("ds-button"))).toHaveLength(5);
    // Neither path has started: no name field, no search field yet.
    expect(descendants(root).some((candidate) =>
      candidate.className.includes("welcome__control"))).toBe(false);
    // Continue waits for both answers.
    expect(continueButton(root).disabled).toBe(true);
    answer(root, "timeTrials", "yes");
    expect(continueButton(root).disabled).toBe(true);
    answer(root, "tournaments", "no");
    expect(continueButton(root).disabled).toBe(false);
    continueButton(root).dispatch("click");

    expect(text(root, "Find yourself in the list")).toBeDefined();
    expect(text(root, "Step 2 of 3")).toBeDefined();
    // "Oh no, not after all" leaves nothing behind and simply continues.
    text(root, "Oh no, not after all — I'm new here, create a Player instead").dispatch("click");
    expect(text(root, "What should we call you?")).toBeDefined();
    expect(field(root, "welcome__control--name").className).toContain("ds-input");
    mounted.unmount();
  });

  it("goes straight to a new Player after No and No", async () => {
    const { root, mounted } = mount();
    await mounted.ready;
    await settle();
    answers(root, "no", "no");
    expect(text(root, "What should we call you?")).toBeDefined();
    mounted.unmount();
  });

  it("asks one question first, and shows the handle it will use", async () => {
    const { root, mounted } = mount();
    await mounted.ready;
    await settle();
    answers(root, "no", "no");

    expect(text(root, "What should we call you?")).toBeDefined();
    expect(text(root, "Step 2 of 3")).toBeDefined();
    // One primary action, and no Save button anywhere on the first screen.
    expect(descendants(root).filter((candidate) =>
      String(candidate.textContent ?? "").startsWith("Save"))).toHaveLength(0);

    const name = field(root, "welcome__control--name");
    name.value = "Nova";
    name.dispatch("input");
    expect(field(root, "welcome__handle").textContent).toBe("You'll be @nova");

    // A taken handle is resolved before anything is created, and the person
    // keeps the name they typed.
    name.value = "Evan";
    name.dispatch("input");
    expect(field(root, "welcome__handle").textContent).toBe("You'll be @evan2");
    mounted.unmount();
  });

  it("warns about a display name that already races, points at the other path, and creates on a second press", async () => {
    const createOwnPlayer = vi.fn(async () => ({
      playerId: "player.evan-2", username: "evan2", displayName: "Evan",
      playerClaimId: "player_claim.evan-2",
    }));
    const { root, mounted } = mount({
      claims: claimClient({ createOwnPlayer: createOwnPlayer as never }),
    });
    await mounted.ready;
    await settle();
    answers(root, "no", "no");

    const name = field(root, "welcome__control--name");
    name.value = "Evan";
    name.dispatch("input");
    field(root, "welcome__form").dispatch("submit");
    await settle();

    expect(createOwnPlayer).not.toHaveBeenCalled();
    expect(has(root, "A Player already races under that name")).toBe(true);
    expect(has(root, "My times or tournament results are already on this site")).toBe(true);

    // ADR-0218: a name is never an identity, so a second press creates this person's own Player.
    field(root, "welcome__form").dispatch("submit");
    await settle();
    expect(createOwnPlayer).toHaveBeenCalledTimes(1);
    mounted.unmount();
  });

  it("creates the Player and moves on to the optional step", async () => {
    const createOwnPlayer = vi.fn(async () => ({
      playerId: "player.nova", username: "nova", displayName: "Nova",
      playerClaimId: "player_claim.nova",
    }));
    const { root, mounted, visited } = mount({
      claims: claimClient({ createOwnPlayer }),
    });
    await mounted.ready;
    await settle();
    answers(root, "no", "no");

    const name = field(root, "welcome__control--name");
    name.value = "Nova";
    name.dispatch("input");
    field(root, "welcome__form").dispatch("submit");
    await settle(8);

    expect(createOwnPlayer).toHaveBeenCalledWith(
      "nova", "Nova", expect.any(AbortSignal),
    );
    expect(text(root, "You're in, Nova")).toBeDefined();
    expect(text(root, "Step 3 of 3 · optional")).toBeDefined();
    // One Save for the whole step, and a visible way past it.
    expect(text(root, "Save and finish")).toBeDefined();
    expect(text(root, "Skip for now")).toBeDefined();

    text(root, "Skip for now").dispatch("click");
    // The person lands on the Player they just made, addressed by name.
    expect(visited).toEqual(["/?player=nova"]);
    mounted.unmount();
  });

  it("says who already holds a Player instead of failing generically", async () => {
    const request = vi.fn(async () => {
      throw new PlayerClaimClientError("conflict");
    });
    const { root, mounted } = mount({ claims: claimClient({ request }) });
    await mounted.ready;
    await settle();

    answers(root, "no", "yes");
    const search = field(root, "welcome__control--search");
    search.value = "evan";
    search.dispatch("input");
    result(root, "Evan").dispatch("click");
    text(root, "Yes, that's me").dispatch("click");
    await settle(6);

    expect(has(root, "already linked to an account")).toBe(true);
    expect(has(root, "sign in with its email address")).toBe(true);
    mounted.unmount();
  });

  it("sends a claim request and explains that a person checks it", async () => {
    const request = vi.fn(async () => ({
      playerClaimId: "player_claim.evan",
      playerId: "player.evan",
      claimStatus: "requested" as const,
      disputeStatus: "none" as const,
    }));
    const { root, mounted } = mount({ claims: claimClient({ request }) });
    await mounted.ready;
    await settle();

    answers(root, "no", "yes");
    const search = field(root, "welcome__control--search");
    search.value = "soudler";
    search.dispatch("input");
    // The in-game alias found the Player whose display name is Sadler.
    result(root, "Sadler").dispatch("click");
    text(root, "Yes, that's me").dispatch("click");
    await settle(6);

    expect(request).toHaveBeenCalledWith("player.sadler", expect.any(AbortSignal));
    expect(text(root, "Request sent")).toBeDefined();
    expect(has(root, "someone checks that this Player is really you")).toBe(true);
    mounted.unmount();
  });

  it("does not ask an account that already has a Player to make another", async () => {
    const { root, mounted } = mount({
      claims: claimClient({
        async listMine() {
          return [{
            playerClaimId: "player_claim.ben",
            playerId: "player.ben",
            playerUsername: "ben",
            playerDisplayName: "Ben",
            claimStatus: "verified" as const,
            disputeStatus: "none" as const,
            updatedAtMs: 1787011200000,
          }];
        },
      }),
    });
    await mounted.ready;
    await settle();
    expect(text(root, "You're all set")).toBeDefined();
    mounted.unmount();
  });

  it("keeps a private choice honest when only the Player could be created", async () => {
    const { root, mounted } = mount({
      claims: claimClient({
        async createOwnPlayer() {
          return {
            playerId: "player.nova", username: "nova", displayName: "Nova",
            playerClaimId: "player_claim.nova",
          };
        },
      }),
      visibility: visibilityClient({
        async setOwn() { throw new Error("visibility unavailable"); },
      }),
    });
    await mounted.ready;
    await settle();
    answers(root, "no", "no");

    const name = field(root, "welcome__control--name");
    name.value = "Nova";
    name.dispatch("input");
    const priv = descendants(root).find((candidate) =>
      candidate.type === "radio" && candidate.value === "private")!;
    priv.checked = true;
    field(root, "welcome__form").dispatch("submit");
    await settle(8);

    expect(field(root, "welcome__status").textContent)
      .toContain("could not be made private");
    // The Player still exists, so the flow still moves on.
    expect(text(root, "You're in, Nova")).toBeDefined();
    mounted.unmount();
  });
});

describe("finding yourself with context (ADR-0219)", () => {
  const malTimeTrials: ClaimCandidate = {
    playerId: "player.mal_tt", username: "mal_tt", displayName: "Mal", aliases: [],
    claimed: false, matchesAnswers: true,
    timeTrials: { times: 42, lastAt: "2026-10-30", classes: [150, 200] },
    tournaments: { nights: 0, directorNames: [], lastNight: null },
  };
  const malNights: ClaimCandidate = {
    playerId: "player.mal", username: "mal", displayName: "Mal", aliases: ["Malie"],
    claimed: false, matchesAnswers: true,
    timeTrials: { times: 0, lastAt: null, classes: [] },
    tournaments: { nights: 7, directorNames: ["Ben", "Evan"], lastNight: { name: "TN13", date: "2026-10-04" } },
  };
  const malBoth: ClaimCandidate = {
    ...malNights, playerId: "player.mal_both", username: "mal_both",
    timeTrials: { times: 3, lastAt: "2026-09-01", classes: [150] },
  };
  const requested = (playerId: string) => ({
    playerClaimId: `player_claim.${playerId.slice(7)}`, playerId,
    claimStatus: "requested" as const, disputeStatus: "none" as const,
  });

  it("writes the context lines a person recognises", () => {
    expect(timeTrialContextLine(malTimeTrials.timeTrials))
      .toBe("42 published Time Trials · last on 2026-10-30 · 150cc and 200cc");
    expect(timeTrialContextLine({ times: 1, lastAt: null, classes: [200] })).toBe("1 published Time Trial · 200cc");
    expect(timeTrialContextLine(malNights.timeTrials)).toBe("No published Time Trials");
    expect(tournamentContextLine(malNights.tournaments))
      .toBe("7 tournament nights · Directors: Ben, Evan · last: TN13 (2026-10-04)");
    expect(tournamentContextLine({ nights: 1, directorNames: [], lastNight: { name: "TN4", date: null } }))
      .toBe("1 tournament night · last: TN4");
    expect(tournamentContextLine(malTimeTrials.tournaments)).toBe("No tournament nights");
  });

  it("looks for the missing half only after two yeses", () => {
    const both = { timeTrials: true, tournaments: true };
    expect(missingHalf(both, malBoth)).toBeNull();
    expect(missingHalf(both, malTimeTrials)).toEqual({ timeTrials: false, tournaments: true });
    expect(missingHalf(both, malNights)).toEqual({ timeTrials: true, tournaments: false });
    expect(missingHalf({ timeTrials: true, tournaments: false }, malNights)).toBeNull();
    expect(possiblySamePersonNote(malNights)).toContain("Possibly the same person as Mal (@mal)");
  });

  it("asks the server with both answers and groups the Players that fit", async () => {
    vi.useFakeTimers();
    try {
      const candidates = vi.fn(async () => [malTimeTrials, { ...malNights, matchesAnswers: false }]);
      const { root, mounted } = mount({ claims: claimClient({ candidates }) });
      await mounted.ready;
      await settle();
      answers(root, "yes", "no");
      const search = field(root, "welcome__control--search");
      search.value = "mal";
      search.dispatch("input");
      await vi.advanceTimersByTimeAsync(250);
      await settle();

      expect(candidates).toHaveBeenCalledWith(
        { query: "mal", timeTrials: true, tournaments: false }, expect.any(AbortSignal),
      );
      expect(text(root, "Matches your answers")).toBeDefined();
      expect(text(root, "Other Players with this name")).toBeDefined();
      expect(text(root, "42 published Time Trials · last on 2026-10-30 · 150cc and 200cc")).toBeDefined();
      expect(text(root, "7 tournament nights · Directors: Ben, Evan · last: TN13 (2026-10-04)")).toBeDefined();
      mounted.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("sends one request when the chosen Player has both", async () => {
    vi.useFakeTimers();
    try {
      const request = vi.fn(async (playerId: string) => requested(playerId));
      const { root, mounted } = mount({
        claims: claimClient({ candidates: async () => [malBoth], request }),
      });
      await mounted.ready;
      await settle();
      answers(root, "yes", "yes");
      const search = field(root, "welcome__control--search");
      search.value = "mal";
      search.dispatch("input");
      await vi.advanceTimersByTimeAsync(250);
      await settle();
      descendants(root).find((candidate) => candidate.className === "welcome__result")!.dispatch("click");
      text(root, "Yes, that's me").dispatch("click");
      await settle(8);

      expect(request).toHaveBeenCalledTimes(1);
      expect(request).toHaveBeenCalledWith("player.mal_both", expect.any(AbortSignal));
      expect(text(root, "Request sent")).toBeDefined();
      mounted.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("finds a second Player for the other half and notes they may be one person", async () => {
    vi.useFakeTimers();
    try {
      const request = vi.fn(async (playerId: string) => requested(playerId));
      const candidates = vi.fn(async (input: { timeTrials: boolean; tournaments: boolean }) =>
        input.timeTrials && input.tournaments ? [malTimeTrials, malNights] : [malNights, malTimeTrials]);
      const { root, mounted } = mount({ claims: claimClient({ candidates, request }) });
      await mounted.ready;
      await settle();
      answers(root, "yes", "yes");
      let search = field(root, "welcome__control--search");
      search.value = "mal";
      search.dispatch("input");
      await vi.advanceTimersByTimeAsync(250);
      await settle();
      result(root, "Mal").dispatch("click");
      text(root, "Yes, that's me").dispatch("click");

      // The Time Trial Player has no nights: look for the tournament Player.
      expect(text(root, "Are your tournament nights under another Player?")).toBeDefined();
      search = field(root, "welcome__control--search");
      search.value = "mal";
      search.dispatch("input");
      await vi.advanceTimersByTimeAsync(250);
      await settle();
      expect(candidates).toHaveBeenLastCalledWith(
        { query: "mal", timeTrials: false, tournaments: true }, expect.any(AbortSignal),
      );
      // The Player already chosen is not offered twice.
      expect(descendants(root).filter((candidate) => candidate.className === "welcome__result")).toHaveLength(1);
      result(root, "Mal").dispatch("click");
      text(root, "Yes, that's me").dispatch("click");
      await settle(12);

      expect(request.mock.calls).toEqual([
        ["player.mal_tt", expect.any(AbortSignal), possiblySamePersonNote(malNights)],
        ["player.mal", expect.any(AbortSignal), possiblySamePersonNote(malTimeTrials)],
      ]);
      expect(text(root, "Request sent")).toBeDefined();
      expect(has(root, "these two Players may be the same person")).toBe(true);
      mounted.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("lets the person send the first request alone", async () => {
    vi.useFakeTimers();
    try {
      const request = vi.fn(async (playerId: string) => requested(playerId));
      const { root, mounted } = mount({
        claims: claimClient({ candidates: async () => [malTimeTrials], request }),
      });
      await mounted.ready;
      await settle();
      answers(root, "yes", "yes");
      const search = field(root, "welcome__control--search");
      search.value = "mal";
      search.dispatch("input");
      await vi.advanceTimersByTimeAsync(250);
      await settle();
      result(root, "Mal").dispatch("click");
      text(root, "Yes, that's me").dispatch("click");
      text(root, "No — send the request for Mal only").dispatch("click");
      await settle(8);

      expect(request.mock.calls).toEqual([["player.mal_tt", expect.any(AbortSignal)]]);
      expect(text(root, "Request sent")).toBeDefined();
      mounted.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("falls back to the directory when the server search fails", async () => {
    vi.useFakeTimers();
    try {
      const { root, mounted } = mount({
        claims: claimClient({ candidates: async () => { throw new PlayerClaimClientError("unavailable"); } }),
      });
      await mounted.ready;
      await settle();
      answers(root, "no", "yes");
      const search = field(root, "welcome__control--search");
      search.value = "soud";
      search.dispatch("input");
      await vi.advanceTimersByTimeAsync(250);
      await settle();
      expect(result(root, "Sadler")).toBeDefined();
      mounted.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows every pending request while they wait", async () => {
    const pending = (name: string) => ({
      playerClaimId: `player_claim.${name.toLowerCase()}`, playerId: `player.${name.toLowerCase()}`,
      playerUsername: name.toLowerCase(), playerDisplayName: name,
      claimStatus: "requested" as const, disputeStatus: "none" as const, updatedAtMs: 1787011200000,
    });
    const { root, mounted } = mount({
      claims: claimClient({ async listMine() { return [pending("Mal"), pending("MalTT")]; } }),
    });
    await mounted.ready;
    await settle();
    expect(text(root, "Your request for Mal & MalTT is with the team.")).toBeDefined();
    mounted.unmount();
  });
});
