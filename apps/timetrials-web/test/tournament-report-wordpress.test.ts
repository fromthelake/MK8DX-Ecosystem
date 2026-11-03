import { describe, expect, it } from "vitest";

import { readoutHtml, type ChartPoint } from "../src/tournament-report-chart.js";
import {
  encodeReadoutPoint, remToPx, rootDeclarations, scopeSelector, scriptJson, splitSelectorList, staticSelector,
  shortenClassNames, slimWordpressHtml, wordpressBlock, wordpressFileName, wordpressSafeScript, WORDPRESS_READOUT_JS, WORDPRESS_RUNTIME,
} from "../src/tournament-report-wordpress.js";

describe("the WordPress export's stylesheet", () => {
  it("splits a selector list only at its own commas", () => {
    expect(splitSelectorList(".a, .b:is(.c, .d), [data-x=\"1,2\"] .e"))
      .toEqual([".a", ".b:is(.c, .d)", "[data-x=\"1,2\"] .e"]);
  });

  it("moves page-root rules onto the fragment and everything else under it", () => {
    const prefix = "#r#r";
    expect(scopeSelector(":root", prefix)).toEqual({ selector: prefix, root: true });
    expect(scopeSelector(":root[data-appearance-choice=\"light\"]", prefix)).toEqual({ selector: prefix, root: true });
    expect(scopeSelector("html body", prefix)).toEqual({ selector: prefix, root: true });
    expect(scopeSelector(":root[data-appearance-choice=\"light\"] .tournament-report__dot", prefix))
      .toEqual({ selector: "#r#r .tournament-report__dot", root: false });
    expect(scopeSelector(".tournament-report > h2", prefix))
      .toEqual({ selector: "#r#r .tournament-report > h2", root: false });
  });

  it("keeps only tokens and typography from a page-root rule", () => {
    expect(rootDeclarations("--ds-bg: #fff; min-height: 100vh; color: rgb(1, 2, 3); font-family: Plex; margin: 0"))
      .toBe("--ds-bg: #fff;color: rgb(1, 2, 3);font-family: Plex");
  });

  it("turns rem into px so a theme's root size cannot shrink the report", () => {
    expect(remToPx("padding: 0.5rem 1.25rem; gap: calc(2rem - 1px); --x: .75rem")).toBe("padding: 8px 20px; gap: calc(32px - 1px); --x: 12px");
  });

  it("tests a selector without what only a pointer or a form state makes true", () => {
    expect(staticSelector(".a:hover .b::before")).toBe(".a .b");
    expect(staticSelector(".scrub:focus-visible")).toBe(".scrub");
    expect(staticSelector("::selection")).toBe("");
  });
});

describe("the fragment around it", () => {
  it("is one WordPress Custom HTML block, its markers the very first and last lines", () => {
    const file = wordpressBlock("Toernooi 13 -- finale", ["<style>a{}</style>", "<div>x</div>"]);
    const lines = file.split(String.fromCharCode(10));
    expect(lines[0]).toBe("<!-- wp:html -->");
    expect(lines.at(-2)).toBe("<!-- /wp:html -->");
    expect(lines.at(-1)).toBe("");
    expect(file.charCodeAt(0)).toBe("<".charCodeAt(0));
    expect(file.match(/<!-- \/?wp:html -->/g)).toHaveLength(2);
    // A night's name cannot close the comment that carries it.
    expect(lines[2]).toBe("<!-- Toernooi 13 - - finale · MK8DX WordPress export (mk8dx.example) -->");
  });

  it("is named after the night", () => {
    expect(wordpressFileName("Toernooi 13")).toBe("toernooi-13-wordpress.html");
    expect(wordpressFileName("TN12 ‘WaLuigi Forever’")).toBe("tn12-waluigi-forever-wordpress.html");
  });

  it("carries data that cannot end its own script element", () => {
    const separator = String.fromCharCode(0x2028);
    const json = scriptJson({ s: ["</script><td>x</td>", separator] });
    expect(json).not.toContain("</");
    expect(json).not.toContain(separator);
    expect(JSON.parse(json)).toEqual({ s: ["</script><td>x</td>", separator] });
  });

  it("ships a runtime that parses as plain script", () => {
    // eslint-disable-next-line no-new-func
    expect(() => new Function(WORDPRESS_RUNTIME.replace(/\bID\b/g, "\"mk8-report-x\""))).not.toThrow();
  });
});

