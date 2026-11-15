# Operations — install, beheer, backup en herstel

Met een kant-en-klaar hostpakket gebruik je het startmenu en de [handleiding](install/MK8DX_Handleiding_NL.txt) (hoofdstukken over backup, herstel en updates) en [Beheer](install/BEHEER.md). Deze pagina bevat de onderliggende opdrachten voor installaties die vanuit de bron zijn gebouwd.

Deze instructies zijn voor een nieuwe installatie in een eigen Docker-project. De installer maakt unieke sleutels, een MySQL-wachtwoord en een projectnaam aan. Hij weigert een bestaande installatiemap en vervangt nooit sleutels. De map bevat credentials; bewaar haar buiten Git en deel haar niet.

## Lokale eerste installatie

Zet eerst `$state` op je privé-installatiemap buiten de repository, bijvoorbeeld `$state = "$env:LOCALAPPDATA\MK8DX\Dev"`.

Gebruik de opdrachten uit [Aan de slag](GETTING_STARTED.md) (Engels). `config --quiet` moet slagen vóór `up`; bekijk bij een eigen locatie de opgeloste services, build-contexten, mounts en poorten. Alleen de Webgateway en Mailpit krijgen loopbackpoorten. De API en database hebben geen hostpoort. De Web- en Mailpit-URL komen uit `tooling/install.py`; de standaardvrije poorten begonnen in de lokale proef bij 18080 en 18025, maar een andere machine kan andere kiezen.

De volgorde is: installatiemap maken → images bouwen → MySQL/Mailpit starten → alle migraties uit de catalogus (75 in deze versie) op een **lege** database toepassen → de 192 Staff- en 192 World Records-referenties zaaien → API/Web starten. `--fresh-empty-database` weigert een niet-lege onbekende database en weigert een latere schema-upgrade zonder backup. Een gewone herhaling zonder nieuwe migraties blijft ongewijzigd.

