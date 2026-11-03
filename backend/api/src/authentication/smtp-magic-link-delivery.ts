import nodemailer from "nodemailer";

import type {
  PasswordlessEmailDelivery,
  PasswordlessAccountEmail,
  PasswordlessMagicLink,
} from "./embedded-passwordless-auth.js";
import type { NativeEmailApprovalDelivery, NativeEmailSignIn } from "./native-email-approval.js";

const hostnamePattern = /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/;
const mailboxPattern = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/;

export class SmtpMagicLinkConfigurationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "SmtpMagicLinkConfigurationError";
  }
}

export class SmtpMagicLinkDeliveryError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "SmtpMagicLinkDeliveryError";
  }
}

export type SmtpMagicLinkConfig = Readonly<{
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
  fromAddress: string;
  allowedLinkOrigin: string;
  localDemo?: boolean;
}>;

export interface SmtpMagicLinkTransport {
  verify(): Promise<unknown>;
  sendMail(message: Readonly<Record<string, unknown>>): Promise<unknown>;
  close(): void;
}

function exactLinkOrigin(value: string, localDemo = false): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new SmtpMagicLinkConfigurationError("magic-link origin is invalid");
  }
  if (!(parsed.protocol === "https:" || (localDemo && parsed.protocol === "http:" &&
      ["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname))) || parsed.pathname !== "/" ||
    parsed.username.length > 0 || parsed.password.length > 0 ||
    parsed.search.length > 0 || parsed.hash.length > 0) {
    throw new SmtpMagicLinkConfigurationError("magic-link origin is invalid");
  }
  return parsed.origin;
}

function validate(config: SmtpMagicLinkConfig): SmtpMagicLinkConfig {
  if (!hostnamePattern.test(config.host) ||
    !Number.isSafeInteger(config.port) || config.port < 1 || config.port > 65535 ||
    (!config.localDemo && (config.username.length < 1 || config.password.length < 1)) ||
    config.username.length > 320 || config.password.length > 1024 ||
    !mailboxPattern.test(config.fromAddress) || config.fromAddress.length > 320) {
    throw new SmtpMagicLinkConfigurationError("SMTP configuration is invalid");
  }
  return { ...config, allowedLinkOrigin: exactLinkOrigin(config.allowedLinkOrigin, config.localDemo) };
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * One branded shell for every transactional MK8DX email.
 *
 * Table layout with inline styles only: no stylesheet, no web font and no
 * remote image survives the common mail clients, and `disableUrlAccess`
 * forbids the transport from fetching anything anyway. The wordmark is
 * therefore type, not an image, so the message renders the same in an inbox
 * that blocks images.
 */
function emailShell(parts: Readonly<{
  preheader: string;
  heading: string;
  intro: string;
  action: string;
  url: string;
  afterAction: string;
  footer: string;
  code?: string;
}>): string {
  const url = escapeHtml(parts.url);
  // A one-time code a person types elsewhere: large, spaced and selectable.
  const codeBlock = parts.code === undefined ? "" : [
    '<tr><td style="padding:20px 32px 0;">',
    '<div style="display:inline-block;padding:12px 20px;border-radius:8px;',
    'border:1px dashed #e8912b;font-family:Consolas,Menlo,monospace;',
    'font-size:30px;font-weight:700;letter-spacing:.3em;color:#f2f2f5;">',
    escapeHtml(parts.code), '</div></td></tr>',
  ].join("");
  return [
    '<!doctype html><html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    `<title>${escapeHtml(parts.heading)}</title></head>`,
    '<body style="margin:0;padding:0;background:#101014;">',
    '<div style="display:none;max-height:0;overflow:hidden;opacity:0;">',
    escapeHtml(parts.preheader),
    '</div>',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" ',
    'border="0" style="background:#101014;padding:32px 16px;"><tr>',
    '<td align="center">',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" ',
    'border="0" style="max-width:520px;background:#1a1b22;border-radius:12px;',
    'border:1px solid #2b2d37;">',
    '<tr><td style="padding:28px 32px 0;font-family:Helvetica,Arial,sans-serif;',
    'font-size:13px;font-weight:700;letter-spacing:.16em;color:#e8912b;">',
    'MK8DX&nbsp;TIME&nbsp;TRIALS</td></tr>',
    '<tr><td style="padding:14px 32px 0;font-family:Helvetica,Arial,sans-serif;',
    'font-size:24px;line-height:1.25;font-weight:700;color:#f2f2f5;">',
    escapeHtml(parts.heading), '</td></tr>',
    '<tr><td style="padding:14px 32px 0;font-family:Helvetica,Arial,sans-serif;',
    'font-size:15px;line-height:1.6;color:#b9bbc6;">',
    escapeHtml(parts.intro), '</td></tr>',
    codeBlock,
    '<tr><td style="padding:26px 32px 0;">',
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0">',
    '<tr><td style="border-radius:8px;background:#e8912b;">',
    `<a href="${url}" style="display:inline-block;padding:13px 26px;`,
    'font-family:Helvetica,Arial,sans-serif;font-size:15px;font-weight:700;',
    'color:#17181d;text-decoration:none;border-radius:8px;">',
    escapeHtml(parts.action), '</a></td></tr></table></td></tr>',
    '<tr><td style="padding:20px 32px 0;font-family:Helvetica,Arial,sans-serif;',
    'font-size:14px;line-height:1.6;color:#b9bbc6;">',
    escapeHtml(parts.afterAction), '</td></tr>',
    '<tr><td style="padding:20px 32px 0;font-family:Helvetica,Arial,sans-serif;',
    'font-size:12px;line-height:1.6;color:#7c7f8c;">',
    'If the button does not work, copy this address into your browser:<br>',
    `<span style="color:#9fa2ae;word-break:break-all;">${url}</span></td></tr>`,
    '<tr><td style="padding:22px 32px 28px;',
    'font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:1.6;',
    'color:#6c6f7b;border-top:1px solid #2b2d37;">',
    escapeHtml(parts.footer), '</td></tr>',
    '</table></td></tr></table></body></html>',
  ].join("");
}

function emailPlainText(parts: Readonly<{
  heading: string;
  intro: string;
  url: string;
  afterAction: string;
  footer: string;
}>): string {
  return `${parts.heading}\n\n${parts.intro}\n\n${parts.url}\n\n` +
    `${parts.afterAction}\n\n${parts.footer}\n`;
}

export class SmtpMagicLinkDelivery implements PasswordlessEmailDelivery, NativeEmailApprovalDelivery {
  private readonly allowedLinkOrigin: string;

  public constructor(
    private readonly transport: SmtpMagicLinkTransport,
    private readonly fromAddress: string,
    allowedLinkOrigin: string,
    localDemo = false,
  ) {
    if (!mailboxPattern.test(fromAddress) || fromAddress.length > 320) {
      throw new SmtpMagicLinkConfigurationError("SMTP sender is invalid");
    }
    this.allowedLinkOrigin = exactLinkOrigin(allowedLinkOrigin, localDemo);
  }

  public async verify(): Promise<void> {
    try {
      await this.transport.verify();
    } catch {
      throw new SmtpMagicLinkDeliveryError("SMTP readiness check failed");
    }
  }

  public async sendMagicLink(message: PasswordlessMagicLink): Promise<void> {
    let link: URL;
    try {
      link = new URL(message.url);
    } catch {
      throw new SmtpMagicLinkDeliveryError("magic-link message is invalid");
    }
    if (!mailboxPattern.test(message.email) || message.email.length > 320 ||
      link.origin !== this.allowedLinkOrigin ||
      link.pathname !== "/api/auth/magic-link/verify" ||
      link.searchParams.get("token") === null) {
      throw new SmtpMagicLinkDeliveryError("magic-link message is invalid");
    }
    const url = link.toString();
    // A first-time registration and a returning sign-in are different events
    // for the reader, so they are different messages. `newAccount` is left
    // undefined when the runtime cannot tell; the wording then has to be true
    // either way rather than guessing.
    const copy = message.newAccount === true
      ? {
        subject: "Welcome to MK8DX \u2014 finish setting up your account",
        preheader: "Confirm your email, then pick the name you race under.",
        heading: "Welcome to MK8DX",
        intro: "You are one click away. Confirm this address and you can " +
          "choose the name you race under, then start recording your Time " +
          "Trials straight away.",
        action: "Confirm and choose my name",
      }
      : message.newAccount === false
        ? {
          subject: "Your MK8DX sign-in link",
          preheader: "One-time link to sign in. Expires in 15 minutes.",
          heading: "Sign in to MK8DX",
          intro: "Use the button below to sign in. Everything is where you " +
            "left it.",
          action: "Sign in",
        }
        : {
          subject: "Your MK8DX link",
          preheader: "One-time link to continue. Expires in 15 minutes.",
          heading: "Continue to MK8DX",
          intro: "Use the button below to continue to MK8DX. If you do not " +
            "have an account yet, this creates one for you.",
          action: "Continue to MK8DX",
        };
    const parts = {
      ...copy,
      url,
      afterAction: "This link works once and expires in 15 minutes. Need a " +
        "new one? Ask for another from the sign-in page.",
      footer: "You are receiving this because this address was entered on " +
        `${link.host}. If that was not you, ignore this email \u2014 ` +
        "nothing happens until the link is opened.",
    };
    try {
      await this.transport.sendMail({
        from: this.fromAddress,
        to: message.email,
        subject: copy.subject,
        text: emailPlainText(parts),
        html: emailShell(parts),
        disableFileAccess: true,
        disableUrlAccess: true,
      });
    } catch {
      throw new SmtpMagicLinkDeliveryError("magic-link delivery failed");
    }
  }

  private async sendAccountMessage(
    message: PasswordlessAccountEmail,
    kind: "verify" | "confirm",
  ): Promise<void> {
    let link: URL;
    try { link = new URL(message.url); } catch {
      throw new SmtpMagicLinkDeliveryError("account email message is invalid");
    }
    // Better Auth uses the same token-verification endpoint for both the
    // current-mailbox confirmation and the new-mailbox verification steps.
    const allowedPath = link.pathname === "/api/auth/verify-email";
    if (!mailboxPattern.test(message.email) || message.email.length > 320 ||
        link.origin !== this.allowedLinkOrigin || !allowedPath ||
        link.searchParams.get("token") === null) {
      throw new SmtpMagicLinkDeliveryError("account email message is invalid");
    }
    const url = link.toString();
    const verify = kind === "verify";
    const subject = verify ? "Verify your new MK8DX email" : "Confirm your MK8DX email change";
    const action = verify ? "Verify new email" : "Confirm email change";
    const heading = verify ? "Verify your new email" : "Confirm your email change";
    const explanation = verify
      ? "Verify this address to complete your MK8DX account email change."
      : "Confirm that you want to move your MK8DX account to a new email address.";
    const parts = {
      preheader: explanation, heading, intro: explanation, action, url,
      afterAction: "This link works once and expires shortly.",
      footer: "If you did not request this, ignore this email \u2014 your " +
        "account keeps its current address.",
    };
    try {
      await this.transport.sendMail({
        from: this.fromAddress, to: message.email, subject,
        text: emailPlainText(parts),
        html: emailShell(parts),
        disableFileAccess: true, disableUrlAccess: true,
      });
    } catch { throw new SmtpMagicLinkDeliveryError("account email delivery failed"); }
  }

  /** Sign a native client in: one link and one code, either one works once. */
  public async sendNativeSignIn(message: NativeEmailSignIn): Promise<void> {
    let link: URL;
    try { link = new URL(message.url); } catch {
      throw new SmtpMagicLinkDeliveryError("native sign-in message is invalid");
    }
    if (!mailboxPattern.test(message.email) || message.email.length > 320 ||
        link.origin !== this.allowedLinkOrigin || link.pathname !== "/" ||
        link.searchParams.get("device-email") === null ||
        !/^[0-9]{6}$/.test(message.code) ||
        !/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(message.userCode)) {
      throw new SmtpMagicLinkDeliveryError("native sign-in message is invalid");
    }
    const minutes = message.expiresInMinutes;
    const parts = {
      preheader: `Your code is ${message.code}. Or use the button to approve ${message.clientName}.`,
      heading: `Sign in ${message.clientName}`,
      intro: `Type this code in ${message.clientName}, or use the button to approve it. ` +
        `The app shows the code ${message.userCode} on its screen.`,
      code: message.code,
      action: "Approve this sign-in",
      url: link.toString(),
      afterAction: `The code and the button work once and expire in ${minutes} minutes. ` +
        "Only approve if you just asked to sign in on your own device and it shows " +
        `${message.userCode}.`,
      footer: "You are receiving this because this address was entered in an MK8DX app. " +
        "If that was not you, ignore this email \u2014 nothing happens without the code or the button.",
    };
    try {
      await this.transport.sendMail({
        from: this.fromAddress, to: message.email,
        subject: `${message.code} is your MK8DX sign-in code`,
        text: `${parts.heading}\n\nYour code: ${message.code}\n\n${parts.intro}\n\n${parts.url}\n\n` +
          `${parts.afterAction}\n\n${parts.footer}\n`,
        html: emailShell(parts),
        disableFileAccess: true, disableUrlAccess: true,
      });
    } catch { throw new SmtpMagicLinkDeliveryError("native sign-in delivery failed"); }
  }

  public async sendEmailVerification(message: PasswordlessAccountEmail): Promise<void> {
    await this.sendAccountMessage(message, "verify");
  }

  public async sendChangeEmailConfirmation(message: PasswordlessAccountEmail): Promise<void> {
    await this.sendAccountMessage(message, "confirm");
  }

  public close(): void {
    this.transport.close();
  }
}

export function createSmtpMagicLinkDelivery(
  config: SmtpMagicLinkConfig,
): SmtpMagicLinkDelivery {
  const validated = validate(config);
  const transport = nodemailer.createTransport({
    host: validated.host,
    port: validated.port,
    secure: validated.secure,
    requireTLS: !validated.secure && !validated.localDemo,
    ...(validated.localDemo && !validated.username && !validated.password ? {} : {
      auth: { user: validated.username, pass: validated.password },
    }),
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  return new SmtpMagicLinkDelivery(
    transport,
    validated.fromAddress,
    validated.allowedLinkOrigin,
    validated.localDemo,
  );
}
