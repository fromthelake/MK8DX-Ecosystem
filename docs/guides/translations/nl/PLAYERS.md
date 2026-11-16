# Spelers: de website en de Android-app

*Nederlandse versie van de [Engelse handleiding](../../PLAYERS.md); bij details is de Engelse versie leidend.*

[Alle handleidingen](../../../../README.md#get-started)

Je hebt het adres nodig van de MK8DX-website van je community, bijvoorbeeld `https://www.example.org`. Elke community
draait een eigen installatie met eigen accounts en resultaten; vraag de mensen die jouw community runnen om het adres
en om hulp met je account. Om de website te gebruiken hoef je niets te installeren.

## De website

### Aanmelden

1. Open het adres van je community en kies het accountpictogram (rechtsboven) en daarna **Aanmelden**.
2. Vul je e-mailadres in en kies **Mail me een link**. Open de e-mail en volg de link. Er is geen
   wachtwoord. De link werkt één keer en verloopt; vraag een nieuwe aan als hij niet werkt.
3. De eerste keer opent de link meteen een installatie in drie stappen. Stap 1, **Sta je al op deze website?**,
   vraagt of je Time Trial-tijden al op de site staan en of je hebt meegedaan aan een toernooi dat daar staat.
   Zo ja, dan zoek je in stap 2 de Player die jij bent en vraag je die aan je account te koppelen; een
   beheerder of de toernooidirecteur van die avond beoordeelt zo'n claim voordat hij gekoppeld wordt, en niets
   wordt alleen op naam gekoppeld. Zo nee, dan maakt stap 2 je Player aan (in een community waar alleen directeuren
   Players aanmaken, legt de stap uit aan wie je het moet vragen). Stap 3 biedt een paar optionele instellingen die je kunt overslaan.

Je account (het e-mailadres waarmee je je aanmeldt) en je Player (de naam op de ranglijsten) zijn twee verschillende dingen.

### Een Time Trial plaatsen

- **Tijd plaatsen** (bovenbalk), of **Circuits** → een circuit → **Tijd plaatsen**: vul je tijd in 150cc of 200cc in, controleer
  de waarden in de bevestiging en publiceer.
- **Scannen**: open `<your community address>/scanner/` op een telefoon of tablet. Richt de camera op het
  resultatenscherm op je tv, of kies **afbeelding uploaden** met een foto of screenshot. De scanner leest de tijden, rondes
  en, als ze zichtbaar zijn, het personage, de kartcombinatie en de vlag. Controleer elke waarde voordat je verstuurt; de herkenning kan
  fout zitten. De camera heeft een vertrouwd HTTPS-adres nodig (op `localhost` werkt hij ook); afbeelding uploaden werkt overal.
- Afhankelijk van de regels van de community wordt een inzending meteen gepubliceerd of wacht hij op beoordeling door een
  beheerder. Een beheerder kan een gepubliceerde tijd corrigeren of intrekken.

### Je voortgang volgen

**Circuits**, **Klassement** en **Records** tonen je beste tijden en rondes naast die van de community, je gekozen rivalen,
de Nintendo Ghost Staff en de wereldrecords. **Kart** helpt met personages en kartcombinaties, **Community**
toont andere Players en **Toernooien** de gepubliceerde toernooiavonden, standen en verslagen. Als iemand
een van je gepubliceerde tijden verbetert, krijg je een melding (de bel). De website kan ook pushmeldingen in de browser
sturen als je community dat heeft ingesteld; zet ze aan in je accountinstellingen.

De website is beschikbaar in de 15 talen van het spel (kies de jouwe in de instellingen). Engels en Nederlands zijn
nagekeken; de andere 13 zijn machinevertalingen, en verbeteringen zijn welkom: zie
[Change UI text and translations](../../../DEVELOPMENT.md#change-ui-text-and-translations) voor het bestand dat je aanpast en
[Contributing](../../../../.github/CONTRIBUTING.md) voor de pull request.

## De Android-app

De app biedt een snellere scan op de telefoon zelf, je tijden en meldingen. Hij is optioneel.

### Vereisten

- Android 8.0 of nieuwer; een arm64-telefoon wordt aanbevolen. De release-APK is groot (ongeveer 530 MB): houd ongeveer
  1 GB vrij tijdens het installeren.
- Een community die de app kan bereiken: een **online community** met een vertrouwd HTTPS-adres, of een **installatie thuis of
  bij de club** (A2) op hetzelfde wifi. Een adres dat alleen op een computer zelf werkt (`http://127.0.0.1:…`), werkt niet in de app.

### Installeren

1. Haal de APK van de pagina **Download de app** van je community als die downloads aanbiedt (je moet aangemeld zijn om
   ze te zien; dat is de build die je community ondersteunt), of van de pagina
   [GitHub Releases](https://github.com/fromthelake/MK8DX-Ecosystem/releases) van het project: neem
   `mk8dx-android-release-….apk`. Met een kloon van de repository kun je de APK ook zelf bouwen:
   [Client builds](../../../CLIENT_BUILDS.md#android).
2. Controleer het bestand met `SHA256SUMS.txt` uit dezelfde release (op een computer: `Get-FileHash` in PowerShell,
   `sha256sum` op Linux, `shasum -a 256` op macOS).
3. Zet de APK op de telefoon en open hem vanuit **Bestanden** of **Downloads**. Android vraagt of je installeren vanuit
   die app wilt toestaan; sta dat alleen toe voor dit gecontroleerde bestand en zet het daarna eventueel weer uit.

Dit is geen app uit de Play Store. Eerdere openbare APK's waren ondertekend met een debug-buildsleutel; de release-APK gebruikt de
vaste sleutel van de maintainer. Bewaar eerst resultaten die nog niet verstuurd zijn en verwijder een eerdere debug-APK één keer voordat je
deze release installeert. Latere APK's met dezelfde releasesleutel werken gewoon bij. Overstappen naar de APK van een community of een
zelfgebouwde APK met een andere sleutel vraagt ook eerst een verwijdering.

### Eerste start

De app opent op **Kies je community**, in de taal van de telefoon als de app die heeft. Wil je een andere
taal, tik dan bovenin op **Language / Taal** (met de wereldbol); de app onthoudt die keuze. Daarna vraagt de app één ding:
hoe jullie community speelt. Weet je het niet? Vraag het aan de
persoon die je community runt.

- **Thuis of bij de club** (A2, MK8DX draait daar op een computer): tik op **Scan de QR-code** en scan de kaart
  **Apparaat voorbereiden** die je beheerder op die computer laat zien of op papier uitdeelt. De telefoon moet op
  hetzelfde wifi zitten. De app toont dan het adres en de sleutel van de installatie; die staan ook op de pagina **Dit apparaat
  voorbereiden** bij **Volledige vingerafdrukken**. Tik op **Verbinden** als ze gelijk zijn. Geen internet nodig. Stap voor stap:
  [de A2-handleiding, hoofdstuk 7](../../../install/A2_THUIS_HANDLEIDING_NL.md#7-de-android-app-en-livetrial).
- **Online community** (een website op internet): vul het adres in waarmee je hem in de browser opent, bijvoorbeeld
  `https://www.example.org` (geen pad, geen slash aan het eind), en tik op **Opslaan**. Lukt het niet, open dan hetzelfde adres in
  de browser van de telefoon: het moet openen zonder certificaatwaarschuwing.

Thuis of bij de club (A2) vergelijk je eerst de controlecode van 16 tekens en tik je op **Verbinden**. Volg daarna de stappen in de app: **Certificaat opslaan**, **Instellingen openen** om het als CA-certificaat te installeren, en **Inlogkaart scannen** om je in de app aan te melden. Een browsercode is daarvoor niet nodig. Bij een online community tik je op het persoonspictogram en **Aanmelden** (of Instellingen › **Speler op deze telefoon**); de app opent dan je community in de browser voor goedkeuring.

### Je weg vinden

Bovenin de app staan het logo (terug naar Home), de **communitychip** met de naam van de community die je
gebruikt, de bel en je naam. Je naam opent **Jij**: je Player met **Speler wisselen**, en de tabbladen
**Mijn tijden**, **Records** en **Rivalen**, met daaronder een regel **Instellingen**.

- **Meerdere community's**: tik op de communitychip om **Communities** te openen. De actieve is groen; met **Community wisselen**
  ga je met één tik naar een andere, **Van deze telefoon verwijderen** vergeet er een (pas als er niets meer wacht op verzenden), en
  **Een community toevoegen** opent het scherm van de eerste start opnieuw. Elke community houdt een eigen aanmelding, eigen niet verzonden
  ritten en, thuis of bij de club, een eigen vertrouwen; er gaat niets vanzelf van de een naar de ander. Als de beheerder
  de community een naam heeft gegeven, toont de app die naam in plaats van het adres.
- **Mijn tijden** is één lijst: eerst je carrièrecijfers, daarna één regel per circuit en klasse met je persoonlijk record; tik op een
  regel voor oudere ritten en gebruik **⋯** bij een rit voor **Details**, **Bewerken**, **Intrekken** of
  **Meenemen naar een andere community…**.
- **Zonder internet**: de app bewaart per community een kopie van je eigen tijden en de beste tijden van je rivalen en
  toont die met "Offline — laatst bijgewerkt …".
- **Wacht op verzenden**: ritten die nog alleen op de telefoon staan, verschijnen als oranje balk op Home en Jij; tik erop,
  of gebruik Instellingen › **Bewaard op deze telefoon**, om ze te zien.
- **Instellingen** is verdeeld in **Speler**, **App**, **Community** en **Over**, en slaat elke wijziging meteen zelf op.
  De taal staat onder App; **Download de app** en **Bewaard op deze telefoon** staan onder Community; **Testscan uitvoeren**
  staat onder Over.

### Tijden meenemen naar een andere community

Hoor je bij meer dan één community, dan kan een tijd ook in een andere community meetellen: **Meenemen naar een andere community…**
bij een rit, of **Mijn beste tijden meenemen** onder je carrièrecijfers in Mijn tijden (circuits waar de andere community
al een betere tijd van jou heeft, worden overgeslagen). De kopie wacht tot je daar bent aangemeld. De **ontvangende**
community beslist: standaard neemt hij geen tijden van elders aan, hij kan een beheerder elke tijd eerst laten goedkeuren,
of hij neemt ze aan zoals elke andere tijd. Een meegenomen tijd laat altijd zien waar hij vandaan komt ("Meegenomen van … ·
oorspronkelijk …"). Hetzelfde origineel wordt maar één keer aangenomen; een gelijke tijd vult alleen aan wat er bij de bestaande rit
nog ontbrak.

### Meldingen

Meldingen in de app worden opgehaald uit de inbox van je community; de meldingstoestemming van Android en de
eigen schakelaar van de app moeten allebei aan staan.

## Problemen

- Geen aanmeldmail: kijk in je spammap, controleer het exacte adres en vraag een nieuwe link aan. Bij een lokale proefinstallatie komt de
  e-mail in de lokale testbrievenbus, niet in je eigen mailbox.
- Een claim wordt geweigerd met *Te veel claimacties op dit moment…*: wacht de genoemde tijd en probeer het opnieuw.
  Een account kan tegelijk hoogstens 5 claims hebben die op een beslissing wachten (een speler hoogstens 5 van alle
  accounts samen). Is die grens bereikt, wacht dan tot een openstaande claim is afgehandeld, of trek er een in met
  **Dit verzoek intrekken**, en probeer het opnieuw.
- Ziet iets er verkeerd uit op de site van je community: vraag het eerst aan de mensen die hem runnen. Fouten in de software zelf
  kun je melden in de issues van het project; zie [SUPPORT.md](../../../../.github/SUPPORT.md). Plaats nooit aanmeldlinks of de namen van
  andere mensen.
