# Tournament Directors: een avond leiden

*Nederlandse versie van de [Engelse handleiding](../../TOURNAMENT_DIRECTORS.md); bij details is de Engelse versie leidend.*

[Alle handleidingen](../../../../README.md#get-started) · [Naslag Tournament Tools](../../../product/USING_MK8DX_TOURNAMENT_TOOLS.md)

Een Tournament Director leidt een toernooiavond op de communitywebsite: deelnemers, consoles, groepen, scores,
finales en het gepubliceerde verslag. De Windows-**Tournament Tools** kunnen de race-uitslagen uit opnames of
live capture lezen, zodat je niet elke plaats met de hand hoeft in te typen. Ze zijn optioneel: scores kun je ook
met de hand invoeren of uit Excel/CSV importeren.

**Zonder website:** de Windows Tournament Tools in [hoofdstuk 3](#3-de-windows-tournament-tools) (Processor,
Analysis en Live) werken op zichzelf. Ze schrijven Excel-, CSV- en JSON-bestanden op je pc; Connect is optioneel.

Herkenning maakt een uitslag nooit officieel. Jij controleert elke race voordat hij telt, en jij beslist over
publicatie.

## 1. Directorrechten krijgen op de website van je community

1. Meld je aan op de website (zie [Spelers](PLAYERS.md)).
2. Kies op de pagina **Toernooien** **Verzoek om te hosten**. Een beheerder keurt het verzoek goed of af.
   Beheerders, en Directors na goedkeuring, zien die knop niet: zij zien op dezelfde pagina **Nieuw toernooi
   maken** (in de balk **Wedstrijdleiding**) en beginnen de avond daar.
3. Om herkende races vanuit de Windows-tools naar de website te sturen, geeft een beheerder je aangemelde speler
   ook toegang onder **Beheer → Toernooien → Directeuren**. Dat geeft toegang tot toernooien, geen algemeen
   beheer.

## 2. De avond leiden op de website

Open het toernooi via **Toernooien** (beheerders vinden het ook onder **Beheer → Toernooien**). De avond is een
reeks stappen; de pagina laat zien waar je bent:

| Stap | Wat je doet |
| --- | --- |
| 0 | Kies de Director |
| 1 | Start het toernooi |
| 2 | Kies de deelnemers, markeer wie aanwezig is en welke Switches zij meenemen (de vinkjes **NS1**/**NS2** naast elke naam) |
| 3-4 | Maak en exporteer de indeling van de voorronde (groepen en plaatsen) |
| 5 | Voer de scores van de voorronde in: met de hand, uit een Excel/CSV-bestand of uit **Binnenkomende uitslagen** |
| 6 | Exporteer de uitslagen van de voorronde |
| 7-8 | Controleer en exporteer de finalegroepen |
| 9 | Voer de scores van de finalegroepen in; een import werkt per groep en weigert een groep zolang er nog een naam niet gekoppeld is |
| 10 | Afronden en delen: eindstand, verslag en de WordPress-export |

Stap 2 gaat pas verder als er genoeg Switches zijn: op elke Switch spelen twee spelers, dus de avond heeft
minstens de helft van de Aanwezige deelnemers, naar boven afgerond, aan aangevinkte Switches nodig (9 Aanwezigen
hebben er 5 nodig). Het overzicht onder de lijst toont hoeveel er ontbreken; vink de Switches aan die mensen
meenemen, of zet deelnemers op Wachtlijst of Afwezig.

Voor races die uit de Tournament Tools komen: open **Binnenkomende uitslagen** bij de groep, koppel elke
herkende naam aan de juiste speler, controleer het circuit en de finishplaatsen en bevestig de feed van de groep.
Een voorlopige live stand is geen officiële uitslag. Je kunt een uitslagbestand ook rechtstreeks importeren met
**Offline terugval: opgeslagen Live-/Processor-uitslagbestand importeren** binnen een groep, of via
**Beheer → Toernooien → Canonieke race-uitslagen importeren**.

Publicatie en de communityrating zijn aparte beslissingen in de laatste stap.

## 3. De Windows Tournament Tools

### Vereisten

- Windows op x86-64 (getest op Windows 11) en enkele GB vrije ruimte. De ZIP is ongeveer 440 MB en uitgepakt
  ongeveer 1,3 GB; de installer heeft één keer internet nodig om Python 3.12 en openbare pakketten te downloaden
  (meer met GPU/CUDA); alle OCR-modellen zitten erbij. Daarna werkt verwerken offline. Een NVIDIA-kaart versnelt
  alleen de OCR-stap; de eerste scan van een opname draait altijd op de processor (zie
  [welke stappen de videokaart gebruiken](../../../product/USING_MK8DX_TOURNAMENT_TOOLS.md#which-steps-use-the-graphics-card)).
- Voor live capture: een capturekaart met een werkende Windows-driver (DirectShow). Voor opnames: niets extra.
- Optioneel, om uitslagen te versturen: het websiteadres en Directortoegang (stap 1).

### Installeren

1. Download van de [GitHub Releases](https://github.com/fromthelake/MK8DX-Ecosystem/releases)-pagina van het
   project (bij elke release horen de releasepakketten) `tournament-tools-….zip` en `SHA256SUMS.txt`. Met een
   kloon kun je het ook zelf bouwen ([Zelf de tools bouwen](#zelf-de-tools-bouwen)). In PowerShell:
   `Get-FileHash '.\tournament-tools-<version>.zip' -Algorithm SHA256`, en vergelijk de hele waarde.
2. Pak de complete ZIP uit in een map waarin je mag schrijven (niet `Program Files`). Houd `runtime-assets\`
   naast de starters.
3. Dubbelklik `Install-MK8DX-TournamentTools.cmd` en wacht op `SUCCESS`. Hij kiest zelf NVIDIA CUDA of CPU-PyTorch
   voor deze computer. Mislukt het, lees dan `install.log` in de pakketmap.

De installer maakt deze starters:

| Starter | Gebruik |
| --- | --- |
| `TournamentProcessor.cmd` | Sleep er een `.mp4`- of `.mkv`-opname op. Hij schrijft naast de video een sessiemap (`<name>_TournamentSession\Output_Results\`) met Excel, CSV en `<name>_TournamentRaceResultsV1.json`. |
| `TournamentAnalysis.cmd` | Een venster voor dezelfde analyse van opgenomen video's, met meerdere video's of een map per toernooi ([hieronder](#opnames-achteraf-analyseren)). |
| `TournamentLive.cmd` | Live capture tijdens de avond, of een video afspelen: **Videobestand toevoegen** (of voeg een opnameapparaat toe), **Alles starten**, controleer **Bevestigde stand** en kies daarna **Exports openen**. Afleveren aan de website: zie [Tournament Live naar de website](#tournament-live-naar-de-website). |
| `TournamentConnect.cmd` | Optionele verbinding met de website (hieronder). |
| `TournamentLiveCli.cmd` | Diagnose: apparaten zoeken, replay en uitslagopdrachten. Geen vervanging voor het livevenster. |

`TournamentTools.config.cmd` bevat lokale paden en taalvoorkeuren. Bewaar dat bestand, de sessiemap
`TournamentLive\` en je uitvoermappen als je een nieuwer pakket installeert.

### Opnames achteraf analyseren

Gebruik Tournament Live als je de avond vastlegt terwijl hij bezig is. Liep de avond zonder Live en heb je alleen
opnames, analyseer ze dan achteraf met het venster **Tournament Analysis**:

1. Dubbelklik `TournamentAnalysis.cmd` in de pakketmap.
2. **① Opnames kiezen**: **Video's toevoegen...** kiest een of meer opnames (`.mp4`, `.mkv`, `.mov`, `.avi`,
   `.ts`); **Map toevoegen...** voegt een map toe met de opnames van één toernooi.
3. **② Video's kiezen**: alles wat je toevoegde staat aangevinkt; vink uit wat niet geanalyseerd moet worden
   (**Alles**, **Geen**, **Leegmaken**).
4. **③ De analyse starten**: controleer de **Sessie-id** (ingevuld uit de eerste naam en de datum; hij wordt bij
   elke race bewaard) en de **Uitslagenmap** (standaard `<first name>_TournamentSession` naast de eerste opname)
   en kies daarna **ANALYSE STARTEN**. Het venster voert dezelfde verwerking uit als `TournamentProcessor.cmd`;
   het activiteitenlog toont de gekleurde uitvoer, het startlicht wordt oranje en **Annuleren** stopt het.
   Opnames worden gekoppeld in `Input_Videos\` van de uitslagenmap, of gekopieerd als ze op een andere schijf
   staan.
5. **🏁 Uitslagen**: zodra er **Klaar** staat, kies **Laatste Excel openen** of **Uitslagenmap openen**:
   `Output_Results\` bevat de Excel-werkmap, de CSV en `*_TournamentRaceResultsV1.json`. Controleer de races en
   importeer daarna de JSON op de website zoals hierboven beschreven.

De teksten volgen de taal van Windows (Engels of Nederlands); `MK8DX_TOURNAMENT_LANGUAGE` in
`TournamentTools.config.cmd` overschrijft dat. Wil je een andere afbeelding in de banner, zet dan
`MK8DX_ANALYSIS_BACKGROUND` in `TournamentTools.config.cmd` op dat bestand. Vanuit een kloon opent
`python -m tournament_processor.gui` hetzelfde venster als de Tournament Processor en zijn herkenningsbestanden
geïnstalleerd zijn; het heeft PySide6 nodig (de `gui`-extra van de processor) en opent anders, of met
`--classic-gui`, een eenvoudiger Tkinter-venster.

### Verbinden met de website (optioneel)

In PowerShell, in de pakketmap:

```powershell
.\TournamentConnect.cmd sign-in                           # asks for the website address once, then browser sign-in
.\TournamentConnect.cmd server                            # shows the address
.\TournamentConnect.cmd server https://www.example.org    # changes it (asks for confirmation)
.\TournamentConnect.cmd tournaments                       # lists the nights you may deliver to
.\TournamentConnect.cmd target                            # night and group for Tournament Live's live feed (clear-target)
.\TournamentConnect.cmd send <name>_TournamentRaceResultsV1.json   # asks which night, then uploads
.\TournamentConnect.cmd sign-out
```

Gebruik `http://127.0.0.1:<port>` (of `http://localhost:<port>`) alleen als de website op dezelfde
Windows-computer draait, zoals bij A1 en A3: gewoon HTTP wordt alleen voor deze adressen op deze pc geaccepteerd;
elk ander adres heeft zijn vertrouwde HTTPS-adres nodig. Zonder terminal (bijvoorbeeld vanuit een script) vraagt
`sign-in` niets: stel het adres dan eerst in met `TournamentConnect.cmd server <adres>`. Uploads die op een server
wachten, blijven bij die server. Een afgeleverde race komt in **Binnenkomende uitslagen** terecht; hij wordt nooit
automatisch gepubliceerd.

### Tournament Live naar de website

1. Kies in Tournament Live **Verbinden met Tournament Manager** (later **Toernooi wijzigen**), rond de aanmelding
   in de browser af en kies de avond in **Toernooi kiezen**. Die keuze is alleen een voorstel; je kunt hem voor of
   na de run maken.
2. Start de feeds (**Videobestand toevoegen** of een capturekaart, daarna **Alles starten**). Tournament Live kan
   een bekende capturekaart zelf toevoegen, als extra bron op Groep 1. Staat er ook een video op Groep 1, dan
   stopt **Alles starten** met *Koppel iedere feed aan precies één verschillende groep*: selecteer de extra bron
   en kies **Selectie verwijderen**, of geef hem een eigen groep, en start opnieuw.
3. Open op de website de avond, ga naar Stap 5 (Stap 9 voor de finalegroepen) en zoek de run onder **Beschikbare
   Tournament Live-opnamen**. Kies de groep bij **Koppelen aan groep** en daarna **Gecontroleerde opname
   koppelen**. De races wachten als bewijs in afwachting tot je ze accepteert.

### Later koppelen

Een avond die zonder verbinding is verwerkt, staat volledig op je pc: `Output_Results\` bevat de Excel-werkmap, de
CSV en `*_TournamentRaceResultsV1.json`. Tournament Live zonder verbinding schrijft ook zijn Excel-werkmap: als je
de feeds stopt, als de analyse klaar is, of als je het venster sluit terwijl er nog feeds lopen (hij stopt ze eerst).
De bestanden blijven na het sluiten in `Live_Output\exports` (**Exports openen**). Wordt Live hard afgebroken
voordat de feeds stoppen, dan ontbreekt die laatste werkmap; de opnamen blijven bewaard en Tournament Analysis of
de Processor maakt er dezelfde werkmap van. Achteraf wordt er niets vanzelf verstuurd; breng hem op een van deze
manieren naar de website:

- In de groep op de website: **Offline terugval: opgeslagen Live-/Processor-uitslagbestand importeren** met de
  JSON, of de Excel-import van de groep. Elke herkende naam moet eerst aan een speler gekoppeld zijn; een import
  weigert een groep zolang er een naam niet gekoppeld is.
- Een beheerder: **Beheer → Toernooien → Canonieke race-uitslagen importeren**. Geïmporteerde races blijven privé
  tot ze gepubliceerd zijn.
- Met TournamentConnect: `.\TournamentConnect.cmd sign-in`, daarna
  `.\TournamentConnect.cmd send <name>_TournamentRaceResultsV1.json`. Het vraagt de avond, de groep en het eerste
  racenummer; de races komen in **Binnenkomende uitslagen**. Is de website niet bereikbaar, dan blijft het bestand
  staan; verstuur het later opnieuw.
- In Tournament Live: kies je na een afgeronde sessie de avond met **Verbinden met Tournament Manager**, dan biedt
  Live die afgeronde sessie aan die avond aan. Uploads die mislukten terwijl Live verbonden was, worden bewaard en
  opnieuw verstuurd, vanzelf of met **Upload opnieuw proberen**, alleen voor hetzelfde aangemelde account. Een
  sessie met **Offline werken** wordt niet bewaard voor upload; gebruik voor dat bestand een van de routes
  hierboven.

Aanmelden voegt twee dingen toe: de lijst van avonden waarvoor je mag afleveren, en tijdens de avond de live-feed
(`target`), die elke race naar de gekozen groep stuurt zodra Tournament Live hem herkent. In beide gevallen telt
een race pas als je hem in **Binnenkomende uitslagen** hebt bevestigd.

### Controleren wat er gelezen is

OCR kan een naam, een plaats of een opgetelde score verkeerd lezen. Vergelijk elke race met het scherm of de
opname voordat je hem bevestigt. Een bekende beperking: Tournament Live kan een juiste race-uitslag exporteren met
een verkeerd gelezen opgeteld totaal, en de controle op de website kan de waargenomen naam of het totaal niet
aanpassen (zie [Tournament Live op een lokale laptop](../../../product/README_TOURNAMENT_LIVE_LAPTOP.md)).

De tools lezen het spel in de 15 consoletalen. Tournament Live doorstond een fysieke acceptatierun op 1× met het
v0.2.2-pakket: drie bron-pc's speelden opgenomen kwalificatievideo's af in hun eigen capturekaarten
([issue #137](https://github.com/fromthelake/MK8DX-Ecosystem/issues/137)). Een videoreplay zonder capturekaart
test het capturepad niet.

## Zelf de tools bouwen

`python tooling/tournament/build_windows_package.py --output <new folder> --version local` vanuit een kloon bouwt
hetzelfde pakket; zie [Clients bouwen](../../../CLIENT_BUILDS.md).
