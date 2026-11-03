// W13 Records — the community record book — on the design system (Phase 12).
//
// MEDIUM spectacle (DESIGN_SYSTEM §5): the only art is the holders' own characters, which say who
// the record belongs to. Each category is a Panel with the shared PodiumStrip: the place is a
// numeral in the rank colour, never a medal emoji (§15, §17), and the value is printed beside the
// name.
//
// Engine context (ENGINE_CONTEXT_INVENTORY §6, R9). The register splits this page's four categories
// in two:
//   * "Most published times" is genuinely engine-independent activity → labelled **Combined**.
//     `/v1/public/record-book` returns one summed number and no per-engine split, so the panel says
//     it is Combined and says the split is not published. Inventing a breakdown would be a lie.
//   * "Most leaderboard #1s", "Most podiums" and "Widest track coverage" are COMPETITIVE metrics
//     that today sum across engine classes. The owner rule is to split them per engine, which needs
//     the API to compute them per engine (and R14's ranking fix with it). That is engine data, not
//     presentation: today's numbers are kept exactly as they are and each panel says in words that
//     it counts both engine classes together, so no reader takes a mixed number for a 150cc one.
//     Class B, logged in OVERNIGHT_MIGRATION_STATUS.
// Tournament champions is a Tournament-format record and carries no engine at all (§7).
import {
  chip,
  dataTable,
  el,
  emptyState,
  errorState,
  panel,
  podiumStrip,
  skeleton,
  type PodiumEntry,
  type DataRow,
} from "./ds-components.js";
import { formatCount, type NumberLanguage } from "./ds-numeric.js";
import { avatarAppearance } from "./avatar-manifest.js";
import {
  fetchTournamentStandings,
  tournamentChampions,
} from "./tournament-career.js";
import { GAME_ASSET_BASE } from "./asset-manifest.js";
import { CHARACTER_PARTS } from "./loadout-manifest.js";
import { loadoutVariantById } from "./loadout-variants.js";
import { localized, productLanguage } from "./product-language.js";

export type MountedRecordsView = Readonly<{
  container: HTMLElement;
  ready: Promise<void>;
  unmount(): void;
}>;

type RecordHolder = Readonly<{
  playerId: string;
  displayName: string;
  avatarId?: string;
  value: number;
}>;

export type RecordBook = Readonly<{
  categories: readonly Readonly<{
    key: string;
    holders: readonly RecordHolder[];
  }>[];
}>;

function tournamentCharacter(
  characterId: string | undefined,
  characterVariantId: string | undefined,
): Readonly<{ name: string; iconPath: string }> | undefined {
  const base = CHARACTER_PARTS.find((part) => part.id === characterId);
  if (base === undefined) { return undefined; }
  const variant = loadoutVariantById(characterVariantId);
  return variant?.baseId === base.id
    ? { name: `${base.name} · ${variant.name}`, iconPath: variant.iconPath }
    : { name: base.name, iconPath: base.iconPath };
}

/** What each category counts, and whether it pools the two engine classes (§6). */
type CategoryPresentation = Readonly<{
  title: Readonly<{ en: string; nl: string }>;
  note: Readonly<{ en: string; nl: string }>;
  /** "combined" = engine-independent activity; "mixed" = competitive, summed across engines today. */
  engines: "combined" | "mixed";
}>;

const CATEGORY_PRESENTATION: Readonly<Record<string, CategoryPresentation>> = {
  firsts: {
    title: { en: "Most leaderboard #1s", nl: "Meeste eerste plaatsen" },
    note: { en: "Tracks led.", nl: "Circuits aangevoerd." },
    engines: "mixed",
  },
  podiums: {
    title: { en: "Most podiums", nl: "Meeste podiumplaatsen" },
    note: { en: "Podium places.", nl: "Podiumplaatsen." },
    engines: "mixed",
  },
  published: {
    title: { en: "Most published times", nl: "Meeste gepubliceerde tijden" },
    note: {
      en: "Published Time Trials; the engine split is not available.",
      nl: "Gepubliceerde tijdritten; de verdeling per klasse is niet beschikbaar.",
    },
    engines: "combined",
  },
  coverage: {
    title: { en: "Widest track coverage", nl: "Breedste circuitdekking" },
    note: {
      en: "Track–engine combinations out of 192.",
      nl: "Circuit-klassecombinaties van de 192.",
    },
    engines: "mixed",
  },
};

