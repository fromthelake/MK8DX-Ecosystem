import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { errorResponseSchema } from "../identity/schemas.js";
import type { ActorContext, ActorResolver } from "../identity/types.js";
import {
  TournamentSignupError,
  type TournamentSignupBoard,
  type TournamentSignupDocument,
  type TournamentSignupService,
} from "./tournament-signup-service.js";

/**
 * Open sign-up (ADR-0222). Everybody reads a night's sign-up and lists; a signed-in account with a
 * verified Player signs up, changes the consoles it brings or withdraws (browser with the CSRF
 * proof, native with the bearer, one link grammar); the night's Director reads every sign-up and
 * the console warning, sets the terms, closes early and moves people by hand.
 */

const tournamentIdSchema = { type: "string", minLength: 17, maxLength: 160, pattern: "^tournament\\.[A-Za-z0-9][A-Za-z0-9_-]{5,127}$" } as const;
const playerIdSchema = { type: "string", maxLength: 135, pattern: "^player\\.[a-z0-9]+(?:[._-][a-z0-9]+)*$" } as const;
const nullablePlayerId = { anyOf: [playerIdSchema, { type: "null" }] } as const;
const epochSchema = { type: "integer", minimum: 0 } as const;
const nullableEpoch = { anyOf: [epochSchema, { type: "null" }] } as const;
const nullableCount = { anyOf: [{ type: "integer", minimum: 1, maximum: 60 }, { type: "null" }] } as const;
const seedSchema = { anyOf: [{ type: "string", pattern: "^[0-9a-f]{64}$" }, { type: "null" }] } as const;
const algorithmSchema = { anyOf: [{ type: "string", minLength: 1, maxLength: 48 }, { type: "null" }] } as const;
const modeSchema = { type: "string", enum: ["director", "open"] } as const;
const selectionSchema = { anyOf: [{ type: "string", enum: ["first_come", "draw"] }, { type: "null" }] } as const;
const statusSchema = { type: "string", enum: ["director", "open", "closed"] } as const;

export const signupListEntrySchema = {
  type: "object",
  additionalProperties: false,
  required: ["position", "playerId", "displayName"],
  properties: {
    position: { type: "integer", minimum: 1 },
    playerId: nullablePlayerId,
    displayName: { type: "string", minLength: 1, maxLength: 128 },
  },
} as const;

export const signupViewerSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "state", "playerId", "hasSwitch1", "hasSwitch2", "waitingPosition", "canSignUp", "canWithdraw",
    "canChangeConsoles",
  ],
  properties: {
    state: {
      type: "string",
      enum: [
        "signed_out", "no_player", "director_roster", "not_signed_up", "pending", "selected", "waiting",
        "withdrawn", "removed", "closed",
      ],
    },
    playerId: nullablePlayerId,
    hasSwitch1: { type: "boolean" },
    hasSwitch2: { type: "boolean" },
    waitingPosition: { anyOf: [{ type: "integer", minimum: 1 }, { type: "null" }] },
    canSignUp: { type: "boolean" },
    canWithdraw: { type: "boolean" },
    canChangeConsoles: { type: "boolean" },
  },
} as const;

export const signupDocumentSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "schemaVersion", "tournamentId", "mode", "selection", "status", "closesAtMs", "timezone", "capacity",
    "taken", "closedAtMs", "drawSeed", "drawAlgorithm", "active", "waiting", "viewer",
  ],
  properties: {
    schemaVersion: { type: "string", const: "mk8dx.tournament-signup.v1" },
    tournamentId: tournamentIdSchema,
    mode: modeSchema,
    selection: selectionSchema,
    status: statusSchema,
    closesAtMs: nullableEpoch,
    timezone: { anyOf: [{ type: "string", minLength: 1, maxLength: 64 }, { type: "null" }] },
    capacity: nullableCount,
    taken: { type: "integer", minimum: 0 },
    closedAtMs: nullableEpoch,
    drawSeed: seedSchema,
    drawAlgorithm: algorithmSchema,
    active: { type: "array", maxItems: 200, items: signupListEntrySchema },
    waiting: { type: "array", maxItems: 500, items: signupListEntrySchema },
    viewer: signupViewerSchema,
  },
} as const;

