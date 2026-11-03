import {
  createClaimWalkClient,
  type ClaimNote,
  type ClaimPlayerRef,
  type ClaimReviewCard,
  type ClaimReviewClient,
  type LinkedClaimRow,
  type ReviewAction,
  type RevokeReason,
} from "./claim-walk-client.js";
import { PlayerClaimClientError } from "./player-claim-client.js";
import { localized, productLocaleTag } from "./product-language.js";

export type MountedAdministratorClaimReviewSection = Readonly<{
  container: HTMLElement;
  ready: Promise<void>;
  unmount(): void;
}>;

export type ClaimReviewSectionOptions = Readonly<{
  /** Directors see the section only when something is theirs to review (Settings). */
  hideWhenEmpty?: boolean;
}>;

function clear(element: HTMLElement): void {
  while (element.firstChild !== null) { element.removeChild(element.firstChild); }
}

function day(ms: number): string {
  return new Date(ms).toLocaleDateString(productLocaleTag(), {
    day: "numeric", month: "short", year: "numeric",
  });
}

function playerLabel(player: ClaimPlayerRef): string {
  return `${player.displayName} (@${player.username})`;
}

const revokeReasons: readonly Readonly<{ code: RevokeReason; en: string; nl: string }>[] = [
  { code: "linked_by_mistake", en: "Linked by mistake", nl: "Per vergissing gekoppeld" },
  { code: "person_asked", en: "The person asked for it", nl: "De persoon vroeg erom" },
  { code: "account_misuse", en: "The account is misused", nl: "Het account wordt misbruikt" },
];

/**
 * The reviewer's side of the claim walk (ADR-0216): one card per request that says who asks, what
 * is asked for, what approving changes and what stands in the way, with plain buttons. Linked
 * Players can be unlinked with a reason. Administrators review everything; a Director the Players
 * from their own Tournaments.
 */
