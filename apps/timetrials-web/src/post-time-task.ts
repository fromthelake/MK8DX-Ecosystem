// The canonical Post-a-Time task (docs/design-system/POST_A_TIME_ARCHITECTURE.md; DESIGN_SYSTEM §14).
//
// ONE task. It is the whole of W08, it is what the track page (W07) opens for entry, and it is what
// a returning scan fills. There is no "scan result / enter manually" choice, no second form, no
// second validator and no second review: typing and scanning are two ways of filling the same
// fields, and everything downstream is shared.
//
//   Shared Tracks & Cups chooser (only when the track is unknown)
//   EngineSelector · TimeInput · RaceDetails (LapRow × 3 or 7) · SetupSummary + SetupPicker
//   PredictionPanel (the client port of the server's feedback) · PublishAction (armed, two press)
//
// A successful send ends in an observable confirmation and returns to Home; a failed send keeps the
// draft editable. That boundary makes it unambiguous whether the task is finished.

import {
  armedButton, artThumb, button, el, engineMark, engineSelector, field, nextId, panel,
  setupSummary, statusMessage, stepper, timeInput, useDocument,
  type EngineSelectorHandle, type SetupPart, type TimeInputHandle,
} from "./ds-components.js";
import { formatDelta, formatTime } from "./ds-numeric.js";
import { GAME_ASSET_BASE, trackAsset } from "./asset-manifest.js";
import {
  BODY_PARTS, CHARACTER_PARTS, GLIDER_PARTS, TIRE_PARTS, type LoadoutPart,
} from "./loadout-manifest.js";
import { loadoutVariantById, matchedLoadoutVariant, type LoadoutVariant } from "./loadout-variants.js";
import { COUNTRY_ASSET_MANIFEST } from "./asset-manifest.js";
import { dutchPresentation } from "./dutch-ui-copy.js";
import { mountCupsView, type MountedCupsView } from "./ds-cups.js";
import { openPartPicker } from "./ds-setup-picker.js";
import { scanAction } from "./ds-scan.js";
import { localized, sourceLanguage } from "./product-language.js";
import type { WebTrackCatalogEntry } from "./schema9-track-catalog.js";
import {
  applyPayload, applyScan, clearDraft, clearLap, clearLaps, coinBalances, createPostTimeDraft, errorFor,
  formatDraftDigits, hasMeaningfulData, lapCoinField, lapMushroomField, lapTimeField, loadDraft,
  loadoutField, LOADOUT_PART_KEYS, saveDraft, setLapCoinChange, setLapDigits, setLapMushrooms,
  setCountry, setLoadoutPart, setMode, setTotalDigits, setTrack, TOTAL_FIELD, COUNTRY_FIELD, trackEntry, trackLapCount,
  validatePostTime, type EngineMode, type LoadoutPartKey, type PostTimeDraft, type ScanFill,
  type ScanVariants,
} from "./post-time-model.js";
import { predictFromBoard, type BoardRow, type SubmissionPrediction } from "./post-time-prediction.js";
import { ruleMessage } from "./time-trial-rules.generated.js";
import {
  createWebManualAuthenticatedBootstrapClient, WebManualBootstrapError,
  type WebManualAuthenticatedBootstrapClient,
} from "./manual-authenticated-bootstrap.js";
import { decodeWebManualContextJson } from "./manual-context-json.js";
import { parseWebManualContextDocument } from "./manual-context-document.js";
import { createWebManualSubmission } from "./manual-submission.js";
import type { WebManualTimeTrialSubmissionV1 } from "./manual-submission.js";
import {
  createWebManualSameOriginPublicationClient, WebManualPublicationError,
  type WebManualPublicationErrorCode, type WebManualSameOriginPublicationClient,
  type WebManualSubmissionFeedback,
} from "./manual-publication-client.js";
import type { WebManualAuthenticatedSessionBoundary } from "./post-time-session.js";
import type { ValidatedPayload } from "./post-time-model.js";
import { TIME_TRIAL_REASON_CODES, type TimeTrialReasonCode } from "./time-trial-lifecycle-client.js";
import { videoLinkProblem } from "./youtube-link.js";

/** Why a published result is being changed, in the Player's words (the lifecycle reason codes). */
function reasonLabel(code: TimeTrialReasonCode): string {
  switch (code) {
    case "incorrect_time": return localized("A value was wrong", "Een waarde klopte niet");
    case "wrong_track_or_mode": return localized("Wrong track or engine class", "Verkeerd circuit of verkeerde klasse");
    case "duplicate": return localized("It is a duplicate", "Het is een dubbele");
    case "test_result": return localized("It was a test", "Het was een test");
    case "invalid_result": return localized("The result is not valid", "Het resultaat is niet geldig");
    case "other": return localized("Something else", "Iets anders");
  }
}

/** The parts of a result an edit compares, to send only what the Player changed. */
function resultKey(payload: ValidatedPayload): string {
  return JSON.stringify([payload.totalTimeMs, payload.laps.map((lap) => lap.timeMs)]);
}
function countsKey(payload: ValidatedPayload): string {
  return JSON.stringify(payload.laps.map((lap) => [lap.coinsCollected ?? null, lap.mushroomsUsed ?? null]));
}
function setupKey(payload: ValidatedPayload): string {
  const loadout = payload.loadout ?? {};
  return JSON.stringify([loadout.characterId ?? null, loadout.bodyId ?? null, loadout.tireId ?? null, loadout.gliderId ?? null]);
}

export type PostTimePublicationState =
  | Readonly<{ kind: "idle" }>
  | Readonly<{ kind: "sending" }>
  | Readonly<{ kind: "published"; feedback?: WebManualSubmissionFeedback }>
  | Readonly<{ kind: "failed"; code: WebManualPublicationErrorCode; retryable: boolean }>;

export interface PostTimeBoardClient {
  /** The (track, mode) leaderboard the prediction is computed over. */
  leaderboard(trackId: string, mode: EngineMode, signal?: AbortSignal): Promise<readonly BoardRow[]>;
  /** The Player's own best on this combo when the board does not carry it. */
  ownBest(playerId: string, trackId: string, mode: EngineMode, signal?: AbortSignal): Promise<number | null>;
  rivals(signal?: AbortSignal): Promise<ReadonlySet<string>>;
}

export type PostTimeTaskOptions = Readonly<{
  /** Null opens the shared Tracks & Cups chooser first (POST_A_TIME §9, "track unknown"). */
  trackId: string | null;
  mode: EngineMode;
  /** The signed-in Player, for the draft key and for leaving their own row out of the field. */
  playerId: string;
  /** Rendered inside the track page rather than as its own route: no heading of its own. */
  embedded?: boolean;
  bootstrapClient?: WebManualAuthenticatedBootstrapClient;
  publicationClient?: WebManualSameOriginPublicationClient;
  boardClient?: PostTimeBoardClient;
  /** Values a scan handed back, filling the SAME form (POST_A_TIME §11). */
  scanFill?: ScanFill | null;
  /** Where the scanner lives, when this deployment has one. */
  scanHref?: string | null;
  onScan?: () => void;
  onTrackChosen?: (trackId: string) => void;
  onModeChanged?: (mode: EngineMode) => void;
  onPublicationState?: (state: PostTimePublicationState) => void;
  onPublished?: (submission: WebManualTimeTrialSubmissionV1) => void;
  /** Finish the task after its observable confirmation screen (normally: return to Home). */
  onComplete?: () => void;
  completionDelayMs?: number;
  storage?: Storage | null;
  now?: () => number;
  /**
   * Attaches the optional YouTube link to the result just published (owner 2026-09-28: "Video is
   * optional in Post a Time and can also be added later in Manage").
   */
  videoClient?: Readonly<{ setVideo(submissionId: string, videoUrl: string | null): Promise<unknown> }>;
  /**
   * Edit mode (Manage): the same form, fields and checks, filled with a published result. Track and
   * engine are fixed (a different one is a different competition: retire and post again), nothing is
   * scanned, predicted or kept as a draft, and saving is a correction instead of a publication.
   */
  edit?: PostTimeEdit;
}>;

export type PostTimeEditSave = Readonly<{
  /** The corrected result; null when only the video changed. */
  payload: ValidatedPayload | null;
  /** Which parts of the result changed, so an untouched part keeps what it recorded. */
  lapCountsChanged: boolean;
  setupChanged: boolean;
  /** The new video link ("" removes it); undefined when it did not change. */
  video: string | undefined;
  reasonCode: TimeTrialReasonCode;
  note: string | undefined;
}>;

