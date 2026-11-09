import type { FastifyInstance } from "fastify";

import { errorResponseSchema } from "../identity/schemas.js";
import type { ActorResolver } from "../identity/types.js";
import type { TimeTrialWebCsrfVerifier } from
  "../timetrials/submission-routes.js";
import {
  accountSettingRateLimitFailure,
  consumeAccountSettingMutationBudget,
} from "../security/account-setting-mutation-budget.js";
import type { MutationRateLimiter } from "../security/mysql-mutation-rate-limiter.js";
import {
  PlayerCountryError,
  type PlayerCountryService,
} from "./player-country-service.js";

type ErrorResponse = Readonly<{ code: string; message: string }>;

export type PlayerCountryRouteOptions = Readonly<{
  resolveActor: ActorResolver;
  service: Pick<PlayerCountryService, "setOwnCountry">;
  csrfVerifier?: TimeTrialWebCsrfVerifier;
  rateLimiter: MutationRateLimiter;
}>;

const bodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["countryId"],
  properties: {
    countryId: {
      anyOf: [
        { type: "string", maxLength: 64, pattern: "^country\\.[a-z0-9_]+$" },
        { type: "null" },
      ],
    },
  },
} as const;

const acknowledgedSchema = {
  type: "object",
  additionalProperties: false,
  required: ["acknowledged"],
  properties: { acknowledged: { type: "boolean", const: true } },
} as const;

function errorReply(error: unknown): Readonly<{
  status: number;
  body: ErrorResponse;
}> {
  if (error instanceof PlayerCountryError) {
    switch (error.code) {
      case "invalid_input":
        return {
          status: 400,
          body: {
            code: "country_invalid",
            message: "That country is not in the canonical catalog.",
          },
        };
      case "not_authenticated":
        return {
          status: 401,
          body: {
            code: "not_authenticated",
            message: "Sign in to update your Player country.",
          },
        };
      case "no_verified_player":
        return {
          status: 409,
          body: {
            code: "no_verified_player",
            message: "A verified Player claim is required first.",
          },
        };
      case "unavailable":
        break;
    }
  }
  return {
    status: 503,
    body: {
      code: "country_unavailable",
      message: "The Player country could not be updated.",
    },
  };
}

export async function registerPlayerCountryRoutes(
  app: FastifyInstance,
  options: PlayerCountryRouteOptions,
): Promise<void> {
  app.put<{ Body: Readonly<{ countryId: string | null }> }>(
    "/v1/account/player-country",
    {
      schema: {
        body: bodySchema,
        response: {
          200: acknowledgedSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
          409: errorResponseSchema,
          429: errorResponseSchema,
          503: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const actor = await options.resolveActor(request);
        const proof = request.headers["x-mk8dx-csrf"];
        if (options.csrfVerifier !== undefined &&
            (typeof proof !== "string" ||
             !await options.csrfVerifier.verify(actor, proof))) {
          throw new PlayerCountryError("not_authenticated");
        }
        await consumeAccountSettingMutationBudget(actor, options.rateLimiter);
        await options.service.setOwnCountry(actor, request.body.countryId);
        return reply.send({ acknowledged: true });
      } catch (error) {
        const limited = accountSettingRateLimitFailure(error);
        if (limited !== null) {
          void reply.header("retry-after", String(limited.retryAfterSeconds));
          return reply.code(429).send(limited.body);
        }
        const { status, body } = errorReply(error);
        return reply.code(status).send(body);
      }
    },
  );
}
