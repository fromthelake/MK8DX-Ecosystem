// W15 Community on the design system (Phase 12).
//
// LOW spectacle (DESIGN_SYSTEM §5): no art backdrop. The only pictures are the flags, which are the
// data. Four StatBlocks, two routes out, and the country distribution as the shared ProgressBar with
// its exact count printed beside it — a bar is never the only cue (§15).
//
// Engine context (ENGINE_CONTEXT_INVENTORY §6): "published Time Trials" is a genuinely
// engine-independent activity count, so it is labelled **Combined**. Today's
// `/v1/public/community` returns one summed number and no per-engine split, so the value says it is
// Combined and says the split is not published — it does not invent one. The breakdown needs a
// public-API change and is logged as class B.
import {
  combinedValue,
  cardLink,
  el,
  emptyState,
  errorState,
  panel,
  skeleton,
  statBlock,
  statGrid,
  valueBar,
} from "./ds-components.js";
import { formatCount, type NumberLanguage } from "./ds-numeric.js";
import {
  COUNTRY_ASSET_MANIFEST,
  GAME_ASSET_BASE,
  countryFlagPath,
} from "./asset-manifest.js";
import { localized, productLanguage } from "./product-language.js";

export type MountedCommunityView = Readonly<{
  container: HTMLElement;
  ready: Promise<void>;
  unmount(): void;
}>;

export type CommunityOverview = Readonly<{
  players: number;
  countries: readonly Readonly<{ countryId: string; players: number }>[];
  publishedTimeTrials: number;
  tournaments: number;
}>;

const countryNames = new Map(
  COUNTRY_ASSET_MANIFEST.map((country) => [country.id, country.name]),
);

export async function fetchCommunityOverview(
  signal: AbortSignal,
): Promise<CommunityOverview> {
  const response = await fetch("/v1/public/community", {
    method: "GET",
    headers: { Accept: "application/json" },
    credentials: "same-origin",
    mode: "same-origin",
    redirect: "error",
    referrerPolicy: "same-origin",
    cache: "no-store",
    signal,
  });
  if (response.status !== 200) {
    throw new Error("community overview unavailable");
  }
  const body = await response.json() as Record<string, unknown>;
  if (body["schemaVersion"] !== "mk8dx.public-community-overview.v1" ||
      !Array.isArray(body["countries"]) || body["countries"].length > 200) {
    throw new Error("community overview invalid");
  }
  const integer = (value: unknown): number => {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 0) {
      throw new Error("community overview invalid");
    }
    return parsed;
  };
  return {
    players: integer(body["players"]),
    publishedTimeTrials: integer(body["publishedTimeTrials"]),
    tournaments: integer(body["tournaments"]),
    countries: body["countries"].map((entry) => {
      const row = entry as Record<string, unknown>;
      if (typeof row["countryId"] !== "string" ||
          !/^country\.[a-z0-9_]+$/.test(row["countryId"])) {
        throw new Error("community overview invalid");
      }
      return { countryId: row["countryId"], players: integer(row["players"]) };
    }),
  };
}

