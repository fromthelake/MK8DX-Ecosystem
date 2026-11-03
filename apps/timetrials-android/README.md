# MK8DX Time Trials for Android

The Android app scans Time Trial results with the phone camera, keeps a local queue of runs and sends them to
the community the user chose, and shows the same rankings, builds, tournaments and notifications as the website.
Application ID: `nl.mariokart8.mk8dxtimetrials`. It has no Firebase or Google Play Services dependency:
notifications come from the community's own inbox, which the app checks while it is open and periodically in
the background.

Build it with the commands in [Client builds](../../docs/CLIENT_BUILDS.md); the scan runtime and game images come
from the repository's asset collection (`packages/assets/collection/`). The app reads the website's own link
format (`?tournaments=`, `?ranking=`, `?player=` and so on) through one parser, `deeplink/AndroidDeepLink.kt`,
whose tests share the website router's table. A build that the server marks as retired
(`GET /v1/public/client-support`) shows an Update Required screen.

## Product composition

`MainActivity` mounts a restored MK8DX product shell with five persistent,
icon-led bottom destinations — Home, Post, Rank, Build and Tournament — plus
header routes for synchronization status, notifications, settings and Player:

- cup/track-first 150cc/200cc entry with track standing, explicit manual/camera
  choice, equal time boxes, signed per-lap coin changes, bounded mushrooms,
  validation and review;
- gallery and in-app CameraX TT Scan with evidence/confidence/correction review;
- connected focus, detailed image-led Community Activity with lap coin deltas,
  mushrooms, compact loadout icons and explicit Android/Web/Windows producer
  badges (plus a correction mark when recognized fields were reviewed),
  time-sorted human/WR/ghost track
  context, full Global/Among-rivals Rank, historical Mastery and Build views;
- newest-first durable saved canonical results with explicit retry/sync; and
- a complete native Tournament operation client for authorized organizers.

Passwordless Player/account controls remain available from the header without
dominating launch. The Tournament client consumes server-authoritative APIs for
creation, the historical Absent roster with a default-hidden three-month
Inactive subset, A/W/X attendance, NS1/NS2 stations/cables, groups, standings,
incoming review, manual race entry, incidents, publication and rating choices.
MySQL, revisions, scoring and policy remain server-owned. Access requires
administrator authority or the audited bounded `tournament.operation`
capability.

While signed in, the header reads the protected canonical Apps manifest. When
its Android build number is newer than the installed `versionCode`, the
permanent notification is counted by the header bell and opens the trusted
website download page. Network or manifest errors are deliberately silent and
never block the product.

Manual entry and scanning work while signed out. They use a durable private
`producer_local_profile` installation UUID and save canonical
`TimeTrialSubmissionV1` into the app-owned outbox. Signing in never rewrites an
existing local identity.

Authentication is needed only for account operations and central
synchronization. The app requests an allow-listed MK8DX device code, opens the
same-origin `/device` approval page in the user's browser, and polls explicitly.
It contains no password UI. A bearer session becomes usable only after the API
returns the separately verified claimed `player.*`. The session is encrypted at
rest with Android Keystore AES-GCM and expires fail-closed.

The canonical sync transport accepts only the configured exact HTTPS origin
and fixed `/v1/time-trial-submissions` path. It receives the canonical outbox
entry, not the private evidence root, follows no redirects, performs no
automatic retries, and requires an exact acknowledgement. Under the approved
none-by-default corpus policy, the production composition currently permits
synchronization only when canonical `evidence[]` is empty.

Saving schedules owner-bound automatic synchronization through WorkManager.
Connectivity and owning-account constraints control retries; Home and Saved
Results keep the exact human state visible, and manual **Sync now** remains an
explicit recovery action. Each transport invocation is still one bounded
attempt with an exact acknowledgement—retry policy lives outside the transport.

The generated loadout catalog derives private image filenames from the
canonical manifest `iconPath`, not from filtered picker position. This matters
for character variants: stable record IDs, displayed names and packaged icons
must resolve through the same mapping. See
`docs/provenance/ANDROID_LOADOUT_PRESENTATION_EVIDENCE.md`.

## Offline scanner packaging

Normal public builds compile without a recognition payload and report that
offline scanner assets are unavailable. An explicitly private build may enable
the staged scanner with:

```powershell
.\gradlew.bat -PenableScanRuntime=true :app:assembleDebug
```

Additional presentation assets and test fixtures can be staged from a local folder outside Git:

```powershell
.\gradlew.bat -PenableScanRuntime=true `
  -Pmk8dxPrivateProductAssetsRoot=C:\path\to\private\assets `
  -Pmk8dxPrivateScanTestFixturesRoot=C:\path\to\private\testkit\frames `
  :app:assembleRelease
```

Color-family character/body/glider presentation variants are staged separately
from a local reference folder. Only generated IDs, family metadata and paths are checked in:

```powershell
.\gradlew.bat `
  -Pmk8dxPrivateCleanAssetsRoot=C:\path\to\clean-assets `
  -Pmk8dxPrivateVariantAssetsRoot=C:\path\to\icon-matcher\refs `
  :app:assembleDebug
```

That graph bundles the unchanged locally staged recognition model/assets and
keeps core gallery/camera scanning offline. The model, game-derived references,
and evaluation corpus are game-derived material; see
[Third-party materials](../../docs/THIRD_PARTY_MATERIALS.md).

The preserved source projects remain read-only evidence. Normal app runtime
code does not locate `_source_snapshots`, Firebase configuration, or private
corpus paths.

## Configuration and validation

The normal APK asks the user for the exact HTTPS community origin on first
launch and allows a confirmed change in Settings. Building a separate APK for
each operator domain is unnecessary. For a customized APK, the optional build
property `mk8dxApiOrigin` supplies a default and manifest host; without it the
default is `https://example.invalid`:

```powershell
.\gradlew.bat -Pmk8dxApiOrigin=https://example.invalid :app:assembleDebug
```

Use the checked-in Gradle wrapper with process-local Android SDK and JDK paths.
For product changes, run JVM tests, lint, APK build, emulator device tests,
explicit install/cold launch, and logcat review. The scanner-enabled graph must
also pass when private local artifacts are available.

`local.properties`, credentials, Firebase configuration, bearer sessions,
generated builds, private scanner payloads, and emulator state must stay
outside Git.
