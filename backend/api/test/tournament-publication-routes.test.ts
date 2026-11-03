import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

import { buildApp } from "../src/app.js";
import type { IdentityReadRepository } from "../src/identity/types.js";
import {
  PublicTournamentService,
  type PublicTournamentRepository,
} from "../src/tournaments/public-tournament-service.js";
import {
  TournamentPublicationService,
  type TournamentPublicationRepository,
} from "../src/tournaments/tournament-publication-service.js";

const identityRepository: IdentityReadRepository = {
  async findPublicPlayerById() { return null; },
  async findUserAccountSummaryById() { return null; },
  async findPlayerClaimSummaryById() { return null; },
};
const administrator = {
  role: "administrator" as const,
  userAccountId: "user_account.synthetic_admin",
};
const publicationId = "tournament_publication.synthetic_event_001";
const raceResultId = "tournament_race_result.synthetic_race_001";
const playerId = "player.synthetic_racer_001";
const snapshot = {
  publicationId,
  eventName: "Synthetic Cup",
  status: "published" as const,
  revision: 1,
  resultCount: 1,
  publishedAtMs: 1_900_000_000_000,
  updatedAtMs: 1_900_000_000_000,
};
const candidate = {
  raceResultId,
  currentRevision: 1,
  raceNumber: 1,
  scoringSegment: 1,
  trackId: "track.mario_kart_stadium",
  mode: 150 as const,
  placementCount: 1,
  publishable: true,
};
const publicTournament = {
  publicationId,
  eventName: "Synthetic Cup",
  publishedAtMs: 1_900_000_000_000,
  races: [{
    raceResultId,
    revision: 1,
    raceNumber: 1,
    scoringSegment: 1,
    trackId: "track.mario_kart_stadium",
    mode: 150 as const,
    countsTowardStandings: true,
    resultAtMs: 1_899_999_999_000,
    placements: [{
      finishPosition: 1,
      playerId,
      playerUsername: "Racer",
      playerDisplayName: "Synthetic Racer",
      racePoints: 15,
      totalAfterRace: 15,
      rankAfterRace: 1,
    }],
  }],
  standings: [{
    scoringSegment: 1,
    playerId,
    playerUsername: "Racer",
    playerDisplayName: "Synthetic Racer",
    totalPoints: 15,
    rank: 1,
  }],
};

const apps: FastifyInstance[] = [];
afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())));

function setup(role: "administrator" | "account" = "administrator") {
  const publicationRepository: TournamentPublicationRepository = {
    listReview: vi.fn(async () => ({ publications: [snapshot], candidates: [candidate] })),
    create: vi.fn(async () => snapshot),
    republish: vi.fn(async (input) => ({ ...snapshot, revision: input.expectedRevision + 1 })),
    retract: vi.fn(async (input) => {
      const { publishedAtMs: _publishedAtMs, ...current } = snapshot;
      return {
        ...current,
        status: "retracted" as const,
        revision: input.expectedRevision + 1,
        resultCount: 0,
      };
    }),
  };
  const publicRepository: PublicTournamentRepository = {
    loadPublication: vi.fn(async (id) => id === publicationId ? publicTournament : null),
    listPlayerResults: vi.fn(async () => [{
      publicationId,
      eventName: "Synthetic Cup",
      publishedAtMs: 1_900_000_000_000,
      raceResultId,
      revision: 1,
      raceNumber: 1,
      scoringSegment: 1,
      trackId: "track.mario_kart_stadium",
      mode: 150 as const,
      finishPosition: 1,
      racePoints: 15,
      totalAfterRace: 15,
      rankAfterRace: 1,
      resultAtMs: 1_899_999_999_000,
    }]),
  };
  const appPromise = buildApp({
    identityRepository,
    resolveActor: async () => role === "administrator"
      ? administrator
      : { role: "account", userAccountId: administrator.userAccountId },
    tournamentPublications: {
      service: new TournamentPublicationService(
        publicationRepository,
        { newPublicationId: () => publicationId },
        { nowMs: () => 1_900_000_000_000 },
      ),
      csrfVerifier: { verify: (_actor, token) => token === "valid-csrf" },
    },
    publicTournaments: { service: new PublicTournamentService(publicRepository) },
  });
  return { appPromise, publicationRepository, publicRepository };
}

describe("Tournament publication routes", () => {
  it("mounts administrator review and CSRF-protected publication", async () => {
    const { appPromise, publicationRepository } = setup();
    const app = await appPromise;
    apps.push(app);
    const review = await app.inject({
      method: "GET",
      url: "/v1/administrator/tournament-publications/review",
    });
    expect(review.statusCode).toBe(200);
    expect(review.json()).toEqual({ publications: [snapshot], candidates: [candidate] });
    const created = await app.inject({
      method: "POST",
      url: "/v1/tournament-publications",
      headers: { "x-mk8dx-csrf": "valid-csrf" },
      payload: {
        eventName: "Synthetic Cup",
        targets: [{ raceResultId, revision: 1 }],
        reasonCode: "event_completed",
      },
    });
    expect(created.statusCode).toBe(200);
    expect(created.json()).toEqual(snapshot);
    expect(publicationRepository.create).toHaveBeenCalledOnce();
  });

  it("rejects ordinary accounts and invalid CSRF before mutation", async () => {
    for (const [role, token] of [["account", "valid-csrf"], ["administrator", "wrong"]] as const) {
      const { appPromise, publicationRepository } = setup(role);
      const app = await appPromise;
      apps.push(app);
      const response = await app.inject({
        method: "POST",
        url: "/v1/tournament-publications",
        headers: { "x-mk8dx-csrf": token },
        payload: {
          eventName: "Synthetic Cup",
          targets: [{ raceResultId, revision: 1 }],
          reasonCode: "event_completed",
        },
      });
      expect(response.statusCode).toBe(403);
      expect(publicationRepository.create).not.toHaveBeenCalled();
    }
  });

  it("serves only closed anonymous publication and Player-history projections", async () => {
    const { appPromise } = setup();
    const app = await appPromise;
    apps.push(app);
    const event = await app.inject({
      method: "GET",
      url: `/v1/public/tournaments/${publicationId}`,
    });
    const history = await app.inject({
      method: "GET",
      url: `/v1/public/players/${playerId}/tournaments`,
    });
    expect(event.statusCode).toBe(200);
    expect(event.json()).toEqual(publicTournament);
    expect(history.statusCode).toBe(200);
    expect(history.json()).toMatchObject({
      schemaVersion: "mk8dx.public-player-tournaments.v1",
      results: [{ publicationId, raceResultId, finishPosition: 1 }],
    });
    expect(`${event.body}${history.body}`).not.toMatch(
      /email|userAccount|claim|evidence|observed|verification|confidence|source|audit|firebase/i,
    );
  });

  it("returns not found for retracted or unknown public publication state", async () => {
    const { appPromise } = setup();
    const app = await appPromise;
    apps.push(app);
    const response = await app.inject({
      method: "GET",
      url: "/v1/public/tournaments/tournament_publication.unknown1",
    });
    expect(response.statusCode).toBe(404);
  });
});
