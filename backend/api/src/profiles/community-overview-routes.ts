import type { FastifyInstance } from "fastify";

import { errorResponseSchema } from "../identity/schemas.js";
import type { CommunityOverviewService } from
  "./community-overview-service.js";

export type CommunityOverviewRouteOptions = Readonly<{
  service: Pick<CommunityOverviewService, "loadOverview">;
}>;

const responseSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "schemaVersion", "players", "countries", "publishedTimeTrials",
    "tournaments",
  ],
  properties: {
    schemaVersion: {
      type: "string",
      const: "mk8dx.public-community-overview.v1",
    },
    players: { type: "integer", minimum: 0 },
    publishedTimeTrials: { type: "integer", minimum: 0 },
    tournaments: { type: "integer", minimum: 0 },
    countries: {
      type: "array",
      maxItems: 200,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["countryId", "players"],
        properties: {
          countryId: {
            type: "string",
            pattern: "^country\\.[a-z0-9_]+$",
          },
          players: { type: "integer", minimum: 1 },
        },
      },
    },
  },
} as const;

export async function registerCommunityOverviewRoutes(
  app: FastifyInstance,
  options: CommunityOverviewRouteOptions,
): Promise<void> {
  app.get<{ Reply: unknown }>(
    "/v1/public/community",
    {
      schema: {
        response: { 200: responseSchema, 503: errorResponseSchema },
      },
    },
    async (_request, reply) => {
      try {
        const overview = await options.service.loadOverview();
        return reply.send({
          schemaVersion: "mk8dx.public-community-overview.v1",
          ...overview,
        });
      } catch (error) {
        void error;
        return reply.code(503).send({
          code: "community_unavailable",
          message: "The community overview is temporarily unavailable.",
        });
      }
    },
  );
}
