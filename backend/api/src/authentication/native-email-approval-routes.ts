import type { FastifyInstance } from "fastify";

import type { NativeEmailApprovalService } from "./native-email-approval.js";

const SCHEMA_VERSION = "mk8dx.native-email-approval.v1";

const errorSchema = {
  type: "object",
  additionalProperties: false,
  required: ["code", "message"],
  properties: { code: { type: "string" }, message: { type: "string" } },
} as const;

// Read by the web's native-email-approval-client.ts; tests/contracts binds both sides.
const linkViewSchema = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "userCode", "clientName", "expiresAtMs"],
  properties: {
    schemaVersion: { type: "string", const: SCHEMA_VERSION },
    userCode: { type: "string" },
    clientName: { type: "string" },
    expiresAtMs: { type: "integer" },
  },
} as const;

const linkApprovalSchema = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "status"],
  properties: { schemaVersion: { type: "string", const: SCHEMA_VERSION }, status: { type: "string", const: "approved" } },
} as const;

/**
 * Unauthenticated by design: the proof is the pending device code the client
 * holds plus what arrives in the account's inbox. No cookie is read or set, so
 * there is nothing for a cross-site request to borrow.
 */
export async function registerNativeEmailApprovalRoutes(
  app: FastifyInstance,
  options: Readonly<{ service: Pick<NativeEmailApprovalService, "request" | "verifyCode" | "inspectLink" | "approveLink"> }>,
): Promise<void> {
  const { service } = options;

  app.post<{ Body: { userCode: string; email: string } }>(
    "/v1/native/device-authorization/email",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["userCode", "email"],
          properties: {
            userCode: { type: "string", minLength: 8, maxLength: 16 },
            email: { type: "string", minLength: 3, maxLength: 320 },
          },
        },
        response: {
          202: {
            type: "object",
            additionalProperties: false,
            required: ["schemaVersion", "status"],
            properties: { schemaVersion: { type: "string", const: SCHEMA_VERSION }, status: { type: "string", const: "sent_if_eligible" } },
          },
          400: errorSchema,
        },
      },
    },
    async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      const accepted = await service.request(request.body.userCode, request.body.email, request.ip);
      if (!accepted) {
        return reply.code(400).send({ code: "native_email_request_invalid", message: "Enter the sign-in code and a valid email address." });
      }
      // The same answer for every address: whether an account exists is never told here.
      return reply.code(202).send({ schemaVersion: SCHEMA_VERSION, status: "sent_if_eligible" });
    },
  );

  app.post<{ Body: { userCode: string; code: string } }>(
    "/v1/native/device-authorization/email/verify",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["userCode", "code"],
          properties: {
            userCode: { type: "string", minLength: 8, maxLength: 16 },
            code: { type: "string", minLength: 6, maxLength: 12 },
          },
        },
        response: {
          200: {
            type: "object",
            additionalProperties: false,
            required: ["schemaVersion", "status"],
            properties: {
              schemaVersion: { type: "string", const: SCHEMA_VERSION },
              status: { type: "string", enum: ["approved", "invalid", "expired", "locked"] },
              attemptsLeft: { type: "integer", minimum: 0 },
            },
          },
        },
      },
    },
    async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      const outcome = await service.verifyCode(request.body.userCode, request.body.code);
      return reply.send({ schemaVersion: SCHEMA_VERSION, ...outcome });
    },
  );

  app.get<{ Querystring: { token?: string } }>(
    "/v1/native/device-authorization/email/link",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: { token: { type: "string", maxLength: 64 } },
        },
        response: {
          200: linkViewSchema,
          404: errorSchema,
        },
      },
    },
    async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      reply.header("Referrer-Policy", "no-referrer");
      const view = await service.inspectLink(request.query.token);
      if (view === null) {
        return reply.code(404).send({ code: "native_email_link_invalid", message: "This link has expired or was already used." });
      }
      return reply.send({ schemaVersion: SCHEMA_VERSION, ...view });
    },
  );

  app.post<{ Body: { token: string } }>(
    "/v1/native/device-authorization/email/link",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["token"],
          properties: { token: { type: "string", maxLength: 64 } },
        },
        response: {
          200: linkApprovalSchema,
          404: errorSchema,
        },
      },
    },
    async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      if (!(await service.approveLink(request.body.token))) {
        return reply.code(404).send({ code: "native_email_link_invalid", message: "This link has expired or was already used." });
      }
      return reply.send({ schemaVersion: SCHEMA_VERSION, status: "approved" });
    },
  );
}
