// Card-presence parity: the TS port against Python records on private columns.
//   node --experimental-strip-types card_presence_parity.mjs <card-anchors.json> <bundle-dir>
// The bundle comes from tooling/recognition/export_card_presence_vectors.py.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { cardPresence, parseCardAnchors } from './sharedCardPresence.ts';

const [anchorsPath, dir] = process.argv.slice(2);
const raw = await readFile(anchorsPath);
const anchors = parseCardAnchors(JSON.parse(raw.toString('utf8')), createHash('sha256').update(raw).digest('hex'));
const bundle = JSON.parse(await readFile(path.join(dir, 'bundle.json'), 'utf8'));
if (bundle.anchorsSha256 !== anchors.sha256) throw new Error('bundle was made with other anchors');
const [x0, x1] = bundle.columnX;
const screens = new Map();
let differences = 0; let worst = 0;
for (const item of bundle.cases) {
  if (!screens.has(item.column)) {
    const column = await readFile(path.join(dir, 'columns', item.column));
    const rgb = new Uint8Array(1280 * 720 * 3);
    const w = (x1 - x0) * 3;
    for (let y = 0; y < 720; y += 1) rgb.set(column.subarray(y * w, (y + 1) * w), (y * 1280 + x0) * 3);
    screens.set(item.column, rgb);
  }
  const got = cardPresence(screens.get(item.column), 1280, 720, anchors, item.owner, item.lapCount, item.excludeSlot);
  const want = item.expected;
  const same = got.present === want.present && got.slot === want.slot && got.y === want.y
    && got.circleY === want.circleY && got.best?.slot === want.best?.slot && got.best?.offset === want.best?.offset;
  for (let i = 0; i < (want.best?.scores ?? []).length; i += 1) {
    worst = Math.max(worst, Math.abs(got.best.scores[i] - want.best.scores[i]));
  }
  if (!same) { differences += 1; if (differences <= 5) console.log('differs', item.column, item.owner, item.lapCount, item.excludeSlot); }
}
console.log(`cases=${bundle.cases.length} differences=${differences} maxScoreDelta=${worst.toExponential(2)}`);
process.exitCode = differences || worst > 1e-9 ? 1 : 0;
