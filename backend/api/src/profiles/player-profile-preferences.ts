import type { FastifyInstance } from "fastify";
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";

import { errorResponseSchema } from "../identity/schemas.js";
import type { ActorContext, ActorResolver } from "../identity/types.js";
import type { TimeTrialWebCsrfVerifier } from "../timetrials/submission-routes.js";
import {
  accountSettingRateLimitFailure,
  consumeAccountSettingMutationBudget,
} from "../security/account-setting-mutation-budget.js";
import type { MutationRateLimiter } from "../security/mysql-mutation-rate-limiter.js";

export type PlayerProfilePreferences = Readonly<{
  countryId: string | null;
  favoriteCharacterId: string | null;
  favoriteBodyId: string | null;
  favoriteTireId: string | null;
  favoriteGliderId: string | null;
}>;

export interface PlayerProfilePreferenceCatalog {
  hasCountry(id: string): boolean;
  hasCharacterAppearance(id: string): boolean;
  hasBody(id: string): boolean;
  hasTire(id: string): boolean;
  hasGlider(id: string): boolean;
}

export interface PlayerProfilePreferenceRepository {
  readForAccount(userAccountId: string): Promise<PlayerProfilePreferences | null>;
  updateForAccount(userAccountId: string, value: PlayerProfilePreferences, nowMs: number): Promise<boolean>;
}

export class PlayerProfilePreferenceError extends Error {
  public constructor(public readonly code: "not_authenticated" | "no_verified_player" | "invalid_input" | "unavailable") {
    super("Player profile preferences could not be saved.");
    this.name = "PlayerProfilePreferenceError";
  }
}

function account(actor: ActorContext): string {
  if (actor.role !== "account" && actor.role !== "administrator") {
    throw new PlayerProfilePreferenceError("not_authenticated");
  }
  return actor.userAccountId;
}

export class PlayerProfilePreferenceService {
  public constructor(
    private readonly repository: PlayerProfilePreferenceRepository,
    private readonly catalog: PlayerProfilePreferenceCatalog,
    private readonly nowMs: () => number = Date.now,
  ) {}

  public async readMine(actor: ActorContext): Promise<PlayerProfilePreferences> {
    try {
      const value = await this.repository.readForAccount(account(actor));
      if (value === null) throw new PlayerProfilePreferenceError("no_verified_player");
      return value;
    } catch (error) {
      if (error instanceof PlayerProfilePreferenceError) throw error;
      throw new PlayerProfilePreferenceError("unavailable");
    }
  }

  public async updateMine(actor: ActorContext, value: PlayerProfilePreferences): Promise<PlayerProfilePreferences> {
    if ((value.countryId !== null && !this.catalog.hasCountry(value.countryId)) ||
        (value.favoriteCharacterId !== null && !this.catalog.hasCharacterAppearance(value.favoriteCharacterId)) ||
        (value.favoriteBodyId !== null && !this.catalog.hasBody(value.favoriteBodyId)) ||
        (value.favoriteTireId !== null && !this.catalog.hasTire(value.favoriteTireId)) ||
        (value.favoriteGliderId !== null && !this.catalog.hasGlider(value.favoriteGliderId))) {
      throw new PlayerProfilePreferenceError("invalid_input");
    }
    try {
      if (!await this.repository.updateForAccount(account(actor), value, this.nowMs())) {
        throw new PlayerProfilePreferenceError("no_verified_player");
      }
      return value;
    } catch (error) {
      if (error instanceof PlayerProfilePreferenceError) throw error;
      throw new PlayerProfilePreferenceError("unavailable");
    }
  }
}

interface PreferenceRow extends RowDataPacket {
  playerInternalId: unknown;
  countryId: unknown;
  favoriteCharacterId: unknown;
  favoriteBodyId: unknown;
  favoriteTireId: unknown;
  favoriteGliderId: unknown;
}

const valueOrNull = (value: unknown): string | null => typeof value === "string" ? value : null;

export class MysqlPlayerProfilePreferenceRepository implements PlayerProfilePreferenceRepository {
  public constructor(private readonly pool: Pick<Pool, "execute">) {}

  private async row(userAccountId: string): Promise<PreferenceRow | null> {
    const [rows] = await this.pool.execute<PreferenceRow[]>(
      `SELECT player.player_id AS playerInternalId,
              player.country_id AS countryId, player.avatar_id AS favoriteCharacterId,
              player.favorite_body_id AS favoriteBodyId,
              player.favorite_tire_id AS favoriteTireId,
              player.favorite_glider_id AS favoriteGliderId
       FROM players AS player
       INNER JOIN player_claims AS claim
         ON claim.player_id = player.player_id AND claim.claim_status = 'verified'
       INNER JOIN user_accounts AS account
         ON account.user_account_id = claim.user_account_id AND account.account_status = 'active'
       WHERE account.public_id = ? AND player.record_status = 'active'
       LIMIT 1`,
      [userAccountId],
    );
    return rows[0] ?? null;
  }

