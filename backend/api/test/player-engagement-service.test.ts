import { describe, expect, it } from "vitest";

import {
  ENGAGEMENT_COOLDOWN_MS,
  ENGAGEMENT_MAX_PER_RECIPIENT,
  PlayerEngagementError,
  PlayerEngagementService,
  type EngagementAcceptScope,
  type EngagementRecord,
  type GameReply,
  type PlayerEngagementRepository,
} from "../src/social/player-engagement-service.js";
import type { ActorContext } from "../src/identity/types.js";

const actor = { role: "account", userAccountId: "user_account.ben" } as ActorContext;

function repository(overrides: Partial<PlayerEngagementRepository> = {}) {
  const recorded: EngagementRecord[] = [];
  const base: PlayerEngagementRepository = {
    verifiedPlayerId: async () => "player.ben",
    playerExists: async () => true,
    hasVerifiedAccount: async () => true,
    acceptScope: async (): Promise<EngagementAcceptScope> => "all",
    isRivalOf: async () => false,
    recentFromActor: async () => [],
    countForRecipient: async () => 0,
    publishedBest: async () => 71_506,
    listForPlayer: async () => recorded,
    listBetween: async () => recorded,
    rpsStats: async () => ({ played: 0, wins: 0, losses: 0, draws: 0 }),
    answerGame: async () => null,
    record: async (engagement) => { recorded.push(engagement); },
    ...overrides,
  };
  return { repository: base, recorded };
}

function service(overrides: Partial<PlayerEngagementRepository> = {}, nowMs = 1_000) {
  const { repository: store, recorded } = repository(overrides);
  let sequence = 0;
  return {
    recorded,
    service: new PlayerEngagementService(
      store,
      { nowMs: () => nowMs },
      { newEngagementId: () => `player_engagement.test_${(sequence += 1)}` },
      { roll: () => 6 },
    ),
  };
}

const poke = { kind: "poke", recipientPlayerId: "player.nova" } as const;

describe("one Player poking another", () => {
  it("records the poke with both Players and the moment", async () => {
    const { service: subject, recorded } = service();
    const engagement = await subject.send(actor, poke);
    expect(engagement).toMatchObject({
      kind: "poke", actorPlayerId: "player.ben", recipientPlayerId: "player.nova",
      createdAtMs: 1_000,
    });
    expect(recorded).toHaveLength(1);
  });

  it("refuses a visitor and an account with no verified Player", async () => {
    const anonymous = { role: "anonymous" } as ActorContext;
    await expect(service().service.send(anonymous, poke))
      .rejects.toThrow(PlayerEngagementError);
    await expect(service({ verifiedPlayerId: async () => null }).service.send(actor, poke))
      .rejects.toMatchObject({ failure: "no_verified_player" });
  });

  it("refuses poking yourself and poking somebody who is not there", async () => {
    await expect(
      service().service.send(actor, { kind: "poke", recipientPlayerId: "player.ben" }),
    ).rejects.toMatchObject({ failure: "self_engagement" });
    await expect(
      service({ playerExists: async () => false }).service.send(actor, poke),
    ).rejects.toMatchObject({ failure: "recipient_not_found" });
  });

  it("honours the recipient's own choice about who may reach them", async () => {
    await expect(service({ acceptScope: async () => "none" }).service.send(actor, poke))
      .rejects.toMatchObject({ failure: "not_accepted" });
    await expect(
      service({ acceptScope: async () => "rivals", isRivalOf: async () => false })
        .service.send(actor, poke),
    ).rejects.toMatchObject({ failure: "not_accepted" });
    await expect(
      service({ acceptScope: async () => "rivals", isRivalOf: async () => true })
        .service.send(actor, poke),
    ).resolves.toMatchObject({ kind: "poke" });
  });

  it("allows one poke an hour to the same Player and says when the next one is free", async () => {
    const earlier: EngagementRecord = {
      engagementId: "player_engagement.test_000001", kind: "poke",
      actorPlayerId: "player.ben", recipientPlayerId: "player.nova", createdAtMs: 400_000,
    };
    const since: number[] = [];
    await expect(service({
      recentFromActor: async (_a, _r, kind, sinceMs) => { since.push(sinceMs); return kind === "poke" ? [earlier] : []; },
    }, 1_000_000).service.send(actor, poke)).rejects.toMatchObject({ failure: "cooldown" });
    expect(since).toEqual([1_000_000 - ENGAGEMENT_COOLDOWN_MS]);
    const { service: subject } = service({
      recentFromActor: async (_a, _r, kind) => kind === "poke" ? [earlier] : [],
    }, 1_000_000);
    const conversation = await subject.conversation(actor, "player.nova");
    expect(conversation.actions.poke).toEqual({
      available: false, reason: "cooldown", availableAtMs: 400_000 + ENGAGEMENT_COOLDOWN_MS,
    });
    // Every other kind is its own rule and stays open.
    expect(conversation.actions.challenge).toEqual({ available: true });
    expect(conversation.actions.dice_roll).toEqual({ available: true });
    await expect(subject.send(actor, { kind: "dice_roll", recipientPlayerId: "player.nova" }))
      .resolves.toMatchObject({ detail: { face: 6, duel: true } });
  });

  it("holds the crowd to the recipient's daily cap", async () => {
    await expect(
      service({ countForRecipient: async () => ENGAGEMENT_MAX_PER_RECIPIENT })
        .service.send(actor, poke),
    ).rejects.toMatchObject({ failure: "recipient_limit_reached" });
    await expect(
      service({ countForRecipient: async () => ENGAGEMENT_MAX_PER_RECIPIENT - 1 })
        .service.send(actor, poke),
    ).resolves.toMatchObject({ kind: "poke" });
  });
});

