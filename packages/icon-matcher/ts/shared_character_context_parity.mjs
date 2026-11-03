/** Check the TypeScript character-context decision against pinned Python cases. */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { combineCharacter } from './sharedCharacterContext.ts';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const [casesArg, referenceArg, outArg] = process.argv.slice(2);
if (!casesArg || !referenceArg || !outArg) {
  throw new Error('Need <private-Python-cases> <private-references.json> <new-private-output>');
}
const inside = (path) => path === repo || path.startsWith(repo + sep);
const [casesPath, referencePath, outputPath] = [casesArg, referenceArg, outArg].map((path) => resolve(path));
if ([casesPath, referencePath, outputPath].some(inside) || existsSync(outputPath)) {
  throw new Error('Inputs and output must remain outside Git; output must be new');
}
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const casesBytes = readFileSync(casesPath);
const referenceBytes = readFileSync(referencePath);
const source = JSON.parse(casesBytes);
const manifest = JSON.parse(referenceBytes);
if (source.schema !== 'mk8dx.private-character-context-parity-cases.v1'
    || manifest.schema !== 'mk8dx.shared-icon-references.v1'
    || source.catalogSha256 !== manifest.catalogSha256) {
  throw new Error('Unpaired Python context cases and reference catalog');
}
const group = manifest.groups.characters__result;
if (!group || group.ids.length !== group.families.length) {
  throw new Error('Missing pinned character family map');
}
const families = new Map(group.ids.map((id, index) => [id, group.families[index]]));
const rows = [];
for (const item of source.cases) {
  const value = item.visual;
  const visual = { schema: 'mk8dx.visual-field-read.v1', kind: 'characters',
    profile: 'result', method: 'rgb', catalogSha256: source.catalogSha256,
    cropPixelSha256: '0'.repeat(64), status: value.acceptedId ? 'accepted' : 'unknown',
    top1Id: value.top1Id, acceptedId: value.acceptedId, score: value.score,
    margin: value.margin, offset: [0, 0], top: value.top };
  const actual = combineCharacter(visual, item.clue, families);
  const equal = JSON.stringify(actual) === JSON.stringify(item.expected);
  rows.push({ sourceRecordId: item.sourceRecordId, owner: item.owner,
    arm: item.arm, scenario: item.scenario, equal,
    expected: item.expected, actual });
}
const mismatches = rows.filter((item) => !item.equal);
const report = { schema: 'mk8dx.private-character-context-ts-parity.v1',
  pythonCasesSha256: hash(casesBytes), referenceManifestSha256: hash(referenceBytes),
  catalogSha256: source.catalogSha256, cases: rows.length,
  matches: rows.length - mismatches.length, mismatches,
  limits: ['Synthetic text clues verify decision parity, not OCR accuracy or Web product integration.'] };
writeFileSync(outputPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ cases: report.cases, matches: report.matches,
  mismatches: mismatches.length, reportSha256: hash(readFileSync(outputPath)) }));
if (mismatches.length) process.exitCode = 1;
