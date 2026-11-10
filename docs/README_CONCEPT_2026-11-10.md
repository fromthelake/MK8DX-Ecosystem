# MK8DX Ecosystem

**Your own Mario Kart 8 Deluxe home base — for LAN nights, Time Trials and bragging rights.**

Language: English · [Nederlands](README_NL.md)

<!-- Screenshots to add before publishing: a LAN night seating board, LiveTrial's live view,
     the phone scanner on a TV result screen, a player's records page. Real captures only. -->

Remember LAN parties? Two players per screen, a room full of Switches, everybody yelling at
Rainbow Road. MK8DX Ecosystem brings that night back — and takes care of everything around the
racing: who sits where, which group plays next, the scores, the finals and the standings.
Between nights, it turns your Time Trials into something you can actually compare: automatically
recorded runs, ghosts, records and rivals.

Everything runs on **your own computer and your own network**. No cloud account, no
subscription, no ads.

---

## 🏁 LAN tournament nights

The heart of MK8DX: a real, social tournament night.

- **Sign-up** — open sign-up for a night with a closing time and a maximum; first come, or a fair
  draw from a published seed. Players sign up with the Switches they bring.
- **Seating that does itself** — attendance, consoles and seats (two players per Switch), station
  and cable numbers. Choose ranked or random seeding and *Balanced* or *Minimal movement*
  placement; MK8DX builds the qualifier groups and then the finals for you.
- **Tournament Live reads the races** — point a capture card at each screen. After every race it
  reads the finishing positions, characters, flags, race points, totals and the track (also in
  two-player split screen), saves them locally and sends them to the night on the website.
- **You stay in charge** — the organiser checks players and places before a result counts. Live
  standings are shown provisionally in the meantime.
- **Afterwards** — final standings, a shareable report (WhatsApp, PNG, CSV, a WordPress-ready
  article) and an optional TrueSkill-style community rating across nights.

## ⏱️ Time Trials with LiveTrial — fully automatic

Connect your Switch to your Windows PC through a capture card and just race. As far as we know,
nothing like this existed before.

LiveTrial watches the HDMI feed and recognises, by itself:

- the menus you go through, the **track** and the **class** (150cc/200cc);
- during the race: the **race clock, lap counter, coins and items**;
- on the result screen: **total time, every lap time** (3, or 7 on Baby Park), **character, kart
  body, tyres, glider** and **flag**;
- the **Select-a-Ghost** panel — ghost names, times, laps and parts — and whether a ghost is one
  of **Nintendo's staff ghosts**;
- your **Switch language** (all 12 system languages) automatically.

It keeps a **clip of every race** and of every ghost replay you watch to the finish, a run
history with lap tables and charts, and shows your gap to the **world record**, the **Nintendo
staff ghost**, your **own record** and your **rivals**. Send results to your community with one
click (or switch on automatic sending), and optionally upload a clip to your own YouTube channel.

## 📱 Scan from the couch

Time-trialling at a friend's place? Take your phone or tablet, point it at the TV and the scanner
reads the result screen: **total, laps, character, body, tyres, glider, flag and player name**, or a
**ghost panel** with its track and times. Anything uncertain is shown with alternatives so you can
pick the right one before you post.

The browser scanner runs **entirely on your device** — no account, no server, and offline after the
first download. The Android app scans on-device too.

## 🏆 Your records, your rivals

Every player gets their own records per track, a ranking with family, friends or the club, rivals
to chase (with pokes, challenges and the odd dice duel), notifications when someone beats your
time, and **23 mastery levels** measured against the current world records.

## 🌍 Speaks your language — all 15 of them

Mario Kart 8 Deluxe is played everywhere, so MK8DX is built for every game language: the website,
the Android app, LiveTrial and the Tournament tools come in **15 languages**, and recognition is
built for **all 15 game language variants** — from Dutch and English to Japanese, Korean,
Chinese, Russian and more. English and Dutch are reviewed by people; the other languages are
machine-translated and recognition in some of them is still being verified on real consoles.
Playing in your language? Your help checking it is the most valuable contribution there is.

