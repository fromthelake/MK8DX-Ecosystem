// W22 Legacy published Tournament `?tournament=` on the design system (Phase 12).
//
// LOW spectacle (DESIGN_SYSTEM §5): no art. This is the old publication view an old link still
// lands on, and **OD-04 keeps its safe default**: it stays reachable and shows what it always
// showed — its own "Segment N" vocabulary included — rather than redirecting somewhere that might
// not hold the same rows. Only how it is drawn changed: Panels, the shared DataTable, and the
// states every other migrated route uses.
//
// Nothing about the publication is touched (class C): the standings, their segments, their ranks
// and the counted/excluded flag per race are exactly the document the server sends.
import {
  chip,
  dataTable,
  el,
  emptyState,
  errorState,
  panel,
  skeleton,
  type DataRow,
} from "./ds-components.js";
import { formatCount, type NumberLanguage } from "./ds-numeric.js";
import {
  createTournamentPublicationClient,
  type TournamentPublicationClient,
} from "./tournament-publication-client.js";
import { schema9WebTrackCatalog } from "./schema9-track-catalog.js";
import { dutchPresentation } from "./dutch-ui-copy.js";
import { localized, productLanguage } from "./product-language.js";
import { tournamentRaceClassLabel } from "./tournament-race-class.js";

export type MountedPublicTournament = Readonly<{
  container: HTMLElement;
  ready: Promise<void>;
  unmount(): void;
}>;

const trackNames = new Map(schema9WebTrackCatalog.map((track) => [track.id, track.displayName]));
const trackLabel = (trackId: string): string =>
  dutchPresentation(trackNames.get(trackId) ?? trackId);

/**
 * A Player's published Tournament results on the Time Trials profile tab. This is the same calm
 * table grammar as the verified times above it; the publication link and all scoring values are
 * unchanged.
 */
export async function appendPublicPlayerTournaments(
  container: HTMLElement,
  playerId: string,
  client: TournamentPublicationClient,
  signal: AbortSignal,
): Promise<void> {
  const language = productLanguage();
  const body = el("div", "ds-stack", { "data-gap": "md" }, skeleton(3,
    localized("Loading published Tournaments", "Gepubliceerde toernooien laden")));
  container.append(panel({
    title: localized("Published Tournaments", "Gepubliceerde toernooien"),
    titleLevel: 2,
    note: localized(
      "Official published race results. Tournament scoring stays separate from engine-specific Time Trials.",
      "Officieel gepubliceerde raceresultaten. Toernooiscores blijven gescheiden van tijdritten per motorklasse.",
    ),
    children: [body],
  }));
  try {
    const results = await client.listPlayer(playerId, signal);
    if (results.length === 0) {
      body.replaceChildren(emptyState({
        title: localized("No published Tournament results yet.", "Nog geen gepubliceerde toernooiresultaten."),
      }));
    } else {
      body.replaceChildren(dataTable({
        caption: localized("Published Tournament results", "Gepubliceerde toernooiresultaten"),
        density: "dense",
        columns: [
          { key: "event", label: localized("Tournament", "Toernooi"), align: "name" },
          { key: "race", label: localized("Race", "Race"), phone: 2 },
          { key: "position", label: localized("Position", "Positie"), align: "rank", phone: 1 },
          { key: "points", label: localized("Points", "Punten"), align: "num", phone: 2 },
          { key: "total", label: localized("Total", "Totaal"), align: "num", phone: 3 },
        ],
        rows: results.map((result): DataRow => ({
          key: `${result.publicationId}:${result.scoringSegment}:${result.raceNumber}`,
          cells: [
            el("span", "ds-table__name-inner", {},
              el("a", "ds-table__name-text ds-link", {
                href: `/?tournament=${encodeURIComponent(result.publicationId)}`,
                title: result.eventName,
              }, result.eventName)),
            localized(
              `Segment ${formatCount(result.scoringSegment, language)}, race ${formatCount(result.raceNumber, language)} · ${trackLabel(result.trackId)}`,
              `Segment ${formatCount(result.scoringSegment, language)}, race ${formatCount(result.raceNumber, language)} · ${trackLabel(result.trackId)}`),
            formatCount(result.finishPosition, language),
            formatCount(result.racePoints, language),
            formatCount(result.totalAfterRace, language),
          ],
          podium: result.finishPosition,
        })),
      }));
    }
  } catch {
    body.replaceChildren(errorState({
      title: localized(
        "Published Tournament history is temporarily unavailable.",
        "De gepubliceerde toernooigeschiedenis is tijdelijk niet beschikbaar."),
    }));
  }
}

