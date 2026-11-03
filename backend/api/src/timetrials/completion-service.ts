import type { ActorContext } from "../identity/types.js";
import {
  validateEvidence,
  validateLap,
  validateLoadout,
  type ProtectedValue,
  type TimeTrialAssetCatalog,
  type TimeTrialEvidence,
  type TimeTrialLap,
  type TimeTrialLoadout,
  type TimeTrialSensitiveValueProtector,
} from "./submission-service.js";

// Completing a published result from a later reading of the same run
// (ADR-0210 rule 10, owner 2026-09-28: "it should still be added if it's there").
//
// A LiveTrial ghost of the Player's own run often knows what the result on the
// website never had: the laps, coins and mushrooms per lap, the whole combo. A
// completion fills in exactly those gaps and nothing else. It never replaces a
// value that is there; a value that disagrees means it is not the same run and
// the whole completion is refused. The result keeps its source, its date, its
// evidence and its place in the publication history — a new revision carries
// all of it forward, with the ghost's reference added beside the original
// evidence.

export const TIME_TRIAL_COMPLETION_SCHEMA = "mk8dx.time-trial-completion.v1";

/** Only a producer that read the run from a screen may complete one. */
export const completionSourceKinds = ["livetrial_capture", "livetrial_recorded_video"] as const;
export type TimeTrialCompletionSourceKind = typeof completionSourceKinds[number];

export type TimeTrialCompletionV1 = Readonly<{
  schemaVersion: typeof TIME_TRIAL_COMPLETION_SCHEMA;
  /** The revision the producer compared against; a newer one refuses (409). */
  expectedRevision: number;
  trackId: string;
  mode: 150 | 200;
  totalTimeMs: number;
  laps?: readonly TimeTrialLap[];
  loadout?: TimeTrialLoadout;
  source: Readonly<{ kind: TimeTrialCompletionSourceKind; producerVersion?: string }>;
  evidence: readonly TimeTrialEvidence[];
}>;

export type TimeTrialCompletionField =
  | "laps" | "coinsCollected" | "mushroomsUsed"
  | "character" | "characterVariant" | "body" | "bodyVariant" | "tire" | "glider" | "gliderVariant";

export type TimeTrialCompletionResult = Readonly<{
  submissionId: string;
  revision: number;
  completedFields: readonly TimeTrialCompletionField[];
}>;

export class TimeTrialCompletionError extends Error {
  public constructor(
    public readonly code:
      | "invalid_completion"
      | "invalid_assets"
      | "not_authenticated"
      | "not_found"
      | "revision_conflict"
      | "different_result"
      | "nothing_missing"
      | "protection_failed",
    message: string,
  ) {
    super(message);
    this.name = "TimeTrialCompletionError";
  }
}

export type ProtectedCompletionEvidence = Readonly<{
  kind: TimeTrialEvidence["kind"];
  protectedReference: ProtectedValue;
  sha256?: Uint8Array;
  mediaType?: string;
}>;

export interface TimeTrialCompletionRepository {
  complete(input: Readonly<{
    submissionId: string;
    actorUserAccountId: string;
    completion: TimeTrialCompletionV1;
    evidence: readonly ProtectedCompletionEvidence[];
  }>): Promise<TimeTrialCompletionResult>;
}

const submissionIdPattern = /^user_submission\.time\.[A-Za-z0-9][A-Za-z0-9_-]{5,127}$/;
const trackPattern = /^track\.[a-z0-9]+(?:_[a-z0-9]+)*$/;
const keyVersionPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[]): boolean {
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(value, key)) && Object.keys(value).every((key) => allowed.has(key));
}

