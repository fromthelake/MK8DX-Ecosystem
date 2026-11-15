# Dagelijks beheer, updates en herstel

English: [ADMINISTRATION_EN.md](ADMINISTRATION_EN.md)

Gebruik telkens **dezelfde private gegevensmap**. Op Windows A1 is dat standaard `%LOCALAPPDATA%\MK8DX\Server`, op A2 de aparte `LAN`-map uit de gids, op B1 `/var/lib/mk8dx/instance`. Een map met alleen software is vervangbaar; de gegevensmap en het Docker-volume zijn dat niet. Menu **3 status** toont route/adres/project zonder geheimen. `docker compose down -v` is geen stopcommando: `-v` verwijdert de databasevolume.

## Stoppen, starten en controleren

**Windows:** open Docker Desktop, ga in Verkenner naar de uitgepakte hostmap, dubbelklik `Start-MK8DX.cmd` (A1) of `Start-MK8DX-LAN.cmd` (A2). Kies **2** voor start, **3** voor status, **4** voor stop. **Je ziet:** dezelfde `project`-identiteit, geen nieuwe installatiewizard. **Als het afwijkt:** controleer Docker Desktop en de juiste gegevensmap; maak geen nieuwe map om een poort-/mailfout te omzeilen.

**Ubuntu VPS:** verbind zoals in [B1](B1_VPS.md), voer `cd /opt/mk8dx/host` uit en `sh tooling/start-mk8dx.sh /var/lib/mk8dx/instance`; kies hetzelfde menu. **Je ziet:** het bestaande project. Als de server herstart, starten containers met `restart: unless-stopped` na Docker; controleer nog steeds website, mail en opslag. Een laptop in slaapstand of een uitgeschakelde VPS is tijdelijk niet bereikbaar.

## Het startvenster: weergave en opties

Elk startvenster opent als de start van een race: een gekleurd MK8DX-logo, aftellen 3-2-1-GO met piepjes, de
controles als ronden met een raceklok en een finish met de rondetijden. Dat geldt voor `Start-MK8DX.cmd`,
`Start-MK8DX-LAN.cmd` (ook achter het bureaubladpictogram **MK8DX beheer**), `Start-MK8DX-No-Docker.cmd`,
`Manage-MK8DX-No-Docker.cmd` en `tooling/start-mk8dx.sh`. Alleen de weergave verschilt; stappen, menu en meldingen
zijn hetzelfde. In een terminal met moderne kleuren (Windows Terminal, de Windows 10/11-console, een Linux/macOS-
terminal met UTF-8 en 256 kleuren) is de rijke weergave standaard aan, met geluid. Gaat de uitvoer naar een bestand,
dan krijg je gewone tekst.

| Wat je wilt | Windows | Linux en macOS |
| --- | --- | --- |
| Aftellen overslaan (standaard staat het aan) | `Start-MK8DX.cmd -SkipCountdown` (alle vier de `.cmd`-bestanden), of `MK8DX_SKIP_COUNTDOWN=1` | `sh tooling/start-mk8dx.sh --skip-countdown [installatiemap]`, of `MK8DX_SKIP_COUNTDOWN=1` |
| Gewone tekst | `-Plain`, `MK8DX_PLAIN=1` of `NO_COLOR=1` | `--plain`, `MK8DX_PLAIN=1` of `NO_COLOR=1` |
| Zonder geluid (standaard aan) | `MK8DX_SOUND=0` | `MK8DX_SOUND=0` |
| Rijke of klassieke weergave afdwingen | `MK8DX_RICH=1` / `MK8DX_RICH=0` | `MK8DX_RICH=1` / `MK8DX_RICH=0` |
| Bekijken zonder iets te starten | `powershell -NoProfile -File tooling\mk8dx-ui.ps1 -Demo` | `sh tooling/mk8dx-ui.sh --demo` |

Een keuze bewaren: Windows `setx MK8DX_SKIP_COUNTDOWN 1` (geldt voor vensters die je daarna opent), Linux/macOS
`export MK8DX_SKIP_COUNTDOWN=1` in `~/.profile`. Bij het pictogram **MK8DX beheer** kun je ook in de eigenschappen
` -SkipCountdown` achter het doel zetten. Op Linux en macOS is het geluid de terminalbel; de terminal bepaalt of je
die hoort.

## Private backup: maak, controleer, kopieer weg

**Waar:** in hetzelfde menu, kies **6**. De helper gebruikt het opgeslagen profiel en maakt een nieuw backupmapje met een MySQL-dump, runtimeconfig, secrets en een manifest met SHA-256. Windows schrijft onder `Documenten\MK8DX-backups\<tijdstip>`, Ubuntu onder `~/mk8dx-backups/<tijdstip>`. **Je ziet:** `Backup complete`. Controleer een backup op Windows in PowerShell:

```powershell
python tooling/lifecycle.py verify --backup "$env:USERPROFILE\Documents\MK8DX-backups\<ECHTE_MAPNAAM>"
```

