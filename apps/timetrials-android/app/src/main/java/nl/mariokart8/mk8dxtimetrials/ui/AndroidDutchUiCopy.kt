package nl.mariokart8.mk8dxtimetrials.ui

internal object AndroidDutchUiCopy {
    private fun tournamentState(value: String): String = when (value.lowercase()) {
        "setup" -> "VOORBEREIDING"
        "qualifier" -> "KWALIFICATIE"
        "final" -> "FINALE"
        "finalized" -> "AFGEROND"
        else -> value
    }

    private val exact = mapOf(
        "Accept" to "Accepteren",
        "Account" to "Account",
        "Active Player settings" to "Instellingen actieve speler",
        "Add account" to "Account toevoegen",
        "All cups" to "Alle bekers",
        "All players" to "Alle spelers",
        "Among rivals" to "Onder rivalen",
        "Approve this request in your browser" to "Keur dit verzoek goed in je browser",
        "Automatic input" to "Automatische invoer",
        "Back" to "Terug",
        "Back to saved results" to "Terug naar opgeslagen resultaten",
        "Base game" to "Basisspel",
        "Body" to "Chassis",
        "Booster Course Pass" to "Circuit-uitbreidingspas",
        "Bring your progress with you" to "Neem je voortgang mee",
        "Build" to "Voertuig",
        "BUILD" to "VOERTUIG",
        "BUILD STATS" to "VOERTUIGSTATISTIEKEN",
        "Camera" to "Camera",
        "Cancel" to "Annuleren",
        "Change track" to "Circuit wijzigen",
        "Character" to "Coureur",
        "Character and kart setup not recorded." to "Coureur en voertuigconfiguratie niet vastgelegd.",
        "Check approval" to "Goedkeuring controleren",
        "Choose a test result" to "Kies een testresultaat",
        "Choose another track" to "Kies een ander circuit",
        "Choose every part to review this build." to "Kies elk onderdeel om dit voertuig te beoordelen.",
        "Choose rivals in Settings" to "Kies rivalen bij Instellingen",
        "Clear" to "Wissen",
        "Clear kart setup" to "Voertuigconfiguratie wissen",
        "Close" to "Sluiten",
        "Coins" to "Munten",
        "Coins gained / lost" to "Munten verzameld / verloren",
        "Community" to "Community",
        "Community activity" to "Communityactiviteit",
        "COMMUNITY ACTIVITY" to "COMMUNITYACTIVITEIT",
        "Confirm" to "Bevestigen",
        "Contacting authentication…" to "Verbinding maken met aanmelden…",
        "Adjust" to "Aanpassen",
        "Correct track" to "Circuit corrigeren",
        "Country" to "Land",
        "Create Tournament" to "Toernooi maken",
        "Create new Tournament" to "Nieuw toernooi maken",
        "Cancel new Tournament" to "Nieuw toernooi annuleren",
        "Current level" to "Huidig niveau",
        "Delta per track" to "Verschil per circuit",
        "Details" to "Details",
        "Device code" to "Apparaatcode",
        "Edit" to "Bewerken",
        "Email me a sign-in link" to "Stuur mij een aanmeldlink",
        "English" to "Engels",
        "Enter a time and confirm twice" to "Voer een tijd in en bevestig tweemaal",
        "Enter another result" to "Voer nog een resultaat in",
        "Enter coins gained or lost per lap." to "Voer per ronde verzamelde of verloren munten in.",
        "Filter player name" to "Spelersnaam filteren",
        // The scanner's own phase wording, shared with the v0.4.1 recognition UX.
        "Finding card…" to "Kaart zoeken…",
        "Finding time slots…" to "Tijdvakken vinden…",
        "Reading times…" to "Tijden lezen…",
        "Identifying setup…" to "Setup herkennen…",
        "Confirming setup…" to "Setup bevestigen…",
        "Aim at the result screen" to "Richt op het resultaatscherm",
        "Aim at the ghost panel" to "Richt op het ghost-paneel",
        "End screen" to "Eindscherm",
        "Ghost panel" to "Ghost-paneel",
        "Scanning" to "Scannen",
        "Finalize Tournament" to "Toernooi afronden",
        "All Tournaments" to "Alle toernooien",
        "Choose a Tournament" to "Kies een toernooi",
        "Open Tournament" to "Toernooi openen",
        "Delete draft" to "Concept verwijderen",
        "Confirm delete" to "Verwijderen bevestigen",
        "First choose a track" to "Kies eerst een circuit",
        "Full account settings" to "Alle accountinstellingen",
        "Gallery" to "Galerij",
        "Generate final groups" to "Finalegroepen genereren",
        "Generate qualifier groups" to "Kwalificatiegroepen genereren",
        "Global" to "Wereldwijd",
        "Glider" to "Paraglider",
        "Groups" to "Groepen",
        "Home" to "Home",
        "Improve by" to "Verbeter met",
        "Kart setup" to "Voertuigconfiguratie",
        "Keep account" to "Account behouden",
        "Language / Taal" to "Taal / Language",
        "Lap" to "Ronde",
        "Lap time" to "Rondetijd",
        "Lap times" to "Rondetijden",
        "Loading…" to "Laden…",
        "Lowest mastery" to "Laagste Mastery",
        "Manual input" to "Handmatige invoer",
        "Manual entry" to "Handmatige invoer",
        "Mastery" to "Mastery",
        "Mastery total" to "Mastery-totaal",
        "Medals" to "Medailles",
        "Mushrooms" to "Paddenstoelen",
        "My results" to "Mijn resultaten",
        "NEEDS SEAT" to "HEEFT ZITPLAATS NODIG",
        "NO SAVED RESULTS YET" to "NOG GEEN OPGESLAGEN RESULTATEN",
        "Nintendo Ghost" to "Nintendo-ghost",
        "Nintendo Staff" to "Nintendo-staf",
        "No active tournament" to "Geen actief toernooi",
        "No recent activity yet." to "Nog geen recente activiteit.",
        "No result details available." to "Geen resultaatdetails beschikbaar.",
        "No rivals selected yet." to "Nog geen rivalen geselecteerd.",
        "No tracks found" to "Geen circuits gevonden",
        "No verified times yet." to "Nog geen geverifieerde tijden.",
        "Nobody ahead yet" to "Nog niemand voor je",
        "Not driven" to "Niet gereden",
        "Not recorded" to "Niet vastgelegd",
        "Notifications" to "Meldingen",
        "Open" to "Openen",
        "Other tournaments" to "Andere toernooien",
        "Park" to "Parkeren",
        "Player" to "Speler",
        "Player on this phone" to "Speler op deze telefoon",
        "PLAYERS" to "SPELERS",
        "PLAYERS ON THIS PHONE" to "SPELERS OP DEZE TELEFOON",
        "Position" to "Positie",
        "Prepare retry" to "Opnieuw proberen voorbereiden",
        "Profile" to "Profiel",
        "Profile & Records" to "Profiel en records",
        "Public results" to "Openbare resultaten",
        "RANK" to "RANGLIJST",
        "Rank" to "Ranglijst",
        "Recent verified sessions" to "Recente geverifieerde sessies",
        "Records" to "Records",
        "Reference players" to "Referentiespelers",
        "Reference Players" to "Referentiespelers",
        "Refresh" to "Vernieuwen",
        "Reject" to "Afwijzen",
        "Relevant classes" to "Relevante klassen",
        "Remove" to "Verwijderen",
        "Reset filters" to "Filters herstellen",
        "Retry" to "Opnieuw proberen",
        "Review" to "Controleren",
        "Rivals" to "Rivalen",
        "Save" to "Opslaan",
        "Saved results" to "Opgeslagen resultaten",
        "Scan" to "Scannen",
        "SCAN RESULT" to "SCANRESULTAAT",
        "Screen name" to "Schermnaam",
        "Search" to "Zoeken",
        "Search character" to "Coureur zoeken",
        "Search body" to "Chassis zoeken",
        "Search tire" to "Banden zoeken",
        "Search glider" to "Paraglider zoeken",
        "Search player" to "Speler zoeken",
        "Search player name" to "Spelersnaam zoeken",
        "Search track" to "Circuit zoeken",
        "Select" to "Selecteren",
        "Settings" to "Instellingen",
        "Share" to "Delen",
        "Sign in" to "Aanmelden",
        "Sign out" to "Afmelden",
        "Smallest gap" to "Kleinste verschil",
        "Standings" to "Stand",
        "Post" to "Plaatsen",
        "SUBMIT TIME TRIAL" to "TIME TRIAL INSTUREN",
        "Sync" to "Synchroniseren",
        "Synchronize" to "Synchroniseren",
        "Take photo" to "Foto maken",
        "Test result" to "Testresultaat",
        "Time" to "Tijd",
        "Time Trial preference" to "Time Trial-voorkeur",
        "Tire" to "Banden",
        "Total" to "Totaal",
        "Tournament" to "Toernooi",
        "Track" to "Circuit",
        "Tracks" to "Circuits",
        "Try again" to "Opnieuw proberen",
        "Use camera" to "Camera gebruiken",
        "Waiting to sync" to "Wacht op synchronisatie",
        "World Record" to "Wereldrecord",
        "96 TRACKS" to "96 CIRCUITS",
        "YOUR FOCUS" to "JOUW FOCUS",
        "Your Focus" to "Jouw focus",
        "Affects TrueSkill" to "Telt mee voor TrueSkill",
        "ALIGN THE RESULT SCREEN" to "LIJN HET RESULTAATSCHERM UIT",
        "Approve this request in your browser, then check it here." to "Keur dit verzoek goed in je browser en controleer het daarna hier.",
        "Browse and compare without signing in. Nintendo Ghost is selected as the default reference." to "Bekijk en vergelijk zonder aan te melden. Nintendo-ghost is standaard als referentie geselecteerd.",
        "Choose rivals in Settings on the configured website; your global and Mastery views remain available." to "Kies rivalen bij Instellingen op de ingestelde website; je wereldwijde stand en Mastery-overzicht blijven beschikbaar.",
        "Community, your best and official references" to "Community, jouw beste tijd en officiële referenties",
        "Fill the frame with the MK8DX result screen" to "Vul het kader met het MK8DX-resultaatscherm",
        "Finalization pins the current results. Public visibility and rating inclusion are independent choices." to "Bij afronden worden de huidige resultaten vastgezet. Openbare zichtbaarheid en meetellen voor de rating zijn afzonderlijke keuzes.",
        "Loading notifications…" to "Meldingen laden…",
        "Loading rivals…" to "Rivalen laden…",
        "Loading Tournament…" to "Toernooi laden…",
        "Loading track times…" to "Circuittijden laden…",
        "Loading your results…" to "Jouw resultaten laden…",
        "Loading your standings…" to "Jouw stand laden…",
        "Manage profile character, country, rivals, follows and visibility on the configured website." to "Beheer profielcoureur, land, rivalen, gevolgde spelers en zichtbaarheid op de ingestelde website.",
        "Manual entry and scanning still work on this phone without signing in." to "Handmatig invoeren en scannen werken op deze telefoon ook zonder aanmelding.",
        "MK8DX Kart Builder" to "MK8DX-voertuigbouwer",
        "No accepted private Groups yet. Manage invitations in Settings." to "Nog geen geaccepteerde privégroepen. Beheer uitnodigingen bij Instellingen.",
        "No active Tournament" to "Geen actief toernooi",
        "No Nintendo Switch assigned yet" to "Nog geen Nintendo Switch-systeem toegewezen",
        "No recent community activity yet — be the first." to "Nog geen recente communityactiviteit — wees de eerste.",
        "No record holder yet." to "Nog geen recordhouder.",
        "Most leaderboard #1s" to "Meeste eerste plaatsen",
        "Most published times" to "Meeste gepubliceerde tijden",
        "Widest track coverage" to "Grootste circuitdekking",
        "No result details were recorded for this session." to "Voor deze sessie zijn geen resultaatdetails vastgelegd.",
        "No rivals chosen yet." to "Nog geen rivalen gekozen.",
        "No verified community times yet. Your saved result can be the first." to "Nog geen geverifieerde communitytijden. Jouw opgeslagen resultaat kan het eerste zijn.",
        "Open approval page" to "Goedkeuringspagina openen",
        "Open full web profile" to "Volledig webprofiel openen",
        "Open website settings" to "Website-instellingen openen",
        "Possible duplicate — compare before accepting" to "Mogelijk duplicaat — vergelijk vóór accepteren",
        "Race balance stays 0–10" to "Racebalans blijft 0–10",
        "Race-day control in your pocket" to "Wedstrijddagbediening in je broekzak",
        "RECOGNIZED · LAP SUM VERIFIED" to "HERKEND · SOM VAN RONDEN GECONTROLEERD",
        "Record incident" to "Incident vastleggen",
        "Remove anyway" to "Toch verwijderen",
        "Remove Player" to "Speler verwijderen",
        "Review finalization" to "Afronding controleren",
        "Review order and save race" to "Volgorde controleren en race opslaan",
        "Save incident" to "Incident opslaan",
        "Scan another image" to "Nog een afbeelding scannen",
        "Scanned evidence stays private on this device." to "Gescand bewijs blijft privé op dit apparaat.",
        "Search Player" to "Speler zoeken",
        "Share build" to "Voertuig delen",
        "Sign in for rivals & Groups" to "Meld je aan voor rivalen en groepen",
        "Post a Time Trial" to "Een Time Trial plaatsen",
        "Sync now" to "Nu synchroniseren",
        "Tap a Player to move or park them" to "Tik op een speler om die te verplaatsen of te parkeren",
        "Tap Players in finish order" to "Tik spelers aan in finishvolgorde",
        "TEST RESULT · EXPIRES IN 24 HOURS" to "TESTRESULTAAT · VERLOOPT OVER 24 UUR",
        "The global standing uses your total across all 96 tracks." to "De wereldwijde stand gebruikt je totaaltijd over alle 96 circuits.",
        "Top of the recovered 23-level Mastery ladder." to "Bovenaan de herstelde Mastery-ladder met 23 niveaus.",
        "TOURNAMENT" to "TOERNOOI",
        "Tournament finalized" to "Toernooi afgerond",
        "Tournament name" to "Toernooinaam",
        "Tournament unavailable" to "Toernooi niet beschikbaar",
        "Tournament workflow" to "Toernooiworkflow",
        "Try a test scan" to "Probeer een testscan",
        "TT SCAN" to "TT-SCAN",
        "Unknown source" to "Onbekende bron",
        "Updating…" to "Bijwerken…",
        "Used" to "Gebruikt",
        "View track" to "Circuit bekijken",
        "What happened?" to "Wat is er gebeurd?",
        "Who is racing?" to "Wie rijdt er?",
        "You can prepare a run offline" to "Je kunt offline een rit voorbereiden",
        "Ranking is temporarily unavailable." to "De ranglijst is tijdelijk niet beschikbaar.",
        "RESULT SCANNER" to "RESULTAATSCANNER",
        "0–3 used" to "0–3 gebruikt",
        "0–10 balance" to "0–10 balans",
        "All rivals are in scope. Select up to 3 columns for direct comparison." to "Alle rivalen vallen binnen het filter. Selecteer maximaal 3 kolommen voor een directe vergelijking.",
        "Air" to "Lucht",
        "Acceleration" to "Acceleratie",
        "Anti-Gravity" to "Anti-zwaartekracht",
        "Choose a Cup" to "Kies een beker",
        "Choose every part and compare the real in-game stat contributions." to "Kies elk onderdeel en vergelijk de echte bijdrage aan de spelstatistieken.",
        "Choose your track" to "Kies je circuit",
        "CLOSEST BATTLE" to "KLEINSTE DUEL",
        "BIGGEST GAP" to "GROOTSTE ACHTERSTAND",
        "Create the Tournament here, then add Players, generate groups, run races and finalize the result without leaving Android." to "Maak hier het toernooi, voeg spelers toe, genereer groepen, rijd races en rond het resultaat af zonder Android te verlaten.",
        "Delta\nper track" to "Verschil\nper circuit",
        "Enter a time manually or scan a Switch result. It is saved safely on this phone first, then synced to the website." to "Voer handmatig een tijd in of scan een resultaat van je Nintendo Switch. Het resultaat wordt eerst veilig op deze telefoon opgeslagen en daarna met de website gesynchroniseerd.",
        "Full lap, coin, mushroom and build details when recorded" to "Volledige ronde-, munt-, paddenstoel- en voertuigdetails indien vastgelegd",
        "Ground" to "Grond",
        "Handling" to "Besturing",
        "Invincibility" to "Onkwetsbaarheid",
        "Latest Time Trials" to "Nieuwste Time Trials",
        "LOWEST MASTERY" to "LAAGSTE MASTERY",
        "Meta target: combine any character, body, tires and glider that reach exactly 3.25 Ground Speed and 4.75 Mini-Turbo. Optimum alternatives follow the Magic 8 rule: both stats total 8.00 and Ground Speed is not higher than Mini-Turbo." to "Meta-doel: combineer een coureur, chassis, banden en paraglider die samen exact 3.25 grondsnelheid en 4.75 Mini-Turbo bereiken. Optimale alternatieven volgen de Magic 8-regel: beide waarden zijn samen 8.00 en grondsnelheid is niet hoger dan Mini-Turbo.",
        "No notifications yet." to "Nog geen meldingen.",
        "No saved results" to "Geen opgeslagen resultaten",
        "Not The Meta" to "Niet de meta",
        "Optimum Build" to "Optimale combinatie",
        "Optimum Build: Speed + Mini-Turbo is 8.00 and Speed does not exceed Mini-Turbo." to "Optimale combinatie: snelheid + Mini-Turbo is 8.00 en snelheid is niet hoger dan Mini-Turbo.",
        "Other" to "Overig",
        "Public 96-track standings and direct comparisons with community Players, Nintendo Ghost and World Record." to "Openbare stand over 96 circuits en directe vergelijkingen met communityspelers, Nintendo-ghost en wereldrecord.",
        "Refresh saved results" to "Opgeslagen resultaten vernieuwen",
        "Result details" to "Resultaatdetails",
        "RIVAL FILTERS" to "RIVALENFILTERS",
        "SAVED RESULTS" to "OPGESLAGEN RESULTATEN",
        "Search tracks" to "Circuits zoeken",
        "Select body" to "Chassis selecteren",
        "Select character" to "Coureur selecteren",
        "Select glider" to "Paraglider selecteren",
        "Select tire" to "Banden selecteren",
        "Speed" to "Snelheid",
        "Start a new result with manual input or use the camera scanner." to "Start een nieuw resultaat met handmatige invoer of gebruik de camerascanner.",
        "Sign in to sync results to your Player profile. You can explore the app first." to "Meld je aan om resultaten met je spelersprofiel te synchroniseren. Je kunt de app ook eerst bekijken.",
        "Switch Player" to "Van speler wisselen",
        "Sync all" to "Alles synchroniseren",
        "Time Trial standing & Mastery" to "Time Trial-stand en Mastery",
        "Tap a Player column to sort by that Player's delta." to "Tik op een spelerskolom om te sorteren op het verschil van die speler.",
        "Tires" to "Banden",
        "Traction" to "Grip",
        "Track ↑" to "Circuit ↑",
        "Track ↕" to "Circuit ↕",
        "Water" to "Water",
        "Weight" to "Gewicht",
        "✓ Optimum Build" to "✓ Optimale combinatie",
        "☆ Not The Meta" to "☆ Niet de meta",
        "Your published Time Trials and the community record book." to "Jouw gepubliceerde Time Trials en het recordboek van de community.",
        "Community updates are unavailable. Check your connection and retry; local Time Trial tools still work." to "Community-updates zijn niet beschikbaar. Controleer je verbinding en probeer het opnieuw; de lokale Time Trial-functies blijven werken.",
        "Community Records" to "Communityrecords",
        "The same community records as the website" to "Dezelfde communityrecords als op de website",
        "Manual Time Trial" to "Handmatige Time Trial",
        "SCAN A TIME TRIAL" to "EEN TIME TRIAL SCANNEN",
        "First choose the track shown in your result. Recognition reads the time, laps, Player and kart setup." to "Kies eerst het circuit dat in je uitslag staat. De scanner leest de tijd, ronden, speler en voertuigconfiguratie.",
        "Recognition is never saved automatically. Check the highlighted result, then correct or accept it." to "Een herkende uitslag wordt nooit automatisch opgeslagen. Controleer de gemarkeerde gegevens en corrigeer of accepteer ze daarna.",
        "This uses the real Player, offline save and website sync, but never counts toward rankings or records." to "Dit gebruikt de echte speler, lokale opslag en synchronisatie met de website, maar telt nooit mee voor ranglijsten of records.",
        "Scanned result evidence" to "Afbeelding van de gescande uitslag",
        "Not read" to "Niet herkend",
        "Recognition checks passed" to "Herkenningscontroles geslaagd",
        "Correct any recognized part, or mark it as not recorded." to "Corrigeer verkeerd herkende onderdelen of markeer ze als niet vastgelegd.",
        "Retry save" to "Opnieuw opslaan",
        "Save test" to "Test opslaan",
        "Save result" to "Uitslag opslaan",
        "Not saved yet" to "Nog niet opgeslagen",
        "Saving safely on this phone…" to "Veilig opslaan op deze telefoon…",
        "Saved safely. Automatic sync is queued." to "Veilig opgeslagen. Automatische synchronisatie staat klaar.",
        "Save failed. The reviewed result is still here." to "Opslaan is mislukt. De gecontroleerde uitslag staat nog op dit scherm.",
        "Choose camera or a saved Switch screenshot" to "Kies de camera of een opgeslagen Switch-schermafbeelding",
        "Scanning stays local. Sign in so the reviewed result belongs to the right Player." to "Scannen gebeurt lokaal. Meld je aan zodat de gecontroleerde uitslag bij de juiste speler hoort.",
        "Sign in before saving" to "Meld je aan vóór het opslaan",
        "Scanner unavailable" to "Scanner niet beschikbaar",
        "This public build does not contain the owner-private offline recognition package." to "Deze openbare versie bevat niet het privé gehouden offline herkenningspakket van de beheerder.",
        "Running Tournament nights is for Directors; you can ask to host on the Tournaments tab. Time Trials remain fully usable." to "Toernooiavonden draaien is voor Directeuren; op het tabblad Toernooien kun je vragen om te hosten. Time Trials blijven volledig bruikbaar.",
        "Tournament is unavailable right now. Your Time Trials are unaffected." to "Het toernooi is nu niet beschikbaar. Dit heeft geen invloed op je Time Trials.",
        "The Tournament could not be created." to "Het toernooi kon niet worden gemaakt.",
        "The Tournament could not be deleted." to "Het toernooi kon niet worden verwijderd.",
        "Only a draft without recorded races can be deleted." to "Alleen een concept zonder vastgelegde races kan worden verwijderd.",
        "Could not load that Tournament." to "Dat toernooi kon niet worden geladen.",
        "The Tournament changed elsewhere. Refresh and try again." to "Het toernooi is elders gewijzigd. Vernieuw en probeer het opnieuw.",
        "That change could not be saved." to "Die wijziging kon niet worden opgeslagen.",
        "Incoming results could not be refreshed." to "Binnenkomende uitslagen konden niet worden vernieuwd.",
        "Race-day control in your pocket" to "Wedstrijddagbediening in je broekzak",
        "Sign in as a Director to view attendance, seating, stations, groups, standings and incoming results." to "Meld je aan als Directeur om aanwezigheid, indeling, stations, groepen, standen en binnenkomende uitslagen te bekijken.",
        "Qualifiers + finals" to "Kwalificatie + finales",
        "One compact group phase" to "Eén compacte groepsfase",
        "Maximum participants (optional)" to "Maximumaantal deelnemers (optioneel)",
        "Overview" to "Overzicht",
        "People" to "Deelnemers",
        "Incoming" to "Binnenkomend",
        "Scores" to "Scores",
        "Start" to "Start",
        "Players" to "Spelers",
        "Qualifier layout" to "Kwalificatie-indeling",
        "Layout export" to "Indeling delen",
        "Qualifier scores" to "Kwalificatiescores",
        "Result export" to "Uitslag delen",
        "Final layout" to "Finale-indeling",
        "Final export" to "Finale delen",
        "Final scores" to "Finalescores",
        "Final result" to "Einduitslag",
        "Layout" to "Indeling",
        "Scores" to "Scores",
        "Result" to "Uitslag",
        "Export" to "Delen",
        "Swipe for later steps →" to "Veeg voor latere stappen →",
        "Create qualifier groups" to "Kwalificatiegroepen maken",
        "Confirm qualifier layout" to "Kwalificatie-indeling bevestigen",
        "Share qualifier layout" to "Kwalificatie-indeling delen",
        "Layout checked · enter scores" to "Indeling gecontroleerd · voer scores in",
        "Confirm all scores" to "Alle scores bevestigen",
        "Share results" to "Uitslagen delen",
        "Create final groups" to "Finalegroepen maken",
        "Confirm final layout" to "Finale-indeling bevestigen",
        "Share final layout" to "Finale-indeling delen",
        "Layout checked · enter final scores" to "Indeling gecontroleerd · voer finalescores in",
        "Share final result" to "Einduitslag delen",
        "Previous step" to "Vorige stap",
        "Confirm previous step · later data is cleared" to "Vorige stap bevestigen · latere gegevens worden gewist",
        "Present" to "Aanwezig",
        "Waiting" to "Wachtlijst",
        "Absent" to "Afwezig",
        "Stations" to "Stations",
        "Races" to "Races",
        "Nintendo Switch stations & cable plan" to "Nintendo Switch-stations en kabelplan",
        "No Nintendo Switch stations assigned" to "Nog geen Nintendo Switch-stations toegewezen",
        "Progress" to "Voortgang",
        "Participants & attendance" to "Deelnemers en aanwezigheid",
        "Players from previous Tournaments start Absent. Tap A, W or X, then mark NS1/NS2 for consoles brought to the event." to "Spelers uit eerdere toernooien beginnen als Afwezig. Tik op A, W of X en markeer daarna NS1/NS2 voor meegebrachte consoles.",
        "Open another Tournament, resume a draft or start a new event." to "Open een ander toernooi, hervat een concept of start een nieuw evenement.",
        "Delete this draft permanently? This is only allowed before races are recorded." to "Dit concept definitief verwijderen? Dit kan alleen voordat races zijn vastgelegd.",
        "Hide inactive absent Players" to "Inactieve afwezige spelers verbergen",
        "Loading Tournament history…" to "Toernooihistorie laden…",
        "No historical Players are loaded yet." to "Er zijn nog geen historische spelers geladen.",
        "Inactive" to "Inactief",
        "Filter the Player roster" to "Spelerslijst filteren",
        "Missing Player or legacy roster?" to "Ontbreekt er een speler of is dit een oude lijst?",
        "Hide roster tools" to "Lijsthulpmiddelen verbergen",
        "Roster tools" to "Lijsthulpmiddelen",
        "Synchronize Tournament history" to "Toernooihistorie synchroniseren",
        "All known Players" to "Alle bekende spelers",
        "Add Players from latest 3 TNs" to "Spelers uit de laatste 3 toernooien toevoegen",
        "Filter or search Player" to "Speler filteren of zoeken",
        "Groups, seating & stations" to "Groepen, indeling en stations",
        "Available" to "Beschikbaar",
        "Everyone present has a group." to "Iedere aanwezige speler heeft een groep.",
        "These present Players are safely kept outside the group layout." to "Deze aanwezige spelers blijven veilig buiten de groepsindeling.",
        "Tournament standings" to "Toernooistand",
        "No standings yet — enter or accept a race" to "Nog geen stand — voer een race in of accepteer er een",
        "Tournament Live / Processor incoming results" to "Binnenkomende uitslagen van Tournament Live / Processor",
        "No incoming results are waiting" to "Er wachten geen binnenkomende uitslagen",
        "Recommended on race day: Tournament Live" to "Aanbevolen op de toernooiavond: Tournament Live",
        "Keep Tournament Manager on Step 5. On the capture PC choose Connect to Tournament Manager, select this Tournament and match each feed to the correct qualifier group." to "Laat Tournament Manager op Stap 5 staan. Kies op de capture-pc Verbinden met Tournament Manager, selecteer dit toernooi en koppel iedere feed aan de juiste kwalificatiegroep.",
        "Keep Tournament Manager on Step 9. On the capture PC choose Connect to Tournament Manager, select this Tournament and match each feed to the correct final group." to "Laat Tournament Manager op Stap 9 staan. Kies op de capture-pc Verbinden met Tournament Manager, selecteer dit toernooi en koppel iedere feed aan de juiste finalegroep.",
        "Results appear below under Incoming results and count only after the complete group feed is reviewed and accepted. Excel and manual entry remain available." to "Uitslagen verschijnen hieronder bij Binnenkomende uitslagen en tellen pas mee nadat de volledige groepsfeed is gecontroleerd en geaccepteerd. Excel en handmatige invoer blijven beschikbaar.",
        "Linking creates pending evidence only. Scores count after Player, Track, order and group are reviewed and accepted. Excel and manual entry remain available." to "Koppelen maakt alleen bewijs in afwachting. Scores tellen mee nadat speler, circuit, volgorde en groep zijn gecontroleerd en geaccepteerd. Excel en handmatige invoer blijven beschikbaar.",
        "Connection errors" to "Verbindingsfouten",
        "Score entry" to "Score-invoer",
        "Enter the total per Player, or let Tournament Live / Tournament Processor deliver race results. Excel workbooks can be imported in the web app." to "Voer per speler het totaal in, of laat Tournament Live / Tournament Processor de raceresultaten aanleveren. Excel-werkmappen kun je in de webapp importeren.",
        "Live standings" to "Tussenstand",
        "Manual totals follow the original score sheet. Only confirmed desktop race results can affect TrueSkill." to "Handmatige totalen volgen het originele scoreblad. Alleen bevestigde raceresultaten uit de desktopapps kunnen TrueSkill beinvloeden.",
        "Complete the current guided step first." to "Voltooi eerst de huidige begeleide stap.",
        "Nothing needs your attention" to "Je hoeft niets te doen",
        "The capture operator selects this Tournament and a different current group for each sticker-named feed before Start. Race 1 can confirm the public View automatically; scores still wait for your Player and full group review after Stop." to "De capture-operator selecteert dit toernooi en vóór START voor iedere feed met stickernaam een andere actuele groep. Race 1 kan de openbare View automatisch bevestigen; scores wachten na STOP nog op jouw Player-koppeling en volledige groepscontrole.",
        "No completed recording is available yet." to "Er is nog geen voltooide opname beschikbaar.",
        "Available recordings could not be loaded." to "Beschikbare opnamen konden niet worden geladen.",
        // Authentication and shared-phone account management (2026-08-30
        // sign-in workflow review): every string a person meets between
        // "Sign in" and a working synchronized session.
        "STEP 0 · DIRECTOR" to "STAP 0 · DIRECTEUR",
        "Sign in as the Tournament director" to "Log in als toernooidirecteur",
        "Sign in to synchronize" to "Aanmelden om te synchroniseren",
        "Sign in again" to "Opnieuw aanmelden",
        "Signed in and ready to synchronize." to "Aangemeld en klaar om te synchroniseren.",
        "Contacting the authentication service…" to "Verbinding maken met aanmelden…",
        "The device request was denied." to "Het apparaatverzoek is geweigerd.",
        "The device code expired." to "De apparaatcode is verlopen.",
        "Authentication could not be completed." to "Het aanmelden kon niet worden voltooid.",
        "You're signed in, but this account has no Player yet. Finish the one-step Player setup on the website, then sign in here again." to
            "Je bent aangemeld, maar dit account heeft nog geen speler. Rond de korte spelersetup op de website af en meld je hier daarna opnieuw aan.",
        "Finish Player setup on the website" to "Spelersetup op de website afronden",
        "Not approved yet. Approve the request in your browser, then check again." to
            "Nog niet goedgekeurd. Keur het verzoek goed in je browser en controleer daarna opnieuw.",
        "Switch" to "Wisselen",
        "No accounts are remembered on this device." to "Er zijn geen accounts bekend op dit apparaat.",
        "Expired — sign in again to synchronize" to "Verlopen — meld je opnieuw aan om te synchroniseren",
        "Switch Player quickly on a shared phone. Every saved result keeps the Player who created it." to
            "Wissel snel van speler op een gedeelde telefoon. Elk opgeslagen resultaat blijft van de speler die het maakte.",
        "Sign in to see your Player profile." to "Meld je aan om je spelersprofiel te zien.",
        "Sign in to read your notifications." to "Meld je aan om je meldingen te lezen.",
        "Sign in to compare these times with your PB." to "Meld je aan om deze tijden met je PR te vergelijken.",
        "Sign in to synchronize saved results" to "Meld je aan om opgeslagen resultaten te synchroniseren",
        "Open synchronization" to "Synchronisatie openen",
        "Account unknown" to "Account onbekend",
        "Uploader suggested this Tournament; you decide." to "De uploader stelde dit toernooi voor; jij beslist.",
        "Uploader did not suggest a Tournament." to "De uploader heeft geen toernooi voorgesteld.",
        "Choose matching group" to "Kies de bijbehorende groep",
        "Linked · races remain available. Update these group links after changing the layout." to "Gekoppeld · races blijven beschikbaar. Werk deze groepskoppelingen bij nadat je de indeling wijzigt.",
        "Link reviewed recording" to "Gecontroleerde opname koppelen",
        "Update reviewed group links" to "Gecontroleerde groepskoppelingen bijwerken",
        "The recording could not be linked." to "De opname kon niet worden gekoppeld.",
    )

