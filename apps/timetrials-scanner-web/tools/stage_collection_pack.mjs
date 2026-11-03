// Stage the shared field reader (public/shared_icon) from the asset collection's recognition-pack group, so a
// scanner built from this repository reads character, kart, wheels, glider and flag like the released one, and the
// scanner-runtime group (OCR languages, icons) into public/.
// Part of `npm run sync-assets`; it materializes the pack into a temporary folder and hands it to
// tools/stage_shared_fields.mjs --recognition-pack.
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scannerRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = path.resolve(scannerRoot, '../..');
const temporary = mkdtempSync(path.join(tmpdir(), 'mk8dx-pack-'));
try {
  const pack = path.join(temporary, 'recognition-pack');
  execFileSync(process.execPath, [path.join(repositoryRoot, 'tooling/assets/materialize_collection.mjs'), 'recognition-pack', pack],
    { cwd: repositoryRoot, stdio: ['ignore', 'ignore', 'inherit'] });
  execFileSync(process.execPath, [path.join(scannerRoot, 'tools/stage_shared_fields.mjs'), '--recognition-pack', pack],
    { cwd: scannerRoot, stdio: ['ignore', 'ignore', 'inherit'] });
  // The scanner's own runtime files (OCR languages for every name script, icons), as the Web image build does;
  // copied over public/ so a file left by an older collection is replaced.
  const runtime = path.join(temporary, 'scanner-runtime');
  execFileSync(process.execPath, [path.join(repositoryRoot, 'tooling/assets/materialize_collection.mjs'), 'scanner-runtime', runtime],
    { cwd: repositoryRoot, stdio: ['ignore', 'ignore', 'inherit'] });
  cpSync(runtime, path.join(scannerRoot, 'public'), { recursive: true, force: true });
  console.log('Staged the shared field reader from the collection\'s recognition pack and the scanner runtime files.');
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
