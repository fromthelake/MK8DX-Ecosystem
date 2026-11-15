import type { Pool, RowDataPacket } from "mysql2/promise";

import type { ActorContext } from "../identity/types.js";
import {
  ABUSE_BUDGET_DEFINITIONS,
  INSTALLATION_BUDGET_SCOPES,
  defaultAbuseBudgetSettings,
  installationBudgetScope,
  type AbuseBudgetName,
  type AbuseBudgetSettings,
} from "../security/abuse-budgets.js";
import {
  REFUSAL_LEDGER_PREFIX,
  REFUSAL_LEDGER_SUBJECT_WINDOW_MS,
  REFUSAL_LEDGER_TOTAL_SUBJECT,
  REFUSAL_LEDGER_TOTAL_WINDOW_MS,
  type RefusalLedgerEntry,
} from "../security/refusal-ledger.js";
import {
  DEFAULT_TOURNAMENT_EVIDENCE_LIMITS,
  type TournamentEvidenceLimits,
} from "../tournaments/tournament-connected-service.js";

/**
 * What the request budgets and quotas refused lately, for administrators. A read of operational
 * counters only: scope names are fixed code strings, counts are numbers, and the one kind of
 * subject that is named is an account (its public id and screen name), which administrators
 * already see. Target, recipient, address-slot and device subjects are digests and are only
 * counted. The source is the refusal ledger (`security/refusal-ledger.ts`): its rows flushed to
 * `api_mutation_rate_limits` by every API process, plus this process's counts not flushed yet,
 * and the budget rows themselves.
 */
export const ADMINISTRATOR_REQUEST_BUDGETS_SCHEMA_VERSION = "mk8dx.administrator-request-budgets.v1";

export const REQUEST_BUDGET_SUBJECT_KINDS = [
  "account", "installation", "target", "recipient", "address", "device", "other",
] as const;
export type RequestBudgetSubjectKind = typeof REQUEST_BUDGET_SUBJECT_KINDS[number];

export type RequestBudgetRefusalScope = Readonly<{
  scope: string;
  lastHour: number;
  lastDay: number;
  /** The kind of subject this scope counts; null when only installation totals exist (quotas). */
  subjectKind: RequestBudgetSubjectKind | null;
  /** Distinct refused subjects in about the last day. */
  subjectsLastDay: number;
  /** The most refused accounts (at most five), only for account scopes. */
  topAccounts: readonly Readonly<{ accountId: string; screenName: string | null; refusedLastDay: number }>[];
}>;

export type RequestBudgetSetting = Readonly<{
  name: AbuseBudgetName;
  setting: string;
  windowSeconds: number;
  value: number;
  defaultValue: number;
}>;

export type RequestBudgetHeadroom = Readonly<{
  scope: string;
  /** The `MK8DX_HOSTED_BUDGET_*` setting, or null for a built-in budget. */
  setting: string | null;
  windowSeconds: number;
  windowEndsAtMs: number;
  used: number;
  maximum: number;
  refused: number;
}>;

export type AdministratorRequestBudgets = Readonly<{
  schemaVersion: typeof ADMINISTRATOR_REQUEST_BUDGETS_SCHEMA_VERSION;
  generatedAtMs: number;
  refusals: readonly RequestBudgetRefusalScope[];
  /** True when more refused scopes or subjects existed than this report lists. */
  refusalsTruncated: boolean;
  settings: readonly RequestBudgetSetting[];
  headroom: readonly RequestBudgetHeadroom[];
}>;

export class AdministratorRequestBudgetsError extends Error {
  public constructor(public readonly code: "forbidden" | "unavailable", message: string) {
    super(message);
    this.name = "AdministratorRequestBudgetsError";
  }
}

export type RefusalTotalRow = Readonly<{ scope: string; lastHour: number; lastDay: number }>;
export type RefusalSubjectRow = Readonly<{ scope: string; subject: string; refused: number }>;
export type BudgetCountRow = Readonly<{ scopeKey: string; windowStartedAtMs: number; eventCount: number }>;