  public async readForAccount(userAccountId: string): Promise<PlayerProfilePreferences | null> {
    const row = await this.row(userAccountId);
    return row === null ? null : {
      countryId: valueOrNull(row.countryId),
      favoriteCharacterId: valueOrNull(row.favoriteCharacterId),
      favoriteBodyId: valueOrNull(row.favoriteBodyId),
      favoriteTireId: valueOrNull(row.favoriteTireId),
      favoriteGliderId: valueOrNull(row.favoriteGliderId),
    };
  }

  public async updateForAccount(userAccountId: string, value: PlayerProfilePreferences, nowMs: number): Promise<boolean> {
    const row = await this.row(userAccountId);
    const playerInternalId = Number(row?.playerInternalId);
    if (!Number.isSafeInteger(playerInternalId)) return false;
    const [result] = await this.pool.execute<ResultSetHeader>(
      `UPDATE players SET country_id = ?, avatar_id = ?, favorite_body_id = ?,
              favorite_tire_id = ?, favorite_glider_id = ?, revision = revision + 1,
              updated_at_ms = ? WHERE player_id = ? AND record_status = 'active'`,
      [value.countryId, value.favoriteCharacterId, value.favoriteBodyId,
        value.favoriteTireId, value.favoriteGliderId, nowMs, playerInternalId],
    );
    return result.affectedRows === 1;
  }
}

const nullableId = (pattern: string) => ({ anyOf: [{ type: "string", maxLength: 128, pattern }, { type: "null" }] }) as const;
const preferenceProperties = {
  countryId: nullableId("^country\\.[a-z0-9_]+$"),
  favoriteCharacterId: nullableId("^character(_variant)?\\.[a-z0-9_.]+$"),
  favoriteBodyId: nullableId("^body\\.[a-z0-9_]+$"),
  favoriteTireId: nullableId("^tire\\.[a-z0-9_]+$"),
  favoriteGliderId: nullableId("^glider\\.[a-z0-9_]+$"),
} as const;
const preferenceFields = Object.keys(preferenceProperties);
const responseSchema = {
  type: "object", additionalProperties: false,
  required: ["schemaVersion", ...preferenceFields],
  properties: { schemaVersion: { type: "string", const: "mk8dx.player-profile-preferences.v1" }, ...preferenceProperties },
} as const;

function failure(error: unknown): Readonly<{ status: 400 | 401 | 409 | 503; body: { code: string; message: string } }> {
  if (error instanceof PlayerProfilePreferenceError) {
    if (error.code === "not_authenticated") return { status: 401, body: { code: "not_authenticated", message: "Sign in to manage Player settings." } };
    if (error.code === "no_verified_player") return { status: 409, body: { code: "no_verified_player", message: "Claim a Player before saving Player settings." } };
    if (error.code === "invalid_input") return { status: 400, body: { code: "profile_preferences_invalid", message: "Choose values from the MK8DX catalog." } };
  }
  return { status: 503, body: { code: "profile_preferences_unavailable", message: "Player settings are temporarily unavailable." } };
}

export async function registerPlayerProfilePreferenceRoutes(
  app: FastifyInstance,
  options: Readonly<{
    resolveActor: ActorResolver;
    service: Pick<PlayerProfilePreferenceService, "readMine" | "updateMine">;
    csrfVerifier?: TimeTrialWebCsrfVerifier;
    rateLimiter: MutationRateLimiter;
  }>,
): Promise<void> {
  app.get("/v1/account/player-profile-preferences", { schema: { response: {
    200: responseSchema, 400: errorResponseSchema, 401: errorResponseSchema, 409: errorResponseSchema, 503: errorResponseSchema,
  } } }, async (request, reply) => {
    try { return reply.send({ schemaVersion: "mk8dx.player-profile-preferences.v1", ...await options.service.readMine(await options.resolveActor(request)) }); }
    catch (error) { const value = failure(error); return reply.code(value.status).send(value.body); }
  });
  app.put<{ Body: PlayerProfilePreferences }>("/v1/account/player-profile-preferences", { schema: {
    body: { type: "object", additionalProperties: false, required: preferenceFields, properties: preferenceProperties },
    response: { 200: responseSchema, 400: errorResponseSchema, 401: errorResponseSchema, 409: errorResponseSchema, 429: errorResponseSchema, 503: errorResponseSchema },
  } }, async (request, reply) => {
    try {
      const actor = await options.resolveActor(request);
      const proof = request.headers["x-mk8dx-csrf"];
      if (options.csrfVerifier !== undefined && (typeof proof !== "string" || !await options.csrfVerifier.verify(actor, proof))) {
        throw new PlayerProfilePreferenceError("not_authenticated");
      }
      await consumeAccountSettingMutationBudget(actor, options.rateLimiter);
      return reply.send({ schemaVersion: "mk8dx.player-profile-preferences.v1", ...await options.service.updateMine(actor, request.body) });
    } catch (error) {
      const limited = accountSettingRateLimitFailure(error);
      if (limited !== null) {
        void reply.header("retry-after", String(limited.retryAfterSeconds));
        return reply.code(429).send(limited.body);
      }
      const value = failure(error);
      return reply.code(value.status).send(value.body);
    }
  });
}
