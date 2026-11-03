// Directors: who may host Tournament nights (ADR-0220).
//
// "Director" is the one word for hosting. An administrator adds a Director by picking a person by
// name (the account identifier is still shown, because that is what the audit trail records),
// removes one, and answers the requests to host that signed-in accounts send from the Tournaments
// page: Approve gives the same audited grant as adding by hand, Decline takes an optional reason.
// The capability code behind it stays `tournament.operation`; only the words changed.

import {
  createDirectorHostRequestClient,
  type DirectorHostRequestClient,
  type HostRequestQueueItem,
} from "./director-host-request-client.js";
import { localized, productLocaleTag } from "./product-language.js";

type Grant = Readonly<{ grantId: string; userAccountId: string; status: "active" | "revoked" }>;
type LinkedAccount = Readonly<{
  playerId: string;
  username: string;
  displayName: string;
  userAccountId: string;
}>;

export type MountedTournamentOperatorAccess = Readonly<{ ready: Promise<void>; unmount(): void }>;

// `/v1/session/csrf` is a GET route and names the proof `value`. Every other
// web client reads it that way; this one did not, so no grant could ever be
// issued. Kept identical to the shared shape so the drift cannot recur.
async function proof(signal: AbortSignal): Promise<{ name: string; value: string }> {
  const response = await fetch("/v1/session/csrf", {
    method: "GET", credentials: "same-origin", cache: "no-store",
    headers: { Accept: "application/json" }, signal,
  });
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok || typeof body["headerName"] !== "string" || typeof body["value"] !== "string") {
    throw new Error("CSRF unavailable");
  }
  return { name: body["headerName"], value: body["value"] };
}