export interface AdministratorRequestBudgetsRepository {
  refusalTotals(sinceHourMs: number, sinceDayMs: number): Promise<readonly RefusalTotalRow[]>;
  refusalSubjects(sinceMs: number, limit: number): Promise<readonly RefusalSubjectRow[]>;
  accountScreenNames(accountIds: readonly string[]): Promise<ReadonlyMap<string, string | null>>;
  budgetCounts(scopeKeys: readonly string[], sinceMs: number): Promise<readonly BudgetCountRow[]>;
}

export const MAXIMUM_REPORTED_REFUSAL_SCOPES = 100;
export const MAXIMUM_READ_REFUSAL_SUBJECTS = 5_000;
const TOP_ACCOUNTS = 5;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** The kind of a limiter subject, from its fixed prefix. Never returns the subject itself. */
export function requestBudgetSubjectKind(subject: string): RequestBudgetSubjectKind {
  if (subject.startsWith("user_account.")) { return "account"; }
  if (subject === "installation" || subject === "all" || subject === "global") { return "installation"; }
  if (subject.startsWith("target.")) { return "target"; }
  if (subject.startsWith("recipient.")) { return "recipient"; }
  if (subject.startsWith("preauth-slot.")) { return "address"; }
  if (subject.startsWith("device.")) { return "device"; }
  return "other";
}

export class AdministratorRequestBudgetsService {
  public constructor(
    private readonly repository: AdministratorRequestBudgetsRepository,
    private readonly settings: AbuseBudgetSettings = defaultAbuseBudgetSettings(),
    private readonly clock: Readonly<{ nowMs(): number }> = { nowMs: () => Date.now() },
    private readonly evidenceLimits: Pick<TournamentEvidenceLimits, "uploadWindowSeconds" | "installationUploadsPerWindow">
      = DEFAULT_TOURNAMENT_EVIDENCE_LIMITS,
    /** This process's ledger counts that are not in the database yet. */
    private readonly unflushed: () => readonly RefusalLedgerEntry[] = () => [],
  ) {}

