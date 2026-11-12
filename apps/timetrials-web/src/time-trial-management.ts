// Managing one recorded Time Trial, in the Player's own words.
//
// The same panel serves the Player managing their own result and an
// administrator managing anyone's, because the product answer is the same:
// show what the result says now, show what has happened to it, and offer the
// three honest actions — correct it, retire it, bring it back. Which of
// those the caller may actually perform is decided by the server; the panel
// only decides what to OFFER.

import {
  TIME_TRIAL_REASON_CODES,
  TimeTrialLifecycleClientError,
  createTimeTrialLifecycleClient,
  isTimeTrialReasonCode,
  type ManagedCarriedFrom,
  type ManagedTimeTrial,
  type ManagedTimeTrialEvent,
  type TimeTrialCorrection,
  type TimeTrialLifecycleClient,
  type TimeTrialReasonCode,
} from "./time-trial-lifecycle-client.js";
import { schema9WebTrackCatalog } from "./schema9-track-catalog.js";
import { localized, productLocaleTag } from "./product-language.js";
import {
  button,
  chip,
  dialog,
  field,
  nextId,
  useDocument,
  type OverlayHandle,
} from "./ds-components.js";
import { mountPostTimeTask, type MountedPostTimeTask, type PostTimeEditSave } from "./post-time-task.js";
import { createPostTimeDraft, timeMsToDigits, type PostTimeDraft } from "./post-time-model.js";

/**
 * A published result as the Post a Time form holds it (owner 2026-09-28: "manage / edit get the
 * checks ... in the format of Post a Time"). Coins are stored as the balance at each lap's end; the
 * form speaks in the change during the lap, so a lap after an unknown balance has no known change.
 */
export function editDraftOf(result: ManagedTimeTrial): PostTimeDraft {
  const current = result.current;
  const base = createPostTimeDraft(current.trackId, current.modeCc);
  let previous: number | null = 0;
  const laps = base.laps.map((blank, index) => {
    const timeMs = current.laps[index];
    const counts = current.lapDetails?.[index];
    const balance = counts?.coinsCollected;
    let coinChange: number | null = null;
    if (balance === undefined) {
      previous = null;
    } else {
      coinChange = previous === null ? null : balance - previous;
      previous = balance;
    }
    return timeMs === undefined ? blank : {
      timeDigits: timeMsToDigits(timeMs),
      coinChange,
      mushroomsUsed: counts?.mushroomsUsed ?? null,
    };
  });
  const loadout = current.loadout ?? {};
  return {
    ...base,
    totalDigits: timeMsToDigits(current.totalTimeMs),
    laps,
    loadout: {
      characterId: loadout["characterId"] ?? null,
      bodyId: loadout["bodyId"] ?? null,
      tireId: loadout["tireId"] ?? null,
      gliderId: loadout["gliderId"] ?? null,
    },
  };
}

/** The correction a saved edit sends: only what changed travels, so the rest keeps its record. */
export function correctionOf(changes: PostTimeEditSave): TimeTrialCorrection | null {
  const payload = changes.payload;
  if (payload === null) { return null; }
  const loadout = payload.loadout ?? {};
  return {
    totalTimeMs: payload.totalTimeMs,
    laps: payload.laps.map((lap) => lap.timeMs),
    ...(changes.lapCountsChanged ? {
      lapDetails: payload.laps.map((lap) => ({
        ...(lap.coinsCollected === undefined ? {} : { coinsCollected: lap.coinsCollected }),
        ...(lap.mushroomsUsed === undefined ? {} : { mushroomsUsed: lap.mushroomsUsed }),
      })),
    } : {}),
    ...(changes.setupChanged ? {
      loadout: {
        ...(loadout.characterId === undefined ? {} : { characterId: loadout.characterId }),
        ...(loadout.bodyId === undefined ? {} : { bodyId: loadout.bodyId }),
        ...(loadout.tireId === undefined ? {} : { tireId: loadout.tireId }),
        ...(loadout.gliderId === undefined ? {} : { gliderId: loadout.gliderId }),
      },
    } : {}),
    reasonCode: changes.reasonCode,
    ...(changes.note === undefined ? {} : { note: changes.note }),
  };
}

