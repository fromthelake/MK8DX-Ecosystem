# MK8DX Ecosystem

Language: English · [Nederlands](README_NL.md)

Finished a Time Trial in Mario Kart 8 Deluxe? Open the scanner of your community's MK8DX website on a
phone or tablet, point the camera at the result screen on your TV, and the scanner reads the times and
laps for you. On the website you follow your progress and compare with friends, rivals, the Nintendo Ghost
Staff and world records. MK8DX Ecosystem also runs tournaments: organizers set up the night, capture the
races, review the results and publish standings and a report.

The project is self-hosted: every community runs its own installation, with its own accounts and results.

## What it does

- **Scan Time Trials from your TV screen.** The browser scanner reads total and lap times and, when visible,
  the character, kart setup and flag. You review the result before you submit it. A camera needs a trusted
  HTTPS connection; you can also upload a photo or screenshot. The optional Android app offers a faster
  on-device scan.
- **Compare your times.** Your best time and laps per track next to community results, chosen rivals, the
  Nintendo Ghost Staff and world records. When someone beats one of your published times, you get a
  notification.
- **Record runs with LiveTrial.** A Windows client for a capture card or existing video files. It recognizes
  new runs, saves their details and clips, and sends results to your community after you sign in once.
- **Organize tournaments.** Participants, groups and consoles; Tournament Processor reads recorded races and
  Tournament Live captures during the event. After the organizer has checked players and places, the website
  computes scores, standings and finals and publishes a report, also as a WordPress export.

Recognition alone never makes a result official. Where the rules require it, an authorized person reviews
a submission before it appears publicly.

## Guides

Start with the guide for what you want to do:

| I want to… | Guide | Platform |
| --- | --- | --- |
| **host the website for my community** (self-hosted server) | [Host a community server](docs/guides/HOSTING.md) | Linux with Docker (main route); Windows; shared hosting |
| **run tournament nights** as a Tournament Director | [Tournament Directors](docs/guides/TOURNAMENT_DIRECTORS.md) | website, plus the Windows Tournament Tools |
| **post and compare my Time Trials** on a community's website or the Android app | [Players](docs/guides/PLAYERS.md) | any browser; Android 8.0+ |
| **record Time Trials with a capture card or from videos** | [LiveTrial](docs/guides/LIVETRIAL.md) | Windows |
| **change the code**, run the tests or send a pull request | [Developer guide](docs/DEVELOPMENT.md), [Testing](docs/TESTING.md), [Contributing](CONTRIBUTING.md) | Windows, Linux; macOS untested |

The complete step-by-step user guide for every installation route, with backups, restores and updates, is
[docs/install/MK8DX_User_Guide_EN.txt](docs/install/MK8DX_User_Guide_EN.txt) ([Word](docs/install/MK8DX_User_Guide_EN.docx);
Dutch: [MK8DX_Handleiding_NL.txt](docs/install/MK8DX_Handleiding_NL.txt)). Questions: [Getting help](SUPPORT.md).

## Project status

