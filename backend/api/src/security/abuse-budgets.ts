import { createHash, createHmac } from "node:crypto";

import type { ActorContext } from "../identity/types.js";
import {
  MutationRateLimitExceeded,
  type MutationRateLimiter,
} from "./mysql-mutation-rate-limiter.js";

/**
 * Installation-wide and per-target budgets (hardening H1).
 *
 * Per-account budgets stop one account. They do not stop a person with many fresh accounts, and they
 * do not stop many accounts aiming at one person. Two more kinds of budget close that gap, all
 * durable in `api_mutation_rate_limits` through `MysqlMutationRateLimiter` and therefore shared by
 * every API process:
 *
 * - an **installation** budget per expensive or fan-out path: one counter for the whole community, so
 *   however many accounts take part, the database and the mail server receive a bounded amount;
 * - a **target** budget for actions that notify somebody else (a claim on a Player, a message on a
 *   claim, a dispute): one counter per target, so one victim's inbox stays bounded however many
 *   accounts aim at it.
 *
 * Order matters: a route consumes the caller's own budget first, then the installation budget, then
 * the target budget. One account therefore never drains the installation budget beyond its own
 * allowance, and a target counter is only created by a request that was already admitted by the
 * account and installation budgets, so caller-chosen target ids cannot create unbounded rows.
 *
 * Defaults are sized from realistic community volumes (see docs/architecture/MUTATING_ROUTES.md,
 * "Installation budgets"): a community of a few hundred Players, a launch day where most of them
 * sign in and claim their Player, a phone uploading a long offline queue and a busy Tournament night
 * all stay well below them. Each can be changed with its MK8DX_HOSTED_BUDGET_* setting.
 */

export type BudgetWindow = Readonly<{ windowSeconds: number; maximum: number }>;

type SettingDefinition = Readonly<{ env: string; windowSeconds: number; fallback: number }>;

const HOUR = 3_600;
const DAY = 86_400;

