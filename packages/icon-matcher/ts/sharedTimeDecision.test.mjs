import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { lapSumClosure, lapSumComplete, repairGuard, timeMs } from './sharedTimeDecision.ts';

const vectors = JSON.parse(readFileSync(new URL('../vectors/time-decision-v1.json', import.meta.url), 'utf8'));

test('time decision equals the Python reference on the shared vectors', () => {
  for (const c of vectors.closures) assert.deepEqual(lapSumClosure(c.texts), c.repair, JSON.stringify(c.texts));
  for (const c of vectors.completes) assert.equal(lapSumComplete(c.owners), c.complete, JSON.stringify(c.owners));
  for (const c of vectors.guards) assert.equal(repairGuard(c.lapSumOk, c.repairs, c.minConfidence) !== null, c.guard);
});

test('format rules', () => {
  assert.equal(timeMs('1:23.456'), 83456);
  assert.equal(timeMs('1:63.456'), null);
  assert.equal(timeMs('1:2?.456'), null);
});