describe("games wait for their answer", () => {
  const game = (kind: "rock_paper_scissors" | "dice_roll", detail: EngagementRecord["detail"]): EngagementRecord => ({
    engagementId: `player_engagement.test_${kind}`, kind,
    actorPlayerId: "player.ben", recipientPlayerId: "player.nova", createdAtMs: 900, ...(detail === undefined ? {} : { detail }),
  });
  const withRecent = (records: readonly EngagementRecord[]) =>
    service({ recentFromActor: async (_a, _r, kind) => records.filter((record) => record.kind === kind) });

  it("refuses a new game while the last one is unanswered, and names it", async () => {
    const open = game("rock_paper_scissors", { hand: "rock" });
    await expect(withRecent([open]).service.send(actor, {
      kind: "rock_paper_scissors", recipientPlayerId: "player.nova", detail: { hand: "paper" },
    })).rejects.toMatchObject({ failure: "awaiting_answer" });
    const conversation = await withRecent([open]).service.conversation(actor, "player.nova");
    expect(conversation.actions.rock_paper_scissors).toEqual({
      available: false, reason: "awaiting_answer", engagementId: open.engagementId,
    });
  });

  it("lets the next game start once answered, and never waits on a pre-duel roll", async () => {
    const answered = game("rock_paper_scissors", { hand: "rock", recipientHand: "paper", outcome: "recipient", respondedAtMs: 950 });
    await expect(withRecent([answered]).service.send(actor, {
      kind: "rock_paper_scissors", recipientPlayerId: "player.nova", detail: { hand: "paper" },
    })).resolves.toMatchObject({ kind: "rock_paper_scissors" });
    const oneWayRoll = game("dice_roll", { face: 3 });
    await expect(withRecent([oneWayRoll]).service.send(actor, { kind: "dice_roll", recipientPlayerId: "player.nova" }))
      .resolves.toMatchObject({ kind: "dice_roll" });
    const openDuel = game("dice_roll", { face: 3, duel: true });
    await expect(withRecent([openDuel]).service.send(actor, { kind: "dice_roll", recipientPlayerId: "player.nova" }))
      .rejects.toMatchObject({ failure: "awaiting_answer" });
  });
});

describe("the games that will sit on the same rails", () => {
  it("takes a thrown hand, rolls the die on the server, and uses a published best", async () => {
    const subject = service().service;
    await expect(subject.send(actor, {
      kind: "rock_paper_scissors", recipientPlayerId: "player.nova",
      detail: { hand: "rock" },
    })).resolves.toMatchObject({ kind: "rock_paper_scissors" });
    await expect(subject.send(actor, {
      kind: "dice_roll", recipientPlayerId: "player.nova",
    })).resolves.toMatchObject({ kind: "dice_roll", detail: { face: 6, duel: true } });
    await expect(subject.send(actor, {
      kind: "challenge", recipientPlayerId: "player.nova",
      detail: { trackId: "track.baby_park", mode: 150 },
    })).resolves.toMatchObject({ kind: "challenge", detail: { totalTimeMs: 71_506 } });
  });

  it("refuses client-chosen rolls, fabricated times and unavailable published bests", async () => {
    const subject = service().service;
    for (const face of [0, 7, 2.5]) {
      await expect(subject.send(actor, {
        kind: "dice_roll", recipientPlayerId: "player.nova", detail: { face },
      })).rejects.toMatchObject({ failure: "invalid_detail" });
    }
    await expect(subject.send(actor, {
      kind: "rock_paper_scissors", recipientPlayerId: "player.nova",
      detail: { hand: "lizard" as never },
    })).rejects.toMatchObject({ failure: "invalid_detail" });
    await expect(subject.send(actor, {
      kind: "challenge", recipientPlayerId: "player.nova",
      detail: { trackId: "track.baby_park", mode: 150 },
    })).resolves.toMatchObject({ detail: { totalTimeMs: 71_506 } });
    await expect(subject.send(actor, {
      kind: "challenge", recipientPlayerId: "player.nova",
      detail: { trackId: "track.baby_park", mode: 150, totalTimeMs: 1 },
    })).rejects.toMatchObject({ failure: "invalid_detail" });
    await expect(service({ publishedBest: async () => null }).service.send(actor, {
      kind: "challenge", recipientPlayerId: "player.nova",
      detail: { trackId: "track.baby_park", mode: 150 },
    })).rejects.toMatchObject({ failure: "invalid_detail" });
  });

  it("keeps a poke a poke: it carries nothing", async () => {
    await expect(service().service.send(actor, {
      kind: "poke", recipientPlayerId: "player.nova", detail: { face: 6 },
    })).rejects.toMatchObject({ failure: "invalid_detail" });
  });

  it("checks the payload before it looks anything up", async () => {
    let lookups = 0;
    const { service: subject } = service({
      verifiedPlayerId: async () => { lookups += 1; return "player.ben"; },
    });
    await expect(subject.send(actor, {
      kind: "dice_roll", recipientPlayerId: "player.nova", detail: { face: 9 },
    })).rejects.toMatchObject({ failure: "invalid_detail" });
    expect(lookups).toBe(0);
  });
});

