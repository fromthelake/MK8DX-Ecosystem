import { describe, expect, it } from "vitest";
import { hostedSmtpEnvironment } from "../src/composition/hosted-smtp-environment.js";

describe("private SMTP installer environment", () => {
  it("round-trips shell-special UTF-8 password bytes without exposing them as an env-file literal", () => {
    const password = "special'\n$#é";
    const encoded = Buffer.from(password).toString("base64");
    const result = hostedSmtpEnvironment({ MK8DX_HOSTED_SMTP_PASSWORD_BASE64: encoded });
    expect(result.MK8DX_HOSTED_SMTP_PASSWORD).toBe(password);
  });

  it("rejects malformed or noncanonical encodings", () => {
    expect(() => hostedSmtpEnvironment({ MK8DX_HOSTED_SMTP_PASSWORD_BASE64: "!!" })).toThrow();
    expect(() => hostedSmtpEnvironment({ MK8DX_HOSTED_SMTP_PASSWORD_BASE64: "//8=" })).toThrow();
  });
});
