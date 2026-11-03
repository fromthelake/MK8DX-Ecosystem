// Who was behind which name on the console.
//
// The binder works this out from the races themselves and is right almost
// every time - it lines the recording up with the rated history on finishing
// order, end points and running totals, and 34 of 35 sections agree
// completely. Almost is the problem. In TN07 the screen said "Wanda" for the
// 242 points the rated history credits to Tobias: the account was Wanda's, the
// driver was not. No arithmetic finds that. Somebody who was in the room does.
//
// So this screen shows what the binder concluded together with the evidence it
// used, and lets a person disagree. A corrected link is marked as such and the
// next rebuild of the history leaves it alone; handing it back to the binder is
// one button, because a correction can itself be the mistake.

import {
  createObservedIdentityClient,
  ObservedIdentityClientError,
  type ObservedIdentityClient,
  type ObservedIdentityLink,
  type ObservedIdentityOverview,
  type ObservedIdentityPlayer,
} from "./observed-identity-client.js";
import { localized } from "./product-language.js";

export type MountedObservedIdentitySection = Readonly<{
  container: HTMLElement;
  ready: Promise<void>;
  unmount(): void;
}>;

function clear(element: HTMLElement): void {
  while (element.firstChild !== null) { element.removeChild(element.firstChild); }
}

/**
 * Why the binder believes this pairing, in one line. A reviewer should be able
 * to see the reasoning without being asked to trust it.
 */
export function evidenceOf(link: ObservedIdentityLink): string {
  const parts: string[] = [];
  if (link.orderAgreement !== null) {
    parts.push(localized(
      `${Math.round(link.orderAgreement * 100)}% of finishes agree`,
      `${Math.round(link.orderAgreement * 100)}% van de finishes klopt`,
    ));
  }
  if (link.videoPoints !== null && link.historyPoints !== null) {
    parts.push(link.videoPoints === link.historyPoints
      ? localized(
        `points match at ${link.videoPoints}`,
        `punten sluiten op ${link.videoPoints}`)
      : localized(
        `points ${link.videoPoints} vs ${link.historyPoints}`,
        `punten ${link.videoPoints} tegen ${link.historyPoints}`));
  }
  parts.push(localized(
    `${link.placements} races`, `${link.placements} races`));
  return parts.join(" · ");
}

/** A pairing worth a second look: the two accounts of it do not agree. */
export function needsReview(link: ObservedIdentityLink): boolean {
  if (link.decisionSource === "manual") { return false; }
  if (link.orderAgreement !== null && link.orderAgreement < 1) { return true; }
  return link.videoPoints !== null && link.historyPoints !== null &&
    link.videoPoints !== link.historyPoints;
}

