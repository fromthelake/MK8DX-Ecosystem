// Settings → Appearance (DESIGN_SYSTEM.md §19, ADR-0205).
//
// The first design-system island inside the still-legacy Settings page: it is a `.ds-root` subtree,
// so it renders in the chosen profile while the legacy page around it keeps its own look until
// Settings migrates (Phase 12). Choosing Light here therefore shows Light immediately, on the very
// control that set it.
//
// Appearance is synced to the account; text size and reduced motion are device-local by decision,
// which the section says in words rather than leaving to be discovered.

import {
  APPEARANCE_CHOICES, TEXT_SCALES,
  type AppearanceChoice, type MotionChoice, type TextScale,
} from "./appearance.js";
import {
  appearanceState, chooseAppearance, chooseReducedMotion, chooseTextScale, onAppearanceChange,
} from "./appearance-runtime.js";
import { el, segmentedControl } from "./ds-components.js";
import { localized } from "./product-language.js";

const CHOICE_LABELS: Readonly<Record<AppearanceChoice, () => string>> = {
  system: () => localized("System", "Systeem"),
  light: () => localized("Light", "Licht"),
  dark: () => localized("Dark", "Donker"),
};

export function mountAppearanceSettings(
  root: HTMLElement,
  options: Readonly<{ signedIn?: boolean }> = {},
): Readonly<{ ready: Promise<void>; unmount(): void }> {
  const signedIn = options.signedIn ?? true;
  const headingId = "appearance-settings-title";
  const section = el("section", "ds-root ds-panel ds-appearance", {
    "data-spectacle": "low", "aria-labelledby": headingId,
  });

  const appearance = segmentedControl<AppearanceChoice>({
    label: localized("Appearance", "Weergave"),
    choices: APPEARANCE_CHOICES.map((value) => ({ value, label: CHOICE_LABELS[value]() })),
    value: appearanceState().choice,
    onChange: (value) => { void chooseAppearance(value, { signedIn }); },
  });
  const textScale = segmentedControl<TextScale>({
    label: localized("Text size", "Tekstgrootte"),
    choices: TEXT_SCALES.map((value) => ({ value, label: `${value}%` })),
    value: appearanceState().textScale,
    onChange: (value) => { chooseTextScale(value); },
  });
  const motion = segmentedControl<MotionChoice>({
    label: localized("Motion", "Beweging"),
    choices: [
      { value: "system", label: localized("Follow system", "Systeem volgen") },
      { value: "on", label: localized("Reduce motion", "Beweging beperken") },
    ],
    value: appearanceState().reducedMotion,
    onChange: (value) => { chooseReducedMotion(value); },
  });

  const group = (label: string, note: string, control: HTMLElement): HTMLElement =>
    el("div", "ds-appearance__group", {},
      el("span", "ds-label ds-appearance__label", {}, label),
      control,
      el("p", "ds-body-s ds-appearance__note", {}, note));

  section.append(
    el("h3", "ds-title", { id: headingId }, localized("Appearance", "Weergave")),
    el("p", "ds-body-s ds-appearance__intro", {}, localized(
      "Dark is the flagship look; Light is fully supported. System follows this device's own setting.",
      "Donker is de hoofdweergave; licht wordt volledig ondersteund. Systeem volgt de instelling van dit apparaat.",
    )),
    group(
      localized("Theme", "Thema"),
      signedIn
        ? localized(
          "Your choice is kept with your account, so your other devices use it too. A device on System still follows its own operating system.",
          "Je keuze hoort bij je account, dus je andere apparaten gebruiken hem ook. Een apparaat op Systeem volgt nog steeds het eigen besturingssysteem.",
        )
        : localized(
          "Kept on this device. Sign in to use the same choice everywhere.",
          "Alleen op dit apparaat bewaard. Meld je aan om overal dezelfde keuze te gebruiken.",
        ),
      appearance.root,
    ),
    group(
      localized("Text size", "Tekstgrootte"),
      localized("This device only.", "Alleen op dit apparaat."),
      textScale.root,
    ),
    group(
      localized("Motion", "Beweging"),
      localized(
        "This device only. Reducing motion never hides information.",
        "Alleen op dit apparaat. Minder beweging verbergt nooit informatie.",
      ),
      motion.root,
    ),
    el("p", "ds-body-s ds-appearance__note", {}, localized(
      "High contrast and forced colours always follow this device's operating system.",
      "Hoog contrast en systeemkleuren volgen altijd het besturingssysteem van dit apparaat.",
    )),
  );
  root.append(section);

  // Another device, or the account, may change the choice while this page is open.
  const stop = onAppearanceChange((next) => {
    appearance.set(next.choice);
    textScale.set(next.textScale);
    motion.set(next.reducedMotion);
  });

  return {
    ready: Promise.resolve(),
    unmount(): void {
      stop();
      if (section.parentNode === root) { root.removeChild(section); }
    },
  };
}
