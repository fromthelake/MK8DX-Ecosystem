// The Player's YouTube video of a run (owner 2026-09-28), checked in the page the way the API checks
// it (backend/api/src/timetrials/youtube-video.ts), so a wrong link is said before anything is sent.

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be", "www.youtu.be"]);

/** The video id of a YouTube link, or null when it is not one. */
export function youTubeVideoId(value: string): string | null {
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

/** "" (no video) is fine; anything else must be a YouTube link. */
export function videoLinkProblem(value: string, language: "en" | "nl"): string | null {
  if (value.trim() === "" || youTubeVideoId(value) !== null) { return null; }
  return language === "nl"
    ? "Plak een link naar de YouTube-video, bijvoorbeeld https://youtu.be/…"
    : "Paste a link to the YouTube video, for example https://youtu.be/…";
}
