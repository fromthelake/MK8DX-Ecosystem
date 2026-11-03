// The first minutes of a new MK8DX account.
//
// Onboarding used to be the Settings page with `?onboarding=1` appended: a
// new arrival was handed a language dropdown, a sign-out button and eight
// independent Save buttons before reaching the one step that actually
// mattered. This is a route of its own with a single job per screen.
//
// Step 1  two questions (ADR-0219): are your Time Trial times already here,
//         have you taken part in a tournament listed here.
// Step 2  the name you race under (No and No), or finding the Player(s) you
//         already are, with context that matches the answers.
// Step 3  optional preferences, one Save, and a visible Skip.
//
// Everything else - aliases, screen name, kart parts, rivals, notifications -
// belongs in Settings, where a person goes when they want to tune something.

import {
  createPlayerClaimClient,
  PlayerClaimClientError,
  type ClaimablePlayerSummary,
  type ClaimCandidate,
  type PlayerClaimClient,
} from "./player-claim-client.js";
import {
  createPlayerVisibilityClient,
  type PlayerVisibility,
  type PlayerVisibilityClient,
} from "./time-trial-lifecycle-client.js";
import { PLAYER_VISIBILITY_COPY } from "./player-visibility-settings.js";
import {
  createInstallationSettingsClient,
  loadInstallationSettings,
  type InstallationSettingsClient,
} from "./installation-settings-client.js";
import {
  createPlayerProfilePreferenceClient,
  type PlayerProfilePreferenceClient,
} from "./player-profile-preference-settings.js";
import {
  createAccountTimeTrialPreferenceClient,
  type AccountTimeTrialPreferenceClient,
  type TimeTrialModePreference,
  type TimeTrialTrackAccess,
} from "./account-time-trial-settings.js";
import { COUNTRY_ASSET_MANIFEST, GAME_ASSET_BASE, countryFlagPath } from "./asset-manifest.js";
import { AVATAR_GROUPS } from "./avatar-manifest.js";
import { pickerCharacterName } from "./character-picker-names.js";
import { dutchPresentation } from "./dutch-ui-copy.js";
import { localized } from "./product-language.js";
import {
  RETURN_INTENT_PARAM,
  sanitizeReturnIntent,
} from "./return-intent.js";

export type MountedWelcomeOnboarding = Readonly<{
  container: HTMLElement;
  ready: Promise<void>;
  unmount(): void;
}>;

export type WelcomeOnboardingDependencies = Readonly<{
  claims?: PlayerClaimClient;
  visibility?: PlayerVisibilityClient;
  profilePreferences?: PlayerProfilePreferenceClient;
  timeTrialPreferences?: AccountTimeTrialPreferenceClient;
  navigate?: (href: string) => void;
  /**
   * Validated destination the person was heading for when the account was
   * created (carried by the magic link as `?return=`). Onboarding finishes
   * there instead of on the new profile, so signing up to download an app or
   * approve a device completes that errand.
   */
  returnIntent?: string | null;
  /** ADR-0221: whether this installation lets people create their own Player. */
  installationSettings?: Pick<InstallationSettingsClient, "current">;
}>;

const usernamePattern = /^[a-z0-9_-]{3,16}$/;

/** ADR-0221: what a person reads where "create my Player" would be. */
function creationClosedText(): string {
  return localized(
    "On this site, Players are created by the Directors. Ask the Director of your nights to add you, then find your Player here and claim it.",
    "Op deze site maken de Directeuren de spelers aan. Vraag de Directeur van jouw avonden om je toe te voegen, zoek daarna hier je speler en claim hem.",
  );
}
const controlCharacters = /[\u0000-\u001f\u007f]/;

/**
 * The server's own rule for turning a human name into a `@handle`
 * (`rosterUsernameFor` in `player-onboarding-service.ts`, ADR-0151). Kept
 * identical here so the handle a person is shown while typing is the handle
 * they get.
 */
export function deriveUsername(displayName: string): string | null {
  const normalized = displayName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "_")
    .replace(/_+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .slice(0, 16);
  return usernamePattern.test(normalized) ? normalized : null;
}

/**
 * The first free handle at or after `base`. Two people called Nova both get
 * to be Nova; only the handle carries the digit, and it is shown before
 * anything is created.
 */
export function suggestAvailableUsername(
  base: string,
  taken: ReadonlySet<string>,
): string | null {
  if (!usernamePattern.test(base)) { return null; }
  if (!taken.has(base)) { return base; }
  for (let suffix = 2; suffix <= 99; suffix += 1) {
    const tail = String(suffix);
    const candidate = `${base.slice(0, 16 - tail.length)}${tail}`;
    if (usernamePattern.test(candidate) && !taken.has(candidate)) {
      return candidate;
    }
  }
  return null;
}

/** Every name a Player answers to, lower-cased, for local matching. */
export function playerSearchKeys(player: ClaimablePlayerSummary): readonly string[] {
  return [player.displayName, player.username, ...player.aliases]
    .map((name) => name.trim().toLowerCase())
    .filter((name) => name.length > 0);
}

export function matchPlayers(
  players: readonly ClaimablePlayerSummary[],
  rawQuery: string,
  limit = 8,
): readonly ClaimablePlayerSummary[] {
  const query = rawQuery.trim().toLowerCase();
  if (query.length === 0) { return []; }
  const starts: ClaimablePlayerSummary[] = [];
  const contains: ClaimablePlayerSummary[] = [];
  for (const player of players) {
    const keys = playerSearchKeys(player);
    if (keys.some((key) => key.startsWith(query))) { starts.push(player); }
    else if (keys.some((key) => key.includes(query))) { contains.push(player); }
  }
  return [...starts, ...contains].slice(0, limit);
}

/** The two answers of the first screen (ADR-0219). */
export type WelcomeAnswers = Readonly<{ timeTrials: boolean; tournaments: boolean }>;

/**
 * A Player on the "find yourself" screen: with context when the server
 * answered (ADR-0219), a bare directory row when it could not.
 */
export type WelcomeCandidate = ClaimablePlayerSummary & Partial<Omit<ClaimCandidate, keyof ClaimablePlayerSummary>>;

/** How long typing pauses before the server is asked. */
const candidateSearchDelayMs = 200;

function classesLabel(classes: readonly (150 | 200)[]): string {
  if (classes.length === 2) { return localized("150cc and 200cc", "150cc en 200cc"); }
  return classes.length === 1 ? `${classes[0]}cc` : "";
}

