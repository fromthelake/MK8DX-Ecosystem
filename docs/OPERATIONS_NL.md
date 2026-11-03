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

## Software-update

Maak eerst een gecontroleerde backup. Bouw de nieuwe publieke bronversie naar nieuwe images, inspecteer `docker compose config --quiet`, pas pending hash-gepinde migraties toe met `--backup-verified`, en start dan de nieuwe images:

```powershell
docker compose --env-file "$state\compose.env" -f compose.yaml -f compose.local.yaml build api web
docker compose --env-file "$state\compose.env" -f compose.yaml -f compose.local.yaml run --rm --no-deps api sh /app/operator-command.sh dist/composition/migration-apply-main.js --migration-catalog /app/infrastructure/mysql/migration-catalog-v1.json --confirm-database mk8dx --backup-verified
docker compose --env-file "$state\compose.env" -f compose.yaml -f compose.local.yaml up -d --no-build
```

Een nieuwe referentieset is een **aparte** actie met de seed-CLI uit stap 6 van [Aan de slag](GETTING_STARTED.md#6-add-the-two-reviewed-reference-sets). Bij lokaal gewijzigde wereldrecords weigert die de update tot het conflict beoordeeld is. Een gewone herstart haalt geen externe records op. Schakel niet blind naar een oud image terug na een schema-upgrade: database-rollback vraagt herstel van een passende backup of een geteste voorwaartse correctie.

De migratiecatalogus is hash-gepind en toegepaste migraties worden nooit herschreven. De publieke geschiedenis begint bij 0.1.0-rc.8, waarin de historische datareparaties 0048, 0049 en 0057 neutrale teksten hebben (geen persoonsgegevens). Elke installatie uit deze repository (of haar releases) werkt gewoon bij. Een database die de oorspronkelijke teksten van die migraties al toepaste vóór de publieke geschiedenis bestond (de eigen installatie van de maintainer), werkt verder bij vanuit de boom van de maintainer, niet met deze pakketten: de migratiecontrole weigert de gewijzigde hashes bewust.

## Een installatie verwijderen

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