export function validateTimeTrialCompletion(input: unknown): asserts input is TimeTrialCompletionV1 {
  const fail = (message: string): never => {
    throw new TimeTrialCompletionError("invalid_completion", message);
  };
  if (!isObject(input) || !exactKeys(
    input,
    ["schemaVersion", "expectedRevision", "trackId", "mode", "totalTimeMs", "source", "evidence"],
    ["laps", "loadout"],
  )) {
    fail("completion shape is invalid");
    return;
  }
  if (input.schemaVersion !== TIME_TRIAL_COMPLETION_SCHEMA ||
    !Number.isSafeInteger(input.expectedRevision) || (input.expectedRevision as number) < 1 ||
    typeof input.trackId !== "string" || input.trackId.length > 255 || !trackPattern.test(input.trackId) ||
    (input.mode !== 150 && input.mode !== 200) ||
    !Number.isSafeInteger(input.totalTimeMs) || (input.totalTimeMs as number) < 1 ||
    (input.totalTimeMs as number) > 599_999) {
    fail("completion scalar is invalid");
  }
  const laps = input.laps;
  if (laps !== undefined) {
    if (!Array.isArray(laps) || ![3, 7].includes(laps.length) ||
      laps.some((lap, index) => !validateLap(lap, index + 1))) {
      fail("laps are invalid");
    }
    const typed = laps as readonly TimeTrialLap[];
    if (typed.reduce((sum, lap) => sum + lap.timeMs, 0) !== input.totalTimeMs ||
      typed.reduce((sum, lap) => sum + (lap.mushroomsUsed ?? 0), 0) > 3) {
      fail("lap semantics are invalid");
    }
  }
  if (input.loadout !== undefined && !validateLoadout(input.loadout)) {
    fail("loadout is invalid");
  }
  if (laps === undefined && input.loadout === undefined) {
    fail("a completion must carry laps or a loadout");
  }
  const source = input.source;
  if (!isObject(source) || !exactKeys(source, ["kind"], ["producerVersion"]) ||
    !(completionSourceKinds as readonly unknown[]).includes(source.kind) ||
    (Object.hasOwn(source, "producerVersion") &&
      (typeof source.producerVersion !== "string" || source.producerVersion.length < 1 ||
        source.producerVersion.length > 64))) {
    fail("source is invalid");
  }
  // The reading that completes a result must be traceable: exactly one reference, as the LiveTrial
  // sender already requires of every result it sends (ADR-0210 rule 9).
  if (!Array.isArray(input.evidence) || input.evidence.length !== 1 ||
    !validateEvidence(input.evidence[0]) ||
    !["capture_session", "video"].includes((input.evidence[0] as TimeTrialEvidence).kind)) {
    fail("evidence is invalid");
  }
}

export class TimeTrialCompletionService {
  public constructor(
    private readonly repository: TimeTrialCompletionRepository,
    private readonly assetCatalog: TimeTrialAssetCatalog,
    private readonly protector: TimeTrialSensitiveValueProtector,
  ) {}

  public async complete(
    actor: ActorContext,
    submissionId: string,
    input: unknown,
  ): Promise<TimeTrialCompletionResult> {
    if (actor.role !== "account" && actor.role !== "administrator") {
      throw new TimeTrialCompletionError("not_authenticated", "Authentication is required.");
    }
    if (!submissionIdPattern.test(submissionId)) {
      throw new TimeTrialCompletionError("invalid_completion", "submission id is invalid");
    }
    validateTimeTrialCompletion(input);
    const issues = await this.assetCatalog.validateReferences({
      trackId: input.trackId,
      ...(input.loadout === undefined ? {} : { loadout: input.loadout }),
    });
    if (issues.length > 0) {
      throw new TimeTrialCompletionError("invalid_assets", "asset references are invalid");
    }
    const evidence: ProtectedCompletionEvidence[] = [];
    for (const item of input.evidence) {
      let protectedReference: ProtectedValue;
      try {
        protectedReference = await this.protector.protectEvidenceReference(item.reference);
      } catch {
        throw new TimeTrialCompletionError("protection_failed", "evidence reference protection failed");
      }
      if (!(protectedReference.ciphertext instanceof Uint8Array) ||
        protectedReference.ciphertext.length < 1 || protectedReference.ciphertext.length > 2048 ||
        !keyVersionPattern.test(protectedReference.encryptionKeyVersion)) {
        throw new TimeTrialCompletionError("protection_failed", "protected value is invalid");
      }
      evidence.push({
        kind: item.kind,
        protectedReference,
        ...(item.sha256 === undefined ? {} : { sha256: Uint8Array.from(Buffer.from(item.sha256, "hex")) }),
        ...(item.mediaType === undefined ? {} : { mediaType: item.mediaType }),
      });
    }
    return this.repository.complete({
      submissionId,
      // Ownership is decided in the transaction from the account's verified claim; an
      // administrator completes nothing that is not their own Player's either.
      actorUserAccountId: actor.userAccountId,
      completion: input,
      evidence,
    });
  }
}

// ------------------------------------------------------------------ the fill rule

export type CurrentLoadout = Readonly<{
  characterId: string | null;
  characterVariantId: string | null;
  bodyId: string | null;
  bodyVariantId: string | null;
  tireId: string | null;
  gliderId: string | null;
  gliderVariantId: string | null;
}>;

export type CurrentLap = Readonly<{
  lapNumber: number;
  timeMs: number;
  coinsCollected: number | null;
  mushroomsUsed: number | null;
}>;