export function mountAdministratorObservedIdentitySection(
  root: HTMLElement,
  client: ObservedIdentityClient = createObservedIdentityClient(),
): MountedObservedIdentitySection {
  const document = root.ownerDocument;
  const controller = new AbortController();
  let disposed = false;
  let overview: ObservedIdentityOverview = { links: [], players: [] };
  let onlyReview = false;
  let search = "";

  const container = document.createElement("section");
  container.className = "observed-identities ds-panel";
  container.setAttribute("aria-labelledby", "observed-identities-heading");
  const heading = document.createElement("h2");
  heading.id = "observed-identities-heading";
  heading.className = "ds-panel__title";
  heading.textContent = localized(
    "Names on screen and who was driving",
    "Namen op het scherm en wie er reed",
  );
  const explain = document.createElement("p");
  explain.className = "observed-identities__explain";
  explain.textContent = localized(
    "Derived from the recordings and the rated history. A matching name is " +
    "not proof: the same account was sometimes handed to somebody else.",
    "Afgeleid uit de opnames en de beoordeelde historie. Een kloppende naam " +
    "is geen bewijs: hetzelfde account werd soms door iemand anders gebruikt.",
  );
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  status.className = "observed-identities__status";
  status.textContent = localized("Loading…", "Laden…");
  const controls = document.createElement("div");
  controls.className = "observed-identities__controls";
  const content = document.createElement("div");
  container.append(heading, explain, status, controls, content);
  root.append(container);

  const filterField = document.createElement("input");
  filterField.type = "search";
  filterField.className = "observed-identities__search";
  filterField.setAttribute("aria-label", localized(
    "Filter by name or player", "Filter op naam of speler"));
  filterField.placeholder = localized(
    "Filter by name or player…", "Filter op naam of speler…");
  filterField.addEventListener("input", () => {
    search = filterField.value.trim().toLowerCase();
    render();
  });
  const reviewToggle = document.createElement("label");
  reviewToggle.className = "observed-identities__toggle";
  const reviewBox = document.createElement("input");
  reviewBox.type = "checkbox";
  reviewBox.addEventListener("change", () => {
    onlyReview = reviewBox.checked;
    render();
  });
  const reviewLabel = document.createElement("span");
  reviewLabel.textContent = localized(
    "Only the ones that disagree", "Alleen de afwijkende");
  reviewToggle.append(reviewBox, reviewLabel);
  controls.append(filterField, reviewToggle);

  const act = async (work: () => Promise<void>, done: string): Promise<void> => {
    try {
      await work();
      if (disposed) { return; }
      status.textContent = done;
      await load();
    } catch (error) {
      if (disposed) { return; }
      const code = error instanceof ObservedIdentityClientError
        ? error.code : "unavailable";
      status.textContent = code === "not_authorized"
        ? localized(
          "This is an administrator surface.",
          "Dit is een administratorscherm.")
        : code === "not_found"
          ? localized(
            "That name is no longer in the history; reload the page.",
            "Die naam staat niet meer in de historie; herlaad de pagina.")
          : code === "invalid_input"
            ? localized(
              "That player was not accepted.",
              "Die speler is niet geaccepteerd.")
            : localized(
              "Saving is temporarily unavailable.",
              "Opslaan is tijdelijk niet mogelijk.");
    }
  };

  const renderRow = (
    link: ObservedIdentityLink, players: readonly ObservedIdentityPlayer[],
  ): HTMLElement => {
    const row = document.createElement("li");
    row.className = link.decisionSource === "manual"
      ? "observed-identity-row observed-identity-row--manual"
      : needsReview(link)
        ? "observed-identity-row observed-identity-row--review"
        : "observed-identity-row";

    const where = document.createElement("p");
    where.className = "observed-identity-row__where";
    where.textContent = `TN${link.tournamentNumber} · ${link.sectionName}`;

    const name = document.createElement("p");
    name.className = "observed-identity-row__name";
    name.textContent = link.observedName;

    const evidence = document.createElement("p");
    evidence.className = "observed-identity-row__evidence";
    evidence.textContent = evidenceOf(link);

    const choose = document.createElement("select");
    choose.className = "observed-identity-row__choose";
    choose.setAttribute("aria-label", localized(
      `Player behind ${link.observedName} in TN${link.tournamentNumber} ${link.sectionName}`,
      `Speler achter ${link.observedName} in TN${link.tournamentNumber} ${link.sectionName}`,
    ));
    for (const player of players) {
      const option = document.createElement("option");
      option.value = player.playerId;
      option.textContent = player.displayName;
      if (player.playerId === link.playerId) { option.selected = true; }
      choose.append(option);
    }
    choose.addEventListener("change", () => {
      const chosen = choose.value;
      if (chosen === link.playerId) { return; }
      void act(
        () => client.assign(link.linkId, chosen, null, controller.signal),
        localized(
          `${link.observedName} in TN${link.tournamentNumber} is now linked ` +
          "to a different player.",
          `${link.observedName} in TN${link.tournamentNumber} is nu aan een ` +
          "andere speler gekoppeld.",
        ),
      );
    });

    row.append(where, name, evidence, choose);

    if (link.decisionSource === "manual") {
      const mark = document.createElement("p");
      mark.className = "observed-identity-row__manual";
      mark.textContent = link.note === null
        ? localized("Corrected by hand", "Handmatig gecorrigeerd")
        : localized(
          `Corrected by hand — ${link.note}`,
          `Handmatig gecorrigeerd — ${link.note}`);
      const undo = document.createElement("button");
      undo.type = "button";
      undo.className = "observed-identity-row__undo";
      undo.textContent = localized(
        "Hand back to the binder", "Terug naar de automaat");
      undo.addEventListener("click", () => {
        void act(
          () => client.restore(link.linkId, controller.signal),
          localized(
            `${link.observedName} will be derived again on the next rebuild.`,
            `${link.observedName} wordt bij de volgende herbouw opnieuw afgeleid.`,
          ),
        );
      });
      row.append(mark, undo);
    }
    return row;
  };

  function render(): void {
    clear(content);
    const matching = overview.links.filter((link) => {
      if (onlyReview && !needsReview(link)) { return false; }
      if (search.length === 0) { return true; }
      return link.observedName.toLowerCase().includes(search) ||
        link.playerName.toLowerCase().includes(search);
    });
    if (overview.links.length === 0) {
      const empty = document.createElement("p");
      empty.className = "observed-identities__empty";
      empty.textContent = localized(
        "No recording has been linked to the history yet.",
        "Er is nog geen opname aan de historie gekoppeld.",
      );
      content.append(empty);
      return;
    }
    const count = document.createElement("p");
    count.className = "observed-identities__count";
    const review = overview.links.filter(needsReview).length;
    const manual = overview.links.filter(
      (link) => link.decisionSource === "manual").length;
    count.textContent = localized(
      `${matching.length} of ${overview.links.length} links · ` +
      `${review} disagree · ${manual} corrected by hand`,
      `${matching.length} van ${overview.links.length} koppelingen · ` +
      `${review} wijken af · ${manual} handmatig gecorrigeerd`,
    );
    const list = document.createElement("ul");
    list.className = "observed-identities__list";
    for (const link of matching) {
      list.append(renderRow(link, overview.players));
    }
    content.append(count, list);
  }

  async function load(): Promise<void> {
    try {
      overview = await client.overview(controller.signal);
      if (disposed) { return; }
      render();
    } catch (error) {
      if (disposed) { return; }
      const code = error instanceof ObservedIdentityClientError
        ? error.code : "unavailable";
      status.textContent = code === "not_authorized"
        ? localized(
          "This is an administrator surface.",
          "Dit is een administratorscherm.")
        : localized(
          "The mapping is temporarily unavailable.",
          "De koppeling is tijdelijk niet beschikbaar.");
    }
  }

  const ready = load().then(() => {
    if (disposed || status.textContent?.includes("…") !== true) { return; }
    status.textContent = "";
  });

  return {
    container,
    ready,
    unmount() {
      if (disposed) { return; }
      disposed = true;
      controller.abort();
      if (container.parentNode === root) { root.removeChild(container); }
    },
  };
}
