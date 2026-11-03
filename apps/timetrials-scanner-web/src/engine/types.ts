// Implementatie-neutrale grenslaag van de browser-scanner (eis §43/§44):
// geen UI-klassen, geen netwerk, geen account. Alles wat de app of een
// toekomstige integratie nodig heeft staat hier als gewone data.

import type { GhostProposal } from '../../../../packages/icon-matcher/ts/sharedGhostProposal';
import type { ResultProposal } from '../../../../packages/icon-matcher/ts/sharedResultProposal';

export type LayoutProfile = 'endscreen' | 'ghost_detail';

export interface Detection {
  label: 'ghost_timetrail_box' | 'player_timetrail_box' | 'lap_index' | string;
  score: number;
  /** genormaliseerd 0..1 t.o.v. het beeld (float32-semantiek zoals de APK) */
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface DetectionTiming {
  resize: number;
  normalize: number;
  tensor: number;
  ort_run: number;
  parse: number;
  total: number;
}

export interface DetectionResult {
  detections: Detection[];
  timing: DetectionTiming;
  /** Lap circles placed by the Select-a-Ghost panel registration, not detected (step 19 skipped). */
  registered?: boolean;
}

/** RGBA-pixels van één frame in analyse-ruimte (liggend, EXIF toegepast). */
export interface Frame {
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
}

/** Één identiteitsslot (character/kart/wheel/glider/flag) zoals node 27 hem oplevert. */
export interface IdentityEntry {
  ok?: boolean;
  id?: string | null;
  index?: number | null;
  name?: string;
  score?: number;
  margin?: number;
  margin_ext?: number;
  top3?: [string, number][];
  topk?: [string, number][];
  family?: string;
  dx?: number;
  dy?: number;
  scale?: number;
  evidence?: string;
  reason?: string;
  crop_std?: number;
  slot_xywh?: [number, number, number, number];
  /** Actual flag/tire template window in canonical game-image pixels, after search. */
  match_xywh?: [number, number, number, number];
  character_slot_qa?: Record<string, unknown>;
  character_text_qa?: Record<string, unknown>;
  part_text_qa?: Record<string, unknown>;
  /** Runner-up flag proposal for uncertain near-neighbours; never an accepted ID. */
  alternative_index?: number;
  alternative_name?: string;
  /** A named QA proposal is retained even when it must not be accepted. */
  proposed_id?: string;
  proposed_index?: number;
  proposed_name?: string;
  review_required?: boolean;
  asset_ref?: string;
  /** data-URL (PNG) van de uitgesneden slot-crop — browser-equivalent van crop_path */
  crop_png?: string;
  pattern?: string;
  shortlist?: number;
  text?: { text: string; id: string; fuzzy: number; margin: number };
  name_text?: { text: string; id: string; fuzzy: number };
  color_realigned_from?: string;
  family_color_trace?: { raw_rgb_id: string; chroma_id: string; visual_id: string; family_color_id: string; sibling_color_id: string; final_id: string };
  color_text_agreement_from?: string;
  constraint_candidates?: number;
  [key: string]: unknown;
}

export interface OwnerIdentity {
  joint_loadout_qa?: Record<string, unknown>;
  /** Central photometric correction of this card (packages/icon-matcher sharedCardPresence). */
  photometric_qa?: Record<string, unknown>;
  shared_proposal_qa?: GhostProposal;
  shared_result_proposal_qa?: ResultProposal;
  shared_result_white_proposal_qa?: ResultProposal;
  /** Select-a-Ghost: the central picker's frame decision (packages/icon-matcher sharedGhostPanel). */
  ghost_panel_decision_qa?: Record<string, unknown>;
  panel_source?: string;
  grid?: { mode: string; dx: number; dy: number; sx: number; sy: number; score: number };
  character?: IdentityEntry;
  kart?: IdentityEntry;
  wheel?: IdentityEntry;
  glider?: IdentityEntry;
  flag?: IdentityEntry;
  text_locale?: { script: string; locale: string | null; kart_text: string; fuzzy: number };
  card_name?: string;
  card_name_debug?: string;
  physical_owner?: string;
  semantic_owner?: string;
  text_evidence_error?: string;
  status?: string;
}

export interface KartConfigResult {
  stage: '27_KartConfig';
  status: string;
  race_key: string;
  yellow_player_slot: string | null;
  owners: Record<string, OwnerIdentity>;
  duration_ms: number;
  qa_sharpness?: number;
}

/** Resultaat van één frame door de pijplijn (port van LiveResult + 26/27-json). */
export interface FrameResult {
  status: 'valid_decode' | 'partial_decode' | 'blocked' | 'error' | 'not_started' | 'implemented';
  message: string;
  firstBlockingStage: string;
  raceProfile: string;
  frameValid: boolean;
  lapSumOk: boolean | null;
  lapSumRepairs: number;
  lapSumRepairList: unknown[];
  expectedFieldCount: number;
  /** semantische veldnaam -> "m:ss.mmm" (of met '?') */
  fields: Record<string, string>;
  fieldDetails: FieldDetail[];
  kartConfig: KartConfigResult | null;
  stageStatus: Record<string, string>;
  totalRuntimeMs: number;
  stageTimings: Record<string, number>;
  diagnostics: FrameDiagnostics;
}

export interface FieldDetail {
  field_name: string;
  owner: string;
  physical_field: string;
  physical_owner: string;
  field_type: 'lap' | 'total';
  lap_index: number;
  decoded_value: string;
  valid_format: boolean;
  field_box: [number, number, number, number];
  slots: { slot_index: number; slot_type: string; box: [number, number, number, number]; char: string; confidence: number; pattern: string }[];
  /** data-URL PNG van het veld (canonieke ruimte), voor de verificatieweergave */
  crop_png?: string;
}

export interface FrameDiagnostics {
  /** Select-a-Ghost: the registered panel's colour correction, applied before any reading. */
  ghostPanelPhotometric?: unknown;
  /** Effective game-internal recovery switches for the opt-in optical entry point. */
  opticalCandidateOptions?: { strictLapSumSeed: boolean; gameAnchorLapProfile: boolean;
    sparseDualYellow: boolean; ghostLapColumn: boolean; inlineCardEdge: boolean;
    inlineBadgeRow: boolean;
    kartVariantTextReview: boolean; wheelTextConflictReview: boolean;
    ownerPresence: boolean;
    nameOnlyCharacterVariantReview: boolean; characterTextLeftProbe: boolean };
  /** Opt-in RAW optical card fit and conservative second-pass choice; game pixels only. */
  opticalCardEdge?: { status: string; selected: boolean; firstStatus: string; secondStatus?: string;
    ordinaryOutsideMax?: number; edgeBoxGapMax?: number; fitMs?: number; elapsedMs: number; reason: string };
  /** Optional in-game badge, part-row and card-rail perspective proposal. */
  opticalBadgeRow?: { status: string; selected: boolean; firstStatus: string; secondStatus?: string;
    fitMs: number; rowCount?: number; badgeCount?: number;
    sideSources?: { left: string; right: string };
    identityConflicts?: { owner: string; kind: string; priorId: string; proposedId: string | null;
      priorScore: number | null; proposedScore: number | null;
      priorTextId: string | null; priorTextFuzzy: number | null;
      proposedTextId: string | null; proposedTextFuzzy: number | null }[];
    identityReviewCount?: number;
    reason: string };
  /** Opt-in rejected native badge detection; all coordinates remain in game-image space. */
  lapIndexOutlier?: Detection;
  /** Opt-in duplicate native badge detection suppressed before profile selection. */
  lapIndexDuplicate?: Detection;
  /** Opt-in weak box outside two regular in-game three-lap badge lattices. */
  lapIndexOffLattice?: Detection;
  sparseRecoveryIdentityReview?: { reason: string; withheld: number };
  ownerPresenceCandidate?: { reason: string; playerScore: number; ghostScore: number; badgeCount: number; ghostTimePresent: boolean; removedGhostOutput: boolean };
  /** Opt-in saved-image orientation trial, separate from image-quality truth. */
  savedFramePreparation?: { requested: string; selected: string; firstStatus: string; firstBlockingStage: string; firstRuntimeMs: number; elapsedMs: number };
  /** per seed-poging: quad, uitlijning, leesbaarheid (diagnose van seed-keuze) */
  seedAttempts?: any[];
  /** ghost_detail: de gemeten kanteling van de badge-kolom als de rechtzet-seed is gebruikt */
  ghostDetailDeskewDegrees?: number;
  /** Opt-in research offsets inferred from repeated in-game ghost-lap columns. */
  ghostLapColumnOffsets?: Record<number, { dx: number; dy: number; rows: number }>;
  /** Opt-in rescue offsets from repeated in-game player-lap rows. */
  playerLapColumnOffsets?: Record<number, { dx: number; dy: number; rows: number }>;
  /** ghost_detail: de registratie op de schone opname (ankers gevonden, inliers, toegepast) */
  ghostPanelRegistration?: Record<string, unknown>;
  /** Offline QA only: x correction composed into the RAW-to-canonical warp. */
  researchCanonicalShear?: { slope: number; intercept: number; largestShift: number };
  /** Opt-in game-punctuation proposal; selected means canonical pixels were corrected. */
  canonicalPunctuationShear?: { selected: boolean; reason: string; slope: number; intercept: number;
    badgeDeltaX: number; colonMinScore: number; dotMinScore: number;
    dotMaeBefore: number; dotMaeAfterPredicted: number; maxShift: number; fitMs: number };
  /** de middelende voorverkleining vóór de canonieke warp, als die is toegepast */
  antialiasFactor?: number;
  roi?: { box: [number, number, number, number]; route: string; reason: string; status: string; lapIndexCount: number; playerCount: number; ghostCount: number };
  detections?: Detection[];
  seedUsed?: string;
  quad?: [number, number][];
  canonicalDetections?: Detection[];
  gridFields?: { name: string; box: [number, number, number, number] }[];
  yellowPosition?: string | null;
  brightness?: { brightness: number; contrast: number; reason: string };
  /** canonieke 1280x720 (JPEG data-URL) alleen wanneer gevraagd (diagnostiek) */
  canonical_jpeg?: string;
  /** OCR-crops (PNG data-URL) + ruwe tekst, alleen wanneer gevraagd (diagnostiek) */
  ocr_crops?: { label: string; script: string; text: string; png: string }[];
}

/** Voortgangsgebeurtenis (eis §44) — de UI leidt hier zijn presentatie uit af. */
export interface ProgressEvent {
  phase: 'card' | 'slots' | 'read' | 'setup' | 'confirm' | 'finish' | 'failed' | 'idle';
  /** monotoon 0..1 over de hele scan */
  overallProgress: number;
  attemptIndex: number;
  attemptCount: number;
  /** 0..100 voor het huidige frame; reset per frame */
  frameProgress: number;
  identityOnly: boolean;
  difficultFrame: boolean;
  stage: string;
  success: boolean;
  failure: boolean;
  timesLocked: boolean;
  elapsedMs: number;
}

export interface IdentitySnapshotEntry {
  id: string;
  index: number;
  name: string;
  asset_ref: string;
  crop_png?: string;
  score: number;
  ok: boolean;
  votes: number;
  frames: number;
  /** Shared field reader: the next named choices when this one is not certain. */
  alternatives?: { id: string; index: number | null; name: string; asset_ref?: string }[];
}

export type IdentitySnapshot = Record<string, Partial<Record<'character' | 'kart' | 'wheel' | 'glider' | 'flag', IdentitySnapshotEntry>> & { card_name?: string }>;

/** Eindresultaat van een scan (eis §43: schone lokale result-API). */
export interface ScanResult {
  locked: boolean;
  acceptPath: string;
  layout: LayoutProfile;
  raceProfile: string;
  lockedFrameIndex: number;
  framesAnalyzed: number;
  okFrames: number;
  fields: Record<string, string>;
  identity: IdentitySnapshot;
  /** per-frame uitkomsten (diagnostiek/parity) */
  frames: FrameResult[];
  timing: { frame: number; identityOnly: boolean; stage: string; ms: number }[];
  totalMs: number;
  stopped: boolean;
  /** gelockte frame als JPEG data-URL (verificatieweergave) */
  lockFrameJpeg?: string;
}
