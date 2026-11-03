// The two boundaries the Post-a-Time task talks to, and their production implementations.
//
//   - the authenticated session for one track (the preserved manual-bootstrap + CSRF boundary);
//   - the public data the prediction is computed over (POST_A_TIME §5: the leaderboard, the
//     Player's own best and their rivals - all of it already loaded by the track page).
//
// Both are interfaces so the task can be driven against doubles in the tests without a network.

import { createPlayerClaimClient } from "./player-claim-client.js";
import { createPublicTimeTrialClient, type PublicTimeTrialClient } from "./public-time-trial-client.js";
import { createRivalClient, type RivalClient } from "./rival-settings.js";
import { fetchTrackBests } from "./mastery-view.js";
import type { BoardRow } from "./post-time-prediction.js";
import type { EngineMode } from "./post-time-model.js";
import type { PostTimeBoardClient } from "./post-time-task.js";

/**
 * What the task needs from a signed-in session: the submission context document for this track, and
 * a fresh CSRF proof at publication time. Exactly the boundary the tested manual bootstrap returns.
 */
export interface WebManualAuthenticatedSessionBoundary {
  contextJson(): unknown;
  csrfProof(signal?: AbortSignal): Promise<unknown>;
}

export function createPostTimeBoardClient(
  publicClient: PublicTimeTrialClient = createPublicTimeTrialClient(),
  rivalClient: RivalClient = createRivalClient(),
): PostTimeBoardClient {
  return {
    async leaderboard(trackId, mode, signal): Promise<readonly BoardRow[]> {
      const document = await publicClient.leaderboard(trackId, mode, signal);
      return document.results.map((result) => ({
        playerId: result.playerId,
        playerUsername: result.playerUsername,
        playerDisplayName: result.playerDisplayName,
        totalTimeMs: result.totalTimeMs,
      }));
    },
    async ownBest(playerId, trackId, mode, signal): Promise<number | null> {
      const controller = new AbortController();
      signal?.addEventListener("abort", () => controller.abort(), { once: true });
      const bests = await fetchTrackBests(playerId, controller.signal);
      return bests.find((best) => best.trackId === trackId && best.mode === mode)?.totalTimeMs ?? null;
    },
    async rivals(signal): Promise<ReadonlySet<string>> {
      const list = await rivalClient.list(signal);
      return new Set(list.map((rival) => rival.playerId));
    },
  };
}

/** The signed-in viewer's verified Player, or null. The task needs it to key drafts and the field. */
export async function verifiedPlayerId(
  signal?: AbortSignal,
  claimClient = createPlayerClaimClient(),
): Promise<string | null> {
  const claims = await claimClient.listMine(signal).catch(() => []);
  return claims.find((claim) => claim.claimStatus === "verified")?.playerId ?? null;
}

export type { EngineMode };
