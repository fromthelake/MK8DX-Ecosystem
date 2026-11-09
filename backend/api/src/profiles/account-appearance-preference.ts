// The account-canonical appearance choice (ADR-0205, DESIGN_SYSTEM.md §19).
//
// Only the choice travels - `system`, `light` or `dark` - never the mode a device resolved it to,
// so a device on `system` follows its own operating system. A 404-free "never chosen" is expressed
// as `appearance: null`: the account has no opinion, and every device keeps whatever it chose
// locally until the person changes it explicitly. That is why this route never writes on a read and
// never backfills a default.
//
// It follows the ADR-0172 account-preferences pattern exactly (same actor resolution, same CSRF
// proof on the mutation, same error vocabulary) and is its own document so no existing response
// schema grows a key - the web parsers demand the keys they know.

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

export type AppearanceChoice = "system" | "light" | "dark";
export const APPEARANCE_CHOICES: readonly AppearanceChoice[] = ["system", "light", "dark"];

export function isAppearanceChoice(value: unknown): value is AppearanceChoice {
  return value === "system" || value === "light" || value === "dark";
}

export class AccountAppearancePreferenceError extends Error {
  public constructor(public readonly code: "not_authenticated" | "invalid_input" | "unavailable") {
    super("The appearance preference could not be read or updated.");
    this.name = "AccountAppearancePreferenceError";
  }
}

export interface AccountAppearancePreferenceRepository {
  /** null = this account never chose; the device keeps its own choice. */
  read(userAccountId: string): Promise<AppearanceChoice | null>;
  update(userAccountId: string, choice: AppearanceChoice, nowMs: number): Promise<boolean>;
}

function account(actor: ActorContext): string {
  if (actor.role !== "account" && actor.role !== "administrator") {
    throw new AccountAppearancePreferenceError("not_authenticated");
  }
  return actor.userAccountId;
}

export class AccountAppearancePreferenceService {
  public constructor(
    private readonly repository: AccountAppearancePreferenceRepository,
    private readonly nowMs: () => number = Date.now,
  ) {}

  public async readMine(actor: ActorContext): Promise<AppearanceChoice | null> {
    const userAccountId = account(actor);
    try {
      return await this.repository.read(userAccountId);
    } catch {
      throw new AccountAppearancePreferenceError("unavailable");
    }
  }

  public async updateMine(actor: ActorContext, appearance: unknown): Promise<AppearanceChoice> {
    if (!isAppearanceChoice(appearance)) {
      throw new AccountAppearancePreferenceError("invalid_input");
    }
    const userAccountId = account(actor);
    let stored: boolean;
    try {
      stored = await this.repository.update(userAccountId, appearance, this.nowMs());
    } catch {
      throw new AccountAppearancePreferenceError("unavailable");
    }
    if (!stored) { throw new AccountAppearancePreferenceError("not_authenticated"); }
    return appearance;
  }
}

interface AppearanceRow extends RowDataPacket { appearance: unknown }

export class MysqlAccountAppearancePreferenceRepository
implements AccountAppearancePreferenceRepository {
  public constructor(private readonly pool: Pick<Pool, "execute">) {}

  public async read(userAccountId: string): Promise<AppearanceChoice | null> {
    const [rows] = await this.pool.execute<AppearanceRow[]>(
      `SELECT p.appearance_preference AS appearance
       FROM user_account_appearance_preferences p
       JOIN user_accounts a ON a.user_account_id = p.user_account_id
       WHERE a.public_id = ? AND a.account_status = 'active' LIMIT 1`,
      [userAccountId],
    );
    const value = rows[0]?.appearance;
    return isAppearanceChoice(value) ? value : null;
  }

  public async update(
    userAccountId: string,
    choice: AppearanceChoice,
    nowMs: number,
  ): Promise<boolean> {
    // One statement, no read-modify-write: the row exists or it does not.
    // The ON DUPLICATE clause repeats the parameters instead of using VALUES(),
    // which MySQL 8 deprecates and MariaDB spells differently.
    const [result] = await this.pool.execute<ResultSetHeader>(
      `INSERT INTO user_account_appearance_preferences
         (user_account_id, appearance_preference, updated_at_ms)
       SELECT a.user_account_id, ?, ? FROM user_accounts a
       WHERE a.public_id = ? AND a.account_status = 'active'
       ON DUPLICATE KEY UPDATE appearance_preference = ?, updated_at_ms = ?`,
      [choice, nowMs, userAccountId, choice, nowMs],
    );
    return result.affectedRows >= 1;
  }
}

