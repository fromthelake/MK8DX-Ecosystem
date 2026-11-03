// ADR-0220 "Request to host" on the website: the client's key-for-key parsing, the Tournaments
// page block for a signed-in non-Director, and the requests in the administrators' Directors section.

import { afterEach, describe, expect, it, vi } from "vitest";

import { FakeDocument, FakeNode, allByClass, descendants, texts } from "./dom-double.js";
import {
  createDirectorHostRequestClient,
  HostRequestClientError,
  type DirectorHostRequestClient,
  type HostRequestQueueItem,
  type HostRequestStanding,
} from "../src/director-host-request-client.js";
import { mountDirectorHostRequest } from "../src/director-host-request-section.js";
import { mountTournamentOperatorAccess } from "../src/tournament-operator-access-section.js";
import { setProductLanguage } from "../src/product-language.js";

const requestId = "director_host_request.synthetic-1";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const standingDocument = (request: unknown = null, overrides: Record<string, unknown> = {}) => ({
  schemaVersion: "mk8dx.director-host-request.v1", administrator: false, director: false, request, ...overrides,
});
const openRequest = {
  requestId, status: "open", note: "Friday nights", requestedAtMs: 1_790_000_000_000, decidedAtMs: null, declineReason: null,
};

afterEach(() => { vi.unstubAllGlobals(); });