const trackNames = new Map(
  schema9WebTrackCatalog.map((track) => [track.id, track.displayName]),
);

export function trackName(trackId: string): string {
  return trackNames.get(trackId) ?? trackId;
}

export function formatTimeMs(milliseconds: number): string {
  const minutes = Math.floor(milliseconds / 60_000);
  const seconds = Math.floor((milliseconds % 60_000) / 1_000);
  const millis = milliseconds % 1_000;
  return `${minutes}:${String(seconds).padStart(2, "0")}.${
    String(millis).padStart(3, "0")}`;
}

// A lap is read as seconds, the way the game shows it, unless it really
// took more than a minute.
export function formatLapMs(milliseconds: number): string {
  if (milliseconds >= 60_000) { return formatTimeMs(milliseconds); }
  return `${Math.floor(milliseconds / 1_000)}.${
    String(milliseconds % 1_000).padStart(3, "0")}`;
}

// Accepts what a Player actually types: "1:34.612", "94.612", "1:34.6".
export function parseTimeMs(value: string): number | null {
  const match = /^(?:([0-9]{1,2}):)?([0-9]{1,2})\.([0-9]{1,3})$/
    .exec(value.trim());
  if (match === null) { return null; }
  const minutes = Number(match[1] ?? "0");
  const seconds = Number(match[2]);
  const millis = Number((match[3] ?? "").padEnd(3, "0"));
  if (seconds > 59) { return null; }
  const total = (minutes * 60 + seconds) * 1_000 + millis;
  return total >= 1 && total <= 599_999 ? total : null;
}

const reasonPhrases: Readonly<Record<TimeTrialReasonCode, string>> = {
  incorrect_time: "the time was wrong",
  wrong_track_or_mode: "it was the wrong track or mode",
  duplicate: "it was recorded twice",
  test_result: "it was only a test",
  invalid_result: "the run was not valid",
  other: "another reason",
};

const reasonChoices: Readonly<Record<TimeTrialReasonCode, string>> = {
  incorrect_time: "The time is wrong",
  wrong_track_or_mode: "Wrong track or mode",
  duplicate: "I recorded it twice",
  test_result: "It was only a test",
  invalid_result: "The run was not valid",
  other: "Something else",
};

export function describeReasonCode(reasonCode: string): string {
  return isTimeTrialReasonCode(reasonCode)
    ? reasonPhrases[reasonCode]
    : reasonCode.replaceAll("_", " ");
}

const sourceNames: Readonly<Record<string, string>> = {
  web_manual: "entered on the website",
  web_scan: "scanned on the website",
  android_manual: "entered in the Android app",
  android_scan: "scanned in the Android app",
  livetrial_capture: "captured live by the Windows app",
  livetrial_recorded_video: "read from a recording by the Windows app",
};

export function describeSourceKind(sourceKind: string): string {
  return sourceNames[sourceKind] ?? sourceKind.replaceAll("_", " ");
}

// "You retired this result — the time was wrong." The audit trail is a
// story about the result, not a table of codes.
export function describeLifecycleEvent(
  lifecycleEvent: ManagedTimeTrialEvent,
  viewerIsOwner: boolean,
  ownerDisplayName: string,
): string {
  const actor = lifecycleEvent.actorRole === "administrator"
    ? "An administrator"
    : viewerIsOwner
      ? "You"
      : ownerDisplayName;
  const verb = lifecycleEvent.eventType === "corrected"
    ? "corrected"
    : lifecycleEvent.eventType === "retired"
      ? "retired"
      : "brought back";
  const note = lifecycleEvent.note === undefined
    ? ""
    : ` — “${lifecycleEvent.note}”`;
  return `${actor} ${verb} this result — ${
    describeReasonCode(lifecycleEvent.reasonCode)}${note}`;
}

