# MK8DX Ecosystem

**Host your own Mario Kart 8 Deluxe community website — for Time Trials *and* tournament nights.**

Language: English · [Nederlands](README_NL.md) · [Deutsch](README_DE.md) · [Español](README_ES.md) · [Français](README_FR.md) · [Italiano](README_IT.md) · [Português](README_PT.md) · [Русский](README_RU.md) · [日本語](README_JA.md) · [한국어](README_KO.md) · [简体中文](README_ZH_CN.md) · [繁體中文](README_ZH_TW.md)

![The home page of a community website: your standing, your focus tracks and your rivals](docs/readme/web-home.jpg)

MK8DX Ecosystem is something you host yourself. It gives your community one website that keeps
two kinds of results — **Time Trial results** and **tournament results** — and adds its own kind
of competition to each.

**⏱️ Time Trials**

- **Leaderboards** per track and class (150cc/200cc), for your community and next to the
  **world records**, which are refreshed once a day.
- **Rivals**: pick them once and always see where they stand against you.
- **Enter a time your way**: type it in by hand, scan the result screen with a camera — in the
  website or in the Android app — or let the Windows application **LiveTrial** record every run
  by itself through a capture card.
- **LiveTrial sees the race itself**: when you pick up coins, when you use your mushrooms — and it
  makes a **video clip of every run** that is yours to use.

**🏁 Tournaments**

- **LAN nights from sign-up to finals**: seating, groups, scores and standings, organised for you.
- **Results read from the screen** by Tournament Live, checked by the organiser before they count.
- **TrueSkill rating**: a skill rating that grows with every tournament night.
- **No account needed to play**: you can host a tournament without asking anyone to sign up.
  A player who wants their results on their own account can link them later — never an
  obligation.

**✨ What makes it unique**

Until now there was no solid way to get the data out of Mario Kart 8 Deluxe on a Nintendo Switch
through a capture card: it was mostly typing it over, or OCR that only reads text. MK8DX reads the
times, positions and points *and* recognises the pictures: the **character (including the right
colour)**, **kart body, tyres, glider** and **flag** — wherever the game shows them.

And you do not even need a capture card for that: from the couch, point your phone at the TV and
scan a Time Trial **result screen** or a **Select-a-Ghost screen**, and the result goes straight
to your website. As far as we know, that had not been done before either.

**🏠 At home or online — you choose**

- **Completely local**: run it on your home or club network. After the setup **no internet is
  needed** at all.
- **Online**: host it on your own server or web hosting and share it with your own online
  community.

Either way it is your installation, with your own accounts and results. No cloud account, no
subscription, no ads.

**🔑 No passwords, ever**

- **Only the administrator needs an account.** That account is also the first player, so the
  system always has at least one player; everybody else can join tournaments without one.
- **One link to sign in**: nobody has to make up or remember a password. At home, everyone gets
  a personal sign-in card (a link or QR code). Online, a new user only enters an **email
  address** and signs in with the link MK8DX sends them.

---

## 🏁 LAN tournament nights

Remember LAN parties? Two players per screen, a room full of Switches, everybody yelling at
Rainbow Road. MK8DX brings that night back and takes care of everything around the racing: who
sits where, which group plays next, the scores, the finals and the standings.

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

