# B2 — gedeelde webhosting met Node.js en MariaDB

English: [B2_WEBHOSTING_EN.md](B2_WEBHOSTING_EN.md)

Deze route is voor gedeelde webhosting met Node.js/Passenger, MariaDB, een mailbox en SSH; de handleiding gebruikt mijn.host Starter als uitgewerkt voorbeeld. Zij heeft een eigen uploadpakket `mk8dx-mijnhost-node-<versie>.zip`; ondanks die naam werkt het bij elke gedeelde Node.js-hosting met SSH. mijn.host is het geteste voorbeeld, en de SSH-poort 26 in `ssh -p 26`/`scp -P 26` is de poort van die provider: gebruik elders de SSH-poort van je eigen host. Het gewone Nederlandse en Engelse stappenplan staat in `MK8DX_Handleiding_NL.docx`/`.txt` en `MK8DX_User_Guide_EN.docx`/`.txt`. Dit bestand is technische naslag, geen extra installatievoorwaarde.

Het pakket bevat dezelfde gebouwde API, Web, scanner, interne runtime-assets, alle migraties uit de catalogus, twee referentieseeds, centrale installer en beheertooling als de andere routes. De bestaande `passenger-hosted-main.js` is het startupbestand. `operator-profile.json` en `secrets.json` leven in een private map buiten de app en `public_html`; `passenger-config` leidt `mk8dx-hosted.env.json` af in de private Application root. De API serveert de website, `/scanner/`, `/assets/` en `/client-config.json` via gesloten route-inventarissen. `/.well-known/assetlinks.json` blijft een exact JSON-pad. Onbekende routes vallen niet terug op HTML.

Node 24 en Python 3.9+ zijn nodig voor de huidige pakketroute. Productieafhankelijkheden installeert men met `npm ci --omit=dev --ignore-scripts --no-audit --no-fund` in `api` binnen de door DirectAdmin geactiveerde Node-omgeving. De databasecontrole vereist gemeten MariaDB 11.4+ of MySQL 8.4+, een lege eigen database en een beperkte gebruiker. De gebruikelijke mailboxroute gebruikt impliciete TLS op SMTP 465. Een echt Starter-account kan andere versies of limieten hebben.

De route vereist geen Docker, VPS-root, PHP-applicatie, extra PM2-service of mobiele build op de host. Zij is lokaal met een Linux/Node/MariaDB-fixture te verifiëren. Een installatie in een eigen DirectAdmin-account, echte DNS/TLS/SMTP, exacte providerquota en uploadlimieten blijven externe acceptatie. De gebruiker bewerkt geen `.env` of broncode.

Beheer via dezelfde `tooling/install.py`-ingang: `wizard`, `check-database`, `setup`, `check`, `passenger-config`, `admin`, `backup`, `verify-backup`, `restore-wizard` en `upgrade`. Backups bevatten DB-dump plus profiel, sleutels en private runtimeconfig. `upgrade` vereist en verifieert eerst een nieuwe backup. Herstel gaat naar een nieuwe lege database op dezelfde engine/versieserie en een aparte private installatiemap; een latere echte domeinomschakeling is geen lokale testactie. Een bestaande admin wordt bij herhaling of herstel nooit automatisch vervangen.

## Aparte databaseaccounts

Geef de website een eigen databasegebruiker die alleen rijen kan lezen en schrijven. Dan kan zelfs SQL die via een
toekomstige fout de database bereikt geen tabellen verwijderen, wijzigen of leegmaken, en geen rechten uitdelen.
MK8DX gebruikt twee gebruikers:

- **de eerste gebruiker**, met alle rechten op de MK8DX-database (de gebruiker die DirectAdmin met de database
  aanmaakt): alleen voor database-updates (`setup`, `upgrade`), de referentiegegevens, back-ups en herstel;
- **een tweede gebruiker voor de website** met alleen `SELECT`, `INSERT`, `UPDATE` en `DELETE` op dezelfde database.
  Alleen deze login komt in `operator.json` en de Passenger-configuratie (`mk8dx-hosted.env.json`).

Maak de tweede gebruiker in het paneel, naast de eerste:

- **DirectAdmin**: Account Manager → MySQL Management → open de MK8DX-database → maak er een gebruiker bij, open
  daarna de rechten van die gebruiker (Modify Privileges) en laat alleen SELECT, INSERT, UPDATE en DELETE aangevinkt.
- **cPanel**: Databases → MySQL Databases → Add New User, daarna Add User To Database (de MK8DX-database) en vink
  alleen SELECT, INSERT, UPDATE en DELETE aan.

De wizard vraagt beide gebruikers (Enter bij de tweede vraag houdt één gebruiker). Zonder tweede gebruiker blijft
alles werken, maar `setup`, `upgrade` en `check` tonen een duidelijke waarschuwing. Voor een bestaande installatie:
maak de tweede gebruiker en voer `python3 tooling/install.py database-accounts --state-dir "$HOME/mk8dx-private"`
uit. Het vraagt de gebruiker en het verborgen wachtwoord, meldt zich ermee aan, weigert een gebruiker die nog tabellen
kan wijzigen (en noemt de extra rechten) en schakelt pas dan om; de eerste gebruiker blijft bewaard in de private
`migration.json` voor updates en back-ups, zodat je nooit de toegang verliest. Voer daarna `passenger-config` uit en
herstart de app in DirectAdmin. Terugdraaien met `database-accounts --undo` (daarna weer `passenger-config` en een
herstart). Zonder vragen: `--runtime-db-user` en `--runtime-db-password-file`, ook voor `init --mode shared`.
`status` toont `"databaseAccounts": "separate"`. Wachtwoorden worden bewaard zoals de andere geheimen (alleen voor
de eigenaar leesbaar, buiten `public_html`) en nooit getoond.

## Gevaarlijke acties bevestigen per e-mail