export async function fetchRecordBook(signal: AbortSignal): Promise<RecordBook> {
  const response = await fetch("/v1/public/record-book", {
    method: "GET",
    headers: { Accept: "application/json" },
    credentials: "same-origin",
    mode: "same-origin",
    redirect: "error",
    referrerPolicy: "same-origin",
    cache: "no-store",
    signal,
  });
  if (response.status !== 200) { throw new Error("record book unavailable"); }
  const body = await response.json() as Record<string, unknown>;
  if (body["schemaVersion"] !== "mk8dx.public-record-book.v1" ||
      !Array.isArray(body["categories"]) || body["categories"].length > 8) {
    throw new Error("record book invalid");
  }
  return {
    categories: body["categories"].map((entry) => {
      const category = entry as Record<string, unknown>;
      if (typeof category["key"] !== "string" ||
          !Array.isArray(category["holders"]) ||
          category["holders"].length > 3) {
        throw new Error("record book invalid");
      }
      return {
        key: category["key"],
        holders: category["holders"].map((raw) => {
          const holder = raw as Record<string, unknown>;
          const value = Number(holder["value"]);
          if (typeof holder["playerId"] !== "string" ||
              typeof holder["displayName"] !== "string" ||
              !Number.isSafeInteger(value) || value < 1) {
            throw new Error("record book invalid");
          }
          return {
            playerId: holder["playerId"],
            displayName: holder["displayName"],
            ...(typeof holder["avatarId"] === "string"
              ? { avatarId: holder["avatarId"] }
              : {}),
            value,
          };
        }),
      };
    }),
  };
}

