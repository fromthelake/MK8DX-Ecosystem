// CSS architecture metrics for the design-system migration (docs/design-system/LEGACY_RETIREMENT.md).
//
//   node tooling/design-system/css-metrics.mjs                 print metrics as JSON
//   node tooling/design-system/css-metrics.mjs --write-baseline store tooling/design-system/baseline/css-metrics.json
//   node tooling/design-system/css-metrics.mjs --check          budget + lint gate against the baseline
//
// The gate (IMPLEMENTATION_PLAN §0): total CSS bytes may not grow; legacy files may not gain
// colour literals, breakpoints, !important or state-modifier classes; system files (styles/ds-*.css)
// may contain no colour literals or breakpoint literals except the generated token file.
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
const stylesDir = join(repo, "apps/timetrials-web/styles");
const scannerCss = join(repo, "apps/timetrials-scanner-web/src/app/app.css");
const baselineFile = join(here, "baseline/css-metrics.json");
const GENERATED = new Set(["ds-tokens.css"]);
const NEWLINE = String.fromCharCode(10);

const HEX = /#[0-9a-fA-F]{3,8}\b/g;
const RGB = /\brgba?\(/g;
const IMPORTANT = /!important/g;
const MEDIA = /@media[^{]*\{/g;
const WIDTH = /(min|max)-width:\s*([0-9.]+)(rem|px|em)/g;
const STATE_CLASS = /\.[A-Za-z0-9_-]+--(active|selected|current)\b/g;
const CUSTOM_DEF = /(^|[;{\s])(--[A-Za-z0-9_-]+)\s*:/g;
const FONT_SIZE = /font-size\s*:\s*([^;}]+)/g;
const PAGE_SHELL = /\.page-shell--([a-z0-9-]+)/g;

function metricsOf(text) {
  const count = (re) => (text.match(re) ?? []).length;
  const distinct = (re, pick = (m) => m[0].toLowerCase()) => new Set([...text.matchAll(re)].map(pick)).size;
  // Breakpoints are the widths in @media preludes (a min-width property on an element is a size).
  const widths = new Set([...text.matchAll(MEDIA)].flatMap((media) => [...media[0].matchAll(WIDTH)].map((m) => `${m[2]}${m[3]}`)));
  const shells = {};
  for (const m of text.matchAll(PAGE_SHELL)) shells[m[1]] = (shells[m[1]] ?? 0) + 1;
  return {
    bytes: Buffer.byteLength(text),
    lines: text.split("\n").length,
    ruleBlocks: count(/\{/g),
    hexLiterals: count(HEX),
    hexDistinct: distinct(HEX),
    rgbCalls: count(RGB),
    important: count(IMPORTANT),
    mediaQueries: count(MEDIA),
    breakpointWidths: [...widths].sort(),
    stateModifierClasses: distinct(STATE_CLASS),
    customPropertyDefinitions: count(CUSTOM_DEF),
    fontSizeDeclarations: count(FONT_SIZE),
    fontSizeDistinct: distinct(FONT_SIZE, (m) => m[1].trim()),
    pageShellLayers: shells,
  };
}

export function collect() {
  const files = {};
  for (const name of readdirSync(stylesDir).filter((n) => n.endsWith(".css")).sort()) {
    files[name] = metricsOf(readFileSync(join(stylesDir, name), "utf8"));
  }
  let scanner = null;
  try { scanner = metricsOf(readFileSync(scannerCss, "utf8")); } catch { scanner = null; }
  const legacy = Object.entries(files).filter(([n]) => !n.startsWith("ds-"));
  const system = Object.entries(files).filter(([n]) => n.startsWith("ds-"));
  const sum = (entries, key) => entries.reduce((s, [, m]) => s + m[key], 0);
  return {
    measuredAt: new Date().toISOString(),
    totals: {
      webCssBytes: sum(Object.entries(files), "bytes"),
      legacyCssBytes: sum(legacy, "bytes"),
      systemCssBytes: sum(system, "bytes"),
      scannerCssBytes: scanner?.bytes ?? 0,
      legacyHexLiterals: sum(legacy, "hexLiterals"),
      legacyImportant: sum(legacy, "important"),
      legacyMediaQueries: sum(legacy, "mediaQueries"),
      legacyStateModifierClasses: sum(legacy, "stateModifierClasses"),
      pageShellLayers: Object.keys(Object.assign({}, ...legacy.map(([, m]) => m.pageShellLayers))).length,
    },
    files,
    scanner,
  };
}

// The legacy ceiling ratchets down and never up. Without it the gate would keep comparing against
// the Phase 0 measurement, so a phase could quietly put back everything an earlier phase deleted and
// still pass. `--ratchet` records a retirement that has actually happened (IMPLEMENTATION_PLAN §0).
const LEGACY_CEILING_KEYS = [
  "legacyCssBytes", "legacyHexLiterals", "legacyImportant",
  "legacyMediaQueries", "legacyStateModifierClasses", "pageShellLayers",
];

function ceilingOf(baseline) {
  const ceiling = { ...baseline.totals };
  for (const [key, value] of Object.entries(baseline.legacyCeiling?.totals ?? {})) {
    if (LEGACY_CEILING_KEYS.includes(key)) ceiling[key] = value;
  }
  return ceiling;
}

function check(current, baseline) {
  const failures = [];
  const t = current.totals, b = ceilingOf(baseline);
  const allowedGrowth = Number(process.env.DS_CSS_ALLOWED_GROWTH ?? 0);
  if (t.legacyCssBytes > b.legacyCssBytes + 200) failures.push(`legacy CSS grew: ${b.legacyCssBytes} → ${t.legacyCssBytes} bytes (legacy accepts deletions only; +200 B allowed for the @layer wrapper)`);
  if (t.legacyHexLiterals > b.legacyHexLiterals) failures.push(`legacy colour literals grew: ${b.legacyHexLiterals} → ${t.legacyHexLiterals}`);
  if (t.legacyImportant > b.legacyImportant) failures.push(`legacy !important grew: ${b.legacyImportant} → ${t.legacyImportant}`);
  if (t.legacyMediaQueries > b.legacyMediaQueries) failures.push(`legacy @media grew: ${b.legacyMediaQueries} → ${t.legacyMediaQueries}`);
  if (t.legacyStateModifierClasses > b.legacyStateModifierClasses) failures.push(`legacy state-modifier classes grew: ${b.legacyStateModifierClasses} → ${t.legacyStateModifierClasses}`);
  if (t.pageShellLayers > b.pageShellLayers) failures.push(`route layers grew: ${b.pageShellLayers} → ${t.pageShellLayers}`);
  if (t.webCssBytes > baseline.totals.webCssBytes + 200 + t.systemCssBytes + allowedGrowth) failures.push(`total CSS grew beyond legacy (+200 B wrapper) + system: ${t.webCssBytes}`);
  for (const [name, m] of Object.entries(current.files)) {
    if (!name.startsWith("ds-") || GENERATED.has(name)) continue;
    if (m.hexLiterals > 0 || m.rgbCalls > 0) failures.push(`${name}: ${m.hexLiterals} hex + ${m.rgbCalls} rgb literals (system CSS must use tokens)`);
    if (m.important > 0) failures.push(`${name}: !important in system CSS`);
    const allowed = new Set((process.env.DS_BREAKPOINTS ?? "360px,600px,1100px,1440px,359px,599px,1099px").split(","));
    const bad = m.breakpointWidths.filter((w) => !allowed.has(w));
    if (bad.length) failures.push(`${name}: breakpoints outside the tokens: ${bad.join(", ")}`);
    if (m.stateModifierClasses > 0) failures.push(`${name}: --active/--selected/--current classes (use ARIA state)`);
  }
  return failures;
}

const arg = process.argv[2];
if (arg === "--ratchet") {
  // Records a retirement: the new, lower legacy ceiling plus the note that says what was deleted.
  const baseline = JSON.parse(readFileSync(baselineFile, "utf8"));
  const current = collect();
  const previous = ceilingOf(baseline);
  const ceiling = { ...(baseline.legacyCeiling?.totals ?? {}) };
  const moved = [];
  for (const key of LEGACY_CEILING_KEYS) {
    if (current.totals[key] > previous[key]) { console.error(`refused: ${key} is higher than the ceiling (${previous[key]} → ${current.totals[key]})`); process.exit(1); }
    if (current.totals[key] < previous[key]) moved.push(`${key} ${previous[key]} → ${current.totals[key]}`);
    ceiling[key] = Math.min(current.totals[key], previous[key]);
  }
  const note = process.argv[3];
  if (!note) { console.error("--ratchet needs a note saying which selectors were deleted"); process.exit(2); }
  baseline.legacyCeiling = {
    totals: ceiling,
    history: [...(baseline.legacyCeiling?.history ?? []), { at: new Date().toISOString(), note, moved }],
  };
  writeFileSync(baselineFile, JSON.stringify(baseline, null, 1) + NEWLINE);
  console.log("legacy ceiling lowered:" + NEWLINE + "- " + (moved.join(NEWLINE + "- ") || "nothing moved"));
} else if (arg === "--write-baseline") {
  mkdirSync(dirname(baselineFile), { recursive: true });
  writeFileSync(baselineFile, JSON.stringify(collect(), null, 1) + "\n");
  console.log("baseline written:", baselineFile);
} else if (arg === "--check") {
  const failures = check(collect(), JSON.parse(readFileSync(baselineFile, "utf8")));
  if (failures.length) { console.error("CSS gate FAILED:\n- " + failures.join("\n- ")); process.exit(1); }
  console.log("CSS gate passed");
} else if (arg === "--diff") {
  const cur = collect(), base = JSON.parse(readFileSync(baselineFile, "utf8"));
  const ceiling = ceilingOf(base);
  const out = {};
  for (const k of Object.keys(cur.totals)) out[k] = { baseline: base.totals[k], ceiling: ceiling[k], now: cur.totals[k] };
  console.log(JSON.stringify(out, null, 1));
} else {
  console.log(JSON.stringify(collect(), null, 1));
}
