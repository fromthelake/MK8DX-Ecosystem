// The dialog that asks for a fresh e-mail confirmation before a dangerous administrator action.
//
// It explains why, sends the link when asked, then waits: the person opens the link (on this device
// or another one), presses Confirm there, and this dialog notices by itself and lets the original
// action continue once. Cancel or Escape ends it and the action is not performed.

import { button, dialog, el, statusMessage } from "./ds-components.js";
import { localized } from "./product-language.js";
import {
  StepUpClientError,
  requestStepUp,
  stepUpStatus,
  type StepUpStatus,
} from "./step-up-client.js";

type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type StepUpDialogOptions = Readonly<{
  fetcher: Fetch;
  /** Waits between status checks; replaced in tests. */
  wait?: (ms: number) => Promise<void>;
  pollIntervalMs?: number;
}>;

/** Resolves true once this session is confirmed, false when the person cancels or the link runs out. */
export function confirmWithEmailLink(options: StepUpDialogOptions): Promise<boolean> {
  const wait = options.wait ?? ((ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); }));
  const pollIntervalMs = options.pollIntervalMs ?? 3_000;
  return new Promise<boolean>((resolve) => {
    let settled = false;
    let polling = false;
    const intro = el("p", "ds-body", {}, localized(
      "This action needs a fresh confirmation. We send a one-time link to your account's email address. " +
        "Open it, on this device or another one, and press Confirm. Then this action continues by itself.",
      "Voor deze actie is een nieuwe bevestiging nodig. We sturen een eenmalige link naar het e-mailadres van " +
        "je account. Open die, op dit apparaat of een ander, en druk op Bevestigen. Daarna gaat deze actie vanzelf verder."));
    const notice = el("div", "ds-stack", { "aria-live": "polite" });
    const say = (tone: "info" | "success" | "warning" | "error", text: string): void => {
      notice.replaceChildren(statusMessage(tone, text));
    };
    const finish = (result: boolean): void => {
      if (settled) { return; }
      settled = true;
      handle.close();
      handle.root.remove();
      resolve(result);
    };
    const cancel = button({ label: localized("Cancel", "Annuleren"), variant: "secondary", onPress: () => finish(false) });
    const send = button({
      label: localized("Send the link", "Stuur de link"), variant: "primary",
      onPress: () => { void sendLink(); },
    });
    const watch = async (linkExpiresAtMs: number): Promise<void> => {
      if (polling) { return; }
      polling = true;
      while (!settled) {
        await wait(pollIntervalMs);
        if (settled) { return; }
        let status: StepUpStatus;
        try { status = await stepUpStatus(options.fetcher); } catch { continue; }
        if (status.active) {
          say("success", localized("Confirmed. Continuing…", "Bevestigd. Bezig met doorgaan…"));
          finish(true);
          return;
        }
        if (!status.pending && Date.now() > linkExpiresAtMs) {
          polling = false;
          say("warning", localized("The link has expired. Send a new one to continue.",
            "De link is verlopen. Stuur een nieuwe om verder te gaan."));
          send.setDisabled(null);
          send.setLoading(null);
          return;
        }
      }
    };
    const sendLink = async (): Promise<void> => {
      send.setLoading(localized("Sending…", "Versturen…"));
      try {
        const sent = await requestStepUp(options.fetcher);
        if (settled) { return; }
        send.setLoading(null);
        send.setDisabled(localized("The link was sent.", "De link is verstuurd."));
        say("info", localized(
          "Check your inbox and open the link. This window waits for your confirmation.",
          "Kijk in je inbox en open de link. Dit venster wacht op je bevestiging."));
        void watch(sent.linkExpiresAtMs);
      } catch (error) {
        if (settled) { return; }
        send.setLoading(null);
        const code = error instanceof StepUpClientError ? error.code : "unavailable";
        if (code === "mail_unavailable" && error instanceof StepUpClientError && error.linkExpiresAtMs !== null) {
          // The link exists; only the e-mail failed. The server operator can hand it over, and this
          // window keeps waiting for the confirmation.
          say("error", localized(
            "The confirmation link was created, but the email could not be sent. Ask the server operator to run python tooling/install.py step-up-link on the server and give you the link. Open it and this window continues.",
            "De bevestigingslink is aangemaakt, maar de e-mail kon niet worden verstuurd. Vraag de serverbeheerder om op de server python tooling/install.py step-up-link uit te voeren en je de link te geven. Open die en dit venster gaat verder."));
          void watch(error.linkExpiresAtMs);
          return;
        }
        say("error", code === "rate_limited"
          ? localized("Too many links were requested. Wait a few minutes and try again.",
            "Er zijn te veel links aangevraagd. Wacht een paar minuten en probeer het opnieuw.")
          : code === "signed_out"
            ? localized("You are signed out. Sign in again first.", "Je bent afgemeld. Meld je eerst opnieuw aan.")
            : localized("The link could not be sent. Please retry.", "De link kon niet worden verstuurd. Probeer het opnieuw."));
      }
    };
    const handle = dialog({
      title: localized("Confirm with a new email link", "Bevestig met een nieuwe e-maillink"),
      body: [intro, notice],
      actions: [cancel.root, send.root],
    });
    handle.root.setAttribute("data-step-up-dialog", "");
    handle.root.addEventListener("close", () => finish(false));
    handle.open();
    send.control.focus?.();
  });
}
