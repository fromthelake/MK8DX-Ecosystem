import { describe, expect, it, vi } from "vitest";

import { createPlayerClaimClient } from "../src/player-claim-client.js";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const player = {
  playerId: "player.synthetic_claim_ui_01",
  username: "SyntheticRacer",
  displayName: "Synthetic Racer",
  aliases: ["Synth"],
} as const;

describe("same-origin Player claim client", () => {
  it("loads private claim status and searches only public Player fields", async () => {
    const fetchPort = vi.fn(async (path: string) => path.startsWith("/v1/me/")
      ? response({
          schemaVersion: "mk8dx.account-player-claims.v1",
          claims: [{
            playerClaimId: "player_claim.synthetic_claim_ui_01",
            playerId: player.playerId,
            playerUsername: player.username,
            playerDisplayName: player.displayName,
            claimStatus: "requested",
            disputeStatus: "none",
            updatedAtMs: 1787011200000,
          }],
        })
      : response({ schemaVersion: "mk8dx.player-directory.v1", players: [player] }));
    const client = createPlayerClaimClient(fetchPort);
    await expect(client.listMine()).resolves.toHaveLength(1);
    await expect(client.search(" Synthetic ")).resolves.toEqual([player]);
    expect(fetchPort.mock.calls[1]?.[0]).toBe("/v1/player-directory?query=Synthetic");
    expect(JSON.stringify(fetchPort.mock.calls)).not.toMatch(/authorization|evidence/i);
  });

  it("loads the complete signed-in Player directory without a search waterfall", async () => {
    const fetchPort = vi.fn(async (_path: string, _init: RequestInit) => response({
      schemaVersion: "mk8dx.player-directory.v1",
      players: [player, {
        playerId: "player.synthetic_claim_ui_02",
        username: "SecondRacer",
        displayName: "Second Racer",
        aliases: [],
      }],
    }));

    await expect(createPlayerClaimClient(fetchPort).listAll?.()).resolves.toHaveLength(2);
    expect(fetchPort).toHaveBeenCalledOnce();
    expect(fetchPort.mock.calls[0]?.[0]).toBe("/v1/player-directory");
  });

  it("obtains a fresh CSRF proof immediately before an empty-evidence request", async () => {
    const fetchPort = vi.fn(async (path: string, init: RequestInit) => {
      if (path === "/v1/session/csrf") {
        return response({
          schemaVersion: "mk8dx.web-csrf.v1",
          headerName: "X-MK8DX-CSRF",
          value: "synthetic-proof",
        });
      }
      expect(init.headers).toMatchObject({ "X-MK8DX-CSRF": "synthetic-proof" });
      expect(JSON.parse(init.body as string)).toEqual({
        playerId: player.playerId,
        evidenceIds: [],
      });
      return response({
        playerClaimId: "player_claim.synthetic_claim_ui_01",
        playerId: player.playerId,
        userAccountId: "user_account.synthetic_claim_ui_01",
        claimStatus: "requested",
        disputeStatus: "none",
        revision: 1,
        lastSequence: 1,
      }, 201);
    });
    await expect(createPlayerClaimClient(fetchPort).request(player.playerId))
      .resolves.toMatchObject({
        playerId: player.playerId,
        claimStatus: "requested",
      });
    expect(fetchPort.mock.calls.map((call) => call[0])).toEqual([
      "/v1/session/csrf",
      "/v1/player-claims",
    ]);
  });

  it("rejects unbounded or private response extensions", async () => {
    const client = createPlayerClaimClient(async () => response({
      schemaVersion: "mk8dx.player-directory.v1",
      players: [{ ...player, email: "private@example.invalid" }],
    }));
    await expect(client.search("Synthetic")).rejects.toMatchObject({
      code: "invalid_response",
    });
    await expect(client.search("x")).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("loads the administrator queue and applies a CSRF-protected review action", async () => {
    const calls: Array<{ path: string; init: RequestInit }> = [];
    const queueClaim = {
      playerClaimId: "player_claim.synthetic_claim_ui_01",
      playerId: player.playerId,
      playerUsername: player.username,
      playerDisplayName: player.displayName,
      claimStatus: "under_review",
      disputeStatus: "none",
      updatedAtMs: 1787011200000,
    };
    const fetchPort = vi.fn(async (path: string, init: RequestInit) => {
      calls.push({ path, init });
      if (path === "/v1/administrator/player-claims") {
        return response({
          schemaVersion: "mk8dx.administrator-player-claim-queue.v1",
          claims: [queueClaim],
        });
      }
      if (path === "/v1/session/csrf") {
        return response({
          schemaVersion: "mk8dx.web-csrf.v1",
          headerName: "X-MK8DX-CSRF",
          value: "synthetic-proof",
        });
      }
      return response({
        playerClaimId: queueClaim.playerClaimId,
        playerId: queueClaim.playerId,
        userAccountId: "user_account.synthetic_claim_ui_01",
        claimStatus: "verified",
        disputeStatus: "none",
        revision: 3,
        lastSequence: 3,
      });
    });
    const client = createPlayerClaimClient(fetchPort);
    await expect(client.listReviewQueue()).resolves.toEqual([queueClaim]);
    await expect(client.reviewAction(
      queueClaim.playerClaimId,
      "verify",
      "identity_evidence_reviewed",
    )).resolves.toMatchObject({ claimStatus: "verified" });
    expect(calls.map((call) => call.path)).toEqual([
      "/v1/administrator/player-claims",
      "/v1/session/csrf",
      `/v1/player-claims/${queueClaim.playerClaimId}/actions`,
    ]);
    expect(JSON.parse(calls[2]?.init.body as string)).toEqual({
      action: "verify",
      evidenceIds: [],
      reasonCode: "identity_evidence_reviewed",
    });
    expect(JSON.stringify(calls)).not.toMatch(/email|password|reviewDetail/i);
  });

  it("distinguishes a non-administrator from transient queue failure", async () => {
    const forbidden = createPlayerClaimClient(async () => response({
      code: "claim_directory_forbidden",
      message: "not available",
    }, 403));
    await expect(forbidden.listReviewQueue()).rejects.toMatchObject({
      code: "not_authorized",
    });
  });

  it.each([
    ["username_taken", "username_taken"],
    ["display_name_taken", "display_name_taken"],
    ["player_already_linked", "already_linked"],
  ] as const)("preserves the actionable onboarding conflict %s", async (
    serverCode,
    clientCode,
  ) => {
    const fetchPort = vi.fn(async (path: string) => path === "/v1/session/csrf"
      ? response({
          schemaVersion: "mk8dx.web-csrf.v1",
          headerName: "X-MK8DX-CSRF",
          value: "synthetic-proof",
        })
      : response({ code: serverCode, message: "closed test message" }, 409));
    await expect(createPlayerClaimClient(fetchPort).createOwnPlayer(
      "fresh_racer",
      "Fresh Racer",
    )).rejects.toMatchObject({ code: clientCode });
  });

  it("reports the onboarding mutation budget separately", async () => {
    const fetchPort = vi.fn(async (path: string) => path === "/v1/session/csrf"
      ? response({
          schemaVersion: "mk8dx.web-csrf.v1",
          headerName: "X-MK8DX-CSRF",
          value: "synthetic-proof",
        })
      : response({
          code: "player_onboarding_rate_limited",
          message: "closed test message",
        }, 429));
    await expect(createPlayerClaimClient(fetchPort).createOwnPlayer(
      "fresh_racer",
    )).rejects.toMatchObject({ code: "rate_limited" });
  });

  it("asks for contextual claim candidates with the answers and a fresh proof (ADR-0219)", async () => {
    const candidate = {
      ...player,
      claimed: false,
      matchesAnswers: true,
      timeTrials: { times: 4, lastAt: "2026-10-30", classes: [150, 200] },
      tournaments: { nights: 2, directorNames: ["Ben"], lastNight: { name: "TN13", date: null } },
    };
    let served: unknown = { schemaVersion: "mk8dx.claim-candidates.v1", candidates: [candidate] };
    const fetchPort = vi.fn(async (path: string, init: RequestInit) => {
      if (path === "/v1/session/csrf") {
        return response({ schemaVersion: "mk8dx.web-csrf.v1", headerName: "X-MK8DX-CSRF", value: "synthetic-proof" });
      }
      expect(path).toBe("/v1/me/claim-candidates");
      expect(init.method).toBe("POST");
      expect(init.headers).toMatchObject({ "X-MK8DX-CSRF": "synthetic-proof" });
      expect(JSON.parse(init.body as string)).toEqual({ query: "Synthetic", timeTrials: true, tournaments: false });
      return response(served);
    });
    const client = createPlayerClaimClient(fetchPort);
    const input = { query: " Synthetic ", timeTrials: true, tournaments: false };
    await expect(client.candidates!(input)).resolves.toEqual([candidate]);
    // An unknown key is refused, like every response here.
    served = { schemaVersion: "mk8dx.claim-candidates.v1", candidates: [{ ...candidate, email: "x@example.com" }] };
    await expect(client.candidates!(input)).rejects.toMatchObject({ code: "invalid_response" });
    served = { schemaVersion: "mk8dx.claim-candidates.v1", candidates: [{ ...candidate, timeTrials: { ...candidate.timeTrials, classes: [100] } }] };
    await expect(client.candidates!(input)).rejects.toMatchObject({ code: "invalid_response" });
    await expect(client.candidates!({ ...input, query: "x" })).rejects.toMatchObject({ code: "invalid_input" });
  });
});
