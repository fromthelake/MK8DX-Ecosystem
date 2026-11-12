/**
 * ADR-0224 phase 1, "add another device": a signed-in Player account in an offline-invitation
 * installation makes a one-use, 15-minute invitation for ITS OWN account, shown as a QR card that
 * the other device scans. The route is registered only in an offline-invitation installation, so
 * an email-link installation answers 404. It never names a target account, never creates or
 * changes an account and is refused for administrators (the loopback host page is their path).
 */
import type { FastifyInstance } from "fastify";
import QRCode from "qrcode";

import { errorResponseSchema } from "../identity/schemas.js";
import type { ActorContext, ActorResolver } from "../identity/types.js";
import {
  MutationRateLimitExceeded,
  type MutationRateLimiter,
} from "../security/mysql-mutation-rate-limiter.js";
import type { OfflineInvitationTicketService } from "./offline-invitation-ticket.js";

export const DEVICE_INVITATION_PATH = "/v1/session/device-invitations";
export const DEVICE_INVITATION_SCHEMA_VERSION = "mk8dx.device-invitation.v1";
/** Ten cards an hour is far beyond adding a phone or two, and keeps a stolen session from minting many. */
export const DEVICE_INVITATION_HOURLY_LIMIT = 10;
/** QR version 14 (73 modules) holds far more than the invitation URL; the bound keeps the answer small. */
export const DEVICE_INVITATION_QR_MAXIMUM_SIZE = 73;

export type DeviceInvitationDocument = Readonly<{
  schemaVersion: typeof DEVICE_INVITATION_SCHEMA_VERSION;
  invitationUrl: string;
  expiresAtMs: number;
  /** The QR matrix, row by row, "1" for a dark module. The page draws it; no image markup travels. */
  qr: Readonly<{ size: number; modules: string }>;
}>;
type ErrorResponse = Readonly<{ code: string; message: string }>;

export const deviceInvitationResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "invitationUrl", "expiresAtMs", "qr"],
  properties: {
    schemaVersion: { type: "string", const: DEVICE_INVITATION_SCHEMA_VERSION },
    invitationUrl: { type: "string", minLength: 1, maxLength: 512 },
    expiresAtMs: { type: "integer", minimum: 0 },
    qr: {
      type: "object",
      additionalProperties: false,
      required: ["size", "modules"],
      properties: {
        size: { type: "integer", minimum: 21, maximum: DEVICE_INVITATION_QR_MAXIMUM_SIZE },
        modules: {
          type: "string",
          pattern: "^[01]+$",
          maxLength: DEVICE_INVITATION_QR_MAXIMUM_SIZE * DEVICE_INVITATION_QR_MAXIMUM_SIZE,
        },
      },
    },
  },
} as const;

export type DeviceInvitationRouteOptions = Readonly<{
  resolveActor: ActorResolver;
  tickets: Pick<OfflineInvitationTicketService, "issueOwn">;
  /** The installation's exact public HTTPS origin, the same one the host page puts in its cards. */
  origin: string;
  rateLimiter: MutationRateLimiter;
  csrfVerifier?: Readonly<{
    verify(actor: ActorContext, proof: string): boolean | Promise<boolean>;
  }>;
}>;

function failure(code: string, message: string): ErrorResponse { return { code, message }; }

export function qrMatrix(text: string): Readonly<{ size: number; modules: string }> {
  const code = QRCode.create(text, { errorCorrectionLevel: "M" });
  const size = code.modules.size;
  if (size > DEVICE_INVITATION_QR_MAXIMUM_SIZE) { throw new Error("invitation QR is too large"); }
  let modules = "";
  for (let index = 0; index < size * size; index += 1) {
    modules += code.modules.data[index] ? "1" : "0";
  }
  return { size, modules };
}

export async function registerDeviceInvitationRoutes(
  app: FastifyInstance,
  options: DeviceInvitationRouteOptions,
): Promise<void> {
  const origin = new URL(options.origin);
  if (origin.protocol !== "https:" || origin.origin !== options.origin) {
    throw new Error("device invitation origin must be an exact HTTPS origin");
  }
  app.post<{ Reply: DeviceInvitationDocument | ErrorResponse }>(
    DEVICE_INVITATION_PATH,
    {
      schema: {
        response: {
          200: deviceInvitationResponseSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
          429: errorResponseSchema,
          503: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      const body: unknown = request.body;
      // Nothing is chosen by the caller: the account is the session's own. Anything in the body
      // is a sign of a client that thinks otherwise.
      if (body !== undefined && body !== null &&
          (typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 0)) {
        return reply.code(400).send(failure("device_invitation_invalid",
          "This request takes no input."));
      }
      let actor: ActorContext;
      try {
        actor = await options.resolveActor(request);
      } catch {
        return reply.code(503).send(failure("device_invitation_unavailable",
          "Adding a device is temporarily unavailable."));
      }
      if (actor.role === "anonymous") {
        return reply.code(401).send(failure("session_authentication_required",
          "Authentication is required."));
      }
      if (actor.role !== "account") {
        // Administrators add devices on the host computer only (ADR-0224).
        return reply.code(403).send(failure("device_invitation_forbidden",
          "This account adds devices through the host computer."));
      }
      const proof = request.headers["x-mk8dx-csrf"];
      try {
        if (options.csrfVerifier !== undefined &&
            (typeof proof !== "string" || !await options.csrfVerifier.verify(actor, proof))) {
          return reply.code(403).send(failure("device_invitation_csrf_invalid",
            "Reload the page and try again."));
        }
        await options.rateLimiter.consume(actor.userAccountId, "device-invitations-hour",
          3_600, DEVICE_INVITATION_HOURLY_LIMIT);
      } catch (error) {
        if (error instanceof MutationRateLimitExceeded) {
          reply.header("retry-after", String(error.retryAfterSeconds));
          return reply.code(429).send(failure("device_invitation_rate_limited",
            "Too many device cards were made. Wait before trying again."));
        }
        return reply.code(503).send(failure("device_invitation_unavailable",
          "Adding a device is temporarily unavailable."));
      }
      let ticket: Awaited<ReturnType<OfflineInvitationTicketService["issueOwn"]>>;
      try {
        ticket = await options.tickets.issueOwn(actor);
      } catch (error) {
        const code = (error as { code?: unknown } | null)?.code;
        if (code === "forbidden") {
          return reply.code(403).send(failure("device_invitation_forbidden",
            "This account adds devices through the host computer."));
        }
        if (code === "unavailable") {
          return reply.code(404).send(failure("device_invitation_unavailable",
            "This account cannot add a device here."));
        }
        return reply.code(503).send(failure("device_invitation_unavailable",
          "Adding a device is temporarily unavailable."));
      }
      // The token is in the fragment, so it never reaches a server log or a Referer header.
      const invitationUrl = `${options.origin}/offline-invite#token=${ticket.token}`;
      let qr: Readonly<{ size: number; modules: string }>;
      try {
        qr = qrMatrix(invitationUrl);
      } catch {
        return reply.code(503).send(failure("device_invitation_unavailable",
          "Adding a device is temporarily unavailable."));
      }
      return reply.send({
        schemaVersion: DEVICE_INVITATION_SCHEMA_VERSION,
        invitationUrl,
        expiresAtMs: ticket.expiresAtMs,
        qr,
      });
    },
  );
}
