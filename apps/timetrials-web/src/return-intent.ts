// One typed, allow-listed return-intent contract for every authentication
// entry point (ADR-0180 follow-up, 2026-08-30).
//
// Signing in is never the goal; it interrupts one. Whoever offers a sign-in
// control records where the person was going as a `return` query parameter,
// the magic-link callback carries it, and after authentication (and, for a
// new account, after onboarding) the person lands back on that destination.
//
// The contract is deliberately closed: a return destination is a same-origin
// product route rebuilt from parsed, allow-listed query keys — never a raw
// string echoed back into navigation. Anything else resolves to `null`, and
// `null` means the safe default (Home). This is what keeps the mechanism from
// becoming an open redirect or a query-injection channel.

/** Query parameter that carries a validated product destination. */
export const RETURN_INTENT_PARAM = "return";

/**
 * Product routes a sign-in may return to. Authentication surfaces themselves
 * (`signin`, `welcome`, `authError`) and the carrier parameter are excluded so
 * an intent can never loop back into the sign-in flow.
 */
const allowedQueryKeys: ReadonlySet<string> = new Set([
  "cups", "ranking", "records", "build", "community",
  "tournaments", "operate", "director", "tournament", "night-report",
  "player", "tab", "compare",
  "leaderboard", "mode",
  "apps", "settings", "notifications", "mystats", "activity", "admin",
]);

const forbiddenCharacters = /[\u0000-\u0020\u007f"#'<>\\]/;
const userCodePattern = /^[A-Za-z0-9-]{4,32}$/;
const valuePattern = /^[A-Za-z0-9._,-]{0,128}$/;

/**
 * Validates a candidate return destination and rebuilds it from its parsed
 * parts. Returns the canonical same-origin path, or `null` when the candidate
 * is not an allow-listed product route (including `/`, which is already the
 * default landing and needs no carrier).
 */
export function sanitizeReturnIntent(
  raw: string | null | undefined,
): string | null {
  if (typeof raw !== "string" || raw.length < 2 || raw.length > 600 ||
    forbiddenCharacters.test(raw) ||
    !raw.startsWith("/") || raw.startsWith("//")) {
    return null;
  }
  if (raw.startsWith("/device")) {
    // The device-approval page is the one non-SPA route: it may carry exactly
    // its prefilled user code and nothing else.
    if (raw === "/device") { return "/device"; }
    if (!raw.startsWith("/device?")) { return null; }
    const entries = [...new URLSearchParams(raw.slice("/device?".length))];
    if (entries.length !== 1) { return null; }
    const [key, value] = entries[0]!;
    if (key !== "user_code" || !userCodePattern.test(value)) { return null; }
    return `/device?user_code=${value}`;
  }
  if (!raw.startsWith("/?")) { return null; }
  const rebuilt = new URLSearchParams();
  let keys = 0;
  for (const [key, value] of new URLSearchParams(raw.slice(2))) {
    if (!allowedQueryKeys.has(key) || !valuePattern.test(value)) {
      return null;
    }
    rebuilt.append(key, value);
    keys += 1;
  }
  if (keys === 0 || keys > 6) { return null; }
  return `/?${rebuilt.toString()}`;
}

/**
 * The return intent expressed by the current address: a sign-in or link-error
 * route hands its carried `return` through; any other product route is itself
 * the place to come back to.
 */
export function returnIntentFromSearch(search: string): string | null {
  const query = new URLSearchParams(
    search.startsWith("?") ? search.slice(1) : search,
  );
  if (query.get("signin") !== null || query.get("authError") !== null ||
    query.get("welcome") !== null) {
    return sanitizeReturnIntent(query.get(RETURN_INTENT_PARAM));
  }
  return sanitizeReturnIntent(`/?${query.toString()}`);
}

/** The focused sign-in route, carrying the given destination when one exists. */
export function signInHref(intent: string | null): string {
  return intent === null
    ? "/?signin=1"
    : `/?signin=1&${RETURN_INTENT_PARAM}=${encodeURIComponent(intent)}`;
}

/** Appends a validated destination to a fixed callback route. */
export function withReturnIntent(base: string, intent: string | null): string {
  return intent === null
    ? base
    : `${base}&${RETURN_INTENT_PARAM}=${encodeURIComponent(intent)}`;
}