Vervang `<ECHTE_MAPNAAM>` door de werkelijk aangemaakte mapnaam; gebruik de complete map, niet alleen het `.gz`-bestand. Op Ubuntu is het equivalent `python3 tooling/lifecycle.py verify --backup '/root/mk8dx-backups/<ECHTE_MAPNAAM>'`. **Je ziet:** `Backup verified` met route A1/A2/B1. **Als het afwijkt:** bewaar de mislukte kopie privé, maak een nieuwe backup en onderzoek de fout voordat je bijwerkt. Bewaar daarnaast een kopie op een ander, beschermd medium; een backup op dezelfde kapotte VPS is geen herstelplan. De backup bevat accounts, database, adminstatus en alle sleutels; deel hem nooit in een issue, e-mail of openbare cloudlink. De Caddy-certificaatvolume blijft bij normale updates op dezelfde host bestaan; een apart hersteld B1-project vraagt bij het uiteindelijke DNS-cutover een nieuw certificaat aan.

## Automatische dagelijkse back-up

**Wat:** elke nacht (03:15, ingehaald na een gemiste nacht) maakt MK8DX vanzelf dezelfde back-up als menu 6,
controleert hem en bewaart de nieuwste van elk van 14 dagen en 4 weken, samen hooguit 10 GB (B2: 1 GB). Hij staat
aan voor A1, A3 en B1 na de eerste setup; B2 vraagt het. Windows gebruikt een taak in Taakplanner voor jouw account
("MK8DX automatic backup …"), Ubuntu/B2 één gemarkeerde regel in je crontab. **Waar:**
`Documents\MK8DX-backups\automatic` op Windows, `~/mk8dx-backups/automatic` op Linux. **Je ziet:** **3**
(controleren) of `python tooling/install.py backup-status --state-dir <installatie>` toont `lastResult`,
`lastSuccessAgeHours` en de nieuwste map; `stale: true` betekent 36 uur niets gelukt. **Wijkt het af:** een
mislukte nacht laat elke oudere back-up staan; lees `lastMessage` (bijvoorbeeld "database is not running"), los het
op en draai één keer met de hand `backup-run`.

