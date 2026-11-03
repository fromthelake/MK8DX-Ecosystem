// Bouwt een uploadklare map voor submap-hosting (bv. https://example.invalid/mk8dxscanner/).
//   node tools/build_deploy.mjs [--name mk8dxscanner] [--out deploy/mk8dxscanner]
// (--name zonder slashes: Git Bash converteert /pad-argumenten naar Windows-paden)
// Zet de Vite-base (service-worker-scope, manifest, asset-paden) op het opgegeven pad,
// zonder Git-Bash-padconversie-problemen. Uitvoer bevat ook .htaccess (verborgen bestand!).
import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..');

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const basePath = `/${opt('--name', 'mk8dxscanner').replace(/^\/+|\/+$/g, '')}/`;
const outOption = opt('--out', path.join('deploy', basePath.replace(/\//g, '') || 'root'));
const out = path.resolve(projectRoot, outOption);
const r = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['vite', 'build', '--outDir', out, '--emptyOutDir'], {
  cwd: projectRoot,
  stdio: 'inherit',
  env: { ...process.env, MK8_BASE_PATH: basePath },
  shell: process.platform === 'win32',
});
if (r.status !== 0) process.exit(r.status ?? 1);
const files = [];
async function walk(dir) { for (const e of await fs.readdir(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) await walk(p); else files.push(p); } }
await walk(out);
let bytes = 0;
for (const f of files) bytes += (await fs.stat(f)).size;
const ht = await fs.stat(path.join(out, '.htaccess')).catch(() => null);
console.log(`\nklaar: ${path.resolve(out)}  (${files.length} bestanden, ${(bytes / 1048576).toFixed(0)} MB, base ${basePath}, .htaccess ${ht ? 'aanwezig' : 'ONTBREEKT'})`);
console.log('upload de INHOUD van deze map naar de submap op de host; .htaccess is een verborgen bestand (WinSCP: verborgen bestanden tonen).');