export type PostTimeEdit = Readonly<{
  submissionId: string;
  draft: PostTimeDraft;
  videoUrl: string | null;
  save(changes: PostTimeEditSave): Promise<void>;
  /** A sentence to show when saving failed; null keeps the generic one. */
  failureText?(error: unknown): string | null;
  onSaved?(): void;
}>

export type MountedPostTimeTask = Readonly<{
  root: HTMLElement;
  draft(): PostTimeDraft;
  selectedTrack(): WebTrackCatalogEntry | null;
  publicationState(): PostTimePublicationState;
  /** The heading the task focuses on open, so a route can move the reader into it. */
  heading: HTMLElement;
  unmount(): void;
}>;

const PART_SETS: Readonly<Record<LoadoutPartKey, readonly LoadoutPart[]>> = {
  characterId: CHARACTER_PARTS,
  bodyId: BODY_PARTS,
  tireId: TIRE_PARTS,
  gliderId: GLIDER_PARTS,
};

function partLabel(key: LoadoutPartKey): string {
  switch (key) {
    case "characterId": return localized("Character", "Personage");
    case "bodyId": return localized("Kart", "Kart");
    case "tireId": return localized("Tyres", "Banden");
    case "gliderId": return localized("Glider", "Paraglider");
  }
}

/**
 * The colour a part is shown in. The picker offers base parts only (SPEC §7 D8), but a scanned
 * colour variant is shown while its base part is unchanged, and a matched body or glider follows
 * the (scanned) character's colour - the same rule as the APK's androidPostTimePartVisual.
 */
export function partVariant(
  key: LoadoutPartKey,
  id: string,
  loadout: Readonly<Record<LoadoutPartKey, string | null>>,
  scanned: ScanVariants | undefined,
): LoadoutVariant | undefined {
  const characterId = loadout.characterId;
  const scannedCharacter = characterId !== null &&
    loadoutVariantById(scanned?.characterId)?.baseId === characterId
    ? scanned?.characterId : undefined;
  const exact = loadoutVariantById(key === "characterId" ? scannedCharacter
    : key === "bodyId" || key === "gliderId" ? scanned?.[key] : undefined);
  if (exact !== undefined && exact.baseId === id) { return exact; }
  if (key !== "bodyId" && key !== "gliderId") { return undefined; }
  const rider = scannedCharacter ?? characterId;
  return rider === null ? undefined : matchedLoadoutVariant(id, rider);
}

function partName(
  key: LoadoutPartKey,
  id: string | null,
  loadout: Readonly<Record<LoadoutPartKey, string | null>>,
  scanned?: ScanVariants,
): string | null {
  if (id === null) { return null; }
  const part = PART_SETS[key].find((candidate) => candidate.id === id);
  if (part === undefined) { return null; }
  const variant = partVariant(key, part.id, loadout, scanned);
  return dutchPresentation(variant === undefined ? part.name : `${part.name} · ${variant.name}`);
}

function partArt(
  key: LoadoutPartKey,
  id: string | null,
  loadout: Readonly<Record<LoadoutPartKey, string | null>>,
  scanned?: ScanVariants,
): string | undefined {
  if (id === null) { return undefined; }
  const part = PART_SETS[key].find((candidate) => candidate.id === id);
  if (part === undefined) { return undefined; }
  const variant = partVariant(key, part.id, loadout, scanned);
  return `${GAME_ASSET_BASE}${variant?.iconPath ?? part.iconPath}`;
}

/** The coin artwork the track actually shows (rupees on Hyrule, bells on Animal Crossing). */
function coinIconPath(trackId: string | null): string {
  const file = trackId === "track.hyrule_circuit" ? "002_rupee.png"
    : trackId === "track.animal_crossing" ? "003_bell.png" : "000_coin.png";
  return `${GAME_ASSET_BASE}images/items/icons/${file}`;
}

function bootstrapFailure(error: unknown): Readonly<{ text: string; retryable: boolean }> {
  if (!(error instanceof WebManualBootstrapError)) {
    return { text: localized("Could not open Post a time.", "Kon Tijd plaatsen niet openen."), retryable: true };
  }
  if (error.code === "not_authenticated") {
    return { text: localized("Sign in to post a time.", "Meld je aan om een tijd te plaatsen."), retryable: false };
  }
  if (error.code === "not_authorized") {
    return {
      text: localized("Your account is not linked to an eligible Player.",
        "Je account is niet gekoppeld aan een speler die tijden mag plaatsen."),
      retryable: false,
    };
  }
  return error.retryable
    ? { text: localized("Could not connect. Try again.", "Geen verbinding. Probeer het opnieuw."), retryable: true }
    : { text: localized("Could not open Post a time.", "Kon Tijd plaatsen niet openen."), retryable: false };
}

/** The server's coarse rejection reason, said in the Player's words (SPEC §7 D9). */
function rejectionText(code: WebManualPublicationErrorCode): string {
  switch (code) {
    case "invalid_submission":
    case "submission_rejected":
      return localized("The server did not accept these values. Check the total time and the laps.",
        "De server accepteerde deze waarden niet. Controleer de totaaltijd en de ronden.");
    case "implausible_time":
      // More than 12 % faster than the World Record: the owner's own words (2026-09-28).
      return localized("The proposed time is highly unreasonable, please double check all information.",
        "De voorgestelde tijd is zeer onwaarschijnlijk, controleer alle gegevens nog eens.");
    case "revision_conflict":
      return localized("This time was already published.", "Deze tijd is al gepubliceerd.");
    case "not_authenticated":
      return localized("Your session ended. Sign in again.", "Je sessie is verlopen. Meld je opnieuw aan.");
    case "not_authorized":
      return localized("Your account may not publish for this Player.",
        "Je account mag geen tijd publiceren voor deze speler.");
    default:
      return localized("Publishing failed — try again.", "Publiceren is mislukt — probeer het opnieuw.");
  }
}

// ---------------------------------------------------------------- the mount

