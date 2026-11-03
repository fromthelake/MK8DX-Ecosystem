// Share a run as a picture (owner 2026-09-29: "Why not immediately add the cup, track, cc image ...
// character, body, tire, glider, mushroom, coins. I think it's better for engagement than plain old
// boring text"). The picture is the message; the text beside it names the run and carries the link
// that opens it on the leaderboard (`&run=`, ADR-0199). Android draws the same card
// (AndroidRunShareCard.kt); change one and change the other.

import { GAME_ASSET_BASE } from "./asset-manifest.js";
import { schema9WebTrackCatalog } from "./schema9-track-catalog.js";
import { runCode } from "./short-links.js";

export type RunShareLap = Readonly<{ lapNumber: number; timeMs: number; coins?: number; mushrooms?: number }>;
export type RunSharePart = Readonly<{ name: string; iconPath: string }>;

export type RunShareModel = Readonly<{
  trackId: string;
  trackName: string;
  cupName: string;
  cupIconPath: string | null;
  trackPreviewPath: string | null;
  mode: 150 | 200;
  playerName: string;
  rank: number | null;
  timeMs: number;
  parts: readonly RunSharePart[];
  laps: readonly RunShareLap[];
  coinIconPath: string;
  mushroomIconPath: string;
  url: string;
}>;

/** The link a shared run carries: that leaderboard, with that run's Details open. Short where it can
 *  be (ADR-0199): the track's catalog index and the run's 8-character code. */
export function runShareUrl(origin: string, trackId: string, mode: 150 | 200, resultId: string): string {
  const index = schema9WebTrackCatalog.find((entry) => entry.id === trackId)?.index;
  const board = index === undefined ? `leaderboard=${encodeURIComponent(trackId)}` : `lb=${index}`;
  const code = runCode(resultId);
  return `${origin}/?${board}&mode=${mode}&run=${encodeURIComponent(code.length === 8 ? code : resultId)}`;
}

export function formatRunTime(timeMs: number): string {
  const minutes = Math.floor(timeMs / 60_000);
  const seconds = Math.floor((timeMs % 60_000) / 1_000);
  return `${minutes}:${String(seconds).padStart(2, "0")}.${String(timeMs % 1_000).padStart(3, "0")}`;
}

/** The words beside the picture: who, where, which class, the time and place, and the link. */
export function runShareText(model: RunShareModel): string {
  const place = model.rank === null ? "" : ` (#${model.rank})`;
  return `${model.playerName} · ${model.trackName} ${model.mode}cc · ${formatRunTime(model.timeMs)}${place}\n${model.url}`;
}

export function runShareFileName(model: RunShareModel): string {
  const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `mk8dx-${slug(model.trackName)}-${model.mode}cc-${slug(model.playerName)}.png`;
}

// ----------------------------------------------------------------- drawing (logical px, drawn at 2x)

export const RUN_SHARE_WIDTH = 540;
export const RUN_SHARE_SCALE = 2;
const HEADER = 236;
const LAP_ROW = 30;
const COLORS = {
  page: "#0e1422", card: "#161e33", line: "#2a3552", text: "#eef1fa", muted: "#9aa3bd",
  e150: "#2f6fe0", e200: "#d2334a", gold: "#f5b301", silver: "#c0c7d4", bronze: "#cd7f32",
} as const;

/** The card's height for this many laps. */
export function runShareHeight(lapCount: number): number {
  return HEADER + 96 + 132 + (lapCount === 0 ? 0 : 36 + lapCount * LAP_ROW) + 56;
}

function font(size: number, weight: number, mono = false): string {
  return `${weight >= 700 ? "bold" : "normal"} ${size}px ${mono ? "ui-monospace, Menlo, Consolas, monospace" : "system-ui, sans-serif"}`;
}

function text(context: CanvasRenderingContext2D, value: string, x: number, y: number, size: number, weight: number,
  color: string, align: CanvasTextAlign = "left", mono = false): void {
  context.font = font(size, weight, mono);
  context.fillStyle = color;
  context.textAlign = align;
  context.fillText(value, x, y);
  context.textAlign = "left";
}