  public async report(actor: ActorContext): Promise<AdministratorRequestBudgets> {
    if (actor.role !== "administrator") {
      throw new AdministratorRequestBudgetsError("forbidden", "administrator actor required");
    }
    const nowMs = this.clock.nowMs();
    const step = REFUSAL_LEDGER_TOTAL_WINDOW_MS;
    const sinceHourMs = Math.floor((nowMs - HOUR_MS) / step) * step;
    const sinceDayMs = Math.floor((nowMs - DAY_MS) / step) * step;
    const sinceSubjectsMs = Math.floor((nowMs - DAY_MS) / REFUSAL_LEDGER_SUBJECT_WINDOW_MS) *
      REFUSAL_LEDGER_SUBJECT_WINDOW_MS;
    const headroomInputs = this.headroomInputs(nowMs);
    const [totals, subjects, counts] = await Promise.all([
      this.repository.refusalTotals(sinceHourMs, sinceDayMs),
      this.repository.refusalSubjects(sinceSubjectsMs, MAXIMUM_READ_REFUSAL_SUBJECTS),
      this.repository.budgetCounts(headroomInputs.map((input) => input.key),
        Math.min(...headroomInputs.map((input) => input.windowStartedAtMs))),
    ]);
    let truncated = subjects.length >= MAXIMUM_READ_REFUSAL_SUBJECTS;
    const merged = mergeUnflushed(totals, subjects, this.unflushed(), sinceHourMs, sinceDayMs, sinceSubjectsMs);

    type Scope = { lastHour: number; lastDay: number; kinds: Map<RequestBudgetSubjectKind, number>;
      subjects: number; accounts: { accountId: string; refused: number }[] };
    const scopes = new Map<string, Scope>();
    const scopeOf = (name: string): Scope => {
      let value = scopes.get(name);
      if (value === undefined) {
        value = { lastHour: 0, lastDay: 0, kinds: new Map(), subjects: 0, accounts: [] };
        scopes.set(name, value);
      }
      return value;
    };
    for (const row of merged.totals) {
      const value = scopeOf(row.scope);
      value.lastHour += row.lastHour;
      value.lastDay += row.lastDay;
    }
    for (const row of merged.subjects) {
      const value = scopeOf(row.scope);
      const kind = requestBudgetSubjectKind(row.subject);
      value.kinds.set(kind, (value.kinds.get(kind) ?? 0) + 1);
      value.subjects += 1;
      if (kind === "account") { value.accounts.push({ accountId: row.subject, refused: row.refused }); }
    }
    const ordered = [...scopes.entries()]
      .filter(([, value]) => value.lastDay > 0)
      .sort((left, right) => right[1].lastDay - left[1].lastDay || left[0].localeCompare(right[0]));
    if (ordered.length > MAXIMUM_REPORTED_REFUSAL_SCOPES) { truncated = true; }
    const listed = ordered.slice(0, MAXIMUM_REPORTED_REFUSAL_SCOPES);
    const topByScope = new Map(listed.map(([name, value]) => [name, value.accounts
      .sort((left, right) => right.refused - left.refused || left.accountId.localeCompare(right.accountId))
      .slice(0, TOP_ACCOUNTS)]));
    const accountIds = [...new Set([...topByScope.values()].flatMap((list) => list.map((item) => item.accountId)))];
    const names = accountIds.length === 0 ? new Map<string, string | null>()
      : await this.repository.accountScreenNames(accountIds);

    const refusals: RequestBudgetRefusalScope[] = listed.map(([name, value]) => {
      let subjectKind: RequestBudgetSubjectKind | null = null;
      let most = 0;
      for (const kind of REQUEST_BUDGET_SUBJECT_KINDS) {
        const seen = value.kinds.get(kind) ?? 0;
        if (seen > most) { most = seen; subjectKind = kind; }
      }
      return {
        scope: name,
        lastHour: value.lastHour,
        lastDay: value.lastDay,
        subjectKind,
        subjectsLastDay: value.subjects,
        topAccounts: (topByScope.get(name) ?? []).map((item) => ({
          accountId: item.accountId,
          screenName: names.get(item.accountId) ?? null,
          refusedLastDay: item.refused,
        })),
      };
    });

    const byKey = new Map<string, number>();
    for (const row of counts) { byKey.set(`${row.scopeKey}@${String(row.windowStartedAtMs)}`, row.eventCount); }
    const headroom: RequestBudgetHeadroom[] = headroomInputs.map((input) => {
      const count = byKey.get(`${input.key}@${String(input.windowStartedAtMs)}`) ?? 0;
      return {
        scope: input.scope,
        setting: input.setting,
        windowSeconds: input.windowSeconds,
        windowEndsAtMs: input.windowStartedAtMs + input.windowSeconds * 1_000,
        used: Math.min(count, input.maximum),
        maximum: input.maximum,
        refused: Math.max(0, count - input.maximum),
      };
    });

    const settings: RequestBudgetSetting[] = (Object.keys(ABUSE_BUDGET_DEFINITIONS) as AbuseBudgetName[])
      .map((name) => ({
        name,
        setting: ABUSE_BUDGET_DEFINITIONS[name].env,
        windowSeconds: this.settings[name].windowSeconds,
        value: this.settings[name].maximum,
        defaultValue: ABUSE_BUDGET_DEFINITIONS[name].fallback,
      }));

    return {
      schemaVersion: ADMINISTRATOR_REQUEST_BUDGETS_SCHEMA_VERSION,
      generatedAtMs: nowMs,
      refusals,
      refusalsTruncated: truncated,
      settings,
      headroom,
    };
  }

