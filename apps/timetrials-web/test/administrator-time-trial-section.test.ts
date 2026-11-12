import { describe, expect, it, vi } from "vitest";

import {
  buildAdministratorQuery,
  mountAdministratorTimeTrialSection,
  resultSummary,
} from "../src/administrator-time-trial-section.js";
import {
  TimeTrialLifecycleClientError,
  type ManagedTimeTrial,
  type PlayerVisibilityClient,
  type TimeTrialLifecycleClient,
} from "../src/time-trial-lifecycle-client.js";
import { FakeDocument, type FakeNode, descendants } from "./dom-double.js";
function node(root: FakeNode, value: string): FakeNode {
  const found = descendants(root).find((candidate) => candidate.textContent === value);
  if (found === undefined) { throw new Error(`synthetic node missing: ${value}`); }
  return found;
}
async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

const submissionId = "user_submission.time.SYNTHETICLIFECYCLE01";
const playerId = "player.synthetic_racer_001";

const result: ManagedTimeTrial = {
  submissionId,
  playerId,
  playerUsername: "SyntheticRacer",
  playerDisplayName: "Synthetic Racer",
  retirementState: "active",
  publicationStatus: "published",
  publicationReason: "policy_public",
  current: {
    revision: 2,
    modeCc: 200,
    trackId: "track.mario_kart_stadium",
    totalTimeMs: 94_612,
    laps: [],
    sourceKind: "android_scan",
    createdAtMs: 1_900_000_000_000,
  },
  revisions: [],
  events: [],
};

function client(
  overrides: Partial<TimeTrialLifecycleClient> = {},
): TimeTrialLifecycleClient {
  return {
    async read() { return result; },
    async correct() { return result; },
    async retire() { return { ...result, retirementState: "retired" }; },
    async restore() { return result; },
    async setVideo() { return result; },
    async listForAdministrator() { return [result]; },
    async publishReviewed() { return { ...result, publicationStatus: "published" }; },
    ...overrides,
  };
}

function visibility(
  overrides: Partial<PlayerVisibilityClient> = {},
): PlayerVisibilityClient {
  return {
    async read() { throw new Error("unused"); },
    async setOwn() { throw new Error("unused"); },
    async setForPlayer(_playerId, chosen) {
      return {
        playerId,
        username: "SyntheticRacer",
        displayName: "Synthetic Racer",
        visibility: chosen,
      };
    },
    ...overrides,
  };
}

describe("administrator Time Trial filters and summary", () => {
  it("sends only the filters that were actually chosen", () => {
    expect(buildAdministratorQuery({
      playerId: "  ", trackId: "track.mario_kart_stadium", mode: "",
      retirementState: "retired", publicationStatus: "", sourceKind: "",
    })).toEqual({
      trackId: "track.mario_kart_stadium",
      retirementState: "retired",
      limit: 50,
    });
    expect(buildAdministratorQuery({ mode: "200" }))
      .toEqual({ mode: 200, limit: 50 });
  });

  it("summarises a row with Player, track, speed, time, source and state", () => {
    expect(resultSummary(result)).toBe(
      "Synthetic Racer (@SyntheticRacer) · Mario Kart Stadium 200cc · " +
      "1:34.612 · scanned in the Android app · version 2 · " +
      "Public — visible on leaderboards and your profile.",
    );
  });
});

describe("administrator Time Trial section", () => {
  it("lists recorded results and re-queries with the chosen filters", async () => {
    const listForAdministrator = vi.fn(async () => [result]);
    const document = new FakeDocument();
    const root = document.createElement("div");
    const mounted = mountAdministratorTimeTrialSection(
      root as unknown as HTMLElement,
      client({ listForAdministrator }),
      visibility(),
    );
    await mounted.ready;
    expect(listForAdministrator).toHaveBeenCalledWith(
      { limit: 50 }, expect.any(AbortSignal),
    );
    expect(node(root, "1 recorded Time Trial.")).toBeDefined();
    expect(descendants(root).some((candidate) =>
      String(candidate.textContent).includes(
        "Synthetic Racer (@SyntheticRacer)"))).toBe(true);
    // The management panel is already usable on the row itself.
    expect(node(root, "Retire this result")).toBeDefined();

    descendants(root).find((candidate) =>
      candidate.name === "player_id")!.value = playerId;
    descendants(root).find((candidate) =>
      candidate.name === "retirement_state")!.value = "retired";
    descendants(root).find((candidate) =>
      candidate.className === "administrator-time-trials__filters")!
      .dispatch("submit");
    await settle();
    expect(listForAdministrator).toHaveBeenLastCalledWith(
      { playerId, retirementState: "retired", limit: 50 },
      expect.any(AbortSignal),
    );
    mounted.unmount();
    expect(root.children).toHaveLength(0);
  });

  it("sets a Player's presence from the row, with a recorded reason", async () => {
    const setForPlayer = vi.fn(async () => ({
      playerId,
      username: "SyntheticRacer",
      displayName: "Synthetic Racer",
      visibility: "private" as const,
    }));
    const document = new FakeDocument();
    const root = document.createElement("div");
    const mounted = mountAdministratorTimeTrialSection(
      root as unknown as HTMLElement,
      client(),
      visibility({ setForPlayer }),
    );
    await mounted.ready;
    const presence = descendants(root).find((candidate) =>
      candidate.className === "administrator-time-trials__presence")!;
    const reason = descendants(presence).find((candidate) =>
      candidate.name === "visibility_reason")!;
    // A missing or shouty reason code is refused before anything is sent.
    reason.value = "Player Request";
    presence.dispatch("submit");
    await settle();
    expect(setForPlayer).not.toHaveBeenCalled();

    descendants(presence).find((candidate) =>
      candidate.name === "player_visibility")!.value = "private";
    reason.value = "player_request";
    presence.dispatch("submit");
    await settle();
    expect(setForPlayer).toHaveBeenCalledWith(
      playerId, "private", "player_request", expect.any(AbortSignal),
    );
    expect(node(root, "Synthetic Racer is a Private Player.")).toBeDefined();
    mounted.unmount();
  });

  it("removes itself for an account that is not an administrator", async () => {
    const document = new FakeDocument();
    const root = document.createElement("div");
    const mounted = mountAdministratorTimeTrialSection(
      root as unknown as HTMLElement,
      client({
        async listForAdministrator() {
          throw new TimeTrialLifecycleClientError("forbidden");
        },
      }),
      visibility(),
    );
    await mounted.ready;
    expect(root.children).toHaveLength(0);
  });
});
