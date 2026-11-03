import {
  AdministratorOverviewClientError,
  createAdministratorOverviewClient,
  type AdministratorOverview,
  type AdministratorOverviewClient,
} from "./administrator-overview-client.js";
import { localized } from "./product-language.js";

export type MountedAdministratorOverviewSection = Readonly<{
  container: HTMLElement;
  ready: Promise<void>;
  unmount(): void;
}>;

/**
 * The first thing an administrator sees: how many people are here, how many
 * were around lately, and what is waiting. Numbers only; every one of them
 * has a sentence saying what it counts, because "active" means one thing
 * here and the owner should not have to guess which.
 */
export function mountAdministratorOverviewSection(
  root: HTMLElement,
  options: Readonly<{
    client?: AdministratorOverviewClient;
    /** Opens the Claims section, where the waiting link requests are. */
    onOpenClaims?: () => void;
  }> = {},
): MountedAdministratorOverviewSection {
  const document = root.ownerDocument;
  const client = options.client ?? createAdministratorOverviewClient();
  const controller = new AbortController();
  let disposed = false;

  const container = document.createElement("section");
  container.className = "admin-overview ds-panel";
  const heading = document.createElement("h2");
  heading.className = "ds-panel__title";
  heading.textContent = localized("Overview", "Overzicht");
  const status = document.createElement("p");
  status.className = "admin-overview__status";
  status.setAttribute("role", "status");
  status.textContent = localized("Counting…", "Tellen…");
  const grid = document.createElement("div");
  grid.className = "admin-overview__grid ds-stat-grid";
  container.append(heading, status, grid);
  root.append(container);

  const tile = (
    value: number, label: string, note: string, extra?: HTMLElement,
  ): HTMLElement => {
    const item = document.createElement("article");
    item.className = "admin-overview__tile ds-stat";
    const figure = document.createElement("p");
    figure.className = "admin-overview__figure ds-stat__value";
    figure.textContent = String(value);
    const name = document.createElement("h3");
    name.className = "admin-overview__label ds-stat__label";
    name.textContent = label;
    const detail = document.createElement("p");
    detail.className = "admin-overview__note ds-stat__note";
    detail.textContent = note;
    item.append(figure, name, detail);
    if (extra !== undefined) { item.append(extra); }
    return item;
  };

  const activity = (
    title: string, window: AdministratorOverview["active"]["last24h"],
  ): HTMLElement => {
    const item = document.createElement("article");
    item.className = "admin-overview__tile admin-overview__tile--activity ds-stat";
    const name = document.createElement("h3");
    name.className = "admin-overview__label ds-stat__label";
    name.textContent = title;
    const figure = document.createElement("p");
    figure.className = "admin-overview__figure ds-stat__value";
    figure.textContent = String(window.signedIn);
    const detail = document.createElement("p");
    detail.className = "admin-overview__note ds-stat__note";
    detail.textContent = localized(
      `signed in · ${window.submitted} submitted a Time Trial`,
      `aangemeld · ${window.submitted} stuurde een Time Trial in`,
    );
    item.append(figure, name, detail);
    return item;
  };

  const render = (overview: AdministratorOverview): void => {
    while (grid.firstChild !== null) { grid.removeChild(grid.firstChild); }
    const pending = document.createElement("button");
    pending.type = "button";
    pending.className = "tt-auth__link admin-overview__link";
    pending.textContent = localized("Review the link requests", "Bekijk de koppelverzoeken");
    pending.addEventListener("click", () => { options.onOpenClaims?.(); });
    grid.append(
      tile(
        overview.pending.playerClaims,
        localized("Link requests waiting", "Koppelverzoeken in de wacht"),
        localized(
          "Somebody asked to be linked to an existing Player and needs a decision.",
          "Iemand vroeg om gekoppeld te worden aan een bestaande speler en wacht op een besluit.",
        ),
        overview.pending.playerClaims > 0 && options.onOpenClaims !== undefined
          ? pending
          : undefined,
      ),
      tile(
        overview.registered.signInIdentities,
        localized("Registered", "Geregistreerd"),
        localized(
          `people who have signed in at least once · ${overview.registered.accounts} active accounts`,
          `mensen die minstens één keer zijn aangemeld · ${overview.registered.accounts} actieve accounts`,
        ),
      ),
      tile(
        overview.registered.players,
        localized("Players", "Spelers"),
        localized(
          `${overview.registered.linkedPlayers} linked to an account · ${overview.registered.administrators} administrator${overview.registered.administrators === 1 ? "" : "s"}`,
          `${overview.registered.linkedPlayers} gekoppeld aan een account · ${overview.registered.administrators} beheerder${overview.registered.administrators === 1 ? "" : "s"}`,
        ),
      ),
      activity(localized("Active in the last 24 hours", "Actief in de laatste 24 uur"), overview.active.last24h),
      activity(localized("Active in the last 7 days", "Actief in de laatste 7 dagen"), overview.active.last7d),
      activity(localized("Active in the last month", "Actief in de laatste maand"), overview.active.last30d),
    );
    status.textContent = localized(
      "Active means a signed-in session was started or refreshed in the window; sessions refresh at most every twelve hours.",
      "Actief betekent dat er in die periode een aangemelde sessie is gestart of ververst; sessies verversen hooguit elke twaalf uur.",
    );
  };

  const ready = client.overview(controller.signal).then((overview) => {
    if (disposed) { return; }
    render(overview);
  }).catch((error: unknown) => {
    if (disposed) { return; }
    if (error instanceof AdministratorOverviewClientError && error.code === "not_authorized") {
      // Somebody who is not an administrator never sees the numbers; the
      // page itself already says so.
      if (container.parentNode === root) { root.removeChild(container); }
      return;
    }
    status.textContent = localized(
      "The overview could not be loaded.", "Het overzicht kon niet worden geladen.",
    );
  });

  return {
    container,
    ready,
    unmount(): void {
      if (disposed) { return; }
      disposed = true;
      controller.abort();
      if (container.parentNode === root) { root.removeChild(container); }
    },
  };
}