export function mountCommunityView(
  root: HTMLElement,
  loadOverview: typeof fetchCommunityOverview = fetchCommunityOverview,
): MountedCommunityView {
  const controller = new AbortController();
  const language = (): NumberLanguage => productLanguage();
  let disposed = false;

  const container = el("div", "ds-root ds-community ds-stack", { "data-spectacle": "low" });
  const heading = el("h1", "ds-title", {}, localized("Community", "Community"));
  const lede = el("p", "ds-community__lede", {}, localized(
    "One community, country by country.", "Eén community, land voor land."));
  const status = el("p", "ds-community__status ds-micro", { role: "status" },
    localized("Loading community overview…", "Communityoverzicht wordt geladen…"));
  const body = el("div", "ds-stack", {},
    panel({
      title: localized("Country signal", "Landensignaal"), titleLevel: 2,
      children: [skeleton(5, localized("Loading the countries…", "De landen worden geladen…"))],
    }));
  container.append(heading, lede, status, body);
  root.append(container);

  const ready = loadOverview(controller.signal).then((overview) => {
    if (disposed) { return; }
    status.textContent = localized(
      "A live public snapshot of MK8DX participation.",
      "Een actuele publieke momentopname van de deelname aan MK8DX.");

    const summary = panel({
      title: localized("Participation", "Deelname"), titleLevel: 2,
      children: [statGrid([
        statBlock({
          label: localized("Players", "Spelers"),
          value: formatCount(overview.players, language()),
        }),
        statBlock({
          label: localized("Countries represented", "Vertegenwoordigde landen"),
          value: formatCount(overview.countries.length, language()),
        }),
        statBlock({
          label: localized("Published Time Trials", "Gepubliceerde tijdritten"),
          // Engine-independent activity (§6): Combined, and honest about the missing split.
          value: combinedValue({
            label: localized("Combined", "Samen"),
            total: formatCount(overview.publishedTimeTrials, language()),
            note: localized("150cc and 200cc together; the split is not published.",
              "150cc en 200cc samen; de verdeling wordt niet gepubliceerd."),
          }),
        }),
        statBlock({
          label: localized("Tournaments", "Toernooien"),
          value: formatCount(overview.tournaments, language()),
        }),
      ])],
    });

    const routes = el("nav", "ds-tiles", { "aria-label": localized(
      "Explore community performance", "Ontdek de prestaties van de community") },
      cardLink({
        href: "/?activity=1",
        title: localized("Activity log", "Activiteitenlogboek"),
        body: localized("Follow the latest published runs", "Volg de nieuwste gepubliceerde runs"),
      }),
      cardLink({
        href: "/?ranking=timetrials",
        title: localized("Time Trial ranking", "Tijdritklassement"),
        body: localized("Compare total and per-track pace", "Vergelijk totaal en tempo per circuit"),
      }));

    const visiblePlayers = overview.countries.reduce((total, country) => total + country.players, 0);
    const note = localized(
      "Countries appear when Players choose to show one — never inferred.",
      "Landen verschijnen als spelers er een tonen — nooit afgeleid.");
    const coverage = localized(
      `${formatCount(visiblePlayers, language())} of ${formatCount(overview.players, language())} Players share a country`,
      `${formatCount(visiblePlayers, language())} van ${formatCount(overview.players, language())} spelers delen een land`);

    let board: HTMLElement;
    if (overview.countries.length === 0) {
      board = panel({
        title: localized("Country signal", "Landensignaal"), titleLevel: 2, note: coverage,
        children: [
          emptyState({
            title: localized("No Players have set a country yet — be the first from yours.",
              "Nog geen speler heeft een land ingesteld — wees de eerste uit het jouwe."),
          }),
          el("p", "ds-micro", {}, note),
        ],
      });
    } else {
      const most = overview.countries[0]!.players;
      const list = el("ul", "ds-community__countries", {});
      for (const country of overview.countries) {
        const name = countryNames.get(country.countryId) ??
          country.countryId.replace(/^country\./, "").toUpperCase();
        const flagPath = countryFlagPath(country.countryId);
        const row = el("li", "ds-community__country", {});
        if (flagPath !== undefined) {
          row.append(el("img", "ds-flag", {
            src: `${GAME_ASSET_BASE}${flagPath}`, alt: "", loading: "lazy", "aria-hidden": "true",
          }));
        }
        const count = country.players === 1
          ? localized("1 Player", "1 speler")
          : localized(`${formatCount(country.players, language())} Players`,
            `${formatCount(country.players, language())} spelers`);
        row.append(
          el("span", "ds-community__name", { title: name }, name),
          valueBar({ label: name, value: count, share: most === 0 ? 0 : (country.players / most) * 100 }),
        );
        list.append(row);
      }
      board = panel({
        title: localized("Country signal", "Landensignaal"), titleLevel: 2, note: coverage,
        children: [list, el("p", "ds-micro", {}, note)],
      });
    }
    body.replaceChildren(summary, routes, board);
  }).catch(() => {
    if (disposed) { return; }
    status.textContent = "";
    body.replaceChildren(errorState({
      title: localized("The community overview is temporarily unavailable.",
        "Het communityoverzicht is tijdelijk niet beschikbaar."),
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
