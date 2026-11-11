"use strict";
// MK8DX setup wizard (A2 offline). Text via textContent only; no inline script or style (CSP).
const TOKEN = document.querySelector('meta[name="mk8dx-wizard"]').content;
const LANG = (navigator.language || "en").toLowerCase().startsWith("nl") ? "nl" : "en";
document.documentElement.lang = LANG;

const T = {
  nl: {
    brandSub: "installatie", help: "Handleiding", next: "Volgende", back: "Vorige", advanced: "Geavanceerd",
    install: "Installeren", finish: "Voltooien", retry: "Opnieuw proberen", close: "Sluiten",
    welcomeTitle: "Welkom bij MK8DX",
    welcomeLead: "Je eigen Mario Kart 8 Deluxe-thuisbasis: Time Trials scannen met je telefoon, je tijden vergelijken met familie en vrienden, LiveTrial-opnames en toernooiavonden — op je eigen netwerk, zonder internet of cloudaccount.",
    welcomeWhat: "Deze installatie zet MK8DX op deze computer klaar voor iedereen in huis of op de club. Het duurt ongeveer 5 minuten. Je hoeft bijna alleen op Volgende te klikken.",
    hiLanT: "LAN-toernooiavonden", hiLan: "Een ouderwetse LAN-avond met twee spelers per scherm: aanmelden, aanwezigheid, consoles en zitplaatsen, kwalificatiegroepen en daarna de finales worden automatisch voor je ingedeeld. Tournament Live leest de races via de capture card mee en zet de uitslagen klaar op de website.",
    hiLiveT: "Time Trials met LiveTrial", hiLive: "Sluit je Switch via een capture card aan op je pc en race. LiveTrial herkent elke run vanzelf en bewaart je tijden, rondes en clips — je hoeft niets in te typen.",
    hiScanT: "Scannen op de bank", hiScan: "Bij vrienden aan het timetrialen? Richt je telefoon of tablet op de tv en MK8DX leest het resultaatscherm voor je uit.",
    hiFamilyT: "Eigen records en rivalen", hiFamily: "Iedereen een eigen account, eigen records en een ranglijst met familie, vrienden of club.",
    hiOwnT: "Van jou", hiOwn: "Alles blijft op je eigen netwerk. Geen internet, geen abonnement, geen cloud.",
    checkTitle: "Even controleren", checkLead: "MK8DX draait in Docker Desktop. We kijken of alles klaarstaat.",
    check_docker: "Docker Desktop draait", check_docker_fix: "Start Docker Desktop, wacht tot 'Engine running' en klik op Opnieuw proberen.",
    check_disk: "Genoeg vrije schijfruimte", check_disk_fix: "Maak minstens 6 GB vrij op deze schijf.",
    check_platform: "Windows, Linux of macOS", check_platform_fix: "Deze installatie werkt op Windows, Linux en macOS.",
    kindTitle: "Wat voor installatie?",
    kindHome: "Thuis-, club- of LAN-avondnetwerk, geen internet nodig", kindHomeText: "Iedereen op hetzelfde wifi- of kabelnetwerk kan meedoen met een persoonlijke inlogkaart — thuis, op de club of tijdens een LAN-toernooiavond. Er gaat niets naar internet.",
    recommended: "aanbevolen",
    kindOther: "Andere mogelijkheden (één computer, eigen server, webhosting) staan in de handleiding onder 'Installatieroutes'.",
    netTitle: "Je netwerk", netLead: "Telefoons, tablets en andere pc's bereiken MK8DX op dit adres:",
    netPrivate: "Dit netwerk staat als thuisnetwerk (privé) ingesteld.",
    netPublic: "Windows ziet dit netwerk nu als openbaar. Bij Installeren zet MK8DX het op 'privé' en laat het alleen MK8DX door. Windows vraagt daarvoor één keer om toestemming — klik dan op Ja.",
    netAdvanced: "Kies een ander adres van deze computer:", netNone: "Geen netwerkadres gevonden. Verbind deze computer met je thuisnetwerk en klik op Opnieuw proberen.",
    installTitle: "Installeren", installLead: "MK8DX wordt klaargezet. Laat dit venster open.",
    phase_idle: "Starten…", phase_prepare: "Installatie voorbereiden", phase_network: "Netwerk toestaan (Windows vraagt toestemming)",
    phase_install: "Database en website starten", phase_verify: "Controleren", phase_done: "Klaar!",
    showLog: "Details", installDone: "MK8DX draait. Nog twee korte stappen.",
    working: "Bezig", stillWorking: "nog bezig, dit kan een paar minuten duren",
    adminTitle: "Jouw beheerdersaccount", adminLead: "Jij beheert deze installatie. Hoe heet je?",
    adminField: "Je naam", adminHint: "Bijvoorbeeld 'Papa', 'Sanne' of 'Clubleiding'. Dit is alleen het label van het account in MK8DX beheer. Je spelersnaam op de website kies je zelf bij de eerste keer inloggen.",
    peopleTitle: "Wie spelen er mee?",
    peopleLead: "Wil je nu al accounts maken voor anderen — familie, vrienden, clubleden of collega's? Iedereen krijgt een eigen persoonlijke inlogkaart.",
    peopleLater: "Dit kan ook later, precies zo: open 'MK8DX beheer' op het bureaublad en kies 'Mensen'.",
    peopleField: "Namen (één per regel)", peopleAdd: "Toevoegen", peopleNow: "In deze installatie:", skip: "Overslaan",
    cardsTitle: "Inloggen op telefoons en pc's",
    cardsLead: "Inloggen op een telefoon, tablet of pc gaat in twee stappen: eerst het apparaat voorbereiden, daarna inloggen als de juiste persoon.",
    step1Title: "Stap 1 · Apparaat voorbereiden",
    step1Text: "Eén keer per apparaat. Scan deze QR-code met de camera. Het apparaat leert dan deze installatie te vertrouwen (een beveiligingscertificaat), zodat de website veilig opent. Je bent daarmee nog niet ingelogd. Was dit apparaat al voorbereid, ga dan meteen naar stap 2.",
    step2Title: "Stap 2 · Inloggen als de juiste persoon",
    step2Text: "Klik bij de persoon die dit apparaat gebruikt op 'Kaart maken' en scan die QR-code met hetzelfde apparaat. Het apparaat is dan ingelogd als die persoon. Een kaart werkt één keer en 15 minuten lang; maak gerust een nieuwe.",
    setupCard: "Apparaat voorbereiden", makeCard: "Kaart maken", newCard: "Nieuwe kaart", print: "Kaarten afdrukken",
    validUntil: "Geldig tot", administrator: "beheerder", fingerprint: "Vingerafdruk",
    revokeCard: "Kaart intrekken", cardRevoked: "Ingetrokken: deze kaart werkt niet meer.",
    signOut: "Overal uitloggen", signOutConfirm: "Zeker? Klik nogmaals",
    signedOut: "Uitgelogd op alle apparaten. Met een nieuwe kaart kan deze persoon weer inloggen.",
    signOutSelf: "Jezelf log je uit via het accountmenu op de website ('Op alle apparaten afmelden').",
    doneTitle: "Klaar! Veel racegenot.",
    doneLead: "MK8DX draait op je thuisnetwerk.",
    doneWebsite: "Website", doneSetup: "Nieuw apparaat", doneManage: "Later mensen toevoegen of kaarten maken: dubbelklik 'MK8DX beheer' op het bureaublad.",
    shortcut: "Snelkoppeling 'MK8DX beheer' op het bureaublad zetten",
    autostart: "MK8DX starten met Windows", autostartHint: "Docker Desktop start mee bij het aanmelden; MK8DX komt daarna vanzelf online.",
    autostartOther: "MK8DX starten als de computer opstart", autostartOtherHint: "Docker start mee; MK8DX komt daarna vanzelf online.",
    autostartManual: "Laat Docker ook na een herstart starten met dit commando in een terminal:",
    backups: "Elke nacht een back-up maken", backupsHint: "Versleuteld, in Documenten\\MK8DX-backups. De laatste 7 blijven bewaard.",
    recoveryLead: "Bewaar deze herstelcode goed (opschrijven of afdrukken). Je hebt hem alleen nodig om een back-up op een andere computer terug te zetten.",
    recoveryTitle: "MK8DX herstelcode", recoveryText: "Zonder deze code is een back-up niet te openen. Hij wordt maar één keer getoond.",
    manageTitle: "MK8DX beheer", manageLead: "Mensen toevoegen en inlogkaarten maken.",
    finished: "Je kunt dit venster nu sluiten.",
    restoreOffer: "Een back-up terugzetten", restoreOfferHint: "Nieuwe computer? Zet je MK8DX met al je mensen, tijden en toernooien terug uit een back-up. Je hebt de herstelcode nodig.",
    restoreTitle: "Een back-up terugzetten", restoreLead: "Kies de back-up en vul de herstelcode in die je bij de eerste installatie hebt opgeschreven.",
    restoreNone: "In deze map staat geen MK8DX-back-up. Kopieer de back-upmap (bijvoorbeeld vanaf een USB-stick) naar de map MK8DX-backups in je Documenten, of kies hieronder een andere map.",
    restoreFolder: "Andere map (bijvoorbeeld een USB-stick):", restoreLook: "Zoeken", restoreCode: "Herstelcode",
    restoreCodeHint: "Vijf groepjes van vier tekens, bijvoorbeeld ABCD-EFGH-…", restoreGo: "Terugzetten",
    restoreWrongCode: "Deze herstelcode opent de back-up niet. Controleer de code en probeer het opnieuw.",
    restoreTitleRun: "Terugzetten", restoreDone: "MK8DX draait weer, met alles uit de back-up.",
    restoreReconnect: "Kreeg deze computer een ander adres? Telefoons en pc's vertrouwen MK8DX nog steeds; laat ze de kaart 'Apparaat voorbereiden' scannen en koppel apps opnieuw.",
    restoreSameCode: "Nieuwe back-ups gebruiken dezelfde herstelcode als voorheen.",
    phase_restore: "Back-up openen en terugzetten",
    updateTitle: "Een nieuwere versie van MK8DX",
    updateLead: "Deze map bevat een nieuwere versie van MK8DX ({to}) dan er nu draait ({from}). Bijwerken duurt een paar minuten; MK8DX is in die tijd even niet bereikbaar.",
    updateSteps: "Eerst wordt een versleutelde back-up gemaakt en gecontroleerd. Daarna gaat MK8DX over op de nieuwe versie. Alle mensen, tijden, toernooien en inloggingen blijven bewaard; telefoons hoeven niets opnieuw te doen.",
    updateFolder: "Bewaar deze map: MK8DX start na het bijwerken vanuit deze map. De oude map kun je daarna verwijderen.",
    updateGo: "Bijwerken", updateLater: "Niet nu", updateTitleRun: "Bijwerken", updatePrevious: "een eerdere versie",
    updateDone: "MK8DX draait de nieuwe versie. Klik op Volgende en daarna op Voltooien, zodat de automatische taken en de snelkoppeling de nieuwe map gebruiken.",
    phase_backup: "Back-up maken en controleren", phase_update: "Nieuwe versie installeren en starten",
    moveTitle: "Deze computer heeft een nieuw netwerkadres",
    moveLead: "MK8DX stond op {old}, maar deze computer gebruikt nu een ander adres (bijvoorbeeld na een nieuwe router of een ander netwerk). Verhuis MK8DX naar:",
    moveGo: "Verhuizen", moveTitleRun: "Verhuizen", phase_move: "Naar het nieuwe adres verhuizen (Windows vraagt toestemming)",
    moveDone: "MK8DX draait op het nieuwe adres.",
    moveAfter: "Telefoons en pc's blijven MK8DX vertrouwen. Laat ze één keer de kaart 'Apparaat voorbereiden' scannen en opnieuw inloggen; gekoppelde apps koppel je opnieuw.",
  },
  en: {
    brandSub: "setup", help: "Manual", next: "Next", back: "Back", advanced: "Advanced",
    install: "Install", finish: "Finish", retry: "Try again", close: "Close",
    welcomeTitle: "Welcome to MK8DX",
    welcomeLead: "Your own Mario Kart 8 Deluxe home base: scan Time Trials with your phone, compare times with family and friends, LiveTrial recordings and tournament nights — on your own network, without internet or a cloud account.",
    welcomeWhat: "This setup prepares MK8DX on this computer for everyone at home or at your club. It takes about 5 minutes. You mostly just click Next.",
    hiLanT: "LAN tournament nights", hiLan: "An old-school LAN night with two players per screen: sign-up, attendance, consoles and seats, qualifier groups and then the finals are arranged for you automatically. Tournament Live reads the races from the capture card and prepares the results on the website.",
    hiLiveT: "Time Trials with LiveTrial", hiLive: "Connect your Switch to your PC through a capture card and race. LiveTrial recognizes every run by itself and keeps your times, laps and clips — nothing to type.",
    hiScanT: "Scan from the couch", hiScan: "Time-trialling at a friend's place? Point your phone or tablet at the TV and MK8DX reads the result screen for you.",
    hiFamilyT: "Your own records and rivals", hiFamily: "Everyone gets their own account, records and a ranking with family, friends or club.",
    hiOwnT: "Yours", hiOwn: "Everything stays on your own network. No internet, no subscription, no cloud.",
    checkTitle: "Quick check", checkLead: "MK8DX runs in Docker Desktop. Let's see whether everything is ready.",
    check_docker: "Docker Desktop is running", check_docker_fix: "Start Docker Desktop, wait for 'Engine running' and click Try again.",
    check_disk: "Enough free disk space", check_disk_fix: "Free at least 6 GB on this drive.",
    check_platform: "Windows, Linux or macOS", check_platform_fix: "This installation runs on Windows, Linux and macOS.",
    kindTitle: "What kind of installation?",
    kindHome: "Home, club or LAN-night network, no internet needed", kindHomeText: "Everyone on the same Wi-Fi or wired network can join with a personal sign-in card — at home, at the club or during a LAN tournament night. Nothing goes to the internet.",
    recommended: "recommended",
    kindOther: "Other options (one computer, your own server, web hosting) are in the manual under 'Installation routes'.",
    netTitle: "Your network", netLead: "Phones, tablets and other PCs reach MK8DX at this address:",
    netPrivate: "This network is set up as a home (private) network.",
    netPublic: "Windows currently treats this network as public. When you click Install, MK8DX marks it private and allows only MK8DX. Windows asks for permission once — click Yes.",
    netAdvanced: "Choose another address of this computer:", netNone: "No network address found. Connect this computer to your home network and click Try again.",
    installTitle: "Installing", installLead: "MK8DX is being set up. Keep this window open.",
    phase_idle: "Starting…", phase_prepare: "Preparing the installation", phase_network: "Allowing the network (Windows asks for permission)",
    phase_install: "Starting the database and website", phase_verify: "Checking", phase_done: "Done!",
    showLog: "Details", installDone: "MK8DX is running. Two short steps left.",
    working: "Working", stillWorking: "still working, this can take a few minutes",
    adminTitle: "Your administrator account", adminLead: "You manage this installation. What's your name?",
    adminField: "Your name", adminHint: "For example 'Dad', 'Sam' or 'Club team'. This is only the account's label in MK8DX administration. Everyone picks their own player name on the website the first time they sign in.",
    peopleTitle: "Who plays?",
    peopleLead: "Do you want to create accounts for others now — family, friends, club members or colleagues? Everyone gets a personal sign-in card.",
    peopleLater: "You can also do this later, exactly the same way: open 'MK8DX beheer' on the desktop and choose 'People'.",
    peopleField: "Names (one per line)", peopleAdd: "Add", peopleNow: "In this installation:", skip: "Skip",
    cardsTitle: "Sign in on phones and PCs",
    cardsLead: "Signing in on a phone, tablet or PC takes two steps: first prepare the device, then sign in as the right person.",
    step1Title: "Step 1 · Prepare the device",
    step1Text: "Once per device. Scan this QR code with the camera. The device then learns to trust this installation (a security certificate), so the website opens safely. This does not sign you in yet. If the device was prepared before, go straight to step 2.",
    step2Title: "Step 2 · Sign in as the right person",
    step2Text: "Click 'Make card' for the person who uses this device and scan that QR code with the same device. The device is then signed in as that person. A card works once and for 15 minutes; feel free to make a new one.",
    setupCard: "Prepare a device", makeCard: "Make card", newCard: "New card", print: "Print cards",
    validUntil: "Valid until", administrator: "administrator", fingerprint: "Fingerprint",
    revokeCard: "Revoke card", cardRevoked: "Revoked: this card no longer works.",
    signOut: "Sign out everywhere", signOutConfirm: "Sure? Click again",
    signedOut: "Signed out on every device. A new card lets this person sign in again.",
    signOutSelf: "Sign yourself out from the account menu on the website ('Sign out on all devices').",
    doneTitle: "Done! Enjoy the races.",
    doneLead: "MK8DX is running on your home network.",
    doneWebsite: "Website", doneSetup: "New device", doneManage: "To add people or make cards later: double-click 'MK8DX beheer' on the desktop.",
    shortcut: "Put an 'MK8DX beheer' shortcut on the desktop",
    autostart: "Start MK8DX with Windows", autostartHint: "Docker Desktop starts when you sign in; MK8DX then comes online by itself.",
    autostartOther: "Start MK8DX when the computer starts", autostartOtherHint: "Docker starts with it; MK8DX then comes online by itself.",
    autostartManual: "Make Docker start after a restart too, with this command in a terminal:",
    backups: "Make a backup every night", backupsHint: "Encrypted, in Documents\\MK8DX-backups. The newest 7 are kept.",
    recoveryLead: "Keep this recovery code safe (write it down or print it). You only need it to restore a backup on another computer.",
    recoveryTitle: "MK8DX recovery code", recoveryText: "A backup cannot be opened without this code. It is shown only once.",
    manageTitle: "MK8DX administration", manageLead: "Add people and make sign-in cards.",
    finished: "You can close this window now.",
    restoreOffer: "Restore a backup", restoreOfferHint: "New computer? Bring MK8DX back with all your people, times and tournaments from a backup. You need the recovery code.",
    restoreTitle: "Restore a backup", restoreLead: "Choose the backup and enter the recovery code you wrote down during the first installation.",
    restoreNone: "There is no MK8DX backup in this folder. Copy the backup folder (for example from a USB stick) to the MK8DX-backups folder in your Documents, or choose another folder below.",
    restoreFolder: "Another folder (for example a USB stick):", restoreLook: "Search", restoreCode: "Recovery code",
    restoreCodeHint: "Five groups of four characters, for example ABCD-EFGH-…", restoreGo: "Restore",
    restoreWrongCode: "This recovery code does not open the backup. Check the code and try again.",
    restoreTitleRun: "Restoring", restoreDone: "MK8DX is running again, with everything from the backup.",
    restoreReconnect: "Did this computer get a different address? Phones and PCs still trust MK8DX; let them scan the 'Prepare a device' card and pair apps again.",
    restoreSameCode: "New backups use the same recovery code as before.",
    phase_restore: "Opening and restoring the backup",
    updateTitle: "A newer version of MK8DX",
    updateLead: "This folder holds a newer version of MK8DX ({to}) than the one running now ({from}). Updating takes a few minutes; MK8DX is briefly unreachable meanwhile.",
    updateSteps: "First an encrypted backup is made and checked. Then MK8DX switches to the new version. All people, times, tournaments and sign-ins are kept; phones do not need to do anything again.",
    updateFolder: "Keep this folder: after the update MK8DX starts from this folder. You can delete the old folder afterwards.",
    updateGo: "Update", updateLater: "Not now", updateTitleRun: "Updating", updatePrevious: "an earlier version",
    updateDone: "MK8DX runs the new version. Click Next and then Finish, so the automatic tasks and the shortcut use the new folder.",
    phase_backup: "Making and checking a backup", phase_update: "Installing and starting the new version",
    moveTitle: "This computer has a new network address",
    moveLead: "MK8DX was on {old}, but this computer now uses another address (for example after a new router or another network). Move MK8DX to:",
    moveGo: "Move", moveTitleRun: "Moving", phase_move: "Moving to the new address (Windows asks for permission)",
    moveDone: "MK8DX runs on the new address.",
    moveAfter: "Phones and PCs keep trusting MK8DX. Let them scan the 'Prepare a device' card once and sign in again; pair apps again.",
  },
}[LANG];

