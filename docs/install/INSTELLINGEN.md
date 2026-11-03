# Instellingenwijzer — één invoer per betekenis

De **gezaghebbende installatie-invoer** staat per installatie in `operator-profile.json` en `secrets.json` binnen één **private gegevensmap**. De wizard vult ze. `api.env`, `operator.json`, `compose.env` en `public-client.json` zijn afgeleide bestanden voor bestaande consumers; bewerk die niet los. De publieke `https://<website>/client-config.json` bevat uitsluitend `schemaVersion` en `websiteOrigin`, geen serversecret of adminadres.

| Gegeven en echte veldnaam | Wie/waar | Voorbeeldvorm | Waar het terechtkomt en hoe je controleert |
| --- | --- | --- | --- |
| Route `route` | Jij in wizard: A1/A2/A3/B1/B2 | `B2` | Privé profiel; `install.py status` toont route. Een andere route is een aparte installatie tenzij een expliciete migratie later wordt uitgevoerd. |
| Hoofdadres `origin` | A1 automatisch; A2 privénaam; A3 lokaal Apache-adres; B1/B2 jij geeft DNS-host | `https://www.example.org` | API `MK8DX_HOSTED_AUTH_BASE_URL`, trusted-origins, publieke clientconfig en links. Alleen B1 gebruikt Caddy `MK8DX_DOMAIN`. |
| Project `project`, DB-volume | Willekeurig één keer gegenereerd | `mk8dx-os-…` | A1/A2/B1 gebruiken een Docker-project en databasevolume. A3/B2 bewaren dezelfde projectidentiteit in hun profiel en gebruiken hun eigen MariaDB buiten Docker. |
| Webpoort `httpPort`, bindadres `bindAddress` | A1 vrij loopbackpoort; A2 gekozen LAN-IP/443; B1 standaard 80/443; A3 vaste Apache-loopbackpoort 18090; B2 HTTPS bij de provider | `127.0.0.1:18090` | Alleen Docker-routes gebruiken `compose.env`. A3 gebruikt een smalle Apache-doorstuurregel en eigen Node/MariaDB-processen; B2 gebruikt Passenger. |
| Eerste admin `adminEmail` | Jij één keer in wizard; **niet** SMTP-login | `eigenadres@example.org` | Privé profiel; menu 5 geeft dit via stdin aan de beheer-CLI **na** echte magic-link-aanmelding. Eerste signup alleen geeft geen rol. |
| SMTP `smtp.host`, `.port`, `.secure`, `.username`, `.fromAddress` | A1 automatisch Mailpit; A2/B1 van eigen mailprovider | `mail.example.org`, `465`, `true`, `mailbox@example.org`, `noreply@example.org` | API runtime. Poort 465 gebruikt impliciete TLS. `username`, afzender en admin zijn functioneel verschillende adressen. |
| SMTP-wachtwoord `MK8DX_HOSTED_SMTP_PASSWORD` | Jij typt afgeschermd in wizard; bij CLI-init kan `--smtp-password-file` | nooit in een voorbeeld of screenshot | Privé `secrets.json` en runtime `operator.json`; `api.env` bewaart het als base64 voor veilige Compose-parsing. Base64 is **geen versleuteling**. Geen publieke client of image bevat het. |
| Databasegeheimen/cryptografische sleutels | MK8DX genereert één keer; B2-databasewachtwoord komt uit DirectAdmin | geen handmatige waarde in broncode | `secrets.json` plus afgeleide runtimebestanden; blijven gelijk bij herhalen en update. A3 gebruikt een afzonderlijke gebundelde MariaDB 11.4.13 omdat XAMPP MariaDB 10.4.32 te oud is. |
| Databasehost intern `MK8DX_HOSTED_MYSQL_HOST` | Automatisch `mysql` in Docker; A3 `127.0.0.1:18306`; B2 volgens DirectAdmin | `localhost:3306` | Alleen servergebruik. Gebruik dit **niet** als websiteadres of DNS-record. B2 vereist gemeten MariaDB ≥11.4 of MySQL ≥8.4 vóór migraties. |
| DNS, VPS-SSH, providerwachtwoord | Externe provideractie, nooit in MK8DX-profiel | A-record `www → VPS-IPv4` | DNS-portaal, WinSCP/SSH. Zie [B1](B1_VPS.md). De provider bepaalt de werkelijke gebruikersnaam, poort en hostkey. |
| Android-/LiveTrial-server | Jij kiest op elk apparaat de **publieke URL**; geen serversecret | `https://www.example.org` | Android eerste scherm/Instellingen; LiveTrial Instellingen. Sessies en wachtende resultaten worden per server apart opgeslagen. |
| Android App Links-certificaatfingerprint | Eigen APK-ondertekenaar, afzonderlijk | geen vaste voorbeeldfingerprint | Alleen voor geavanceerde, per domein ondertekende APK. Standaard `assetlinks.json` is `[]` en JSON; de debug-APK krijgt geen valse domeinclaim. Private signingkey blijft buiten gedeelde installatie. |

## Precieze mappen en voorrang