describe("the readouts the pasted page draws", () => {
  const cup = { src: "/assets/cups/mushroom.png", alt: "Mushroom Cup" };
  const track = { src: "/assets/tracks/baby-park.png", alt: "GCN Baby Park" };
  const points: readonly ChartPoint[] = [
    { raceNumber: 7, label: "7", head: { race: "Race 7", label: "Kampioen · race 7" }, mode: "place-track",
      values: [{ label: "Positie", color: "#c33", value: 3, display: "3e plek", lines: ["GCN Baby Park", " ", "12 punten & \"meer\""], icons: [cup, track] }] },
    { raceNumber: 8, label: "8", head: { race: "Race 8", label: "" }, mode: "benchmark",
      values: [
        { label: "Verschil met 1e", color: "#fa0", value: -4, display: "-4", pack: { displayName: "Matteo", benchmarkTotal: 58, playerTotal: 54, delta: -4, unit: "punten" } },
        { label: "Verschil met 2e", color: "#888", value: 2, display: "+2", pack: { displayName: "", benchmarkTotal: 52, playerTotal: 54, delta: 2, unit: "punten" } },
        { label: "Zonder pack", color: "#888", value: 0, display: "0" },
      ] },
    { raceNumber: 9, label: "9", head: { race: "Race 9", label: "Talent · race 9" }, mode: "delta",
      values: [{ label: "Ben <b>", color: "#2a2", value: 12, display: "+12", lines: ["voor", "", "na"], pictures: [[track], [], [cup]] }] },
    { raceNumber: 3, label: "3", head: { race: "3e plek", label: "" }, mode: "compact",
      values: [{ label: "Aantal", color: "#36c", value: 5, display: "5x", lines: ["GCN Baby Park"], pictures: [[cup, track]] }] },
    { raceNumber: 1, label: "1", head: { race: "Race 1", label: "" }, mode: "place-track", values: [] },
  ];

  it("are the same markup as the site's own readouts, in every mode", () => {
    const strings: string[] = [];
    const images: string[] = [];
    const text = (value: string): number => { const at = strings.indexOf(value); return at >= 0 ? at : strings.push(value) - 1; };
    const picture = (source: string): number => { const at = images.indexOf(source); return at >= 0 ? at : images.push(source) - 1; };
    // eslint-disable-next-line no-new-func
    const draw = new Function("D", "p", "r", "e", `${WORDPRESS_READOUT_JS}; return mk8Readout(D, p, r, e);`) as
      (data: unknown, point: unknown, resting: boolean, empty: string) => string;
    for (const point of points) {
      const encoded = encodeReadoutPoint(point, text, picture);
      for (const resting of [false, true]) {
        expect(draw({ s: strings, img: images }, encoded, resting, "Geen datapunt")).toBe(readoutHtml(point, "Geen datapunt", resting));
      }
    }
  });
});

describe("the script WordPress gets", () => {
  it("is packed as the TN12 runtime was: one line, nothing WordPress rewrites, and it still runs", () => {
    const source = ["globalThis.__packedResult = [];", "for (let i = 0; i < 2 && true; i += 1) {", "  globalThis.__packedResult.push('TN12 ‘WaLuigi’ · ' + i);", "}"].join(String.fromCharCode(10));
    const packed = wordpressSafeScript(source);
    expect(packed.startsWith("(function(){try{var _d='")).toBe(true);
    expect(packed).not.toContain(String.fromCharCode(10));
    expect(packed).not.toContain("<");
    // Only the wrapper's own two, exactly as in the TN12 post.
    expect(packed.split("&&").length - 1).toBe(2);
    const scope = globalThis as unknown as { __packedResult?: string[]; escape?: (value: string) => string };
    scope.escape ??= (value: string) => value.replace(/[^A-Za-z0-9@*_+\-./]/g, (char) => {
      const code = char.charCodeAt(0);
      return code < 256 ? `%${code.toString(16).toUpperCase().padStart(2, "0")}` : `%u${code.toString(16).toUpperCase().padStart(4, "0")}`;
    });
    (0, eval)(packed);
    expect(scope.__packedResult).toEqual(["TN12 ‘WaLuigi’ · 0", "TN12 ‘WaLuigi’ · 1"]);
  });
});

