import {
  createPlayerClaimClient,
  PlayerClaimClientError,
  type AccountPlayerClaimSummary,
  type ClaimablePlayerSummary,
  type PlayerClaimClient,
} from "./player-claim-client.js";
import {
  createPlayerVisibilityClient,
  type PlayerVisibility,
  type PlayerVisibilityClient,
} from "./time-trial-lifecycle-client.js";
import { PLAYER_VISIBILITY_COPY } from "./player-visibility-settings.js";
import { createClaimWalkClient, type ClaimWalkClient } from "./claim-walk-client.js";
import { mountPlayerClaimWalk, type MountedPlayerClaimWalk } from "./player-claim-walk.js";
import { localized } from "./product-language.js";

export type MountedPlayerClaimSection = Readonly<{
  container: HTMLElement;
  ready: Promise<void>;
  state: Promise<"linked" | "pending" | "unbound" | "unavailable">;
  unmount(): void;
}>;

const activeStatuses = new Set(["requested", "under_review", "verified"]);

function clear(element: HTMLElement): void {
  while (element.firstChild !== null) { element.removeChild(element.firstChild); }
}

function statusLabel(claim: AccountPlayerClaimSummary): string {
  if (claim.claimStatus === "verified") {
    return `Verified Player: ${claim.playerDisplayName} (@${claim.playerUsername}).`;
  }
  if (claim.claimStatus === "under_review") {
    return `Your claim for ${claim.playerDisplayName} is under review.`;
  }
  if (claim.claimStatus === "requested") {
    return `Your claim for ${claim.playerDisplayName} has been requested.`;
  }
  return `Your earlier claim for ${claim.playerDisplayName} is ${claim.claimStatus}.`;
}

