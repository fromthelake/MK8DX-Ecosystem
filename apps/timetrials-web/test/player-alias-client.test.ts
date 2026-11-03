import { describe, expect, it, vi } from "vitest";

import {
  createPlayerAliasClient,
  PlayerAliasClientError,
} from "../src/player-alias-client.js";

const playerId = "player.synthetic_profile_01";
const document = {
  schemaVersion: "mk8dx.public-player-aliases.v1",
  playerId,
  aliases: [{
    aliasId: "alias.synthetic_profile_01",
    playerId,
    aliasText: "Synthetic Racer",
    aliasType: "tournament_name",
  }],
} as const;

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("same-origin public Player Alias client", () => {
  it("loads an exact bounded public projection without JavaScript credentials", async () => {
    const fetchPort = vi.fn(async () => response(document));
    await expect(createPlayerAliasClient(fetchPort).listForPlayer(playerId))
      .resolves.toEqual(document);
    expect(fetchPort).toHaveBeenCalledWith(
      `/v1/players/${playerId}/aliases`,
      expect.objectContaining({
        method: "GET",
        credentials: "same-origin",
        mode: "same-origin",
        redirect: "error",
        cache: "no-store",
      }),
    );
    expect(JSON.stringify(fetchPort.mock.calls)).not.toContain("Authorization");
  });

  it("rejects cross-Player aliases and extra private fields", async () => {
    const crossPlayer = createPlayerAliasClient(async () => response({
      ...document,
      aliases: [{ ...document.aliases[0], playerId: "player.someone_else" }],
    }));
    await expect(crossPlayer.listForPlayer(playerId)).rejects
      .toBeInstanceOf(PlayerAliasClientError);

    const privateField = createPlayerAliasClient(async () => response({
      ...document,
      aliases: [{ ...document.aliases[0], provenance: "private" }],
    }));
    await expect(privateField.listForPlayer(playerId)).rejects
      .toBeInstanceOf(PlayerAliasClientError);
  });

  it("rejects malformed Player identifiers before network access", async () => {
    const fetchPort = vi.fn(async () => response(document));
    await expect(createPlayerAliasClient(fetchPort).listForPlayer("../private"))
      .rejects.toBeInstanceOf(PlayerAliasClientError);
    expect(fetchPort).not.toHaveBeenCalled();
  });
});
