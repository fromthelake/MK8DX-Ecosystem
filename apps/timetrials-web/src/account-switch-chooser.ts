// ADR-0224 phase 2: "Switch account" on a shared device. The server remembers which accounts
// signed in on this browser and hands the page labels and opaque entry ids only - never a session
// token, and nothing is kept in browser storage. One tap switches; an account with a PIN asks for
// it, and only the server checks it. Administrators are never offered (they sign in afresh).

import {
  button as dsButton,
  dialog as dsDialog,
  el,
  nextId,
  type OverlayHandle,
} from "./ds-components.js";
import {
  WebAuthenticationError,
  type WebRememberedAccount,
} from "./authentication-client.js";
import { localized } from "./product-language.js";

export type AccountSwitchPort = Readonly<{
  load(signal?: AbortSignal): Promise<readonly WebRememberedAccount[]>;
  switchTo(entryId: string, pin?: string, signal?: AbortSignal): Promise<void>;
}>;

export type AccountChooser = Readonly<{
  root: HTMLElement;
  /** Resolves with the number of accounts offered (the current one is never offered). */
  refresh(): Promise<number>;
  dispose(): void;
}>;

function accountLabel(account: WebRememberedAccount): string {
  return account.label ?? localized("Account without a Player", "Account zonder Player");
}

function failureText(error: unknown): string {
  const code = error instanceof WebAuthenticationError ? error.code : null;
  switch (code) {
    case "pin_invalid": return localized("That PIN is not right.", "Die pincode klopt niet.");
    case "rate_limited": return localized(
      "Too many attempts. Wait a few minutes and try again.",
      "Te veel pogingen. Wacht een paar minuten en probeer het opnieuw.");
    case "not_available": return localized(
      "This account is no longer remembered here. Sign in instead.",
      "Dit account wordt hier niet meer onthouden. Meld je gewoon aan.");
    case "network_unavailable": return localized(
      "No connection. Check the network and try again.",
      "Geen verbinding. Controleer het netwerk en probeer het opnieuw.");
    default: return localized("Could not switch. Try again.", "Overstappen is niet gelukt. Probeer het opnieuw.");
  }
}

