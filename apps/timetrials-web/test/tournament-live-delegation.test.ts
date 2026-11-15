import { afterEach, describe, expect, it, vi } from "vitest";

import { TournamentIncomingClient } from "../src/tournament-incoming-client.js";
import { mountTournamentIncomingSection } from "../src/tournament-incoming-section.js";
import { FakeDocument, byClass, descendants, type FakeNode } from "./dom-double.js";

const TOURNAMENT = "tournament.synthetic_live";
const NOW = Date.now();

function delegation(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    delegationId: "live_capture_delegation.one", tournamentId: TOURNAMENT,
    delegateUserAccountId: "user_account.capture", delegateDisplayName: "Capture operator",
    status: "active", reason: "Live capture delegated by Tournament director",
    grantedByUserAccountId: "user_account.director", grantedAtMs: NOW - 60_000, expiresAtMs: NOW + 3_600_000,
    revokedByUserAccountId: null, revokeReason: null, revokedAtMs: null,
    ...overrides,
  };
}

function liveRecord(recordId: string, status: "requested" | "active" | "stopping" | "complete", approvedAtMs: number | null,
  uploader = { userAccountId: "user_account.capture", displayName: "Capture operator" }) {
  return {
    recordId, clientRecordId: `run-${recordId}`, revision: 3, status: "uploading",
    sourceKind: "tournament_live_capture", uploadedBy: uploader,
    startedAtMs: 1, stoppedAtMs: null, analysisCompletedAtMs: null, complete: false,
    suggestedTournamentId: TOURNAMENT, suggestedTournamentName: "Live night",
    linkedTournamentId: null, groups: [], resultCount: 0, createdAtMs: 1, updatedAtMs: 2,
    live: {
      status, approvedAtMs, stoppedAtMs: null, completedAtMs: null,
      mappings: [{ observedGroupLabel: "Capture Card A", groupId: "tournament_group.live_a", phase: "qualifier" }],
    },
  };
}

describe("capture-delegation client parsing", () => {
  const client = (body: unknown, status = 200) => new TournamentIncomingClient(async () => Response.json(body, { status }));

  it("reads a delegation list with exactly the served keys", async () => {
    const listed = await client({ delegations: [delegation(), delegation({
      delegationId: "live_capture_delegation.two", status: "revoked",
      revokedByUserAccountId: "user_account.director", revokeReason: "capture PC replaced", revokedAtMs: NOW,
    })] }).listLiveCaptureDelegations(TOURNAMENT);
    expect(listed.map((entry) => [entry.delegationId, entry.status, entry.revokedAtMs])).toEqual([
      ["live_capture_delegation.one", "active", null],
      ["live_capture_delegation.two", "revoked", NOW],
    ]);
  });

  it("rejects an unknown key, a missing key, an unknown status and a wrong envelope", async () => {
    await expect(client({ delegations: [delegation({ extra: true })] }).listLiveCaptureDelegations(TOURNAMENT)).rejects.toThrow();
    const missing = delegation();
    delete missing["delegateDisplayName"];
    await expect(client({ delegations: [missing] }).listLiveCaptureDelegations(TOURNAMENT)).rejects.toThrow();
    await expect(client({ delegations: [delegation({ status: "expired" })] }).listLiveCaptureDelegations(TOURNAMENT)).rejects.toThrow();
    await expect(client({ delegations: [], nextCursor: null }).listLiveCaptureDelegations(TOURNAMENT)).rejects.toThrow();
    await expect(client({ code: "tournament_forbidden" }, 403).listLiveCaptureDelegations(TOURNAMENT)).rejects.toThrow("403");
  });

  it("refuses a duration beyond 7 days and a malformed account before any request", async () => {
    const fetchPort = vi.fn(async () => Response.json({}));
    const strict = new TournamentIncomingClient(fetchPort);
    await expect(strict.grantLiveCaptureDelegation(TOURNAMENT, {
      delegateUserAccountId: "user_account.capture", expiresInMinutes: 10_081,
    })).rejects.toThrow();
    await expect(strict.grantLiveCaptureDelegation(TOURNAMENT, {
      delegateUserAccountId: "Capture operator", expiresInMinutes: 720,
    })).rejects.toThrow();
    expect(fetchPort).not.toHaveBeenCalled();
  });
});