describe("the host request client", () => {
  it("parses the standing key for key and rejects an unknown key", async () => {
    const client = createDirectorHostRequestClient(async () => json(standingDocument(openRequest)));
    expect(await client.standing()).toEqual({
      administrator: false, director: false,
      request: { ...openRequest, status: "open" },
    });
    const drifted = createDirectorHostRequestClient(async () => json({ ...standingDocument(), extra: 1 }));
    await expect(drifted.standing()).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("posts the note with the CSRF proof and refuses a note over 300 characters before sending", async () => {
    const calls: { path: string; init: RequestInit }[] = [];
    const client = createDirectorHostRequestClient(async (path, init) => {
      calls.push({ path, init });
      if (path === "/v1/session/csrf") {
        return json({ schemaVersion: "mk8dx.web-csrf.v1", headerName: "x-mk8dx-csrf", value: "synthetic-proof" });
      }
      return json(standingDocument(openRequest), 201);
    });
    const standing = await client.submit("  Friday nights  ");
    expect(standing.request?.status).toBe("open");
    expect(calls[1]).toMatchObject({ path: "/v1/me/director-host-request" });
    expect(calls[1]!.init.method).toBe("POST");
    expect(JSON.parse(String(calls[1]!.init.body))).toEqual({ note: "Friday nights" });
    expect((calls[1]!.init.headers as Record<string, string>)["x-mk8dx-csrf"]).toBe("synthetic-proof");
    await expect(client.submit("x".repeat(301))).rejects.toMatchObject({ code: "invalid_input" });
    expect(calls).toHaveLength(2);
  });

  it("names the server's reason on a refusal", async () => {
    const client = createDirectorHostRequestClient(async (path) => path === "/v1/session/csrf"
      ? json({ schemaVersion: "mk8dx.web-csrf.v1", headerName: "x-mk8dx-csrf", value: "synthetic-proof" })
      : json({ code: "director_host_request_already_open", message: "open" }, 409));
    const failure = await client.submit("").catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(HostRequestClientError);
    expect(failure).toMatchObject({ code: "conflict", serverCode: "director_host_request_already_open" });
  });
});

function fakeClient(standing: HostRequestStanding, queue: readonly HostRequestQueueItem[] = []) {
  const calls: string[] = [];
  let current = standing;
  const client: DirectorHostRequestClient = {
    async standing() { return current; },
    async submit(note) {
      calls.push(`submit:${note}`);
      current = { ...current, request: { ...openRequest, status: "open", note: note.trim() || null } };
      return current;
    },
    async queue() { return queue; },
    async approve(id) { calls.push(`approve:${id}`); },
    async decline(id, reason) { calls.push(`decline:${id}:${reason}`); },
  };
  return { client, calls };
}

async function settle(): Promise<void> {
  for (let turn = 0; turn < 8; turn += 1) { await new Promise((resolve) => setTimeout(resolve, 0)); }
}

function mount(standing: HostRequestStanding) {
  const document = new FakeDocument();
  const root = document.createElement("div");
  const { client, calls } = fakeClient(standing);
  const mounted = mountDirectorHostRequest(root as unknown as HTMLElement, client);
  return { root, mounted, calls };
}

describe("Request to host on the Tournaments page", () => {
  it("explains how to become a Director and sends a request with a note", async () => {
    const { root, mounted, calls } = mount({ administrator: false, director: false, request: null });
    await mounted.ready;
    const section = root.children[0]!;
    expect(section.hidden).toBe(false);
    expect(texts(root).join("\n")).toContain("Tournament nights are hosted by Directors");
    const note = descendants(root).find((node) => node.tagName === "textarea")!;
    note.value = "Friday nights in Utrecht";
    const send = descendants(root).find((node) => node.tagName === "button" && node.textContent === "Request to host")!;
    send.click();
    await settle();
    expect(calls).toEqual(["submit:Friday nights in Utrecht"]);
    expect(texts(root).join("\n")).toMatch(/Request sent on .+\. The administrators will answer it\./u);
    expect(texts(root).join("\n")).toContain("Your note: Friday nights in Utrecht");
    expect(descendants(root).some((node) => node.tagName === "textarea")).toBe(false);
    mounted.unmount();
    expect(root.children).toHaveLength(0);
  });

  it("shows a decline with its reason and offers to ask again", async () => {
    const { root, mounted } = mount({
      administrator: false, director: false,
      request: { ...openRequest, status: "declined", decidedAtMs: 1_790_000_100_000, declineReason: "Run one night first" },
    });
    await mounted.ready;
    expect(texts(root).join("\n")).toContain("Declined: Run one night first");
    expect(descendants(root).some((node) => node.tagName === "button" && node.textContent === "Ask again")).toBe(true);
  });

  it("is never shown to an administrator or a Director", async () => {
    for (const standing of [
      { administrator: true, director: false, request: null },
      { administrator: false, director: true, request: { ...openRequest, status: "approved" as const } },
    ]) {
      const { root, mounted } = mount(standing);
      await mounted.ready;
      expect((root.children[0] as FakeNode).hidden).toBe(true);
      expect(descendants(root).some((node) => node.tagName === "button")).toBe(false);
    }
  });

  it("speaks Dutch with Directeur", async () => {
    vi.stubGlobal("localStorage", { getItem: () => "nl", setItem: () => undefined });
    setProductLanguage("nl");
    const { root, mounted } = mount({ administrator: false, director: false, request: null });
    await mounted.ready;
    expect(texts(root).join("\n")).toContain("Toernooiavonden worden gehost door Directeuren");
    expect(descendants(root).some((node) => node.textContent === "Verzoek om te hosten")).toBe(true);
  });
});

describe("Requests to host in the Directors section", () => {
  it("lists who asks with their Players, note and date, and approves or declines with a reason", async () => {
    const document = new FakeDocument();
    const root = document.createElement("div");
    const queue: HostRequestQueueItem[] = [
      {
        requestId, userAccountId: "user_account.synthetic_asker", accountCreatedAtMs: 1_780_000_000_000,
        players: [{ playerId: "player.synthetic_mal", username: "mal", displayName: "Mal" }],
        note: "Friday nights", requestedAtMs: 1_790_000_000_000,
      },
      {
        requestId: "director_host_request.synthetic-2", userAccountId: "user_account.synthetic_new",
        accountCreatedAtMs: 1_789_000_000_000, players: [], note: null, requestedAtMs: 1_790_000_500_000,
      },
    ];
    const { client, calls } = fakeClient({ administrator: true, director: false, request: null }, queue);
    const previousFetch = globalThis.fetch;
    // The Directors list itself still comes from its own routes; an empty answer keeps this focused.
    globalThis.fetch = (async (path: string) => json(
      String(path).includes("linked-player-accounts") ? { players: [] } : [],
    )) as typeof fetch;
    try {
      const mounted = mountTournamentOperatorAccess(root as unknown as HTMLElement, client);
      await mounted.ready;
      const section = root.children[0]!;
      expect(section.open).toBe(true);
      const page = texts(root).join("\n");
      expect(page).toContain("Directors");
      expect(page).toContain("Requests to host");
      expect(page).toContain("2 open request(s) to host.");
      expect(page).toContain("Mal (@mal)");
      expect(page).toContain("Friday nights");
      expect(page).toContain("An account without a linked Player");
      const rows = allByClass(root, "operator-access__request");
      expect(rows).toHaveLength(2);
      descendants(rows[0]!).find((node) => node.textContent === "Approve")!.click();
      const reason = descendants(rows[1]!).find((node) => node.tagName === "input")!;
      reason.value = "Not yet";
      descendants(rows[1]!).find((node) => node.textContent === "Decline")!.click();
      await settle();
      expect(calls).toEqual([`approve:${requestId}`, "decline:director_host_request.synthetic-2:Not yet"]);
      expect(allByClass(root, "operator-access__request")).toHaveLength(0);
      expect(texts(root).join("\n")).toContain("Remove Director");
      mounted.unmount();
    } finally {
      globalThis.fetch = previousFetch;
    }
  });
});
