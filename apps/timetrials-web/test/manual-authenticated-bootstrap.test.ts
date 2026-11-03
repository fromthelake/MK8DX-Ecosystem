import { describe, expect, it, vi } from "vitest";

import {
  createWebManualAuthenticatedBootstrapClient,
  WEB_MANUAL_BOOTSTRAP_PATH,
  WEB_MANUAL_CSRF_PATH,
  WebManualBootstrapError,
} from "../src/manual-authenticated-bootstrap.js";


function context(trackId = "track.mario_kart_stadium"): Record<string, unknown> {
  return {
    schemaVersion: "mk8dx.web-manual-context.v1",
    submissionId: "user_submission.time.web-bootstrap-0001",
    revision: 1,
    trackId,
    playerReference: {
      namespace: "player",
      value: "player.owner_01",
    },
    producer: {
      version: "timetrials-web-test",
      localRecordId: "web-bootstrap-0001",
    },
    timestamps: { createdAtMs: 1_786_912_000_000 },
  };
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function expectCode(
  action: Promise<unknown>,
  code: string,
  retryable = false,
): Promise<void> {
  await expect(action).rejects.toMatchObject({
    name: "WebManualBootstrapError",
    code,
    retryable,
  });
}

describe("authenticated same-origin web manual bootstrap", () => {
  it("establishes one closed central-Player context and fetches fresh CSRF proof", async () => {
    const fetchPort = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        schemaVersion: "mk8dx.web-manual-bootstrap.v1",
        context: context(),
      }))
      .mockResolvedValueOnce(jsonResponse({
        schemaVersion: "mk8dx.web-csrf.v1",
        headerName: "X-MK8DX-CSRF",
        value: "fresh-proof-0001",
      }))
      .mockResolvedValueOnce(jsonResponse({
        schemaVersion: "mk8dx.web-csrf.v1",
        headerName: "X-MK8DX-CSRF",
        value: "fresh-proof-0002",
      }));
    const client = createWebManualAuthenticatedBootstrapClient(fetchPort);

    const session = await client.bootstrap("track.mario_kart_stadium");

    expect(JSON.parse(session.contextJson() as string)).toEqual(context());
    expect(await session.csrfProof()).toEqual({
      headerName: "X-MK8DX-CSRF",
      value: "fresh-proof-0001",
    });
    const csrfSignal = new AbortController().signal;
    expect(await session.csrfProof(csrfSignal)).toEqual({
      headerName: "X-MK8DX-CSRF",
      value: "fresh-proof-0002",
    });
    expect(fetchPort.mock.calls[0]?.[0]).toBe(
      `${WEB_MANUAL_BOOTSTRAP_PATH}?trackId=track.mario_kart_stadium`,
    );
    expect(fetchPort.mock.calls[1]?.[0]).toBe(WEB_MANUAL_CSRF_PATH);
    for (const call of fetchPort.mock.calls) {
      expect(call[1]).toMatchObject({
        method: "GET",
        credentials: "same-origin",
        mode: "same-origin",
        redirect: "error",
        cache: "no-store",
      });
      expect(call[1]?.headers).toEqual({ Accept: "application/json" });
    }

    expect(fetchPort.mock.calls[2]?.[1]).toMatchObject({ signal: csrfSignal });
  });

  it("rejects invalid requested tracks before transport", async () => {
    const fetchPort = vi.fn();
    const client = createWebManualAuthenticatedBootstrapClient(fetchPort);

    for (const trackId of ["", "00_MarioKartStadium", "track.Mario", "track.bad/path"]) {
      await expectCode(client.bootstrap(trackId), "invalid_track");
    }
    expect(fetchPort).not.toHaveBeenCalled();
  });

  it("requires the response track and a resolved central Player", async () => {
    for (const invalidContext of [
      context("track.water_park"),
      {
        ...context(),
        playerReference: {
          namespace: "legacy_firebase_user",
          value: "private-user",
        },
      },
    ]) {
      const client = createWebManualAuthenticatedBootstrapClient(
        vi.fn(async () => jsonResponse({
          schemaVersion: "mk8dx.web-manual-bootstrap.v1",
          context: invalidContext,
        })),
      );
      await expectCode(
        client.bootstrap("track.mario_kart_stadium"),
        "invalid_response",
      );
    }
  });

  it("maps authentication, authorization, temporary, and network failures", async () => {
    for (const [status, code, retryable] of [
      [401, "not_authenticated", false],
      [403, "not_authorized", false],
      [429, "service_unavailable", true],
      [503, "service_unavailable", true],
    ] as const) {
      const client = createWebManualAuthenticatedBootstrapClient(
        vi.fn(async () => jsonResponse({}, status)),
      );
      await expectCode(
        client.bootstrap("track.mario_kart_stadium"),
        code,
        retryable,
      );
    }
    const offline = createWebManualAuthenticatedBootstrapClient(
      vi.fn(async () => { throw new Error("private network detail"); }),
    );
    await expectCode(
      offline.bootstrap("track.mario_kart_stadium"),
      "network_unavailable",
      true,
    );
  });

  it("rejects widened, malformed, oversized, and invalid CSRF documents", async () => {
    const invalidBootstrap = [
      {},
      {
        schemaVersion: "mk8dx.web-manual-bootstrap.v1",
        context: context(),
        extra: true,
      },
      {
        schemaVersion: "mk8dx.web-manual-bootstrap.v1",
        context: { ...context(), extra: true },
      },
    ];
    for (const value of invalidBootstrap) {
      const client = createWebManualAuthenticatedBootstrapClient(
        vi.fn(async () => jsonResponse(value)),
      );
      await expectCode(
        client.bootstrap("track.mario_kart_stadium"),
        "invalid_response",
      );
    }

    const huge = new Response("x".repeat(32_769), {
      headers: { "Content-Type": "application/json" },
    });
    await expectCode(
      createWebManualAuthenticatedBootstrapClient(
        vi.fn(async () => huge),
      ).bootstrap("track.mario_kart_stadium"),
      "invalid_response",
    );

    const fetchPort = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        schemaVersion: "mk8dx.web-manual-bootstrap.v1",
        context: context(),
      }))
      .mockResolvedValueOnce(jsonResponse({
        schemaVersion: "mk8dx.web-csrf.v1",
        headerName: "Authorization",
        value: "secret",
      }));
    const session = await createWebManualAuthenticatedBootstrapClient(fetchPort)
      .bootstrap("track.mario_kart_stadium");
    await expectCode(session.csrfProof(), "invalid_response");
  });

  it("uses one fixed generic error message", () => {
    expect(new WebManualBootstrapError("invalid_response", false).message)
      .toBe("The authenticated web manual session could not be established.");
  });
});