const appearanceSchema = {
  type: "object", additionalProperties: false,
  required: ["schemaVersion", "appearance"],
  properties: {
    schemaVersion: { type: "string", const: "mk8dx.account-appearance-preference.v1" },
    appearance: {
      anyOf: [{ type: "string", enum: ["system", "light", "dark"] }, { type: "null" }],
    },
  },
} as const;

function failure(
  error: unknown,
): Readonly<{ status: 400 | 401 | 503; body: { code: string; message: string } }> {
  if (error instanceof AccountAppearancePreferenceError) {
    if (error.code === "not_authenticated") {
      return { status: 401, body: { code: "not_authenticated", message: "Sign in to sync your appearance." } };
    }
    if (error.code === "invalid_input") {
      return { status: 400, body: { code: "appearance_invalid", message: "Choose System, Light or Dark." } };
    }
  }
  return { status: 503, body: { code: "appearance_unavailable", message: "Appearance is temporarily unavailable." } };
}

export async function registerAccountAppearancePreferenceRoutes(
  app: FastifyInstance,
  options: Readonly<{
    resolveActor: ActorResolver;
    service: Pick<AccountAppearancePreferenceService, "readMine" | "updateMine">;
    csrfVerifier?: TimeTrialWebCsrfVerifier;
    rateLimiter: MutationRateLimiter;
  }>,
): Promise<void> {
  app.get(
    "/v1/account/appearance-preference",
    { schema: { response: { 200: appearanceSchema, 401: errorResponseSchema, 503: errorResponseSchema } } },
    async (request, reply) => {
      try {
        const appearance = await options.service.readMine(await options.resolveActor(request));
        return reply.send({ schemaVersion: "mk8dx.account-appearance-preference.v1", appearance });
      } catch (error) {
        const value = failure(error);
        return reply.code(value.status === 400 ? 503 : value.status).send(value.body);
      }
    },
  );
  app.put<{ Body: Readonly<{ appearance: string }> }>(
    "/v1/account/appearance-preference",
    { schema: {
      body: {
        type: "object", additionalProperties: false, required: ["appearance"],
        properties: { appearance: { type: "string", enum: ["system", "light", "dark"] } },
      },
      response: {
        200: appearanceSchema, 400: errorResponseSchema,
        401: errorResponseSchema, 429: errorResponseSchema, 503: errorResponseSchema,
      },
    } },
    async (request, reply) => {
      try {
        const actor = await options.resolveActor(request);
        const proof = request.headers["x-mk8dx-csrf"];
        if (options.csrfVerifier !== undefined &&
            (typeof proof !== "string" || !await options.csrfVerifier.verify(actor, proof))) {
          throw new AccountAppearancePreferenceError("not_authenticated");
        }
        await consumeAccountSettingMutationBudget(actor, options.rateLimiter);
        const appearance = await options.service.updateMine(actor, request.body?.appearance);
        return reply.send({ schemaVersion: "mk8dx.account-appearance-preference.v1", appearance });
      } catch (error) {
        const limited = accountSettingRateLimitFailure(error);
        if (limited !== null) {
          void reply.header("retry-after", String(limited.retryAfterSeconds));
          return reply.code(429).send(limited.body);
        }
        const value = failure(error);
        return reply.code(value.status).send(value.body);
      }
    },
  );
}