**Pre-release.** Release candidates of version 0.1.0 are published on the project's
[GitHub Releases](https://github.com/fromthelake/MK8DX-Ecosystem/releases) page; the
[changelog](CHANGELOG.md) lists what changed. The website, API, browser scanner and installer are tested
on Windows 11 with the Linux/amd64 Docker images and with XAMPP/Node.js. Other platforms are described under
[Platform support](#platform-support).

## Get it

Release packages are attached to the project's
[GitHub Releases](https://github.com/fromthelake/MK8DX-Ecosystem/releases). Download the package for your route
from the latest release, together with `SHA256SUMS.txt`, and check the checksum as the guide explains. [Release packages](docs/RELEASE_PACKAGES.md) explains which file belongs to
which route. GitHub's automatic **Source code (zip)** is the complete source, not an installation package.

| Route | Package |
| --- | --- |
| Website on one computer or a home network, with Docker | `mk8dx-host-local-…-amd64.zip` |
| Website on Windows without Docker (XAMPP and Node.js) | `mk8dx-xampp-node-windows-….zip` |
| Website on shared hosting with Node.js and MariaDB | `mk8dx-mijnhost-node-….zip` |
| Android app | `mk8dx-android-debug-….apk` with its notices ZIP |
| LiveTrial (Windows) | `desktop-client-….zip` |
| Tournament tools (Windows) | `tournament-tools-….zip` |
| Complete source with the asset collection | `mk8dx-full-local-….zip` |

Then follow the [guide](#guides) for your group, or the complete user guide:
[English](docs/install/MK8DX_User_Guide_EN.txt) ([Word](docs/install/MK8DX_User_Guide_EN.docx)) or
[Nederlands](docs/install/MK8DX_Handleiding_NL.txt) ([Word](docs/install/MK8DX_Handleiding_NL.docx)). It walks
through installation, the apps, settings, backups and recovery.

**Have a clone of this repository instead?** Build and run it from source with
[Getting started](docs/GETTING_STARTED.md); the launchers above need the prebuilt images of a release package.
You can also build the packages yourself: the Docker host package as in
[Host a community server](docs/guides/HOSTING.md#build-the-host-package-from-a-clone), the Android app,
LiveTrial and the Tournament tools as in [Client builds](docs/CLIENT_BUILDS.md).

## Documentation

| I want to… | Read |
| --- | --- |
| understand the parts and how a result travels | [Architecture](docs/architecture/COMPONENTS.md) |
| build or change the code | [Developer guide](docs/DEVELOPMENT.md) and [Testing](docs/TESTING.md) |
| build the native clients | [Client builds](docs/CLIENT_BUILDS.md) |
| run an installation (backup, upgrade, recovery) | [Operations](docs/OPERATIONS.md) |
| start from source with Docker | [Getting started](docs/GETTING_STARTED.md) |
| contribute | [Contributing](CONTRIBUTING.md), [Code of conduct](CODE_OF_CONDUCT.md) |
| find out which script in `tooling/` is for whom | [Tooling](tooling/README.md) |
| get help | [Getting help](SUPPORT.md) |
| report a security problem | [Security policy](SECURITY.md) |
| work with a coding agent | [AGENTS.md](AGENTS.md) |

## What runs where

| Component | Role | Runs on |
| --- | --- | --- |
| Website, browser scanner and gateway | Public pages, administration and scanning | The server installation |
| API and MySQL/MariaDB | Sign-in, submissions, review, publication and data | The same installation |
| Android | Mobile scanning and submissions | A phone; the user chooses the community |
| LiveTrial | Recognizes and sends recordings or capture results | Windows |
| Tournament Processor, Live and Connect | Recognize races and deliver them after review | Windows |

A fresh installation starts empty: no community accounts or results are inherited. It includes only the
game catalog and the Nintendo Ghost Staff and World Records reference sets.

## Platform support

- **Windows 11 x86-64**: tested end to end with Docker and with XAMPP/Node.js, including LiveTrial and
  Tournament Processor/Connect results arriving on the website.
- **Linux x86-64**: the Docker host package includes a shell launcher (`tooling/start-mk8dx.sh`). Demonstrated
  on a Linux Docker Engine (in a container, not on Ubuntu itself): package launcher, first setup, sign-in,
  first administrator, backup, update and restore, and the source route. A public B1 installation with a real
  domain and mail provider is not yet tested. LiveTrial and the Tournament tools are Windows applications.
- **macOS**: an Intel Mac can try the Docker host package with Docker Desktop; Apple Silicon needs amd64
  emulation. Not accepted end to end; the Windows clients do not run on macOS.
- **ARM servers**: no native images yet.
- Not yet verified: physical capture with Tournament Live, a fresh installation on a real external host.

## License and Nintendo

This is an independent, non-commercial hobby project to learn programming and to make Mario Kart 8 Deluxe
more fun. It is **not affiliated with or endorsed by Nintendo**. Nintendo owns its trademarks and game
content; please support Nintendo by buying its consoles and games.

The project's original code and documentation are licensed under the [Mozilla Public License 2.0](LICENSE).
The [license scope](LICENSE_SCOPE.md) explains what that covers: it does **not** cover Nintendo material,
game images, recognition templates, models, fonts or other third-party material, which keep their own
terms. See [Third-party materials](docs/THIRD_PARTY_MATERIALS.md). The software is provided as is.
