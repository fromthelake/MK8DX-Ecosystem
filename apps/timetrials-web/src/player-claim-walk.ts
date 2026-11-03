import {
  createClaimWalkClient,
  type ClaimNote,
  type ClaimWalkClient,
  type ClaimWalkItem,
} from "./claim-walk-client.js";
import { PlayerClaimClientError } from "./player-claim-client.js";
import { localized, productLocaleTag } from "./product-language.js";

export type MountedPlayerClaimWalk = Readonly<{
  container: HTMLElement;
  ready: Promise<readonly ClaimWalkItem[]>;
  unmount(): void;
}>;

/** Closed claims stay in view this long, so a decline or an unlink is read before it goes. */
const closedVisibleMs = 90 * 24 * 60 * 60 * 1000;

function clear(element: HTMLElement): void {
  while (element.firstChild !== null) { element.removeChild(element.firstChild); }
}

function day(ms: number): string {
  return new Date(ms).toLocaleDateString(productLocaleTag(), {
    day: "numeric", month: "short", year: "numeric",
  });
}

function either(names: readonly string[]): string {
  if (names.length <= 1) { return names[0] ?? ""; }
  return `${names.slice(0, -1).join(", ")} ${localized("or", "of")} ${names.at(-1)}`;
}

function reviewerName(item: ClaimWalkItem): string {
  const decision = item.lastDecision;
  if (decision === null) { return localized("the team", "het team"); }
  if (decision.byName !== null) { return decision.byName; }
  return decision.byRole === "director"
    ? localized("the Director", "de Directeur")
    : localized("an administrator", "een beheerder");
}

const revokeReasonText: Readonly<Record<string, readonly [string, string]>> = {
  linked_by_mistake: ["it was linked by mistake", "het per vergissing gekoppeld was"],
  person_asked: ["the person asked for it", "de persoon erom vroeg"],
  account_misuse: ["the account was misused", "het account werd misbruikt"],
};

/** The plain sentence that says where a claim stands (ADR-0216 section 4). */
export function claimWalkStatusLine(item: ClaimWalkItem, nowMs = Date.now()): string {
  const name = item.player.displayName;
  const question = lastQuestion(item);
  switch (item.claimStatus) {
    case "requested":
    case "under_review": {
      if (question !== null) {
        return localized(
          `${question.authorName ?? "A reviewer"} has a question about ${name}:`,
          `${question.authorName ?? "Een beoordelaar"} heeft een vraag over ${name}:`,
        );
      }
      const who = item.reviewerDirectorNames.length === 0
        ? localized("the administrators", "de beheerders")
        : localized(`${either(item.reviewerDirectorNames)} or the administrators`,
          `${either(item.reviewerDirectorNames)} of de beheerders`);
      const days = Math.max(0, Math.floor((nowMs - item.requestedAtMs) / 86_400_000));
      return localized(
        `Your request for ${name} waits for ${who} since ${day(item.requestedAtMs)}${days >= 1 ? ` (${days} day${days === 1 ? "" : "s"})` : ""}.`,
        `Je verzoek voor ${name} wacht sinds ${day(item.requestedAtMs)} op ${who}${days >= 1 ? ` (${days} dag${days === 1 ? "" : "en"})` : ""}.`,
      );
    }
    case "verified":
      return localized(`Linked: you are ${name}.`, `Gekoppeld: jij bent ${name}.`);
    case "rejected":
      return localized(
        `Declined by ${reviewerName(item)} on ${day(item.updatedAtMs)}: they could not confirm that ${name} is you.`,
        `Afgewezen door ${reviewerName(item)} op ${day(item.updatedAtMs)}: ze konden niet bevestigen dat ${name} jij bent.`,
      );
    case "revoked": {
      const reason = revokeReasonText[item.lastDecision?.reasonCode ?? ""];
      return localized(
        `${name} was unlinked by ${reviewerName(item)} on ${day(item.updatedAtMs)}${reason === undefined ? "" : `, because ${reason[0]}`}.`,
        `${name} is ontkoppeld door ${reviewerName(item)} op ${day(item.updatedAtMs)}${reason === undefined ? "" : `, omdat ${reason[1]}`}.`,
      );
    }
    case "released":
      return item.lastDecision?.byRole === "requester"
        ? localized(`You unlinked ${name} on ${day(item.updatedAtMs)}.`, `Je hebt ${name} ontkoppeld op ${day(item.updatedAtMs)}.`)
        : localized(
          `${reviewerName(item)} closed your link with ${name} on ${day(item.updatedAtMs)}.`,
          `${reviewerName(item)} sloot je koppeling met ${name} op ${day(item.updatedAtMs)}.`,
        );
  }
}