export function mountPostTimeTask(
  host: HTMLElement,
  options: PostTimeTaskOptions,
): MountedPostTimeTask {
  useDocument(host.ownerDocument);
  const now = options.now ?? (() => Date.now());
  const storage = options.storage === undefined
    ? (() => { try { return globalThis.sessionStorage ?? null; } catch { return null; } })()
    : options.storage;
  const bootstrapClient = options.bootstrapClient ?? createWebManualAuthenticatedBootstrapClient();
  const publicationClient = options.publicationClient ?? createWebManualSameOriginPublicationClient();
  const board = options.boardClient ?? null;

  const root = el("div", "ds-root ds-post", { "data-embedded": options.embedded ? "" : null });
  const heading = el("h1", "ds-title ds-post__title", {},
    localized("Post a time", "Tijd plaatsen"));
  heading.hidden = options.embedded === true;
  const status = el("p", "ds-post__status", { role: "status", "aria-live": "polite" });
  /** The one place a notice about the task itself is shown, so a repaint never loses it. */
  const notice = el("div", "ds-post__notice", {});
  notice.hidden = true;
  const body = el("div", "ds-post__body", {});
  root.append(heading, status, notice, body);
  host.append(root);

  let disposed = false;
  let draft = createPostTimeDraft(options.trackId, options.mode);
  let touched = new Set<string>();
  let attempted = false;
  let publication: PostTimePublicationState = { kind: "idle" };
  let session: WebManualAuthenticatedSessionBoundary | null = null;
  let controller: AbortController | null = null;
  let publishController: AbortController | null = null;
  let boardRows: readonly BoardRow[] = [];
  let boardLoaded = false;
  let ownBestMs: number | null = null;
  let rivalIds: ReadonlySet<string> = new Set();
  let scanPending: ScanFill | null = options.scanFill ?? null;
  let restored = false;
  let trackSelector: MountedCupsView | null = null;
  let lapsDisclosureOpen: boolean | null = null;
  let completionTimer: ReturnType<typeof setTimeout> | null = null;
  const edit = options.edit ?? null;
  // The optional YouTube link (both modes) and, when editing, why the result changes.
  let videoValue = edit?.videoUrl ?? "";
  let reasonCode: TimeTrialReasonCode = "incorrect_time";
  let noteValue = "";
  let editOriginal: ValidatedPayload | null = null;

  const setPublication = (state: PostTimePublicationState): void => {
    publication = state;
    options.onPublicationState?.(state);
  };

  // ---- shared Tracks & Cups selection (only reached when the track is unknown)

  const renderTrackSelector = (): void => {
    trackSelector?.unmount();
    body.replaceChildren();
    heading.hidden = true;
    status.hidden = true;
    trackSelector = mountCupsView(body, {
      engine: draft.mode,
      purpose: "post",
      trackHref: (trackId) => `/?post=${encodeURIComponent(trackId)}&mode=${draft.mode}`,
      onTrackChosen: chooseTrack,
      onEngineChange: (mode) => {
        draft = setMode(draft, mode);
        options.onModeChanged?.(mode);
      },
    });
  };

  const chooseTrack = (trackId: string): void => {
    trackSelector?.unmount();
    trackSelector = null;
    draft = setTrack(draft, trackId);
    options.onTrackChosen?.(trackId);
    void start();
  };

  // ---- the form

  let engineHandle: EngineSelectorHandle | null = null;
  let totalInput: TimeInputHandle | null = null;
  let publish: ReturnType<typeof armedButton> | null = null;
  let repaint: () => void = () => undefined;
  let leaveConfirmation: () => void = () => undefined;

  const disarm = (): void => {
    publish?.disarm();
    leaveConfirmation();
  };

  const mark = (fieldPath: string): void => {
    touched.add(fieldPath);
    // The published confirmation belongs to the time that was sent. The moment the Player starts
    // the next one, the panel goes back to predicting rather than reporting.
    if (publication.kind === "published") { setPublication({ kind: "idle" }); }
  };

  const errorText = (fieldPath: string): string | undefined => {
    if (!attempted && !touched.has(fieldPath)) { return undefined; }
    const result = validatePostTime(draft);
    const found = errorFor(result.errors, fieldPath);
    return found === null ? undefined : ruleMessage(found, sourceLanguage());
  };

  const sourceOf = (fieldPath: string): Readonly<{ kind: "scan" | "edited"; label: string }> | undefined => {
    if (draft.origin[fieldPath] === "scanned") {
      return { kind: "scan", label: localized("Scanned", "Gescand") };
    }
    if (draft.scan !== null && touched.has(fieldPath)) {
      return { kind: "edited", label: localized("Edited", "Aangepast") };
    }
    return undefined;
  };

  const doubtOf = (fieldPath: string): string | undefined =>
    draft.doubt.includes(fieldPath)
      ? localized("Check this one.", "Controleer deze even.")
      : undefined;

  const persist = (): void => {
    // An edit is not a draft of a new result: nothing is kept between visits.
    if (edit !== null) { return; }
    saveDraft(options.playerId, draft, now(), storage);
  };

  // ---- prediction

  const predictionRoot = el("div", "ds-post__prediction", {});

  const neighbourLine = (
    neighbour: SubmissionPrediction["ahead"],
    keepsExistingBest: boolean,
  ): HTMLElement | null => {
    if (neighbour === null) { return null; }
    const line = el("p", "ds-post__neighbour", {});
    const name = el("a", "ds-post__neighbour-name", {
      href: `/?player=${encodeURIComponent(neighbour.username)}`,
    }, `${neighbour.displayName}${keepsExistingBest ? "" : ":"}`);
    if (neighbour.rival) { name.classList.add("ds-post__neighbour-name--rival"); }
    const outcome = neighbour.gapMs > 0
      ? localized("behind", "achter")
      : neighbour.gapMs < 0
        ? localized("ahead", "voor")
        : localized("level", "gelijk");
    const relationship = keepsExistingBest
      ? localized(
        `remains ${formatDelta(neighbour.gapMs)} · your PB is ${outcome}.`,
        `blijft ${formatDelta(neighbour.gapMs)} · je PR ligt ${outcome}.`)
      : localized(
        `${formatDelta(neighbour.gapMs)} · you would be ${outcome}.`,
        `${formatDelta(neighbour.gapMs)} · je zou ${outcome} liggen.`);
    line.append(
      el("span", "ds-micro", {}, localized("Delta to", "Delta met")), " ", name,
      " ",
      el("span", "ds-post__neighbour-gap", {
        "data-direction": neighbour.gapMs < 0 ? "faster" : neighbour.gapMs > 0 ? "slower" : "even",
      }, relationship),
    );
    return line;
  };

  const renderPrediction = (): void => {
    const result = validatePostTime(draft);
    const language = sourceLanguage();
    const children: (Node | string | null)[] = [];
    if (edit !== null) {
      // An edit predicts nothing: it says whether every value is right, like Post a Time does.
      const checks = el("ul", "ds-post__checks", {});
      const videoProblem = videoLinkProblem(videoValue, language);
      if (result.valid && videoProblem === null) {
        checks.append(el("li", "ds-post__check", { "data-ok": "" },
          localized("Everything checks out.", "Alles klopt.")));
      } else {
        const seen = new Set<string>();
        for (const ruleError of result.errors) {
          const text = ruleMessage(ruleError, language);
          if (text === "" || seen.has(text)) { continue; }
          seen.add(text);
          checks.append(el("li", "ds-post__check", {}, text));
        }
        if (videoProblem !== null) { checks.append(el("li", "ds-post__check", {}, videoProblem)); }
      }
      predictionRoot.replaceChildren(panel({
        title: localized("Checks", "Controle"), titleLevel: 2, children: [checks],
      }));
      return;
    }
    if (publication.kind === "published") {
      // The server's answer is authoritative and replaces the prediction (POST_A_TIME §5).
      const feedback = publication.feedback;
      children.push(statusMessage("success",
        localized("Published.", "Gepubliceerd.")));
      if (feedback !== undefined) { children.push(renderFeedback(feedback)); }
      children.push(el("p", "ds-post__again", {},
        localized("Submission confirmed.", "Inzending bevestigd.")));
    } else if (draft.totalDigits === "") {
      children.push(el("p", "ds-post__hint", {},
        options.scanHref === null || options.scanHref === undefined
          ? localized("Type your total time.", "Vul je totaaltijd in.")
          : localized("Type your total time — or scan it.", "Vul je totaaltijd in — of scan hem.")));
    } else if (result.payload === null) {
      children.push(el("p", "ds-post__hint", {},
        localized("Finish the fields below and the prediction appears here.",
          "Maak de velden hieronder af, dan verschijnt de voorspelling hier.")));
    } else {
      const prediction = predictFromBoard(result.payload.totalTimeMs, {
        rows: boardRows, ownPlayerId: options.playerId, ownBestMs, rivalPlayerIds: rivalIds,
      });
      children.push(el("p", "ds-post__big", {},
        el("span", "ds-data-xl", {}, formatTime(prediction.totalTimeMs)),
        engineMark(draft.mode, "md")));
      const best = prediction.personalBest;
      children.push(el("p", "ds-post__pb", { "data-outcome": best.previousBestMs === null ? "first" : best.deltaMs === 0 ? "equal" : best.improved ? "improved" : "slower" },
        best.previousBestMs === null
          ? localized("Your first time on this track in this engine class.",
            "Je eerste tijd op dit circuit in deze klasse.")
          : best.deltaMs === 0
            ? localized("Personal best matched — this run becomes your current PB with its added details.",
              "Persoonlijk record geëvenaard — deze run wordt je actuele PR met de toegevoegde details.")
          : best.improved
            ? localized(`Personal best — ${formatDelta(best.deltaMs!)} faster than ${formatTime(best.previousBestMs)}.`,
              `Persoonlijk record — ${formatDelta(best.deltaMs!)} sneller dan ${formatTime(best.previousBestMs)}.`)
            : localized(`This time is ${formatDelta(best.deltaMs!)} slower than your ${formatTime(best.previousBestMs)} PB.`,
                `Deze tijd is ${formatDelta(best.deltaMs!)} langzamer dan je PR van ${formatTime(best.previousBestMs)}.`)));
      if (!boardLoaded) {
        children.push(el("p", "ds-micro", {},
          localized("Loading the leaderboard for the predicted position…",
            "Het klassement wordt geladen voor de voorspelde positie…")));
      } else if (prediction.rank.after === null) {
        children.push(el("p", "ds-post__rank", {},
          localized("Outside the top 100.", "Buiten de top 100.")));
      } else {
        const field = prediction.field.complete ? prediction.field.count : `${prediction.field.count}+`;
        const keepsExistingBest = best.previousBestMs !== null && best.deltaMs !== null && best.deltaMs > 0;
        children.push(el("p", "ds-post__rank", {}, keepsExistingBest
          ? localized(
            `Your leaderboard position stays #${prediction.rank.after} of ${field}, based on your ${formatTime(best.previousBestMs!)} PB.`,
            `Je blijft #${prediction.rank.after} van ${field}, op basis van je PR van ${formatTime(best.previousBestMs!)}.`)
          : localized(
            `Predicted position ${prediction.rank.after} of ${field}.`,
            `Voorspelde positie ${prediction.rank.after} van ${field}.`)));
        const ahead = neighbourLine(prediction.ahead, keepsExistingBest);
        const behind = neighbourLine(prediction.behind, keepsExistingBest);
        if (ahead !== null) { children.push(ahead); }
        if (behind !== null) { children.push(behind); }
        if (prediction.rank.passedCount > 0) {
          children.push(el("p", "ds-post__passed", {},
            prediction.rank.rivalsPassed > 0
              ? localized(
                `You would pass ${prediction.rank.passedCount} ${prediction.rank.passedCount === 1 ? "player" : "players"}, ${prediction.rank.rivalsPassed} of them ${prediction.rank.rivalsPassed === 1 ? "a rival" : "rivals"}.`,
                `Je haalt ${prediction.rank.passedCount} ${prediction.rank.passedCount === 1 ? "speler" : "spelers"} in, waarvan ${prediction.rank.rivalsPassed} ${prediction.rank.rivalsPassed === 1 ? "rivaal" : "rivalen"}.`)
              : localized(
                `You would pass ${prediction.rank.passedCount} ${prediction.rank.passedCount === 1 ? "player" : "players"}.`,
                `Je haalt ${prediction.rank.passedCount} ${prediction.rank.passedCount === 1 ? "speler" : "spelers"} in.`)));
        }
      }
    }
    // The checklist: every outstanding rule, in one place, beside the per-field messages (§13).
    if (publication.kind !== "published") {
      const checks = el("ul", "ds-post__checks", {});
      if (result.valid) {
        checks.append(el("li", "ds-post__check", { "data-ok": "" },
          localized("Everything checks out.", "Alles klopt.")));
      } else {
        const seen = new Set<string>();
        for (const ruleError of result.errors) {
          if (ruleError.rule === "total_required" && draft.totalDigits === "") { continue; }
          const text = ruleMessage(ruleError, language);
          if (text === "" || seen.has(text)) { continue; }
          seen.add(text);
          checks.append(el("li", "ds-post__check", {}, text));
        }
      }
      if (checks.childElementCount > 0) { children.push(checks); }
    }
    predictionRoot.replaceChildren(panel({
      title: localized("Your time", "Jouw tijd"),
      titleLevel: 2,
      label: localized("Prediction", "Voorspelling"),
      children,
    }));
  };

  const complete = (): void => {
    if (disposed) { return; }
    if (completionTimer !== null) {
      clearTimeout(completionTimer);
      completionTimer = null;
    }
    options.onComplete?.();
  };

  const renderCompletion = (feedback?: WebManualSubmissionFeedback, videoNote: string | null = null): void => {
    heading.hidden = false;
    heading.textContent = localized("Time posted", "Tijd geplaatst");
    status.hidden = false;
    status.textContent = localized(
      "Your time has been published.", "Je tijd is gepubliceerd.",
    );
    notice.hidden = true;
    const home = button({
      label: localized("Go to Home now", "Nu naar Home"),
      variant: "primary",
      onPress: complete,
    });
    const children: (Node | string | null)[] = [
      statusMessage("success", localized(
        "Your time has been posted.", "Je tijd is geplaatst.",
      )),
    ];
    if (feedback !== undefined) { children.push(renderFeedback(feedback)); }
    if (videoNote !== null) { children.push(el("p", "ds-post__completion-video", {}, videoNote)); }
    children.push(el("p", "ds-post__completion-note", {}, localized(
      "Taking you back to Home…", "Je gaat terug naar Home…",
    )));
    body.replaceChildren(panel({
      title: localized("Published", "Gepubliceerd"),
      titleLevel: 2,
      actions: [home.root],
      children,
    }));
    heading.setAttribute("tabindex", "-1");
    heading.focus();
    if (options.onComplete !== undefined) {
      completionTimer = setTimeout(complete, options.completionDelayMs ?? 2_000);
    }
  };

  const renderFeedback = (feedback: WebManualSubmissionFeedback): HTMLElement => {
    const wrap = el("div", "ds-post__feedback", {});
    const { personalBest, rank } = feedback;
    const time = formatTime(feedback.totalTimeMs);
    wrap.append(el("p", "ds-post__big", {}, el("span", "ds-data-xl", {}, time),
      engineMark(feedback.modeCc === 200 ? 200 : 150, "md")));
    wrap.append(el("p", "ds-post__pb", {},
      personalBest.previousBestMs === null || personalBest.deltaMs === null
        ? localized("First time on this track in this engine class.",
          "Eerste tijd op dit circuit in deze klasse.")
        : personalBest.deltaMs === 0
          ? localized("Personal best matched — this run is now your current PB with its added details.",
            "Persoonlijk record geëvenaard — deze run is nu je actuele PR met de toegevoegde details.")
        : personalBest.improved
          ? localized(`New personal best, ${formatDelta(personalBest.deltaMs)} faster than ${formatTime(personalBest.previousBestMs)}.`,
            `Nieuw persoonlijk record, ${formatDelta(personalBest.deltaMs)} sneller dan ${formatTime(personalBest.previousBestMs)}.`)
          : localized(`${formatDelta(personalBest.deltaMs)} behind your best of ${formatTime(personalBest.previousBestMs)}.`,
              `${formatDelta(personalBest.deltaMs)} achter je beste tijd van ${formatTime(personalBest.previousBestMs)}.`)));
    wrap.append(el("p", "ds-post__rank", {},
      rank.before === null
        ? localized(`You enter the leaderboard at #${rank.after}.`, `Je komt binnen op #${rank.after}.`)
        : rank.after < rank.before
          ? localized(`Now #${rank.after}, up from #${rank.before}.`, `Nu #${rank.after}, omhoog van #${rank.before}.`)
          : localized(`You stay #${rank.after}.`, `Je blijft #${rank.after}.`)));
    if (rank.passedCount > 0) {
      const passed = el("p", "ds-post__passed", {});
      passed.append(el("span", "", {}, rank.rivalsPassed > 0
        ? localized(`Passed ${rank.passedCount} ${rank.passedCount === 1 ? "player" : "players"}, ${rank.rivalsPassed} of them ${rank.rivalsPassed === 1 ? "a rival" : "rivals"}: `,
          `Ingehaald: ${rank.passedCount} ${rank.passedCount === 1 ? "speler" : "spelers"}, ${rank.rivalsPassed} ${rank.rivalsPassed === 1 ? "rivaal" : "rivalen"}: `)
        : localized(`Passed ${rank.passedCount} ${rank.passedCount === 1 ? "player" : "players"}: `,
          `Ingehaald: ${rank.passedCount} ${rank.passedCount === 1 ? "speler" : "spelers"}: `)));
      rank.passed.forEach((player, index) => {
        if (index > 0) { passed.append(", "); }
        const link = el("a", "ds-post__neighbour-name", {
          href: `/?player=${encodeURIComponent(player.username)}`,
        }, player.displayName);
        if (player.rival) { link.classList.add("ds-post__neighbour-name--rival"); }
        passed.append(link);
      });
      wrap.append(passed);
    }
    return wrap;
  };

  // ---- the form DOM

  const renderForm = (): void => {
    trackSelector?.unmount();
    trackSelector = null;
    heading.hidden = options.embedded === true;
    status.hidden = false;
    const track = trackEntry(draft.trackId);
    const lapCount = trackLapCount(draft.trackId);
    const result = validatePostTime(draft);
    body.replaceChildren();
    status.textContent = track === null ? "" : localized(
      `${dutchPresentation(track.displayName)} · ${track.lapCount} laps`,
      `${dutchPresentation(track.displayName)} · ${track.lapCount} ronden`);

    // --- engine (EngineContext: never the scanner, never a fixed 150). An edit keeps its engine:
    // a different engine class is a different competition (retire the result and post again).
    const fixedEngine = edit === null ? null : field({
      label: localized("Engine class", "Motorklasse"),
      control: engineMark(draft.mode, "lg"),
      hint: localized("A different track or engine class is a new result: retire this one and post again.",
        "Een ander circuit of een andere klasse is een nieuw resultaat: trek dit in en plaats het opnieuw."),
    });
    engineHandle = engineSelector({
      label: localized("Engine class", "Motorklasse"),
      value: draft.mode,
      onChange: (mode) => {
        draft = setMode(draft, mode);
        // A mode switch discards and recomputes everything derived from it, and disarms.
        disarm();
        boardLoaded = false;
        boardRows = [];
        ownBestMs = null;
        options.onModeChanged?.(mode);
        persist();
        void loadBoard();
        repaint();
      },
      size: "lg",
    });

    // --- total time
    const totalErrorId = nextId("ds-post-total-error");
    const totalError = errorText(TOTAL_FIELD);
    totalInput = timeInput({
      label: localized("Total time", "Totaaltijd"),
      digits: draft.totalDigits,
      ...(totalError === undefined ? {} : { invalid: true, describedBy: totalErrorId }),
      ...(draft.doubt.includes(TOTAL_FIELD) ? { doubt: true } : {}),
      onInput: (digits) => {
        mark(TOTAL_FIELD);
        draft = setTotalDigits(draft, digits);
        if (totalInput !== null && totalInput.digits() !== draft.totalDigits) {
          totalInput.set(draft.totalDigits);
        }
        disarm();
        persist();
        renderPrediction();
        paintPublish();
        paintFieldError(totalFieldNode, TOTAL_FIELD);
        paintFieldSource(totalFieldNode, TOTAL_FIELD);
        paintFieldDoubt(totalFieldNode, TOTAL_FIELD);
      },
    });
    const totalSource = sourceOf(TOTAL_FIELD);
    const totalDoubt = doubtOf(TOTAL_FIELD);
    const totalFieldNode = field({
      label: localized("Total time", "Totaaltijd"),
      control: totalInput.root,
      hint: localized("Six digits: 145912 is 1:45.912.", "Zes cijfers: 145912 is 1:45.912."),
      ...(totalSource === undefined ? {} : { source: totalSource }),
      ...(totalDoubt === undefined ? {} : { doubt: totalDoubt }),
      ...(totalError === undefined ? {} : { error: totalError, errorId: totalErrorId }),
    });

    // ScanAction (POST_A_TIME §6): one secondary action inside the form, never the viewport's A4.
    const scanNode = options.scanHref === null || options.scanHref === undefined || edit !== null
      ? null
      : scanAction({
        scanned: draft.scan !== null,
        onPress: () => options.onScan?.(),
      }).root;

    // --- laps, coins, mushrooms
    const lapsBodyId = nextId("ds-post-laps");
    const lapsBody = el("div", "ds-post__laps", { id: lapsBodyId });
    const anyLapData = draft.laps.some((lap) =>
      lap.timeDigits !== "" || lap.coinChange !== null || lap.mushroomsUsed !== null);
    let lapsOpen = lapsDisclosureOpen ?? (anyLapData || draft.scan !== null);
    const lapsToggle = el("button", "ds-post__disclosure", {
      type: "button", "aria-expanded": lapsOpen ? "true" : "false", "aria-controls": lapsBodyId,
    }, localized("Lap times, coins and mushrooms", "Rondetijden, munten en paddenstoelen"));
    const lapsSummary = el("p", "ds-micro ds-post__laps-summary", {});
    const paintLapsSummary = (): void => {
      lapsSummary.textContent = anyLapDataNow()
        ? draft.laps.map((lap, index) =>
          lap.timeDigits === ""
            ? localized(`Lap ${index + 1} —`, `Ronde ${index + 1} —`)
            : formatDraftDigits(lap.timeDigits)).join(" · ")
        : localized("Optional. Leave blank if you only recorded the total.",
          "Optioneel. Laat leeg als je alleen de totaaltijd hebt.");
    };
    const anyLapDataNow = (): boolean => draft.laps.some((lap) =>
      lap.timeDigits !== "" || lap.coinChange !== null || lap.mushroomsUsed !== null);
    lapsToggle.addEventListener("click", () => {
      lapsOpen = !lapsOpen;
      lapsDisclosureOpen = lapsOpen;
      lapsToggle.setAttribute("aria-expanded", lapsOpen ? "true" : "false");
      lapsBody.hidden = !lapsOpen;
    });
    lapsBody.hidden = !lapsOpen;
    paintLapsSummary();

    const balances = (): readonly number[] => coinBalances(draft);
    const lapNodes: HTMLElement[] = [];
    for (let index = 0; index < lapCount; index += 1) {
      const lap = draft.laps[index]!;
      const timeField = lapTimeField(index);
      const timeErrorId = nextId("ds-post-lap-error");
      const timeErrorText = errorText(timeField);
      const lapTime = timeInput({
        label: localized(`Lap ${index + 1} time`, `Tijd ronde ${index + 1}`),
        digits: lap.timeDigits,
        size: "compact",
        ...(timeErrorText === undefined ? {} : { invalid: true, describedBy: timeErrorId }),
        ...(draft.doubt.includes(timeField) ? { doubt: true } : {}),
        onInput: (digits) => {
          mark(timeField);
          draft = setLapDigits(draft, index, digits);
          if (lapTime.digits() !== draft.laps[index]!.timeDigits) {
            lapTime.set(draft.laps[index]!.timeDigits);
          }
          disarm();
          persist();
          paintLapsSummary();
          paintCoinValues();
          renderPrediction();
          paintPublish();
          paintFieldError(lapFieldNode, timeField);
          paintFieldSource(lapFieldNode, timeField);
          paintFieldDoubt(lapFieldNode, timeField);
        },
      });
      const lapSource = sourceOf(timeField);
      const lapDoubt = doubtOf(timeField);
      const lapFieldNode = field({
        label: localized("Time", "Tijd"),
        control: lapTime.root,
        ...(lapSource === undefined ? {} : { source: lapSource }),
        ...(lapDoubt === undefined ? {} : { doubt: lapDoubt }),
        ...(timeErrorText === undefined ? {} : { error: timeErrorText, errorId: timeErrorId }),
      });

      // Coins: a signed change with the running balance beside it. A stepper rather than a text
      // field, so a lone "+" or "-" cannot exist at all (SPEC §7 D4).
      const coinValue = el("span", "ds-post__balance", {});
      const coinControl = stepper({
        label: localized(`Lap ${index + 1} coins`, `Munten ronde ${index + 1}`),
        value: lap.coinChange ?? 0,
        min: -10, max: 10,
        decrementLabel: localized(`One coin fewer in lap ${index + 1}`, `Eén munt minder in ronde ${index + 1}`),
        incrementLabel: localized(`One coin more in lap ${index + 1}`, `Eén munt meer in ronde ${index + 1}`),
        format: (value) => (value > 0 ? `+${value}` : value < 0 ? `−${-value}` : "0"),
        onChange: (value) => {
          mark(lapCoinField(index));
          draft = setLapCoinChange(draft, index, value);
          disarm();
          persist();
          paintCoinValues();
          renderPrediction();
          paintPublish();
        },
      });
      const coinError = errorText(lapCoinField(index));
      const coinFieldNode = field({
        label: localized("Coins", "Munten"),
        control: el("span", "ds-post__coins", {},
          el("img", "ds-post__coin-icon", { src: coinIconPath(draft.trackId), alt: "" }),
          coinControl, coinValue),
        ...(coinError === undefined ? {} : { error: coinError }),
      });

      // Mushrooms: four one-tap values; pressing the chosen one again clears it (POST_A_TIME §6).
      const mushroomGroup = el("div", "ds-post__mushrooms", {
        role: "group", "aria-label": localized(`Mushrooms used, lap ${index + 1}`, `Paddenstoelen ronde ${index + 1}`),
      });
      const mushroomButtons = [0, 1, 2, 3].map((value) => {
        const node = el("button", "ds-post__count", {
          type: "button",
          "aria-pressed": lap.mushroomsUsed === value ? "true" : "false",
          "aria-label": localized(`Lap ${index + 1}: ${value} mushrooms`, `Ronde ${index + 1}: ${value} paddenstoelen`),
        }, String(value));
        node.addEventListener("click", () => {
          const current = draft.laps[index]!.mushroomsUsed;
          mark(lapMushroomField(index));
          draft = setLapMushrooms(draft, index, current === value ? null : value);
          disarm();
          persist();
          paintMushrooms();
          renderPrediction();
          paintPublish();
        });
        return { value, node };
      });
      const paintMushrooms = (): void => {
        for (const entry of mushroomButtons) {
          entry.node.setAttribute("aria-pressed",
            draft.laps[index]!.mushroomsUsed === entry.value ? "true" : "false");
        }
      };
      mushroomGroup.append(
        el("img", "ds-post__coin-icon", { src: `${GAME_ASSET_BASE}images/items/icons/014_mushroom.png`, alt: "" }),
        ...mushroomButtons.map((entry) => entry.node));
      const mushroomFieldNode = field({
        label: localized("Mushrooms", "Paddenstoelen"),
        control: mushroomGroup,
      });

      const paintCoinValues = (): void => {
        const balance = balances()[index] ?? 0;
        coinValue.textContent = draft.laps[index]!.coinChange === null
          ? localized("not recorded", "niet genoteerd")
          : localized(`balance ${balance}`, `saldo ${balance}`);
      };
      paintCoinValues();
      const clearOne = button({
        label: localized("Clear", "Wis"),
        variant: "quiet",
        size: "sm",
        onPress: () => {
          draft = clearLap(draft, index);
          lapsDisclosureOpen = true;
          attempted = false;
          disarm();
          persist();
          repaint();
        },
      });
      clearOne.control.setAttribute("aria-label", localized(
        `Clear lap ${index + 1}`, `Wis ronde ${index + 1}`,
      ));
      lapNodes.push(el("div", "ds-post__lap", {},
        el("div", "ds-post__lap-head", {},
          el("span", "ds-post__lap-title", {}, localized(`Lap ${index + 1}`, `Ronde ${index + 1}`)),
          clearOne.root),
        lapFieldNode, coinFieldNode, mushroomFieldNode));
    }
    const lapsError = errorText("laps");
    lapsBody.append(...lapNodes);
    if (lapsError !== undefined) {
      lapsBody.append(el("p", "ds-field__error", {}, lapsError));
    }
    lapsBody.append(button({
      label: localized("Clear all", "Wis alles"),
      variant: "quiet",
      onPress: () => {
        draft = clearLaps(draft);
        lapsDisclosureOpen = true;
        attempted = false;
        disarm();
        persist();
        repaint();
      },
    }).root);

    // --- kart setup
    const parts: readonly SetupPart[] = LOADOUT_PART_KEYS.map((key) => {
      const name = partName(key, draft.loadout[key], draft.loadout, draft.scan?.variants);
      const art = partArt(key, draft.loadout[key], draft.loadout, draft.scan?.variants);
      const doubt = doubtOf(loadoutField(key));
      return {
        kind: partLabel(key), name,
        ...(art === undefined ? {} : { art }),
        ...(doubt === undefined ? {} : { doubt }),
      };
    });
    const setup = setupSummary({
      label: localized("Kart setup", "Kartopstelling"),
      parts,
      emptyName: localized("Add", "Toevoegen"),
      onOpen: (index) => openPicker(LOADOUT_PART_KEYS[index]!),
    });

    // --- the flag on the scanned card (ADR-0215): only a scan brings it; the Player may change or
    // remove it. It silently follows the scan, also when it is not the Player's own country.
    let countryFieldNode: HTMLElement | null = null;
    let countryFact: HTMLElement | null = null;
    if (draft.countryId !== null || draft.corrected.includes("country")) {
      const countrySelect = el("select", "ds-select ds-post__country", {
        "aria-label": localized("Flag", "Vlag"),
      }) as HTMLSelectElement;
      countrySelect.append(el("option", "", { value: "" }, localized("No flag", "Geen vlag")));
      const countries = [...COUNTRY_ASSET_MANIFEST]
        .map((country) => ({ id: country.id, name: dutchPresentation(country.name), flagPath: country.flagPath }))
        .sort((a, b) => a.name.localeCompare(b.name));
      for (const country of countries) {
        countrySelect.append(el("option", "", { value: country.id }, country.name));
      }
      countrySelect.value = draft.countryId ?? "";
      countrySelect.addEventListener("change", () => {
        draft = setCountry(draft, countrySelect.value === "" ? null : countrySelect.value);
        disarm();
        persist();
        repaint();
      });
      const countryDoubt = doubtOf(COUNTRY_FIELD);
      countryFieldNode = field({
        label: localized("Flag", "Vlag"),
        control: countrySelect,
        hint: countryDoubt ?? localized("The flag on the scanned card.", "De vlag op de gescande kaart."),
      });
      const chosen = countries.find((country) => country.id === draft.countryId);
      countryFact = el("div", "ds-post__confirm-part", {},
        ...(chosen === undefined ? [] : [el("img", "", { src: `${GAME_ASSET_BASE}${chosen.flagPath}`, alt: "" })]),
        el("span", "ds-micro", {}, localized("Flag", "Vlag")),
        el("strong", "", {}, chosen?.name ?? localized("No flag", "Geen vlag")));
    }

    // --- the optional YouTube video (owner 2026-09-28)
    const videoInput = el("input", "ds-input ds-post__video", {
      type: "url", inputmode: "url", autocomplete: "off", spellcheck: "false",
      placeholder: "https://youtu.be/…",
      "aria-label": localized("Video (YouTube)", "Video (YouTube)"),
    }) as HTMLInputElement;
    videoInput.value = videoValue;
    const videoFieldNode = field({
      label: localized("Video (YouTube)", "Video (YouTube)"),
      control: videoInput,
      hint: edit === null
        ? localized("Optional. A link to your run on YouTube — you can also add it later in Manage.",
          "Optioneel. Een link naar je rit op YouTube — dit kan ook later via Beheren.")
        : localized("Optional. Leave empty to remove the video.",
          "Optioneel. Laat leeg om de video te verwijderen."),
    });
    const paintVideoError = (): void => {
      const problem = videoLinkProblem(videoValue, sourceLanguage());
      const existing = videoFieldNode.querySelector(".ds-field__error");
      if (problem === null) { existing?.remove(); videoInput.removeAttribute("aria-invalid"); return; }
      videoInput.setAttribute("aria-invalid", "true");
      if (existing !== null) { existing.textContent = problem; return; }
      videoFieldNode.append(el("span", "ds-field__error", {}, problem));
    };
    videoInput.addEventListener("input", () => {
      videoValue = videoInput.value;
      disarm();
      paintVideoError();
      renderPrediction();
      paintPublish();
    });
    if (videoValue !== "") { paintVideoError(); }

    // --- why an edit changes the result (the lifecycle's own reasons)
    let reasonNodes: HTMLElement[] = [];
    if (edit !== null) {
      const reasonSelect = el("select", "ds-select ds-post__reason", {
        "aria-label": localized("Why is it changing?", "Waarom verandert het?"),
      }) as HTMLSelectElement;
      for (const code of TIME_TRIAL_REASON_CODES) {
        reasonSelect.append(el("option", "", { value: code }, reasonLabel(code)));
      }
      reasonSelect.value = reasonCode;
      reasonSelect.addEventListener("change", () => { reasonCode = reasonSelect.value as TimeTrialReasonCode; });
      const noteInput = el("input", "ds-input ds-post__note", {
        type: "text", maxlength: "256", autocomplete: "off",
        "aria-label": localized("Note (optional)", "Notitie (optioneel)"),
      }) as HTMLInputElement;
      noteInput.value = noteValue;
      noteInput.addEventListener("input", () => { noteValue = noteInput.value; });
      reasonNodes = [
        field({ label: localized("Why is it changing?", "Waarom verandert het?"), control: reasonSelect,
          hint: localized("Only asked when the result itself changes.", "Alleen nodig als het resultaat zelf verandert.") }),
        field({ label: localized("Note (optional)", "Notitie (optioneel)"), control: noteInput }),
      ];
    }

    // --- publish (or, in an edit, save)
    publish = armedButton({
      label: edit === null
        ? localized(`Publish · ${draft.mode}cc`, `Publiceer · ${draft.mode}cc`)
        : localized("Save changes", "Wijzigingen opslaan"),
      armedLabel: edit === null
        ? localized(`Confirm and publish · ${draft.mode}cc`, `Bevestig en publiceer · ${draft.mode}cc`)
        : localized("Confirm and save", "Bevestig en sla op"),
      nextStep: edit === null
        ? localized("Review the summary, then confirm · nothing is published yet",
          "Controleer de samenvatting en bevestig · er is nog niets gepubliceerd")
        : localized("Review the summary, then confirm · nothing is saved yet",
          "Controleer de samenvatting en bevestig · er is nog niets opgeslagen"),
      icon: "stopwatch",
      onConfirm: () => { void send(); },
    });
    publish.control.setAttribute("data-engine", String(draft.mode));
    const publishReason = el("p", "ds-micro ds-post__publish-reason", {});
    const paintPublish = (): void => {
      const outcome = validatePostTime(draft);
      const control = publish!.control;
      if (publication.kind === "sending") {
        control.setAttribute("aria-disabled", "true");
        publishReason.textContent = localized("Sending your time…", "Je tijd wordt verstuurd…");
        return;
      }
      const videoProblem = videoLinkProblem(videoValue, sourceLanguage());
      if (outcome.valid && videoProblem === null) {
        control.removeAttribute("aria-disabled");
        publishReason.textContent = "";
        return;
      }
      control.setAttribute("aria-disabled", "true");
      if (outcome.valid) { publishReason.textContent = videoProblem ?? ""; return; }
      const first = outcome.errors[0]!;
      publishReason.textContent = draft.totalDigits === ""
        ? localized("Enter a total time first.", "Vul eerst een totaaltijd in.")
        : ruleMessage(first, sourceLanguage());
    };

    const form = panel({
      title: localized("Your result", "Je resultaat"),
      titleLevel: 2,
      children: [
        fixedEngine ?? field({ label: localized("Engine class", "Motorklasse"), control: engineHandle.root }),
        scanNode,
        totalFieldNode,
        // The kart setup sits beside the total as on the result screen; the
        // optional lap details follow.
        field({ label: localized("Kart setup", "Kartopstelling"), control: setup, hint: localized("Optional.", "Optioneel.") }),
        countryFieldNode,
        el("div", "ds-post__details", {}, lapsToggle, lapsSummary, lapsBody),
        videoFieldNode,
        ...reasonNodes,
      ],
    });
    const confirmation = el("section", "ds-post__confirmation", {
      "aria-label": localized("Confirm what you publish", "Bevestig wat je publiceert"),
      tabindex: "-1",
    });
    const lapFacts = el("div", "ds-post__confirm-laps", {});
    // Filled when the confirmation opens: typing updates the draft without re-rendering this view, so values read
    // while building it can be stale (an empty total showed as _:__.___).
    const fillLapFacts = (): void => {
      lapFacts.replaceChildren();
      const hasLapTimes = draft.laps.some((lap) => lap.timeDigits !== "");
      if (hasLapTimes) {
        draft.laps.forEach((lap, index) => {
          const coin = lap.coinChange === null ? "—" : lap.coinChange > 0 ? `+${lap.coinChange}` : String(lap.coinChange).replace("-", "−");
          const mushrooms = lap.mushroomsUsed === null ? "—" : String(lap.mushroomsUsed);
          lapFacts.append(el("div", "ds-post__confirm-lap", {},
            el("strong", "", {}, localized(`Lap ${index + 1}`, `Ronde ${index + 1}`)),
            el("span", "ds-data", {}, lap.timeDigits === "" ? "—" : formatDraftDigits(lap.timeDigits)),
            el("span", "ds-micro", {}, localized(`Coins ${coin} · Mushrooms ${mushrooms}`, `Munten ${coin} · Paddenstoelen ${mushrooms}`))));
        });
      } else {
        lapFacts.append(el("p", "ds-micro", {}, localized(
          "Lap times, coins and mushrooms not recorded.",
          "Rondetijden, munten en paddenstoelen niet vastgelegd.",
        )));
      }
    };
    const setupFacts = el("div", "ds-post__confirm-setup", {});
    parts.forEach((part) => {
      const item = el("div", "ds-post__confirm-part", {},
        ...(part.art === undefined ? [] : [el("img", "", { src: part.art, alt: "" })]),
        el("span", "ds-micro", {}, part.kind),
        el("strong", "", {}, part.name ?? localized("Not recorded", "Niet vastgelegd")));
      setupFacts.append(item);
    });
    if (countryFact !== null) { setupFacts.append(countryFact); }
    const asset = draft.trackId === null ? undefined : trackAsset(draft.trackId);
    const summaryTrack = track !== null && asset !== undefined
      ? el("div", "ds-post__confirm-track", {},
        artThumb({ src: `${GAME_ASSET_BASE}${asset.previewPath}`, badge: `${GAME_ASSET_BASE}${asset.cup.iconPath}` }),
        el("div", "", {}, el("span", "ds-label", {}, localized("Track", "Circuit")),
          el("strong", "", {}, dutchPresentation(track.displayName))))
      : null;
    const back = button({
      label: localized("Back to adjust", "Terug om aan te passen"),
      variant: "secondary",
      onPress: () => {
        disarm();
        totalInput?.input.focus();
      },
    });
    const confirmVideo = el("span", "ds-post__confirm-video ds-body-s", {});
    const confirmTotal = el("strong", "ds-data-xl", {}, formatDraftDigits(draft.totalDigits));
    confirmation.append(panel({
      title: edit === null
        ? localized("Confirm publication", "Publicatie bevestigen")
        : localized("Confirm changes", "Wijzigingen bevestigen"),
      titleLevel: 2,
      label: localized("Review", "Controle"),
      children: [
        summaryTrack,
        el("div", "ds-post__confirm-total", {},
          el("div", "", {}, el("span", "ds-label", {}, localized("Total time", "Totaaltijd")), confirmTotal),
          engineMark(draft.mode, "lg")),
        el("div", "ds-post__confirm-block", {}, el("span", "ds-label", {}, localized("Kart setup", "Kartopstelling")), setupFacts),
        el("div", "ds-post__confirm-block", {}, el("span", "ds-label", {}, localized("Race details", "Rondedetails")), lapFacts),
        el("div", "ds-post__confirm-block", {}, el("span", "ds-label", {}, localized("Video", "Video")), confirmVideo),
        el("p", "ds-post__confirm-ok", {}, localized("Everything checks out.", "Alles klopt.")),
        back.root,
      ],
    }));
    confirmation.hidden = true;
    const actions = el("div", "ds-post__actions", {}, publish.root, publishReason);
    let trackContext: HTMLElement | null = null;
    // Manage already names the track above the form, so an edit does not repeat it.
    if (track !== null && asset !== undefined && edit === null) {
      trackContext = el("div", "ds-post__track-context", {},
        artThumb({
          src: `${GAME_ASSET_BASE}${asset.previewPath}`,
          badge: `${GAME_ASSET_BASE}${asset.cup.iconPath}`,
        }),
        el("div", "ds-post__track-copy", {},
          el("span", "ds-label", {}, localized("Selected track", "Gekozen circuit")),
          el("strong", "ds-post__track-name", {}, dutchPresentation(track.displayName)),
          el("span", "ds-micro", {}, localized(
            `${dutchPresentation(asset.cup.name)} · ${track.lapCount} laps`,
            `${dutchPresentation(asset.cup.name)} · ${track.lapCount} ronden`,
          ))));
      body.append(trackContext);
    }
    body.append(el("div", "ds-post__columns", {},
      el("div", "ds-post__form", {}, form, confirmation, actions),
      predictionRoot));
    leaveConfirmation = () => {
      confirmation.hidden = true;
      form.hidden = false;
      predictionRoot.hidden = false;
      if (trackContext !== null) { trackContext.hidden = false; }
    };
    publish.control.addEventListener("click", () => {
      if (!publish?.armed()) { return; }
      confirmTotal.textContent = formatDraftDigits(draft.totalDigits);
      fillLapFacts();
      confirmVideo.textContent = videoValue.trim() === ""
        ? localized("No video", "Geen video")
        : videoValue.trim();
      confirmation.hidden = false;
      form.hidden = true;
      predictionRoot.hidden = true;
      if (trackContext !== null) { trackContext.hidden = true; }
      confirmation.focus();
    });
    renderPrediction();
    paintPublish();
    if (result.valid && attempted) { attempted = true; }
  };

  const paintFieldError = (node: HTMLElement, fieldPath: string): void => {
    const text = errorText(fieldPath);
    const existing = node.querySelector(".ds-field__error");
    if (text === undefined) { existing?.remove(); return; }
    if (existing !== null) { existing.textContent = text; return; }
    node.append(el("span", "ds-field__error", {}, text));
  };

  /**
   * ScannedFieldIndicator (POST_A_TIME §6): the dot on a scanned value, and the "Edited" mark the
   * moment the Player changes it. It is repainted in place so a keystroke does not rebuild the form
   * under the caret.
   */
  const paintFieldSource = (node: HTMLElement, fieldPath: string): void => {
    const label = node.querySelector(".ds-field__label");
    if (label === null) { return; }
    const existing = label.querySelector(".ds-source");
    const source = sourceOf(fieldPath);
    if (source === undefined) { existing?.remove(); return; }
    if (existing !== null) {
      existing.setAttribute("data-source", source.kind);
      existing.textContent = source.label;
      return;
    }
    label.append(el("span", "ds-source", { "data-source": source.kind }, source.label));
  };

  /** The doubt line goes as soon as the Player has made their own choice about the field. */
  const paintFieldDoubt = (node: HTMLElement, fieldPath: string): void => {
    if (doubtOf(fieldPath) === undefined) {
      node.querySelector(".ds-field__doubt")?.remove();
    }
  };

  // ---- setup picker (a dialog with the platform focus trap; Escape closes; focus returns)

  const openPicker = (key: LoadoutPartKey): void => {
    openPartPicker({
      title: partLabel(key),
      parts: PART_SETS[key],
      value: draft.loadout[key],
      clearable: true,
      onChoose: (partId) => {
        touched.add(loadoutField(key));
        draft = setLoadoutPart(draft, key, partId);
        disarm();
        persist();
        repaint();
      },
    });
  };

  // ---- publication

  const renderEditSaved = (message: string): void => {
    heading.hidden = false;
    heading.textContent = localized("Saved", "Opgeslagen");
    status.hidden = false;
    status.textContent = message;
    notice.hidden = true;
    body.replaceChildren(panel({
      title: localized("Saved", "Opgeslagen"),
      titleLevel: 2,
      children: [statusMessage("success", message)],
    }));
    edit?.onSaved?.();
  };

  /** Edit mode: send only what the Player changed, as a correction and/or the video. */
  const saveEdit = async (): Promise<void> => {
    if (edit === null || disposed || publication.kind === "sending") { return; }
    const outcome = validatePostTime(draft);
    attempted = true;
    if (outcome.payload === null || videoLinkProblem(videoValue, sourceLanguage()) !== null) { repaint(); return; }
    const original = editOriginal;
    const payload = outcome.payload;
    const resultChanged = original === null || resultKey(payload) !== resultKey(original);
    const lapCountsChanged = original === null || countsKey(payload) !== countsKey(original);
    const setupChanged = original === null || setupKey(payload) !== setupKey(original);
    const correctionNeeded = resultChanged || lapCountsChanged || setupChanged;
    const nextVideo = videoValue.trim();
    const videoChanged = nextVideo !== (edit.videoUrl ?? "");
    if (!correctionNeeded && !videoChanged) {
      disarm();
      status.textContent = localized("Nothing was changed.", "Er is niets veranderd.");
      return;
    }
    setPublication({ kind: "sending" });
    status.textContent = localized("Saving…", "Opslaan…");
    root.setAttribute("aria-busy", "true");
    repaint();
    try {
      await edit.save({
        payload: correctionNeeded ? payload : null,
        lapCountsChanged,
        setupChanged,
        video: videoChanged ? nextVideo : undefined,
        reasonCode,
        note: noteValue.trim() === "" ? undefined : noteValue.trim().slice(0, 256),
      });
      if (disposed) { return; }
      root.setAttribute("aria-busy", "false");
      setPublication({ kind: "idle" });
      renderEditSaved(correctionNeeded
        ? localized("Your result is corrected. The earlier version is kept in its history.",
          "Je resultaat is gecorrigeerd. De eerdere versie blijft in de geschiedenis bewaard.")
        : nextVideo === ""
          ? localized("The video is removed.", "De video is verwijderd.")
          : localized("The video is attached.", "De video is toegevoegd."));
    } catch (error) {
      if (disposed) { return; }
      root.setAttribute("aria-busy", "false");
      setPublication({ kind: "idle" });
      repaint();
      status.textContent = edit.failureText?.(error)
        ?? localized("That change could not be saved. Please retry.", "Die wijziging kon niet worden opgeslagen. Probeer het opnieuw.");
    }
  };

  const send = async (): Promise<void> => {
    if (edit !== null) { await saveEdit(); return; }
    if (disposed || session === null || publication.kind === "sending") { return; }
    const outcome = validatePostTime(draft);
    attempted = true;
    if (outcome.payload === null || videoLinkProblem(videoValue, sourceLanguage()) !== null) { repaint(); return; }
    let submission: WebManualTimeTrialSubmissionV1;
    try {
      const context = parseWebManualContextDocument(
        decodeWebManualContextJson(session.contextJson()));
      // The draft travels with the payload so the envelope can say how it was filled in
      // (ADR-0204): typed, scanned, or scanned and then corrected.
      submission = applyPayload(createWebManualSubmission({
        ...context, mode: outcome.payload.mode,
        timeDigits: draft.totalDigits,
      }), outcome.payload, draft);
    } catch {
      setPublication({ kind: "failed", code: "invalid_submission", retryable: false });
      repaint();
      return;
    }
    setPublication({ kind: "sending" });
    status.textContent = localized("Sending your time…", "Je tijd wordt verstuurd…");
    root.setAttribute("aria-busy", "true");
    repaint();
    publishController?.abort();
    publishController = new AbortController();
    try {
      const proof = await session.csrfProof(publishController.signal);
      const answer = await publicationClient.publish(submission, proof, publishController.signal);
      if (disposed) { return; }
      root.setAttribute("aria-busy", "false");
      setPublication(answer.feedback === undefined
        ? { kind: "published" }
        : { kind: "published", feedback: answer.feedback });
      options.onPublished?.(submission);
      // The durable draft is gone, but an observable completion state stays on screen before the
      // route returns to Home. This gives the Player an unmistakable end to the task.
      clearDraft(storage);
      // The optional video is attached to the result just published. The time is already out, so a
      // failure here only says how to add the video later, it never undoes the publication.
      let videoNote: string | null = null;
      if (videoValue.trim() !== "" && options.videoClient !== undefined) {
        try {
          await options.videoClient.setVideo(submission.submissionId, videoValue.trim());
          videoNote = localized("Your video is attached.", "Je video is toegevoegd.");
        } catch {
          videoNote = localized("Your time is published, but the video link could not be saved. Add it later in Manage.",
            "Je tijd is gepubliceerd, maar de videolink kon niet worden opgeslagen. Voeg hem later toe via Beheren.");
        }
      }
      if (disposed) { return; }
      renderCompletion(answer.feedback, videoNote);
    } catch (error) {
      if (disposed) { return; }
      root.setAttribute("aria-busy", "false");
      const failure = error instanceof WebManualPublicationError
        ? error
        : new WebManualPublicationError("network_unavailable", true);
      // FAILED / REJECTED: the draft is kept for correction or retry, and the form is usable again.
      setPublication({ kind: "failed", code: failure.code, retryable: failure.retryable });
      persist();
      repaint();
      status.textContent = rejectionText(failure.code);
    }
  };

  // ---- the board behind the prediction

  const loadBoard = async (): Promise<void> => {
    if (board === null || draft.trackId === null) { boardLoaded = true; return; }
    const trackId = draft.trackId;
    const mode = draft.mode;
    try {
      const [rows, best, rivals] = await Promise.all([
        board.leaderboard(trackId, mode),
        board.ownBest(options.playerId, trackId, mode).catch(() => null),
        board.rivals().catch(() => new Set<string>()),
      ]);
      if (disposed || draft.trackId !== trackId || draft.mode !== mode) { return; }
      boardRows = rows;
      ownBestMs = best;
      rivalIds = rivals;
      boardLoaded = true;
      renderPrediction();
    } catch {
      if (disposed) { return; }
      // A board we cannot read only costs the predicted position; the PB line and the checks stay.
      boardLoaded = true;
      renderPrediction();
    }
  };

  // ---- start: bootstrap the authenticated session for this track, then draw the form

  repaint = (): void => {
    if (disposed) { return; }
    if (draft.trackId === null) { renderTrackSelector(); return; }
    renderForm();
  };

  const start = async (): Promise<void> => {
    if (disposed) { return; }
    if (edit !== null) {
      // An edit needs no publication session, no draft and no board: the result is the start.
      draft = edit.draft;
      editOriginal = validatePostTime(draft).payload;
      lapsDisclosureOpen = true;
      repaint();
      return;
    }
    if (draft.trackId === null) { renderTrackSelector(); return; }
    const trackId = draft.trackId;
    body.replaceChildren(el("p", "ds-post__hint", {},
      localized("Opening…", "Bezig met openen…")));
    status.textContent = "";
    controller?.abort();
    controller = new AbortController();
    try {
      session = await bootstrapClient.bootstrap(trackId, controller.signal);
    } catch (error) {
      if (disposed) { return; }
      const failure = bootstrapFailure(error);
      body.replaceChildren(statusMessage("error", failure.text));
      if (failure.retryable) {
        body.append(button({
          label: localized("Try again", "Probeer opnieuw"),
          variant: "secondary",
          onPress: () => { void start(); },
        }).root);
      }
      return;
    }
    if (disposed) { return; }
    // A draft from this exact (player, track, mode) comes back, and says so (POST_A_TIME §8).
    const stored = loadDraft(options.playerId, trackId, draft.mode, storage);
    if (stored !== null && hasMeaningfulData(stored)) {
      draft = stored;
      restored = true;
    }
    if (scanPending !== null) {
      const application = applyScan(draft, scanPending);
      draft = application.draft;
      scanPending = null;
      persist();
    }
    repaint();
    if (restored) {
      notice.replaceChildren(statusMessage("info",
        localized("Your unfinished time is back.", "Je onafgemaakte tijd staat er weer.")));
      notice.hidden = false;
      restored = false;
    }
    void loadBoard();
  };

  void start();

  return {
    root,
    heading,
    draft: () => draft,
    selectedTrack: () => trackEntry(draft.trackId),
    publicationState: () => publication,
    unmount(): void {
      if (disposed) { return; }
      disposed = true;
      controller?.abort();
      publishController?.abort();
      if (completionTimer !== null) { clearTimeout(completionTimer); }
      trackSelector?.unmount();
      if (root.parentNode === host) { host.removeChild(root); }
    },
  };
}
