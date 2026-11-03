// Owner decision 2026-08-28: aliases are managed under the profile, by the
// Player as well as by an administrator. This is the Player's own half. It
// lists the aliases of every Player this account has a verified claim on, and
// lets the account declare or withdraw one of its own.
//
// What an account may assert is deliberately narrower than what an
// administrator may. Every alias created here is `declared` with
// `player_declaration` provenance: a statement about yourself, never a claim
// about how somebody else observed a name. The service enforces the same rule,
// so this is a matching interface rather than the only guard.
//
// ADR-0006 still holds: an alias lets an import resolve a name to this Player,
// it never approves a claim and never merges identities.

import { localized } from "./product-language.js";
import {
  createAliasAdministrationClient,
  type AliasAdministrationClient,
} from "./administrator-alias-section.js";
import {
  createPlayerAliasClient,
  type PlayerAliasClient,
  type PublicPlayerAlias,
} from "./player-alias-client.js";
import {
  createPlayerClaimClient,
  type AccountPlayerClaimSummary,
  type PlayerClaimClient,
} from "./player-claim-client.js";

export type MountedProfileAliasSection = Readonly<{
  element: HTMLElement;
  refresh: () => Promise<void>;
  dispose: () => void;
}>;

// Resolved per render, not once at import: the product language can change
// while the page is open.
function aliasTypeLabel(type: PublicPlayerAlias["aliasType"]): string {
  const labels: Readonly<Record<PublicPlayerAlias["aliasType"], string>> = {
    declared: localized("You added this", "Zelf opgegeven"),
    legacy_handle: localized("In-game name", "In-game naam"),
    tournament_name: localized("Tournament name", "Toernooinaam"),
    ocr_observation: localized("Seen in a scan", "Waargenomen bij scan"),
    other_observation: localized("Observed", "Waargenomen"),
  };
  return labels[type];
}

function describe(error: unknown): string {
  const code = (error as { code?: string } | null)?.code;
  if (code === "not_authorized") {
    return localized(
      "You can only manage the names of your own Player.",
      "Je kunt alleen de namen van je eigen speler beheren.",
    );
  }
  if (code === "invalid_input") {
    return localized(
      "That name cannot be saved.", "Die naam kan niet worden opgeslagen.",
    );
  }
  if (code === "conflict") {
    return localized("That name is already listed.", "Die naam staat er al.");
  }
  return localized(
    "Your names could not be loaded.", "Namen konden niet worden geladen.",
  );
}

