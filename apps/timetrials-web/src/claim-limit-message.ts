// What a person reads when the server's claim limits answer (H1): 429 claim_rate_limited with
// Retry-After, or 409 claim_quota_exceeded. Every claim screen uses the same words.
import { PlayerClaimClientError } from "./player-claim-client.js";
import { localized } from "./product-language.js";

/** The friendly text for a claim limit, or null when the error is something else. */
export function claimLimitMessage(error: unknown): string | null {
  if (!(error instanceof PlayerClaimClientError)) { return null; }
  if (error.code === "quota_exceeded") {
    return localized(
      "You have reached the limit for Player claims. Wait until a waiting claim has been handled, or withdraw one, and try again.",
      "Je hebt de limiet voor spelersclaims bereikt. Wacht tot een openstaande claim is afgehandeld, of trek er een in, en probeer het opnieuw.",
    );
  }
  if (error.code !== "rate_limited") { return null; }
  const seconds = error.retryAfterSeconds;
  if (seconds === null) {
    return localized(
      "Too many claim actions at the moment. Please try again later.",
      "Te veel claimacties op dit moment. Probeer het later opnieuw.",
    );
  }
  const minutes = Math.ceil(seconds / 60);
  if (minutes <= 1) {
    return localized(
      "Too many claim actions at the moment. Please try again in a minute.",
      "Te veel claimacties op dit moment. Probeer het over een minuut opnieuw.",
    );
  }
  if (minutes <= 90) {
    return localized(
      `Too many claim actions at the moment. Please try again in ${minutes} minutes.`,
      `Te veel claimacties op dit moment. Probeer het over ${minutes} minuten opnieuw.`,
    );
  }
  const hours = Math.ceil(minutes / 60);
  return localized(
    `Too many claim actions at the moment. Please try again in ${hours} hours.`,
    `Te veel claimacties op dit moment. Probeer het over ${hours} uur opnieuw.`,
  );
}
