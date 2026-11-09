import { describe, expect, it } from "vitest";
import { reportMarkupBlocks, reportMarkupHtml, reportMarkupText, sanitizeReportMarkup } from "../src/tournaments/tournament-report-markup.js";

describe("report markup", () => {
  it("keeps plain text the way the old boxes stored it: blank lines separate paragraphs", () => {
    expect(reportMarkupBlocks("Een lange avond.\n\nEn nog   een\nalinea.")).toEqual([
      { html: "<p>Een lange avond.</p>", text: "Een lange avond." },
      { html: "<p>En nog een alinea.</p>", text: "En nog een alinea." },
    ]);
    expect(reportMarkupText("  \n\n ")).toEqual([]);
    expect(sanitizeReportMarkup("a < b & c > d")).toBe("<p>a &lt; b &amp; c &gt; d</p>");
    expect(sanitizeReportMarkup("Intro <safe> en Ben <3 Baby Park")).toBe("<p>Intro &lt;safe&gt; en Ben &lt;3 Baby Park</p>");
    expect(reportMarkupText("<p>echt</p>")).toEqual(["echt"]);
  });

  it("keeps the formatting the editor produces and expresses it as classes, never inline style", () => {
    const html = sanitizeReportMarkup(
      "<div><b>Valerio</b> won <i>alles</i>, <u>echt</u> <strike>bijna</strike> <span style=\"color: rgb(214, 75, 42); font-size: 20px; background-color:#fff2a8\">alles</span>." +
      "</div><p style=\"text-align:center; margin-left: 80px\">Midden</p><font color=\"#2563eb\" size=\"5\" face=\"Georgia\">groot</font>" +
      "<blockquote>citaat</blockquote><ul><li>een</li><li>twee</li></ul>",
    );
    expect(html).toBe(
      "<p><strong>Valerio</strong> won <em>alles</em>, <u>echt</u> <s>bijna</s> <span class=\"rt-bg-yellow rt-color-red rt-size-l\">alles</span>.</p>" +
      "<p class=\"rt-align-center rt-indent-2\">Midden</p><p><span class=\"rt-color-blue rt-font-serif rt-size-l\">groot</span></p>" +
      "<blockquote>citaat</blockquote><ul><li>een</li><li>twee</li></ul>",
    );
    expect(html).not.toContain("style=");
    expect(reportMarkupText(html)).toEqual(["Valerio won alles, echt bijna alles.", "Midden", "groot", "citaat", "• een\n• twee"]);
  });

  it("drops scripts, handlers, unknown elements and unsafe links, keeping the words", () => {
    const html = sanitizeReportMarkup(
      "<p onclick=\"steal()\">Hallo <script>alert(1)</script><a href=\"javascript:alert(1)\">daar</a> " +
      "<a href=\"https://mk8dx.example/?tournaments=1\">site</a> <img src=x onerror=alert(1)> <em style=\"color:#abcdef\">kleurloos</em></p><style>p{}</style>",
    );
    expect(html).toBe("<p>Hallo daar <a href=\"https://mk8dx.example/?tournaments=1\" rel=\"noopener\" target=\"_blank\">site</a> <em>kleurloos</em></p>");
    expect(sanitizeReportMarkup("<span class=\"rt-color-red evil\">x</span><p class=\"rt-color-red\">y</p>")).toBe("<p><span class=\"rt-color-red\">x</span></p><p>y</p>");
  });

  it("closes what the editor left open, ignores stray closers and wraps loose text in a paragraph", () => {
    expect(sanitizeReportMarkup("<p><strong>open")).toBe("<p><strong>open</strong></p>");
    expect(sanitizeReportMarkup("</em>loose <b>bold</b> text<br><br>")).toBe("<p>loose <strong>bold</strong> text</p>");
    expect(sanitizeReportMarkup("<p></p><p><br></p><ol>los<li>item</li></ol>")).toBe("<p><br></p><ol><li>los<li>item</li></li></ol>");
    expect(reportMarkupHtml("<section><p>a</p><p>b</p></section>")).toEqual(["<p>a</p>", "<p>b</p>"]);
    // The browser's list command leaves the list inside the paragraph it was typed in.
    expect(reportMarkupHtml("<p>x<ul><li>a</li></ul>y</p><p><ul><li>b</li></ul></p>")).toEqual(["<p>x</p>", "<ul><li>a</li></ul>", "<p>y</p>", "<ul><li>b</li></ul>"]);
    expect(sanitizeReportMarkup("<p>&amp;lt; &nbsp;&#128512;</p>")).toBe("<p>&amp;lt; 😀</p>");
    // Plain text is taken literally: an ampersand typed in the old box stays an ampersand.
    expect(sanitizeReportMarkup("Tom & Jerry &amp; co")).toBe("<p>Tom &amp; Jerry &amp;amp; co</p>");
  });

  it("is idempotent: sanitising the stored form changes nothing", () => {
    const stored = sanitizeReportMarkup("<div style=\"text-align:right\">Rechts <font size=\"1\">klein</font> <a href=\"mailto:test1@example.invalid\">mail</a></div>");
    expect(sanitizeReportMarkup(stored)).toBe(stored);
    expect(stored).toBe("<p class=\"rt-align-right\">Rechts <span class=\"rt-size-s\">klein</span> <a href=\"mailto:test1@example.invalid\" rel=\"noopener\" target=\"_blank\">mail</a></p>");
  });

  it("handles long unfinished comments and tags without regex backtracking", () => {
    const unfinishedComment = `<p>${"<!--".repeat(10_000)}safe</p>`;
    const unfinishedTag = `<p>${"<A ".repeat(10_000)}safe`;
    expect(sanitizeReportMarkup(unfinishedComment)).toContain("&lt;!--");
    expect(sanitizeReportMarkup(unfinishedTag)).toContain("&lt;A ");
  });
});