export function mountPublicTournament(
  root: HTMLElement,
  publicationId: string,
  client: TournamentPublicationClient = createTournamentPublicationClient(),
): MountedPublicTournament {
  const controller = new AbortController();
  const language = (): NumberLanguage => productLanguage();
  let disposed = false;

  const container = el("div", "ds-root ds-published ds-stack", { "data-spectacle": "low" });
  const heading = el("h1", "ds-title", {}, localized("Published Tournament", "Gepubliceerd toernooi"));
  const status = el("p", "ds-published__status ds-micro", { role: "status" },
    localized("Loading published standings…", "Gepubliceerde stand wordt geladen…"));
  const body = el("div", "ds-stack", {},
    skeleton(6, localized("Loading the standings…", "De stand wordt geladen…")));
  container.append(heading, status, body);
  root.append(container);

  const ready = client.loadPublic(publicationId, controller.signal).then((event) => {
    if (disposed) { return; }
    const lang = language();
    heading.textContent = event.eventName;
    status.textContent = localized(
      `Published ${new Date(event.publishedAtMs).toLocaleDateString("en-GB")}`,
      `Gepubliceerd op ${new Date(event.publishedAtMs).toLocaleDateString("nl-NL")}`);

    const segments = new Map<number, typeof event.standings>();
    for (const standing of event.standings) {
      segments.set(standing.scoringSegment, [...(segments.get(standing.scoringSegment) ?? []), standing]);
    }
    const panels: HTMLElement[] = [];
    for (const [segment, standings] of segments) {
      panels.push(panel({
        // OD-04: the old view's own vocabulary is kept, because an old link's reader knows it.
        title: localized(`Segment ${formatCount(segment, lang)} standings`,
          `Stand van segment ${formatCount(segment, lang)}`),
        titleLevel: 2,
        children: [dataTable({
          caption: localized(`Segment ${formatCount(segment, lang)} standings`,
            `Stand van segment ${formatCount(segment, lang)}`),
          columns: [
            { key: "rank", label: "#", name: localized("Position", "Positie"), align: "rank" },
            { key: "player", label: localized("Player", "Speler"), align: "name" },
            { key: "points", label: localized("Points", "Punten"), align: "num", phone: 2 },
          ],
          rows: standings.map((standing): DataRow => ({
            key: `${segment}:${standing.playerId}`,
            podium: standing.rank,
            cells: [
              `#${formatCount(standing.rank, lang)}`,
              el("span", "ds-table__name-inner", {},
                el("a", "ds-table__name-text ds-link", {
                  href: `/?player=${encodeURIComponent(standing.playerId)}`,
                  title: standing.playerDisplayName,
                }, standing.playerDisplayName)),
              el("span", "ds-table__num-inner", {}, formatCount(standing.totalPoints, lang)),
            ],
          })),
        })],
      }));
    }

    panels.push(panel({
      title: localized("Published races", "Gepubliceerde races"), titleLevel: 2,
      children: [event.races.length === 0
        ? emptyState({ title: localized("No races were published.", "Er zijn geen races gepubliceerd.") })
        : dataTable({
          caption: localized("Published races", "Gepubliceerde races"),
          columns: [
            // On a phone the track is the row identity. Give the verbose Segment/Race label its
            // own line; sharing line one made both strings visually overlap at 320 px even though
            // neither the document nor either cell overflowed its measured box.
            { key: "race", label: localized("Race", "Race"), align: "text", phone: 2 },
            { key: "track", label: localized("Track", "Circuit"), align: "name" },
            { key: "engine", label: localized("Engine class", "Motorklasse"), align: "text", phone: 3 },
            { key: "counted", label: localized("Standings", "Stand"), align: "text", phone: 3 },
          ],
          rows: event.races.map((race, index): DataRow => ({
            key: `race-${index}`,
            cells: [
              localized(`Segment ${formatCount(race.scoringSegment, lang)}, race ${formatCount(race.raceNumber, lang)}`,
                `Segment ${formatCount(race.scoringSegment, lang)}, race ${formatCount(race.raceNumber, lang)}`),
              el("span", "ds-table__name-inner", {},
                el("span", "ds-table__name-text", { title: trackLabel(race.trackId) }, trackLabel(race.trackId))),
              race.mode === undefined
                ? el("span", "ds-missing", {}, "–")
                : race.mirror === true
                  ? tournamentRaceClassLabel(race.mode, true)!
                  : `${formatCount(race.mode, lang)}cc`,
              race.countsTowardStandings
                ? chip(localized("Counted", "Geteld"), "success")
                : chip(localized("Excluded", "Uitgesloten"), "warning"),
            ],
          })),
        })],
    }));
    body.replaceChildren(...panels);
  }).catch(() => {
    if (disposed) { return; }
    status.textContent = "";
    body.replaceChildren(errorState({
      title: localized(
        "This Tournament is not published or is temporarily unavailable.",
        "Dit toernooi is niet gepubliceerd of tijdelijk niet beschikbaar."),
    }));
  });

  return {
    container,
    ready,
    unmount(): void {
      if (disposed) { return; }
      disposed = true;
      controller.abort();
      if (container.parentNode === root) { root.removeChild(container); }
    },
  };
}
