# Public recognition test set

Twelve labelled Mario Kart 8 Deluxe screens that everyone can run the recognition against. They show how the
project checks its readers and how to grow your own set; the maintainers measure releases on larger private sets.

| Kind | Frames | What varies |
| --- | --- | --- |
| Result screen, capture card (`result-<lang>-…png`) | 7 | console language (de, en, es, ja, ko, nl, zh-cn), track, solo record or win against a Nintendo staff ghost, 3 and 7 laps |
| Select-a-Ghost panel (`ghost-select-…`) | 3 | phone photo and HDMI frame, 150cc and 200cc, three staff ghosts with different characters |
| Result screen, capture card (`result-screen-capture-…jpg`) | 2 | other characters, a 7-lap race |

`labels.json` (schema `mk8dx.public-test-set.v1`) holds per frame its times (`times`, or `totalMs`/`lapTimesMs`
for a panel) and per owner the five kart fields with the catalog's stable IDs (`packages/assets/schema9-asset-catalog-v1.json`).
A label with a colour variant (`glider_variant.super_glider.043_yellow`) must be read exactly; a label with only the
item (`glider.super_glider`, as the staff records give it) accepts every colour variant of that item.
`labelSource` says where a label comes from: a Clean Assets staff record, the maintainers' reviewed baseline, or
a scanner reading whose lap sums were verified and checked against the image.

**Label rule:** labels record what is seen on the screen; every interpretation (which track, which colour
variant, a repaired lap) belongs to versioned code, not to the label.

## Run it

```powershell
npm ci --ignore-scripts --prefix apps/timetrials-scanner-web
npm run sync-assets --prefix apps/timetrials-scanner-web
npx --prefix apps/timetrials-scanner-web playwright install chromium
node tooling/test-set/score_test_set.mjs
```

The scorer feeds every frame through the browser scanner's saved-photo route and compares times and fields with
the labels; it exits non-zero when a frame no longer matches. CI runs it on every pull request.

## Add a frame

Add the image here, add a record to `labels.json` with what the screen shows (check every digit and every field
against the image), and run the scorer. Only add screens you may share: your own name and public Nintendo staff
ghost names, no other players' names.

Then admit the image in `test-set-files-v1.json` with its SHA-256 and size. `tooling/privacy_scan.py` accepts
exactly the listed bytes in this folder; an unlisted, changed or missing image fails the scan, so a reviewer sees
every new frame. Print the entry with:

```sh
python -c "import hashlib,sys,pathlib; b=pathlib.Path(sys.argv[1]).read_bytes(); print(hashlib.sha256(b).hexdigest(), len(b))" packages/assets/test-set/<file>
```