describe("rock-paper-scissors reply", () => {
  it("hides the sender's hand until the recipient answers", async () => {
    const pending: EngagementRecord = {
      engagementId: "player_engagement.test_123456", kind: "rock_paper_scissors",
      actorPlayerId: "player.nova", recipientPlayerId: "player.ben",
      detail: { hand: "rock" }, createdAtMs: 1_000,
    };
    const subject = service({ listForPlayer: async () => [pending] }).service;
    const visible = await subject.list(actor);
    expect(visible.engagements[0]).not.toHaveProperty("detail");
  });

  it("returns the completed game and rejects an unrelated account", async () => {
    const finished: EngagementRecord = {
      engagementId: "player_engagement.test_123456", kind: "rock_paper_scissors",
      actorPlayerId: "player.nova", recipientPlayerId: "player.ben",
      detail: { hand: "rock", recipientHand: "paper", outcome: "recipient", respondedAtMs: 1_000 },
      createdAtMs: 900,
    };
    await expect(service({ answerGame: async () => finished }).service.answer(
      actor, finished.engagementId, "paper",
    )).resolves.toEqual(finished);
    await expect(service().service.answer(actor, finished.engagementId, "paper"))
      .rejects.toMatchObject({ failure: "engagement_not_found" });
  });

  it("answers a dice duel with the server's roll, never a client's", async () => {
    const replies: GameReply[] = [];
    const subject = service({
      answerGame: async (_id, _recipient, reply) => {
        replies.push(reply);
        return {
          engagementId: "player_engagement.test_123456", kind: "dice_roll",
          actorPlayerId: "player.nova", recipientPlayerId: "player.ben",
          detail: { face: 2, duel: true, recipientFace: 6, outcome: "recipient", respondedAtMs: 1_000 },
          createdAtMs: 900,
        };
      },
    }).service;
    await expect(subject.answer(actor, "player_engagement.test_123456")).resolves
      .toMatchObject({ detail: { recipientFace: 6, outcome: "recipient" } });
    expect(replies).toEqual([{ kind: "dice_roll", face: 6 }]);
  });
});

describe("the conversation with one Player", () => {
  it("hides an open hand from its recipient and closes everything when not accepted", async () => {
    const invite: EngagementRecord = {
      engagementId: "player_engagement.test_777777", kind: "rock_paper_scissors",
      actorPlayerId: "player.nova", recipientPlayerId: "player.ben",
      detail: { hand: "rock" }, createdAtMs: 900,
    };
    const open = await service({ listBetween: async () => [invite] }).service.conversation(actor, "player.nova");
    expect(open.accepted).toBe(true);
    expect(open.engagements[0]).not.toHaveProperty("detail");
    const closed = await service({ acceptScope: async () => "none" }).service.conversation(actor, "player.nova");
    expect(closed.accepted).toBe(false);
    expect(Object.values(closed.actions).every((action) => action.reason === "not_accepted")).toBe(true);
    await expect(service().service.conversation(actor, "player.ben"))
      .rejects.toMatchObject({ failure: "self_engagement" });
  });
});

describe("a Player nobody can notify", () => {
  it("is refused with a reason instead of a silent send", async () => {
    const unclaimed = service({ hasVerifiedAccount: async () => false });
    await expect(unclaimed.service.send(actor, poke)).rejects.toMatchObject({ failure: "recipient_unreachable" });
    const conversation = await unclaimed.service.conversation(actor, "player.nova");
    expect(conversation.accepted).toBe(false);
    expect(Object.values(conversation.actions).every((action) => action.reason === "no_account")).toBe(true);
  });
});
