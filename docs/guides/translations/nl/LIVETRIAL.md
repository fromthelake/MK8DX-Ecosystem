# LiveTrial: Time Trials opnemen op Windows

*Nederlandse versie van de [Engelse handleiding](../../LIVETRIAL.md); bij details is de Engelse versie leidend.*

[Alle handleidingen](../../../../README.md#get-started) · [README van het LiveTrial-onderdeel](../../../../apps/timetrials-desktop/README.md)

LiveTrial is een Windows-programma dat je Time Trials via een capturekaart volgt, of opgenomen video's leest.
Het herkent elke rit (totaal- en rondetijden, personage en kartcombinatie, ghost) en bewaart hem met een clip op
je pc. Nadat je één keer bent aangemeld, kan het de resultaten naar de website van je community sturen.
Resultaten die nog niet verstuurd kunnen worden, wachten op de pc.

## Zonder communitywebsite

LiveTrial werkt ook op zichzelf. Opnemen, video-analyse, **Ritgeschiedenis**, clips en correcties werken allemaal
lokaal. Ritten die zonder account zijn opgenomen, blijven alleen op deze pc tot je ze verstuurt met
**Verstuur als <account>**. De tabbladen **Mijn records**, **Ranglijst** en **Voertuig** hebben een aangemelde
community nodig.

## Vereisten

- Windows op x86-64 (getest op Windows 11). Ongeveer 1 GB voor het programma plus ruimte voor je opnames.
- Voor live opnemen: een capturekaart die Windows als videoapparaat toont, met de driver, en **FFmpeg** (gratis,
  niet meegeleverd vanwege de licentie; zie stap 4 hieronder). Voor videobestanden: geen capturekaart en geen
  FFmpeg.
- Om resultaten te versturen: het adres van de website van je community en een account daar (zie
  [Spelers](PLAYERS.md)). Op dezelfde computer als een lokale proefinstallatie werkt `http://127.0.0.1:<port>`;
  gebruik anders het vertrouwde HTTPS-adres.

## Installeren

1. Download van de [GitHub Releases](https://github.com/fromthelake/MK8DX-Ecosystem/releases)-pagina van het
   project (bij elke release horen de releasepakketten) `desktop-client-….zip` en `SHA256SUMS.txt`. Met een
   kloon kun je hetzelfde pakket ook zelf bouwen: [Clients bouwen](../../../CLIENT_BUILDS.md#livetrial-windows).
   Controleer het in PowerShell:
   `Get-FileHash '.\desktop-client-<version>.zip' -Algorithm SHA256` en vergelijk de hele waarde.
2. Pak de **hele** ZIP uit in een map van jezelf, bijvoorbeeld onder Documenten. Behoud de mapstructuur; het
   pakket bevat een eigen Python-runtime, herkenningsengine en spelafbeeldingen.
3. Dubbelklik `LiveTrial.exe`. Het dashboard opent als eigen venster (Edge, anders Chrome, anders je
   standaardbrowser). Video's analyseren werkt meteen.
4. Installeer voor live opnemen één keer FFmpeg. De makkelijkste manier: open PowerShell en voer
   `winget install Gyan.FFmpeg` uit, sluit LiveTrial daarna af en start het opnieuw, zodat het het nieuwe PATH
   ziet. Zonder winget download je een Windows-build (bijvoorbeeld de releasezip van gyan.dev, gelinkt vanaf
   [ffmpeg.org/download.html](https://ffmpeg.org/download.html)), pak je die uit en kopieer je `bin\ffmpeg.exe`
   naar `%LOCALAPPDATA%\MK8DX\LiveTrial\tools\ffmpeg\bin\`. Ontbreekt FFmpeg, dan meldt **Opname starten** dat
   en toont het deze stappen.

## Verbinden met je community

1. Open **Instellingen**. Vul het adres van je community in bij **Adres van je communitywebsite** (bijvoorbeeld
   `https://www.example.org`) en kies **Server opslaan**. LiveTrial start zichzelf opnieuw; laat het open.
2. Controleer na de herstart of Instellingen precies jouw adres toont en meld je daarna aan via het accountmenu
   (code per e-mail, e-maillink of goedkeuring op de website).
3. Mislukt het automatisch opnieuw starten, kies dan in de app **LiveTrial afsluiten**, wacht tot het gesloten
   is en start `LiveTrial.exe` opnieuw. Alleen het venster sluiten is niet genoeg: LiveTrial kan op de
   achtergrond blijven draaien.

Accounts en wachtende ritten worden per server apart bewaard: wisselen van server stuurt nooit oude ritten naar de
nieuwe community. Vul in LiveTrial nooit het adres van de lokale mailbrievenbus of een intern serveradres in.

## Later koppelen

Je kunt eerst opnemen en later bij een community aansluiten. Dit gebeurt er met de ritten die al op deze pc staan:

- **Kies de community voordat je opneemt.** Ritten worden per server bewaard. Ritten die zijn opgenomen voordat
  je een communityadres had opgeslagen, of terwijl een andere community gekozen was, blijven bij die server en
  worden nooit aan de nieuwe aangeboden. Zo'n opname haal je over door na het koppelen het videobestand opnieuw
  te verwerken met **Video analyseren**.
- **Ritten zonder account** gaan bij later aanmelden niet vanzelf mee. Kies **Verstuur als <account>** bij één
  rit (in **Ritgeschiedenis** of op de regel na de race), of bij de regel **Geen account** in de wachtlijst (de
  teller bovenin) om ze allemaal aan het aangemelde account te geven. Ze komen op de speler van dat account;
  zonder die keuze wordt niets toegewezen.
- **Ritten die met een account zijn opgenomen** gaan altijd met datzelfde account mee. **Nu verzenden** verstuurt
  elke wachtende rit, elk met zijn eigen account; een rit van een afgemeld account wacht tot dat account weer
  aanmeldt.
- **Elke rit wordt één keer opgeslagen.** Iedere rit heeft een eigen inzendings-ID, en de website neemt dezelfde
  rit geen tweede keer aan.
- **Clips en video's blijven op deze pc.** Alleen het resultaat (tijden, circuit, combinatie) gaat naar de
  website; uploaden naar YouTube is een aparte, optionele stap.

## Gebruiken

- **Opname starten**: kies de capturekaart. LiveTrial toont er eerst één stilstaand beeld van, zodat je kunt
  controleren of het het juiste apparaat is. Het tabblad **Live** toont daarna het beeld en elke herkende rit.
- **Video analyseren**: kies een `.mp4`/`.mkv`-bestand (het wordt gekopieerd naar
  `%LOCALAPPDATA%\MK8DX\LiveTrial\videos`) en LiveTrial verwerkt het als een opname.
- Na elke race zegt de regel over de laatste race waar de rit staat: op de website, opgeslagen en wachtend op
  verzending (**Nu verzenden**), of alleen op deze pc (**Verstuur als <account>**).
- **Ritgeschiedenis** toont elke rit met zijn clip. Je kunt een herkenning corrigeren; een correctie bewaart een
  nieuwe versie en houdt de vorige.
- Automatisch verzenden staat standaard uit; zet het aan in Instellingen. Een rit wordt altijd eerst lokaal
  bewaard.

Stel **Taal van je Switch** in bij Instellingen als de taal van de console afwijkt van die van het dashboard.

Het dashboard is alleen vanaf deze computer te bedienen: in het LiveTrial-venster of op de dashboardpagina die op deze
pc open staat. Start je de engine met `--lan` (zie de
[README van de LiveTrial-component](../../../../apps/timetrials-desktop/README.md)), dan kunnen telefoons en tablets
in het netwerk de live-weergave en de ritten bekijken, maar niets veranderen.

## Problemen

- Verkeerde website, of aanmelden opent de verkeerde site: sluit LiveTrial af met **LiveTrial afsluiten**, start
  het opnieuw en controleer het adres in Instellingen. Een ander Windows-account op dezelfde pc kan LiveTrial nog
  open hebben.
- Geen opnameapparaat in de lijst: controleer de USB-verbinding en de driver, wacht een paar seconden en probeer
  het opnieuw.
- Herkenningsfouten: corrigeer de rit in Ritgeschiedenis voordat je hem verstuurt. Herkenning vervangt nooit het
  controleren van je eigen resultaat.

LiveTrial is alleen voor Windows; er is geen build voor macOS of Linux. Zelf bouwen: zie
[Clients bouwen](../../../CLIENT_BUILDS.md).