  private headroomInputs(nowMs: number): {
    scope: string; key: string; setting: string | null; windowSeconds: number; windowStartedAtMs: number; maximum: number;
  }[] {
    type Input = { scope: string; key: string; setting: string | null; windowSeconds: number;
      windowStartedAtMs: number; maximum: number };
    const inputs: Input[] = INSTALLATION_BUDGET_SCOPES.flatMap((entry) => entry.budgets.map((name): Input => {
      const budget = this.settings[name];
      const scope = installationBudgetScope(entry.scope, budget);
      const windowMs = budget.windowSeconds * 1_000;
      return {
        scope,
        key: `${scope}|installation`,
        setting: ABUSE_BUDGET_DEFINITIONS[name].env,
        windowSeconds: budget.windowSeconds,
        windowStartedAtMs: Math.floor(nowMs / windowMs) * windowMs,
        maximum: budget.maximum,
      };
    }));
    const evidenceWindowMs = this.evidenceLimits.uploadWindowSeconds * 1_000;
    inputs.push({
      scope: "tournament-evidence.installation",
      key: "tournament-evidence.installation|installation",
      setting: null,
      windowSeconds: this.evidenceLimits.uploadWindowSeconds,
      windowStartedAtMs: Math.floor(nowMs / evidenceWindowMs) * evidenceWindowMs,
      maximum: this.evidenceLimits.installationUploadsPerWindow,
    });
    return inputs;
  }
}

/** Adds the not yet flushed counts to the database rows (the same key in both is summed). */
function mergeUnflushed(
  totals: readonly RefusalTotalRow[], subjects: readonly RefusalSubjectRow[],
  unflushed: readonly RefusalLedgerEntry[], sinceHourMs: number, sinceDayMs: number, sinceSubjectsMs: number,
): { totals: RefusalTotalRow[]; subjects: RefusalSubjectRow[] } {
  const totalMap = new Map(totals.map((row) => [row.scope, { ...row }]));
  const subjectMap = new Map(subjects.map((row) => [`${row.scope}|${row.subject}`, { ...row }]));
  for (const entry of unflushed) {
    const key = ledgerKey(entry.scopeKey);
    if (key === null) { continue; }
    if (key.subject === REFUSAL_LEDGER_TOTAL_SUBJECT) {
      if (entry.windowStartedAtMs < sinceDayMs) { continue; }
      const row = totalMap.get(key.scope) ?? { scope: key.scope, lastHour: 0, lastDay: 0 };
      totalMap.set(key.scope, {
        scope: key.scope,
        lastHour: row.lastHour + (entry.windowStartedAtMs >= sinceHourMs ? entry.count : 0),
        lastDay: row.lastDay + entry.count,
      });
    } else if (entry.windowStartedAtMs >= sinceSubjectsMs) {
      const id = `${key.scope}|${key.subject}`;
      const row = subjectMap.get(id);
      subjectMap.set(id, { scope: key.scope, subject: key.subject, refused: (row?.refused ?? 0) + entry.count });
    }
  }
  return { totals: [...totalMap.values()], subjects: [...subjectMap.values()] };
}

interface TotalRow extends RowDataPacket { scopeKey: unknown; lastHour: unknown; lastDay: unknown }
interface SubjectRow extends RowDataPacket { scopeKey: unknown; refused: unknown }
interface NameRow extends RowDataPacket { accountId: unknown; screenName: unknown }
interface CountRow extends RowDataPacket { scopeKey: unknown; windowStartedAtMs: unknown; eventCount: unknown }

