import { beforeEach, describe, expect, it } from "vitest";

import { useDocument } from "../src/ds-components.js";
import { setProductLanguage } from "../src/product-language.js";
import {
  describeEngagement,
  headToHead,
  isOpenGame,
  mountPlayerInteractions,
} from "../src/player-interactions-panel.js";
import type { Engagement, EngagementConversation, PlayerEngagementClient } from "../src/player-engagement-client.js";
import { notificationLink, notificationMessage } from "../src/notification-section.js";
import { descendants, FakeDocument } from "./dom-double.js";

const viewer = "player.ben";
const other = "player.matteo";
const entry = (overrides: Partial<Engagement>): Engagement => ({
  engagementId: "player_engagement.test_000001", kind: "poke",
  actorPlayerId: viewer, recipientPlayerId: other, createdAtMs: 1_000, ...overrides,
} as Engagement);

let fakeDocument: FakeDocument;

beforeEach(() => {
  fakeDocument = new FakeDocument();
  useDocument(fakeDocument as unknown as Document);
  setProductLanguage("en");
});

describe("what happened between two Players, in words", () => {
  it("reads a dice duel from each side and names the winner", () => {
    const duel = entry({ kind: "dice_roll", detail: { face: 4, duel: true, recipientFace: 6, outcome: "recipient", respondedAtMs: 2_000 } });
    expect(describeEngagement(duel, viewer, "Matteo")).toMatchObject({
      text: "You rolled 4 · Matteo rolled 6", status: { label: "Matteo won", tone: "error" },
    });
    expect(describeEngagement(duel, other, "Ben")).toMatchObject({
      text: "You rolled 6 · Ben rolled 4", status: { label: "You won", tone: "success" },
    });
    expect(describeEngagement(entry({ kind: "dice_roll", detail: { face: 3, duel: true } }), viewer, "Matteo"))
      .toMatchObject({ text: "You rolled 3 · Matteo still has to roll back", status: { label: "Waiting" } });
    expect(describeEngagement(entry({ kind: "dice_roll", actorPlayerId: other, recipientPlayerId: viewer,
      detail: { face: 5, duel: true } }), viewer, "Matteo"))
      .toMatchObject({ status: { label: "Your turn" } });
    // A roll from before duels is one-way, never waits, and says so.
    expect(isOpenGame(entry({ kind: "dice_roll", detail: { face: 2 } }))).toBe(false);
    expect(describeEngagement(entry({ kind: "dice_roll", detail: { face: 2 } }), viewer, "Matteo"))
      .toMatchObject({ text: "You rolled 2 · one-way roll from before duels", status: { label: "Old roll" } });
  });

  it("keeps an open hand hidden, then shows both hands and the result", () => {
    expect(describeEngagement(entry({ kind: "rock_paper_scissors", actorPlayerId: other, recipientPlayerId: viewer }), viewer, "Matteo"))
      .toMatchObject({ text: "Matteo threw a hidden hand · pick yours", status: { label: "Your turn" } });
    expect(describeEngagement(entry({ kind: "rock_paper_scissors",
      detail: { hand: "scissors", recipientHand: "rock", outcome: "recipient", respondedAtMs: 2_000 } }), viewer, "Matteo"))
      .toMatchObject({ text: "You threw ✂️ · Matteo threw 🪨", status: { label: "Matteo won" } });
    expect(describeEngagement(entry({ kind: "rock_paper_scissors", detail: { hand: "paper" } }), viewer, "Matteo"))
      .toMatchObject({ text: "You threw 📄 · Matteo still has to answer", status: { label: "Waiting" } });
  });

  it("counts the head-to-head from the viewer's side", () => {
    const games = [
      entry({ kind: "rock_paper_scissors", detail: { hand: "rock", recipientHand: "scissors", outcome: "actor" } }),
      entry({ kind: "rock_paper_scissors", actorPlayerId: other, recipientPlayerId: viewer,
        detail: { hand: "rock", recipientHand: "scissors", outcome: "actor" } }),
      entry({ kind: "rock_paper_scissors", detail: { hand: "rock", recipientHand: "rock", outcome: "draw" } }),
    ];
    expect(headToHead(games, viewer, "rock_paper_scissors")).toEqual({ wins: 1, losses: 1, draws: 1 });
  });
});

