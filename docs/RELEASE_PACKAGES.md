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
| `mk8dx-android-debug-….apk` | CI-built debug-signed Android app for testing; remove before publishing a stable release | Test phones |
| `mk8dx-android-release-….apk` | App signed locally by the maintainer's release key | Phones; the stable release requires this file |
| `mk8dx-android-notices-….zip` | License and source notices that belong next to the APK | Distributing the APK |
| `desktop-client-….zip` | LiveTrial for Windows, with its engine and an embedded Python | Capture-card and video recognition |
| `tournament-tools-….zip` | Tournament Processor, Live and Connect for Windows, with an installer | Tournament nights |
| `mk8dx-full-local-….zip` | The complete source with the hydrated asset collection and build recipes, without Git history | Building everything yourself |
| `SBOM.spdx.json` | SPDX inventory of the automatically built release assets, including SHA-256 for each built file and Syft's discovered package records | Asset audit; nested dependencies are checked separately by Verify's dependency audits |

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

Pushing a tag `v*` runs `.github/workflows/release.yml`. It first checks that the tagged commit passed `Verify`,
then builds all seven client/source/server packages from that exact commit. The Web and API images receive tags
derived from the release version (`ghcr.io/fromthelake/mk8dx-{web,api}:<tag>-amd64`) and are also included in
the host ZIP for offline installation. The workflow pushes those two images to GHCR, generates an SPDX SBOM,
attests the exact release-asset bytes, writes `SHA256SUMS.txt` and `manifest.json`, and opens a **draft** release.
The signing key stays only on the maintainer's computer; CI's debug APK is not the stable phone package.
`workflow_dispatch` builds the same package types as a dry run, with no tag, image push or release.

Maintainers and other users can build the same packages from a clean clone with
`tooling/release/full_archive.py`, `tooling/release/host_bundle.py`, `tooling/release/non_docker_bundle.py` and
the [client recipes](CLIENT_BUILDS.md). The [hosting guide](guides/HOSTING.md#build-the-host-package-from-a-clone)
has the manual image commands. Use `host_bundle.py --version <release-tag>` to select versioned GHCR image names;
without it, local clone builds continue to use the current local image tags.

## Publishing a release

1. Wait for the release workflow's draft and confirm all workflow jobs succeeded. Download the three server ZIPs,
   verify their `sourceCommit` equals the tag commit, and check their internal manifests and bytes.
2. Attach the locally release-signed APK, remove the debug APK for a stable release, and keep the Android notices ZIP.
   Verify the APK signing certificate against the retained owner certificate. The earlier public APKs were debug
   builds: users must protect unsent results and uninstall once before installing the release-signed APK.
3. Refresh `SHA256SUMS.txt` so it lists every attached file. The workflow wrote it before the signing step, and the user
   guides tell people to stop when a package has no matching line:

   ```sh
   tag=v0.1.0-rc.N
   mkdir release-check && cd release-check
   gh release download "$tag" --repo fromthelake/MK8DX-Ecosystem
   rm SHA256SUMS.txt
   sha256sum -- * > SHA256SUMS.txt
   gh release upload "$tag" SHA256SUMS.txt --clobber --repo fromthelake/MK8DX-Ecosystem
   ```

4. Check that every asset has a line (`wc -l SHA256SUMS.txt` equals the number of other assets). Verify the
   unchanged downloaded CI assets with `gh attestation verify <file> -R fromthelake/MK8DX-Ecosystem` and inspect
   `SBOM.spdx.json`. The locally signed APK has separate signing-certificate evidence, not CI provenance.
   Install the downloaded A1 and A3 packages and test an upgrade with data before publishing the draft. Check
   anonymous pulls of the matching GHCR images: newly created GitHub container packages default to private
   visibility even when linked to a public repository. The maintainer must make them public in GitHub package
   settings before describing them as public downloads.
