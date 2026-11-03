// The header's "signed in as" chip, remembered between page loads.
//
// Resolving it costs two requests - the claim set, then the Player - and the
// header did that in the opening burst of every page, taking two of the five
// slots the host allows per second before any page content moved. Who you are
// signed in as is the most stable fact the page knows, so it is kept here and
// the truth is re-read once the page's own data has settled.
//
// This is deliberately its own module with its own name. It holds only what
// the header already shows in public - the Player's username, display name and
// chosen character - and never the account, the email, a session or a token.
// It is not a local mirror of identity: nothing reads it to decide what the
// viewer may do, and every page still asks the server who the viewer is.

const STORAGE_KEY = "mk8dx.nav-identity.v1";

export type NavIdentity = Readonly<{
  username: string;
  displayName: string;
  avatarId?: string;
}>;

export function readNavIdentity(): NavIdentity | null {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (raw === null || raw === undefined) { return null; }
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) { return null; }
    const row = value as Record<string, unknown>;
    const username = row["username"];
    const displayName = row["displayName"];
    const avatarId = row["avatarId"];
    if (typeof username !== "string" || typeof displayName !== "string" ||
      username.length === 0 || username.length > 64 ||
      displayName.length === 0 || displayName.length > 64) { return null; }
    return {
      username,
      displayName,
      ...(typeof avatarId === "string" && avatarId.length <= 64 ? { avatarId } : {}),
    };
  } catch { return null; }
}

export function rememberNavIdentity(identity: NavIdentity): void {
  try { globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(identity)); }
  catch { /* a browser that refuses storage simply resolves every time */ }
}

export function forgetNavIdentity(): void {
  try { globalThis.localStorage?.removeItem(STORAGE_KEY); } catch { /* as above */ }
}
