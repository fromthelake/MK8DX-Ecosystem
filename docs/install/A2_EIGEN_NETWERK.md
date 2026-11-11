# A2 — delen op je eigen vertrouwde netwerk

> **Bestaande A2-route:** de stappen hieronder beschrijven het oudere profiel
> met een privé-hostnaam en SMTP. De optionele volledig offline A2-route met
> lokale CA, hostbeheer, uitnodigingen en afzonderlijke gezinsaccounts is nog
> in ontwikkeling en wordt pas als installatiehandleiding aangeboden nadat
> de volledige route is getest. Volg deze stappen niet als offline-LAN-instructie.

## Wegwijs in de huidige offline-LAN-proef

Deze uitleg helpt bij een **bestaande, door de beheerder voorbereide QA-installatie**.
De publieke A2-offline-installer en de volledige telefoonproef zijn nog niet
gekwalificeerd. De oudere installatieprocedure verderop op deze pagina is een
ander A2-profiel; gebruik haar niet voor de offline proef.

| Waar open je het? | Adres | Doel |
| --- | --- | --- |
| Alleen op de host-pc | `http://127.0.0.1:19090/` | Afgeschermd hostbeheer: setup-QR, CA-vingerafdruk, accounts en uitnodigingen. |
| Telefoon of tweede pc op hetzelfde vertrouwde netwerk | `http://<LAN-IP>/setup` | Publiek **certificaat** en platforminstructies, nog vóór HTTPS werkt. |
| Telefoon of tweede pc na certificaatinstallatie | `https://<LAN-IP>/` | Website, scanner en gepubliceerde tijden. |
| Alleen op de pc met LiveTrial | `http://127.0.0.1:8776/` | Lokaal LiveTrial-dashboard; verzonden tijden verschijnen op de website. |

`127.0.0.1` betekent **dit apparaat zelf**. Het hostbeheer op de pc kan en mag
dus niet vanaf een telefoon worden geopend. Gebruik het LAN-IP dat het
hostscherm toont; het LAN-IP verschilt per installatie. Houd host en telefoon op hetzelfde netwerk,
zonder gasten-wifi of router-portforwarding.

### Telefoon of tweede pc koppelen

1. Ontgrendel **op de host-pc** het hostbeheer met de afzonderlijke, vijf minuten
   geldige **beheercode** van die installatie. De lange SHA-256-vingerafdruk
   is geen code en hoort niet in dat invoerveld. Het beschikbaar maken van de
   beheercode in de publieke installer is nog een open acceptatiepunt.
2. Open `http://<LAN-IP>/setup` op het andere apparaat. Vergelijk de
   **Root certificate SHA-256** daar teken voor teken met die op het ontgrendelde
   pc-hostscherm. De HTTP-pagina bewijst haar eigen identiteit niet; installeer
   niets als de waarden verschillen.
3. Download pas dan het publieke `.crt`-bestand voor Android/Windows of het
   `.mobileconfig`-profiel voor iPhone/iPad. Op Android kies je in de
   beveiligingsinstellingen **CA-certificaat installeren**; de exacte menunamen
   verschillen per fabrikant. Op Windows kies je **Huidige gebruiker →
   Vertrouwde basiscertificeringsinstanties**, niet *Tussenliggende
   certificeringsinstanties*. Op iOS schakel je na profielinstallatie ook
   volledig vertrouwen in. Verwijder dit lokale vertrouwen wanneer je de
   installatie niet meer gebruikt.
4. Open `https://<LAN-IP>/` in de browser, zonder de certificaatwaarschuwing te
   omzeilen. Een fout over een onvertrouwd certificaat betekent: controleer
   installatie, IP-adres en vingerafdruk opnieuw.

### Een lokaal account gebruiken

1. De hostbeheerder maakt op het **pc-hostscherm** voor iedere persoon een
   afzonderlijk speleraccount. Een account is nog niet automatisch gekoppeld
   aan een Player of diens tijden.
