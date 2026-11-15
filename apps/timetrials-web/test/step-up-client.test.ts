import { describe, expect, it } from "vitest";

import {
  StepUpClientError,
  confirmStepUpLink,
  isStepUpToken,
  parseStepUpLinkView,
  parseStepUpStatus,
  requestStepUp,
  stepUpAwareFetch,
} from "../src/step-up-client.js";

const origin = "https://club.example";
const stepUpRequired = () => new Response(JSON.stringify({ code: "step_up_required" }), {
  status: 403, headers: { "x-mk8dx-step-up": "required", "content-type": "application/json" },
});

describe("step-up aware fetch", () => {
  it("asks once, then repeats the original request exactly once with the same body", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    let answers = [stepUpRequired(), new Response("{}", { status: 201 })];
    const base = async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), body: init?.body });
      return answers.shift()!;
    };
    let asked = 0;
    const fetcher = stepUpAwareFetch(base, async () => { asked += 1; return true; }, origin);
    const answer = await fetcher("/v1/administrator-grants", { method: "POST", body: "{\"a\":1}" });
    expect(answer.status).toBe(201);
    expect(asked).toBe(1);
    expect(calls).toEqual([
      { url: "/v1/administrator-grants", body: "{\"a\":1}" },
      { url: "/v1/administrator-grants", body: "{\"a\":1}" },
    ]);
    // A second refusal after confirmation is returned as it is; there is no loop.
    answers = [stepUpRequired(), stepUpRequired()];
    expect((await fetcher("/v1/administrator-grants", { method: "POST", body: "{}" })).status).toBe(403);
    expect(asked).toBe(2);
  });

  it("returns the refusal when the person cancels, and leaves other answers alone", async () => {
    const plain403 = new Response("{}", { status: 403 });
    const answers = [stepUpRequired(), plain403, new Response("ok")];
    let asked = 0;
    const fetcher = stepUpAwareFetch(async () => answers.shift()!, async () => { asked += 1; return false; }, origin);
    expect((await fetcher("/v1/administrator-grants")).status).toBe(403);
    expect(await (await fetcher("/v1/x")).text()).toBe("{}");
    expect(await (await fetcher("/v1/y")).text()).toBe("ok");
    expect(asked).toBe(1);
  });

  it("shares one confirmation between concurrent requests and ignores other origins", async () => {
    let release: (value: boolean) => void = () => undefined;
    let asked = 0;
    const replies = new Map<string, number>();
    const base = async (input: RequestInfo | URL) => {
      const key = String(input);
      const seen = (replies.get(key) ?? 0) + 1;
      replies.set(key, seen);
      return seen === 1 ? stepUpRequired() : new Response("done");
    };
    const fetcher = stepUpAwareFetch(base, () => { asked += 1; return new Promise<boolean>((resolve) => { release = resolve; }); }, origin);
    const both = Promise.all([fetcher("/v1/a"), fetcher("/v1/b")]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    release(true);
    expect((await both).map((response) => response.status)).toEqual([200, 200]);
    expect(asked).toBe(1);
    expect((await fetcher("https://elsewhere.example/v1/c")).status).toBe(403);
    expect(asked).toBe(1);
  });
});

describe("step-up client", () => {
  it("parses only the exact server documents", () => {
    expect(parseStepUpStatus({ schemaVersion: "mk8dx.step-up.v1", active: true, expiresAtMs: 5, pending: false, windowSeconds: 600 }))
      .toEqual({ active: true, expiresAtMs: 5, pending: false, windowSeconds: 600 });
    expect(() => parseStepUpStatus({ schemaVersion: "mk8dx.step-up.v1", active: true, expiresAtMs: 5, pending: false,
      windowSeconds: 600, extra: 1 })).toThrow(StepUpClientError);
    expect(parseStepUpLinkView({ schemaVersion: "mk8dx.step-up.v1", clientKind: "native", requestedAtMs: 1,
      linkExpiresAtMs: 2, windowSeconds: 600 }).clientKind).toBe("native");
    expect(() => parseStepUpLinkView({ schemaVersion: "mk8dx.step-up.v1", clientKind: "robot", requestedAtMs: 1,
      linkExpiresAtMs: 2, windowSeconds: 600 })).toThrow(StepUpClientError);
    expect(isStepUpToken("a".repeat(43))).toBe(true);
    expect(isStepUpToken("a".repeat(42))).toBe(false);
  });

  it("reports a rate limit with its wait and an unusable link", async () => {
    const limited = async () => new Response("{}", { status: 429, headers: { "retry-after": "120" } });
    await expect(requestStepUp(limited)).rejects.toMatchObject({ code: "rate_limited", retryAfterSeconds: 120 });
    const used = async () => new Response("{}", { status: 404 });
    await expect(confirmStepUpLink("a".repeat(43), used)).rejects.toMatchObject({ code: "expired_or_used" });
    const sent: RequestInit[] = [];
    await requestStepUp(async (_input, init) => {
      sent.push(init!);
      return new Response(JSON.stringify({ schemaVersion: "mk8dx.step-up.v1", status: "sent", linkExpiresAtMs: 9, windowSeconds: 600 }),
        { status: 202 });
    });
    expect(sent[0]).toMatchObject({ method: "POST", credentials: "same-origin" });
  });

  it("tells a failed e-mail (link created, break-glass possible) apart from other failures", async () => {
    const mailDown = async () => new Response(JSON.stringify({ code: "step_up_mail_unavailable",
      message: "x", linkExpiresAtMs: 1_900_000_600_000 }), { status: 503 });
    await expect(requestStepUp(mailDown)).rejects.toMatchObject({ code: "mail_unavailable", linkExpiresAtMs: 1_900_000_600_000 });
    const otherOutage = async () => new Response(JSON.stringify({ code: "busy" }), { status: 503 });
    await expect(requestStepUp(otherOutage)).rejects.toMatchObject({ code: "unavailable" });
    const broken = async () => new Response(JSON.stringify({ code: "step_up_mail_unavailable" }), { status: 503 });
    await expect(requestStepUp(broken)).rejects.toMatchObject({ code: "unavailable" });
    const crashed = async () => new Response("{}", { status: 500 });
    await expect(requestStepUp(crashed)).rejects.toBeInstanceOf(StepUpClientError);
  });
});
