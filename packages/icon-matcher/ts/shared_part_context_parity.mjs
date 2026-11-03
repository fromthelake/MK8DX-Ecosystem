/** Compare TS part-context decisions with Python on pinned visual cases. */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { combinePart, partRelationKey } from './sharedPartContext.ts';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const [casesArg, outArg] = process.argv.slice(2);
if (!casesArg || !outArg) throw new Error('Need <private-Python-cases> <new-private-output>');
const [casesPath, outputPath] = [casesArg, outArg].map((value) => resolve(value));
const inside = (path) => path === repo || path.startsWith(repo + sep);
if ([casesPath, outputPath].some(inside) || existsSync(outputPath)) {
  throw new Error('Inputs and output must remain outside Git; output must be new');
}
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const casesBytes = readFileSync(casesPath);
const source = JSON.parse(casesBytes);
if (source.schema !== 'mk8dx.private-part-context-parity-cases.v1') {
  throw new Error('Unexpected Python part cases');
}
const context = source.context;
const refs = { familyById: new Map(context.familyById),
  resultMembers: new Map(Object.entries(context.resultMembers)),
  partForCharacter: new Map(context.partForCharacter.map(([kind, family, character, value]) =>
    [partRelationKey(kind, family, character), value])),
  tireByIndex: new Map(context.tireByIndex) };
const mismatches = [];
const scenarios = {};
for (const item of source.cases) {
  const value = item.visual;
  const visual = { schema: 'mk8dx.visual-field-read.v1', kind: item.kind,
    profile: 'result', method: 'rgb', catalogSha256: source.catalogSha256,
    cropPixelSha256: value.cropPixelSha256 ?? '0'.repeat(64),
    status: value.acceptedId ? 'accepted' : 'unknown', top1Id: value.top1Id,
    acceptedId: value.acceptedId, score: value.score, margin: value.margin,
    familyMargin: value.familyMargin,
    offset: [0, 0], top: value.top };
  const actual = combinePart(item.kind, visual, item.character, item.clue, refs);
  scenarios[item.scenario] = (scenarios[item.scenario] ?? 0) + 1;
  if (JSON.stringify(actual) !== JSON.stringify(item.expected)) {
    mismatches.push({ sourceRecordId: item.sourceRecordId, owner: item.owner,
      kind: item.kind, scenario: item.scenario, expected: item.expected, actual });
  }
}
const report = { schema: 'mk8dx.private-part-context-ts-parity.v1',
  pythonCasesSha256: hash(casesBytes), catalogSha256: source.catalogSha256,
  cases: source.cases.length, matches: source.cases.length - mismatches.length,
  scenarios, mismatches,
  limits: ['Decision parity only; neither OCR accuracy nor Web worker integration.'] };
writeFileSync(outputPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ cases: report.cases, matches: report.matches,
  scenarios, mismatches: mismatches.length, reportSha256: hash(readFileSync(outputPath)) }));
if (mismatches.length) process.exitCode = 1;
