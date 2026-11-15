// Step 5/9 · live capture delegations (security finding F05).
//
// A roster match never opens a public live feed by itself. A feed goes public
// when the night's Director (or an administrator) confirms it, or when it
// comes from an account the Director delegated live capture to for this
// night. This panel lists those delegations, issues one (12 hours by default,
// at most 7 days) and revokes one. The API decides every step again on the
// server; the panel only offers what the Director can already see.

import {
  LIVE_CAPTURE_DELEGATION_DEFAULT_MINUTES,
  type TournamentEvidenceRecord,
  type TournamentIncomingClient,
  type TournamentLiveCaptureDelegation,
} from "./tournament-incoming-client.js";
import { localized, productLocaleTag } from "./product-language.js";

export type LiveDelegationPanelOptions = Readonly<{
  document: Document;
  client: TournamentIncomingClient;
  tournamentId: string;
  /** null when the list could not be loaded; the panel then says so instead of offering writes. */
  delegations: readonly TournamentLiveCaptureDelegation[] | null;
  evidenceRecords: readonly TournamentEvidenceRecord[];
  nowMs: number;
  signal?: AbortSignal;
  onChanged(): Promise<void>;
}>;

/** The delegation that lets this account's feed open the public view right now, if any. */
export function activeLiveCaptureDelegation(
  delegations: readonly TournamentLiveCaptureDelegation[] | null,
  userAccountId: string,
  nowMs: number,
): TournamentLiveCaptureDelegation | null {
  return delegations?.find((delegation) => delegation.delegateUserAccountId === userAccountId &&
    delegation.status === "active" && delegation.expiresAtMs > nowMs) ?? null;
}

export function delegationMoment(ms: number): string {
  return new Date(ms).toLocaleString(productLocaleTag(), { dateStyle: "medium", timeStyle: "short" });
}

const DURATIONS: readonly (readonly [number, () => string])[] = [
  [120, () => localized("2 hours", "2 uur")],
  [360, () => localized("6 hours", "6 uur")],
  [LIVE_CAPTURE_DELEGATION_DEFAULT_MINUTES, () => localized("12 hours (default)", "12 uur (standaard)")],
  [1_440, () => localized("24 hours", "24 uur")],
  [4_320, () => localized("3 days", "3 dagen")],
  [10_080, () => localized("7 days (maximum)", "7 dagen (maximaal)")],
];

function labelled(document: Document, text: string, control: HTMLElement): HTMLLabelElement {
  const element = document.createElement("label");
  const title = document.createElement("span");
  title.textContent = text;
  element.append(title, control);
  return element;
}

function delegationState(delegation: TournamentLiveCaptureDelegation, nowMs: number): string {
  if (delegation.status === "revoked") {
    return delegation.revokedAtMs === null
      ? localized("revoked", "ingetrokken")
      : localized(`revoked ${delegationMoment(delegation.revokedAtMs)}`, `ingetrokken ${delegationMoment(delegation.revokedAtMs)}`);
  }
  if (delegation.expiresAtMs <= nowMs) {
    return localized(`expired ${delegationMoment(delegation.expiresAtMs)}`, `verlopen ${delegationMoment(delegation.expiresAtMs)}`);
  }
  return localized(`active until ${delegationMoment(delegation.expiresAtMs)}`, `actief tot ${delegationMoment(delegation.expiresAtMs)}`);
}

