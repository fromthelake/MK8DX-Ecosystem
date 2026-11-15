# Start here: choosing an MK8DX installation

Nederlands: [START_HIER.md](START_HIER.md)

The complete, plain guide is [MK8DX_User_Guide_EN.txt](MK8DX_User_Guide_EN.txt) (also as a
[Word file](MK8DX_User_Guide_EN.docx)); in Dutch [MK8DX_Handleiding_NL.txt](MK8DX_Handleiding_NL.txt).
It takes you through step by step. The pages in this folder are technical reference per route.

## Which route suits you?

| Route | For whom | Status | Reference |
| --- | --- | --- | --- |
| **A1** — one Windows computer with Docker | Trying it calmly on your own PC, without a domain or real email | Tested end to end on Windows 11 | [A1_ONE_COMPUTER_EN.md](A1_ONE_COMPUTER_EN.md) ([Dutch](A1_EEN_COMPUTER.md)) |
| **A3** — one Windows computer without Docker (XAMPP and Node.js) | When Docker is not possible or not allowed | Tested end to end on Windows 11 | [English guide, chapter 2](MK8DX_User_Guide_EN.txt); [Dutch guide, chapter 2](MK8DX_Handleiding_NL.txt) |
| **A2** — at home or at the club, without internet | Letting phones and PCs join at home or at a tournament venue, with a guided installation in the browser | Tested on Windows 11 (Linux in WSL 2; macOS not tested) | [A2_HOME_GUIDE_EN.md](A2_HOME_GUIDE_EN.md) |
| **B1** — your own VPS with Docker | A public website on your own domain | Rehearsed by following the guide on Ubuntu 24.04 in WSL 2; not yet tested on a real VPS | [B1_VPS_EN.md](B1_VPS_EN.md) |
| **B2** — web hosting with Node.js and MariaDB | A public website without a server of your own | Our own community site runs this way; the public package has not yet been installed from scratch on a new hosting account | [B2_WEBHOSTING_EN.md](B2_WEBHOSTING_EN.md) |

After that: [connecting the apps](CLIENTS_EN.md), [settings](SETTINGS_EN.md), [administration, updates and restoring](ADMINISTRATION_EN.md)
and [building it yourself](../DEVELOPMENT.md) (the developer guide).

For A1 you use the **host package** (`mk8dx-host-local-…`) from the release, for A3 the package `mk8dx-xampp-node-windows-…`. You do not need to
edit source code, install Python packages with `pip` or build a Docker
image. The guide explains the installation of Docker Desktop (A1) or
XAMPP/Node.js (A3), the small Python installer, the first administration account and
later backups/updates step by step. Start with the route you choose;
the chapters are not consecutive installation steps.

## Requirements before buying or installing

- **A1 and A3:** Windows 11 on x86-64, 8 GB of memory recommended and about 15 GB free space (A1) or
  a few GB (A3). These are generous margins, not measured minimums.
- **A2:** a computer with Windows 11, Linux or macOS (x86-64 or arm64), Docker and Python 3.12–3.15, plus the
  devices on the same trusted network. No guest network and no forwarded router port. Everything is in
  [chapters 1 and 2 of the guide](A2_HOME_GUIDE_EN.md).
- **B1:** Ubuntu 24.04 LTS on x86-64, 2 processor cores, 8 GB of memory and a 40 GB SSD recommended, a domain of your own
  and an outgoing mailbox (SMTP with TLS).
- **B2:** a hosting package with Node.js 24 (Passenger), MariaDB 11.4+ or MySQL 8.4+, SSH, an empty database with
  a restricted user, and a mailbox.
- **Apps:** Android 8.0 or newer (arm64 recommended); LiveTrial and the tournament tools on Windows x86-64.

## Which file do you get?

From the newest release on the project's GitHub Releases page, download the package for your route,
together with `SHA256SUMS.txt`:

| Route | Package |
| --- | --- |
| A1, B1 | `mk8dx-host-local-…-amd64.zip` |
| A2 | `mk8dx-a2-<platform>-<arch>-….zip`, for example `mk8dx-a2-windows-amd64-….zip` |
| A3 | `mk8dx-xampp-node-windows-….zip` |
| B2 | `mk8dx-mijnhost-node-….zip` |
| Android | `mk8dx-android-release-….apk` and `mk8dx-android-notices-….zip` |
| LiveTrial | `desktop-client-….zip` |
| Tournament tools | `tournament-tools-….zip` |

Check every package before extracting it. In PowerShell, in the folder with both files:

```powershell
Get-FileHash '.\<package-name>.zip' -Algorithm SHA256
```

Compare the whole value with the line for that file in `SHA256SUMS.txt`. If it differs, extract nothing
and download again. GitHub's **Source code (zip)** button is not an installation package.
Earlier public APKs were signed with a debug key: keep any results not yet sent and uninstall
that app once before you install the release APK. Later APKs with the same release key can be updated
in place.
