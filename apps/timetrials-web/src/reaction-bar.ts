// Reusable reaction control for a published Time Trial: grouped summary
// pills (🔥 4  😂 2) plus a compact WhatsApp-style picker with the
// curated vocabulary. One reaction per account; picking again removes,
// picking another replaces. Optimistic with rollback on failure.

import {
  ReactionClientError,
  REACTION_KINDS,
  type ReactionClient,
  type ReactionKind,
  type ReactionSummary,
} from "./reaction-client.js";
import { localized } from "./product-language.js";

export const REACTION_EMOJI: Readonly<Record<ReactionKind, string>> = {
  laugh: "\u{1F602}",
  very_funny: "\u{1F923}",
  crying: "\u{1F62D}",
  nervous: "\u{1F605}",
  wow: "\u{1F62E}",
  unbelievable: "\u{1F631}",
  cool: "\u{1F60E}",
  competitive: "\u{1F624}",
  watching: "\u{1F440}",
  fire: "\u{1F525}",
  fast: "⚡",
  rocket: "\u{1F680}",
  strong: "\u{1F4AA}",
  clap: "\u{1F44F}",
  thumbs_up: "\u{1F44D}",
  trophy: "\u{1F3C6}",
  gold: "\u{1F947}",
  crown: "\u{1F451}",
  target: "\u{1F3AF}",
  heart: "❤️",
};

const REACTION_LABELS: Readonly<Record<ReactionKind, string>> = {
  laugh: "Funny",
  very_funny: "Hilarious",
  crying: "Nooo",
  nervous: "That was close",
  wow: "Wow",
  unbelievable: "Unbelievable",
  cool: "Cool",
  competitive: "Challenge accepted",
  watching: "Watching you",
  fire: "On fire",
  fast: "So fast",
  rocket: "Huge improvement",
  strong: "Strong",
  clap: "Respect",
  thumbs_up: "Good job",
  trophy: "Winner",
  gold: "Number one",
  crown: "Royalty",
  target: "Nailed it",
  heart: "Love it",
};

export type MountedReactionBar = Readonly<{
  element: HTMLElement;
  apply(loaded: ReactionSummary): void;
}>;

export function mountReactionBar(
  document: Document,
  resultId: string,
  client: ReactionClient,
  signal: AbortSignal,
  options: Readonly<{ labelledToggle?: boolean }> = {},
): MountedReactionBar {
  const bar = document.createElement("div");
  bar.className = "ds-reactions";
  let summary: ReactionSummary = { resultId, counts: {} };
  let pickerOpen = false;

  const pills = document.createElement("div");
  pills.className = "ds-reactions__pills";
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "ds-reactions__toggle";
  toggle.textContent = "\u{1F642}+";
  if (options.labelledToggle === true) {
    // The APK's Home wording: "🙂+ React" rather than the bare glyph.
    const word = document.createElement("span");
    word.className = "ds-reactions__toggle-label";
    word.textContent = ` ${localized("React", "Reageer")}`;
    toggle.append(word);
  }
  toggle.setAttribute("aria-label", localized("React to this Time Trial", "Reageer op deze tijdrit"));
  toggle.setAttribute("aria-expanded", "false");
  const picker = document.createElement("div");
  picker.className = "ds-reactions__picker";
  picker.setAttribute("role", "menu");
  picker.setAttribute("hidden", "hidden");
  const hint = document.createElement("span");
  hint.className = "ds-reactions__hint";
  bar.append(pills, toggle, picker, hint);

  const choose = (kind: ReactionKind): void => {
    const previous = summary;
    const removing = summary.mine === kind;
    const counts: Partial<Record<ReactionKind, number>> = { ...summary.counts };
    if (summary.mine !== undefined) {
      const current = counts[summary.mine] ?? 0;
      if (current <= 1) { delete counts[summary.mine]; }
      else { counts[summary.mine] = current - 1; }
    }
    if (!removing) { counts[kind] = (counts[kind] ?? 0) + 1; }
    summary = {
      resultId,
      counts,
      ...(removing ? {} : { mine: kind }),
    };
    hint.textContent = "";
    setPicker(false);
    render();
    const operation = removing
      ? client.remove(resultId, signal)
      : client.react(resultId, kind, signal);
    operation.catch((error: unknown) => {
      summary = previous;
      render();
      if (error instanceof ReactionClientError) {
        if (error.code === "not_authenticated") {
          hint.textContent = localized("Sign in to react.", "Meld je aan om te reageren.");
        } else if (error.code === "own_result") {
          hint.textContent = localized("This is your own time.", "Dit is je eigen tijd.");
        }
      }
    });
  };

  const pickerButtons = new Map<ReactionKind, HTMLButtonElement>();
  for (const kind of REACTION_KINDS) {
    const option = document.createElement("button");
    option.type = "button";
    option.className = "ds-reactions__option";
    option.textContent = REACTION_EMOJI[kind];
    option.title = REACTION_LABELS[kind];
    option.setAttribute("aria-label", REACTION_LABELS[kind]);
    option.addEventListener("click", () => choose(kind));
    pickerButtons.set(kind, option);
    picker.append(option);
  }

  function setPicker(open: boolean): void {
    pickerOpen = open;
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) { picker.removeAttribute("hidden"); }
    else { picker.setAttribute("hidden", "hidden"); }
  }

  toggle.addEventListener("click", () => setPicker(!pickerOpen));

  function render(): void {
    while (pills.firstChild !== null) { pills.removeChild(pills.firstChild); }
    const entries = (Object.entries(summary.counts) as
      [ReactionKind, number][])
      .filter(([, total]) => total > 0)
      .sort((a, b) => b[1] - a[1]);
    for (const [kind, total] of entries) {
      const pill = document.createElement("button");
      pill.type = "button";
      pill.className = "ds-reactions__pill";
      // State in ARIA, never in a --mine modifier class (DESIGN_SYSTEM §24).
      pill.setAttribute("aria-pressed", summary.mine === kind ? "true" : "false");
      pill.textContent = `${REACTION_EMOJI[kind]} ${total}`;
      pill.title = REACTION_LABELS[kind];
      pill.setAttribute(
        "aria-label",
        `${REACTION_LABELS[kind]}: ${total}`,
      );
      pill.addEventListener("click", () => choose(kind));
      pills.append(pill);
    }
    for (const [kind, option] of pickerButtons) {
      option.setAttribute("aria-pressed", summary.mine === kind ? "true" : "false");
    }
  }

  render();
  return {
    element: bar,
    apply(loaded: ReactionSummary): void {
      summary = loaded;
      render();
    },
  };
}
