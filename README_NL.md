# MK8DX Ecosystem

Taal: [English](README.md) · Nederlands

Een Time Trial gereden in Mario Kart 8 Deluxe? Open de scanner van de MK8DX-website van je community op
een telefoon of tablet, richt de camera op het resultaatscherm op je tv, en de scanner leest de tijden en
rondes voor je. Op de website volg je je voortgang en vergelijk je met vrienden, rivalen, de Nintendo Ghost
Staff en wereldrecords. MK8DX Ecosystem ondersteunt ook toernooien: organisatoren richten de avond in,
leggen de races vast, controleren de uitslagen en publiceren standen en een verslag.

Het project is zelf te hosten: elke community draait een eigen installatie met eigen accounts en uitslagen.

## Wat het doet

- **Time Trials scannen vanaf je tv.** De browserscanner leest totaal- en rondetijden en, als ze zichtbaar
  zijn, het personage, de kart en de vlag. Je controleert het resultaat voordat je het instuurt. Voor de camera
  is een vertrouwde HTTPS-verbinding nodig; je kunt ook een foto of schermafbeelding uploaden. De optionele
  Android-app scant sneller op het toestel zelf.
- **Tijden vergelijken.** Je beste tijd en rondes per baan naast communityuitslagen, gekozen rivalen, de
  Nintendo Ghost Staff en wereldrecords. Verbetert iemand een van je gepubliceerde tijden, dan krijg je een
  melding.
- **Runs opnemen met LiveTrial.** Een Windows-programma voor een capturekaart of bestaande video's. Het
  herkent nieuwe runs, bewaart de gegevens en clips, en stuurt uitslagen naar je community nadat je één keer
  hebt aangemeld.
- **Toernooien organiseren.** Deelnemers, groepen en consoles; Tournament Processor leest opgenomen races en
  Tournament Live legt vast tijdens het evenement. Na controle van spelers en plaatsen berekent de website
  scores, standen en finales en publiceert een verslag, ook als WordPress-export.

Herkenning alleen maakt een uitslag nooit officieel. Waar de regels dat vragen, controleert een bevoegd
persoon een inzending voordat die openbaar wordt.

## Handleidingen

Begin bij de handleiding voor wat je wilt doen (de korte handleidingen zijn in het Engels):

| Ik wil… | Handleiding | Platform |
| --- | --- | --- |
| **de website voor mijn community hosten** (eigen server) | [Host a community server](docs/guides/HOSTING.md) | Linux met Docker (hoofdroute); Windows; webhosting |
| **toernooiavonden leiden** als Tournament Director | [Tournament Directors](docs/guides/TOURNAMENT_DIRECTORS.md) | website, plus de Windows-toernooitools |
| **mijn Time Trials posten en vergelijken** op de website of in de Android-app | [Players](docs/guides/PLAYERS.md) | elke browser; Android 8.0+ |
| **Time Trials opnemen met een capturekaart of uit video's** | [LiveTrial](docs/guides/LIVETRIAL.md) | Windows |
| **de code aanpassen**, tests draaien of een pull request sturen | [Ontwikkelen](docs/DEVELOPMENT_NL.md), [Testen](docs/TESTING_NL.md), [Contributing](CONTRIBUTING.md) | Windows, Linux; macOS ongetest |

De volledige stap-voor-stap-handleiding voor elke installatieroute, met backup, herstel en updates, is
[docs/install/MK8DX_Handleiding_NL.txt](docs/install/MK8DX_Handleiding_NL.txt)
([Word](docs/install/MK8DX_Handleiding_NL.docx)). Vragen: [Getting help](SUPPORT.md).

## Status

