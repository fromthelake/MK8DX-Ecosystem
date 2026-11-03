// A Player's published Time Trials, as the public profile lists them.
//
// The per-track leaderboard that used to live here is the design system's own board since Phase 9
// (`ds-track-board.ts`, W07): one engine selector, DataTable rows, WR and Nintendo-ghost reference
// rows, the viewer's own row, and the entry that opens the canonical Post-a-Time task. What is left
// in this file is the profile's result list and the owner's management hook on it (W25/W26, Phase 13).
import {
  type PublicTimeTrialClient,
  type PublicTimeTrialResult,
} from "./public-time-trial-client.js";
import { schema9WebTrackCatalog } from "./schema9-track-catalog.js";
import { GAME_ASSET_BASE, trackAsset } from "./asset-manifest.js";
import {
  createPlayerClaimClient,
  type PlayerClaimClient,
} from "./player-claim-client.js";
import {
  artThumb,
  dataTable,
  el,
  emptyState,
  engineMark,
  panel,
  statusMessage,
  useDocument,
  type DataRow,
} from "./ds-components.js";
import { localized, productLocaleTag } from "./product-language.js";

const trackNames = new Map(schema9WebTrackCatalog.map((track) => [track.id, track.displayName]));

function time(milliseconds: number): string {
  const minutes = Math.floor(milliseconds / 60_000);
  const seconds = Math.floor((milliseconds % 60_000) / 1_000);
  const millis = milliseconds % 1_000;
  return `${minutes}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

function resultRow(
  result: PublicTimeTrialResult,
): Readonly<{
  row: DataRow;
  actions: HTMLElement;
  applied: (totalTimeMs: number, retired: boolean) => void;
}> {
  const asset = trackAsset(result.trackId);
  const href = `/?${new URLSearchParams({
    leaderboard: result.trackId,
    mode: String(result.mode),
  }).toString()}`;
  const actions = el("span", "ds-profile-results__actions", {});
  const track = el("span", "ds-table__name-inner ds-profile-results__identity", {},
    el("a", "ds-profile-results__track ds-link", { href, title: trackNames.get(result.trackId) ?? result.trackId },
      asset === undefined ? null : artThumb({
        src: `${GAME_ASSET_BASE}${asset.previewPath}`,
        badge: `${GAME_ASSET_BASE}${asset.cup.iconPath}`,
        size: "sm",
      }),
      el("span", "ds-table__name-text", {}, trackNames.get(result.trackId) ?? result.trackId)));
  const total = el("span", "ds-table__num-inner", {}, time(result.totalTimeMs));
  const retirementMark = el("span", "ds-chip", { "data-tone": "warning" });
  retirementMark.hidden = true;
  const timeCell = el("span", "ds-profile-results__time", {}, total, retirementMark);
  // After the Player corrects or retires their own result the row must
  // agree with what they just did, without a page reload.
  const applied = (totalTimeMs: number, retired: boolean): void => {
    total.textContent = time(totalTimeMs);
    retirementMark.textContent = retired ? localized("Retired", "Ingetrokken") : "";
    retirementMark.hidden = !retired;
  };
  return {
    row: {
      key: result.resultId,
      cells: [
        track,
        engineMark(result.mode, "plain"),
        timeCell,
        new Date(result.resultAtMs).toLocaleDateString(productLocaleTag()),
        actions,
      ],
    },
    actions,
    applied,
  };
}

export type PublicPlayerTimeTrialsOptions = Readonly<{
  claimClient?: Pick<PlayerClaimClient, "listMine">;
  attachManagement?: (
    actions: HTMLElement,
    submissionId: string,
    applied: (totalTimeMs: number, retired: boolean) => void,
  ) => Readonly<{ unmount(): void }>;
}>;

export async function appendPublicPlayerTimeTrials(
  container: HTMLElement,
  playerId: string,
  client: PublicTimeTrialClient,
  signal: AbortSignal,
  options: PublicPlayerTimeTrialsOptions = {},
): Promise<void> {
  const document = container.ownerDocument;
  useDocument(document);
  const body = el("div", "ds-stack", { "data-gap": "md" },
    statusMessage("info", localized("Loading verified Time Trials…", "Geverifieerde tijdritten laden…")));
  container.append(panel({
    title: localized("Verified Time Trials", "Geverifieerde tijdritten"),
    titleLevel: 2,
    note: localized(
      "Each result stays in its own engine class. Open a track to see its current leaderboard.",
      "Elk resultaat blijft in zijn eigen motorklasse. Open een circuit voor het huidige klassement.",
    ),
    children: [body],
  }));
  const rows: [
    PublicTimeTrialResult,
    HTMLElement,
    (totalTimeMs: number, retired: boolean) => void,
  ][] = [];
  try {
    const response = await client.listPlayer(playerId, signal);
    const tableRows: DataRow[] = [];
    for (const result of response.results) {
      const rendered = resultRow(result);
      tableRows.push(rendered.row);
      rows.push([result, rendered.actions, rendered.applied]);
    }
    if (response.results.length === 0) {
      body.replaceChildren(emptyState({
        title: localized("No verified Time Trials yet.", "Nog geen geverifieerde tijdritten."),
        body: localized(
          "Published results will appear here in their own engine class.",
          "Gepubliceerde resultaten verschijnen hier in hun eigen motorklasse.",
        ),
      }));
    } else {
      body.replaceChildren(dataTable({
        caption: localized("Verified Time Trial results", "Geverifieerde tijdritresultaten"),
        density: "timing",
        columns: [
          { key: "track", label: localized("Track", "Circuit"), align: "name" },
          { key: "engine", label: localized("Engine", "Motorklasse"), phone: 1 },
          { key: "time", label: localized("Time", "Tijd"), align: "num", phone: 2 },
          { key: "date", label: localized("Driven", "Gereden"), phone: 3, tablet: "drop" },
          { key: "manage", label: localized("Manage", "Beheren"), phone: 3 },
        ],
        rows: tableRows,
      }));
    }
  } catch {
    body.replaceChildren(statusMessage("error", localized(
      "Public Time Trial history is temporarily unavailable.",
      "De openbare tijdritgeschiedenis is tijdelijk niet beschikbaar.",
    )));
  }
  // "Manage" belongs to the Player looking at their OWN results. The check
  // is a non-blocking enrichment AFTER the public history has rendered, so
  // an anonymous visitor — or an unreachable session — never delays or
  // changes the public profile.
  const attach = options.attachManagement;
  if (attach === undefined || rows.length === 0) { return; }
  const claimClient = options.claimClient ?? createPlayerClaimClient();
  const own = await claimClient.listMine(signal).then(
    (claims) => claims.find(
      (claim) => claim.claimStatus === "verified")?.playerId ?? null,
    () => null,
  );
  if (own !== playerId) { return; }
  for (const [result, actions, applied] of rows) {
    attach(actions, result.resultId, applied);
  }
}
