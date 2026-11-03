import type { FastifyInstance } from "fastify";

import { errorResponseSchema } from "../identity/schemas.js";
import type { RecordBookService } from "./record-book-service.js";

export type RecordBookRouteOptions = Readonly<{
  service: Pick<RecordBookService, "loadRecordBook">;
}>;

const responseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "categories"],
  properties: {
    schemaVersion: {
      type: "string",
      const: "mk8dx.public-record-book.v1",
    },
    categories: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["key", "holders"],
        properties: {
          key: {
            type: "string",
            enum: ["firsts", "podiums", "published", "coverage"],
          },
          holders: {
            type: "array",
            maxItems: 3,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["playerId", "displayName", "value"],
              properties: {
                playerId: {
                  type: "string",
                  pattern: "^player\\.[a-z0-9]+(?:[._-][a-z0-9]+)*$",
                },
                displayName: { type: "string", minLength: 1, maxLength: 128 },
                avatarId: {
                  type: "string",
                  pattern: "^character(_variant)?\\.[a-z0-9_.]+$",
                },
                value: { type: "integer", minimum: 1 },
              },
            },
          },
        },
      },
    },
  },
} as const;

export async function registerRecordBookRoutes(
  app: FastifyInstance,
  options: RecordBookRouteOptions,
): Promise<void> {
  app.get<{ Reply: unknown }>(
    "/v1/public/record-book",
    {
      schema: {
        response: { 200: responseSchema, 503: errorResponseSchema },
      },
    },
    async (_request, reply) => {
      try {
        const book = await options.service.loadRecordBook();
        return reply.send({
          schemaVersion: "mk8dx.public-record-book.v1",
          ...book,
        });
      } catch {
        return reply.code(503).send({
          code: "record_book_unavailable",
          message: "The record book is temporarily unavailable.",
        });
      }
    },
  );
}
