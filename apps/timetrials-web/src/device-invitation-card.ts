// ADR-0224 phase 1, "Add another device": the account menu opens this dialog in an
// offline-invitation installation. It asks the API for a one-use, 15-minute card for the signed-in
// account itself and shows it as a QR code, the link and its expiry, with "New card" to replace it.
// The QR is drawn here from the module matrix the API returns: no image or markup travels, and the
// page's CSP (img-src 'self', no inline style) needs nothing new.

import {
  button as dsButton,
  dialog as dsDialog,
  el,
  nextId,
  ownerDocument,
  type OverlayHandle,
} from "./ds-components.js";
import {
  WebAuthenticationError,
  type WebDeviceInvitation,
} from "./authentication-client.js";
import { localized, productLocaleTag } from "./product-language.js";

const SVG = "http://www.w3.org/2000/svg";
/** The quiet zone the QR specification asks for around the code. */
const QUIET_ZONE = 4;

/** One path of unit squares, one per dark module, on a white field with its quiet zone. */
export function qrSvg(qr: WebDeviceInvitation["qr"], label: string): SVGSVGElement {
  const document = ownerDocument();
  const extent = qr.size + QUIET_ZONE * 2;
  const node = document.createElementNS(SVG, "svg");
  node.setAttribute("viewBox", `0 0 ${String(extent)} ${String(extent)}`);
  node.setAttribute("class", "ds-device-card__qr");
  node.setAttribute("role", "img");
  node.setAttribute("aria-label", label);
  node.setAttribute("shape-rendering", "crispEdges");
  const field = document.createElementNS(SVG, "rect");
  field.setAttribute("width", String(extent));
  field.setAttribute("height", String(extent));
  field.setAttribute("fill", "#ffffff");
  let d = "";
  for (let row = 0; row < qr.size; row += 1) {
    for (let column = 0; column < qr.size; column += 1) {
      if (qr.modules[row * qr.size + column] === true) {
        d += `M${String(column + QUIET_ZONE)} ${String(row + QUIET_ZONE)}h1v1h-1z`;
      }
    }
  }
  const modules = document.createElementNS(SVG, "path");
  modules.setAttribute("d", d);
  modules.setAttribute("fill", "#000000");
  node.append(field, modules);
  return node;
}

export type DeviceInvitationSource = (signal?: AbortSignal) => Promise<WebDeviceInvitation>;

export function openDeviceInvitationDialog(
  createInvitation: DeviceInvitationSource,
  options: Readonly<{ nowMs?: () => number }> = {},
): OverlayHandle {
  const nowMs = options.nowMs ?? Date.now;
  const intro = el("p", "ds-body", {}, localized(
    "Scan this card with the other device's camera. It signs that device in to this account once and stops working after 15 minutes.",
    "Scan deze kaart met de camera van het andere apparaat. Hij meldt dat apparaat één keer aan op dit account en werkt na 15 minuten niet meer.",
  ));
  const caution = el("p", "ds-body-s", {}, localized(
    "Only show it to a device of your own: whoever scans it is signed in as you. The other device must already trust this installation (the setup page on the host screen).",
    "Laat hem alleen aan je eigen apparaat zien: wie hem scant, is op jouw account aangemeld. Het andere apparaat moet deze installatie al vertrouwen (de setup-pagina op het beheerscherm).",
  ));
  const status = el("p", "ds-body-s", { role: "status", "aria-live": "polite" });
  const card = el("div", "ds-device-card ds-stack");
  card.hidden = true;
  const qrSlot = el("div", "ds-device-card__code");
  const linkId = nextId("ds-device-card-link");
  const link = el("input", "ds-text-input", { id: linkId, readonly: "", autocomplete: "off", spellcheck: "false" });
  const linkLabel = el("label", "ds-label", { for: linkId }, localized("Invitation link", "Uitnodigingslink"));
  const expiry = el("p", "ds-body-s", {});
  card.append(qrSlot, linkLabel, link, expiry);

  let controller: AbortController | null = null;
  let expiryTimer: ReturnType<typeof setTimeout> | null = null;
  let issuedOnce = false;
  let closed = false;

  const forgetCard = (): void => {
    if (expiryTimer !== null) { clearTimeout(expiryTimer); expiryTimer = null; }
    qrSlot.replaceChildren();
    link.value = "";
    expiry.textContent = "";
    card.hidden = true;
  };

  let handle: OverlayHandle;
  const newCard = dsButton({ label: localized("New card", "Nieuwe kaart"), variant: "secondary",
    onPress: () => { issue(); } });
  const close = dsButton({ label: localized("Close", "Sluiten"), variant: "primary",
    onPress: () => { handle.close(); } });

  const issue = (): void => {
    if (closed) { return; }
    controller?.abort();
    const current = new AbortController();
    controller = current;
    const replacing = issuedOnce;
    forgetCard();
    status.textContent = localized("Making a card…", "Kaart maken…");
    newCard.setLoading(localized("Making a card…", "Kaart maken…"));
    void createInvitation(current.signal).then((invitation) => {
      if (closed || controller !== current) { return; }
      issuedOnce = true;
      qrSlot.replaceChildren(qrSvg(invitation.qr,
        localized("QR code that signs another device in to this account", "QR-code die een ander apparaat op dit account aanmeldt")));
      link.value = invitation.invitationUrl;
      const until = new Date(invitation.expiresAtMs).toLocaleTimeString(productLocaleTag(), {
        hour: "2-digit", minute: "2-digit",
      });
      expiry.textContent = `${localized("Works once, valid until", "Werkt één keer, geldig tot")} ${until}`;
      card.hidden = false;
      status.textContent = replacing
        ? localized("New card ready. The previous card no longer works.", "Nieuwe kaart klaar. De vorige kaart werkt niet meer.")
        : localized("Card ready.", "Kaart klaar.");
      expiryTimer = setTimeout(() => {
        if (closed) { return; }
        forgetCard();
        status.textContent = localized("This card has expired. Make a new card.", "Deze kaart is verlopen. Maak een nieuwe kaart.");
      }, Math.max(0, invitation.expiresAtMs - nowMs()));
    }).catch((error: unknown) => {
      if (closed || controller !== current) { return; }
      const code = error instanceof WebAuthenticationError ? error.code : null;
      status.textContent = code === "not_available"
        ? localized("This account cannot add a device here.", "Dit account kan hier geen apparaat toevoegen.")
        : code === "not_authenticated"
          ? localized("Your session has ended. Sign in again.", "Je sessie is beëindigd. Meld je opnieuw aan.")
          : code === "service_unavailable"
            ? localized("Too many cards right now, or the server is busy. Wait a moment and try again.",
              "Nu te veel kaarten, of de server is bezet. Wacht even en probeer het opnieuw.")
            : localized("Could not make a card. Try again.", "Kon geen kaart maken. Probeer het opnieuw.");
    }).finally(() => {
      if (controller === current) { newCard.setLoading(null); }
    });
  };

  handle = dsDialog({
    title: localized("Add another device", "Ander apparaat toevoegen"),
    body: [intro, caution, status, card],
    actions: [newCard.root, close.root],
  });
  // The token must not stay in the document once the dialog is gone.
  handle.root.addEventListener("close", () => {
    closed = true;
    controller?.abort();
    forgetCard();
    handle.root.remove();
  }, { once: true });
  return {
    root: handle.root,
    open: () => { handle.open(); issue(); },
    close: () => { handle.close(); },
  };
}
