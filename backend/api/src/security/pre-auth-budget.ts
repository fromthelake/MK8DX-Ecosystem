import { createHmac } from "node:crypto";

import type { ClientAddressHeaders } from "./client-address.js";
import type { MutationRateLimiter } from "./mysql-mutation-rate-limiter.js";

/**
 * A request budget for routes that are reachable before the caller is known.
 *
 * The durable limiter (`MysqlMutationRateLimiter`) stores one row per subject and window. Keyed by
 * anything the caller chooses (a device value, a token prefix), a stream of rejected requests would
 * create a fresh row each time. This budget never uses caller-chosen material as the key: the
 * client address (resolved through the trusted-proxy rules in `client-address.ts`) is mapped with
 * a server-keyed HMAC onto a fixed number of slots. Whatever the caller sends, at most `slots` rows
 * exist per scope and window; the limiter's retention removes them afterwards. Clients that share
 * a slot share its budget, so the limit is set well above ordinary use (a tournament hall behind
 * one address included). The budget is shared by every API process because it lives in the
 * database.
 */
export const PRE_AUTH_DEFAULT_SLOTS = 1_024;
const MAXIMUM_SLOTS = 65_536;

export type PreAuthClientAddress = Readonly<{
  resolve(peerAddress: string | undefined, headers: ClientAddressHeaders): Promise<string | null>;
}>;

export type PreAuthRequest = Readonly<{
  headers: ClientAddressHeaders;
  raw: Readonly<{ socket?: Readonly<{ remoteAddress?: string | undefined }> | undefined }>;
}>;

export class PreAuthBudget {
  private readonly slots: number;

  public constructor(
    private readonly limiter: MutationRateLimiter,
    private readonly key: Buffer,
    private readonly clientAddress?: PreAuthClientAddress,
    slots: number = PRE_AUTH_DEFAULT_SLOTS,
  ) {
    if (key.length < 16) { throw new Error("pre-authentication budget key is too short"); }
    if (!Number.isSafeInteger(slots) || slots < 1 || slots > MAXIMUM_SLOTS) {
      throw new Error("pre-authentication slot count is invalid");
    }
    this.slots = slots;
  }

  /** The limiter subject for this request: a slot number, never an address or a header value. */
  public async subject(request: PreAuthRequest): Promise<string> {
    const peer = request.raw.socket?.remoteAddress;
    const address = this.clientAddress === undefined
      ? peer ?? null
      : await this.clientAddress.resolve(peer, request.headers);
    const digest = createHmac("sha256", this.key).update(address ?? "unknown", "utf8").digest();
    return `preauth-slot.${String(digest.readUInt32BE(0) % this.slots)}`;
  }

  /** Throws `MutationRateLimitExceeded` when this request's slot has used its budget. */
  public async consume(
    request: PreAuthRequest,
    scope: string,
    windowSeconds: number,
    maximum: number,
  ): Promise<void> {
    await this.limiter.consume(await this.subject(request), scope, windowSeconds, maximum);
  }
}

/** A budget key derived from the installation's auth secret, the same in every API process. */
export function derivePreAuthBudgetKey(secretBase64: string): Buffer {
  return createHmac("sha256", Buffer.from(secretBase64, "base64"))
    .update("mk8dx.pre-auth-budget.v1", "ascii").digest();
}