    fun translate(value: String): String {
        exact[value]?.let { return it }
        Regex("^Hide inactive absent Players \\((\\d+)\\)$").matchEntire(value)?.let {
            return "Inactieve afwezige spelers verbergen (${it.groupValues[1]})"
        }
        Regex("^(\\d+) inactive absent Players are hidden below the board\\.$").matchEntire(value)?.let {
            return "${it.groupValues[1]} inactieve afwezige spelers zijn onder het bord verborgen."
        }
        Regex("^Posting as (.+)$").matchEntire(value)?.let { return "Plaatsen als ${it.groupValues[1]}" }
        Regex("""^of (\d+) Players · total across 96 tracks$""").matchEntire(value)?.let {
            return "van ${it.groupValues[1]} spelers · totaal over 96 circuits"
        }
        Regex("^STEP (\\d+) OF (\\d+)$").matchEntire(value)?.let { return "STAP ${it.groupValues[1]} VAN ${it.groupValues[2]}" }
        Regex("^STEP (\\d+)/(\\d+) · (.+)$").matchEntire(value)?.let {
            return "STAP ${it.groupValues[1]}/${it.groupValues[2]} · ${tournamentState(it.groupValues[3])}"
        }
        Regex("^(\\d+)/(\\d+) present · revision (\\d+)$").matchEntire(value)?.let {
            return "${it.groupValues[1]}/${it.groupValues[2]} aanwezig · versie ${it.groupValues[3]}"
        }
        Regex("^Lowest identity confidence (\\d+)%$").matchEntire(value)?.let {
            return "Laagste herkenningszekerheid ${it.groupValues[1]}%"
        }
        Regex("^Step (5|9) · Tournament Live / Processor incoming results$").matchEntire(value)?.let {
            return "Stap ${it.groupValues[1]} · Binnenkomende uitslagen van Tournament Live / Processor"
        }
        Regex("^Before Start, the capture operator selects this Tournament and maps every sticker-named card to a different (qualifier|final) group\\. After race 1, a strong exact roster match may open the public View\\. Scores count only after Stop, Player matching and complete group approval here\\.$").matchEntire(value)?.let {
            val group = if (it.groupValues[1] == "final") "finalegroep" else "kwalificatiegroep"
            return "Vóór START selecteert de capture-operator dit toernooi en koppelt iedere card met stickernaam aan een andere $group. Na race 1 kan een sterke exacte rostermatch de openbare View openen. Scores tellen pas na STOP, Player-koppeling en volledige groepscontrole hier."
        }
        Regex("^Available Tournament Live recordings \\((\\d+)\\)$").matchEntire(value)?.let {
            return "Beschikbare Tournament Live-opnamen (${it.groupValues[1]})"
        }
        Regex("^Tournament Live · (.+)$").matchEntire(value)?.let {
            return "Tournament Live · ${it.groupValues[1]}"
        }
        Regex("^Recording (.+) – (.+) · (\\d+) races$").matchEntire(value)?.let {
            return "Opname ${it.groupValues[1]} – ${it.groupValues[2]} · ${it.groupValues[3]} races"
        }
        Regex("^Uploader suggested (.+); you may choose this Tournament instead\\.$").matchEntire(value)?.let {
            return "De uploader stelde ${it.groupValues[1]} voor; je mag in plaats daarvan dit toernooi kiezen."
        }
        Regex("^(.+) · (\\d+) races · (\\d+) connection errors$").matchEntire(value)?.let {
            return "${it.groupValues[1]} · ${it.groupValues[2]} races · ${it.groupValues[3]} verbindingsfouten"
        }
        Regex("""^Nothing is waiting yet\. In Tournament Live connect to this Tournament and select the correct (qualifier|final) group for every feed\. Connected results appear here automatically and do not count until accepted\.$""").matchEntire(value)?.let {
            val group = if (it.groupValues[1] == "final") "finalegroep" else "kwalificatiegroep"
            return "Er staat nog niets klaar. Verbind Tournament Live met dit toernooi en selecteer voor iedere feed de juiste $group. Verbonden uitslagen verschijnen hier automatisch en tellen pas mee na acceptatie."
        }
        Regex("^Set every Player to Present, Waiting or Absent and mark NS1/NS2\\. (\\d+)/(\\d+) Nintendo Switches ready\\.$").matchEntire(value)?.let {
            return "Zet elke speler op Aanwezig, Wachtend of Afwezig en markeer NS1/NS2. ${it.groupValues[1]}/${it.groupValues[2]} Nintendo Switch-systemen gereed."
        }
        Regex("^Tap A, W or X for every Player and mark NS1/NS2\\. (\\d+)/(\\d+) Nintendo Switches ready\\.$").matchEntire(value)?.let {
            return "Tik bij elke speler op A, W of X en markeer NS1/NS2. ${it.groupValues[1]}/${it.groupValues[2]} Nintendo Switch-systemen gereed."
        }
        Regex("^(.+) · (Light Blue|Black|Red|Yellow|White|Blue|Green|Pink|Orange|Purple|Cyan)$").matchEntire(value)?.let {
            val color = mapOf(
                "Light Blue" to "Lichtblauw", "Black" to "Zwart", "Red" to "Rood",
                "Yellow" to "Geel", "White" to "Wit", "Blue" to "Blauw", "Green" to "Groen",
                "Pink" to "Roze", "Orange" to "Oranje", "Purple" to "Paars", "Cyan" to "Cyaan",
            ).getValue(it.groupValues[2])
            return "${it.groupValues[1]} · $color"
        }
        Regex("^Lap (\\d+)$").matchEntire(value)?.let { return "Ronde ${it.groupValues[1]}" }
        Regex("^(\\d+) laps$").matchEntire(value)?.let { return "${it.groupValues[1]} ronden" }
        Regex("^(\\d+) tracks$").matchEntire(value)?.let { return "${it.groupValues[1]} circuits" }
        Regex("^(\\d+)/96 tracks$").matchEntire(value)?.let { return "${it.groupValues[1]}/96 circuits" }
        Regex("^(\\d+) cups$").matchEntire(value)?.let { return "${it.groupValues[1]} bekers" }
        Regex("^(\\d+) cups · (\\d+) tracks$").matchEntire(value)?.let {
            return "${it.groupValues[1]} bekers · ${it.groupValues[2]} circuits"
        }
        Regex("^(\\d+) laps · Base game$").matchEntire(value)?.let {
            return "${it.groupValues[1]} ronden · Basisspel"
        }
        Regex("^(\\d+) laps · Booster Course Pass$").matchEntire(value)?.let {
            return "${it.groupValues[1]} ronden · Circuit-uitbreidingspas"
        }
        Regex("^Lap (\\d+): (.+) · coins (.+) · mushrooms (.+)$").matchEntire(value)?.let {
            return "Ronde ${it.groupValues[1]}: ${it.groupValues[2]} · munten ${it.groupValues[3]} · paddenstoelen ${it.groupValues[4]}"
        }
        Regex("^Lap (\\d+) · (.+)$").matchEntire(value)?.let {
            return "Ronde ${it.groupValues[1]} · ${it.groupValues[2]}"
        }
        Regex("^(\\d+)\\. (.+) · (\\d+) track·class combos$").matchEntire(value)?.let {
            return "${it.groupValues[1]}. ${it.groupValues[2]} · ${it.groupValues[3]} circuit-klassecombinaties"
        }
        Regex("^Groups \\((\\d+)\\)$").matchEntire(value)?.let { return "Groepen (${it.groupValues[1]})" }
        Regex("^Compare (.+)$").matchEntire(value)?.let { return "Vergelijk ${it.groupValues[1]}" }
        Regex("^Time Trial standing #(\\d+) of (\\d+)$").matchEntire(value)?.let {
            return "Time Trial-stand #${it.groupValues[1]} van ${it.groupValues[2]}"
        }
        Regex("^Your lowest Mastery: (.+)$").matchEntire(value)?.let { return "Jouw laagste Mastery: ${it.groupValues[1]}" }
        Regex("^Improve by (.+) to reach$").matchEntire(value)?.let { return "Verbeter met ${it.groupValues[1]} om te bereiken" }
        Regex("^(.+) is #(\\d+) here — you are #(\\d+) of (\\d+)\\.$").matchEntire(value)?.let {
            return "${it.groupValues[1]} staat hier #${it.groupValues[2]} — jij staat #${it.groupValues[3]} van ${it.groupValues[4]}."
        }
        Regex("^(\\d+) runs · (.+)$").matchEntire(value)?.let {
            val count = it.groupValues[1].toInt()
            return "$count ${if (count == 1) "rit" else "ritten"} · ${it.groupValues[2]}"
        }
        Regex("^(\\d+) (?:run|runs)$").matchEntire(value)?.let {
            val count = it.groupValues[1].toInt()
            return "$count ${if (count == 1) "rit" else "ritten"}"
        }
        Regex("^(.+) · You$").matchEntire(value)?.let { return "${it.groupValues[1]} · Jij" }
        Regex("^Add (.+)$").matchEntire(value)?.let { return "${it.groupValues[1]} toevoegen" }
        Regex("^Move (.+)$").matchEntire(value)?.let { return "${it.groupValues[1]} verplaatsen" }
        Regex("^Select (.+)$").matchEntire(value)?.let { return "${it.groupValues[1]} selecteren" }
        Regex("^Run (\\d+)$").matchEntire(value)?.let { return "Rit ${it.groupValues[1]}" }
        Regex("^Current level: (.+)$").matchEntire(value)?.let { return "Huidig niveau: ${it.groupValues[1]}" }
        Regex("^Device code: (.+)$").matchEntire(value)?.let { return "Apparaatcode: ${it.groupValues[1]}" }
        Regex("^ACTIVE PLAYER (.+)$").matchEntire(value)?.let { return "ACTIEVE SPELER ${it.groupValues[1]}" }
        Regex("^(\\d+) saved results still belong to this account\\. They stay on this device; only the stored sign-in is removed\\.$").matchEntire(value)?.let {
            return "${it.groupValues[1]} opgeslagen resultaten horen nog bij dit account. Ze blijven op dit apparaat; alleen de opgeslagen aanmelding wordt verwijderd."
        }
        Regex("^Select (.+) to open this notification\\. The app never switches Player silently\\.$").matchEntire(value)?.let {
            return "Selecteer ${it.groupValues[1]} om deze melding te openen. De app wisselt nooit stilzwijgend van speler."
        }
        Regex("^Latest (\\d+) published results loaded · (\\d+) at 150cc · (\\d+) at 200cc$").matchEntire(value)?.let {
            return "Laatste ${it.groupValues[1]} gepubliceerde resultaten geladen · ${it.groupValues[2]} op 150cc · ${it.groupValues[3]} op 200cc"
        }
        Regex("^No published (150|200)cc times yet — every track is still open\\.$").matchEntire(value)?.let {
            return "Nog geen gepubliceerde tijden voor ${it.groupValues[1]}cc — elk circuit is nog vrij."
        }
        Regex("^No published (150|200)cc times yet\\.$").matchEntire(value)?.let {
            return "Nog geen gepubliceerde tijden voor ${it.groupValues[1]}cc."
        }
        Regex("^TRACK TIMES · (150|200)CC$").matchEntire(value)?.let { return "CIRCUITTIJDEN · ${it.groupValues[1]}CC" }
        Regex("^PER-TRACK COMPARISON · (150|200)CC$").matchEntire(value)?.let { return "VERGELIJKING PER CIRCUIT · ${it.groupValues[1]}CC" }
        Regex("^Screen name: (.+)$").matchEntire(value)?.let {
            return "Schermnaam: ${if (it.groupValues[1] == "Not set") "Niet ingesteld" else it.groupValues[1]}"
        }
        Regex("^Relevant classes: (.+)$").matchEntire(value)?.let {
            val choice = when (it.groupValues[1]) {
                "150cc only" -> "alleen 150cc"
                "200cc only" -> "alleen 200cc"
                "All" -> "Alle"
                else -> it.groupValues[1]
            }
            return "Relevante klassen: $choice"
        }
        Regex("^Country: (.+)$").matchEntire(value)?.let {
            return "Land: ${AndroidDutchPresentationCatalog.translate(it.groupValues[1])}"
        }
        Regex("^Character: (.+)$").matchEntire(value)?.let {
            return "Coureur: ${AndroidDutchPresentationCatalog.translate(it.groupValues[1])}"
        }
        Regex("^Track: (.+)$").matchEntire(value)?.let {
            return "Circuit: ${AndroidDutchPresentationCatalog.translate(it.groupValues[1])}"
        }
        Regex("^Loading (.+)…$").matchEntire(value)?.let { return "${it.groupValues[1]} laden…" }
        return value
    }
}