export function mountAdministratorClaimReviewSection(
  root: HTMLElement,
  client: ClaimReviewClient = createClaimWalkClient(),
  options: ClaimReviewSectionOptions = {},
): MountedAdministratorClaimReviewSection {
  const document = root.ownerDocument;
  const controller = new AbortController();
  let disposed = false;
  let operation = 0;
  const container = document.createElement("section");
  container.className = "administrator-claim-review ds-panel";
  container.id = "claim-reviews";
  container.setAttribute("aria-labelledby", "administrator-claim-review-heading");
  const heading = document.createElement("h2");
  heading.id = "administrator-claim-review-heading";
  heading.className = "ds-panel__title";
  heading.textContent = localized("Player link requests", "Koppelverzoeken");
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  status.textContent = localized("Checking link requests…", "Koppelverzoeken ophalen…");
  const content = document.createElement("div");
  content.className = "ds-stack";
  container.append(heading, status, content);
  if (options.hideWhenEmpty === true) { container.hidden = true; }
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

  const conversation = (notes: readonly ClaimNote[]): HTMLElement | null => {
    if (notes.length === 0) { return null; }
    const list = element("ol", "administrator-claim-review__notes");
    for (const entry of notes) {
      const item = element("li", `administrator-claim-review__note administrator-claim-review__note--${entry.role}`);
      const who = entry.role === "requester"
        ? localized("The person asking", "De aanvrager")
        : entry.authorName ?? localized("A reviewer", "Een beoordelaar");
      item.append(
        element("span", "administrator-claim-review__note-meta", `${who} · ${day(entry.createdAtMs)}`),
        element("p", "administrator-claim-review__note-body", entry.body),
      );
      list.append(item);
    }
    return list;
  };

  const noteField = (labelText: string, name: string): Readonly<{ label: HTMLLabelElement; input: HTMLTextAreaElement }> => {
    const label = element("label", "ds-field administrator-claim-review__field");
    const caption = element("span", "", labelText);
    const input = element("textarea", "ds-input administrator-claim-review__note-input");
    input.name = name;
    input.maxLength = 500;
    input.rows = 2;
    label.append(caption, input);
    return { label, input };
  };

  const run = (
    controls: readonly HTMLButtonElement[],
    message: string,
    work: () => Promise<void>,
  ): void => {
    if (disposed) { return; }
    operation += 1;
    const current = operation;
    for (const control of controls) { control.disabled = true; }
    status.textContent = message;
    void work().then(() => {
      if (!disposed && current === operation) { return load(); }
    }).catch((error: unknown) => {
      if (disposed || current !== operation) { return; }
      for (const control of controls) { control.disabled = false; }
      if (error instanceof PlayerClaimClientError && error.code === "conflict") {
        status.textContent = localized(
          "This request changed in the meantime. Showing where it stands now…",
          "Dit verzoek is intussen veranderd. Je ziet nu de actuele stand…",
        );
        void load();
        return;
      }
      status.textContent = error instanceof PlayerClaimClientError && error.code === "invalid_input"
        ? localized("Write a question for the person first.", "Schrijf eerst een vraag aan de persoon.")
        : localized("That did not go through. Please try again.", "Dat lukte niet. Probeer het opnieuw.");
    });
  };

  const decide = (
    card: ClaimReviewCard,
    action: ReviewAction,
    note: string,
    controls: readonly HTMLButtonElement[],
    message: string,
  ): void => {
    run(controls, message, async () => {
      // Approve and decline start the review themselves; the reviewer presses one button.
      if ((action === "verify" || action === "reject") && card.claimStatus === "requested") {
        await client.review(card.playerClaimId, "start_review", {}, controller.signal);
      }
      await client.review(card.playerClaimId, action, { note }, controller.signal);
    });
  };

  const renderCard = (card: ClaimReviewCard): HTMLLIElement => {
    const item = element("li", "administrator-claim-review__item ds-stack");
    const name = card.player.displayName;
    item.append(element("h3", "ds-title", localized(
      `Somebody asks to be linked to ${playerLabel(card.player)}`,
      `Iemand wil gekoppeld worden aan ${playerLabel(card.player)}`,
    )));
    item.append(element("p", "ds-body-s administrator-claim-review__meta", [
      localized(`Asked on ${day(card.requestedAtMs)}`, `Gevraagd op ${day(card.requestedAtMs)}`),
      card.claimStatus === "under_review" ? localized("under review", "in behandeling") : null,
      card.reviewerRole === "director"
        ? localized("you review this as Director of their nights", "jij beoordeelt dit als Directeur van hun avonden")
        : null,
    ].filter((part): part is string => part !== null).join(" · ")));

    const facts = element("dl", "administrator-claim-review__facts");
    const fact = (term: string, value: string): void => {
      facts.append(element("dt", "", term), element("dd", "", value));
    };
    const owned = card.requester.verifiedPlayers;
    fact(localized("Who asks", "Wie vraagt"), [
      localized(`An account created on ${day(card.requester.accountCreatedAtMs)}`,
        `Een account aangemaakt op ${day(card.requester.accountCreatedAtMs)}`),
      owned.length === 0
        ? localized("owns no Player yet", "heeft nog geen speler")
        : localized(`already owns ${owned.map(playerLabel).join(", ")}`, `heeft al ${owned.map(playerLabel).join(", ")}`),
    ].join("; "));
    const player = card.player;
    const nightParts = [
      localized(`${player.tournamentNights} Tournament night${player.tournamentNights === 1 ? "" : "s"}`,
        `${player.tournamentNights} toernooiavond${player.tournamentNights === 1 ? "" : "en"}`),
      player.lastNightName === null ? null : localized(
        `last: ${player.lastNightName}${player.lastNightDate === null ? "" : ` (${player.lastNightDate})`}`,
        `laatste: ${player.lastNightName}${player.lastNightDate === null ? "" : ` (${player.lastNightDate})`}`,
      ),
      player.directorNames.length === 0 ? null
        : localized(`Director: ${player.directorNames.join(", ")}`, `Directeur: ${player.directorNames.join(", ")}`),
      player.conservativeRating === null ? null
        : localized(`rating ${player.conservativeRating.toFixed(1)}`, `rating ${player.conservativeRating.toFixed(1)}`),
      localized(`${player.publishedTimeTrials} published Time Trial${player.publishedTimeTrials === 1 ? "" : "s"}`,
        `${player.publishedTimeTrials} gepubliceerde tijdrit${player.publishedTimeTrials === 1 ? "" : "ten"}`),
    ].filter((part): part is string => part !== null);
    fact(localized("What is asked for", "Waar om gevraagd wordt"), `${name}: ${nightParts.join(" · ")}`);
    fact(localized("What approving changes", "Wat goedkeuren verandert"), localized(
      `${name}'s nights, rating and results are linked to this account. Nothing is merged, and it can be undone.`,
      `De avonden, rating en resultaten van ${name} worden aan dit account gekoppeld. Er wordt niets samengevoegd en het kan ongedaan worden gemaakt.`,
    ));
    item.append(facts);
    const profile = element("a", "tt-auth__link", localized(`Open ${name}'s profile`, `Profiel van ${name} openen`));
    profile.href = `/?player=${encodeURIComponent(player.playerId)}`;
    item.append(profile);

    const blockers: string[] = [];
    if (card.conflicts.playerAlreadyLinked) {
      blockers.push(localized(`${name} is already linked to another account.`, `${name} is al aan een ander account gekoppeld.`));
    }
    if (card.conflicts.sharedTournament !== null) {
      blockers.push(localized(
        `This account already owns a Player who raced against ${name} in ${card.conflicts.sharedTournament}, so they are two people.`,
        `Dit account heeft al een speler die in ${card.conflicts.sharedTournament} tegen ${name} reed; het zijn dus twee mensen.`,
      ));
    }
    if (player.otherOpenClaims > 0) {
      item.append(element("p", "ds-body-s administrator-claim-review__hint", localized(
        `${player.otherOpenClaims} other request${player.otherOpenClaims === 1 ? "" : "s"} for ${name} wait${player.otherOpenClaims === 1 ? "s" : ""} too.`,
        `Er ${player.otherOpenClaims === 1 ? "wacht nog 1 ander verzoek" : `wachten nog ${player.otherOpenClaims} andere verzoeken`} voor ${name}.`,
      )));
    }
    for (const blocker of blockers) {
      const warning = element("p", "administrator-claim-review__conflict", blocker);
      warning.setAttribute("role", "note");
      item.append(warning);
    }
    const thread = conversation(card.notes);
    if (thread !== null) { item.append(thread); }

    if (card.disputeStatus === "open") {
      if (card.reviewerRole === "administrator") {
        const resolve = button(localized("Resolve dispute", "Geschil afhandelen"), "secondary");
        resolve.addEventListener("click", () => {
          run([resolve], localized("Resolving…", "Afhandelen…"), () =>
            client.review(card.playerClaimId, "resolve_dispute", { reasonCode: "dispute_resolved" }, controller.signal));
        });
        item.append(resolve);
      } else {
        item.append(element("p", "ds-body-s", localized(
          "This request is disputed; an administrator handles it.",
          "Over dit verzoek loopt een geschil; een beheerder handelt het af.",
        )));
      }
      return item;
    }

    const { label, input } = noteField(
      localized("Note to the person (optional; needed for a question)", "Bericht aan de persoon (optioneel; nodig bij een vraag)"),
      `claim_note_${card.playerClaimId}`,
    );
    const approve = button(localized("Approve: this is them", "Goedkeuren: dit zijn ze"), "primary");
    const decline = button(localized("Not this person", "Niet deze persoon"), "secondary");
    const ask = button(localized("Ask for more information", "Om meer informatie vragen"), "quiet");
    approve.disabled = blockers.length > 0;
    const controls = [approve, decline, ask];
    approve.addEventListener("click", () => decide(card, "verify", input.value, controls,
      localized("Approving…", "Goedkeuren…")));
    decline.addEventListener("click", () => decide(card, "reject", input.value, controls,
      localized("Declining…", "Afwijzen…")));
    ask.addEventListener("click", () => {
      if (input.value.trim().length === 0) {
        status.textContent = localized("Write a question for the person first.", "Schrijf eerst een vraag aan de persoon.");
        input.focus?.();
        return;
      }
      decide(card, "request_information", input.value, controls, localized("Sending your question…", "Je vraag versturen…"));
    });
    const actions = element("div", "administrator-claim-review__actions");
    actions.append(approve, decline, ask);
    item.append(label, actions);
    return item;
  };

  const renderLinked = (rows: readonly LinkedClaimRow[]): HTMLElement => {
    const group = element("section", "administrator-claim-review__linked ds-stack");
    group.append(element("h3", "ds-title", localized("Linked Players", "Gekoppelde spelers")));
    group.append(element("p", "ds-body-s", localized(
      "Unlinking keeps every night, rating and result with the Player; only the account loses the link and is told why.",
      "Ontkoppelen laat alle avonden, rating en resultaten bij de speler; alleen het account verliest de koppeling en hoort waarom.",
    )));
    const filterLabel = element("label", "ds-field");
    filterLabel.append(element("span", "", localized("Find a Player", "Speler zoeken")));
    const filter = element("input", "ds-input");
    filter.type = "search";
    filter.name = "linked_player_filter";
    filterLabel.append(filter);
    const list = element("ul", "administrator-claim-review__linked-list");
    const items: Array<Readonly<{ row: LinkedClaimRow; node: HTMLLIElement }>> = [];
    for (const row of rows) {
      const node = element("li", "administrator-claim-review__linked-item");
      const summary = element("p", "ds-body-s", [
        playerLabel(row.player),
        localized(`linked ${day(row.linkedAtMs)}`, `gekoppeld ${day(row.linkedAtMs)}`),
        row.accountPlayers.length === 0 ? null
          : localized(`same account: ${row.accountPlayers.map(playerLabel).join(", ")}`,
            `zelfde account: ${row.accountPlayers.map(playerLabel).join(", ")}`),
      ].filter((part): part is string => part !== null).join(" · "));
      const open = button(localized("Unlink…", "Ontkoppelen…"), "quiet");
      const panel = element("div", "administrator-claim-review__revoke ds-stack");
      panel.hidden = true;
      const reasons = element("fieldset", "ds-settings-choices");
      reasons.append(element("legend", "", localized("Why?", "Waarom?")));
      const radios: HTMLInputElement[] = [];
      for (const [index, reason] of revokeReasons.entries()) {
        const choice = element("label", "ds-settings-choice");
        const radio = element("input", "");
        radio.type = "radio";
        radio.name = `revoke_reason_${row.playerClaimId}`;
        radio.value = reason.code;
        radio.checked = index === 0;
        radios.push(radio);
        choice.append(radio, element("span", "", localized(reason.en, reason.nl)));
        reasons.append(choice);
      }
      const { label, input } = noteField(localized("Note to the person (optional)", "Bericht aan de persoon (optioneel)"),
        `revoke_note_${row.playerClaimId}`);
      const confirm = button(localized(`Unlink ${row.player.displayName}`, `${row.player.displayName} ontkoppelen`), "primary");
      const cancel = button(localized("Cancel", "Annuleren"), "quiet");
      open.addEventListener("click", () => { panel.hidden = false; open.hidden = true; });
      cancel.addEventListener("click", () => { panel.hidden = true; open.hidden = false; });
      confirm.addEventListener("click", () => {
        const reasonCode = (radios.find((radio) => radio.checked)?.value ?? "linked_by_mistake") as RevokeReason;
        run([confirm, cancel], localized("Unlinking…", "Ontkoppelen…"), () =>
          client.review(row.playerClaimId, "revoke", { reasonCode, note: input.value }, controller.signal));
      });
      const actions = element("div", "administrator-claim-review__actions");
      actions.append(confirm, cancel);
      panel.append(reasons, label, actions);
      node.append(summary, open, panel);
      items.push({ row, node });
      list.append(node);
    }
    filter.addEventListener("input", () => {
      const query = filter.value.trim().toLowerCase();
      for (const { row, node } of items) {
        node.hidden = query.length > 0 &&
          !`${row.player.displayName} ${row.player.username}`.toLowerCase().includes(query);
      }
    });
    group.append(filterLabel, list);
    return group;
  };

  const load = async (): Promise<void> => {
    const current = ++operation;
    try {
      const queue = await client.listReviews(controller.signal);
      if (disposed || current !== operation) { return; }
      clear(content);
      const nothing = queue.open.length === 0 && queue.linked.length === 0;
      if (options.hideWhenEmpty === true) { container.hidden = nothing; }
      status.textContent = queue.open.length === 0
        ? localized("No link requests are waiting.", "Er wachten geen koppelverzoeken.")
        : localized(
          `${queue.open.length} link request${queue.open.length === 1 ? "" : "s"} waiting.`,
          `${queue.open.length} koppelverzoek${queue.open.length === 1 ? "" : "en"} wacht${queue.open.length === 1 ? "" : "en"}.`,
        );
      if (queue.open.length > 0) {
        const list = element("ol", "administrator-claim-review__list ds-stack");
        for (const card of queue.open) { list.append(renderCard(card)); }
        content.append(list);
      }
      if (queue.linked.length > 0) { content.append(renderLinked(queue.linked)); }
    } catch (error) {
      if (disposed || current !== operation) { return; }
      if (error instanceof PlayerClaimClientError &&
          (error.code === "not_authorized" || error.code === "not_authenticated")) {
        if (container.parentNode === root) { root.removeChild(container); }
        return;
      }
      status.textContent = localized(
        "Link requests are temporarily unavailable.",
        "Koppelverzoeken zijn tijdelijk niet beschikbaar.",
      );
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
