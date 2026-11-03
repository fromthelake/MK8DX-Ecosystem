// Build-time counterpart of shared_asset_source.py. No image transformation,
// implicit machine path, or browser-visible filesystem location.
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

function safePath(value) {
  if (typeof value !== "string" || value === "" || value.startsWith("/") ||
      /[\\:\x00-\x1f]/.test(value) || value.split("/").some((part) => ["", ".", ".."].includes(part))) {
    throw new Error("Unsafe shared asset path");
  }
  return value;
}

export function sharedRootArgument(arguments_ = process.argv.slice(2)) {
  const index = arguments_.indexOf("--shared-asset-root");
  const value = index < 0 ? process.env.MK8DX_SHARED_ASSET_ROOT : arguments_[index + 1];
  if (index >= 0 && (!value || value.startsWith("--"))) throw new Error("Missing --shared-asset-root value");
  return value;
}

export class SharedAssetSource {
  constructor(root = sharedRootArgument()) {
    if (!root) throw new Error("Supply --shared-asset-root or MK8DX_SHARED_ASSET_ROOT");
    this.root = realpathSync(resolve(root));
    const raw = readFileSync(join(this.root, "asset-source-manifest.v1.json"));
    this.manifestSha256 = createHash("sha256").update(raw).digest("hex");
    this.manifest = JSON.parse(raw);
    if (this.manifest.schemaVersion !== "mk8dx.shared-asset-source.v1") throw new Error("Unsupported shared asset manifest");
    this.files = this.manifest.files;
    const folded = new Set();
    for (const [logical, entry] of Object.entries(this.files)) {
      safePath(logical);
      if (folded.has(logical.toLowerCase()) || !/^[0-9a-f]{64}$/.test(entry.sha256) ||
          !Number.isSafeInteger(entry.sizeBytes) || entry.sizeBytes < 0) throw new Error("Invalid shared asset manifest entry");
      folded.add(logical.toLowerCase());
    }
  }

  resolve(logicalPath) {
    safePath(logicalPath);
    const entry = this.files[logicalPath];
    if (!entry) throw new Error(`Unknown shared asset: ${logicalPath}`);
    const segments = ["objects", entry.sha256.slice(0, 2), entry.sha256];
    let path = this.root;
    for (const part of segments) {
      if (!readdirSync(path).includes(part)) throw new Error(`Missing/case-changed asset: ${logicalPath}`);
      path = join(path, part);
      if (lstatSync(path).isSymbolicLink()) throw new Error("Shared asset symlink refused");
    }
    const resolved = realpathSync(path), boundary = relative(this.root, resolved);
    if (isAbsolute(boundary) || boundary === ".." || boundary.startsWith(`..${sep}`)) throw new Error("Shared asset escaped root");
    const bytes = readFileSync(resolved);
    if (bytes.length !== entry.sizeBytes || createHash("sha256").update(bytes).digest("hex") !== entry.sha256) {
      throw new Error(`Changed shared asset: ${logicalPath}`);
    }
    return resolved;
  }
}

export function sourceDatabasePath(explicitPath) {
  // Existing explicit inputs remain supported; adoption can be verified per consumer.
  return explicitPath ?? new SharedAssetSource().resolve("schema9/database.json");
}
