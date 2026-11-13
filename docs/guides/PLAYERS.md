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
- A community the app can reach: an **online community** with a trusted HTTPS address, or a **home or club
  installation** (A2) on the same Wi-Fi. A computer-local address (`http://127.0.0.1:…`) does not work in the app.

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

The app opens on **Choose your community**, in the phone's language when the app has it. To pick another
language, tap **Language / Taal** (with the globe) at the top; the app keeps that choice. Then it asks one thing:
how your community plays. Not sure? Ask the
person who runs your community.

- **At home or at the club** (A2, MK8DX runs on a computer there): tap **Scan the QR code** and scan the
  **Prepare a device** card your administrator shows on that computer or hands out on paper. The phone must be on
  the same Wi-Fi. The app then shows the installation's address and key; they are also on the **Prepare this
  device** page under **Full fingerprints**. Tap **Connect** when they match. No internet needed. Step by step:
  [the A2 guide, chapter 7](../install/A2_HOME_GUIDE_EN.md#7-the-android-app-and-livetrial).
- **Online community** (a website on the internet): enter the address you open it with in the browser, for example
  `https://www.example.org` (no path, no trailing slash), and tap **Save**. If it fails, open the same address in
  the phone's browser: it must open without a certificate warning.

Then sign in: tap the person icon at the top right and **Sign in**; Settings › **Player on this phone** does the
same. The app shows a code and opens your community in the browser, where you confirm with your own account (on a
home or club installation the app reminds you: first sign in there with your personal sign-in card).

### Finding your way

The top of the app shows the logo (back to Home), the **community chip** with the name of the community you are
using, the bell and your name. Your name opens **You**: your Player with **Switch Player**, and the tabs
**My times**, **Records** and **Rivals**, with a **Settings** row below them.

- **Several communities**: tap the community chip to open **Communities**. The active one is green; **Switch**
  changes to another in one tap, **Remove from this phone** forgets one (only once nothing waits to be sent), and
  **Add a community** opens the first-start screen again. Each community keeps its own sign-in, its own unsent
  runs and, at home or at the club, its own trust; nothing moves between them by itself. When the administrator
  has named the community, the app shows that name instead of the address.
- **My times** is one list: your career numbers, then one row per track and class with your personal best; tap a
  row for older runs and use **⋯** on a run for **Details**, **Edit**, **Withdraw** or
  **Carry to another community…**.
- **Without internet**: the app keeps a copy of your own times and your rivals' best times per community and
  shows it with "Offline — last updated …".
- **Waiting to be sent**: runs that are still only on the phone show as an orange banner on Home and You; tap it,
  or use Settings › **Saved on this phone**, to see them.
- **Settings** is grouped into **Player**, **App**, **Community** and **About**, and saves each change by itself.
  The language is under App; **Get the app** and **Saved on this phone** are under Community; **Run a test scan**
  is under About.

### Carrying times to another community

If you belong to more than one community, a time can count in another one too: **Carry to another community…**
on a run, or **Carry my best times** below your career numbers in My times (tracks where the other community
already has a better time of yours are skipped). The copy waits until you are signed in there. The **receiving**
community decides: by default it does not take times from elsewhere, it may let an administrator approve each one
first, or it may take them like any other time. A carried time always shows where it came from ("Carried from … ·
originally …"). The same original is taken only once; an equal time only fills in what the existing run was
missing.

### Notifications

Notifications in the app are fetched from your community's inbox; Android's notification permission and the
app's own switch must both be on.

## Problems

- No sign-in email: check spam, the exact address and ask for a new link. On a local trial installation the
  email arrives in the local test inbox, not in your mailbox.
- Something looks wrong on your community's site: ask the people who run it first. Bugs in the software itself
  can be reported in the project's issues; see [SUPPORT.md](../../SUPPORT.md). Never post sign-in links or other
  people's names.
