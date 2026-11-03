import Fastify from "fastify";
import { describe, expect, it } from "vitest";

import { registerTournamentStandingRoutes } from
  "../src/tournaments/tournament-standing-routes.js";
import {
  TournamentStandingService,
  type TournamentSharedRaces,
} from "../src/tournaments/tournament-standing-service.js";

async function appWith(shared: TournamentSharedRaces) {
  const asked: string[][] = [];
  const service = new TournamentStandingService({
    async listStanding() { return []; },
    async listRivalries() { return []; },
    async listSharedRaces(playerIds) { asked.push([...playerIds]); return shared; },
  });
  const app = Fastify();
  await registerTournamentStandingRoutes(app, service);
  return { app, asked };
}

describe("GET /v1/public/tournament-shared-races", () => {
  it("answers the records over the races every named Player finished", async () => {
    const finishes = [2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const { app, asked } = await appWith({
      sharedRaces: 3,
      entries: ["player.ben", "player.matteo"].map((playerId) => ({
        playerId, races: 3, wins: 2, podiums: 3, points: 42,
        finishPositionTotal: 4, finishes,
      })),
    });
    const response = await app.inject({
      method: "GET",
      url: "/v1/public/tournament-shared-races?players=player.ben,player.matteo",
    });
    expect(response.statusCode).toBe(200);
    expect(asked).toEqual([["player.ben", "player.matteo"]]);
    const body = response.json();
    expect(body.schemaVersion).toBe("mk8dx.tournament-shared-races.v1");
    expect(body.sharedRaces).toBe(3);
    expect(body.entries.map((row: { playerId: string }) => row.playerId))
      .toEqual(["player.ben", "player.matteo"]);
    await app.close();
  });

  it("refuses a comparison of one Player", async () => {
    const { app } = await appWith({ sharedRaces: 0, entries: [] });
    const response = await app.inject({
      method: "GET", url: "/v1/public/tournament-shared-races?players=player.ben",
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("invalid_tournament_shared_races_query");
    await app.close();
  });
});