/** Every configurable budget: its setting name, window and default. */
export const ABUSE_BUDGET_DEFINITIONS = {
  // Whole-installation backstop for every signed-in mutation under /v1 (one counter per minute).
  mutationsPerMinute: { env: "MK8DX_HOSTED_BUDGET_MUTATIONS_PER_MINUTE", windowSeconds: 60, fallback: 6_000 },
  // Per-account backstop for every signed-in mutation under /v1; administrators get the higher pair.
  accountMutationsPer10Minutes: { env: "MK8DX_HOSTED_BUDGET_ACCOUNT_MUTATIONS_PER_10_MINUTES", windowSeconds: 600, fallback: 600 },
  accountMutationsPerDay: { env: "MK8DX_HOSTED_BUDGET_ACCOUNT_MUTATIONS_PER_DAY", windowSeconds: DAY, fallback: 10_000 },
  administratorMutationsPer10Minutes: { env: "MK8DX_HOSTED_BUDGET_ADMINISTRATOR_MUTATIONS_PER_10_MINUTES", windowSeconds: 600, fallback: 3_000 },
  administratorMutationsPerDay: { env: "MK8DX_HOSTED_BUDGET_ADMINISTRATOR_MUTATIONS_PER_DAY", windowSeconds: DAY, fallback: 30_000 },
  // Sign-in, sign-up, change of e-mail and app sign-in mail, together.
  authEmailsPerHour: { env: "MK8DX_HOSTED_BUDGET_AUTH_EMAILS_PER_HOUR", windowSeconds: HOUR, fallback: 600 },
  authEmailsPerDay: { env: "MK8DX_HOSTED_BUDGET_AUTH_EMAILS_PER_DAY", windowSeconds: DAY, fallback: 3_000 },
  authEmailsPerRecipientPerHour: { env: "MK8DX_HOSTED_BUDGET_AUTH_EMAILS_PER_RECIPIENT_PER_HOUR", windowSeconds: HOUR, fallback: 6 },
  authEmailsPerRecipientPerDay: { env: "MK8DX_HOSTED_BUDGET_AUTH_EMAILS_PER_RECIPIENT_PER_DAY", windowSeconds: DAY, fallback: 20 },
  authEmailsPerAddressPerHour: { env: "MK8DX_HOSTED_BUDGET_AUTH_EMAILS_PER_ADDRESS_PER_HOUR", windowSeconds: HOUR, fallback: 120 },
  deviceCodesPerHour: { env: "MK8DX_HOSTED_BUDGET_DEVICE_CODES_PER_HOUR", windowSeconds: HOUR, fallback: 1_200 },
  deviceCodesPerAddressPerHour: { env: "MK8DX_HOSTED_BUDGET_DEVICE_CODES_PER_ADDRESS_PER_HOUR", windowSeconds: HOUR, fallback: 240 },
  // Player claims and the messages around them (replies, reviewer questions and decisions, disputes).
  claimRequestsPerHour: { env: "MK8DX_HOSTED_BUDGET_CLAIM_REQUESTS_PER_HOUR", windowSeconds: HOUR, fallback: 300 },
  claimRequestsPerDay: { env: "MK8DX_HOSTED_BUDGET_CLAIM_REQUESTS_PER_DAY", windowSeconds: DAY, fallback: 1_500 },
  claimMessagesPerHour: { env: "MK8DX_HOSTED_BUDGET_CLAIM_MESSAGES_PER_HOUR", windowSeconds: HOUR, fallback: 600 },
  claimMessagesPerDay: { env: "MK8DX_HOSTED_BUDGET_CLAIM_MESSAGES_PER_DAY", windowSeconds: DAY, fallback: 3_000 },
  claimRequestsPerPlayerPerDay: { env: "MK8DX_HOSTED_BUDGET_CLAIM_REQUESTS_PER_PLAYER_PER_DAY", windowSeconds: DAY, fallback: 5 },
  claimMessagesPerClaimPerDay: { env: "MK8DX_HOSTED_BUDGET_CLAIM_MESSAGES_PER_CLAIM_PER_DAY", windowSeconds: DAY, fallback: 20 },
  // Time Trial submissions (besides the existing 10-second and one-minute installation bursts).
  submissionsPerHour: { env: "MK8DX_HOSTED_BUDGET_SUBMISSIONS_PER_HOUR", windowSeconds: HOUR, fallback: 6_000 },
  submissionsPerDay: { env: "MK8DX_HOSTED_BUDGET_SUBMISSIONS_PER_DAY", windowSeconds: DAY, fallback: 40_000 },
  // Notifications written for other people (one unit per producer call).
  notificationsPerHour: { env: "MK8DX_HOSTED_BUDGET_NOTIFICATIONS_PER_HOUR", windowSeconds: HOUR, fallback: 20_000 },
  notificationsPerDay: { env: "MK8DX_HOSTED_BUDGET_NOTIFICATIONS_PER_DAY", windowSeconds: DAY, fallback: 100_000 },
  downloadsPerHour: { env: "MK8DX_HOSTED_BUDGET_DOWNLOADS_PER_HOUR", windowSeconds: HOUR, fallback: 2_000 },
  downloadsPerDay: { env: "MK8DX_HOSTED_BUDGET_DOWNLOADS_PER_DAY", windowSeconds: DAY, fallback: 10_000 },
  aliasesPerHour: { env: "MK8DX_HOSTED_BUDGET_ALIASES_PER_HOUR", windowSeconds: HOUR, fallback: 1_000 },
  aliasesPerDay: { env: "MK8DX_HOSTED_BUDGET_ALIASES_PER_DAY", windowSeconds: DAY, fallback: 5_000 },
  pushSubscriptionsPerHour: { env: "MK8DX_HOSTED_BUDGET_PUSH_SUBSCRIPTIONS_PER_HOUR", windowSeconds: HOUR, fallback: 1_000 },
  pushSubscriptionsPerDay: { env: "MK8DX_HOSTED_BUDGET_PUSH_SUBSCRIPTIONS_PER_DAY", windowSeconds: DAY, fallback: 5_000 },
  engagementsPerHour: { env: "MK8DX_HOSTED_BUDGET_ENGAGEMENTS_PER_HOUR", windowSeconds: HOUR, fallback: 1_200 },
  engagementsPerDay: { env: "MK8DX_HOSTED_BUDGET_ENGAGEMENTS_PER_DAY", windowSeconds: DAY, fallback: 6_000 },
} as const satisfies Readonly<Record<string, SettingDefinition>>;