## 🏠 Yours

Self-hosted: every community runs its own installation with its own accounts and results.

## 💡 The story behind it

MK8DX Ecosystem has been in development since 2024. It was built with AI — "vibe coding" — and
honestly: I could not have built this without AI, and the AI could not have built it without me.
I cannot imagine a world in which this would have reached a good result without constant
steering and explaining the logic, over and over. The number of sessions that just kept running,
burning credits without real results, still keeps me awake at night (haha). Part of the reason:
with all the screenshots and videos involved, the context simply grows too large for an AI to
hold — by now there are about 4 TB of AI-generated QA test material waiting for me to clean up.

Probably because this had never been built before. The techniques existed; stitching the right
ones together, in the right order, with a human checking every visual step in between and
steering again, did not. The same goes for the game assets: bits and pieces exist here and there,
but a complete package that contains everything, I had not seen before.

It has been a great school — and it has made me able to build faster and more efficiently around
image recognition and extraction from here on.

— [fromthelake](https://github.com/fromthelake)

## 🛠️ Make it your own

MK8DX is open source, built by players for players. Run it for your club, your family or your
city's LAN scene; adapt it to how *your* nights work; and build on it:

- **Translate or review** your language (the website, the apps and the in-game recognition).
- **Test recognition** with your own console, language and capture card, and report what it misses.
- **Add what your community needs** — new tournament formats, statistics, ways to share results.
- **Improve the docs** so the next organiser gets started even faster.

Start with [Contributing](CONTRIBUTING.md) and the [developer guide](docs/DEVELOPMENT.md).
Every pull request, bug report and translation fix makes the next LAN night better for everyone.

---

## Get started

| I want to… | Start here |
| --- | --- |
| **run MK8DX at home or at my club** | [Releases](https://github.com/fromthelake/MK8DX-Ecosystem/releases): download the package for one computer (A1) and follow the guide. A guided *setup wizard* for a home/club network without internet (A2) is being tested. |
| **organise LAN tournament nights** | [Tournament Directors](docs/guides/TOURNAMENT_DIRECTORS.md) |
| **record my Time Trials automatically** | [LiveTrial](docs/guides/LIVETRIAL.md) — Windows + a capture card |
| **post and compare my times** | [Players](docs/guides/PLAYERS.md) — any browser; Android 8.0+ |
| **host a community website** | [Host a community server](docs/guides/HOSTING.md) |
| **change the code** | [Developer guide](docs/DEVELOPMENT.md), [Testing](docs/TESTING.md), [Contributing](CONTRIBUTING.md) |

### What you need

- **A computer to host it** — Windows with Docker Desktop is the easiest; Linux works too.
- **For LiveTrial and Tournament Live** — a Windows PC and a USB HDMI capture card per screen.
- **For scanning** — any phone or tablet with a camera (Chrome or the Android app recommended;
  iPhone support is being tested).

## Project status

The 0.1.0 series is published on [GitHub Releases](https://github.com/fromthelake/MK8DX-Ecosystem/releases);
see the [changelog](CHANGELOG.md). Installation on one computer (A1) and on Windows with
XAMPP/Node.js (A3) is supported after installation and upgrade tests. Other routes are documented
and being tested; details in [Release packages](docs/RELEASE_PACKAGES.md) and the complete guide
([English](docs/install/MK8DX_User_Guide_EN.txt), [Nederlands](docs/install/MK8DX_Handleiding_NL.txt)).

Recognition never makes a result official by itself: you review your own Time Trials, and an
organiser checks tournament races before they count. Not affiliated with or endorsed by Nintendo.

## For the curious

How recognition works, the product rules and the architecture: the
[pipeline map](docs/architecture/RECOGNITION_PIPELINE.md), the
[public decision index](docs/decisions/README.md) and the [developer guide](docs/DEVELOPMENT.md).
Questions: [Getting help](SUPPORT.md).
