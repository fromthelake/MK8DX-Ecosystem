# User guide map

This map describes the maintained reader-facing guides. It separates authored
content from generated formats so a change reaches the source, the offline
packages and the release downloads together. Current release status belongs in
[Release packages](RELEASE_PACKAGES.md) and the release itself.

The 15 locales are `en`, `en-US`, `nl`, `de`, `es`, `es-419`, `fr`, `fr-CA`, `it`,
`ja`, `ko`, `pt`, `ru`, `zh-CN` and `zh-TW`. English and Dutch are reviewed
source texts; the other 13 are machine translations pending language review.
An available file is not evidence that a native speaker checked it.

## Which guide owns the task?

| Reader task | Guide to follow | Related summaries or references |
| --- | --- | --- |
| Choose an installation route | `docs/install/START_HERE_EN.md` / `START_HIER.md`, with `translations/<locale>/START_HERE.md` | Root README, Hosting and the reading guide introduction |
| Install and run at home or at a club (A2) | `docs/install/A2_HOME_GUIDE_EN.md` / `A2_THUIS_HANDLEIDING_NL.md`, with `translations/<locale>/A2_HOME_GUIDE.md` | Reading guide chapter 3; the A2 guide also owns local certificate trust, sign-in cards, backup, restore, update and package relocation |
| Try A1 on one computer | `docs/install/A1_ONE_COMPUTER_EN.md` / `A1_EEN_COMPUTER.md` | Reading guide chapter 1; Hosting |
| Try A3 without Docker | Reading guide chapter 2 | Start here and Hosting point to that chapter; no separate A3 guide exists |
| Install on a VPS (B1) | `docs/install/B1_VPS_EN.md` / `B1_VPS.md` | Reading guide chapter 5; Hosting |
| Install on shared web hosting (B2) | `docs/install/B2_WEBHOSTING_EN.md` / `B2_WEBHOSTING.md` | Reading guide chapter 4; Hosting |
| Manage any installation | `docs/install/ADMINISTRATION_EN.md` / `BEHEER.md`, and `SETTINGS_EN.md` / `INSTELLINGEN.md` | Reading guide chapters 7–8; A2-specific operations stay in the A2 guide |
| Use the website and Android app | `docs/guides/PLAYERS.md` and its translations | Reading guide chapter 6; `CLIENTS_EN.md` / `CLIENTS.md`; A2 joining in the A2 guide |
| Use LiveTrial | `docs/guides/LIVETRIAL.md` and its translations | Reading guide chapter 6; `CLIENTS_EN.md` / `CLIENTS.md`; A2 pairing in the A2 guide |
| Run a tournament night | `docs/guides/TOURNAMENT_DIRECTORS.md` and its translations | Reading guide chapter 6; root README overview |
| Host and operate a server | `docs/guides/HOSTING.md` / `translations/nl/HOSTING.md` | A1/B1/B2 route guides and reading guide |

The broad `docs/install/MK8DX_User_Guide_EN.txt` / `MK8DX_Handleiding_NL.txt`
and 13 translated TXT files cover all five routes, clients and operations in
one book. Keep its route chapters complete enough to read alone, and keep the
more detailed A2 guide complete enough for someone working offline. A summary
may point to a fuller guide, but must not replace a necessary step with a link
the reader cannot open.

The older Dutch `docs/install/A2_EIGEN_NETWERK.md` documents a different,
advanced mail-server route; its warning points ordinary A2 readers to the
current guide. `A2_OFFLINE_LAN_EN.md` is a short redirect to the current A2
guide. Do not treat either as a second authority for the offline sign-in-card
route. Check unique content and links before retiring an older page.

## Language and format coverage

| Family | Source locales | Built or distributed copies | In A2 ZIP? |
| --- | --- | --- | --- |
| Root README | All 15 | Markdown only | No |
| Start here | All 15 | Markdown only | Yes |
| A2 full guide | All 15 | `docs/install/guide/<locale>.html`; standalone release HTML and PDF | Yes: Markdown and local HTML |
| Broad reading guide | All 15 | DOCX built from TXT; TXT/DOCX release assets | Yes: TXT and DOCX |
| Players, LiveTrial, Tournament Directors | All 15 | Markdown only | No |
| A1, B1, B2, Clients, Administration, Settings, Hosting | EN/NL | Markdown only | `docs/install` families yes; Hosting no |

`tooling/build_guide_html.py` builds the local A2 HTML from the Markdown
sources and uses screenshots from `docs/install/guide/img/` (one EN and one NL
image per current illustrated scene, with English fallback for other locales).
`tooling/build_guide_bundle.mjs` builds the standalone HTML/PDF from those
pages and images. `tooling/release/build_reading_guides.py` builds DOCX from
TXT. Generated files are not separate editorial sources. A2 HTML is the
primary on-screen and offline format, PDF is for print and sharing, TXT is
the broad guide's plain-text source and DOCX its formatted copy.

Every important action must be understandable in text, with a useful image
alt description where an image is shown. Re-capture a screenshot from the real
UI when its buttons, sequence or security check change; do not edit interface
words into an old image. Review example data and image hashes before packaging.

## Reader entry points

1. The README and release page help choose a route and language before the
   download. A historical release should link to its own guide assets rather
   than to `/releases/latest/`.
2. An A2 package's `README-FIRST.txt` leads to its local illustrated guide.
   `START-HERE.html` offers the 15 languages immediately after unpacking.
   The setup/management wizard's **Manual** link serves the guide in the chosen
   language through `/help`, with the Markdown manual as fallback. That wizard
   listens on the host's `127.0.0.1`; phones cannot follow its link.
3. The phone's `/setup` page and Android onboarding show their own immediate
   certificate and sign-in instructions. `/setup` also links to the matching
   illustrated guide through the read-only `/help/a2/<locale>.html` LAN route.
   This route serves only the packaged guide pages and their required assets;
   it does not expose the host management wizard.
4. The website's Apps page gives short install/update instructions. Additional
   Players, LiveTrial, Tournament and operator links should appear near their
   tasks only when those guides are actually reachable in that installation.

The packaging check must compare the guide sources and generated copies with
the exact source commit of a new package. Source validation, package contents
and published asset checks are separate evidence.

[Guide gaps](GUIDE_GAPS.md) records where EN/NL-only technical references still
contain extra detail and how the 15-language reading guide directs readers to it.
