# Classic WordPress export: vendored original code

The classic WordPress export (Step 10 part 5, *Klassieke opmaak, zoals TN12*) is made by the
Seating & Standings Manager's own export code, not by a re-implementation of it.
`src/tournament-report-classic.ts` runs that code in a hidden frame and answers its two PHP
endpoints from the published night; see the module's header.

The files in `styles/` are copies (taken 2026-10-24) in which every identifier, CSS class, element id
and endpoint name that carried the old page name ("erik") is renamed to "classic" (2026-10-31:
a person's name is no name for code). In this public tree two help texts and one example base URL that
named the community site's owner and domain are neutral as well. Nothing else differs: mapping each `classic`
identifier back gives the original bytes, except two help texts ("preview for the report writer").
A change belongs in the original project; copy it again and repeat the same rename.
On 2026-11-04 the public-only neutralized `classicFullHelper` sentence gained a
typographic apostrophe: its previous ASCII apostrophe ended the JavaScript
single-quoted string early, so the classic report export script could not parse.
The private original remains unchanged. Recheck this public text after any
future source refresh.

| File here | Original (Seating & Standings Manager) | SHA-256 of the original |
| --- | --- | --- |
| `styles/classic-report-export.js` | `tournament_analytics/assets/analytics.js` | `85e2b871c47a5feaf0e3732d24a983ae8caa6c4d011347e6febec72f39003bab` |
| `styles/classic-report-export-css.txt` (text the old code inlines, not a stylesheet of this site) | `"\n"` + `analytics.css` + `"\n"` + `recap.css` + `"\n"` + the export stylesheet, as the export page concatenates them | `bea02452…` / `326ebf4f…` / `29a97fd4…` |
| `styles/classic-report-catalog.json` | `assets/game_catalog.json` (names and indices only) | `19bafdd7550c11cc8fd9c6b860da12d36c40766538b9c46221f93ff5113f546b` |

The original export page (`27f10381…`) is not copied: its markup, without the inline scripts the
hosted pages refuse, is `CLASSIC_PAGE_BODY` in the module, and its three globals are set from the
module (empty template, so the export is the fallback document the TN12 post is).

No picture is copied. The old code asks for `/assets/img/track|cup|character/<index>`; the module
answers with this site's own game assets (`classicPicture`), scaled to the old files' size.

The night report itself followed on 2026-10-31: capability `tournament.analytics.night_report`
(migration 0074), API schema `mk8dx.tournament-night-report.v1` and the address `?night-report=`;
the first address `?erik-report=` was retired on 2026-11-02 (no old links; it now reads as an unknown address).
