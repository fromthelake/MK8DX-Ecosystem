# Dagelijks beheer, updates en herstel

Gebruik telkens **dezelfde private gegevensmap**. Op Windows A1 is dat standaard `%LOCALAPPDATA%\MK8DX\Server`, op A2 de aparte `LAN`-map uit de gids, op B1 `/var/lib/mk8dx/instance`. Een map met alleen software is vervangbaar; de gegevensmap en het Docker-volume zijn dat niet. Menu **3 status** toont route/adres/project zonder geheimen. `docker compose down -v` is geen stopcommando: `-v` verwijdert de databasevolume.

## Stoppen, starten en controleren

**Windows:** open Docker Desktop, ga in Verkenner naar de uitgepakte hostmap, dubbelklik `Start-MK8DX.cmd` (A1) of `Start-MK8DX-LAN.cmd` (A2). Kies **2** voor start, **3** voor status, **4** voor stop. **Je ziet:** dezelfde `project`-identiteit, geen nieuwe installatiewizard. **Als het afwijkt:** controleer Docker Desktop en de juiste gegevensmap; maak geen nieuwe map om een poort-/mailfout te omzeilen.

**Ubuntu VPS:** verbind zoals in [B1](B1_VPS.md), voer `cd /opt/mk8dx/host` uit en `sh tooling/start-mk8dx.sh /var/lib/mk8dx/instance`; kies hetzelfde menu. **Je ziet:** het bestaande project. Als de server herstart, starten containers met `restart: unless-stopped` na Docker; controleer nog steeds website, mail en opslag. Een laptop in slaapstand of een uitgeschakelde VPS is tijdelijk niet bereikbaar.

## Private backup: maak, controleer, kopieer weg

**Waar:** in hetzelfde menu, kies **6**. De helper gebruikt het opgeslagen profiel en maakt een nieuw backupmapje met een MySQL-dump, runtimeconfig, secrets en een manifest met SHA-256. Windows schrijft onder `Documenten\MK8DX-backups\<tijdstip>`, Ubuntu onder `~/mk8dx-backups/<tijdstip>`. **Je ziet:** `Backup complete`. Controleer een backup op Windows in PowerShell:

```powershell
python tooling/lifecycle.py verify --backup "$env:USERPROFILE\Documents\MK8DX-backups\<ECHTE_MAPNAAM>"
```

Vervang `<ECHTE_MAPNAAM>` door de werkelijk aangemaakte mapnaam; gebruik de complete map, niet alleen het `.gz`-bestand. Op Ubuntu is het equivalent `python3 tooling/lifecycle.py verify --backup '/root/mk8dx-backups/<ECHTE_MAPNAAM>'`. **Je ziet:** `Backup verified` met route A1/A2/B1. **Als het afwijkt:** bewaar de mislukte kopie privé, maak een nieuwe backup en onderzoek de fout voordat je bijwerkt. Bewaar daarnaast een kopie op een ander, beschermd medium; een backup op dezelfde kapotte VPS is geen herstelplan. De backup bevat accounts, database, adminstatus en alle sleutels; deel hem nooit in een issue, e-mail of openbare cloudlink. De Caddy-certificaatvolume blijft bij normale updates op dezelfde host bestaan; een apart hersteld B1-project vraagt bij het uiteindelijke DNS-cutover een nieuw certificaat aan.

## Herstellen zonder de huidige installatie te wissen

**Doel:** controleer een backup in een **nieuwe** gegevensmap en met een **nieuw** Docker-project. De helper weigert een bestaande doelmap. Op Windows, in PowerShell vanuit het hostpakket:

```powershell
python tooling/lifecycle.py restore-new --backup "$env:USERPROFILE\Documents\MK8DX-backups\<ECHTE_MAPNAAM>" --state-dir (Join-Path $env:LOCALAPPDATA 'MK8DX\Herstelproef')
python tooling/install.py status --state-dir (Join-Path $env:LOCALAPPDATA 'MK8DX\Herstelproef')
```

