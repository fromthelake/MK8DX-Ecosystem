// W14 Build — the kart configurator — on the design system (Phase 12).
//
// LOW spectacle (DESIGN_SYSTEM §5): no art backdrop, no accent surfaces. The part art IS the data,
// and so are the four part colours: the whole point of the meter is which part paid for a number,
// so the colour is the builder's key (slot edge, legend swatch, meter segment) and stays product
// data — the same decision the Android A05 pass took. Only the ink on it changed, and every segment
// still prints its own contribution.
//
// The configurator owns no A4: reading a build is the task, and "Share build" is secondary (§4, the
// matrix's "none (Share build secondary)"). Sharing is W35's build half — the permalink the address
// already carries, offered through the platform's own share sheet with a clipboard fallback.
//
// The part picker is the SAME picker the canonical Post-a-Time task uses (`ds-setup-picker.ts`):
// one sheet, one search, one grid, so a reader who has chosen a body once has chosen it everywhere.
import {
  button,
  chip,
  el,
  panel,
  setupSummary,
  statBlock,
  statGrid,
  statusMessage,
} from "./ds-components.js";
import { GAME_ASSET_BASE } from "./asset-manifest.js";
import {
  BODY_PARTS,
  CHARACTER_PARTS,
  GLIDER_PARTS,
  LOADOUT_STAT_MODEL,
  TIRE_PARTS,
  type LoadoutPart,
} from "./loadout-manifest.js";
import { matchedLoadoutVariant } from "./loadout-variants.js";
import { AVATAR_GROUPS } from "./avatar-manifest.js";
import { pickerCharacterName } from "./character-picker-names.js";
import { dutchPresentation } from "./dutch-ui-copy.js";
import { openPartPicker } from "./ds-setup-picker.js";
import { localized } from "./product-language.js";

export type MountedBuildConfigurator = Readonly<{
  container: HTMLElement;
  ready: Promise<void>;
  unmount(): void;
}>;

export type BuildSelection = Readonly<{
  character: LoadoutPart;
  body: LoadoutPart;
  tire: LoadoutPart;
  glider: LoadoutPart;
}>;

export type BuildMetaAssessment = Readonly<{
  groundSpeed: number;
  miniTurbo: number;
  optimum: boolean;
  meta: boolean;
  explanation: string;
}>;

const CHARACTER_OPTIONS: readonly LoadoutPart[] = AVATAR_GROUPS.flatMap((group) => {
  const base = CHARACTER_PARTS.find((part) => part.id === group.id);
  return base === undefined ? [] : [
    pickerCharacterName(base.id, base.name) === base.name ? base : { ...base, name: pickerCharacterName(base.id, base.name) },
    ...group.variants.map((variant) => ({ ...base, id: variant.id, name: variant.name, iconPath: variant.iconPath })),
  ];
});

const presentedIconPath = (part: LoadoutPart, characterId: string): string =>
  matchedLoadoutVariant(part.id, characterId)?.iconPath ?? part.iconPath;

/** The recovered original grouping: Speed and Handling per surface, everything else under Other. */
const STAT_SECTIONS: readonly Readonly<{
  title: Readonly<{ en: string; nl: string }>;
  rows: readonly Readonly<{ key: string; en: string; nl: string }>[];
}>[] = [
  {
    title: { en: "Speed", nl: "Snelheid" },
    rows: [
      { key: "speedLand", en: "Ground", nl: "Grond" },
      { key: "speedWater", en: "Water", nl: "Water" },
      { key: "speedGliding", en: "Air", nl: "Lucht" },
      { key: "speedAntiGravity", en: "Anti-Gravity", nl: "Antizwaartekracht" },
    ],
  },
  {
    title: { en: "Handling", nl: "Wegligging" },
    rows: [
      { key: "handlingLand", en: "Ground", nl: "Grond" },
      { key: "handlingWater", en: "Water", nl: "Water" },
      { key: "handlingGliding", en: "Air", nl: "Lucht" },
      { key: "handlingAntiGravity", en: "Anti-Gravity", nl: "Antizwaartekracht" },
    ],
  },
  {
    title: { en: "Other", nl: "Overig" },
    rows: [
      { key: "acceleration", en: "Acceleration", nl: "Acceleratie" },
      { key: "miniTurbo", en: "Mini-Turbo", nl: "Mini-Turbo" },
      { key: "weight", en: "Weight", nl: "Gewicht" },
      { key: "traction", en: "Traction", nl: "Grip" },
      { key: "invincibility", en: "Invincibility", nl: "Onkwetsbaarheid" },
    ],
  },
];

