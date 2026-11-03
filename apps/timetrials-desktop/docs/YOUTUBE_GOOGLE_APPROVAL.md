# Getting LiveTrial's YouTube upload approved by Google

Until Google approves the project, every upload is **Private** (not usable as public evidence),
every Player's Google account must be a **test user**, and connections expire after **about seven
days**. Two separate Google processes lift this. Check Google's current pages before submitting; the
requirements below are what they ask for at the time of writing.

## 1. OAuth app verification (Google Auth Platform)

Needed because `https://www.googleapis.com/auth/youtube.upload` is a *sensitive* scope. It removes the
test-user list and the seven-day expiry once the app is **In production**.

Prepare:

- **Home page** on a domain you own, describing LiveTrial and the upload feature
  (for example a page on `example.invalid`).
- **Privacy policy** on the same domain: what LiveTrial does with Google data (it uploads the clip the
  Player chose to that Player's own channel; it stores an OAuth token on the Player's PC only,
  protected by Windows; it sends no Google data to any server; how to disconnect and revoke).
- **Authorized domain** verified in Google Search Console, matching the home page and privacy policy.
- **App name and logo** in *Branding* exactly as the app shows them.
- **Scope justification**: upload only, one clip at a time, only when the Player presses Upload.
- **Demo video** (unlisted YouTube link) showing: Connect YouTube -> Google consent screen with the
  scope visible -> back in LiveTrial -> Upload of one clip -> the video on YouTube.

Then: *Audience* -> **Publish app** (Testing -> In production) and submit for verification.

## 2. YouTube API Services audit (compliance review)

Needed to lift the **Private-only** lock on uploads (and to raise the daily quota). Submitted with the
*YouTube API Services - Audit and Quota Extension* form.

Prepare:

- The API project number and a description of how LiveTrial uses `videos.insert`.
- Evidence of the **YouTube API Services Terms and Developer Policies**, in particular the
  upload-client minimum functionality: the Player chooses **Public, Private or Unlisted** (LiveTrial's
  model already carries all three; only Private is offered until approval), sees the title and
  description, and the upload is always the Player's own action.
- Links to the privacy policy and terms, and screenshots of the upload screen.
- Expected volume (uploads per day) for the quota request.

## After approval

1. Add `"unlisted"` (and `"public"`) to `AVAILABLE_PRIVACY_STATUSES` in `livetrial_youtube.py`, default
   new uploads to Unlisted.
2. Build the isolated next step: link an Unlisted upload automatically to the matching result on the
   website (same Player only; `POST /v1/time-trials/<submissionId>/actions/video`).
3. Videos uploaded before approval stay Private; do not assume they can be switched. Decide whether to
   upload them again.