export function mountPlayerClaimSection(
  root: HTMLElement,
  client: PlayerClaimClient = createPlayerClaimClient(),
  visibilityClient: PlayerVisibilityClient = createPlayerVisibilityClient(),
  walkClient: ClaimWalkClient | null = createClaimWalkClient(),
): MountedPlayerClaimSection {
  const document = root.ownerDocument;
  const controller = new AbortController();
  let disposed = false;
  let operation = 0;
  const container = document.createElement("section");
  container.className = "ds-panel player-claim";
  container.setAttribute("aria-labelledby", "player-claim-heading");
  const heading = document.createElement("h3");
  heading.className = "ds-title";
  heading.id = "player-claim-heading";
  heading.textContent = "Your Player";
  const status = document.createElement("p");
  status.className = "ds-body-s player-claim__status";
  status.setAttribute("role", "status");
  status.textContent = "Checking your Player…";
  const content = document.createElement("div");
  // Every claim of this account with where it stands and the conversation (ADR-0216).
  const walkRoot = document.createElement("div");
  container.append(heading, status, walkRoot, content);
  root.append(container);
  let walk: MountedPlayerClaimWalk | null = null;
  const showWalk = (): void => {
    if (walkClient === null || disposed) { return; }
    walk?.unmount();
    walk = mountPlayerClaimWalk(walkRoot, walkClient, showWalk);
  };

  const renderCreateOwnPlayer = (): HTMLElement => {
    const create = document.createElement("form");
    create.className = "ds-settings__nested player-claim__create";
    // We render consistent persistent field feedback ourselves. Native bubble
    // validation would stop the submit event before the status region and
    // aria-invalid state can explain what still needs attention.
    create.noValidate = true;
    const heading = document.createElement("h3");
    heading.className = "ds-title";
    heading.textContent = "Create your Player";
    const explanation = document.createElement("p");
    explanation.className = "ds-panel__note player-claim__hint";
    explanation.textContent =
      "Pick the name you want to race under. It is yours straight away — " +
      "no waiting, and you can start recording times immediately.";
    const requiredNote = document.createElement("p");
    requiredNote.className = "player-claim__required-note";
    requiredNote.textContent =
      "* Required. Display name is optional; the remaining profile preferences can be saved later.";
    const usernameLabel = document.createElement("label");
    usernameLabel.className = "ds-field player-claim__field";
    const usernameCaption = document.createElement("span");
    usernameCaption.textContent = "Username *";
    const username = document.createElement("input");
    username.className = "ds-input";
    username.name = "new_player_username";
    username.required = true;
    username.minLength = 3;
    username.maxLength = 16;
    username.pattern = "[a-z0-9_-]{3,16}";
    username.autocomplete = "off";
    username.spellcheck = false;
    username.setAttribute(
      "aria-describedby",
      "new-player-username-hint new-player-username-error",
    );
    const usernameHint = document.createElement("span");
    usernameHint.className = "ds-field__hint player-claim__hint";
    usernameHint.id = "new-player-username-hint";
    usernameHint.textContent =
      "3-16 characters: lower-case letters, digits, '-' or '_'. Must be unique.";
    const usernameError = document.createElement("span");
    usernameError.id = "new-player-username-error";
    usernameError.className = "ds-field__error player-claim__field-error";
    usernameError.setAttribute("aria-live", "polite");
    usernameLabel.append(usernameCaption, username, usernameHint, usernameError);
    const displayLabel = document.createElement("label");
    displayLabel.className = "ds-field player-claim__field";
    const displayCaption = document.createElement("span");
    displayCaption.textContent = "Display name (optional)";
    const displayName = document.createElement("input");
    displayName.className = "ds-input";
    displayName.name = "new_player_display_name";
    displayName.maxLength = 64;
    displayName.autocomplete = "off";
    displayName.setAttribute(
      "aria-describedby",
      "new-player-display-name-hint new-player-display-name-error",
    );
    const displayHint = document.createElement("span");
    displayHint.id = "new-player-display-name-hint";
    displayHint.className = "ds-field__hint player-claim__hint";
    displayHint.textContent =
      "1-64 printable characters when provided. Must not duplicate another Player name.";
    const displayError = document.createElement("span");
    displayError.id = "new-player-display-name-error";
    displayError.className = "ds-field__error player-claim__field-error";
    displayError.setAttribute("aria-live", "polite");
    displayLabel.append(displayCaption, displayName, displayHint, displayError);
    // The presence choice belongs at the moment the Player is created, in
    // the same words Settings uses later. Public is the default because it
    // is what most people come here for; Private is one click away and
    // never hides anything from the Player themselves.
    const visibility = document.createElement("fieldset");
    visibility.className = "ds-settings-choices player-claim__visibility";
    const visibilityLegend = document.createElement("legend");
    visibilityLegend.textContent = "How should your Player appear? *";
    visibility.append(visibilityLegend);
    const visibilityInputs = new Map<PlayerVisibility, HTMLInputElement>();
    for (const choice of ["public", "private"] as const) {
      const copy = PLAYER_VISIBILITY_COPY[choice];
      const label = document.createElement("label");
      label.className = "ds-settings-choice player-claim__choice";
      const input = document.createElement("input");
      input.type = "radio";
      input.name = "new_player_visibility";
      input.value = choice;
      input.checked = choice === "public";
      const title = document.createElement("strong");
      title.textContent = copy.label;
      const detail = document.createElement("span");
      detail.className = "ds-field__hint player-claim__hint";
      detail.textContent = copy.explanation;
      label.append(input, title, detail);
      visibilityInputs.set(choice, input);
      visibility.append(label);
    }
    const submit = document.createElement("button");
    submit.type = "submit";
    submit.className = "ds-button ds-slant";
    submit.setAttribute("data-variant", "primary");
    submit.setAttribute("data-size", "md");
    submit.textContent = "Create Player";
    create.append(
      heading, explanation, requiredNote, usernameLabel, displayLabel,
      visibility, submit,
    );

    const showFieldError = (
      field: HTMLInputElement,
      error: HTMLElement,
      message: string,
    ): void => {
      field.setAttribute("aria-invalid", "true");
      error.textContent = message;
      field.focus?.();
    };
    const clearFieldErrors = (): void => {
      username.setAttribute("aria-invalid", "false");
      displayName.setAttribute("aria-invalid", "false");
      usernameError.textContent = "";
      displayError.textContent = "";
    };
    username.addEventListener("input", () => {
      username.setAttribute("aria-invalid", "false");
      usernameError.textContent = "";
    });
    displayName.addEventListener("input", () => {
      displayName.setAttribute("aria-invalid", "false");
      displayError.textContent = "";
    });

    create.addEventListener("submit", (event) => {
      event.preventDefault();
      if (disposed) { return; }
      clearFieldErrors();
      if (username.value.length === 0) {
        showFieldError(username, usernameError, "Username is required.");
        status.textContent = "Complete the highlighted required field.";
        return;
      }
      if (!/^[a-z0-9_-]{3,16}$/.test(username.value)) {
        showFieldError(
          username,
          usernameError,
          "Use 3-16 lower-case letters, digits, '-' or '_'.",
        );
        status.textContent = "Correct the highlighted username and retry.";
        return;
      }
      const trimmedDisplayName = displayName.value.trim();
      if (trimmedDisplayName.length > 64 ||
          /[\u0000-\u001f\u007f]/.test(trimmedDisplayName)) {
        showFieldError(
          displayName,
          displayError,
          "Use at most 64 printable characters, or leave this optional field empty.",
        );
        status.textContent = "Correct the highlighted display name and retry.";
        return;
      }
      operation += 1;
      const current = operation;
      const chosenVisibility: PlayerVisibility =
        visibilityInputs.get("private")?.checked === true
          ? "private"
          : "public";
      submit.disabled = true;
      status.textContent = "Creating your Player…";
      void client.createOwnPlayer(
        username.value,
        displayName.value,
        controller.signal,
      ).then(async (created) => {
        // The presence choice is a separate, reversible setting; a Player
        // that exists but could not be made private is reported honestly
        // rather than silently left public.
        let presenceFailed = false;
        if (chosenVisibility === "private") {
          presenceFailed = await visibilityClient
            .setOwn("private", controller.signal)
            .then(() => false, () => true);
        }
        if (disposed || current !== operation) { return; }
        clear(content);
        status.textContent =
          `Your Player ${created.displayName} (@${created.username}) has ` +
          "been created and linked to this account.";
        if (presenceFailed) {
          const warning = document.createElement("p");
          warning.className = "player-claim__hint";
          warning.textContent =
            "Your Player was created, but it could not be made private " +
            "just now. You can set that in Settings.";
          content.append(warning);
        }
        // Onboarding is its own route now; reached from Settings, the useful
        // next step is the Player you just made.
        const profile = document.createElement("a");
        profile.className = "tt-auth__link";
        profile.href = `/?player=${encodeURIComponent(created.username)}`;
        profile.textContent = "View your Player";
        content.append(profile);
      }).catch((error) => {
        if (disposed || current !== operation) { return; }
        if (error instanceof PlayerClaimClientError) {
          if (error.code === "username_taken") {
            status.textContent =
              "That username is already in use. Choose another one.";
            showFieldError(
              username,
              usernameError,
              "This username is already in use.",
            );
          } else if (error.code === "display_name_taken") {
            status.textContent =
              "That display name belongs to an existing Player. Choose the existing-Player path or use another display name.";
            showFieldError(
              displayName,
              displayError,
              "This display name is already in use by another Player.",
            );
          } else if (error.code === "invalid_input") {
            status.textContent =
              "One or more Player fields are invalid. Review the field guidance and retry.";
          } else if (error.code === "already_linked") {
            status.textContent =
              "This account already has a Player. Reload to review the linked Player.";
          } else if (error.code === "creation_closed") {
            // ADR-0221: only Directors create Players on this installation.
            status.textContent = localized(
              "On this site, Players are created by the Directors. Ask the Director of your nights to add you, then find your Player here and claim it.",
              "Op deze site maken de Directeuren de spelers aan. Vraag de Directeur van jouw avonden om je toe te voegen, zoek daarna hier je speler en claim hem.",
            );
          } else if (error.code === "rate_limited") {
            status.textContent =
              "Too many Player creation attempts were made today. Wait before retrying.";
          } else if (error.code === "not_authenticated") {
            status.textContent =
              "Your sign-in expired. Sign in again; your entered names are still shown above.";
          } else if (error.code === "conflict") {
            status.textContent =
              "The Player changed while it was being created. Your entered names are preserved; retry once.";
          } else {
            status.textContent = "The Player could not be created. Please retry.";
          }
        } else {
          status.textContent = "The Player could not be created. Please retry.";
        }
        submit.disabled = false;
      });
    });
    return create;
  };

  // Two honest paths, in the words a new arrival would use themselves.
  // Neither path is preselected: the answer to "have you raced here
  // before?" is the whole decision, and only the person can answer it.
  const renderSearch = (): void => {
    clear(content);
    status.textContent =
      "Let's set up your Player — the name you race under.";
    const intro = document.createElement("p");
    intro.className = "ds-panel__note player-claim__hint";
    intro.textContent =
      "Your Player holds your times, your records and your history. " +
      "Which of these is you?";
    const paths = document.createElement("div");
    paths.className = "player-claim__paths";
    paths.setAttribute("role", "group");
    paths.setAttribute("aria-label", "How would you like to start?");
    const existingPanel = document.createElement("div");
    existingPanel.className = "player-claim__panel";
    existingPanel.hidden = true;
    const newPanel = document.createElement("div");
    newPanel.className = "player-claim__panel";
    newPanel.hidden = true;
    const pathButtons = new Map<"existing" | "new", HTMLButtonElement>();
    const choosePath = (path: "existing" | "new"): void => {
      existingPanel.hidden = path !== "existing";
      newPanel.hidden = path !== "new";
      for (const [candidate, control] of pathButtons) {
        const active = candidate === path;
        control.className = "ds-button player-claim__path";
        control.setAttribute("data-variant", "secondary");
        control.setAttribute("aria-pressed", active ? "true" : "false");
      }
      status.textContent = path === "existing"
        ? "Search for the name you have raced under before."
        : "Pick the name you want to race under.";
    };
    for (const [path, label] of [
      ["existing", "I already have a Player"],
      ["new", "I'm new here"],
    ] as const) {
      const control = document.createElement("button");
      control.type = "button";
      control.className = "ds-button player-claim__path";
      control.setAttribute("data-variant", "secondary");
      control.setAttribute("aria-pressed", "false");
      control.textContent = label;
      control.addEventListener("click", () => choosePath(path));
      pathButtons.set(path, control);
      paths.append(control);
    }
    content.append(intro, paths, existingPanel, newPanel);

    const form = document.createElement("form");
    form.className = "ds-stack player-claim__search";
    const label = document.createElement("label");
    label.className = "ds-field";
    label.textContent = "Username or display name";
    const input = document.createElement("input");
    input.className = "ds-input";
    input.type = "search";
    input.name = "player_query";
    input.minLength = 2;
    input.maxLength = 64;
    input.required = true;
    input.autocomplete = "off";
    const submit = document.createElement("button");
    submit.type = "submit";
    submit.className = "ds-button";
    submit.setAttribute("data-variant", "secondary");
    submit.textContent = "Search Players";
    const results = document.createElement("ul");
    results.className = "player-claim__results";
    label.append(input);
    form.append(label, submit);
    existingPanel.append(form, results);
    newPanel.append(renderCreateOwnPlayer());

    const select = (player: ClaimablePlayerSummary): void => {
      clear(results);
      const selection = document.createElement("li");
      const summary = document.createElement("p");
      summary.textContent = `${player.displayName} (@${player.username})`;
      const warning = document.createElement("p");
      warning.textContent = localized(
        "Nothing is merged automatically. The Director of their nights or an administrator checks " +
          "that this Player is really you before it is linked.",
        "Er wordt niets automatisch samengevoegd. De Directeur van hun avonden of een beheerder controleert " +
          "eerst of deze speler echt jij bent.",
      );
      const noteLabel = document.createElement("label");
      noteLabel.className = "ds-field";
      const noteCaption = document.createElement("span");
      noteCaption.textContent = localized(
        "How can they recognise you? (optional, for example where and when you played)",
        "Hoe herkennen ze je? (optioneel, bijvoorbeeld waar en wanneer je speelde)",
      );
      const note = document.createElement("textarea");
      note.className = "ds-input";
      note.name = "claim_request_note";
      note.maxLength = 500;
      note.rows = 2;
      noteLabel.append(noteCaption, note);
      const publicProfile = document.createElement("a");
      publicProfile.className = "ds-button";
      publicProfile.setAttribute("data-variant", "quiet");
      publicProfile.setAttribute(
        "href",
        `/?player=${encodeURIComponent(player.playerId)}`,
      );
      publicProfile.textContent = "View public profile";
      const request = document.createElement("button");
      request.type = "button";
      request.className = "ds-button ds-slant";
      request.setAttribute("data-variant", "primary");
      request.setAttribute("data-size", "md");
      request.textContent = "This is me";
      request.addEventListener("click", () => {
        if (disposed) { return; }
        operation += 1;
        const current = operation;
        request.disabled = true;
        status.textContent = "Asking for this Player to be linked to you…";
        void client.request(player.playerId, controller.signal, note.value).then((claim) => {
          if (disposed || current !== operation) { return; }
          clear(content);
          showWalk();
          status.textContent = claim.claimStatus === "requested"
            ? `We have asked the team to link ${player.displayName} to ` +
              "your account. You will hear back here."
            : `Your request for ${player.displayName} is ${claim.claimStatus}.`;
        }).catch((error) => {
          if (disposed || current !== operation) { return; }
          status.textContent = error instanceof PlayerClaimClientError &&
            error.code === "conflict"
            ? "Something already changed about this Player. Reload to see where it stands."
            : "That request could not be sent. Please retry.";
          request.disabled = false;
        });
      });
      selection.append(summary, publicProfile, warning, noteLabel, request);
      results.append(selection);
      status.textContent = "Make sure this is the right Player before you continue.";
    };

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (disposed) { return; }
      operation += 1;
      const current = operation;
      submit.disabled = true;
      input.disabled = true;
      status.textContent = "Searching Players…";
      void client.search(input.value, controller.signal).then((players) => {
        if (disposed || current !== operation) { return; }
        clear(results);
        for (const player of players) {
          const row = document.createElement("li");
          const choose = document.createElement("button");
          choose.type = "button";
          choose.className = "ds-button player-claim__result";
          choose.setAttribute("data-variant", "secondary");
          choose.textContent = `${player.displayName} (@${player.username})`;
          choose.addEventListener("click", () => select(player));
          row.append(choose);
          results.append(row);
        }
        status.textContent = players.length === 0
          ? "No Player matched that name. Try the exact start of the name."
          : "Pick the one that is you. Similar names are never merged for you.";
        submit.disabled = false;
        input.disabled = false;
      }).catch(() => {
        if (disposed || current !== operation) { return; }
        status.textContent = "Player search is temporarily unavailable. Please retry.";
        submit.disabled = false;
        input.disabled = false;
      });
    });
  };

  const state = client.listMine(controller.signal).then((claims) => {
    if (disposed) { return "unavailable" as const; }
    // A linked Player outranks an open request: an account may own several (ADR-0178).
    const active = claims.find((claim) => claim.claimStatus === "verified") ??
      claims.find((claim) => activeStatuses.has(claim.claimStatus));
    showWalk();
    if (active !== undefined) {
      status.textContent = statusLabel(active);
      if (active.claimStatus === "verified") {
        // An account may own several Players, never two that met (ADR-0178).
        const another = document.createElement("button");
        another.type = "button";
        another.className = "ds-button";
        another.setAttribute("data-variant", "quiet");
        another.textContent = localized("Link another Player who is also you", "Nog een speler koppelen die ook jij bent");
        another.addEventListener("click", () => renderSearch());
        content.append(another);
      }
      return active.claimStatus === "verified" ? "linked" as const : "pending" as const;
    }
    renderSearch();
    return "unbound" as const;
  }).catch(() => {
    if (!disposed) {
      status.textContent = "Your Player could not be loaded. Reload to retry.";
    }
    return "unavailable" as const;
  });
  const ready = state.then(() => undefined);

  return {
    container,
    ready,
    state,
    unmount(): void {
      if (disposed) { return; }
      disposed = true;
      operation += 1;
      controller.abort();
      walk?.unmount();
      if (container.parentNode === root) { root.removeChild(container); }
    },
  };
}