2. De beheerder kiest dat account en maakt een **eenmalige uitnodigings-QR**.
   Dit is niet de setup-QR. De uitnodiging is 15 minuten geldig en werkt één
   keer. Deel haar alleen met de bedoelde persoon.
3. Open de uitnodiging op het apparaat dat het CA-certificaat al vertrouwt,
   bevestig de aanmelding en controleer daarna de accountnaam. Een verlopen of
   gebruikte uitnodiging moet de beheerder opnieuw uitgeven. De gewone knop
   **Aanmelden / Sign in** toont in de huidige QA-build nog de online
   e-mailroute; gebruik voor deze offline proef de uitnodiging.
4. Koppel een Player alleen via de bestaande expliciete claimstappen. Een
   uitnodiging of gelijke weergavenaam doet dit nooit vanzelf.

### LiveTrial op een tweede Windows-pc

Getest op een QA-installatie met LiveTrial 3.37.0 (10-11-2026). Zonder
e-mailserver werkt aanmelden alleen via de goedkeuringspagina.

1. Laat die pc de installatie eerst vertrouwen (stappen 2–3 bij *Telefoon of
   tweede pc koppelen*, Windows: **Huidige gebruiker → Vertrouwde
   basiscertificeringsinstanties**; Windows vraagt één keer om bevestiging).
   Controleer in de browser dat `https://<LAN-IP>/` zonder waarschuwing opent.
2. Zorg dat jouw account op de website een **Player** heeft. Zonder Player
   eindigt het aanmelden in LiveTrial met de melding dat je eerst je speler
   op de communitywebsite moet instellen.
3. Open LiveTrial, klik op het tandwiel (**Instellingen**) en vul bij **Adres
   van je communitywebsite** `https://<LAN-IP>` in. LiveTrial start daarna
   opnieuw; lukt dat niet, sluit het af en open het opnieuw. Accounts en
   wachtende ritten van een andere server blijven bij die server.
4. Klik op **Aanmelden** en kies **Open de goedkeuringspagina**. Meld je in de
   browser aan met je uitnodiging als dat nog niet gebeurd is, controleer dat
   de site dezelfde code toont en keur het apparaat goed. LiveTrial toont
   daarna je Player als aangemeld account.
5. Ritten die LiveTrial opslaat, verstuur je met **Nu verzenden** (of zet
   **Nieuwe ritten automatisch verzenden** aan in Instellingen). De tijd
   verschijnt daarna op de website van de installatie.

Gebruik je de pc niet meer voor deze installatie, verwijder dan het
certificaat weer uit *Vertrouwde basiscertificeringsinstanties*.

### De Android-app koppelen

Getest op een QA-installatie met een testbuild van de app (10-11-2026); deze
koppeling zit nog in geen uitgebrachte app. De app hoeft het certificaat niet
via de Android-instellingen te vertrouwen.

1. Open in de app **Instellingen → Server wijzigen → Installatie thuis of bij
   de club (QR scannen)** en sta de camera toe.
2. Scan de setup-QR op het hostscherm (dezelfde QR die met de gewone camera
   de setup-pagina opent). Lukt scannen niet, plak dan de setup-link van het
   hostscherm.
3. Vergelijk het adres en de **Root publieke sleutel SHA-256 (SPKI)** met het
   hostscherm en kies **Verbinden**; bevestig daarna het wisselen van server.
   De app vertrouwt deze installatie dan alleen voor dat adres.
4. Kies **Aanmelden om te synchroniseren**. De browser opent de
   goedkeuringspagina; keur het apparaat goed met je account (de browser moet
   daarvoor ingelogd zijn, bijvoorbeeld via je uitnodiging).
5. Tijden die je in de app plaatst, verschijnen op de website van de
   installatie.

**Instellingen → Server wijzigen → Deze installatie vergeten** maakt de
koppeling ongedaan.

