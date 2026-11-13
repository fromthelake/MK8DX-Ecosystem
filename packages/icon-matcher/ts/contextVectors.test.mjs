// Replays vectors/context-v1.json (Python context.py, tools/generate_vectors.py) against
// sharedCharacterContext.ts and sharedPartContext.ts, and its OCR normalization cases against
// sharedNameMatch.normalizeName. Decisions must be identical; there are no known exceptions since
// issue #99 phase 2 (divergences 6 and 8 are one rule in every runtime).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { combineCharacter } from './sharedCharacterContext.ts';
import { combinePart, partRelationKey } from './sharedPartContext.ts';
import { normalizeName } from './sharedNameMatch.ts';

const doc = JSON.parse(readFileSync(new URL('../vectors/context-v1.json', import.meta.url), 'utf8'));

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

const KEYS = ['id', 'familyId', 'status', 'evidence', 'visualTop1', 'suggestedId'];
// Character decisions carry no suggestion field in TypeScript; Python writes null.
const canonical = (decision) => JSON.stringify(KEYS.map((key) => decision[key] ?? null));

function run(item) {
  const visual = visualRead(item.visual);
  if (item.rule === 'character') return combineCharacter(visual, item.clue, familyById);
  return combinePart(item.kind, visual, item.character, item.clue, refs, item.tireTextTop3Guard);
}

test('context-v1 is decision-identical to the Python reference', () => {
  assert.equal(doc.schema, 'mk8dx.context-vectors.v1');
  assert.ok(doc.cases.length >= 50);
  const unexpected = [];
  for (const item of doc.cases) {
    const got = run(item);
    if (canonical(got) !== canonical(item.expected)) {
      unexpected.push(`${item.id}${item.boundary ? ' [boundary]' : ''}: python=${JSON.stringify(item.expected)} ts=${JSON.stringify(got)}`);
    }
  }
  assert.deepEqual(unexpected, []);
});

test('context-v1 OCR normalization folds full-width digits like Python', () => {
  assert.ok(doc.ocrNormalization.length >= 4);
  for (const item of doc.ocrNormalization) {
    assert.equal(normalizeName(item.text), item.normalized, JSON.stringify(item.text));
  }
});
