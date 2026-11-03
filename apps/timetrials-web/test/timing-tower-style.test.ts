import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const style = readFileSync(new URL("../styles/ds-workflows.css", import.meta.url), "utf8");
const system = readFileSync(new URL("../styles/ds-components.css", import.meta.url), "utf8");

describe("track timing-tower contract", () => {
  it("keeps engine and competitive identity in semantic components", () => {
    expect(style).not.toContain("page-shell--");
    expect(style).not.toMatch(/#[0-9a-f]{3,8}\b/iu);
    expect(system).toContain('.ds-engine-mark[data-engine="200"], .ds-engine-option[data-engine="200"] { --ds-c: var(--ds-engine-200); }');
    expect(system).toContain('.ds-engine-option[aria-checked="true"]::before { content: "✓"');
    expect(system).toContain(".ds-tier-chip");
  });

  it("sizes the board's columns from its data and keeps a pointer-based density", () => {
    // The eleven fixed pixel columns this test pinned belonged to the retired board. The design
    // system sizes numeric columns in ch from the dataset instead, and folds the row rather than
    // scaling a value (§10, §12); the densities are tokens, not literals.
    expect(style).not.toContain("grid-template-columns: 18px 15px minmax(6rem, 1fr) 50px 34px 62px 66px 44px 74px 24px 14px;");
    expect(system).toContain("display: grid; grid-template-columns: 0 var(--ds-cols) 0;");
    expect(system).toContain("grid-column: 1 / -1; grid-template-columns: subgrid;");
    expect(system).toContain('.ds-table[data-density="timing"] .ds-table__row { min-height: var(--ds-table-row-timing); }');
    expect(system).toMatch(/@media \(max-width: 599px\)[\s\S]*?min-height: var\(--ds-table-row-phone\);/u);
    expect(system).toMatch(/@media \(max-width: 359px\)[\s\S]*?min-height: var\(--ds-table-row-phone-compact\);/u);
    expect(system).toMatch(/@media \(pointer: coarse\)[\s\S]*?min-height: var\(--ds-target-min\);/u);
    expect(style).not.toContain(".track-board__mode--150");
  });

  // Phase 9 replaced the three assertions that stood here. They pinned the retired
  // `.page-shell--track-control` layer and the legacy leaderboard module: the five-second OKLCH
  // delta ramp, the missing/not-applicable marker pair, and the centred rank icons. W07 is the
  // design system's own board now, so the same three things are asserted as design-system
  // behaviour: a signed delta whose direction is a token (never colour alone), a reference row
  // that consumes no rank, and a rank column sized from the dataset. The board's behaviour itself
  // is in ds-track-board.test.ts.
  it("states a delta's direction in the sign and in a token, never in colour alone", () => {
    expect(style).not.toContain("track-board__delta--t-");
    expect(style).not.toContain("--track-delta-end");
    expect(system).toContain('.ds-delta[data-direction="faster"], .ds-delta__value[data-direction="faster"] { color: var(--ds-delta-faster); }');
    expect(system).toContain('.ds-delta[data-direction="slower"], .ds-delta__value[data-direction="slower"] { color: var(--ds-delta-slower); }');
    // One size per table (§10), so a gap never shrinks away from the time beside it.
    expect(system).toContain(".ds-table .ds-delta, .ds-table .ds-delta__value { font-size: inherit; }");
  });

  it("keeps a reference row visually apart without giving it a rank", () => {
    expect(system).toContain('.ds-table__row[data-kind="reference"] { background: transparent; color: var(--ds-text-tertiary);');
    expect(system).toContain('.ds-table__row[data-kind="you"] { background: var(--ds-personal-wash); box-shadow: inset 4px 0 0 var(--ds-personal-edge);');
    expect(style).not.toContain("--track-reference-wr");
    expect(style).not.toContain("--track-reference-staff");
  });

  it("sizes the rank column from the dataset and prints the podium on the row", () => {
    expect(system).toContain('.ds-table__cell[data-align="num"], .ds-table__cell[data-align="rank"], .ds-table__cell[data-align="delta"] { text-align: right; }');
    expect(system).toContain('.ds-table__row[data-podium="1"] .ds-table__rank { color: var(--ds-rank-gold); }');
    expect(system).toContain(".ds-table__rank { font-family: var(--ds-font-data); font-variant-numeric: tabular-nums;");
  });

  it("resolves header and body tracks in the same data-font grid", () => {
    expect(system).toContain('.ds-table__row[data-head] { min-height: 34px; font-weight: 500;');
    expect(system).toContain('.ds-table__row[data-head] > .ds-table__cell { font-family: var(--ds-font-ui); font-size: var(--ds-type-label-size); }');
    expect(system).not.toContain('.ds-table__row[data-head] { font-family: var(--ds-font-ui);');
  });
});
