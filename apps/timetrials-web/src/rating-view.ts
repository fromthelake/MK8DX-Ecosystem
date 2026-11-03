// Public MK8DX ranking: rank, Player, and conservative skill score —
// the behavioral continuation of the legacy public ranking (ADR-0154).

import { createPlayerClaimClient } from "./player-claim-client.js";
import { disambiguatedName, repeatedDisplayNames } from "./name-disambiguation.js";

export const PUBLIC_RATING_LEADERBOARD_PATH = "/v1/public/rating-leaderboard";

const maximumResponseBytes = 65_536;
const playerIdPattern = /^player\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

export class RatingClientError extends Error {
  public constructor(
    public readonly code: "unavailable" | "invalid_response",
  ) {
    super("The public ranking could not be loaded.");
    this.name = "RatingClientError";
  }
}

export type PublicRatingEntry = Readonly<{
  rank: number;
  playerId: string;
  username: string;
  displayName: string;
  score: number;
}>;

export interface RatingClient {
  leaderboard(signal?: AbortSignal): Promise<readonly PublicRatingEntry[]>;
}

type FetchPort = (input: string, init: RequestInit) => Promise<Response>;

/**
 * The public rating leaderboard is the same document for everybody and only
 * moves when a Tournament is finalized, yet Compare, the Tournament ranking and
 * the Player page each asked for it again on arrival. It is read once per page
 * session and reused; a finalized Tournament is a full reload away, and the
 * ranking pages that show it live still refresh on their own.
 */
let sharedLeaderboard: Promise<readonly PublicRatingEntry[]> | null = null;

/** Drop the shared answer; used after anything that can move the ratings. */
export function forgetSharedRatingLeaderboard(): void { sharedLeaderboard = null; }

export function createRatingClient(
  fetchPort: FetchPort = globalThis.fetch.bind(globalThis),
): RatingClient {
  const load = async (signal?: AbortSignal): Promise<readonly PublicRatingEntry[]> => {
      let response: Response;
      try {
        response = await fetchPort(PUBLIC_RATING_LEADERBOARD_PATH, {
          method: "GET",
          credentials: "same-origin",
          mode: "same-origin",
          redirect: "error",
          referrerPolicy: "same-origin",
          cache: "no-store",
          headers: { Accept: "application/json" },
          ...(signal === undefined ? {} : { signal }),
        });
      } catch {
        throw new RatingClientError("unavailable");
      }
      if (response.status !== 200) {
        throw new RatingClientError(
          response.status >= 500 ? "unavailable" : "invalid_response",
        );
      }
      const text = await response.text();
      if (text.length > maximumResponseBytes) {
        throw new RatingClientError("invalid_response");
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new RatingClientError("invalid_response");
      }
      if (typeof parsed !== "object" || parsed === null ||
        Array.isArray(parsed)) {
        throw new RatingClientError("invalid_response");
      }
      const root = parsed as Record<string, unknown>;
      if (root["schemaVersion"] !== "mk8dx.public-rating-leaderboard.v1" ||
        !Array.isArray(root["entries"]) || root["entries"].length > 200) {
        throw new RatingClientError("invalid_response");
      }
      return root["entries"].map((value): PublicRatingEntry => {
        if (typeof value !== "object" || value === null) {
          throw new RatingClientError("invalid_response");
        }
        const entry = value as Record<string, unknown>;
        const { rank, playerId, username, displayName, score } = entry;
        if (typeof rank !== "number" || !Number.isSafeInteger(rank) ||
          rank < 1 || typeof playerId !== "string" ||
          !playerIdPattern.test(playerId) || typeof username !== "string" ||
          username.length === 0 || username.length > 64 ||
          typeof displayName !== "string" || displayName.length === 0 ||
          displayName.length > 128 || typeof score !== "number" ||
          !Number.isFinite(score)) {
          throw new RatingClientError("invalid_response");
        }
        return { rank, playerId, username, displayName, score };
      });
  };
  return {
    async leaderboard() {
      if (sharedLeaderboard === null) {
        // The caller that asks first must not be able to cancel the answer the
        // others are waiting for, so the shared read carries no signal.
        sharedLeaderboard = load().catch((error: unknown) => {
          sharedLeaderboard = null;
          throw error;
        });
      }
      return sharedLeaderboard;
    },
  };
}

export type MountedRatingLeaderboard = Readonly<{
  container: HTMLElement;
  ready: Promise<void>;
  unmount(): void;
}>;

async function defaultOwnPlayerId(): Promise<string | null> {
  try {
    const claims = await createPlayerClaimClient().listMine();
    return claims.find(
      (claim) => claim.claimStatus === "verified",
    )?.playerId ?? null;
  } catch {
    return null;
  }
}

export function mountRatingLeaderboard(
  root: HTMLElement,
  client: RatingClient = createRatingClient(),
  loadOwnPlayerId: () => Promise<string | null> = defaultOwnPlayerId,
): MountedRatingLeaderboard {
  const document = root.ownerDocument;
  const controller = new AbortController();
  let disposed = false;
  const container = document.createElement("section");
  container.className = "public-rating";
  const heading = document.createElement("h2");
  heading.textContent = "MK8DX Ranking";
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  status.textContent = "Loading the ranking…";
  const list = document.createElement("ol");
  list.className = "public-rating__list";
  container.append(heading, status, list);
  root.append(container);

  // A signed-in Player's own row is highlighted (best effort; the
  // public ranking never requires a session).
  const ownPlayerId = loadOwnPlayerId().catch(() => null);
  const ready = Promise.all([
    client.leaderboard(controller.signal),
    ownPlayerId,
  ]).then(([entries, selfPlayerId]) => {
    if (disposed) { return; }
    status.textContent = entries.length === 0
      ? "No rated Players yet."
      : "Skill scores after the most recent rated races.";
    // ADR-0218: two Players may share a name; the ranking then shows whose is whose.
    const repeated = repeatedDisplayNames(entries);
    for (const entry of entries) {
      const row = document.createElement("li");
      row.className = entry.playerId === selfPlayerId
        ? "public-rating__row public-rating__row--self"
        : "public-rating__row";
      const rank = document.createElement("span");
      rank.className = "public-rating__rank";
      rank.textContent = `${entry.rank}.`;
      const player = document.createElement("a");
      player.setAttribute(
        "href",
        `/?player=${encodeURIComponent(entry.playerId)}`,
      );
      player.className = "tt-auth__link public-rating__player";
      player.textContent = disambiguatedName(entry, repeated);
      player.title = `@${entry.username}`;
      player.setAttribute(
        "aria-label",
        `${entry.displayName}, @${entry.username}`,
      );
      const score = document.createElement("span");
      score.className = "public-rating__score";
      score.textContent = entry.score.toFixed(2);
      row.append(rank, player, score);
      list.append(row);
    }
  }).catch(() => {
    if (!disposed) {
      status.textContent = "The ranking could not be loaded. Retry later.";
    }
  });

  return {
    container,
    ready,
    unmount(): void {
      if (disposed) { return; }
      disposed = true;
      controller.abort();
      if (container.parentNode === root) { root.removeChild(container); }
    },
  };
}