const $ = (id) => document.getElementById(id);
function el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; }
let pending = 0;
async function api(path, body) {
  const init = { headers: { "X-MK8DX-Wizard": TOKEN, Accept: "application/json" }, cache: "no-store" };
  if (body !== undefined) { init.method = "POST"; init.headers["Content-Type"] = "application/json"; init.body = JSON.stringify(body); }
  // Every button press that waits on the computer shows a spinner on Next, so a step never looks stuck.
  if (init.method === "POST") { pending += 1; $("next").classList.add("busy"); }
  let response;
  try { response = await fetch(path, init); }
  finally { if (init.method === "POST" && --pending === 0) $("next").classList.remove("busy"); }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || response.statusText);
  return data;
}
document.querySelectorAll("[data-t]").forEach((n) => { n.textContent = T[n.dataset.t]; });
$("help").href = `/help?lang=${LANG}`;

const FLOW = ["welcome", "check", "kind", "network", "install", "admin", "people", "cards", "done"];
// A new computer: the backup already holds the administrator and the people.
const RESTORE_FLOW = ["welcome", "check", "restore", "network", "install", "people", "cards", "done"];
const state = { step: "welcome", flow: FLOW, ip: null, people: [], cards: {}, advanced: false, manage: false };
const main = $("main");