export type AbuseBudgetName = keyof typeof ABUSE_BUDGET_DEFINITIONS;
export type AbuseBudgetSettings = Readonly<Record<AbuseBudgetName, BudgetWindow>>;

const MAXIMUM_SETTING = 1_000_000;

export class AbuseBudgetConfigurationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "AbuseBudgetConfigurationError";
  }
}

/** The defaults, unchanged by any setting. */
export function defaultAbuseBudgetSettings(): AbuseBudgetSettings {
  return readAbuseBudgetSettings({});
}

/**
 * Reads every MK8DX_HOSTED_BUDGET_* setting. A missing setting keeps its default; a present one must
 * be a whole number from 1 to 1,000,000, so a typo stops the start instead of switching a budget off.
 * There is deliberately no "unlimited".
 */
export function readAbuseBudgetSettings(
  environment: Readonly<Record<string, string | undefined>>,
): AbuseBudgetSettings {
  const known = new Set<string>(Object.values(ABUSE_BUDGET_DEFINITIONS).map((definition) => definition.env));
  for (const name of Object.keys(environment)) {
    if (name.startsWith("MK8DX_HOSTED_BUDGET_") && !known.has(name)) {
      throw new AbuseBudgetConfigurationError(`${name} is not a known budget setting`);
    }
  }
  const settings: Partial<Record<AbuseBudgetName, BudgetWindow>> = {};
  for (const [name, definition] of Object.entries(ABUSE_BUDGET_DEFINITIONS) as
      [AbuseBudgetName, SettingDefinition][]) {
    const raw = environment[definition.env];
    let maximum: number = definition.fallback;
    if (raw !== undefined && raw.length > 0) {
      if (!/^[0-9]{1,7}$/.test(raw) || Number(raw) < 1 || Number(raw) > MAXIMUM_SETTING) {
        throw new AbuseBudgetConfigurationError(`${definition.env} must be a whole number from 1 to 1000000`);
      }
      maximum = Number(raw);
    }
    settings[name] = { windowSeconds: definition.windowSeconds, maximum };
  }
  return settings as AbuseBudgetSettings;
}

/** A limiter subject for a target id: a fixed-length digest, never the id itself. */
export function targetSubject(kind: string, targetId: string): string {
  return `target.${createHash("sha256").update(`${kind}\u0000${targetId}`, "utf8").digest("hex").slice(0, 40)}`;
}

/** A limiter subject for an e-mail recipient: server-keyed, so the address cannot be recovered. */
export function recipientSubject(key: Buffer, normalizedEmail: string): string {
  return `recipient.${createHmac("sha256", key).update(normalizedEmail, "utf8").digest("hex").slice(0, 40)}`;
}

/** One installation-wide budget, handed to a route that consumes it after the caller's own budget. */
export type InstallationBudget = Readonly<{ consume(): Promise<void> }>;

export class AbuseBudgets {
  public constructor(
    public readonly limiter: MutationRateLimiter,
    public readonly settings: AbuseBudgetSettings = defaultAbuseBudgetSettings(),
  ) {}

  /** Consumes one unit from each named installation budget, in order. */
  public async installation(scope: string, ...names: readonly AbuseBudgetName[]): Promise<void> {
    for (const name of names) {
      const budget = this.settings[name];
      await this.limiter.consume("installation", `${scope}.${windowLabel(budget)}`, budget.windowSeconds, budget.maximum);
    }
  }

  /** One installation budget as a route option. */
  public forInstallation(scope: string, ...names: readonly AbuseBudgetName[]): InstallationBudget {
    return { consume: () => this.installation(scope, ...names) };
  }

  /** Consumes one unit from each named budget for one target (a Player, a claim, a recipient). */
  public async target(subject: string, scope: string, ...names: readonly AbuseBudgetName[]): Promise<void> {
    for (const name of names) {
      const budget = this.settings[name];
      await this.limiter.consume(subject, `${scope}.${windowLabel(budget)}`, budget.windowSeconds, budget.maximum);
    }
  }

