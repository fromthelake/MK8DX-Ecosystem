# Players: the website and the Android app

[All guides](../../README.md#get-started)

You need the address of your community's MK8DX website, for example `https://www.example.org`. Every community
runs its own installation with its own accounts and results; ask the people who run yours for the address and
for help with your account. You do not install anything to use the website.

## The website

### Sign in

1. Open your community's address and choose the account icon (top right), then **Sign in**.
2. Enter your email address and choose **Email me a link**. Open the email and follow the link. There is no
   password. The link works once and expires; ask for a new one if it does not work.
3. The first time, the link opens a three-step setup directly. Step 1, **Are you already on this website?**,
   asks whether your Time Trial times are already on the site and whether you took part in a tournament listed
   there. If so, step 2 lets you find the Player that is you and ask for it to be linked to your account; an
   administrator or the night's Tournament Director reviews such a claim before it is linked, and nothing is
   linked by name alone. If not, step 2 creates your Player (on a community where only Directors create
   Players, it explains whom to ask instead). Step 3 offers a few optional settings you can skip.

Your account (the email you sign in with) and your Player (the name on the leaderboards) are separate things.

### Post a Time Trial

- **Post a time** (top bar), or **Tracks** → a track → **Post a time**: enter your time in 150cc or 200cc, check
  the values on the confirmation and publish.
- **Scan it**: open `<your community address>/scanner/` on a phone or tablet. Point the camera at the result
  screen on your TV, or choose **image upload** with a photo or screenshot. The scanner reads the times, laps
  and, when visible, the character, kart setup and flag. Check every value before you submit; recognition can
  be wrong. The camera needs a trusted HTTPS address (it works on `localhost` too); image upload works anywhere.
- Depending on the community's rules, a submission may be published at once or wait for review by an
  administrator. An administrator can correct or withdraw a published time.

### Follow your progress

**Tracks**, **Ranking** and **Records** show your best times and laps next to the community, your chosen rivals,
the Nintendo Ghost Staff and the world records. **Build** helps with character and kart setups, **Community**
shows other Players and **Tournaments** the published tournament nights, standings and reports. When someone
beats one of your published times, you get a notification (the bell). The website can also send browser push
notifications if your community has set that up; turn them on in your account settings.

The website is available in the game's 15 languages (choose yours in the settings). English and Dutch are
reviewed; the other 13 are machine translations, and corrections are welcome: see
[Change UI text and translations](../DEVELOPMENT.md#change-ui-text-and-translations) for the file to edit and
[Contributing](../../CONTRIBUTING.md) for the pull request.

## The Android app

The app offers a faster scan on the phone itself, your times and notifications. It is optional.

### Requirements

- Android 8.0 or newer; an arm64 phone is recommended. The release APK is large (about 484 MB): keep about
  1 GB free while installing.
- A community address with **trusted HTTPS** (a public website). A computer-local address (`http://127.0.0.1:…`)
  or a home-network address with a self-made certificate does not work in the app.

### Install

1. Get the APK from your community's **Get the app** page when it offers downloads (you must be signed in to see
   them; that is the build your community supports), or from the project's
   [GitHub Releases](https://github.com/fromthelake/MK8DX-Ecosystem/releases) page: take
   `mk8dx-android-release-….apk`. With a clone of the repository you can also build the APK yourself:
   [Client builds](../CLIENT_BUILDS.md#android).
2. Check the file against `SHA256SUMS.txt` from the same release (on a computer: `Get-FileHash` in PowerShell,
   `sha256sum` on Linux, `shasum -a 256` on macOS).
3. Copy the APK to the phone and open it from **Files** or **Downloads**. Android asks to allow installing from
   that app; allow it only for this checked file and turn it off again afterwards if you like.

This is not a Play Store app. Earlier public APKs were signed with a debug build key; the release APK uses the
maintainer's retained key. Save any results not yet sent and uninstall an earlier debug APK once before installing
this release. Later APKs signed with the same release key update in place. Switching to a community's or a
self-built APK with a different key also requires an uninstall.

### First start

1. **Community website**: enter the full address, for example `https://www.example.org` (no path, no trailing
   slash), and tap **Save**. If it fails, open the same address in the phone's browser: it must open without a
   certificate warning.
2. Sign in with the code the app shows: it opens your community in the browser, where you confirm with your own
   account.
3. To change community later: **Settings → Community server → Change server**. Sessions and runs that were not
   sent stay with the old server; they do not move automatically.

Notifications in the app are fetched from your community's inbox; Android's notification permission and the
app's own switch must both be on.

## Problems

- No sign-in email: check spam, the exact address and ask for a new link. On a local trial installation the
  email arrives in the local test inbox, not in your mailbox.
- Something looks wrong on your community's site: ask the people who run it first. Bugs in the software itself
  can be reported in the project's issues; see [SUPPORT.md](../../SUPPORT.md). Never post sign-in links or other
  people's names.