export function describePresence(result: ManagedTimeTrial): string {
  if (result.retirementState === "retired") {
    return "Retired — kept in your account, taken out of public views.";
  }
  return result.publicationStatus === "published"
    ? "Public — visible on leaderboards and your profile."
    : "Not public yet — kept in your account.";
}

/**
 * "Carried from <community> · originally <date>" (ADR-0225): the community's name when the producer
 * gave one, otherwise its address, and the day the time was first submitted there.
 */
export function describeCarriedFrom(carried: ManagedCarriedFrom): string {
  const from = carried.communityName ?? carried.origin.replace(/^https:\/\//, "");
  const originally = new Date(carried.originalSubmittedAtMs).toLocaleDateString(productLocaleTag(), {
    day: "numeric", month: "short", year: "numeric",
  });
  return localized(
    `Carried from ${from} · originally ${originally}`,
    `Meegenomen van ${from} · oorspronkelijk ${originally}`,
  );
}

/** The small marker a carried run carries wherever it is shown in detail or in review. */
export function carriedFromMarker(carried: ManagedCarriedFrom): HTMLElement {
  const marker = chip(describeCarriedFrom(carried), "info");
  marker.classList.add("ds-carried-from");
  marker.setAttribute("title", carried.origin);
  return marker;
}

export type CorrectionDraft = Readonly<{
  totalTime: string;
  laps: readonly string[];
  reasonCode: string;
  note: string;
}>;

export type CorrectionOutcome =
  | Readonly<{ ok: true; correction: TimeTrialCorrection }>
  | Readonly<{ ok: false; message: string }>;

// The same check the server makes, phrased for a person and applied before
// anything is sent, so a typo never becomes a failed request.
export function prepareCorrection(draft: CorrectionDraft): CorrectionOutcome {
  const totalTimeMs = parseTimeMs(draft.totalTime);
  if (totalTimeMs === null) {
    return {
      ok: false,
      message: "Enter the total time as minutes:seconds.milliseconds, " +
        "for example 1:34.612.",
    };
  }
  const entered = draft.laps.filter((lap) => lap.trim() !== "");
  const laps: number[] = [];
  for (const lap of entered) {
    const parsed = parseTimeMs(lap);
    if (parsed === null) {
      return {
        ok: false,
        message: "Enter each lap as seconds.milliseconds, for example 31.204.",
      };
    }
    laps.push(parsed);
  }
  if (laps.length !== 0 && laps.length !== 3 && laps.length !== 7) {
    return {
      ok: false,
      message: "Enter every lap or none at all: this game has 3 laps " +
        "(7 on Baby Park).",
    };
  }
  const sum = laps.reduce((total, lap) => total + lap, 0);
  if (laps.length > 0 && sum !== totalTimeMs) {
    return {
      ok: false,
      message: `Those laps add up to ${formatTimeMs(sum)}, not ${
        formatTimeMs(totalTimeMs)}. Check the numbers.`,
    };
  }
  if (!isTimeTrialReasonCode(draft.reasonCode)) {
    return { ok: false, message: "Choose why this result is changing." };
  }
  const note = draft.note.trim();
  if (note.length > 256) {
    return { ok: false, message: "Keep the note under 256 characters." };
  }
  return {
    ok: true,
    correction: {
      totalTimeMs,
      laps,
      reasonCode: draft.reasonCode,
      ...(note === "" ? {} : { note }),
    },
  };
}

export function lifecycleFailureMessage(error: unknown): string {
  if (!(error instanceof TimeTrialLifecycleClientError)) {
    return "That change could not be saved. Please retry.";
  }
  switch (error.code) {
    case "not_authenticated":
      return "Your session has ended. Sign in again to manage this result.";
    case "forbidden":
      return "You are not allowed to change this result.";
    case "not_found":
      return "That result no longer exists.";
    case "conflict":
      return "This result changed while you were editing it. " +
        "Reopen it and try again.";
    case "invalid_input":
      // The server's own sentence when it gave one (the 12 % World Record guard, YouTube links only).
      return error.detail ?? "Check the time, the laps, and the reason, then try again.";
    default:
      return "That change could not be saved right now. Please retry.";
  }
}

export type MountedTimeTrialManagementPanel = Readonly<{
  container: HTMLElement;
  ready: Promise<void>;
  unmount(): void;
}>;

export type TimeTrialManagementOptions = Readonly<{
  client?: TimeTrialLifecycleClient;
  initial?: ManagedTimeTrial;
  viewerIsOwner?: boolean;
  onChanged?: (result: ManagedTimeTrial) => void;
  /** The label of the button that opens the panel (default "Manage"). */
  buttonLabel?: string;
}>;

function clear(element: HTMLElement): void {
  while (element.firstChild !== null) { element.removeChild(element.firstChild); }
}

function labelled(
  document: Document,
  caption: string,
  control: HTMLElement,
  hint?: string,
): HTMLElement {
  void document;
  const id = control.id || nextId("ds-manage-field");
  control.id = id;
  return field({ label: caption, labelFor: id, control, ...(hint === undefined ? {} : { hint }) });
}
export function reasonSelect(document: Document): HTMLSelectElement {
  const select = document.createElement("select");
  select.className = "ds-select ds-manage__reason";
  for (const reasonCode of TIME_TRIAL_REASON_CODES) {
    const option = document.createElement("option");
    option.value = reasonCode;
    option.textContent = reasonChoices[reasonCode];
    select.append(option);
  }
  select.value = "incorrect_time";
  return select;
}

export function mountTimeTrialManagementPanel(
  root: HTMLElement,
  submissionId: string,
  options: TimeTrialManagementOptions = {},
): MountedTimeTrialManagementPanel {
  const document = root.ownerDocument;
  useDocument(document);
  const client = options.client ?? createTimeTrialLifecycleClient();
  const viewerIsOwner = options.viewerIsOwner ?? true;
  const controller = new AbortController();
  let disposed = false;
  let operation = 0;
  let editTask: MountedPostTimeTask | null = null;

  const container = document.createElement("section");
  container.className = "ds-manage ds-stack";
  container.setAttribute("data-gap", "md");
  container.setAttribute("aria-label", "Manage this Time Trial");
  const status = document.createElement("p");
  status.className = "ds-manage__status ds-micro";
  status.setAttribute("role", "status");
  status.textContent = "Loading this result…";
  const content = document.createElement("div");
  content.className = "ds-manage__content ds-stack";
  container.append(status, content);
  root.append(container);

  const busy = (controls: readonly HTMLElement[], value: boolean): void => {
    for (const control of controls) {
      (control as HTMLButtonElement).disabled = value;
    }
  };

  const render = (result: ManagedTimeTrial): void => {
    clear(content);
    // Administrator lists can mount many of these regions at once. A repeated generic landmark
    // name makes screen-reader navigation ambiguous, so carry the same identifying facts the row
    // exposes plus a short stable submission suffix for otherwise identical duplicate results.
    container.setAttribute(
      "aria-label",
      `Manage ${result.playerDisplayName}'s ${trackName(result.current.trackId)} ${result.current.modeCc}cc Time Trial, ${formatTimeMs(result.current.totalTimeMs)}, submission ${submissionId.slice(-8)}`,
    );
    status.textContent = describePresence(result);
    if (result.carriedFrom !== undefined) {
      content.append(carriedFromMarker(result.carriedFrom));
    }

    const summary = document.createElement("dl");
    summary.className = "ds-manage__facts";
    for (const [term, value] of [
      ["Track", `${trackName(result.current.trackId)} · ${
        result.current.modeCc}cc`],
      ["Time", formatTimeMs(result.current.totalTimeMs)],
      ["Laps", result.current.laps.length === 0
        ? "Not recorded"
        : result.current.laps.map(formatLapMs).join(" · ")],
      ["How it was recorded", describeSourceKind(result.current.sourceKind)],
      ["Video", result.videoUrl ?? "None"],
      ["Version", `${result.current.revision} of ${result.revisions.length}`],
      ["Where it shows", describePresence(result)],
    ] as const) {
      const termNode = document.createElement("dt");
      termNode.textContent = term;
      const valueNode = document.createElement("dd");
      valueNode.textContent = value;
      summary.append(termNode, valueNode);
    }
    content.append(summary);

    const historyHeading = document.createElement("h3");
    historyHeading.textContent = "What has happened to this result";
    const history = document.createElement("ul");
    history.className = "ds-manage__history";
    if (result.events.length === 0) {
      const untouched = document.createElement("li");
      untouched.textContent =
        "Nothing yet — this result is exactly as it was recorded.";
      history.append(untouched);
    }
    for (const lifecycleEvent of [...result.events].reverse()) {
      const row = document.createElement("li");
      const sentence = document.createElement("span");
      sentence.textContent = describeLifecycleEvent(
        lifecycleEvent, viewerIsOwner, result.playerDisplayName,
      );
      const when = document.createElement("span");
      when.className = "ds-manage__when";
      when.textContent = new Date(lifecycleEvent.occurredAtMs)
        .toLocaleDateString();
      row.append(sentence, when);
      history.append(row);
    }
    content.append(historyHeading, history);

    // Fix this result: the Post a Time form itself in edit mode (owner 2026-09-28), so the time,
    // the laps with their coins and mushrooms, the kart setup and the video are entered and checked
    // exactly as when posting. A different track or engine is a different competition, so that
    // stays a retirement plus a new result.
    const correctionForm = document.createElement("div");
    correctionForm.className = "ds-manage__form ds-manage__edit ds-stack";
    correctionForm.setAttribute("data-gap", "md");
    const correctionHeading = document.createElement("h3");
    correctionHeading.textContent = "Fix this result";
    const editHost = document.createElement("div");
    correctionForm.append(correctionHeading, editHost);
    let saved: ManagedTimeTrial = result;
    editTask?.unmount();
    editTask = mountPostTimeTask(editHost, {
      trackId: result.current.trackId,
      mode: result.current.modeCc,
      playerId: result.playerId,
      embedded: true,
      storage: null,
      edit: {
        submissionId: result.submissionId,
        draft: editDraftOf(result),
        videoUrl: result.videoUrl ?? null,
        save: async (changes) => {
          const correction = correctionOf(changes);
          if (correction !== null) {
            saved = await client.correct(result.submissionId, correction, controller.signal);
          }
          if (changes.video !== undefined) {
            saved = await client.setVideo(result.submissionId, changes.video === "" ? null : changes.video, controller.signal);
          }
        },
        failureText: (error) => lifecycleFailureMessage(error),
        onSaved: () => {
          if (disposed) { return; }
          render(saved);
          status.textContent = "Saved. The earlier version stays in this result's history.";
          options.onChanged?.(saved);
        },
      },
    });

    // Retirement: nothing is deleted, the result simply stops being public.
    const retirementForm = document.createElement("form");
    retirementForm.className = "ds-manage__form ds-stack";
    retirementForm.setAttribute("data-gap", "md");
    const retired = result.retirementState === "retired";
    const retirementHeading = document.createElement("h3");
    retirementHeading.textContent = retired
      ? "Bring this result back"
      : "Take this result out of public views";
    const retirementExplanation = document.createElement("p");
    retirementExplanation.className = "ds-field__hint";
    retirementExplanation.textContent = retired
      ? "Bringing it back returns it to leaderboards and profiles under the " +
        "ordinary rules. Nothing was deleted while it was retired."
      : "Retiring keeps the result — and its whole history — in the account. " +
        "It simply stops appearing on leaderboards, records and activity.";
    const retirementReason = reasonSelect(document);
    const retirementNote = document.createElement("input");
    retirementNote.name = "retirement_note";
    retirementNote.maxLength = 256;
    retirementNote.autocomplete = "off";
    retirementNote.className = "ds-input";
    const retirementButton = button({
      label: retired ? "Bring it back" : "Retire this result",
      variant: retired ? "secondary" : "danger",
    });
    (retirementButton.control as HTMLButtonElement).type = "submit";
    retirementForm.append(
      retirementHeading,
      retirementExplanation,
      labelled(document, "Why?", retirementReason),
      labelled(document, "Note (optional)", retirementNote),
      retirementButton.root,
    );
    content.append(correctionForm, retirementForm);

    const controls = [retirementButton.control];
    const apply = (action: Promise<ManagedTimeTrial>): void => {
      const current = ++operation;
      busy(controls, true);
      void action.then((next) => {
        if (disposed || current !== operation) { return; }
        render(next);
        options.onChanged?.(next);
      }).catch((error: unknown) => {
        if (disposed || current !== operation) { return; }
        status.textContent = lifecycleFailureMessage(error);
        busy(controls, false);
      });
    };

    retirementForm.addEventListener("submit", (submitEvent) => {
      submitEvent.preventDefault();
      if (disposed) { return; }
      const reasonCode = retirementReason.value;
      if (!isTimeTrialReasonCode(reasonCode)) {
        status.textContent = "Choose a reason first.";
        return;
      }
      const note = retirementNote.value.trim();
      status.textContent = retired
        ? "Bringing the result back…"
        : "Retiring the result…";
      const action = retired ? client.restore : client.retire;
      apply(action.call(
        client,
        result.submissionId,
        reasonCode,
        note === "" ? undefined : note,
        controller.signal,
      ));
    });
  };

  const ready = options.initial !== undefined
    ? Promise.resolve(render(options.initial))
    : client.read(submissionId, controller.signal).then((result) => {
      if (!disposed) { render(result); }
    }).catch((error: unknown) => {
      if (!disposed) { status.textContent = lifecycleFailureMessage(error); }
    });

  return {
    container,
    ready,
    unmount(): void {
      if (disposed) { return; }
      disposed = true;
      operation += 1;
      editTask?.unmount();
      controller.abort();
      if (container.parentNode === root) { root.removeChild(container); }
    },
  };
}

// The affordance itself: one "Manage" button on the Player's OWN result row
// that opens (and closes) the panel in place. It is never rendered for
// somebody else's result — and the server would refuse anyway.
export function attachOwnerTimeTrialManagement(
  row: HTMLElement,
  submissionId: string,
  options: TimeTrialManagementOptions = {},
): Readonly<{ unmount(): void }> {
  const document = row.ownerDocument;
  useDocument(document);
  const manage = button({ label: options.buttonLabel ?? "Manage", variant: "quiet" });
  const toggle = manage.control;
  const host = document.createElement("div");
  host.className = "ds-manage__host";
  let overlay: OverlayHandle;
  const close = button({
    label: "Close",
    variant: "secondary",
    onPress: () => overlay.close(),
  });
  overlay = dialog({
    title: "Manage Time Trial",
    kind: "dialog",
    body: [host],
    actions: [close.root],
  });
  row.append(manage.root);
  let panel: MountedTimeTrialManagementPanel | null = null;
  toggle.addEventListener("click", () => {
    if (panel === null) { panel = mountTimeTrialManagementPanel(host, submissionId, options); }
    overlay.open();
  });
  return {
    unmount(): void {
      panel?.unmount();
      panel = null;
      if (overlay.root.open) { overlay.close(); }
      overlay.root.remove();
    },
  };
}
