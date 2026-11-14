# Een communityserver hosten

*Nederlandse versie van de [Engelse handleiding](../../HOSTING.md); bij details is de Engelse versie leidend.*

[Alle handleidingen](../../../../README.md#get-started) · [Operations](../../../OPERATIONS.md) · [Handleiding (volledig)](../../../install/MK8DX_Handleiding_NL.txt)

Deze handleiding is voor wie de MK8DX-website voor een community draait: de website, de browserscanner,
de API en de database. Spelers, toernooidirecteuren en LiveTrial-gebruikers maken daarna verbinding met jouw adres.

Elke installatie begint leeg: er worden geen accounts of resultaten overgenomen. Er zitten alleen de gamecatalogus en de
referentiesets Nintendo Ghost Staff en World Records in.

## Kies een route

| Route | Wat je krijgt | Draait op | Instructies |
| --- | --- | --- | --- |
| **B1** openbare website met Docker | Je eigen HTTPS-domein, echte e-mail | **Linux**-server op x86-64 (Ubuntu 24.04 LTS gedocumenteerd) | [hieronder](#linux-server-met-docker-hoofdroute), en het VPS-hoofdstuk van de handleiding |
| **A1** proef op één computer met Docker | Website op `127.0.0.1`, lokale testbrievenbus (Mailpit) | **Linux** x86-64 of Windows 11 | [hieronder](#linux-server-met-docker-hoofdroute) (Linux), hoofdstuk 1 van de handleiding (Windows) |
| **A2** netwerk thuis of op de club, zonder internet | Telefoons en pc's in je eigen netwerk, begeleide installatie in de browser, inlogkaarten | Windows 11 (getest), Linux, macOS; x86-64 of arm64 | [A2-handleiding](../../../install/A2_THUIS_HANDLEIDING_NL.md) |
| **A3** één computer zonder Docker | XAMPP Apache, Node.js en een meegeleverde MariaDB | Windows 11 | hoofdstuk 2 van de handleiding |
| **B2** gedeelde webhosting | Node.js (Passenger) en MariaDB/MySQL, geen Docker of root | Een hostingpakket met SSH | hoofdstuk 4 van de handleiding |
| Vanaf de broncode | De images zelf bouwen vanuit een kloon | Linux, Windows (macOS niet getest) | [Getting started](../../../GETTING_STARTED.md) |

De handleiding is [docs/install/MK8DX_Handleiding_NL.txt](../../../install/MK8DX_Handleiding_NL.txt) (ook als Word-bestand,
en in het Engels). De hoofdstukken nemen je klik voor klik door elke route, inclusief back-ups, herstel en updates.

## Het pakket downloaden

Releasepakketten hangen aan de
[GitHub Releases](https://github.com/fromthelake/MK8DX-Ecosystem/releases) van het project. Download het pakket voor je route
en `SHA256SUMS.txt` uit dezelfde release (zie [Release packages](../../../RELEASE_PACKAGES.md)):

| Route | Pakket |
| --- | --- |
| A1, B1 | `mk8dx-host-local-…-amd64.zip` (images van website, API en database plus de startscripts) |
| A2 | `mk8dx-a2-<platform>-<arch>-….zip` (alles voor dat platform, met de begeleide installatie) |
| A3 | `mk8dx-xampp-node-windows-….zip` |
| B2 | `mk8dx-mijnhost-node-….zip` |

Controleer de checksum voordat je iets uitpakt: `sha256sum <file>` op Linux, `shasum -a 256 <file>` op macOS,
`Get-FileHash '<file>' -Algorithm SHA256` in PowerShell. Vergelijk de hele waarde met de regel in
`SHA256SUMS.txt`. **Source code (zip)** op GitHub is geen installatiepakket.

Werk je in plaats daarvan met een kloon van de repository? Bouw het hostpakket dan zelf
([hieronder](#het-hostpakket-bouwen-vanuit-een-kloon)); de A3- en B2-pakketten staan onder
[De andere routes](#de-andere-routes).

### Pakketrevisie en image-tags

De revisie in de bestandsnaam van een pakket (bijvoorbeeld `v0.1.0`) duidt dat releasepakket aan. Officiële
releasepakketten bevatten geversioneerde `ghcr.io/fromthelake/mk8dx-{api,web}:<tag>-amd64`-images. De meegeleverde startscripts
en `compose.yaml` verwijzen naar dezelfde tags. Een handmatige build vanuit een kloon zonder `--version` gebruikt nog steeds de huidige lokale
image-tags. Bij de eerste
start laadt een pakket altijd zijn eigen images, ook over oudere images met dezelfde tags heen, en noteert dat in
`images/loaded.txt`; latere starts laden ze alleen opnieuw als er een ontbreekt. Omdat je een update in een
nieuwe map uitpakt, draait die altijd de images van het nieuwe pakket. De map
waarin je uitpakt, bepaalt geen van beide: deze handleiding gebruikt `/opt/mk8dx/host`.

## Het hostpakket bouwen vanuit een kloon

Op Linux x86-64 met Git, Docker Engine en Python 3.12 of nieuwer, vanuit de hoofdmap van een verse kloon. Het pakket
heeft vier images nodig: de API- en Web-images, gebouwd uit deze broncode met de tags die de startscripts verwachten, en de
MySQL- en Mailpit-images die `compose.yaml` en `compose.local.yaml` vastleggen op tag en digest. `tooling/release/host_bundle.py
--list-images` print precies die vier tags, dus de opdrachten lezen ze uit het script; `--pull-base-images`
haalt MySQL en Mailpit op met hun vastgelegde digest en geeft ze hun tag:

```sh
git clone https://github.com/fromthelake/MK8DX-Ecosystem.git
cd MK8DX-Ecosystem
python3 tooling/assets/shared_asset_source.py verify
set -- $(python3 tooling/release/host_bundle.py --list-images)   # API, Web, MySQL, Mailpit
docker build --platform linux/amd64 -f backend/api/Dockerfile -t "$1" .
docker build --platform linux/amd64 -f apps/timetrials-web/Dockerfile -t "$2" .
python3 tooling/release/host_bundle.py --pull-base-images --arch amd64
mkdir -p "$HOME/mk8dx-packages"
python3 tooling/release/host_bundle.py --output "$HOME/mk8dx-packages/mk8dx-host-local-r0-local-amd64.zip" --revision r0-local
```

  - `--output` moet een **nieuw absoluut `.zip`-pad buiten de repository** zijn; het script weigert al het andere en
    schrijft ernaast een `.manifest.json` met de SHA-256 van het archief. `--revision` is je eigen label voor het pakket.
    Geef voor een geversioneerde releasebuild dezelfde `--version vX.Y.Z` (of `vX.Y.Z-rc.N`) mee aan `--list-images` en aan
    de pakketopdracht; daarmee komen de bijpassende GHCR-imagenamen in het archief, de startscripts en het Compose-bestand.
- Het script draait eerst `tooling/privacy_scan.py` en stopt bij een bevinding, dus bouw vanuit een schone kloon. Het
  weigert ook een lokaal MySQL- of Mailpit-image waarvan de registry-digest niet de vastgelegde is. De Compose-bestanden van het pakket
  noemen die twee images alleen op tag, omdat `docker load` geen registry-digests terugzet; het manifest legt
  de vastgelegde digests vast onder `baseImageDigests`.
- De image-builds vervangen alle images met dezelfde tags op deze machine, ook die van een geïnstalleerd
  hostpakket. Bouw op een machine waarop er geen draait, of accepteer dat die vanaf dan jouw build draait.
- Een zelfgebouwd pakket heeft geen `SHA256SUMS.txt`; vergelijk de kopie op de server in plaats daarvan met `archiveSha256` in
  het manifest. Ga daarna verder met [Installeren](#installeren) hieronder.

## Linux-server met Docker (hoofdroute)

Het hostpakket bevat kant-en-klare Linux/amd64-images en het startscript `tooling/start-mk8dx.sh`. Het draait op elke
x86-64-Linux met Docker Engine; de handleiding beschrijft Ubuntu 24.04 LTS.

### Vereisten

- Linux op x86-64 (`uname -m` print `x86_64`). Het B1-hostpakket heeft alleen amd64-images; het A2-pakket bestaat
  ook voor arm64.
- Docker Engine met de Compose-plugin (`docker compose version` werkt), Python 3.12 of nieuwer (`python3`) en
  `unzip`. Voor Ubuntu staan in het VPS-hoofdstuk van de handleiding de exacte opdrachten voor de officiële apt-repository van Docker.
- Een account dat Docker mag gebruiken (root, of lid van de groep `docker`, wat gelijkstaat aan root).
- Voor **B1** daarnaast: een domeinnaam waarvan het DNS-A-record naar de server wijst, inkomend TCP 80 en 443 open,
  en een uitgaand mailaccount met SMTP op een poort met directe TLS (465). Alleen STARTTLS op 587 past niet bij de
  wizard. Als ruime marge (geen gemeten minimum): 2 processorkernen, 8 GB RAM, 40 GB schijfruimte.
- Voor **A1** verder niets: die is alleen vanaf dezelfde computer bereikbaar en gebruikt een lokale testbrievenbus.

### Installeren

```sh
mkdir -p /opt/mk8dx/host /var/lib/mk8dx
unzip -q mk8dx-host-local-<revision>-amd64.zip -d /opt/mk8dx/host
cd /opt/mk8dx/host
ls Start-MK8DX.cmd compose.yaml tooling/start-mk8dx.sh images/docker-images-amd64.tar
sh tooling/start-mk8dx.sh /var/lib/mk8dx/instance
```

Gebruik in plaats daarvan een pad in je thuismap (bijvoorbeeld `"$HOME/MK8DX/host"` en `"$HOME/mk8dx-data"`) als je niet
als root werkt. Het tweede pad is je **privé-installatiemap**: daarin staan de sleutels, wachtwoorden en instellingen.
Die map mag nog niet bestaan en moet buiten de pakketmap liggen; de installer weigert al het andere en maakt
hem aan met modus 0700. Bewaar hem als je een nieuwer pakket installeert.

Bij de eerste start laadt het startscript de images uit `images/docker-images-amd64.tar` en start de wizard:

1. `Where will MK8DX run?` (Waar gaat MK8DX draaien?) noemt A1, A2 en B1 in gewone woorden. Typ **B1** voor een openbare website of **A1** voor een
   lokale proef. (Gebruik voor een netwerk thuis of op de club het pakket `mk8dx-a2-…`; A3 en B2 horen bij het
   pakket zonder Docker.)
2. Voor B1: je hostnaam zonder `https://`, de SMTP-server, de poort (Enter voor 465), de login, het geautoriseerde
   afzenderadres en het SMTP-wachtwoord (verborgen terwijl je typt).
3. `Your own future MK8DX administrator email:` (je eigen toekomstige beheerdersadres): het adres waarmee je je gaat aanmelden.
4. De eerste installatie start daarna vanzelf. Die start de database, voert elke migratie van de catalogus uit,
   voegt de twee referentiesets toe en start de website en de API. De eerste keer duurt een paar minuten.

Elke latere start van `sh tooling/start-mk8dx.sh <installation directory>` toont dit menu; het blijft open tot je **0** kiest:

| Keuze | Doet |
| --- | --- |
| 1 | eerste installatie, of een onderbroken installatie hervatten |
| 2 | starten |
| 3 | status (print het websiteadres en, voor A1, de lokale mailbrievenbus) en de toestand van de containers |
| 4 | stoppen (alle gegevens blijven bewaard) |
| 5 | het opgeslagen beheerdersadres de eerste beheerder maken (na de eerste aanmelding ermee) |
| 6 | back-up naar `$HOME/mk8dx-backups/<UTC time>`, meteen gecontroleerd |
| 7 | update: eerst een gecontroleerde back-up, dan de openstaande migraties, dan de nieuwe images |
| 8 | het websiteadres tonen (Windows: opent het ook) |
| 0 | afsluiten |

### Beheerder worden

1. Open het websiteadres (B1: `https://<your host name>`, A1: de `origin` die keuze 3 toont, bijvoorbeeld
   `http://127.0.0.1:18080`). Voor B1 hoort `https://<your host name>/health/ready` te antwoorden met `{"status":"ready"}`,
   zonder certificaatwaarschuwing.
2. Kies **Aanmelden**, vul het beheerdersadres uit de wizard in en volg de link in de e-mail
   (B1: je echte inbox; A1: het adres van de lokale brievenbus dat keuze 3 toont). De link opent meteen de installatie in drie stappen
   **Sta je al op deze website?**; laat de pagina helemaal laden. De beheerder heeft geen
   Player nodig, dus je kunt de vragen nu beantwoorden of voor later laten.
3. Start het startscript opnieuw en kies **5**. Je hoort `created` te zien (een herhaling zegt `unchanged`). Ververs de website:
   het accountmenu heeft nu **Beheer**.

Wie zich als eerste registreert, wordt nooit automatisch beheerder, en de stap voor de eerste beheerder
werkt maar één keer per installatie. Zie [Operations](../../../OPERATIONS.md) voor de afgebakende herstelprocedure.

### Dagelijks beheer

- **Back-ups**: keuze 6, en controleer daarna de map met
  `python3 tooling/lifecycle.py verify --backup "$HOME/mk8dx-backups/<folder>"` (je hoort `Backup verified` te zien).
  Kopieer de hele map naar beveiligde opslag buiten de server. Er zitten de database, de accounts en de sleutels in.
- **Updates**: controleer het nieuwe hostpakket en pak het uit in een nieuwe, lege map naast de oude (bijvoorbeeld
  `/opt/mk8dx/host-new`), start dan het startscript daarvan met **dezelfde** installatiemap en kies 7.
  Bewaar de oude map tot de update is gecontroleerd. De update naar 0.2.3 zet de database over van MySQL 8.4
  naar 9.7 LTS. MySQL werkt de databestanden één keer bij, bij de eerste start op de nieuwe versie, en alleen een back-up maakt
  dat ongedaan. Kies dus 7 vóór 2: 2 zou de nieuwe versie starten zonder de back-up en zonder de database-updates
  (3, controleren, kan geen kwaad).
- **Mail of adres wijzigen**: `python3 tooling/install.py change-smtp|change-origin ...`, daarna `apply` en
  `check`, vanuit de pakketmap; het instellingenhoofdstuk van de handleiding heeft de exacte opdrachten.
- **Herstellen**: `python3 tooling/lifecycle.py restore-new --backup <folder> --state-dir <new directory>` maakt uit een
  gecontroleerde back-up een aparte, nieuwe installatie; zie het back-uphoofdstuk van de handleiding.
- Draai nooit `docker compose down -v` op een installatie die je wilt houden: `-v` wist het databasevolume.
  Dat hoort alleen bij [Een installatie verwijderen](#een-installatie-verwijderen).

### Een installatie verwijderen

Om een proefinstallatie weg te gooien (of een installatie waarvan je bent overgestapt), werk je vanuit de pakketmap ervan met
dezelfde installatiemap. Dit **wist de database, de accounts en de sleutels** van die installatie;
maak eerst een back-up (keuze 6) als er iets is wat je misschien terug wilt.

1. Start het startscript en kies **3**: noteer de `route` (A1, A2 of B1). Start het daarna opnieuw en kies **4** om te stoppen.
2. Verwijder de containers, het netwerk en de volumes (de database, en voor A2/B1 de certificaten). Gebruik het
   Compose-bestand dat bij de route hoort: `compose.local.yaml` voor A1, `compose.lan.yaml` voor A2,
   `compose.production.yaml` voor B1.

   ```sh
   cd /opt/mk8dx/host
   state=/var/lib/mk8dx/instance
   docker compose --env-file "$state/compose.env" -f compose.yaml -f compose.local.yaml -f compose.images.yaml down -v
   ```

3. Verwijder de installatiemap: `rm -rf "$state"` (de map bevat sleutels en wachtwoorden; wis hem pas
   na stap 2, die zijn `compose.env` nodig heeft).
4. Verwijder de images als geen andere installatie op deze machine ze gebruikt. `PACKAGE_MANIFEST.json` in de pakketmap
   noemt ze:

   ```sh
   docker image rm $(python3 -c 'import json; print(" ".join(json.load(open("PACKAGE_MANIFEST.json"))["images"]))')
   ```

   Docker weigert een image te verwijderen dat een container nog gebruikt; `mysql` en `axllent/mailpit` kunnen ook bij
   andere projecten horen.
5. Wis de pakketmap (`/opt/mk8dx/host`) en de back-ups die je niet meer nodig hebt.

**Op Windows** (A1 of A2 met Docker Desktop) zijn de stappen hetzelfde in PowerShell. De installatiemap
is `%LOCALAPPDATA%\MK8DX\Server`, tenzij je een andere koos; open PowerShell in de uitgepakte pakketmap:

```powershell
$state = Join-Path $env:LOCALAPPDATA 'MK8DX\Server'
docker compose --env-file "$state\compose.env" -f compose.yaml -f compose.local.yaml -f compose.images.yaml down -v
Remove-Item -LiteralPath $state -Recurse -Force
docker image rm (Get-Content PACKAGE_MANIFEST.json -Raw | ConvertFrom-Json).images
```

Gebruik voor A2 `compose.lan.yaml` in plaats van `compose.local.yaml`. Wis daarna de pakketmap en de back-ups
in `Documents\MK8DX-backups` die je niet meer nodig hebt.

Een installatie die vanaf de broncode is gebouwd, verwijder je op dezelfde manier vanuit de hoofdmap van de repository; zie
[Operations](../../../OPERATIONS.md#remove-an-installation).

### Wat er op Linux getest is

- Gedemonstreerd op 2026-11-02 op een Linux-host met Docker Engine 28.5 (Alpine Linux in een geprivilegieerde Docker-in-Docker-container,
  niet Ubuntu), met een hostpakket dat vanuit deze repository is gebouwd door `tooling/release/host_bundle.py`:
  het startscript laadde de imagebundel; de wizard (A1) en keuze 1 zetten de database, migraties en
  referentiesets op; keuze 3 meldde ready; de website en `/scanner/` antwoordden; een aanmelding met een magic link in een echte
  browser, gevolgd door keuze 5, gaf `created` en daarna `unchanged`; keuze 6 maakte een back-up die
  `lifecycle.py verify` goedkeurde; keuze 7 werkte bij met een gecontroleerde back-up; en `lifecycle.py restore-new` startte
  een tweede, herstelde installatie. De [broncoderoute](../../../GETTING_STARTED.md#linux-and-macos-variant) liep op
  dezelfde host door tot en met de aanmelding en de eerste beheerder.
- Niet gedemonstreerd: B1 met een echt domein, certificaat en mailprovider, en Ubuntu zelf. Dat de containers werken,
  bewijst nog niets over DNS, TLS of de bezorging van mail: meld je aan met je eigen adres om dat te controleren.

## De andere routes

- **Windows (A1, A3)**: dubbelklik op `Start-MK8DX.cmd` (hostpakket) of `Start-MK8DX-No-Docker.cmd` (pakket
  zonder Docker) en volg hoofdstuk 1 of 2 van de handleiding.
- **Netwerk thuis of op de club (A2)**: dubbelklik op `Start-MK8DX-LAN.cmd` in het pakket `mk8dx-a2-…` (Linux en macOS:
  `sh tooling/start-mk8dx.sh`); de installatie opent in je browser. Volg de [A2-handleiding](../../../install/A2_THUIS_HANDLEIDING_NL.md).
- **Gedeelde hosting (B2)**: hoofdstuk 4 van de handleiding (uploaden via SSH, `python3 tooling/install.py wizard`,
  `setup`, `passenger-config`, en daarna de Node.js-app starten in je hostingpaneel). Elk hostingpakket met Node.js
  (Passenger), MariaDB/MySQL en SSH past; het hoofdstuk gebruikt mijn.host Starter als uitgewerkt voorbeeld. Ondanks de
  naam is `mk8dx-mijnhost-node-….zip` het pakket voor elke Node.js-host van die soort: mijn.host is het geteste voorbeeld,
  en poort 26 in de opdrachten `ssh -p 26`/`scp -P 26` is de SSH-poort van die provider, dus gebruik die van je eigen host.
- **De A3- en B2-pakketten bouwen vanuit een kloon**: `tooling/release/non_docker_bundle.py` maakt beide ZIP's, op
  Windows (het roept `npm.cmd` aan). Bouw eerst de API en de website (`npm ci` en `npm run build` met
  `--prefix backend/api` en `--prefix apps/timetrials-web`) en de browserscanner zoals in
  [Client builds](../../../CLIENT_BUILDS.md#browser-scanner-and-web-image). Draai daarna
  `python tooling/release/non_docker_bundle.py --output-dir <existing folder outside the repository>
  --mailpit-archive <Mailpit Windows amd64 ZIP> --mariadb-archive <mariadb-11.4.13-winx64.zip> --revision <r>`.
  De MariaDB-ZIP moet de officiële download van 11.4.13 zijn (het script controleert de SHA-256); de Mailpit-ZIP moet
  `mailpit.exe` en `LICENSE` bevatten.
- **macOS**: een Intel-Mac kan het A1-hostpakket proberen met Docker Desktop voor Mac en hetzelfde shell-startscript;
  Apple Silicon heeft amd64-emulatie nodig. Dit is niet getest; zie het macOS-hoofdstuk van de handleiding.
- **Vanaf de broncode**: [Getting started](../../../GETTING_STARTED.md) bouwt de images vanuit een kloon (Windows en Linux).

## Het startvenster: weergave en opties

Elk startscript opent als de start van een race: een gekleurd MK8DX-logo, aftellen 3-2-1-GO met piepjes, de controles als
rondes met een raceklok, en een finishlijn met de rondetijden. Dat geldt voor `Start-MK8DX.cmd`, `Start-MK8DX-LAN.cmd`
(ook achter het bureaubladpictogram **MK8DX beheer**), `Start-MK8DX-No-Docker.cmd` en `Manage-MK8DX-No-Docker.cmd` op
Windows, en `tooling/start-mk8dx.sh` op Linux en macOS. Alleen de weergave verschilt: de stappen, het menu en de
meldingen zijn in elke weergave hetzelfde, dus deze handleidingen gelden wat je ook ziet.

| Weergave | Wanneer |
| --- | --- |
| **Rich** (standaard) | Een terminal met moderne kleuren: Windows Terminal, de console van Windows 10/11, VS Code, of een Linux/macOS-terminal met UTF-8 en 256 kleuren (true colour bij `COLORTERM=truecolor`; macOS Terminal krijgt de dichtstbijzijnde 256 kleuren). |
| **Classic** | Een kleurenterminal zonder die mogelijkheden, of `MK8DX_RICH=0`: de banner in blokletters, startlichten en rondebalken in basiskleuren. |
| **Plain** | De uitvoer gaat naar een bestand of een ander programma, `TERM=dumb`, of je vraagt erom: alleen tekst, geen kleuren of animatie. Gebruik dit voor logs en hulpvragen. |

| Wat je wilt | Windows | Linux en macOS |
| --- | --- | --- |
| Het aftellen weglaten (dat staat standaard aan) | `Start-MK8DX.cmd -SkipCountdown` (elk van de vier `.cmd`-bestanden accepteert dit), of `MK8DX_SKIP_COUNTDOWN=1` | `sh tooling/start-mk8dx.sh --skip-countdown [installation directory]`, of `MK8DX_SKIP_COUNTDOWN=1` |
| Alleen tekst | `-Plain`, `MK8DX_PLAIN=1` of `NO_COLOR=1` | `--plain`, `MK8DX_PLAIN=1` of `NO_COLOR=1` |
| Geen geluid (dat staat standaard aan) | `MK8DX_SOUND=0` | `MK8DX_SOUND=0` |
| De weergave Rich of Classic afdwingen | `MK8DX_RICH=1` / `MK8DX_RICH=0` | `MK8DX_RICH=1` / `MK8DX_RICH=0` |
| ASCII in plaats van ronde symbolen | `MK8DX_ASCII=1` | (niet nodig) |
| Bekijken zonder iets te starten | `powershell -NoProfile -File tooling\mk8dx-ui.ps1 -Demo` | `sh tooling/mk8dx-ui.sh --demo` |

Op Windows zijn de piepjes een toon via de luidsprekers. Op Linux en macOS laat het aftellen de terminalbel klinken;
de terminal speelt die af als geluid, toont een flits of negeert hem, afhankelijk van zijn eigen instellingen.

Wil je een keuze vasthouden, zet de variabele dan één keer: op Windows `setx MK8DX_SKIP_COUNTDOWN 1` (dat geldt voor vensters die je
daarna opent), op Linux en macOS `export MK8DX_SKIP_COUNTDOWN=1` in `~/.profile`. Voor het pictogram **MK8DX beheer** kun je
ook de eigenschappen openen en ` -SkipCountdown` aan het eind van het doel toevoegen.

## Na de installatie

- Geef je spelers het exacte websiteadres. Ze melden zich aan met een e-maillink; meer is er voor de
  website niet nodig. Zie [Spelers](PLAYERS.md).
- De Android-app, LiveTrial en de toernooitools vragen één keer om dat adres. Android heeft een vertrouwd HTTPS-adres
  nodig (B1, B2, of A2 nadat de telefoon de installatie één keer is gaan vertrouwen); een lokaal A1-adres werkt alleen voor
  Windows-clients op dezelfde computer.
- De pagina **Download de app** van de website toont alleen downloads van apps als de serverbeheerder een
  downloadmap heeft ingesteld; de installer stelt er geen in. Verwijs spelers in plaats daarvan naar de GitHub-release.
- Toernooidirecteuren: een beheerder keurt hun **Verzoek om te hosten** goed of voegt ze toe onder
  Beheer → Toernooien → Directeuren. Zie [Tournament Directors](TOURNAMENT_DIRECTORS.md).
- Beheer → **Installatie-instellingen** begint met de **Communitynaam** ("Club Noord"), die de apps
  tonen in plaats van het webadres (leeg = geen naam). Daaronder staan drie keuzes voor de hele site; elke wijziging wordt
  vastgelegd met de naam van de beheerder: wie Players aanmaakt, wie meetelt voor de rating, en **Tijden uit andere
  community's**.
  Die laatste staat standaard uit: een speler die bij meerdere community's hoort, kan geen tijd meenemen die
  elders is gereden. *Met goedkeuring* houdt elke meegenomen tijd buiten de openbare weergaven tot een beheerder hem publiceert; zulke
  tijden staan onder Beheer → Tijdritten als achtergehouden, met een knop **Publiceren**. Stap je over van *Met goedkeuring* terwijl er nog meegenomen tijden wachten, dan vraagt de pagina
  of je ze allemaal wilt publiceren (of, bij overstappen naar uit, weigeren) of laten wachten. *Toegestaan* behandelt meegenomen tijden als elke
  andere inzending. Een meegenomen tijd laat altijd zien waar hij vandaan komt (ADR-0225).
- Beveiligingsproblemen: [SECURITY.md](../../../../SECURITY.md). Houd de installatiemap, back-ups en aanmeldlinks
  buiten issues.