function lastQuestion(item: ClaimWalkItem): ClaimNote | null {
  const last = item.notes.at(-1);
  return last !== undefined && last.role === "reviewer" && last.kind === "question" ? last : null;
}

/**
 * Every claim of this account with a plain status line, the conversation with its reviewers, a reply
 * box for a question, and "This is not me" to unlink, after a confirmation that says what stays with
 * the Player.
 */
export function mountPlayerClaimWalk(
  root: HTMLElement,
  client: ClaimWalkClient = createClaimWalkClient(),
  onChanged: () => void = () => undefined,
): MountedPlayerClaimWalk {
  const document = root.ownerDocument;
  const controller = new AbortController();
  let disposed = false;
  let operation = 0;
  const container = document.createElement("div");
  container.className = "player-claim-walk ds-stack";
  const status = document.createElement("p");
  status.className = "ds-body-s player-claim-walk__status";
  status.setAttribute("role", "status");
  const list = document.createElement("ul");
  list.className = "player-claim-walk__list ds-stack";
  container.append(list, status);
  root.append(container);

  const element = <K extends keyof HTMLElementTagNameMap>(
    tag: K, className: string, text?: string,
  ): HTMLElementTagNameMap[K] => {
    const node = document.createElement(tag);
    if (className.length > 0) { node.className = className; }
    if (text !== undefined) { node.textContent = text; }
    return node;
  };
  const button = (text: string, variant: "primary" | "secondary" | "quiet"): HTMLButtonElement => {
    const control = element("button", "ds-button", text);
    control.type = "button";
    control.setAttribute("data-variant", variant);
    return control;
  };
  const noteField = (labelText: string, name: string) => {
    const label = element("label", "ds-field");
    const input = element("textarea", "ds-input");
    input.name = name;
    input.maxLength = 500;
    input.rows = 2;
    label.append(element("span", "", labelText), input);
    return { label, input };
  };

  const run = (controls: readonly HTMLButtonElement[], message: string, work: () => Promise<void>): void => {
    if (disposed) { return; }
    operation += 1;
    const current = operation;
    for (const control of controls) { control.disabled = true; }
    status.textContent = message;
    void work().then(() => {
      if (disposed || current !== operation) { return; }
      status.textContent = "";
      onChanged();
      return load().then(() => undefined);
    }).catch((error: unknown) => {
      if (disposed || current !== operation) { return; }
      for (const control of controls) { control.disabled = false; }
      status.textContent = error instanceof PlayerClaimClientError && error.code === "conflict"
        ? localized("This changed in the meantime. Reload to see where it stands.",
          "Dit is intussen veranderd. Herlaad om de stand te zien.")
        : localized("That did not go through. Please try again.", "Dat lukte niet. Probeer het opnieuw.");
    });
  };

  const renderItem = (item: ClaimWalkItem): HTMLLIElement => {
    const node = element("li", `player-claim-walk__item player-claim-walk__item--${item.claimStatus} ds-stack`);
    node.append(element("p", "ds-body player-claim-walk__line", claimWalkStatusLine(item)));
    if (item.notes.length > 0) {
      const thread = element("ol", "player-claim-walk__notes");
      for (const entry of item.notes) {
        const who = entry.role === "requester"
          ? localized("You", "Jij")
          : entry.authorName ?? localized("Reviewer", "Beoordelaar");
        const line = element("li", `player-claim-walk__note player-claim-walk__note--${entry.role}`);
        line.append(
          element("span", "player-claim-walk__note-meta", `${who} · ${day(entry.createdAtMs)}`),
          element("p", "player-claim-walk__note-body", entry.body),
        );
        thread.append(line);
      }
      node.append(thread);
    }
    const open = item.claimStatus === "requested" || item.claimStatus === "under_review";
    if (open && item.disputeStatus !== "open") {
      const { label, input } = noteField(
        lastQuestion(item) === null
          ? localized("Add something for the reviewer (optional)", "Iets toevoegen voor de beoordelaar (optioneel)")
          : localized("Your answer", "Je antwoord"),
        `claim_reply_${item.playerClaimId}`,
      );
      const send = button(localized("Send", "Versturen"), "secondary");
      send.addEventListener("click", () => {
        if (input.value.trim().length === 0) {
          status.textContent = localized("Write your answer first.", "Schrijf eerst je antwoord.");
          return;
        }
        run([send], localized("Sending…", "Versturen…"), () =>
          client.reply(item.playerClaimId, input.value, controller.signal));
      });
      node.append(label, send);
    }
    if ((open || item.claimStatus === "verified") && item.disputeStatus !== "open") {
      const start = button(
        item.claimStatus === "verified"
          ? localized("This is not me: unlink", "Dit ben ik niet: ontkoppelen")
          : localized("Withdraw this request", "Dit verzoek intrekken"),
        "quiet",
      );
      const confirmPanel = element("div", "player-claim-walk__confirm ds-stack");
      confirmPanel.hidden = true;
      confirmPanel.append(element("p", "ds-body-s", item.claimStatus === "verified"
        ? localized(
          `Unlinking keeps ${item.player.displayName}'s nights, rating and results with that Player; this account simply stops being them. Linking again needs a new review.`,
          `Ontkoppelen laat de avonden, rating en resultaten van ${item.player.displayName} bij die speler; dit account is die speler alleen niet meer. Opnieuw koppelen vraagt een nieuwe beoordeling.`,
        )
        : localized("Your request is closed and nobody needs to review it any more.",
          "Je verzoek wordt gesloten en niemand hoeft het nog te beoordelen.")));
      const { label, input } = noteField(localized("Why (optional)", "Waarom (optioneel)"), `claim_release_${item.playerClaimId}`);
      const confirm = button(item.claimStatus === "verified"
        ? localized(`Unlink ${item.player.displayName}`, `${item.player.displayName} ontkoppelen`)
        : localized("Withdraw", "Intrekken"), "primary");
      const cancel = button(localized("Cancel", "Annuleren"), "quiet");
      start.addEventListener("click", () => { confirmPanel.hidden = false; start.hidden = true; });
      cancel.addEventListener("click", () => { confirmPanel.hidden = true; start.hidden = false; });
      confirm.addEventListener("click", () => {
        run([confirm, cancel], localized("Unlinking…", "Ontkoppelen…"), () =>
          client.release(item.playerClaimId, input.value, controller.signal));
      });
      const actions = element("div", "player-claim-walk__actions");
      actions.append(confirm, cancel);
      confirmPanel.append(label, actions);
      node.append(start, confirmPanel);
    }
    if (item.claimStatus === "rejected") {
      node.append(element("p", "ds-body-s player-claim-walk__hint", localized(
        "If this is you after all, ask again and tell the reviewer where and when you played.",
        "Ben jij het toch? Vraag het opnieuw en vertel de beoordelaar waar en wanneer je speelde.",
      )));
    }
    return node;
  };

  const load = async (): Promise<readonly ClaimWalkItem[]> => {
    const current = ++operation;
    try {
      const items = await client.listMine(controller.signal);
      if (disposed || current !== operation) { return items; }
      clear(list);
      const nowMs = Date.now();
      const shown = items.filter((item) =>
        item.claimStatus === "requested" || item.claimStatus === "under_review" ||
        item.claimStatus === "verified" || nowMs - item.updatedAtMs <= closedVisibleMs);
      for (const item of shown) { list.append(renderItem(item)); }
      container.hidden = shown.length === 0;
      return items;
    } catch {
      if (!disposed && current === operation) {
        status.textContent = localized("Your link requests could not be loaded.", "Je koppelverzoeken konden niet geladen worden.");
      }
      return [];
    }
  };

  const ready = load();
  return {
    container,
    ready,
    unmount(): void {
      if (disposed) { return; }
      disposed = true;
      operation += 1;
      controller.abort();
      if (container.parentNode === root) { root.removeChild(container); }
    },
  };
}
