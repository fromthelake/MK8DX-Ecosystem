import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";


const appRoot = fileURLToPath(new URL("../", import.meta.url));
const pageStyle = readFileSync(`${appRoot}styles/ds-workflows.css`, "utf8");
const pageHtml = readFileSync(`${appRoot}index.html`, "utf8");
const activitySource = readFileSync(`${appRoot}src/ds-activity.ts`, "utf8");
const activityModel = readFileSync(`${appRoot}src/activity-stories.ts`, "utf8");
const systemStyle = readFileSync(`${appRoot}styles/ds-components.css`, "utf8");
// The track thumb is one implementation shared by Activity, the public result
// view and the inbox, so the markup it guarantees is asserted where it lives.
const trackThumbSource = readFileSync(`${appRoot}src/track-thumb.ts`, "utf8");

describe("web product style", () => {
  it("keeps product assets outside the TypeScript build", () => {
    // Design-system stylesheets (styles/ds-*.css) are guarded by tooling/design-system/css-metrics.mjs.
    // The language catalogs (styles/i18n-*.json) are guarded by product-catalog-coverage.test.ts.
    expect(readdirSync(`${appRoot}styles`).filter((name) => !name.startsWith("ds-") && !name.startsWith("i18n-")).sort()).toEqual([
      "app-icon-192.png",
      "app-icon-512.png",
      "app-icon-manifest.json",
      "app-icon-maskable-192.png",
      "app-icon-maskable-512.png",
      // The Seating & Standings Manager's original export, vendored (identifiers renamed) for the classic
      // WordPress export (CLASSIC_EXPORT_PROVENANCE.md). Read by tournament-report-classic.ts only;
      // the CSS is text the old code inlines into its file, not a stylesheet of this site.
      "classic-report-catalog.json",
      "classic-report-export-css.txt",
      "classic-report-export.js",
      "mk8dx_ns1.png",
      "mk8dx_ns2.png",
      "tournament-stories.json",
    ]);
    expect(readdirSync(appRoot).sort()).toContain("index.html");
    expect(readdirSync(appRoot).sort()).not.toContain("public");
    expect(pageHtml).toContain('href="./styles/ds-workflows.css"');
    expect(pageHtml).not.toContain('product-page.css');
    expect(pageHtml).not.toContain('manual-entry.css');
    expect(pageHtml).toContain(
      '<link rel="icon" href="./styles/app-icon-192.png" type="image/png">',
    );
    expect(pageHtml).toContain('src="./dist/main.js"');
    expect(pageHtml).toContain("Content-Security-Policy");
    const brand = JSON.parse(readFileSync(`${appRoot}styles/app-icon-manifest.json`, "utf8")) as
      { outputs: readonly { file: string; sha256: string }[] };
    expect(brand.outputs.map((icon) => icon.file)).toEqual([
      "app-icon-192.png", "app-icon-512.png", "app-icon-maskable-192.png", "app-icon-maskable-512.png",
    ]);
    for (const icon of brand.outputs) {
      expect(createHash("sha256").update(readFileSync(`${appRoot}styles/${icon.file}`)).digest("hex"))
        .toBe(icon.sha256);
    }
    expect(brand.outputs[1]?.sha256).toBe("556fd24449fbd6694b79936ede9520d8ffb9413d79e4d2c0eb00550792214be2");
  });

  it("keeps every semantically hidden component out of layout and the accessibility tree", () => {
    // Author display rules outrank the user-agent `[hidden]` rule. Without this contract, Overview
    // laid out all five data-heavy sections, a denied Web-Push button remained unnamed to axe, and
    // an empty retirement chip stole width from every exact Time Trial value.
    expect(systemStyle).toContain(".ds-root [hidden] { display: none; }");
  });

  it("anchors every cup badge over track artwork at the top left", () => {
    // Phase 12 retired the feed's own badge rules; the inbox and the public board still draw one.
    for (const className of ["activity-list__cup"]) {
      const rule = pageStyle.match(new RegExp(`\\.${className}\\s*\\{([^}]+)\\}`))?.[1];
      expect(rule).toContain("left:");
      expect(rule).not.toContain("right:");
    }
    // The board's art is the design system's ArtHero/ArtThumb since Phase 9; the badge keeps the
    // product's own anchor rather than inventing a second convention.
    for (const className of ["ds-hero__thumb-badge", "ds-thumb__badge"]) {
      const rule = systemStyle.match(new RegExp(`\\.${className}\\s*\\{([^}]+)\\}`))?.[1];
      expect(rule).toContain("inset: var(--ds-space-xxs) auto auto var(--ds-space-xxs);");
    }
  });

  it("keeps Home and track identity artwork at their canonical proportions", () => {
    // Phase 10: Home's focus cards are the design system's FocusTile and its art is ArtThumb, so
    // the proportions are a component contract rather than a route rule.
    expect(pageStyle).not.toContain(".home-focus__art");
    const thumbRule = systemStyle.match(/\.ds-thumb__art \{([^}]+)\}/)?.[1];
    expect(thumbRule).toContain("aspect-ratio: 16 / 9");
    expect(thumbRule).toContain("object-fit: cover");
    const homeModule = readFileSync(`${appRoot}src/ds-home.ts`, "utf8");
    expect(homeModule).toContain("previewPath");

    // The track's own art is the ArtHero's since Phase 9: a fixed 16/9 frame with the cup badge
    // over it, so a preview can neither stretch nor crop its cup away.
    const heroArt = systemStyle.match(/\.ds-hero__thumb-art \{([^}]+)\}/)?.[1];
    expect(heroArt).toContain("aspect-ratio: 16 / 9");
    expect(heroArt).toContain("object-fit: cover");
    const squareHeroArt = systemStyle.match(
      /\.ds-hero__thumb\[data-shape="square"\] \.ds-hero__thumb-art \{([^}]+)\}/,
    )?.[1];
    expect(squareHeroArt).toContain("aspect-ratio: 1 / 1");
    expect(squareHeroArt).toContain("object-fit: contain");
    const squarePodiumArt = systemStyle.match(
      /\.ds-podium__art\[data-shape="square"\] \{([^}]+)\}/,
    )?.[1];
    expect(squarePodiumArt).toContain("height: 44px");
    expect(squarePodiumArt).toContain("object-fit: contain");
    expect(homeModule).toContain('thumb: { src: options.brandSrc, shape: "square" }');
    expect(homeModule).toContain('shape: "square" as const');
  });

  // Phase 12 retired the `.page-shell--tracks-control` layer this test pinned. The directory's
  // track cards are the design system's Card + ArtThumb, so the proportion is one component
  // contract shared with Home's focus tiles and the board's hero — not a per-route width.
  it("keeps Cup track artwork on the one art contract", () => {
    expect(pageStyle).not.toContain("page-shell--tracks-control");
    expect(pageStyle).not.toContain("cups-view");
    const thumbRule = systemStyle.match(/\.ds-thumb__art \{([^}]+)\}/)?.[1];
    expect(thumbRule).toContain("aspect-ratio: 16 / 9");
    expect(thumbRule).toContain("object-fit: cover");
    const cupsModule = readFileSync(`${appRoot}src/ds-cups.ts`, "utf8");
    expect(cupsModule).toContain("cardLink({");
    expect(cupsModule).toContain("badge:");
  });

  it("keeps the phone cup chooser on the Android four-column grid", () => {
    expect(systemStyle).toMatch(
      /@media \(max-width: 599px\)[\s\S]*?\.ds-cups__grid \{[\s\S]*?grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/u,
    );
    expect(systemStyle).toMatch(
      /\.ds-cups__cup-name \{[\s\S]*?white-space: normal;[\s\S]*?overflow-wrap: anywhere;/u,
    );
  });

  it("keeps the phone cup detail full-width with its labelled search and two track columns", () => {
    expect(systemStyle).toContain('.ds-cups:is([data-view="detail"], [data-view="search"]) { margin-inline: -12px; }');
    expect(systemStyle).toContain('.ds-cups:is([data-view="detail"], [data-view="search"]) .ds-cups__controls { padding-inline: 0; }');
    expect(systemStyle).toMatch(/\.ds-cups__tracks \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/u);
    expect(systemStyle).not.toContain('.ds-cups[data-view="detail"] .ds-cups__controls { display: none; }');
  });

  it("keeps phone track-search results full-width and close to their count", () => {
    expect(systemStyle).toContain('.ds-cups:is([data-view="detail"], [data-view="search"]) { margin-inline: -12px; }');
    expect(systemStyle).toContain('.ds-cups[data-view="search"] .ds-cups__status { margin-top: 12px; }');
    expect(systemStyle).toContain('.ds-cups[data-view="search"] > .ds-stack { margin-top: 0; }');
  });

  it("keeps Tournament track comparisons compact and their Win percentage readable", () => {
    const thumbRule = pageStyle.match(
      /\.track-record__row > \.activity-list__thumb \{([^}]+)\}/,
    )?.[1];
    expect(thumbRule).toContain("width: 10rem");
    expect(pageStyle).toMatch(
      /@media \(max-width: 599px\)[\s\S]*?\.track-record__row > \.activity-list__thumb \{[\s\S]*?width: 6rem/u,
    );
    expect(pageStyle).toContain(".track-record__row .activity-list__track-label { display: none; }");
    expect(systemStyle).toContain(".ds-rank--tournament .track-record .ds-panel__title {");
    expect(systemStyle).toContain(".ds-rank--tournament .track-record__hint { display: none; }");
    expect(systemStyle).toContain(".ds-rank--tournament .track-record__deep-dive-phone-title {");
    expect(systemStyle).toContain(".ds-rank--tournament .track-record__note--desktop { display: none; }");
    expect(systemStyle).toContain("width: 720px; table-layout: fixed");
    expect(systemStyle).toContain(".ds-rank--tournament .track-record__share { display: none; }");
    expect(systemStyle).toContain(".ds-rank--tournament .track-record__track-mode::before { content: \"› 150cc\"; }");
    expect(systemStyle).toContain(".ds-tournament-competitors .ds-table__cell[data-key=\"share\"] {");
    expect(systemStyle).toContain(".ds-tournament-competitors .ds-table__cell[data-key=\"shared\"]::after { content: \" races\"; }");
    expect(systemStyle).toContain(".ds-tournament-finishes .ds-chart__column { min-width: 0;");
    expect(systemStyle).toContain(".ds-tournament-outcomes > .ds-table { display: none; }");
    expect(systemStyle).toContain("grid-template-columns: 72px minmax(0, 1fr) 78px");
    expect(systemStyle).toContain(".ds-tournament-points > .ds-table { display: none; }");
    expect(systemStyle).toContain("grid-template-columns: 72px minmax(0, 1fr) 44px");
    expect(systemStyle).toContain(".ds-rank--tournament .track-record__name {");
    expect(systemStyle).toMatch(/\.ds-rank--tournament \.track-record__name \{[^}]*white-space: normal;/u);
    const winRule = pageStyle.match(
      /\.track-record__table \.track-record__win \{([^}]+)\}/,
    )?.[1];
    expect(winRule).toContain("color: var(--ds-personal-on-accent)");
    const cupIconRule = pageStyle.match(/\.track-record__cup-icon \{([^}]+)\}/)?.[1];
    expect(cupIconRule).toContain("display: inline-block");
  });

  // Phase 9 retired the `.page-shell--track-control` layer this test pinned. The same guarantee —
  // a combo icon that keeps its proportions, a readable flag, a reachable evidence link — is now a
  // design-system contract on the board's own components.
  it("keeps board art proportional and its links reachable", () => {
    expect(pageStyle).not.toContain("page-shell--track-control");
    const systemStyle = readFileSync(`${appRoot}styles/ds-components.css`, "utf8");
    expect(systemStyle).toContain(".ds-combo__icon { height: 18px; width: auto; }");
    expect(systemStyle).toContain(".ds-flag { flex: none; width: 20px; height: auto;");
    expect(systemStyle).toMatch(/\.ds-evidence__link \{[^}]*min-height: var\(--ds-target-min-dense\)/u);
    expect(systemStyle).toContain("@media (pointer: coarse) { .ds-link, .ds-evidence__link { min-height: var(--ds-target-min); } }");
    expect(systemStyle).toContain(".ds-track .ds-hero__thumb { width: 12rem; }");
    expect(systemStyle).toContain(".ds-track .ds-hero__thumb-badge { width: 2.5rem; height: 2.5rem; }");
  });

  it("keeps the complete Home focus track identity visible", () => {
    // The tile ellipsises nothing away: the label, the origin prefix and the track name each keep
    // their own place, and the three tiles reflow instead of shrinking (§12).
    expect(systemStyle).toContain(".ds-tiles { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--ds-space-md); }");
    expect(systemStyle).toContain("@media (min-width: 600px) { .ds-tiles { grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr)); } }");
    expect(systemStyle).toMatch(/\.ds-focus__name \{[^}]*text-overflow: ellipsis/u);
    const homeModule = readFileSync(`${appRoot}src/ds-home.ts`, "utf8");
    expect(homeModule).toContain('nl: "Dichtstbijzijnde rivaal"');
    expect(homeModule).toContain('localized("Your focus", "Je focus")');
  });

  it("keeps the phone inbox on the Android card canvas and action row", () => {
    expect(systemStyle).toMatch(/\.ds-notifications-page \{\s*width: 100vw;\s*max-width: none;/u);
    expect(systemStyle).toContain('.ds-notifications .notifications__item[data-unread] {\n      background: var(--ds-surface-raised);');
    expect(systemStyle).toContain('box-shadow: inset 3px 0 0 var(--ds-action-primary)');
    expect(systemStyle).toContain('.ds-notifications .notifications__actions { flex-wrap: nowrap; }');
    expect(systemStyle).toContain('font-size: var(--ds-type-title-size); line-height: var(--ds-type-title-line);');
  });

  it("keeps Tournament track names visible instead of ellipsising the action", () => {
    const wrapRule = systemStyle.match(
      /\.ds-tstats__cell-name \.ds-button-wrap \{([^}]+)\}/u,
    )?.[1];
    const labelRule = systemStyle.match(
      /\.ds-tstats__cell-name \.ds-button__label \{([^}]+)\}/u,
    )?.[1];
    expect(wrapRule).toContain("overflow: visible");
    expect(labelRule).toContain("white-space: normal");
    expect(labelRule).toContain("overflow-wrap: anywhere");
    expect(labelRule).not.toContain("text-overflow");
    expect(labelRule).not.toContain("overflow: hidden");
    expect(systemStyle).toMatch(/@media \(max-width: 359px\)[\s\S]*?\.ds-tstats__cell-name \{ grid-column: 2 \/ -1; \}/u);
    const statisticsSource = readFileSync(`${appRoot}src/tournament-statistics-view.ts`, "utf8");
    expect(statisticsSource).toContain('key: "best", label: columnLabel("best"), align: "text", phone: 3, compact: "drop"');
  });

  it("gives narrow Ranking identities and comparison values separate grid space", () => {
    const standingSource = readFileSync(`${appRoot}src/time-trial-standing-view.ts`, "utf8");
    // One equal phone column per compared Player, all on one line: a third Player once took
    // the first Player's grid column and painted over it.
    expect(standingSource).toContain("const shared = `0px repeat(${ids.length}, minmax(0, 1fr))`;");
    expect(standingSource).toContain('table.style.setProperty("--ds-cols-phone", shared)');
    expect(standingSource).not.toContain("phone: index === 2 ? 3 : 2");
    expect(systemStyle).toMatch(
      /\.ds-rank__track-value \{[\s\S]*?display: grid;[\s\S]*?justify-items: end;/u,
    );
    expect(systemStyle).toContain(".ds-tournament-standing__scroll {");
    expect(systemStyle).toContain("max-width: 100%; overflow-x: auto;");
    expect(systemStyle).toContain("grid-template-columns: 28px 220px 60px 46px 50px 46px 48px 48px;");
    expect(systemStyle).toContain('.ds-tournament-standing .ds-table__cell[data-key="pick"] {');
    expect(systemStyle).toContain('.ds-tournament-standing .ds-table__cell[data-align="num"] { text-align: right; }');
    expect(systemStyle).toContain('.ds-tournament-standing .ds-table__row[data-compare-series="3"]');
    expect(systemStyle).toContain('.ds-rank__tabs .ds-tabs { flex-wrap: wrap; overflow-x: visible; }');
    expect(systemStyle).toContain('.ds-rank__tabs { order: 3; margin-top: var(--ds-space-md); }');
    expect(systemStyle).toMatch(
      /\.ds-rank__summary \.ds-filter-summary__label,[\s\S]*?\.ds-rank__summary \.ds-filter-summary__value \{[\s\S]*?font-weight: 400;/u,
    );
    expect(systemStyle).toMatch(
      /\.ds-rank__track-panel > \.ds-panel__header,[\s\S]*?display: none;/u,
    );
    expect(systemStyle).toMatch(
      /\.ds-rank__track-focus-mobile \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\) auto;/u,
    );
    expect(standingSource).toContain(
      'rank.className = "ds-data-s ds-rank__track-position"',
    );
    expect(systemStyle).toContain(
      '.ds-rank-tracks[data-comparison-columns="2"] .ds-table__row {\n      grid-template-columns: 6rem repeat(2, minmax(0, 1fr));',
    );
    expect(systemStyle).toContain(
      'grid-template-columns: 6rem minmax(0, 1fr);\n      min-height: 4.25rem;\n      padding: 0;',
    );
    expect(systemStyle).toContain(
      '.ds-rank-track .ds-thumb[data-size="sm"] { width: 100%; }',
    );
    expect(systemStyle).toContain('.ds-rank__track-position { display: none; }');
    expect(systemStyle).not.toContain('.ds-rank-track .ds-thumb__image');
    expect(systemStyle).toMatch(
      /\.ds-rank__headline-panel \{[\s\S]*?border: 0;[\s\S]*?background: transparent;/u,
    );
  });

  it("keeps the mobile medal board on the APK's five-column composition", () => {
    expect(systemStyle).toContain(
      'grid-template-columns: .45fr 1.6fr repeat(3, .5fr);',
    );
    expect(systemStyle).toContain(
      '.ds-rank-standing[data-standing-kind="medals"] { row-gap: var(--ds-space-sm); }',
    );
    expect(systemStyle).toMatch(
      /\.ds-rank__standing-panel\[data-standing-kind="medals"\] \{[\s\S]*?gap: var\(--ds-space-sm\);[\s\S]*?padding: var\(--ds-space-md\);[\s\S]*?border: 0;/u,
    );
    expect(systemStyle).toMatch(
      /\.ds-rank-standing\[data-standing-kind="medals"\] \.ds-table__row \{[\s\S]*?padding: 0;[\s\S]*?border-bottom: 0;[\s\S]*?box-shadow: none;/u,
    );
    expect(systemStyle).toContain(
      '.ds-rank-standing[data-standing-kind="medals"] .ds-table__cell { text-align: left; }',
    );
    expect(systemStyle).toContain(
      '.ds-rank-standing[data-standing-kind="medals"] .ds-table__cell[data-key="gold"] { color: var(--ds-text-primary); }',
    );
    expect(systemStyle).toContain(
      '.ds-rank-standing[data-standing-kind="medals"] .ds-you-chip { display: none; }',
    );
  });

  // Phase 12: the activity feed is the design system's StoryCard, whose art is the shared ArtThumb,
  // so the track's artwork and its cup badge are one component contract instead of a route rule.
  // `trackThumb` itself stays: the inbox and the Tournament track section still draw it.
  it("shows track artwork and its cup identity in Community Activity", () => {
    expect(trackThumbSource).toContain("tt-standing__track-label");
    expect(trackThumbSource).toContain("tt-standing__track-copy");
    expect(trackThumbSource).toContain("asset.cup.name");
    expect(trackThumbSource).toContain("if (asset === undefined)");
    expect(activitySource).toContain("art: { src: `${GAME_ASSET_BASE}${asset.previewPath}`, badge:");
    expect(pageStyle).not.toContain("page-shell--activity-control");
    const thumbRule = systemStyle.match(/\.ds-thumb__art \{([^}]+)\}/)?.[1];
    expect(thumbRule).toContain("aspect-ratio: 16 / 9");
    expect(thumbRule).toContain("object-fit: cover");

    // What the compact Home list used to express in eleven route rules is now the StoryCard's own
    // contract: the rank and the engine class are marks beside the name, the mushrooms, coins and
    // combo are a session's own recorded facts behind its Disclosure, and the publication-time
    // position is explained once on the page rather than in a hidden column head.
    expect(activitySource).toContain("engineMark(story.mode");
    expect(activitySource).toContain("formatRank(story.rank.after");
    expect(activitySource).toContain("activityLapCoinDeltas");
    expect(activitySource).toContain("activityLapMushroomValues");
    expect(activitySource).toContain("position when the run was published");
    expect(activitySource).toContain("activityOutcome(item)");
    expect(systemStyle).toContain('.ds-story[data-outcome="won"]');
    expect(systemStyle).toContain('.ds-story[data-outcome="lost"]');
    expect(systemStyle).toContain('.ds-story[data-outcome="none"] { box-shadow: none; }');
    expect(systemStyle).toContain("var(--ds-delta-faster)");
    expect(systemStyle).toContain("var(--ds-delta-slower)");
    expect(pageStyle).not.toContain(".activity--compact");
    expect(pageStyle).not.toContain("activity__source-label");
  });

  it("keeps Home activity inside the aggregate request budget", () => {
    // The rank a session shows is the immutable publication-time snapshot the activity document
    // already carries. Neither the model nor either feed may fan out one leaderboard request per
    // track and engine class to recover it.
    for (const source of [activitySource, activityModel]) {
      expect(source).not.toContain("resolveActivityRunRanks");
      expect(source).not.toContain("createPublicTimeTrialClient");
    }
    expect(activityModel).toContain("runRank?: number;");
    expect(activitySource).toContain("story.rank?.after");
  });

});
