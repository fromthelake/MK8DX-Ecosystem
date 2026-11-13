// Links every compiled API module against the real installed packages, without running any of them.
//
// Unit tests may mock a package, and Vitest's interop turns a missing export into `undefined` instead of an error,
// so a dependency upgrade that removes an export (web-push 4 dropped its default export) can pass every test and
// still stop the API at startup. This check uses Node's own ES module linker: an import of a name a package does not
// export fails here exactly as it would in production. Our modules are linked, never evaluated, so entry points
// (`*-main.js`) are safe to include. Packages and Node built-ins are loaded to read their real export names.
//
// Usage (after `npm run build`): node --experimental-vm-modules scripts/check-module-links.mjs [dist]
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";

const root = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), "..", "dist"));
const context = vm.createContext({});
const ours = new Map();
const external = new Map();

function files(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? files(path) : name.endsWith(".js") ? [path] : [];
  });
}

function own(path) {
  let module = ours.get(path);
  if (!module) {
    module = new vm.SourceTextModule(readFileSync(path, "utf8"), { identifier: pathToFileURL(path).href, context });
    ours.set(path, module);
  }
  return module;
}

async function foreign(specifier, attributes) {
  const key = `${specifier}|${JSON.stringify(attributes ?? {})}`;
  let module = external.get(key);
  if (!module) {
    const namespace = await import(specifier, attributes && Object.keys(attributes).length ? { with: attributes } : undefined);
    const names = Object.keys(namespace);
    module = new vm.SyntheticModule(names, function () {
      for (const name of names) this.setExport(name, namespace[name]);
    }, { identifier: `external:${specifier}`, context });
    external.set(key, module);
  }
  return module;
}

async function linker(specifier, referencing, extra) {
  const attributes = extra?.attributes ?? extra?.assert;
  if (specifier.startsWith(".") || specifier.startsWith("/") || specifier.startsWith("file:")) {
    const target = fileURLToPath(new URL(specifier, referencing.identifier));
    if (target.endsWith(".js")) return own(target);
    // A relative non-JS import (for example JSON) is resolved like a package import.
    return foreign(pathToFileURL(target).href, attributes);
  }
  // Packages resolve from the API folder, as at run time.
  const resolved = import.meta.resolve(specifier, pathToFileURL(join(root, "index.js")).href);
  return foreign(resolved.startsWith("node:") ? resolved : resolved, attributes);
}

const all = files(root);
const failures = [];
for (const path of all) {
  const module = own(path);
  if (module.status !== "unlinked") continue;
  try {
    await module.link(linker);
  } catch (error) {
    failures.push(`${path.slice(root.length + 1)}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
if (failures.length > 0) {
  console.error(`module link check: ${failures.length} of ${all.length} modules failed to link`);
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}
console.log(`module link check: ${all.length} modules linked against ${external.size} packages and built-ins`);