  /**
   * The general backstop for one signed-in mutation: the account's own budget (higher for an
   * administrator, never unlimited), then the whole installation's per-minute budget.
   */
  public async mutation(actor: ActorContext): Promise<void> {
    if (actor.role !== "account" && actor.role !== "administrator") { return; }
    const administrator = actor.role === "administrator";
    const short = this.settings[administrator ? "administratorMutationsPer10Minutes" : "accountMutationsPer10Minutes"];
    const long = this.settings[administrator ? "administratorMutationsPerDay" : "accountMutationsPerDay"];
    const prefix = administrator ? "api-mutations.administrator" : "api-mutations.account";
    await this.limiter.consume(actor.userAccountId, `${prefix}.10m`, short.windowSeconds, short.maximum);
    await this.limiter.consume(actor.userAccountId, `${prefix}.day`, long.windowSeconds, long.maximum);
    await this.installation("api-mutations.installation", "mutationsPerMinute");
  }
}

/**
 * Every installation budget a route spends, by the scope it passes to `installation` or
 * `forInstallation`. The administrator view reads the current window of each to show the headroom;
 * a test binds this list to the calls in the source, so a new installation budget cannot be missed.
 */
export const INSTALLATION_BUDGET_SCOPES: readonly Readonly<{ scope: string; budgets: readonly AbuseBudgetName[] }>[] = [
  { scope: "api-mutations.installation", budgets: ["mutationsPerMinute"] },
  { scope: "auth-email", budgets: ["authEmailsPerHour", "authEmailsPerDay"] },
  { scope: "device-code", budgets: ["deviceCodesPerHour"] },
  { scope: "player-claims.requests", budgets: ["claimRequestsPerHour", "claimRequestsPerDay"] },
  { scope: "player-claims.messages", budgets: ["claimMessagesPerHour", "claimMessagesPerDay"] },
  { scope: "time-trial-submit", budgets: ["submissionsPerHour", "submissionsPerDay"] },
  { scope: "notifications", budgets: ["notificationsPerHour", "notificationsPerDay"] },
  { scope: "app-downloads", budgets: ["downloadsPerHour", "downloadsPerDay"] },
  { scope: "aliases", budgets: ["aliasesPerHour", "aliasesPerDay"] },
  { scope: "web-push-subscriptions", budgets: ["pushSubscriptionsPerHour", "pushSubscriptionsPerDay"] },
  { scope: "player-engagements", budgets: ["engagementsPerHour", "engagementsPerDay"] },
];

/** The limiter scope one installation budget is counted under (`<scope>.<window>`). */
export function installationBudgetScope(scope: string, budget: BudgetWindow): string {
  return `${scope}.${windowLabel(budget)}`;
}

function windowLabel(budget: BudgetWindow): string {
  if (budget.windowSeconds === DAY) { return "day"; }
  if (budget.windowSeconds === HOUR) { return "hour"; }
  if (budget.windowSeconds === 600) { return "10m"; }
  if (budget.windowSeconds === 60) { return "minute"; }
  return `${String(budget.windowSeconds)}s`;
}

/** The 429 body every budgeted route uses when a shared budget is spent. */
export function budgetRefusal(error: unknown, code: string, message: string): Readonly<{
  retryAfterSeconds: number;
  body: Readonly<{ code: string; message: string }>;
}> | null {
  if (!(error instanceof MutationRateLimitExceeded)) { return null; }
  return { retryAfterSeconds: error.retryAfterSeconds, body: { code, message } };
}

const QUOTA_REFUSAL_STATUSES = new Set([403, 409, 413, 429]);

/**
 * The fixed code of a refused response that the refusal ledger counts as a quota: a full stored
 * quota (`*_quota_exceeded`, `*_too_large`), a per-recipient limit (`*_recipient_limit`) or a missing
 * fresh confirmation (`step_up_required`). Budget refusals from the durable limiter are counted by
 * the limiter itself and are not repeated here. Anything else, or a payload that is not a small
 * JSON string, gives null.
 */
export function quotaRefusalCode(statusCode: number, payload: unknown): string | null {
  if (!QUOTA_REFUSAL_STATUSES.has(statusCode) || typeof payload !== "string" || payload.length > 4_096) {
    return null;
  }
  const code = /"code":"([a-z0-9_]{1,64})"/.exec(payload)?.[1];
  if (code === undefined) { return null; }
  return code === "step_up_required" || code.endsWith("_quota_exceeded") || code.endsWith("_too_large") ||
    code.endsWith("_recipient_limit") ? code : null;
}
