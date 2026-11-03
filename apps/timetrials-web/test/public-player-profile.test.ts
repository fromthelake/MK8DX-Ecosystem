import { describe, expect, it } from "vitest";

import type { PlayerAliasClient } from "../src/player-alias-client.js";
import type { PublicPlayerClient } from "../src/public-player-client.js";
import type { PublicTimeTrialClient } from "../src/public-time-trial-client.js";
import { mountPublicPlayerProfile } from "../src/public-player-profile.js";
import { descendants, FakeDocument } from "./dom-double.js";

describe("public Player profile", () => {
  it("renders the exact Player and reviewed aliases as text only", async () => {
    const playerId = "player.synthetic_public_page_01";
    const playerClient: PublicPlayerClient = {
      async load() {
        return {
          playerId,
          username: "SyntheticRacer",
          displayName: "<img src=x onerror=alert(1)>",
          avatarId: "character.inkling_boy",
          favoriteBodyId: "body.buggybud",
          favoriteTireId: "tire.standard",
          favoriteGliderId: "glider.super_glider",
        };
      },
    };
    const aliasClient: PlayerAliasClient = {
      async listForPlayer() {
        return {
          schemaVersion: "mk8dx.public-player-aliases.v1",
          playerId,
          aliases: [{
            aliasId: "alias.synthetic_public_page_01",
            playerId,
            aliasText: "<script>alias</script>",
            aliasType: "tournament_name",
          }],
        };
      },
    };
    const timeTrialClient: PublicTimeTrialClient = {
      async leaderboard() { throw new Error("unused"); },
      async activity() { throw new Error("unused"); },
      async listPlayer() {
        return {
          schemaVersion: "mk8dx.public-player-time-trials.v1",
          results: [{
            resultId: "user_submission.time.SYNTHETICPUBLIC01",
            revision: 1,
            playerId,
            playerUsername: "SyntheticRacer",
            playerDisplayName: "Synthetic Racer",
            trackId: "track.mario_kart_stadium",
            mode: 150,
            totalTimeMs: 94_612,
            laps: [],
            resultAtMs: 1_900_000_000_000,
            publishedAtMs: 1_900_000_001_000,
            sourceKind: "android_manual",
          }],
        };
      },
    };
    const document = new FakeDocument();
    const root = document.createElement("div");
    let pokedPlayerId: string | null = null;
    const mounted = mountPublicPlayerProfile(
      root as unknown as HTMLElement,
      playerId,
      "overview",
      playerClient,
      aliasClient,
      timeTrialClient,
      undefined,
      {
        async leaderboard() {
          return [{
            rank: 4,
            playerId,
            username: "SyntheticRacer",
            displayName: "Synthetic Racer",
            score: 27.15,
          }];
        },
      },
      undefined,
      {
        viewerPlayerId: Promise.resolve("player.viewer"),
        client: {
          async send(recipientPlayerId, kind) {
            pokedPlayerId = recipientPlayerId;
            return { engagementId: "player_engagement.test_123456", kind,
              recipientPlayerId, createdAtMs: 1_000 };
          },
          async list() { return { engagements: [], rpsStats: { played: 0, wins: 0, losses: 0, draws: 0 } }; },
          async answer() { throw new Error("not used"); },
          async conversation(otherPlayerId) {
            const open = { available: true } as const;
            return pokedPlayerId === null
              ? { playerId: otherPlayerId, accepted: true, engagements: [],
                actions: { poke: open, challenge: open, dice_roll: open, rock_paper_scissors: open } }
              : { playerId: otherPlayerId, accepted: true,
                actions: { poke: { available: false, reason: "cooldown", availableAtMs: 3_601_000 },
                  challenge: open, dice_roll: open, rock_paper_scissors: open },
                engagements: [{ engagementId: "player_engagement.test_123456", kind: "poke",
                  actorPlayerId: "player.viewer", recipientPlayerId: otherPlayerId, createdAtMs: 1_000 }] };
          },
        },
      },
    );
    await mounted.ready;
    await Promise.resolve();
    await Promise.resolve();
    const text = descendants(root).map((node) => node.textContent);
    expect(text).toContain("<img src=x onerror=alert(1)>");
    expect(text).toContain("<script>alias</script>");
    expect(text).toContain("Tournament name");
    expect(text.some((value) => value?.includes("#4 of 1 · Rating 27.15")))
      .toBe(true);
    const pageTitle = descendants(root).find((node) =>
      node.className.includes("ds-hero__title"));
    expect(pageTitle?.tagName).toBe("h1");
    expect(pageTitle?.attributes.get("id")).toBe("public-player-heading");
    expect(descendants(root).some((node) =>
      node.className.includes("ds-hero__backdrop"))).toBe(false);
    expect(descendants(root).find((node) =>
      node.className.includes("ds-hero__thumb"))
      ?.attributes.get("data-shape")).toBe("square");
    const overviewPosition = descendants(root).findIndex((node) =>
      node.textContent === "Overview");
    const preferencesPosition = descendants(root).findIndex((node) =>
      node.textContent === "Player preferences");
    expect(overviewPosition).toBeGreaterThanOrEqual(0);
    expect(preferencesPosition).toBeGreaterThan(overviewPosition);
    const tier = descendants(root).find((node) =>
      node.className.includes("ds-tier-chip"));
    expect(tier?.textContent).toBe("Champion");
    expect(tier?.style.values.get("--ds-tier-colour")).toBe("#F59E0B");
    const favoriteImages = descendants(root)
      .filter((node) => node.tagName === "img")
      .map((node) => node.src);
    expect(favoriteImages.some((source) =>
      source.includes("body_variant.buggybud.000_blue.png")))
      .toBe(true);
    expect(favoriteImages.some((source) =>
      source.includes("glider_variant.super_glider.012_inkling_m.png")))
      .toBe(true);
    // Time Trials live on their own profile tab, deep-linkable.
    expect(descendants(root).find((node) => node.textContent === "Time Trials")
      ?.attributes.get("href"))
      .toBe("/?player=SyntheticRacer&tab=timetrials");
    expect(descendants(root).some((node) => node.tagName === "script"))
      .toBe(false);
    // "You and <Player>": the panel lives directly below the section tabs.
    for (let step = 0; step < 12; step += 1) { await Promise.resolve(); }
    const panel = descendants(root).find((node) => node.className.includes("ds-interactions") &&
      node.attributes.get("id") === "interactions");
    expect(panel).toBeDefined();
    expect(descendants(panel!).some((node) => node.textContent === "Your interactions will appear here.")).toBe(true);
    const poke = descendants(panel!).find((node) =>
      node.tagName === "button" && node.textContent === "Poke");
    poke?.click();
    for (let step = 0; step < 12; step += 1) { await Promise.resolve(); }
    expect(pokedPlayerId).toBe(playerId);
    const panelText = descendants(panel!).map((node) => node.textContent);
    expect(panelText).toContain("Poke sent. <img src=x onerror=alert(1)> gets a notification.");
    expect(panelText).toContain("You poked <img src=x onerror=alert(1)>");
    // The Poke card says what was sent and when the next one is possible.
    expect(panelText.some((value) => value?.startsWith("You poked <img src=x onerror=alert(1)> ")
      && value.includes("next one at "))).toBe(true);
    expect(descendants(panel!).find((node) => node.tagName === "button" && node.textContent === "Poke")
      ?.attributes.has("disabled")).toBe(true);
    mounted.unmount();
    expect(root.children).toHaveLength(0);

    const trialsRoot = document.createElement("div");
    const trials = mountPublicPlayerProfile(
      trialsRoot as unknown as HTMLElement,
      playerId,
      "timetrials",
      playerClient,
      aliasClient,
      timeTrialClient,
    );
    await trials.ready;
    const trialsText = descendants(trialsRoot).map((node) => node.textContent);
    expect(trialsText).toContain("Verified Time Trials");
    expect(trialsText).toContain("1:34.612");
    expect(trialsText).not.toContain("Player preferences");
    // The design-system row keeps the exact engine in text and in its semantic marker.
    expect(descendants(trialsRoot)
      .find((node) => node.classList.contains("ds-profile-results__track"))
      ?.attributes.get("href"))
      .toBe("/?leaderboard=track.mario_kart_stadium&mode=150");
    expect(descendants(trialsRoot).some((node) =>
      node.classList.contains("ds-engine-mark") &&
      node.attributes.get("data-engine") === "150"))
      .toBe(true);
    trials.unmount();
  });
});