export const signupBoardEntrySchema = {
  type: "object",
  additionalProperties: false,
  required: ["playerId", "displayName", "status", "position", "signedUpAtMs", "attendance", "hasSwitch1", "hasSwitch2"],
  properties: {
    playerId: playerIdSchema,
    displayName: { type: "string", minLength: 1, maxLength: 128 },
    status: { type: "string", enum: ["pending", "selected", "waiting", "withdrawn", "removed"] },
    position: { anyOf: [{ type: "integer", minimum: 1 }, { type: "null" }] },
    signedUpAtMs: epochSchema,
    attendance: { anyOf: [{ type: "string", enum: ["present", "waiting", "absent"] }, { type: "null" }] },
    hasSwitch1: { type: "boolean" },
    hasSwitch2: { type: "boolean" },
  },
} as const;

export const signupBoardSettingsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["mode", "selection", "status", "closesAtMs", "capacity", "closedAtMs", "drawSeed", "drawAlgorithm"],
  properties: {
    mode: modeSchema,
    selection: selectionSchema,
    status: statusSchema,
    closesAtMs: nullableEpoch,
    capacity: nullableCount,
    closedAtMs: nullableEpoch,
    drawSeed: seedSchema,
    drawAlgorithm: algorithmSchema,
  },
} as const;

export const signupConsolesSchema = {
  type: "object",
  additionalProperties: false,
  required: ["players", "coming", "needed", "warning"],
  properties: {
    players: { type: "integer", minimum: 0 },
    coming: { type: "integer", minimum: 0 },
    needed: { type: "integer", minimum: 0 },
    warning: { type: "boolean" },
  },
} as const;

export const signupBoardSchema = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "tournamentId", "editable", "settings", "entries", "consoles"],
  properties: {
    schemaVersion: { type: "string", const: "mk8dx.tournament-signup-board.v1" },
    tournamentId: tournamentIdSchema,
    editable: { type: "boolean" },
    settings: signupBoardSettingsSchema,
    entries: { type: "array", maxItems: 500, items: signupBoardEntrySchema },
    consoles: signupConsolesSchema,
  },
} as const;

const params = {
  type: "object", additionalProperties: false, required: ["tournamentId"], properties: { tournamentId: tournamentIdSchema },
} as const;
const signUpBody = {
  type: "object",
  additionalProperties: false,
  required: ["hasSwitch1", "hasSwitch2"],
  properties: { hasSwitch1: { type: "boolean" }, hasSwitch2: { type: "boolean" }, playerId: playerIdSchema },
} as const;
const emptyBody = { type: "object", additionalProperties: false, properties: {} } as const;
const settingsBody = {
  type: "object",
  additionalProperties: false,
  required: ["mode"],
  properties: {
    mode: modeSchema,
    selection: { type: "string", enum: ["first_come", "draw"] },
    closesAtMs: { type: "integer", minimum: 0, maximum: 253_402_300_799_999 },
    capacity: { type: "integer", minimum: 1, maximum: 60 },
  },
} as const;
const moveBody = {
  type: "object",
  additionalProperties: false,
  required: ["playerId", "to"],
  properties: {
    playerId: playerIdSchema,
    to: { type: "string", enum: ["selected", "waiting", "removed"] },
    position: { type: "integer", minimum: 1, maximum: 1000 },
  },
} as const;

const errors = {
  400: errorResponseSchema,
  401: errorResponseSchema,
  403: errorResponseSchema,
  404: errorResponseSchema,
  409: errorResponseSchema,
  503: errorResponseSchema,
} as const;

const statuses = {
  not_authenticated: 401,
  forbidden: 403,
  invalid_input: 400,
  not_found: 404,
  no_verified_player: 403,
  closed: 409,
  conflict: 409,
  unavailable: 503,
} as const;

function send(reply: FastifyReply, error: unknown) {
  if (error instanceof TournamentSignupError) {
    return reply.code(statuses[error.code]).send({ code: `tournament_signup_${error.code}`, message: error.message });
  }
  return reply.code(503).send({ code: "tournament_signup_unavailable", message: "Sign-up is temporarily unavailable." });
}

function csrfToken(request: FastifyRequest): string | null {
  const value = request.headers["x-mk8dx-csrf"];
  return typeof value === "string" ? value : null;
}

function requireNativeBearer(request: FastifyRequest): void {
  // Shape-check only, as on the native Tournament routes; resolveActor stays authoritative.
  if (!/^Bearer [^\s]{20,512}$/i.test(request.headers.authorization ?? "")) {
    throw new TournamentSignupError("not_authenticated", "A native-app bearer token is required.");
  }
}

type SignupService = Pick<
  TournamentSignupService,
  "status" | "signUp" | "withdraw" | "board" | "configure" | "closeNow" | "move"
>;

