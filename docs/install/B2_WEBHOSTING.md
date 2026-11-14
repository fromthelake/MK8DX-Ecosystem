# B2 — gedeelde webhosting met Node.js en MariaDB

English: [B2_WEBHOSTING_EN.md](B2_WEBHOSTING_EN.md)

Deze route is voor gedeelde webhosting met Node.js/Passenger, MariaDB, een mailbox en SSH; de handleiding gebruikt mijn.host Starter als uitgewerkt voorbeeld. Zij heeft een eigen uploadpakket `mk8dx-mijnhost-node-<versie>.zip`; ondanks die naam werkt het bij elke gedeelde Node.js-hosting met SSH. mijn.host is het geteste voorbeeld, en de SSH-poort 26 in `ssh -p 26`/`scp -P 26` is de poort van die provider: gebruik elders de SSH-poort van je eigen host. Het gewone Nederlandse en Engelse stappenplan staat in `MK8DX_Handleiding_NL.docx`/`.txt` en `MK8DX_User_Guide_EN.docx`/`.txt`. Dit bestand is technische naslag, geen extra installatievoorwaarde.

Het pakket bevat dezelfde gebouwde API, Web, scanner, interne runtime-assets, alle migraties uit de catalogus, twee referentieseeds, centrale installer en beheertooling als de andere routes. De bestaande `passenger-hosted-main.js` is het startupbestand. `operator-profile.json` en `secrets.json` leven in een private map buiten de app en `public_html`; `passenger-config` leidt `mk8dx-hosted.env.json` af in de private Application root. De API serveert de website, `/scanner/`, `/assets/` en `/client-config.json` via gesloten route-inventarissen. `/.well-known/assetlinks.json` blijft een exact JSON-pad. Onbekende routes vallen niet terug op HTML.

Node 24 en Python 3.9+ zijn nodig voor de huidige pakketroute. Productieafhankelijkheden installeert men met `npm ci --omit=dev --ignore-scripts --no-audit --no-fund` in `api` binnen de door DirectAdmin geactiveerde Node-omgeving. De databasecontrole vereist gemeten MariaDB 11.4+ of MySQL 8.4+, een lege eigen database en een beperkte gebruiker. De gebruikelijke mailboxroute gebruikt impliciete TLS op SMTP 465. Een echt Starter-account kan andere versies of limieten hebben.

De route vereist geen Docker, VPS-root, PHP-applicatie, extra PM2-service of mobiele build op de host. Zij is lokaal met een Linux/Node/MariaDB-fixture te verifiëren. Een installatie in een eigen DirectAdmin-account, echte DNS/TLS/SMTP, exacte providerquota en uploadlimieten blijven externe acceptatie. De gebruiker bewerkt geen `.env` of broncode.

Beheer via dezelfde `tooling/install.py`-ingang: `wizard`, `check-database`, `setup`, `check`, `passenger-config`, `admin`, `backup`, `verify-backup`, `restore-wizard` en `upgrade`. Backups bevatten DB-dump plus profiel, sleutels en private runtimeconfig. `upgrade` vereist en verifieert eerst een nieuwe backup. Herstel gaat naar een nieuwe lege database op dezelfde engine/versieserie en een aparte private installatiemap; een latere echte domeinomschakeling is geen lokale testactie. Een bestaande admin wordt bij herhaling of herstel nooit automatisch vervangen.

## App-downloads op hosts die app-antwoorden begrenzen

De pagina **Download de app** van de website levert de bestanden uit `downloads.json` in de map die `MK8DX_HOSTED_APP_DOWNLOAD_ROOT` noemt (buiten `public_html`), alleen aan aangemelde accounts. Standaard streamt de API elk bestand zelf. Gedeelde LiteSpeed/Passenger-hosting kan zo'n groot app-antwoord (een APK van 500 MB) weigeren en toont dan een eigen korte foutpagina. Zet voor zulke hosts kortlevende statische links aan: de aangemelde aanvraag krijgt dan een doorverwijzing naar een link die de webserver zelf serveert, met hervatbare downloads. Zet deze sleutels in `operator.json` in de private installatiemap, voer `python3 tooling/install.py passenger-config` uit en herstart de app in DirectAdmin:

| Sleutel | Waarde |
| --- | --- |
| `MK8DX_HOSTED_APP_DOWNLOAD_LINK_DOCUMENT_ROOT` | de absolute document root, bijv. `/home/<gebruiker>/domains/<domein>/public_html` |
| `MK8DX_HOSTED_APP_DOWNLOAD_LINK_DIRECTORY` | een absolute map daarbinnen voor de links, bijv. `…/public_html/dl` (wordt aangemaakt als hij ontbreekt; nooit een symlink) |
| `MK8DX_HOSTED_APP_DOWNLOAD_LINK_URL_PATH` | optioneel: het publieke pad van die map; standaard daarvan afgeleid, bijv. `/dl` |
| `MK8DX_HOSTED_APP_DOWNLOAD_LINK_TTL_SECONDS` | optioneel: levensduur van een link, 60–86400 seconden; standaard `600` |

Elke download maakt `<map>/<64 willekeurige hex>/<bestandsnaam>` als symbolische link (een harde link waar symlinks geweigerd worden) naar het opgeslagen bestand. Mappen met precies zo'n naam worden na de levensduur verwijderd, bij elke download en bij het starten; verder wordt niets in de map aangeraakt. Mapweergave moet uit staan voor de document root (`Options -Indexes` in `.htaccess`), en de webserver moet bestaande bestanden in die map zelf serveren (symlinks van dezelfde eigenaar volgen). Een onvolledige of onveilige instelling stopt de start met de reden. Zonder deze sleutels verandert er niets.

Bronnen voor actuele paneelbenamingen en leveranciersmogelijkheden: [Node.js-app in DirectAdmin](https://mijn.host/kb/web-apps/node-js-applicatie-draaien-op-je-hostingpakket), [Starter-overzicht](https://mijn.host/webhosting), [SSH](https://mijn.host/kb/webhosting/verbinden-met-ssh), [Let's Encrypt](https://mijn.host/kb/webhosting/lets-encrypt-ssl-certificaat-aanvragen).
