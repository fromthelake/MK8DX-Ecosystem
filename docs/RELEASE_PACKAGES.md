# Release packages

Every release on the project's [GitHub Releases](https://github.com/fromthelake/MK8DX-Ecosystem/releases) page
contains prebuilt packages, a `SHA256SUMS.txt` with the checksum of every file, and a `manifest.json` with the
exact source commit. File names carry a package revision (shown as `…` below); always take files from the same
release. The [changelog](../CHANGELOG.md) says what changed. With a clone of the repository you can build the
same packages yourself; see [Building the packages](#building-the-packages).

| Package | Contents | Use it for |
| --- | --- | --- |
| `mk8dx-host-local-…-amd64.zip` | Prebuilt Linux/amd64 images for website and API, MySQL and Mailpit images, Compose files, the installer and launchers (`Start-MK8DX.cmd`, `tooling/start-mk8dx.sh`) | Routes A1 (one computer) and B1 (VPS) |
| `mk8dx-a2-<platform>-<arch>-….zip` | Everything for A2 on that platform: website and API images, the guided setup, pinned Python wheels, launchers and the A2 guides | Route A2: home or club network without internet (`windows-amd64`, `linux-amd64`, `linux-arm64`, `macos-arm64`, `macos-amd64` for Intel Macs) |
| `mk8dx-xampp-node-windows-….zip` | Built website and API for Node.js, a private MariaDB, Mailpit and the Apache configuration helper | Route A3: Windows without Docker |
| `mk8dx-mijnhost-node-….zip` | Built website and API for Node.js/Passenger hosting with MariaDB | Route B2: shared hosting |
| `mk8dx-android-debug-….apk` | CI-built debug-signed Android app for testing; remove before publishing a stable release | Test phones |
| `mk8dx-android-release-….apk` | App signed locally by the maintainer's release key | Phones; the stable release requires this file |
| `mk8dx-android-notices-….zip` | License and source notices that belong next to the APK | Distributing the APK |
| `desktop-client-….zip` | LiveTrial for Windows, with its engine and an embedded Python | Capture-card and video recognition |
| `tournament-tools-….zip` | Tournament Processor, Live and Connect for Windows, with an installer | Tournament nights |
| `mk8dx-full-local-….zip` | The complete source with the hydrated asset collection and build recipes, without Git history | Building everything yourself |
| `SBOM.spdx.json` | SPDX inventory of the seven primary CI-built packages and full-source manifest sidecar, with SHA-256 and Syft's discovered package records | Package audit; ancillary notices/guides and nested dependencies are checked separately by checksums and Verify's dependency audits |

The user guides are attached to each release as well: `MK8DX_User_Guide_EN.txt`/`.docx` and
`MK8DX_Handleiding_NL.txt`/`.docx`. The same files are in [docs/install](install/) and inside the installation
packages.

A1 and A3 are supported after fresh-install and upgrade tests with data. A2 is tested end to end on Windows 11
(Linux in WSL 2; macOS built but not tested). B1 and B2 are documented but have not been tested end to end. The Android release APK is signed locally with the maintainer's retained key;
earlier public debug APKs require one uninstall before installing it. Save any results not yet sent before that
uninstall. Later updates signed with the same release key install in place.

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

The product version is SemVer: the `v0.1.0-rc.N` tags are candidates and `v0.1.0` is the stable release tag.
`productVersion` in [compatibility.json](../compatibility.json) matches the version being packaged.
The [changelog](../CHANGELOG.md) keeps future work under *Unreleased*; advance the version for the next
development release after tagging.

Pushing a tag `v*` runs `.github/workflows/release.yml`. It first checks that the tagged commit passed `Verify`,
then builds every client, source and server package (including the five A2 packages) from that exact commit. The Web and API images receive tags
derived from the release version (`ghcr.io/fromthelake/mk8dx-{web,api}:<tag>-amd64`) and are also included in
the host ZIP for offline installation. The workflow pushes those two images to GHCR, generates an SPDX SBOM,
attests the exact release-asset bytes, writes `SHA256SUMS.txt` and `manifest.json`, and opens a **draft** release.
The signing key stays only on the maintainer's computer; CI's debug APK is not the stable phone package.
`workflow_dispatch` builds the same package types as a dry run, with no tag, image push or release.
The Docker gateways enforce the Web CSP (the same policy the Web shell's meta tag and the Node static route
already enforce, plus `font-src` and `frame-ancestors`). They also enforce the scanner's policy under
`/scanner/`; only the scanner's worker entries (`/scanner/assets/worker/*`) may evaluate strings, which OpenCV.js
needs. See [Testing](TESTING.md) for its three parts and the browser check after a change.
Every base image is pinned by tag and digest: Node and Caddy in the Dockerfiles, MySQL and Mailpit in
`compose.yaml` and `compose.local.yaml` (Dependabot's `docker` and `docker-compose` entries move tag and digest
together; review upstream security updates in a tested PR). The release workflow fetches MySQL and Mailpit with
`host_bundle.py --pull-base-images`, by digest, and the packager refuses a local copy with another digest. A
package loads its images from a tar, where `docker load` keeps only the tag, so its Compose files name those two
images by tag; the manifest records the digests under `baseImageDigests`.

The gateway's Caddy runs without root. The image starts as root only for its entrypoint
(`infrastructure/docker/gateway-entrypoint.sh`), which picks the user, gives `/data` and `/config` (the
`caddy_data` and `caddy_config` volumes) to it and then hands Caddy to that user with `su-exec`. The user is
`caddy` (uid/gid 10002). On a Linux host where the operator's own 0600 files are mounted (the A2 CA signer key and
setup page), Caddy runs as that operator's uid instead, so those files keep their modes. When only root could
read a mounted file (state created by root, or modes changed by hand), Caddy keeps running as root and logs
`mk8dx-gateway: ... Caddy runs as root`. The ownership change keeps every file mode (keys stay 0600) and does not
follow links. Compose files name no user, so a newer package's Compose files also start an older (root) image,
and the other way round. Docker lets processes in a container's own network namespace bind ports below 1024, so
80/443 need no extra capability. Upgrade check (2026-11-13, disposable Compose projects on Docker Desktop): the
LAN route (`tls internal`) and the A2 offline route (real `offline_lan_ca.py` material, once with Windows bind
mounts and once with uid-1000 0600 files as on Linux) were started on the previous root image, then recreated on
the new one: same root CA and the same leaf served, no file left with another owner, keys still 0600, Caddy as
uid 10002 (or 1000), and a rollback to the root image served the same chain.