**Buiten de host:** voeg een tweede map op een andere schijf of NAS toe met `backup-schedule --copy-to <map>`, of
haal de nieuwste vanaf je pc op met `backup-latest --print-path` en `scp`. Herstellen gaat met de gewone
herstelopdrachten hieronder op die map. Uitzetten met `backup-unschedule`; een installatie verwijderen begint
daarmee. Alle opties, afsluitcodes en versleuteling: [Beheer en updates](../OPERATIONS_NL.md#automatische-dagelijkse-back-up-a1-a2-b1-a3-b2).

## Herstellen zonder de huidige installatie te wissen

**Doel:** controleer een backup in een **nieuwe** gegevensmap en met een **nieuw** Docker-project. De helper weigert een bestaande doelmap. Op Windows, in PowerShell vanuit het hostpakket:

```powershell
python tooling/lifecycle.py restore-new --backup "$env:USERPROFILE\Documents\MK8DX-backups\<ECHTE_MAPNAAM>" --state-dir (Join-Path $env:LOCALAPPDATA 'MK8DX\Herstelproef')
python tooling/install.py status --state-dir (Join-Path $env:LOCALAPPDATA 'MK8DX\Herstelproef')
```

**Je ziet:** geverifieerde bestanden, geïmporteerde database en een **ander** project. A1 krijgt vrije nieuwe loopbackpoorten; B1/A2 bewaart het bedoelde HTTPS-adres, maar start in deze proef alleen MySQL, niet de publieke gateway. Zo ontstaat geen onverwachte tweede live site of certificaataanvraag. De oorspronkelijke containers, accounts en volumes blijven staan. **Als het afwijkt:** start niet met wissen of `down -v`; controleer checksum, vrije schijfruimte en of de nieuwe doelmap echt nog niet bestond. Op Ubuntu vervang je `python` door `python3`, backup- en doelpad door `/root/mk8dx-backups/<ECHTE_MAPNAAM>` en `/var/lib/mk8dx/herstelproef`. Een daadwerkelijke vervanging van een publieke site vraagt daarna een geplande DNS-/poort-/certificaatcutover; voer die pas uit nadat de eigenaar de herstelde data heeft gecontroleerd.

## Een nieuwe softwareversie installeren

**Waar:** op de host. **Doe:** controleer de SHA-256 van het **nieuwe** hostpakket, pak het naast de oude softwaremap uit, houd de bestaande gegevensmap/volumes intact. Start het nieuwe pakket met dezelfde `-StateDir` (Windows) of hetzelfde enige padargument (Ubuntu). Kies **7 update**. De helper maakt eerst een nieuwe backup en controleert hem, voert daarna alleen nog ontbrekende canonieke migraties en idempotente referentieseeds uit, en vervangt API/Web-containers door de meegeleverde versie-images. **Je ziet:** dezelfde projectnaam, dezelfde accounts en admin, en daarna een gezonde website. **Als het afwijkt:** bewaar de gemaakte backup, leg de fout vast zonder geheimen, en herstel zo nodig naar een apart doel. Draai niet blind een oudere image terug nadat het schema is veranderd. Een gewijzigde SMTP-provider of domein wordt via de [instellingenwijzer](INSTELLINGEN.md) behandeld, niet door een `.env`-regel in elk pakket te wijzigen.

**Update naar 0.2.3:** deze versie zet de Docker-database over van MySQL 8.4 naar MySQL 9.7 LTS. MySQL zet de gegevensbestanden één keer om bij de eerste start op de nieuwe versie; dat maak je alleen ongedaan met een backup. Kies in de nieuwe pakketmap daarom eerst **7** (update): die maakt een gecontroleerde backup en voert de database-updates uit. Vanaf 0.2.4 weigert **2** (starten) tot de update gedraaid heeft; met een 0.2.3-pakket zou 2 de backup overslaan. Menu **3** (controleren) kan geen kwaad. Bij het A2-pakket maakt **Bijwerken** in de browser vanzelf eerst de backup.

**Update naar de volgende release (na 0.2.4):** menu **7** past de database-updates 0092 en 0095 toe en geeft de website een eigen databaseaccount dat alleen rijen kan lezen en schrijven; start de website daarmee niet, dan gaat de update vanzelf terug naar het vorige account ([databaseaccounts](../OPERATIONS_NL.md#databaseaccounts)). Controleer daarna dat aanmeldmail aankomt: gevaarlijke beheeracties en de accountlijst vragen nu om een nieuwe e-maillink (zie *Admin en problemen* hieronder). De automatische dagelijkse back-up blijft zoals hij was. Nieuwe ingebouwde grenzen tegen overspoeling vragen geen instelling; een `MK8DX_HOSTED_BUDGET_*`-waarde die je toevoegt moet een bekende naam hebben ([instellingengids](INSTELLINGEN.md)).

## Admin en problemen

Onder Beheer → **Installatie-instellingen** staat bovenaan de **Communitynaam** (bijvoorbeeld "Club Noord"), die de apps tonen in plaats van het webadres (leeg = geen naam). Daaronder staan drie keuzes voor de hele site, elke wijziging vastgelegd met de naam van de beheerder: wie spelers aanmaakt, wie meetelt voor de rating en **tijden uit andere community's**. Die laatste staat standaard uit: een speler die bij meerdere community's hoort, kan dan geen elders gezette tijd meenemen. Bij *Met goedkeuring* blijft elke meegenomen tijd buiten de openbare overzichten tot een beheerder hem openbaar maakt; zulke tijden staan onder Beheer → Tijdritten als niet openbaar, met een knop **Publiceren**. Zet je *Met goedkeuring* uit terwijl er nog meegenomen tijden wachten, dan vraagt de pagina of je ze allemaal publiceert (of bij *Uit*: weigert) of laat wachten. Bij *Toegestaan* volgt een meegenomen tijd de gewone publicatieregels. Een meegenomen tijd laat altijd zien waar hij vandaan komt (ADR-0225).

De adminactie (menu **5**) werkt pas na aanmelding via de geverifieerde magic link voor het opgeslagen eigen doeladres. De gewone eerste registratie geeft nooit een rol. Als het adminadres vóór de eerste toekenning fout was, stel de doelidentiteit veilig bij met `python tooling/install.py set-admin-email --state-dir '<jouw gegevensmap>' --admin-email 'eigenadres@example.org'`, meld met precies dat adres aan en kies daarna menu 5. Een al gebruikte bootstrap wordt niet heropend; de bestaande begrensde administrator-recovery uit [Operations NL](../OPERATIONS_NL.md) vereist een expliciet geverifieerd doelaccount en eigenaarbesluit.

**Gevaarlijke acties bevestigen per e-mail.** Beheerders-, directeurs- of verslagrechten wijzigen, een account rechtstreeks aan een speler koppelen, de installatie-instellingen, ratings herberekenen, een avond weghalen, heropenen of terugzetten, en de lijst met alle accounts openen vragen eerst **Bevestig met een nieuwe e-maillink** → **Stuur de link**. De link gaat naar je eigen adres (A1: de Mailpit-inbox) en bevestigt deze browser of app voor 10 minuten. Komt de mail niet aan omdat e-mail niet werkt, druk dan toch op **Stuur de link** en draai binnen 10 minuten op de host `python tooling/install.py step-up-link --state-dir '<jouw gegevensmap>'`; open de link die het toont en druk op **Deze actie bevestigen** ([details](../OPERATIONS_NL.md#als-e-mail-niet-werkt-een-gevaarlijke-actie-bevestigen-vanaf-de-server)). A2 offline verstuurt geen mail en vraagt er niet om.

Een homepage zonder aanmeldmail is meestal een SMTP-probleem; A1 heeft alleen Mailpit op de host, A2/B1 echte mail. `/.well-known/assetlinks.json` moet `application/json` met `[]` (of later een correct eigen association-document) leveren, geen HTML. `/client-config.json` moet alleen het publieke serveradres tonen. `/health/ready` controleert API/database, maar bewijst geen inboxbezorging of fysieke clientverbinding. Kijk bij een fout eerst in de veilige menu-status en de toepasselijke routegids. Deel nooit private env/config/logregels met tokens of wachtwoorden.
