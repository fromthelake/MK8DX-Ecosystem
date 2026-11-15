import { afterEach, describe, expect, it } from "vitest";

import { claimLimitMessage } from "../src/claim-limit-message.js";
import { createClaimWalkClient } from "../src/claim-walk-client.js";
import { createPlayerClaimClient, PlayerClaimClientError } from "../src/player-claim-client.js";
import { setProductLanguage } from "../src/product-language.js";

const storage = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string): string | null => storage.get(key) ?? null,
    setItem: (key: string, value: string): void => { storage.set(key, value); },
  },
});

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json", ...headers },
});
const csrf = { schemaVersion: "mk8dx.web-csrf.v1", headerName: "X-MK8DX-CSRF", value: "synthetic-proof" };
const playerId = "player.synthetic_claim_limit";

function claimClient(answer: () => Response) {
  return createPlayerClaimClient(async (path) => String(path) === "/v1/session/csrf" ? json(csrf) : answer());
}

afterEach(() => { setProductLanguage("en"); });

describe("claim limits (H1) in the web claim screens", () => {
  it("reads 429 with Retry-After and turns it into a wait time", async () => {
    const refused = claimClient(() => json({ code: "claim_rate_limited", message: "Wait." }, 429, { "retry-after": "1500" }));
    const error = await refused.request(playerId).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PlayerClaimClientError);
    expect(error).toMatchObject({ code: "rate_limited", retryAfterSeconds: 1500 });
    expect(claimLimitMessage(error)).toBe("Too many claim actions at the moment. Please try again in 25 minutes.");
    expect(claimLimitMessage(new PlayerClaimClientError("rate_limited", 30)))
      .toBe("Too many claim actions at the moment. Please try again in a minute.");
    expect(claimLimitMessage(new PlayerClaimClientError("rate_limited", 7200)))
      .toBe("Too many claim actions at the moment. Please try again in 2 hours.");
    expect(claimLimitMessage(new PlayerClaimClientError("rate_limited")))
      .toBe("Too many claim actions at the moment. Please try again later.");
  });

  it("reads 409 claim_quota_exceeded as the claim limit, other conflicts stay conflicts", async () => {
    const quota = claimClient(() => json({ code: "claim_quota_exceeded", message: "The claim limit was reached." }, 409));
    const error = await quota.request(playerId).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: "quota_exceeded" });
    expect(claimLimitMessage(error)).toContain("limit for Player claims");
    const conflict = claimClient(() => json({ code: "claim_conflict", message: "Changed." }, 409));
    const other = await conflict.request(playerId).catch((caught: unknown) => caught);
    expect(other).toMatchObject({ code: "conflict" });
    expect(claimLimitMessage(other)).toBeNull();
  });

  it("does the same for claim replies, in Dutch too", async () => {
    setProductLanguage("nl");
    const walk = createClaimWalkClient(async (path) => String(path) === "/v1/session/csrf"
      ? json(csrf)
      : json({ code: "claim_rate_limited", message: "Wait." }, 429, { "retry-after": "120" }));
    const error = await walk.reply("player_claim.synthetic", "Hello").catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: "rate_limited", retryAfterSeconds: 120 });
    expect(claimLimitMessage(error)).toBe("Te veel claimacties op dit moment. Probeer het over 2 minuten opnieuw.");
    const full = createClaimWalkClient(async (path) => String(path) === "/v1/session/csrf"
      ? json(csrf) : json({ code: "claim_quota_exceeded", message: "Limit." }, 409));
    const quota = await full.reply("player_claim.synthetic", "Hello").catch((caught: unknown) => caught);
    expect(claimLimitMessage(quota)).toContain("limiet voor spelersclaims");
  });
});
