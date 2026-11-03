import { describe, expect, it } from "vitest";

import {
  injectSocialMeta,
  socialPreviewMeta,
} from "../src/runtime/social-preview.js";

const dependencies = {
  baseUrl: "https://mariokart.example",
  async playerName(playerId: string) {
    if (playerId === "player.ben") { return "Ben"; }
    if (playerId === "player.xss") { return `<script>"x"</script>`; }
    return null;
  },
};

describe("social preview metadata", () => {
  it("renders player, leaderboard, and comparison previews", async () => {
    const player = await socialPreviewMeta(
      { player: "player.ben" },
      dependencies,
    );
    expect(player).toContain('og:title" content="Ben — MK8DX"');
    expect(player).toContain(
      "https://mariokart.example/?player=player.ben",
    );

    const board = await socialPreviewMeta(
      { leaderboard: "track.mount_wario", mode: "150" },
      dependencies,
    );
    expect(board).toContain("Mount Wario 150cc — MK8DX leaderboard");
    expect(board).toContain("/assets/images/tracks/previews/");

    const compare = await socialPreviewMeta(
      { compare: "player.ben,player.ben" },
      dependencies,
    );
    expect(compare).toContain("Ben vs Ben — MK8DX");
  });

  it("escapes player names and falls back for unknown entities", async () => {
    const escaped = await socialPreviewMeta(
      { player: "player.xss" },
      dependencies,
    );
    expect(escaped).not.toContain("<script>");
    expect(escaped).toContain("&lt;script&gt;");

    const unknown = await socialPreviewMeta(
      { player: "player.unknownghost" },
      dependencies,
    );
    expect(unknown).toContain("MK8DX Community");

    const malformed = await socialPreviewMeta(
      { player: "<injected>" },
      dependencies,
    );
    expect(malformed).toContain("MK8DX Community");
  });

  it("injects before the closing head tag and degrades gracefully", () => {
    const html = "<html><head><title>x</title></head><body></body></html>";
    const injected = injectSocialMeta(html, `<meta property="og:title">`);
    expect(injected).toContain(`<meta property="og:title">`);
    expect(injected.indexOf("og:title"))
      .toBeLessThan(injected.indexOf("</head>"));
    expect(injectSocialMeta("<no-head>", "<meta>")).toBe("<no-head>");
  });
});
