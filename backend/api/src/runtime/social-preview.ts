// Server-rendered Open Graph metadata for shared links: WhatsApp,
// Facebook, and mail clients never run the SPA, so the "/" document is
// served with per-entity og tags derived from validated public data
// only. Never any private information; every value is HTML-escaped.

import { AVATAR_ICON_PATHS } from "./avatar-icon-manifest.js";
import { TRACK_SOCIAL } from "./track-social-manifest.js";

export type SocialPreviewDependencies = Readonly<{
  baseUrl: string;
  playerName(playerId: string): Promise<string | null>;
  playerAvatarId?(playerId: string): Promise<string | null>;
}>;

const playerIdPattern = /^player\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const trackIdPattern = /^track\.[a-z0-9]+(?:_[a-z0-9]+)*$/;

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function metaBlock(input: Readonly<{
  baseUrl: string;
  title: string;
  description: string;
  canonicalPath: string;
  imagePath?: string;
}>): string {
  const title = escapeHtml(input.title);
  const description = escapeHtml(input.description);
  const url = escapeHtml(`${input.baseUrl}${input.canonicalPath}`);
  const image = escapeHtml(
    `${input.baseUrl}/assets/${input.imagePath ?? "images/misc/site_background.jpg"}`,
  );
  return [
    `<meta property="og:site_name" content="MK8DX">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:title" content="${title}">`,
    `<meta property="og:description" content="${description}">`,
    `<meta property="og:url" content="${url}">`,
    `<meta property="og:image" content="${image}">`,
    `<meta name="description" content="${description}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<link rel="canonical" href="${url}">`,
  ].join("\n    ");
}

export async function socialPreviewMeta(
  query: Readonly<Record<string, unknown>>,
  dependencies: SocialPreviewDependencies,
): Promise<string> {
  const base = dependencies.baseUrl;
  const playerId = typeof query["player"] === "string" &&
    playerIdPattern.test(query["player"])
    ? query["player"]
    : null;
  if (playerId !== null) {
    const name = await dependencies.playerName(playerId).catch(() => null);
    if (name !== null) {
      const avatarId = await dependencies.playerAvatarId?.(playerId)
        .catch(() => null) ?? null;
      const avatarIcon = avatarId === null
        ? undefined
        : AVATAR_ICON_PATHS[avatarId];
      return metaBlock({
        baseUrl: base,
        title: `${name} — MK8DX`,
        description:
          "Time Trials, Track Mastery, rating, and career on the MK8DX " +
          "community platform.",
        canonicalPath: `/?player=${encodeURIComponent(playerId)}`,
        ...(avatarIcon === undefined ? {} : { imagePath: avatarIcon }),
      });
    }
  }
  const trackId = typeof query["leaderboard"] === "string" &&
    trackIdPattern.test(query["leaderboard"])
    ? query["leaderboard"]
    : null;
  if (trackId !== null) {
    const track = TRACK_SOCIAL[trackId];
    if (track !== undefined) {
      const mode = query["mode"] === "200" ? 200 : 150;
      return metaBlock({
        baseUrl: base,
        title: `${track.name} ${mode}cc — MK8DX leaderboard`,
        description:
          "Verified Time Trials with World Record and Nintendo Staff " +
          "reference times.",
        canonicalPath:
          `/?leaderboard=${encodeURIComponent(trackId)}&mode=${mode}`,
        imagePath: track.previewPath,
      });
    }
  }
  const compare = typeof query["compare"] === "string"
    ? query["compare"]
    : null;
  if (compare !== null) {
    const [first, second] = compare.split(",").slice(0, 2);
    if (first !== undefined && playerIdPattern.test(first) &&
        second !== undefined && playerIdPattern.test(second)) {
      const [nameA, nameB] = await Promise.all([
        dependencies.playerName(first).catch(() => null),
        dependencies.playerName(second).catch(() => null),
      ]);
      if (nameA !== null && nameB !== null) {
        return metaBlock({
          baseUrl: base,
          title: `${nameA} vs ${nameB} — MK8DX`,
          description:
            "Head-to-head Time Trial comparison across all 96 tracks.",
          canonicalPath: `/?compare=${encodeURIComponent(first)},${
            encodeURIComponent(second)}`,
        });
      }
    }
  }
  if (typeof query["build"] === "string") {
    return metaBlock({
      baseUrl: base,
      title: "MK8DX Build",
      description:
        "Character, body, tires, and glider with real in-game stats.",
      canonicalPath: "/?build=1",
    });
  }
  if (typeof query["ranking"] === "string") {
    return metaBlock({
      baseUrl: base,
      title: "MK8DX Ranking",
      description: "The public community skill ranking.",
      canonicalPath: "/?ranking=1",
    });
  }
  return metaBlock({
    baseUrl: base,
    title: "MK8DX Community",
    description:
      "Mario Kart 8 Deluxe Time Trials, Tournaments, Track Mastery, " +
      "rating, and rivalries.",
    canonicalPath: "/",
  });
}

export function injectSocialMeta(indexHtml: string, meta: string): string {
  const anchor = "</head>";
  const index = indexHtml.indexOf(anchor);
  if (index < 0) { return indexHtml; }
  return `${indexHtml.slice(0, index)}    ${meta}\n  ${
    indexHtml.slice(index)}`;
}
