# A1 — MK8DX proberen op één Windows-computer

Volg deze route als je alleen op je eigen pc wilt kijken. Er is geen domein, VPS of echte uitgaande e-mail nodig. **Mailpit** is hier de lokale testbrievenbus: de aanmeldmail gaat niet naar een gewone inbox. Doe deze route niet voor andere mensen op internet.

## 1. Controleer de pc

**Waar:** op je Windows-computer, in **Instellingen**, **Verkenner** en je browser. **Doe:** controleer Windows 11, x86-64, aanbevolen 8 GB RAM en ongeveer 15 GB vrij volgens [de vereisten](START_HIER.md#vereisten-vóór-aanschaf-of-installatie). **Je ziet:** deze gegevens onder **Instellingen → Systeem → Info** en **Deze pc**. **Als het afwijkt:** schaf nog niets aan; gebruik een geschikte pc of vraag hulp om de vereisten te controleren.

## 2. Installeer Docker Desktop

**Waar:** op dezelfde pc, in de browser. **Doe:** open de [officiële Windows-downloadpagina van Docker](https://docs.docker.com/desktop/setup/install/windows-install/), controleer daar de actuele Windows/WSL2-voorwaarden, download Docker Desktop voor Windows en open het gedownloade installatieprogramma. Kies de WSL2/Linux-containeroptie; geef Windows toestemming voor de installatie. Herstart de pc als de installer dat vraagt. Start daarna **Docker Desktop** via Start en wacht tot de engine draait. **Je ziet:** “Engine running” (of de actuele gelijkwaardige gereedmelding). **Controle:** open Start, typ `PowerShell`, open **Windows PowerShell** en voer `docker compose version` uit; er moet een versienummer verschijnen. **Als het afwijkt:** voer de door Docker genoemde WSL-/virtualisatiestap uit, herstart en open Docker Desktop opnieuw. Een geïnstalleerde maar gesloten Docker Desktop is nog geen draaiende engine.

## 3. Installeer Python voor de kleine installer

**Waar:** op de pc, in de browser. **Doe:** download Python 3.12 tot en met 3.15 voor Windows x86-64 via [python.org](https://www.python.org/downloads/windows/). Start het programma, vink **Add python.exe to PATH** aan en kies **Install Now**. Sluit daarna PowerShell en open een nieuw venster. **Je ziet:** `python --version` toont een versie van 3.12 tot en met 3.15. **Als het afwijkt:** controleer of Windows de Microsoft Store-alias in plaats van Python start; herstel de PATH-keuze via de officiële Python-installer en open PowerShell opnieuw. Python wordt alleen gebruikt om de bestaande installer te bedienen; je bouwt geen programma.

## 4. Controleer en pak het juiste bestand uit

**Waar:** in je **Downloads**-map. **Doe:** neem het hostpakket `mk8dx-host-local-<versie>-amd64.zip` uit de nieuwste release én `SHA256SUMS.txt`. Controleer de checksum zoals op [de startpagina](START_HIER.md#welk-bestand-krijg-je). Klik daarna met rechts op de ZIP → **Alles uitpakken** en kies bijvoorbeeld `Documenten\MK8DX-A1` (niet binnen de map `Documenten\MK8DX` van een A2-installatie). Open de uitgepakte map. **Je ziet:** `Start-MK8DX.cmd`, `compose.yaml`, mappen `tooling`, `images` en `docs`. **Als het afwijkt:** je zit waarschijnlijk nog in een extra bovenliggende map of hebt de ontwikkelaarsbron-ZIP; zoek de map waar `Start-MK8DX.cmd` echt staat. Dubbelklik geen ZIP als ware het een installatieprogramma.

## 5. Laat MK8DX de installatie aanmaken

**Waar:** in de uitgepakte map in **Verkenner**. **Doe:** dubbelklik `Start-MK8DX.cmd`. Het opent PowerShell in de correcte pakketmap met een korte race-intro (het MK8DX-logo en aftellen 3-2-1-GO met piepjes; [opties](BEHEER.md#het-startvenster-weergave-en-opties)) en controleert Python en Docker. De eerste keer vraagt het venster **Waar gaat MK8DX draaien?** en noemt A1, A2 en B1: typ `A1` en druk op Enter. Daarna volgt het e-mailadres dat **jij** later als administrator wilt verifiëren. Typ bijvoorbeeld de vorm `mijnnaam@example.test` alleen als je die mailbox zelf kunt openen; bij A1 verschijnt de link in Mailpit. Het script kiest zelf vrije localhostpoorten en laadt de meegeleverde images. De eerste installatie start daarna vanzelf. **Je ziet:** “Private installatie”, “Web-origin”, “Lokale mailinbox”, migraties, twee toegepaste referentiesets en tenslotte `OK  Klaar.` met **Website:** en **Inlogmail komt binnen in de lokale testinbox:**. **Als het afwijkt:** lees de fout, controleer of Docker Desktop nog draait en kies opnieuw **1**. De installer bewaart zijn sleutels in `%LOCALAPPDATA%\MK8DX\Server`; verwijder die map of het Docker-volume niet om een opstartfout te verhelpen.

De gekozen Web-URL lijkt op `http://127.0.0.1:18080`; de poort kan anders zijn. **Kopieer de daadwerkelijk getoonde URL.** `127.0.0.1` betekent deze ene pc. Het Mailpit-adres lijkt op `http://127.0.0.1:18025` en kan eveneens een andere poort hebben.

## 6. Controleer Web en aanmelding

**Waar:** in de browser **op dezelfde pc**. **Doe:** open de getoonde Web-URL, klik **Sign in / Aanmelden** en typ exact het adminadres uit stap 5. Open een tweede tab met de getoonde Mailpit-URL. Open de nieuwste mail voor dat adres en klik de aanmeldlink. Een nieuw account krijgt eerst drie korte schermen: of je tijden al op deze website staan (kies twee keer **Nee** en dan **Verder**), je racenaam (**Maak mijn speler aan**) en een paar optionele keuzes (**Opslaan en afronden** of **Nu overslaan**). **Je ziet:** de MK8DX-site toont dat je bent aangemeld. **Controle:** `Tracks/Circuits` toont circuits en Nintendo Staff/World Records; de lijst of details laden. **Als het afwijkt:** kijk of de mail in de juiste Mailpit-inbox staat, of je exact dezelfde installatie/URL gebruikt, en of de link nog geldig is. Mailpit bezorgt niets op internet. Delen van deze inbox met anderen zou alle testlinks tonen.

## 7. Maak je eigen account beheerder

**Waar:** in hetzelfde zwarte venster, dat na de installatie een menu toont (of dubbelklik opnieuw `Start-MK8DX.cmd`). **Doe:** typ **5** (*Maak mij beheerder*) en druk op Enter, nadat stap 6 is gelukt. De installer leest het eenmaal opgeslagen adminadres en geeft het via stdin aan de bestaande beheer-CLI; hij kiest nooit zelf de eerste willekeurige aanmelder. **Je ziet:** `created` of bij herhaling `unchanged`. Ververs de browser of meld je opnieuw aan; de beheerweergave verschijnt voor jouw geverifieerde account. **Als het afwijkt:** controleer het adres en of de magic link echt in deze instantie is geopend. Bij een al gebruikte bootstrap kun je niet een ander adres als “eerste” admin claimen; zie [beheer/herstel](BEHEER.md).

## 8. Doe één echte producthandeling

**Waar:** op de website. **Doe:** open **Circuits**, kies een cup en een circuit, kies 150cc of 200cc en klik **Plaats je tijd**; typ de zes cijfers van je tijd, controleer tijd en circuit en kies **Publiceer** en daarna **Bevestig en publiceer**. **Je ziet:** je tijd in het klassement van het circuit en op je startpagina. **Als het afwijkt:** controleer of je aangemeld bent en of alle verplichte velden geldig zijn. Je kunt optioneel `/scanner/` openen, **GALLERY** kiezen en een foto van een uitslagscherm kiezen; de scanner toont de totaaltijd, de rondetijden en de kartcombinatie die hij las; cameragebruik op deze pc vraagt browsertoestemming. Tournament kun je bekijken zonder een capturekaart.

## Later terugkomen

Open Docker Desktop, ga terug naar dezelfde uitgepakte map en dubbelklik `Start-MK8DX.cmd`. Het menu blijft open tot je **0** kiest: **2** start, **3** controleert of alles werkt, **4** stopt, **6** maakt een private back-up en controleert die meteen, **7** werkt bij naar het pakket waaruit je het venster startte (eerst een gecontroleerde back-up; pak een nieuwer pakket uit naast het oude en start daar `Start-MK8DX.cmd`), **8** opent de website. Na elke stap zie je `OK  Klaar.` of een duidelijke melding. Sluit je de laptop of gaat hij slapen, dan is de website tijdelijk weg; de named databasevolume en `%LOCALAPPDATA%\MK8DX\Server` blijven bestaan. Een software-update vervangt het **hostpakket**, niet deze gegevensmap. Gebruik nooit `docker compose down -v` (alleen bij verwijderen, hieronder). Voor backup en terugzetten naar een aparte installatie: [beheer](BEHEER.md).

**Bijwerken naar 0.2.3:** deze versie zet de database over van MySQL 8.4 naar 9.7 LTS. MySQL zet de gegevensbestanden één keer om bij de eerste start op de nieuwe versie; alleen een backup maakt dat ongedaan. Typ in de nieuwe pakketmap daarom eerst **7** (bijwerken): die maakt een gecontroleerde backup en voert de database-updates uit. Vanaf 0.2.4 weigert **2** (starten) tot de update gedraaid heeft; met een 0.2.3-pakket zou 2 de backup overslaan. **3** (controleren) kan geen kwaad.

**Automatische back-up:** MK8DX maakt daarnaast elke nacht zelf een gecontroleerde back-up (03:15, of zodra de computer weer aan staat) in `Documents\MK8DX-backups\automatic` en bewaart 14 dagen en 4 weken. **3** (controleren) toont onder `automaticBackup` de leeftijd en het resultaat van de laatste; `"enabled": true` betekent dat hij aan staat. Staat hij niet aan (een installatie met een ouder pakket kan *Nightly automatic backup could not be switched on* hebben gemeld, en een update zet hem daarna niet aan), voer de regel hieronder dan één keer uit. Voer hem uit in PowerShell in de pakketmap; hij kopieert elke back-up ook naar een andere schijf of een NAS (laat `--copy-to ...` weg als je die niet hebt): `python tooling/install.py backup-schedule --state-dir "$env:LOCALAPPDATA\MK8DX\Server" --copy-to 'D:\MK8DX-backups'`. `backup-run` in plaats van `backup-schedule` maakt er meteen één. Uitzetten met `backup-unschedule`. Meer: [beheer](BEHEER.md#automatische-dagelijkse-back-up).

**Databaseaccounts:** de website meldt zich bij de database aan met een eigen account (`mk8dx_runtime`) dat alleen gegevens kan lezen en schrijven; database-updates gebruiken het eigen account van de database (`mk8dx_app`). De installatie maakt ze allebei; een oudere installatie krijgt ze bij de volgende update (**7**), en start de website niet met het nieuwe account, dan gaat de update terug naar het oude. **3** (controleren) toont `"databaseAccounts": "separate"`. Meer: [Operations](../OPERATIONS_NL.md#databaseaccounts).

## MK8DX van deze computer verwijderen

Dit wist de database, de accounts en de sleutels van deze installatie; maak eerst een back-up (**6**) als je nog iets terug wilt kunnen halen. In PowerShell in de pakketmap:

1. `python tooling/install.py backup-unschedule --state-dir "$env:LOCALAPPDATA\MK8DX\Server"` (de nachtelijke back-up).
2. Dubbelklik `Start-MK8DX.cmd` en typ **4** (stoppen), daarna **0**.
3. `docker compose --env-file "$env:LOCALAPPDATA\MK8DX\Server\compose.env" -f compose.yaml -f compose.local.yaml -f compose.images.yaml down -v` verwijdert de containers en de database.
4. `Remove-Item -LiteralPath "$env:LOCALAPPDATA\MK8DX\Server" -Recurse -Force` verwijdert de sleutels en instellingen.
5. `python tooling/remove_images.py` verwijdert de programma's. Het laat elk image staan dat een andere installatie of een ander programma op deze computer nog gebruikt (bijvoorbeeld een A2-installatie) en zegt welke.
6. Verwijder de pakketmap, en in `Documenten\MK8DX-backups` de back-ups die je niet meer nodig hebt.

**Je ziet:** de website en de testinbox antwoorden niet meer, en `docker ps -a` toont geen `mk8dx-os-…`-containers van deze installatie meer. Meer: [Een communityserver hosten](../guides/translations/nl/HOSTING.md#een-installatie-verwijderen).