export async function registerTournamentSignupRoutes(
  app: FastifyInstance,
  options: Readonly<{
    resolveActor: ActorResolver;
    service: SignupService;
    csrfVerifier: Readonly<{ verify(actor: ActorContext, token: string): boolean }>;
  }>,
): Promise<void> {
  const browserWriter = async (request: FastifyRequest): Promise<ActorContext> => {
    const actor = await options.resolveActor(request);
    const token = csrfToken(request);
    if (token === null || !options.csrfVerifier.verify(actor, token)) {
      throw new TournamentSignupError("forbidden", "The request is not authorized.");
    }
    return actor;
  };
  const nativeActor = async (request: FastifyRequest): Promise<ActorContext> => {
    requireNativeBearer(request);
    return await options.resolveActor(request);
  };
  const documentOf = (document: TournamentSignupDocument) => ({
    schemaVersion: "mk8dx.tournament-signup.v1" as const, ...document,
  });
  const boardOf = (board: TournamentSignupBoard) => ({
    schemaVersion: "mk8dx.tournament-signup-board.v1" as const, ...board,
  });

  for (const [prefix, writer] of [
    ["/v1/tournaments", browserWriter],
    ["/v1/native/tournaments", nativeActor],
  ] as const) {
    // Reading needs nobody: a visitor sees the terms and the lists, a signed-in viewer also themselves.
    app.get<{ Params: { tournamentId: string } }>(
      `${prefix}/:tournamentId/signup`,
      { schema: { params, response: { 200: signupDocumentSchema, ...errors } } },
      async (request, reply) => {
        reply.header("Cache-Control", "no-store");
        try {
          return documentOf(await options.service.status(await options.resolveActor(request), request.params.tournamentId));
        } catch (error) {
          return send(reply, error);
        }
      },
    );
    app.post<{ Params: { tournamentId: string }; Body: { hasSwitch1: boolean; hasSwitch2: boolean; playerId?: string } }>(
      `${prefix}/:tournamentId/signup`,
      { schema: { params, body: signUpBody, response: { 200: signupDocumentSchema, ...errors } } },
      async (request, reply) => {
        reply.header("Cache-Control", "no-store");
        try {
          return documentOf(await options.service.signUp(await writer(request), request.params.tournamentId, request.body));
        } catch (error) {
          return send(reply, error);
        }
      },
    );
    app.post<{ Params: { tournamentId: string }; Body: Record<string, never> }>(
      `${prefix}/:tournamentId/signup/actions/withdraw`,
      { schema: { params, body: emptyBody, response: { 200: signupDocumentSchema, ...errors } } },
      async (request, reply) => {
        reply.header("Cache-Control", "no-store");
        try {
          return documentOf(await options.service.withdraw(await writer(request), request.params.tournamentId));
        } catch (error) {
          return send(reply, error);
        }
      },
    );
    app.get<{ Params: { tournamentId: string } }>(
      `${prefix}/:tournamentId/signups`,
      { schema: { params, response: { 200: signupBoardSchema, ...errors } } },
      async (request, reply) => {
        reply.header("Cache-Control", "no-store");
        try {
          const actor = prefix === "/v1/native/tournaments"
            ? await nativeActor(request)
            : await options.resolveActor(request);
          return boardOf(await options.service.board(actor, request.params.tournamentId));
        } catch (error) {
          return send(reply, error);
        }
      },
    );
    app.post<{ Params: { tournamentId: string }; Body: { mode: "director" | "open"; selection?: "first_come" | "draw"; closesAtMs?: number; capacity?: number } }>(
      `${prefix}/:tournamentId/signup-settings`,
      { schema: { params, body: settingsBody, response: { 200: signupBoardSchema, ...errors } } },
      async (request, reply) => {
        try {
          return boardOf(await options.service.configure(await writer(request), request.params.tournamentId, request.body));
        } catch (error) {
          return send(reply, error);
        }
      },
    );
    app.post<{ Params: { tournamentId: string }; Body: Record<string, never> }>(
      `${prefix}/:tournamentId/signups/actions/close`,
      { schema: { params, body: emptyBody, response: { 200: signupBoardSchema, ...errors } } },
      async (request, reply) => {
        try {
          return boardOf(await options.service.closeNow(await writer(request), request.params.tournamentId));
        } catch (error) {
          return send(reply, error);
        }
      },
    );
    app.post<{ Params: { tournamentId: string }; Body: { playerId: string; to: "selected" | "waiting" | "removed"; position?: number } }>(
      `${prefix}/:tournamentId/signups/actions/move`,
      { schema: { params, body: moveBody, response: { 200: signupBoardSchema, ...errors } } },
      async (request, reply) => {
        try {
          return boardOf(await options.service.move(await writer(request), request.params.tournamentId, request.body));
        } catch (error) {
          return send(reply, error);
        }
      },
    );
  }
}