describe("the You and <Player> panel", () => {
  const settle = async (): Promise<void> => { for (let step = 0; step < 12; step += 1) { await Promise.resolve(); } };

  it("closes a waiting game with its reason and lets the viewer roll back on their turn", async () => {
    const open = { available: true } as const;
    let answered: string | null = null;
    let conversation: EngagementConversation = {
      playerId: other, accepted: true,
      actions: { poke: open, challenge: open, dice_roll: { available: false, reason: "awaiting_answer", engagementId: "player_engagement.test_000009" },
        rock_paper_scissors: open },
      engagements: [
        entry({ engagementId: "player_engagement.test_000008", kind: "dice_roll", actorPlayerId: other, recipientPlayerId: viewer,
          actorDisplayName: "Matteo", detail: { face: 2, duel: true } }),
        entry({ engagementId: "player_engagement.test_000009", kind: "dice_roll", detail: { face: 4, duel: true } }),
      ],
    };
    const client: PlayerEngagementClient = {
      async send() { throw new Error("unused"); },
      async list() { throw new Error("unused"); },
      async answer(id, hand) {
        answered = `${id}:${hand ?? "dice"}`;
        const result = entry({ engagementId: id, kind: "dice_roll", actorPlayerId: other, recipientPlayerId: viewer,
          detail: { face: 2, duel: true, recipientFace: 5, outcome: "recipient", respondedAtMs: 3_000 } });
        conversation = { ...conversation, engagements: [result, conversation.engagements[1]!] };
        return result;
      },
      async conversation() { return conversation; },
    };
    const mounted = mountPlayerInteractions(fakeDocument as unknown as Document, {
      player: { playerId: other, displayName: "Matteo" }, viewerPlayerId: viewer, client,
      loadBests: async () => [], nowMs: () => 10_000,
    });
    await mounted.ready;
    const text = (): string[] => descendants(mounted.root as never).map((node) => node.textContent ?? "");
    // The dice card shows the die that is waiting, not only that something is.
    expect(text().some((value) => value.startsWith("You rolled 4 ") && value.endsWith("waiting for Matteo to roll back."))).toBe(true);
    const rollDice = descendants(mounted.root as never).find((node) => node.tagName === "button" && node.textContent === "Roll the dice");
    expect(rollDice?.attributes.has("disabled")).toBe(true);
    const rollBack = descendants(mounted.root as never).find((node) => node.tagName === "button" && node.textContent === "🎲 Roll back");
    rollBack?.click();
    await settle();
    expect(answered).toBe("player_engagement.test_000008:dice");
    expect(text()).toContain("You rolled 5 · Matteo rolled 2 — You won");
    expect(text().some((value) => value.startsWith("You vs Matteo: Dice duels 1–0"))).toBe(true);
  });
});

describe("engagement notifications open the conversation", () => {
  const view = (kind: "dice_roll" | "rock_paper_scissors" | "poke", detail?: string) => ({
    notificationId: "7", kind, actorPlayerId: "player.matteo", actorDisplayName: "Matteo",
    count: 1, lastEventAtMs: 1_000, read: false, ...(detail === undefined ? {} : { detail }),
  }) as never;

  it("links games and pokes to the sender's #interactions and reads a duel", () => {
    expect(notificationLink(view("dice_roll", "4"), "player.ben")).toBe("/?player=player.matteo#interactions");
    expect(notificationLink(view("rock_paper_scissors", "invite"), "player.ben")).toBe("/?player=player.matteo#interactions");
    expect(notificationLink(view("poke"), "player.ben")).toBe("/?player=player.matteo#interactions");
    expect(notificationMessage(view("dice_roll", "4"))).toBe("Matteo rolled 4 — roll back to beat it");
    expect(notificationMessage(view("dice_roll", "6 vs 4"))).toBe("Matteo rolled 6 against your 4 — Matteo won");
    expect(notificationMessage(view("dice_roll", "3 vs 5"))).toBe("Matteo rolled 3 against your 5 — you won");
  });
});
