# Configuring your own Google OAuth client for LiveTrial's YouTube upload

LiveTrial's YouTube upload is optional. A build or fork without a client file runs
normally and simply shows *YouTube integration is not configured*. To enable it you need your own
Google Cloud project and a **Desktop app** OAuth client. Nothing here depends on the MK8DX
maintainers' Google project.

## 1. Google Cloud project

1. Open <https://console.cloud.google.com/> and create or select a project.
2. **APIs & Services → Library**: enable **YouTube Data API v3**.

## 2. Google Auth Platform (consent screen)

1. **Google Auth Platform → Branding**: give the app a name (for example *LiveTrial Desktop*) and a
   support email.
2. **Audience**: choose **External** unless everyone is in your own Google Workspace.
3. **Data Access → Add or remove scopes**: add only
   `https://www.googleapis.com/auth/youtube.upload`.
4. While the app's publishing status is **Testing**, add every Google account that will connect
   under **Audience → Test users** (up to 100). Accounts that are not listed are refused at consent.

## 3. The Desktop client

1. **Google Auth Platform → Clients → Create client**, application type **Desktop app**.
2. Download the JSON. It has a top-level `"installed"` object; a *Web application* client does not
   work with LiveTrial's loopback redirect and is refused with a clear message.
3. Name the file `youtube-oauth-client.json` and put it in one of these places:
   - `%LOCALAPPDATA%\MK8DX\LiveTrial\integrations\youtube-oauth-client.json` (per Windows user), or
   - anywhere else, with the environment variable `LIVETRIAL_YOUTUBE_OAUTH_CLIENT` set to its full
     path. When the variable is set, that is the only place LiveTrial looks, so a wrong path is
     reported instead of silently using another file.

LiveTrial reads only `client_id` and `client_secret` from the file; the token and consent addresses
are fixed in the code (`livetrial_youtube.py`), so a modified file cannot redirect traffic.

**Never commit the client file**, and never paste its contents into issues, docs or sample files. The
repository's `.gitignore` excludes `youtube-oauth-client.json`, Google's default
`client_secret_*.json` download name and the per-account `*.youtube.dat` authorization files. For an
installed app Google does not treat the client secret as confidential, but it still identifies your
project and its quota.

## 4. What LiveTrial does with it

- Consent opens in the person's default browser; the redirect returns once to
  `http://127.0.0.1:<random port>/` with a checked `state` and PKCE (S256).
- Tokens are stored per LiveTrial account in `%LOCALAPPDATA%\MK8DX\LiveTrial\accounts\<slot>.youtube.dat`,
  protected with Windows DPAPI exactly like that account's session file.
- Network access is limited to `POST https://oauth2.googleapis.com/token` and the resumable upload at
  `https://www.googleapis.com/upload/youtube/v3/videos` (`livetrial_https.allowed_google_request`).
- Uploaded clips are recorded in `%LOCALAPPDATA%\MK8DX\LiveTrial\youtube-uploads.json` (video id,
  link, privacy, account slot; never a token).

## 5. Limits of an unverified project

- **Private only.** Videos uploaded through an API project that has not completed YouTube's API
  compliance audit are locked to Private. LiveTrial therefore offers only Private
  (`AVAILABLE_PRIVACY_STATUSES` in `livetrial_youtube.py`); after the audit, add `"unlisted"` (and
  `"public"`) there. Do not try to work around the restriction.
- **Seven-day connections.** While the OAuth app is in *Testing*, Google expires refresh tokens after
  about seven days; LiveTrial then shows *Connect again*. Publishing the app (and Google's
  verification of the sensitive `youtube.upload` scope) removes this.
- **Quota.** Each upload costs YouTube Data API quota (the default daily quota allows only a handful
  of uploads per project). LiveTrial shows a plain message when it is used up.

## 6. Switching it off or removing it

- **Off for everyone on a PC:** do not provide the client file (and leave
  `LIVETRIAL_YOUTUBE_OAUTH_CLIENT` unset). LiveTrial then shows *YouTube integration is not configured*,
  makes no Google request and offers no upload.
- **Off for one Player:** *Disconnect YouTube* in the account menu (deletes that Player's
  `<slot>.youtube.dat`; with *Also forget locally stored YouTube upload history* also that Player's rows
  in `youtube-uploads.json`); removing the Player from LiveTrial deletes the authorization too.
- **Which clips:** `livetrial_clips.list_clips` lists every run's `clip_HHMMSS_runNN.mp4` and each ghost
  replay's `clip_HHMMSS.mp4` that a session's `ghosts.json` names (`ghost_clip_facts`
  rule 11). A plain clip no ghost names (a manual REC clip) is not listed.
- **What is sent:** `videos.insert` with `snippet.title`, `snippet.description`, `snippet.categoryId`
  (20) and `status.privacyStatus` / `selfDeclaredMadeForKids=false` - title and description exactly as
  the Player approved them in the upload form (`validate_upload_text` checks YouTube's limits and
  refuses; it never trims). No tags. The upload form carries the required notice with the YouTube
  Terms of Service and Community Guidelines links; the dashboard's Dutch layer skips form fields
  (`data-no-translate`) so it can never rewrite them.
- **Local traces:** `accounts\*.youtube.dat` (authorizations) and `youtube-uploads.json` (video ids and
  links of past uploads) under `%LOCALAPPDATA%\MK8DX\LiveTrial`; delete them to forget everything.
  Engine clips also get a small `clip_*.timeline.json` beside them; it holds only frame/time pairs.
- **Removing the code from a fork:** the feature is isolated in `livetrial_youtube.py` (Google side),
  `livetrial_youtube_publisher.py` (per-Player service), the YouTube parts of `livetrial_clips.py`
  (metadata and upload records), `allowed_google_request` in `livetrial_https.py`, the `youtube.*` and
  `clips.*` actions in `livetrial_desktop_app.py`, the companion-file line in `livetrial_accounts.py`, and
  the YouTube block and Clips dialog in `dashboard/app.js`. Nothing else in LiveTrial depends on it.

## 7. A centrally managed client later

An official LiveTrial distribution can ship its verified client file beside the package (still
outside Git) or place it at the app-data path during installation. Nothing else changes: the lookup,
the per-account tokens and the upload code stay the same.

## 8. Testing without Google

`tests/integration/test_livetrial_youtube.py` runs the whole flow against a fake transport: client
file lookup, consent with state and PKCE, per-Player connections, refresh and *Connect again*, the
resumable upload with resume after errors, duplicate prevention and log hygiene. No test contacts
Google or uploads a video.
