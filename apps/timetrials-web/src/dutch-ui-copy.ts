import {
  DUTCH_PRESENTATION_BY_ENGLISH,
  DUTCH_PRESENTATION_BY_ID,
} from "./dutch-presentation.generated.js";
import { replaceGameNames, translateEnglish } from "./product-catalog.js";
import { productLanguage, usesProductCatalog } from "./product-language.js";

const exact: Readonly<Record<string, string>> = {
  "Account settings": "Accountinstellingen",
  "All results synchronized": "Alle resultaten gesynchroniseerd",
  "Among rivals": "Onder rivalen",
  "Back": "Terug",
  "Body": "Chassis",
  "Build": "Voertuig",
  "Cancel": "Annuleren",
  "Change track": "Circuit wijzigen",
  "Character": "Coureur",
  "Choose the product language. More languages can be added without changing saved preferences.": "Kies de taal van het product. Later kunnen talen worden toegevoegd zonder opgeslagen voorkeuren te wijzigen.",
  "Close": "Sluiten",
  "Coins": "Munten",
  "Compare Nintendo Ghost": "Vergelijk met Nintendo-ghost",
  "Compare World Record": "Vergelijk met wereldrecord",
  "Country": "Land",
  "Delta per track": "Verschil per circuit",
  "Details": "Details",
  "English": "Engels",
  "Glider": "Paraglider",
  "Global": "Wereldwijd",
  "Groups": "Groepen",
  "Home": "Home",
  "Lap": "Ronde",
  "Lap times": "Rondetijden",
  "Loading…": "Laden…",
  "Manual input": "Handmatige invoer",
  "Medals": "Medailles",
  "Mushrooms": "Paddenstoelen",
  "New Group name": "Naam van nieuwe groep",
  "No country": "Geen land",
  "No tracks match that search.": "Geen circuits komen overeen met deze zoekopdracht.",
  "Notifications": "Meldingen",
  "Open": "Openen",
  "Player": "Speler",
  "Product language": "Producttaal",
  "Profile": "Profiel",
  "Rank": "Ranglijst",
  "RANK": "RANGLIJST",
  "Records": "Records",
  "Reference Players": "Referentiespelers",
  "Refresh": "Vernieuwen",
  "Reset filters": "Filters herstellen",
  "Rivals": "Rivalen",
  "Save": "Opslaan",
  "Saving…": "Opslaan…",
  "Search player name": "Spelersnaam zoeken",
  "Search track": "Circuit zoeken",
  "Settings": "Instellingen",
  "Welcome — complete your Player profile": "Welkom — voltooi je spelersprofiel",
  "Your account is ready. First complete the Player step marked with *. Every preference after that is optional and has its own Save button.": "Je account is gereed. Voltooi eerst de spelersstap met een *. Elke voorkeur daarna is optioneel en heeft een eigen knop Opslaan.",
  "Your Player": "Jouw speler",
  "Create your Player": "Maak jouw speler",
  "Pick the name you want to race under. It is yours straight away — no waiting, and you can start recording times immediately.": "Kies de naam waaronder je wilt racen. Deze is direct van jou en je kunt meteen tijden vastleggen.",
  "* Required. Display name is optional; the remaining profile preferences can be saved later.": "* Verplicht. De weergavenaam is optioneel; de overige profielvoorkeuren kun je later opslaan.",
  "Username *": "Gebruikersnaam *",
  "Display name (optional)": "Weergavenaam (optioneel)",
  "How should your Player appear? *": "Hoe moet jouw speler worden weergegeven? *",
  "Username is required.": "Gebruikersnaam is verplicht.",
  "Complete the highlighted required field.": "Vul het gemarkeerde verplichte veld in.",
  "Correct the highlighted username and retry.": "Corrigeer de gemarkeerde gebruikersnaam en probeer opnieuw.",
  "Correct the highlighted display name and retry.": "Corrigeer de gemarkeerde weergavenaam en probeer opnieuw.",
  "This username is already in use.": "Deze gebruikersnaam is al in gebruik.",
  "This display name is already in use by another Player.": "Deze weergavenaam is al in gebruik door een andere speler.",
  "That username is already in use. Choose another one.": "Die gebruikersnaam is al in gebruik. Kies een andere.",
  "That display name belongs to an existing Player. Choose the existing-Player path or use another display name.": "Die weergavenaam hoort bij een bestaande speler. Kies de route voor een bestaande speler of gebruik een andere weergavenaam.",
  "Continue with optional preferences": "Doorgaan met optionele voorkeuren",
  "Required Player step complete": "Verplichte spelersstap voltooid",
  "You can finish onboarding now, or save any optional preference below. Unsaved optional fields never block completion.": "Je kunt de onboarding nu afronden of hieronder optionele voorkeuren opslaan. Niet-opgeslagen optionele velden blokkeren de afronding nooit.",
  "Finish onboarding": "Onboarding afronden",
  "Player review pending": "Spelerscontrole in behandeling",
  "Player step still required": "Spelersstap nog verplicht",
  "Create a new Player or request your existing Player above. Optional account preferences below do not complete or block that step.": "Maak hierboven een nieuwe speler of vraag je bestaande speler aan. De optionele accountvoorkeuren hieronder voltooien of blokkeren die stap niet.",
  "Relevant engine classes (optional)": "Relevante raceklassen (optioneel)",
  "Do you have the Booster Course Pass?": "Heb je de Circuit-uitbreidingspas?",
  "Choose an answer": "Kies een antwoord",
  "Choose Yes or No": "Kies Ja of Nee",
  "Yes — all 96 tracks": "Ja — alle 96 circuits",
  "No — base 48 tracks": "Nee — 48 basiscircuits",
  "No — the 48 base tracks": "Nee — de 48 basiscircuits",
  "Save track access": "Circuittoegang opslaan",
  "This sets your default progress and ranking scope. Every public track remains available.": "Dit bepaalt je standaardvoortgang en ranglijstscope. Elk openbaar circuit blijft beschikbaar.",
  "Preferences could not be loaded. Reload before saving this field.": "Voorkeuren konden niet worden geladen. Herlaad de pagina voordat je dit veld opslaat.",
  "Wait until the saved preference has loaded.": "Wacht tot de opgeslagen voorkeur is geladen.",
  "Choose Yes or No before saving.": "Kies Ja of Nee voordat je opslaat.",
  "Saved. Progress and rankings now use this default.": "Opgeslagen. Voortgang en ranglijsten gebruiken nu deze standaard.",
  "Track access could not be saved. Other fields were not changed.": "Circuittoegang kon niet worden opgeslagen. Andere velden zijn niet gewijzigd.",
  "Your Time Trial journey": "Jouw Time Trial-reis",
  "Base tracks · Times set": "Basiscircuits · tijden gezet",
  "Base tracks · Staff ghosts defeated": "Basiscircuits · staff-ghosts verslagen",
  "DLC tracks · Times set": "DLC-circuits · tijden gezet",
  "DLC tracks · Staff ghosts defeated": "DLC-circuits · staff-ghosts verslagen",
  "Base 48 · Times set": "Basis 48 · tijden gezet",
  "Base 48 · Staff ghosts defeated": "Basis 48 · staff-ghosts verslagen",
  "BCP 48 · Times set": "Uitbreiding 48 · tijden gezet",
  "BCP 48 · Staff ghosts defeated": "Uitbreiding 48 · staff-ghosts verslagen",
  "Do you have the Booster Course Pass? Set it in Settings so progress uses the right journey.": "Heb je de Circuit-uitbreidingspas? Stel dit in bij Instellingen, zodat je voortgang de juiste reis gebruikt.",
  "Start your 150cc journey with one time on any base track.": "Begin je 150cc-reis met één tijd op een willekeurig basiscircuit.",
  "Start your 200cc journey with one time on any base track.": "Begin je 200cc-reis met één tijd op een willekeurig basiscircuit.",
  "Start your 150cc journey with one time on any available track.": "Begin je 150cc-reis met één tijd op een willekeurig beschikbaar circuit.",
  "Start your 200cc journey with one time on any available track.": "Begin je 200cc-reis met één tijd op een willekeurig beschikbaar circuit.",
  "Your journey counts the 48 base tracks; BCP tracks remain public and browsable.": "Je reis telt de 48 basiscircuits; uitbreidingscircuits blijven openbaar en doorzoekbaar.",
  "Base and BCP progress are tracked separately; competitive status uses all 96 tracks.": "Voortgang voor basis en uitbreiding wordt apart bijgehouden; je competitieve status gebruikt alle 96 circuits.",
  "Current #1s": "Huidige #1-posities",
  "Outside top 10": "Buiten de top 10",
  "Community": "Community",
  "Tracks": "Circuits",
  "Base 48": "Basis 48",
  "BCP 48": "Uitbreiding 48",
  "All 96": "Alle 96",
  "MK8DX RACE CONTROL": "MK8DX RACE CONTROL",
  "Public Base 48, Booster Course Pass 48 and All 96 standings, Mastery distribution and direct comparison.": "Openbare ranglijsten voor Basis 48, Uitbreiding 48 en Alle 96, Mastery-verdeling en directe vergelijking.",
  "Optional. ‘All’ is preselected, so you can keep the default.": "Optioneel. ‘Alle’ is vooraf geselecteerd; je kunt deze standaard behouden.",
  "Screen name (optional)": "Schermnaam (optioneel)",
  "Save Time Trial preference": "Time Trial-voorkeur opslaan",
  "Save screen name": "Schermnaam opslaan",
  "Public Player preferences": "Openbare spelersvoorkeuren",
  "All fields below are optional and save independently. They are shown on your public Player profile.": "Alle onderstaande velden zijn optioneel en worden afzonderlijk opgeslagen. Ze verschijnen op je openbare spelersprofiel.",
  "Country (optional)": "Land (optioneel)",
  "Character (optional)": "Coureur (optioneel)",
  "Body (optional)": "Chassis (optioneel)",
  "Tires (optional)": "Banden (optioneel)",
  "Glider (optional)": "Paraglider (optioneel)",
  "Save country": "Land opslaan",
  "Save character": "Coureur opslaan",
  "Save body": "Chassis opslaan",
  "Save tires": "Banden opslaan",
  "Save glider": "Paraglider opslaan",
  "Choose a country from the list, or leave this optional field empty.": "Kies een land uit de lijst of laat dit optionele veld leeg.",
  "New email address (optional)": "Nieuw e-mailadres (optioneel)",
  "Sign in": "Aanmelden",
  "Sign out": "Afmelden",
  "Post": "Plaatsen",
  "Post a Time Trial": "Een tijd plaatsen",
  "Tire": "Banden",
  "Total": "Totaal",
  "Tournament": "Toernooi",
  "Track ↑": "Circuit ↑",
  "Track ↕": "Circuit ↕",
  "Track / mode records": "Circuit-/klasserecords",
  "World Record": "Wereldrecord",
  "YOUR FOCUS": "JOUW FOCUS",
  "Your Focus": "Jouw focus",
  "Account email": "Account-e-mailadres",
  "Accept": "Accepteren",
  "Add reviewed alias": "Gecontroleerde alias toevoegen",
  "Administration": "Beheer",
  "Administrator access is required.": "Beheerderstoegang is vereist.",
  "Administrator access is required to run a tournament.": "Beheerderstoegang is vereist om een toernooi te leiden.",
  "Tournament operator access is required to run a tournament.": "Toegang als toernooi-organisator is vereist om een toernooi te leiden.",
  "Adding…": "Toevoegen…",
  "Aliases": "Aliassen",
  "Apps": "Apps",
  "Approve device": "Apparaat goedkeuren",
  "Approve only if you started this request on your device.": "Keur dit alleen goed als jij het verzoek op je apparaat hebt gestart.",
  "Best times side by side": "Beste tijden naast elkaar",
  "Bring your own progress with you": "Neem je eigen voortgang mee",
  "Canonical submission ready.": "Canonieke inzending gereed.",
  "Career": "Carrière",
  "Career statistics are temporarily unavailable.": "Carrièrestatistieken zijn tijdelijk niet beschikbaar.",
  "Character and kart setup not recorded.": "Coureur en voertuigconfiguratie niet vastgelegd.",
  "Character, body, tires, and glider with real in-game stats": "Coureur, chassis, banden en paraglider met echte spelstatistieken",
  "Checking the device code…": "Apparaatcode controleren…",
  "Checking your session…": "Jouw sessie controleren…",
  "Choose a cup or search a track": "Kies een beker of zoek een circuit",
  "Choose a track.": "Kies een circuit.",
  "Choose rivals to personalize your challenges": "Kies rivalen om je uitdagingen te personaliseren",
  "Choose which engine classes are relevant across Home, rankings and notifications. All is the default.": "Kies welke klassen relevant zijn op Home, in ranglijsten en in meldingen. Alle is de standaard.",
  "Choose your device and download the latest build.": "Kies je apparaat en download de nieuwste versie.",
  "Clear": "Wissen",
  "Compare with another Player": "Vergelijk met een andere speler",
  "Continue": "Doorgaan",
  "Could not check your session. Reload to retry.": "Je sessie kon niet worden gecontroleerd. Laad opnieuw om het nogmaals te proberen.",
  "Could not request a sign-in link. Please retry.": "Er kon geen aanmeldlink worden aangevraagd. Probeer het opnieuw.",
  "Could not sign out. Please retry.": "Afmelden is mislukt. Probeer het opnieuw.",
  "Create Group": "Groep maken",
  "Decline": "Weigeren",
  "Deny": "Weigeren",
  "Device code": "Apparaatcode",
  "Email address": "E-mailadres",
  "Email me a sign-in / registration link": "Stuur mij een aanmeld-/registratielink",
  "Enter a time and confirm twice.": "Voer een tijd in en bevestig tweemaal.",
  "Following": "Gevolgd",
  "Groups are temporarily unavailable.": "Groepen zijn tijdelijk niet beschikbaar.",
  "Install MK8DX on your phone or your PC.": "Installeer MK8DX op je telefoon of pc.",
  "Leaderboard": "Ranglijst",
  "Link copied": "Link gekopieerd",
  "Loading career…": "Carrière laden…",
  "Loading comparison…": "Vergelijking laden…",
  "Loading the ranking…": "Ranglijst laden…",
  "Looking for the latest builds…": "Nieuwste versies zoeken…",
  "Manage": "Beheren",
  "Mushrooms used": "Gebruikte paddenstoelen",
  "My Groups": "Mijn groepen",
  "My records & stats": "Mijn records en statistieken",
  "My records & stats →": "Mijn records en statistieken →",
  "New email address": "Nieuw e-mailadres",
  "No active test results. Use Try a test scan in Android to verify your phone.": "Geen actieve testresultaten. Gebruik Probeer een testscan in Android om je telefoon te controleren.",
  "No apps have been published yet.": "Er zijn nog geen apps gepubliceerd.",
  "No canonical submission yet.": "Nog geen canonieke inzending.",
  "No character": "Geen coureur",
  "No character selected": "Geen coureur geselecteerd",
  "No Groups yet.": "Nog geen groepen.",
  "No other ranked Players to compare with yet.": "Nog geen andere gerangschikte spelers om mee te vergelijken.",
  "No rivals chosen yet.": "Nog geen rivalen gekozen.",
  "Not recorded": "Niet vastgelegd",
  "One community, country by country.": "Eén community, land voor land.",
  "Optional lap, coins, mushrooms and kart details": "Optionele ronde-, munten-, paddenstoel- en voertuigdetails",
  "Optional name used in-game. Your Player username and account stay the same.": "Optionele naam die je in het spel gebruikt. Je spelersnaam en account blijven hetzelfde.",
  "Calculating your records…": "Je records worden berekend…",
  "Choose Player": "Kies een speler",
  "Choose the group, race number, and every Player.": "Kies de groep, het racenummer en alle spelers.",
  "Incoming results": "Binnenkomende uitslagen",
  "Live and Processor uploads remain pending until you map Players, verify context and Track, and accept them.": "Uploads van Live en Processor blijven in afwachting totdat je spelers koppelt, de context en het circuit controleert en ze accepteert.",
  "No pending results. File import remains available in each group.": "Geen uitslagen in afwachting. Bestandsimport blijft in elke groep beschikbaar.",
  "Needs review": "Moet worden gecontroleerd",
  "Group / phase": "Groep / fase",
  "Race number": "Racenummer",
  "Track": "Circuit",
  "Review note": "Controlenotitie",
  "Accept confirmed result": "Bevestigde uitslag accepteren",
  "Reject": "Afwijzen",
  "Choose the group, race number, Track, and every Player from that group.": "Kies de groep, het racenummer, het circuit en elke speler uit die groep.",
  "Player profile": "Spelersprofiel",
  "Player vs Player": "Speler tegen speler",
  "Players around the world": "Spelers over de hele wereld",
  "Preferences could not be loaded.": "Voorkeuren konden niet worden geladen.",
  "Preferences could not be saved.": "Voorkeuren konden niet worden opgeslagen.",
  "Private Groups": "Privégroepen",
  "Profile character": "Profielcoureur",
  "Public 96-track standings, Mastery distribution and direct comparison between community Players, Nintendo Ghost and World Record.": "Openbare stand over 96 circuits, Mastery-verdeling en directe vergelijking tussen communityspelers, Nintendo-ghost en wereldrecord.",
  "Public Player identity": "Openbare spelersidentiteit",
  "Public verified Time Trials": "Openbare geverifieerde Time Trials",
  "Overview": "Overzicht",
  "Rating": "Rating",
  "Reference Players:": "Referentiespelers:",
  "Relevant engine classes": "Relevante raceklassen",
  "Remove": "Verwijderen",
  "Requesting a secure one-time link…": "Veilige eenmalige link aanvragen…",
  "Review this device request.": "Controleer dit apparaatverzoek.",
  "Run a tournament": "Een toernooi leiden",
  "Run a tournament night": "Een toernooiavond organiseren",
  "Save preferences": "Voorkeuren opslaan",
  "Saved.": "Opgeslagen.",
  "Saved. Home and notifications now use this preference.": "Opgeslagen. Home en meldingen gebruiken nu deze voorkeur.",
  "Scanner test results": "Scannertestresultaten",
  "Screen name": "Schermnaam",
  "Set up your Player": "Stel je speler in",
  "Share build": "Voertuig delen",
  "Sign in to download the MK8DX apps.": "Meld je aan om de MK8DX-apps te downloaden.",
  "Sign in to react.": "Meld je aan om te reageren.",
  "Since you were away": "Sinds je weg was",
  "Start email change": "E-mailadres wijzigen",
  "Post a time": "Een tijd plaatsen",
  "That comparison is not available.": "Die vergelijking is niet beschikbaar.",
  "The community overview is temporarily unavailable.": "Het communityoverzicht is tijdelijk niet beschikbaar.",
  "The comparison is temporarily unavailable.": "De vergelijking is tijdelijk niet beschikbaar.",
  "The ranking could not be loaded. Retry later.": "De ranglijst kon niet worden geladen. Probeer het later opnieuw.",
  "The record book is temporarily unavailable.": "Het recordboek is tijdelijk niet beschikbaar.",
  "The Time Trial Rank is temporarily unavailable.": "De Time Trial-ranglijst is tijdelijk niet beschikbaar.",
  "This is your own time.": "Dit is je eigen tijd.",
  "Time Trial preferences": "Time Trial-voorkeuren",
  "Tournaments": "Toernooien",
  "Tracks & Cups": "Circuits en bekers",
  "Welcome back,": "Welkom terug,",
  "Welcome! Set up your Player to start racing.": "Welkom! Stel je speler in om te beginnen met racen.",
  "Your focus": "Jouw focus",
  "Lowest mastery": "Laagste Mastery",
  "Closest rival": "Dichtste rivaal",
  "Biggest gap": "Grootste achterstand",
  "Staff ghost target": "Staff-ghostdoel",
  "Staff ghosts left": "Staff-ghosts te verslaan",
  "Outside the top 10": "Buiten de top 10",
  "Within 1s of #1": "Binnen 1 s van #1",
  "Current track records": "Huidige circuitrecords",
  "Next track target": "Volgend circuitdoel",
  "Tracks left to drive": "Circuits nog te rijden",
  "Top 3 positions": "Top 3-posities",
  "RACE. RECORD. IMPROVE.": "RACE. LEG VAST. VERBETER.",
  "Explore all 96 tracks, compare the community and publish your own best times.": "Ontdek alle 96 circuits, vergelijk je met de community en publiceer je beste tijden.",
  "Choose a cup and track, then enter your result.": "Kies een beker en circuit en voer daarna je tijd in.",
  "Explore 96 tracks": "Ontdek 96 circuits",
  "Leaderboards, WR and Nintendo ghosts.": "Ranglijsten, wereldrecords en Nintendo-ghosts.",
  "Build your kart": "Stel je voertuig samen",
  "Compare character, body, tyres and glider.": "Vergelijk coureur, chassis, banden en paraglider.",
  "Sign in to see your focus, rivals and recommended next race.": "Meld je aan voor je focus, rivalen en aanbevolen volgende race.",
  "View result details": "Resultaatdetails bekijken",
  "Ranking": "Ranglijst",
  "Global and rival Time Trial standing": "Wereldwijde Time Trial-stand en stand onder rivalen",
  "Time Trials": "Time Trials",
  "Tournament rating": "Toernooirating",
  "Average": "Gemiddelde",
  "vs you": "tegen jou",
  "Selected": "Geselecteerd",
  "Step 2 · Participants & consoles": "Stap 2 · Deelnemers en consoles",
  "Players from previous Tournaments start Absent. Mark arrivals as Present or Waiting, then select NS1/NS2 for the consoles they brought.": "Spelers uit eerdere toernooien beginnen als Afwezig. Markeer gearriveerde spelers als Aanwezig of Wachtlijst en selecteer daarna NS1/NS2 voor hun meegebrachte consoles.",
  "Hide inactive absent Players": "Inactieve afwezige spelers verbergen",
  "Inactive": "Inactief",
  "Filter the Player roster…": "Spelerslijst filteren…",
  "Missing Player or legacy roster?": "Ontbreekt er een speler of is dit een oude lijst?",
  "Synchronize Tournament history": "Toernooihistorie synchroniseren",
  "Add Players from latest 3 TNs": "Spelers uit de laatste 3 toernooien toevoegen",
  "Present": "Aanwezig",
  "Waiting list": "Wachtlijst",
  "Absent": "Afwezig",
  "Verified Time Trials": "Geverifieerde Time Trials",
  "The community's notable Time Trial records.": "Opvallende Time Trial-records van de community.",
  "DRIVER & COLOR": "COUREUR EN KLEUR",
  "✓ Optimum Build": "✓ Optimale combinatie",
  "☆ Not The Meta": "☆ Geen meta-combinatie",
  "SPEED": "SNELHEID",
  "Ground": "Grond",
  "Water": "Water",
  "Air": "Lucht",
  "Anti-Gravity": "Anti-zwaartekracht",
  "HANDLING": "BESTURING",
  "OTHER": "OVERIG",
  "countries represented": "vertegenwoordigde landen",
  "published Time Trials": "gepubliceerde Time Trials",
  "Countries appear when Players choose to show one — never inferred.": "Landen verschijnen alleen wanneer spelers ervoor kiezen hun land te tonen — het wordt nooit afgeleid.",
};

