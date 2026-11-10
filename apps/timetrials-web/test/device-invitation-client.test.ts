import { describe, expect, it, vi } from "vitest";

import {
  AUTH_REVOKE_SESSIONS_PATH,
  AUTH_SIGN_OUT_PATH,
  createWebAuthenticationClient,
  DEVICE_INVITATION_PATH,
  parseDeviceInvitation,
  WebAuthenticationError,
} from "../src/authentication-client.js";

function json(document: unknown, status = 200): Response {
  return new Response(JSON.stringify(document), {
    status, headers: { "Content-Type": "application/json" },
  });
}

const csrf = { schemaVersion: "mk8dx.web-csrf.v1", headerName: "X-MK8DX-CSRF", value: "proof-1" };
const size = 25;
// The exact shape device-invitation-routes.ts declares in its response schema (closed object).
const invitation = {
  schemaVersion: "mk8dx.device-invitation.v1",
  invitationUrl: `https://192.168.1.20/offline-invite#token=${"A".repeat(43)}`,
  expiresAtMs: 1_900_000_900_000,
  qr: { size, modules: "10".repeat((size * size - 1) / 2) + "1" },
};

function port(answers: Readonly<Record<string, Response | (() => Response)>>) {
  return vi.fn(async (input: string, _init: RequestInit) => {
    const answer = answers[input];
    if (answer === undefined) { throw new Error(`unexpected ${input}`); }
    return typeof answer === "function" ? answer() : answer.clone();
  });
}

describe("add another device: the web client (ADR-0224)", () => {
  it("fetches a CSRF proof, then posts no input and returns the parsed card", async () => {
    const fetchPort = port({ "/v1/session/csrf": json(csrf), [DEVICE_INVITATION_PATH]: json(invitation) });
    const card = await createWebAuthenticationClient(fetchPort).createDeviceInvitation!();
    expect(card.invitationUrl).toBe(invitation.invitationUrl);
    expect(card.expiresAtMs).toBe(invitation.expiresAtMs);
    expect(card.qr.size).toBe(size);
    expect(card.qr.modules).toHaveLength(size * size);
    expect(card.qr.modules[0]).toBe(true);
    expect(card.qr.modules[1]).toBe(false);
    const post = fetchPort.mock.calls.find(([path]) => path === DEVICE_INVITATION_PATH)![1];
    expect(post).toMatchObject({ method: "POST", credentials: "same-origin", cache: "no-store", body: "{}" });
    expect(post.headers).toMatchObject({ "X-MK8DX-CSRF": "proof-1" });
  });

  it("maps refusals: 401 signed out, 403/404 not available here, 429 and 5xx retryable", async () => {
    for (const [status, code] of [
      [401, "not_authenticated"], [403, "not_available"], [404, "not_available"],
      [429, "service_unavailable"], [503, "service_unavailable"],
    ] as const) {
      const fetchPort = port({
        "/v1/session/csrf": json(csrf),
        [DEVICE_INVITATION_PATH]: json({ code: "x", message: "y" }, status),
      });
      await expect(createWebAuthenticationClient(fetchPort).createDeviceInvitation!())
        .rejects.toMatchObject({ code });
    }
    const signedOut = port({ "/v1/session/csrf": json({ code: "x", message: "y" }, 401) });
    await expect(createWebAuthenticationClient(signedOut).createDeviceInvitation!())
      .rejects.toMatchObject({ code: "not_authenticated" });
    expect(signedOut).toHaveBeenCalledTimes(1);
  });

  it("rejects any document that is not exactly the declared shape", () => {
    expect(() => parseDeviceInvitation(200, invitation)).not.toThrow();
    const bad: unknown[] = [
      { ...invitation, extra: true },
      { ...invitation, schemaVersion: "mk8dx.device-invitation.v2" },
      { ...invitation, qr: { ...invitation.qr, extra: 1 } },
      { ...invitation, qr: { size, modules: invitation.qr.modules.slice(1) } },
      { ...invitation, qr: { size: 24, modules: "1".repeat(24 * 24) } },
      { ...invitation, qr: { size, modules: "2".repeat(size * size) } },
      { ...invitation, expiresAtMs: 1.5 },
      { ...invitation, invitationUrl: "http://192.168.1.20/offline-invite#token=" + "A".repeat(43) },
      { ...invitation, invitationUrl: "https://192.168.1.20/elsewhere#token=" + "A".repeat(43) },
      { ...invitation, invitationUrl: "https://192.168.1.20/offline-invite?token=" + "A".repeat(43) },
      { ...invitation, invitationUrl: "https://192.168.1.20/offline-invite#token=short" },
    ];
    for (const document of bad) {
      expect(() => parseDeviceInvitation(200, document)).toThrow(WebAuthenticationError);
    }
    expect(() => parseDeviceInvitation(201, invitation)).toThrow(WebAuthenticationError);
  });
});

describe("sign out on all devices: the web client (ADR-0224)", () => {
  it("revokes every session, then clears this browser's cookie", async () => {
    const fetchPort = port({
      [AUTH_REVOKE_SESSIONS_PATH]: json({ status: true }),
      [AUTH_SIGN_OUT_PATH]: json({ success: true }),
    });
    await createWebAuthenticationClient(fetchPort).signOutEverywhere!();
    expect(fetchPort.mock.calls.map(([path]) => path)).toEqual([AUTH_REVOKE_SESSIONS_PATH, AUTH_SIGN_OUT_PATH]);
    expect(fetchPort.mock.calls[0]![1]).toMatchObject({ method: "POST", credentials: "same-origin" });
  });

  it("does not report success when the revocation did not happen", async () => {
    for (const [response, code] of [
      [json({ code: "UNAUTHORIZED" }, 401), "not_authenticated"],
      [json({ code: "x" }, 500), "service_unavailable"],
      [json({ status: false }), "invalid_response"],
    ] as const) {
      const fetchPort = port({ [AUTH_REVOKE_SESSIONS_PATH]: response, [AUTH_SIGN_OUT_PATH]: json({ success: true }) });
      await expect(createWebAuthenticationClient(fetchPort).signOutEverywhere!())
        .rejects.toMatchObject({ code });
      expect(fetchPort).toHaveBeenCalledTimes(1);
    }
  });
});
