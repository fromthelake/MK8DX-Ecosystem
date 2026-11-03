# A1 — MK8DX proberen op één Windows-computer

Volg deze route als je alleen op je eigen pc wilt kijken. Er is geen domein, VPS of echte uitgaande e-mail nodig. **Mailpit** is hier de lokale testbrievenbus: de aanmeldmail gaat niet naar een gewone inbox. Doe deze route niet voor andere mensen op internet.

## 1. Controleer de pc

**Waar:** op je Windows-computer, in **Instellingen**, **Verkenner** en je browser. **Doe:** controleer Windows 11, x86-64, aanbevolen 8 GB RAM en ongeveer 15 GB vrij volgens [de vereisten](START_HIER.md#vereisten-vóór-aanschaf-of-installatie). **Je ziet:** deze gegevens onder **Instellingen → Systeem → Info** en **Deze pc**. **Als het afwijkt:** schaf nog niets aan; gebruik een geschikte pc of vraag hulp om de vereisten te controleren.

## 2. Installeer Docker Desktop

**Waar:** op dezelfde pc, in de browser. **Doe:** open de [officiële Windows-downloadpagina van Docker](https://docs.docker.com/desktop/setup/install/windows-install/), controleer daar de actuele Windows/WSL2-voorwaarden, download Docker Desktop voor Windows en open het gedownloade installatieprogramma. Kies de WSL2/Linux-containeroptie; geef Windows toestemming voor de installatie. Herstart de pc als de installer dat vraagt. Start daarna **Docker Desktop** via Start en wacht tot de engine draait. **Je ziet:** “Engine running” (of de actuele gelijkwaardige gereedmelding). **Controle:** open Start, typ `PowerShell`, open **Windows PowerShell** en voer `docker compose version` uit; er moet een versienummer verschijnen. **Als het afwijkt:** voer de door Docker genoemde WSL-/virtualisatiestap uit, herstart en open Docker Desktop opnieuw. Een geïnstalleerde maar gesloten Docker Desktop is nog geen draaiende engine.

## 3. Installeer Python voor de kleine installer

**Waar:** op de pc, in de browser. **Doe:** download Python 3.12 of nieuwer voor Windows x86-64 via [python.org](https://www.python.org/downloads/windows/). Start het programma, vink **Add python.exe to PATH** aan en kies **Install Now**. Sluit daarna PowerShell en open een nieuw venster. **Je ziet:** `python --version` toont 3.12 of hoger. **Als het afwijkt:** controleer of Windows de Microsoft Store-alias in plaats van Python start; herstel de PATH-keuze via de officiële Python-installer en open PowerShell opnieuw. Python wordt alleen gebruikt om de bestaande installer te bedienen; je bouwt geen programma.

## 4. Controleer en pak het juiste bestand uit

**Waar:** in je **Downloads**-map. **Doe:** neem het hostpakket `mk8dx-host-local-<versie>-amd64.zip` uit de nieuwste release én `SHA256SUMS.txt`. Controleer de checksum zoals op [de startpagina](START_HIER.md#welk-bestand-krijg-je). Klik daarna met rechts op de ZIP → **Alles uitpakken** en kies bijvoorbeeld `Documenten\MK8DX\host`. Open de uitgepakte map. **Je ziet:** `Start-MK8DX.cmd`, `compose.yaml`, mappen `tooling`, `images` en `docs`. **Als het afwijkt:** je zit waarschijnlijk nog in een extra bovenliggende map of hebt de ontwikkelaarsbron-ZIP; zoek de map waar `Start-MK8DX.cmd` echt staat. Dubbelklik geen ZIP als ware het een installatieprogramma.

## 5. Laat MK8DX de installatie aanmaken

**Waar:** in de uitgepakte map in **Verkenner**. **Doe:** dubbelklik `Start-MK8DX.cmd`. Het opent PowerShell in de correcte pakketmap en controleert Python en Docker. De eerste keer vraagt de wizard om `A1`, daarna het e-mailadres dat **jij** later als administrator wilt verifiëren. Typ bijvoorbeeld de vorm `mijnnaam@example.test` alleen als je die mailbox zelf kunt openen; bij A1 verschijnt de link in Mailpit. Het script kiest zelf vrije localhostpoorten en laadt de meegeleverde images. Kies in het genummerde menu **1** voor eerste installatie. **Je ziet:** “Private installation”, “Web origin”, “Local mail inbox”, migraties, twee toegepaste referentiesets en tenslotte de status `A1`. **Als het afwijkt:** lees de fout, controleer of Docker Desktop nog draait en kies opnieuw **1**. De installer bewaart zijn sleutels in `%LOCALAPPDATA%\MK8DX\Server`; verwijder die map of het Docker-volume niet om een opstartfout te verhelpen.

De gekozen Web-URL lijkt op `http://127.0.0.1:18080`; de poort kan anders zijn. **Kopieer de daadwerkelijk getoonde URL.** `127.0.0.1` betekent deze ene pc. Het Mailpit-adres lijkt op `http://127.0.0.1:18025` en kan eveneens een andere poort hebben.

## 6. Controleer Web en aanmelding

**Waar:** in de browser **op dezelfde pc**. **Doe:** open de getoonde Web-URL, klik **Sign in / Aanmelden** en typ exact het adminadres uit stap 5. Open een tweede tab met de getoonde Mailpit-URL. Open de nieuwste mail voor dat adres en klik de aanmeldlink. **Je ziet:** de MK8DX-site toont dat je bent aangemeld. **Controle:** `Tracks/Circuits` toont circuits en Nintendo Staff/World Records; de lijst of details laden. **Als het afwijkt:** kijk of de mail in de juiste Mailpit-inbox staat, of je exact dezelfde installatie/URL gebruikt, en of de link nog geldig is. Mailpit bezorgt niets op internet. Delen van deze inbox met anderen zou alle testlinks tonen.

## 7. Maak je eigen account beheerder

**Waar:** terug in de uitgepakte map, dubbelklik `Start-MK8DX.cmd`. **Doe:** kies **5** nadat stap 6 aantoonbaar is voltooid. De installer leest het eenmaal opgeslagen adminadres en geeft het via stdin aan de bestaande beheer-CLI; hij kiest nooit zelf de eerste willekeurige aanmelder. **Je ziet:** `created` of bij herhaling `unchanged`. Ververs de browser of meld je opnieuw aan; de beheerweergave verschijnt voor jouw geverifieerde account. **Als het afwijkt:** controleer het adres en of de magic link echt in deze instantie is geopend. Bij een al gebruikte bootstrap kun je niet een ander adres als “eerste” admin claimen; zie [beheer/herstel](BEHEER.md).

## 8. Doe één echte producthandeling

**Waar:** op de website. **Doe:** open **Tracks**, kies een circuit, kies 150cc of 200cc en gebruik **Submit a Time Trial** om een eigen proefrit in te voeren; controleer tijd en gekozen circuit vóór verzenden. **Je ziet:** de inzending verschijnt in je account/overzicht. Een inzending en publieke goedkeuring zijn verschillende stappen. **Als het afwijkt:** controleer of je aangemeld bent en of alle verplichte velden geldig zijn. Je kunt optioneel `/scanner/` openen en een afbeelding uploaden; cameragebruik op deze pc vraagt browsertoestemming. Tournament kun je bekijken zonder een capturekaart.

## Later terugkomen

Open Docker Desktop, ga terug naar dezelfde uitgepakte map en dubbelklik `Start-MK8DX.cmd`: **2** start, **3** toont veilige status, **4** stopt, **6** maakt een private backup. Sluit je de laptop of gaat hij slapen, dan is de website tijdelijk weg; de named databasevolume en `%LOCALAPPDATA%\MK8DX\Server` blijven bestaan. Een software-update vervangt het **hostpakket**, niet deze gegevensmap. Gebruik nooit `docker compose down -v`. Voor backup en terugzetten naar een aparte installatie: [beheer](BEHEER.md).