function dynamicDutchPresentation(value: string): string | undefined {
  let status = /^(Present|Waiting list|Absent) (\d+)$/.exec(value);
  if (status) return `${status[1] === "Present" ? "Aanwezig" : status[1] === "Waiting list" ? "Wachtlijst" : "Afwezig"} ${status[2]}`;
  const inactive = /^Hide inactive absent Players \((\d+)\)$/.exec(value);
  if (inactive) return `Inactieve afwezige spelers verbergen (${inactive[1]})`;
  let match = /^(\d+)h ago$/.exec(value);
  if (match) return `${match[1]} uur geleden`;
  match = /^(\d+)d ago$/.exec(value);
  if (match) return `${match[1]} ${match[1] === "1" ? "dag" : "dagen"} geleden`;
  match = /^View (\d+) runs & details$/.exec(value);
  if (match) return `${match[1]} runs en details bekijken`;
  match = /^(\d+) Players · (.+)$/.exec(value);
  if (match) {
    const detail = match[2]!
      .replace("Base 48", "Basis 48")
      .replace("BCP 48", "Uitbreiding 48")
      .replace("All 96", "Alle 96")
      .replace(/total across (\d+) tracks/u, "totaal over $1 circuits")
      .replace("click a Player column to sort", "klik op een spelerskolom om te sorteren");
    return `${match[1]} spelers · ${detail}`;
  }
  match = /^(\d+) tracks led$/.exec(value);
  if (match) return `${match[1]} circuits aangevoerd`;
  match = /^(\d+) podium places$/.exec(value);
  if (match) return `${match[1]} podiumplaatsen`;
  match = /^(\d+) track·class combos$/.exec(value);
  if (match) return `${match[1]} circuit-klassecombinaties`;
  match = /^Compare (\d+\/\d+):$/.exec(value);
  if (match) return `Vergelijk ${match[1]}:`;
  return undefined;
}

