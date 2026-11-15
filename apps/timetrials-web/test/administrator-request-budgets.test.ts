import { describe, expect, it, vi } from "vitest";

import {
  AdministratorRequestBudgetsClientError,
  createAdministratorRequestBudgetsClient,
  parseAdministratorRequestBudgets,
} from "../src/administrator-request-budgets-client.js";
import { mountAdministratorRequestBudgetsSection } from "../src/administrator-request-budgets-section.js";

class FakeNode {
  readonly children: FakeNode[] = [];
  readonly attributes = new Map<string, string>();
  parentNode: FakeNode | null = null;
  className = "";
  textContent: string | null = null;
  type = "";
  disabled = false;
  private readonly listeners = new Map<string, Set<(event: Event) => void>>();
  constructor(readonly tagName: string, readonly ownerDocument: FakeDocument) {}
  get firstChild(): FakeNode | null { return this.children[0] ?? null; }
  append(...nodes: FakeNode[]): void {
    for (const node of nodes) { node.parentNode = this; this.children.push(node); }
  }
  removeChild(node: FakeNode): FakeNode {
    const index = this.children.indexOf(node);
    if (index < 0) { throw new Error("synthetic child missing"); }
    this.children.splice(index, 1);
    node.parentNode = null;
    return node;
  }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  addEventListener(type: string, listener: (event: Event) => void): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }
  dispatch(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) { listener(new Event(type)); }
  }
}

class FakeDocument {
  createElement(tagName: string): FakeNode { return new FakeNode(tagName, this); }
}

function texts(root: FakeNode): string[] {
  return root.children.flatMap((child) => [child.textContent ?? "", ...texts(child)]).filter((text) => text !== "");
}

const body = {
  schemaVersion: "mk8dx.administrator-request-budgets.v1",
  generatedAtMs: 1_900_000_000_000,
  refusals: [
    { scope: "player-claims.self.hour", lastHour: 1, lastDay: 4, subjectKind: "account", subjectsLastDay: 2,
      topAccounts: [{ accountId: "user_account.b", screenName: "Bee", refusedLastDay: 3 },
        { accountId: "user_account.c", screenName: null, refusedLastDay: 1 }] },
    { scope: "quota.alias_quota_exceeded", lastHour: 0, lastDay: 2, subjectKind: null, subjectsLastDay: 0, topAccounts: [] },
  ],
  refusalsTruncated: true,
  settings: [{ name: "aliasesPerHour", setting: "MK8DX_HOSTED_BUDGET_ALIASES_PER_HOUR", windowSeconds: 3_600, value: 900, defaultValue: 1_000 }],
  headroom: [{ scope: "aliases.hour", setting: "MK8DX_HOSTED_BUDGET_ALIASES_PER_HOUR", windowSeconds: 3_600,
    windowEndsAtMs: 1_900_000_800_000, used: 900, maximum: 900, refused: 7 },
  { scope: "tournament-evidence.installation", setting: null, windowSeconds: 600,
    windowEndsAtMs: 1_900_000_200_000, used: 0, maximum: 6_000, refused: 0 }],
};

function response(status: number, value: unknown): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

describe("administrator request budget client", () => {
  it("reads the report key for key and refuses an unknown or missing key", () => {
    expect(parseAdministratorRequestBudgets(body).refusals[0]!.topAccounts[1]).toEqual(
      { accountId: "user_account.c", screenName: null, refusedLastDay: 1 });
    expect(() => parseAdministratorRequestBudgets({ ...body, extra: true })).toThrow(AdministratorRequestBudgetsClientError);
    const { refusalsTruncated: _dropped, ...missing } = body;
    expect(() => parseAdministratorRequestBudgets(missing)).toThrow(AdministratorRequestBudgetsClientError);
    expect(() => parseAdministratorRequestBudgets({ ...body,
      refusals: [{ ...body.refusals[0], topAccounts: [{ accountId: "target.ab", screenName: null, refusedLastDay: 1 }] }] }))
      .toThrow(AdministratorRequestBudgetsClientError);
    expect(() => parseAdministratorRequestBudgets({ ...body,
      refusals: [{ ...body.refusals[1], subjectKind: "person" }] })).toThrow(AdministratorRequestBudgetsClientError);
    expect(() => parseAdministratorRequestBudgets({ ...body,
      headroom: [{ ...body.headroom[0], used: -1 }] })).toThrow(AdministratorRequestBudgetsClientError);
  });

  it("asks the same-origin path without a cache and maps refusals", async () => {
    const fetchPort = vi.fn(async () => response(200, body));
    const client = createAdministratorRequestBudgetsClient(fetchPort as never);
    await expect(client.report()).resolves.toMatchObject({ refusalsTruncated: true });
    expect(fetchPort).toHaveBeenCalledWith("/v1/administrator/request-budgets",
      expect.objectContaining({ method: "GET", credentials: "same-origin", cache: "no-store" }));
    await expect(createAdministratorRequestBudgetsClient((async () => response(403, {})) as never).report())
      .rejects.toMatchObject({ code: "not_authorized" });
    await expect(createAdministratorRequestBudgetsClient((async () => response(503, {})) as never).report())
      .rejects.toMatchObject({ code: "unavailable" });
  });
});

describe("administrator request budget section", () => {
  it("shows refusals per scope, names accounts, the headroom and the settings, and reloads on Refresh", async () => {
    const document = new FakeDocument();
    const root = document.createElement("div");
    const report = vi.fn(async () => parseAdministratorRequestBudgets(body));
    const section = mountAdministratorRequestBudgetsSection(root as never, { client: { report } });
    await section.ready;
    const shown = texts(root);
    expect(shown).toContain("Request limits");
    expect(shown).toContain("player-claims.self.hour");
    expect(shown).toContain("1 in the last hour · 2 affected");
    expect(shown).toContain("per account");
    expect(shown).toContain("Bee · 3");
    expect(shown).toContain("user_account.c · 1");
    expect(shown).toContain("a quota, counted for the whole installation");
    expect(shown).toContain("More was refused than this list shows.");
    expect(shown).toContain("900 / 900");
    expect(shown).toContain("7 refused in this window");
    expect(shown).toContain("built-in limit");
    expect(shown.some((text) => text.startsWith("MK8DX_HOSTED_BUDGET_ALIASES_PER_HOUR · per hour · default 1000"))).toBe(true);

    const refresh = root.children[0]!.children.find((child) => child.tagName === "button")!;
    refresh.dispatch("click");
    await vi.waitFor(() => { expect(report).toHaveBeenCalledTimes(2); });
    section.unmount();
    expect(root.children).toHaveLength(0);
  });

  it("says when nothing was refused, and disappears for somebody who is not an administrator", async () => {
    const document = new FakeDocument();
    const root = document.createElement("div");
    const quiet = mountAdministratorRequestBudgetsSection(root as never, { client: {
      report: async () => parseAdministratorRequestBudgets({ ...body, refusals: [], refusalsTruncated: false }),
    } });
    await quiet.ready;
    expect(texts(root)).toContain("Nothing was refused in the last day.");
    quiet.unmount();

    const denied = mountAdministratorRequestBudgetsSection(root as never, { client: {
      report: async () => { throw new AdministratorRequestBudgetsClientError("not_authorized"); },
    } });
    await denied.ready;
    expect(root.children).toHaveLength(0);
  });
});
