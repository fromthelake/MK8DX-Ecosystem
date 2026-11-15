import { describe, expect, it } from "vitest";

import {
  AliasAdministrationClientError,
  aliasSourceReference,
  createAliasAdministrationClient,
} from "../src/administrator-alias-section.js";

const snapshot = {
  aliasId: "alias.synthetic_admin_client_01",
  playerId: "player.synthetic_admin_client_01",
  aliasText: "Synthetic Racer",
  aliasType: "declared",
  visibility: "public",
  recordStatus: "active",
  revision: 1,
  lastSequence: 1,
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("alias writes carry the session's same-origin proof", () => {
  it("fetches a proof and sends it with the write", async () => {
    const calls: Array<{ path: string; headers: Record<string, string> }> = [];
    const client = createAliasAdministrationClient(async (path, init) => {
      calls.push({ path, headers: { ...(init.headers as Record<string, string>) } });
      return path === "/v1/session/csrf"
        ? json({ schemaVersion: "mk8dx.web-csrf.v1", headerName: "X-MK8DX-CSRF", value: "proof-1" })
        : json(snapshot, 201);
    }, () => 1_900_000_000_000);
    await client.create({ playerId: snapshot.playerId, aliasText: "Synthetic Racer", aliasType: "declared",
      visibility: "public", sourceType: "player_declaration", sourceReference: "source.synthetic" });
    expect(calls.map((call) => call.path)).toEqual(["/v1/session/csrf", "/v1/aliases"]);
    expect(calls[1]!.headers["X-MK8DX-CSRF"]).toBe("proof-1");
  });

  it("writes without a proof where the installation offers none", async () => {
    const calls: string[] = [];
    const client = createAliasAdministrationClient(async (path) => {
      calls.push(path);
      return path === "/v1/session/csrf" ? json({ code: "not_found" }, 404) : json(snapshot);
    });
    await client.retire(snapshot.aliasId);
    expect(calls).toEqual(["/v1/session/csrf", `/v1/aliases/${snapshot.aliasId}/actions`]);
  });

  it("reports a rate limit as unavailable and a quota as a conflict", async () => {
    const answer = (status: number) => createAliasAdministrationClient(async (path) =>
      path === "/v1/session/csrf"
        ? json({ schemaVersion: "mk8dx.web-csrf.v1", headerName: "X-MK8DX-CSRF", value: "p" })
        : json({ code: "x", message: "m" }, status));
    await expect(answer(429).retire(snapshot.aliasId)).rejects.toMatchObject({ code: "unavailable" });
    await expect(answer(409).retire(snapshot.aliasId)).rejects.toBeInstanceOf(AliasAdministrationClientError);
  });
});

describe("the reviewed-alias source becomes a valid provenance identifier", () => {
  it("keeps a valid identifier and derives one from plain words", () => {
    expect(aliasSourceReference("source.tn13-workbook")).toBe("source.tn13-workbook");
    expect(aliasSourceReference("  TN13 workbook  ")).toBe("source.tn13-workbook");
    expect(aliasSourceReference("Discord-bericht van Gído, 12/11")).toBe("source.discord-bericht-van-gido-12-11");
    expect(aliasSourceReference("source.TN13 Excel")).toBe("source.tn13-excel");
    expect(aliasSourceReference("x".repeat(400))).toHaveLength(255);
  });

  it("gives no identifier for text without Latin letters or digits", () => {
    expect(aliasSourceReference("龍")).toBeNull();
    expect(aliasSourceReference("  ")).toBeNull();
    expect(aliasSourceReference("--")).toBeNull();
  });

  it("refuses a free-text source before any request instead of a 400 from the API", async () => {
    const calls: string[] = [];
    const client = createAliasAdministrationClient(async (path) => { calls.push(path); return json(snapshot, 201); });
    await expect(client.create({ playerId: snapshot.playerId, aliasText: "Synthetic Racer", aliasType: "declared",
      visibility: "public", sourceType: "administrator", sourceReference: "TN13 workbook" }))
      .rejects.toMatchObject({ code: "invalid_input", detail: "sourceReference" });
    expect(calls).toEqual([]);
  });
});
