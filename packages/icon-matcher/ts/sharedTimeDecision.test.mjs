import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { lapSumClosure, lapSumComplete, preferClosedSeed, repairGuard, timeMs } from './sharedTimeDecision.ts';

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

test('a weak repaired refinement cannot displace a closed ordinary read', () => {
  assert.equal(preferClosedSeed(true, true, 1, 0.609), true);
  assert.equal(preferClosedSeed(true, true, 1, 0.65), false);
  assert.equal(preferClosedSeed(true, true, 0, 0.609), false);
  assert.equal(preferClosedSeed(true, false, 0, 1), true);
  assert.equal(preferClosedSeed(false, true, 1, 0.609), false);
});