const phrases: readonly (readonly [string, string])[] = [
  ["Nintendo Ghost", "Nintendo-ghost"],
  ["World Record", "Wereldrecord"],
  ["Search tracks", "Circuits zoeken"],
  ["Search track", "Circuit zoeken"],
  ["Search player", "Speler zoeken"],
  ["No tracks", "Geen circuits"],
  ["No track", "Geen circuit"],
  [" tracks available", " circuits beschikbaar"],
  [" tracks driven", " circuits gereden"],
  [" tracks", " circuits"],
  [" cups", " bekers"],
  [" laps", " ronden"],
  ["Lap ", "Ronde "],
  ["coins", "munten"],
  ["mushrooms", "paddenstoelen"],
  ["Country", "Land"],
  ["Character", "Coureur"],
  ["Body", "Chassis"],
  ["Tires", "Banden"],
  ["Tire", "Banden"],
  ["Glider", "Paraglider"],
  ["Player", "Speler"],
  ["Track", "Circuit"],
  ["Cups", "Bekers"],
];
const domainNames = Object.entries(DUTCH_PRESENTATION_BY_ENGLISH)
  .filter(([english, dutch]) => english !== dutch)
  .sort(([left], [right]) => right.length - left.length);

/**
 * The page's English text in a catalog language (roadmap LANGUAGES_15 B): the whole text from the catalog
 * (exactly or by message template), then its game names replaced — a catalog text may keep an English game
 * name the translator could not verify; surrounding whitespace is kept.
 */
