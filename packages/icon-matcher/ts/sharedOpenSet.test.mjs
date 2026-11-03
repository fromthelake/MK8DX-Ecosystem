import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { miiSuggestion } from './sharedOpenSet.ts';

const vectors = JSON.parse(readFileSync(new URL('../vectors/open-set-v1.json', import.meta.url), 'utf8'));
const near = (a, b) => JSON.stringify(a, (k, v) => (typeof v === 'number' ? Math.round(v * 1e9) / 1e9 : v))
  === JSON.stringify(b, (k, v) => (typeof v === 'number' ? Math.round(v * 1e9) / 1e9 : v));

test('open-set suggestion equals the Python reference', () => {
  for (const c of vectors.suggestions) {
    assert.ok(near(miiSuggestion(c.profile, c.top, c.acceptedId), c.suggestion), JSON.stringify(c));
  }
});

// The result-card step (sharedResultProposal.openSetDecision) imports without .ts extensions, which
// only the bundler resolves; Java (OpenSetParityTest) checks the proposal vectors.