**Je ziet:** geverifieerde bestanden, geïmporteerde database en een **ander** project. A1 krijgt vrije nieuwe loopbackpoorten; B1/A2 bewaart het bedoelde HTTPS-adres, maar start in deze proef alleen MySQL, niet de publieke gateway. Zo ontstaat geen onverwachte tweede live site of certificaataanvraag. De oorspronkelijke containers, accounts en volumes blijven staan. **Als het afwijkt:** start niet met wissen of `down -v`; controleer checksum, vrije schijfruimte en of de nieuwe doelmap echt nog niet bestond. Op Ubuntu vervang je `python` door `python3`, backup- en doelpad door `/root/mk8dx-backups/<ECHTE_MAPNAAM>` en `/var/lib/mk8dx/herstelproef`. Een daadwerkelijke vervanging van een publieke site vraagt daarna een geplande DNS-/poort-/certificaatcutover; voer die pas uit nadat de eigenaar de herstelde data heeft gecontroleerd.

## Een nieuwe softwareversie installeren

**Waar:** op de host. **Doe:** controleer de SHA-256 van het **nieuwe** hostpakket, pak het naast de oude softwaremap uit, houd de bestaande gegevensmap/volumes intact. Start het nieuwe pakket met dezelfde `-StateDir` (Windows) of hetzelfde enige padargument (Ubuntu). Kies **7 update**. De helper maakt eerst een nieuwe backup en controleert hem, voert daarna alleen nog ontbrekende canonieke migraties en idempotente referentieseeds uit, en vervangt API/Web-containers door de meegeleverde versie-images. **Je ziet:** dezelfde projectnaam, dezelfde accounts en admin, en daarna een gezonde website. **Als het afwijkt:** bewaar de gemaakte backup, leg de fout vast zonder geheimen, en herstel zo nodig naar een apart doel. Draai niet blind een oudere image terug nadat het schema is veranderd. Een gewijzigde SMTP-provider of domein wordt via de [instellingenwijzer](INSTELLINGEN.md) behandeld, niet door een `.env`-regel in elk pakket te wijzigen.

## Admin en problemen

Onder Beheer → **Installatie-instellingen** staan drie keuzes voor de hele site, elke wijziging vastgelegd met de naam van de beheerder: wie spelers aanmaakt, wie meetelt voor de rating en **tijden uit andere community's**. Die laatste staat standaard uit: een speler die bij meerdere community's hoort, kan dan geen elders gezette tijd meenemen. Bij *Met goedkeuring* blijft elke meegenomen tijd buiten de openbare overzichten tot een beheerder hem openbaar maakt; zulke tijden staan onder Beheer → Tijdritten als niet openbaar, met een knop **Publiceren**. Zet je *Met goedkeuring* uit terwijl er nog meegenomen tijden wachten, dan vraagt de pagina of je ze allemaal publiceert (of bij *Uit*: weigert) of laat wachten. Bij *Toegestaan* volgt een meegenomen tijd de gewone publicatieregels. Een meegenomen tijd laat altijd zien waar hij vandaan komt (ADR-0225).

De adminactie (menu **5**) werkt pas na aanmelding via de geverifieerde magic link voor het opgeslagen eigen doeladres. De gewone eerste registratie geeft nooit een rol. Als het adminadres vóór de eerste toekenning fout was, stel de doelidentiteit veilig bij met `python tooling/install.py set-admin-email --state-dir '<jouw gegevensmap>' --admin-email 'eigenadres@example.org'`, meld met precies dat adres aan en kies daarna menu 5. Een al gebruikte bootstrap wordt niet heropend; de bestaande begrensde administrator-recovery uit [Operations NL](../OPERATIONS_NL.md) vereist een expliciet geverifieerd doelaccount en eigenaarbesluit.

Een homepage zonder aanmeldmail is meestal een SMTP-probleem; A1 heeft alleen Mailpit op de host, A2/B1 echte mail. `/.well-known/assetlinks.json` moet `application/json` met `[]` (of later een correct eigen association-document) leveren, geen HTML. `/client-config.json` moet alleen het publieke serveradres tonen. `/health/ready` controleert API/database, maar bewijst geen inboxbezorging of fysieke clientverbinding. Kijk bij een fout eerst in de veilige menu-status en de toepasselijke routegids. Deel nooit private env/config/logregels met tokens of wachtwoorden.