function catalogPresentation(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) return value;
  const translated = replaceGameNames(translateEnglish(trimmed) ?? trimmed);
  if (translated === trimmed) return value;
  const start = value.indexOf(trimmed);
  return `${value.slice(0, start)}${translated}${value.slice(start + trimmed.length)}`;
}

/** Whether rendered English is rewritten on the page: Dutch by its own copy, the others by their catalog. */
function translatesPage(): boolean {
  return productLanguage() === "nl" || usesProductCatalog();
}

export function dutchPresentation(value: string): string {
  if (value.length > 0 && usesProductCatalog()) return catalogPresentation(value);
  if (productLanguage() !== "nl" || value.length === 0) return value;
  const exactDomain = DUTCH_PRESENTATION_BY_ID[value] ?? DUTCH_PRESENTATION_BY_ENGLISH[value];
  if (exactDomain !== undefined) return exactDomain;
  const trimmed = value.trim();
  let translated = exact[trimmed] ?? dynamicDutchPresentation(trimmed) ?? trimmed;
  for (const [english, dutch] of domainNames) translated = translated.replaceAll(english, dutch);
  for (const [english, dutch] of phrases) translated = translated.replaceAll(english, dutch);
  if (translated === trimmed) return value;
  const start = value.indexOf(trimmed);
  return `${value.slice(0, start)}${translated}${value.slice(start + trimmed.length)}`;
}

