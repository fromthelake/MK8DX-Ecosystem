# MK8DX Ecosystem

**Host je eigen Mario Kart 8 Deluxe-communitywebsite — voor Time Trials *én* toernooiavonden.**

Taal: [English](README.md) · Nederlands · [Deutsch](README_DE.md) · [Español](README_ES.md) · [Français](README_FR.md) · [Italiano](README_IT.md) · [Português](README_PT.md) · [Русский](README_RU.md) · [日本語](README_JA.md) · [한국어](README_KO.md) · [简体中文](README_ZH_CN.md) · [繁體中文](README_ZH_TW.md)

![De startpagina van een communitywebsite: je stand, je focusbanen en je rivalen](docs/readme/web-home.jpg)

MK8DX Ecosystem host je zelf. Het geeft je community één website die twee soorten uitslagen
bijhoudt — **Time Trial-uitslagen** en **toernooi-uitslagen** — en bij elk zijn eigen soort
competitie toevoegt.

**⏱️ Time Trials**

- **Ranglijsten** per baan en klasse (150cc/200cc), voor je community en naast de
  **wereldrecords**, die één keer per dag worden ververst.
- **Rivalen**: stel ze één keer in en zie altijd hoe ze er tegenover jou voor staan.
- **Voer een tijd in zoals jij wilt**: met de hand, door het resultaatscherm te scannen met een
  camera — op de website of in de Android-app — of laat de Windows-applicatie **LiveTrial** elke
  rit vanzelf vastleggen via een capture card.
- **LiveTrial ziet de race zelf**: wanneer je munten pakt, wanneer je je paddenstoelen gebruikt —
  en het maakt van **elke rit een videoclip** die je zelf mag gebruiken.

**🏁 Toernooien**

- **LAN-avonden van aanmelding tot finale**: indeling, groepen, scores en standen, voor je geregeld.
- **Uitslagen van het scherm gelezen** door Tournament Live, en door de organisator gecontroleerd
  voordat ze tellen.
- **TrueSkill-rating**: een vaardigheidsrating die met elke toernooiavond meegroeit.
- **Geen account nodig om mee te doen**: je kunt een toernooi organiseren zonder dat iemand zich
  hoeft aan te melden. Wil een speler zijn uitslagen op een eigen account, dan koppelt hij ze
  later — nooit een verplichting.

**✨ Wat het uniek maakt**

Tot nu toe was er geen degelijke manier om de gegevens van Mario Kart 8 Deluxe op een Nintendo
Switch via een capture card uit te lezen: het was vooral overtypen, of OCR die alleen tekst leest.
MK8DX leest de tijden, posities en punten *en* herkent de plaatjes: het **character (inclusief de
juiste kleur)**, de **kart, banden, glider** en **vlag** — overal waar het spel ze laat zien.

En daarvoor heb je niet eens een capture card nodig: richt vanaf de bank je telefoon op de tv,
scan een Time Trial-**resultaatscherm** of een **Select-a-Ghost-scherm**, en de uitslag gaat
meteen naar je website. Voor zover wij weten was ook dat nog niet eerder gedaan.

**🏠 Thuis of online — jij kiest**

- **Volledig lokaal**: draai het op je thuis- of clubnetwerk. Na de installatie is **helemaal
  geen internet nodig**.
- **Online**: host het op je eigen server of webhosting en deel het met je eigen online
  community.

Hoe dan ook is het jouw installatie, met je eigen accounts en uitslagen. Geen cloudaccount, geen
abonnement, geen reclame.

**🔑 Nooit wachtwoorden**

- **Alleen de beheerder heeft een account nodig.** Dat account is ook de eerste speler, zodat er
  altijd minstens één speler is; alle anderen kunnen zonder account aan toernooien meedoen.
- **Eén link om in te loggen**: niemand hoeft een wachtwoord te verzinnen of te onthouden. Thuis
  krijgt iedereen een persoonlijke inlogkaart (een link of QR-code). Online vult een nieuwe
  gebruiker alleen een **e-mailadres** in en logt in met de link die MK8DX stuurt.

---

## 🏁 LAN-toernooiavonden

Weet je nog, LAN-party's? Twee spelers per scherm, een zaal vol Switches, iedereen schreeuwend op
Rainbow Road. MK8DX brengt die avond terug en regelt alles rond het racen: wie waar zit, welke
groep als volgende speelt, de scores, de finales en de standen.

