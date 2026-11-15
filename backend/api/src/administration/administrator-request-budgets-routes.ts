import type { FastifyInstance, FastifyReply } from "fastify";

import { errorResponseSchema } from "../identity/schemas.js";
import type { ActorResolver } from "../identity/types.js";
import {
  ADMINISTRATOR_REQUEST_BUDGETS_SCHEMA_VERSION,
  AdministratorRequestBudgetsError,
  REQUEST_BUDGET_SUBJECT_KINDS,
  type AdministratorRequestBudgets,
  type AdministratorRequestBudgetsService,
} from "./administrator-request-budgets.js";

export const ADMINISTRATOR_REQUEST_BUDGETS_PATH = "/v1/administrator/request-budgets";

const count = { type: "integer", minimum: 0 } as const;
const scopeName = { type: "string", minLength: 1, maxLength: 96 } as const;

export const administratorRequestBudgetsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "generatedAtMs", "refusals", "refusalsTruncated", "settings", "headroom"],
  properties: {
    schemaVersion: { type: "string", const: ADMINISTRATOR_REQUEST_BUDGETS_SCHEMA_VERSION },
    generatedAtMs: count,
    refusals: {
      type: "array",
      maxItems: 100,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["scope", "lastHour", "lastDay", "subjectKind", "subjectsLastDay", "topAccounts"],
        properties: {
          scope: scopeName,
          lastHour: count,
          lastDay: count,
          subjectKind: { anyOf: [{ type: "string", enum: [...REQUEST_BUDGET_SUBJECT_KINDS] }, { type: "null" }] },
          subjectsLastDay: count,
          topAccounts: {
            type: "array",
            maxItems: 5,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["accountId", "screenName", "refusedLastDay"],
              properties: {
                accountId: { type: "string", minLength: 1, maxLength: 141 },
                screenName: { anyOf: [{ type: "string", maxLength: 32 }, { type: "null" }] },
                refusedLastDay: count,
              },
            },
          },
        },
      },
    },
    refusalsTruncated: { type: "boolean" },
    settings: {
      type: "array",
      maxItems: 64,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "setting", "windowSeconds", "value", "defaultValue"],
        properties: {
          name: { type: "string", minLength: 1, maxLength: 64 },
          setting: { type: "string", pattern: "^MK8DX_HOSTED_BUDGET_[A-Z0-9_]{1,64}$" },
          windowSeconds: { type: "integer", minimum: 1, maximum: 86_400 },
          value: { type: "integer", minimum: 1, maximum: 1_000_000 },
          defaultValue: { type: "integer", minimum: 1, maximum: 1_000_000 },
        },
      },
    },
    headroom: {
      type: "array",
      maxItems: 64,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["scope", "setting", "windowSeconds", "windowEndsAtMs", "used", "maximum", "refused"],
        properties: {
          scope: scopeName,
          setting: { anyOf: [{ type: "string", pattern: "^MK8DX_HOSTED_BUDGET_[A-Z0-9_]{1,64}$" }, { type: "null" }] },
          windowSeconds: { type: "integer", minimum: 1, maximum: 86_400 },
          windowEndsAtMs: count,
          used: count,
          maximum: { type: "integer", minimum: 1, maximum: 1_000_000 },
          refused: count,
        },
      },
    },
  },
} as const;

function send(reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof AdministratorRequestBudgetsError && error.code === "forbidden") {
    return reply.code(403).send({
      code: "administrator_request_budgets_forbidden",
      message: "Administrator access is required.",
    });
  }
  return reply.code(503).send({
    code: "administrator_request_budgets_unavailable",
    message: "The request budget report is unavailable.",
  });
}

/**
 * A read of operational counters for administrators (browser path). It is not step-up protected:
 * it shows fixed scope names, numbers and, for account budgets, the public id and screen name of
 * the most refused accounts, nothing an administrator cannot already see (docs/architecture/
 * MUTATING_ROUTES.md, "Fresh confirmation"). A GET needs no request proof.
 */
export async function registerAdministratorRequestBudgetRoutes(
  app: FastifyInstance,
  options: Readonly<{
    resolveActor: ActorResolver;
    service: Pick<AdministratorRequestBudgetsService, "report">;
  }>,
): Promise<void> {
  app.get<{ Reply: AdministratorRequestBudgets | { code: string; message: string } }>(
    ADMINISTRATOR_REQUEST_BUDGETS_PATH,
    {
      schema: {
        response: { 200: administratorRequestBudgetsSchema, 403: errorResponseSchema, 503: errorResponseSchema },
      },
    },
    async (request, reply) => {
      void reply.header("cache-control", "no-store");
      try {
        const actor = await options.resolveActor(request);
        return reply.send(await options.service.report(actor));
      } catch (error) {
        return send(reply, error);
      }
    },
  );
}
