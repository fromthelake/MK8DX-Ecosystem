import { describe, expect, it, vi } from "vitest";

import type { PublicTimeTrialClient } from "../src/public-time-trial-client.js";
import { appendPublicPlayerTimeTrials } from "../src/public-time-trial-view.js";
import { descendants, FakeDocument } from "./dom-double.js";

const ownResult = {
  resultId: "user_submission.time.SYNTHETICPUBLIC01",
  revision: 1,
  playerId: "player.synthetic_public_01",
  playerUsername: "SyntheticRacer",
  playerDisplayName: "Synthetic Racer",
  trackId: "track.mario_kart_stadium",
  mode: 150 as const,
  totalTimeMs: 94_612,
  laps: [],
  resultAtMs: 1_900_000_000_000,
  publishedAtMs: 1_900_000_001_000,
  sourceKind: "android_manual",
};

function historyClient(): PublicTimeTrialClient {
  return {
    async leaderboard() { throw new Error("unused"); },
    async activity() { throw new Error("unused"); },
    async listPlayer() {
      return {
        schemaVersion: "mk8dx.public-player-time-trials.v1" as const,
        results: [ownResult],
      };
    },
  };
}

describe("own Time Trial management on the profile", () => {
  it("offers Manage only on the viewer's own results", async () => {
    const document = new FakeDocument();
    for (const [ownPlayerId, expected] of [
      ["player.synthetic_public_01", 1],
      ["player.someone_else_01", 0],
      [null, 0],
    ] as const) {
      const container = document.createElement("div");
      const attachManagement = vi.fn(
        (
          _actions: HTMLElement,
          _submissionId: string,
          _applied: (totalTimeMs: number, retired: boolean) => void,
        ) => ({ unmount() {} }),
      );
      await appendPublicPlayerTimeTrials(
        container as unknown as HTMLElement,
        "player.synthetic_public_01",
        historyClient(),
        new AbortController().signal,
        {
          claimClient: {
            async listMine() {
              return ownPlayerId === null ? [] : [{
                playerClaimId: "player_claim.synthetic_public_01",
                playerId: ownPlayerId,
                playerUsername: "SyntheticRacer",
                playerDisplayName: "Synthetic Racer",
                claimStatus: "verified" as const,
                disputeStatus: "none" as const,
                updatedAtMs: 1_900_000_000_000,
              }];
            },
          },
          attachManagement,
        },
      );
      expect(attachManagement).toHaveBeenCalledTimes(expected);
      if (expected === 1) {
        expect(attachManagement.mock.calls[0]?.[1])
          .toBe("user_submission.time.SYNTHETICPUBLIC01");
        // The row agrees with what the Player just did, without a reload.
        expect(descendants(container).map((node) => node.textContent))
          .toContain("1:34.612");
        attachManagement.mock.calls[0]![2](93_000, true);
        const after = descendants(container).map((node) => node.textContent);
        expect(after).toContain("1:33.000");
        expect(after).toContain("Retired");
      }
      // The public history itself renders either way.
      expect(descendants(container).map((node) => node.textContent))
        .toContain("Verified Time Trials");
    }
  });

  it("never asks about the viewer when no management is offered", async () => {
    const document = new FakeDocument();
    const container = document.createElement("div");
    const listMine = vi.fn(async () => []);
    await appendPublicPlayerTimeTrials(
      container as unknown as HTMLElement,
      "player.synthetic_public_01",
      historyClient(),
      new AbortController().signal,
      { claimClient: { listMine } },
    );
    expect(listMine).not.toHaveBeenCalled();
  });
});
