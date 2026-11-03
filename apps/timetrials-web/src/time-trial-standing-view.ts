import { CUP_ASSET_MANIFEST, GAME_ASSET_BASE } from "./asset-manifest.js";
import { benchmarksByKind } from "./benchmark-manifest.js";
import { fetchTrackBestsFor, type TrackBest } from "./mastery-view.js";
import {
  applyWorldRecordMasteryBaseline, MASTERY_TIER_COLORS, MASTERY_TIER_LABELS, MASTERY_WR_RATIOS, masteryTierLabel,
  MASTERY_UNPLAYED_FALLBACK_MS, nextTotalTierDeltaMs, totalMasteryTier,
  trackMasteryTier,
} from "./mastery-thresholds.js";
import { localized, productLanguage } from "./product-language.js";
import {
  artThumb, button, chip, dataTable, deltaValue, dialog, el, emptyState, engineMark, engineSelector, errorState,
  field, filterSheet, filterSummary, heroRank, hiddenByPreference, panel, podiumStrip,
  removableChip, segmentedControl, skeleton, statBlock, statGrid, statusMessage, tabs, tierChip,
  toggleChip, useDocument, valueBar, youChip,
  type DataColumn, type DataRow, type OverlayHandle,
} from "./ds-components.js";
import {
  formatCount, formatRank, formatTime, TRUE_MINUS, type NumberLanguage,
} from "./ds-numeric.js";
import type { FocusRow } from "./home-focus.js";
import {
  matchesRankTrackFocus,
  rankTrackFocusLabel,
  type RankTrackFocus,
} from "./rank-track-focus.js";
import {
  defaultTimeTrialTrackScope,
  timeTrialTrackIds,
  type TimeTrialTrackScope,
} from "./track-scope.js";

export type TimeTrialStanding = Readonly<{
  rank: number; playerId: string; playerDisplayName: string; mode: 150 | 200;
  totalTimeMs: number; averageTimeMs: number; playedTracks: number;
  goldMedals: number; silverMedals: number; bronzeMedals: number;
  reference?: true;
}>;
export type RankSocialGroup = Readonly<{ groupId: string; name: string; playerIds: readonly string[] }>;
export type TimeTrialStandingContext = Readonly<{
  viewerPlayerId: string | null; rivalPlayerIds: ReadonlySet<string>;
  modePreference?: "all" | "150" | "200";
  trackAccess?: "unknown" | "base_only" | "base_and_bcp";
  /**
   * The viewer's own 150cc standing, so Rank can open with the same headline
   * card the APK opens with instead of going straight to a table.
   */
  standing?: Readonly<{ standing: number; of: number; previousStanding?: number }>;
  onSignIn?: () => void;
  groups?: readonly RankSocialGroup[];
  rankScope?: Readonly<{ global: boolean; rivals: boolean; groupIds: readonly string[] }>;
  saveRankScope?: (scope: Readonly<{ global: boolean; rivals: boolean; groupIds: readonly string[] }>) => Promise<void>;
  focusRows?: readonly FocusRow[];
}>;
export type MountedTimeTrialStanding = Readonly<{ container: HTMLElement; ready: Promise<void>; unmount(): void }>;
type RankTab = "total" | "medals" | "mastery" | "tracks";
export type TimeTrialRankInitialView = Readonly<{
  mode?: 150 | 200;
  scope?: TimeTrialTrackScope;
  tab?: RankTab;
  trackFocus?: RankTrackFocus;
}>;
type PersistedRankView = Readonly<{
  mode: 150 | 200; scope: TimeTrialTrackScope; tab: RankTab; trackQuery: string; selectedPlayers: readonly string[];
  trackSortPlayerId: string | null; trackSortDirection: "asc" | "desc"; scrollY: number;
  /** Whose view this is; "anonymous" for a signed-out visitor. */
  viewer?: string;
}>;
type DirectoryPlayer = Readonly<{ playerId: string; displayName: string }>;
export type WorldRecordHolder = Readonly<{
  playerName: string; videoUrl?: string; nationName?: string; recordDate?: string; durationDays?: number;
  characterName?: string; bodyName?: string; tireName?: string; gliderName?: string;
  lapTimesMs: readonly number[]; coinsPerLap: readonly number[]; mushroomsPerLap: readonly number[];
}>;
export type WorldRecord = Readonly<{
  mode: 150 | 200; trackId: string; totalTimeMs: number; playerName: string; videoUrl?: string; nationName?: string;
  lapTimesMs: readonly number[]; coinsPerLap: readonly number[]; mushroomsPerLap: readonly number[]; holders: readonly WorldRecordHolder[];
}>;

const playerIdPattern = /^player\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
export const NINTENDO_STAFF_REFERENCE_ID = "reference.nintendo_staff";
export const WORLD_RECORD_REFERENCE_ID = "reference.world_record";
const HOME_FOCUS_TARGET_REFERENCE_ID = "reference.home_focus_target";
const referenceNames = new Map<string, string>([
  [NINTENDO_STAFF_REFERENCE_ID, "Nintendo Ghost"],
  [WORLD_RECORD_REFERENCE_ID, "World Record"],
]);
const RANK_VIEW_STORAGE_KEY = "mk8dx.rank-view.v1";
const tracks = CUP_ASSET_MANIFEST.flatMap((cup) => cup.tracks.map((track) => ({ ...track, cupName: cup.name, cupIconPath: cup.iconPath })));
const integer = (value: unknown, minimum = 0): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= minimum ? value : null;

export async function fetchTimeTrialStandings(mode: 150 | 200, signal?: AbortSignal, scope: TimeTrialTrackScope = "all"): Promise<readonly TimeTrialStanding[]> {
  const response = await fetch(`/v1/public/time-trial-standings?mode=${mode}&scope=${scope}`, {
    method: "GET", headers: { Accept: "application/json" }, credentials: "same-origin",
    mode: "same-origin", redirect: "error", referrerPolicy: "same-origin", cache: "no-store",
    ...(signal === undefined ? {} : { signal }),
  });
  if (response.status !== 200) throw new Error("standings unavailable");
  const body = await response.json() as Record<string, unknown>;
  if (body["schemaVersion"] !== "mk8dx.public-time-trial-standings.v1" || !Array.isArray(body["standings"])) throw new Error("standings invalid");
  return body["standings"].map((candidate) => {
    if (candidate === null || typeof candidate !== "object") throw new Error("standing invalid");
    const row = candidate as Record<string, unknown>;
    const rank = integer(row["rank"], 1), parsedMode = integer(row["mode"]);
    const totalTimeMs = integer(row["totalTimeMs"], 1), averageTimeMs = integer(row["averageTimeMs"], 1);
    const playedTracks = integer(row["playedTracks"], 1), goldMedals = integer(row["goldMedals"]);
    const silverMedals = integer(row["silverMedals"]), bronzeMedals = integer(row["bronzeMedals"]);
    if (rank === null || parsedMode !== mode || totalTimeMs === null || averageTimeMs === null ||
      playedTracks === null || playedTracks > 96 || goldMedals === null || silverMedals === null || bronzeMedals === null ||
      typeof row["playerId"] !== "string" || !playerIdPattern.test(row["playerId"]) ||
      typeof row["playerDisplayName"] !== "string" || row["playerDisplayName"].length < 1) throw new Error("standing invalid");
    return { rank, playerId: row["playerId"], playerDisplayName: row["playerDisplayName"], mode,
      totalTimeMs, averageTimeMs, playedTracks, goldMedals, silverMedals, bronzeMedals };
  });
}

export async function fetchRankPlayerDirectory(query: string, signal?: AbortSignal): Promise<readonly DirectoryPlayer[]> {
  const response = await fetch(`/v1/public/player-directory?query=${encodeURIComponent(query)}`, {
    method: "GET", headers: { Accept: "application/json" }, credentials: "same-origin",
    mode: "same-origin", redirect: "error", cache: "no-store", ...(signal === undefined ? {} : { signal }),
  });
  if (response.status !== 200) return [];
  const body = await response.json() as Record<string, unknown>;
  if (body["schemaVersion"] !== "mk8dx.player-directory.v1" || !Array.isArray(body["players"])) return [];
  return body["players"].flatMap((value) => {
    const player = value as Record<string, unknown>;
    return typeof player["playerId"] === "string" && playerIdPattern.test(player["playerId"]) && typeof player["displayName"] === "string"
      ? [{ playerId: player["playerId"], displayName: player["displayName"] }] : [];
  });
}

export async function fetchWorldRecords(signal?: AbortSignal): Promise<readonly WorldRecord[]> {
  const response = await fetch("/v1/public/world-records", { headers: { Accept: "application/json" }, cache: "no-store", ...(signal === undefined ? {} : { signal }) });
  if (response.status !== 200) return [];
  return parseWorldRecordsDocument(await response.json());
}

