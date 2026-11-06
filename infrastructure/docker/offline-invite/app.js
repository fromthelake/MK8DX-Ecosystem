// The bearer stays only in this closure. It is never rendered, logged or stored.
const fragment = window.location.hash;
const query = window.location.search;
window.history.replaceState(null, "", "/offline-invite");

const copy = navigator.language.toLowerCase().startsWith("nl") ? {
  title: "Doe mee met deze MK8DX-installatie",
  explanation: "Controleer eerst of dit HTTPS-adres bij de vertrouwde host hoort. Deze uitnodiging werkt één keer.",
  ready: "Uitnodiging klaar. Bevestig om in te loggen.",
  invalid: "Deze uitnodiging is ongeldig. Vraag de beheerder om een nieuwe QR-code.",
  sending: "Uitnodiging wordt ingewisseld…",
  failed: "Inloggen is niet gelukt. Vraag de beheerder om een nieuwe uitnodiging.",
  accepted: "Je bent ingelogd op deze installatie.",
  redeem: "Uitnodiging accepteren",
  continue: "Verder naar MK8DX",
} : {
  title: "Join this MK8DX installation",
  explanation: "First check that this HTTPS address belongs to the host you trust. The invitation can be used once.",
  ready: "Invitation ready. Confirm to sign in.",
  invalid: "This invitation is invalid. Ask the administrator for a new QR code.",
  sending: "Accepting invitation…",
  failed: "Sign-in failed. Ask the administrator for a new invitation.",
  accepted: "You are signed in to this installation.",
  redeem: "Accept invitation",
  continue: "Continue to MK8DX",
};
document.documentElement.lang = navigator.language.toLowerCase().startsWith("nl") ? "nl" : "en";
const title = document.getElementById("title");
const explanation = document.getElementById("explanation");
const status = document.getElementById("status");
const button = document.getElementById("redeem");
const continueLink = document.getElementById("continue");
title.textContent = copy.title;
explanation.textContent = copy.explanation;
button.textContent = copy.redeem;
continueLink.textContent = copy.continue;

let token = /^#token=([A-Za-z0-9_-]{43})$/.exec(fragment)?.[1] ?? null;
if (window.location.protocol !== "https:" || query !== "" || token === null) {
  token = null;
  status.textContent = copy.invalid;
} else {
  status.textContent = copy.ready;
  button.disabled = false;
}

button.addEventListener("click", async () => {
  if (token === null) return;
  const submitted = token;
  token = null;
  button.disabled = true;
  status.textContent = copy.sending;
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
    status.textContent = copy.accepted;
    continueLink.hidden = false;
  } catch {
    status.textContent = copy.failed;
  }
});
