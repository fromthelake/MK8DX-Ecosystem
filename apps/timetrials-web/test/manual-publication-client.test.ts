import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import {
  createWebManualSameOriginPublicationClient,
  WEB_MANUAL_PUBLICATION_RESPONSE_MAX_BYTES,
  WEB_MANUAL_SUBMISSION_PATH,
  WebManualPublicationError,
} from "../src/manual-publication-client.js";
import {
  createWebManualSubmission,
  type WebManualTimeTrialSubmissionV1,
} from "../src/manual-submission.js";


const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));

function submission(): WebManualTimeTrialSubmissionV1 {
  return createWebManualSubmission({
    submissionId: "user_submission.time.SYNTHETICWEBPUBLISH01",
    revision: 2,
    mode: 200,
    trackId: "track.mario_kart_stadium",
    timeDigits: "134612",
    playerReference: {
      namespace: "player",
      value: "player.synthetic_driver",
    },
    countryId: "country.nl",
    observedPlayerName: "Synthetic Driver",
    occurredAtMs: 1_786_900_050_000,
    createdAtMs: 1_786_900_060_000,
    producerVersion: "phase4-web-publication-v1",
  });
}

function created(input = submission()): Response {
  return new Response(JSON.stringify({
    submissionId: input.submissionId,
    revision: input.revision,
  }), {
    status: 201,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

describe("web manual same-origin publication client", () => {
  it("posts only projected canonical V1 to the fixed same-origin API", async () => {
    const fetchPort = vi.fn(async (_input: string, _init: RequestInit) => created());
    const client = createWebManualSameOriginPublicationClient(fetchPort);
    const input = submission();

    await expect(client.publish(input, {
      headerName: "X-MK8DX-CSRF",
      value: "synthetic-csrf-proof",
    })).resolves.toEqual({
      submissionId: input.submissionId,
      revision: 2,
    });

    expect(fetchPort).toHaveBeenCalledOnce();
    const [path, init] = fetchPort.mock.calls[0]!;
    expect(path).toBe(`${WEB_MANUAL_SUBMISSION_PATH}?feedback=v1`);
    expect(init).toMatchObject({
      method: "POST",
      credentials: "same-origin",
      mode: "same-origin",
      redirect: "error",
      referrerPolicy: "same-origin",
      cache: "no-store",
    });
    expect(init.headers).toEqual({
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-MK8DX-CSRF": "synthetic-csrf-proof",
    });
    expect(JSON.parse(init.body as string)).toEqual(input);
    expect(init.body).not.toContain("synthetic-csrf-proof");
    expect(JSON.parse(init.body as string)).not.toHaveProperty("visibility");
  });

  it("preserves validated optional laps, coins, mushrooms and loadout in publication", async () => {
    const fetchPort = vi.fn(async (_input: string, _init: RequestInit) => created());
    const client = createWebManualSameOriginPublicationClient(fetchPort);
    const input: WebManualTimeTrialSubmissionV1 = {
      ...submission(),
      totalTimeMs: 94_612,
      laps: [
        { lapNumber: 1, timeMs: 31_500, coinsCollected: 4, mushroomsUsed: 1 },
        { lapNumber: 2, timeMs: 31_500, coinsCollected: 3, mushroomsUsed: 0 },
        { lapNumber: 3, timeMs: 31_612, coinsCollected: 3, mushroomsUsed: 2 },
      ],
      loadout: {
        characterId: "character.yoshi",
        bodyId: "body.mr_scooty",
        tireId: "tire.roller",
        gliderId: "glider.cloud_glider",
      },
    };
    await client.publish(input, {
      headerName: "X-CSRF",
      value: "synthetic-proof",
    });
    expect(JSON.parse(fetchPort.mock.calls[0]![1].body as string)).toEqual(input);
  });

  it("carries a scanned colour variant only beside its base part (ADR-0215)", async () => {
    const fetchPort = vi.fn(async (_input: string, _init: RequestInit) => created());
    const client = createWebManualSameOriginPublicationClient(fetchPort);
    const input: WebManualTimeTrialSubmissionV1 = {
      ...submission(),
      loadout: { characterId: "character.yoshi", characterVariantId: "character_variant.yoshi.017_light_blue" },
    };
    await client.publish(input, { headerName: "X-CSRF", value: "synthetic-proof" });
    expect(JSON.parse(fetchPort.mock.calls[0]![1].body as string)).toEqual(input);
    const orphan: WebManualTimeTrialSubmissionV1 = {
      ...submission(),
      loadout: { characterId: "character.mario", characterVariantId: "character_variant.yoshi.017_light_blue" },
    };
    await expect(client.publish(orphan, { headerName: "X-CSRF", value: "synthetic-proof" }))
      .rejects.toMatchObject({ code: "invalid_submission" });
  });

  it.each([
    null,
    {},
    { headerName: "Authorization", value: "private-token" },
    { headerName: "Content-Type", value: "private-token" },
    { headerName: "X-CSRF\r\nCookie", value: "private-token" },
    { headerName: "X-CSRF", value: "line\nbreak" },
    { headerName: "X-CSRF", value: "contains space" },
    { headerName: "X-CSRF", value: "" },
    { headerName: "X-CSRF", value: "x".repeat(4_097) },
  ])("rejects malformed or unsafe CSRF proof before transport: %#", async (proof) => {
    const fetchPort = vi.fn(async () => created());
    const client = createWebManualSameOriginPublicationClient(fetchPort);
    await expect(client.publish(submission(), proof)).rejects.toMatchObject({
      code: "invalid_session",
      retryable: false,
    });
    expect(fetchPort).not.toHaveBeenCalled();
  });

  it("rejects widened or non-web-manual documents before transport", async () => {
    const fetchPort = vi.fn(async () => created());
    const client = createWebManualSameOriginPublicationClient(fetchPort);
    const widened = {
      ...submission(),
      privateFirebaseUid: "must-not-cross",
    } as unknown as WebManualTimeTrialSubmissionV1;
    await expect(client.publish(widened, {
      headerName: "X-CSRF",
      value: "synthetic-proof",
    })).rejects.toMatchObject({ code: "invalid_submission" });
    expect(fetchPort).not.toHaveBeenCalled();
  });

  it.each([
    [401, "not_authenticated", false],
    [403, "not_authorized", false],
    [409, "revision_conflict", false],
    [400, "submission_rejected", false],
    [404, "submission_rejected", false],
    [429, "service_unavailable", true],
    [503, "service_unavailable", true],
  ])("maps HTTP %i without exposing response detail", async (
    status,
    code,
    retryable,
  ) => {
    const fetchPort = vi.fn(async () => new Response(
      JSON.stringify({ privateDetail: "must-not-escape" }),
      { status, headers: { "Content-Type": "application/json" } },
    ));
    const client = createWebManualSameOriginPublicationClient(fetchPort);
    const promise = client.publish(submission(), {
      headerName: "X-CSRF",
      value: "synthetic-proof",
    });
    await expect(promise).rejects.toMatchObject({ code, retryable });
    await expect(promise).rejects.not.toThrow("must-not-escape");
  });

  it("says a time more than 12 % faster than the World Record is refused as such", async () => {
    const fetchPort = vi.fn(async () => new Response(
      JSON.stringify({
        code: "time_trial_time_implausible",
        message: "The proposed time is highly unreasonable, please double check all information.",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    ));
    const client = createWebManualSameOriginPublicationClient(fetchPort);
    await expect(client.publish(submission(), { headerName: "X-CSRF", value: "synthetic-proof" }))
      .rejects.toMatchObject({ code: "implausible_time", retryable: false });
  });

  it("carries a well-formed feedback block and drops a malformed one", async () => {
    const input = submission();
    const feedback = {
      trackId: "track.mario_kart_stadium",
      modeCc: 200,
      totalTimeMs: 94_612,
      personalBest: { previousBestMs: null, deltaMs: null, improved: true },
      rank: { after: 3, before: null, passed: [], passedCount: 0, rivalsPassed: 0 },
    };
    const respond = (body: unknown): Response => new Response(JSON.stringify(body), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
    const proof = { headerName: "X-CSRF", value: "synthetic-proof" };

    const carried = createWebManualSameOriginPublicationClient(vi.fn(async () =>
      respond({ submissionId: input.submissionId, revision: 2, feedback })));
    await expect(carried.publish(input, proof)).resolves.toEqual({
      submissionId: input.submissionId, revision: 2, feedback,
    });

    const dropped = createWebManualSameOriginPublicationClient(vi.fn(async () =>
      respond({
        submissionId: input.submissionId, revision: 2,
        feedback: { ...feedback, rank: { ...feedback.rank, after: 0 } },
      })));
    await expect(dropped.publish(input, proof)).resolves.toEqual({
      submissionId: input.submissionId, revision: 2,
    });
  });

  it("treats transport failure as retryable without leaking its detail", async () => {
    const client = createWebManualSameOriginPublicationClient(
      vi.fn(async () => { throw new Error("private network detail"); }),
    );
    const promise = client.publish(submission(), {
      headerName: "X-CSRF",
      value: "synthetic-proof",
    });
    await expect(promise).rejects.toEqual(
      new WebManualPublicationError("network_unavailable", true),
    );
    await expect(promise).rejects.not.toThrow("private network detail");
  });

  it.each([
    new Response("not-json", {
      status: 201,
      headers: { "Content-Type": "application/json" },
    }),
    new Response(JSON.stringify({ submissionId: "wrong", revision: 2 }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    }),
    new Response(JSON.stringify({
      submissionId: submission().submissionId,
      revision: 2,
      privateDetail: true,
    }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    }),
    new Response(JSON.stringify({
      submissionId: submission().submissionId,
      revision: 2,
    }), {
      status: 201,
      headers: { "Content-Type": "text/plain" },
    }),
    new Response(JSON.stringify({
      submissionId: submission().submissionId,
      revision: 2,
    }), {
      status: 201,
      headers: { "Content-Type": "application/jsonp" },
    }),
    new Response(null, {
      status: 201,
      headers: { "Content-Type": "application/json" },
    }),
    new Response(JSON.stringify({
      submissionId: submission().submissionId,
      revision: 2,
    }), {
      status: 201,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": `${WEB_MANUAL_PUBLICATION_RESPONSE_MAX_BYTES + 1}`,
      },
    }),
    new Response(`"${"x".repeat(WEB_MANUAL_PUBLICATION_RESPONSE_MAX_BYTES)}"`, {
      status: 201,
      headers: { "Content-Type": "application/json" },
    }),
  ])("rejects malformed, widened, mismatched, or oversized success", async (response) => {
    const client = createWebManualSameOriginPublicationClient(
      vi.fn(async () => response),
    );
    await expect(client.publish(submission(), {
      headerName: "X-CSRF",
      value: "synthetic-proof",
    })).rejects.toMatchObject({ code: "invalid_response", retryable: false });
  });

  it("contains no Firebase, browser-storage, service-worker, or absolute endpoint path", () => {
    const source = readFileSync(
      `${repositoryRoot}apps/timetrials-web/src/manual-publication-client.ts`,
      "utf8",
    );
    expect(source).not.toMatch(
      /firebase|firestore|localStorage|sessionStorage|indexedDB|XMLHttpRequest|serviceWorker/i,
    );
    expect(source).not.toMatch(/https?:\/\/|window\.location|document\.cookie/i);
    expect(source).toContain(
      'WEB_MANUAL_SUBMISSION_PATH = "/v1/time-trial-submissions"',
    );
  });
});
