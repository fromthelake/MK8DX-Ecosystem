# Asset catalogue

`schema9-asset-catalog-v1.json` owns stable game asset IDs used by API and Web. Consumer adapters validate references against it. Change a catalogue ID only with a compatibility review and API/Web contract tests. The Web benchmark manifest is generated from approved reference inputs; it is not an independent source of records. This package must not import application internals.

## Complete internal collection

`collection/collection-manifest.v1.json` is the release inventory for physical
runtime objects. Its current release version is
`master-schema9-v5.10-pack-0.4.2-2026-11-05-r1` (the same value as `assetCollectionVersion` in
`compatibility.json`): group `schema9` is Clean Assets v5.10 (catalog `2375050f…`) and group `recognition-pack`
is the central recognition pack (field semantics 0.4.2, `recognition-pack/manifest.json`) that the scanner,
Android, LiveTrial and Tournament builds take with `--recognition-pack` (materialize it with
`node tooling/assets/materialize_collection.mjs recognition-pack <dir>`). Group `scan-stage` holds the
Android scanner's staged runtime (view `android-scan`), and groups `tournament` and `legacy-live` carry the
locale race-counter, results-banner and class-badge templates. Every logical resource has a role,
consumer, size and SHA-256; identical bytes occupy one object. Run
`python tooling/assets/shared_asset_source.py verify` from the repository root
to verify the complete collection. `node tooling/assets/materialize_collection.mjs`
creates the selected Web, Android, LiveTrial and Tournament build views from it.
The object store is the single authoritative copy; generated views are ignored
build outputs. The schema-9 catalogue, database migrations and reference seeds
retain their distinct domain ownership.

No Git LFS is used. The one object above GitHub's 100 MiB file limit (the
121,579,098-byte scanner ONNX model) is stored as `<sha>.part1` and `<sha>.part2`;
`shared_asset_source.py` (`verify`, `resolve`) and `materialize_collection.mjs`
join them into the object, an ignored local file, on first use and check the
joined SHA-256. The privacy scan and the full archive check the parts the same way.
