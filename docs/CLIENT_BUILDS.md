# Build the local clients from this repository

Ordinary users install the checked prebuilt clients and choose their server in the app; see the guides for [players](guides/PLAYERS.md) (Android), [LiveTrial](guides/LIVETRIAL.md) and [Tournament Directors](guides/TOURNAMENT_DIRECTORS.md). The commands below are for developers and custom signing.

Work from the repository root (a Git clone, GitHub's source ZIP or the extracted full-source archive) with the
public toolchains below. `packages/assets/collection/` already holds the required product
inputs. Run its verification command from the repository root before building:

```powershell
python tooling/assets/shared_asset_source.py verify
```

Every client build takes the Clean Assets release and the central recognition pack recorded in the collection
(`assetCollectionVersion` in [compatibility.json](../compatibility.json)), so a Web, Android, LiveTrial and
Tournament build made from the same commit read screens with identical references.

## Browser scanner and Web image

Docker Compose builds both from the repository through
`apps/timetrials-web/Dockerfile`. For a standalone scanner build, use Node 24:

```powershell
cd apps/timetrials-scanner-web
npm ci --ignore-scripts
npm run sync-assets
npm run typecheck
$env:MK8_BASE_PATH='/scanner/'
npm run build
```

## Android

Install JDK 17 (or 21), Android SDK platform 37.0, the Android build tools and Node 24.
Set `JAVA_HOME` to that JDK when `java -version` does not already show it, and set `ANDROID_HOME` to the installed public SDK directory (or create a local,
untracked `local.properties` containing `sdk.dir`). From
`apps/timetrials-android`, on Windows:

```powershell
$env:ANDROID_HOME = 'C:\path\to\Android\Sdk'
./gradlew.bat :app:testDebugUnitTest :app:assembleDebug
```

On Linux or macOS, set `ANDROID_HOME` the same way and run `bash ./gradlew :app:testDebugUnitTest :app:assembleDebug`
(the wrapper is stored without its executable bit). CI builds this way on Ubuntu with JDK 21.

The default build includes the scanner and materializes its model/assets from
the collection. The resulting `app/build/outputs/apk/debug/app-debug.apk` is
**debug signed**, not a public store release. On first launch the user chooses
the exact HTTPS community origin; a different server does not require an APK
rebuild. `-Pmk8dxApiOrigin=https://your-site.example` sets only a build-time
default for a customized app. For automatic Android App Links on an operator
domain, that operator must configure the association for the actual release
signing certificate. Keep signing keys outside this repository. Official releases are signed by the maintainer
with a key that never enters the repository; a fork or a community build signs with its own key. Android only
installs an update signed with the same key as the installed app, so switching between an official and a
self-built APK means uninstalling first, which removes results that were not yet sent.
Device tests run with `:app:connectedDebugAndroidTest`; the optional private
recognition corpus test skips when its separately held corpus is absent.
The launcher, in-app header and splash use the owner Time Trials icon staged
from `apps/timetrials-web/styles/app-icon-512.png`. The source is pixel-identical
to the historical Play Store icon; no private path is needed for this artwork.
On Android 26+, the round launcher uses a stopwatch/8 mark derived from that
image so the system mask does not crop the lettering or frame the square image
in white. The full artwork remains in the splash and other clients. Run
`python tooling/assets/derive_android_launcher_mark.py` to check the derived
bitmap, or add `--write` to regenerate it after changing the owner icon.

### Signing a release APK

Every Android app is signed, and Android only installs an update that carries the same signature as the app
already on the phone. The official APK on the Releases page is signed with the maintainer's own key; that key is
kept offline and never enters this repository, CI or a build log. This is the usual open-source arrangement: the
code is open, the signing key is personal, and anyone can build the same app with a key of their own.

To build a release-signed APK with your own key:

1. Make a key once and keep it safe; losing it means your users can no longer update your app.

   ```sh
   keytool -genkeypair -v -keystore my-mk8dx-release.jks -alias mk8dx -keyalg RSA -keysize 4096 -validity 10000
   ```

2. Give the build the four signing properties, all together (the build refuses a partial set). Put them in
   `~/.gradle/gradle.properties`, or as environment variables `ORG_GRADLE_PROJECT_<name>`, so passwords never
   appear on a command line:

   ```properties
   mk8dxReleaseStoreFile=/path/to/my-mk8dx-release.jks
   mk8dxReleaseStorePassword=...
   mk8dxReleaseKeyAlias=mk8dx
   mk8dxReleaseKeyPassword=...
   ```

3. Raise `versionCode` (and set `versionName`) in `apps/timetrials-android/app/build.gradle.kts` when you
   publish a new version: Android refuses an update with a lower number. Then build and check:

   ```sh
   ./gradlew :app:testDebugUnitTest :app:assembleRelease
   apksigner verify --print-certs app/build/outputs/apk/release/app-release.apk
   ```

Without the properties the release build still succeeds but is unsigned, so an accidental unsigned release is
obvious. An APK signed with your key and the official one cannot update each other: switching means uninstalling
first, which removes results that were not yet sent. For a test copy next to a real app, build the debug variant
with `-Pmk8dxSideBySideSuffix=test`; it installs under its own application id.

## LiveTrial Windows

Install 64-bit Python 3.12, Node 24 and FFmpeg (for example `winget install Gyan.FFmpeg`; the package does not
include FFmpeg, and live capture finds it on PATH or under `%LOCALAPPDATA%\MK8DX\LiveTrial\tools\ffmpeg\bin\`). Create a
new build venv outside the repository; install the packages pinned in
`apps/timetrials-desktop/vision-runtime/requirements.txt` plus
`pyinstaller==6.16.0`; the manifest already pins the runtime's `jsonschema`.
Obtain the official Python
3.12.10 64-bit embeddable ZIP from python.org; the builder checks its pinned
SHA-256. Then, from the repository root:

```powershell
C:\path\to\new-build-venv\Scripts\python.exe tooling/livetrial/build_windows_package.py --output C:\path\to\new-live-package --engine-venv C:\path\to\new-build-venv --embedded-python C:\path\to\python-3.12.10-embed-amd64.zip --version local --product-icon apps/timetrials-web/styles/app-icon-512.png
```

The output contains the real engine, internal game/OCR assets, two executables
and an embedded interpreter. Capture input and results stay operator local.

## Tournament Windows

With Python 3.12 and Node 24, from the repository root:

```powershell
python tooling/tournament/build_windows_package.py --output C:\path\to\new-tournament-package --version local
```

Extract the emitted ZIP and run `Install-MK8DX-TournamentTools.cmd`. The package
contains the five wheels (the central reader `mk8dx_icon_matcher` among them) and both recognition variants; its installer obtains
the pinned public Python dependencies into its own folder. See the
[operator guide](product/USING_MK8DX_TOURNAMENT_TOOLS.md). Recognition output
requires human review before import or publication.

Built packages contain game material from the asset collection; see
[Third-party materials](THIRD_PARTY_MATERIALS.md) before you share them.
