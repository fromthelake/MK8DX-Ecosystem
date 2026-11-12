// ADR-0224 phase 2, Settings: an optional 4-digit PIN for switching to this Player account on a
// shared device. Off by default. The server stores only a peppered hash, checks every attempt
// and limits them; changing or removing a PIN needs the current one unless this is a fresh sign-in.

import { button as dsButton, el, nextId } from "./ds-components.js";
import {
  WebAuthenticationError,
  type WebSwitchPinState,
} from "./authentication-client.js";
import { localized } from "./product-language.js";

export type AccountSwitchPinPort = Readonly<{
  read(signal?: AbortSignal): Promise<WebSwitchPinState>;
  set(pin: string, currentPin?: string, signal?: AbortSignal): Promise<WebSwitchPinState>;
  clear(currentPin?: string, signal?: AbortSignal): Promise<WebSwitchPinState>;
}>;

function pinField(label: string): Readonly<{ root: HTMLElement; input: HTMLInputElement }> {
  const id = nextId("ds-switch-pin");
  const input = el("input", "ds-text-input", {
    id, type: "password", inputmode: "numeric", autocomplete: "off", maxlength: "4",
    pattern: "[0-9]{4}", spellcheck: "false",
  }) as HTMLInputElement;
  return { root: el("div", "ds-field", {}, el("label", "ds-label", { for: id }, label), input), input };
}

function failureText(error: unknown): string {
  const code = error instanceof WebAuthenticationError ? error.code : null;
  switch (code) {
    case "pin_required": return localized("Enter the current PIN first.", "Vul eerst de huidige pincode in.");
    case "pin_invalid": return localized("The current PIN is not right.", "De huidige pincode klopt niet.");
    case "rate_limited": return localized(
      "Too many attempts. Wait a few minutes and try again.",
      "Te veel pogingen. Wacht een paar minuten en probeer het opnieuw.");
    case "invalid_input": return localized("A PIN is four digits.", "Een pincode heeft vier cijfers.");
    case "not_authenticated": return localized("Your session has ended. Sign in again.",
      "Je sessie is beëindigd. Meld je opnieuw aan.");
    default: return localized("Could not save the PIN. Try again.", "De pincode kon niet worden opgeslagen. Probeer het opnieuw.");
  }
}

export function mountAccountSwitchPinSettings(
  root: HTMLElement,
  port: AccountSwitchPinPort,
): Readonly<{ ready: Promise<void>; unmount(): void }> {
  const controller = new AbortController();
  let disposed = false;
  const section = el("section", "ds-panel ds-stack settings__switch-pin");
  const title = el("h3", "ds-title", {}, localized("PIN for switching accounts", "Pincode voor ander account"));
  const note = el("p", "ds-panel__note", {}, localized(
    "On a shared device, anyone can switch to your account with one tap. A 4-digit PIN stops that: switching to you then asks for it. If you forget it, sign in again with your usual sign-in and change or remove it within 15 minutes.",
    "Op een gedeeld apparaat kan iedereen met één tik naar jouw account overstappen. Een pincode van 4 cijfers voorkomt dat: overstappen naar jou vraagt er dan om. Vergeten? Meld je opnieuw aan zoals altijd en wijzig of verwijder hem binnen 15 minuten."));
  const state = el("p", "ds-body", {});
  const current = pinField(localized("Current PIN", "Huidige pincode"));
  const next = pinField(localized("New PIN (4 digits)", "Nieuwe pincode (4 cijfers)"));
  const status = el("p", "ds-body-s", { role: "status", "aria-live": "polite" });
  let known: WebSwitchPinState = { enabled: false, currentPinRequired: false };

  const render = (value: WebSwitchPinState): void => {
    known = value;
    state.textContent = value.enabled
      ? localized("A PIN is on for this account.", "Voor dit account staat een pincode aan.")
      : localized("No PIN: one tap switches to this account on a shared device.",
        "Geen pincode: met één tik stap je op een gedeeld apparaat over naar dit account.");
    current.root.hidden = !value.currentPinRequired;
    turnOn.root.hidden = value.enabled;
    change.root.hidden = !value.enabled;
    remove.root.hidden = !value.enabled;
    current.input.value = "";
    next.input.value = "";
  };
  const currentValue = (): string | undefined =>
    known.currentPinRequired && current.input.value.length > 0 ? current.input.value : undefined;
  const run = (work: () => Promise<WebSwitchPinState>, done: string): void => {
    status.textContent = localized("Saving…", "Opslaan…");
    void work().then((value) => {
      if (disposed) { return; }
      render(value);
      status.textContent = done;
    }).catch((error: unknown) => {
      if (disposed) { return; }
      current.input.value = "";
      status.textContent = failureText(error);
    });
  };
  const save = (): void => {
    if (!/^[0-9]{4}$/.test(next.input.value)) {
      status.textContent = localized("A PIN is four digits.", "Een pincode heeft vier cijfers.");
      return;
    }
    const value = next.input.value;
    run(() => port.set(value, currentValue(), controller.signal),
      localized("PIN saved.", "Pincode opgeslagen."));
  };
  const turnOn = dsButton({ label: localized("Turn on PIN", "Pincode aanzetten"), variant: "primary", onPress: save });
  const change = dsButton({ label: localized("Change PIN", "Pincode wijzigen"), variant: "primary", onPress: save });
  const remove = dsButton({
    label: localized("Remove PIN", "Pincode verwijderen"), variant: "secondary",
    onPress: () => {
      run(() => port.clear(currentValue(), controller.signal),
        localized("PIN removed.", "Pincode verwijderd."));
    },
  });
  const actions = el("div", "ds-cluster", { "data-gap": "sm" }, turnOn.root, change.root, remove.root);
  section.append(title, note, state, current.root, next.root, actions, status);
  root.append(section);
  render(known);
  section.hidden = true;
  const ready = port.read(controller.signal).then((value) => {
    if (disposed) { return; }
    render(value);
    section.hidden = false;
  }).catch(() => {
    // Not offered (an administrator, or an installation without switching): show nothing.
    if (!disposed) { section.remove(); }
  });
  return {
    ready,
    unmount: () => {
      disposed = true;
      controller.abort();
      current.input.value = "";
      next.input.value = "";
      section.remove();
    },
  };
}