/**
 * The builder's key: which part paid for a number. Product data, not tokens — the meter's whole
 * point is the attribution, and the same four colours are the slot edge, the legend swatch and the
 * meter segment. The ink printed on a segment is chosen for contrast against it.
 */
export const BUILD_PART_COLORS = {
  character: { segment: "#FF9800", border: "#FFA726", text: "#111820", en: "Character", nl: "Coureur" },
  // Its ink is dark, not white: white on this blue is 3.1:1, which is how the legacy meter printed
  // it and what the Phase 12 browser gate caught on 13 segments per appearance.
  body: { segment: "#2196F3", border: "#42A5F5", text: "#08131F", en: "Body", nl: "Chassis" },
  tire: { segment: "#2ECC71", border: "#66BB6A", text: "#07150d", en: "Tires", nl: "Banden" },
  glider: { segment: "#9B27B0", border: "#AB47BC", text: "#ffffff", en: "Glider", nl: "Paraglider" },
} as const;

type Category = keyof typeof BUILD_PART_COLORS;
const CATEGORIES: readonly Category[] = ["character", "body", "tire", "glider"];

const PART_SETS: Readonly<Record<Category, readonly LoadoutPart[]>> = {
  character: CHARACTER_OPTIONS,
  body: BODY_PARTS,
  tire: TIRE_PARTS,
  glider: GLIDER_PARTS,
};

const CATEGORY_TITLES: Readonly<Record<Category, Readonly<{ en: string; nl: string }>>> = {
  character: { en: "Character", nl: "Coureur" },
  body: { en: "Body", nl: "Chassis" },
  tire: { en: "Tires", nl: "Banden" },
  glider: { en: "Glider", nl: "Paraglider" },
};

const PICKER_TITLES: Readonly<Record<Category, Readonly<{ en: string; nl: string }>>> = {
  character: { en: "Select character", nl: "Kies coureur" },
  body: { en: "Select body", nl: "Kies chassis" },
  tire: { en: "Select tires", nl: "Kies banden" },
  glider: { en: "Select glider", nl: "Kies paraglider" },
};

/**
 * The recovered original contribution semantics: a negative contribution displays as zero, the
 * composed total clamps at the effective cap, and the bar scale runs 0..cap. Unchanged.
 */
export function statContributions(
  selection: BuildSelection,
  key: string,
): Readonly<{ character: number; body: number; tire: number; glider: number; total: number }> {
  const character = Math.max(0, selection.character.stats[key] ?? 0);
  const body = Math.max(0, selection.body.stats[key] ?? 0);
  const tire = Math.max(0, selection.tire.stats[key] ?? 0);
  const glider = Math.max(0, selection.glider.stats[key] ?? 0);
  return {
    character, body, tire, glider,
    total: Math.min(character + body + tire + glider, LOADOUT_STAT_MODEL.effectiveCap),
  };
}

/** The documented additive model: contributions sum across the four parts, the value is capped. */
export function combinedStat(selection: BuildSelection, key: string): number {
  const sum = (selection.character.stats[key] ?? 0) + (selection.body.stats[key] ?? 0) +
    (selection.tire.stats[key] ?? 0) + (selection.glider.stats[key] ?? 0);
  return Math.min(sum, LOADOUT_STAT_MODEL.effectiveCap);
}

