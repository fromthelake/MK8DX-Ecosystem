import { describe, expect, it } from "vitest";

import { sanitizeReportMarkup } from "../src/tournament-report-markup.js";
import { importedButHidden } from "../src/tournament-report-view.js";
import {
  buildReportTemplate,
  markupToShorthand,
  parseReportTemplate,
  reportTemplateFileName,
  shorthandToMarkup,
} from "../src/tournament-report-template.js";

// Evan writes the report and the night sometimes has to be rebuilt, which
// gives every group and Player a new identifier. So the writing travels as a
// Markdown file keyed by name, and the round trip has to lose nothing.
//
// The format is CommonMark/GFM where Markdown has a word for something and
// plain inline HTML where it does not, which is what Markdown itself
// prescribes. Nothing here is our own invention.
describe("the report file", () => {
  const roundTrip = (markup: string): string => shorthandToMarkup(markupToShorthand(markup));

  it("carries every construct the editor can store through Markdown and back", () => {
    const cases = [
      "<p>Plain writing.</p>",
      "<p>Two<br>lines in one paragraph.</p>",
      "<p>One.</p><p>Two.</p>",
      "<p><strong>Bold</strong> and <em>italic</em> and <u>underlined</u> and <s>struck</s>.</p>",
      "<p><span class=\"rt-color-red\">Red</span> and <span class=\"rt-color-blue\">blue</span>.</p>",
      "<p><mark class=\"rt-bg-yellow\">Highlighted</mark>.</p>",
      "<p><span class=\"rt-size-l\">Bigger</span> and <span class=\"rt-size-s\">smaller</span> and <span class=\"rt-size-xl\">biggest</span>.</p>",
      "<p><span class=\"rt-font-serif\">Serif</span> and <span class=\"rt-font-mono\">mono</span>.</p>",
      "<p class=\"rt-align-center\">Centred.</p>",
      "<p class=\"rt-align-right\">To the right.</p>",
      "<p class=\"rt-indent-2\">Indented twice.</p>",
      "<ul><li>First</li><li>Second</li></ul>",
      "<ol><li>First</li><li>Second</li></ol>",
      "<blockquote>Somebody said this.</blockquote>",
      "<p>A <a href=\"https://mk8dx.example\" rel=\"noopener\" target=\"_blank\">link</a> inside a line.</p>",
      "<p><span class=\"rt-color-green\">Green with <strong>bold</strong> inside</span>.</p>",
    ];
    for (const markup of cases) {
      expect(roundTrip(markup), markup).toBe(sanitizeReportMarkup(markup));
    }
  });

  it("writes the ordinary things as plain Markdown", () => {
    expect(markupToShorthand("<p><strong>Kampioen</strong> Matteo.</p>")).toBe("**Kampioen** Matteo.");
    expect(markupToShorthand("<p><em>bijna</em> gewonnen</p>")).toBe("*bijna* gewonnen");
    expect(markupToShorthand("<p><s>weg</s></p>")).toBe("~~weg~~");
    expect(markupToShorthand("<ul><li>Een</li><li>Twee</li></ul>")).toBe("- Een\n- Twee");
    expect(markupToShorthand("<ol><li>Een</li><li>Twee</li></ol>")).toBe("1. Een\n2. Twee");
    expect(markupToShorthand("<blockquote>Zo ging het.</blockquote>")).toBe("> Zo ging het.");
    expect(markupToShorthand("<p>Zie <a href=\"https://mk8dx.example\">de site</a>.</p>"))
      .toBe("Zie [de site](https://mk8dx.example).");
  });

  it("writes what Markdown has no word for as plain HTML, with a class a writer can read", () => {
    expect(markupToShorthand("<p><span class=\"rt-color-red\">rood</span></p>")).toBe("<span class=\"red\">rood</span>");
    expect(markupToShorthand("<p><mark class=\"rt-bg-pink\">let op</mark></p>")).toBe("<mark class=\"pink\">let op</mark>");
    expect(markupToShorthand("<p><u>onderstreept</u></p>")).toBe("<u>onderstreept</u>");
    expect(markupToShorthand("<p class=\"rt-align-center\">Midden.</p>")).toBe("<p class=\"center\">Midden.</p>");
  });

  it("reads the stored class names and the Dutch ones as well", () => {
    expect(shorthandToMarkup("<span class=\"rood\">Rood</span>")).toBe(shorthandToMarkup("<span class=\"red\">Rood</span>"));
    expect(shorthandToMarkup("<span class=\"rt-color-red\">Rood</span>")).toBe(shorthandToMarkup("<span class=\"red\">Rood</span>"));
    expect(shorthandToMarkup("<p class=\"midden\">Midden.</p>")).toBe(shorthandToMarkup("<p class=\"center\">Midden.</p>"));
    expect(shorthandToMarkup("<mark class=\"geel\">Geel</mark>")).toBe(shorthandToMarkup("<mark class=\"yellow\">Geel</mark>"));
  });

  it("follows Markdown where Markdown and the old shorthand disagreed", () => {
    // __x__ is bold in Markdown. The first version of this file called it
    // underline, which would have surprised every Markdown editor.
    expect(shorthandToMarkup("__vet__")).toBe("<p><strong>vet</strong></p>");
    expect(shorthandToMarkup("_cursief_")).toBe("<p><em>cursief</em></p>");
    expect(shorthandToMarkup("* een\n* twee")).toBe("<ul><li>een</li><li>twee</li></ul>");
  });

  it("keeps a star a star when the writer escapes it", () => {
    expect(shorthandToMarkup("Een \\*ster\\* blijft staan.")).toBe("<p>Een *ster* blijft staan.</p>");
    expect(roundTrip("<p>Een *ster* blijft staan.</p>")).toBe("<p>Een *ster* blijft staan.</p>");
    expect(roundTrip("<p>Een &lt;tag&gt; in de tekst.</p>")).toBe("<p>Een &lt;tag&gt; in de tekst.</p>");
    expect(roundTrip("<p>1. geen lijst</p>")).toBe("<p>1. geen lijst</p>");
  });

  it("turns a blank line into a paragraph and a single break into a line break", () => {
    expect(shorthandToMarkup("Een.\n\nTwee.")).toBe("<p>Een.</p><p>Twee.</p>");
    expect(shorthandToMarkup("Een.\nTwee.")).toBe("<p>Een.<br>Twee.</p>");
  });

  it("builds a Markdown file with a marker per field and reads it back by name", () => {
    const fields = {
      titleText: "TN13 'WaLuigi Forever'",
      introText: "<p>De avond begon <strong>hard</strong>.</p>",
      summaryText: "<p>Matteo won.</p>",
      tracksIntroText: "<p>Vijf banen sprongen eruit.</p>",
      groupNotes: { Kampioen: "<p>De zwaarste groep.</p>" },
      playerNotes: { Matteo: "<p>Onverslaanbaar.</p>", Ben: "" },
    };
    const file = buildReportTemplate({
      heading: "TN13 · Toernooi 13",
      fields,
      groupNames: ["Kampioen", "Talent"],
      playerNames: ["Matteo", "Ben"],
      generatedAt: new Date("2026-09-15T21:00:00.000Z"),
    });
    expect(file).toContain("<!-- MK8DX:INTRO -->");
    expect(file).toContain("<!-- MK8DX:GROUP Talent -->");
    expect(file).toContain("<!-- MK8DX:PLAYER Ben -->");
    expect(file).toContain("**hard**");
    // The explanation is ordinary Markdown above the first marker, so a
    // preview shows it and the parser never takes it for writing.
    expect(file.indexOf("MARKDOWN")).toBeLessThan(file.indexOf("<!-- MK8DX:TITLE -->"));

    const parsed = parseReportTemplate(file);
    expect(parsed.fields.titleText).toBe(fields.titleText);
    expect(parsed.fields.introText).toBe(sanitizeReportMarkup(fields.introText));
    expect(parsed.fields.summaryText).toBe(sanitizeReportMarkup(fields.summaryText));
    expect(parsed.fields.tracksIntroText).toBe(sanitizeReportMarkup(fields.tracksIntroText));
    expect(parsed.fields.groupNotes["Kampioen"]).toBe(sanitizeReportMarkup(fields.groupNotes.Kampioen));
    expect(parsed.fields.groupNotes["Talent"]).toBe("");
    expect(parsed.fields.playerNotes["Matteo"]).toBe(sanitizeReportMarkup(fields.playerNotes.Matteo));
    expect(parsed.unknownSections).toEqual([]);
    expect(parsed.strayLines).toEqual([]);
  });

  it("names a marker this night does not have instead of dropping it silently", () => {
    const parsed = parseReportTemplate("<!-- MK8DX:PLAYER Iemand Anders -->\nWon alles.\n<!-- MK8DX:NONSENSE -->\nlos\n");
    expect(parsed.fields.playerNotes["Iemand Anders"]).toBe("<p>Won alles.</p>");
    expect(parsed.unknownSections).toEqual(["NONSENSE"]);
    expect(parsed.strayLines).toEqual([{ line: 4, text: "los" }]);
  });

  it("reports writing under a marker this night does not have", () => {
    const parsed = parseReportTemplate("<!-- MK8DX:NONSENSE -->\nzomaar een regel\n<!-- MK8DX:INTRO -->\nHallo.\n");
    expect(parsed.strayLines).toEqual([{ line: 2, text: "zomaar een regel" }]);
    expect(parsed.fields.introText).toBe("<p>Hallo.</p>");
  });

  it("treats everything above the first marker as the explanation", () => {
    const parsed = parseReportTemplate("# TN13\n\nUitleg met **vet** erin.\n\n<!-- MK8DX:INTRO -->\nHallo.\n");
    expect(parsed.strayLines).toEqual([]);
    expect(parsed.fields.introText).toBe("<p>Hallo.</p>");
  });

  it("still reads the first spelling this file ever had", () => {
    const parsed = parseReportTemplate("=== INTRO ===\nHallo.\n=== PLAYER: Ben ===\nGoed gereden.\n");
    expect(parsed.fields.introText).toBe("<p>Hallo.</p>");
    expect(parsed.fields.playerNotes["Ben"]).toBe("<p>Goed gereden.</p>");
  });

  it("names the file after the night and the day it was made", () => {
    expect(reportTemplateFileName("TN13 · Toernooi 13", new Date("2026-09-15T21:00:00.000Z")))
      .toBe("TN13-Toernooi-13-2026-09-15.md");
  });
});

describe("reading a report file into a night with blocks switched off", () => {
  it("round-trips every text block and names the written ones the switches keep off the page", () => {
    const file = buildReportTemplate({
      heading: "TN14",
      fields: {
        titleText: "", introText: "<p>Een lange avond.</p>", summaryText: "<p>Kort.</p>", tracksIntroText: "",
        groupNotes: { Kampioen: "<p>De kampioenen.</p>" }, playerNotes: { Ben: "<p>Sterk.</p>" },
      },
      groupNames: ["Kampioen"], playerNames: ["Ben"], generatedAt: new Date(Date.UTC(2026, 8, 28)),
    });
    const parsed = parseReportTemplate(file);
    expect(parsed.fields.introText).toBe("<p>Een lange avond.</p>");
    expect(parsed.fields.groupNotes).toEqual({ Kampioen: "<p>De kampioenen.</p>" });
    const defaults = { topTracks: true, benchmark: true, duel: true, distribution: true, intro: false, summary: true, groupNotes: false };
    expect(importedButHidden(parsed.fields, (key) => defaults[key])).toEqual([["Intro", "Intro"], ["Group notes", "Groepsteksten"]]);
    expect(importedButHidden(parsed.fields, () => true)).toEqual([]);
  });
});