export function mountProfileAliasSection(
  root: HTMLElement,
  clients: Readonly<{
    claims?: PlayerClaimClient;
    aliases?: PlayerAliasClient;
    administration?: AliasAdministrationClient;
  }> = {},
): MountedProfileAliasSection {
  const ownerDocument = root.ownerDocument;
  // Constructed on first use rather than at mount: mounting this section must
  // never be able to abort the page it sits on.
  let claimsClient = clients.claims;
  let aliasClient = clients.aliases;
  let administrationClient = clients.administration;
  const claims = (): PlayerClaimClient =>
    (claimsClient ??= createPlayerClaimClient());
  const aliases = (): PlayerAliasClient =>
    (aliasClient ??= createPlayerAliasClient());
  const administration = (): AliasAdministrationClient =>
    (administrationClient ??= createAliasAdministrationClient());
  const controller = new AbortController();
  let disposed = false;

  const container = ownerDocument.createElement("section");
  container.className = "ds-panel profile-aliases";
  container.setAttribute("aria-labelledby", "profile-aliases-heading");

  const heading = ownerDocument.createElement("h3");
  heading.className = "ds-title";
  heading.id = "profile-aliases-heading";
  heading.textContent = localized("Your other names", "Je namen");

  const explanation = ownerDocument.createElement("p");
  explanation.className = "ds-panel__note profile-aliases__explanation";
  explanation.textContent = localized(
    "Race under a different name in-game? Add it here and a tournament " +
      "import will recognise your results. A name only links results to your " +
      "Player; it gives nobody access to your account.",
    "Speel je in de game onder een andere naam? Geef die hier op, dan herkent " +
      "een toernooi-import je uitslagen. Een naam koppelt alleen uitslagen aan " +
      "je speler; hij geeft niemand toegang tot je account.",
  );

  const status = ownerDocument.createElement("p");
  status.setAttribute("role", "status");
  status.className = "ds-body-s profile-aliases__status";

  const players = ownerDocument.createElement("div");
  players.className = "profile-aliases__players";

  container.append(heading, explanation, status, players);
  root.append(container);

  let refresh: () => Promise<void>;

  const renderPlayer = async (claim: AccountPlayerClaimSummary): Promise<void> => {
    const panel = ownerDocument.createElement("article");
    panel.className = "ds-settings__nested profile-aliases__player";
    panel.dataset["playerId"] = claim.playerId;

    const name = ownerDocument.createElement("h3");
    name.textContent = claim.playerDisplayName;
    panel.append(name);

    const rows = ownerDocument.createElement("ul");
    rows.className = "profile-aliases__list";
    panel.append(rows);
    players.append(panel);

    let known: readonly PublicPlayerAlias[];
    try {
      known = (await aliases().listForPlayer(claim.playerId, controller.signal)).aliases;
    } catch {
      const failed = ownerDocument.createElement("li");
      failed.textContent = localized(
        "Your names could not be loaded.", "Namen konden niet worden geladen.",
      );
      rows.append(failed);
      return;
    }
    if (disposed) { return; }

    if (known.length === 0) {
      const empty = ownerDocument.createElement("li");
      empty.className = "profile-aliases__empty";
      empty.textContent = localized(
        "No other names yet.", "Nog geen extra namen.",
      );
      rows.append(empty);
    }

    known.forEach((alias) => {
      const row = ownerDocument.createElement("li");
      row.dataset["aliasId"] = alias.aliasId;
      const text = ownerDocument.createElement("span");
      text.className = "profile-aliases__text";
      text.textContent = alias.aliasText;
      const kind = ownerDocument.createElement("span");
      kind.className = "profile-aliases__kind";
      kind.textContent = aliasTypeLabel(alias.aliasType);
      row.append(text, kind);

      // Only a self-declared name is the Player's to withdraw. A reviewed
      // observation is provenance and stays with the administrator.
      if (alias.aliasType === "declared") {
        const withdraw = ownerDocument.createElement("button");
        withdraw.type = "button";
        withdraw.className = "ds-button";
        withdraw.setAttribute("data-variant", "quiet");
        withdraw.textContent = localized("Remove", "Verwijderen");
        withdraw.addEventListener("click", () => {
          withdraw.disabled = true;
          administration().retire(alias.aliasId, controller.signal)
            .then(async () => {
              status.textContent = localized(
                `"${alias.aliasText}" was removed.`,
                `"${alias.aliasText}" is verwijderd.`,
              );
              await refresh();
            })
            .catch((error: unknown) => {
              withdraw.disabled = false;
              status.textContent = describe(error);
            });
        });
        row.append(withdraw);
      }
      rows.append(row);
    });

    const form = ownerDocument.createElement("form");
    form.className = "profile-aliases__add";
    const input = ownerDocument.createElement("input");
    input.className = "ds-input";
    input.type = "text";
    input.maxLength = 64;
    input.placeholder = localized("Name in the game", "Naam in de game");
    input.setAttribute("aria-label", localized(
      `Add a name for ${claim.playerDisplayName}`,
      `Naam toevoegen voor ${claim.playerDisplayName}`,
    ));
    const submit = ownerDocument.createElement("button");
    submit.type = "submit";
    submit.className = "ds-button";
    submit.setAttribute("data-variant", "secondary");
    submit.textContent = localized("Add name", "Naam toevoegen");
    form.append(input, submit);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const aliasText = input.value.trim();
      if (aliasText.length === 0) { return; }
      submit.disabled = true;
      administration().create({
        playerId: claim.playerId,
        aliasText,
        aliasType: "declared",
        visibility: "public",
        sourceType: "player_declaration",
        sourceReference: "source.player_declaration_profile",
      }, controller.signal)
        .then(async (created) => {
          status.textContent = localized(
            `"${created.aliasText}" was added.`,
            `"${created.aliasText}" is toegevoegd.`,
          );
          input.value = "";
          await refresh();
        })
        .catch((error: unknown) => { status.textContent = describe(error); })
        .finally(() => { submit.disabled = false; });
    });
    panel.append(form);
  };

  refresh = async (): Promise<void> => {
    if (disposed) { return; }
    // The production host and the test DOM disagree about replaceChildren.
    while (players.firstChild !== null) { players.removeChild(players.firstChild); }
    status.textContent = localized("Loading your names…", "Namen laden…");
    let mine: readonly AccountPlayerClaimSummary[];
    try {
      mine = await claims().listMine(controller.signal);
    } catch (error) {
      status.textContent = describe(error);
      return;
    }
    if (disposed) { return; }
    const verified = mine.filter((claim) => claim.claimStatus === "verified");
    if (verified.length === 0) {
      status.textContent =
        localized(
          "Link your Player to your account first; then you can manage your names here.",
          "Koppel eerst je speler aan je account; daarna beheer je hier je namen.",
        );
      return;
    }
    status.textContent = "";
    for (const claim of verified) {
      await renderPlayer(claim);
    }
  };

  void refresh();

  return {
    element: container,
    refresh: () => refresh(),
    dispose: () => {
      if (disposed) { return; }
      disposed = true;
      controller.abort();
      container.remove();
    },
  };
}