export type CompletionPlan = Readonly<{
  loadout: CurrentLoadout;
  laps: readonly CurrentLap[];
  completedFields: readonly TimeTrialCompletionField[];
}>;

const loadoutFields: readonly (readonly [keyof CurrentLoadout, TimeTrialCompletionField, keyof CurrentLoadout | null])[] = [
  ["characterId", "character", null],
  ["characterVariantId", "characterVariant", "characterId"],
  ["bodyId", "body", null],
  ["bodyVariantId", "bodyVariant", "bodyId"],
  ["tireId", "tire", null],
  ["gliderId", "glider", null],
  ["gliderVariantId", "gliderVariant", "gliderId"],
];

/**
 * What a completion changes, or why it may not. Pure, so the rule is tested without a database.
 * A supplied value equal to the stored one is agreement; a stored value that differs is a different
 * run (`different_result`); only an empty stored value is filled. A variant is filled only when its
 * base part is (or becomes) the one the variant belongs to.
 */
export function planCompletion(
  current: Readonly<{ loadout: CurrentLoadout; laps: readonly CurrentLap[] }>,
  completion: Pick<TimeTrialCompletionV1, "laps" | "loadout">,
): CompletionPlan {
  const disagree = (): never => {
    throw new TimeTrialCompletionError(
      "different_result",
      "The reading disagrees with the stored result, so it is not the same run.",
    );
  };
  const completed = new Set<TimeTrialCompletionField>();
  const loadout: Record<keyof CurrentLoadout, string | null> = { ...current.loadout };
  const supplied = (completion.loadout ?? {}) as Readonly<Record<string, string | undefined>>;
  for (const [key, field, base] of loadoutFields) {
    const value = supplied[key];
    if (value === undefined) { continue; }
    const stored = loadout[key];
    if (stored !== null) {
      if (stored !== value) { disagree(); }
      continue;
    }
    if (base !== null) {
      const baseValue = loadout[base];
      // body_variant.buggybud.000_blue belongs to body.buggybud.
      const family = value.split(".")[1];
      if (baseValue === null || baseValue.split(".")[1] !== family) { continue; }
    }
    loadout[key] = value;
    completed.add(field);
  }

  let laps: CurrentLap[] = current.laps.map((lap) => ({ ...lap }));
  if (completion.laps !== undefined) {
    if (laps.length === 0) {
      laps = completion.laps.map((lap) => ({
        lapNumber: lap.lapNumber,
        timeMs: lap.timeMs,
        coinsCollected: lap.coinsCollected ?? null,
        mushroomsUsed: lap.mushroomsUsed ?? null,
      }));
      completed.add("laps");
      if (laps.some((lap) => lap.coinsCollected !== null)) { completed.add("coinsCollected"); }
      if (laps.some((lap) => lap.mushroomsUsed !== null)) { completed.add("mushroomsUsed"); }
    } else {
      if (laps.length !== completion.laps.length) { disagree(); }
      laps = laps.map((lap, index) => {
        const reading = completion.laps![index]!;
        if (reading.timeMs !== lap.timeMs) { disagree(); }
        let coinsCollected = lap.coinsCollected;
        let mushroomsUsed = lap.mushroomsUsed;
        if (reading.coinsCollected !== undefined) {
          if (coinsCollected === null) {
            coinsCollected = reading.coinsCollected;
            completed.add("coinsCollected");
          } else if (coinsCollected !== reading.coinsCollected) { disagree(); }
        }
        if (reading.mushroomsUsed !== undefined) {
          if (mushroomsUsed === null) {
            mushroomsUsed = reading.mushroomsUsed;
            completed.add("mushroomsUsed");
          } else if (mushroomsUsed !== reading.mushroomsUsed) { disagree(); }
        }
        return { ...lap, coinsCollected, mushroomsUsed };
      });
      if (laps.reduce((sum, lap) => sum + (lap.mushroomsUsed ?? 0), 0) > 3) {
        throw new TimeTrialCompletionError("invalid_completion", "lap semantics are invalid");
      }
    }
  }
  if (completed.size === 0) {
    throw new TimeTrialCompletionError("nothing_missing", "The result already has everything this reading knows.");
  }
  const order: readonly TimeTrialCompletionField[] = [
    "laps", "coinsCollected", "mushroomsUsed", "character", "characterVariant",
    "body", "bodyVariant", "tire", "glider", "gliderVariant",
  ];
  return {
    loadout: loadout as CurrentLoadout,
    laps,
    completedFields: order.filter((field) => completed.has(field)),
  };
}
