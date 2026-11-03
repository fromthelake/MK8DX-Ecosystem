/**
 * "Request to host" on the Tournaments page (ADR-0220).
 *
 * A Director is the one word for whoever hosts Tournament nights. A signed-in account that is not a
 * Director (and not an administrator) reads here how to become one and may ask, with an optional
 * short note; the request goes to the administrators' inbox. The same block then says where the
 * request stands: sent on a date, or declined with the reason and the option to ask again. An
 * approved request needs no block: the person is a Director and the page shows them the door.
 */

import { button, el, statusMessage, useDocument } from "./ds-components.js";
import {
  createDirectorHostRequestClient,
  HOST_REQUEST_NOTE_MAXIMUM,
  HostRequestClientError,
  type DirectorHostRequestClient,
  type HostRequestStanding,
} from "./director-host-request-client.js";
import { localized, productLocaleTag } from "./product-language.js";

export type MountedDirectorHostRequest = Readonly<{ ready: Promise<void>; unmount(): void }>;

function day(ms: number): string {
  return new Date(ms).toLocaleDateString(productLocaleTag(), { day: "numeric", month: "long", year: "numeric" });
}

export function mountDirectorHostRequest(
  root: HTMLElement,
  client: DirectorHostRequestClient = createDirectorHostRequestClient(),
): MountedDirectorHostRequest {
  useDocument(root.ownerDocument);
  const controller = new AbortController();
  const section = el("section", "ds-host-request ds-panel ds-stack", {
    "aria-labelledby": "host-request-heading", "data-gap": "sm",
  });
  section.hidden = true;
  root.append(section);

  const render = (standing: HostRequestStanding): void => {
    section.replaceChildren();
    const request = standing.request;
    // Administrators and Directors never see the button.
    if (standing.administrator || standing.director) { section.hidden = true; return; }
    section.hidden = false;
    section.append(
      el("h2", "ds-panel__title", { id: "host-request-heading" },
        localized("Host your own Tournament nights", "Zelf toernooiavonden hosten")),
      el("p", "ds-body", {}, localized(
        "Tournament nights are hosted by Directors. A Director creates a night, fills its list, runs the groups and enters the scores. To become one, ask the administrators: they decide and you hear back here and in your notifications.",
        "Toernooiavonden worden gehost door Directeuren. Een Directeur maakt een avond aan, vult de deelnemerslijst, deelt de groepen in en voert de scores in. Wil je er een worden? Vraag het de beheerders: zij beslissen en je hoort het hier en in je meldingen.",
      )),
    );
    if (request !== null && request.status === "open") {
      section.append(statusMessage("info", localized(
        `Request sent on ${day(request.requestedAtMs)}. The administrators will answer it.`,
        `Verzoek verstuurd op ${day(request.requestedAtMs)}. De beheerders beantwoorden het.`,
      )));
      if (request.note !== null) {
        section.append(el("p", "ds-host-request__note ds-micro", {}, localized(
          `Your note: ${request.note}`, `Jouw notitie: ${request.note}`,
        )));
      }
      return;
    }
    if (request !== null && request.status === "declined") {
      section.append(statusMessage("warning", request.declineReason === null
        ? localized(
          `Declined on ${day(request.decidedAtMs ?? request.requestedAtMs)}.`,
          `Afgewezen op ${day(request.decidedAtMs ?? request.requestedAtMs)}.`,
        )
        : localized(
          `Declined: ${request.declineReason}`,
          `Afgewezen: ${request.declineReason}`,
        )));
    }
    section.append(form(request !== null && request.status === "declined"));
  };

  const form = (again: boolean): HTMLElement => {
    const wrapper = el("div", "ds-host-request__form ds-stack", { "data-gap": "xs" });
    const noteId = "host-request-note";
    const note = el("textarea", "ds-input ds-host-request__input", {
      id: noteId, rows: "3", maxlength: String(HOST_REQUEST_NOTE_MAXIMUM),
    });
    const label = el("label", "ds-field__label", { for: noteId },
      localized("A short note for the administrators (optional)", "Een korte notitie voor de beheerders (optioneel)"));
    const hint = el("span", "ds-field__hint", {}, localized(
      "For example where and how often you would host. At most 300 characters.",
      "Bijvoorbeeld waar en hoe vaak je zou hosten. Hooguit 300 tekens.",
    ));
    const feedback = el("p", "ds-host-request__feedback ds-micro", { role: "status" });
    const send = button({
      label: again ? localized("Ask again", "Opnieuw vragen") : localized("Request to host", "Verzoek om te hosten"),
      variant: "primary",
      onPress: () => {
        send.setLoading(localized("Sending…", "Versturen…"));
        feedback.textContent = "";
        void client.submit(note.value, controller.signal).then(render, (error: unknown) => {
          send.setLoading(null);
          if (controller.signal.aborted) { return; }
          feedback.textContent = error instanceof HostRequestClientError && error.code === "invalid_input"
            ? localized("The note can be at most 300 characters.", "De notitie mag hooguit 300 tekens zijn.")
            : error instanceof HostRequestClientError && error.serverCode === "director_host_request_already_open"
              ? localized("You already have a request waiting.", "Je hebt al een verzoek dat wacht.")
              : localized("The request could not be sent. Try again later.", "Het verzoek kon niet worden verstuurd. Probeer het later opnieuw.");
        });
      },
    });
    wrapper.append(label, note, hint, el("div", "ds-host-request__actions", {}, send.root), feedback);
    return wrapper;
  };

  const ready = client.standing(controller.signal).then(render, () => {
    // Signed out, or the server cannot say: the page simply has no request block.
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