**Windows A1:** standaard `%LOCALAPPDATA%\MK8DX\Server`; **Windows A2:** `%LOCALAPPDATA%\MK8DX\LAN`; **Windows A3:** `%LOCALAPPDATA%\MK8DX\NoDocker`; **Ubuntu B1:** `/var/lib/mk8dx/instance`; **B2:** `$HOME/mk8dx-private`. Een andere map is een aparte installatie. De A3- en B2-pakketmap staat buiten die private gegevensmap. Voor B2 staat ook `mk8dx-hosted.env.json` in de private Passenger Application root buiten `public_html`; de installer leidt dat bestand af uit `operator.json`.

De voorrang is: (1) de wizard/expliciete `change-origin`-actie schrijft het private profiel; (2) de installer leidt runtimebestanden daaruit af; (3) Compose leest alleen de opgeslagen `compose.env`, zonder `COMPOSE_*`/`MK8DX_*` shelloverrides van de aanroepende gebruiker. Losse edits aan runtimebestanden worden door `status` als conflict gemeld of zijn buiten het contract. Bewaar private waarden niet in Git, `public_html`, screenshots, e-mails of supportlogs. Onder Linux hebben nieuwe bestanden/mappen mode 0600/0700; op Windows staat de map onder het eigen gebruikersprofiel. Lokale bestanden zijn niet automatisch versleuteld; bescherm het gebruikersaccount en de backupmedia.

## Eén adres wijzigen

**Waar:** PowerShell in de uitgepakte pakketmap of SSH in `/opt/mk8dx/host`. **Doe:** maak eerst [een backup](BEHEER.md), voer daarna bijvoorbeeld uit:

```powershell
python tooling/install.py change-origin --state-dir (Join-Path $env:LOCALAPPDATA 'MK8DX\Server') --origin 'http://127.0.0.1:18090'
python tooling/install.py apply --state-dir (Join-Path $env:LOCALAPPDATA 'MK8DX\Server')
python tooling/install.py check --state-dir (Join-Path $env:LOCALAPPDATA 'MK8DX\Server')
```

Voor B1 vervang je voorbeeldorigin en state-dir door jouw exacte `https://…` en `/var/lib/mk8dx/instance` met `python3`. `change-origin` valideert eerst en vervangt alleen relevante afgeleide bestanden; `apply` start API/Web met hetzelfde project en databasevolume opnieuw. **Je ziet:** `status` en `/client-config.json` tonen hetzelfde nieuwe adres, en nieuwe aanmeldlinks gebruiken het. **Als het afwijkt:** start niet blind een tweede installatie. DNS en TLS moeten al op het nieuwe adres passen; bestaande browsers/Android/LiveTrial moeten opnieuw naar het juiste adres verbinden.

## Mailprovider of mailwachtwoord wijzigen

**Waar:** eerst in het portaal van jouw mailprovider, daarna in PowerShell in de uitgepakte hostmap (A2) of SSH in `/opt/mk8dx/host` (B1). **Doe:** noteer de echte SMTP-host, poort **465 met impliciete TLS**, SMTP-login, toegestaan afzenderadres en het nieuwe mailboxwachtwoord. Maak via menu **6** eerst een private backup. Open op Windows PowerShell vanuit de hostmap en voer voor A2 uit:

```powershell
python tooling/install.py change-smtp --state-dir (Join-Path $env:LOCALAPPDATA 'MK8DX\LAN')
python tooling/install.py apply --state-dir (Join-Path $env:LOCALAPPDATA 'MK8DX\LAN')
python tooling/install.py check --state-dir (Join-Path $env:LOCALAPPDATA 'MK8DX\LAN')
```

Op de VPS gebruik je in het SSH-venster `python3 tooling/install.py change-smtp --state-dir /var/lib/mk8dx/instance`, daarna dezelfde opdracht met `apply` en met `check`. De invoer vraagt bij technische veldnamen `smtp.host`, `smtp.port`, `smtp.username`, `smtp.fromAddress` en verborgen `MK8DX_HOSTED_SMTP_PASSWORD`; Enter houdt de bestaande waarde, ook bij het wachtwoord. **Je ziet:** de status met de nieuwe SMTP-host, zonder wachtwoord. Vraag daarna een **nieuwe** aanmeldmail aan met je eigen account en controleer dat die in de echte inbox aankomt. **Als het afwijkt:** controleer de providerwaarden en toegestane afzender; herstel de waarden via dezelfde `change-smtp`-actie. Een succesvolle `check` bewijst alleen dat de services draaien, geen mailbezorging. De actie bewaart project, accounts, admin en volume.

## Wat blijft apart en waarom?

- **Mailbox versus admin:** SMTP is het transport; het adminadres is een geverifieerde MK8DX-gebruiker. Het SMTP-secret blijft op de host, nooit in een APK.
- **Providerhost versus publiek domein:** een VPS-IP is voor SSH/DNS; het domein is voor bezoekers. `mysql` is alleen binnen Docker bereikbaar.
- **Clients:** elk apparaat bewaart zijn eigen login. Een serverwissel vraagt bevestiging; eerdere resultaten gaan niet automatisch naar de nieuwe community.
- **Signing en App Links:** een certificaatfingerprint hoort bij de specifieke ondertekende APK. De generieke debug-APK en een willekeurig domein kunnen niet vooraf een echte association bewijzen.
- **Backuplocatie:** kies een ander opslagmedium buiten de server; de app kan de externe bestemming niet raden. De backup bevat echte secrets en accounts en moet privé blijven.
