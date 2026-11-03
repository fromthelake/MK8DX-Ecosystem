import Fastify from "fastify";
import { describe, expect, it } from "vitest";

import { registerPlayerEngagementRoutes } from "../src/social/player-engagement-routes.js";
import { PlayerEngagementError } from "../src/social/player-engagement-service.js";
import type { PlayerEngagementService } from "../src/social/player-engagement-service.js";

const actor = { role: "account", userAccountId: "user_account.ben" } as const;

async function fixture() {
  const calls: unknown[] = [];
  const service = {
    async send(_actor: unknown, request: unknown) {
      if ((request as { detail?: { face?: number } }).detail?.face !== undefined) {
        throw new PlayerEngagementError("invalid_detail");
      }
      calls.push(request);
      return {
        engagementId: "player_engagement.test_123456", kind: "dice_roll",
        actorPlayerId: "player.ben", recipientPlayerId: "player.nova",
        detail: { face: 4 }, createdAtMs: 1_000,
      };
    },
    async list() { return { rpsStats: { played: 1, wins: 1, losses: 0, draws: 0 }, engagements: [{
      engagementId: "player_engagement.test_123456", kind: "rock_paper_scissors",
      actorPlayerId: "player.nova", recipientPlayerId: "player.ben",
      createdAtMs: 1_000,
    }] }; },
    async answer(_actor: unknown, _id: string, hand?: string) {
      calls.push({ answered: hand ?? "dice" });
      return hand === undefined ? {
        engagementId: "player_engagement.test_123456", kind: "dice_roll",
        actorPlayerId: "player.nova", recipientPlayerId: "player.ben",
        detail: { face: 2, duel: true, recipientFace: 5, outcome: "recipient", respondedAtMs: 2_000 },
        createdAtMs: 1_000,
      } : {
        engagementId: "player_engagement.test_123456", kind: "rock_paper_scissors",
        actorPlayerId: "player.nova", recipientPlayerId: "player.ben",
        detail: { hand: "rock", recipientHand: "paper", outcome: "recipient" },
        createdAtMs: 1_000,
      };
    },
    async conversation(_actor: unknown, playerId: string) {
      if (playerId === "player.busy") { throw new PlayerEngagementError("cooldown"); }
      return {
        playerId, accepted: true,
        actions: {
          poke: { available: false, reason: "cooldown", availableAtMs: 3_601_000 },
          challenge: { available: true },
          dice_roll: { available: true },
          rock_paper_scissors: { available: false, reason: "awaiting_answer", engagementId: "player_engagement.test_654321" },
        },
        engagements: [{
          engagementId: "player_engagement.test_654321", kind: "rock_paper_scissors",
          actorPlayerId: "player.ben", recipientPlayerId: playerId,
          actorDisplayName: "Ben", recipientDisplayName: "Nova",
          detail: { hand: "scissors" }, createdAtMs: 1_000,
        }],
      };
    },
  } as unknown as Pick<PlayerEngagementService, "send" | "list" | "answer" | "conversation">;
  const app = Fastify();
  await registerPlayerEngagementRoutes(app, {
    resolveActor: async () => actor,
    service,
    csrfVerifier: { verify: async (_actor, proof) => proof === "test-proof" },
  });
  return { app, calls };
}

describe("Player engagement API", () => {
  it("returns the server-rolled face and rejects a client-selected face", async () => {
    const { app, calls } = await fixture();
    const send = await app.inject({
      method: "POST", url: "/v1/players/player.nova/engagements",
      headers: { "x-mk8dx-csrf": "test-proof" },
      payload: { kind: "dice_roll" },
    });
    expect(send.statusCode).toBe(201);
    expect(send.json().detail.face).toBe(4);
    const forged = await app.inject({
      method: "POST", url: "/v1/players/player.nova/engagements",
      headers: { "x-mk8dx-csrf": "test-proof" },
      payload: { kind: "dice_roll", detail: { face: 6 } },
    });
    expect(forged.statusCode).toBe(400);
    expect(calls).toHaveLength(1);
    await app.close();
  });

  it("requires CSRF for a reply and exposes the returned result", async () => {
    const { app } = await fixture();
    const url = "/v1/player-engagements/player_engagement.test_123456/reply";
    const refused = await app.inject({ method: "POST", url, payload: { hand: "paper" } });
    expect(refused.statusCode).toBe(401);
    const answered = await app.inject({ method: "POST", url,
      headers: { "x-mk8dx-csrf": "test-proof" }, payload: { hand: "paper" } });
    expect(answered.statusCode).toBe(200);
    expect(answered.json().engagement.detail.outcome).toBe("recipient");
    const list = await app.inject({ method: "GET", url: "/v1/player-engagements" });
    expect(list.statusCode).toBe(200);
    expect(list.json().engagements).toHaveLength(1);
    expect(list.json().rpsStats.wins).toBe(1);
    await app.close();
  });

  it("answers a dice duel with an empty body and a server roll", async () => {
    const { app, calls } = await fixture();
    const answered = await app.inject({
      method: "POST", url: "/v1/player-engagements/player_engagement.test_123456/reply",
      headers: { "x-mk8dx-csrf": "test-proof" }, payload: {},
    });
    expect(answered.statusCode).toBe(200);
    expect(answered.json().engagement.detail).toMatchObject({ recipientFace: 5, outcome: "recipient" });
    expect(calls).toContainEqual({ answered: "dice" });
    await app.close();
  });

  it("returns the conversation with each action's allowance and names a refusal precisely", async () => {
    const { app } = await fixture();
    const conversation = await app.inject({ method: "GET", url: "/v1/players/player.nova/engagements" });
    expect(conversation.statusCode).toBe(200);
    expect(conversation.json()).toMatchObject({
      schemaVersion: "mk8dx.player-engagement-conversation.v1", playerId: "player.nova", accepted: true,
      actions: { poke: { available: false, reason: "cooldown", availableAtMs: 3_601_000 },
        rock_paper_scissors: { reason: "awaiting_answer" } },
    });
    expect(conversation.json().engagements).toHaveLength(1);
    const refused = await app.inject({ method: "GET", url: "/v1/players/player.busy/engagements" });
    expect(refused.statusCode).toBe(429);
    expect(refused.json().code).toBe("engagement_cooldown");
    await app.close();
  });
});
