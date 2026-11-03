// Sequence decision parity: the TS module against Python's records.
//   node --experimental-strip-types sequence_decision_parity.mjs [vectors.json]
import { readFileSync } from 'node:fs';
import { SequenceDecision, fieldVote } from './sharedSequenceDecision.ts';

const path = process.argv[2] ?? new URL('../vectors/sequence-decision-v1.json', import.meta.url);
const doc = JSON.parse(readFileSync(path, 'utf8'));
const canon = (value) => JSON.stringify(value, (_key, v) => (v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]])) : v));
let differences = 0;
let steps = 0;
for (const scan of doc.scans) {
  const decision = new SequenceDecision();
  for (const step of scan.steps) {
    steps++;
    const justLocked = decision.updateTimes(step.fields, step.lapSumOk, step.lapSumRepairs, step.expectedFields);
    decision.addIdentity(step.identity);
    const after = { justLocked, locked: decision.locked, acceptPath: decision.acceptPath,
      lockedFields: decision.lockedFields, identitySettled: decision.identitySettled() };
    if (canon(after) !== canon(step.after)) {
      differences++;
      if (differences <= 5) console.log('step differs', canon(after), canon(step.after));
    }
  }
  // Insertion order is part of the specification: compare the snapshot with its key order.
  if (JSON.stringify(decision.result()) !== JSON.stringify(scan.result)) {
    differences++;
    if (differences <= 5) console.log('result differs\n got', JSON.stringify(decision.result()).slice(0, 800), '\n want', JSON.stringify(scan.result).slice(0, 800));
  }
}
let votes = 0;
for (const c of doc.fieldVotes ?? []) {
  votes++;
  const got = fieldVote(c.values.map(([v, w]) => [v, w]), c.minSupport, c.minMargin);
  const near = (a, b) => (a === null || b === null ? a === b
    : a.value === b.value && Math.abs(a.weight - b.weight) < 1e-9 && Math.abs(a.second - b.second) < 1e-9 && Math.abs(a.share - b.share) < 1e-9);
  if (!near(got, c.result)) { differences++; if (differences <= 5) console.log('vote differs', JSON.stringify(c), JSON.stringify(got)); }
}
console.log(`field votes=${votes}`);
console.log(`sequence decision parity scans=${doc.scans.length} steps=${steps} differences=${differences}`);
process.exitCode = differences ? 1 : 0;
