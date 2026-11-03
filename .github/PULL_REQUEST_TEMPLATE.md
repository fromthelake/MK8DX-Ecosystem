## What changes for the user

Describe the visible effect in one or two sentences. Link the issue if there is one.

## Components

Which components does this touch (Web, API, MySQL, browser scanner, central reader, Android,
LiveTrial, Tournament, installer, documentation)? Did a shared contract, migration, asset or the
central reader change, and which consumers did you check?

## Verification

List the checks you ran from [docs/TESTING.md](../docs/TESTING.md) and their result. Say what you did
**not** test (for example a physical device, capture card or a real host).

## Checklist

- [ ] The change is focused and the diff contains no unrelated edits.
- [ ] `python tooling/privacy_scan.py`, `python tooling/check_boundaries.py` and `python tooling/check_docs.py` pass.
- [ ] No credentials, installation directories, databases, recordings or personal data are included.
- [ ] No new Nintendo or other third-party material, or its provenance is explained (see
      [THIRD_PARTY_MATERIALS.md](../docs/THIRD_PARTY_MATERIALS.md)).
- [ ] Documentation is updated where behaviour, commands or installation steps changed.
- [ ] AI assistance, if any, is disclosed above (see CONTRIBUTING.md).
