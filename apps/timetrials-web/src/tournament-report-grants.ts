// Who may write the night's report. The capability is one per account and
// covers every Tournament; an administrator hands it out and takes it back
// on Step 10, next to the button it unlocks. The accounts offered are the
// Directors the console already knows, by name, so nobody has to type an id.

import { localized } from "./product-language.js";
import type { createTournamentReportClient, TournamentReportGrant } from "./tournament-report-client.js";

export type ReportGrantAccount = Readonly<{ userAccountId: string; displayName: string }>;

export function renderReportGrants(
  document: Document,
  client: ReturnType<typeof createTournamentReportClient>,
  accounts: () => Promise<readonly ReportGrantAccount[]>,
  signal: AbortSignal,
): HTMLElement {
  const block = document.createElement("div");
  block.className = "tournament-op__grants";
  const heading = document.createElement("h4");
  heading.textContent = localized("Who may write the report", "Wie het verslag mag schrijven");
  const list = document.createElement("ul");
  list.className = "tournament-op__grants-list";
  const form = document.createElement("form");
  form.className = "tournament-op__grants-form";
  const select = document.createElement("select");
  select.setAttribute("aria-label", localized("Account to grant", "Account om toe te kennen"));
  const grant = document.createElement("button");
  grant.type = "submit";
  grant.className = "tt-auth__button";
  grant.textContent = localized("Grant writing access", "Schrijfrecht toekennen");
  // One line under the button; what it means in full is in the fold under it,
  // the same way the rest of Step 10 reads since the owner called it a wall.
  const caption = document.createElement("p");
  caption.className = "tournament-op__hint tournament-op__caption";
  caption.textContent = localized(
    "Lets the chosen account write and publish reports.",
    "Geeft het gekozen account het recht verslagen te schrijven en te publiceren.",
  );
  const detail = document.createElement("details");
  detail.className = "tournament-op__detail";
  const detailHead = document.createElement("summary");
  detailHead.textContent = localized("What happens exactly?", "Wat gebeurt er precies?");
  const detailBody = document.createElement("p");
  detailBody.className = "tournament-op__hint tournament-op__caption";
  detailBody.textContent = localized(
    "Pressing this lets the chosen account write, save and publish reports, for every Tournament. It can be revoked here at any time.",
    "Drukken geeft het gekozen account het recht om verslagen te schrijven, op te slaan en te publiceren, voor alle toernooien. Intrekken kan hier altijd weer.",
  );
  detail.append(detailHead, detailBody);
  const note = document.createElement("p");
  note.className = "tournament-op__hint";
  note.setAttribute("role", "status");
  form.append(select, grant);
  block.append(heading, list, form, caption, detail, note);

  let known: readonly ReportGrantAccount[] = [];
  const nameOf = (userAccountId: string): string => known.find((account) => account.userAccountId === userAccountId)?.displayName ?? userAccountId;
  const fail = (error: unknown): void => { note.textContent = error instanceof Error ? error.message : localized("The access list is unavailable.", "De toegangslijst is niet beschikbaar."); };

  const draw = (grants: readonly TournamentReportGrant[]): void => {
    const active = grants.filter((entry) => entry.status === "active");
    list.replaceChildren(...(active.length === 0
      ? [(() => { const item = document.createElement("li"); item.textContent = localized("Nobody yet. Administrators can always write.", "Nog niemand. Beheerders kunnen altijd schrijven."); return item; })()]
      : active.map((entry) => {
        const item = document.createElement("li");
        item.textContent = nameOf(entry.userAccountId);
        const revoke = document.createElement("button");
        revoke.type = "button";
        revoke.className = "tt-auth__button";
        revoke.textContent = localized("Revoke", "Intrekken");
        revoke.addEventListener("click", () => { void client.revoke(entry.userAccountId, signal).then(load, fail); });
        item.append(" ", revoke);
        return item;
      })));
    const granted = new Set(active.map((entry) => entry.userAccountId));
    select.replaceChildren(...known.filter((account) => !granted.has(account.userAccountId)).map((account) => {
      const option = document.createElement("option");
      option.value = account.userAccountId;
      option.textContent = account.displayName;
      return option;
    }));
    const empty = select.options.length === 0;
    select.disabled = empty;
    grant.disabled = empty;
    if (empty) { note.textContent = localized("Every known Director already has it.", "Elke bekende directeur heeft het al."); }
  };
  const load = (): void => {
    void Promise.all([client.listGrants(signal), accounts().catch(() => [] as readonly ReportGrantAccount[])])
      .then(([grants, listed]) => { known = listed; note.textContent = ""; draw(grants); }, fail);
  };
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (select.value.length === 0) { return; }
    const chosen = nameOf(select.value);
    void client.grant(select.value, signal).then(() => {
      load();
      note.textContent = localized(`${chosen} may now write the report.`, `${chosen} mag nu het verslag schrijven.`);
    }, fail);
  });
  load();
  return block;
}