export function assessBuildMeta(selection: BuildSelection): BuildMetaAssessment {
  const groundSpeed = combinedStat(selection, "speedLand");
  const miniTurbo = combinedStat(selection, "miniTurbo");
  const optimum = Math.abs(groundSpeed + miniTurbo - 8) < 0.001 && groundSpeed <= miniTurbo;
  const meta = Math.abs(groundSpeed - 3.25) < 0.001 && Math.abs(miniTurbo - 4.75) < 0.001;
  const explanation = meta
    ? localized("The Meta: exactly 3.25 Ground Speed and 4.75 Mini-Turbo.",
      "De meta: precies 3.25 grondsnelheid en 4.75 Mini-Turbo.")
    : optimum
      ? localized("Optimum Build: Speed + Mini-Turbo is 8.00 and Speed does not exceed Mini-Turbo.",
        "Optimale combinatie: snelheid + Mini-Turbo is 8.00 en snelheid is niet hoger dan Mini-Turbo.")
      : localized(
        `Not optimum yet: Speed + Mini-Turbo is ${(groundSpeed + miniTurbo).toFixed(2)} (target 8.00)` +
          (groundSpeed > miniTurbo ? " and Speed is higher than Mini-Turbo." : "."),
        `Nog niet optimaal: snelheid + Mini-Turbo is ${(groundSpeed + miniTurbo).toFixed(2)} (doel 8.00)` +
          (groundSpeed > miniTurbo ? " en snelheid is hoger dan Mini-Turbo." : "."));
  return { groundSpeed, miniTurbo, optimum, meta, explanation };
}

export function buildPermalinkQuery(selection: BuildSelection): string {
  return [selection.character.id, selection.body.id, selection.tire.id, selection.glider.id].join(",");
}

export function parseBuildQuery(value: string | null): BuildSelection {
  const fallback: BuildSelection = {
    character: CHARACTER_OPTIONS[0]!, body: BODY_PARTS[0]!, tire: TIRE_PARTS[0]!, glider: GLIDER_PARTS[0]!,
  };
  if (value === null) { return fallback; }
  const ids = value.split(",");
  const find = (list: readonly LoadoutPart[], id: string | undefined): LoadoutPart | undefined =>
    id === undefined ? undefined : list.find((part) => part.id === id);
  return {
    character: find(CHARACTER_OPTIONS, ids[0]) ?? fallback.character,
    body: find(BODY_PARTS, ids[1]) ?? fallback.body,
    tire: find(TIRE_PARTS, ids[2]) ?? fallback.tire,
    glider: find(GLIDER_PARTS, ids[3]) ?? fallback.glider,
  };
}