export function parseWorldRecordsDocument(value: unknown): readonly WorldRecord[] {
  if (value === null || typeof value !== "object") return [];
  const body = value as Record<string, unknown>; if (body["schemaVersion"] !== "mk8dx.world-records.v1" || !Array.isArray(body["records"])) return [];
  return body["records"].flatMap((candidate) => {
    if (candidate === null || typeof candidate !== "object") return [];
    const row = candidate as Record<string, unknown>;
    if ((row["mode"] !== 150 && row["mode"] !== 200) || typeof row["trackId"] !== "string" || typeof row["totalTimeMs"] !== "number" || typeof row["playerName"] !== "string" ||
      !Array.isArray(row["lapTimesMs"]) || !Array.isArray(row["coinsPerLap"]) || !Array.isArray(row["mushroomsPerLap"])) return [];
    const parsedHolders = Array.isArray(row["holders"]) ? row["holders"].flatMap((candidate) => {
      if (candidate === null || typeof candidate !== "object") return [];
      const holder = candidate as Record<string, unknown>;
      if (typeof holder["playerName"] !== "string" || !Array.isArray(holder["lapTimesMs"]) || !Array.isArray(holder["coinsPerLap"]) || !Array.isArray(holder["mushroomsPerLap"])) return [];
      return [{ playerName: holder["playerName"], ...(typeof holder["videoUrl"] === "string" ? { videoUrl: holder["videoUrl"] } : {}),
        ...(typeof holder["nationName"] === "string" ? { nationName: holder["nationName"] } : {}),
        ...(typeof holder["recordDate"] === "string" ? { recordDate: holder["recordDate"] } : {}),
        ...(typeof holder["durationDays"] === "number" ? { durationDays: holder["durationDays"] } : {}),
        ...(typeof holder["characterName"] === "string" ? { characterName: holder["characterName"] } : {}),
        ...(typeof holder["bodyName"] === "string" ? { bodyName: holder["bodyName"] } : {}),
        ...(typeof holder["tireName"] === "string" ? { tireName: holder["tireName"] } : {}),
        ...(typeof holder["gliderName"] === "string" ? { gliderName: holder["gliderName"] } : {}),
        lapTimesMs: holder["lapTimesMs"] as number[], coinsPerLap: holder["coinsPerLap"] as number[], mushroomsPerLap: holder["mushroomsPerLap"] as number[] }];
    }) : [];
    const fallback = { playerName: row["playerName"], ...(typeof row["videoUrl"] === "string" ? { videoUrl: row["videoUrl"] } : {}),
      ...(typeof row["nationName"] === "string" ? { nationName: row["nationName"] } : {}),
      ...(typeof row["recordDate"] === "string" ? { recordDate: row["recordDate"] } : {}),
      ...(typeof row["durationDays"] === "number" ? { durationDays: row["durationDays"] } : {}),
      ...(typeof row["characterName"] === "string" ? { characterName: row["characterName"] } : {}),
      ...(typeof row["bodyName"] === "string" ? { bodyName: row["bodyName"] } : {}),
      ...(typeof row["tireName"] === "string" ? { tireName: row["tireName"] } : {}),
      ...(typeof row["gliderName"] === "string" ? { gliderName: row["gliderName"] } : {}),
      lapTimesMs: row["lapTimesMs"] as number[], coinsPerLap: row["coinsPerLap"] as number[], mushroomsPerLap: row["mushroomsPerLap"] as number[] };
    return [{ mode: row["mode"], trackId: row["trackId"], totalTimeMs: row["totalTimeMs"], playerName: row["playerName"],
      ...(typeof row["videoUrl"] === "string" ? { videoUrl: row["videoUrl"] } : {}),
      ...(typeof row["nationName"] === "string" ? { nationName: row["nationName"] } : {}),
      lapTimesMs: row["lapTimesMs"] as number[], coinsPerLap: row["coinsPerLap"] as number[], mushroomsPerLap: row["mushroomsPerLap"] as number[], holders: parsedHolders.length ? parsedHolders : [fallback] }];
  });
}

export function formatStandingTotal(milliseconds: number): string {
  const hours = Math.floor(milliseconds / 3_600_000), rest = milliseconds % 3_600_000;
  return `${hours}:${String(Math.floor(rest / 60_000)).padStart(2, "0")}:${String(Math.floor((rest % 60_000) / 1_000)).padStart(2, "0")}.${String(rest % 1_000).padStart(3, "0")}`;
}

export function sortMedalStandings(rows: readonly TimeTrialStanding[]): readonly TimeTrialStanding[] {
  return [...rows].sort((left, right) =>
    right.goldMedals - left.goldMedals ||
    right.silverMedals - left.silverMedals ||
    right.bronzeMedals - left.bronzeMedals ||
    left.playerDisplayName.localeCompare(right.playerDisplayName),
  );
}

export function sortComparisonIdsByTotal(
  ids: readonly string[],
  totalFor: (id: string) => number,
  nameFor: (id: string) => string,
): readonly string[] {
  return [...ids].sort((left, right) => totalFor(left) - totalFor(right) ||
    nameFor(left).localeCompare(nameFor(right)));
}

export function referenceTotalCoverage(
  bests: readonly Pick<TrackBest, "trackId" | "mode" | "totalTimeMs">[],
  mode: 150 | 200,
  trackIds: readonly string[],
): Readonly<{ coveredTracks: number; totalTracks: number; totalTimeMs: number | null }> {
  const byTrack = new Map<string, number[]>();
  const wanted = new Set(trackIds);
  for (const best of bests) {
    if (best.mode !== mode || !wanted.has(best.trackId)) continue;
    const times = byTrack.get(best.trackId) ?? [];
    times.push(best.totalTimeMs);
    byTrack.set(best.trackId, times);
  }
  let coveredTracks = 0, totalTimeMs = 0;
  for (const trackId of trackIds) {
    const times = byTrack.get(trackId);
    if (times?.length !== 1 || !Number.isSafeInteger(times[0]) || times[0]! <= 0) continue;
    coveredTracks += 1;
    totalTimeMs += times[0]!;
  }
  return { coveredTracks, totalTracks: trackIds.length,
    totalTimeMs: coveredTracks === trackIds.length && Number.isSafeInteger(totalTimeMs) ? totalTimeMs : null };
}