- **Aanmelden** — open de aanmelding voor een avond met een sluitingstijd en een maximum; wie het
  eerst komt, of een eerlijke loting met een gepubliceerde seed. Spelers melden zich aan met de
  Switches die ze meenemen.
- **Een indeling die zichzelf maakt** — aanwezigheid, consoles en plaatsen (twee spelers per
  Switch), station- en kabelnummers. Kies indelen op rangorde of willekeurig, en plaatsing
  *Gebalanceerd* of *Minimaal verplaatsen*; MK8DX maakt de voorrondegroepen en daarna de finales.
- **Tournament Live leest de races** — zet een capture card op elk scherm. Na elke race leest het
  de eindposities, characters, vlaggen, racepunten, totalen en de baan (ook in split screen met
  twee spelers), slaat ze lokaal op en stuurt ze naar de avond op de website.
- **Jij houdt de regie** — de organisator controleert spelers en plaatsen voordat een uitslag
  telt. Live-standen worden in de tussentijd voorlopig getoond.
- **Na afloop** — eindstanden, een deelbaar verslag (WhatsApp, PNG, CSV, een artikel klaar voor
  WordPress) en een optionele TrueSkill-communityrating over alle avonden.

![Tournament Live na een race: het beeld van de capture card, en de eindvolgorde met het character en de punten van elke rijder](docs/readme/tournament-live.jpg)

<p>
  <img src="docs/readme/tournament-results.jpg" alt="Eindstand van een toernooiavond: voorrondegroepen met het character van elke speler, gekleurd naar de finale waarin ze verder gingen" width="49%">
  <img src="docs/readme/tournament-skill.jpg" alt="Pagina toernooivaardigheid: TrueSkill-rating, overwinningen, top 3 en gemiddelde eindpositie van een speler" width="49%">
</p>

### Geen Tournament Live op de avond? Analyseer de opnames achteraf

