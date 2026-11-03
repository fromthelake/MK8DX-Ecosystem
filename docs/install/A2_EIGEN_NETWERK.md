# A2 — delen op je eigen vertrouwde netwerk

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
