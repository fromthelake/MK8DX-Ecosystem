// ONE part picker, shared by the canonical Post-a-Time task (W08) and the Build configurator (W14).
//
// Both screens ask the same question — which character, body, tires or glider? — over the same
// catalogue, so they ask it the same way: a dialog with the platform's own focus trap, a search
// field over the part names in either language and the design system's `setupPicker` grid with
// radio semantics and roving focus. A tile applies immediately, just as it does in the native app;
// Close leaves the caller's value alone and Not recorded clears an optional Post-a-Time part.
//
// The picker never guesses. An empty picker starts on no option at all, so the reader's first press
// is always a change (the CP1 defect Phase 7 found).
import {
  button,
  dialog,
  el,
  field,
  setupPicker,
} from "./ds-components.js";
import { GAME_ASSET_BASE } from "./asset-manifest.js";
import { dutchPresentation, presentationSearchText } from "./dutch-ui-copy.js";
import { localized } from "./product-language.js";

/** As much of a catalogue part as the picker needs; both callers' part types satisfy it. */
export type PickablePart = Readonly<{ id: string; name: string; iconPath: string }>;

/** How many options one sheet draws; the search is how a reader reaches the rest. */
export const PICKER_OPTION_LIMIT = 120;

export type PartPickerOptions = Readonly<{
  /** The sheet's title, already in the reader's language. */
  title: string;
  parts: readonly PickablePart[];
  /** The part currently chosen, or null when nothing is. */
  value: string | null;
  /**
   * Which icon to draw for a part. Build shows a body in the chosen character's colour, so the
   * caller decides; the default is the part's own icon.
   */
  iconPathOf?: (part: PickablePart) => string;
  /** A part may be left unset (the Post-a-Time task); Build always has one. */
  clearable?: boolean;
  /** Called immediately with the chosen id, or null when the reader clears it. Close calls nothing. */
  onChoose: (partId: string | null) => void;
}>;

/**
 * Opens the picker and returns its handle. The dialog removes itself from the document when it
 * closes, so a route may open it as often as it likes without leaving dialogs behind.
 */
export function openPartPicker(options: PartPickerOptions): void {
  const iconPathOf = options.iconPathOf ?? ((part: PickablePart) => part.iconPath);
  const searchInput = el("input", "ds-text-input", {
    type: "search", autocomplete: "off", maxlength: "64",
    "aria-label": localized("Search parts", "Zoek onderdelen"),
  });
  const gridHost = el("div", "ds-picker-host", {});
  const count = el("p", "ds-visually-hidden", { role: "status", "aria-live": "polite" });
  let overlay: ReturnType<typeof dialog>;

  const choose = (partId: string | null): void => {
    options.onChoose(partId);
    overlay.close();
  };

  const paint = (): void => {
    const query = searchInput.value.toLocaleLowerCase("nl-NL");
    const matches = options.parts.filter((part) =>
      presentationSearchText(part.name).includes(query));
    const choices = matches.slice(0, PICKER_OPTION_LIMIT).map((part) => ({
      value: part.id,
      label: dutchPresentation(part.name),
      art: `${GAME_ASSET_BASE}${iconPathOf(part)}`,
    }));
    count.textContent = matches.length === options.parts.length
      ? localized(`${options.parts.length} options`, `${options.parts.length} opties`)
      : localized(`${matches.length} of ${options.parts.length} options`,
        `${matches.length} van ${options.parts.length} opties`);
    gridHost.replaceChildren(setupPicker<string>({
      label: options.title,
      choices,
      value: options.value,
      onChange: choose,
    }));
  };

  const body: HTMLElement[] = [
    field({ label: localized("Search parts", "Zoek onderdelen"), control: searchInput }),
    count,
  ];
  if (options.clearable === true) {
    body.push(button({
      label: localized("Not recorded", "Niet vastgelegd"), variant: "secondary",
      onPress: () => choose(null),
    }).root);
  }
  body.push(gridHost);

  const close = button({
    label: localized("Close", "Sluiten"), variant: "quiet",
    onPress: () => overlay.close(),
  }).root;

  overlay = dialog({
    title: options.title,
    kind: "dialog",
    body,
    actions: [close],
    actionsFirst: true,
  });
  overlay.root.classList.add("ds-part-picker");

  searchInput.addEventListener("input", paint);
  paint();

  overlay.root.addEventListener("close", () => { overlay.root.remove(); }, { once: true });
  overlay.open();
}
