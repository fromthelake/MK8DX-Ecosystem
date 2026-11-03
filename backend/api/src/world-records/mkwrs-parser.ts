import { MKWRS_TRACKS } from "./mkwrs-track-map.js";

export type WorldRecordHolder = Readonly<{
  playerName: string; nationName?: string; recordDate: string; durationDays: number;
  characterName: string; bodyName: string; tireName: string; gliderName: string;
  videoUrl?: string; lapTimesMs: readonly number[];
  coinsPerLap: readonly number[]; mushroomsPerLap: readonly number[];
}>;
export type WorldRecordEntry = WorldRecordHolder & Readonly<{
  mode: 150 | 200; trackId: string; trackName: string; totalTimeMs: number;
  holders: readonly WorldRecordHolder[];
  sourceUrl: string;
}>;

export class MkwrsParseError extends Error { public constructor(message: string) { super(message); this.name = "MkwrsParseError"; } }
const decode = (value: string): string => value
  .replace(/&#0*39;|&apos;/gi, "'").replace(/&quot;/gi, '"').replace(/&amp;/gi, "&")
  .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&nbsp;/gi, " ");
const text = (html: string): string => decode(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
const normalizedTrack = (name: string): string => name.toLocaleLowerCase().replace(/^tour\s+/, "").replace(/[^a-z0-9]+/g, "");
// MKWRS publishes rounded three-decimal section splits. The current 200cc N64
// Rainbow Road sections total 8 ms below its official total, so allow only a
// tightly bounded rounding difference while keeping the totals cross-checked.
const MAX_SPLIT_ROUNDING_DRIFT_MS = 10;
const parseTime = (value: string): number => {
  const match = /(\d+)'(\d{2})"(\d{3})/.exec(value); if (!match) throw new MkwrsParseError("invalid total time");
  return Number(match[1]) * 60_000 + Number(match[2]) * 1_000 + Number(match[3]);
};
const parseSplit = (value: string): number => {
  const match = /^(\d+):(\d{2})\.(\d{3})$|^(\d+)\.(\d{3})$/.exec(value.trim());
  if (!match) throw new MkwrsParseError("invalid lap split");
  return match[1] ? Number(match[1]) * 60_000 + Number(match[2]) * 1_000 + Number(match[3]) : Number(match[4]) * 1_000 + Number(match[5]);
};

// Coins and mushrooms per lap. Some entries list them in another grouping than one value per lap
// (a 7-lap Baby Park record with three values); those are kept as unknown rather than guessed.
const itemVector = (value: string, laps: number): number[] => {
  const values = value.split("-").map((part) => Number(part));
  if (values.some((part) => !Number.isSafeInteger(part))) throw new MkwrsParseError("invalid split vector");
  return values.length === laps ? values : [];
};

export function parseMkwrsPage(mode: 150 | 200, html: string): readonly WorldRecordEntry[] {
  if (html.length < 10_000 || html.length > 5_000_000) throw new MkwrsParseError("unexpected page size");
  const sourceUrl = mode === 150 ? "https://mkwrs.com/mk8dx/wrs.php" : "https://mkwrs.com/mk8dx/wrs_200.php";
  const candidates = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].flatMap((row) => {
    const cells = [...row[1]!.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) => cell[1]!);
    return cells.length === 11 && /display\.php\?track=/i.test(cells[0]!) ? [cells] : [];
  });
  if (candidates.length < 96 || candidates.length > 98) throw new MkwrsParseError(`expected 96 unique tracks with at most two tie rows, received ${candidates.length}`);
  const trackByName = new Map(MKWRS_TRACKS.map((track, index) => [normalizedTrack(track.name), { track, index }]));
  let previousIndex = -1;
  const parsed = candidates.map((cells): WorldRecordEntry => {
    const trackName = text(cells[0]!); const resolved = trackByName.get(normalizedTrack(trackName));
    if (resolved === undefined || resolved.index < previousIndex) throw new MkwrsParseError(`track order does not match at ${trackName}`);
    previousIndex = resolved.index; const expected = resolved.track;
    const totalTimeMs = parseTime(text(cells[1]!));
    const video = /href=["'](https:\/\/(?:www\.)?(?:youtube\.com|youtu\.be)\/[^"']+)["']/i.exec(cells[1]!);
    const nation = /(?:alt|title)=["']([^"']+)["']/i.exec(cells[3]!);
    const splitCall = /show_splits(?:_BP)?\(([\s\S]*?)\);/i.exec(cells[10]!);
    const split = splitCall === null ? [] : [...splitCall[1]!.matchAll(/['"]([^'"]*)['"]/g)].map((match) => match[1]!);
    const expectedLaps = expected.trackId === "track.gcn_baby_park" ? 7 : 3;
    if (split.length !== expectedLaps + 3) throw new MkwrsParseError(`missing splits for ${trackName}`);
    const lapTimesMs = split.slice(1, 1 + expectedLaps).map(parseSplit);
    if (Math.abs(lapTimesMs.reduce((sum, lap) => sum + lap, 0) - totalTimeMs) > MAX_SPLIT_ROUNDING_DRIFT_MS) throw new MkwrsParseError(`splits do not total for ${trackName}`);
    const coins = itemVector(split[1 + expectedLaps]!, expectedLaps), mushrooms = itemVector(split[2 + expectedLaps]!, expectedLaps);
    if (coins.some((value) => value < 0 || value > 10) || mushrooms.some((value) => value < 0 || value > 3) || mushrooms.reduce((sum, value) => sum + value, 0) > 3) throw new MkwrsParseError(`invalid item splits for ${trackName}`);
    // A record set today shows "<1" days.
    const duration = text(cells[5]!);
    const date = text(cells[4]!), durationDays = duration === "<1" ? 0 : Number(duration);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isSafeInteger(durationDays) || durationDays < 0) throw new MkwrsParseError(`invalid record metadata for ${trackName}`);
    const holder: WorldRecordHolder = { playerName: text(cells[2]!),
      ...(nation ? { nationName: decode(nation[1]!) } : {}), recordDate: date, durationDays,
      characterName: text(cells[6]!), bodyName: text(cells[7]!), tireName: text(cells[8]!), gliderName: text(cells[9]!),
      ...(video ? { videoUrl: decode(video[1]!) } : {}), lapTimesMs, coinsPerLap: coins, mushroomsPerLap: mushrooms };
    return { mode, trackId: expected.trackId, trackName, totalTimeMs, ...holder, holders: [holder], sourceUrl };
  });
  const grouped = new Map<string, WorldRecordEntry[]>();
  for (const record of parsed) { const rows = grouped.get(record.trackId) ?? []; rows.push(record); grouped.set(record.trackId, rows); }
  if (grouped.size !== 96) throw new MkwrsParseError(`expected 96 unique tracks, received ${grouped.size}`);
  return MKWRS_TRACKS.map(({ trackId }) => {
    const ties = grouped.get(trackId)!; const first = ties[0]!;
    if (ties.length > 3 || ties.some((record) => record.totalTimeMs !== first.totalTimeMs)) throw new MkwrsParseError(`conflicting duplicate World Records for ${first.trackName}`);
    const holders = ties.map((record) => record.holders[0]!);
    if (new Set(holders.map((holder) => holder.playerName.toLocaleLowerCase())).size !== holders.length) throw new MkwrsParseError(`duplicate World Record holder for ${first.trackName}`);
    return { ...first, playerName: holders.map((holder) => holder.playerName).join(" / "), holders };
  });
}

export function parseCompleteMkwrsSnapshot(html150: string, html200: string): readonly WorldRecordEntry[] {
  const records = [...parseMkwrsPage(150, html150), ...parseMkwrsPage(200, html200)];
  if (records.length !== 192) throw new MkwrsParseError("incomplete snapshot"); return records;
}