De website start op een nieuw apparaat met **Systeem** als thema. Een telefoon
die licht is ingesteld toont dus een witte website, ook als de pc donker is.
Na aanmelden kies je via **Account → Instellingen → Weergave → Donker** het
donkere thema. De keuze wordt bij het account bewaard; bij *Systeem* blijft elk
apparaat zijn eigen systeeminstelling volgen.

English orientation for this QA route: [A2 offline LAN (EN)](A2_OFFLINE_LAN_EN.md).
De stap-voor-stap handleiding voor de begeleide installatie (installeren,
aanmeldkaarten, nachtelijke backups, terugzetten op een nieuwe computer, een
nieuw netwerkadres) is [MK8DX thuis of op de club](A2_THUIS_HANDLEIDING_NL.md)
([English](A2_HOME_GUIDE_EN.md)); de installatiewizard opent hem ook via
**Handleiding**.

Dit is een **eigen installatieprofiel** op de Windows-host. De A1-proef blijft behouden en wordt niet automatisch gedeeld of omgezet. De A2-website, databasevolume en sleutels zijn afzonderlijk. `127.0.0.1` betekent op elke telefoon of pc *dat apparaat zelf*. A2 gebruikt daarom een vaste **privé-hostnaam** (`mk8dx.home.arpa`) die op beide pc's naar het LAN-IP van de host verwijst. Een kaal HTTPS-IP werkte in de lokale Windows-proef niet betrouwbaar wegens ontbrekende SNI.

```text
Windows-host met Docker  ── privé-wifi/ethernet ── tweede pc/browser
192.168.0.50 ↔ mk8dx.home.arpa            https://mk8dx.home.arpa
```

De ondersteunde eerste clientroute is een **tweede Windows-pc met browser en scanner-upload**. Android-app en LiveTrial verwachten een door het apparaat vertrouwde HTTPS-server; de Android-app vertrouwt niet automatisch een handmatig geïnstalleerde lokale CA. Voor een gewone APK is de publieke B1-route met openbaar vertrouwd certificaat het eenvoudige pad. Er is lokaal alleen een geïsoleerde netwerkclientproef gedaan, geen fysieke tweede-pc-/telefoonacceptatie.

## 1. Controleer host en netwerk

**Waar:** op de Windows-host, in **Instellingen → Netwerk en internet → Ethernet/Wi-Fi → Eigenschappen**. **Doe:** stel het netwerk alleen als **Privé** in als het echt jouw vertrouwde thuisnetwerk is. Zoek **IPv4-adres**; noteer bijvoorbeeld `192.168.0.50` (dit is een voorbeeld, typ jouw echte adres). Zorg dat de host wakker blijft. Vraag de routerbeheerder zo nodig om een DHCP-reservering voor dit apparaat, zodat het adres later gelijk blijft; de exacte routerknop verschilt per model. **Je ziet:** een privéadres dat niet `127.0.0.1` is. **Als het afwijkt:** gebruik geen gasten-wifi of publiek netwerk; gasten-wifi is vaak geïsoleerd. Open geen routerpoort naar internet.

## 2. Koppel de privé-hostnaam op beide pc's