Rechten wijzigen, accounts rechtstreeks aan spelers koppelen, de installatie-instellingen, ratings herberekenen, een avond weghalen of heropenen en de lijst met alle accounts vragen de aangemelde sessie om een nieuwe eenmalige link naar het eigen adres (10 minuten; `MK8DX_HOSTED_STEP_UP_WINDOW_SECONDS` in `operator.json`, 60–3600, standaard 600). Daarvoor moet de SMTP van de mailbox blijven werken (`python3 tooling/install.py change-smtp --state-dir "$HOME/mk8dx-private"`). Werkt de mail niet, druk dan toch op **Stuur de link** en draai binnen 10 minuten via SSH `python3 tooling/install.py step-up-link --state-dir "$HOME/mk8dx-private"` (met `--admin-email <adres>` voor een ander account) in de geactiveerde Node-omgeving. Dat toont een nieuwe eenmalige link voor die ene wachtende aanvraag; open hem en druk op **Deze actie bevestigen**. Het werkt alleen op de host, heeft geen webroute en wordt vastgelegd ([details](../OPERATIONS_NL.md#als-e-mail-niet-werkt-een-gevaarlijke-actie-bevestigen-vanaf-de-server)).

## Automatische dagelijkse back-up

`setup` vraagt één keer of MK8DX elke nacht zelf een gecontroleerde back-up moet maken (Enter = ja). Dat kost
ongeveer 3 MB per dag gecomprimeerd; 14 dagelijkse en 4 wekelijkse back-ups blijven in
`~/mk8dx-backups/automatic`, buiten `public_html`, samen hooguit 1 GB, alleen voor jou leesbaar. Het is één
gemarkeerde regel in je eigen crontab (ook zichtbaar in DirectAdmin → Geavanceerde functies → Cronjobs); andere
cronjobs blijven ongemoeid.

**Maakt je hostingpartij al dagelijks back-ups van je account** (bijvoorbeeld de eigen back-ups van DirectAdmin of
JetBackup)? Dan mag je nee zeggen. Vraag het je provider, of zoek in het paneel naar "Backups"/"JetBackup": hoeveel
dagen worden bewaard, zitten de databases en de mappen buiten `public_html` erin, en kun je zelf terugzetten? Een
eigen back-up helpt toch: je zet gisteren zelf binnen minuten terug, inclusief de sleutels van de site (zonder die
zijn opgeslagen resultaten onleesbaar), onafhankelijk van de helpdesk, en ook nadat iemand de site met opzet
beschadigde. Later uitzetten met `python3 tooling/install.py backup-unschedule --state-dir "$HOME/mk8dx-private"`,
weer aan met `backup-schedule`. `python3 tooling/install.py status` toont onder `automaticBackup` de leeftijd en het
resultaat van de laatste run; de host mailt je de uitvoer van een mislukte run. Haal geregeld een kopie naar je eigen
pc; de opdrachten staan in [Beheer en updates](../OPERATIONS_NL.md#automatische-dagelijkse-back-up-a1-a2-b1-a3-b2).
Een update (`upgrade`) houdt hem aan en laat hem naar de nieuwe applicatiemap wijzen.

## App-downloads op hosts die app-antwoorden begrenzen

De pagina **Download de app** van de website levert de bestanden uit `downloads.json` in de map die `MK8DX_HOSTED_APP_DOWNLOAD_ROOT` noemt (buiten `public_html`), alleen aan aangemelde accounts. Standaard streamt de API elk bestand zelf. Gedeelde LiteSpeed/Passenger-hosting kan zo'n groot app-antwoord (een APK van 500 MB) weigeren en toont dan een eigen korte foutpagina. Zet voor zulke hosts kortlevende statische links aan: de aangemelde aanvraag krijgt dan een doorverwijzing naar een link die de webserver zelf serveert, met hervatbare downloads. Zet deze sleutels in `operator.json` in de private installatiemap, voer `python3 tooling/install.py passenger-config` uit en herstart de app in DirectAdmin:

| Sleutel | Waarde |
| --- | --- |
| `MK8DX_HOSTED_APP_DOWNLOAD_LINK_DOCUMENT_ROOT` | de absolute document root, bijv. `/home/<gebruiker>/domains/<domein>/public_html` |
| `MK8DX_HOSTED_APP_DOWNLOAD_LINK_DIRECTORY` | een absolute map daarbinnen voor de links, bijv. `…/public_html/dl` (wordt aangemaakt als hij ontbreekt; nooit een symlink) |
| `MK8DX_HOSTED_APP_DOWNLOAD_LINK_URL_PATH` | optioneel: het publieke pad van die map; standaard daarvan afgeleid, bijv. `/dl` |
| `MK8DX_HOSTED_APP_DOWNLOAD_LINK_TTL_SECONDS` | optioneel: levensduur van een link, 60–86400 seconden; standaard `600` |
| `MK8DX_HOSTED_APP_DOWNLOAD_LINK_MAX_LINKS` | optioneel: hoogstens zoveel levende linkmappen tegelijk, 1–20000; standaard `2000` |
| `MK8DX_HOSTED_APP_DOWNLOAD_LINK_PROBE` | optioneel: `false` slaat de zelfcontrole bij het starten (hieronder) over |

Een download maakt `<map>/<verloop>-<64 hex>/<bestandsnaam>` als symbolische link (een harde link waar symlinks geweigerd worden) naar het opgeslagen bestand, naast een kleine `.htaccess` die de API eerst schrijft. Eén aangemeld account krijgt een tijd lang dezelfde link voor dezelfde download, zodat herhaald klikken geen mappen bijmaakt; een link blijft tussen de halve en de hele levensduur bruikbaar. Boven `…_MAX_LINKS` levende mappen krijgt een nieuwe download "probeer het over een paar minuten opnieuw" (503 met Retry-After), en één account mag 60 downloads per uur starten (daarboven 429).

**Zo wordt het verlopen afgedwongen.** De `.htaccess` in elke linkmap weigert elke aanvraag (403) zodra de klok van de webserver voorbij het verloop van die map is. Een verlopen link werkt dus bij de webserver niet meer, ook als de Node-app stilstaat of door Passenger is gestopt. Een al begonnen download loopt af; hervatten na het verloop wordt geweigerd en een nieuwe klik op **Download de app** geeft een nieuwe link. Lokaal getest met Apache 2.4 (heel bestand, HTTP Range, weigering na verloop terwijl de API stil was, geen mapweergave); LiteSpeed past dezelfde `.htaccess`-rewriteregels toe maar is hier niet getest. Webserver en Node-app moeten dezelfde tijdzone gebruiken (normaal op één host). Daarnaast verwijdert de API verlopen mappen bij het starten en ongeveer elke minuut zolang hij draait (een begrensde ronde, gelogd als `app_download_links_swept`); hij verwijdert alleen mappen met precies dat naampatroon en nooit het opgeslagen bestand.

**Zelfcontrole bij het starten.** Na het starten vraagt de API via het publieke adres een al verlopen en een geldige proeflink op bij de webserver en logt `app_download_link_expiry_probe` met `enforced`, `not_enforced`, `clock_mismatch`, `rules_rejected` of `unreachable`. Alles behalve `enforced` betekent: de eerlijke maximale levensduur van een link is de levensduur plus ongeveer een minuut zolang de app draait, en **tot de volgende start van de app** als Passenger hem heeft gestopt; herstel dan de host (`.htaccess`-rewriteregels toestaan voor de map, tijdzone gelijkzetten) of zet de modus uit.

De webserver moet bestaande bestanden in die map zelf serveren (symlinks van dezelfde eigenaar volgen). De API zet een lege `index.html` in de linkmap, zodat die nooit zijn inhoud toont; `Options -Indexes` voor de document root blijft aanbevolen. Een onvolledige of onveilige instelling (ook een downloadmap binnen de linkmap) stopt de start met de reden. Zonder deze sleutels verandert er niets.

## Browsermeldingen (Web Push)

Browsermeldingen blijven uit totdat `MK8DX_HOSTED_WEB_PUSH_SUBJECT`, `MK8DX_HOSTED_WEB_PUSH_PUBLIC_KEY` en `MK8DX_HOSTED_WEB_PUSH_PRIVATE_KEY` (het eigen VAPID-sleutelpaar van de beheerder) samen in `operator.json` staan. De server levert dan alleen af bij de pushdiensten van de ondersteunde browsers: `fcm.googleapis.com` (Chrome, Edge op Android, Opera, Samsung Internet), `updates.push.services.mozilla.com` (Firefox), `web.push.apple.com` (Safari) en `*.notify.windows.com` (Edge op Windows). De optionele `MK8DX_HOSTED_WEB_PUSH_EXTRA_PROVIDER_HOSTS` voegt andere pushdiensten toe die je vertrouwt, als hostnamen gescheiden door komma's (`push.example.org`; `*.push.example.org` voor de subdomeinen); IP-adressen, poorten en paden worden geweigerd. Elke aflevering gaat naar poort 443, controleert het TLS-certificaat voor die naam, verbindt alleen met openbare adressen die de server zelf heeft opgezocht en gecontroleerd, en volgt nooit een doorverwijzing. Een browser die een andere pushdienst aanbiedt, krijgt te horen dat die niet door deze installatie wordt geaccepteerd.

Grenzen: hoogstens 10 actieve browsers per account (een nieuwe vervangt de langst geleden geregistreerde van dat account); 30 aan- of afmeldingen per account per uur (daarna `429` met `Retry-After`); 10 seconden en 16 KiB antwoord per afleververzoek; 4 browsers tegelijk; nieuwe pogingen na 1, 5, 30 en 120 minuten, opgegeven na 5 pogingen. Een browser waarvan de afleveringen drie keer achter elkaar definitief mislukken zonder enig succes, wordt afgemeld, en afgemelde browsers worden na 30 dagen verwijderd. Waar je host het toestaat, is een uitgaande firewall die privénetwerken voor de app blokkeert een nuttige tweede verdedigingslinie.

Bronnen voor actuele paneelbenamingen en leveranciersmogelijkheden: [Node.js-app in DirectAdmin](https://mijn.host/kb/web-apps/node-js-applicatie-draaien-op-je-hostingpakket), [Starter-overzicht](https://mijn.host/webhosting), [SSH](https://mijn.host/kb/webhosting/verbinden-met-ssh), [Let's Encrypt](https://mijn.host/kb/webhosting/lets-encrypt-ssl-certificaat-aanvragen).
