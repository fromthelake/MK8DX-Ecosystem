import type { FastifyInstance } from "fastify";

import { errorResponseSchema } from "../identity/schemas.js";
import {
  TournamentTrackRecordError,
  type TournamentTrackRecordService,
} from "./tournament-track-record-service.js";

// Public, like the standing it sits beside: which tracks somebody is strong on
// is a fact about a public Player, and it is the kind of thing you want to show
// a friend before a race night without asking them to sign in first.

const playerIdSchema = {
  type: "string", minLength: 8, maxLength: 135,
  pattern: "^player\\.[a-z0-9]+(?:[._-][a-z0-9]+)*$",
} as const;

const trackRecordSchema = {
  type: "object", additionalProperties: false,
  required: [
    "schemaVersion", "playerId", "racesWithTrack", "racesWithoutTrack",
    "tracks",
  ],
  properties: {
    schemaVersion: {
      type: "string", const: "mk8dx.tournament-track-record.v1",
    },
    playerId: playerIdSchema,
    racesWithTrack: { type: "integer", minimum: 0 },
    // TN4-TN6 were never recorded, so a long career always has some. Reported
    // rather than hidden: an average over half a career should say so.
    racesWithoutTrack: { type: "integer", minimum: 0 },
    overallFieldShare: { type: ["number", "null"] },
    tracks: {
      type: "array", maxItems: 128,
      items: {
        type: "object", additionalProperties: false,
        required: [
          "trackId", "races", "wins", "podiums", "bestFinish", "worstFinish",
          "averageFinish", "averageFieldShare", "relativeToOwnAverage",
          "lastRacedAtMs",
        ],
        properties: {
          trackId: { type: "string", minLength: 1, maxLength: 255 },
          races: { type: "integer", minimum: 1 },
          wins: { type: "integer", minimum: 0 },
          podiums: { type: "integer", minimum: 0 },
          bestFinish: { type: "integer", minimum: 1 },
          worstFinish: { type: "integer", minimum: 1 },
          averageFinish: { type: "number" },
          averagePoints: { type: ["number", "null"] },
          averageFieldShare: { type: "number" },
          relativeToOwnAverage: { type: "number" },
          lastRacedAtMs: { type: "integer", minimum: 0 },
        },
      },
    },
  },
} as const;

export async function registerTournamentTrackRecordRoutes(
  app: FastifyInstance,
  service: Pick<TournamentTrackRecordService, "recordFor">,
): Promise<void> {
  app.get<{ Params: Readonly<{ playerId: string }> }>(
    "/v1/public/players/:playerId/tournament-tracks",
    {
      schema: {
        params: {
          type: "object", additionalProperties: false, required: ["playerId"],
          properties: { playerId: playerIdSchema },
        },
        response: {
          200: trackRecordSchema,
          400: errorResponseSchema,
          503: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const record = await service.recordFor(request.params.playerId);
        void reply.header("cache-control", "no-store");
        return reply.send({
          schemaVersion: "mk8dx.tournament-track-record.v1",
          ...record,
        });
      } catch (error) {
        if (error instanceof TournamentTrackRecordError) {
          return reply.code(400).send({
            code: "invalid_tournament_track_query",
            message: "The Player query is invalid.",
          });
        }
        return reply.code(503).send({
          code: "tournament_track_record_unavailable",
          message: "The track record is temporarily unavailable.",
        });
      }
    },
  );
}
