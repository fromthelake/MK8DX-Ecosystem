import {
  createIdentityLinkClient,
  IdentityLinkClientError,
  type IdentityLinkAccount,
  type IdentityLinkClient,
  type IdentityLinkOverview,
  type IdentityLinkPlayer,
} from "./identity-link-client.js";

export type MountedAdministratorIdentityLinkSection = Readonly<{
  container: HTMLElement;
  ready: Promise<void>;
  unmount(): void;
}>;

function clear(element: HTMLElement): void {
  while (element.firstChild !== null) { element.removeChild(element.firstChild); }
}

/** "119 Time Trials · 283 Tournament races", or what is actually there. */
function history(player: IdentityLinkPlayer): string {
  const parts: string[] = [];
  if (player.timeTrials > 0) { parts.push(`${player.timeTrials} Time Trials`); }
  if (player.tournamentRaces > 0) { parts.push(`${player.tournamentRaces} Tournament races`); }
  return parts.length === 0 ? "no recorded history" : parts.join(" · ");
}

/**
 * Who can sign in, and whose history they see.
 *
 * Everyone who played before this ecosystem existed already has a Player here,
 * holding their Time Trials, their Tournament races or both. When they sign in
 * for the first time they arrive as a new account attached to nothing, and
 * somebody has to say which Player is them. This screen is where that is said,
 * and unsaid.
 */
export function mountAdministratorIdentityLinkSection(
  root: HTMLElement,
  client: IdentityLinkClient = createIdentityLinkClient(),
): MountedAdministratorIdentityLinkSection {
  const document = root.ownerDocument;
  const controller = new AbortController();
  let disposed = false;
  let operation = 0;

  const container = document.createElement("section");
  container.className = "administrator-identity-links ds-panel";
  container.setAttribute("aria-labelledby", "administrator-identity-links-heading");
  const heading = document.createElement("h2");
  heading.id = "administrator-identity-links-heading";
  heading.className = "ds-panel__title";
  heading.textContent = "Accounts and Players";
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  status.textContent = "Loading accounts…";
  const content = document.createElement("div");
  container.append(heading, status, content);
  root.append(container);

  const act = async (work: () => Promise<void>, done: string): Promise<void> => {
    try {
      await work();
      status.textContent = done;
      await load();
    } catch (error) {
      if (disposed) { return; }
      const code = error instanceof IdentityLinkClientError ? error.code : "unavailable";
      status.textContent = code === "conflict"
        ? "That Player or that account is already linked. Unlink it first."
        : code === "not_authorized"
          ? "Linking is available to an administrator only."
          : code === "invalid_input"
            ? "That account or Player was not accepted."
            : "Linking is temporarily unavailable.";
    }
  };

  const renderAccount = (
    account: IdentityLinkAccount, players: readonly IdentityLinkPlayer[],
  ): HTMLElement => {
    const row = document.createElement("li");
    row.className = "identity-link-row";

    const who = document.createElement("p");
    who.className = "identity-link-who";
    who.textContent = account.email ?? account.screenName ?? account.userAccountId;
    row.append(who);

    if (account.linkedPlayerId !== null) {
      const linked = document.createElement("p");
      linked.className = "identity-link-current";
      const player = players.find((entry) => entry.playerId === account.linkedPlayerId);
      linked.textContent = player === undefined
        ? `linked to ${account.linkedPlayerName ?? account.linkedPlayerId}`
        : `linked to ${player.displayName} — ${history(player)}`;
      const unlink = document.createElement("button");
      unlink.type = "button";
      unlink.className = "identity-link-unlink";
      unlink.textContent = "Unlink";
      unlink.addEventListener("click", () => {
        void act(
          () => client.unlink(account.userAccountId, controller.signal),
          `${who.textContent} is no longer linked.`,
        );
      });
      row.append(linked, unlink);
      return row;
    }

    if (account.userAccountId === "") {
      // Signed in at least once, but this deployment cannot resolve the
      // account behind the address; there is nothing to link yet.
      const note = document.createElement("p");
      note.className = "identity-link-current";
      note.textContent = "has signed in but has no account here yet";
      row.append(note);
      return row;
    }

    const choose = document.createElement("select");
    choose.className = "identity-link-choose";
    choose.setAttribute("aria-label", `Player for ${who.textContent}`);
    const none = document.createElement("option");
    none.value = "";
    none.textContent = "Choose a Player…";
    choose.append(none);
    for (const player of players) {
      if (player.linkedAccountId !== null) { continue; }
      const option = document.createElement("option");
      option.value = player.playerId;
      option.textContent = `${player.displayName} — ${history(player)}`;
      choose.append(option);
    }
    const link = document.createElement("button");
    link.type = "button";
    link.className = "identity-link-link";
    link.textContent = "Link";
    link.addEventListener("click", () => {
      const playerId = choose.value;
      if (playerId === "") {
        status.textContent = "Choose a Player first.";
        return;
      }
      void act(
        () => client.link(account.userAccountId, playerId, controller.signal),
        `${who.textContent} is linked.`,
      );
    });
    row.append(choose, link);
    return row;
  };

  const render = (overview: IdentityLinkOverview): void => {
    clear(content);
    const unlinkedAccounts = overview.accounts.filter((a) => a.linkedPlayerId === null);
    status.textContent = overview.accounts.length === 0
      ? "No accounts have signed in yet."
      : `${overview.accounts.length} account${overview.accounts.length === 1 ? "" : "s"}, ${
        unlinkedAccounts.length} not yet linked to a Player.`;

    const list = document.createElement("ol");
    list.className = "identity-link-list";
    // The ones needing a decision come first; there is no reason to scroll
    // past the settled ones to find the work.
    for (const account of [...unlinkedAccounts,
      ...overview.accounts.filter((a) => a.linkedPlayerId !== null)]) {
      list.append(renderAccount(account, overview.players));
    }
    content.append(list);

    const orphans = overview.players.filter((p) =>
      p.linkedAccountId === null && (p.timeTrials > 0 || p.tournamentRaces > 0));
    if (orphans.length > 0) {
      const note = document.createElement("p");
      note.className = "identity-link-orphans";
      note.textContent = `${orphans.length} Players have history but no account yet.`;
      content.append(note);
    }
  };

  const load = async (): Promise<void> => {
    const current = ++operation;
    try {
      const overview = await client.overview(controller.signal);
      if (disposed || current !== operation) { return; }
      render(overview);
    } catch (error) {
      if (disposed || current !== operation) { return; }
      if (error instanceof IdentityLinkClientError && error.code === "not_authorized") {
        // Not an administrator: the screen simply is not there.
        if (container.parentNode === root) { root.removeChild(container); }
        return;
      }
      status.textContent = "Accounts and Players are temporarily unavailable.";
    }
  };

  const ready = load();

  return {
    container,
    ready,
    unmount() {
      disposed = true;
      controller.abort();
      if (container.parentNode === root) { root.removeChild(container); }
    },
  };
}
