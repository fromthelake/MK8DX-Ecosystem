# Local preview with the bundled collection

The standard [getting started](GETTING_STARTED.md) Compose route builds Web,
API, MySQL and local Mailpit from this repository. Web's Dockerfile builds the
scanner and stages selected game images directly from
`packages/assets/collection/`. No separate image directory, scanner build,
source tree or private asset mount is required. The database stays in a named
volume; operator configuration stays in the ignored installation directory.

From the repository root, after `tooling/install.py init` has created your
installation directory (outside the repository; set `$state` to it, e.g.
`$state = "$env:LOCALAPPDATA\MK8DX\Dev"`), inspect the exact project and mounts before starting:

```powershell
docker compose --env-file "$state\compose.env" -f compose.yaml -f compose.local.yaml config --quiet
docker compose --env-file "$state\compose.env" -f compose.yaml -f compose.local.yaml build api web
docker compose --env-file "$state\compose.env" -f compose.yaml -f compose.local.yaml up -d
```

Use the migration, seed and first-administrator steps in the getting-started
guide for a new installation. For an existing installation, follow
[Operations](OPERATIONS.md), including the backup gate before any migration.
Do not use `down -v` during an update. The browser scanner is served at
`<web-origin>/scanner/`; the API readiness route is `<web-origin>/health/ready`.

[Release packages](RELEASE_PACKAGES.md) describes the prebuilt alternative, and
[Third-party materials](THIRD_PARTY_MATERIALS.md) the terms of the bundled game material.