/** The Time Trial line of a candidate: how many, the last one, the classes. */
export function timeTrialContextLine(timeTrials: ClaimCandidate["timeTrials"]): string {
  if (timeTrials.times === 0) {
    return localized("No published Time Trials", "Geen gepubliceerde Time Trials");
  }
  const count = timeTrials.times;
  const parts = [count === 1
    ? localized("1 published Time Trial", "1 gepubliceerde Time Trial")
    : localized(`${count} published Time Trials`, `${count} gepubliceerde Time Trials`)];
  if (timeTrials.lastAt !== null) {
    const last = timeTrials.lastAt;
    parts.push(localized(`last on ${last}`, `laatste op ${last}`));
  }
  const classes = classesLabel(timeTrials.classes);
  if (classes.length > 0) { parts.push(classes); }
  return parts.join(" · ");
}

/** The tournament line of a candidate: how many nights, their Directors, the last night. */
export function tournamentContextLine(tournaments: ClaimCandidate["tournaments"]): string {
  if (tournaments.nights === 0) {
    return localized("No tournament nights", "Geen toernooiavonden");
  }
  const count = tournaments.nights;
  const parts = [count === 1
    ? localized("1 tournament night", "1 toernooiavond")
    : localized(`${count} tournament nights`, `${count} toernooiavonden`)];
  if (tournaments.directorNames.length > 0) {
    const directors = tournaments.directorNames.join(", ");
    parts.push(localized(`Directors: ${directors}`, `Directeuren: ${directors}`));
  }
  const last = tournaments.lastNight;
  if (last !== null) {
    const night = last.name;
    const date = last.date;
    parts.push(date === null
      ? localized(`last: ${night}`, `laatst: ${night}`)
      : localized(`last: ${night} (${date})`, `laatst: ${night} (${date})`));
  }
  return parts.join(" · ");
}

/** Both context lines, when the server sent context. */
export function candidateContextLines(player: WelcomeCandidate): readonly string[] {
  if (player.timeTrials === undefined || player.tournaments === undefined) { return []; }
  return [timeTrialContextLine(player.timeTrials), tournamentContextLine(player.tournaments)];
}

/**
 * After a yes to both questions: the half the chosen Player does not show, to
 * look for under a second Player, or null when this Player has both (the most
 * common case) or only one question was answered yes.
 */
export function missingHalf(answers: WelcomeAnswers, player: WelcomeCandidate): WelcomeAnswers | null {
  if (!answers.timeTrials || !answers.tournaments) { return null; }
  const hasTimeTrials = (player.timeTrials?.times ?? 0) > 0;
  const hasNights = (player.tournaments?.nights ?? 0) > 0;
  if (hasTimeTrials && hasNights) { return null; }
  return { timeTrials: !hasTimeTrials, tournaments: !hasNights };
}

/**
 * The claim note recorded on each of two requests made together, so the
 * reviewer sees the two Players may be one person (ADR-0216 notes,
 * ADR-0219). Written in English, the one language every reviewer shares.
 */
export function possiblySamePersonNote(other: Readonly<{ displayName: string; username: string }>): string {
  return `Possibly the same person as ${other.displayName} (@${other.username}): both Players were requested together at sign-up (one for Time Trials, one for tournaments).`;
}

const characters = AVATAR_GROUPS.flatMap((group) => {
  const basePart = { id: group.id, name: pickerCharacterName(group.id, group.name), iconPath: group.iconPath };
  return [basePart, ...group.variants.map((variant) => ({ ...basePart, ...variant }))];
});

function clear(element: HTMLElement): void {
  while (element.firstChild !== null) { element.removeChild(element.firstChild); }
}

function element<K extends keyof HTMLElementTagNameMap>(
  owner: Document,
  tag: K,
  className?: string,
  textContent?: string,
): HTMLElementTagNameMap[K] {
  const created = owner.createElement(tag);
  if (className !== undefined) {
    const classes = [className];
    // W05 keeps its workflow-specific hooks, but the controls themselves are the shared system:
    // one field/input/select/button/panel grammar rather than a parallel onboarding kit.
    if (className.includes("welcome__stepper")) { classes.push("ds-eyebrow"); }
    if (className.includes("welcome__heading")) { classes.push("ds-display-2"); }
    if (className.includes("welcome__lede")) { classes.push("ds-body"); }
    if (className.includes("welcome__status")) { classes.push("ds-micro"); }
    if (className.includes("welcome__stage") || className.includes("welcome__form")) {
      classes.push("ds-stack");
    }
    if (className.includes("welcome__panel")) { classes.push("ds-panel"); }
    if (className.includes("welcome__field")) { classes.push("ds-field"); }
    if (className.includes("welcome__label")) { classes.push("ds-field__label"); }
    if (className.includes("welcome__hint")) { classes.push("ds-field__hint"); }
    if (className.includes("welcome__error")) { classes.push("ds-field__error"); }
    if (className.includes("welcome__control")) {
      classes.push(tag === "select" ? "ds-select" : "ds-input");
    }
    if (className.includes("welcome__button") || className.includes("welcome__link")) {
      classes.push("ds-button");
    }
    if (className.includes("welcome__button--primary")) { classes.push("ds-slant"); }
    created.className = classes.join(" ");
    if (className.includes("welcome__button--primary")) {
      created.setAttribute("data-variant", "primary");
    } else if (className.includes("welcome__button--quiet") || className.includes("welcome__link")) {
      created.setAttribute("data-variant", "quiet");
    } else if (className.includes("welcome__button")) {
      created.setAttribute("data-variant", "secondary");
    }
  }
  if (textContent !== undefined) { created.textContent = textContent; }
  return created;
}