describe("the slimmer file", () => {
  const picture = `data:image/webp;base64,${"A".repeat(120)}`;
  const once = `data:image/png;base64,${"B".repeat(120)}`;
  const html = [
    `<div data-chart-points="1.23456,2.98765">`,
    `<svg viewBox="0 0 860 308">\n  <line x1="56" y1="251.94736842105266" x2="840" y2="251.94736842105266"></line>\n  <text x="46.55555" y="12">1.234567</text>\n  <polyline points="10.123456,20.987654 30.5,40.25"></polyline>\n</svg>`,
    `<img class="a" src="${picture}" alt=""><img src="${picture}"><img src="${once}">`,
    `<script>var keep="${picture}";var n=3.14159265;</script><style>.x{width:1.23456px}</style></div>`,
  ].join("");

  it("rounds chart coordinates and drops their whitespace, and leaves text, data, scripts and styles alone", () => {
    const { html: out } = slimWordpressHtml(html);
    expect(out).toContain('y1="251.9"');
    expect(out).toContain('x="46.6"');
    expect(out).toContain('points="10.1,21 30.5,40.3"');
    expect(out).toContain(">1.234567</text>");
    expect(out).toContain('data-chart-points="1.23456,2.98765"');
    expect(out).toContain("<line");
    expect(out).not.toMatch(/<svg[^>]*>\s+</);
    expect(out).toContain("var n=3.14159265;");
    expect(out).toContain(".x{width:1.23456px}");
  });

  it("stores a repeated picture once and lets a packed script put it back", () => {
    const { html: out, script } = slimWordpressHtml(html);
    expect(out.split(picture).length - 1).toBe(1); // only the copy inside the untouched script
    expect(out).toContain(`src="${once}"`);
    expect(out.match(/data-mk8img="0"/g)).toHaveLength(2);
    expect(script?.startsWith("(function(){try{var _d='")).toBe(true);
  });
});

describe("the shorter class names", () => {
  const html = [
    `<style>.tournament-report__tick{fill:red}.chart-hover-zone{opacity:0}.story-context-bar{top:0}.rt-color-red{color:red}.x[class*="rt-color-"]{a:b}.tournament-report__dot.is-active{r:6}.name{font:x}</style>`,
    `<div class="tournament-report__tick chart-hover-zone" data-chart-points="%5B%22story-context-bar%22%5D">`,
    `<span class="story-context-bar rt-color-red name">Moss-HM name</span><circle class="tournament-report__dot is-active"></circle></div>`,
    `<script>document.querySelector('.chart-hover-zone');var t=['tournament-report__dot','name','Moss-HM'];</script>`,
  ].join("");

  it("renames only what no script or payload looks up (classic: scripts stay as they are)", () => {
    const out = shortenClassNames(html, { renameInScripts: false });
    // Only in markup and CSS: renamed in both, consistently.
    const tick = /class="(m[0-9a-z]+) chart-hover-zone"/.exec(out)?.[1];
    expect(tick).toBeDefined();
    expect(out).toContain(`.${tick}{fill:red}`);
    expect(out).not.toContain("tournament-report__tick");
    // Named by the script, by a payload, by an attribute selector: kept.
    expect(out).toContain('class="story-context-bar rt-color-red name"');
    expect(out).toContain(".chart-hover-zone{opacity:0}");
    expect(out).toContain("'tournament-report__dot'");
    // Named by the script: kept in markup; a class nothing looks up is renamed there and in the CSS alike.
    const active = /<circle class="tournament-report__dot (m[0-9a-z]+)">/.exec(out)?.[1];
    expect(active).toBeDefined();
    expect(out).toContain(`.tournament-report__dot.${active}{r:6}`);
    expect(out).toContain("<script>document.querySelector('.chart-hover-zone');var t=['tournament-report__dot','name','Moss-HM'];</script>");
  });

  it("renames inside its own scripts too (site look), but never a plain word or a Player's name", () => {
    const out = shortenClassNames(html, { renameInScripts: true });
    const [, dot, active] = /<circle class="(m[0-9a-z]+) (m[0-9a-z]+)">/.exec(out) ?? [];
    expect(dot).toBeDefined();
    expect(out).toContain(`'${dot}'`);
    expect(out).toContain(`.${dot}.${active}{r:6}`);
    expect(out).toContain("'name','Moss-HM'");
    expect(out).toContain(">Moss-HM name</span>");
    expect(out).toContain('rt-color-red');
  });
});
