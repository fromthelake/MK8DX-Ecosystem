"use strict";
// MK8DX beheer "Add a phone or device": the three steps for one person as a small state machine, plus the
// welcome card's content. No DOM here, so tooling/tests/test_add_device.py runs it under Node.
//   prepare  the device trusts this installation ("Prepare a device" QR, the short certificate code)
//   signin   that person's one-time sign-in card (15 minutes); a countdown, "New card", waiting for its use
//   done     the card was used: a device is signed in as that person
// The card itself is made by the existing route (/api/card -> the host page's invitation); this file only
// decides what the screen shows and when to ask for a new card or the card's state.
(function (root) {
  const STEPS = ["prepare", "signin", "done"];

  function start(person) {
    return { step: "prepare", person: { accountKey: person.accountKey, name: person.name, role: person.role },
      card: null, cardState: null, wanted: false };
  }

  // A card made earlier (state.cards in wizard.js) is reused while it is valid for at least 30 more seconds.
  function usable(card, now) {
    return Boolean(card && typeof card.expiresAtMs === "number" && card.expiresAtMs > now + 30000);
  }

  function step(state, event, now) {
    const next = { ...state };
    switch (event.type) {
      case "next":
        if (state.step === "prepare") { next.step = "signin"; next.wanted = !usable(state.card, now); }
        else if (state.step === "done") next.step = "exit";
        return next;
      case "back":
        if (state.step === "signin" || state.step === "done") next.step = "prepare";
        else next.step = "exit";
        next.wanted = false;
        return next;
      case "card":  // a new card arrived from /api/card
        if (!event.card || typeof event.card.expiresAtMs !== "number") return next;
        return { ...next, step: "signin", card: event.card, cardState: "open", wanted: false };
      case "new":   // "New card": the screen revokes the old one and asks for another
        return { ...next, card: null, cardState: null, wanted: true };
      case "tick":
        if (state.card && state.cardState === "open" && now >= state.card.expiresAtMs) next.cardState = "expired";
        return next;
      case "status":  // the card's state from /api/card/status: open, used, revoked, expired, unsupported
        if (!state.card || state.step !== "signin") return next;
        if (event.state === "used") return { ...next, step: "done", cardState: "used" };
        if (["revoked", "expired", "unsupported"].includes(event.state)) next.cardState = event.state;
        return next;
      case "confirm":  // the host cannot report a used card (an older host page): the person says it worked
        if (state.step === "signin" && state.card) return { ...next, step: "done", cardState: "confirmed" };
        return next;
      default:
        return next;
    }
  }

  // Ask the host about the card only while it can still be used and its answer changes the screen.
  function polling(state) {
    return state.step === "signin" && Boolean(state.card) && state.cardState === "open";
  }

  function remaining(card, now) {
    const left = Math.max(0, Math.ceil((((card && card.expiresAtMs) || 0) - now) / 1000));
    return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
  }

  // The short code of the /setup page: the certificate's SHA-256, first 16 hex digits in groups of four.
  function shortCode(fingerprint) {
    const hex = String(fingerprint || "").replace(/[^0-9a-fA-F]/g, "").slice(0, 16).toUpperCase();
    return hex.length === 16 ? hex.match(/.{4}/g).join(" ") : "";
  }

  // The welcome card: three numbered steps, both QR codes (the sign-in one only while it can be used) and
  // the address. A card that expires or is used before it is printed prints without its sign-in QR, so a sheet
  // printed days ahead never carries a dead code without saying so.
  function sheet({ person, setup, card, cardState, now, texts, format }) {
    const fill = (text) => String(text || "").replaceAll("{name}", person.name);
    const live = Boolean(card && card.expiresAtMs > now && (!cardState || cardState === "open"));
    return {
      format: format === "a4" ? "a4" : "a6",
      title: fill(texts.welcomeCardTitle),
      address: setup.origin,
      setupUrl: setup.setupUrl,
      steps: [
        { number: 1, title: texts.welcomeStep1, text: texts.welcomeStep1Text, qr: setup.qr, code: shortCode(setup.fingerprint),
          codeLabel: texts.welcomeCode },
        { number: 2, title: texts.welcomeStep2, text: fill(texts.welcomeStep2Text), qr: live ? card.qr : null,
          personal: true, mark: fill(texts.welcomePersonal),
          expiry: live ? texts.welcomeExpires : texts.welcomeNoCard },
        { number: 3, title: texts.welcomeStep3, text: fill(texts.welcomeStep3Text) },
      ],
      until: live ? card.expiresAtMs : null,
    };
  }

  const api = { STEPS, start, step, polling, remaining, shortCode, sheet, usable };
  root.MK8DXAddDevice = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
