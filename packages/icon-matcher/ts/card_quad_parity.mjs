// Card quad parity: the TS module against Python's records.
//   node --experimental-strip-types card_quad_parity.mjs [vectors.json]
import { readFileSync } from 'node:fs';
import { QuadLine, clusterLines, filterAngles, ghostDetailDeskewSeed, selectQuad, shortLineGuard } from './sharedCardQuad.ts';

const path = process.argv[2] ?? new URL('../vectors/card-quad-v1.json', import.meta.url);
const doc = JSON.parse(readFileSync(path, 'utf8'));
const close = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
const sameQuad = (got, want) => (got === null || want === null ? got === want
  : got.every((p, i) => close(p.x, want[i][0]) && close(p.y, want[i][1])));
const sameLine = (l, w) => close(l.x1, w.x1) && close(l.y1, w.y1) && close(l.x2, w.x2) && close(l.y2, w.y2)
  && close(l.workflowLen(), w.workflowLength) && close(Number.isNaN(l.angle) ? l.angleDeg() : l.angle, w.angle)
  && close(l.support, w.support) && l.count === w.count && l.keyName === w.keyName && close(l.keyValue, w.keyValue);
let differences = 0;
for (const c of doc.quads) {
  const axis = filterAngles(c.segments.map((s) => new QuadLine(s[0], s[1], s[2], s[3])));
  const guard = shortLineGuard(axis);
  const clusters = clusterLines(guard.lines);
  const quad = selectQuad(c.maskW, c.maskH, clusters);
  const ok = axis.length === c.axisCount && guard.guardUsed === c.guardUsed && guard.fallbackUsed === c.fallbackUsed
    && guard.lines.length === c.guardedCount && clusters.length === c.clusters.length
    && clusters.every((l, i) => sameLine(l, c.clusters[i])) && sameQuad(quad, c.quad);
  if (!ok && ++differences <= 5) console.log('quad differs', JSON.stringify(quad), JSON.stringify(c.quad));
}
for (const c of doc.deskews) {
  const got = ghostDetailDeskewSeed(c.detections, c.frameW, c.frameH, c.roiLeft, c.roiTop, c.cropW, c.cropH);
  const ok = got === null || c.result === null ? got === c.result
    : close(got.degrees, c.result.degrees) && sameQuad(got.quad, c.result.quad);
  if (!ok && ++differences <= 5) console.log('deskew differs', JSON.stringify(got), JSON.stringify(c.result));
}
console.log(`card quad parity quads=${doc.quads.length} deskews=${doc.deskews.length} differences=${differences}`);
process.exitCode = differences ? 1 : 0;
