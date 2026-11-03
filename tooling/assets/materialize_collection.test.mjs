import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const script = fileURLToPath(new URL('./materialize_collection.mjs', import.meta.url));

test('external collection is explicit and each copied object is hash checked', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mk8dx-materialize-test-'));
  try {
    const collection = path.join(root, 'collection');
    const output = path.join(root, 'view');
    const payload = Buffer.from('synthetic fixture\n');
    const sha256 = createHash('sha256').update(payload).digest('hex');
    const object = path.join(collection, 'objects', sha256.slice(0, 2), sha256);
    await fs.mkdir(path.dirname(object), { recursive: true });
    await fs.writeFile(object, payload);
    await fs.writeFile(path.join(collection, 'collection-manifest.v1.json'), JSON.stringify({
      schemaVersion: 'mk8dx.internal-asset-collection.v1',
      releaseVersion: 'synthetic-v1',
      sources: { 'tournament-text': { fileCount: 1 } },
      files: { 'tournament-text/allowed.json': { sha256, sizeBytes: payload.length } },
    }));
    const run = (env) => spawnSync(process.execPath, [script, 'tournament-text', output], {
      env: { ...process.env, ...env }, encoding: 'utf8',
    });
    const missing = run({ MK8DX_ASSET_COLLECTION_ROOT: '' });
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /MK8DX_ASSET_COLLECTION_ROOT/);

    const valid = run({ MK8DX_ASSET_COLLECTION_ROOT: collection });
    assert.equal(valid.status, 0, valid.stderr);
    assert.deepEqual(await fs.readFile(path.join(output, 'allowed.json')), payload);

    await fs.writeFile(object, 'tampered fixture\n');
    const tampered = run({ MK8DX_ASSET_COLLECTION_ROOT: collection });
    assert.notEqual(tampered.status, 0);
    assert.match(tampered.stderr, /Collection object changed/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