export function presentationSearchText(value: string): string {
  const dutch = DUTCH_PRESENTATION_BY_ID[value] ?? DUTCH_PRESENTATION_BY_ENGLISH[value] ?? value;
  return `${value}\n${dutch}`.toLocaleLowerCase("nl-NL");
}

function localizeAttributes(element: Element): void {
  for (const attribute of ["placeholder", "title", "aria-label"] as const) {
    const value = element.getAttribute(attribute);
    if (value !== null) {
      const translated = dutchPresentation(value);
      if (translated !== value) element.setAttribute(attribute, translated);
    }
  }
}

function localizeElement(element: Element): void {
  if (element.matches("script, style")) return;
  localizeAttributes(element);
  // Descendants' attributes as well: a whole subtree is often inserted at once.
  for (const child of element.querySelectorAll("[placeholder], [title], [aria-label]")) localizeAttributes(child);
  const document = element.ownerDocument;
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let current = walker.nextNode();
  while (current !== null) {
    if (current.parentElement?.matches("script, style") !== true) {
      const value = current.nodeValue ?? "";
      const translated = dutchPresentation(value);
      if (translated !== value) current.nodeValue = translated;
    }
    current = walker.nextNode();
  }
}

export function installDutchUiCopy(document: Document): () => void {
  if (translatesPage()) localizeElement(document.documentElement);
  const observe = (): void => observer.observe(
    document.documentElement,
    // Attributes too: a title or aria-label is often set after its element is on the page.
    {
      childList: true, subtree: true, characterData: true,
      attributes: true, attributeFilter: ["placeholder", "title", "aria-label"],
    },
  );
  const observer = new MutationObserver((mutations) => {
    if (!translatesPage()) return;
    // Translating a node changes text/attributes itself. Disconnect while
    // applying the batch so those deliberate writes cannot recursively queue
    // a second MutationObserver batch on dense, dynamically mounted pages.
    observer.disconnect();
    try {
      for (const mutation of mutations) {
        if (mutation.type === "attributes" && mutation.target instanceof Element) {
          localizeAttributes(mutation.target);
          continue;
        }
        if (mutation.type === "characterData" && mutation.target.parentElement !== null) {
          localizeElement(mutation.target.parentElement);
        }
        for (const node of mutation.addedNodes) {
          if (node instanceof Element) localizeElement(node);
          else if (node.parentElement !== null) localizeElement(node.parentElement);
        }
      }
    } finally {
      observe();
    }
  });
  observe();
  const languageListener = (): void => {
    // A whole-document live rewrite can recursively wake the MutationObserver
    // while a dense Tournament reconciliation board is mounted. Language is
    // a persisted product setting, so rebuild one clean DOM in the selected
    // language instead of mutating thousands of existing result nodes.
    document.defaultView?.location.reload();
  };
  document.addEventListener("mk8dx-language-change", languageListener);
  return () => {
    observer.disconnect();
    document.removeEventListener("mk8dx-language-change", languageListener);
  };
}