![Tournament Live after a race: the capture-card feed, and the finishing order with each driver's character and points](docs/readme/tournament-live.jpg)

<p>
  <img src="docs/readme/tournament-results.jpg" alt="Final results of a tournament night: qualifier groups with each player's character, coloured by the final they went on to" width="49%">
  <img src="docs/readme/tournament-skill.jpg" alt="Tournament skill page: TrueSkill rating, wins, top 3 and average finish of a player" width="49%">
</p>

### No Tournament Live on the night? Analyse the recordings afterwards

Recorded the night instead of capturing it live? The **Tournament Analysis** window reads the
recordings afterwards: add one video, several, or a folder per tournament, press **START
ANALYSIS**, and it finds every race with its positions, characters and points while a live,
coloured log and a Rainbow Road progress bar show how far it is. The result is an
Excel workbook, a CSV and a website import file for the organiser to check and import — the same
review as for Tournament Live. A 22-minute recording with four races took about 70 seconds on a laptop. In the Windows Tournament Tools package, double-click
`TournamentAnalysis.cmd` (dragging a video onto `TournamentProcessor.cmd` still works);
developers run `python -m tournament_processor.gui`.
[Tournament Directors](docs/guides/TOURNAMENT_DIRECTORS.md#analyse-recordings-afterwards) has the
steps.

![Tournament Analysis window during a run: a folder with one cup recording ticked on the left, the analysis running; on the right the coloured activity log with races found, and below it the Rainbow Road progress bar at 56% and the clock](docs/readme/tournament-analysis.jpg)

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

![LiveTrial during a run on Baby Park: lap 4 of 7, coins and mushrooms counted live, every lap compared with the ghost](docs/readme/livetrial-live.jpg)

![LiveTrial's run card afterwards: total time, the gap to the ghost, coins and mushrooms](docs/readme/livetrial-run.jpg)

## 📱 Scan from the couch

Time-trialling at a friend's place? Take your phone or tablet, point it at the TV and the scanner
reads the result screen: **total, laps, character, body, tyres, glider, flag and player name**, or a
**ghost panel** with its track and times. Anything uncertain is shown with alternatives so you can
pick the right one before you post.

The browser scanner runs **entirely on your device** — no account, no server, and offline after the
first download. The Android app scans on-device too.

<p>
  <img src="docs/readme/scanner-reading.jpg" alt="The browser scanner reading a phone photo of a Select-a-Ghost screen" width="32%">
  <img src="docs/readme/scanner-filled.jpg" alt="The form filled from the scan: character, kart, tyres, glider, flag and lap times, with the one uncertain part marked" width="32%">
</p>

## 🏆 Your records, your rivals

Every player gets their own records per track, a ranking with family, friends or the club, rivals
to chase (with pokes, challenges and the odd dice duel), notifications when someone beats your
time, and **23 mastery levels** measured against the current world records.

<p>
  <img src="docs/readme/timetrials-leaderboard.jpg" alt="Rainbow Road leaderboard with the world record, combos, mushrooms and coins per lap" width="72%">
  <img src="docs/readme/phone-leaderboard.jpg" alt="The same leaderboard on a phone, in the dark theme" width="24%">
</p>

## 🌍 Speaks your language — all 15 of them

Mario Kart 8 Deluxe is played everywhere, so MK8DX is built for every game language: the website,
the Android app, LiveTrial and the Tournament tools come in **15 languages**, and recognition is
built for **all 15 game language variants** — from Dutch and English to Japanese, Korean,
Chinese, Russian and more. English and Dutch are reviewed by people; the other languages are
machine-translated and recognition in some of them is still being verified on real consoles.
Playing in your language? Your help checking it is the most valuable contribution there is.

## 💡 The story behind it

**It all started with a local Mario Kart tournament, a few enthusiastic people, and an invitation in December 2023.**

Believe it or not, despite having played Mario Kart on the Nintendo 64, I had barely touched Mario Kart 8 Deluxe. I didn't even know drifting was a thing. Needless to say, I had some catching up to do.

What I discovered was a wonderful group of people who genuinely loved bringing others together to race.

And that group kept growing.

What started with just 16 players eventually grew into a community of more than 68 participants, with up to **36 players competing in a single evening**. Together, they've completed **over 1,000 registered races**, covering all 96 tracks and countless hours of friendly competition.

The setup evolved just as quickly. What started with **Wi-Fi, a GoPro, a lot of manual review and plenty of connection issues** gradually evolved into capture cards, a fully wired Ethernet network, automated race tracking and 36 players competing in a warehouse surrounded by consoles, screens, cables, friends and, of course, pizza.

And every tournament brought new ideas.

We started analysing scores, tracking performances, optimising seating arrangements and figuring out how to automate the increasingly complicated task of moving players between Nintendo Switches, including switching Ethernet cables around. Anyone who has organised something like this knows that sometimes the racing is the easy part.

**Then came the Time Trials.**

What began as a little competition quickly turned into a friendly rivalry to shave just a few more milliseconds off our times. Baby Park and Big Blue on 150cc became particular favourites. There was always someone setting a faster lap and always someone determined to beat it.

Naturally, we wanted to track those results properly too. The same enthusiasm for improving our tournaments found its way into automated Time Trial recording, image recognition, statistics, rankings and more.

One thing led to another, and before I knew it, I was spending almost as much time building tools around Mario Kart as actually playing it.

### From passion to an open-source ecosystem

MK8DX Ecosystem has been in development since 2024, with a lot of help from AI — or what we now call *vibe coding*.

And I want to be clear about something: **I could not have built this without AI, and AI could not have built it without me.**

Getting everything to work has required an incredible amount of experimentation, patience, explaining game logic, reviewing screenshots, correcting mistakes and steering AI back in the right direction. Sometimes over and over again.

There have been plenty of sessions that happily burned through credits while achieving absolutely nothing. Those still keep me awake at night (haha).

And apparently, visual testing produces quite a bit of data. I'm now sitting on roughly 4 TB of AI-generated QA screenshots and recordings that I really should clean up someday.

The individual techniques already existed, but bringing them together into a working ecosystem that understands what is happening on screen, extracts game information and makes it useful for players and organisers has been quite a journey. The same goes for gathering and organising the game assets needed to support it all.

It has been an incredible learning experience, especially around image recognition, automation and software development.

Now, in 2026, I'm finally able to share the results as an **open-source ecosystem**, so others can use it, improve it and hopefully have just as much fun with it as we have.

### ❤️ For Volkert

I also want to dedicate a part of this project to our dear friend and rival, **Volkert**, who passed away far too soon.

Volkert was one of those people who kept inspiring us to push a little harder, find that faster racing line and try just one more Time Trial. The friendly rivalry, especially around Baby Park and Big Blue, made the competition something special.

But more than the lap times or rankings, it's the moments together that matter. Sitting in a warehouse with friends, laughing, competing, sharing pizza and enjoying something as simple as a game.

Those are the moments worth remembering.

Volkert, thank you for the competition, the inspiration and the memories. You'll always be part of this story.

### Keep racing, keep sharing

We don't claim to be the best players, the best developers or to have built the perfect solution. But there's certainly no shortage of enthusiasm, curiosity or determination to keep improving.

If this project helps you organise a LAN tournament, start a friendly rivalry, beat a personal record or simply have a great evening with friends, then it has achieved something worthwhile.

**Please keep sharing your best moments, your ideas and your improvements.** That's what keeps a community like this alive.

And finally, a big thank you to **Nintendo** for creating such fantastic consoles and games. If you enjoy Mario Kart, support the people who make it possible: buy the original consoles and games, invite your friends, family or colleagues, and enjoy playing together.

After all, that's how this whole adventure started.

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
| **run MK8DX at home or at my club** | The A2 package for your computer from [Releases](https://github.com/fromthelake/MK8DX-Ecosystem/releases): unpack, start, click Next. Step by step with pictures: [English](docs/install/A2_HOME_GUIDE_EN.md) · [Nederlands](docs/install/A2_THUIS_HANDLEIDING_NL.md) |
| **organise LAN tournament nights** | [Tournament Directors](docs/guides/TOURNAMENT_DIRECTORS.md) |
| **record my Time Trials automatically** | [LiveTrial](docs/guides/LIVETRIAL.md) — Windows + a capture card |
| **post and compare my times** | [Players](docs/guides/PLAYERS.md) — any browser; Android 8.0+ |
| **host a community website** | [Host a community server](docs/guides/HOSTING.md) |
| **change the code** | [Developer guide](docs/DEVELOPMENT.md), [Testing](docs/TESTING.md), [Contributing](CONTRIBUTING.md) |

### Which computer for which route

Every route gives you the same website; they differ in where it runs and who can reach it.

| Route | For | Runs on | Status |
| --- | --- | --- | --- |
| **A2** home or club network | Your own network, no internet needed after setup, sign-in cards for everyone | Windows 11 (x86-64), Linux (x86-64 or arm64), Mac (Apple silicon or Intel) | Tested end to end on Windows 11; Linux in WSL 2; Mac built, not yet tested on a real Mac |
| **A1** one computer | Trying it out on the computer you sit at | Windows 11 or Linux, x86-64, with Docker | Tested: install, upgrade, backup |
| **A3** one computer without Docker | A Windows PC where Docker is not an option | Windows 11 with XAMPP and Node.js | Tested: install, upgrade, backup |
| **B1** public website | Your online community, your own domain and email | A Linux x86-64 server (VPS) with Docker; Ubuntu 24.04 documented | Documented, not yet tested end to end |
| **B2** web hosting | Online, without a server of your own | A hosting plan with Node.js (Passenger), MariaDB/MySQL and SSH | Our own community site runs this way; the public package has not yet been installed from scratch on a new hosting account |

The apps around it:

| App | Runs on | Why |
| --- | --- | --- |
| Website and browser scanner | Any modern browser; Chrome or Edge recommended for scanning | The scanner runs entirely on your device and needs a browser that gives it several threads |
| Android app | Android 8.0 or newer, arm64 recommended | Scans on the phone itself, also without a connection |
| iPhone and iPad | The website in the browser; scanning in Safari is still being tested | There is no iOS app: building and signing one needs a Mac and an Apple developer account |
| LiveTrial and Tournament Live | Windows on x86-64 (tested on Windows 11), with a USB HDMI capture card per screen | The capture cards and the bundled recognition engine are built and tested for Windows; there is no macOS or Linux build |

**First start of the Android app:** it asks *Choose your community*. At home or at the club you scan the
**Prepare a device** card your administrator shows; for an online community you type its website address. Then you
sign in through the browser. Details: [Players](docs/guides/PLAYERS.md#first-start).

**One app, several communities:** the community chip at the top switches between your club, your home
installation and an online community in one tap; each keeps its own account and unsent times. Under **You** →
**My times** you see your best time per track, also without internet, and with more than one community you can
carry your best times to another one — if that community accepts them.

**Why not everything everywhere?** Each package is only offered where it has been built and tried. The A1 and
B1 server images exist for x86-64 only; A2 also has arm64. For Intel Macs the security library A2 needs
(`cryptography`) is no longer published, so the release builds it from source on an Intel Mac and tests it there
([how](docs/RELEASE_PACKAGES.md#intel-mac-a2-package)). A3 exists for people who cannot or do not
want to run Docker. The [hosting guide](docs/guides/HOSTING.md) and the [release packages](docs/RELEASE_PACKAGES.md)
list every file and its exact requirements.

A fresh installation starts empty: no community accounts or results are inherited. It brings only the game
catalog and the Nintendo staff ghost and world record reference sets.

## Project status

Stable releases are on [GitHub Releases](https://github.com/fromthelake/MK8DX-Ecosystem/releases); 0.2.0 added A2,
at home or at the club; 0.2.1 gives the Android app an offline copy of your times and a calmer layout. See the
[changelog](CHANGELOG.md), [Release packages](docs/RELEASE_PACKAGES.md) and the complete guide
([English](docs/install/MK8DX_User_Guide_EN.txt), [Nederlands](docs/install/MK8DX_Handleiding_NL.txt)).

Recognition never makes a result official by itself: you review your own Time Trials, and an
organiser checks tournament races before they count.

## Documentation

| I want to… | Read |
| --- | --- |
| understand how recognition works | [Recognition pipeline](docs/architecture/RECOGNITION_PIPELINE.md) |
| understand the parts and how a result travels | [Architecture](docs/architecture/COMPONENTS.md) |
| build or change the code | [Developer guide](docs/DEVELOPMENT.md) and [Testing](docs/TESTING.md) |
| build the native clients | [Client builds](docs/CLIENT_BUILDS.md) |
| run an installation (backup, upgrade, recovery) | [Operations](docs/OPERATIONS.md) |
| know why something is the way it is | [Decision index](docs/decisions/README.md) |
| contribute | [Contributing](CONTRIBUTING.md), [Code of conduct](CODE_OF_CONDUCT.md) |
| get help | [Getting help](SUPPORT.md) |
| report a security problem | [Security policy](SECURITY.md) |
| work with a coding agent | [AGENTS.md](AGENTS.md) |

## License and Nintendo

This is an independent, non-commercial hobby project to learn programming and to make Mario Kart 8 Deluxe
more fun. It is **not affiliated with or endorsed by Nintendo**. Nintendo owns its trademarks and game
content; please support Nintendo by buying its consoles and games.

The project's original code and documentation are licensed under the [Mozilla Public License 2.0](LICENSE).
The [license scope](LICENSE_SCOPE.md) explains what that covers: it does **not** cover Nintendo material,
game images, recognition templates, models, fonts or other third-party material, which keep their own
terms. See [Third-party materials](docs/THIRD_PARTY_MATERIALS.md). The software is provided as is.
