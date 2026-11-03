# Importing upstream changes (maintainers)

[Nederlandse versie](MAINTAINER_INTAKE_NL.md)

This repository is fed from the maintainer's own development tree. `tooling/intake.py` imports reviewed
changes from that tree into this repository without copying anything private. Ordinary contributors do not need
it; they open pull requests. Operators who want to update an installation use [Operations](OPERATIONS.md)
instead.

## How it works

A private JSON **policy**, kept outside this repository, names:

- the read-only source tree and this repository as the target;
- a private state directory for baselines, plans and the audit trail;
- the exact source-to-target path mapping, the scanned folders, explicit exclusions and deletions;
- replacement rules (for example a private host name becomes `mk8dx.example`) and blocked patterns that stop the
  import when private markers remain;
- "fixed" files: a reviewed public text for a source file, valid only while the source file's hash is unchanged;
- the checks to run per affected component.

Each import compares three trees: the previous sanitized source (`U0`), the current public repository (`P`) and
the new sanitized source (`U1`). A source change to a file the public tree has not changed is applied; a change
made only in the public tree (documentation, Docker files) is kept; independent edits are merged; overlapping
edits stop the import as a conflict. A new source file that is byte-identical to the existing public file counts
as already present. Applied SQL migrations can never change.

## Commands

```sh
python tooling/intake.py plan     --config <private-policy.json>
python tooling/intake.py resolve  --config <private-policy.json> --plan-id <id> --resolution-dir <dir>
python tooling/intake.py validate --config <private-policy.json> --plan-id <id>
python tooling/intake.py apply    --config <private-policy.json> --plan-id <id>
python tooling/intake.py recover  --config <private-policy.json> --plan-id <id>
python tooling/intake.py migrate-policy --config <new-policy.json> --baseline-dir <dir> --old-policy-id <id>
```

- `plan` stages the sanitized source and a candidate tree in the private state directory and reports the changes,
  the affected components and any conflicts. It never touches this repository.
- `resolve` accepts a reviewed resolution for every conflict, bound to the exact bytes by SHA-256.
- `validate` runs the selected component checks in the candidate tree.
- `apply` writes the changes into this repository. It refuses a dirty working tree, a stale plan or a candidate
  that changed after validation, and keeps a journal so `recover` can roll back an interrupted apply.
- `migrate-policy` records a reviewed policy change (new mappings, replacements) without changing the baseline's
  path set.

After `apply`, review `git diff`, run `python tooling/privacy_scan.py` and `python tooling/check_boundaries.py`,
and commit.

## Rehearsal

```sh
MK8DX_INTAKE_TEST_ROOT=<temporary folder outside the repository> python tooling/test_intake.py -v
```

The synthetic tests cover sequential imports, public-only changes, conflicts and their resolution, deletions and
renames, identical new files, private markers, path and junction errors, stale plans, interrupted applies, append-only
SQL and policy migration.

## Replacing assets in the collection

Existing images in `packages/assets/collection/` have their own narrow update path. A private policy of schema
`mk8dx.collection-update-policy.v1` pins the current manifest hash and version, the next version, a source folder
and the exact list of changed files with their previous and next SHA-256:

```sh
python tooling/assets/update_collection.py plan     --policy <private-policy.json> --plan <private-plan.json>
python tooling/assets/update_collection.py validate --policy <private-policy.json> --plan <private-plan.json>
python tooling/assets/update_collection.py apply    --policy <private-policy.json> --plan <private-plan.json>
python tooling/assets/shared_asset_source.py verify
```

It updates the object store, the collection version, the consumer selections and `compatibility.json`, verifies
the whole collection and rolls back on failure. New kinds of resources, models and catalog changes go through
the software import above instead.