**Waar:** eerst op de Windows-host, later op de tweede Windows-pc. **Doe:** open **Start**, zoek **Kladblok/Notepad**, klik met rechts → **Als administrator uitvoeren**. Kies **Bestand → Openen**, ga naar `C:\Windows\System32\drivers\etc\`, verander het bestandsfilter van **Tekstdocumenten** naar **Alle bestanden**, open `hosts`. Voeg op een nieuwe regel jouw echte host-IP en de vaste privénaam toe, bijvoorbeeld `192.168.0.50 mk8dx.home.arpa`. Sla op als `hosts` zonder `.txt`. Doe exact dezelfde handeling op de tweede pc. **Je ziet:** in PowerShell geeft `ping -n 1 mk8dx.home.arpa` vóór de pingregels het bedoelde IPv4-adres weer (de ping zelf mag door de firewall worden geweigerd). **Als het afwijkt:** controleer dat je het echte `hosts`-bestand als administrator hebt opgeslagen en dat op beide pc's dezelfde actuele IP-reeks staat. Deze handeling is per apparaat omdat een lokaal netwerk geen publiek DNS-record voor `home.arpa` publiceert. Gebruik bij meerdere MK8DX-hosts elk een andere privénaam en kies diezelfde naam in de wizard.

## 3. Regel aanmeldmail vóór andere gebruikers komen

**Waar:** bij je mailprovider. **Doe:** maak of kies een mailbox die aanmeldmails mag versturen en verzamel afzonderlijk de uitgaande SMTP-host, **poort 465 met impliciete TLS**, SMTP-login, wachtwoord en toegestaan afzenderadres. Deze waarden hoeven niet gelijk te zijn aan je MK8DX-adminadres. De huidige wizard ondersteunt deze TLS-variant; een provider die alleen STARTTLS op 587 aanbiedt past nog niet bij deze route. **Je ziet:** de provider toont deze uitgaande instellingen. **Als het afwijkt:** vraag de provider expliciet of poort 465 met impliciete TLS en SMTP-authenticatie werkt; kies geen onversleutelde mail en gebruik Mailpit niet als gedeelde mailbox voor andere gebruikers.

## 4. Maak de A2-installatie

**Waar:** op de Windows-host, in de uitgepakte hostpakketmap. **Doe:** volg eerst [A1 stappen 1–4](A1_EEN_COMPUTER.md) voor Docker/Python/pakket, zonder een nieuwe A1-installatie te hoeven starten. Dubbelklik daarna op `Start-MK8DX-LAN.cmd`. Dit opent een venster voor het afzonderlijke A2-profiel in `%LOCALAPPDATA%\MK8DX\LAN`.

Kies **A2**. Bevestig de voorgestelde privénaam `mk8dx.home.arpa` (of geef de afwijkende naam uit stap 2) en typ apart het IPv4-adres waarop Docker moet luisteren, bijvoorbeeld `192.168.0.50`. Vul SMTP-gegevens in de aangegeven prompts in; het wachtwoord verschijnt niet op het scherm. Typ je eigen gewenste adminmailadres. Kies daarna menu **1**. **Je ziet:** `https://mk8dx.home.arpa`, route `A2`, alle migraties en referentiesets en gezonde containers. **Als het afwijkt:** `python tooling/install.py check --state-dir (Join-Path $env:LOCALAPPDATA 'MK8DX\LAN')` toont de opgeslagen route en de betreffende containers. Een SMTP-readinessfout betekent dat host/poort/TLS/login/providerbereik eerst moeten kloppen. Begin niet opnieuw met nieuwe sleutels of een nieuw volume. Bij een later gewijzigd LAN-IP werk je eerst beide `hosts`-regels bij en voer je in deze map twee aparte opdrachten uit:

```powershell
python tooling/install.py change-lan-address --state-dir (Join-Path $env:LOCALAPPDATA 'MK8DX\LAN') --lan-bind-address '192.168.0.51'
python tooling/install.py apply --state-dir (Join-Path $env:LOCALAPPDATA 'MK8DX\LAN')
```

Vervang het voorbeeld-IP door je echte nieuwe privé-adres.

## 5. Laat alleen HTTPS op de host toe

**Waar:** Windows-host, **Windows-beveiliging → Firewall en netwerkbeveiliging → Geavanceerde instellingen → Regels voor binnenkomende verbindingen → Nieuwe regel**. **Doe:** kies **Poort → TCP → Specifieke lokale poorten: 443 → Verbinding toestaan → alleen profiel Privé** en geef de regel een herkenbare naam zoals `MK8DX LAN HTTPS`. Beperk onder **Bereik** de externe adressen tot je eigen LAN-subnet als je dat kent; raadpleeg zo nodig je routergegevens. Laat Openbaar/Domein uit en maak geen regel voor MySQL of Mailpit. **Je ziet:** één ingeschakelde privé-regel voor TCP 443. **Als het afwijkt:** controleer of het netwerk echt als Privé staat; blokkeer niet je bestaande beheerverbinding. De Docker-Web-poort is op het gekozen hostadres gebonden.

