import { describe, expect, it } from "vitest";

import { chunkPackedScript, formatCssLines, formatWordpressLines, longLines } from "../src/wordpress-export-format.js";
import { wordpressSafeScript } from "../src/tournament-report-wordpress.js";

describe("short lines for the WordPress code editor", () => {
  it("splits a packed script's base64 into pieces that join back to the very same string", () => {
    const packed = wordpressSafeScript(`globalThis.__formatted = ${JSON.stringify("x".repeat(9000))};`);
    const chunked = chunkPackedScript(packed, 1000);
    expect(chunked.split("\n").length).toBeGreaterThan(9);
    expect(Math.max(...chunked.split("\n").map((line) => line.length))).toBeLessThan(1200);
    const original = /var _d='([^']+)'/.exec(packed)![1];
    const pieces = /var _d=\[([\s\S]*?)\]\.join\(''\)/.exec(chunked)![1]!;
    expect([...pieces.matchAll(/"([^"]*)"/g)].map((match) => match[1]).join("")).toBe(original);
    // Every line break sits inside a comment: rewriting it to <br /> keeps the script valid.
    expect(chunked.replace(/\/\*\n\*\//g, "")).not.toContain("\n");
    const scope = globalThis as unknown as { __formatted?: string };
    (0, eval)(chunked.replace(/\n/g, "<br />\n"));
    expect(scope.__formatted).toBe("x".repeat(9000));
  });

  it("leaves a script it does not recognise exactly as it is", () => {
    expect(chunkPackedScript("var a = '" + "y".repeat(5000) + "';", 100)).toBe("var a = '" + "y".repeat(5000) + "';");
  });

  it("breaks markup only inside start tags, where a newline means the same as the space it replaces", () => {
    const cells = Array.from({ length: 400 }, (_, i) => `<span class="c${i}" data-i="${i}">Speler ${i} &amp; co</span> `).join("");
    const html = `<div id="r" class="m3y">${cells}<pre class="p">  keep   this  </pre></div>`;
    const formatted = formatWordpressLines(html, 500);
    expect(formatted.split("\n").length).toBeGreaterThan(20);
    expect(longLines(formatted, 500)).toEqual([]);
    // Undo every inserted break: exactly the original.
    expect(formatted.replace(/\n/g, " ")).toBe(html);
    // No break ever lands in text or between elements.
    expect(formatted).not.toMatch(/>\n|\n</);
    expect(formatted).toContain("<pre class=\"p\">  keep   this  </pre>");
  });

  it("never breaks inside a quoted attribute value, a CSS string or url()", () => {
    const data = `data:image/webp;base64,${"A".repeat(3000)}`;
    const html = `<p class="a">x</p><img alt="a > b" src="${data}"><style>.a{color:red}.b{background:url("${data}")}.c{content:"} {"}</style>`;
    const formatted = formatWordpressLines(html, 200);
    expect(formatted).toContain(`src="${data}"`);
    expect(formatted).toContain(`url("${data}")`);
    expect(formatted).toContain('content:"} {"');
    expect(formatted).toContain('alt="a > b"');
    expect(formatCssLines(".a{color:red}.b{x:1}", 10)).toBe(".a{color:red}\n.b{x:1}");
  });

  it("keeps the WordPress block markers as the first and last lines", () => {
    const formatted = formatWordpressLines(`<!-- wp:html -->\n<div class="x">${"<b class='y'>z</b>".repeat(300)}</div>\n<!-- /wp:html -->\n`, 300);
    const lines = formatted.split("\n");
    expect(lines[0]).toBe("<!-- wp:html -->");
    expect(lines.at(-2)).toBe("<!-- /wp:html -->");
  });
});
