// Name matcher parity: the TS module against Python's records.
//   node --experimental-strip-types name_match_parity.mjs <vectors.json>
import { readFileSync } from 'node:fs';
import { localeVote, matchName, matchTitle, nameMatchStrong, sameNameLocales, scriptForLocale } from './sharedNameMatch.ts';

const doc = JSON.parse(readFileSync(process.argv[2], 'utf8'));
let differences = 0;
for (const c of doc.cases) {
  const m = matchName(c.query, doc.vocabs[c.kind]);
  const same = m.key === c.key && m.name === c.name && Math.abs(m.fuzzy - c.fuzzy) <= 1e-12
    && Math.abs(m.margin - c.margin) <= 1e-12 && nameMatchStrong(m) === c.strong;
  if (!same) { differences++; if (differences <= 5) console.log('differs', JSON.stringify(c.query), m.key, c.key, m.fuzzy, c.fuzzy); }
}
const records = Object.fromEntries(Object.entries(doc.vocabs).map(([kind, pairs]) => [kind, Object.fromEntries(pairs)]));
let voteDifferences = 0;
for (const v of doc.votes) {
  const got = localeVote(v.rows, records, doc.locales, v.preferred);
  const same = got.locale === v.locale && Math.abs(got.score - v.score) <= 1e-12 && JSON.stringify(got.tied) === JSON.stringify(v.tied)
    && (got.firstMatch?.key ?? null) === v.firstKey;
  if (!same) { voteDifferences++; if (voteDifferences <= 5) console.log('vote differs', got.locale, v.locale, got.score, v.score); }
}
differences += voteDifferences;
for (const c of doc.sameNames ?? []) {
  const locs = sameNameLocales(records.bodies, c.key);
  const scripts = [...new Set(locs.map(scriptForLocale))].sort();
  if (JSON.stringify(locs) !== JSON.stringify(c.locales) || JSON.stringify(scripts) !== JSON.stringify(c.scripts)) {
    differences++; if (differences <= 5) console.log('same-name differs', c.key, locs, c.locales);
  }
}
const subsets = { all: doc.vocabs.tracks,
  'en-nl': doc.vocabs.tracks.filter(([k]) => k.endsWith('#en-GB') || k.endsWith('#en-US') || k.endsWith('#nl-NL')) };
for (const t of doc.titles ?? []) {
  const m = matchTitle(t.query, subsets[t.subset]);
  const same = m.key === t.key && m.name === t.name && m.rule === t.rule && Math.abs(m.fuzzy - t.fuzzy) <= 1e-12
    && Math.abs(m.margin - t.margin) <= 1e-12;
  if (!same) { differences++; if (differences <= 5) console.log('title differs', JSON.stringify(t.query), m.key, t.key, m.rule, t.rule); }
}
console.log(`titles=${(doc.titles ?? []).length} queries=${doc.cases.length} votes=${doc.votes.length} sameNames=${(doc.sameNames ?? []).length} differences=${differences}`);
process.exitCode = differences ? 1 : 0;