Open de Web-URL. De e-maillink verschijnt in Mailpit. Na de eerste geverifieerde aanmelding voer je de eerstebeheerder-opdracht uit stap 8 van [Aan de slag](GETTING_STARTED.md#8-sign-in-and-become-the-first-administrator) uit met het exacte adres via stdin. De installer kiest nooit de eerste willekeurige gebruiker. Herhaal dezelfde opdracht alleen ter controle; een tweede doelaccount wordt niet als bootstrapbeheerder toegelaten. Beheerderstoegang in de browser verschijnt na opnieuw aanmelden of verversen.

Een Player-profiel is niet nodig voor beheerderstoegang; het is alleen nodig om zelf een Time Trial te plaatsen. Als de eenmalige bootstrap al door een tijdelijk testaccount is gebruikt, meld je eerst met je eigen adres aan via de gewone magic link. Voer daarna vanuit de repository-root uit:

```powershell
'<EIGEN_GEVERIFIEERD_EMAILADRES>' | docker compose --env-file "$state\compose.env" -f compose.yaml -f compose.local.yaml run -T --rm --no-deps api sh /app/operator-command.sh dist/administration/administrator-recovery-main.js --email-stdin --confirm-existing-bootstrap
```

Vervang het invulveld door precies dat geverifieerde adres en gebruik het `compose.env`-pad van de bestaande installatie. Deze operator-CLI voegt via het bestaande beheerdersmodel één gecontroleerde toekenning toe; zij verwijdert de testbeheerder, accounts of resultaten niet. Herhaling voor hetzelfde doel meldt `unchanged`; een ander doel wordt daarna geweigerd. Ververs de browser of meld je opnieuw aan. De gewone eerste aanmelding verleent nooit automatisch beheerderrechten.

Controleer de services:

```powershell
docker compose --env-file "$state\compose.env" -f compose.yaml -f compose.local.yaml ps
Invoke-RestMethod <web-origin>/health/ready
```

Stop/start zonder database te wissen:

```powershell
docker compose --env-file "$state\compose.env" -f compose.yaml -f compose.local.yaml stop
docker compose --env-file "$state\compose.env" -f compose.yaml -f compose.local.yaml start
```

Gebruik nooit `down -v` voor een normale stop, herstart of update. De database zit in de projectgebonden Docker-volume. De lokale Mailpit-inbox is een testinstrument, geen herstelbron.

## Backup en herstel

Maak vóór een upgrade een nieuwe private backupmap buiten de bronboom. Deze bevat gecomprimeerde SQL, de installatiesleutels/configuratie en SHA-256-controles. Bescherm of versleutel deze map volgens het beleid van je machine; verlies van de sleutels kan bestaande beschermde waarden onleesbaar maken.

```powershell
python tooling/lifecycle.py backup --state-dir $state --output ..\mk8dx-backup-20260930
python tooling/lifecycle.py restore-new --backup ..\mk8dx-backup-20260930 --state-dir ..\mk8dx-restore-20260930
```

`restore-new` controleert alle hashes, weigert een bestaande doelmap, maakt een ander Compose-project met vrije loopbackpoorten en herstelt MySQL. Hij raakt de oorspronkelijke installatie niet. Daarna kun je in de herstelde installatiemap dezelfde API/Web/Mailpit-images bouwen/starten met `--env-file ..\mk8dx-restore-20260930\compose.env` en de lokale twee Compose-bestanden. De migratie- en seed-CLI moeten dan 0 nieuwe migraties en `unchanged` melden. Meld je opnieuw aan om het herstelde account en de rechten te controleren. Een mislukte herstelmap is alleen taakdata; onderzoek die voordat je een nieuwe doelmap kiest.

De lokale route heeft geen apart mediavolume. Optionele private app-downloads en recognition-media worden niet geconfigureerd of geback-upt door deze lokale route. Productiebackups moeten voor iedere later toegevoegde mediaopslag worden uitgebreid.

## Automatische dagelijkse back-up (A1, A2, B1, A3, B2)

Elke route behalve A2 offline (die heeft een eigen verzegelde nachtelijke back-up in MK8DX beheer) krijgt één
geplande opdracht, `python tooling/install.py backup-run --state-dir <installatie>`. Die maakt de gewone back-up
van de route (dezelfde dump-opties en privébestanden als `lifecycle.py backup` / `install.py backup`, dus de
gewone herstelopdrachten nemen hem aan), controleert hem met de herstelcontroles (SHA-256 van elk bestand, de dump
pakt uit) en hernoemt hem pas daarna van een verborgen map `.partial-…` naar `<project>-<UTC-datum>-<tijd>`. Een
mislukte of niet-gecontroleerde run verwijdert alleen zijn eigen halve map en laat elke oudere back-up staan.

| | A1 / A3 (Windows) | A1 (Linux/macOS-desktop) | B1 (VPS) | B2 (gedeelde hosting) |
| --- | --- | --- | --- | --- |
| Planner | Taakplanner, huidige gebruiker, haalt een gemiste nacht in | systemd-gebruikerstimer / launchd | crontab van de gebruiker | één gemarkeerde regel in de crontab van de gebruiker |
| Standaard | aan | aan | aan | gevraagd bij de setup, standaard ja |
| Map | `Documents\MK8DX-backups\automatic` | `~/mk8dx-backups/automatic` | `~/mk8dx-backups/automatic` | `~/mk8dx-backups/automatic` (buiten `public_html`) |
| Grootte-grens | 10 GiB | 10 GiB | 10 GiB | 1 GiB |

`setup` zet hem aan (B2 alleen als de setupvraag met ja is beantwoord; `--no-auto-backup` bij `wizard`, `init` of
`setup` laat hem uit); `upgrade` vanuit een nieuwe pakketmap laat de planning naar die map wijzen. A3 start voor de
back-up zijn eigen MariaDB als MK8DX niet draait en stopt hem daarna weer. A1/B1 hebben de draaiende
databasecontainer nodig (op Windows wacht de taak tot 15 minuten op Docker Desktop); anders mislukt de run met een
duidelijke melding en blijft de vorige back-up de nieuwste.

Bewaren: de nieuwste back-up van elk van de laatste 14 dagen, plus de nieuwste van elk van de 4 ISO-weken
daarvoor; daarna vallen de oudste af tot het totaal binnen de grootte-grens past. De nieuwste gecontroleerde
back-up wordt nooit verwijderd, ook niet als hij alleen al groter is. Back-upmappen zijn alleen voor de eigenaar
(0700/0600; op Windows staan alleen deze gebruiker, SYSTEM en Administrators in de toegangslijst). Een run
controleert eerst of er ongeveer twee keer de vorige back-up vrij is.

```sh
python3 tooling/install.py backup-status --state-dir <installatie>    # aan/uit, laatste resultaat, leeftijd in uren
python3 tooling/install.py backup-run --state-dir <installatie>       # nu één run
python3 tooling/install.py backup-latest --state-dir <installatie> --print-path
python3 tooling/install.py backup-schedule --state-dir <installatie> [--backup-root MAP] [--copy-to MAP]
        [--backup-time 03:15] [--keep-daily 14] [--keep-weekly 4] [--max-backup-mb 10240] [--encrypt-backups]
python3 tooling/install.py backup-unschedule --state-dir <installatie>  # verwijdert taak/timer/cronregel
```

`install.py status` (menu 3, controleren) toont dezelfde samenvatting onder `automaticBackup`; `stale: true`
betekent geen geslaagde back-up in de laatste 36 uur. Afsluitcodes van `backup-run`: 0 in orde, 1 back-up
mislukt, 2 controle mislukt, 3 back-up in orde maar kopie mislukt, 4 er loopt al een run, 5 te weinig schijfruimte
of quotum. Een cronrun drukt alleen fouten af, dus een gedeelde host mailt je precies die.

**Crontab (B1/B2).** De regel eindigt op `# mk8dx-auto-backup:<id>` en neemt het `PATH` mee van de shell waarin
`setup` draaide (zo worden Node en `mariadb-dump` van een geactiveerde Node-omgeving gevonden). Installeren en
verwijderen herschrijven alleen die regel; alle andere regels blijven in volgorde staan. De melding en de
64-teken-hash die DirectAdmin-achtige hosts bij `crontab -l` tonen, zijn geen crontabregels en worden niet
teruggeschreven. Controleer met `crontab -l`.

**Een kopie buiten de host.** Een back-up op dezelfde schijf overleeft geen kapotte schijf, server of
hostingaccount. Kies op Windows een tweede map op een andere schijf of een NAS (gebruik een pad
`\\server\share\map`; de taak draait als jij, maar netwerkschijfletters ontbreken daar soms):
`backup-schedule --copy-to '\\nas\mk8dx'`. Elke gecontroleerde back-up wordt gekopieerd, opnieuw gecontroleerd en
met dezelfde bewaarregels bewaard. Haal bij B1/B2 de nieuwste gecontroleerde back-up op vanaf je eigen pc (Windows
heeft `scp` ingebouwd; gebruik de SSH-poort van je host):

```sh
latest=$(ssh -p 26 user@host 'cd ~/apps/mk8dx && python3 tooling/install.py backup-latest --state-dir ~/mk8dx-private --print-path')
scp -P 26 -r "user@host:$latest" ./mk8dx-offsite/
# of, met rsync aan beide kanten: rsync -a -e 'ssh -p 26' "user@host:$latest" ./mk8dx-offsite/
```

**Versleuteling (optioneel).** `--encrypt-backups` verzegelt elke back-up (AES-256-GCM met een scrypt-sleutel uit
een herstelcode, zoals A2 offline). De code wordt één keer getoond: schrijf hem op en bewaar hem niet op de host.
De host bewaart hem DPAPI-beschermd (Windows) of met `systemd-creds`/alleen-eigenaar-rechten (Linux) voor de
nachtelijke run. Open een verzegelde back-up voor herstel met `install.py backup-open --state-dir <nieuwe
installatie> --backup-input <verzegeld> --recovery-phrase-file <bestand met de code> --backup-output <nieuwe map>`
en gebruik daarna de gewone herstelopdracht op die map. Op gedeelde hosting kan de code alleen naast de back-ups
staan; verzegelen beschermt daar kopieën buiten de host, niet de host zelf. Daar is de bescherming:
alleen-eigenaar-rechten buiten `public_html`. Zonder de code kan niemand een verzegelde back-up herstellen, jij ook
niet.

**Hersteloefening.** `tooling/tests/test_backup_restore_drill.py` (vrijwillig, `MK8DX_BACKUP_DRILL=1`) maakt
gegevens in een wegwerp-MariaDB 11.4 en -MySQL 9.7 (B2-codepad) en in een echt A1-Compose-project, draait de
geplande back-up, wist de gegevens, herstelt met de gewone herstelopdracht en vergelijkt elke rij.

## Databaseaccounts

De API van de website maakt verbinding met een databaseaccount dat alleen rijen mag lezen en schrijven (`SELECT`,
`INSERT`, `UPDATE`, `DELETE` op de MK8DX-database). Zelfs SQL die via een toekomstige fout de database bereikt kan
dan geen tabellen verwijderen, wijzigen of leegmaken, geen gebruikers aanmaken en geen rechten uitdelen; de
echte-databasesuites draaien met precies zo'n account en controleren dat `DROP`, `ALTER`, `TRUNCATE`, `CREATE` en
`GRANT` worden geweigerd. Database-updates, de referentiegegevens, back-ups en herstel gebruiken aparte accounts:

| Route | Website (runtime) | Updates en referentiegegevens (migratie) | Back-up |
| --- | --- | --- | --- |
| A1, A2, A2 offline, B1 (Docker) | `mk8dx_runtime`, aangemaakt door `setup`/`upgrade` | `mk8dx_app` (de eigen gebruiker van het MySQL-image), alleen in de `migrate`-service | de root-login van MySQL binnen de databasecontainer (die heeft hij al; er verlaat niets de container) |
| A3 (XAMPP + Node) | `mk8dx_runtime` op de eigen MariaDB | `mk8dx_app` | `mk8dx_backup` (`SELECT`, `SHOW VIEW`, `TRIGGER`, `LOCK TABLES`, `EVENT`) |
| B2 (gedeelde hosting) | de tweede gebruiker die je in het paneel maakt ([B2-handleiding](install/B2_WEBHOSTING.md#aparte-databaseaccounts)) | de eerste gebruiker (alle rechten op de database) | de eerste gebruiker |

Waar de logins staan: Docker-routes geven de API-container alleen `api.env` en `operator.json` (runtime-login); de
migratielogin staat in `compose.env` (voor het MySQL-image) en in `migration.json`, die alleen de `migrate`-service
mount (`docker compose ... run --rm --no-deps migrate sh /app/operator-command.sh ...`; `up` start hem nooit). A3 en
B2 bewaren `operator.json` (runtime) en `migration.json` (migratie) in de private installatiemap. Wachtwoorden worden
gegenereerd (A1–A3) of verborgen ingetypt (B2), net als de andere sleutels in `secrets.json` bewaard
(`MK8DX_MIGRATION_MYSQL_PASSWORD`, bij A3 ook `MK8DX_NATIVE_BACKUP_MYSQL_PASSWORD`) en nooit getoond. `status` toont `"databaseAccounts": "separate"`.

**Bestaande installaties.** De update splitst de accounts vanzelf en houdt de toegang: Docker-`upgrade` (en de
pakketupdate van A2 offline) maakt en controleert de back-up, maakt `mk8dx_runtime`, houdt `mk8dx_app` ongewijzigd
als migratielogin, past daarmee de migraties toe en start de nieuwe API met de runtime-login. Wordt de API daarmee
niet gezond, dan komen de vorige bestanden byte voor byte terug en start de API weer met de vorige login; er wordt
niets uit de database verwijderd. A3 doet hetzelfde bij de volgende start (of `maintenance`) van de eigen MariaDB.
B2 kan zelf geen gebruikers aanmaken: tot je de tweede gebruiker toevoegt met `database-accounts` blijft alles
werken en tonen `setup`, `upgrade` en `check` een waarschuwing. `python tooling/install.py database-accounts
--state-dir <map>` maakt of herstelt het runtime-account op een Docker-route met de hand (MySQL draait), bijvoorbeeld
na [Getting started](GETTING_STARTED.md) stap voor stap. Een herstel naar een nieuw project (`lifecycle.py
restore-new`) maakt het runtime-account opnieuw, omdat accounts geen deel van een databasedump zijn.

Controleer wat een account mag zonder een wachtwoord te tonen: `node api/dist/composition/database-account-check-main.js
--private-environment-file <map>/operator.json` (A3/B2; in Docker: `docker compose ... run --rm --no-deps api sh
/app/operator-command.sh dist/composition/database-account-check-main.js`) toont `canChangeSchema` en eventuele
extra rechten.

## Als e-mail niet werkt: een gevaarlijke actie bevestigen vanaf de server

Gevaarlijke beheeracties, en de lijst met elk account en zijn e-mailadres, vragen een nieuwe e-maillink voor de
sessie die erom vraagt (step-up; de bevestiging geldt `MK8DX_HOSTED_STEP_UP_WINDOW_SECONDS`, 60 tot 3600, standaard
600 seconden). Daarvoor moet e-mail werken. Ligt de mailserver plat of komt er op het adres geen mail meer aan, dan
kan de beheerder van de server de link uitgeven:

1. De beheerder drukt zoals gewoonlijk op de website of in de app op **Bevestig met een nieuwe e-maillink** →
   **Stuur de link**. De aanvraag wordt voor die ene sessie bewaard, ook als de e-mail niet verstuurd kan worden.
2. Binnen 10 minuten, op de server, vanuit de pakket- of repositorymap:
   `python tooling/install.py step-up-link --state-dir <installatie>` (B1/B2: `python3`). Dat gebruikt het
   beheerdersadres van de installatie; met `--admin-email <aanmeldadres>` kies je een ander account, bijvoorbeeld een
   directeur.
3. De opdracht toont één regel JSON met `stepUpLink`, `clientKind` (`web` of `native`), `requestedAt` en
   `linkExpiresAt`. Controleer dat `requestedAt` het moment is waarop de knop werd ingedrukt, open de link in een
   willekeurige browser en druk op **Deze actie bevestigen**. De wachtende actie gaat verder zoals met de gemailde
   link; komt die gemailde link toch nog aan, dan werkt hij niet meer.

De opdracht heeft geen HTTP-route: hij vraagt de private installatiemap en toegang tot deze server (Docker-routes
draaien hem in de `api`-container met de private beheerdersinstellingen). Hij opent nooit zelf het venster, vervangt
alleen de link van de ene wachtende aanvraag en wordt in de step-up-audit vastgelegd als `step_up_operator_link`. Hij
weigert als er niets wacht, en als sessies op meer dan één apparaat wachten: meld dan de andere apparaten af (**Op alle
apparaten afmelden** in het accountmenu), druk opnieuw op **Stuur de link** en draai hem nog eens. Behandel de getoonde
link als een wachtwoord: hij werkt één keer, 10 minuten; plak hem nooit in een issue of chat. De onderliggende
opdrachten zijn `node api/dist/security/step-up-operator-main.js --private-environment-file <map>/operator.json
--email-stdin` (A3/B2) en `docker compose ... run -T --rm --no-deps api sh /app/operator-command.sh
dist/security/step-up-operator-main.js --email-stdin` (Docker), beide met het adres op standaardinvoer. A2 offline
verstuurt geen e-mail en vraagt geen step-up. Herstel daarna de mailinstellingen met `install.py change-smtp`.

## Software-update

Maak eerst een gecontroleerde backup. Bouw de nieuwe publieke bronversie naar nieuwe images, inspecteer `docker compose config --quiet`, pas pending hash-gepinde migraties toe met `--backup-verified`, en start dan de nieuwe images:

```powershell
docker compose --env-file "$state\compose.env" -f compose.yaml -f compose.local.yaml build api web
docker compose --env-file "$state\compose.env" -f compose.yaml -f compose.local.yaml run --rm --no-deps migrate sh /app/operator-command.sh dist/composition/migration-apply-main.js --migration-catalog /app/infrastructure/mysql/migration-catalog-v1.json --confirm-database mk8dx --backup-verified
docker compose --env-file "$state\compose.env" -f compose.yaml -f compose.local.yaml up -d --no-build
```

0.2.3 zet `compose.yaml` over van MySQL 8.4 naar MySQL 9.7 LTS. MySQL zet de gegevensbestanden één keer om bij de eerste start op het nieuwe image; dat maak je alleen ongedaan door een backup terug te zetten. Maak en controleer de backup dus terwijl de oude databasecontainer nog draait, vóór de `up -d` hierboven hem op 9.7 opnieuw maakt.

Een nieuwe referentieset is een **aparte** actie met de seed-CLI uit stap 6 van [Aan de slag](GETTING_STARTED.md#6-add-the-two-reviewed-reference-sets). Bij lokaal gewijzigde wereldrecords weigert die de update tot het conflict beoordeeld is. Een gewone herstart haalt geen externe records op. Schakel niet blind naar een oud image terug na een schema-upgrade: database-rollback vraagt herstel van een passende backup of een geteste voorwaartse correctie.

De migratiecatalogus is hash-gepind en toegepaste migraties worden nooit herschreven. De publieke geschiedenis begint bij 0.1.0-rc.8, waarin de historische datareparaties 0048, 0049 en 0057 neutrale teksten hebben (geen persoonsgegevens). Elke installatie uit deze repository (of haar releases) werkt gewoon bij. Een database die de oorspronkelijke teksten van die migraties al toepaste vóór de publieke geschiedenis bestond (de eigen installatie van de maintainer), werkt verder bij vanuit de boom van de maintainer, niet met deze pakketten: de migratiecontrole weigert de gewijzigde hashes bewust.

## Een installatie verwijderen

Haal eerst de nachtelijke back-upplanning weg: `python tooling/install.py backup-unschedule --state-dir $state`.

Een proefinstallatie uit de broncode gooi je weg vanuit de root van de repository, met `$state` op de map van die
installatie. `down -v` **verwijdert de databasevolume** met alle accounts en gegevens; maak eerst een backup als je
iets terug wilt kunnen halen. Gebruik de Compose-bestanden waarmee de installatie draait (`compose.local.yaml`
lokaal, `compose.production.yaml` voor het productieprofiel).

```powershell
docker compose --env-file "$state\compose.env" -f compose.yaml -f compose.local.yaml down -v
Remove-Item -Recurse -Force $state
docker image rm mk8dx-source/api:local mk8dx-source/web:local
```

In een POSIX-shell: dezelfde `docker compose ... down -v` met `"$state/compose.env"`, daarna `rm -rf "$state"`.
Verwijder de installatiemap pas na `down -v`, dat haar `compose.env` nodig heeft. De images delen alle
broninstallaties op deze computer; laat ze staan als er nog een draait. Een installatie uit het hostpakket
verwijder je vanuit de pakketmap: zie [Host a community server](guides/HOSTING.md#remove-an-installation).

## Productieprofiel

De productieconfiguratie en Caddyfile zijn lokaal syntactisch gevalideerd. Echte domein-, certificaat-, SMTP- en productie-workflows zijn nog niet extern gevalideerd. Kies een beheerd DNS-domein en een eigen SMTP-dienst met impliciete TLS. Bewaar het SMTP-wachtwoord in een private file buiten Git. De installatiemap moet buiten de repository liggen (de installer weigert een pad erbinnen). Vanuit de root van de repository, op de Linux-host:

```sh
state=/var/lib/mk8dx/production
python3 tooling/install.py init --state-dir "$state" --mode production --domain jouw-domein.example --smtp-host smtp.jouw-domein.example --smtp-user gebruiker --smtp-password-file <private-bestand> --smtp-from afzender@jouw-domein.example
docker compose --env-file "$state/compose.env" -f compose.yaml -f compose.production.yaml config --quiet
```

Controleer het opgeloste Compose-model op de eigen host. Productie publiceert 80/443 en gebruikt Caddy voor HTTPS; de API/MySQL blijven intern. Volg daarna de migratie/seed/start-volgorde van lokaal met de productie-Composebestanden. Gebruik een echte inbox voor de eerste beheerder. Bewaar TLS-state, database, configuratie en sleutels in de herstelprocedure. Deze instructie is pas productiegeschikt na een echte DNS/TLS/SMTP- en restore-proef op de doelhost.
