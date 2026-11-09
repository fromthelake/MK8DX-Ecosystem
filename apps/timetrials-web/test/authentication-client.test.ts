import { describe, expect, it, vi } from "vitest";

import {
  createWebAuthenticationClient,
  WebAuthenticationError,
} from "../src/authentication-client.js";

function json(document: unknown, status = 200): Response {
  return new Response(JSON.stringify(document), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("same-origin web authentication client", () => {
  it("reads the explicit offline invitation mode from public installation config", async () => {
    const offline = vi.fn(async () => json({
      schemaVersion: "mk8dx.public-client.v1", websiteOrigin: "https://192.168.50.20",
      authenticationMode: "offline-invitation",
    }));
    await expect(createWebAuthenticationClient(offline).installationMode?.())
      .resolves.toBe("offline-invitation");
    expect(offline).toHaveBeenCalledWith("/client-config.json",
      expect.objectContaining({ method: "GET", credentials: "same-origin", cache: "no-store" }));
    await expect(createWebAuthenticationClient(async () => json({
      schemaVersion: "mk8dx.public-client.v1", websiteOrigin: "https://example.invalid",
    })).installationMode?.()).resolves.toBe("email-link");
    await expect(createWebAuthenticationClient(async () => new Response("not found", { status: 404 }))
      .installationMode?.()).resolves.toBe("email-link");
    await expect(createWebAuthenticationClient(async () => json({
      schemaVersion: "mk8dx.public-client.v1", websiteOrigin: "https://example.invalid",
      authenticationMode: "untrusted",
    })).installationMode?.()).rejects.toBeInstanceOf(WebAuthenticationError);
  });

  it("maps only a verified server session to an opaque authenticated state", async () => {
    const fetchPort = vi.fn(async (_input: string, _init: RequestInit) =>
      json({
        session: { id: "private-session" },
        user: { email: "private@example.test", emailVerified: true },
      }));
    const client = createWebAuthenticationClient(fetchPort);

    const session = await client.session();
    expect(session).toEqual({ authenticated: true });
    expect(fetchPort).toHaveBeenCalledWith(
      "/api/auth/get-session",
      expect.objectContaining({
        method: "GET",
        credentials: "same-origin",
        mode: "same-origin",
        redirect: "error",
        cache: "no-store",
      }),
    );
    // Signing in asks one question. Capabilities are a separate question,
    // so a signed-out visitor never provokes a 401 on this path.
    expect(fetchPort).toHaveBeenCalledTimes(1);
    expect(fetchPort).not.toHaveBeenCalledWith(
      "/v1/session/capabilities",
      expect.anything(),
    );
    expect(JSON.stringify(session)).not.toContain("private@example.test");
  });

  it("reports administrator capability only when asked, and never for a signed-out visitor", async () => {
    const granted = vi.fn(async () => json({
      schemaVersion: "mk8dx.web-session-capabilities.v1",
      administrator: true,
      tournamentOperation: true,
    }));
    await expect(createWebAuthenticationClient(granted).capabilities())
      .resolves.toEqual({ administrator: true, tournamentOperation: true });
    await expect(createWebAuthenticationClient(async () => json({
      schemaVersion: "mk8dx.web-session-capabilities.v1",
      administrator: true,
    })).capabilities()).resolves.toEqual({ administrator: true, tournamentOperation: false });
    expect(granted).toHaveBeenCalledWith(
      "/v1/session/capabilities",
      expect.objectContaining({ method: "GET", credentials: "same-origin" }),
    );
    for (const status of [401, 403]) {
      await expect(createWebAuthenticationClient(
        async () => json({ code: "denied", message: "no" }, status),
      ).capabilities()).resolves.toBeNull();
    }
    await expect(createWebAuthenticationClient(
      async () => json({ schemaVersion: "other.v1", administrator: true, tournamentOperation: true }),
    ).capabilities()).rejects.toBeInstanceOf(WebAuthenticationError);
  });

  it("treats a null session as signed out and rejects unverified shapes", async () => {
    await expect(createWebAuthenticationClient(
      async () => json(null),
    ).session()).resolves.toBeNull();
    await expect(createWebAuthenticationClient(
      async () => json({ session: {}, user: { emailVerified: false } }),
    ).session()).rejects.toBeInstanceOf(WebAuthenticationError);
  });

  it("requests a magic link with normalized email and a local callback", async () => {
    const fetchPort = vi.fn(async (_input: string, _init: RequestInit) =>
      json({ status: true }));
    const client = createWebAuthenticationClient(fetchPort);
    await client.requestMagicLink(
      "  Player@Example.Test ",
      "/device?user_code=ABCD-1234",
    );

    const [path, init] = fetchPort.mock.calls[0]!;
    expect(path).toBe("/api/auth/sign-in/magic-link");
    expect(init).toMatchObject({
      method: "POST",
      credentials: "same-origin",
      mode: "same-origin",
    });
    expect(JSON.parse(String(init.body))).toEqual({
      email: "player@example.test",
      callbackURL: "/device?user_code=ABCD-1234",
      // Onboarding and the link-error screen both carry the interrupted
      // destination, so a brand-new device approval is not stranded on the
      // new Player's profile. Double-encoded: Better Auth's verify step
      // decodes the whole callback one extra time.
      newUserCallbackURL:
        "/?welcome=1&return=%252Fdevice%253Fuser_code%253DABCD-1234",
      errorCallbackURL:
        "/?authError=1&return=%252Fdevice%253Fuser_code%253DABCD-1234",
    });
  });

  it("keeps the plain onboarding and error callbacks for the default landing", async () => {
    const fetchPort = vi.fn(async (_input: string, _init: RequestInit) =>
      json({ status: true }));
    const client = createWebAuthenticationClient(fetchPort);
    await client.requestMagicLink("player@example.test", "/");
    expect(JSON.parse(String(fetchPort.mock.calls[0]![1].body))).toEqual({
      email: "player@example.test",
      callbackURL: "/",
      newUserCallbackURL: "/?welcome=1",
      errorCallbackURL: "/?authError=1",
    });
  });

  it("never sends an invalid email or external/protocol-relative callback", async () => {
    const fetchPort = vi.fn(async (_input: string, _init: RequestInit) =>
      json({ status: true }));
    const client = createWebAuthenticationClient(fetchPort);
    for (const [email, callback] of [
      ["bad mailbox", "/"],
      ["player@example.test", "https://evil.example/"],
      ["player@example.test", "//evil.example/"],
    ]) {
      await expect(client.requestMagicLink(email!, callback!)).rejects.toMatchObject({
        code: "invalid_input",
      });
    }
    expect(fetchPort).not.toHaveBeenCalled();
  });

  it("loads and approves or denies only an allow-listed pending device", async () => {
    const responses = [
      json({
        user_code: "ABCD-1234",
        status: "pending",
        client_id: "mk8dx.timetrials.android.v1",
      }),
      json({ success: true }),
      json({ success: true }),
    ];
    const fetchPort = vi.fn(async (_input: string, _init: RequestInit) =>
      responses.shift()!);
    const client = createWebAuthenticationClient(fetchPort);
    await expect(client.device("abcd-1234")).resolves.toEqual({
      userCode: "ABCD-1234",
      clientId: "mk8dx.timetrials.android.v1",
    });
    await client.approveDevice("ABCD-1234");
    await client.denyDevice("ABCD-1234");
    expect(fetchPort.mock.calls.map(([path]) => path)).toEqual([
      "/api/auth/device?user_code=ABCD-1234",
      "/api/auth/device/approve",
      "/api/auth/device/deny",
    ]);
  });

  it("maps authentication, expiry, rate, network, and oversized failures", async () => {
    await expect(createWebAuthenticationClient(
      async () => json({ error: "unauthorized" }, 401),
    ).device("ABCD-1234")).rejects.toMatchObject({ code: "not_authenticated" });
    await expect(createWebAuthenticationClient(
      async () => json({ error: "expired" }, 400),
    ).device("ABCD-1234")).rejects.toMatchObject({ code: "invalid_device_code" });
    await expect(createWebAuthenticationClient(
      async () => json({ error: "limited" }, 429),
    ).requestMagicLink("player@example.test", "/")).rejects.toMatchObject({
      code: "service_unavailable",
      retryable: true,
    });
    await expect(createWebAuthenticationClient(
      async () => { throw new Error("private network detail"); },
    ).session()).rejects.toMatchObject({ code: "network_unavailable" });
    await expect(createWebAuthenticationClient(
      async () => new Response("{}", {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": "99999",
        },
      }),
    ).session()).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("uses the maintained session revocation endpoint for sign-out", async () => {
    const fetchPort = vi.fn(async (_input: string, _init: RequestInit) =>
      json({ success: true }));
    await createWebAuthenticationClient(fetchPort).signOut();
    expect(fetchPort).toHaveBeenCalledWith(
      "/api/auth/sign-out",
      expect.objectContaining({ method: "POST", credentials: "same-origin" }),
    );
  });
});