async function write(path: string, body: unknown, signal: AbortSignal): Promise<void> {
  const csrf = await proof(signal);
  const response = await fetch(path, {
    method: "POST", credentials: "same-origin", signal,
    headers: { "content-type": "application/json", [csrf.name]: csrf.value },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const failure = await response.json().catch(() => ({})) as Record<string, unknown>;
    throw new Error(typeof failure["message"] === "string"
      ? failure["message"]
      : localized("That change could not be saved.", "Die wijziging kon niet worden opgeslagen."));
  }
}

function day(ms: number): string {
  return new Date(ms).toLocaleDateString(productLocaleTag(), { day: "numeric", month: "short", year: "numeric" });
}

export function mountTournamentOperatorAccess(
  root: HTMLElement,
  requests: DirectorHostRequestClient = createDirectorHostRequestClient(),
): MountedTournamentOperatorAccess {
  const document = root.ownerDocument;
  const controller = new AbortController();

  const section = document.createElement("details");
  section.className = "operator-access ds-panel";
  const title = document.createElement("summary");
  title.className = "ds-panel__title";
  title.textContent = localized("Directors", "Directeuren");
  const explanation = document.createElement("p");
  explanation.textContent = localized(
    "Directors host Tournament nights: they create a night, fill its list, run the groups and enter the scores, on the website and in the app. Being a Director does not make someone an administrator.",
    "Directeuren hosten toernooiavonden: ze maken een avond aan, vullen de deelnemerslijst, delen de groepen in en voeren de scores in, op de website en in de app. Directeur zijn maakt iemand geen beheerder.",
  );
  const status = document.createElement("p");
  status.setAttribute("role", "status");

  // Requests to host, answered first: somebody is waiting for them.
  const requestsHeading = document.createElement("h3");
  requestsHeading.className = "operator-access__heading";
  requestsHeading.textContent = localized("Requests to host", "Verzoeken om te hosten");
  const requestsStatus = document.createElement("p");
  requestsStatus.className = "operator-access__hint";
  requestsStatus.setAttribute("role", "status");
  const requestList = document.createElement("ul");
  requestList.className = "operator-access__grants operator-access__requests";

  const directorsHeading = document.createElement("h3");
  directorsHeading.className = "operator-access__heading";
  directorsHeading.textContent = localized("Current Directors", "Huidige Directeuren");
  const list = document.createElement("ul");
  list.className = "operator-access__grants";

  const form = document.createElement("form");
  form.className = "operator-access__form";
  form.noValidate = true;
  const label = document.createElement("label");
  label.className = "operator-access__field";
  const caption = document.createElement("span");
  caption.textContent = localized("Add a Director", "Directeur toevoegen");
  const search = document.createElement("input");
  search.type = "text";
  search.autocomplete = "off";
  search.spellcheck = false;
  search.maxLength = 64;
  search.placeholder = localized("Search by Player name", "Zoek op spelersnaam");
  const hint = document.createElement("span");
  hint.className = "operator-access__hint";
  hint.textContent = localized(
    "Only Players with a verified account can become a Director.",
    "Alleen spelers met een geverifieerd account kunnen Directeur worden.",
  );
  label.append(caption, search, hint);
  const results = document.createElement("ul");
  results.className = "operator-access__results";
  form.append(label, results);

  section.append(
    title, explanation, status,
    requestsHeading, requestsStatus, requestList,
    directorsHeading, list, form,
  );
  root.append(section);

  let people: readonly LinkedAccount[] = [];
  const granted = new Set<string>();

  const clear = (element: HTMLElement): void => {
    while (element.firstChild !== null) { element.removeChild(element.firstChild); }
  };

  const describe = (accountId: string): string => {
    const person = people.find((candidate) => candidate.userAccountId === accountId);
    return person === undefined
      ? accountId
      : `${person.displayName} (@${person.username})`;
  };

  const addGrant = (grant: Grant): void => {
    granted.add(grant.userAccountId);
    const item = document.createElement("li");
    const name = document.createElement("strong");
    name.textContent = describe(grant.userAccountId);
    const identifier = document.createElement("span");
    identifier.className = "operator-access__hint";
    identifier.textContent = grant.userAccountId;
    const revoke = document.createElement("button");
    revoke.type = "button";
    revoke.className = "tt-auth__button";
    revoke.textContent = localized("Remove Director", "Directeur verwijderen");
    revoke.addEventListener("click", () => {
      revoke.disabled = true;
      void write(
        `/v1/administrator/tournament-operation-capabilities/${encodeURIComponent(grant.userAccountId)}/actions/revoke`,
        { reasonCode: "tournament_operator_access_revoked" },
        controller.signal,
      ).then(() => {
        granted.delete(grant.userAccountId);
        item.remove();
        status.textContent = localized(
          `${describe(grant.userAccountId)} is no longer a Director.`,
          `${describe(grant.userAccountId)} is geen Directeur meer.`,
        );
      }, (error: unknown) => {
        revoke.disabled = false;
        status.textContent = error instanceof Error
          ? error.message
          : localized("The Director could not be removed.", "De Directeur kon niet worden verwijderd.");
      });
    });
    item.append(name, identifier, revoke);
    list.append(item);
  };

  const grant = (person: LinkedAccount): void => {
    clear(results);
    search.value = "";
    status.textContent = localized(
      `Making ${person.displayName} a Director…`,
      `${person.displayName} Directeur maken…`,
    );
    void write(
      "/v1/administrator/tournament-operation-capabilities",
      { userAccountId: person.userAccountId, reasonCode: "tournament_operator_access" },
      controller.signal,
    ).then(() => {
      addGrant({ grantId: "pending", userAccountId: person.userAccountId, status: "active" });
      status.textContent = localized(
        `${person.displayName} is now a Director.`,
        `${person.displayName} is nu Directeur.`,
      );
    }, (error: unknown) => {
      status.textContent = error instanceof Error
        ? error.message
        : localized("The Director could not be added.", "De Directeur kon niet worden toegevoegd.");
    });
  };

  const renderMatches = (): void => {
    const query = search.value.trim().toLowerCase();
    clear(results);
    if (query.length < 2) { return; }
    const matches = people.filter((person) =>
      !granted.has(person.userAccountId) &&
      (person.displayName.toLowerCase().includes(query) ||
        person.username.toLowerCase().includes(query))).slice(0, 8);
    if (matches.length === 0) {
      const empty = document.createElement("li");
      empty.className = "operator-access__hint";
      empty.textContent = localized(
        "No Player with a verified account matches that name.",
        "Geen speler met een geverifieerd account past bij die naam.",
      );
      results.append(empty);
      return;
    }
    for (const person of matches) {
      const item = document.createElement("li");
      const choose = document.createElement("button");
      choose.type = "button";
      choose.className = "operator-access__result";
      const name = document.createElement("strong");
      name.textContent = person.displayName;
      const handle = document.createElement("span");
      handle.className = "operator-access__hint";
      handle.textContent = `@${person.username}`;
      choose.append(name, handle);
      choose.addEventListener("click", () => { grant(person); });
      item.append(choose);
      results.append(item);
    }
  };

  search.addEventListener("input", renderMatches);
  form.addEventListener("submit", (event) => { event.preventDefault(); renderMatches(); });

  const requester = (item: HostRequestQueueItem): string => item.players.length === 0
    ? localized("An account without a linked Player", "Een account zonder gekoppelde speler")
    : item.players.map((player) => `${player.displayName} (@${player.username})`).join(", ");

  const renderRequests = (items: readonly HostRequestQueueItem[]): void => {
    clear(requestList);
    requestsStatus.textContent = items.length === 0
      ? localized("No open requests to host.", "Geen open verzoeken om te hosten.")
      : localized(`${items.length} open request(s) to host.`, `${items.length} open verzoek(en) om te hosten.`);
    for (const item of items) {
      const row = document.createElement("li");
      row.className = "operator-access__request";
      const who = document.createElement("strong");
      who.textContent = requester(item);
      const meta = document.createElement("span");
      meta.className = "operator-access__hint";
      meta.textContent = localized(
        `Asked on ${day(item.requestedAtMs)} · account since ${day(item.accountCreatedAtMs)} · ${item.userAccountId}`,
        `Gevraagd op ${day(item.requestedAtMs)} · account sinds ${day(item.accountCreatedAtMs)} · ${item.userAccountId}`,
      );
      row.append(who, meta);
      if (item.note !== null) {
        const note = document.createElement("p");
        note.className = "operator-access__note";
        note.textContent = item.note;
        row.append(note);
      }
      const reasonLabel = document.createElement("label");
      reasonLabel.className = "operator-access__field";
      const reasonCaption = document.createElement("span");
      reasonCaption.textContent = localized("Reason when declining (optional)", "Reden bij afwijzen (optioneel)");
      const reason = document.createElement("input");
      reason.type = "text";
      reason.maxLength = 300;
      reasonLabel.append(reasonCaption, reason);
      const actions = document.createElement("div");
      actions.className = "operator-access__actions";
      const approve = document.createElement("button");
      approve.type = "button";
      approve.className = "tt-auth__button tt-auth__button--primary";
      approve.textContent = localized("Approve", "Goedkeuren");
      const decline = document.createElement("button");
      decline.type = "button";
      decline.className = "tt-auth__button";
      decline.textContent = localized("Decline", "Afwijzen");
      const decide = (action: "approve" | "decline"): void => {
        approve.disabled = true;
        decline.disabled = true;
        const work = action === "approve"
          ? requests.approve(item.requestId, controller.signal)
          : requests.decline(item.requestId, reason.value, controller.signal);
        void work.then(() => {
          row.remove();
          if (action === "approve") {
            addGrant({ grantId: "pending", userAccountId: item.userAccountId, status: "active" });
          }
          status.textContent = action === "approve"
            ? localized(`${requester(item)} is now a Director.`, `${requester(item)} is nu Directeur.`)
            : localized(`The request of ${requester(item)} was declined.`, `Het verzoek van ${requester(item)} is afgewezen.`);
        }, () => {
          approve.disabled = false;
          decline.disabled = false;
          status.textContent = localized(
            "That decision could not be saved. Reload and try again.",
            "Die beslissing kon niet worden opgeslagen. Vernieuw en probeer het opnieuw.",
          );
        });
      };
      approve.addEventListener("click", () => { decide("approve"); });
      decline.addEventListener("click", () => { decide("decline"); });
      actions.append(approve, decline);
      row.append(reasonLabel, actions);
      requestList.append(row);
    }
  };

  let loaded = false;
  const loadDirectors = (): void => {
    if (loaded) { return; }
    loaded = true;
    status.textContent = localized("Loading…", "Laden…");
    void Promise.all([
      fetch("/v1/administrator/linked-player-accounts", {
        credentials: "same-origin", signal: controller.signal,
      }).then(async (response) => {
        if (!response.ok) { throw new Error("directory unavailable"); }
        return (await response.json() as { players: readonly LinkedAccount[] }).players;
      }),
      fetch("/v1/administrator/tournament-operation-capabilities", {
        credentials: "same-origin", signal: controller.signal,
      }).then(async (response) => {
        if (!response.ok) { throw new Error("grants unavailable"); }
        return await response.json() as Grant[];
      }),
    ]).then(([directory, grants]) => {
      people = directory;
      grants.forEach(addGrant);
      status.textContent = grants.length > 0
        ? localized(
          `${grants.length} Director(s) besides the administrators.`,
          `${grants.length} Directeur(en) naast de beheerders.`,
        )
        : localized(
          "Only administrators host Tournaments right now.",
          "Alleen beheerders hosten nu toernooien.",
        );
    }).catch(() => {
      if (!controller.signal.aborted) {
        status.textContent = localized(
          "The Directors are unavailable.",
          "De Directeuren zijn niet beschikbaar.",
        );
      }
    });
  };
  section.addEventListener("toggle", () => {
    if (section.open) { loadDirectors(); }
  });

  // The open requests are read at once: the notification that announced one opens this page, and
  // the section opens itself when somebody is waiting.
  const ready = requests.queue(controller.signal).then((items) => {
    renderRequests(items);
    if (items.length > 0) {
      section.open = true;
      loadDirectors();
    }
  }, () => {
    if (!controller.signal.aborted) {
      requestsStatus.textContent = localized(
        "Requests to host are unavailable.",
        "Verzoeken om te hosten zijn niet beschikbaar.",
      );
    }
  });

  return {
    ready,
    unmount(): void {
      controller.abort();
      if (section.parentNode === root) { root.removeChild(section); }
    },
  };
}
