// "Public Player" or "Private Player".
//
// This is a presence choice about the PLAYER — the racing identity — and
// never about the account or the data. A Private Player keeps every result,
// every record and the whole history inside the account; those results are
// simply withdrawn from leaderboards, records, activity and Player search.
// Nothing is deleted, and switching back to Public restores the presence.

import {
  TimeTrialLifecycleClientError,
  createPlayerVisibilityClient,
  type PlayerVisibility,
  type PlayerVisibilityClient,
} from "./time-trial-lifecycle-client.js";

export type MountedPlayerVisibilitySettings = Readonly<{
  container: HTMLElement;
  ready: Promise<void>;
  unmount(): void;
}>;

export const PLAYER_VISIBILITY_COPY = {
  public: {
    label: "Public Player",
    explanation: "Your times appear on leaderboards, in the record book and " +
      "in community activity, and other players can find your profile.",
  },
  private: {
    label: "Private Player",
    explanation: "Your times stay in your account and are taken out of " +
      "leaderboards, records, activity and Player search. Nothing is " +
      "deleted, and you can go public again whenever you like.",
  },
} as const;

export function visibilityFailureMessage(error: unknown): string {
  if (error instanceof TimeTrialLifecycleClientError) {
    if (error.code === "no_verified_player") {
      return "Set up your Player first, then choose how it appears.";
    }
    if (error.code === "not_authenticated") {
      return "Your session has ended. Sign in again to change this.";
    }
  }
  return "That choice could not be saved right now. Please retry.";
}

export function mountPlayerVisibilitySettings(
  root: HTMLElement,
  client: PlayerVisibilityClient = createPlayerVisibilityClient(),
): MountedPlayerVisibilitySettings {
  const document = root.ownerDocument;
  const controller = new AbortController();
  let disposed = false;
  let operation = 0;

  const container = document.createElement("section");
  container.className = "ds-panel player-visibility";
  container.setAttribute("aria-label", "Player visibility");
  const heading = document.createElement("h3");
  heading.className = "ds-title";
  heading.textContent = "How your Player appears";
  const explanation = document.createElement("p");
  explanation.className = "ds-panel__note player-visibility__note";
  explanation.textContent =
    "This decides where your Player shows up. It never deletes anything: " +
    "your results always stay in your account.";
  const choices = document.createElement("fieldset");
  choices.className = "ds-settings-choices player-visibility__choices";
  const legend = document.createElement("legend");
  legend.textContent = "Choose how your Player appears";
  choices.append(legend);
  const inputs = new Map<PlayerVisibility, HTMLInputElement>();
  for (const visibility of ["public", "private"] as const) {
    const copy = PLAYER_VISIBILITY_COPY[visibility];
    const label = document.createElement("label");
    label.className = "ds-settings-choice player-visibility__choice";
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "player_visibility";
    input.value = visibility;
    input.checked = visibility === "public";
    const title = document.createElement("strong");
    title.textContent = copy.label;
    const detail = document.createElement("span");
    detail.className = "ds-field__hint player-visibility__hint";
    detail.textContent = copy.explanation;
    label.append(input, title, detail);
    inputs.set(visibility, input);
    choices.append(label);
  }
  const save = document.createElement("button");
  save.type = "button";
  save.className = "ds-button";
  save.setAttribute("data-variant", "secondary");
  save.textContent = "Save";
  save.disabled = true;
  const status = document.createElement("p");
  status.className = "ds-body-s player-visibility__status";
  status.setAttribute("role", "status");
  status.textContent = "Checking how your Player appears…";
  container.append(heading, explanation, choices, save, status);
  root.append(container);

  const selected = (): PlayerVisibility =>
    inputs.get("private")?.checked === true ? "private" : "public";

  const apply = (visibility: PlayerVisibility): void => {
    for (const [candidate, input] of inputs) {
      input.checked = candidate === visibility;
    }
  };

  save.addEventListener("click", () => {
    if (disposed) { return; }
    const current = ++operation;
    const visibility = selected();
    save.disabled = true;
    status.textContent = "Saving…";
    void client.setOwn(visibility, controller.signal).then((state) => {
      if (disposed || current !== operation) { return; }
      apply(state.visibility);
      status.textContent = state.visibility === "public"
        ? "Saved. You are a Public Player."
        : "Saved. You are a Private Player — your results stay in your " +
          "account and are out of public views.";
      save.disabled = false;
    }).catch((error: unknown) => {
      if (disposed || current !== operation) { return; }
      status.textContent = visibilityFailureMessage(error);
      save.disabled = false;
    });
  });

  const ready = client.read(controller.signal).then((state) => {
    if (disposed) { return; }
    apply(state.visibility);
    status.textContent = state.visibility === "public"
      ? "You are a Public Player."
      : "You are a Private Player.";
    save.disabled = false;
  }).catch((error: unknown) => {
    if (disposed) { return; }
    status.textContent = visibilityFailureMessage(error);
  });

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