export function mountWelcomeOnboarding(
  root: HTMLElement,
  dependencies: WelcomeOnboardingDependencies = {},
): MountedWelcomeOnboarding {
  const owner = root.ownerDocument;
  const claims = dependencies.claims ?? createPlayerClaimClient();
  const visibilityClient = dependencies.visibility ?? createPlayerVisibilityClient();
  const profileClient = dependencies.profilePreferences ??
    createPlayerProfilePreferenceClient();
  const preferenceClient = dependencies.timeTrialPreferences ??
    createAccountTimeTrialPreferenceClient();
  const navigate = dependencies.navigate ??
    ((href: string): void => { globalThis.location.assign(href); });
  const returnIntent = dependencies.returnIntent !== undefined
    ? sanitizeReturnIntent(dependencies.returnIntent)
    : sanitizeReturnIntent(new URLSearchParams(
        globalThis.location?.search?.slice(1) ?? "",
      ).get(RETURN_INTENT_PARAM));

  const controller = new AbortController();
  let disposed = false;
  let operation = 0;
  // ADR-0221: open until the installation says only Directors create Players.
  let selfCreationAllowed = true;
  void loadInstallationSettings(
    dependencies.installationSettings ?? createInstallationSettingsClient(), controller.signal,
  ).then((settings) => { selfCreationAllowed = settings.playerCreation !== "directors_only"; });

  const container = element(owner, "section", "ds-root ds-welcome welcome");
  container.setAttribute("aria-labelledby", "welcome-heading");

  const stepper = element(owner, "p", "welcome__stepper");
  const heading = element(owner, "h1", "welcome__heading");
  heading.id = "welcome-heading";
  const lede = element(owner, "p", "welcome__lede");
  const status = element(owner, "p", "welcome__status");
  status.setAttribute("role", "status");
  const stage = element(owner, "div", "welcome__stage");
  container.append(stepper, heading, lede, status, stage);
  root.append(container);

  // One directory read serves handle availability, display-name collision and
  // the "find yourself" typeahead. Nothing here costs a request per keystroke.
  let directory: readonly ClaimablePlayerSummary[] = [];
  let takenUsernames: ReadonlySet<string> = new Set();
  let takenDisplayNames: ReadonlySet<string> = new Set();
  let confirmedSameName: string | null = null;
  let directoryLoaded = false;

  const setHeader = (step: string, title: string, sub: string): void => {
    stepper.textContent = step;
    stepper.hidden = step.length === 0;
    heading.textContent = title;
    lede.textContent = sub;
  };

  const finishTo = (username: string): void => {
    // The errand that required the account wins over admiring the new
    // profile; without one, the profile is the natural landing.
    navigate(returnIntent ?? `/?player=${encodeURIComponent(username)}`);
  };

  // ---------------------------------------------------------------- step 2

  const renderExtras = (created: Readonly<{
    username: string;
    displayName: string;
    warning?: string;
  }>): void => {
    clear(stage);
    setHeader(
      localized("Step 3 of 3 · optional", "Stap 3 van 3 · optioneel"),
      localized(`You're in, ${created.displayName}`, `Je bent binnen, ${created.displayName}`),
      localized(
        "A few choices that make the experience yours. Skip them and nothing is lost — they all live in Settings.",
        "Een paar keuzes die de ervaring van jou maken. Sla ze over en er gaat niets verloren — ze staan allemaal in Instellingen.",
      ),
    );
    status.textContent = created.warning ?? "";

    const form = element(owner, "form", "welcome__form");
    form.noValidate = true;

    // Country — a real dropdown, because the list is finite and known.
    const countryField = element(owner, "label", "welcome__field");
    countryField.append(element(owner, "span", "welcome__label",
      localized("Country", "Land")));
    const countryRow = element(owner, "div", "welcome__row");
    const flag = element(owner, "img", "welcome__flag");
    flag.alt = "";
    flag.hidden = true;
    const country = element(owner, "select", "welcome__control");
    const noCountry = element(owner, "option", undefined,
      localized("Prefer not to say", "Liever niet zeggen"));
    noCountry.value = "";
    country.append(noCountry);
    for (const entry of COUNTRY_ASSET_MANIFEST) {
      const option = element(owner, "option", undefined,
        localized(entry.name, dutchPresentation(entry.name)));
      option.value = entry.id;
      country.append(option);
    }
    country.addEventListener("change", () => {
      const path = countryFlagPath(country.value || null);
      flag.hidden = path === undefined;
      if (path !== undefined) { flag.src = `${GAME_ASSET_BASE}${path}`; }
    });
    countryRow.append(flag, country);
    countryField.append(countryRow);

    // Favourite character.
    const characterField = element(owner, "label", "welcome__field");
    characterField.append(element(owner, "span", "welcome__label",
      localized("Favourite character", "Favoriete coureur")));
    const characterRow = element(owner, "div", "welcome__row");
    const characterIcon = element(owner, "img", "welcome__icon");
    characterIcon.alt = "";
    characterIcon.hidden = true;
    const character = element(owner, "select", "welcome__control");
    const noCharacter = element(owner, "option", undefined,
      localized("No favourite yet", "Nog geen favoriet"));
    noCharacter.value = "";
    character.append(noCharacter);
    for (const part of characters) {
      const option = element(owner, "option", undefined,
        localized(part.name, dutchPresentation(part.name)));
      option.value = part.id;
      character.append(option);
    }
    character.addEventListener("change", () => {
      const part = characters.find((candidate) => candidate.id === character.value);
      characterIcon.hidden = part === undefined;
      if (part !== undefined) { characterIcon.src = `${GAME_ASSET_BASE}${part.iconPath}`; }
    });
    characterRow.append(characterIcon, character);
    characterField.append(characterRow);

    // Engine class.
    const modeField = element(owner, "label", "welcome__field");
    modeField.append(element(owner, "span", "welcome__label",
      localized("Which engine class do you care about?", "Welke cc-klasse volg je?")));
    const mode = element(owner, "select", "welcome__control");
    for (const [value, label] of [
      ["all", localized("Both — 150cc and 200cc", "Allebei — 150cc en 200cc")],
      ["150", localized("150cc only", "Alleen 150cc")],
      ["200", localized("200cc only", "Alleen 200cc")],
    ] as const) {
      const option = element(owner, "option", undefined, label);
      option.value = value;
      mode.append(option);
    }
    modeField.append(mode);
    modeField.append(element(owner, "span", "welcome__hint", localized(
      "This decides what Home, the rankings and your notifications lead with.",
      "Dit bepaalt waarmee Home, de klassementen en je meldingen beginnen.",
    )));

    const trackAccessField = element(owner, "label", "welcome__field");
    trackAccessField.append(element(owner, "span", "welcome__label", localized(
      "Do you have the Booster Course Pass?",
      "Heb je de Circuit-uitbreidingspas?",
    )));
    const trackAccess = element(owner, "select", "welcome__control welcome__control--track-access");
    for (const [value, label] of [
      ["unknown", localized("Choose Yes or No", "Kies Ja of Nee")],
      ["base_and_bcp", localized("Yes — all 96 tracks", "Ja — alle 96 circuits")],
      ["base_only", localized("No — the 48 base tracks", "Nee — de 48 basiscircuits")],
    ] as const) {
      const option = element(owner, "option", undefined, label);
      option.value = value;
      trackAccess.append(option);
    }
    trackAccessField.append(trackAccess);
    trackAccessField.append(element(owner, "span", "welcome__hint", localized(
      "This keeps DLC tracks out of your missing-progress count. You can still browse every public track.",
      "Zo tellen DLC-circuits niet als ontbrekende voortgang. Je kunt alle openbare circuits blijven bekijken.",
    )));

    const actions = element(owner, "div", "welcome__actions");
    const save = element(owner, "button", "welcome__button welcome__button--primary",
      localized("Save and finish", "Opslaan en afronden"));
    save.type = "submit";
    const skip = element(owner, "button", "welcome__button welcome__button--quiet",
      localized("Skip for now", "Nu overslaan"));
    skip.type = "button";
    skip.addEventListener("click", () => { finishTo(created.username); });
    actions.append(save, skip);

    form.append(countryField, characterField, modeField, trackAccessField, actions);
    stage.append(form);

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (disposed) { return; }
      save.disabled = true;
      skip.disabled = true;
      status.textContent = localized("Saving…", "Opslaan…");
      const chosenMode = mode.value as TimeTrialModePreference;
      const chosenTrackAccess = trackAccess.value as TimeTrialTrackAccess;
      if (chosenTrackAccess === "unknown") {
        status.textContent = localized(
          "Choose Yes or No for the Booster Course Pass, or skip these optional choices for now.",
          "Kies Ja of Nee voor de Circuit-uitbreidingspas, of sla deze optionele keuzes nu over.",
        );
        trackAccess.focus();
        save.disabled = false;
        skip.disabled = false;
        return;
      }
      // Both preference documents are read-modify-write; a failure in either
      // is reported but never traps the person on this screen.
      void Promise.allSettled([
        profileClient.read(controller.signal).then((current) => profileClient.save({
          ...current,
          countryId: country.value || null,
          favoriteCharacterId: character.value || null,
        }, controller.signal)),
        preferenceClient.read(controller.signal).then((current) => preferenceClient.save({
          ...current,
          modePreference: chosenMode,
          trackAccess: chosenTrackAccess,
        }, controller.signal)),
      ]).then((results) => {
        if (disposed) { return; }
        if (results.every((result) => result.status === "fulfilled")) {
          finishTo(created.username);
          return;
        }
        status.textContent = localized(
          "Your Player is ready, but those preferences could not be saved just now. You can set them in Settings.",
          "Je speler staat klaar, maar die voorkeuren konden nu niet worden opgeslagen. Je kunt ze in Instellingen zetten.",
        );
        save.disabled = false;
        skip.disabled = false;
        skip.textContent = localized("Continue anyway", "Toch doorgaan");
      });
    });
  };

  // ------------------------------------------------------------ claim sent

  const renderClaimRequested = (
    players: readonly WelcomeCandidate[],
    warning = "",
  ): void => {
    clear(stage);
    const names = players.map((player) => player.displayName).join(" & ");
    setHeader(
      "",
      localized("Request sent", "Verzoek verstuurd"),
      localized(
        `We have asked the team to link ${names} to your account.`,
        `We hebben het team gevraagd om ${names} aan je account te koppelen.`,
      ),
    );
    status.textContent = warning;
    const panel = element(owner, "div", "welcome__panel");
    panel.append(element(owner, "p", "welcome__body", localized(
      "Nothing is merged automatically — someone checks that this Player is really you. You will hear back here, usually within a day.",
      "Er wordt niets automatisch samengevoegd — iemand controleert of deze speler echt jou is. Je hoort het hier, meestal binnen een dag.",
    )));
    if (players.length > 1) {
      panel.append(element(owner, "p", "welcome__body", localized(
        "We told the reviewers that these two Players may be the same person. Each request is checked on its own; nothing is merged.",
        "We hebben de beoordelaars laten weten dat deze twee spelers misschien dezelfde persoon zijn. Elk verzoek wordt apart bekeken; er wordt niets samengevoegd.",
      )));
    }
    panel.append(element(owner, "p", "welcome__body", localized(
      "In the meantime you can look around: browse the tracks, the record book and the rankings.",
      "Ondertussen kun je rondkijken: de circuits, het recordboek en de klassementen.",
    )));
    const actions = element(owner, "div", "welcome__actions");
    const home = element(owner, "a", "welcome__button welcome__button--primary",
      returnIntent === null
        ? localized("Look around", "Rondkijken")
        : localized("Continue where you left off", "Verdergaan waar je was"));
    home.href = returnIntent ?? "/";
    actions.append(home);
    panel.append(actions);
    stage.append(panel);
  };

  /**
   * Sends one request, or two when the person found a Time Trial Player and a
   * tournament Player that are both them (ADR-0219). Two requests each carry a
   * note so the reviewer sees they may be one person; nothing is merged.
   */
  const sendRequests = (
    players: readonly WelcomeCandidate[],
    buttons: readonly HTMLButtonElement[],
  ): void => {
    if (disposed) { return; }
    operation += 1;
    const current = operation;
    for (const button of buttons) { button.disabled = true; }
    status.textContent = players.length > 1
      ? localized("Sending your requests…", "Je verzoeken worden verstuurd…")
      : localized("Sending your request…", "Je verzoek wordt verstuurd…");
    const sent: WelcomeCandidate[] = [];
    void (async () => {
      for (const player of players) {
        const other = players.find((candidate) => candidate.playerId !== player.playerId);
        try {
          const claim = other === undefined
            ? await claims.request(player.playerId, controller.signal)
            : await claims.request(player.playerId, controller.signal, possiblySamePersonNote(other));
          if (disposed || current !== operation) { return; }
          if (claim.claimStatus === "verified" && players.length === 1) { finishTo(player.username); return; }
          sent.push(player);
        } catch (error) {
          if (disposed || current !== operation) { return; }
          const reason = error instanceof PlayerClaimClientError && error.code === "conflict"
            ? localized(
              `${player.displayName} is already linked to an account. If that account is yours, sign in with its email address; otherwise ask an administrator to help.`,
              `${player.displayName} is al aan een account gekoppeld. Is dat jouw account, meld je dan aan met dat e-mailadres; vraag anders een beheerder om hulp.`,
            )
            : localized(
              "That request could not be sent. Please try again.",
              "Dat verzoek kon niet worden verstuurd. Probeer het opnieuw.",
            );
          if (sent.length > 0) {
            // The first request stands; say plainly which one did not go.
            renderClaimRequested(sent, reason);
            return;
          }
          status.textContent = reason;
          for (const button of buttons) { button.disabled = false; }
          return;
        }
      }
      if (disposed || current !== operation) { return; }
      renderClaimRequested(sent);
    })();
  };

  // ------------------------------------------- step 2b: find yourself

  /**
   * The typeahead over display name, handle and public aliases (ADR-0180),
   * answered by the server with context that matches the two answers
   * (ADR-0219). `first` is set when the person said yes twice and the Player
   * they already chose lacks one of the two: then this screen looks for the
   * other half.
   */
  const renderExisting = (answers: WelcomeAnswers, first: WelcomeCandidate | null = null): void => {
    clear(stage);
    if (first === null) {
      setHeader(
        localized("Step 2 of 3", "Stap 2 van 3"),
        localized("Find yourself in the list", "Zoek jezelf in de lijst"),
        localized(
          "Start typing the name you race under. In-game names count too.",
          "Typ de naam waaronder je rijdt. In-game namen tellen ook mee.",
        ),
      );
    } else {
      setHeader(
        localized("Step 2 of 3", "Stap 2 van 3"),
        answers.timeTrials && !answers.tournaments
          ? localized(
            "Are your Time Trial times under another Player?",
            "Staan je Time Trial-tijden onder een andere speler?",
          )
          : !answers.timeTrials && answers.tournaments
            ? localized(
              "Are your tournament nights under another Player?",
              "Staan je toernooiavonden onder een andere speler?",
            )
            : localized(
              "Are your other results under another Player?",
              "Staan je andere resultaten onder een andere speler?",
            ),
        localized(
          `Sometimes the same person has two Players here. If so, find the other one; ${first.displayName} stays chosen.`,
          `Soms heeft dezelfde persoon hier twee spelers. Zoek dan de andere; ${first.displayName} blijft gekozen.`,
        ),
      );
    }
    status.textContent = "";

    const field = element(owner, "label", "welcome__field");
    field.append(element(owner, "span", "welcome__label",
      localized("Your name", "Je naam")));
    const input = element(owner, "input", "welcome__control welcome__control--search");
    input.type = "text";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.maxLength = 64;
    input.placeholder = localized("Start typing…", "Begin met typen…");
    input.setAttribute("aria-describedby", "welcome-existing-hint");
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-expanded", "false");
    input.setAttribute("aria-controls", "welcome-existing-results");
    field.append(input);
    const hint = element(owner, "span", "welcome__hint");
    hint.id = "welcome-existing-hint";
    hint.textContent = localized(
      "Nothing is merged automatically. Someone from the team checks that the Player is really you before it is linked.",
      "Er wordt niets automatisch samengevoegd. Iemand van het team controleert of de speler echt jou is voordat er wordt gekoppeld.",
    );
    field.append(hint);

    const results = element(owner, "ul", "welcome__results");
    results.id = "welcome-existing-results";
    results.setAttribute("role", "listbox");

    stage.append(field, results);

    if (first === null && !selfCreationAllowed) {
      stage.append(element(owner, "p", "welcome__hint", creationClosedText()));
    } else if (first === null) {
      // The "oh no, not after all" way out: nothing has been sent yet, and the
      // ordinary onboarding simply continues as a new Player.
      const switchBack = element(owner, "button", "welcome__link",
        localized(
          "Oh no, not after all — I'm new here, create a Player instead",
          "Oh nee, toch niet — ik ben nieuw, maak een speler aan",
        ));
      switchBack.type = "button";
      switchBack.addEventListener("click", () => { renderCreate(); });
      stage.append(switchBack);
    } else {
      const onlyFirst = element(owner, "button", "welcome__button welcome__button--primary",
        localized(
          `No — send the request for ${first.displayName} only`,
          `Nee — stuur alleen het verzoek voor ${first.displayName}`,
        ));
      onlyFirst.type = "button";
      onlyFirst.setAttribute("data-welcome-only-first", "true");
      onlyFirst.addEventListener("click", () => { sendRequests([first], [onlyFirst]); });
      stage.append(onlyFirst);
    }

    const confirm = (player: WelcomeCandidate): void => {
      clear(results);
      input.setAttribute("aria-expanded", "false");
      const item = element(owner, "li", "welcome__confirm");
      item.append(element(owner, "p", "welcome__confirm-name",
        `${player.displayName} (@${player.username})`));
      if (player.aliases.length > 0) {
        item.append(element(owner, "p", "welcome__hint", localized(
          `Also known as ${player.aliases.join(", ")}`,
          `Ook bekend als ${player.aliases.join(", ")}`,
        )));
      }
      for (const line of candidateContextLines(player)) {
        item.append(element(owner, "p", "welcome__hint", line));
      }
      const profile = element(owner, "a", "welcome__link",
        localized("Look at this profile first", "Bekijk dit profiel eerst"));
      profile.href = `/?player=${encodeURIComponent(player.username)}`;
      profile.target = "_blank";
      profile.rel = "noopener";
      const actions = element(owner, "div", "welcome__actions");
      const yes = element(owner, "button", "welcome__button welcome__button--primary",
        localized("Yes, that's me", "Ja, dat ben ik"));
      yes.type = "button";
      const no = element(owner, "button", "welcome__button welcome__button--quiet",
        localized("Not me — keep looking", "Niet ik — verder zoeken"));
      no.type = "button";
      no.addEventListener("click", () => {
        clear(results);
        input.focus();
      });
      actions.append(yes, no);
      item.append(profile, actions);
      results.append(item);

      yes.addEventListener("click", () => {
        if (disposed) { return; }
        if (first !== null) {
          sendRequests([first, player], [yes, no]);
          return;
        }
        const missing = missingHalf(answers, player);
        if (missing !== null) {
          renderExisting(missing, player);
          return;
        }
        sendRequests([player], [yes, no]);
      });
    };

    const show = (matches: readonly WelcomeCandidate[], withContext: boolean): void => {
      clear(results);
      const shown = matches.filter((player) => player.playerId !== first?.playerId);
      if (shown.length === 0) {
        input.setAttribute("aria-expanded", "false");
        results.append(element(owner, "li", "welcome__empty", localized(
          "No Player answers to that name yet.",
          "Nog geen speler met die naam.",
        )));
        if (first === null && !selfCreationAllowed) {
          results.append(element(owner, "li", "welcome__empty", creationClosedText()));
        } else if (first === null) {
          const create = element(owner, "button", "welcome__link", localized(
            "Create a new Player with this name", "Maak een nieuwe speler met deze naam",
          ));
          create.type = "button";
          const typed = input.value;
          create.addEventListener("click", () => { renderCreate(typed); });
          const row = element(owner, "li");
          row.append(create);
          results.append(row);
        }
        return;
      }
      input.setAttribute("aria-expanded", "true");
      let heading: "fit" | "other" | null = null;
      for (const player of shown) {
        if (withContext && (answers.timeTrials || answers.tournaments)) {
          const group = player.matchesAnswers === true ? "fit" : "other";
          if (group !== heading) {
            heading = group;
            results.append(element(owner, "li", "welcome__group", group === "fit"
              ? localized("Matches your answers", "Past bij je antwoorden")
              : localized("Other Players with this name", "Andere spelers met deze naam")));
          }
        }
        const row = element(owner, "li");
        const choose = element(owner, "button", "welcome__result");
        choose.type = "button";
        choose.setAttribute("role", "option");
        choose.setAttribute("aria-selected", "false");
        choose.append(element(owner, "strong", "welcome__result-name", player.displayName));
        const detail = player.aliases.length > 0
          ? localized(
            `@${player.username} · also ${player.aliases.slice(0, 3).join(", ")}`,
            `@${player.username} · ook ${player.aliases.slice(0, 3).join(", ")}`,
          )
          : `@${player.username}`;
        choose.append(element(owner, "span", "welcome__result-detail", detail));
        for (const line of candidateContextLines(player)) {
          choose.append(element(owner, "span", "welcome__result-context", line));
        }
        if (player.claimed === true) {
          choose.append(element(owner, "span", "welcome__result-context", localized(
            "Already linked to an account",
            "Al aan een account gekoppeld",
          )));
        }
        choose.addEventListener("click", () => { confirm(player); });
        row.append(choose);
        results.append(row);
      }
    };

    // The server answers with context; while that search fails (a dropped
    // connection, a busy server) the directory already read still finds the name.
    let searchTimer: ReturnType<typeof setTimeout> | null = null;
    let search = 0;
    const render = (): void => {
      if (searchTimer !== null) { clearTimeout(searchTimer); searchTimer = null; }
      search += 1;
      const query = input.value.trim();
      if (query.length < 2) {
        clear(results);
        input.setAttribute("aria-expanded", "false");
        return;
      }
      if (claims.candidates === undefined) {
        show(matchPlayers(directory, query), false);
        return;
      }
      const mine = search;
      const lookup = claims.candidates.bind(claims);
      searchTimer = setTimeout(() => {
        searchTimer = null;
        void lookup({ query, ...answers }, controller.signal).then((found) => {
          if (disposed || mine !== search) { return; }
          show(found, true);
        }, () => {
          if (disposed || mine !== search) { return; }
          show(matchPlayers(directory, query), false);
        });
      }, candidateSearchDelayMs);
    };

    input.addEventListener("input", render);
    if (!directoryLoaded && claims.candidates === undefined) {
      status.textContent = localized("Loading the Player list…", "Spelerslijst laden…");
    }
    input.focus();
  };

  // --------------------------------------------------- step 1a: brand new

  // ADR-0221: on this installation only Directors create Players. The person
  // asks the Director of their nights, then finds and claims that Player here.
  const renderCreationClosed = (): void => {
    clear(stage);
    setHeader(
      localized("Step 2 of 3", "Stap 2 van 3"),
      localized("A Director creates your Player", "Een Directeur maakt je speler aan"),
      creationClosedText(),
    );
    status.textContent = "";
    const find = element(owner, "button", "welcome__button welcome__button--primary",
      localized("Find my Player", "Mijn speler zoeken"));
    find.type = "button";
    find.addEventListener("click", () => { renderExisting({ timeTrials: true, tournaments: true }); });
    stage.append(find);
  };

  const renderCreate = (initialName = ""): void => {
    if (!selfCreationAllowed) { renderCreationClosed(); return; }
    clear(stage);
    setHeader(
      localized("Step 2 of 3", "Stap 2 van 3"),
      localized("What should we call you?", "Hoe zullen we je noemen?"),
      localized(
        "This is the name on the leaderboards, in the record book and on your profile. You can change it later.",
        "Dit is de naam op de klassementen, in het recordboek en op je profiel. Je kunt hem later wijzigen.",
      ),
    );
    status.textContent = "";

    const form = element(owner, "form", "welcome__form");
    form.noValidate = true;

    const nameField = element(owner, "label", "welcome__field");
    nameField.append(element(owner, "span", "welcome__label",
      localized("Your racing name", "Je racenaam")));
    const name = element(owner, "input", "welcome__control welcome__control--name");
    name.type = "text";
    name.maxLength = 64;
    name.setAttribute("autocomplete", "nickname");
    name.spellcheck = false;
    name.value = initialName.slice(0, 64);
    name.placeholder = localized("For example: Nova", "Bijvoorbeeld: Nova");
    name.setAttribute("aria-describedby", "welcome-handle welcome-name-error");
    nameField.append(name);
    const handleLine = element(owner, "span", "welcome__handle");
    handleLine.id = "welcome-handle";
    const nameError = element(owner, "span", "welcome__error");
    nameError.id = "welcome-name-error";
    nameError.setAttribute("aria-live", "polite");
    nameField.append(handleLine, nameError);

    // The handle is derived and shown, not asked for. It stays editable for
    // the few people who care, behind one click.
    const handleEditRow = element(owner, "div", "welcome__handle-edit");
    handleEditRow.hidden = true;
    const handleLabel = element(owner, "label", "welcome__label",
      localized("Your @handle", "Je @handle"));
    const handleInput = element(owner, "input", "welcome__control welcome__control--handle");
    handleInput.type = "text";
    handleInput.maxLength = 16;
    handleInput.autocomplete = "off";
    handleInput.spellcheck = false;
    handleLabel.append(handleInput);
    handleEditRow.append(handleLabel);
    const handleEdit = element(owner, "button", "welcome__link",
      localized("Choose my @handle myself", "Zelf mijn @handle kiezen"));
    handleEdit.type = "button";

    let handleIsManual = false;
    handleEdit.addEventListener("click", () => {
      handleIsManual = true;
      handleEditRow.hidden = false;
      handleEdit.hidden = true;
      handleInput.value = currentHandle() ?? "";
      handleInput.focus();
      updateHandleLine();
    });

    const currentHandle = (): string | null => {
      if (handleIsManual) {
        const typed = handleInput.value.trim().toLowerCase();
        return usernamePattern.test(typed) ? typed : null;
      }
      const derived = deriveUsername(name.value);
      return derived === null ? null : suggestAvailableUsername(derived, takenUsernames);
    };

    const updateHandleLine = (): void => {
      const typed = name.value.trim();
      if (typed.length === 0) {
        handleLine.textContent = localized(
          "Your @handle is made from this — you'll see it as you type.",
          "Je @handle wordt hiervan gemaakt — je ziet hem terwijl je typt.",
        );
        handleLine.dataset["state"] = "idle";
        return;
      }
      const handle = currentHandle();
      if (handle === null) {
        handleLine.textContent = handleIsManual
          ? localized(
            "A handle is 3-16 characters: a-z, 0-9, '-' or '_'.",
            "Een handle is 3-16 tekens: a-z, 0-9, '-' of '_'.",
          )
          : localized(
            "Add a few letters or numbers so we can make a handle from this.",
            "Voeg wat letters of cijfers toe zodat we er een handle van kunnen maken.",
          );
        handleLine.dataset["state"] = "bad";
        return;
      }
      if (handleIsManual && takenUsernames.has(handle)) {
        handleLine.textContent = localized(
          `@${handle} is already taken. Try another.`,
          `@${handle} is al bezet. Probeer een andere.`,
        );
        handleLine.dataset["state"] = "bad";
        return;
      }
      handleLine.textContent = localized(
        `You'll be @${handle}`,
        `Je wordt @${handle}`,
      );
      handleLine.dataset["state"] = "good";
    };

    name.addEventListener("input", () => {
      nameError.textContent = "";
      name.setAttribute("aria-invalid", "false");
      updateHandleLine();
    });
    handleInput.addEventListener("input", updateHandleLine);

    // Visibility, in the same words Settings uses later.
    const visibility = element(owner, "fieldset", "welcome__choices");
    visibility.append(element(owner, "legend", "welcome__label",
      localized("Who can see your times?", "Wie kan je tijden zien?")));
    const visibilityInputs = new Map<PlayerVisibility, HTMLInputElement>();
    for (const choice of ["public", "private"] as const) {
      const copy = PLAYER_VISIBILITY_COPY[choice];
      const label = element(owner, "label", "welcome__choice");
      const input = element(owner, "input");
      input.type = "radio";
      input.name = "welcome_visibility";
      input.value = choice;
      input.checked = choice === "public";
      const text = element(owner, "span", "welcome__choice-text");
      text.append(element(owner, "strong", undefined, localized(copy.label, dutchPresentation(copy.label))));
      text.append(element(owner, "span", "welcome__hint", localized(copy.explanation, dutchPresentation(copy.explanation))));
      label.append(input, text);
      visibilityInputs.set(choice, input);
      visibility.append(label);
    }

    const actions = element(owner, "div", "welcome__actions");
    const submit = element(owner, "button", "welcome__button welcome__button--primary",
      localized("Create my Player", "Maak mijn speler aan"));
    submit.type = "submit";
    actions.append(submit);

    const switchPath = element(owner, "button", "welcome__link",
      localized(
        "My times or tournament results are already on this site",
        "Mijn tijden of toernooiresultaten staan al op deze site",
      ));
    switchPath.type = "button";
    switchPath.addEventListener("click", () => { renderExisting({ timeTrials: true, tournaments: true }); });

    form.append(nameField, handleEdit, handleEditRow, visibility, actions);
    stage.append(form, switchPath);
    updateHandleLine();
    name.focus();

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (disposed) { return; }
      const displayName = name.value.trim();
      nameError.textContent = "";
      name.setAttribute("aria-invalid", "false");
      if (displayName.length === 0) {
        name.setAttribute("aria-invalid", "true");
        nameError.textContent = localized(
          "Tell us what to call you.", "Vertel ons hoe we je moeten noemen.",
        );
        name.focus();
        return;
      }
      if (displayName.length > 64 || controlCharacters.test(displayName)) {
        name.setAttribute("aria-invalid", "true");
        nameError.textContent = localized(
          "Use at most 64 ordinary characters.",
          "Gebruik maximaal 64 gewone tekens.",
        );
        name.focus();
        return;
      }
      // ADR-0218: display names may repeat. A name already in use is a warning the person confirms by pressing
      // again (their handle gets its own suffix); it is never a refusal.
      if (takenDisplayNames.has(displayName.toLowerCase()) && confirmedSameName !== displayName.toLowerCase()) {
        confirmedSameName = displayName.toLowerCase();
        nameError.textContent = localized(
          "A Player already races under that name. If that Player is you, use “My times or tournament results are already on this site” below. If not, press the button again to create your own Player with this name.",
          "Er rijdt al een speler onder die naam. Ben jij dat, gebruik dan “Mijn tijden of toernooiresultaten staan al op deze site” hieronder. Zo niet, druk dan nog eens op de knop om je eigen speler met deze naam te maken.",
        );
        name.focus();
        return;
      }
      const handle = currentHandle();
      if (handle === null) {
        name.setAttribute("aria-invalid", "true");
        nameError.textContent = localized(
          "We could not make a handle from that name. Add a few letters or numbers, or choose your handle yourself.",
          "We konden hier geen handle van maken. Voeg letters of cijfers toe, of kies zelf je handle.",
        );
        name.focus();
        return;
      }
      operation += 1;
      const current = operation;
      submit.disabled = true;
      switchPath.disabled = true;
      status.textContent = localized("Creating your Player…", "Je speler wordt aangemaakt…");
      const chosenVisibility: PlayerVisibility =
        visibilityInputs.get("private")?.checked === true ? "private" : "public";
      void claims.createOwnPlayer(handle, displayName, controller.signal)
        .then(async (created) => {
          // A Player that exists but could not be made private is reported
          // honestly rather than silently left public.
          const presenceFailed = chosenVisibility === "private" &&
            await visibilityClient
              .setOwn("private", controller.signal)
              .then(() => false, () => true);
          if (disposed || current !== operation) { return; }
          renderExtras({
            username: created.username,
            displayName: created.displayName,
            ...(presenceFailed
              ? {
                warning: localized(
                  "Your Player was created, but it could not be made private just now. You can set that in Settings.",
                  "Je speler is aangemaakt, maar kon nu niet op privé worden gezet. Je kunt dat in Instellingen doen.",
                ),
              }
              : {}),
          });
        })
        .catch((error) => {
          if (disposed || current !== operation) { return; }
          submit.disabled = false;
          switchPath.disabled = false;
          if (!(error instanceof PlayerClaimClientError)) {
            status.textContent = localized(
              "Your Player could not be created. Please try again.",
              "Je speler kon niet worden aangemaakt. Probeer het opnieuw.",
            );
            return;
          }
          if (error.code === "username_taken") {
            takenUsernames = new Set([...takenUsernames, handle]);
            updateHandleLine();
            status.textContent = localized(
              "Somebody just took that handle. We picked the next free one — check it and try again.",
              "Iemand heeft die handle net genomen. We kozen de volgende vrije — controleer hem en probeer opnieuw.",
            );
            return;
          }
          if (error.code === "display_name_taken") {
            takenDisplayNames = new Set([...takenDisplayNames, displayName.toLowerCase()]);
            name.setAttribute("aria-invalid", "true");
            nameError.textContent = localized(
              "A Player already races under that name.",
              "Er rijdt al een speler onder die naam.",
            );
            status.textContent = localized(
              "If that Player is you, use “My times or tournament results are already on this site”.",
              "Ben jij dat, gebruik dan “Mijn tijden of toernooiresultaten staan al op deze site”.",
            );
            return;
          }
          if (error.code === "creation_closed") {
            selfCreationAllowed = false;
            renderCreationClosed();
            return;
          }
          if (error.code === "already_linked") {
            status.textContent = localized(
              "This account already has a Player.",
              "Dit account heeft al een speler.",
            );
            void start();
            return;
          }
          if (error.code === "rate_limited") {
            status.textContent = localized(
              "That is a lot of attempts for one day. Please try again later.",
              "Dat zijn veel pogingen voor één dag. Probeer het later opnieuw.",
            );
            return;
          }
          if (error.code === "not_authenticated") {
            status.textContent = localized(
              "Your sign-in expired. Sign in again — the name you typed is still here.",
              "Je aanmelding is verlopen. Meld je opnieuw aan — de naam die je typte staat er nog.",
            );
            return;
          }
          status.textContent = localized(
            "Your Player could not be created. Please try again.",
            "Je speler kon niet worden aangemaakt. Probeer het opnieuw.",
          );
        });
    });
  };

  // ------------------------------------------------------------ entry point

  const renderAlreadyDone = (): void => {
    clear(stage);
    setHeader(
      "",
      localized("You're all set", "Je bent helemaal klaar"),
      localized(
        "This account already has a Player, so there is nothing left to do here.",
        "Dit account heeft al een speler, dus hier is niets meer te doen.",
      ),
    );
    status.textContent = "";
    const actions = element(owner, "div", "welcome__actions");
    const home = element(owner, "a", "welcome__button welcome__button--primary",
      returnIntent === null
        ? localized("Go to Home", "Naar Home")
        : localized("Continue where you left off", "Verdergaan waar je was"));
    home.href = returnIntent ?? "/";
    const settings = element(owner, "a", "welcome__link",
      localized("Open Settings", "Instellingen openen"));
    settings.href = "/?settings=1";
    actions.append(home, settings);
    stage.append(actions);
  };

  const renderPending = (playerDisplayNames: readonly string[]): void => {
    clear(stage);
    const names = playerDisplayNames.join(" & ");
    setHeader(
      "",
      localized("We're checking", "We zijn aan het controleren"),
      localized(
        `Your request for ${names} is with the team.`,
        `Je verzoek voor ${names} ligt bij het team.`,
      ),
    );
    status.textContent = "";
    const panel = element(owner, "div", "welcome__panel");
    panel.append(element(owner, "p", "welcome__body", localized(
      "You will hear back here. In the meantime you can browse the tracks, the record book and the rankings.",
      "Je hoort het hier. Ondertussen kun je de circuits, het recordboek en de klassementen bekijken.",
    )));
    const actions = element(owner, "div", "welcome__actions");
    const home = element(owner, "a", "welcome__button welcome__button--primary",
      returnIntent === null
        ? localized("Look around", "Rondkijken")
        : localized("Continue where you left off", "Verdergaan waar je was"));
    home.href = returnIntent ?? "/";
    actions.append(home);
    panel.append(actions);
    stage.append(panel);
  };

  // ------------------------------------- step 1: what is already here?

  /**
   * Two questions that decide the path (ADR-0219). Somebody whose Time Trial
   * times or tournament nights are already here has a Player, and the right
   * move is to link it, not to create a namesake beside it (ADR-0178). Two
   * separate questions, because Time Trials and tournaments are often two
   * different records. No and No creates a new Player; any yes finds yourself.
   */
  const renderQuestions = (): void => {
    clear(stage);
    setHeader(
      localized("Step 1 of 3", "Stap 1 van 3"),
      localized("Are you already on this website?", "Sta je al op deze website?"),
      localized(
        "If you are, your results are already here under a Player. We link that Player to your account instead of making a second one.",
        "Zo ja, dan staan je resultaten hier al onder een speler. Die speler koppelen we aan je account in plaats van een tweede aan te maken.",
      ),
    );
    status.textContent = "";
    const panel = element(owner, "div", "welcome__panel");
    const chosen: { timeTrials: boolean | null; tournaments: boolean | null } = { timeTrials: null, tournaments: null };

    const next = element(owner, "button", "welcome__button welcome__button--primary",
      localized("Continue", "Verder"));
    next.type = "button";
    next.disabled = true;
    next.setAttribute("data-welcome-continue", "true");

    const question = (key: "timeTrials" | "tournaments", legend: string): HTMLFieldSetElement => {
      const set = element(owner, "fieldset", "welcome__choices welcome__question");
      set.setAttribute("data-welcome-question", key);
      set.append(element(owner, "legend", "welcome__label", legend));
      const row = element(owner, "div", "welcome__actions");
      const buttons: HTMLButtonElement[] = [];
      for (const [value, label] of [
        [true, localized("Yes", "Ja")],
        [false, localized("No", "Nee")],
      ] as const) {
        const button = element(owner, "button", "welcome__button welcome__answer", label);
        button.type = "button";
        button.setAttribute("data-welcome-answer", value ? "yes" : "no");
        button.setAttribute("aria-pressed", "false");
        button.addEventListener("click", () => {
          chosen[key] = value;
          for (const other of buttons) {
            const pressed = other === button;
            other.setAttribute("aria-pressed", pressed ? "true" : "false");
            other.setAttribute("data-variant", pressed ? "primary" : "secondary");
          }
          next.disabled = chosen.timeTrials === null || chosen.tournaments === null;
        });
        buttons.push(button);
        row.append(button);
      }
      set.append(row);
      return set;
    };

    next.addEventListener("click", () => {
      if (chosen.timeTrials === null || chosen.tournaments === null) { return; }
      // ADR-0221: renderCreate explains instead when only Directors create Players
      // (and a refusal from the server switches to that explanation too).
      if (!chosen.timeTrials && !chosen.tournaments) { renderCreate(); return; }
      renderExisting({ timeTrials: chosen.timeTrials, tournaments: chosen.tournaments });
    });

    panel.append(
      question("timeTrials", localized(
        "Are your Time Trial times already on this website?",
        "Staan je Time Trial-tijden al op deze website?",
      )),
      question("tournaments", localized(
        "Have you taken part in a tournament listed on this site?",
        "Heb je meegedaan aan een toernooi dat op deze site staat?",
      )),
      element(owner, "p", "welcome__body", localized(
        "Not sure? Choose yes and look for your name; you can always turn back.",
        "Twijfel je? Kies ja en zoek je naam; je kunt altijd terug.",
      )),
    );
    const actions = element(owner, "div", "welcome__actions");
    actions.append(next);
    panel.append(actions);
    stage.append(panel);
  };

  const start = async (): Promise<void> => {
    setHeader(
      "",
      localized("Welcome to MK8DX", "Welkom bij MK8DX"),
      localized("Just a moment…", "Een moment…"),
    );
    status.textContent = "";
    const existing = await claims.listMine(controller.signal).catch(() => null);
    if (disposed) { return; }
    if (existing === null) {
      setHeader(
        "",
        localized("Something went wrong", "Er ging iets mis"),
        localized(
          "We could not check your account just now.",
          "We konden je account nu niet controleren.",
        ),
      );
      const retry = element(owner, "button", "welcome__button welcome__button--primary",
        localized("Try again", "Opnieuw proberen"));
      retry.type = "button";
      retry.addEventListener("click", () => { void start(); });
      clear(stage);
      stage.append(retry);
      return;
    }
    const verified = existing.find((claim) => claim.claimStatus === "verified");
    if (verified !== undefined) { renderAlreadyDone(); return; }
    const pending = existing.filter((claim) =>
      claim.claimStatus === "requested" || claim.claimStatus === "under_review");
    if (pending.length > 0) { renderPending(pending.map((claim) => claim.playerDisplayName)); return; }

    renderQuestions();
    // The directory is only needed for suggestions and the "find yourself"
    // path, so it loads behind the first screen instead of delaying it.
    if (!directoryLoaded && claims.listAll !== undefined) {
      const loaded = await claims.listAll(controller.signal).catch(() => null);
      if (disposed || loaded === null) { return; }
      directory = loaded;
      takenUsernames = new Set(loaded.map((player) => player.username.toLowerCase()));
      takenDisplayNames = new Set(loaded.map((player) => player.displayName.trim().toLowerCase()));
      directoryLoaded = true;
      if (status.textContent === localized("Loading the Player list…", "Spelerslijst laden…")) {
        status.textContent = "";
      }
    }
  };

  const ready = start();

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
