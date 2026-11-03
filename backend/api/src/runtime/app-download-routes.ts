import type { FastifyInstance } from "fastify";

import { errorResponseSchema } from "../identity/schemas.js";
import type { ActorResolver } from "../identity/types.js";
import { APP_DOWNLOAD_LANGUAGES, isAppDownloadLanguage } from "./app-downloads.js";
import type { AppDownloadStore } from "./app-downloads.js";

// Downloads are for the owner's known community, so both routes require a
// signed-in account. Nothing here reveals a filesystem path.

export type AppDownloadRouteOptions = Readonly<{
  resolveActor: ActorResolver;
  store: AppDownloadStore;
}>;

const entrySchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "platform", "title", "version", "releasedOn", "fileName",
    "bytes", "sha256", "requirements", "installSteps", "updateSteps"],
  properties: {
    id: { type: "string", minLength: 1, maxLength: 64 },
    platform: { type: "string", enum: ["android", "windows"] },
    title: { type: "string", minLength: 1, maxLength: 96 },
    version: { type: "string", minLength: 1, maxLength: 64 },
    releasedOn: { type: "string", minLength: 10, maxLength: 10 },
    fileName: { type: "string", minLength: 1, maxLength: 128 },
    bytes: { type: "integer", minimum: 1 },
    sha256: { type: "string", minLength: 64, maxLength: 64 },
    requirements: {
      type: "array", maxItems: 20,
      items: { type: "string", maxLength: 300 },
    },
    installSteps: {
      type: "array", maxItems: 20,
      items: { type: "string", maxLength: 300 },
    },
    updateSteps: {
      type: "array", maxItems: 20,
      items: { type: "string", maxLength: 300 },
    },
    // Optional, Windows only: the oldest LiveTrial that may still send.
    minimumSupportedVersion: { type: "string", minLength: 3, maxLength: 32 },
  },
} as const;

const catalogSchema = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "entries"],
  properties: {
    schemaVersion: { type: "string", const: "mk8dx.app-downloads.v1" },
    entries: { type: "array", maxItems: 20, items: entrySchema },
  },
} as const;

export async function registerAppDownloadRoutes(
  app: FastifyInstance,
  options: AppDownloadRouteOptions,
): Promise<void> {
  // The guides are served in the product language the page asks for, and in
  // English when it asks for nothing. The document keeps one shape and one
  // size whichever language is chosen.
  app.get<{ Querystring: Readonly<{ language?: string }> }>("/v1/app-downloads", {
    schema: {
      querystring: {
        type: "object",
        additionalProperties: false,
        properties: {
          language: { type: "string", enum: [...APP_DOWNLOAD_LANGUAGES] },
        },
      },
      response: {
        200: catalogSchema,
        401: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const actor = await options.resolveActor(request);
    if (actor.role === "anonymous") {
      return reply.code(401).send({
        code: "not_authenticated",
        message: "Sign in to download the MK8DX apps.",
      });
    }
    const language = request.query.language;
    void reply.header("cache-control", "no-store");
    return reply.send(options.store.catalog(
      isAppDownloadLanguage(language) ? language : "en",
    ));
  });

  app.get<{ Params: Readonly<{ downloadId: string }> }>(
    "/v1/app-downloads/:downloadId/file",
    {
      schema: {
        params: {
          type: "object", additionalProperties: false,
          required: ["downloadId"],
          properties: {
            downloadId: {
              type: "string", minLength: 1, maxLength: 64,
              pattern: "^[a-z0-9]+(?:[._-][a-z0-9]+)*$",
            },
          },
        },
      },
    },
    async (request, reply) => {
      const actor = await options.resolveActor(request);
      if (actor.role === "anonymous") {
        return reply.code(401).send({
          code: "not_authenticated",
          message: "Sign in to download the MK8DX apps.",
        });
      }
      const opened = await options.store.open(request.params.downloadId);
      if (opened === null) {
        return reply.code(404).send({
          code: "download_not_found",
          message: "That download is not available.",
        });
      }
      void reply.header("content-type", "application/octet-stream");
      void reply.header("content-length", String(opened.bytes));
      void reply.header(
        "content-disposition",
        `attachment; filename="${opened.entry.fileName}"`,
      );
      void reply.header("cache-control", "no-store");
      void reply.header("x-content-type-options", "nosniff");
      return reply.send(opened.stream);
    },
  );
}
