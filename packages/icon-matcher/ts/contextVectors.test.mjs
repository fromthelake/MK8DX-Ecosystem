// Replays vectors/context-v1.json (Python context.py, tools/generate_vectors.py) against
// sharedCharacterContext.ts and sharedPartContext.ts. Decisions must be identical.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { combineCharacter } from './sharedCharacterContext.ts';
import { combinePart, partRelationKey } from './sharedPartContext.ts';

const doc = JSON.parse(readFileSync(new URL('../vectors/context-v1.json', import.meta.url), 'utf8'));

// Genuine Python/TypeScript rule differences, kept visible until the owner decides (issue #99).
const KNOWN_DIVERGENCES = new Map([
  // #99 divergence 6: Python's glider conflict rule also accepts a "suggested" character; TS only "unknown".
  ['part.glider_suggested_character_conflict', 'issue #99 divergence 6 (suggested character status)'],
  // #99 divergence 8: Python str.isdecimal() accepts Unicode digits as a tyre row number; TS /^\d+$/ is ASCII.
  ['part.tire_unicode_digit', 'issue #99 divergence 8 (Unicode digit tyre index)'],
]);

const catalog = doc.catalog;
const familyById = new Map(Object.entries(catalog.familyById));
const refs = {
  familyById,
  resultMembers: new Map(Object.entries(catalog.resultMembers)),
  partForCharacter: new Map(catalog.partForCharacter.map(([kind, family, character, part]) =>
    [partRelationKey(kind, family, character), part])),
  tireByIndex: new Map(catalog.tireByIndex),
};

function visualRead(visual) {
  const accepted = visual.status === 'accepted';
  const familyTop = visual.familyTop;
  return { schema: 'mk8dx.visual-field-read.v1', kind: visual.kind, profile: 'result', method: 'rgb',
    status: visual.status, top1Id: visual.top[0].id, acceptedId: accepted ? visual.top[0].id : null,
    score: visual.score, margin: visual.margin,
    familyMargin: familyTop.length > 1 ? familyTop[0].score - familyTop[1].score : null,
    offset: [0, 0], top: visual.top };
}

const KEYS = ['id', 'familyId', 'status', 'evidence', 'visualTop1'];
const canonical = (decision) => JSON.stringify(KEYS.map((key) => decision[key]));

function run(item) {
  const visual = visualRead(item.visual);
  if (item.rule === 'character') return combineCharacter(visual, item.clue, familyById);
  return combinePart(item.kind, visual, item.character, item.clue, refs, item.tireTextTop3Guard);
}

test('context-v1 is decision-identical to the Python reference', () => {
  assert.equal(doc.schema, 'mk8dx.context-vectors.v1');
  assert.ok(doc.cases.length >= 50);
  const unexpected = [];
  const known = [];
  for (const item of doc.cases) {
    const got = run(item);
    const same = canonical(got) === canonical(item.expected);
    if (KNOWN_DIVERGENCES.has(item.id)) {
      known.push(`${item.id}: ${same ? 'now EQUAL' : 'differs'} (${KNOWN_DIVERGENCES.get(item.id)})`);
    } else if (!same) {
      unexpected.push(`${item.id}${item.boundary ? ' [boundary]' : ''}: python=${JSON.stringify(item.expected)} ts=${JSON.stringify(got)}`);
    }
  }
  if (known.length) console.log(`context-v1 known divergences:\n  ${known.join('\n  ')}`);
  assert.deepEqual(unexpected, []);
});
