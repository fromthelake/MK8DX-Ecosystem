import type { AbuseBudgets } from "../security/abuse-budgets.js";
import { recipientSubject } from "../security/abuse-budgets.js";
import type { PreAuthBudget, PreAuthRequest } from "../security/pre-auth-budget.js";

/** The recipient as the budget counts it: trimmed and lower-cased, or null when it is no address. */
export function budgetRecipient(value: unknown): string | null {
  if (typeof value !== "string") { return null; }
  const email = value.trim().toLowerCase();
  return email.length >= 3 && email.length <= 320 && email.includes("@") ? email : null;
}

/**
 * Durable budgets for the requests that send mail or start an app sign-in before anybody is signed
 * in (H1). Better Auth keeps its own per-address limits (`embedded-passwordless-auth.ts`); these
 * add what it does not have:
 *
 * - per client address, through the fixed pre-authentication slots, shared by all API processes;
 * - for the whole installation, so many addresses together cannot exhaust the mail server or create
 *   accounts without bound;
 * - per recipient (a server-keyed digest of the normalized address), so nobody can bury one inbox
 *   in sign-in mail from many addresses.
 *
 * Address first, installation second, recipient last: a recipient counter is only created by a
 * request the installation budget admitted, so invented addresses cannot create unbounded rows.
 * None of the answers depends on whether an account exists.
 */
export class AuthEmailBudgets {
  public constructor(
    private readonly budgets: AbuseBudgets,
    private readonly preAuth: PreAuthBudget,
    private readonly recipientKey: Buffer,
  ) {
    if (recipientKey.length < 16) { throw new Error("recipient budget key is too short"); }
  }

  /** Throws `MutationRateLimitExceeded` when a sign-in, verification or change-of-address mail must wait. */
  public async email(request: PreAuthRequest, normalizedEmail: string | null): Promise<void> {
    const perAddress = this.budgets.settings.authEmailsPerAddressPerHour;
    await this.preAuth.consume(request, "auth-email.address", perAddress.windowSeconds, perAddress.maximum);
    await this.budgets.installation("auth-email", "authEmailsPerHour", "authEmailsPerDay");
    if (normalizedEmail !== null) {
      await this.budgets.target(recipientSubject(this.recipientKey, normalizedEmail), "auth-email.recipient",
        "authEmailsPerRecipientPerHour", "authEmailsPerRecipientPerDay");
    }
  }

  /** Throws `MutationRateLimitExceeded` when no new app sign-in code may be started now. */
  public async deviceCode(request: PreAuthRequest): Promise<void> {
    const perAddress = this.budgets.settings.deviceCodesPerAddressPerHour;
    await this.preAuth.consume(request, "device-code.address", perAddress.windowSeconds, perAddress.maximum);
    await this.budgets.installation("device-code", "deviceCodesPerHour");
  }
}