describe("Director live-capture delegation view", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  async function mount(records: readonly unknown[], delegations: readonly unknown[] | "fail",
    answer: (url: string, body: unknown) => Response = (url) => url.endsWith("/actions/withdraw-live")
      ? Response.json({ record: { ...liveRecord("evidence.active", "requested", 5), revision: 4 } })
      : Response.json({ delegation: delegation() })) {
    const posted: { url: string; body: unknown }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/v1/session/csrf") return Response.json({ headerName: "x-mk8dx-csrf", value: "proof" });
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as unknown;
        posted.push({ url, body });
        return answer(url, body);
      }
      if (url.endsWith("/evidence-records")) return Response.json({ records });
      if (url.endsWith("/incoming-results")) return Response.json({ results: [] });
      if (url.endsWith("/live-capture-delegations")) {
        return delegations === "fail"
          ? Response.json({ code: "tournament_unavailable", message: "unavailable" }, { status: 503 })
          : Response.json({ delegations });
      }
      throw new Error(`unexpected ${url}`);
    }));
    const document = new FakeDocument();
    const container = document.createElement("div");
    const onChanged = vi.fn(async () => undefined);
    const controller = new AbortController();
    await mountTournamentIncomingSection({
      document: document as never,
      container: container as never,
      signal: controller.signal,
      tournament: {
        summary: { tournamentId: TOURNAMENT, workflowStep: 5 },
        groups: [{ groupId: "tournament_group.live_a", stage: "qualifier", name: "Group 1", tierKey: null, members: [], races: [] }],
        participants: [],
      } as never,
      onChanged,
    });
    controller.abort();
    return { container: container as unknown as FakeNode, posted, onChanged };
  }

  const button = (root: FakeNode, text: string) => descendants(root).find((node) =>
    node.tagName === "button" && node.textContent === text);

  it("says a waiting feed needs the Director, and delegates its uploader for 12 hours", async () => {
    const { container, posted, onChanged } = await mount([liveRecord("evidence.requested", "requested", null)], []);
    expect(descendants(container).some((node) => (node.textContent ?? "").startsWith("Waiting for the Director.") &&
      (node.textContent ?? "").includes("a roster match alone never opens a live feed"))).toBe(true);
    expect(button(container, "Withdraw this live feed")).toBeUndefined();
    button(container, "Delegate live capture to Capture operator (12 hours)")!.click();
    await vi.waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(posted).toEqual([{
      url: `/v1/administrator/tournaments/${TOURNAMENT}/live-capture-delegations`,
      body: { delegateUserAccountId: "user_account.capture", expiresInMinutes: 720,
        reason: "Live capture delegated by Tournament director" },
    }]);
  });

  it("issues a delegation from the panel with the chosen duration", async () => {
    const { container, posted } = await mount([liveRecord("evidence.requested", "requested", null)], []);
    const panel = byClass(container, "tournament-live-delegations")!;
    const [account, duration] = descendants(panel).filter((node) => node.tagName === "select");
    expect(duration!.value).toBe("720");
    account!.value = "user_account.capture";
    duration!.value = "10080";
    descendants(panel).find((node) => node.tagName === "form")!.dispatch("submit");
    await vi.waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]!.body).toMatchObject({ delegateUserAccountId: "user_account.capture", expiresInMinutes: 10_080 });
  });

  it("lists delegations with their state and revokes an active one", async () => {
    const { container, posted, onChanged } = await mount([liveRecord("evidence.requested", "requested", null)], [
      delegation(),
      delegation({ delegationId: "live_capture_delegation.old", delegateDisplayName: "Old PC", status: "revoked",
        revokedByUserAccountId: "user_account.director", revokeReason: "replaced", revokedAtMs: NOW - 1_000 }),
      delegation({ delegationId: "live_capture_delegation.expired", delegateDisplayName: "Expired PC", expiresAtMs: NOW - 1 }),
    ]);
    const panel = byClass(container, "tournament-live-delegations")!;
    const items = descendants(panel).filter((node) => node.className === "tournament-live-delegations__item");
    expect(items.map((item) => (item.textContent ?? "").split(" · ")[1]?.split(" ")[0])).toEqual(["active", "revoked", "expired"]);
    // A delegated uploader is told the roster match may open the feed, and is not offered a second delegation.
    expect(button(container, "Delegate live capture to Capture operator (12 hours)")).toBeUndefined();
    expect(descendants(container).some((node) => (node.textContent ?? "").startsWith("This account holds your capture delegation"))).toBe(true);
    const revokes = descendants(panel).filter((node) => node.tagName === "button" && node.textContent === "Revoke");
    expect(revokes).toHaveLength(1);
    revokes[0]!.click();
    await vi.waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(posted).toEqual([{
      url: `/v1/administrator/tournaments/${TOURNAMENT}/live-capture-delegations/live_capture_delegation.one/actions/revoke`,
      body: { reason: "Capture delegation revoked by Tournament director" },
    }]);
  });

  it("withdraws only public feeds, after a second click", async () => {
    const { container, posted, onChanged } = await mount([
      liveRecord("evidence.active", "active", 5),
      liveRecord("evidence.stopping_unapproved", "stopping", null),
      liveRecord("evidence.complete", "complete", 5),
    ], []);
    const withdraws = descendants(container).filter((node) => node.tagName === "button" && node.textContent === "Withdraw this live feed");
    expect(withdraws).toHaveLength(2);
    withdraws[0]!.click();
    expect(posted).toHaveLength(0);
    expect(withdraws[0]!.textContent).toBe("Click again to withdraw");
    withdraws[0]!.click();
    await vi.waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(posted).toEqual([{
      url: `/v1/administrator/tournaments/${TOURNAMENT}/evidence-records/evidence.active/actions/withdraw-live`,
      body: { expectedRevision: 3, reason: "Live feed withdrawn by Tournament director" },
    }]);
  });

  it("keeps the recordings and offers no delegation writes when the list cannot be read", async () => {
    const { container } = await mount([liveRecord("evidence.requested", "requested", null)], "fail");
    expect(button(container, "Confirm live routing manually")).toBeDefined();
    expect(button(container, "Delegate live capture to Capture operator (12 hours)")).toBeUndefined();
    const panel = byClass(container, "tournament-live-delegations")!;
    expect(descendants(panel).some((node) => node.tagName === "form")).toBe(false);
    expect(panel.textContent).toContain("Capture delegations could not be loaded.");
  });
});