export function liveCaptureDelegationPanel(options: LiveDelegationPanelOptions): HTMLElement {
  const { document, client, tournamentId, delegations, nowMs } = options;
  const panel = document.createElement("section");
  panel.className = "tournament-op__card tournament-op__incoming-card tournament-live-delegations";
  const heading = document.createElement("h4");
  heading.textContent = localized("Live capture delegations", "Live-capturedelegaties");
  const intro = document.createElement("p");
  intro.className = "tournament-op__hint";
  intro.textContent = localized(
    "A roster match alone never opens a public live feed. A feed goes public when you confirm it, or when it comes from an account you delegated live capture to for this night. A delegation lasts 12 hours unless you choose otherwise (at most 7 days); revoking it takes that account's feeds off the public view at once.",
    "Een rostermatch alleen opent nooit een openbare live-feed. Een feed wordt openbaar als jij hem bevestigt, of als hij komt van een account waaraan jij de live-capture voor deze avond hebt gedelegeerd. Een delegatie geldt 12 uur, tenzij je iets anders kiest (maximaal 7 dagen); intrekken haalt de feeds van dat account direct van de openbare weergave.",
  );
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  panel.append(heading, intro);

  if (delegations === null) {
    status.textContent = localized(
      "Capture delegations could not be loaded. Live feeds still wait for your confirmation.",
      "Capturedelegaties konden niet worden geladen. Live-feeds wachten nog steeds op jouw bevestiging.",
    );
    panel.append(status);
    return panel;
  }

  const list = document.createElement("ul");
  list.className = "tournament-live-delegations__list";
  if (delegations.length === 0) {
    const empty = document.createElement("li");
    empty.textContent = localized("No capture delegations for this night.", "Geen capturedelegaties voor deze avond.");
    list.append(empty);
  }
  for (const delegation of delegations) {
    const item = document.createElement("li");
    item.className = "tournament-live-delegations__item";
    const text = document.createElement("span");
    text.textContent = `${delegation.delegateDisplayName} · ${delegationState(delegation, nowMs)}`;
    item.append(text);
    if (delegation.status === "active" && delegation.expiresAtMs > nowMs) {
      const revoke = document.createElement("button");
      revoke.type = "button";
      revoke.className = "tt-auth__button";
      revoke.textContent = localized("Revoke", "Intrekken");
      revoke.setAttribute("aria-label", localized(
        `Revoke the capture delegation of ${delegation.delegateDisplayName}`,
        `Capturedelegatie van ${delegation.delegateDisplayName} intrekken`,
      ));
      revoke.addEventListener("click", () => {
        revoke.disabled = true;
        status.textContent = localized("Revoking the capture delegation…", "Capturedelegatie wordt ingetrokken…");
        void client.revokeLiveCaptureDelegation(tournamentId, delegation.delegationId, options.signal)
          .then(options.onChanged).catch((error: unknown) => {
            status.textContent = error instanceof Error ? error.message
              : localized("The capture delegation could not be revoked.", "De capturedelegatie kon niet worden ingetrokken.");
            revoke.disabled = false;
          });
      });
      item.append(revoke);
    }
    list.append(item);
  }
  panel.append(list);

  // The accounts the Director can recognize: whoever connected Tournament Live
  // to this night. Accounts that already hold an active delegation are left out.
  const candidates = new Map<string, string>();
  for (const evidence of options.evidenceRecords) {
    if (evidence.live === undefined) continue;
    if (activeLiveCaptureDelegation(delegations, evidence.uploadedBy.userAccountId, nowMs) !== null) continue;
    candidates.set(evidence.uploadedBy.userAccountId, evidence.uploadedBy.displayName);
  }
  const form = document.createElement("form");
  form.className = "tournament-live-delegations__form";
  const account = document.createElement("select");
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = localized("Choose an account", "Kies een account");
  account.append(placeholder);
  for (const [userAccountId, displayName] of candidates) {
    const option = document.createElement("option");
    option.value = userAccountId;
    option.textContent = displayName;
    account.append(option);
  }
  const duration = document.createElement("select");
  for (const [minutes, text] of DURATIONS) {
    const option = document.createElement("option");
    option.value = String(minutes);
    option.textContent = text();
    option.selected = minutes === LIVE_CAPTURE_DELEGATION_DEFAULT_MINUTES;
    duration.append(option);
  }
  duration.value = String(LIVE_CAPTURE_DELEGATION_DEFAULT_MINUTES);
  const grant = document.createElement("button");
  grant.type = "submit";
  grant.className = "tt-auth__button tt-auth__button--primary";
  grant.textContent = localized("Delegate live capture", "Live-capture delegeren");
  const hint = document.createElement("p");
  hint.className = "tournament-op__hint";
  hint.textContent = candidates.size === 0
    ? localized(
      "An account appears here once its Tournament Live has connected to this night and pressed Start. Its feed then waits for you.",
      "Een account verschijnt hier zodra zijn Tournament Live met deze avond is verbonden en op START heeft gedrukt. De feed wacht dan op jou.",
    )
    : localized(
      "Only accounts whose Tournament Live connected to this night are offered. The delegation is for this night only.",
      "Alleen accounts waarvan Tournament Live met deze avond is verbonden, worden aangeboden. De delegatie geldt alleen voor deze avond.",
    );
  account.disabled = candidates.size === 0;
  grant.disabled = candidates.size === 0;
  form.append(
    labelled(document, localized("Account", "Account"), account),
    labelled(document, localized("Valid for", "Geldig voor"), duration),
    grant,
  );
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (account.value === "") {
      status.textContent = localized("Choose an account to delegate live capture to.", "Kies een account om de live-capture aan te delegeren.");
      return;
    }
    grant.disabled = true;
    status.textContent = localized("Saving the capture delegation…", "Capturedelegatie wordt opgeslagen…");
    void client.grantLiveCaptureDelegation(tournamentId, {
      delegateUserAccountId: account.value, expiresInMinutes: Number(duration.value),
    }, options.signal).then(options.onChanged).catch((error: unknown) => {
      status.textContent = error instanceof Error ? error.message
        : localized("The capture delegation could not be saved.", "De capturedelegatie kon niet worden opgeslagen.");
      grant.disabled = false;
    });
  });
  panel.append(form, hint, status);
  return panel;
}
