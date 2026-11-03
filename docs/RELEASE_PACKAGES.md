# Release packages

Every release on the project's [GitHub Releases](https://github.com/fromthelake/MK8DX-Ecosystem/releases) page
contains prebuilt packages, a `SHA256SUMS.txt` with the checksum of every file, and a `manifest.json` with the
exact source commit. File names carry a package revision (shown as `…` below); always take files from the same
release. The [changelog](../CHANGELOG.md) says what changed. With a clone of the repository you can build the
same packages yourself; see [Building the packages](#building-the-packages).

| Package | Contents | Use it for |
| --- | --- | --- |
| `mk8dx-host-local-…-amd64.zip` | Prebuilt Linux/amd64 images for website and API, MySQL and Mailpit images, Compose files, the installer and launchers (`Start-MK8DX.cmd`, `tooling/start-mk8dx.sh`) | Routes A1 (one computer), A2 (home network) and B1 (VPS) |
| `mk8dx-xampp-node-windows-….zip` | Built website and API for Node.js, a private MariaDB, Mailpit and the Apache configuration helper | Route A3: Windows without Docker |
| `mk8dx-mijnhost-node-….zip` | Built website and API for Node.js/Passenger hosting with MariaDB | Route B2: shared hosting |
| `mk8dx-android-debug-….apk` | The Android app, debug-signed (see [Players](guides/PLAYERS.md#the-android-app)) | Phones |
| `mk8dx-android-release-….apk` | Only in some releases: the same app signed by the maintainer's release key | Phones; prefer it when present |
| `mk8dx-android-notices-….zip` | License and source notices that belong next to the APK | Distributing the APK |
| `desktop-client-….zip` | LiveTrial for Windows, with its engine and an embedded Python | Capture-card and video recognition |
| `tournament-tools-….zip` | Tournament Processor, Live and Connect for Windows, with an installer | Tournament nights |
| `mk8dx-full-local-….zip` | The complete source with the hydrated asset collection and build recipes, without Git history | Building everything yourself |

The user guides are attached to each release as well: `MK8DX_User_Guide_EN.txt`/`.docx` and
`MK8DX_Handleiding_NL.txt`/`.docx`. The same files are in [docs/install](install/) and inside the installation
packages.

## Check a download

```powershell
Get-FileHash '.\<file>' -Algorithm SHA256
```

Compare the whole value with the file's line in `SHA256SUMS.txt`; on Linux or macOS use `sha256sum <file>`.

GitHub's automatic **Source code (zip)** is the complete source but not an installation package. To build
from source, see the [developer guide](DEVELOPMENT.md).

## Notices that travel with every package

Each package carries `LICENSE`, `LICENSE_SCOPE.md`, `docs/THIRD_PARTY_MATERIALS.md` and
`SOURCE_FOR_BINARIES.txt`. The Android APK cannot hold loose files; the notices ZIP carries them. The MPL covers
the project's own code and documentation only; the game material inside the packages keeps its own terms (see
[Third-party materials](THIRD_PARTY_MATERIALS.md)).

## Building the packages

The product version is SemVer: before 1.0, releases are release candidates of `0.1.0` (tags `v0.1.0-rc.N`).
`productVersion` in [compatibility.json](../compatibility.json) names the release that the current *Unreleased*
section of the [changelog](../CHANGELOG.md) becomes; set it to the next candidate right after tagging.

Pushing a tag `v*` runs `.github/workflows/release.yml`. It first checks that the tagged commit passed the `Verify`
workflow (tag after Verify is green), then builds the debug APK, LiveTrial, the Tournament tools
and the source archive, writes `SHA256SUMS.txt` and `manifest.json` and opens a **draft** release with these files,
the user guides and the Android notices ZIP. The maintainer then follows [Publishing a release](#publishing-a-release).
By hand, maintainers build the packages from a
clean, reviewed commit: `tooling/release/full_archive.py` for the source
archive, `tooling/release/host_bundle.py` and `tooling/release/non_docker_bundle.py` for the server packages
(step by step in [Host a community server](guides/HOSTING.md#build-the-host-package-from-a-clone) and its
[other routes](guides/HOSTING.md#the-other-routes)), and the recipes in [Client builds](CLIENT_BUILDS.md) for
Android, LiveTrial and Tournament. Anyone can run the same recipes from a clone.

## Publishing a release

1. Wait for the release workflow's draft.
2. Attach the server packages built from the tagged commit (`mk8dx-host-local-…-amd64.zip`,
   `mk8dx-xampp-node-windows-….zip`, `mk8dx-mijnhost-node-….zip`) and, if there is one, the release-signed APK.
3. Refresh `SHA256SUMS.txt` so it lists every attached file. The workflow wrote it before step 2, and the user
   guides tell people to stop when a package has no matching line:

   ```sh
   tag=v0.1.0-rc.N
   mkdir release-check && cd release-check
   gh release download "$tag" --repo fromthelake/MK8DX-Ecosystem
   rm SHA256SUMS.txt
   sha256sum -- * > SHA256SUMS.txt
   gh release upload "$tag" SHA256SUMS.txt --clobber --repo fromthelake/MK8DX-Ecosystem
   ```

4. Check that every asset has a line (`wc -l SHA256SUMS.txt` equals the number of other assets), then publish
   the draft.