Maintainers and other users can build the same packages from a clean clone with
`tooling/release/full_archive.py`, `tooling/release/host_bundle.py`, `tooling/release/non_docker_bundle.py` and
the [client recipes](CLIENT_BUILDS.md). The [hosting guide](guides/HOSTING.md#build-the-host-package-from-a-clone)
has the manual image commands. Use `host_bundle.py --version <release-tag>` to select versioned GHCR image names;
without it, local clone builds continue to use the current local image tags.

### Intel Mac A2 package

`cryptography` (pinned in `tooling/requirements-offline-lan.txt`) publishes no Intel Mac wheel after 48.0.1, and
48.0.1 has known security advisories. The release workflow's `macos-intel-cryptography` job therefore builds the
pinned version from source on GitHub's `macos-15-intel` runner with
`tooling/release/build_macos_intel_cryptography.sh`: OpenSSL 3.5 (checksum-pinned) is built and linked in
statically for macOS 10.15 and newer, the script refuses a wheel that links anything outside the system
libraries, and the job runs the A2 certificate and backup tests with that wheel before the `macos-amd64`
package takes it. To build it yourself on an Intel Mac with Python 3.12+, the Xcode command line tools and Rust:

```sh
sh tooling/release/build_macos_intel_cryptography.sh dist/intel-wheel
```

Pass the folder to `pip download --find-links dist/intel-wheel` when you collect the A2 wheels. When a new
`cryptography` is pinned, the same job builds that version; no other change is needed.

## Publishing a release

Before tagging, set `productVersion` in `compatibility.json` and `ecosystemVersion` in
`component-registry.json` to the new version (without the `v`) in the release pull request; the release
manifest copies `compatibility.json`.

1. Wait for the release workflow's draft and confirm all workflow jobs succeeded. Download the server ZIPs (host-local, the A2 packages, A3 and B2),
   verify their `sourceCommit` equals the tag commit, and check their internal manifests and bytes.
2. Attach the locally release-signed APK, remove the debug APK for a stable release, and keep the Android notices ZIP.
   Verify the APK signing certificate against the retained owner certificate. The earlier public APKs were debug
   builds: users must protect unsent results and uninstall once before installing the release-signed APK.
3. Refresh `SHA256SUMS.txt` so it lists every attached file. The workflow wrote it before the signing step, and the user
   guides tell people to stop when a package has no matching line:

   ```sh
   tag=v0.1.0
   mkdir release-check && cd release-check
   gh release download "$tag" --repo fromthelake/MK8DX-Ecosystem
   rm SHA256SUMS.txt
   sha256sum -- * > SHA256SUMS.txt
   gh release upload "$tag" SHA256SUMS.txt --clobber --repo fromthelake/MK8DX-Ecosystem
   ```

4. Check that every asset has a line (`wc -l SHA256SUMS.txt` equals the number of other assets). Verify the
   unchanged downloaded CI assets with `gh attestation verify <file> -R fromthelake/MK8DX-Ecosystem` and inspect
   `SBOM.spdx.json`. The locally signed APK has separate signing-certificate evidence, not CI provenance.
   At draft review, start **every route called supported** in the release notes afresh from that draft's downloaded
   assets. Record its source commit, migrations, readiness and affected routes. For A1, load the Docker images
   inside the downloaded host ZIP even if a local image already has the same tag; a cached tag is not package
   evidence. For v0.1.0, this means fresh A1 and A3 installations. Test an upgrade with data before publishing.
   Check anonymous pulls of the matching GHCR images: newly created GitHub container packages default to private
   visibility even when linked to a public repository. The maintainer must make them public in GitHub package
   settings before describing them as public downloads.
