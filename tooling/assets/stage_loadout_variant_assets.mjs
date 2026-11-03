#!/usr/bin/env node
// Stages owner-private Icon Matcher presentation PNGs into a schema-9 web
// release without placing game-derived files in Git.
import { copyFileSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { SharedAssetSource, sharedRootArgument } from "./shared_asset_source.mjs";
const arg = (name) => { const index = process.argv.indexOf(name); if (index < 0 || !process.argv[index + 1]) throw new Error(`missing ${name}`); return resolve(process.argv[index + 1]); };
const shared = sharedRootArgument() ? new SharedAssetSource() : null;
const source = shared ? null : arg("--source"), target = arg("--target");
const categories = [
  ["characters", "images/characters/variants"],
  ["bodies", "images/vehicles/bodies/variants"],
  ["gliders", "images/vehicles/gliders/variants"],
];
let count = 0;
const staged = {};
for (const [folder, destination] of categories) {
  const output = resolve(target, destination); mkdirSync(output, { recursive: true });
  const prefix = `icon-matcher/${folder}/`;
  const names = shared ? Object.keys(shared.files).filter((name) => name.startsWith(prefix)).map((name) => name.slice(prefix.length))
    : readdirSync(resolve(source, folder));
  for (const file of names.filter((name) => !name.includes("/") && name.includes("_variant.") && name.endsWith(".png")).sort()) {
    const logical = prefix + file;
    copyFileSync(shared ? shared.resolve(logical) : resolve(source, folder, file), resolve(output, file)); count += 1;
    if (shared) staged[`${destination}/${file}`] = { sourcePath: logical, ...shared.files[logical] };
  }
}
if (count !== 288) throw new Error(`expected 288 variant assets, staged ${count}`);
if (shared) writeFileSync(resolve(target, "loadout-variant-staging.v1.json"), JSON.stringify({
  schemaVersion: "mk8dx.shared-asset-variant-staging.v1", sourceManifestSha256: shared.manifestSha256, files: staged,
}, null, 2) + "\n");
console.log(`staged ${count} private loadout variant assets`);