## 6. Vertrouw het taak-eigen lokale certificaat op de tweede Windows-pc

**Waar eerst:** op de host, in PowerShell in de pakketmap. Het lokale Caddy-certificaat ontstaat pas als A2 draait. Voer deze opdrachten één voor één uit; `$state` is hier het vaste A2-profiel uit stap 3:

```powershell
$state = Join-Path $env:LOCALAPPDATA 'MK8DX\LAN'
$compose = @('--env-file', (Join-Path $state 'compose.env'), '-f', 'compose.yaml', '-f', 'compose.lan.yaml', '-f', 'compose.images.yaml')
docker compose @compose cp web:/data/caddy/pki/authorities/local/root.crt (Join-Path $env:USERPROFILE 'Downloads\mk8dx-lan-root.crt')
Get-FileHash (Join-Path $env:USERPROFILE 'Downloads\mk8dx-lan-root.crt') -Algorithm SHA256
```

**Je ziet:** een SHA-256-reeks. Noteer die **op papier of via een apart betrouwbaar kanaal**. Zet uitsluitend `mk8dx-lan-root.crt` via USB/vertrouwde overdracht op de tweede pc, **nooit** `root.key`, de complete Caddy-data, `operator.json` of `secrets.json`. Op de tweede Windows-pc: controleer met PowerShell `Get-FileHash '.\mk8dx-lan-root.crt' -Algorithm SHA256` in de downloadmap dat de reeks exact overeenkomt. Dubbelklik dan op het `.crt`-bestand → **Certificaat installeren → Huidige gebruiker → Alle certificaten in het onderstaande archief plaatsen → Bladeren → Vertrouwde basiscertificeringsinstanties → Voltooien**. Bevestig alleen als de vingerafdruk overeenkomt met de host. Herstart de browser. **Als het afwijkt:** installeer het certificaat niet, controleer overdracht en fingerprint. Klik geen browserwaarschuwing weg. Verwijder later het certificaat via `certmgr.msc` onder **Vertrouwde basiscertificeringsinstanties → Certificaten**, op basis van dezelfde fingerprint, wanneer je deze A2-installatie opgeeft.

## 7. Controleer vanaf het tweede apparaat

**Waar:** op de tweede Windows-pc in Chrome of Edge. **Doe:** open exact `https://mk8dx.home.arpa` uit stap 4. Open ook `https://mk8dx.home.arpa/scanner/` en kies de uploadfunctie met een eigen testafbeelding. Gebruik **Aanmelden** met een eigen mailbox die echte mail ontvangt, klik de link in die inbox. **Je ziet:** een vertrouwd slotje zonder waarschuwing, de website, scanner en na de mail je eigen account. **Als het afwijkt:** controleer in deze volgorde de `hosts`-naam/IP-koppeling, wakker blijven, beide apparaten op hetzelfde niet-geïsoleerde netwerk, privé-firewallregel, certificaatfingerprint, SMTP en de absolute URL in de mail. Een `https://127.0.0.1`-link in een A2-mail betekent dat de verkeerde installatie is gebruikt.

Op de host kun je na je eigen verificatie het A2-administratoraccount eenmalig toekennen: dubbelklik opnieuw op `Start-MK8DX-LAN.cmd`, kies **5**, en ververs de tweede browser. A1-accounts/admins zijn niet automatisch A2-accounts/admins. Voor status, stoppen, backups en een aparte herstelinstallatie: [beheer](BEHEER.md). Installeer op de router geen portforwarding voor deze route.
