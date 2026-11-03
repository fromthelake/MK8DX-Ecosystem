// An installation can publish its own Tournament reports. The distributable
// stories file starts empty; no other community's history is bundled.

export type TournamentStoryPlayer = Readonly<{
  /** Sanitised class-based markup of `paragraphs`, when the Director wrote with formatting. */
  html?: readonly string[];
  rank?: number;
  name: string;
  paragraphs: readonly string[];
  analysis: readonly string[];
}>;

export type TournamentStory = Readonly<{
  introHtml?: readonly string[];
  summaryHtml?: readonly string[];
  topTracksHtml?: readonly string[];
  edition: number;
  sourceUrl: string;
  title: string;
  intro: readonly string[];
  summary: readonly string[];
  topTracks: readonly string[];
  groups: readonly Readonly<{ name: string; paragraphs: readonly string[]; html?: readonly string[] }>[];
  players: readonly TournamentStoryPlayer[];
}>;

export const TOURNAMENT_STORIES_PATH = "/styles/tournament-stories.json";

let cached: Promise<readonly TournamentStory[]> | null = null;

/** Every imported story, fetched once per page life; nothing when the file is absent. */
export function loadTournamentStories(fetchImpl: typeof fetch | undefined = globalThis.fetch): Promise<readonly TournamentStory[]> {
  if (cached === null) {
    cached = (async (): Promise<readonly TournamentStory[]> => {
      if (typeof fetchImpl !== "function") { return []; }
      try {
        // The page's scripts and styles carry a content hash in their URL; this
        // file does not, so a returning visitor kept the stories of the deploy
        // they first saw. `no-cache` still uses the cached copy - it only makes
        // the browser ask whether it is still the current one.
        const response = await fetchImpl(TOURNAMENT_STORIES_PATH, {
          cache: "no-cache",
          headers: { Accept: "application/json" },
        });
        if (!response.ok) { return []; }
        return parseTournamentStories(await response.json());
      } catch {
        return [];
      }
    })();
  }
  return cached;
}

export function parseTournamentStories(value: unknown): readonly TournamentStory[] {
  if (typeof value !== "object" || value === null) { return []; }
  const stories = (value as { stories?: unknown }).stories;
  if (!Array.isArray(stories)) { return []; }
  const strings = (input: unknown): readonly string[] =>
    Array.isArray(input) ? input.filter((entry): entry is string => typeof entry === "string" && entry.length > 0) : [];
  return stories.flatMap((entry): TournamentStory[] => {
    if (typeof entry !== "object" || entry === null) { return []; }
    const row = entry as Record<string, unknown>;
    const edition = Number(row["edition"]);
    if (!Number.isInteger(edition) || edition < 1) { return []; }
    const players = Array.isArray(row["players"]) ? row["players"].flatMap((player): TournamentStoryPlayer[] => {
      if (typeof player !== "object" || player === null) { return []; }
      const playerRow = player as Record<string, unknown>;
      if (typeof playerRow["name"] !== "string" || playerRow["name"].length === 0) { return []; }
      const rank = Number(playerRow["rank"]);
      return [{
        ...(Number.isInteger(rank) && rank > 0 ? { rank } : {}),
        name: playerRow["name"],
        paragraphs: strings(playerRow["paragraphs"]),
        analysis: strings(playerRow["analysis"]),
      }];
    }) : [];
    const groups = Array.isArray(row["groups"]) ? row["groups"].flatMap((group) => {
      if (typeof group !== "object" || group === null) { return []; }
      const groupRow = group as Record<string, unknown>;
      return typeof groupRow["name"] === "string" ? [{ name: groupRow["name"], paragraphs: strings(groupRow["paragraphs"]) }] : [];
    }) : [];
    return [{
      edition,
      sourceUrl: typeof row["sourceUrl"] === "string" ? row["sourceUrl"] : "",
      title: typeof row["title"] === "string" ? row["title"] : `TN${edition}`,
      intro: strings(row["intro"]),
      summary: strings(row["summary"]),
      topTracks: strings(row["topTracks"]),
      groups,
      players,
    }];
  });
}

/**
 * A night of our own, written by its Director and published, told in the same
 * shape as the community's imported stories - so the document draws either
 * without knowing which one it was handed.
 */
export function tournamentStoryFromReport(
  report: Readonly<{
    title: string;
    intro: readonly string[];
    summary: readonly string[];
    topTracks: readonly string[];
    groups: readonly Readonly<{ name: string; paragraphs: readonly string[]; html?: readonly string[] }>[];
    players: readonly Readonly<{ name: string; paragraphs: readonly string[]; html?: readonly string[] }>[];
    introHtml?: readonly string[];
    summaryHtml?: readonly string[];
    topTracksHtml?: readonly string[];
  }>,
): TournamentStory {
  return {
    edition: 0,
    sourceUrl: "",
    title: report.title,
    intro: report.intro,
    summary: report.summary,
    topTracks: report.topTracks,
    ...(report.introHtml === undefined ? {} : { introHtml: report.introHtml }),
    ...(report.summaryHtml === undefined ? {} : { summaryHtml: report.summaryHtml }),
    ...(report.topTracksHtml === undefined ? {} : { topTracksHtml: report.topTracksHtml }),
    groups: report.groups.map((group) => ({ name: group.name, paragraphs: group.paragraphs, ...(group.html === undefined ? {} : { html: group.html }) })),
    players: report.players.map((player) => ({ name: player.name, paragraphs: player.paragraphs, analysis: [], ...(player.html === undefined ? {} : { html: player.html }) })),
  };
}

export function tournamentStoryFor(
  stories: readonly TournamentStory[],
  editionNumber: number | undefined,
): TournamentStory | null {
  if (editionNumber === undefined) { return null; }
  return stories.find((story) => story.edition === editionNumber) ?? null;
}

const fold = (value: string): string => value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();

/**
 * The paragraphs written about one Player. The reports name people the way
 * the group chat does ("Chris", "Mike HM"), the site the way they registered
 * ("Christiaan"), so an exact name wins and a unique prefix either way is
 * accepted after that.
 */
export function tournamentStoryPlayer(
  story: TournamentStory | null,
  displayName: string,
): TournamentStoryPlayer | null {
  if (story === null) { return null; }
  const wanted = fold(displayName);
  const exact = story.players.find((player) => fold(player.name) === wanted);
  if (exact !== undefined) { return exact; }
  const near = story.players.filter((player) => {
    const name = fold(player.name);
    return name.length >= 3 && wanted.length >= 3 && (wanted.startsWith(name) || name.startsWith(wanted));
  });
  return near.length === 1 ? near[0]! : null;
}