function fit(context: CanvasRenderingContext2D, value: string, maxWidth: number, size: number, weight: number): string {
  context.font = font(size, weight);
  if (context.measureText(value).width <= maxWidth) { return value; }
  let cut = value;
  while (cut.length > 1 && context.measureText(`${cut}…`).width > maxWidth) { cut = cut.slice(0, -1); }
  return `${cut}…`;
}

/** Draws an image contained in (or covering) a box, keeping its proportions. */
function image(context: CanvasRenderingContext2D, source: CanvasImageSource | undefined, x: number, y: number,
  width: number, height: number, cover = false): void {
  if (source === undefined) { return; }
  const natural = source as { naturalWidth?: number; naturalHeight?: number; width?: number; height?: number };
  const sourceWidth = Number(natural.naturalWidth ?? natural.width ?? width) || width;
  const sourceHeight = Number(natural.naturalHeight ?? natural.height ?? height) || height;
  const scale = cover ? Math.max(width / sourceWidth, height / sourceHeight) : Math.min(width / sourceWidth, height / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  context.save();
  context.beginPath();
  context.rect(x, y, width, height);
  context.clip();
  context.drawImage(source, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight);
  context.restore();
}

/** Every picture the card uses, so the caller loads them before drawing. */
export function runShareImagePaths(model: RunShareModel): readonly string[] {
  return [
    model.trackPreviewPath, model.cupIconPath, model.coinIconPath, model.mushroomIconPath,
    ...model.parts.map((part) => part.iconPath),
  ].filter((path): path is string => path !== null && path.length > 0);
}

export function renderRunShareCard(
  document: Document,
  model: RunShareModel,
  images: ReadonlyMap<string, CanvasImageSource>,
): HTMLCanvasElement | null {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (context === null) { return null; }
  const width = RUN_SHARE_WIDTH;
  const height = runShareHeight(model.laps.length);
  canvas.width = width * RUN_SHARE_SCALE;
  canvas.height = height * RUN_SHARE_SCALE;
  context.scale(RUN_SHARE_SCALE, RUN_SHARE_SCALE);
  context.textBaseline = "alphabetic";
  context.fillStyle = COLORS.page;
  context.fillRect(0, 0, width, height);

  // The track across the top, darkened towards its name.
  image(context, images.get(model.trackPreviewPath ?? ""), 0, 0, width, HEADER, true);
  const shade = context.createLinearGradient(0, HEADER * 0.35, 0, HEADER);
  shade.addColorStop(0, "rgba(14,20,34,0)");
  shade.addColorStop(1, "rgba(14,20,34,0.92)");
  context.fillStyle = shade;
  context.fillRect(0, 0, width, HEADER);
  image(context, images.get(model.cupIconPath ?? ""), 18, 16, 52, 52);
  // The engine class, as the product marks it: one chevron for 150cc, two for 200cc.
  const badge = model.mode === 200 ? COLORS.e200 : COLORS.e150;
  context.fillStyle = badge;
  context.beginPath();
  context.roundRect(width - 118, 18, 100, 34, 6);
  context.fill();
  text(context, `${model.mode === 200 ? "»" : "›"} ${model.mode}cc`, width - 68, 42, 18, 700, "#ffffff", "center");
  text(context, fit(context, model.trackName, width - 40, 28, 700), 20, HEADER - 34, 28, 700, COLORS.text);
  text(context, model.cupName, 20, HEADER - 12, 15, 400, COLORS.muted);

  // Who drove it, the place and the time.
  let y = HEADER + 20;
  context.fillStyle = COLORS.card;
  context.fillRect(0, HEADER, width, 96);
  const rankColor = model.rank === 1 ? COLORS.gold : model.rank === 2 ? COLORS.silver : model.rank === 3 ? COLORS.bronze : COLORS.muted;
  if (model.rank !== null) { text(context, `#${model.rank}`, 20, y + 30, 24, 700, rankColor, "left", true); }
  const nameX = model.rank === null ? 20 : 90;
  text(context, fit(context, model.playerName, 200, 24, 700), nameX, y + 30, 24, 700, COLORS.text);
  text(context, formatRunTime(model.timeMs), width - 20, y + 36, 40, 700, COLORS.text, "right", true);
  y = HEADER + 96;

  // The kart setup: each part's picture with its name under it.
  context.fillStyle = COLORS.line;
  context.fillRect(20, y, width - 40, 1);
  const column = (width - 40) / 4;
  model.parts.slice(0, 4).forEach((part, index) => {
    const centre = 20 + column * index + column / 2;
    image(context, images.get(part.iconPath), centre - 32, y + 14, 64, 64);
    text(context, fit(context, part.name, column - 8, 13, 400), centre, y + 104, 13, 400, COLORS.muted, "center");
  });
  if (model.parts.length === 0) { text(context, "Kart setup not recorded", width / 2, y + 70, 14, 400, COLORS.muted, "center"); }
  y += 132;

  // The laps, with the coins gained and mushrooms used named by their pictures.
  if (model.laps.length > 0) {
    context.fillStyle = COLORS.line;
    context.fillRect(20, y, width - 40, 1);
    const coinX = 330;
    const mushroomX = 440;
    text(context, "Lap", 24, y + 24, 13, 700, COLORS.muted);
    image(context, images.get(model.coinIconPath), coinX - 11, y + 8, 22, 22);
    image(context, images.get(model.mushroomIconPath), mushroomX - 11, y + 8, 22, 22);
    y += 36;
    for (const lap of model.laps) {
      text(context, String(lap.lapNumber), 30, y + 20, 16, 700, COLORS.muted, "left", true);
      text(context, formatRunTime(lap.timeMs), 80, y + 20, 18, 400, COLORS.text, "left", true);
      text(context, lap.coins === undefined ? "–" : String(lap.coins), coinX, y + 20, 18, 400, COLORS.text, "center", true);
      text(context, lap.mushrooms === undefined ? "–" : String(lap.mushrooms), mushroomX, y + 20, 18, 400, COLORS.text, "center", true);
      y += LAP_ROW;
    }
  }

  // Where it lives.
  context.fillStyle = COLORS.card;
  context.fillRect(0, height - 56, width, 56);
  text(context, "MK8DX Time Trials", 20, height - 22, 15, 700, COLORS.text);
  let host = "";
  try { host = new URL(model.url).host; } catch { /* no link, no host */ }
  text(context, host, width - 20, height - 22, 15, 400, COLORS.muted, "right");
  return canvas;
}

async function loadImages(paths: readonly string[]): Promise<Map<string, CanvasImageSource>> {
  const loaded = new Map<string, CanvasImageSource>();
  await Promise.all(paths.map(async (path) => {
    const picture = new Image();
    picture.decoding = "async";
    picture.src = `${GAME_ASSET_BASE}${path}`;
    try { await picture.decode(); loaded.set(path, picture); } catch { /* drawn without it */ }
  }));
  return loaded;
}

/**
 * Shares the run: the phone's share sheet with the picture, its words and the link; where a
 * browser cannot share a picture (most desktops) the picture is downloaded and the words with the
 * link are copied. Returns the sentence to show.
 */
export async function shareRun(document: Document, model: RunShareModel, language: "en" | "nl"): Promise<string> {
  const say = (en: string, nl: string) => language === "nl" ? nl : en;
  const canvas = renderRunShareCard(document, model, await loadImages(runShareImagePaths(model)));
  const blob = canvas === null ? null : await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  const words = runShareText(model);
  const file = blob === null ? null : new File([blob], runShareFileName(model), { type: "image/png" });
  const navigator_ = globalThis.navigator;
  try {
    if (file !== null && navigator_.share !== undefined &&
        (navigator_.canShare === undefined || navigator_.canShare({ files: [file] }))) {
      await navigator_.share({ title: `${model.trackName} ${model.mode}cc`, text: words, files: [file] });
      return say("Shared.", "Gedeeld.");
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") { return ""; }
  }
  if (file !== null) {
    const href = URL.createObjectURL(file);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = file.name;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(href), 10_000);
  }
  try {
    await navigator_.clipboard.writeText(words);
    return file === null
      ? say("The link was copied.", "De link is gekopieerd.")
      : say("Picture downloaded and the link copied.", "Afbeelding gedownload en de link gekopieerd.");
  } catch {
    return file === null ? say("Could not share.", "Delen is niet gelukt.")
      : say("Picture downloaded.", "Afbeelding gedownload.");
  }
}
