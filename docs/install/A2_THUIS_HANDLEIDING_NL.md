# MK8DX thuis of op de club — handleiding

MK8DX draait op één Windows-computer in je eigen netwerk. Iedereen op hetzelfde wifi- of kabelnetwerk kan meedoen met een persoonlijke inlogkaart. Er is geen internet en geen cloudaccount nodig.

## Installeren

1. Installeer Docker Desktop (gratis) en start het. Wacht tot het "Engine running" toont.
2. Pak het MK8DX-pakket uit en dubbelklik **Start-MK8DX-LAN.cmd**.
3. De installatie opent in je browser. Klik steeds op **Volgende**; alles staat al goed ingesteld.
4. Bij **Installeren** vraagt Windows één keer om toestemming om je thuisnetwerk voor MK8DX open te zetten. Klik op **Ja**.
5. Vul je naam in voor het beheerdersaccount.
6. Voeg desgewenst meteen familie, vrienden of clubleden toe (of sla dit over).
7. Laat iedereen zijn eigen inlogkaart scannen.

## Inloggen op een telefoon, tablet of pc

- **Eerste keer op een apparaat:** scan de kaart **Apparaat voorbereiden**. Die pagina laat zien hoe het apparaat deze installatie gaat vertrouwen. Controleer dat de vingerafdruk gelijk is aan die in MK8DX beheer.
- **Inloggen:** scan je **persoonlijke kaart** en tik op **Uitnodiging accepteren**. Een kaart werkt één keer en 15 minuten lang; vraag zo nodig een nieuwe.
- **Nog een apparaat:** vraag in MK8DX beheer een nieuwe kaart voor jezelf en scan die met het andere apparaat.
- **Uitloggen:** via het accountmenu rechtsboven op de website.

## Beheer (mensen en kaarten)

Dubbelklik **MK8DX beheer** op het bureaublad van de computer waarop MK8DX draait. Je komt direct in het overzicht:

- **Mensen toevoegen:** namen invullen, één per regel, en **Toevoegen**.
- **Kaart maken:** kies bij een persoon **Kaart maken** en laat die scannen. **Kaarten afdrukken** drukt alle getoonde kaarten af.
- **Kaart kwijt of verkeerd uitgedeeld?** Kies **Kaart intrekken**; de kaart werkt dan meteen niet meer. **Nieuwe kaart** trekt de vorige kaart van die persoon ook in.

Iedereen kiest of claimt daarna op de website zijn eigen Player. Namen worden nooit automatisch aan elkaar gekoppeld.

## Dagelijks gebruik

- MK8DX start vanzelf zodra Docker Desktop draait. Met de standaardkeuze **MK8DX starten met Windows** start Docker Desktop mee bij het aanmelden.
- De computer met MK8DX moet aan staan en op het netwerk zitten wanneer iemand wil spelen.
- **De Android-app en LiveTrial op een tweede pc** koppel je met dezelfde kaarten; zie `docs/install/A2_EIGEN_NETWERK.md` in het pakket.

## Back-ups en een nieuwe computer

- Met de standaardkeuze **Elke nacht een back-up maken** zet MK8DX elke nacht om 03:00 een versleutelde back-up in **Documenten\MK8DX-backups**. De laatste 7 blijven bewaard. Kopieer die map af en toe naar een USB-stick of een andere schijf.
- Een back-up opent alleen met de **herstelcode** die de installatie één keer liet zien. Zonder die code is een back-up onbruikbaar, ook voor jezelf. Bewaar hem op papier.
- **Op een nieuwe computer terugzetten:** installeer Docker Desktop, kopieer de back-upmap naar **Documenten\MK8DX-backups** (of houd de USB-stick erin), pak het MK8DX-pakket uit en dubbelklik **Start-MK8DX-LAN.cmd**. Kies op het welkomstscherm **Een back-up terugzetten**, kies de back-up, vul de herstelcode in en klik op **Terugzetten**. Iedereen, alle tijden, toernooien en instellingen komen terug.
- Telefoons en pc's blijven de installatie vertrouwen. Heeft de nieuwe computer een ander adres, dan scant iedereen één keer de kaart **Apparaat voorbereiden** en logt opnieuw in; gekoppelde apps koppel je opnieuw.

## Instellingen en geavanceerd

- **Ander netwerkadres:** kies in de installatie bij *Netwerk* de knop **Geavanceerd**. Geef de computer bij voorkeur een vaste reservering in je router, zodat het adres niet verandert. Kreeg de computer toch een ander adres (nieuwe router, ander netwerk)? Open **MK8DX beheer**: het ziet dat vanzelf en biedt **Verhuizen** aan. Telefoons en pc's blijven MK8DX vertrouwen; ze scannen één keer de kaart **Apparaat voorbereiden** en loggen opnieuw in.
- **Updates en andere installatieroutes** (één computer, eigen server, webhosting): zie de volledige handleiding `docs/install/MK8DX_Handleiding_NL.txt` in het pakket.
- **Voor IT-specialisten:** alles kan ook via de opdrachtregel met `tooling/install.py` (bijvoorbeeld `status`, `check`, `backup`, `maintain-ca`).

## Problemen

- **"Docker Desktop draait niet":** start Docker Desktop en klik op **Opnieuw proberen**.
- **Telefoon kan de site niet openen:** controleer dat de telefoon op hetzelfde netwerk zit (niet op mobiele data) en dat de computer met MK8DX aan staat.
- **Kaart werkt niet meer:** kaarten zijn eenmalig en 15 minuten geldig; maak een nieuwe in MK8DX beheer.
- **"Deze herstelcode opent de back-up niet":** controleer de code (hoofd- of kleine letters en streepjes maken niet uit) en kies de juiste back-up.
