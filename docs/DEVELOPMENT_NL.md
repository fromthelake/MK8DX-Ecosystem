# Ontwikkelen aan MK8DX Ecosystem

[English version](DEVELOPMENT.md) · [Architectuur](architecture/COMPONENTS_NL.md) · [Testen](TESTING_NL.md)

Deze gids is voor ontwikkelaars die de broncode lezen of aanpassen. Om MK8DX te installeren en te gebruiken
neem je de [gebruikershandleiding](install/MK8DX_Handleiding_NL.txt) en een kant-en-klaar releasepakket.

## Benodigdheden

- Git.
- Node.js 24 voor website, API, browserscanner en het TypeScript-deel van de centrale lezer (CI gebruikt
  24.12.0, zie `.nvmrc`).
- Python 3.12 voor tooling, de Python-implementatie van de centrale lezer, LiveTrial en de toernooitools (zie
  `.python-version`). Gebruik op macOS of Linux `python3` waar hieronder `python` staat.
- Docker met Linux-containers voor de lokale serverroute.
- De Android SDK (compileerplatform 37) en JDK alleen voor de Android-app; zie [Client builds](CLIENT_BUILDS.md). `targetSdk` is een afzonderlijke instelling.

Installatie per besturingssysteem (Windows met `core.longpaths`, Ubuntu met apt, macOS met Homebrew) staat in de
[Engelse versie](DEVELOPMENT.md#requirements). De macOS-stappen zijn niet getest: er was geen Mac beschikbaar.

## Clonen en controleren

```sh
git clone https://github.com/fromthelake/MK8DX-Ecosystem.git
cd MK8DX-Ecosystem
python tooling/assets/shared_asset_source.py verify
```

`verify` controleert elk object van de interne assetcollectie tegen het manifest. Het scannermodel is groter
dan GitHubs limiet van 100 MiB per bestand en staat als twee delen in Git (`<sha>.part1`, `.part2`); `verify` en
de buildtools voegen ze bij het eerste gebruik samen. Git LFS is niet nodig, en GitHubs automatische
**Source code (zip)** is ook volledig.

Installeer daarna de vastgepinde Python-testpakketten in een virtuele omgeving:

```sh
python -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.txt
```

Op Windows is de interpreter `.venv\Scripts\python.exe`. De `python`-opdrachten in deze documenten en in
[Testen](TESTING_NL.md) gaan uit van deze actieve omgeving: voer in elke nieuwe terminal
`source .venv/bin/activate` uit (Linux, macOS; Git Bash: `source .venv/Scripts/activate`) of
`.venv\Scripts\Activate.ps1` (PowerShell), of typ het pad van de interpreter in plaats van `python`. `.gitattributes` houdt elk bestand byte-gelijk aan de
commit, ook met `core.autocrlf`: migraties, collectie en testset worden op hash gecontroleerd.

Een installatie bewaart accounts, database, sleutels, backups en clientwachtrijen in een gegevensmap
**buiten** de repository; `tooling/install.py` weigert een gegevensmap daarbinnen.

## Vind de code die bij je wijziging hoort

Het [architectuuroverzicht](architecture/COMPONENTS_NL.md) koppelt elke verantwoordelijkheid aan een map; lees
daarna de README van die component. Het [componentenregister](../component-registry.json) noemt afhankelijkheden
en omgekeerde gebruikers, [compatibility.json](../compatibility.json) de samenhangende API-, migratie- en
assetversies. `python tooling/check_boundaries.py` bewaakt de importregels tussen componenten.
Commentaar dat `ADR-NNNN`, `docs/design-system/` of `apps/tournament-manager` noemt, verwijst naar
maintainergeschiedenis buiten deze repository; de code en tests zijn de referentie
([waarom](architecture/COMPONENTS_NL.md#verwijzingen-in-codecommentaar)).

Grenzen om rekening mee te houden:

- De **API** beslist over aanmelden, validatie, acceptatie en publicatie. Clients stellen alleen uitslagen voor.
- **Databasemigraties** zijn alleen-toevoegen en met een hash vastgelegd in
  `infrastructure/mysql/migration-catalog-v1.json`. Referentiegegevens veranderen via een nieuwe seedversie,
  nooit bij het opstarten.
- De **centrale lezer** (`packages/icon-matcher/`) heeft een Python-, TypeScript- en Java-implementatie. Een
  wijziging in de ene vraagt dezelfde wijziging in de andere en opnieuw gegenereerde pariteitsvectoren.
  De [pijplijnkaart](architecture/RECOGNITION_PIPELINE_NL.md) beschrijft de echte app-adapters en pakketgrenzen;
  de README legt de lezer zelf uit.
- Gedeelde contracten in `packages/domain/` (JSON Schema) en regels in `packages/time-trial-rules/` hebben
  gebruikers in de API, website en clients. Controleer ze allemaal.

## Een wijziging maken

1. Maak een branch: `git switch -c fix/korte-omschrijving`.
2. Wijzig de bron in de component die het gedrag bezit.
3. Draai de controles voor de geraakte componenten uit [Testen](TESTING_NL.md), inclusief omgekeerde
   gebruikers van een gedeeld contract of asset.
4. Draai de repositorycontroles:

   ```sh
   python tooling/privacy_scan.py
   python tooling/check_boundaries.py
   python tooling/check_docs.py
   git diff --check
   ```

5. Voeg alleen de bedoelde paden toe, bekijk `git diff --cached`, commit, en open een pull request zoals
   [Contributing](../CONTRIBUTING.md) beschrijft.

Commit nooit installatiemappen, `secrets.json`, `.env`-bestanden, databases, backups, opnames, logs of
persoonsgegevens. Voeg een `.gitignore`-regel toe als een programma lokale bestanden maakt.

## UI-teksten en vertalingen wijzigen

Engels is overal de brontekst en de sleutel; Engels (VK) en Nederlands staan in de code en zijn nagekeken. De
andere 13 speltalen komen uit vertaalcatalogi.

- Website (`apps/timetrials-web`): nieuwe of gewijzigde tekst staat inline als
  `localized("English", "Nederlands")` (`src/product-language.ts`). `src/dutch-ui-copy.ts` vertaalt Engels dat
  zonder `localized` op de pagina komt (gedeelde labels, `title`/`aria-label`); gebruik voor nieuwe tekst liever
  `localized`.
- `i18n/messages.source.json` is **gegenereerd** door een extractor (`tooling/i18n/extract_web_messages.mjs`);
  niet met de hand wijzigen. CI draait de extractor met `--check` en faalt als het bestand niet bij de code past.
- Vertalers werken in `i18n/translations/<taal>.json` (tien bestanden; Engelse tekst → vertaling, placeholders
  zoals `{0}` ongewijzigd). Deze bestanden gelden voor alle producten. **Elke Engelse tekst heeft in elk van de
  tien bestanden een regel nodig**, dus een nieuwe of gewijzigde Engelse tekst geeft tien nieuwe regels.
- Een catalogusbouwer (`tooling/i18n/build_web_catalogs.mjs`) maakt daaruit `styles/i18n-<taal>-<hash>.json` en
  `src/i18n-catalog-index.generated.ts`, en de catalogi van Android (`app/src/main/assets/i18n/`), LiveTrial
  (`dashboard/i18n/`) en Tournament Live (`src/live_processor/i18n/`). Android gebruikt
  `androidText(language, "English", "Nederlands")`; LiveTrial en Tournament Live hebben Engels → Nederlands-tabellen
  in hun bron.

De Web-catalogi opnieuw bouwen na een gewijzigde tekst of vertaling:

```sh
npm ci --prefix tooling/i18n
node tooling/i18n/extract_web_messages.mjs                       # vernieuwt i18n/messages.source.json
node tooling/assets/materialize_collection.mjs schema9 <nieuwe absolute map>   # de spelnamen (Clean Assets)
node tooling/i18n/build_web_catalogs.mjs --clean-assets <die map>/database.json --fill-missing
```

`--fill-missing` zet elke nieuwe Engelse tekst in de tien vertaalbestanden met het Engels als tijdelijke tekst;
die talen tonen hem in het Engels tot iemand hem vertaalt. Vertaal ze als je kunt (een machinevertaling mag; de
bestanden blijven `reviewed: false`) of laat ze voor een vertaler. Zonder de vlag noemt de bouwer elke ontbrekende
tekst als probleem. Hij meldt `"problemCount": 0` als elke catalogus elke tekst dekt; dan slaagt ook
`npm test --prefix apps/timetrials-web`. Commit in een pull request de gewijzigde brontekst samen met
`messages.source.json`, de vertaalbestanden en de opnieuw gebouwde catalogi. De Android- en desktop-extractors
(`extract_android_messages.py`, `extract_desktop_messages.py`) werken zo voor hun catalogi.

## Lokaal draaien

- Website, API en database met Docker vanuit de bron: [Getting started](GETTING_STARTED.md) (Engels).
- Hetzelfde met de meegeleverde assetcollectie en de browserscanner: [Local preview](LOCAL_PREVIEW.md).
- Android-, LiveTrial- en toernooipakketten: [Client builds](CLIENT_BUILDS.md).

De kant-en-klare Docker-images zijn Linux/amd64 (de arm64-A2-pakketten hebben eigen arm64-images). De native clientpakketten zijn voor Windows; een macOS- of
Linux-build van de clients bestaat nog niet.

## Problemen oplossen

- **Git Bash** herschrijft argumenten die met `/` beginnen (`/app/operator-command.sh`): zet
  `MSYS_NO_PATHCONV=1` voor de opdracht of gebruik PowerShell.
- **Windows `Filename too long`**: `git config --global core.longpaths true` en een korte clonemap.
- **LiveTrial-tests** vragen `PYTHONPATH=apps/timetrials-desktop`; één test verwacht Windows-paden.
- **Eerste beheerder geweigerd** na de magic link: open de website na de link één keer in dezelfde browser en
  draai de opdracht opnieuw met exact hetzelfde adres en dezelfde `compose.env`.
- **Linux `cp: cannot open '/run/mk8dx/operator.json': Permission denied`**: een installatiemap van een oudere
  installer; elke `tooling/install.py`-opdracht herstelt dit, of `chmod 644 "$state/operator.json"`.
- **`port is already allocated`**: een ander programma nam de poort; kies een andere met
  `python tooling/install.py change-origin --state-dir "$state" --origin http://127.0.0.1:<vrije poort>`.

Meer in de [tabel in de Engelse versie](DEVELOPMENT.md#troubleshooting).

## Releasepakketten

Het volledige bronarchief wordt vanuit een schone, gecontroleerde commit gemaakt met
`python tooling/release/full_archive.py --output <nieuw pad buiten de repository>`. Het bevat de gevolgde bron
en de volledige assetcollectie, zonder Git-geschiedenis of installatiegegevens. Host- en clientpakketten hebben
eigen bouwrecepten. Zie [Release packages](RELEASE_PACKAGES.md).

## Coding agents

[AGENTS.md](../AGENTS.md) is de gezamenlijke instructie voor coding agents; `CLAUDE.md` en `GEMINI.md`
importeren die. Controleer of jouw agent hem echt geladen heeft.