**Voorlopige versie.** Releasekandidaten van versie 0.1.0 verschijnen op de
[GitHub Releases](https://github.com/fromthelake/MK8DX-Ecosystem/releases)-pagina van het project; de
[changelog](CHANGELOG.md) noemt wat er veranderde. Website, API, browserscanner en installer zijn getest op
Windows 11 met de Linux/amd64-Docker-images en met XAMPP/Node.js. **Nieuw in 0.2.0: MK8DX thuis of op de club
(A2)**, met een begeleide installatie zonder internet, van begin tot eind getest op Windows 11
([handleiding](docs/install/A2_THUIS_HANDLEIDING_NL.md)). Andere platforms staan onder
[Platforms](#platforms).

## Downloaden

Releasepakketten hangen aan de [GitHub Releases](https://github.com/fromthelake/MK8DX-Ecosystem/releases) van
het project. Download het pakket voor jouw route uit de nieuwste release, samen met `SHA256SUMS.txt`, en
controleer de checksum zoals de handleiding uitlegt. [Release packages](docs/RELEASE_PACKAGES.md) legt uit welk bestand bij
welke route hoort. GitHubs automatische **Source code (zip)** is de volledige broncode, geen installatiepakket.

| Route | Pakket | Status |
| --- | --- | --- |
| A1: website op één computer, met Docker | `mk8dx-host-local-…-amd64.zip` | Ondersteund ([handleiding](docs/install/A1_EEN_COMPUTER.md)) |
| A2: thuis of op de club zonder internet, met begeleide installatie | `mk8dx-a2-<platform>-<arch>-….zip` | Getest op Windows 11 ([handleiding](docs/install/A2_THUIS_HANDLEIDING_NL.md)); Linux in WSL 2; macOS niet getest |
| A3: website op Windows zonder Docker (XAMPP en Node.js) | `mk8dx-xampp-node-windows-….zip` | Ondersteund |
| B1: website op een eigen VPS met Docker | `mk8dx-host-local-…-amd64.zip` | Beschreven; nog niet van begin tot eind getest ([handleiding](docs/install/B1_VPS.md)) |
| B2: website op webhosting met Node.js en MariaDB | `mk8dx-mijnhost-node-….zip` | Beschreven; nog niet van begin tot eind getest |
| Android-app | Lokaal release-ondertekende `mk8dx-android-release-….apk` met de notices-ZIP | Eerdere publieke debug-APK's moeten één keer verwijderd worden |
| LiveTrial (Windows) | `desktop-client-….zip` | Windows-pakket |
| Toernooitools (Windows) | `tournament-tools-….zip` | Windows-pakket |
| Volledige broncode met de assetcollectie | `mk8dx-full-local-….zip` | Bronpakket |

Volg daarna de handleiding: [Nederlands](docs/install/MK8DX_Handleiding_NL.txt)
([Word](docs/install/MK8DX_Handleiding_NL.docx)) of [English](docs/install/MK8DX_User_Guide_EN.txt)
([Word](docs/install/MK8DX_User_Guide_EN.docx)). Die loopt installatie, apps, instellingen, backup en herstel
stap voor stap door. Technische naslag per route staat in [docs/install](docs/install/A1_EEN_COMPUTER.md).

**Heb je een kloon van deze repository?** Bouw en start hem vanuit de broncode met
[Getting started](docs/GETTING_STARTED.md); de launchers hierboven hebben de kant-en-klare images van een releasepakket nodig.
Je kunt de pakketten ook zelf bouwen: het Docker-hostpakket zoals in
[Host a community server](docs/guides/HOSTING.md#build-the-host-package-from-a-clone), de Android-app, LiveTrial
en de toernooitools zoals in [Client builds](docs/CLIENT_BUILDS.md).

## Documentatie

| Ik wil… | Lees |
| --- | --- |
| de onderdelen begrijpen en zien hoe een uitslag reist | [Architectuur](docs/architecture/COMPONENTS_NL.md) |
| code bouwen of aanpassen | [Ontwikkelen](docs/DEVELOPMENT_NL.md) en [Testen](docs/TESTING_NL.md) |
| de clients bouwen | [Client builds](docs/CLIENT_BUILDS.md) (Engels) |
| een installatie beheren (backup, upgrade, herstel) | [Beheer](docs/OPERATIONS_NL.md) |
| bijdragen | [Contributing](CONTRIBUTING.md), [Gedragscode](CODE_OF_CONDUCT.md) (Engels) |
| een beveiligingsprobleem melden | [Security policy](SECURITY.md) (Engels) |

## Wat draait waar

| Onderdeel | Rol | Draait op |
| --- | --- | --- |
| Website, browserscanner en gateway | Openbare pagina's, beheer en scannen | De serverinstallatie |
| API en MySQL/MariaDB | Aanmelden, inzendingen, controle, publicatie en gegevens | Dezelfde installatie |
| Android | Mobiel scannen en insturen | Een telefoon; de gebruiker kiest de community |
| LiveTrial | Herkent en verstuurt opnames of captureresultaten | Windows |
| Tournament Processor, Live en Connect | Herkennen races en leveren ze na controle aan | Windows |

Een nieuwe installatie begint leeg: er worden geen communityaccounts of uitslagen overgenomen. Alleen de
spelcatalogus en de referentiesets Nintendo Ghost Staff en World Records zitten erin.

## Platforms

- **Windows 11 x86-64**: volledig getest met Docker en met XAMPP/Node.js, inclusief LiveTrial- en Tournament
  Processor/Connect-uitslagen die op de website verschijnen.
- **Linux x86-64**: het Docker-hostpakket heeft een shell-starter (`tooling/start-mk8dx.sh`). Gedemonstreerd op
  een Linux Docker Engine (in een container, niet op Ubuntu zelf): pakketstarter, eerste installatie,
  aanmelden, eerste beheerder, backup, update en herstel, en de bronroute. Een publieke B1-installatie met echt
  domein en echte mailprovider is nog niet getest. LiveTrial en de toernooitools zijn Windows-programma's.
- **macOS**: een Intel-Mac kan het Docker-hostpakket met Docker Desktop proberen; Apple Silicon heeft
  amd64-emulatie nodig. Niet volledig geaccepteerd; de Windows-clients draaien niet op macOS.
- **ARM-servers**: nog geen eigen images.
- Nog niet geverifieerd: fysieke capture met Tournament Live, een nieuwe installatie bij een echte externe host.

## Licentie en Nintendo

Dit is een onafhankelijk, niet-commercieel hobbyproject om te leren programmeren en Mario Kart 8 Deluxe nog
leuker te maken. Het is **niet verbonden aan of goedgekeurd door Nintendo**. Nintendo is eigenaar van zijn
merken en spelinhoud; steun Nintendo door consoles en games te kopen.

De eigen code en documentatie van het project vallen onder de [Mozilla Public License 2.0](LICENSE). De
[licentiereikwijdte](LICENSE_SCOPE.md) legt uit wat dat dekt: **niet** Nintendo-materiaal, spelafbeeldingen,
herkenningssjablonen, modellen, lettertypen of ander materiaal van derden; dat houdt zijn eigen voorwaarden.
Zie [Third-party materials](docs/THIRD_PARTY_MATERIALS.md). De software wordt geleverd zoals hij is.