function whole(value: unknown): number {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

/** `!refused|<scope>|<subject>` → its parts, or null for anything else. */
function ledgerKey(value: unknown): { scope: string; subject: string } | null {
  if (typeof value !== "string" || !value.startsWith(REFUSAL_LEDGER_PREFIX)) { return null; }
  const rest = value.slice(REFUSAL_LEDGER_PREFIX.length);
  const separator = rest.indexOf("|");
  if (separator < 1 || separator === rest.length - 1) { return null; }
  const scope = rest.slice(0, separator);
  if (!/^[a-z0-9._-]{1,80}$/.test(scope)) { return null; }
  return { scope, subject: rest.slice(separator + 1) };
}

// The ledger keys sort together: '!refused|' up to (not including) '!refused}' ('}' follows '|').
const LEDGER_FROM = REFUSAL_LEDGER_PREFIX;
const LEDGER_TO = `${REFUSAL_LEDGER_PREFIX.slice(0, -1)}}`;
const TOTAL_SUFFIX = `|${REFUSAL_LEDGER_TOTAL_SUBJECT}`;

export class MysqlAdministratorRequestBudgetsRepository implements AdministratorRequestBudgetsRepository {
  public constructor(private readonly executor: Pick<Pool, "execute">) {}

  public async refusalTotals(sinceHourMs: number, sinceDayMs: number): Promise<readonly RefusalTotalRow[]> {
    const [rows] = await this.executor.execute<TotalRow[]>(
      `SELECT scope_key AS scopeKey,
         SUM(CASE WHEN window_started_at_ms >= ? THEN event_count ELSE 0 END) AS lastHour,
         SUM(event_count) AS lastDay
       FROM api_mutation_rate_limits
       WHERE scope_key >= ? AND scope_key < ? AND RIGHT(scope_key, 2) = ? AND window_started_at_ms >= ?
       GROUP BY scope_key
       LIMIT 1000`,
      [sinceHourMs, LEDGER_FROM, LEDGER_TO, TOTAL_SUFFIX, sinceDayMs],
    );
    return rows.flatMap((row) => {
      const key = ledgerKey(row.scopeKey);
      if (key === null || key.subject !== REFUSAL_LEDGER_TOTAL_SUBJECT) { return []; }
      return [{ scope: key.scope, lastHour: whole(row.lastHour), lastDay: whole(row.lastDay) }];
    });
  }

  public async refusalSubjects(sinceMs: number, limit: number): Promise<readonly RefusalSubjectRow[]> {
    const bounded = Math.max(1, Math.min(MAXIMUM_READ_REFUSAL_SUBJECTS, Math.floor(limit)));
    const [rows] = await this.executor.execute<SubjectRow[]>(
      `SELECT scope_key AS scopeKey, SUM(event_count) AS refused
       FROM api_mutation_rate_limits
       WHERE scope_key >= ? AND scope_key < ? AND RIGHT(scope_key, 2) <> ? AND window_started_at_ms >= ?
       GROUP BY scope_key
       ORDER BY refused DESC, scope_key
       LIMIT ${String(bounded)}`,
      [LEDGER_FROM, LEDGER_TO, TOTAL_SUFFIX, sinceMs],
    );
    return rows.flatMap((row) => {
      const key = ledgerKey(row.scopeKey);
      if (key === null || key.subject === REFUSAL_LEDGER_TOTAL_SUBJECT) { return []; }
      return [{ scope: key.scope, subject: key.subject, refused: whole(row.refused) }];
    });
  }

  public async accountScreenNames(accountIds: readonly string[]): Promise<ReadonlyMap<string, string | null>> {
    const ids = accountIds.filter((id) => /^user_account\.[A-Za-z0-9._-]{1,128}$/.test(id)).slice(0, 500);
    if (ids.length === 0) { return new Map(); }
    const [rows] = await this.executor.execute<NameRow[]>(
      `SELECT public_id AS accountId, screen_name AS screenName FROM user_accounts
       WHERE public_id IN (${ids.map(() => "?").join(", ")})`,
      ids,
    );
    return new Map(rows.flatMap((row) => typeof row.accountId === "string"
      ? [[row.accountId, typeof row.screenName === "string" ? row.screenName : null] as const]
      : []));
  }

  public async budgetCounts(scopeKeys: readonly string[], sinceMs: number): Promise<readonly BudgetCountRow[]> {
    if (scopeKeys.length === 0) { return []; }
    const [rows] = await this.executor.execute<CountRow[]>(
      `SELECT scope_key AS scopeKey, window_started_at_ms AS windowStartedAtMs, event_count AS eventCount
       FROM api_mutation_rate_limits
       WHERE scope_key IN (${scopeKeys.map(() => "?").join(", ")}) AND window_started_at_ms >= ?`,
      [...scopeKeys, sinceMs],
    );
    return rows.flatMap((row) => typeof row.scopeKey === "string"
      ? [{ scopeKey: row.scopeKey, windowStartedAtMs: whole(row.windowStartedAtMs), eventCount: whole(row.eventCount) }]
      : []);
  }
}
