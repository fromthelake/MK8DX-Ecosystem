// The bearer stays only in this closure. It is never rendered, logged or stored.
const fragment = window.location.hash;
const query = window.location.search;
window.history.replaceState(null, "", "/offline-invite");

// The website's saved language (same origin, same key), else the browser's languages; English and Dutch are
// written here, the other 13 come from i18n/<language>.json (tooling/i18n/build_web_catalogs.mjs).
const SOURCE = {
  nl: {
    title: "Doe mee met deze MK8DX-installatie",
    checking: "Uitnodiging controleren…",
    explanation: "Controleer eerst of dit HTTPS-adres bij de vertrouwde host hoort. Deze uitnodiging werkt één keer.",
    ready: "Uitnodiging klaar. Bevestig om in te loggen.",
    signsInAs: "Je logt in als:",
    notYou: "Ben jij dit niet? Tik dan niet op accepteren; de kaart blijft geldig voor de juiste persoon.",
    signedInAs: "Je bent ingelogd als",
    invalid: "Deze uitnodiging is ongeldig. Vraag de beheerder om een nieuwe QR-code.",
    sending: "Uitnodiging wordt ingewisseld…",
    failed: "Inloggen is niet gelukt. Vraag de beheerder om een nieuwe uitnodiging.",
    accepted: "Je bent ingelogd op deze installatie.",
    redeem: "Uitnodiging accepteren",
    continue: "Verder naar MK8DX",
    language: "Taal",
  },
  en: {
    title: "Join this MK8DX installation",
    checking: "Checking invitation…",
    explanation: "First check that this HTTPS address belongs to the host you trust. The invitation can be used once.",
    ready: "Invitation ready. Confirm to sign in.",
    signsInAs: "You sign in as:",
    notYou: "Not you? Then do not tap accept; the card stays valid for the right person.",
    signedInAs: "You are signed in as",
    invalid: "This invitation is invalid. Ask the administrator for a new QR code.",
    sending: "Accepting invitation…",
    failed: "Sign-in failed. Ask the administrator for a new invitation.",
    accepted: "You are signed in to this installation.",
    redeem: "Accept invitation",
    continue: "Continue to MK8DX",
    language: "Language",
  },
};
let lang = MK8DXLanguage.choose(MK8DXLanguage.saved(), MK8DXLanguage.browser());
let copy = lang === "nl" ? SOURCE.nl : SOURCE.en;
const title = document.getElementById("title");
const explanation = document.getElementById("explanation");
const status = document.getElementById("status");
const button = document.getElementById("redeem");
const continueLink = document.getElementById("continue");
const who = document.getElementById("who");
const whoLabel = document.getElementById("who-label");
const whoName = document.getElementById("who-name");
const notYou = document.getElementById("not-you");
const languageSelect = document.getElementById("language");
let phase = "checking";
let signedInLabel = null;

async function texts(code) {
  if (code === "nl") return SOURCE.nl;
  if (code === "en" || code === "en-US") return SOURCE.en;
  let messages = {};
  try {
    const response = await fetch(`/offline-invite/i18n/${code}.json`, { cache: "no-store", credentials: "same-origin" });
    if (response.ok) messages = (await response.json()).messages || {};
  } catch { /* English stays */ }
  const out = {};
  for (const [key, english] of Object.entries(SOURCE.en)) {
    out[key] = typeof messages[english] === "string" && messages[english] ? messages[english] : english;
  }
  return out;
}

// Every visible text from the current phase, so a language change rewrites the page in place.
function paint() {
  document.documentElement.lang = lang;
  title.textContent = copy.title;
  explanation.textContent = copy.explanation;
  button.textContent = copy.redeem;
  continueLink.textContent = copy.continue;
  whoLabel.textContent = copy.signsInAs;
  notYou.textContent = copy.notYou;
  languageSelect.setAttribute("aria-label", copy.language);
  languageSelect.title = copy.language;
  status.textContent = phase === "signedIn" ? `${copy.signedInAs} ${signedInLabel}.` : copy[phase];
}

for (const [code, name] of MK8DXLanguage.LANGUAGES) {
  const option = document.createElement("option");
  option.value = code; option.lang = code; option.textContent = name;
  languageSelect.append(option);
}
languageSelect.value = lang;
languageSelect.addEventListener("change", async () => {
  lang = MK8DXLanguage.choose(languageSelect.value, []);
  MK8DXLanguage.save(lang);
  copy = await texts(lang);
  paint();
});
function setPhase(next) { phase = next; status.textContent = copy[next]; }

let token = /^#token=([A-Za-z0-9_-]{43})$/.exec(fragment)?.[1] ?? null;
const usable = window.location.protocol === "https:" && query === "" && token !== null;
if (!usable) token = null;
phase = usable ? "checking" : "invalid";
paint();
texts(lang).then((loaded) => { copy = loaded; paint(); });
if (usable) preview(token);

let label = null;
async function preview(presented) {
  try {
    const response = await fetch("/api/auth/offline-invitation/preview", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: presented }),
    });
    if (!response.ok) throw new Error("invitation unavailable");
    const body = await response.json();
    if (typeof body.displayLabel !== "string" || body.displayLabel === "") throw new Error("no label");
    label = body.displayLabel;
    // textContent only: the label is an administrator-typed name, never markup.
    who.hidden = false;
    whoLabel.textContent = copy.signsInAs;
    whoName.textContent = label;
    notYou.textContent = copy.notYou;
    notYou.hidden = false;
    setPhase("ready");
    button.disabled = false;
  } catch {
    token = null;
    setPhase("invalid");
  }
}

button.addEventListener("click", async () => {
  if (token === null) return;
  const submitted = token;
  token = null;
  button.disabled = true;
  setPhase("sending");
  try {
    const response = await fetch("/api/auth/offline-invitation/redeem", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: submitted }),
    });
    if (!response.ok) throw new Error("invitation unavailable");
    // A new account on this browser: drop the previous account's remembered
    // header identity, exactly as signing out does (shared family devices).
    try { window.localStorage.removeItem("mk8dx.nav-identity.v1"); } catch { /* storage refused */ }
    if (label === null) setPhase("accepted");
    else { signedInLabel = label; phase = "signedIn"; status.textContent = `${copy.signedInAs} ${label}.`; }
    notYou.hidden = true;
    continueLink.hidden = false;
  } catch {
    setPhase("failed");
  }
});
