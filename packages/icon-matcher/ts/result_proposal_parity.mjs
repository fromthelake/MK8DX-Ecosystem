// Shared decision vectors: run composeResultProposal on recorded owner evidence.
//   node --experimental-strip-types result_proposal_parity.mjs <evidence-dir> <out.json>
// Each input JSON carries kartOwners (per owner, per field, the shared reads
// without pixels). The output maps "<file>|<owner>" to the TS proposal; the
// Python (and Java) ports must reproduce it exactly.
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { composeResultProposal } from './sharedResultProposal.ts';

const [dir, out] = process.argv.slice(2);
const vectors = {};
for (const name of (await readdir(dir)).filter((n) => n.endsWith('.json')).sort()) {
  const record = JSON.parse(await readFile(path.join(dir, name), 'utf8'));
  for (const [owner, entry] of Object.entries(record.kartOwners ?? {})) {
    if (!entry || typeof entry !== 'object') continue;
    vectors[`${name}|${owner}`] = { input: entry, output: composeResultProposal(entry) };
  }
}
await writeFile(out, JSON.stringify(vectors));
console.log(Object.keys(vectors).length, 'vectors');
