/**
 * The player's status line and open sign-up on a night's page (ADR-0222).
 *
 * Every night still to come tells a signed-in player one clear line about themselves and what can
 * happen next: sign up (with the consoles they bring), change the consoles, withdraw, or nothing
 * because the Director puts the list together. A night with open sign-up also shows everybody the
 * list and the waiting list in order, and after a draw the seed it was drawn with.
 */

import { button, el, panel, statusMessage, useDocument } from "./ds-components.js";
import { localized, productLocaleTag } from "./product-language.js";
import {
  createTournamentSignupClient,
  SignupClientError,
  type SignupListEntry,
  type TournamentSignup,
  type TournamentSignupClient,
} from "./tournament-signup-client.js";

export type MountedTournamentSignup = Readonly<{ ready: Promise<void>; unmount(): void }>;

const WEEK_MS = 6 * 86_400_000;

/** "Fri 20:00" in the night's own time zone and the viewer's language; a date as well when far off. */
export function signupMoment(atMs: number, timezone: string | null, nowMs: number = Date.now()): string {
  const options: Intl.DateTimeFormatOptions = {
    weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    ...(Math.abs(atMs - nowMs) > WEEK_MS ? { day: "numeric", month: "short" } : {}),
  };
  try {
    return new Intl.DateTimeFormat(productLocaleTag(), { ...options, ...(timezone === null ? {} : { timeZone: timezone }) })
      .format(new Date(atMs)).replace(/,/gu, "");
  } catch {
    return new Intl.DateTimeFormat(productLocaleTag(), options).format(new Date(atMs)).replace(/,/gu, "");
  }
}

export type SignupLine = Readonly<{ text: string; tone: "info" | "success" | "warning" }>;

/** The one line the page says about the viewer (or, signed out, about the sign-up), or null. */
export function signupStatusLine(signup: TournamentSignup, nowMs: number = Date.now()): SignupLine | null {
  const when = signup.closesAtMs === null ? "" : signupMoment(signup.closesAtMs, signup.timezone, nowMs);
  const terms = (): string => localized(
    `Sign-up closes ${when} · ${signup.taken} of ${signup.capacity ?? 0} places`,
    `Aanmelden sluit ${when} · ${signup.taken} van ${signup.capacity ?? 0} plaatsen`,
  );
  switch (signup.viewer.state) {
    case "signed_out":
      return signup.status === "open" ? { text: terms(), tone: "info" } : null;
    case "no_player":
      return signup.status === "open" ? { text: terms(), tone: "info" } : null;
    case "director_roster":
      return { text: localized("The Director puts the list together", "De Directeur stelt de lijst samen"), tone: "info" };
    case "not_signed_up":
      return { text: terms(), tone: "info" };
    case "pending":
      return {
        text: localized(`You're signed up · the draw is on ${when}`, `Je bent aangemeld · er wordt geloot op ${when}`),
        tone: "success",
      };
    case "selected":
      return { text: localized("You're in", "Je doet mee"), tone: "success" };
    case "waiting":
      return {
        text: localized(
          `Waiting list · number ${signup.viewer.waitingPosition ?? 0}`,
          `Wachtlijst · nummer ${signup.viewer.waitingPosition ?? 0}`,
        ),
        tone: "warning",
      };
    case "withdrawn":
      return { text: localized("You withdrew", "Je hebt je afgemeld"), tone: "info" };
    case "removed":
      return {
        text: localized("The Director took you off the list", "De Directeur heeft je van de lijst gehaald"),
        tone: "warning",
      };
    case "closed":
      return { text: localized("Sign-up is closed", "Aanmelden is gesloten"), tone: "info" };
  }
}

function playerName(entry: SignupListEntry): HTMLElement {
  return entry.playerId === null
    ? el("span", "", {}, entry.displayName)
    : el("a", "ds-link", { href: `/?player=${encodeURIComponent(entry.playerId)}` }, entry.displayName);
}

function orderedList(entries: readonly SignupListEntry[], className: string): HTMLElement {
  return el("ol", `ds-signup__list ${className}`, {}, ...entries.map((entry) =>
    el("li", "ds-signup__entry", {}, playerName(entry))));
}