export function mountTimeTrialStanding(
  root: HTMLElement,
  context: Promise<TimeTrialStandingContext> = Promise.resolve({ viewerPlayerId: null, rivalPlayerIds: new Set() }),
  load: typeof fetchTimeTrialStandings = fetchTimeTrialStandings,
  initialView: TimeTrialRankInitialView = {},
): MountedTimeTrialStanding {
  const document = root.ownerDocument, controller = new AbortController();
  useDocument(document);
  const view = document.defaultView;
  const lang = (): NumberLanguage => productLanguage();
  let storage: Storage | null = null;
  try { storage = view?.localStorage ?? null; } catch { storage = null; }
  let stored: Partial<PersistedRankView> = {};
  try { stored = JSON.parse(storage?.getItem(RANK_VIEW_STORAGE_KEY) ?? "{}") as Partial<PersistedRankView>; } catch { stored = {}; }
  let disposed = false;
  let mode: 150 | 200 = initialView.mode ?? (stored.mode === 200 ? 200 : 150);
  let trackScope: TimeTrialTrackScope = initialView.scope ??
    (stored.scope === "base" || stored.scope === "bcp" ? stored.scope : "all");
  let tab: RankTab = initialView.trackFocus !== undefined
    ? "tracks"
    : initialView.tab ??
      (["total", "medals", "mastery", "tracks"].includes(stored.tab ?? "")
        ? stored.tab!
        : "total");
  let trackFocus: RankTrackFocus | null = initialView.trackFocus ?? null;
  let trackQuery = typeof stored.trackQuery === "string" ? stored.trackQuery.slice(0, 80) : "";
  let resolvedContext: TimeTrialStandingContext = { viewerPlayerId: null, rivalPlayerIds: new Set() };
  let activeScopes = new Set<string>(["global"]);
  let selectedPlayers: string[] = Array.isArray(stored.selectedPlayers)
    ? stored.selectedPlayers.filter((id): id is string => typeof id === "string" && (referenceNames.has(id) || playerIdPattern.test(id))).slice(0, 3)
    : [];
  let trackSortPlayerId = typeof stored.trackSortPlayerId === "string" ? stored.trackSortPlayerId : null;
  let trackSortDirection: "asc" | "desc" = stored.trackSortDirection === "asc" ? "asc" : "desc";
  // A saved scroll position belongs to one concrete Ranking view. Reusing it for another URL tab,
  // engine or track set made a freshly opened page appear halfway through unrelated content.
  const storedScrollMatchesRequest =
    (initialView.tab === undefined || initialView.tab === stored.tab) &&
    (initialView.mode === undefined || initialView.mode === stored.mode) &&
    (initialView.scope === undefined || initialView.scope === stored.scope);
  let rememberedScrollY = storedScrollMatchesRequest &&
    typeof stored.scrollY === "number" && Number.isFinite(stored.scrollY)
    ? Math.max(0, stored.scrollY)
    : 0;
  let ownStandingRow: TimeTrialStanding | null = null;
  let standingFilter = "";
  /**
   * A view override, never the saved preference (DESIGN_SYSTEM §7, ENGINE_CONTEXT_INVENTORY §4.7):
   * a single-engine preference hides the other engine; "Show 200cc anyway" reveals the selector for
   * this mount only and writes nothing to the account.
   */
  let engineOverride = false;
  /** Set when a per-player bests lookup failed, so the view can say so. */
  let bestsUnavailable = false;
  const standingsCache = new Map<string, readonly TimeTrialStanding[]>(), bestsCache = new Map<string, readonly TrackBest[]>();
  const namedPlayers = new Map<string, string>(referenceNames);
  // Android refreshes the complete WR-relative Mastery ladder before painting Rank.
  // Fetch in parallel with the viewer context; a missing/incomplete snapshot leaves
  // the packaged baseline intact rather than making the Ranking unavailable.
  let worldRecordsPromise: Promise<readonly WorldRecord[]> | null =
    fetchWorldRecords(controller.signal).catch(() => []);
  const scopedTrackIds = (): readonly string[] => timeTrialTrackIds(trackScope);
  const scopedTracks = (): typeof tracks => {
    const ids = new Set(scopedTrackIds());
    return tracks.filter((track) => ids.has(track.id));
  };
  const scopedTrackCount = (): number => scopedTrackIds().length;
  const count = (value: number): string => formatCount(value, lang());

  // ------------------------------------------------------------------ frame
  const container = document.createElement("section");
  container.className = "ds-root ds-rank";
  container.setAttribute("aria-label", localized("Time Trial Ranking", "Time Trial-klassement"));
  const tabsSlot = document.createElement("div");
  tabsSlot.className = "ds-rank__tabs";
  const controlBar = document.createElement("div");
  controlBar.className = "ds-rank__controls";
  const summarySlot = document.createElement("div");
  summarySlot.className = "ds-rank__summary";
  const engineSlot = document.createElement("div");
  engineSlot.className = "ds-rank__engine";
  controlBar.append(summarySlot, engineSlot);
  const headline = document.createElement("div");
  headline.className = "ds-rank__headline";
  const comparisonSlot = document.createElement("div");
  comparisonSlot.className = "ds-rank__comparison";
  const status = document.createElement("p");
  status.className = "ds-body-s ds-rank__status";
  status.setAttribute("role", "status");
  const content = document.createElement("div");
  content.className = "ds-rank__content";
  container.append(tabsSlot, controlBar, headline, comparisonSlot, status, content);
  root.append(container);

  /** The sheet the filter summary opens; one per mount, rebuilt whenever it is opened. */
  let sheet: OverlayHandle | null = null;
  const closeSheet = (): void => { try { sheet?.close(); } catch { /* not open */ } };

  const persistView = (): void => {
    try {
      storage?.setItem(RANK_VIEW_STORAGE_KEY, JSON.stringify({
        mode, scope: trackScope, tab, trackQuery, selectedPlayers, trackSortPlayerId, trackSortDirection,
        scrollY: Math.max(0, view?.scrollY ?? rememberedScrollY),
        viewer: resolvedContext.viewerPlayerId ?? "anonymous",
      } satisfies PersistedRankView));
    } catch { /* private browsing/storage quotas must never break Rank */ }
  };

  /** The address always carries the engine, the tab and the track set (R6, ADR-0199). */
  const rankHref = (next: Partial<Readonly<{ tab: RankTab; mode: 150 | 200; scope: TimeTrialTrackScope }>> = {}): string => {
    const query = new URLSearchParams();
    query.set("ranking", "timetrials");
    query.set("tab", next.tab ?? tab);
    query.set("mode", String(next.mode ?? mode));
    query.set("scope", next.scope ?? trackScope);
    if (trackFocus !== null && (next.tab ?? tab) === "tracks") { query.set("focus", trackFocus); }
    return `/?${query.toString()}`;
  };
  const syncTrackFocusUrl = (): void => {
    if (view === null || view === undefined) { return; }
    view.history.replaceState(view.history.state, "", rankHref());
  };

  const discardForeignView = (): void => {
    const owner = resolvedContext.viewerPlayerId ?? "anonymous";
    if ((stored.viewer ?? owner) === owner) { return; }
    mode = initialView.mode ??
      (resolvedContext.modePreference === "200" ? 200 : 150);
    trackScope = initialView.scope ?? defaultTimeTrialTrackScope(resolvedContext.trackAccess);
    tab = initialView.trackFocus !== undefined
      ? "tracks"
      : initialView.tab ?? "total";
    trackFocus = initialView.trackFocus ?? null;
    trackQuery = ""; selectedPlayers = [];
    trackSortPlayerId = null; trackSortDirection = "desc"; rememberedScrollY = 0;
    standingFilter = "";
    stored = {};
  };
  const rememberScroll = (): void => { rememberedScrollY = Math.max(0, view?.scrollY ?? 0); persistView(); };
  view?.addEventListener("scroll", rememberScroll, { passive: true });

  // ------------------------------------------------------------- selections
  const scopeChoices = (): readonly Readonly<{ key: string; label: string }>[] => [
    { key: "global", label: localized("Global", "Wereldwijd") },
    { key: "rivals", label: localized("Among rivals", "Onder rivalen") },
    ...(resolvedContext.groups ?? []).map((group) => ({ key: `group:${group.groupId}`, label: group.name })),
  ];
  const scopeLabel = (): string => {
    const chosen = scopeChoices().filter((choice) => activeScopes.has(choice.key));
    return chosen.length === 0 ? localized("Global", "Wereldwijd") : chosen.map((choice) => choice.label).join(" + ");
  };
  const trackSetLabel = (scope: TimeTrialTrackScope = trackScope): string =>
    scope === "base" ? localized("Base 48", "Basis 48") : scope === "bcp" ? "BCP 48" : localized("All 96", "Alle 96");
  const toggleScope = (key: string): void => {
    if (key === "global") { activeScopes = new Set(["global"]); }
    else {
      activeScopes.delete("global");
      if (activeScopes.has(key)) { activeScopes.delete(key); } else { activeScopes.add(key); }
    }
    if (!activeScopes.size) { activeScopes.add("global"); }
    void resolvedContext.saveRankScope?.({
      global: activeScopes.has("global"),
      rivals: activeScopes.has("rivals"),
      groupIds: [...activeScopes].flatMap((scope) => scope.startsWith("group:") ? [scope.slice(6)] : []),
    }).catch(() => undefined);
    repaint();
  };
  const resetFilters = (): void => {
    mode = resolvedContext.modePreference === "200" ? 200 : 150;
    trackScope = defaultTimeTrialTrackScope(resolvedContext.trackAccess);
    tab = "total"; trackFocus = null; trackQuery = "";
    trackSortPlayerId = null; trackSortDirection = "desc";
    activeScopes = new Set(["global"]);
    selectedPlayers = resolvedContext.viewerPlayerId ? [resolvedContext.viewerPlayerId] : [NINTENDO_STAFF_REFERENCE_ID];
    standingFilter = "";
    rememberedScrollY = 0;
    try { storage?.removeItem(RANK_VIEW_STORAGE_KEY); } catch { /* ignore */ }
    syncTrackFocusUrl();
    void resolvedContext.saveRankScope?.({ global: true, rivals: false, groupIds: [] }).catch(() => undefined);
    view?.scrollTo?.({ top: 0, behavior: "instant" });
    repaint();
  };

  const visibleRows = (rows: readonly TimeTrialStanding[]): readonly TimeTrialStanding[] => {
    if (activeScopes.has("global")) return rows;
    const ids = new Set<string>();
    if (activeScopes.has("rivals")) { resolvedContext.rivalPlayerIds.forEach((id) => ids.add(id)); if (resolvedContext.viewerPlayerId) ids.add(resolvedContext.viewerPlayerId); }
    for (const group of resolvedContext.groups ?? []) if (activeScopes.has(`group:${group.groupId}`)) group.playerIds.forEach((id) => ids.add(id));
    return rows.filter((row) => ids.has(row.playerId));
  };
  const ensureBests = async (ids: readonly string[]): Promise<void> => {
    const missing = [...new Set(ids)].filter((id) => !bestsCache.has(id)); if (!missing.length) return;
    if (missing.includes(NINTENDO_STAFF_REFERENCE_ID)) {
      bestsCache.set(NINTENDO_STAFF_REFERENCE_ID, [150, 200].flatMap((candidate) =>
        benchmarksByKind("nintendo_staff", candidate as 150 | 200).map((entry) => ({
          trackId: entry.trackId, mode: entry.mode, totalTimeMs: entry.timeMs, rank: 1,
        }))));
    }
    if (missing.includes(WORLD_RECORD_REFERENCE_ID)) {
      worldRecordsPromise ??= fetchWorldRecords(controller.signal);
      const records = await worldRecordsPromise;
      bestsCache.set(WORLD_RECORD_REFERENCE_ID, records.map((record) => ({
        trackId: record.trackId, mode: record.mode, totalTimeMs: record.totalTimeMs, rank: 1,
      })));
    }
    const humanIds = missing.filter((id) => playerIdPattern.test(id));
    if (humanIds.length) {
      const loaded = await fetchTrackBestsFor(humanIds, controller.signal)
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === "AbortError") { throw error; }
          bestsUnavailable = true;
          return new Map<string, readonly TrackBest[]>();
        });
      loaded.forEach((value, key) => bestsCache.set(key, value));
    }
    missing.forEach((id) => { if (!bestsCache.has(id)) bestsCache.set(id, []); });
  };
  const addPlayer = (player: DirectoryPlayer): void => {
    namedPlayers.set(player.playerId, player.displayName);
    if (!selectedPlayers.includes(player.playerId) && selectedPlayers.length < 3) selectedPlayers = [...selectedPlayers, player.playerId];
    repaint();
  };
  const toggleReference = (playerId: string): void => {
    if (selectedPlayers.includes(playerId)) {
      selectedPlayers = selectedPlayers.filter((id) => id !== playerId);
      return;
    }
    const viewer = resolvedContext.viewerPlayerId;
    const withViewer = viewer === null
      ? selectedPlayers
      : [viewer, ...selectedPlayers.filter((id) => id !== viewer)];
    selectedPlayers = [...withViewer.slice(0, 2), playerId];
  };

  // ----------------------------------------------------------------- chrome
  const paintTabs = (): void => {
    tabsSlot.replaceChildren(tabs({
      label: localized("Ranking views", "Weergaven"),
      items: ([
        ["total", localized("Total", "Totaal")],
        ["medals", localized("Medals", "Medailles")],
        ["mastery", "Mastery"],
        ["tracks", localized("Delta per track", "Verschil per circuit")],
      ] as const).map(([key, label]) => ({
        href: rankHref({ tab: key }), label, current: tab === key,
        onSelect: (): void => {
          if (tab !== key) {
            rememberedScrollY = 0;
            view?.scrollTo?.({ top: 0, behavior: "instant" });
          }
          tab = key;
          if (key !== "tracks" && trackFocus !== null) { trackFocus = null; }
          syncTrackFocusUrl();
          repaint();
        },
      })),
    }));
  };

  const openFilterSheet = (): void => {
    const body: HTMLElement[] = [];
    const community = document.createElement("div");
    community.className = "ds-rank__sheet-group";
    const communityLabel = document.createElement("p");
    communityLabel.className = "ds-label";
    communityLabel.textContent = localized("Community", "Community");
    const communityChips = document.createElement("div");
    communityChips.className = "ds-filter-chips";
    communityChips.setAttribute("role", "group");
    communityChips.setAttribute("aria-label", localized("Community", "Community"));
    for (const choice of scopeChoices()) {
      communityChips.append(toggleChip({
        label: choice.label, pressed: activeScopes.has(choice.key),
        onToggle: () => { toggleScope(choice.key); closeSheet(); },
      }));
    }
    community.append(communityLabel, communityChips);
    const trackSet = document.createElement("div");
    trackSet.className = "ds-rank__sheet-group";
    const trackSetLabelNode = document.createElement("p");
    trackSetLabelNode.className = "ds-label";
    trackSetLabelNode.textContent = localized("Tracks", "Circuits");
    trackSet.append(trackSetLabelNode, segmentedControl<TimeTrialTrackScope>({
      label: localized("Track set", "Circuitset"),
      choices: (["base", "bcp", "all"] as const).map((scope) => ({ value: scope, label: trackSetLabel(scope) })),
      value: trackScope,
      onChange: (scope) => { trackScope = scope; syncTrackFocusUrl(); repaint(); closeSheet(); },
    }).root);
    body.push(community, trackSet);
    if (view?.matchMedia?.("(max-width: 599px)").matches === true) {
      const comparison = document.createElement("div");
      comparison.className = "ds-rank__sheet-group";
      const comparisonLabel = document.createElement("p");
      comparisonLabel.className = "ds-label";
      comparisonLabel.textContent = localized("Reference Players", "Referentiespelers");
      comparison.append(comparisonLabel, ...buildComparisonControls(true));
      body.push(comparison);
    }
    sheet = filterSheet({
      title: localized("Filters", "Filters"),
      body,
      doneLabel: localized("Done", "Klaar"),
      resetLabel: localized("Reset filters", "Filters wissen"),
      onReset: () => { closeSheet(); resetFilters(); },
    });
    sheet.open();
  };

  const paintSummary = (): void => {
    const summary = filterSummary({
      label: localized("Active filters", "Actieve filters"),
      parts: [
        { label: localized("Community:", "Community:"), value: scopeLabel() },
        { label: localized("Tracks:", "Circuits:"), value: trackSetLabel() },
        { label: localized("Chosen:", "Gekozen:"), value: localized(`${count(selectedPlayers.length)} of 3`, `${count(selectedPlayers.length)} van 3`) },
      ],
      openLabel: localized("Filters", "Filters"),
      onOpen: openFilterSheet,
    });
    const parts = document.createElement("span");
    parts.className = "ds-rank__summary-parts";
    const partNodes = Array.from(summary.children)
      .filter((node) => node.classList.contains("ds-filter-summary__part"));
    parts.append(...partNodes);
    const open = summary.lastElementChild;
    summary.replaceChildren(parts, ...(open === null ? [] : [open]));
    summarySlot.replaceChildren(summary);
  };

  const paintEngine = (): void => {
    engineSlot.replaceChildren();
    const preference = resolvedContext.modePreference;
    const single = (preference === "150" || preference === "200") && initialView.mode === undefined;
    if (single && !engineOverride) {
      const hidden: 150 | 200 = preference === "200" ? 150 : 200;
      engineSlot.append(engineMark(mode, "lg"), hiddenByPreference({
        text: localized(
          `${hidden}cc is hidden by your Time Trial preference.`,
          `${hidden}cc is verborgen door je Time Trial-voorkeur.`,
        ),
        showLabel: localized(`Show ${hidden}cc anyway`, `Toch ${hidden}cc tonen`),
        onShow: () => { engineOverride = true; repaint(); },
      }));
      return;
    }
    engineSlot.append(engineSelector({
      label: localized("Engine class", "Motorklasse"),
      value: mode,
      size: "lg",
      onChange: (next) => { mode = next; syncTrackFocusUrl(); repaint(); },
    }).root);
  };

  let directoryController: AbortController | null = null;
  function buildComparisonControls(closeAfterChange = false): HTMLElement[] {
    const references = document.createElement("div");
    references.className = "ds-filter-chips";
    references.setAttribute("role", "group");
    references.setAttribute("aria-label", localized("Reference Players", "Referentiespelers"));
    referenceNames.forEach((displayName, playerId) => {
      references.append(toggleChip({
        label: displayName, pressed: selectedPlayers.includes(playerId),
        onToggle: () => {
          toggleReference(playerId);
          if (closeAfterChange) closeSheet();
          repaint();
        },
      }));
    });
    const chosen = document.createElement("div");
    chosen.className = "ds-rank__chosen";
    for (const playerId of selectedPlayers) {
      chosen.append(removableChip({
        label: namedPlayers.get(playerId) ?? localized("Player", "Speler"),
        removeLabel: localized(`Remove ${namedPlayers.get(playerId) ?? "Player"} from the comparison`,
          `${namedPlayers.get(playerId) ?? "Speler"} uit de vergelijking halen`),
        onRemove: () => {
          selectedPlayers = selectedPlayers.filter((id) => id !== playerId);
          if (closeAfterChange) closeSheet();
          repaint();
        },
      }));
    }
    const search = document.createElement("input");
    search.type = "search";
    search.className = "ds-text-input";
    search.placeholder = localized("Search player name", "Zoek op spelersnaam");
    const searchResults = document.createElement("div");
    searchResults.className = "ds-filter-chips";
    search.addEventListener("input", () => {
      directoryController?.abort(); searchResults.replaceChildren();
      const query = search.value.trim();
      if (query.length < 2 || selectedPlayers.length >= 3) return;
      directoryController = new AbortController();
      void fetchRankPlayerDirectory(query, directoryController.signal).then((players) => {
        if (disposed || search.value.trim() !== query) return;
        for (const player of players.filter((row) => !selectedPlayers.includes(row.playerId))) {
          searchResults.append(toggleChip({
            label: player.displayName, pressed: false, onToggle: () => {
              addPlayer(player);
              if (closeAfterChange) closeSheet();
            },
          }));
        }
      }).catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
      });
    });
    return [
      references,
      chosen,
      field({
        label: localized("Search player name to compare", "Zoek een spelersnaam om te vergelijken"),
        control: search,
      }),
      searchResults,
    ];
  }
  const paintComparison = (): void => {
    comparisonSlot.replaceChildren(panel({
      title: localized("Comparison", "Vergelijking"),
      titleLevel: 2,
      note: localized(
        `Up to three Players or references. Chosen ${selectedPlayers.length}/3.`,
        `Maximaal drie spelers of referenties. Gekozen ${selectedPlayers.length}/3.`,
      ),
      children: buildComparisonControls(),
    }));
  };

  // ------------------------------------------------------------------ cards
  const standingHeadline = (rows: readonly TimeTrialStanding[]): HTMLElement | null => {
    const own = resolvedContext.standing;
    const standingBlock = (rank: number, playerCount: number): HTMLElement => {
      const block = statBlock({
        label: localized("Your standing", "Jouw plaats"),
        value: el("span", "ds-rank__hero-value", {},
          heroRank(rank, lang(), localized("Position", "Positie"))),
        note: localized(
          `of ${count(playerCount)} Players · total across ${count(scopedTrackCount())} tracks`,
          `van ${count(playerCount)} spelers · totaal over ${count(scopedTrackCount())} circuits`,
        ),
        size: "lg",
      });
      block.append(engineMark(mode));
      return block;
    };
    // R5: a standing never stands unlabelled beside another engine. The snapshot the account
    // carries is the 150cc one; at 200cc the figure comes from the standing on screen, which is the
    // same engine as everything else in the view.
    const blocks: HTMLElement[] = [];
    if (mode === 150 && own !== undefined && own.standing > 0) {
      blocks.push(standingBlock(own.standing, own.of));
      if (own.previousStanding !== undefined) {
        const movement = own.previousStanding - own.standing;
        blocks.push(statBlock({
          label: localized("Since last visit", "Sinds je vorige bezoek"),
          value: el("span", "ds-delta__value", {
            "data-direction": movement > 0 ? "faster" : movement < 0 ? "slower" : "even",
          }, movement === 0 ? "±0" : `${movement > 0 ? "+" : TRUE_MINUS}${count(Math.abs(movement))}`),
          note: movement > 0
            ? localized("places gained", "plaatsen gewonnen")
            : movement < 0 ? localized("places lost", "plaatsen verloren") : localized("no change", "geen verandering"),
        }));
      }
    } else if (ownStandingRow !== null) {
      blocks.push(standingBlock(ownStandingRow.rank, rows.length));
    }
    if (blocks.length === 0) { return null; }
    const result = panel({
      title: localized("Global Time Trial standing", "Wereldwijde Time Trial-stand"),
      titleLevel: 2,
      actions: [engineMark(mode, "lg")],
      children: [statGrid(blocks), el("p", "ds-rank__hero-explainer", {}, localized(
        `The global standing uses your total across ${count(scopedTrackCount())} tracks (${trackScope.toUpperCase()}).`,
        `De wereldwijde stand gebruikt je totaaltijd over ${count(scopedTrackCount())} circuits (${trackScope.toUpperCase()}).`,
      ))],
    });
    result.classList.add("ds-rank__headline-panel");
    return result;
  };

  const podiumFor = (rows: readonly TimeTrialStanding[]): HTMLElement | null => {
    const top = rows.filter((row) => !row.reference).slice(0, 3);
    if (top.length < 3) { return null; }
    return podiumStrip({
      label: localized("Podium", "Podium"),
      language: lang(),
      entries: top.map((row, index) => ({
        rank: index + 1,
        name: row.playerDisplayName,
        value: formatStandingTotal(row.totalTimeMs),
        href: `/?player=${encodeURIComponent(row.playerId)}`,
        ...(row.playerId === resolvedContext.viewerPlayerId
          ? { you: true, youLabel: localized("You", "Jij") }
          : {}),
      })),
    });
  };

  const playerCell = (row: TimeTrialStanding, withTier: boolean): HTMLElement => {
    const inner = document.createElement("span");
    inner.className = "ds-table__name-inner";
    if (row.reference) {
      const name = document.createElement("span");
      name.className = "ds-table__name-text";
      name.title = row.playerDisplayName;
      name.textContent = row.playerDisplayName;
      inner.append(name, chip(localized("reference · no rank", "referentie · geen positie"), "neutral"));
      return inner;
    }
    const link = document.createElement("a");
    link.className = "ds-table__name-text";
    link.href = `/?player=${encodeURIComponent(row.playerId)}`;
    link.title = row.playerDisplayName;
    link.textContent = row.playerDisplayName;
    inner.append(link);
    if (row.playerId === resolvedContext.viewerPlayerId) { inner.append(youChip(localized("You", "Jij"))); }
    if (withTier) {
      const label = masteryTierLabel(totalMasteryTier(row.totalTimeMs, mode, scopedTrackIds()));
      inner.append(tierChip(label, MASTERY_TIER_COLORS[label]));
    }
    return inner;
  };

  const compareButton = (row: TimeTrialStanding): HTMLElement => {
    const chosen = selectedPlayers.includes(row.playerId);
    const handle = button({
      label: chosen ? localized("Chosen", "Gekozen") : localized("Compare", "Vergelijk"),
      variant: "quiet", size: "sm",
      onPress: () => addPlayer({ playerId: row.playerId, displayName: row.playerDisplayName }),
    });
    handle.control.setAttribute("aria-label", chosen
      ? localized(`${row.playerDisplayName} is in the comparison`, `${row.playerDisplayName} staat in de vergelijking`)
      : localized(`Compare ${row.playerDisplayName}`, `Vergelijk ${row.playerDisplayName}`));
    if (!chosen && selectedPlayers.length >= 3) {
      handle.setDisabled(localized("Three Players is the limit.", "Drie spelers is het maximum."));
    }
    return handle.root;
  };

  const renderStandingTable = (rows: readonly TimeTrialStanding[], kind: "total" | "medals"): HTMLElement => {
    const own = rows.find((candidate) => candidate.playerId === resolvedContext.viewerPlayerId);
    const needle = standingFilter.trim().toLowerCase();
    const columns: DataColumn[] = kind === "total"
      ? [
        { key: "rank", label: "#", align: "rank", name: localized("Position", "Positie") },
        { key: "player", label: localized("Player", "Speler"), align: "name" },
        { key: "total", label: localized("Total", "Totaal"), align: "num", phone: 2 },
        { key: "average", label: localized("Average", "Gemiddeld"), align: "num", phone: "drop", tablet: "drop" },
        { key: "tracks", label: localized("Tracks", "Circuits"), align: "num", phone: "drop", tablet: "drop" },
        // Android's phone standing is deliberately just rank, identity and total. Delta and the
        // quick Compare affordance remain available on wider Web layouts; on a phone comparison
        // is selected in the same Filters / Comparison controls as the APK.
        { key: "delta", label: localized("vs you", "t.o.v. jou"), align: "delta", phone: "drop" },
        { key: "compare", label: localized("Compare", "Vergelijk"), align: "text", phone: "drop" },
      ]
      : [
        { key: "rank", label: "#", align: "rank", name: localized("Position", "Positie") },
        { key: "player", label: localized("Player", "Speler"), align: "name" },
        // The APK keeps the medal board as a real one-line table on a phone. Preserve those five
        // columns together; only the wider Web table gets its extra quick Compare action.
        { key: "gold", label: "\u{1F3C6}", name: localized("Gold", "Goud"), align: "num", phone: 1 },
        { key: "silver", label: "\u{1F948}", name: localized("Silver", "Zilver"), align: "num", phone: 1 },
        { key: "bronze", label: "\u{1F949}", name: localized("Bronze", "Brons"), align: "num", phone: 1 },
        { key: "compare", label: localized("Compare", "Vergelijk"), align: "text", phone: "drop" },
      ];
    const table = dataTable({
      caption: kind === "total"
        ? localized(`Time Trial standing · ${mode}cc`, `Time Trial-stand · ${mode}cc`)
        : localized(`Medal board · ${mode}cc`, `Medaillebord · ${mode}cc`),
      columns,
      rows: rows.map((row, index): DataRow => {
        const shownRank = row.reference ? 0 : kind === "medals" || !activeScopes.has("global") ? index + 1 : row.rank;
        const hidden = kind === "total" && needle.length > 0 &&
          !row.playerDisplayName.toLowerCase().includes(needle);
        const cells: (Node | string | null)[] = kind === "total"
          ? [
            row.reference ? "—" : formatRank(shownRank, lang()),
            playerCell(row, true),
            formatStandingTotal(row.totalTimeMs),
            formatTime(row.averageTimeMs),
            `${count(row.playedTracks)}/${count(scopedTrackCount())}`,
            own === undefined ? "—" : deltaValue(row.totalTimeMs - own.totalTimeMs),
            row.reference ? null : compareButton(row),
          ]
          : [
            row.reference ? "—" : formatRank(shownRank, lang()),
            playerCell(row, false),
            count(row.goldMedals), count(row.silverMedals), count(row.bronzeMedals),
            row.reference ? null : compareButton(row),
          ];
        return {
          cells,
          ...(row.reference ? { kind: "reference" as const }
            : row.playerId === resolvedContext.viewerPlayerId ? { kind: "you" as const } : {}),
          podium: shownRank,
          hidden,
          attributes: { "data-player-name": row.playerDisplayName.toLowerCase(), "data-rank": String(shownRank) },
        };
      }),
    });
    table.classList.add("ds-rank-standing");
    table.setAttribute("data-standing-kind", kind);
    return table;
  };

  /** The in-place name filter over the standing rows, beside them rather than above the page. */
  const standingFilterField = (): HTMLElement => {
    const filter = document.createElement("input");
    filter.type = "search";
    filter.className = "ds-text-input";
    filter.placeholder = localized("Filter player name", "Filter op spelersnaam");
    filter.value = standingFilter;
    filter.addEventListener("input", () => {
      standingFilter = filter.value;
      const needle = standingFilter.trim().toLowerCase();
      for (const row of content.querySelectorAll<HTMLElement>(".ds-table__row[data-player-name]")) {
        row.hidden = needle.length > 0 && !(row.dataset["playerName"] ?? "").includes(needle);
      }
    });
    return field({ label: localized("Filter player name", "Filter op spelersnaam"), control: filter });
  };

  const renderMastery = async (fallbackRows: readonly TimeTrialStanding[]): Promise<void> => {
    const requestedIds = selectedPlayers.length ? selectedPlayers : fallbackRows.slice(0, 3).map((row) => row.playerId);
    await ensureBests(requestedIds);
    const totalFor = (id: string): number => {
      const times = new Map((bestsCache.get(id) ?? []).filter((best) => best.mode === mode).map((best) => [best.trackId, best.totalTimeMs]));
      return scopedTracks().reduce((sum, track) => sum + (times.get(track.id) ?? MASTERY_UNPLAYED_FALLBACK_MS), 0);
    };
    const ids = sortComparisonIdsByTotal(requestedIds, totalFor, (id) => namedPlayers.get(id) ?? id);
    if (ids.length === 0) {
      content.append(emptyState({
        title: localized("No Player chosen yet", "Nog geen speler gekozen"),
        body: localized("Pick a Player or a reference above to see the level distribution.",
          "Kies hierboven een speler of referentie om de niveauverdeling te zien."),
      }));
      return;
    }
    const activeTrackIds = new Set(scopedTrackIds());
    const distribution = new Map(ids.map((id) => [id, MASTERY_TIER_LABELS.map((_label, tier) =>
      (bestsCache.get(id) ?? []).filter((best) =>
        best.mode === mode && activeTrackIds.has(best.trackId) &&
        trackMasteryTier(best.trackId, mode, best.totalTimeMs) === tier).length)]));
    const largestGroup = Math.max(1, ...Array.from(distribution.values()).flat());
    const table = dataTable({
      caption: localized(`Mastery distribution · ${mode}cc`, `Mastery-verdeling · ${mode}cc`),
      columns: [
        { key: "tier", label: localized("Level", "Niveau"), align: "name" },
        // All compared Players share the phone line (see the Delta per track table).
        ...ids.map((id): DataColumn => ({
          key: id, label: namedPlayers.get(id) ?? id, align: "bar", phone: 2,
        })),
      ],
      rows: MASTERY_TIER_LABELS.map((label, tier): DataRow => ({
        cells: [
          tierChip(label, MASTERY_TIER_COLORS[label]),
          ...ids.map((id) => {
            const driven = distribution.get(id)?.[tier] ?? 0;
            return valueBar({
              label: `${namedPlayers.get(id) ?? id} · ${label}`,
              value: count(driven),
              share: (driven / largestGroup) * 100,
              colour: MASTERY_TIER_COLORS[label],
            });
          }),
        ],
      })),
    });
    table.classList.add("ds-rank-mastery");
    table.setAttribute("data-comparison-columns", String(ids.length));
    const openMasteryHelp = (): void => {
      const percentage = (tier: number): string => {
        const fixed = ((MASTERY_WR_RATIOS[tier]! - 1) * 100).toFixed(2);
        return `+${localized(fixed, fixed.replace(".", ","))}%`;
      };
      const families = [
        { name: "Deity", tiers: [0] },
        { name: "Myth", tiers: [1, 2, 3] },
        { name: "Titan", tiers: [4, 5, 6] },
        { name: "Hero", tiers: [7, 8, 9] },
        { name: "Exp", tiers: [10, 11, 12] },
        { name: "Adv", tiers: [13, 14, 15] },
        { name: "Int", tiers: [16, 17, 18] },
        { name: "Beg", tiers: [19, 20, 21] },
      ] as const;
      const tiers = el("dl", "ds-rank-mastery-help__tiers", {});
      for (const family of families) {
        tiers.append(
          el("dt", "", {}, family.name),
          el("dd", "", {}, family.tiers.map((tier) => family.tiers.length === 1
            ? percentage(tier)
            : `${MASTERY_TIER_LABELS[tier]!.split(" ")[1]} ${percentage(tier)}`).join(" · ")),
        );
      }
      tiers.append(
        el("dt", "", {}, "Noob"),
        el("dd", "", {}, localized("anything slower", "alles wat langzamer is")),
      );
      const deityLimit = Math.round((90_000 * MASTERY_WR_RATIOS[0]!) / 100) * 100;
      const intALimit = Math.round((90_000 * MASTERY_WR_RATIOS[16]!) / 100) * 100;
      const intBLimit = Math.round((90_000 * MASTERY_WR_RATIOS[17]!) / 100) * 100;
      let overlay: OverlayHandle | null = null;
      const close = button({
        label: localized("Close", "Sluiten"), variant: "secondary",
        onPress: () => overlay?.close(),
      });
      overlay = dialog({
        title: localized("How does Mastery work?", "Hoe werkt Mastery?"),
        body: [
          el("p", "ds-body-s", {}, localized(
            "Mastery shows how close a Player's best time is to the current WR for that track and engine. Every level above Noob uses its own fixed WR offset; the same offsets apply to every track and engine.",
            "Mastery laat zien hoe dicht de beste tijd van een speler bij het actuele WR voor dat circuit en die klasse ligt. Elk niveau boven Noob gebruikt een eigen vaste WR-opslag; dezelfde opslagen gelden voor elk circuit en elke klasse.",
          )),
          tiers,
          el("p", "ds-rank-mastery__formula ds-data-s", {}, localized(
            "Tier limit = current WR × (1 + tier offset)",
            "Niveaudrempel = actueel WR × (1 + niveau-opslag)",
          )),
          el("div", "ds-rank-mastery-help__examples", {},
            el("p", "ds-rank-mastery-help__heading", {}, localized("Example · WR 1:30.000", "Voorbeeld · WR 1:30.000")),
            el("p", "ds-body-s", {}, localized(
              `Deity: 1:30.000 × 1.021225… = 1:31.910…, rounded to ${formatTime(deityLimit)}. So ${formatTime(deityLimit)} or faster is Deity.`,
              `Deity: 1:30.000 × 1,021225… = 1:31.910…, afgerond op ${formatTime(deityLimit)}. Dus ${formatTime(deityLimit)} of sneller is Deity.`,
            )),
            el("p", "ds-body-s", {}, localized(
              `Int B: Int A (${percentage(16)}) ends at ${formatTime(intALimit)}; Int B (${percentage(17)}) ends at ${formatTime(intBLimit)}. Int B is slower than ${formatTime(intALimit)} and at or below ${formatTime(intBLimit)}.`,
              `Int B: Int A (${percentage(16)}) eindigt op ${formatTime(intALimit)}; Int B (${percentage(17)}) eindigt op ${formatTime(intBLimit)}. Int B is langzamer dan ${formatTime(intALimit)} en maximaal ${formatTime(intBLimit)}.`,
            )),
          ),
          el("p", "ds-micro", {}, localized(
            "Offsets are shown to two decimals; limits use the full fixed ratios and are then rounded to 0.100 s. When a new WR is processed, every limit for that track and engine moves with it, so Mastery can change without a new personal best.",
            "Opslagen worden met twee decimalen getoond; drempels gebruiken de volledige vaste verhoudingen en worden daarna afgerond op 0,100 s. Als een nieuw WR wordt verwerkt, schuift elke drempel voor dat circuit en die klasse mee; Mastery kan dus veranderen zonder nieuwe persoonlijke beste tijd.",
          )),
        ],
        actions: [close.root],
      });
      overlay.root.classList.add("ds-rank-mastery-help");
      const title = overlay.root.querySelector<HTMLElement>(".ds-title");
      title?.setAttribute("tabindex", "-1");
      overlay.root.addEventListener("close", () => overlay?.root.remove(), { once: true });
      overlay.open();
      // A short phone viewport cannot show the full explanation. The dialog's only regular control
      // is its closing action, so the platform would otherwise focus it and open the overlay at the
      // bottom. Start at the labelled title instead; the dialog stays scrollable and still restores
      // focus to the info button when it closes.
      overlay.root.scrollTop = 0;
      title?.focus({ preventScroll: true });
    };
    const masteryHelp = button({
      label: localized("How does Mastery work?", "Hoe werkt Mastery?"),
      variant: "quiet", size: "sm", onPress: openMasteryHelp,
    });
    masteryHelp.control.classList.add("ds-rank-mastery__help");
    const distributionPanel = panel({
      title: localized("Mastery distribution", "Mastery-verdeling"),
      titleLevel: 2,
      note: localized(
        `${count(MASTERY_TIER_LABELS.length)} levels · driven tracks per level · longer bars mean more tracks`,
        `${count(MASTERY_TIER_LABELS.length)} niveaus · gereden circuits per niveau · langere balken betekenen meer circuits`,
      ),
      actions: [engineMark(mode, "lg"), masteryHelp.root],
      children: [table],
    });
    distributionPanel.classList.add("ds-rank__mastery-distribution");
    content.append(distributionPanel);
  };

  const masteryPanel = (): HTMLElement | null => {
    const own = ownStandingRow;
    if (own === null) { return null; }
    const tier = totalMasteryTier(own.totalTimeMs, mode, scopedTrackIds());
    const label = masteryTierLabel(tier);
    const nextDelta = nextTotalTierDeltaMs(own.totalTimeMs, mode, scopedTrackIds());
    const notes: HTMLElement[] = [];
    const note = (text: string): HTMLElement => {
      const line = document.createElement("p");
      line.className = "ds-body-s";
      line.textContent = text;
      return line;
    };
    notes.push(note(nextDelta !== null && tier > 0
      ? localized(
        `${TRUE_MINUS}${formatStandingTotal(nextDelta)} to ${masteryTierLabel(tier - 1)}`,
        `${TRUE_MINUS}${formatStandingTotal(nextDelta)} tot ${masteryTierLabel(tier - 1)}`,
      )
      : localized("Top of the recovered 23-level Mastery ladder.", "Bovenaan de herstelde Mastery-ladder van 23 niveaus.")));
    if (own.playedTracks < scopedTrackCount()) {
      notes.push(note(localized(
        "Mastery total uses 10:00.000 for each track not yet driven.",
        "Het Mastery-totaal rekent 10:00.000 voor elk circuit dat nog niet is gereden.",
      )));
    }
    return panel({
      title: "Mastery",
      titleLevel: 2,
      actions: [engineMark(mode, "lg"), tierChip(label, MASTERY_TIER_COLORS[label])],
      children: [
        statGrid([
          statBlock({ label: localized("Total", "Totaal"), value: formatStandingTotal(own.totalTimeMs), size: "lg" }),
          statBlock({
            label: localized("Tracks driven", "Gereden circuits"),
            value: `${count(own.playedTracks)}/${count(scopedTrackCount())}`,
          }),
          statBlock({
            label: localized(`${scopedTrackCount()}-track average`, `Gemiddelde over ${scopedTrackCount()} circuits`),
            value: formatTime(Math.round(own.totalTimeMs / scopedTrackCount())),
          }),
          statBlock({ label: localized("Current level", "Huidig niveau"), value: label }),
        ]),
        ...notes,
      ],
    });
  };

  const renderTracks = async (fallbackRows: readonly TimeTrialStanding[]): Promise<void> => {
    let ids = selectedPlayers.length
      ? selectedPlayers
      : fallbackRows.slice(0, 3).map((row) => row.playerId);
    const viewerId = resolvedContext.viewerPlayerId;
    if (trackFocus !== null && viewerId !== null) {
      const useStaffTarget = trackFocus === "staff-left" || trackFocus === "tracks-left";
      const useLeaderTarget = trackFocus === "near-record";
      if (useStaffTarget || useLeaderTarget) {
        const targetBests: TrackBest[] = useStaffTarget
          ? benchmarksByKind("nintendo_staff", mode).map((entry) => ({
            trackId: entry.trackId, mode: entry.mode, totalTimeMs: entry.timeMs, rank: 1,
          }))
          : (resolvedContext.focusRows ?? [])
            .filter((row) => row.mode === mode)
            .map((row) => ({ trackId: row.trackId, mode: row.mode, totalTimeMs: row.leaderBestMs, rank: 1 }));
        namedPlayers.set(HOME_FOCUS_TARGET_REFERENCE_ID, useStaffTarget ? "Nintendo Ghost" : "Track leader");
        bestsCache.set(HOME_FOCUS_TARGET_REFERENCE_ID, targetBests);
        ids = [viewerId, HOME_FOCUS_TARGET_REFERENCE_ID];
      } else {
        ids = [viewerId];
      }
    }
    await ensureBests(ids);
    const byPlayer = new Map(ids.map((id) => [id, new Map((bestsCache.get(id) ?? []).filter((best) => best.mode === mode).map((best) => [best.trackId, best]))]));
    const viewerBests = viewerId === null
      ? new Map<string, TrackBest>()
      : new Map((bestsCache.get(viewerId) ?? []).filter((best) => best.mode === mode).map((best) => [best.trackId, best]));
    const staffTimes = new Map(benchmarksByKind("nintendo_staff", mode).map((entry) => [entry.trackId, entry.timeMs]));
    const leaderTimes = new Map((resolvedContext.focusRows ?? []).filter((row) => row.mode === mode).map((row) => [row.trackId, row.leaderBestMs]));
    let visibleTracks = scopedTracks().filter((track) =>
      track.name.toLocaleLowerCase().includes(trackQuery.trim().toLocaleLowerCase()));
    if (trackFocus !== null) {
      visibleTracks = viewerId === null
        ? []
        : visibleTracks.filter((track) => {
          const best = viewerBests.get(track.id);
          const staffTimeMs = staffTimes.get(track.id);
          const leaderTimeMs = leaderTimes.get(track.id);
          return matchesRankTrackFocus(trackFocus!, {
            ...(best === undefined ? {} : { bestRank: best.rank, bestTimeMs: best.totalTimeMs }),
            ...(staffTimeMs === undefined ? {} : { staffTimeMs }),
            ...(leaderTimeMs === undefined ? {} : { leaderTimeMs }),
          });
        });
    }
    const trackDeltaFor = (trackId: string, playerId: string): number | null => {
      const values = ids.flatMap((id) => byPlayer.get(id)?.get(trackId)?.totalTimeMs ?? []);
      const own = byPlayer.get(playerId)?.get(trackId)?.totalTimeMs;
      return own === undefined || values.length === 0 ? null : own - Math.min(...values);
    };
    if (trackSortPlayerId) {
      visibleTracks = [...visibleTracks].sort((left, right) => {
        const leftDelta = trackDeltaFor(left.id, trackSortPlayerId!) ?? Number.POSITIVE_INFINITY;
        const rightDelta = trackDeltaFor(right.id, trackSortPlayerId!) ?? Number.POSITIVE_INFINITY;
        const result = leftDelta - rightDelta;
        return (trackSortDirection === "asc" ? result : -result) || left.name.localeCompare(right.name);
      });
    }
    const children: (Node | string | null)[] = [
      el("p", "ds-label ds-rank__track-mobile-heading", {}, localized(
        `Per-track comparison · ${mode}cc`,
        `Vergelijking per circuit · ${mode}cc`,
      )),
    ];
    if (trackFocus !== null) {
      const clearFocus = (): void => { trackFocus = null; syncTrackFocusUrl(); repaint(); };
      const clear = button({
        label: localized("Show all tracks", "Alle circuits tonen"),
        variant: "secondary", size: "sm",
        onPress: clearFocus,
      });
      const message = viewerId === null
        ? localized("Sign in to show your matching tracks.", "Meld je aan om jouw overeenkomende circuits te tonen.")
        : localized(
          `${rankTrackFocusLabel(trackFocus)} · ${count(visibleTracks.length)} matching ${visibleTracks.length === 1 ? "track" : "tracks"} · ${mode}cc`,
          `${rankTrackFocusLabel(trackFocus)} · ${count(visibleTracks.length)} overeenkomende ${visibleTracks.length === 1 ? "circuit" : "circuits"} · ${mode}cc`,
        );
      children.push(el("div", "ds-rank__track-focus-desktop", {}, statusMessage("info", message), clear.root));
      const mobileClear = button({
        label: localized("Show all tracks", "Alle circuits tonen"),
        variant: "quiet", size: "sm", onPress: clearFocus,
      });
      mobileClear.root.classList.add("ds-rank__track-focus-clear");
      children.push(el("div", "ds-rank__track-focus-mobile", {},
        el("div", "ds-rank__track-focus-copy", {},
          el("strong", "ds-title", {}, rankTrackFocusLabel(trackFocus)),
          el("span", "ds-body-s", {}, viewerId === null
            ? localized("Sign in to show your matching tracks.", "Meld je aan om jouw overeenkomende circuits te tonen.")
            : localized(
              `${count(visibleTracks.length)} matching ${visibleTracks.length === 1 ? "track" : "tracks"} · ${mode}cc`,
              `${count(visibleTracks.length)} overeenkomende ${visibleTracks.length === 1 ? "circuit" : "circuits"} · ${mode}cc`,
            )),
        ),
        mobileClear.root,
      ));
    }
    const filter = document.createElement("input");
    filter.type = "search";
    filter.className = "ds-text-input";
    filter.placeholder = localized("Search track", "Zoek circuit");
    filter.value = trackQuery;
    filter.addEventListener("input", () => { trackQuery = filter.value; repaint(); });
    children.push(field({ label: localized("Search track", "Zoek circuit"), control: filter }));
    children.push(el("p", "ds-rank__track-sort-hint", {}, localized(
      "Tap a Player column to sort by that Player's delta.",
      "Tik op een spelerskolom om op het verschil van die speler te sorteren.",
    )));
    const shortNameOf = (id: string): string => {
      const playerName = namedPlayers.get(id) ?? id;
      return id === NINTENDO_STAFF_REFERENCE_ID ? "NG"
        : id === WORLD_RECORD_REFERENCE_ID ? "WR"
          : id === HOME_FOCUS_TARGET_REFERENCE_ID ? (playerName === "Nintendo Ghost" ? "NG" : "#1")
            : playerName;
    };
    const columns: DataColumn[] = [
      {
        key: "track", label: localized("Track", "Circuit"), align: "name",
        sort: {
          direction: trackSortPlayerId === null ? (trackSortDirection === "asc" ? "ascending" : "descending") : "none",
          label: localized("Restore the canonical cup and track order", "Herstel de canonieke cup- en circuitvolgorde"),
          onSort: () => { trackSortPlayerId = null; trackSortDirection = "asc"; repaint(); },
        },
      },
      ...ids.map((id): DataColumn => ({
        key: id,
        label: shortNameOf(id),
        phoneLabel: `${namedPlayers.get(id) ?? id} gap`,
        name: namedPlayers.get(id) ?? id,
        align: "num",
        // Every compared Player shares the phone line, one equal column each (the APK grid and the
        // `data-comparison-columns` templates). A third Player on "line 3" was given the first
        // Player's grid column and painted over it.
        phone: 2,
        sort: {
          direction: trackSortPlayerId === id ? (trackSortDirection === "desc" ? "descending" : "ascending") : "none",
          label: localized(`${namedPlayers.get(id) ?? id}: sort tracks by gap`, `${namedPlayers.get(id) ?? id}: sorteer circuits op verschil`),
          onSort: () => {
            if (trackSortPlayerId === id) { trackSortDirection = trackSortDirection === "desc" ? "asc" : "desc"; }
            else { trackSortPlayerId = id; trackSortDirection = "desc"; }
            repaint();
          },
        },
      })),
    ];
    const rows: DataRow[] = visibleTracks.map((track) => {
      const values = ids.map((id) => byPlayer.get(id)?.get(track.id));
      const fastest = Math.min(...values.flatMap((best) => best ? [best.totalTimeMs] : []));
      const name = document.createElement("span");
      name.className = "ds-table__name-inner ds-rank-track";
      const link = document.createElement("a");
      link.className = "ds-table__name-text";
      link.href = `/?leaderboard=${encodeURIComponent(track.id)}&mode=${mode}`;
      link.title = localized(`${track.name} · ${mode}cc leaderboard`, `${track.name} · ${mode}cc ranglijst`);
      link.setAttribute("aria-label", link.title);
      link.textContent = track.name;
      const trackEngine = engineMark(mode);
      trackEngine.classList.add("ds-rank-track__engine");
      name.append(artThumb({
        src: `${GAME_ASSET_BASE}${track.previewPath}`,
        badge: `${GAME_ASSET_BASE}${track.cupIconPath}`,
        size: "sm",
      }), link, trackEngine);
      return {
        cells: [
          name,
          ...values.map((best, index) => {
            if (!best) { return "—"; }
            const cell = document.createElement("span");
            cell.className = "ds-rank__track-value";
            const time = document.createElement("span");
            time.className = "ds-table__num-inner";
            time.setAttribute("data-strong", "");
            time.textContent = formatTime(best.totalTimeMs);
            cell.append(time);
            if (trackFocus !== null && ids[index] === viewerId) {
              const rank = document.createElement("span");
              // Desktop keeps the useful absolute track rank, but Compose's phone
              // comparison cell is deliberately only time, delta and Mastery.
              rank.className = "ds-data-s ds-rank__track-position";
              rank.textContent = formatRank(best.rank, lang());
              cell.append(rank);
            }
            if (ids.length > 1) {
              const gap = best.totalTimeMs - fastest;
              const delta = deltaValue(gap);
              // The installed APK's per-track grid marks a shared fastest time as a
              // green +0.000 target; other Web delta surfaces keep their ±0.000 rule.
              if (gap === 0) { delta.textContent = "+0.000"; delta.setAttribute("data-direction", "faster"); }
              cell.append(delta);
            }
            const label = masteryTierLabel(trackMasteryTier(track.id, mode, best.totalTimeMs) ?? 22);
            cell.append(tierChip(label, MASTERY_TIER_COLORS[label]));
            return cell;
          }),
        ],
      };
    });
    children.push(rows.length === 0
      ? emptyState({
        title: localized("No track matches", "Geen circuit gevonden"),
        body: localized("Clear the filter or the focus to see every track again.",
          "Wis het filter of de focus om alle circuits weer te zien."),
      })
      : (() => {
        const table = dataTable({ caption: localized(`Gap per track · ${mode}cc`, `Verschil per circuit · ${mode}cc`), columns, rows });
        table.classList.add("ds-rank-tracks");
        table.setAttribute("data-comparison-columns", String(ids.length));
        // From 600 px a Player column is as wide as its widest time + gap + Mastery label (the
        // character count dataTable uses does not see the chip or the spacing between the parts).
        const contentWide = `minmax(9ch, 1fr) repeat(${ids.length}, max-content)`;
        table.style.setProperty("--ds-cols", contentWide);
        table.style.setProperty("--ds-cols-tablet", contentWide);
        if (ids.length > 1) {
          // dataTable writes its computed templates inline. Every comparison shares one phone
          // line, so replace auto-width tracks with one equal shrinkable track per Player before
          // any exact time is allowed to paint through its neighbour.
          const shared = `0px repeat(${ids.length}, minmax(0, 1fr))`;
          table.style.setProperty("--ds-cols-phone", shared);
          table.style.setProperty("--ds-cols-compact", shared);
        }
        return table;
      })());
    const trackPanel = panel({
      title: localized("Delta per track", "Verschil per circuit"),
      titleLevel: 2,
      note: localized(
        `${count(visibleTracks.length)} of ${count(scopedTrackCount())} tracks`,
        `${count(visibleTracks.length)} van ${count(scopedTrackCount())} circuits`,
      ),
      actions: [engineMark(mode, "lg")],
      children,
    });
    trackPanel.classList.add("ds-rank__track-panel");
    trackPanel.toggleAttribute("data-focused", trackFocus !== null);
    content.append(trackPanel);
  };

  const repaint = (): void => {
    void render().catch((error: unknown) => {
      if (disposed) { return; }
      if (error instanceof DOMException && error.name === "AbortError") { return; }
      content.replaceChildren(errorState({
        title: localized("The Time Trial Rank is temporarily unavailable.",
          "De Time Trial-rank is tijdelijk niet beschikbaar."),
        body: localized("Retry later; nothing you set has been lost.",
          "Probeer het later opnieuw; je instellingen zijn bewaard."),
      }));
      status.textContent = "";
    });
  };

  const render = async (): Promise<void> => {
    persistView();
    bestsUnavailable = false;
    container.setAttribute("data-tab", tab);
    container.setAttribute("data-scope", trackScope);
    container.removeAttribute("data-total-hero");
    paintTabs(); paintSummary(); paintEngine(); paintComparison();
    headline.replaceChildren();
    content.replaceChildren(skeleton(6, localized(`Loading ${mode}cc Rank…`, `${mode}cc Rank laden…`)));
    status.textContent = localized(`Loading ${mode}cc Rank…`, `${mode}cc Rank laden…`);
    const standingKey = `${mode}#${trackScope}`;
    let rows = standingsCache.get(standingKey);
    if (!rows) { rows = await load(mode, controller.signal, trackScope); standingsCache.set(standingKey, rows); }
    rows.forEach((row) => namedPlayers.set(row.playerId, row.playerDisplayName));
    const visible = visibleRows(rows);
    if (!selectedPlayers.length) {
      selectedPlayers = resolvedContext.viewerPlayerId
        ? [resolvedContext.viewerPlayerId]
        : [NINTENDO_STAFF_REFERENCE_ID];
      paintComparison();
    }
    content.replaceChildren();
    status.textContent = localized(
      `${count(visible.length)} Players · ${mode}cc · ${trackSetLabel()} · ${tab === "tracks"
        ? "sort by a Player column" : `total across ${count(scopedTrackCount())} tracks`}`,
      `${count(visible.length)} spelers · ${mode}cc · ${trackSetLabel()} · ${tab === "tracks"
        ? "sorteer op een spelerskolom" : `totaal over ${count(scopedTrackCount())} circuits`}`,
    );
    ownStandingRow = rows.find((row) => row.playerId === resolvedContext.viewerPlayerId) ?? null;
    if (resolvedContext.viewerPlayerId === null) {
      const signIn = document.createElement("a");
      signIn.className = "ds-button";
      signIn.setAttribute("data-variant", "secondary");
      signIn.setAttribute("data-size", "sm");
      signIn.href = "/?signin=1&return=%2F%3Franking%3Dtimetrials";
      signIn.textContent = localized("Sign in for rivals & Groups", "Meld je aan voor rivalen & groepen");
      headline.append(panel({
        title: localized("Public Rank", "Openbare Rank"),
        titleLevel: 2,
        note: localized(
          "Browse and compare without signing in. Nintendo Ghost is selected as the default reference.",
          "Bekijk en vergelijk zonder aan te melden. Nintendo-ghost is de standaardreferentie.",
        ),
        children: [signIn],
      }));
    }
    if (tab === "total" && activeScopes.has("global")) {
      const card = standingHeadline(rows);
      if (card !== null) { container.setAttribute("data-total-hero", ""); headline.append(card); }
    }
    if (tab === "mastery") {
      const card = masteryPanel();
      if (card !== null) { headline.append(card); }
    }
    if (tab === "total") {
      const referenceIds = selectedPlayers.filter((id) => referenceNames.has(id));
      await ensureBests(referenceIds);
      const incompleteReferences: string[] = [];
      const referenceRows = referenceIds.flatMap((id): TimeTrialStanding[] => {
        const coverage = referenceTotalCoverage(bestsCache.get(id) ?? [], mode, scopedTrackIds());
        if (coverage.totalTimeMs === null) {
          incompleteReferences.push(localized(
            `${namedPlayers.get(id) ?? id}: ${count(coverage.coveredTracks)}/${count(coverage.totalTracks)} valid ${mode}cc track times for ${trackSetLabel()}. Total needs one valid time per track.`,
            `${namedPlayers.get(id) ?? id}: ${count(coverage.coveredTracks)}/${count(coverage.totalTracks)} geldige ${mode}cc-circuittijden voor ${trackSetLabel()}. Totaal vereist één geldige tijd per circuit.`,
          ));
          return [];
        }
        const totalTimeMs = coverage.totalTimeMs;
        return [{ rank: 0, playerId: id, playerDisplayName: namedPlayers.get(id) ?? id, mode,
          totalTimeMs, averageTimeMs: Math.round(totalTimeMs / scopedTrackCount()), playedTracks: scopedTrackCount(),
          goldMedals: 0, silverMedals: 0, bronzeMedals: 0, reference: true }];
      });
      const podium = podiumFor(visible);
      const standingPanel = panel({
        title: localized("Time Trial standing", "Time Trial-stand"),
        titleLevel: 2,
        actions: [engineMark(mode, "lg")],
        children: [
          ...(visible.length === 0 && referenceRows.length > 0 ? [statusMessage("info", localized(
            "No community Players in this selection yet; references have no community rank.",
            "Nog geen communityspelers in deze selectie; referenties hebben geen communitypositie.",
          ))] : []),
          ...incompleteReferences.map((message) => statusMessage("info", message)),
          ...(visible.length + referenceRows.length === 0 ? [emptyState({
            title: localized("Nobody in this standing yet", "Nog niemand in deze stand"),
            body: incompleteReferences.length > 0
              ? localized("The selected references need a valid time on every track before Total can be shown.",
                "De geselecteerde referenties hebben op elk circuit een geldige tijd nodig voordat Totaal kan worden getoond.")
              : localized("Change the community or the track set to see more Players.",
                "Pas de community of de circuitset aan om meer spelers te zien."),
          })] : [podium, standingFilterField(), renderStandingTable([...visible, ...referenceRows], "total")]),
        ],
      });
      standingPanel.classList.add("ds-rank__standing-panel");
      standingPanel.setAttribute("data-standing-kind", "total");
      content.append(standingPanel);
    } else if (tab === "medals") {
      const medalsPanel = panel({
        title: localized("Global medals", "Wereldwijde medailles"),
        titleLevel: 2,
        actions: [engineMark(mode, "lg")],
        children: visible.length === 0
          ? [emptyState({ title: localized("No medals yet", "Nog geen medailles") })]
          : [renderStandingTable(sortMedalStandings(visible), "medals")],
      });
      medalsPanel.classList.add("ds-rank__standing-panel");
      medalsPanel.setAttribute("data-standing-kind", "medals");
      content.append(medalsPanel);
    } else if (tab === "mastery") {
      await renderMastery(visible);
    } else {
      if (ownStandingRow === null && resolvedContext.viewerPlayerId !== null) {
        content.append(statusMessage("info", localized(
          `No published ${mode}cc times yet — every track is still open.`,
          `Nog geen gepubliceerde ${mode}cc-tijden — elk circuit ligt nog open.`,
        )));
      }
      await renderTracks(visible);
    }
    if (bestsUnavailable) {
      content.append(statusMessage("warning", localized(
        "Some Players' per-track times could not be loaded; they are shown as not yet driven.",
        "Van sommige spelers konden de tijden per circuit niet worden geladen; die tellen als nog niet gereden.",
      )));
    }
  };

  const ready = context.then(async (value) => {
    resolvedContext = value;
    discardForeignView();
    if (initialView.scope === undefined && stored.scope === undefined) {
      trackScope = defaultTimeTrialTrackScope(value.trackAccess);
    }
    if ((value.modePreference === "150" || value.modePreference === "200") && initialView.mode === undefined) {
      mode = Number(value.modePreference) as 150 | 200;
    }
    if (value.rankScope !== undefined) {
      activeScopes = new Set([
        ...(value.rankScope.global ? ["global"] : []),
        ...(value.rankScope.rivals ? ["rivals"] : []),
        ...value.rankScope.groupIds.map((id) => `group:${id}`),
      ]);
      if (!activeScopes.size) activeScopes.add("global");
    }
    const records = await worldRecordsPromise;
    if (disposed) { return; }
    applyWorldRecordMasteryBaseline(records ?? []);
    await render();
    if (rememberedScrollY > 0 && trackFocus === null) {
      view?.requestAnimationFrame?.(() => view.scrollTo?.({ top: rememberedScrollY, behavior: "instant" }));
    }
  })
    .catch(() => {
      if (disposed) { return; }
      content.replaceChildren(errorState({
        title: localized("The Time Trial Rank is temporarily unavailable.",
          "De Time Trial-rank is tijdelijk niet beschikbaar."),
      }));
      status.textContent = "";
    });
  return {
    container,
    ready,
    unmount(): void {
      if (disposed) return;
      disposed = true;
      persistView();
      closeSheet();
      sheet?.root.remove();
      view?.removeEventListener("scroll", rememberScroll);
      directoryController?.abort();
      controller.abort();
      if (container.parentNode === root) root.removeChild(container);
    },
  };
}
