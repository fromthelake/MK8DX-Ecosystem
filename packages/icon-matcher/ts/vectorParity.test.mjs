// Every committed cross-runtime vector file (../vectors/*-v1.json) replayed against the TypeScript
// modules. Python (python/tests) and Java (scan-runtime and app *ParityTest) replay the same files.
// Each *_parity.mjs script prints its counts and sets a non-zero exit code on any difference; here
// it runs in its own process with the same flags as this test run.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const vectorsDir = fileURLToPath(new URL('../vectors/', import.meta.url));
const hook = new URL('./ts_resolve_hook.mjs', import.meta.url).href;
const flags = ['--experimental-strip-types', '--no-warnings', '--experimental-loader', hook];

// vector file -> the script that replays it (open-set and time-decision have their own node:test files)
const SCRIPTS = {
  'card-quad-v1.json': 'card_quad_parity.mjs',
  'card-registration-v1.json': 'card_registration_parity.mjs',
  'card-roi-v1.json': 'card_roi_parity.mjs',
  'detections-v1.json': 'detections_parity.mjs',
  'panel-registration-v1.json': 'panel_registration_parity.mjs',
  'scan-result-v1.json': 'scan_result_parity.mjs',
  'sequence-decision-v1.json': 'sequence_decision_parity.mjs',
  'open-set-v1.json': 'sharedOpenSet.test.mjs',
  'time-decision-v1.json': 'sharedTimeDecision.test.mjs',
  'context-v1.json': 'contextVectors.test.mjs',
  'icon-score-v1.json': 'iconScoreVectors.test.mjs',
  'refinement-v1.json': 'refinementVectors.test.mjs',
  'frame-geometry-v1.json': 'frame_geometry_parity.mjs',
  'lap-grid-v1.json': 'lap_grid_parity.mjs',
};
// Scripts whose first argument is the pack's frame-definitions-v1.json (skipped without a pack).
const NEEDS_FRAME_DEFINITIONS = new Set(['frame_geometry_parity.mjs', 'lap_grid_parity.mjs']);
const frameDefinitions = process.env.MK8DX_FRAME_DEFINITIONS
  || (process.env.MK8DX_RECOGNITION_PACK ? join(process.env.MK8DX_RECOGNITION_PACK, 'frame-definitions-v1.json') : null);
const haveFrameDefinitions = Boolean(frameDefinitions && existsSync(frameDefinitions));

test('every committed vector file has a TypeScript replay', () => {
  const files = readdirSync(vectorsDir).filter((name) => name.endsWith('.json')).sort();
  assert.ok(files.length >= 9, `expected the committed vectors, found ${files.length}`);
  assert.deepEqual(files.filter((name) => !SCRIPTS[name]), [], 'vector files without a TypeScript replay');
});

for (const [vector, script] of Object.entries(SCRIPTS)) {
  if (script.endsWith('.test.mjs')) continue; // picked up by the same node --test glob
  const needsDefs = NEEDS_FRAME_DEFINITIONS.has(script);
  test(`${vector} replays identically (${script})`, { skip: needsDefs && !haveFrameDefinitions
    && 'frame definitions not available (set MK8DX_RECOGNITION_PACK)' }, () => {
    const args = needsDefs ? [frameDefinitions, `${vectorsDir}${vector}`] : [`${vectorsDir}${vector}`];
    const run = spawnSync(process.execPath, [...flags, script, ...args],
      { cwd: here, encoding: 'utf8', timeout: 120_000 });
    const output = `${run.stdout}${run.stderr}`;
    assert.equal(run.status, 0, `${script} exited ${run.status}\n${output}`);
    assert.match(output, /differences=0\b/, output);
    assert.doesNotMatch(output, /\b(?:cases|quads|raw|end|scans)=0\b/, `no cases replayed\n${output}`);
  });
}