export function mountTournamentSignup(
  root: HTMLElement,
  tournamentId: string,
  client: TournamentSignupClient = createTournamentSignupClient(),
): MountedTournamentSignup {
  useDocument(root.ownerDocument);
  const controller = new AbortController();
  const section = el("div", "ds-signup ds-stack", { "data-gap": "sm" });
  section.hidden = true;
  root.append(section);

  const render = (signup: TournamentSignup): void => {
    section.replaceChildren();
    const line = signupStatusLine(signup);
    const viewer = signup.viewer;
    const children: (HTMLElement | null)[] = [];
    if (line !== null) {
      const status = statusMessage(line.tone, line.text);
      status.classList.add("ds-signup__line");
      status.setAttribute("data-signup-state", viewer.state);
      children.push(status);
    }
    if (viewer.state === "no_player" && signup.status === "open") {
      children.push(el("p", "ds-body", {},
        localized(
          "To sign up you need a verified Player on your account. ",
          "Om je aan te melden heb je een geverifieerde Player op je account nodig. ",
        ),
        el("a", "ds-link", { href: "/?welcome=1" },
          localized("Link your Player or create one", "Koppel je Player of maak er een aan"))));
    }
    if (viewer.state === "signed_out" && signup.status === "open") {
      children.push(el("p", "ds-micro", {}, localized("Sign in to sign up.", "Meld je aan met je account om mee te doen.")));
    }
    const feedback = el("p", "ds-signup__feedback ds-micro", { role: "status" });
    const consolesNeeded = viewer.canSignUp || viewer.canChangeConsoles;
    if (consolesNeeded || viewer.canWithdraw) {
      const form = el("div", "ds-signup__form ds-stack", { "data-gap": "xs" });
      const box = (id: string, label: string, checked: boolean): [HTMLInputElement, HTMLElement] => {
        const input = el("input", "", { type: "checkbox", id });
        input.checked = checked;
        return [input, el("label", "ds-signup__console", { for: id }, input, ` ${label}`)];
      };
      const [ns1, ns1Label] = box(`signup-ns1-${signup.tournamentId}`, localized("I bring a Switch 1", "Ik neem een Switch 1 mee"), viewer.hasSwitch1);
      const [ns2, ns2Label] = box(`signup-ns2-${signup.tournamentId}`, localized("I bring a Switch 2", "Ik neem een Switch 2 mee"), viewer.hasSwitch2);
      const failure = (error: unknown): void => {
        if (controller.signal.aborted) { return; }
        feedback.textContent = error instanceof SignupClientError && error.code === "conflict"
          ? localized("Sign-up has closed in the meantime. Reload the page.", "Het aanmelden is inmiddels gesloten. Laad de pagina opnieuw.")
          : error instanceof SignupClientError && error.serverCode === "tournament_signup_no_verified_player"
            ? localized("You need a verified Player to sign up.", "Je hebt een geverifieerde Player nodig om je aan te melden.")
            : localized("That did not work. Try again later.", "Dat lukte niet. Probeer het later opnieuw.");
      };
      if (consolesNeeded) {
        form.append(el("fieldset", "ds-signup__consoles", {},
          el("legend", "ds-field__label", {}, localized("Which consoles do you bring?", "Welke consoles neem je mee?")),
          ns1Label, ns2Label));
      }
      const actions = el("div", "ds-signup__actions", {});
      if (consolesNeeded) {
        const save = button({
          label: viewer.canSignUp
            ? (viewer.state === "withdrawn" ? localized("Sign up again", "Opnieuw aanmelden") : localized("Sign up", "Aanmelden"))
            : localized("Change consoles", "Consoles wijzigen"),
          variant: viewer.canSignUp ? "primary" : "secondary",
          onPress: () => {
            save.setLoading(localized("Saving…", "Opslaan…"));
            feedback.textContent = "";
            void client.signUp(signup.tournamentId, { hasSwitch1: ns1.checked, hasSwitch2: ns2.checked }, controller.signal)
              .then(render, (error: unknown) => { save.setLoading(null); failure(error); });
          },
        });
        actions.append(save.root);
      }
      if (viewer.canWithdraw) {
        const withdraw = button({
          label: localized("Withdraw", "Afmelden"),
          variant: "quiet",
          onPress: () => {
            withdraw.setLoading(localized("Withdrawing…", "Afmelden…"));
            feedback.textContent = "";
            void client.withdraw(signup.tournamentId, controller.signal)
              .then(render, (error: unknown) => { withdraw.setLoading(null); failure(error); });
          },
        });
        actions.append(withdraw.root);
      }
      form.append(actions, feedback);
      children.push(form);
    }
    if (signup.mode === "open") {
      children.push(el("h3", "ds-signup__heading", {},
        localized(`On the list (${signup.active.length})`, `Op de lijst (${signup.active.length})`)));
      children.push(signup.active.length === 0
        ? el("p", "ds-micro", {}, localized("Nobody yet.", "Nog niemand."))
        : orderedList(signup.active, "ds-signup__list--active"));
      if (signup.waiting.length > 0 || signup.status === "closed") {
        children.push(el("h3", "ds-signup__heading", {},
          localized(`Waiting list (${signup.waiting.length})`, `Wachtlijst (${signup.waiting.length})`)));
        children.push(signup.waiting.length === 0
          ? el("p", "ds-micro", {}, localized("Nobody is waiting.", "Niemand wacht."))
          : orderedList(signup.waiting, "ds-signup__list--waiting"));
      }
      if (signup.drawSeed !== null) {
        children.push(el("p", "ds-signup__seed ds-micro", {},
          localized(`Drawn with seed ${signup.drawSeed} (${signup.drawAlgorithm ?? ""}).`,
            `Geloot met seed ${signup.drawSeed} (${signup.drawAlgorithm ?? ""}).`)));
      }
    }
    if (children.length === 0) { section.hidden = true; return; }
    section.hidden = false;
    section.append(panel({
      title: signup.mode === "open" ? localized("Sign-up", "Aanmelden") : localized("Taking part", "Meedoen"),
      titleLevel: 2,
      children,
    }));
  };

  const ready = client.load(tournamentId, controller.signal).then(render, () => {
    // A finished night, an old edition or a server that cannot say: the page has no sign-up block.
    section.hidden = true;
  });

  return {
    ready,
    unmount(): void {
      controller.abort();
      if (section.parentNode === root) { root.removeChild(section); }
    },
  };
}
