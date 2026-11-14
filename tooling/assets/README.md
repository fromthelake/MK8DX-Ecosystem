# Asset Release Verification Tooling

`schema9-release-baseline-v7.json` pins the current Clean Assets schema-9
runtime release (v5.9: the Tournament LAN templates in all 15 game languages -
064 results banner, 091 race counter word, 092 too-far-behind message, 093 the
Russian final-race word - and the class badges 094-097, HUD templates 91 -> 98;
it includes v5.8's capture-console note on the nameplates) without copying its
image payload into active packages; its database is
`03725419031e259e52885e0a5b76291cce8c60945d09e5b1c1cb43469d9134a1` and it
describes the release zip's entries (`database.json`, `README.md`, `images/`).
The v1 baseline continues to identify the preserved original release, v2 the
corrected v5.1 database (`e67e2e2c…`), v3 v5.3 (`e67316fe…`), v4 v5.5
(`95be2cf3…`), v5 v5.6 (`fee9d3dc…`), v6 v5.7 (`0fab082b…`, nameplates). After a new release: write the next
baseline from `verify_schema9_release.py` on the extracted zip, move the
baseline references and hash pins, and regenerate with the exporters here plus
`tooling/reference/generate_benchmark_manifest.py` (from the reference seeds in
`infrastructure/mysql/reference/`),
`tooling/web/generate_api_staff_references.mjs` and
`export_android_product_catalogs.mjs`.

`verify_schema9_release.py` reads a candidate release and reports structured
errors for database/README hash changes, schema/count drift, missing or
unreferenced PNGs, unexpected files, symlinks, and full-tree differences. It
never writes to the release.

`schema9_asset_catalog.py` builds a read-only stable-ID index after release
verification. It resolves asset types, exposes character/body/glider variant
parents, and returns structured asset-reference errors for
`TimeTrialSubmissionV1` and `TournamentRaceResultV1` documents. It does not
coerce IDs or mutate records.

`export_schema9_catalog_snapshot.py` deterministically projects only the nine
contract asset types and variant parents into
`packages/assets/schema9-asset-catalog-v1.json`. It refuses a database hash that
does not match the release baseline. The result is runtime data; it contains no
image binaries, labels, users, recognition data, or source paths.

From the repository root, verify the preserved canonical source snapshot with:

```powershell
.venv\Scripts\python.exe tooling/assets/verify_schema9_release.py `
  _source_snapshots/assets-schema9-deploy-original `
  --baseline tooling/assets/schema9-release-baseline-v1.json
```

The tree hash is SHA-256 over UTF-8 inventory lines in ordinal relative-path
order. Each line is:

```text
<lowercase-file-sha256><two spaces><POSIX-relative-path><LF>
```

Synthetic tests exercise the verifier without requiring `_source_snapshots`.
When the canonical source snapshot is locally present, an additional test
checks it against the pinned baseline.

Passing verification does not migrate the release, prove the Assets Generation
pipeline reproducible, select binary distribution/licensing policy, or
authorize replacement of any application asset bundle.

`generate_loadout_variants.mjs` derives deterministic color-family metadata
and the preserved schema-9 `char_to_parts` presentation mapping for existing
character, body and glider variants. This exact mapping matters for parts with
a limited palette, such as Inkling Boy's blue Biddybuggy; family-name matching
alone is insufficient. The generated TypeScript, Kotlin and JSON manifests
contain stable IDs and paths but no image bytes.
`stage_loadout_variant_assets.mjs` copies the selected 288 PNGs only into an
explicit build/release target from an explicit external owner-private root. It
does not modify the source root and is not a recognition benchmark or a public
redistribution decision.
