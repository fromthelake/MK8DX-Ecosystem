// Administration → Installation settings (ADR-0221).
//
// Two choices for the whole installation: who creates Players (self sign-up, Directors, or both) and
// who counts for the one rating (every Player, or only Players with a verified claim). Changing who
// counts never rebuilds ratings silently: the administrator confirms, and the change is followed by
// the same audited recalculation as every other one. When claims change while claims matter, the
// section says the ratings are out of date and offers that recalculation again.

import { confirmDialog } from "./ds-components.js";
import {
  createInstallationSettingsClient,
  InstallationSettingsClientError,
  type InstallationSettingsAdministration,
  type InstallationSettingsClient,
  type PlayerCreationPolicy,
  type RatingEligibilityPolicy,
} from "./installation-settings-client.js";
import { localized, productLocaleTag } from "./product-language.js";

export type MountedInstallationSettingsSection = Readonly<{ ready: Promise<void>; unmount(): void }>;

function clear(element: HTMLElement): void {
  while (element.firstChild !== null) { element.removeChild(element.firstChild); }
}

function when(ms: number): string {
  return new Date(ms).toLocaleString(productLocaleTag(), {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function playerCreationOptions(): readonly (readonly [PlayerCreationPolicy, string])[] {
  return [
    ["self_and_directors", localized(
      "Players sign up themselves, and Directors add Players (default)",
      "Spelers melden zich zelf aan en Directeuren voegen spelers toe (standaard)",
    )],
    ["self_only", localized(
      "Only by signing up: Directors add Players who signed up",
      "Alleen door aanmelden: Directeuren voegen spelers toe die zich hebben aangemeld",
    )],
    ["directors_only", localized(
      "Only Directors create Players; people claim the Player made for them",
      "Alleen Directeuren maken spelers aan; mensen claimen de speler die voor hen is gemaakt",
    )],
  ];
}

function ratingEligibilityOptions(): readonly (readonly [RatingEligibilityPolicy, string])[] {
  return [
    ["all_players", localized("Every Player (default)", "Elke speler (standaard)")],
    ["claimed_only", localized(
      "Only Players with a verified claim",
      "Alleen spelers met een geverifieerde claim",
    )],
  ];
}

function failureText(error: unknown, fallback: string): string {
  if (error instanceof InstallationSettingsClientError) {
    if (error.code === "conflict" && error.serverCode === "installation_settings_conflict") {
      return localized("The settings changed meanwhile. They are reloaded; try again.", "De instellingen zijn intussen gewijzigd. Ze zijn opnieuw geladen; probeer het nog eens.");
    }
    if (error.serverCode === "installation_settings_recompute_unavailable") {
      return localized(
        "The ratings cannot be recalculated on this installation (no rating history to replay).",
        "De ratings kunnen op deze installatie niet worden herberekend (geen ratinggeschiedenis om af te spelen).",
      );
    }
  }
  return fallback;
}

export function mountInstallationSettingsSection(
  root: HTMLElement,
  client: InstallationSettingsClient = createInstallationSettingsClient(),
): MountedInstallationSettingsSection {
  const document = root.ownerDocument;
  const controller = new AbortController();
  let disposed = false;
  const container = document.createElement("section");
  container.className = "installation-settings ds-panel ds-stack";
  container.setAttribute("aria-labelledby", "installation-settings-heading");
  const heading = document.createElement("h2");
  heading.id = "installation-settings-heading";
  heading.className = "ds-panel__title";
  heading.textContent = localized("Installation settings", "Installatie-instellingen");
  const intro = document.createElement("p");
  intro.className = "ds-body";
  intro.textContent = localized(
    "These choices hold for the whole site: who creates Players, and who counts for the rating. Each change is recorded with your name.",
    "Deze keuzes gelden voor de hele site: wie spelers aanmaakt en wie meetelt voor de rating. Elke wijziging wordt met jouw naam vastgelegd.",
  );
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  status.textContent = localized("Loading the installation settings…", "Installatie-instellingen laden…");
  const content = document.createElement("div");
  content.className = "ds-stack";
  container.append(heading, intro, status, content);
  root.append(container);

  let current: InstallationSettingsAdministration | null = null;

  const recompute = (): void => {
    status.textContent = localized("Recalculating every rating…", "Alle ratings worden herberekend…");
    void client.recomputeRatings(controller.signal)
      .then((result) => {
        if (disposed) { return; }
        status.textContent = localized(
          `Ratings recalculated (epoch ${result.epoch}): ${result.ratedPlayers} rated Players, ${result.appliedRaces} races from result sets applied.`,
          `Ratings herberekend (epoch ${result.epoch}): ${result.ratedPlayers} spelers met een rating, ${result.appliedRaces} races uit resultatensets toegepast.`,
        );
        return load(false);
      })
      .catch((error: unknown) => {
        if (disposed) { return; }
        status.textContent = failureText(error, localized("The ratings could not be recalculated.", "De ratings konden niet worden herberekend."));
        void load(false);
      });
  };

  const confirmRecompute = (): void => {
    confirmDialog({
      title: localized("Recalculate every rating?", "Alle ratings herberekenen?"),
      description: localized(
        "Every rating is rebuilt from the whole history under the current rule of who counts, in a new epoch. Earlier epochs stay stored for audit.",
        "Elke rating wordt opnieuw opgebouwd uit de hele geschiedenis met de huidige regel voor wie meetelt, in een nieuwe epoch. Eerdere epochs blijven bewaard.",
      ),
      confirmLabel: localized("Recalculate ratings", "Ratings herberekenen"),
      cancelLabel: localized("Cancel", "Annuleren"),
      onConfirm: recompute,
    }).open();
  };

  const save = (patch: Readonly<{ playerCreation?: PlayerCreationPolicy; ratingEligibility?: RatingEligibilityPolicy }>, thenRecompute: boolean): void => {
    if (current === null) { return; }
    status.textContent = localized("Saving…", "Opslaan…");
    void client.update({ expectedRevision: current.revision, ...patch }, controller.signal)
      .then((saved) => {
        if (disposed) { return; }
        current = saved;
        render(saved);
        status.textContent = localized("Saved.", "Opgeslagen.");
        if (thenRecompute) { recompute(); }
      })
      .catch((error: unknown) => {
        if (disposed) { return; }
        status.textContent = failureText(error, localized("The settings could not be saved.", "De instellingen konden niet worden opgeslagen."));
        void load(false);
      });
  };

  const choice = <T extends string>(
    label: string,
    hint: string,
    options: readonly (readonly [T, string])[],
    selected: T,
    onChange: (value: T, select: HTMLSelectElement) => void,
  ): HTMLElement => {
    const wrapper = document.createElement("label");
    wrapper.className = "ds-field";
    const title = document.createElement("span");
    title.className = "ds-label";
    title.textContent = label;
    const select = document.createElement("select");
    select.className = "ds-select";
    select.setAttribute("aria-label", label);
    for (const [value, optionLabel] of options) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = optionLabel;
      option.selected = value === selected;
      select.append(option);
    }
    select.addEventListener("change", () => { onChange(select.value as T, select); });
    const help = document.createElement("span");
    help.className = "ds-body";
    help.textContent = hint;
    wrapper.append(title, select, help);
    return wrapper;
  };

  const render = (settings: InstallationSettingsAdministration): void => {
    clear(content);
    content.append(choice(
      localized("Who creates Players", "Wie maakt spelers aan"),
      localized(
        "A closed path shows people an explanation instead of the button; the server refuses it too.",
        "Een gesloten route toont uitleg in plaats van de knop; de server weigert hem ook.",
      ),
      playerCreationOptions(),
      settings.playerCreation,
      (value) => { save({ playerCreation: value }, false); },
    ));
    content.append(choice(
      localized("Who counts for the rating", "Wie telt mee voor de rating"),
      localized(
        "Players without a verified claim still play and appear in the standings; with the second choice their races do not change any rating and they have none. An approved claim makes a Player count, including the nights already played, after the next recalculation.",
        "Spelers zonder geverifieerde claim spelen mee en staan in de uitslag; bij de tweede keuze veranderen hun races geen rating en hebben ze er zelf geen. Een goedgekeurde claim laat een speler meetellen, ook voor de al gespeelde avonden, na de volgende herberekening.",
      ),
      ratingEligibilityOptions(),
      settings.ratingEligibility,
      (value, select) => {
        confirmDialog({
          title: localized("Change who counts for the rating?", "Wijzigen wie meetelt voor de rating?"),
          description: value === "claimed_only"
            ? localized(
              "From now on only Players with a verified claim count. Every rating is then recalculated from the whole history: unclaimed Players lose their rating, and the races they were in are rated among the others.",
              "Vanaf nu tellen alleen spelers met een geverifieerde claim mee. Daarna wordt elke rating herberekend uit de hele geschiedenis: spelers zonder claim verliezen hun rating en hun races worden onder de anderen gerekend.",
            )
            : localized(
              "From now on every Player counts. Every rating is then recalculated from the whole history.",
              "Vanaf nu telt elke speler mee. Daarna wordt elke rating herberekend uit de hele geschiedenis.",
            ),
          confirmLabel: localized("Change and recalculate", "Wijzigen en herberekenen"),
          cancelLabel: localized("Cancel", "Annuleren"),
          tone: "danger",
          onConfirm: () => { save({ ratingEligibility: value }, true); },
        }).open();
        // Until confirmed, the select keeps showing what is saved.
        select.value = settings.ratingEligibility;
      },
    ));
    const recomputeStatus = settings.ratingRecompute;
    const last = document.createElement("p");
    last.className = "ds-body";
    last.textContent = recomputeStatus.lastRecalculatedAtMs === null
      ? localized("The ratings were never recalculated on this installation.", "De ratings zijn op deze installatie nog nooit herberekend.")
      : localized(
        `Last recalculation: ${when(recomputeStatus.lastRecalculatedAtMs)}.`,
        `Laatste herberekening: ${when(recomputeStatus.lastRecalculatedAtMs)}.`,
      );
    content.append(last);
    if (recomputeStatus.needed) {
      const notice = document.createElement("div");
      notice.className = "installation-settings__notice ds-stack";
      notice.setAttribute("role", "alert");
      const reason = document.createElement("p");
      reason.className = "ds-body";
      reason.textContent = recomputeStatus.eligibilityChanged
        ? localized(
          "The ratings do not follow the current rule yet: who counts changed after the last recalculation.",
          "De ratings volgen de huidige regel nog niet: wie meetelt is gewijzigd na de laatste herberekening.",
        )
        : localized(
          `The ratings do not follow the current claims yet: ${recomputeStatus.claimChanges} claim change(s) of Players with races since the last recalculation.`,
          `De ratings volgen de huidige claims nog niet: ${recomputeStatus.claimChanges} claimwijziging(en) van spelers met races sinds de laatste herberekening.`,
        );
      const button = document.createElement("button");
      button.type = "button";
      button.className = "ds-button";
      button.setAttribute("data-variant", "primary");
      button.textContent = localized("Recalculate ratings now", "Ratings nu herberekenen");
      button.addEventListener("click", confirmRecompute);
      notice.append(reason, button);
      content.append(notice);
    }
  };

  const load = async (resetStatus = true): Promise<void> => {
    try {
      const settings = await client.administration(controller.signal);
      if (disposed) { return; }
      current = settings;
      if (resetStatus) { status.textContent = ""; }
      render(settings);
    } catch (error) {
      if (disposed) { return; }
      if (error instanceof InstallationSettingsClientError && error.code === "not_authorized") {
        if (container.parentNode === root) { root.removeChild(container); }
        return;
      }
      status.textContent = localized(
        "The installation settings are temporarily unavailable.",
        "De installatie-instellingen zijn tijdelijk niet beschikbaar.",
      );
    }
  };

  const ready = load();
  return {
    ready,
    unmount(): void {
      if (disposed) { return; }
      disposed = true;
      controller.abort();
      if (container.parentNode === root) { root.removeChild(container); }
    },
  };
}