Heb je de avond opgenomen in plaats van live vastgelegd? Het venster **Tournament Analysis** leest
de opnames achteraf: voeg één video toe, meerdere, of een map per toernooi, kies **ANALYSE
STARTEN**, en het vindt elke race met de posities, characters en punten, terwijl een live log in
kleur en een Rainbow Road-voortgangsbalk laten zien hoe ver het is. Het resultaat is een
Excel-werkmap, een CSV en een importbestand voor de website, dat de organisator controleert en
importeert — dezelfde controle als bij Tournament Live. Een opname van 22 minuten met vier races duurde op een laptop ongeveer 70 seconden. Dubbelklik in het Windows-pakket
Tournament Tools op `TournamentAnalysis.cmd` (een video naar `TournamentProcessor.cmd` slepen
werkt nog steeds); ontwikkelaars starten `python -m tournament_processor.gui`.
[Tournament Directors](docs/guides/TOURNAMENT_DIRECTORS.md#analyse-recordings-afterwards) (Engels)
beschrijft de stappen.

![Venster Tournament Analysis tijdens een analyse: links een map met één cup-opname aangevinkt, de analyse loopt; rechts het gekleurde activiteitenlog met gevonden races, en onderaan de Rainbow Road-voortgangsbalk op 56% en de klok](docs/readme/tournament-analysis.jpg)

## ⏱️ Time Trials met LiveTrial — volledig automatisch

Sluit je Switch via een capture card aan op je Windows-pc en race gewoon. Voor zover wij weten
bestond zoiets nog niet.

LiveTrial kijkt mee met het HDMI-beeld en herkent zelf:

- de menu's waar je doorheen gaat, de **baan** en de **klasse** (150cc/200cc);
- tijdens de race: de **raceklok, de rondeteller, munten en items**;
- op het resultaatscherm: de **totaaltijd, elke rondetijd** (3, of 7 op Baby Park), **character,
  kart, banden, glider** en **vlag**;
- het **Select-a-Ghost**-paneel — ghostnamen, tijden, rondes en onderdelen — en of een ghost een
  van de **staff ghosts van Nintendo** is;
- automatisch je **Switch-taal** (alle 12 systeemtalen).

Het bewaart een **clip van elke race** en van elke ghost-herhaling die je tot de finish bekijkt,
een rittengeschiedenis met rondetabellen en grafieken, en laat je achterstand zien op het
**wereldrecord**, de **staff ghost van Nintendo**, je **eigen record** en je **rivalen**. Stuur
uitslagen met één klik naar je community (of zet automatisch versturen aan), en upload desgewenst
een clip naar je eigen YouTube-kanaal.

![LiveTrial tijdens een rit op Baby Park: ronde 4 van 7, munten en paddenstoelen live geteld, elke ronde vergeleken met de ghost](docs/readme/livetrial-live.jpg)

![De ritkaart van LiveTrial achteraf: totaaltijd, verschil met de ghost, munten en paddenstoelen](docs/readme/livetrial-run.jpg)

## 📱 Scannen vanaf de bank

Time Trials bij een vriend? Pak je telefoon of tablet, richt hem op de tv en de scanner leest het
resultaatscherm: **totaal, rondes, character, kart, banden, glider, vlag en spelersnaam**, of een
**ghostpaneel** met de baan en tijden. Wat onzeker is, krijg je te zien met alternatieven, zodat
je het juiste kiest voordat je publiceert.

De browserscanner draait **volledig op je eigen apparaat** — geen account, geen server, en na de
eerste download ook offline. De Android-app scant ook op het toestel zelf.

<p>
  <img src="docs/readme/scanner-reading.jpg" alt="De browserscanner leest een telefoonfoto van een Select-a-Ghost-scherm" width="32%">
  <img src="docs/readme/scanner-filled.jpg" alt="Het formulier ingevuld door de scan: character, kart, banden, glider, vlag en rondetijden, met het ene onzekere onderdeel gemarkeerd" width="32%">
</p>

## 🏆 Jouw records, jouw rivalen

Elke speler krijgt eigen records per baan, een ranglijst met familie, vrienden of de club, rivalen
om op te jagen (met porren, uitdagingen en af en toe een dobbelsteenduel), meldingen als iemand je
tijd verbetert, en **23 masteryniveaus** gemeten aan de huidige wereldrecords.

<p>
  <img src="docs/readme/timetrials-leaderboard.jpg" alt="Ranglijst van Rainbow Road met het wereldrecord, combo's, paddenstoelen en munten per ronde" width="72%">
  <img src="docs/readme/phone-leaderboard.jpg" alt="Dezelfde ranglijst op een telefoon, in het donkere thema" width="24%">
</p>

## 🌍 Spreekt je taal — alle 15

Mario Kart 8 Deluxe wordt overal gespeeld, dus MK8DX is gebouwd voor elke speltaal: de website, de
Android-app, LiveTrial en de Tournament-tools zijn er in **15 talen**, en de herkenning is gebouwd
voor **alle 15 taalvarianten van het spel** — van Nederlands en Engels tot Japans, Koreaans,
Chinees, Russisch en meer. Engels en Nederlands zijn door mensen nagekeken; de andere talen zijn
machinaal vertaald en de herkenning wordt in een deel ervan nog op echte consoles gecontroleerd.
Speel je in jouw taal? Jouw hulp bij het controleren is de waardevolste bijdrage die er is.

## 💡 Het verhaal erachter

**Het begon allemaal met een lokaal Mario Kart-toernooi, een paar enthousiastelingen en een uitnodiging in december 2023.**

Geloof het of niet: ik had Mario Kart nog op de Nintendo 64 gespeeld, maar Mario Kart 8 Deluxe had ik nauwelijks aangeraakt. Ik wist niet eens dat driften bestond. Ik had dus nogal wat in te halen.

Wat ik ontdekte, was een geweldige groep mensen die het oprecht heerlijk vond om anderen samen te brengen om te racen.

En die groep bleef groeien.

Wat begon met slechts 16 spelers, groeide uit tot een community van meer dan 68 deelnemers, met tot wel **36 spelers op één avond**. Samen hebben ze **meer dan 1.000 geregistreerde races** gereden, verspreid over alle 96 banen en talloze uren vriendschappelijke strijd.

De opstelling groeide net zo hard mee. Wat begon met **wifi, een GoPro, een hoop handmatig nakijkwerk en verbindingsproblemen genoeg**, werd stap voor stap capture cards, een volledig bekabeld ethernetnetwerk, automatische raceregistratie en 36 spelers die het tegen elkaar opnemen in een loods vol consoles, schermen, kabels, vrienden en natuurlijk pizza.

En elk toernooi bracht weer nieuwe ideeën.

We begonnen scores te analyseren, prestaties bij te houden, de zitindeling te optimaliseren en uit te zoeken hoe we de steeds ingewikkeldere klus konden automatiseren om spelers tussen Nintendo Switches te laten doorschuiven, inclusief het omwisselen van ethernetkabels. Iedereen die ooit zoiets heeft georganiseerd, weet dat het racen soms nog het makkelijkste deel is.

**Toen kwamen de Time Trials.**

Wat begon als een kleine competitie, werd al snel een vriendschappelijke strijd om nog net een paar milliseconden van onze tijden af te schaven. Vooral Baby Park en Big Blue op 150cc werden echte favorieten. Er was altijd wel iemand die een snellere ronde neerzette, en altijd wel iemand die vastbesloten was die weer te verbeteren.

Natuurlijk wilden we ook die resultaten goed bijhouden. Hetzelfde enthousiasme waarmee we onze toernooien verbeterden, vond zijn weg naar het automatisch vastleggen van Time Trials, beeldherkenning, statistieken, ranglijsten en meer.

Het ene leidde tot het andere, en voor ik het wist, besteedde ik bijna net zoveel tijd aan het bouwen van tools rond Mario Kart als aan het spelen ervan.

### Van passie naar een open-source ecosysteem

MK8DX Ecosystem is sinds 2024 in ontwikkeling, met heel veel hulp van AI — of wat we tegenwoordig *vibe coding* noemen.

En laat ik daar duidelijk over zijn: **zonder AI had ik dit niet kunnen bouwen, en zonder mij had AI het ook niet gekund.**

Alles werkend krijgen vroeg ongelooflijk veel experimenteren en geduld: spellogica uitleggen, screenshots nakijken, fouten corrigeren en de AI weer de goede kant op sturen. Soms keer op keer op keer.

Er zijn genoeg sessies geweest die vrolijk credits verbrandden zonder ook maar iets op te leveren. Daar lig ik nog steeds wakker van (haha).

En visueel testen levert blijkbaar nogal wat data op. Inmiddels zit ik op ongeveer 4 TB aan door AI gemaakte QA-screenshots en -opnames die ik echt een keer moet opruimen.

De afzonderlijke technieken bestonden al, maar ze samenbrengen tot een werkend ecosysteem dat begrijpt wat er op het scherm gebeurt, spelinformatie uitleest en die bruikbaar maakt voor spelers en organisatoren, was een flinke reis. Hetzelfde geldt voor het verzamelen en ordenen van alle spelonderdelen die daarvoor nodig zijn.

Het is een ongelooflijke leerschool geweest, vooral op het gebied van beeldherkenning, automatisering en softwareontwikkeling.

Nu, in 2026, kan ik het resultaat eindelijk delen als **open-source ecosysteem**, zodat anderen het kunnen gebruiken, verbeteren en er hopelijk net zoveel plezier aan beleven als wij.

### ❤️ Voor Volkert

Ik wil een deel van dit project ook opdragen aan onze dierbare vriend en rivaal **Volkert**, die veel te vroeg is overleden.

Volkert was zo iemand die ons steeds weer inspireerde om nét iets harder te pushen, die snellere racelijn te vinden en nog één Time Trial te proberen. De vriendschappelijke rivaliteit, vooral rond Baby Park en Big Blue, maakte de competitie iets bijzonders.

Maar meer nog dan de rondetijden of de ranglijsten gaat het om de momenten samen. Met vrienden in een loods zitten, lachen, strijden, pizza delen en genieten van iets simpels als een spelletje.

Dat zijn de momenten die het waard zijn om te onthouden.

Volkert, bedankt voor de strijd, de inspiratie en de herinneringen. Je blijft altijd een deel van dit verhaal.

### Blijf racen, blijf delen

We beweren niet dat we de beste spelers of de beste ontwikkelaars zijn, of dat we de perfecte oplossing hebben gebouwd. Maar aan enthousiasme, nieuwsgierigheid en de vastberadenheid om steeds beter te worden is zeker geen gebrek.

Als dit project je helpt om een LAN-toernooi te organiseren, een vriendschappelijke rivaliteit te beginnen, een persoonlijk record te verbreken of gewoon een topavond met vrienden te hebben, dan heeft het iets waardevols bereikt.

**Blijf alsjeblieft je mooiste momenten, je ideeën en je verbeteringen delen.** Dat is wat een community als deze levend houdt.

En tot slot een dikke dankjewel aan **Nintendo** voor het maken van zulke fantastische consoles en games. Geniet je van Mario Kart, steun dan de mensen die het mogelijk maken: koop de originele consoles en games, nodig je vrienden, familie of collega's uit en geniet ervan om samen te spelen.

Zo is dit hele avontuur tenslotte ook begonnen.

— [fromthelake](https://github.com/fromthelake)

## 🛠️ Maak het van jezelf

MK8DX is open source, gebouwd door spelers voor spelers. Draai het voor je club, je familie of de
LAN-scene in je stad; pas het aan aan hoe *jouw* avonden werken; en bouw erop verder:

- **Vertaal of controleer** jouw taal (de website, de apps en de herkenning in het spel).
- **Test de herkenning** met je eigen console, taal en capture card, en meld wat hij mist.
- **Voeg toe wat je community nodig heeft** — nieuwe toernooivormen, statistieken, manieren om
  uitslagen te delen.
- **Verbeter de documentatie**, zodat de volgende organisator nog sneller op weg is.

Begin bij [Bijdragen](CONTRIBUTING.md) en de [ontwikkelaarshandleiding](docs/DEVELOPMENT_NL.md).
Elke pull request, foutmelding en vertaalverbetering maakt de volgende LAN-avond beter voor
iedereen.

---

## Aan de slag

| Ik wil… | Begin hier |
| --- | --- |
| **MK8DX thuis of bij mijn club draaien** | Het A2-pakket voor je computer van [Releases](https://github.com/fromthelake/MK8DX-Ecosystem/releases): uitpakken, starten, op Volgende klikken. Stap voor stap met plaatjes: [Nederlands](docs/install/A2_THUIS_HANDLEIDING_NL.md) · [English](docs/install/A2_HOME_GUIDE_EN.md) |
| **LAN-toernooiavonden organiseren** | [Tournament Directors](docs/guides/TOURNAMENT_DIRECTORS.md) (Engels) |
| **mijn Time Trials automatisch vastleggen** | [LiveTrial](docs/guides/LIVETRIAL.md) (Engels) — Windows + een capture card |
| **mijn tijden posten en vergelijken** | [Players](docs/guides/PLAYERS.md) (Engels) — elke browser; Android 8.0+ |
| **een communitywebsite hosten** | [Een communityserver hosten](docs/guides/HOSTING.md) (Engels) |
| **de code aanpassen** | [Ontwikkelaarshandleiding](docs/DEVELOPMENT_NL.md), [Testen](docs/TESTING_NL.md), [Bijdragen](CONTRIBUTING.md) |

### Welke computer voor welke route

Elke route geeft je dezelfde website; ze verschillen in waar hij draait en wie hem kan bereiken.

| Route | Voor | Draait op | Status |
| --- | --- | --- | --- |
| **A2** thuis- of clubnetwerk | Je eigen netwerk, na de installatie geen internet nodig, inlogkaarten voor iedereen | Windows 11 (x86-64), Linux (x86-64 of arm64), Mac (Apple-chip of Intel) | Volledig getest op Windows 11; Linux in WSL 2; Mac gebouwd, nog niet op een echte Mac getest |
| **A1** één computer | Uitproberen op de computer waar je achter zit | Windows 11 of Linux, x86-64, met Docker | Getest: installeren, bijwerken, back-up |
| **A3** één computer zonder Docker | Een Windows-pc waar Docker geen optie is | Windows 11 met XAMPP en Node.js | Getest: installeren, bijwerken, back-up |
| **B1** openbare website | Je online community, je eigen domein en e-mail | Een Linux x86-64-server (VPS) met Docker; Ubuntu 24.04 beschreven | Beschreven, nog niet volledig getest |
| **B2** webhosting | Online, zonder eigen server | Een hostingpakket met Node.js (Passenger), MariaDB/MySQL en SSH | Onze eigen communitysite draait zo; het openbare pakket is nog niet vanaf nul op een nieuw hostingaccount geïnstalleerd |

De apps eromheen:

| App | Draait op | Waarom |
| --- | --- | --- |
| Website en browserscanner | Elke moderne browser; voor scannen Chrome of Edge aanbevolen | De scanner draait volledig op je eigen apparaat en heeft een browser nodig die hem meerdere threads geeft |
| Android-app | Android 8.0 of nieuwer, arm64 aanbevolen | Scant op de telefoon zelf, ook zonder verbinding |
| iPhone en iPad | De website in de browser; scannen in Safari wordt nog getest | Er is geen iOS-app: die bouwen en ondertekenen vraagt een Mac en een Apple-ontwikkelaarsaccount |
| LiveTrial en Tournament Live | Windows op x86-64 (getest op Windows 11), met een USB-HDMI-capture card per scherm | De capture cards en de meegeleverde herkenning zijn gebouwd en getest voor Windows; er is geen macOS- of Linux-versie |

**Eerste start van de Android-app:** die vraagt *Kies je community*. Thuis of bij de club scan je de kaart
**Apparaat voorbereiden** die je beheerder laat zien; bij een online community typ je het adres van de website.
Daarna log je in via de browser. Details: [Spelers](docs/guides/PLAYERS.md#first-start) (Engels).

**Eén app, meerdere community's:** met de communitychip bovenin wissel je met één tik tussen je club, je
installatie thuis en een online community; elk houdt een eigen account en eigen niet verzonden tijden. Onder
**Jij** → **Mijn tijden** zie je je beste tijd per circuit, ook zonder internet, en met meer dan één community
neem je je beste tijden mee naar een andere — als die community ze aanneemt.

**Waarom niet alles overal?** Een pakket wordt alleen aangeboden waar het gebouwd en geprobeerd is. De
serverimages van A1 en B1 bestaan alleen voor x86-64; A2 heeft ook arm64. Voor Intel-Macs wordt de
beveiligingsbibliotheek die A2 nodig heeft (`cryptography`) niet meer uitgebracht, dus bouwt de release hem
vanaf de broncode op een Intel-Mac en test hem daar ([hoe](docs/RELEASE_PACKAGES.md#intel-mac-a2-package)).
A3 bestaat voor wie geen Docker kan of wil draaien. De [hostinghandleiding](docs/guides/HOSTING.md) en de
[releasepakketten](docs/RELEASE_PACKAGES.md) noemen elk bestand en de precieze eisen.

Een nieuwe installatie begint leeg: er worden geen communityaccounts of uitslagen overgenomen. Ze bevat alleen
de spelcatalogus en de referentiesets van de Nintendo staff ghosts en de wereldrecords.

## Status

Stabiele versies staan op [GitHub Releases](https://github.com/fromthelake/MK8DX-Ecosystem/releases); 0.2.0 bracht
A2, thuis of bij de club; 0.2.1 geeft de Android-app een offline kopie van je tijden en een rustiger indeling.
Zie de [changelog](CHANGELOG.md), de [releasepakketten](docs/RELEASE_PACKAGES.md) en de
volledige handleiding ([Nederlands](docs/install/MK8DX_Handleiding_NL.txt),
[English](docs/install/MK8DX_User_Guide_EN.txt)).

Herkenning maakt een uitslag nooit vanzelf officieel: je controleert je eigen Time Trials, en een
organisator controleert toernooiraces voordat ze tellen.

## Documentatie

| Ik wil… | Lees |
| --- | --- |
| begrijpen hoe de herkenning werkt | [Herkenningspijplijn](docs/architecture/RECOGNITION_PIPELINE.md) (Engels) |
| de onderdelen begrijpen en hoe een uitslag reist | [Architectuur](docs/architecture/COMPONENTS.md) (Engels) |
| de code bouwen of aanpassen | [Ontwikkelaarshandleiding](docs/DEVELOPMENT_NL.md) en [Testen](docs/TESTING_NL.md) |
| de native apps bouwen | [Client builds](docs/CLIENT_BUILDS.md) (Engels) |
| een installatie beheren (back-up, bijwerken, herstel) | [Beheer](docs/OPERATIONS_NL.md) |
| weten waarom iets is zoals het is | [Besluitenoverzicht](docs/decisions/README.md) (Engels) |
| bijdragen | [Bijdragen](CONTRIBUTING.md), [Gedragscode](CODE_OF_CONDUCT.md) |
| hulp krijgen | [Hulp krijgen](SUPPORT.md) |
| een beveiligingsprobleem melden | [Beveiligingsbeleid](SECURITY.md) |
| met een coding agent werken | [AGENTS.md](AGENTS.md) |

## Licentie en Nintendo

Dit is een onafhankelijk, niet-commercieel hobbyproject om te leren programmeren en Mario Kart 8 Deluxe nog
leuker te maken. Het is **niet verbonden aan of goedgekeurd door Nintendo**. Nintendo is eigenaar van zijn
merken en spelinhoud; steun Nintendo door zijn consoles en games te kopen.

De eigen code en documentatie van het project vallen onder de [Mozilla Public License 2.0](LICENSE). De
[licentiereikwijdte](LICENSE_SCOPE.md) legt uit wat die dekt: hij dekt **geen** materiaal van Nintendo,
spelafbeeldingen, herkenningstemplates, modellen, lettertypen of ander materiaal van derden, dat zijn eigen
voorwaarden houdt. Zie [Materiaal van derden](docs/THIRD_PARTY_MATERIALS.md). De software wordt geleverd
zoals hij is.
