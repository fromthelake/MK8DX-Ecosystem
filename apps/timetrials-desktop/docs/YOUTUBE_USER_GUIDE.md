# Uploading a clip to YouTube from LiveTrial

YouTube is **optional**. LiveTrial records, recognizes and sends your times exactly the same without
it. Clips stay on your PC until you choose to upload one.

## What it does

LiveTrial keeps a short clip of each race. When your LiveTrial account is connected to your own
YouTube channel, you can upload one clip with one button. The video goes **straight from your PC to
YouTube**; the MK8DX website never receives the video. LiveTrial then shows the link, for example
`https://youtu.be/dQw4w9WgXcQ`, which you can paste as evidence with your time on
<https://example.invalid/>.

## Steps

1. Make sure YouTube is set up on this PC (see *Setting it up* below). If it is not, the account menu
   says **YouTube integration is not configured**. Everything else still works.
2. Open LiveTrial.
3. Open the account menu (top right) and check that **your** account is the one in use.
4. Under **YouTube**, press **Connect YouTube**.
5. Your normal web browser opens Google's sign-in page.
6. Sign in with your Google account and allow LiveTrial to **upload videos**. LiveTrial asks for
   nothing else, and it never sees your Google password.
7. The browser says *YouTube is connected to LiveTrial*. Close it and return to LiveTrial; the
   account menu now says **Connected**.
8. Capture your races as usual.
9. Go to **Run history** and press **Clips & YouTube**. It lists your finished runs with a recognized
   time, each with its end-screen picture, track, class, total time and laps (tick *Show unfinished
   runs* for the rest). Press **Watch** to check a clip first.
10. Press **Upload to YouTube…** on the clip you want. A form opens with the **title**, **description**
    and **visibility** that will be sent. LiveTrial fills them in from your race; change whatever you
    like. What you leave there is exactly what YouTube gets (LiveTrial refuses text YouTube would not
    accept, such as `<` or `>` or a title over 100 characters, instead of changing it). Read the notice
    and press **Upload to YouTube**: by doing so you confirm the video complies with the YouTube Terms
    of Service and Community Guidelines. The clip goes directly from your PC to YouTube; the card shows
    the progress, speed and time left.
11. Wait until it says **On YouTube**. YouTube has returned the video's id, and LiveTrial shows the
    link `https://youtu.be/<video-id>`. You can keep using LiveTrial meanwhile; only one clip uploads
    at a time.
12. Press **Copy link** to copy the `youtu.be` link.
13. Paste that link as the video with your time on the website, the same way you add any YouTube
    link to a result.

## Good to know

- **Ghost replays.** When you watch a ghost's replay to the finish line, LiveTrial keeps one clip of it:
  from that ghost's panel to the end of the replay. It shows in Clips & YouTube as **Ghost replay ·
  <name>**, with the same proposed title and description as a race (you can change them in the
  upload form, for example to say whose ghost it is). Looking through ghosts, backing out of Start Replay?, or quitting the
  replay early makes no clip, and a ghost that already has a clip gets no second one.

- **Several people on one PC:** each LiveTrial account connects its own YouTube channel. The account
  in use decides where a clip goes. Switch account first if you want to upload to someone else's
  channel.
- **Private for now:** LiveTrial's Google project has not yet finished YouTube's review, so Google
  makes every upload **Private**. A Private video can only be watched by you, so it is **not usable as
  publicly viewable evidence**. After the review, evidence uploads will be **Unlisted** by default
  (watchable by anyone with the link, not listed on your channel or in search).
- **Reconnecting:** while LiveTrial's Google project is in its test phase, Google ends the connection
  after about 7 days. The account menu then says **Connect again**. Nothing is lost.
- **Disconnect YouTube** asks first and removes LiveTrial's access from this PC. It does not delete
  any video on YouTube. You can tick *Also forget locally stored YouTube upload history for this
  Player* to also remove that Player's list of uploaded clips and links from this PC (other Players'
  lists stay); if you keep it, those clips keep showing as on YouTube. To withdraw the permission at
  Google as well, visit <https://myaccount.google.com/permissions>.
- Removing an account from LiveTrial also removes its YouTube connection from this PC.
- A clip that failed to upload stays on your PC unchanged; press **Try again**.
- **Forget this upload** (on an uploaded clip) removes LiveTrial's record of the upload on this PC, so
  the clip can be uploaded again. The video stays on YouTube; delete it in YouTube Studio if you want
  it gone.
- Videos uploaded while the Google project is unaudited stay **Private**. Do not count on changing
  them to Unlisted later; after the audit they may need to be uploaded again. LiveTrial does not add
  a Private video to your result on the website.
- **What the video says:** the title is `MK8DX | <track> | <class> | Total Time <time>`. The
  description lists each lap (time, coins, mushrooms) and, under **Details**, the start, coins,
  mushrooms, laps and finish. Every clickable time jumps to that moment in the video, counted from
  the video's 0:00; race times such as `1∶31.919` are not links. It also names you with a link to
  your profile and the track's leaderboard on the website. Only what LiveTrial recognized is
  written; a race you did not finish has no total time. LiveTrial cannot change a video's text after
  the upload; edit it in YouTube Studio if needed.

## Setting it up

LiveTrial needs a Google *OAuth client file* named `youtube-oauth-client.json`. Place it at:

```text
%LOCALAPPDATA%\MK8DX\LiveTrial\integrations\youtube-oauth-client.json
```

or point the environment variable `LIVETRIAL_YOUTUBE_OAUTH_CLIENT` at it. Whoever distributes your
LiveTrial provides that file; to make your own, see [YOUTUBE_DEVELOPER_SETUP.md](YOUTUBE_DEVELOPER_SETUP.md).
