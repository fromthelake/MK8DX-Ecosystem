import { describe, expect, it } from "vitest";

import {
  SmtpMagicLinkConfigurationError,
  SmtpMagicLinkDelivery,
  SmtpMagicLinkDeliveryError,
  type SmtpMagicLinkTransport,
} from "../src/authentication/smtp-magic-link-delivery.js";

class SyntheticTransport implements SmtpMagicLinkTransport {
  readonly messages: Array<Readonly<Record<string, unknown>>> = [];
  verifyFailure = false;
  sendFailure = false;
  closed = false;

  async verify(): Promise<void> {
    if (this.verifyFailure) { throw new Error("private SMTP diagnostic"); }
  }

  async sendMail(message: Readonly<Record<string, unknown>>): Promise<void> {
    if (this.sendFailure) { throw new Error("private SMTP diagnostic"); }
    this.messages.push(message);
  }

  close(): void { this.closed = true; }
}

const origin = "https://mk8dx.example";
const link = `${origin}/api/auth/magic-link/verify?token=opaque%26token&callbackURL=%2F`;

describe("SMTP magic-link delivery", () => {
  it("sends a bounded one-time login message without loading remote content", async () => {
    const transport = new SyntheticTransport();
    const delivery = new SmtpMagicLinkDelivery(
      transport,
      "auth@mk8dx.example",
      origin,
    );

    await delivery.verify();
    await delivery.sendMagicLink({ email: "player@example.test", url: link });
    expect(transport.messages).toHaveLength(1);
    expect(transport.messages[0]).toMatchObject({
      from: "auth@mk8dx.example",
      to: "player@example.test",
      // Neither reader is guessed at when the runtime cannot say which it is.
      subject: "Your MK8DX link",
      disableFileAccess: true,
      disableUrlAccess: true,
    });
    const html = String(transport.messages[0]?.["html"]);
    expect(html).toContain("opaque%26token");
    expect(html).not.toContain("<script");
    // Branded, self-contained, and safe in an inbox that blocks images: no
    // remote stylesheet, font or picture may be referenced.
    expect(html).toContain("MK8DX&nbsp;TIME&nbsp;TRIALS");
    expect(html).not.toMatch(/<img|<link|@import|url\(/i);
    expect(String(transport.messages[0]?.["text"])).toContain("opaque%26token");
    delivery.close();
    expect(transport.closed).toBe(true);
  });

  it("welcomes a new arrival and signs a returning one back in", async () => {
    const transport = new SyntheticTransport();
    const delivery = new SmtpMagicLinkDelivery(
      transport,
      "auth@mk8dx.example",
      origin,
    );

    await delivery.sendMagicLink({
      email: "new@example.test", url: link, newAccount: true,
    });
    await delivery.sendMagicLink({
      email: "back@example.test", url: link, newAccount: false,
    });

    const [welcome, signIn] = transport.messages;
    expect(welcome?.["subject"]).toBe(
      "Welcome to MK8DX — finish setting up your account",
    );
    expect(String(welcome?.["html"])).toContain("Confirm and choose my name");
    expect(signIn?.["subject"]).toBe("Your MK8DX sign-in link");
    expect(String(signIn?.["html"])).toContain("Sign in");
    // Both state the lifetime, because an unexplained dead link is the
    // product's most common silent failure.
    for (const message of [welcome, signIn]) {
      expect(String(message?.["html"])).toContain("expires in 15 minutes");
    }
  });

  it("rejects another origin, route, recipient, or missing token", async () => {
    const delivery = new SmtpMagicLinkDelivery(
      new SyntheticTransport(),
      "auth@mk8dx.example",
      origin,
    );
    for (const message of [
      { email: "player@example.test", url: "https://evil.example/api/auth/magic-link/verify?token=x" },
      { email: "player@example.test", url: `${origin}/other?token=x` },
      { email: "bad mailbox", url: link },
      { email: "player@example.test", url: `${origin}/api/auth/magic-link/verify` },
    ]) {
      await expect(delivery.sendMagicLink(message)).rejects.toBeInstanceOf(
        SmtpMagicLinkDeliveryError,
      );
    }
  });

  it("sends bounded current- and new-mailbox account messages", async () => {
    const transport = new SyntheticTransport();
    const delivery = new SmtpMagicLinkDelivery(
      transport,
      "auth@mk8dx.example",
      origin,
    );
    const accountLink = `${origin}/api/auth/verify-email?token=opaque&callbackURL=%2F%3Fsettings%3D1`;

    await delivery.sendChangeEmailConfirmation({
      email: "current@example.test",
      url: accountLink,
    });
    await delivery.sendEmailVerification({
      email: "new@example.test",
      url: accountLink,
    });

    expect(transport.messages).toHaveLength(2);
    expect(transport.messages[0]).toMatchObject({
      to: "current@example.test",
      subject: "Confirm your MK8DX email change",
      disableFileAccess: true,
      disableUrlAccess: true,
    });
    expect(transport.messages[1]).toMatchObject({
      to: "new@example.test",
      subject: "Verify your new MK8DX email",
      disableFileAccess: true,
      disableUrlAccess: true,
    });
  });

  it("rejects non-verification account-email routes", async () => {
    const delivery = new SmtpMagicLinkDelivery(
      new SyntheticTransport(),
      "auth@mk8dx.example",
      origin,
    );
    await expect(delivery.sendChangeEmailConfirmation({
      email: "current@example.test",
      url: `${origin}/api/auth/change-email/confirm?token=opaque`,
    })).rejects.toBeInstanceOf(SmtpMagicLinkDeliveryError);
  });

  it("fails configuration and transport errors closed without private detail", async () => {
    expect(() => new SmtpMagicLinkDelivery(
      new SyntheticTransport(),
      "bad mailbox",
      origin,
    )).toThrow(SmtpMagicLinkConfigurationError);

    const transport = new SyntheticTransport();
    const delivery = new SmtpMagicLinkDelivery(
      transport,
      "auth@mk8dx.example",
      origin,
    );
    transport.verifyFailure = true;
    const readiness = await delivery.verify().catch((error: unknown) => error);
    expect(readiness).toBeInstanceOf(SmtpMagicLinkDeliveryError);
    expect(String(readiness)).not.toContain("private SMTP diagnostic");
    transport.verifyFailure = false;
    transport.sendFailure = true;
    const send = await delivery.sendMagicLink({
      email: "player@example.test",
      url: link,
    }).catch((error: unknown) => error);
    expect(send).toBeInstanceOf(SmtpMagicLinkDeliveryError);
    expect(String(send)).not.toContain("private SMTP diagnostic");
  });
  it("sends one native sign-in email with the code and the approval link", async () => {
    const transport = new SyntheticTransport();
    const delivery = new SmtpMagicLinkDelivery(transport, "noreply@mk8dx.example", origin);
    await delivery.sendNativeSignIn({
      email: "anna@example.test", code: "042917", url: `${origin}/?device-email=${"a".repeat(43)}`,
      userCode: "ABCD-EFGH", clientName: "LiveTrial for Windows", expiresInMinutes: 10,
    });
    const message = transport.messages[0]!;
    expect(message).toMatchObject({ to: "anna@example.test", subject: "042917 is your MK8DX sign-in code", disableUrlAccess: true, disableFileAccess: true });
    const html = String(message["html"]);
    expect(html).toContain("042917");
    expect(html).toContain("ABCD-EFGH");
    expect(html).toContain("device-email=");
    expect(html).not.toMatch(/<script|<img/i);
    expect(String(message["text"])).toContain("Your code: 042917");
  });

  it("refuses a native sign-in email with another origin, path or a malformed code", async () => {
    const delivery = new SmtpMagicLinkDelivery(new SyntheticTransport(), "noreply@mk8dx.example", origin);
    const good = {
      email: "anna@example.test", code: "042917", url: `${origin}/?device-email=${"a".repeat(43)}`,
      userCode: "ABCD-EFGH", clientName: "LiveTrial for Windows", expiresInMinutes: 10,
    };
    for (const message of [
      { ...good, url: `https://evil.example/?device-email=${"a".repeat(43)}` },
      { ...good, url: `${origin}/device?device-email=x` },
      { ...good, url: `${origin}/` },
      { ...good, code: "12345" },
      { ...good, userCode: "<b>" },
      { ...good, email: "not an address" },
    ]) {
      await expect(delivery.sendNativeSignIn(message)).rejects.toBeInstanceOf(SmtpMagicLinkDeliveryError);
    }
  });
});