export function mountBuildConfigurator(
  root: HTMLElement,
  initialQuery: string | null = null,
): MountedBuildConfigurator {
  let disposed = false;
  let selection = parseBuildQuery(initialQuery);

  const container = el("div", "ds-root ds-build ds-stack", { "data-spectacle": "low" });
  const kicker = el("p", "ds-kicker", {}, localized("Build", "Kart"));
  const heading = el("h1", "ds-display-6", {}, localized("MK8DX Kart Builder", "MK8DX-kartbouwer"));
  const lede = el("p", "ds-build__lede", {}, localized(
    "Choose every part and compare the real in-game stat contributions.",
    "Kies elk onderdeel en vergelijk de echte bijdragen aan de spelstatistieken."));
  const loadoutSlot = el("div", "ds-stack", {});
  const statsSlot = el("div", "ds-stack", {});
  const shareSlot = el("div", "ds-build__share ds-stack", {});
  container.append(kicker, heading, lede, loadoutSlot, statsSlot, shareSlot);
  root.append(container);

  const permalink = (): string => `/?build=${encodeURIComponent(buildPermalinkQuery(selection))}`;
  const partTitle = (category: Category): string =>
    localized(CATEGORY_TITLES[category].en, CATEGORY_TITLES[category].nl);
  const pickerTitle = (category: Category): string =>
    localized(PICKER_TITLES[category].en, PICKER_TITLES[category].nl);

  const shared = el("div", "ds-build__shared", {});
  const share = button({
    label: localized("Share build", "Combinatie delen"), variant: "secondary",
    onPress: () => {
      const url = `${globalThis.location.origin}${permalink()}`;
      const navigatorShare = (globalThis.navigator as Partial<Navigator> | undefined)?.share;
      if (typeof navigatorShare === "function") {
        navigatorShare.call(globalThis.navigator, { title: "MK8DX build", url }).catch(() => undefined);
        return;
      }
      globalThis.navigator?.clipboard?.writeText(url).then(() => {
        shared.replaceChildren(statusMessage("success",
          localized("Link copied.", "Link gekopieerd.")));
      }, () => undefined);
    },
  });
  shareSlot.append(share.root, shared);

  // ---------------------------------------------------------------- the four slots and the share
  const renderLoadout = (): void => {
    const summary = setupSummary({
      label: localized("Current loadout", "Huidige combinatie"),
      emptyName: "—",
      parts: CATEGORIES.map((category) => ({
        kind: partTitle(category),
        name: dutchPresentation(selection[category].name),
        art: `${GAME_ASSET_BASE}${presentedIconPath(selection[category], selection.character.id)}`,
      })),
      onOpen: (index) => {
        const category = CATEGORIES[index]!;
        openPartPicker({
          title: pickerTitle(category),
          parts: PART_SETS[category],
          value: selection[category].id,
          iconPathOf: (part) => presentedIconPath(part as LoadoutPart, selection.character.id),
          onChoose: (partId) => {
            if (disposed || partId === null) { return; }
            const chosen = PART_SETS[category].find((part) => part.id === partId);
            if (chosen === undefined) { return; }
            selection = { ...selection, [category]: chosen };
            update();
          },
        });
      },
    });
    // Each slot carries its part's colour as a 3 px edge — the builder's key, also the legend's
    // swatch and the meter's segment.
    CATEGORIES.forEach((category, index) => {
      const slot = summary.children[index] as HTMLElement | undefined;
      slot?.style.setProperty("--ds-build-part", BUILD_PART_COLORS[category].segment);
      slot?.setAttribute("data-build-part", category);
    });

    const loadout = panel({
      label: localized("Current loadout", "Huidige combinatie"),
      children: [summary],
    });
    loadout.classList.add("ds-build__loadout");
    loadoutSlot.replaceChildren(loadout);
  };

  // ---------------------------------------------------------------- the stats
  const renderStats = (): void => {
    const cap = LOADOUT_STAT_MODEL.effectiveCap;
    const assessment = assessBuildMeta(selection);

    const verdicts = el("div", "ds-cluster", { "data-gap": "sm" },
      chip(assessment.optimum
        ? localized("✓ Optimum Build", "✓ Optimale combinatie")
        : localized("✕ Not optimum", "✕ Niet optimaal"), assessment.optimum ? "success" : "neutral"),
      chip(assessment.meta
        ? localized("★ The Meta", "★ De meta")
        : localized("☆ Not The Meta", "☆ Niet de meta"), assessment.meta ? "warning" : "neutral"));

    const legend = el("ul", "ds-legend ds-build__legend", {});
    for (const category of CATEGORIES) {
      const swatch = el("span", "ds-build__swatch", { "aria-hidden": "true" });
      swatch.style.setProperty("--ds-build-part", BUILD_PART_COLORS[category].segment);
      legend.append(el("li", "ds-legend__item", {}, swatch,
        el("span", "", {}, localized(BUILD_PART_COLORS[category].en, BUILD_PART_COLORS[category].nl))));
    }

    const groups = el("div", "ds-build__groups", {});
    for (const section of STAT_SECTIONS) {
      const rows = el("div", "ds-build__rows", {});
      for (const row of section.rows) {
        const parts = statContributions(selection, row.key);
        const meter = el("div", "ds-build__meter", {
          role: "img",
          "aria-label": `${localized(row.en, row.nl)}: ${parts.total.toFixed(2)} / ${cap.toFixed(2)} — `
            + CATEGORIES.filter((category) => parts[category] > 0)
              .map((category) => `${localized(BUILD_PART_COLORS[category].en, BUILD_PART_COLORS[category].nl)} +${parts[category].toFixed(2)}`)
              .join(", "),
        });
        const fill = el("div", "ds-build__fill", {});
        fill.style.setProperty("--ds-build-share", `${(parts.total / cap * 100).toFixed(2)}%`);
        for (const category of CATEGORIES) {
          const value = parts[category];
          if (value <= 0) { continue; }
          const segment = el("span", "ds-build__segment", {
            title: `${localized(BUILD_PART_COLORS[category].en, BUILD_PART_COLORS[category].nl)} +${value.toFixed(2)}`,
          }, el("span", "ds-build__contribution", {}, value.toFixed(2)));
          segment.style.setProperty("flex-grow", String(value));
          segment.style.setProperty("--ds-build-part", BUILD_PART_COLORS[category].segment);
          segment.style.setProperty("--ds-build-ink", BUILD_PART_COLORS[category].text);
          fill.append(segment);
        }
        meter.append(fill);
        // A hairline at every whole point the scale reaches: 1 to 5 on the 5.75 cap (owner 2026-09-26:
        // 5.00 was missing, which is exactly where the strongest builds sit).
        for (let tick = 1; tick <= Math.floor(cap); tick += 1) {
          const mark = el("span", "ds-build__tick", {
            "aria-hidden": "true",
            "data-value": String(tick),
          });
          mark.style.setProperty("--ds-build-tick", `${(tick / cap * 100).toFixed(3)}%`);
          meter.append(mark);
        }
        rows.append(el("div", "ds-build__row", {},
          el("span", "ds-build__row-label", {}, localized(row.en, row.nl)),
          meter,
          el("span", "ds-data ds-build__row-value", {}, `${parts.total.toFixed(2)}/${cap.toFixed(2)}`)));
      }
      groups.append(el("section", "ds-build__group", {},
        el("h3", "ds-kicker ds-build__group-title", {}, localized(section.title.en, section.title.nl)),
        rows));
    }

    const stats = panel({
      title: localized("Build stats", "Kartstatistieken"), titleLevel: 2,
      children: [
          legend,
          statGrid([
            statBlock({
              label: localized("Speed", "Snelheid"),
              value: el("span", "ds-data-l", {}, assessment.groundSpeed.toFixed(2)),
            }),
            statBlock({
              label: "Mini-Turbo",
              value: el("span", "ds-data-l", {}, assessment.miniTurbo.toFixed(2)),
            }),
          ]),
          verdicts,
          el("p", "ds-build__explanation", {}, assessment.explanation),
          el("p", "ds-build__guide ds-body-s", {}, localized(
            "Meta target: combine any character, body, tires and glider that reach exactly 3.25 Ground Speed and 4.75 Mini-Turbo. Optimum alternatives follow the Magic 8 rule: both stats total 8.00 and Ground Speed is not higher than Mini-Turbo.",
            "Metadoel: combineer een coureur, chassis, banden en paraglider die samen precies 3.25 grondsnelheid en 4.75 Mini-Turbo bereiken. Optimale alternatieven volgen de Magic 8-regel: beide waarden zijn samen 8.00 en grondsnelheid is niet hoger dan Mini-Turbo.")),
          groups,
        ],
      });
    stats.classList.add("ds-build__stats");
    statsSlot.replaceChildren(stats);
  };

  const update = (): void => {
    renderLoadout();
    renderStats();
    globalThis.history?.replaceState?.(null, "", permalink());
  };

  update();

  return {
    container,
    ready: Promise.resolve(),
    unmount(): void {
      if (disposed) { return; }
      disposed = true;
      if (container.parentNode === root) { root.removeChild(container); }
    },
  };
}
