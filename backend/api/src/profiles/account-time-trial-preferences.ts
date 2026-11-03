import type { FastifyInstance } from "fastify";
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";

import { errorResponseSchema } from "../identity/schemas.js";
import type { ActorContext, ActorResolver } from "../identity/types.js";
import type { TimeTrialWebCsrfVerifier } from "../timetrials/submission-routes.js";

export type TimeTrialModePreference = "all" | "150" | "200";
export type TimeTrialTrackAccess = "unknown" | "base_only" | "base_and_bcp";
export type AccountTimeTrialPreferences = Readonly<{
  modePreference: TimeTrialModePreference;
  screenName: string | null;
  trackAccess: TimeTrialTrackAccess;
}>;

export class AccountTimeTrialPreferencesError extends Error {
  public constructor(public readonly code: "not_authenticated" | "invalid_input" | "unavailable") {
    super("Account Time Trial preferences could not be updated.");
    this.name = "AccountTimeTrialPreferencesError";
  }
}

export interface AccountTimeTrialPreferencesRepository {
  read(userAccountId: string): Promise<AccountTimeTrialPreferences | null>;
  update(userAccountId: string, value: AccountTimeTrialPreferences, nowMs: number): Promise<boolean>;
}

const allowedScreenName = /^[\p{L}\p{N} ._'’\-]+$/u;

function account(actor: ActorContext): string {
  if (actor.role !== "account" && actor.role !== "administrator") {
    throw new AccountTimeTrialPreferencesError("not_authenticated");
  }
  return actor.userAccountId;
}

export class AccountTimeTrialPreferencesService {
  public constructor(
    private readonly repository: AccountTimeTrialPreferencesRepository,
    private readonly nowMs: () => number = Date.now,
  ) {}

  public async readMine(actor: ActorContext): Promise<AccountTimeTrialPreferences> {
    try {
      const value = await this.repository.read(account(actor));
      if (value === null) { throw new AccountTimeTrialPreferencesError("not_authenticated"); }
      return value;
    } catch (error) {
      if (error instanceof AccountTimeTrialPreferencesError) { throw error; }
      throw new AccountTimeTrialPreferencesError("unavailable");
    }
  }

  public async updateMine(
    actor: ActorContext,
    input: Readonly<{ modePreference: string; screenName: string | null; trackAccess?: string }>,
  ): Promise<AccountTimeTrialPreferences> {
    const mode = input.modePreference;
    const screenName = input.screenName === null ? null : input.screenName.trim();
    if ((mode !== "all" && mode !== "150" && mode !== "200") ||
        (input.trackAccess !== undefined && input.trackAccess !== "unknown" &&
          input.trackAccess !== "base_only" && input.trackAccess !== "base_and_bcp") ||
        (screenName !== null && (screenName.length < 1 || screenName.length > 32 ||
          !allowedScreenName.test(screenName)))) {
      throw new AccountTimeTrialPreferencesError("invalid_input");
    }
    try {
      const userAccountId = account(actor);
      const existing = input.trackAccess === undefined
        ? await this.repository.read(userAccountId)
        : null;
      if (input.trackAccess === undefined && existing === null) {
        throw new AccountTimeTrialPreferencesError("not_authenticated");
      }
      const trackAccess = input.trackAccess ?? existing!.trackAccess;
      const value: AccountTimeTrialPreferences = { modePreference: mode, screenName, trackAccess };
      if (!await this.repository.update(userAccountId, value, this.nowMs())) {
        throw new AccountTimeTrialPreferencesError("not_authenticated");
      }
      return value;
    } catch (error) {
      if (error instanceof AccountTimeTrialPreferencesError) { throw error; }
      throw new AccountTimeTrialPreferencesError("unavailable");
    }
  }
}

interface PreferenceRow extends RowDataPacket {
  modePreference: unknown;
  screenName: unknown;
  trackAccess: unknown;
}

export class MysqlAccountTimeTrialPreferencesRepository implements AccountTimeTrialPreferencesRepository {
  public constructor(private readonly pool: Pick<Pool, "execute">) {}

  public async read(userAccountId: string): Promise<AccountTimeTrialPreferences | null> {
    const [rows] = await this.pool.execute<PreferenceRow[]>(
      `SELECT time_trial_mode_preference AS modePreference, screen_name AS screenName,
              time_trial_track_access AS trackAccess
       FROM user_accounts WHERE public_id = ? AND account_status = 'active' LIMIT 1`,
      [userAccountId],
    );
    const row = rows[0];
    if (row === undefined) { return null; }
    const mode = row.modePreference;
    return {
      modePreference: mode === "150" || mode === "200" ? mode : "all",
      screenName: typeof row.screenName === "string" ? row.screenName : null,
      trackAccess: row.trackAccess === "base_only" || row.trackAccess === "base_and_bcp"
        ? row.trackAccess : "unknown",
    };
  }

  public async update(
    userAccountId: string,
    value: AccountTimeTrialPreferences,
    nowMs: number,
  ): Promise<boolean> {
    const [result] = await this.pool.execute<ResultSetHeader>(
      `UPDATE user_accounts SET time_trial_mode_preference = ?, screen_name = ?,
              time_trial_track_access = ?,
              revision = revision + 1, updated_at_ms = ?
       WHERE public_id = ? AND account_status = 'active'`,
      [value.modePreference, value.screenName, value.trackAccess, nowMs, userAccountId],
    );
    return result.affectedRows === 1;
  }
}

const preferenceSchema = {
  type: "object", additionalProperties: false,
  required: ["schemaVersion", "modePreference", "screenName", "trackAccess"],
  properties: {
    schemaVersion: { type: "string", const: "mk8dx.account-time-trial-preferences.v1" },
    modePreference: { type: "string", enum: ["all", "150", "200"] },
    screenName: { anyOf: [{ type: "string", minLength: 1, maxLength: 32 }, { type: "null" }] },
    trackAccess: { type: "string", enum: ["unknown", "base_only", "base_and_bcp"] },
  },
} as const;

function failure(error: unknown): Readonly<{ status: 400 | 401 | 503; body: { code: string; message: string } }> {
  if (error instanceof AccountTimeTrialPreferencesError) {
    if (error.code === "not_authenticated") return { status: 401, body: { code: "not_authenticated", message: "Sign in to manage these settings." } };
    if (error.code === "invalid_input") return { status: 400, body: { code: "preferences_invalid", message: "Choose valid Time Trial preferences and a valid screen name." } };
  }
  return { status: 503, body: { code: "preferences_unavailable", message: "Settings are temporarily unavailable." } };
}

export async function registerAccountTimeTrialPreferenceRoutes(
  app: FastifyInstance,
  options: Readonly<{
    resolveActor: ActorResolver;
    service: Pick<AccountTimeTrialPreferencesService, "readMine" | "updateMine">;
    csrfVerifier?: TimeTrialWebCsrfVerifier;
  }>,
): Promise<void> {
  app.get("/v1/account/time-trial-preferences", { schema: { response: { 200: preferenceSchema, 401: errorResponseSchema, 503: errorResponseSchema } } }, async (request, reply) => {
    try {
      return reply.send({ schemaVersion: "mk8dx.account-time-trial-preferences.v1", ...await options.service.readMine(await options.resolveActor(request)) });
    } catch (error) {
      const value = failure(error);
      return reply.code(value.status === 400 ? 503 : value.status).send(value.body);
    }
  });
  app.put<{ Body: Readonly<{ modePreference: string; screenName: string | null; trackAccess?: string }> }>(
    "/v1/account/time-trial-preferences",
    { schema: {
      body: { type: "object", additionalProperties: false, required: ["modePreference", "screenName"], properties: {
        modePreference: { type: "string", enum: ["all", "150", "200"] },
        screenName: { anyOf: [{ type: "string", minLength: 1, maxLength: 32 }, { type: "null" }] },
        trackAccess: { type: "string", enum: ["unknown", "base_only", "base_and_bcp"] },
      } },
      response: { 200: preferenceSchema, 400: errorResponseSchema, 401: errorResponseSchema, 503: errorResponseSchema },
    } },
    async (request, reply) => {
      try {
        const actor = await options.resolveActor(request);
        const proof = request.headers["x-mk8dx-csrf"];
        if (options.csrfVerifier !== undefined && (typeof proof !== "string" || !await options.csrfVerifier.verify(actor, proof))) {
          throw new AccountTimeTrialPreferencesError("not_authenticated");
        }
        return reply.send({ schemaVersion: "mk8dx.account-time-trial-preferences.v1", ...await options.service.updateMine(actor, request.body) });
      } catch (error) { const value = failure(error); return reply.code(value.status).send(value.body); }
    },
  );
}
