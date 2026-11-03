import { describe, expect, it, vi } from "vitest";

import {
  createPublicPlayerClient,
  PublicPlayerClientError,
} from "../src/public-player-client.js";

const playerId = "player.synthetic_public_page_01";
const profile = {
  playerId,
  username: { value: "SyntheticRacer" },
  displayName: "Synthetic Racer",
} as const;

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("same-origin public Player client", () => {
  it("loads only the exact public allow-list without a JavaScript credential", async () => {
    const fetchPort = vi.fn(async () => response(profile));
    await expect(createPublicPlayerClient(fetchPort).load(playerId)).resolves.toEqual({
      playerId,
      username: "SyntheticRacer",
      displayName: "Synthetic Racer",
    });
    expect(fetchPort).toHaveBeenCalledWith(`/v1/players/${playerId}`, expect.objectContaining({
      method: "GET",
      credentials: "same-origin",
      mode: "same-origin",
      redirect: "error",
      cache: "no-store",
    }));
    expect(JSON.stringify(fetchPort.mock.calls)).not.toContain("Authorization");
  });

  it("distinguishes missing profiles and rejects crossed or private fields", async () => {
    const missing = createPublicPlayerClient(async () => response({
      code: "identity_not_found",
      message: "Not found",
    }, 404));
    await expect(missing.load(playerId)).rejects.toMatchObject({ code: "not_found" });

    const crossed = createPublicPlayerClient(async () => response({
      ...profile,
      playerId: "player.someone_else",
    }));
    await expect(crossed.load(playerId)).rejects
      .toBeInstanceOf(PublicPlayerClientError);

    const privateField = createPublicPlayerClient(async () => response({
      ...profile,
      email: "private@example.test",
    }));
    await expect(privateField.load(playerId)).rejects
      .toBeInstanceOf(PublicPlayerClientError);
  });

  it("rejects malformed Player identifiers before network access", async () => {
    const fetchPort = vi.fn(async () => response(profile));
    await expect(createPublicPlayerClient(fetchPort).load("../private"))
      .rejects.toBeInstanceOf(PublicPlayerClientError);
    expect(fetchPort).not.toHaveBeenCalled();
  });
});