export function mountRecordsView(
  root: HTMLElement,
  loadRecordBook: typeof fetchRecordBook = fetchRecordBook,
  loadTournamentStandings: typeof fetchTournamentStandings = fetchTournamentStandings,
): MountedRecordsView {
  const controller = new AbortController();
  const language = (): NumberLanguage => productLanguage();
  let disposed = false;

  const container = el("div", "ds-root ds-records ds-stack", { "data-spectacle": "medium" });
  const heading = el("h1", "ds-title", {}, localized("Record book", "Recordboek"));
  const status = el("p", "ds-records__status ds-micro", { role: "status" },
    localized("Loading the record book…", "Het recordboek wordt geladen…"));
  const grid = el("div", "ds-records__grid", {});
  grid.append(panel({
    title: localized("Records", "Records"), titleLevel: 2,
    children: [skeleton(3, localized("Loading the records…", "De records worden geladen…"))],
  }));
  container.append(heading, status, grid);
  root.append(container);

  // The value in a podium cell is the exact number; the unit is the same for every holder, so it
  // belongs to the panel once rather than three times inside a cell that then cannot shrink.
  const holderEntries = (
    holders: readonly RecordHolder[], categoryKey: string,
  ): readonly PodiumEntry[] =>
    holders.map((holder, index) => {
      const appearance = avatarAppearance(holder.avatarId);
      return {
        rank: index + 1,
        name: holder.displayName,
        value: categoryKey === "coverage"
          ? `${formatCount(holder.value, language())} / 192`
          : formatCount(holder.value, language()),
        href: `/?player=${encodeURIComponent(holder.playerId)}`,
        ...(appearance === undefined ? {} : {
          art: `${GAME_ASSET_BASE}${appearance.iconPath}`,
          artShape: "square" as const,
        }),
      };
    });

  const ready = loadRecordBook(controller.signal).then((book) => {
    if (disposed) { return; }
    const populated = book.categories.filter((category) =>
      category.holders.length > 0 && CATEGORY_PRESENTATION[category.key] !== undefined);
    if (populated.length === 0) {
      status.textContent = "";
      grid.replaceChildren(emptyState({
        title: localized(
          "No records yet — the first published Time Trials will write them.",
          "Nog geen records — de eerste gepubliceerde tijdritten schrijven ze."),
      }));
      return;
    }
    status.textContent = localized(
      "Community Time Trial records · all values combine 150cc and 200cc.",
      "Tijdritrecords van de community · alle waarden combineren 150cc en 200cc.");
    const panels: HTMLElement[] = [];
    for (const category of populated) {
      const presentation = CATEGORY_PRESENTATION[category.key]!;
      const title = localized(presentation.title.en, presentation.title.nl);
      const categoryPanel = panel({
        title, titleLevel: 2,
        actions: presentation.engines === "combined"
          ? [chip(localized("Combined", "Samen"), "combined")]
          : [],
        note: localized(presentation.note.en, presentation.note.nl),
        children: [podiumStrip({
          label: title, language: language(),
          entries: holderEntries(category.holders, category.key),
        })],
      });
      categoryPanel.classList.add("ds-records__category");
      panels.push(categoryPanel);
    }
    grid.replaceChildren(...panels);

    // Tournament champions from the imported legacy history (derived standings, owner-validated).
    // Non-blocking; absence stays silent, exactly as before.
    void loadTournamentStandings(controller.signal).then((sections) => {
      if (disposed) { return; }
      const champions = tournamentChampions(sections);
      if (champions.length === 0) { return; }
      const rows: DataRow[] = champions.map((champion) => {
        const character = tournamentCharacter(
          champion.characterId, champion.characterVariantId);
        const characterCell = character === undefined
          ? el("span", "ds-records__champion-character-missing", {}, "—")
          : el("span", "ds-records__champion-character", { title: character.name },
            el("img", "ds-records__champion-character-icon", {
              src: `${GAME_ASSET_BASE}${character.iconPath}`,
              alt: "",
              width: "40",
              height: "40",
            }),
            el("span", "ds-records__champion-character-name", {}, character.name));
        return {
          cells: [
            `TN${formatCount(champion.tournamentNumber, language())}`,
            characterCell,
            el("span", "ds-table__name-inner", {},
              el("a", "ds-link ds-table__name-text ds-records__champion-name", {
                href: `/?player=${encodeURIComponent(champion.playerId)}`,
                title: champion.displayName,
              }, champion.displayName)),
            formatCount(champion.points, language()),
          ],
        };
      });
      const championsTable = dataTable({
        caption: localized("Tournament champions", "Toernooikampioenen"),
        density: "dense",
        columns: [
          { key: "night", label: "TN", align: "rank" },
          { key: "character", label: localized("Character", "Personage"), phone: 2 },
          { key: "player", label: localized("Player", "Speler"), align: "name" },
          { key: "points", label: localized("Pts", "Pnt"), align: "num", phone: 1 },
        ],
        rows,
      });
      championsTable.classList.add("ds-records__champions");
      const championsPanel = panel({
        title: localized("Tournament champions", "Toernooikampioenen"), titleLevel: 2,
        note: localized("One per finalized night.", "Eén per afgeronde avond."),
        children: [championsTable],
      });
      championsPanel.classList.add("ds-records__champions-panel");
      grid.append(championsPanel);
    }).catch(() => undefined);
  }).catch(() => {
    if (disposed) { return; }
    status.textContent = "";
    grid.replaceChildren(errorState({
      title: localized("The record book is temporarily unavailable.",
        "Het recordboek is tijdelijk niet beschikbaar."),
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
