export const ADMINISTRATOR_REQUEST_BUDGETS_PATH = "/v1/administrator/request-budgets";
export const ADMINISTRATOR_REQUEST_BUDGETS_SCHEMA_VERSION = "mk8dx.administrator-request-budgets.v1";

const maximumResponseBytes = 65_536;

export const REQUEST_BUDGET_SUBJECT_KINDS = [
  "account", "installation", "target", "recipient", "address", "device", "other",
] as const;
export type RequestBudgetSubjectKind = typeof REQUEST_BUDGET_SUBJECT_KINDS[number];

export type RequestBudgetRefusalScope = Readonly<{
  scope: string;
  lastHour: number;
  lastDay: number;
  subjectKind: RequestBudgetSubjectKind | null;
  subjectsLastDay: number;
  topAccounts: readonly Readonly<{ accountId: string; screenName: string | null; refusedLastDay: number }>[];
}>;

export type RequestBudgetSetting = Readonly<{
  name: string;
  setting: string;
  windowSeconds: number;
  value: number;
  defaultValue: number;
}>;

export type RequestBudgetHeadroom = Readonly<{
  scope: string;
  setting: string | null;
  windowSeconds: number;
  windowEndsAtMs: number;
  used: number;
  maximum: number;
  refused: number;
}>;

export type AdministratorRequestBudgets = Readonly<{
  generatedAtMs: number;
  refusals: readonly RequestBudgetRefusalScope[];
  refusalsTruncated: boolean;
  settings: readonly RequestBudgetSetting[];
  headroom: readonly RequestBudgetHeadroom[];
}>;

export type AdministratorRequestBudgetsClientErrorCode = "not_authorized" | "unavailable" | "invalid_response";

export class AdministratorRequestBudgetsClientError extends Error {
  public constructor(public readonly code: AdministratorRequestBudgetsClientErrorCode) {
    super(`administrator request budgets ${code}`);
    this.name = "AdministratorRequestBudgetsClientError";
  }
}

export interface AdministratorRequestBudgetsClient {
  report(signal?: AbortSignal): Promise<AdministratorRequestBudgets>;
}

type FetchPort = typeof globalThis.fetch;

function fail(): never { throw new AdministratorRequestBudgetsClientError("invalid_response"); }

/** An object with exactly these keys; an unknown or missing key is refused, like every response here. */
function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) { fail(); }
  const record = value as Record<string, unknown>;
  const present = Object.keys(record);
  if (present.length !== keys.length || keys.some((key) => !Object.hasOwn(record, key))) { fail(); }
  return record;
}

function count(value: unknown, minimum = 0): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) { fail(); }
  return value;
}

function text(value: unknown, pattern: RegExp): string {
  if (typeof value !== "string" || !pattern.test(value)) { fail(); }
  return value;
}

function list<T>(value: unknown, maximum: number, item: (entry: unknown) => T): T[] {
  if (!Array.isArray(value) || value.length > maximum) { fail(); }
  return value.map(item);
}

const SCOPE = /^[a-z0-9._-]{1,96}$/;
const SETTING = /^MK8DX_HOSTED_BUDGET_[A-Z0-9_]{1,64}$/;

function refusal(value: unknown): RequestBudgetRefusalScope {
  const record = exact(value, ["scope", "lastHour", "lastDay", "subjectKind", "subjectsLastDay", "topAccounts"]);
  const kind = record["subjectKind"];
  if (kind !== null && !(REQUEST_BUDGET_SUBJECT_KINDS as readonly unknown[]).includes(kind)) { fail(); }
  return {
    scope: text(record["scope"], SCOPE),
    lastHour: count(record["lastHour"]),
    lastDay: count(record["lastDay"]),
    subjectKind: kind as RequestBudgetSubjectKind | null,
    subjectsLastDay: count(record["subjectsLastDay"]),
    topAccounts: list(record["topAccounts"], 5, (entry) => {
      const account = exact(entry, ["accountId", "screenName", "refusedLastDay"]);
      const screenName = account["screenName"];
      if (screenName !== null && (typeof screenName !== "string" || screenName.length > 32)) { fail(); }
      return {
        accountId: text(account["accountId"], /^user_account\.[A-Za-z0-9._-]{1,128}$/),
        screenName: screenName as string | null,
        refusedLastDay: count(account["refusedLastDay"]),
      };
    }),
  };
}

export function parseAdministratorRequestBudgets(body: unknown): AdministratorRequestBudgets {
  const record = exact(body, ["schemaVersion", "generatedAtMs", "refusals", "refusalsTruncated", "settings", "headroom"]);
  if (record["schemaVersion"] !== ADMINISTRATOR_REQUEST_BUDGETS_SCHEMA_VERSION ||
      typeof record["refusalsTruncated"] !== "boolean") { fail(); }
  return {
    generatedAtMs: count(record["generatedAtMs"]),
    refusals: list(record["refusals"], 100, refusal),
    refusalsTruncated: record["refusalsTruncated"],
    settings: list(record["settings"], 64, (entry) => {
      const setting = exact(entry, ["name", "setting", "windowSeconds", "value", "defaultValue"]);
      return {
        name: text(setting["name"], /^[A-Za-z0-9]{1,64}$/),
        setting: text(setting["setting"], SETTING),
        windowSeconds: count(setting["windowSeconds"], 1),
        value: count(setting["value"], 1),
        defaultValue: count(setting["defaultValue"], 1),
      };
    }),
    headroom: list(record["headroom"], 64, (entry) => {
      const item = exact(entry, ["scope", "setting", "windowSeconds", "windowEndsAtMs", "used", "maximum", "refused"]);
      const setting = item["setting"];
      return {
        scope: text(item["scope"], SCOPE),
        setting: setting === null ? null : text(setting, SETTING),
        windowSeconds: count(item["windowSeconds"], 1),
        windowEndsAtMs: count(item["windowEndsAtMs"]),
        used: count(item["used"]),
        maximum: count(item["maximum"], 1),
        refused: count(item["refused"]),
      };
    }),
  };
}

export function createAdministratorRequestBudgetsClient(
  fetchPort: FetchPort = globalThis.fetch.bind(globalThis),
): AdministratorRequestBudgetsClient {
  return {
    async report(signal) {
      const response = await fetchPort(ADMINISTRATOR_REQUEST_BUDGETS_PATH, {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
        headers: { Accept: "application/json" },
        ...(signal === undefined ? {} : { signal }),
      });
      if (response.status === 401 || response.status === 403) {
        throw new AdministratorRequestBudgetsClientError("not_authorized");
      }
      if (response.status !== 200) { throw new AdministratorRequestBudgetsClientError("unavailable"); }
      const body = await response.text();
      if (body.length > maximumResponseBytes) { fail(); }
      let parsed: unknown;
      try { parsed = JSON.parse(body); } catch { fail(); }
      return parseAdministratorRequestBudgets(parsed);
    },
  };
}
