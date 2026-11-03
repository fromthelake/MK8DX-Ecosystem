// ScanAction and ScanSourcePicker: the scan as a capability of the Post-a-Time task
// (POST_A_TIME_ARCHITECTURE §6, DESIGN_SYSTEM §14, ADR-0206).
//
// Scanning is not a workflow of its own. Inside the one form there is one secondary action - never
// the viewport's A4, which is always Publish - and one question before the camera: which screen are
// you showing it? The answer is remembered, so the second scan is one press away, and it is carried
// to the camera so the camera never asks again.
//
// The camera itself lives on the cross-origin-isolated scanner path, because the Phase 8 spike
// measured that the recognition engine needs its threads (ADR-0206). The Player does not see that:
// they press Scan result, choose the screen if it is their first time, and come back into this same
// task with this same draft, filled in and marked.

import { button, dialog, el } from "./ds-components.js";
import { localized } from "./product-language.js";
import {
  lastScanSource, rememberScanSource, type ScanSource,
} from "./scan-service.js";

export type ScanActionOptions = Readonly<{
  /** True once a scan has filled something in this draft. */
  scanned: boolean;
  onPress: () => void;
}>;

export type ScanActionHandle = Readonly<{
  root: HTMLElement;
  control: HTMLElement;
}>;

/**
 * The action, and the one line that says what it will do. After a scan it says what happened and
 * whose job the checking is, because a recognised value is a proposal, never a verdict.
 */
export function scanAction(options: ScanActionOptions): ScanActionHandle {
  const control = button({
    label: options.scanned
      ? localized("Scan again", "Opnieuw scannen")
      : localized("Scan result", "Scan resultaat"),
    variant: "secondary",
    size: "lg",
    icon: "camera",
    onPress: options.onPress,
  });
  const note = el("p", "ds-micro ds-scan__note", { "data-state": options.scanned ? "scanned" : "idle" },
    options.scanned
      ? localized("Filled from your screenshot. Check every value.",
        "Ingevuld vanaf je schermafbeelding. Controleer elke waarde.")
      : localized("We'll fill in what we can — you check it before publishing.",
        "We vullen in wat we kunnen — jij controleert het voor je publiceert."));
  return {
    root: el("div", "ds-scan", { "data-state": options.scanned ? "scanned" : "idle" },
      control.root, note),
    control: control.control,
  };
}

type SourceCopy = Readonly<{
  title: string;
  summary: string;
  icon: string;
  image: string;
}>;

function sourceCopy(source: ScanSource): SourceCopy {
  if (source === "ghost_detail") {
    return {
      title: localized("Ghost Select screen", "Ghost Select-scherm"),
      summary: localized("One ghost with total time, laps and kart setup.",
        "Eén ghost met totaaltijd, ronden en voertuig."),
      icon: "👻",
      image: "/assets/images/scan/ghost-select.png",
    };
  }
  return {
    title: localized("Race End Screen", "Race-eindscherm"),
    summary: localized("The end time(s) shown directly after a run.",
      "De eindtijd(en) die direct na een race worden getoond."),
    icon: "🎴",
    image: "/assets/images/scan/race-end.jpg",
  };
}

export type ScanSourcePickerOptions = Readonly<{
  /** Called with the chosen screen. Cancel calls nothing. */
  onChoose: (source: ScanSource) => void;
  /** Injectable for tests; the default is this browser's localStorage. */
  storage?: Storage | null;
}>;

/**
 * Which screen the Player is going to show. Two illustrated radio cards, the one they used last
 * marked as such and selected, and a disclosure per card for the person who wants to be told
 * exactly what to point at. Colour is never the only mark of the selected card.
 */
export function openScanSourcePicker(options: ScanSourcePickerOptions): void {
  const remembered = lastScanSource(options.storage);
  let overlay: ReturnType<typeof dialog>;
  const cards = (["ghost_detail", "endscreen"] as const).map((source) => {
    const copy = sourceCopy(source);
    const card = el("button", "ds-scan-source", {
      type: "button", "data-source": source,
      "aria-label": `${copy.icon} ${copy.title}`,
    },
      el("img", "ds-scan-source__image", { src: copy.image, alt: "", loading: "eager" }),
      el("span", "ds-scan-source__body", {},
        el("span", "ds-scan-source__title", {}, `${copy.icon} ${copy.title}`),
        ...(remembered === source
          ? [el("span", "ds-scan-source__last", {},
            localized("Last used", "Laatst gebruikt"))]
          : []),
        el("span", "ds-micro ds-scan-source__summary-text", {}, copy.summary)));
    card.addEventListener("click", () => {
      rememberScanSource(source, options.storage);
      options.onChoose(source);
      overlay.close();
    });
    return card;
  });

  overlay = dialog({
    title: localized("What are you showing?", "Wat laat je zien?"),
    kind: "sheet",
    body: [
      el("p", "ds-micro", {},
        localized("Pick the screen you have in front of you.",
          "Kies het scherm dat je voor je hebt.")),
      el("div", "ds-scan-sources", { "aria-label": localized("Screen", "Scherm") }, ...cards),
    ],
    actions: [],
  });
  overlay.root.addEventListener("close", () => { overlay.root.remove(); }, { once: true });
  overlay.open();
}
