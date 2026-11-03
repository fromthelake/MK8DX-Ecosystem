/**
 * Sign-up on the Director's Step 2 board (ADR-0222).
 *
 * The list stays the Director's roster by default, prefilled from earlier nights as before. Here
 * the Director may open sign-up (closing time, maximum, first come or a draw), sees every sign-up
 * with its order and the consoles they bring, a warning when too few consoles are coming, closes
 * early, and moves people by hand. Sign-ups write the roster below; the attendance at Step 2 still
 * decides who plays.
 */

import { button, el, statusMessage, useDocument } from "./ds-components.js";
import { localized, productLocaleTag } from "./product-language.js";
import {
  createTournamentSignupClient,
  SignupClientError,
  type SignupBoard,
  type SignupBoardEntry,
  type SignupSelection,
  type TournamentSignupClient,
} from "./tournament-signup-client.js";
import { signupMoment } from "./tournament-signup-section.js";

export type MountedTournamentSignupBoard = Readonly<{ ready: Promise<void>; unmount(): void }>;

/** "2026-11-06T20:00" for a datetime-local input, in the viewer's own clock. */
function localInputValue(atMs: number): string {
  const date = new Date(atMs);
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function signupEntryLabel(entry: SignupBoardEntry): string {
  switch (entry.status) {
    case "selected": return localized("On the list", "Op de lijst");
    case "pending": return localized("Waiting for the draw", "Wacht op de loting");
    case "waiting": return localized(`Waiting list ${entry.position ?? ""}`, `Wachtlijst ${entry.position ?? ""}`).trim();
    case "withdrawn": return localized("Withdrew", "Afgemeld");
    case "removed": return localized("Taken off the list", "Van de lijst gehaald");
  }
}

export function signupConsoleWarning(board: SignupBoard): string | null {
  if (!board.consoles.warning) { return null; }
  return localized(
    `Too few consoles: ${board.consoles.coming} coming for ${board.consoles.players} players, ${board.consoles.needed} needed.`,
    `Te weinig consoles: ${board.consoles.coming} komen er voor ${board.consoles.players} spelers, ${board.consoles.needed} nodig.`,
  );
}

export function mountTournamentSignupBoard(
  root: HTMLElement,
  tournamentId: string,
  options: Readonly<{ client?: TournamentSignupClient; onRosterChanged?: () => void }> = {},
): MountedTournamentSignupBoard {
  useDocument(root.ownerDocument);
  const client = options.client ?? createTournamentSignupClient();
  const controller = new AbortController();
  const section = el("details", "tournament-op__signup ds-signup-board", {});
  section.hidden = true;
  root.append(section);
  const feedback = el("p", "ds-signup__feedback ds-micro", { role: "status" });

  const act = (work: () => Promise<SignupBoard>, rosterChanges: boolean): void => {
    feedback.textContent = localized("Saving…", "Opslaan…");
    void work().then((board) => {
      feedback.textContent = "";
      render(board);
      if (rosterChanges) { options.onRosterChanged?.(); }
    }, (error: unknown) => {
      if (controller.signal.aborted) { return; }
      feedback.textContent = error instanceof SignupClientError && error.code === "invalid_input"
        ? localized("Check the closing time (in the future) and the maximum (1-60).", "Controleer de sluittijd (in de toekomst) en het maximum (1-60).")
        : error instanceof SignupClientError && error.code === "conflict"
          ? localized("That is not possible any more; the board was reloaded.", "Dat kan niet meer; het bord is opnieuw geladen.")
          : localized("That did not work. Try again later.", "Dat lukte niet. Probeer het later opnieuw.");
      void client.board(tournamentId, controller.signal).then(render, () => undefined);
    });
  };

  const render = (board: SignupBoard): void => {
    section.replaceChildren();
    section.hidden = false;
    const settings = board.settings;
    const open = settings.mode === "open";
    section.open = open || section.open;
    const summary = el("summary", "", {}, open
      ? localized(`Sign-up · ${board.entries.length} signed up`, `Aanmelden · ${board.entries.length} aangemeld`)
      : localized("Sign-up · the Director's roster", "Aanmelden · lijst van de Directeur"));
    section.append(summary);
    section.append(el("p", "tournament-op__hint", {}, localized(
      "By default you put the list together, as before. With open sign-up Players sign up themselves until the closing time; they are added to this roster (on the list or the waiting list) and you can still add, remove or move anyone. The attendance on the night decides who plays.",
      "Standaard stel je de lijst zelf samen, zoals altijd. Met open aanmelden melden spelers zich zelf aan tot de sluittijd; ze komen in deze lijst (op de lijst of de wachtlijst) en je kunt nog steeds iedereen toevoegen, verwijderen of verplaatsen. De aanwezigheid op de avond bepaalt wie speelt.",
    )));

    // Terms: only while sign-up has not closed and the night has not started.
    if (board.editable && settings.status !== "closed") {
      const form = el("div", "ds-signup-board__settings ds-stack", { "data-gap": "xs" });
      const mode = el("select", "ds-input", { id: `signup-mode-${tournamentId}` });
      mode.append(
        el("option", "", { value: "director" }, localized("The Director puts the list together", "De Directeur stelt de lijst samen")),
        el("option", "", { value: "open" }, localized("Open sign-up", "Open aanmelden")),
      );
      mode.value = settings.mode;
      const selection = el("select", "ds-input", { id: `signup-selection-${tournamentId}` });
      selection.append(
        el("option", "", { value: "first_come" }, localized("First come, first served", "Wie het eerst komt")),
        el("option", "", { value: "draw" }, localized("A draw at closing", "Loting bij sluiten")),
      );
      selection.value = settings.selection ?? "draw";
      const closes = el("input", "ds-input", { id: `signup-closes-${tournamentId}`, type: "datetime-local" });
      closes.value = settings.closesAtMs === null ? "" : localInputValue(settings.closesAtMs);
      const capacity = el("input", "ds-input", { id: `signup-capacity-${tournamentId}`, type: "number", min: "1", max: "60" });
      capacity.value = settings.capacity === null ? "" : String(settings.capacity);
      const label = (control: HTMLElement, text: string): HTMLElement =>
        el("label", "ds-field ds-signup-board__field", { for: control.id }, el("span", "ds-field__label", {}, text), control);
      form.append(
        label(mode, localized("Who makes the list", "Wie maakt de lijst")),
        label(selection, localized("Selection", "Selectie")),
        label(closes, localized("Sign-up closes", "Aanmelden sluit")),
        label(capacity, localized("Maximum", "Maximum")),
      );
      const save = button({
        label: localized("Save sign-up", "Aanmelden opslaan"),
        variant: "secondary",
        onPress: () => {
          if (mode.value === "director") {
            act(() => client.configure(tournamentId, { mode: "director" }, controller.signal), false);
            return;
          }
          const closesAtMs = closes.value === "" ? Number.NaN : new Date(closes.value).getTime();
          const maximum = Number(capacity.value);
          act(() => client.configure(tournamentId, {
            mode: "open",
            selection: selection.value as SignupSelection,
            ...(Number.isFinite(closesAtMs) ? { closesAtMs } : {}),
            ...(Number.isSafeInteger(maximum) && maximum > 0 ? { capacity: maximum } : {}),
          }, controller.signal), true);
        },
      });
      form.append(el("div", "ds-signup__actions", {}, save.root));
      section.append(form);
    }

    if (open) {
      const closedAt = settings.closedAtMs === null ? "" : new Date(settings.closedAtMs).toLocaleString(productLocaleTag());
      const state = settings.status === "closed"
        ? localized(`Closed ${closedAt}`, `Gesloten ${closedAt}`).trim()
        : localized(
          `Open until ${settings.closesAtMs === null ? "" : signupMoment(settings.closesAtMs, null)} · maximum ${settings.capacity ?? 0}`,
          `Open tot ${settings.closesAtMs === null ? "" : signupMoment(settings.closesAtMs, null)} · maximum ${settings.capacity ?? 0}`,
        );
      section.append(el("p", "tournament-op__hint", {}, state));
      if (settings.drawSeed !== null) {
        section.append(el("p", "ds-micro ds-signup__seed", {}, localized(
          `Draw seed ${settings.drawSeed} (${settings.drawAlgorithm ?? ""})`,
          `Lotingsseed ${settings.drawSeed} (${settings.drawAlgorithm ?? ""})`,
        )));
      }
      if (settings.status === "open" && board.editable) {
        const closeNow = button({
          label: settings.selection === "draw" ? localized("Close and draw now", "Nu sluiten en loten") : localized("Close now", "Nu sluiten"),
          variant: "quiet",
          onPress: () => { act(() => client.close(tournamentId, controller.signal), true); },
        });
        section.append(el("div", "ds-signup__actions", {}, closeNow.root));
      }
    }

    const warning = signupConsoleWarning(board);
    if (warning !== null) { section.append(statusMessage("warning", warning)); }

    if (board.entries.length > 0) {
      const list = el("ol", "ds-signup-board__entries", {});
      for (const entry of board.entries) {
        const consoles = [entry.hasSwitch1 ? "NS1" : "", entry.hasSwitch2 ? "NS2" : ""].filter((part) => part !== "").join(" + ");
        const row = el("li", "ds-signup-board__entry", { "data-signup-status": entry.status },
          el("span", "ds-signup-board__name", {}, entry.displayName),
          el("span", "ds-micro", {}, [
            signupEntryLabel(entry),
            consoles === "" ? localized("no console", "geen console") : consoles,
            new Date(entry.signedUpAtMs).toLocaleString(productLocaleTag()),
          ].join(" · ")));
        if (board.editable && entry.status !== "withdrawn") {
          const actions = el("span", "ds-signup-board__actions", {});
          const move = (label: string, to: "selected" | "waiting" | "removed", position?: number): void => {
            const handle = button({
              label, variant: "quiet", size: "sm",
              onPress: () => {
                act(() => client.move(tournamentId, {
                  playerId: entry.playerId, to, ...(position === undefined ? {} : { position }),
                }, controller.signal), true);
              },
            });
            actions.append(handle.root);
          };
          if (entry.status !== "selected") { move(localized("On the list", "Op de lijst"), "selected"); }
          if (entry.status === "waiting" && (entry.position ?? 1) > 1) {
            move(localized("Move up", "Omhoog"), "waiting", (entry.position ?? 2) - 1);
          }
          if (entry.status !== "waiting" && entry.status !== "removed") {
            move(localized("To the waiting list", "Naar de wachtlijst"), "waiting");
          }
          if (entry.status !== "removed") { move(localized("Take off", "Van de lijst halen"), "removed"); }
          row.append(actions);
        }
        list.append(row);
      }
      section.append(list);
    }
    section.append(feedback);
  };

  const ready = client.board(tournamentId, controller.signal).then(render, () => { section.hidden = true; });

  return {
    ready,
    unmount(): void {
      controller.abort();
      if (section.parentNode === root) { root.removeChild(section); }
    },
  };
}
