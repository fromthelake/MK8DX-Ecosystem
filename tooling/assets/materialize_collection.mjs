// Materialize a consumer view from the one versioned internal object collection.
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Objects over GitHub's 100 MiB limit are stored as `<sha>.part1`, `<sha>.part2`, ... and joined into the
// (ignored) object file on first use; tooling/assets/shared_asset_source.py does the same.
async function hydrateObject(folder, digest) {
  const target = path.join(folder, digest);
  try { await fs.access(target); return target; } catch { /* stored split, or missing */ }
  const names = (await fs.readdir(folder).catch(() => []))
    .map((name) => [name, new RegExp(`^${digest}\\.part([1-9][0-9]*)$`).exec(name)])
    .filter(([, match]) => match).sort(([, a], [, b]) => Number(a[1]) - Number(b[1])).map(([name]) => name);
  if (!names.length) return target;
  const joined = Buffer.concat(await Promise.all(names.map((name) => fs.readFile(path.join(folder, name)))));
  if (createHash('sha256').update(joined).digest('hex') !== digest) throw new Error(`Split object does not join to its hash: ${digest}`);
  await fs.writeFile(`${target}.joining`, joined);
  await fs.rename(`${target}.joining`, target);
  return target;
}

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const collection = path.join(repo, 'packages', 'assets', 'collection');
const args = process.argv.slice(2);
if (args.length !== 2 || !['web', 'android-scan', 'android-product', 'schema9', 'tt-scan', 'icon-matcher', 'tournament', 'tournament-text', 'legacy-live', 'livetrial-runtime', 'ocr-models', 'scanner-runtime', 'recognition-pack'].includes(args[0])) {
  throw new Error('Usage: node materialize_collection.mjs <web|group> <absolute-output-directory>');
}
const [selection, rawOutput] = args;
if (!path.isAbsolute(rawOutput)) throw new Error('Output must be absolute');
const output = path.resolve(rawOutput);
if (output === collection || output.startsWith(collection + path.sep) || collection.startsWith(output + path.sep)) {
  throw new Error('Output overlaps collection');
}

async function noReparse(value) {
  let cursor = path.parse(path.resolve(value)).root;
  for (const part of path.resolve(value).slice(cursor.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    try {
      if ((await fs.lstat(cursor)).isSymbolicLink()) throw new Error('Reparse path');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}

function safeRelative(value) {
  if (!value || value.includes('\\') || value.includes(':') || value.startsWith('/') ||
      value.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error('Unsafe collection path');
  }
  return value;
}

await noReparse(collection);
await noReparse(output);
const manifest = JSON.parse(await fs.readFile(path.join(collection, 'collection-manifest.v1.json'), 'utf8'));
if (manifest.schemaVersion !== 'mk8dx.internal-asset-collection.v1') throw new Error('Unknown collection version');
let selected;
if (['web', 'android-scan', 'android-product'].includes(selection)) {
  const viewName = selection === 'web' ? 'web-asset' : selection;
  const view = JSON.parse(await fs.readFile(path.join(repo, `packages/assets/${viewName}-selection-v1.json`), 'utf8'));
  if (view.schemaVersion !== `mk8dx.${viewName}-selection.v1` || view.collectionVersion !== manifest.releaseVersion) {
    throw new Error('Consumer selection and collection differ');
  }
  selected = Object.entries(view.files);
} else {
  selected = Object.keys(manifest.files).filter(name => name.startsWith(selection + '/'))
    .map(name => [name.slice(selection.length + 1), name]);
  if (selected.length !== manifest.sources[selection]?.fileCount) throw new Error('Incomplete collection group');
}
if (!selected.length || new Set(selected.map(([name]) => name.toLowerCase())).size !== selected.length) {
  throw new Error('Empty or case-colliding consumer view');
}
await fs.mkdir(output, { recursive: true });
let bytes = 0;
for (const [relative, logical] of selected.sort(([a], [b]) => a.localeCompare(b))) {
  safeRelative(relative);
  const row = manifest.files[logical];
  if (!row || !/^[0-9a-f]{64}$/.test(row.sha256)) throw new Error('Unknown or invalid resource ID');
  const source = await hydrateObject(path.join(collection, 'objects', row.sha256.slice(0, 2)), row.sha256);
  const target = path.join(output, ...relative.split('/'));
  await noReparse(source);
  await noReparse(target);
  const payload = await fs.readFile(source);
  if (payload.length !== row.sizeBytes || createHash('sha256').update(payload).digest('hex') !== row.sha256) {
    throw new Error(`Collection object changed: ${logical}`);
  }
  await fs.mkdir(path.dirname(target), { recursive: true });
  try {
    const existing = await fs.readFile(target);
    if (!existing.equals(payload)) throw new Error(`Existing consumer file differs: ${relative}`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await fs.writeFile(target, payload);
  }
  bytes += payload.length;
}
console.log(JSON.stringify({ selection, files: selected.length, bytes, collectionVersion: manifest.releaseVersion }));
