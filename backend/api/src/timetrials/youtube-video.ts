// A Player's YouTube video of their own run (migration 0071, owner 2026-09-28).
//
// Only YouTube, and only the video itself: whatever form of link a person pastes, the eleven-
// character video id is taken out of it and every later use rebuilds one canonical link. Tracking
// parameters, playlists, other sites and anything else are never stored or shown.

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be", "www.youtu.be"]);

/** The video id of a YouTube link, or null when it is not one. */
export function youTubeVideoId(value: unknown): string | null {
  if (typeof value !== "string") { return null; }
  const text = value.trim();
  if (text.length === 0 || text.length > 512) { return null; }
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username !== "" || url.password !== "") {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (!HOSTS.has(host)) { return null; }
  const segments = url.pathname.split("/").filter((segment) => segment !== "");
  let id: string | null = null;
  if (host.endsWith("youtu.be")) {
    id = segments.length === 1 ? segments[0]! : null;
  } else if (segments.length === 1 && segments[0] === "watch") {
    id = url.searchParams.get("v");
  } else if (segments.length === 2 && ["shorts", "live", "embed", "v"].includes(segments[0]!)) {
    id = segments[1]!;
  }
  return id !== null && VIDEO_ID.test(id) ? id : null;
}

export function youTubeWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}