/** The list of remembered accounts with the PIN step; shared by the dialog and the sign-in page. */
export function accountChooser(
  port: AccountSwitchPort,
  onSwitched: () => void,
): AccountChooser {
  const root = el("div", "ds-stack ds-account-chooser");
  const list = el("div", "ds-stack ds-account-chooser__list", { "data-gap": "sm" });
  const status = el("p", "ds-body-s", { role: "status", "aria-live": "polite" });
  const pinId = nextId("ds-account-pin");
  const pinLabel = el("label", "ds-label", { for: pinId });
  const pin = el("input", "ds-text-input", {
    id: pinId, type: "password", inputmode: "numeric", autocomplete: "off", maxlength: "4",
    pattern: "[0-9]{4}", spellcheck: "false",
  }) as HTMLInputElement;
  const pinForm = el("div", "ds-stack ds-account-chooser__pin", { "data-gap": "sm" });
  pinForm.hidden = true;
  let controller: AbortController | null = null;
  let pending: WebRememberedAccount | null = null;
  let disposed = false;

  const forgetPin = (): void => { pin.value = ""; pending = null; pinForm.hidden = true; };
  const attempt = (account: WebRememberedAccount, value?: string): void => {
    if (disposed) { return; }
    controller?.abort();
    const current = new AbortController();
    controller = current;
    status.textContent = localized("Switching…", "Bezig met overstappen…");
    void port.switchTo(account.entryId, value, current.signal).then(() => {
      if (disposed || controller !== current) { return; }
      forgetPin();
      onSwitched();
    }).catch((error: unknown) => {
      if (disposed || controller !== current) { return; }
      pin.value = "";
      if (error instanceof WebAuthenticationError && error.code === "pin_required") {
        askPin(account);
        return;
      }
      status.textContent = failureText(error);
      if (error instanceof WebAuthenticationError && error.code === "not_available") {
        forgetPin();
        void refresh();
      }
    });
  };
  const confirmPin = dsButton({
    label: localized("Switch", "Overstappen"), variant: "primary",
    onPress: () => {
      if (pending === null) { return; }
      if (!/^[0-9]{4}$/.test(pin.value)) {
        status.textContent = localized("A PIN is four digits.", "Een pincode heeft vier cijfers.");
        return;
      }
      attempt(pending, pin.value);
    },
  });
  const cancelPin = dsButton({
    label: localized("Back", "Terug"), variant: "quiet",
    onPress: () => { forgetPin(); status.textContent = ""; },
  });
  const pinActions = el("div", "ds-cluster", { "data-gap": "sm" }, confirmPin.root, cancelPin.root);
  pinForm.append(pinLabel, pin, pinActions);
  pin.addEventListener("keydown", (event) => {
    if ((event as KeyboardEvent).key === "Enter") { confirmPin.control.click(); }
  });
  const askPin = (account: WebRememberedAccount): void => {
    pending = account;
    pinLabel.textContent = `${localized("PIN for", "Pincode voor")} ${accountLabel(account)}`;
    pin.value = "";
    pinForm.hidden = false;
    status.textContent = "";
    pin.focus?.();
  };

  const refresh = async (): Promise<number> => {
    controller?.abort();
    const current = new AbortController();
    controller = current;
    list.replaceChildren();
    status.textContent = localized("Looking for accounts on this device…", "Accounts op dit apparaat zoeken…");
    try {
      const accounts = (await port.load(current.signal)).filter((account) => !account.current);
      if (disposed || controller !== current) { return 0; }
      status.textContent = accounts.length === 0
        ? localized(
          "No other accounts are remembered on this device yet. Each person signs in here once; after that one tap is enough.",
          "Op dit apparaat worden nog geen andere accounts onthouden. Iedereen meldt zich hier één keer aan; daarna is één tik genoeg.")
        : "";
      for (const account of accounts) {
        const choice = dsButton({
          label: account.pinRequired
            ? `${accountLabel(account)} · ${localized("PIN", "pincode")}`
            : accountLabel(account),
          variant: "secondary",
          onPress: () => { if (account.pinRequired) { askPin(account); } else { attempt(account); } },
        });
        list.append(choice.root);
      }
      return accounts.length;
    } catch {
      if (!disposed && controller === current) {
        status.textContent = localized(
          "Could not load the accounts on this device. Try again.",
          "De accounts op dit apparaat konden niet worden geladen. Probeer het opnieuw.");
      }
      return 0;
    }
  };
  root.append(list, pinForm, status);
  return {
    root,
    refresh,
    dispose: () => { disposed = true; controller?.abort(); forgetPin(); },
  };
}

/** The account menu's "Switch account" dialog. */
export function openAccountSwitchDialog(
  port: AccountSwitchPort,
  options: Readonly<{ onSwitched: () => void; onUseAnother: () => void }>,
): OverlayHandle {
  let handle: OverlayHandle;
  const chooser = accountChooser(port, () => { handle.close(); options.onSwitched(); });
  const intro = el("p", "ds-body", {}, localized(
    "Accounts that signed in on this device. Tap one to continue as that person. "
      + "Administrator accounts are never listed here; sign in again with a card for those.",
    "Accounts die op dit apparaat zijn aangemeld. Tik op een account om als die persoon verder te gaan. "
      + "Beheerdersaccounts staan hier nooit; meld je daarvoor opnieuw aan met een kaart."));
  const another = dsButton({
    label: localized("Sign in with another account", "Met een ander account aanmelden"), variant: "secondary",
    onPress: () => { handle.close(); options.onUseAnother(); },
  });
  const cancel = dsButton({ label: localized("Cancel", "Annuleren"), variant: "quiet",
    onPress: () => { handle.close(); } });
  handle = dsDialog({
    title: localized("Switch account", "Ander account"),
    body: [intro, chooser.root],
    actions: [another.root, cancel.root],
  });
  handle.root.addEventListener("close", () => {
    chooser.dispose();
    handle.root.remove();
  }, { once: true });
  return {
    root: handle.root,
    open: () => { handle.open(); void chooser.refresh(); },
    close: () => { handle.close(); },
  };
}
