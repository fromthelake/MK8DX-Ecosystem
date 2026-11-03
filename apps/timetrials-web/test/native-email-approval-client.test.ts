import { describe, expect, it } from "vitest";

import {
  NativeEmailApprovalClientError,
  approveDeviceEmail,
  inspectDeviceEmail,
  isDeviceEmailToken,
  parseDeviceEmailRequest,
} from "../src/native-email-approval-client.js";

const token = "a".repeat(43);
const view = { schemaVersion: "mk8dx.native-email-approval.v1", userCode: "ABCD-EFGH", clientName: "LiveTrial for Windows", expiresAtMs: 1 };

function respond(status: number, body: unknown) {
  const calls: Array<[string, RequestInit | undefined]> = [];
  const fetcher = async (input: string, init?: RequestInit) => {
    calls.push([input, init]);
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  };
  return { calls, fetcher };
}

describe("native email approval client (ADR-0209)", () => {
  it("reads the link without approving it and approves only with a POST", async () => {
    const read = respond(200, view);
    expect(await inspectDeviceEmail(token, read.fetcher)).toEqual({ userCode: "ABCD-EFGH", clientName: "LiveTrial for Windows", expiresAtMs: 1 });
    expect(read.calls[0]![1]?.method).toBe("GET");
    expect(read.calls[0]![1]?.credentials).toBe("omit");

    const approve = respond(200, { schemaVersion: "mk8dx.native-email-approval.v1", status: "approved" });
    await approveDeviceEmail(token, approve.fetcher);
    expect(approve.calls[0]![1]?.method).toBe("POST");
    expect(JSON.parse(String(approve.calls[0]![1]?.body))).toEqual({ token });
  });

  it("says an expired or used link plainly and rejects any other document shape", async () => {
    await expect(inspectDeviceEmail(token, respond(404, { code: "native_email_link_invalid", message: "x" }).fetcher))
      .rejects.toMatchObject({ code: "expired_or_used" });
    await expect(approveDeviceEmail(token, respond(404, {}).fetcher)).rejects.toMatchObject({ code: "expired_or_used" });
    expect(() => parseDeviceEmailRequest({ ...view, extra: 1 })).toThrow(NativeEmailApprovalClientError);
    expect(() => parseDeviceEmailRequest({ ...view, userCode: "<b>" })).toThrow(NativeEmailApprovalClientError);
    await expect(approveDeviceEmail(token, respond(200, { schemaVersion: "mk8dx.native-email-approval.v1", status: "maybe" }).fetcher))
      .rejects.toMatchObject({ code: "invalid_response" });
  });

  it("only accepts a link token of the served shape", () => {
    expect(isDeviceEmailToken(token)).toBe(true);
    expect(isDeviceEmailToken("1")).toBe(false);
    expect(isDeviceEmailToken(null)).toBe(false);
    expect(isDeviceEmailToken(`${token}/../x`)).toBe(false);
  });
});