function setButtons({ next = T.next, nextEnabled = true, back = true, advanced = false } = {}) {
  $("next").textContent = next; $("next").disabled = !nextEnabled;
  $("back").textContent = T.back; $("back").classList.toggle("hidden", !back);
  $("advanced").textContent = T.advanced; $("advanced").classList.toggle("hidden", !advanced);
}
function drawSteps() {
  const steps = $("steps"); steps.replaceChildren();
  const at = state.flow.indexOf(state.step);
  state.flow.forEach((_, i) => steps.append(el("li", i < at ? "done" : i === at ? "now" : "")));
}
function go(step) { state.step = step; render(); main.focus(); }
function forward() { const i = state.flow.indexOf(state.step); if (i < state.flow.length - 1) go(state.flow[i + 1]); }
$("back").addEventListener("click", () => { const i = state.flow.indexOf(state.step); if (i > 0) go(state.flow[i - 1]); });
$("next").addEventListener("click", () => actions[state.step]?.());
$("advanced").addEventListener("click", () => { state.advanced = !state.advanced; render(); });
function errorBox(message) { const box = el("div", "error", message); box.setAttribute("role", "alert"); return box; }

const views = {
  welcome() {
    const highlights = el("ul", "highlights");
    [["hiLanT", "hiLan", "wide"], ["hiLiveT", "hiLive"], ["hiScanT", "hiScan"], ["hiFamilyT", "hiFamily"], ["hiOwnT", "hiOwn"]].forEach(([title, text, wide]) => {
      const li = el("li", wide || ""); li.append(el("strong", "", T[title]), el("span", "", T[text])); highlights.append(li);
    });
    const restore = el("div", "restore-offer");
    const offer = el("button", "secondary small", T.restoreOffer); offer.type = "button"; offer.id = "restore-offer";
    offer.addEventListener("click", () => { state.flow = RESTORE_FLOW; state.restoring = true; go("check"); });
    restore.append(offer, el("p", "muted", T.restoreOfferHint));
    main.replaceChildren(el("h1", "", T.welcomeTitle), el("p", "lead", T.welcomeLead), highlights, el("p", "", T.welcomeWhat), restore);
    state.flow = FLOW; state.restoring = false;
    setButtons({ back: false });
  },
  async check() {
    main.replaceChildren(el("h1", "", T.checkTitle), el("p", "lead", T.checkLead));
    const list = el("ul", "list"); main.append(list);
    setButtons({ nextEnabled: false });
    ["docker", "disk", "platform"].forEach((id) => { const li = el("li"); li.append(el("span", "state wait"), el("span", "", T[`check_${id}`])); li.id = `c-${id}`; list.append(li); });
    try {
      const checks = await api("/api/checks");
      let all = true;
      for (const c of checks) {
        const li = $(`c-${c.id}`); li.replaceChildren();
        const text = el("div"); text.append(el("div", "", T[`check_${c.id}`] + (c.freeGb ? ` (${c.freeGb} GB)` : "")));
        if (!c.ok) { text.append(el("div", "muted", T[`check_${c.id}_fix`])); all = false; }
        li.append(el("span", `state ${c.ok ? "ok" : "bad"}`, c.ok ? "✓" : "!"), text);
      }
      setButtons({ next: all ? T.next : T.retry });
      state.checksOk = all;
    } catch (error) { main.append(errorBox(error.message)); setButtons({ next: T.retry }); state.checksOk = false; }
  },
  kind() {
    const label = el("label", "choice"); const radio = el("input"); radio.type = "radio"; radio.checked = true; radio.name = "kind";
    const text = el("div"); const title = el("strong", "", T.kindHome); title.append(el("span", "badge", T.recommended));
    text.append(title, el("p", "muted", T.kindHomeText)); label.append(radio, text);
    const box = el("div", "list"); box.append(label);
    main.replaceChildren(el("h1", "", T.kindTitle), box, el("p", "muted", T.kindOther));
    setButtons();
  },
  async restore() {
    main.replaceChildren(el("h1", "", T.restoreTitle), el("p", "lead", T.restoreLead));
    setButtons({ nextEnabled: false, advanced: true });
    const list = el("div", "list"); main.append(list);
    const codeField = el("label", "field", T.restoreCode); const code = el("input"); code.type = "text"; code.id = "restore-code";
    code.autocomplete = "off"; code.spellcheck = false; code.maxLength = 40; code.value = state.restoreCode || "";
    codeField.append(code, el("span", "muted", T.restoreCodeHint));
    const ready = () => { state.restoreCode = code.value; $("next").disabled = !(state.backup && code.value.replace(/[\s-]/g, "").length >= 16); };
    code.addEventListener("input", ready);
    try {
      const found = await api(`/api/backups${state.backupFolder ? `?folder=${encodeURIComponent(state.backupFolder)}` : ""}`);
      if (!found.backups.length) { state.backup = null; list.append(errorBox(T.restoreNone)); }
      else if (!found.backups.some((b) => b.name === state.backup)) state.backup = found.backups[0].name;
      found.backups.forEach((b) => {
        const row = el("label", "choice"); const radio = el("input"); radio.type = "radio"; radio.name = "backup"; radio.value = b.name;
        radio.checked = b.name === state.backup; radio.addEventListener("change", () => { state.backup = b.name; ready(); });
        const when = b.createdUtc ? new Date(b.createdUtc).toLocaleString(LANG, { dateStyle: "long", timeStyle: "short" }) : b.name;
        const text = el("div"); text.append(el("strong", "", when), el("div", "muted mono", b.name)); row.append(radio, text); list.append(row);
      });
      main.append(el("p", "muted mono", found.folder));
    } catch (error) { main.append(errorBox(error.message)); }
    if (state.advanced || !state.backup) {
      const folderField = el("label", "field", T.restoreFolder); const folder = el("input"); folder.type = "text"; folder.id = "restore-folder";
      folder.value = state.backupFolder || ""; const look = el("button", "secondary small", T.restoreLook); look.type = "button";
      look.addEventListener("click", () => { state.backupFolder = folder.value.trim(); render(); });
      folderField.append(folder); main.append(folderField, look);
    }
    main.append(codeField);
    ready();
  },
  update() {
    const text = T.updateLead.replace("{to}", state.update.to || "?").replace("{from}", state.update.from || T.updatePrevious);
    main.replaceChildren(el("h1", "", T.updateTitle), el("p", "lead", text), el("p", "", T.updateSteps),
      el("p", "muted", T.updateFolder));
    const later = el("button", "secondary small", T.updateLater); later.type = "button";
    later.addEventListener("click", async () => { await manageFlow(); render(); });
    main.append(later);
    setButtons({ next: T.updateGo, back: false });
  },
  async move() {
    main.replaceChildren(el("h1", "", T.moveTitle), el("p", "lead", T.moveLead.replace("{old}", `https://${state.boundAddress}`)));
    setButtons({ nextEnabled: false, back: false, advanced: true });
    try {
      const rows = await api("/api/network");
      if (rows.length === 0) { main.append(errorBox(T.netNone)); setButtons({ next: T.retry, back: false }); state.ip = null; return; }
      if (!state.ip || !rows.some((r) => r.ip === state.ip)) state.ip = rows[0].ip;
      main.append(el("p", "mono", `https://${state.ip}`));
      if (state.advanced) {
        const field = el("label", "field", T.netAdvanced); const select = el("select");
        rows.forEach((r) => { const o = el("option", "", `${r.ip} — ${r.alias} (${r.category || "?"})`); o.value = r.ip; o.selected = r.ip === state.ip; select.append(o); });
        select.addEventListener("change", () => { state.ip = select.value; render(); });
        field.append(select); main.append(field);
      }
      main.append(el("p", "muted", T.moveAfter));
      setButtons({ next: T.moveGo, back: false, advanced: true });
    } catch (error) { main.append(errorBox(error.message)); setButtons({ next: T.retry, back: false }); }
  },
  async network() {
    main.replaceChildren(el("h1", "", T.netTitle), el("p", "lead", T.netLead));
    setButtons({ nextEnabled: false, next: state.restoring ? T.restoreGo : T.install, advanced: true });
    try {
      const rows = await api("/api/network");
      if (rows.length === 0) { main.append(errorBox(T.netNone)); setButtons({ next: T.retry, advanced: false }); state.ip = null; return; }
      if (!state.ip || !rows.some((r) => r.ip === state.ip)) state.ip = rows[0].ip;
      const chosen = rows.find((r) => r.ip === state.ip);
      main.append(el("p", "mono", `https://${chosen.ip}`));
      // Only Windows reports a network category (Private/Public); Linux and macOS have none to show.
      if (chosen.category === "Private") main.append(el("p", "muted", T.netPrivate));
      else if (chosen.category === "Public") main.append(el("p", "muted", T.netPublic));
      if (state.advanced) {
        const field = el("label", "field", T.netAdvanced); const select = el("select");
        rows.forEach((r) => { const o = el("option", "", `${r.ip} — ${r.alias} (${r.category || "?"})`); o.value = r.ip; o.selected = r.ip === state.ip; select.append(o); });
        select.addEventListener("change", () => { state.ip = select.value; render(); });
        field.append(select); main.append(field);
      }
      setButtons({ next: state.restoring ? T.restoreGo : T.install, advanced: true });
    } catch (error) { main.append(errorBox(error.message)); setButtons({ next: T.retry, advanced: false }); }
  },
  install() {
    const bar = el("div", "bar"); const fill = el("span", "w0"); bar.append(fill);
    const phase = el("p", "alive", T.phase_idle); const latest = el("p", "muted mono latest");
    const log = el("div", "log hidden"); const toggle = el("button", "link small", T.showLog);
    toggle.type = "button"; toggle.addEventListener("click", () => log.classList.toggle("hidden"));
    main.replaceChildren(el("h1", "", state.updating ? T.updateTitleRun : state.moving ? T.moveTitleRun : state.restoring ? T.restoreTitleRun : T.installTitle), el("p", "lead", T.installLead), bar, phase, latest, toggle, log);
    setButtons({ nextEnabled: false, back: false });
    const order = state.updating ? ["idle", "backup", "update", "verify", "done"] : state.moving ? ["idle", "move", "verify", "done"] : ["idle", state.restoring ? "restore" : "prepare", "network", "install", "verify", "done"];
    // The phase name with its own running clock, and the latest log line underneath: visibly alive.
    let shown = null; let since = Date.now();
    const clock = () => { const s = Math.floor((Date.now() - since) / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
    const poll = async () => {
      try {
        const job = await api("/api/job");
        if (job.phase !== shown) { shown = job.phase; since = Date.now(); }
        const elapsed = (Date.now() - since) / 1000;
        phase.textContent = `${T[`phase_${job.phase}`] || job.phase} · ${clock()}${elapsed > 45 ? ` · ${T.stillWorking}` : ""}`;
        latest.textContent = job.lines.length ? job.lines[job.lines.length - 1] : "";
        fill.className = `w${Math.min(4, Math.max(0, order.indexOf(job.phase) - 1))}`;
        log.textContent = job.lines.join("\n"); log.scrollTop = log.scrollHeight;
        if (job.error || job.done) { phase.classList.remove("alive"); latest.textContent = ""; }
        if (job.error) {
          main.append(errorBox(job.error === "wrong-recovery-code" ? T.restoreWrongCode : job.error)); log.classList.remove("hidden");
          state.restored = job.restored; setButtons({ next: T.retry, back: !job.restored }); state.installFailed = true; return;
        }
        if (job.done) { fill.className = "w4"; phase.textContent = state.updating ? T.updateDone : state.moving ? T.moveDone : state.restoring ? T.restoreDone : T.installDone; setButtons({ back: false }); return; }
        setTimeout(poll, 1000);
      } catch (error) { setTimeout(poll, 2000); }
    };
    // A restore whose data is already back retries only the network and start steps (the install job).
    const begin = () => (state.updating ? api("/api/update", {}) : state.moving ? api("/api/move", { ip: state.ip })
      : state.restoring && !state.restored
        ? api("/api/restore", { folder: state.backupFolder || "", name: state.backup, code: state.restoreCode, ip: state.ip })
        : api("/api/install", { ip: state.ip }));
    if (!state.installStarted) { state.installStarted = true; begin().then(poll, (e) => { main.append(errorBox(e.message)); setButtons({ next: T.retry }); state.installFailed = true; }); }
    else poll();
  },
  admin() {
    const field = el("label", "field", T.adminField); const input = el("input"); input.type = "text"; input.maxLength = 80; input.id = "admin-name"; input.autocomplete = "name";
    field.append(input);
    main.replaceChildren(el("h1", "", T.adminTitle), el("p", "lead", T.adminLead), field, el("p", "muted", T.adminHint));
    input.addEventListener("input", () => { $("next").disabled = input.value.trim() === ""; });
    input.addEventListener("keydown", (e) => { if (e.key === "Enter" && input.value.trim()) actions.admin(); });
    setButtons({ nextEnabled: false, back: false }); setTimeout(() => input.focus(), 50);
  },
  people() {
    const field = el("label", "field", T.peopleField); const area = el("textarea"); area.id = "people-names"; field.append(area);
    const add = el("button", "secondary small", T.peopleAdd); add.type = "button";
    const list = el("ul", "list");
    const draw = () => {
      list.replaceChildren();
      state.people.forEach((p) => {
        const li = el("li"); const text = el("div");
        text.append(el("span", "", p.role === "administrator" ? `${p.name} (${T.administrator})` : p.name));
        li.append(el("span", "state ok", "✓"), text);
        if (state.manage) {
          // Lost phone or a card in the wrong hands: end every session of this person.
          const out = el("button", "secondary small person-action", T.signOut); out.type = "button";
          let armed = false;
          out.addEventListener("click", async () => {
            if (!armed) { armed = true; out.textContent = T.signOutConfirm; return; }
            out.disabled = true;
            try { await api("/api/people/sign-out", { accountKey: p.accountKey }); text.append(el("div", "muted", T.signedOut)); out.remove(); }
            catch (error) { text.append(el("div", "muted", error.message === "own-account" ? T.signOutSelf : error.message)); out.remove(); }
          });
          li.append(out);
        }
        list.append(li);
      });
    };
    add.addEventListener("click", async () => {
      const names = area.value.split(/\r?\n/).map((n) => n.trim()).filter(Boolean);
      if (!names.length) return;
      add.disabled = true;
      try { state.people = (await api("/api/people", { names })).people; area.value = ""; draw(); }
      catch (error) { main.append(errorBox(error.message)); } finally { add.disabled = false; }
    });
    main.replaceChildren(el("h1", "", state.manage ? T.manageTitle : T.peopleTitle), el("p", "lead", T.peopleLead), field, add,
      el("h2", "", T.peopleNow), list, el("p", "muted", T.peopleLater));
    draw();
    setButtons({ back: !state.manage, next: state.people.length > 1 ? T.next : T.skip });
    area.addEventListener("input", () => { $("next").textContent = T.next; });
  },
  async cards() {
    // Two visibly separate steps: the device card (trust, once per device), then one card per person.
    const deviceCards = el("div", "cards"); const cards = el("div", "cards");
    const printBtn = el("button", "secondary small no-print", T.print); printBtn.type = "button"; printBtn.addEventListener("click", () => window.print());
    main.replaceChildren(el("h1", "", T.cardsTitle), el("p", "lead", T.cardsLead), printBtn,
      el("h2", "step-title", T.step1Title), el("p", "muted", T.step1Text), deviceCards,
      el("h2", "step-title", T.step2Title), el("p", "muted", T.step2Text), cards);
    setButtons();
    try {
      const setup = await api("/api/setup");
      const s = el("div", "person"); const img = el("img"); img.src = setup.qr; img.alt = T.setupCard;
      // The same short code the /setup page shows, in the same grouping, so comparing is easy.
      const code = setup.fingerprint.slice(0, 16).toUpperCase().match(/.{4}/g).join(" ");
      s.append(el("h3", "", T.setupCard), img, el("div", "muted mono", setup.setupUrl), el("div", "muted", T.fingerprint), el("div", "short-code", code));
      deviceCards.append(s);
    } catch (error) { main.append(errorBox(error.message)); }
    for (const person of state.people) {
      const card = el("div", "person"); const name = el("h3", "", person.name);
      const make = el("button", "primary small no-print", T.makeCard); make.type = "button";
      const holder = el("div", "placeholder"); holder.append(make);
      let current = null; // the card on screen; a new card replaces (revokes) it
      const revoke = async () => {
        if (!current) return;
        const id = current; current = null;
        await api("/api/card/revoke", { invitationId: id }).catch(() => undefined);
      };
      const fill = async () => {
        make.disabled = true;
        try {
          await revoke();
          const c = await api("/api/card", { accountKey: person.accountKey, role: person.role });
          current = c.invitationId;
          const img = el("img"); img.src = c.qr; img.alt = person.name;
          const until = new Date(c.expiresAtMs).toLocaleTimeString(LANG, { hour: "2-digit", minute: "2-digit" });
          card.replaceChildren(name, img, el("div", "muted", `${T.validUntil} ${until}`));
          const again = el("button", "secondary small no-print", T.newCard); again.type = "button"; again.addEventListener("click", fill);
          const stop = el("button", "secondary small no-print", T.revokeCard); stop.type = "button";
          stop.addEventListener("click", async () => {
            stop.disabled = true; await revoke();
            card.replaceChildren(name, el("div", "muted", T.cardRevoked), again);
          });
          card.append(again, stop);
        } catch (error) { card.append(errorBox(error.message)); make.disabled = false; }
      };
      make.addEventListener("click", fill); card.append(name, holder); cards.append(card);
    }
  },
  async done() {
    const status = await api("/api/status").catch(() => ({}));
    const a = status.addresses || {};
    const list = el("ul", "list");
    [[T.doneWebsite, a.website], [T.doneSetup, a.phoneSetup]].forEach(([k, v]) => { if (v) { const li = el("li"); li.append(el("strong", "", k), el("span", "mono", v)); list.append(li); } });
    const option = (id, label, hint) => {
      const row = el("label", "choice"); const box = el("input"); box.type = "checkbox"; box.checked = true; box.id = id;
      const text = el("div"); text.append(el("span", "", label)); if (hint) text.append(el("div", "muted", hint));
      row.append(box, text); return row;
    };
    const options = el("div", "list");
    const windows = (status.platform || "windows") === "windows";
    options.append(option("autostart", windows ? T.autostart : T.autostartOther, windows ? T.autostartHint : T.autostartOtherHint),
      option("backups", T.backups, T.backupsHint),
      option("shortcut", T.shortcut));
    main.replaceChildren(el("h1", "", T.doneTitle), el("p", "lead", T.doneLead), list, options, el("p", "muted", T.doneManage));
    if (state.restoring) main.append(el("p", "muted", T.restoreReconnect));
    setButtons({ next: T.finish });
  },
};

const actions = {
  welcome: forward,
  check() { if (state.checksOk) forward(); else render(); },
  kind: forward,
  restore() { if (state.backup && state.restoreCode) forward(); },
  move() { if (state.ip) forward(); else render(); },
  update() { state.updating = true; forward(); },
  network() {
    // Coming back after a failed attempt (for example a mistyped recovery code) starts a new job.
    if (state.installFailed) { state.installFailed = false; state.installStarted = false; }
    if (state.ip) forward(); else render();
  },
  async install() {
    if (state.installFailed) { state.installFailed = false; state.installStarted = false; render(); return; }
    if (state.restoring || state.moving || state.updating) {
      $("next").disabled = true;
      try { state.people = await api("/api/people"); state.manage = true; } catch (error) { main.append(errorBox(error.message)); $("next").disabled = false; return; }
    }
    forward();
  },
  async admin() {
    const name = $("admin-name").value.trim(); if (!name) return;
    $("next").disabled = true;
    try { state.people = (await api("/api/administrator", { name })).people; forward(); }
    catch (error) { main.append(errorBox(error.message)); $("next").disabled = false; }
  },
  people: forward,
  cards: forward,
  async done() {
    $("next").disabled = true;
    let result = {};
    try {
      result = await api("/api/finish", { shortcut: $("shortcut")?.checked !== false,
        autostart: $("autostart")?.checked !== false, backups: $("backups")?.checked !== false });
    } catch (error) { main.append(errorBox(error.message)); }
    main.replaceChildren(el("h1", "", T.doneTitle));
    if (typeof result.autostart === "string" && result.autostart.startsWith("manual: ")) {
      // Linux: Docker Engine at boot needs root, so the exact command is shown instead of run.
      main.append(el("p", "lead", T.autostartManual), el("p", "mono", result.autostart.slice("manual: ".length)));
    }
    if (result.recoveryCode) {
      const card = el("div", "person recovery");
      card.append(el("h3", "", T.recoveryTitle), el("div", "short-code", result.recoveryCode),
        el("div", "muted", T.recoveryText), el("div", "muted mono", result.folder || ""));
      const printBtn = el("button", "secondary small no-print", T.print); printBtn.type = "button";
      printBtn.addEventListener("click", () => window.print()); card.append(printBtn);
      main.append(el("p", "lead", T.recoveryLead), card);
    } else if (state.restoring) main.append(el("p", "muted", T.restoreSameCode));
    main.append(el("p", "lead", T.finished));
    state.step = "closed";
    setButtons({ next: T.close, back: false });
  },
  async closed() { await api("/api/close", {}).catch(() => undefined); window.close(); },
};

function render() { drawSteps(); views[state.step](); }

async function manageFlow() {
  state.updating = false;
  try {
    state.people = await api("/api/people");
    state.manage = true; state.flow = ["people", "cards", "done"]; state.step = "people";
    document.querySelector(".brand-sub").textContent = LANG === "nl" ? "beheer" : "administration";
    document.title = T.manageTitle;
  } catch { state.flow = ["admin", "people", "cards", "done"]; state.step = "admin"; }
}

(async () => {
  try {
    const status = await api("/api/status");
    if (status.installed && status.addressActive === false) {
      // The computer's address changed: move first, then the usual administration.
      state.moving = true; state.boundAddress = status.boundAddress;
      state.flow = ["move", "install", "people", "cards", "done"]; state.step = "move";
      document.querySelector(".brand-sub").textContent = LANG === "nl" ? "beheer" : "administration";
    } else if (status.installed && status.update && status.update.available) {
      // A newer package opened on this installation: offer the update first ("Not now" goes to administration).
      state.update = status.update; state.flow = ["update", "install", "people", "cards", "done"]; state.step = "update";
      document.querySelector(".brand-sub").textContent = LANG === "nl" ? "beheer" : "administration";
    } else if (status.installed) {
      await manageFlow();
    }
  } catch { /* first run */ }
  render();
})();
