// Port van KartConfigMatcher (node 27): character/kart/glider via
// CleanAssetsMatcher, wielen via de v1-tire-NCC, vlag via patroon-eerst-NCC +
// kleurzweem-tiebreak; deploy-registratie (edge-NCC op kaarttemplates);
// tekst-tweede-bewijs; rescueCharacterViaParts; realignPartColors (v0.4.1).
import { slotPresent } from '../../../../packages/icon-matcher/ts/sharedSlotPresence';
import type { AssetSource } from './assets';
import { TIRE_NAMES } from './tireNames.generated';
import { loadBgrAlpha, loadGray } from './assets';
import { CleanAssetsMatcher, familyOf } from './cleanAssets';
import { cropClone, cv, matStd } from './cv';
import { bgrMatToPngDataUrl } from './imageio';
import { FUZZY_MIN, TextEvidence, VocabMatch, matchVocab, SCRIPTS, scriptForLocale, type Script } from './textEvidence';
import { localeVote, sameNameLocales, vocabLocales } from '../../../../packages/icon-matcher/ts/sharedNameMatch';
import { deployBox as centralDeployBox, ghostNameRight, panelBox, registerCard as centralRegisterCard, registerCoarseSize,
  registerWindow, searchWindow, slotBox, textRight, textStrip, type FrameDefinitions, type PanelBox } from '../../../../packages/icon-matcher/ts/sharedFrameGeometry';
import type { IdentityEntry, OwnerIdentity } from './types';
import { SharedIconReferenceStore, matchCvBgrCrop,
  matchCvBgrTireWindow, visualFieldResult } from './sharedIconCandidate';
import type { VisualFieldRead } from '../../../../packages/icon-matcher/ts/sharedIconFieldResult';
import { combineCharacter } from '../../../../packages/icon-matcher/ts/sharedCharacterContext';
import { combinePart, type PartKind } from '../../../../packages/icon-matcher/ts/sharedPartContext';
import { distinctiveFlagRank } from '../../../../packages/icon-matcher/ts/sharedFlagDistinctive';
import { flagTricolorEvidence } from '../../../../packages/icon-matcher/ts/sharedFlagTricolor';
import { flagBandRatio } from '../../../../packages/icon-matcher/ts/sharedFlagBandRatio';
import { flagExposureProposal } from '../../../../packages/icon-matcher/ts/sharedFlagExposure';
import { matchCvBgrFlagWindow, normalizeCvBgrCrop } from '../../../../packages/icon-matcher/ts/sharedIconCvReader';
import { FLAG_WINDOW_PAD } from '../../../../packages/icon-matcher/ts/sharedFlagWindow';
import { correctCard, parseCardAnchors, parseCardPhotometry, type CardAnchors, type CardPhotometry,
  type PhotometricRecord } from '../../../../packages/icon-matcher/ts/sharedCardPresence';
import { correctPanel, type PanelPhotometricRecord } from '../../../../packages/icon-matcher/ts/sharedPanelPhotometric';
import { correctedGhostCrop, ghostTotalWhite, ghostToneMode } from '../../../../packages/icon-matcher/ts/sharedIconTone';
import { rankPartSubset } from '../../../../packages/icon-matcher/ts/sharedPartSubsetRank';
import { rankGhostCharacter, rankGhostLoadouts } from '../../../../packages/icon-matcher/ts/sharedGhostLoadout';
import { composeGhostProposal, type GhostProposalOwner } from '../../../../packages/icon-matcher/ts/sharedGhostProposal';
import { composeResultProposal, type ResultProposal } from '../../../../packages/icon-matcher/ts/sharedResultProposal';
import { MII_LABEL } from '../../../../packages/icon-matcher/ts/sharedOpenSet';
import { SHARED_FIELD_SEMANTICS_VERSION } from '../../../../packages/icon-matcher/ts/sharedFieldVersion';
import { correctResultFlagBgr, resultGhostNameWhite } from '../../../../packages/icon-matcher/ts/sharedResultFlagWhite';
import { rankIconShape } from '../../../../packages/icon-matcher/ts/sharedShapeRank';
import { rankNeutralChroma } from '../../../../packages/icon-matcher/ts/sharedNeutralChroma';
import { rankCharacterFamilyColour } from '../../../../packages/icon-matcher/ts/sharedFamilyColour';
import { decideGhostSelectFrame, type CropSource, type FrameDescription, type GhostField,
  type GhostPanelReferences, type PartNameTable } from '../../../../packages/icon-matcher/ts/sharedGhostPanel';

const ASSET_ROOT = 'kart_config';
const SEARCH_PAD_PX = 10;
// Whether a slot holds a picture is the central slot-presence decision (sharedSlotPresence, source
// 'photo': grey-value standard deviation); this engine measures the slot.
const FLAG_POS_PENALTY = 0.010;
const ICON_SCORE_MIN = 0.62;
const ICON_MARGIN_MIN = 0.02;
const WHEEL_SCORE_MIN = 0.35;
// A noisy row-text match cannot overturn a strong visual wheel result. These
// moderate review/proposal thresholds stay below text-only acceptance.
const WHEEL_TEXT_PROPOSAL_FUZZY_MIN = 0.65;
const WHEEL_TEXT_PROPOSAL_MARGIN_MIN = 0.15;
export const RACE_KEY_GHOST_DETAIL = 'ghost_detail';
export const RACE_KEY_GHOST_DETAIL7 = 'ghost_detail7';
/** The NL/LU band decision of a central flag proposal: the decided id, 'between', or null. */
function nlLuBand(decision: { evidence: string[]; acceptedId: string | null }): string | null {
  if (decision.evidence.includes('flag_band_ratio_between')) return 'between';
  if (decision.evidence.includes('flag_band_ratio')
      && (decision.acceptedId === 'country.nl' || decision.acceptedId === 'country.lu')) return decision.acceptedId;
  return null;
}

const KINDS: [string, string, 'character' | 'kart' | 'wheel' | 'glider' | 'flag'][] = [
  ['character_icon', 'character', 'character'],
  ['kart_icon', 'body', 'kart'],
  ['wheel_icon', 'tire', 'wheel'],
  ['glider_icon', 'glider', 'glider'],
  ['flag_icon', 'mk8_flags', 'flag'],
];

const REG_GROUP: Record<string, string> = {
  character_icon: 'characters',
  kart_icon: 'bodies',
  wheel_icon: 'tires',
  glider_icon: 'gliders',
  flag_icon: 'flags',
};

interface IconAsset {
  index: number;
  bgr: any;
  alpha: any;
}

interface SizedIcon {
  index: number;
  bgr: Float32Array;
  mask: Float32Array;
  maskSum: number;
}

interface FlagTemplate {
  index: number;
  gray8: any;
  bgr8: any;
  dt: Float32Array;
  dtDen: number;
  cast: Float32Array;
}

function round1(v: number): number {
  return Math.round(v * 10.0) / 10.0;
}

function round2(v: number): number {
  return Math.round(v * 100.0) / 100.0;
}

function round3(v: number): number {
  return Math.round(v * 1000.0) / 1000.0;
}

function round4(v: number): number {
  return Math.round(v * 10000.0) / 10000.0;
}

/** A field the central reader did not decide: no choice is shown (`?`), nothing is certain. */
function clearChoice(entry: IdentityEntry): void {
  entry.ok = false;
  entry.id = null;
  entry.index = null;
  entry.name = '';
  entry.asset_ref = undefined;
}

export class KartConfigMatcher {
  /** Opt-in QA decision after independent printed variant and icon evidence agree. */
  familyColorTextAgreementCandidate = false;
  /** Opt-in optical QA: retry a weak player name when its first glyph is clipped. */
  characterTextLeftProbe = 0;
  /** The pack's Time Trial frame geometry (frame-definitions-v1.json; central sharedFrameGeometry). */
  private frameDefs!: FrameDefinitions;
  private names: any;
  readonly cleanAssets: CleanAssetsMatcher;
  readonly textEvidence: TextEvidence;
  private readonly source: AssetSource;
  private readonly assetCache = new Map<string, IconAsset[]>();
  private readonly sizedIconCache = new Map<string, SizedIcon[]>();
  private readonly flagCache = new Map<string, FlagTemplate[]>();
  private readonly regTemplateCache = new Map<string, any>();
  private tireVocabCache: Record<string, string> | null = null;
  /** crops als PNG data-URL bewaren (resultaat-UI); uit voor de parity-run */
  saveCrops = true;
  private sharedIconQa: SharedIconReferenceStore | null = null;
  /** The central Select-a-Ghost picker's references (CENTRAL_RECOGNITION section 8); null = previous rule. */
  private ghostPicker: GhostPanelReferences | null = null;
  /** Languages that break a tie in the locale vote, most preferred first (a remembered console language). */
  preferredLocales: string[] = [];
  private sharedTireWindowQa = false;
  private sharedFlagWindowQa = false;
  private sharedPhotometric: { anchors: CardAnchors; photometry: CardPhotometry } | null = null;
  private photometricByCanonical = new WeakMap<object, Record<string, PhotometricRecord>>();
  private sharedCharacterSlotQa = false;
  private sharedCharacterTextQa = false;
  private sharedFlagDistinctiveQa = false;
  private sharedFlagTricolorQa = false;
  private sharedPartTextQa = false;
  private sharedTireTextTop3GuardQa = false;
  private sharedSaveSelectedCropsQa = false;
  private sharedToneSuggestionQa = false;
  private sharedPartSubsetQa = false;
  private sharedJointLoadoutQa = false;
  private sharedResultFlagWhiteQa = false;
  private sharedCharacterColourQa = false;
  /** Product route: the shared result decision supplies the five visible fields. */
  private sharedFieldIndex: { flags: Record<string, number>; tires: Record<string, number> } | null = null;

  private constructor(source: AssetSource, cleanAssets: CleanAssetsMatcher, textEvidence: TextEvidence) {
    this.source = source;
    this.cleanAssets = cleanAssets;
    this.textEvidence = textEvidence;
  }

  static async load(source: AssetSource, textEvidence: TextEvidence): Promise<KartConfigMatcher> {
    const cleanAssets = await CleanAssetsMatcher.load(source);
    const m = new KartConfigMatcher(source, cleanAssets, textEvidence);
    // The frame geometry comes from the recognition pack; the staging checked that it describes
    // exactly the icon_grid.json, reg.json and time grids served beside it.
    const defs = await source.json(`${ASSET_ROOT}/frame-definitions-v1.json`) as FrameDefinitions;
    if (defs.schema !== 'mk8dx.frame-definitions.v1') throw new Error('frame-definitions-v1.json missing or wrong schema');
    m.frameDefs = defs;
    m.names = await source.json(`${ASSET_ROOT}/names.json`);
    // iconen + registratie-templates vooraf laden (Java laadt lui; hier
    // bewust vooraf zodat de eerste scan geen netwerk-/decodeerpauze kent)
    for (const [, dir] of KINDS) await m.loadAssets(dir);
    for (const key of ['player_3laps', 'player_7laps', 'ghost_3laps', 'ghost_7laps']) await m.cardTemplate(key);
    return m;
  }

  /** Opt-in, read-only worker comparison. Reference bytes stay in the private QA source. */
  async enableSharedIconQa(source: AssetSource, prefix: string, catalogSha256: string,
    tireWindow = false, characterSlot = false, characterText = false,
    flagDistinctive = false, partText = false,
    saveSelectedCrops = false, toneSuggestion = false, partSubset = false,
    jointLoadout = false, tireTextTop3Guard = false,
    resultFlagWhite = false, characterColour = false,
    flagTricolor = false, flagWindow = false, photometric = false): Promise<void> {
    if (partText && !characterText) throw new Error('Part text QA requires character context QA');
    if (flagTricolor && !flagDistinctive) throw new Error('Flag tricolour QA requires distinctive flag QA');
    if (tireTextTop3Guard && !partText) throw new Error('Tire text guard requires part text QA');
    if (jointLoadout && (!partSubset || !partText)) {
      throw new Error('Joint Ghost QA requires part text and subset evidence');
    }
    this.sharedIconQa = await SharedIconReferenceStore.create(source, prefix, catalogSha256);
    this.sharedTireWindowQa = tireWindow;
    this.sharedFlagWindowQa = flagWindow;
    this.sharedPhotometric = null;
    if (photometric) {
      // Central photometric correction (packages/icon-matcher): the card's own
      // lap-circle disc and digit bring a photo back to HDMI exposure. Without
      // the staged anchor files the shared reads stay on the uncorrected image.
      try {
        const [anchors, photometry] = await Promise.all([source.json(`${prefix}/card-anchors-v1.json`),
          source.json(`${prefix}/card-photometry-v1.json`)]);
        this.sharedPhotometric = { anchors: parseCardAnchors(anchors), photometry: parseCardPhotometry(photometry) };
      } catch {
        this.sharedPhotometric = null;
      }
    }
    this.sharedCharacterSlotQa = characterSlot;
    this.sharedCharacterTextQa = characterText;
    this.sharedFlagDistinctiveQa = flagDistinctive;
    this.sharedFlagTricolorQa = flagTricolor;
    this.sharedPartTextQa = partText;
    this.sharedTireTextTop3GuardQa = tireTextTop3Guard;
    this.sharedSaveSelectedCropsQa = saveSelectedCrops;
    this.sharedToneSuggestionQa = toneSuggestion;
    this.sharedPartSubsetQa = partSubset;
    this.sharedJointLoadoutQa = jointLoadout;
    this.sharedResultFlagWhiteQa = resultFlagWhite;
    this.sharedCharacterColourQa = characterColour;
    if (partText || partSubset) await this.sharedIconQa.getPartContext();
  }

  /** Let the shared result decision (field semantics in packages/icon-matcher)
   * supply the visible result-card fields. The selected choice is shown; only
   * an accepted ID counts as certain, the rest stay `?` with alternatives.
   * The previous reader's decision is kept beside it as `shared_field.legacy`.
   */
  async enableSharedFieldProduct(source: AssetSource, indexPath: string): Promise<void> {
    if (!this.sharedIconQa || !this.sharedCharacterTextQa || !this.sharedPartTextQa) {
      throw new Error('Shared field product requires the shared reader with character and part context');
    }
    const index = await source.json(indexPath) as { schema?: string; catalogSha256?: string;
      flags?: Record<string, number>; tires?: Record<string, number> };
    if (index.schema !== 'mk8dx.scanner-field-index.v1' || index.catalogSha256 !== this.sharedIconQa.catalogSha256
        || !index.flags || !index.tires) throw new Error('Shared field index does not match the reference pack');
    // Load every tensor group now, so a missing or damaged pack stops the start-up instead of
    // failing in the middle of a scan.
    for (const kind of ['characters', 'bodies', 'tires', 'gliders', 'flags']) {
      await this.sharedIconQa.get(kind, 'result');
    }
    await this.sharedIconQa.get('characters', 'ghost_select');
    this.sharedFieldIndex = { flags: index.flags, tires: index.tires };
    // The central Select-a-Ghost picker needs the pack's printed part names (pack 0.4.0 and
    // later); without them a panel keeps the per-field decision only.
    this.ghostPicker = null;
    try {
      const slash = indexPath.lastIndexOf('/');
      const partNamesPath = slash >= 0 ? `${indexPath.slice(0, slash)}/part-names-v1.json` : 'part-names-v1.json';
      const partNames = await source.json(partNamesPath) as PartNameTable;
      if (partNames.schema !== 'mk8dx.part-names.v1' || partNames.catalogSha256 !== this.sharedIconQa.catalogSha256) {
        throw new Error('Part names do not match the reference pack');
      }
      const context = await this.sharedIconQa.getPartContext();
      this.ghostPicker = { characters: await this.sharedIconQa.get('characters', 'ghost_select'),
        bodies: await this.sharedIconQa.get('bodies', 'result'), tires: await this.sharedIconQa.get('tires', 'result'),
        gliders: await this.sharedIconQa.get('gliders', 'result'), flags: await this.sharedIconQa.get('flags', 'result'),
        familyById: context.familyById, partForCharacter: context.partForCharacter, partNames };
    } catch {
      this.ghostPicker = null;
    }
  }

  /** Which Select-a-Ghost decision runs: the central picker, or the per-field decision only. */
  get ghostPanelDecision(): 'central_picker' | 'per_field' | 'none' {
    return !this.sharedFieldIndex ? 'none' : this.ghostPicker ? 'central_picker' : 'per_field';
  }

  private sharedFieldView(field: 'character' | 'kart' | 'wheel' | 'glider' | 'flag', id: string):
      { id: string; index: number | null; name: string; asset_ref?: string } | null {
    const fieldIndex = this.sharedFieldIndex!;
    if (field === 'wheel' || field === 'flag') {
      const index = (field === 'wheel' ? fieldIndex.tires : fieldIndex.flags)[id];
      if (index === undefined) return null;
      const dir = field === 'wheel' ? 'tire' : 'mk8_flags';
      return { id, index, name: this.displayName(dir, index), asset_ref: `${ASSET_ROOT}/${dir}/${index}.png` };
    }
    const group = field === 'character' ? 'characters' : field === 'kart' ? 'bodies' : 'gliders';
    return { id, index: null, name: this.cleanAssets.displayName(id, group),
      asset_ref: this.cleanAssets.assetRefFor(id, group) ?? undefined };
  }

  /** The central open-set suggestion is a bare "Mii" (no size), whatever the catalog calls its id. */
  private openSetView<T extends { name: string }>(view: T | null, basis: string): T | null {
    return view && basis === 'open_set' ? { ...view, name: MII_LABEL } : view;
  }

  private adoptSharedResultProposal(out: OwnerIdentity, proposal: ResultProposal): void {
    for (const field of ['character', 'kart', 'wheel', 'glider', 'flag'] as const) {
      const entry = out[field];
      if (!entry) continue;
      const decision = proposal.fields[field];
      const legacy = { id: entry.id ?? null, index: entry.index ?? null, name: entry.name ?? '', ok: entry.ok ?? false };
      const selected = decision.selectedId ? this.sharedFieldView(field, decision.selectedId) : null;
      if (decision.status === 'unavailable' || !selected) {
        // No central reading: the field is unknown (`?`); older rules do not guess (2026-10-30).
        clearChoice(entry);
        entry.shared_field = { version: SHARED_FIELD_SEMANTICS_VERSION,
          status: selected ? decision.status : 'unavailable', legacy };
        continue;
      }
      // Wheels and flags keep the scanner's index-only shape; the shared ID
      // stays in shared_field.selectedId.
      entry.id = field === 'wheel' || field === 'flag' ? null : selected.id;
      entry.index = selected.index;
      entry.name = decision.openSet?.mode === 'propose' && decision.selectedId === decision.openSet.id
        ? decision.openSet.label : selected.name;
      entry.asset_ref = selected.asset_ref;
      entry.ok = decision.acceptedId !== null;
      const first = decision.top.find((candidate) => candidate.id === decision.selectedId);
      if (first?.matchScore != null) entry.score = first.matchScore;
      entry.evidence = `shared_field_${SHARED_FIELD_SEMANTICS_VERSION}`;
      entry.shared_field = { version: SHARED_FIELD_SEMANTICS_VERSION, status: decision.status,
        selectedId: decision.selectedId, acceptedId: decision.acceptedId,
        reviewRequired: decision.reviewRequired,
        alternatives: decision.top.filter((candidate) => candidate.id !== decision.selectedId)
          .slice(0, 2).map((candidate) => this.openSetView(this.sharedFieldView(field, candidate.id), candidate.basis))
          .filter((view): view is NonNullable<typeof view> => view !== null),
        legacy };
    }
  }

  /**
   * Select-a-Ghost panel, decided centrally (packages/icon-matcher sharedGhostPanel, the same
   * picker as Python and Java): this engine is the ROI Searcher and describes the registered,
   * colour-corrected panel (frame-description-v1); the picker refines every icon's position,
   * compares and decides each field (frame-decision-v1). The engine only shows the decision:
   * the selected choice, certain only when accepted. The previous decision stays in
   * shared_field.legacy.
   */
  private decideGhostPanelCentrally(source: any, out: OwnerIdentity): void {
    const refs = this.ghostPicker!;
    const c = cv();
    const engineField = { character: 'character', kart: 'body', wheel: 'tire', glider: 'glider', flag: 'flag' } as const;
    const fields: FrameDescription['fields'] = [];
    for (const field of ['character', 'kart', 'wheel', 'glider', 'flag'] as const) {
      const slot = out[field]?.slot_xywh;
      if (!slot) continue;
      const item: FrameDescription['fields'][number] = { field: engineField[field],
        slot: slot.map((value) => Math.round(value)) as [number, number, number, number] };
      if (field === 'kart' || field === 'wheel' || field === 'glider') {
        item.context = { printedText: out[field]?.text?.text ?? null };
      }
      fields.push(item);
    }
    if (!fields.length) return;
    const slots = new Map(fields.map((item) => [item.field, item.slot]));
    const residual = (out.photometric_qa as { residual?: number } | undefined)?.residual;
    const description: FrameDescription = { schema: 'mk8dx.frame-description.v1', frame: 'timetrial_ghost_select',
      console: 'unknown', source: 'phone_photo', image: { width: source.cols, height: source.rows },
      residual: typeof residual === 'number' ? residual : null, locale: 'en-GB', fields };
    // crop_at (Python ghost_panel): floor(v + 0.5) on the moved, scaled slot; none outside the frame.
    const cache = new Map<string, Float32Array | null>();
    const crops: CropSource = { crop: (field: GhostField, dx, dy, scale, width, height) => {
      const key = `${field}|${dx}|${dy}|${scale.toFixed(2)}|${width}x${height}`;
      if (cache.has(key)) return cache.get(key)!;
      const [x, y, w, h] = slots.get(field)!;
      const cx = x + w / 2 + dx;
      const cy = y + h / 2 + dy;
      const hw = (w * scale) / 2;
      const hh = (h * scale) / 2;
      const x0 = Math.floor(cx - hw + 0.5);
      const y0 = Math.floor(cy - hh + 0.5);
      const x1 = Math.floor(cx + hw + 0.5);
      const y1 = Math.floor(cy + hh + 0.5);
      let query: Float32Array | null = null;
      if (x0 >= 0 && y0 >= 0 && x1 <= source.cols && y1 <= source.rows && x1 - x0 >= 4 && y1 - y0 >= 4) {
        const roi = source.roi(new c.Rect(x0, y0, x1 - x0, y1 - y0));
        try {
          query = normalizeCvBgrCrop(c, roi, width, height);
        } finally {
          roi.delete();
        }
      }
      cache.set(key, query);
      return query;
    } };
    const decision = decideGhostSelectFrame(description, crops, refs, SHARED_FIELD_SEMANTICS_VERSION);
    const back = { character: 'character', body: 'kart', tire: 'wheel', glider: 'glider', flag: 'flag' } as const;
    for (const decided of decision.fields) {
      const field = back[decided.field as keyof typeof back];
      const entry = out[field];
      if (!entry) continue;
      const legacy = { id: entry.id ?? null, index: entry.index ?? null, name: entry.name ?? '', ok: entry.ok ?? false };
      const view = decided.selectedId ? this.sharedFieldView(field, decided.selectedId) : null;
      let status = decided.basis;
      if (view) {
        entry.id = field === 'wheel' || field === 'flag' ? null : view.id;
        entry.index = view.index;
        entry.name = view.name;
        entry.asset_ref = view.asset_ref;
        entry.evidence = `ghost_panel_picker_${SHARED_FIELD_SEMANTICS_VERSION}`;
        entry.ok = decided.acceptedId !== null;
      } else {
        // A choice this scanner has no picture for (or none placed): unknown, for the player to pick.
        clearChoice(entry);
        status = decided.selectedId ? 'not_displayable' : decided.basis;
      }
      entry.shared_field = { version: SHARED_FIELD_SEMANTICS_VERSION, decision: decision.decisionVersion,
        status, selectedId: decided.selectedId, acceptedId: decided.acceptedId, reviewRequired: !entry.ok,
        alternatives: decided.alternatives, legacy };
    }
    out.ghost_panel_decision_qa = { reliableColour: decision.reliableColour, decisionVersion: decision.decisionVersion,
      fields: decision.fields.map(({ field, selectedId, acceptedId, basis, score, evidence }) =>
        ({ field, selectedId, acceptedId, basis, score, evidence })) };
  }

  /** Opt-in result-card probe, using only the ghost name's white glyphs from
   * this same frame. All normal and uncorrected shared fields remain intact.
   */
  async attachResultFlagWhiteQa(canonical: any,
    owners: Record<string, OwnerIdentity>): Promise<void> {
    if (!this.sharedIconQa || !this.sharedResultFlagWhiteQa) return;
    const c = cv();
    const slot = owners.ghost?.flag?.slot_xywh;
    let anchor: ReturnType<typeof resultGhostNameWhite> = null;
    if (slot && canonical.cols === 1280 && canonical.rows === 720
        && canonical.channels() === 3) {
      const dense = canonical.clone();
      try {
        anchor = resultGhostNameWhite(dense.data as Uint8Array,
          dense.cols, dense.rows, slot);
      } finally { dense.delete(); }
    }
    for (const owner of Object.values(owners)) {
      const flag = owner.flag;
      if (!flag) continue;
      const original = flag.shared_icon_qa as (VisualFieldRead & {
        crop_xywh?: [number, number, number, number]
      }) | undefined;
      const begun = performance.now();
      const sourceCropPixelSha256 = original?.cropPixelSha256 ?? null;
      if (!anchor || original?.schema !== 'mk8dx.visual-field-read.v1'
          || original.profile !== 'result' || original.kind !== 'flags'
          || !original.crop_xywh) {
        flag.flag_white_qa = { schema: 'mk8dx.result-flag-white-shadow.v1',
          status: 'unavailable', reason: !anchor ? 'no_same_frame_name_white'
            : 'no_selected_result_flag_crop', sourceCropPixelSha256,
          acceptedId: null, elapsed_ms: performance.now() - begun };
        continue;
      }
      const [x, y, w, h] = original.crop_xywh;
      if (x < 0 || y < 0 || w < 4 || h < 4
          || x + w > canonical.cols || y + h > canonical.rows) {
        flag.flag_white_qa = { schema: 'mk8dx.result-flag-white-shadow.v1',
          status: 'unavailable', reason: 'selected_crop_outside_frame',
          sourceCropPixelSha256, acceptedId: null,
          elapsed_ms: performance.now() - begun };
        continue;
      }
      const crop = canonical.roi(new c.Rect(x, y, w, h));
      try {
        const dense = crop.clone();
        try {
          const corrected = correctResultFlagBgr(dense.data as Uint8Array,
            anchor.gainsBgr);
          (dense.data as Uint8Array).set(corrected);
          const references = await this.sharedIconQa.get('flags', 'result');
          const match = matchCvBgrCrop(c, dense, references, 'center_shortlist');
          const read = await visualFieldResult(match, dense, 'flags', 'result',
            this.sharedIconQa.catalogSha256);
          const rgb = normalizeCvBgrCrop(c, dense, references.width, references.height);
          const top = distinctiveFlagRank(rgb, references,
            read.top.map((candidate) => candidate.id));
          const correctedRead = { ...read, crop_xywh: original.crop_xywh,
            flag_distinctive_qa: { schema: 'mk8dx.flag-distinctive-shadow.v1',
              cropPixelSha256: read.cropPixelSha256, originalTop1Id: read.top1Id, top } };
          flag.flag_white_qa = { schema: 'mk8dx.result-flag-white-shadow.v1',
            status: 'measured', anchor, sourceCropPixelSha256,
            corrected: correctedRead, elapsed_ms: performance.now() - begun };
          owner.shared_result_white_proposal_qa = composeResultProposal({ ...owner,
            flag: { ...flag, shared_icon_qa: correctedRead } });
        } finally { dense.delete(); }
      } catch (error) {
        flag.flag_white_qa = { schema: 'mk8dx.result-flag-white-shadow.v1',
          status: 'error', reason: error instanceof Error ? error.message : 'unknown_error',
          sourceCropPixelSha256, acceptedId: null,
          elapsed_ms: performance.now() - begun };
      } finally { crop.delete(); }
    }
  }

  /** Open same-frame Ghost character/body/glider combination on selected crops. */
  async attachSharedJointLoadoutQa(canonical: any, owner: OwnerIdentity | undefined,
    totalBox: [number, number, number, number] | null): Promise<void> {
    if (!this.sharedIconQa || !this.sharedJointLoadoutQa || !owner || !totalBox) return;
    const begun = performance.now();
    const c = cv();
    let partial: Record<string, unknown> | null = null;
    try {
      const tone = ghostTotalWhite(c, canonical, totalBox);
      const mode = ghostToneMode(tone);
      const context = await this.sharedIconQa.getPartContext();
      const selected = (field: 'character' | 'kart' | 'glider') => {
        const entry = owner[field];
        const read = entry?.shared_icon_qa as (VisualFieldRead & {
          crop_xywh?: [number, number, number, number]
        }) | undefined;
        if (read?.schema !== 'mk8dx.visual-field-read.v1' || !read.crop_xywh) {
          throw new Error(`Missing selected ${field} icon crop`);
        }
        const [x, y, width, height] = read.crop_xywh;
        if (x < 0 || y < 0 || width < 4 || height < 4
            || x + width > canonical.cols || y + height > canonical.rows) {
          throw new Error(`Selected ${field} crop outside canonical frame`);
        }
        return { entry, read, crop: canonical.roi(new c.Rect(x, y, width, height)) };
      };
      const character = selected('character');
      let characters: ReturnType<typeof rankGhostCharacter>;
      try {
        const group = await this.sharedIconQa.get('characters', 'ghost_select');
        const adjusted = mode === 'digit_neutral_clahe_low_contrast'
          ? correctedGhostCrop(c, character.crop, tone.gainsBgr) : character.crop;
        try {
          const query = normalizeCvBgrCrop(c, adjusted, group.width, group.height);
          characters = rankGhostCharacter(query, group, mode);
        } finally { if (adjusted !== character.crop) adjusted.delete(); }
      } finally { character.crop.delete(); }
      // A missing part crop must not erase an independently ranked character.
      partial = { frameTone: tone, mode,
        characterCropPixelSha256: character.read.cropPixelSha256,
        characterTop3: characters.match.top,
        characterGain: characters.luminanceGain };
      const part = async (field: 'kart' | 'glider', kind: 'bodies' | 'gliders') => {
        const item = selected(field);
        try {
          const group = await this.sharedIconQa!.get(kind, 'result');
          const clue = (item.entry?.part_text_qa as { clue?: {
            id?: string; fuzzy?: number; margin?: number
          } } | undefined)?.clue;
          const textFamily = clue?.id ? context.familyById.get(clue.id) : undefined;
          const strong = textFamily !== undefined && (clue?.fuzzy ?? 0) >= .85
            && (clue?.margin ?? 0) >= .08;
          const subset = item.entry?.part_subset_qa as {
            status?: string; sourceCropPixelSha256?: string;
            top3?: { familyId: string }[]
          } | undefined;
          if (subset?.status !== 'ranked'
              || subset.sourceCropPixelSha256 !== item.read.cropPixelSha256
              || !subset.top3?.length) {
            throw new Error(`Missing same-crop ${field} family ranking`);
          }
          const familyId = strong ? textFamily : subset.top3[0].familyId;
          const adjusted = mode === 'digit_neutral_clahe_low_contrast'
            ? correctedGhostCrop(c, item.crop, tone.gainsBgr) : item.crop;
          try {
            return { query: normalizeCvBgrCrop(c, adjusted, group.width, group.height),
              group, familyId, familyBasis: strong ? 'strong_text' : 'visual_top1',
              cropPixelSha256: item.read.cropPixelSha256 };
          } finally { if (adjusted !== item.crop) adjusted.delete(); }
        } finally { item.crop.delete(); }
      };
      const body = await part('kart', 'bodies');
      const glider = await part('glider', 'gliders');
      const loadouts = rankGhostLoadouts(characters.match.top, body.query, body.group,
        body.familyId, glider.query, glider.group, glider.familyId, context);
      owner.joint_loadout_qa = {
        schema: 'mk8dx.web-ghost-joint-loadout.v1', status: 'ranked',
        ...partial, acceptedId: null,
        kart: { cropPixelSha256: body.cropPixelSha256, familyId: body.familyId,
          familyBasis: body.familyBasis, luminanceGain: loadouts.bodyGain },
        glider: { cropPixelSha256: glider.cropPixelSha256, familyId: glider.familyId,
          familyBasis: glider.familyBasis, luminanceGain: loadouts.gliderGain },
        top3Loadouts: loadouts.top3, elapsedMs: performance.now() - begun,
      };
    } catch (error) {
      owner.joint_loadout_qa = { schema: 'mk8dx.web-ghost-joint-loadout.v1',
        status: partial ? 'partial' : 'unavailable', ...partial,
        reason: error instanceof Error ? error.message : 'unknown_error',
        acceptedId: null, elapsedMs: performance.now() - begun };
    }
    // An opt-in named choice also survives a partial loadout. The normal
    // character/part/flag/tire product fields above are never replaced.
    owner.shared_proposal_qa = composeGhostProposal(owner as GhostProposalOwner);
  }

  /** Same-frame character top three narrows colour variants, without accepting one. */
  private async attachSharedPartSubsetQa(canonical: any, owner: OwnerIdentity): Promise<void> {
    if (!this.sharedIconQa || !this.sharedPartSubsetQa) return;
    const characters = (owner.character?.shared_icon_qa as VisualFieldRead | undefined)?.top
      ?.slice(0, 3).map((candidate) => candidate.id) ?? [];
    for (const [field, kind] of [['kart', 'bodies'], ['glider', 'gliders']] as const) {
      const part = owner[field];
      const raw = part?.shared_icon_qa as (VisualFieldRead & {
        crop_xywh?: [number, number, number, number]
      }) | undefined;
      if (!part) continue;
      if (!characters.length || raw?.schema !== 'mk8dx.visual-field-read.v1'
          || !raw.crop_xywh) {
        part.part_subset_qa = { schema: 'mk8dx.part-subset-rank.v1',
          status: 'unavailable', reason: !characters.length ? 'missing_character_candidates'
            : 'missing_part_crop', acceptedId: null };
        continue;
      }
      const begun = performance.now();
      try {
        const [x, y, width, height] = raw.crop_xywh;
        if (x < 0 || y < 0 || width < 4 || height < 4
            || x + width > canonical.cols || y + height > canonical.rows) {
          throw new Error('Selected shared part crop outside canonical frame');
        }
        const group = await this.sharedIconQa.get(kind, 'result');
        const context = await this.sharedIconQa.getPartContext();
        const crop = canonical.roi(new (cv().Rect)(x, y, width, height));
        try {
          const rgb = normalizeCvBgrCrop(cv(), crop, group.width, group.height);
          part.part_subset_qa = { ...rankPartSubset(rgb, group, kind, characters, context),
            status: 'ranked', sourceCropPixelSha256: raw.cropPixelSha256,
            crop_xywh: raw.crop_xywh, elapsedMs: performance.now() - begun };
        } finally { crop.delete(); }
      } catch (error) {
        // A private QA ranking must never suppress a normal identity read.
        part.part_subset_qa = { schema: 'mk8dx.part-subset-rank.v1',
          status: 'error', reason: error instanceof Error ? error.message : 'unknown_error',
          sourceCropPixelSha256: raw.cropPixelSha256, acceptedId: null,
          elapsedMs: performance.now() - begun };
      }
    }
  }

  /** Opt-in Ghost colour proposal on the exact selected worker crop. */
  async attachSharedToneQa(canonical: any, owner: OwnerIdentity | undefined,
    totalBox: [number, number, number, number] | null): Promise<void> {
    if (!this.sharedIconQa || !this.sharedToneSuggestionQa || !owner || !totalBox) return;
    const c = cv();
    const white = ghostTotalWhite(c, canonical, totalBox);
    for (const [field, kind] of [['kart', 'bodies'], ['glider', 'gliders']] as const) {
      const part = owner[field];
      const raw = part?.shared_icon_qa as (VisualFieldRead & {
        crop_xywh?: [number, number, number, number]
      }) | undefined;
      if (!part || raw?.schema !== 'mk8dx.visual-field-read.v1' || !raw.crop_xywh) continue;
      const begun = performance.now();
      const dark = white.whiteLevel < 210;
      const [x, y, width, height] = raw.crop_xywh;
      if (!dark) {
        part.tone_suggestion_qa = { schema: 'mk8dx.web-ghost-tone-suggestion.v1',
          status: 'raw', sourceCropPixelSha256: raw.cropPixelSha256,
          whiteLevel: white.whiteLevel, gainsBgr: white.gainsBgr,
          rawTop3: raw.top.slice(0, 3), correctedTop3: null,
          suggestedTop1Id: null, acceptedId: null,
          elapsedMs: performance.now() - begun };
        continue;
      }
      if (x < 0 || y < 0 || width < 4 || height < 4
          || x + width > canonical.cols || y + height > canonical.rows) {
        throw new Error('Selected shared icon crop outside canonical frame');
      }
      const crop = canonical.roi(new c.Rect(x, y, width, height));
      try {
        const corrected = correctedGhostCrop(c, crop, white.gainsBgr);
        try {
          const group = await this.sharedIconQa.get(kind, 'result');
          const match = matchCvBgrCrop(c, corrected, group, 'center_shortlist');
          const read = await visualFieldResult(match, corrected, kind, 'result',
            this.sharedIconQa.catalogSha256);
          const offered = raw.acceptedId === null && raw.top1Id !== read.top1Id
            && raw.top[0].familyId === read.top[0].familyId
            && read.margin > raw.margin;
          part.tone_suggestion_qa = { schema: 'mk8dx.web-ghost-tone-suggestion.v1',
            status: offered ? 'same_family_tone_alternative' : 'no_alternative',
            sourceCropPixelSha256: raw.cropPixelSha256,
            correctedCropPixelSha256: read.cropPixelSha256,
            whiteLevel: white.whiteLevel, gainsBgr: white.gainsBgr,
            rawTop3: raw.top.slice(0, 3), correctedTop3: read.top.slice(0, 3),
            rawMargin: raw.margin, correctedMargin: read.margin,
            correctedAcceptedId: read.acceptedId,
            suggestedTop1Id: offered ? read.top1Id : null,
            acceptedId: null, elapsedMs: performance.now() - begun };
        } finally { corrected.delete(); }
      } finally { crop.delete(); }
    }
  }

  /** The card corrected toward HDMI from its own lap circles (BGR copy), or null when off. */
  private sharedPhotometricCorrection(canonical: any, x: number, y: number, laps: number, owner: string):
    { mat: any; record: PhotometricRecord } | null {
    if (!this.sharedPhotometric || canonical.channels() !== 3) return null;
    const c = cv();
    const rgbMat = new c.Mat();
    c.cvtColor(canonical, rgbMat, c.COLOR_BGR2RGB);
    try {
      const others = this.photometricByCanonical.get(canonical) ?? {};
      const other = Object.entries(others).find(([o]) => o !== owner)?.[1] ?? null;
      const { rgb, record } = correctCard(rgbMat.data as Uint8Array, canonical.cols, canonical.rows, [x, y], laps,
        owner, this.sharedPhotometric.anchors, this.sharedPhotometric.photometry, other);
      others[owner] = record;
      this.photometricByCanonical.set(canonical, others);
      if (record.status !== 'corrected') return { mat: canonical, record };
      const outRgb = c.matFromArray(canonical.rows, canonical.cols, c.CV_8UC3, rgb);
      const bgr = new c.Mat();
      c.cvtColor(outRgb, bgr, c.COLOR_RGB2BGR);
      outRgb.delete();
      return { mat: bgr, record };
    } finally {
      rgbMat.delete();
    }
  }

  /** The record of the last correctGhostPanelInPlace, for this frame's photometric_qa. */
  private ghostPanelRecord: PanelPhotometricRecord | null = null;

  /**
   * The registered three-lap Select-a-Ghost panel corrected toward HDMI from its
   * own constant elements, in place, before anything on it is read (times, names,
   * both icon readers). Called by the pipeline right after registration; null when
   * the shared reader is off or the canonical is not a BGR panel.
   */
  correctGhostPanelInPlace(canonical: any | null): PanelPhotometricRecord | null {
    this.ghostPanelRecord = null;
    if (!canonical || !this.sharedPhotometric || canonical.channels() !== 3) return null;
    const c = cv();
    const rgbMat = new c.Mat();
    c.cvtColor(canonical, rgbMat, c.COLOR_BGR2RGB);
    try {
      const { rgb, record } = correctPanel(rgbMat.data as Uint8Array, canonical.cols, canonical.rows);
      if (record.status === 'corrected') {
        const outRgb = c.matFromArray(canonical.rows, canonical.cols, c.CV_8UC3, rgb);
        c.cvtColor(outRgb, canonical, c.COLOR_RGB2BGR);
        outRgb.delete();
      }
      this.ghostPanelRecord = record;
      return record;
    } finally {
      rgbMat.delete();
    }
  }

  private async sharedFlagWindow(canonical: any, slot: [number, number, number, number]):
    Promise<{ box: [number, number, number, number]; read: Record<string, unknown> } | null> {
    const [sx, sy, sw, sh] = slot.map(Math.round);
    const wx = Math.max(0, sx - FLAG_WINDOW_PAD);
    const wy = Math.max(0, sy - FLAG_WINDOW_PAD);
    const ww = Math.min(canonical.cols, sx + sw + FLAG_WINDOW_PAD) - wx;
    const wh = Math.min(canonical.rows, sy + sh + FLAG_WINDOW_PAD) - wy;
    if (sx < wx || sy < wy || sx + sw > wx + ww || sy + sh > wy + wh) return null;
    const window = canonical.roi(new (cv().Rect)(wx, wy, ww, wh));
    try {
      const refs = await this.sharedIconQa!.get('flags', 'result');
      const read = matchCvBgrFlagWindow(cv(), window, [sx - wx, sy - wy, sw, sh], refs);
      const [left, top, width, height] = read.cropXywh;
      return { box: [wx + left, wy + top, width, height],
        read: { ...read, window_xywh: [wx, wy, ww, wh], slot_in_window: [sx - wx, sy - wy, sw, sh],
          ...(this.sharedSaveSelectedCropsQa ? { window_png: await bgrMatToPngDataUrl(cv(), window) } : {}) } };
    } finally { window.delete(); }
  }

  private async sharedTireWindow(canonical: any,
    slot: [number, number, number, number]): Promise<Record<string, unknown>> {
    const started = performance.now();
    const [sx, sy, sw, sh] = slot.map(Math.round);
    const wx = Math.max(0, sx - SEARCH_PAD_PX);
    const wy = Math.max(0, sy - SEARCH_PAD_PX);
    const ww = Math.min(canonical.cols, sx + sw + SEARCH_PAD_PX) - wx;
    const wh = Math.min(canonical.rows, sy + sh + SEARCH_PAD_PX) - wy;
    const window = canonical.roi(new (cv().Rect)(wx, wy, ww, wh));
    try {
      const refs = await this.sharedIconQa!.get('tires', 'result');
      const located = matchCvBgrTireWindow(cv(), window,
        [sx - wx, sy - wy, sw, sh], refs);
      const [left, top, width, height] = located.cropXywh;
      const chosen = window.roi(new (cv().Rect)(left, top, width, height));
      try {
        const read = await visualFieldResult(located.match, chosen, 'tires', 'result',
          this.sharedIconQa!.catalogSha256);
        return { ...read, crop_xywh: [wx + left, wy + top, width, height],
          ...(this.sharedSaveSelectedCropsQa
            ? { crop_png: await bgrMatToPngDataUrl(cv(), chosen) } : {}),
          window_xywh: [wx, wy, ww, wh], basis: located.basis,
          evaluated: located.evaluated, elapsed_ms: performance.now() - started };
      } finally { chosen.delete(); }
    } finally { window.delete(); }
  }

  private async sharedIconShadow(canonical: any, kind: VisualFieldRead['kind'],
    profile: VisualFieldRead['profile'], box: [number, number, number, number],
    old: IdentityEntry, subset: Set<string> | null, rawRgbCandidate: boolean,
    achromaticGapCandidate: boolean): Promise<Record<string, unknown>> {
    const started = performance.now();
    const [left, top, width, height] = box.map(Math.round);
    const x = Math.max(0, Math.min(canonical.cols - 1, left));
    const y = Math.max(0, Math.min(canonical.rows - 1, top));
    const w = Math.min(width, canonical.cols - x);
    const h = Math.min(height, canonical.rows - y);
    if (w < 4 || h < 4) return { status: 'no_crop', crop_xywh: box };
    const crop = canonical.roi(new (cv().Rect)(x, y, w, h));
    try {
      const dense = crop.clone();
      let oldPixels: Uint8Array<ArrayBuffer>;
      try {
        const data = dense.data as Uint8Array;
        oldPixels = new Uint8Array(data.length);
        oldPixels.set(data);
      }
      finally { dense.delete(); }
      const oldDigest = await crypto.subtle.digest('SHA-256', oldPixels);
      const oldCropPixelSha256 = Array.from(new Uint8Array(oldDigest),
        (value) => value.toString(16).padStart(2, '0')).join('');
      let oldSameCrop: Record<string, unknown>;
      if (kind === 'characters' || kind === 'bodies' || kind === 'gliders') {
        const priorTrace = this.cleanAssets.traceFamilyColor;
        if (this.sharedSaveSelectedCropsQa) this.cleanAssets.traceFamilyColor = true;
        let rerun: IdentityEntry;
        try {
          rerun = this.cleanAssets.identifyCrop(crop, kind, subset, [[0, 0]],
            kind === 'characters' ? 12 : 0, rawRgbCandidate, achromaticGapCandidate);
        } finally { this.cleanAssets.traceFamilyColor = priorTrace; }
        oldSameCrop = { basis: 'rerun_unmodified_bgr', id: rerun.id ?? null,
          score: rerun.score ?? null, margin: rerun.margin ?? null,
          margin_ext: rerun.margin_ext ?? null, top3: rerun.top3 ?? [],
          family_color_trace: rerun.family_color_trace ?? null,
          subset_size: subset?.size ?? null };
      } else if (kind === 'tires') {
        // The legacy tire matcher reads Mat.data as a dense array. A canonical
        // ROI can have a parent-row stride, so rerun it on the same pixels in
        // a dense Mat; otherwise this QA comparator scores the wrong rows.
        const denseCrop = crop.clone();
        try {
          const rerun = this.matchIconWindowed(denseCrop, 'tire', w, h, true);
          oldSameCrop = { basis: 'rerun_unmodified_bgr', index: rerun.index ?? null,
            score: rerun.score ?? null, margin: rerun.margin ?? null,
            ok: rerun.ok ?? false };
        } finally { denseCrop.delete(); }
      } else {
        // The normal flag matcher already ranks this precise selected inset.
        oldSameCrop = { basis: 'original_selected_bgr', index: old.index ?? null,
          score: old.score ?? null, margin: old.margin ?? null, ok: old.ok ?? false };
      }
      const references = await this.sharedIconQa!.get(kind, profile);
      const match = matchCvBgrCrop(cv(), crop, references, 'center_shortlist');
      const read = await visualFieldResult(match, crop, kind, profile,
        this.sharedIconQa!.catalogSha256);
      const shapeRank = kind === 'flags' || kind === 'tires'
        ? rankIconShape(normalizeCvBgrCrop(cv(), crop, references.width, references.height),
          references, kind === 'flags' ? 'full_rgb_ncc' : 'masked_gray_ncc') : null;
      const neutralChroma = kind === 'characters' && profile === 'result'
        ? rankNeutralChroma(normalizeCvBgrCrop(cv(), crop, references.width, references.height),
          references, match) : null;
      const familyColour = kind === 'characters' && profile === 'result'
        && this.sharedCharacterColourQa
        ? rankCharacterFamilyColour(normalizeCvBgrCrop(cv(), crop, references.width, references.height),
          references, match) : null;
      let flagDistinctive: Record<string, unknown> | null = null;
      let flagTricolor: Record<string, unknown> | null = null;
      let flagExposure: Record<string, unknown> | null = null;
      let flagBand: Record<string, unknown> | null = null;
      if (kind === 'flags' && this.sharedFlagDistinctiveQa) {
        const begun = performance.now();
        const rgb = normalizeCvBgrCrop(cv(), crop, references.width, references.height);
        const top = distinctiveFlagRank(rgb, references, read.top.map((candidate) => candidate.id));
        flagDistinctive = { schema: 'mk8dx.flag-distinctive-shadow.v1',
          cropPixelSha256: read.cropPixelSha256, originalTop1Id: read.top1Id,
          top, elapsed_ms: performance.now() - begun };
        if (this.sharedFlagTricolorQa && profile === 'result' && read.score >= .80) {
          flagTricolor = { ...flagTricolorEvidence(rgb, references,
            read.top.map((candidate) => candidate.id), top[0].id,
            shapeRank ?? undefined),
          cropPixelSha256: read.cropPixelSha256 };
        }
        if (this.sharedFlagTricolorQa && profile === 'result' && shapeRank) {
          flagExposure = { ...flagExposureProposal(rgb, references, shapeRank),
            cropPixelSha256: read.cropPixelSha256 };
        }
        if (this.sharedFlagTricolorQa && profile === 'result'
          && read.top.some((candidate) => candidate.id === 'country.nl' || candidate.id === 'country.lu')) {
          flagBand = { ...flagBandRatio(rgb), cropPixelSha256: read.cropPixelSha256 };
        }
      }
      return { ...read, crop_xywh: [x, y, w, h],
        ...(this.sharedSaveSelectedCropsQa
          ? { crop_png: await bgrMatToPngDataUrl(cv(), crop) } : {}),
        old_same_crop: { ...oldSameCrop, cropPixelSha256: oldCropPixelSha256 },
        old_visual: { id: old.id ?? null, index: old.index ?? null, ok: old.ok ?? false,
          score: old.score ?? null, margin: old.margin ?? null, evidence: old.evidence ?? null },
        flag_distinctive_qa: flagDistinctive,
        flag_tricolor_qa: flagTricolor,
        flag_exposure_qa: flagExposure,
        flag_band_ratio_qa: flagBand,
        shape_rank_qa: shapeRank ? { ...shapeRank, cropPixelSha256: read.cropPixelSha256 } : null,
        neutral_chroma_qa: neutralChroma
          ? { ...neutralChroma, cropPixelSha256: read.cropPixelSha256 } : null,
        family_colour_qa: familyColour
          ? { ...familyColour, cropPixelSha256: read.cropPixelSha256 } : null,
        elapsed_ms: performance.now() - started };
    } finally {
      crop.delete();
    }
  }

  // ------------------------------------------------------------------
  // Deploy-registratie
  // ------------------------------------------------------------------
  private async cardTemplate(key: string): Promise<any> {
    if (!this.regTemplateCache.has(key)) {
      let tmpl: any = null;
      try {
        const gray = await loadGray(this.source, `clean_assets/reg/${key}.png`);
        tmpl = new (cv().Mat)();
        gray.convertTo(tmpl, cv().CV_32F);
        gray.delete();
      } catch {
        tmpl = null;
      }
      this.regTemplateCache.set(key, tmpl);
    }
    return this.regTemplateCache.get(key);
  }

  // The decision (scale grid, score, refinement) is central (sharedFrameGeometry registerCard); the
  // edge map and the template match are this scanner's pixel work.
  private registerCard(canonical: any, px1: number, py1: number, pw: number, ph: number, templateOwner: string, laps: string): number[] | null {
    const c = cv();
    const templ = this.regTemplateCache.get(`${templateOwner}_${laps}`);
    if (!templ) return null;
    const panel: PanelBox = { x: px1, y: py1, w: pw, h: ph, source: 'static_canonical' };
    const window = registerWindow(this.frameDefs, panel, canonical.cols, canonical.rows);
    let edgesFull: any = null;
    let region: any = null;
    const edges = () => {
      if (edgesFull) return;
      const crop = canonical.roi(new c.Rect(window[0], window[1], window[2] - window[0], window[3] - window[1]));
      const gray8 = new c.Mat();
      c.cvtColor(crop, gray8, c.COLOR_BGR2GRAY);
      crop.delete();
      const grayF = new c.Mat();
      gray8.convertTo(grayF, c.CV_32F);
      gray8.delete();
      edgesFull = edgeMagnitude(grayF);
      grayF.delete();
      const [cw, ch] = registerCoarseSize(this.frameDefs, window);
      region = new c.Mat();
      c.resize(edgesFull, region, new c.Size(cw, ch), 0, 0, c.INTER_AREA);
    };
    const match = (image: any, tw: number, th: number, interpolation: number): [number, number, number] => {
      const t = new c.Mat();
      c.resize(templ, t, new c.Size(tw, th), 0, 0, interpolation);
      const res = new c.Mat();
      c.matchTemplate(image, t, res, c.TM_CCOEFF_NORMED);
      const mm = c.minMaxLoc(res);
      t.delete();
      res.delete();
      return [mm.maxVal, mm.maxLoc.x, mm.maxLoc.y];
    };
    try {
      return centralRegisterCard(this.frameDefs, panel, window, {
        coarse: (tw, th) => {
          edges();
          return match(region, tw, th, c.INTER_AREA);
        },
        fine: (x1, y1, x2, y2, tw, th) => {
          edges();
          const win = edgesFull.roi(new c.Rect(x1, y1, x2 - x1, y2 - y1));
          try {
            return match(win, tw, th, c.INTER_LINEAR);
          } finally {
            win.delete();
          }
        },
      });
    } finally {
      edgesFull?.delete();
      region?.delete();
    }
  }

  private deployBox(iconKind: string, laps: string, cw: number, ch: number): number[] | null {
    return centralDeployBox(this.frameDefs, iconKind, laps, cw, ch);
  }

  // ------------------------------------------------------------------
  // matchCard
  // ------------------------------------------------------------------
  async matchCard(canonical: any, physOwner: string, raceKey: string, anchorXY: number[] | null, yellowCard: boolean, localeSlot: (string | null)[] | null, guardCrossFamilyRescue = false, rawRgbCandidate = false, wheelTextConflictReviewCandidate = false, kartVariantTextReviewCandidate = false, wheelTextProposalCandidate = false, flagBlueBandReviewCandidate = false, achromaticGapCandidate = false, kartFamilySearchCandidate = false, gliderTextConflictReviewCandidate = false, cardBoxAlignCandidate = false, cardBox: number[] | null = null, gliderRowUpshiftCandidate = false, flagChromaticBandReviewCandidate = false): Promise<OwnerIdentity> {
    const c = cv();
    const ghostDetail = raceKey === RACE_KEY_GHOST_DETAIL || raceKey === RACE_KEY_GHOST_DETAIL7;
    const race = ghostDetail ? raceKey : (raceKey === 'race7' ? 'race7' : 'race3');
    const laps = ghostDetail ? raceKey : (race === 'race7' ? '7laps' : '3laps');
    const out: OwnerIdentity = {};
    let px1: number;
    let py1: number;
    let pw: number;
    let ph: number;
    // The card: from the lap-index anchor, else (QA candidate) the detected card box, else the
    // static panel (central frame geometry, frame-definitions-v1.json).
    const anchored = anchorXY ? panelBox(this.frameDefs, raceKey, physOwner, anchorXY) : null;
    let panel: PanelBox;
    if (anchored && anchored.source === 'lap_index_anchor') {
      panel = anchored;
      out.panel_source = 'lap_index_anchor';
    } else if (cardBoxAlignCandidate && !ghostDetail && cardBox && cardBox.length === 4
        && cardBox[2] - cardBox[0] >= 0.25 && cardBox[3] - cardBox[1] >= 0.20) {
      panel = { x: cardBox[0] * canonical.cols, y: cardBox[1] * canonical.rows,
        w: (cardBox[2] - cardBox[0]) * canonical.cols, h: (cardBox[3] - cardBox[1]) * canonical.rows,
        source: 'static_canonical' };
      out.panel_source = 'detected_card_box';
    } else {
      const fixed = panelBox(this.frameDefs, raceKey, physOwner, null);
      if (!fixed) {
        out.status = `no_panel_for_${race}_${physOwner}`;
        return out;
      }
      panel = fixed;
      out.panel_source = 'static_canonical';
    }
    px1 = panel.x;
    py1 = panel.y;
    pw = panel.w;
    ph = panel.h;
    const reg = ghostDetail ? null : this.registerCard(canonical, px1, py1, pw, ph, yellowCard ? 'player' : 'ghost', laps);
    const registered = reg !== null && reg[5] === 0.0;
    if (reg) {
      out.grid = { mode: registered ? 'deploy_registered' : 'v1_fallback', dx: round1(reg[0]), dy: round1(reg[1]), sx: reg[2], sy: reg[3], score: round3(reg[4]) };
    }
    let charId: string | null = null;
    let sharedSource = canonical;
    let photometricRecord: PhotometricRecord | PanelPhotometricRecord | null = null;
    try {
    for (const [iconKind, assetDir, outKey] of KINDS) {
      const box = slotBox(this.frameDefs, physOwner, iconKind, laps, panel,
        registered && reg ? [reg[0], reg[1], reg[2], reg[3]] : null);
      if (!box) continue;
      const [x1, y1, slotW, slotH] = box;
      if (iconKind === 'character_icon' && this.sharedIconQa && this.sharedPhotometric
          && raceKey === RACE_KEY_GHOST_DETAIL) {
        // The registered three-lap panel was already corrected in place by its own
        // constant elements (correctGhostPanelInPlace, before any reading); an
        // unregistered one is corrected for the central reader only, as before.
        if (this.ghostPanelRecord) {
          photometricRecord = this.ghostPanelRecord;
          out.photometric_qa = this.ghostPanelRecord;
        } else {
          const copy = canonical.clone();
          const record = this.correctGhostPanelInPlace(copy);
          this.ghostPanelRecord = null;
          if (record) {
            sharedSource = copy;
            photometricRecord = record;
            out.photometric_qa = record;
          } else {
            copy.delete();
          }
        }
      }
      if (iconKind === 'character_icon' && this.sharedIconQa && this.sharedPhotometric && !ghostDetail) {
        const corrected = this.sharedPhotometricCorrection(canonical, x1, y1, laps === '7laps' ? 7 : 3,
          yellowCard ? 'player' : 'ghost');
        if (corrected) {
          sharedSource = corrected.mat;
          photometricRecord = corrected.record;
          out.photometric_qa = corrected.record;
        }
      }
      const [wx1, wy1, wx2, wy2] = searchWindow(this.frameDefs, iconKind, box, canonical.cols, canonical.rows);
      if (wx2 - wx1 < 8 || wy2 - wy1 < 8 || slotW < 8 || slotH < 8) {
        out[outKey] = { ok: false, reason: 'slot_outside_canonical' };
        continue;
      }
      let result: IdentityEntry;
      let shadowSubset: Set<string> | null = null;
      if (iconKind === 'flag_icon') {
        const window = cropClone(canonical, wx1, wy1, wx2 - wx1, wy2 - wy1);
        try {
          result = this.matchFlag(window, assetDir, slotW, slotH, flagBlueBandReviewCandidate, flagChromaticBandReviewCandidate);
        } finally {
          window.delete();
        }
        if (result.match_xywh) {
          result.match_xywh = [wx1 + result.match_xywh[0], wy1 + result.match_xywh[1],
            result.match_xywh[2], result.match_xywh[3]];
        }
        result.name = this.displayName(assetDir, result.index == null ? null : Number(result.index));
        if (flagChromaticBandReviewCandidate && !result.ok && result.index != null) {
          result.proposed_index = Number(result.index);
          result.review_required = true;
        }
        if (result.proposed_index != null) result.proposed_name = result.name;
        if (result.alternative_index != null) result.alternative_name = this.displayName(assetDir, result.alternative_index);
        if (result.ranked_candidates) {
          const ranked = result.ranked_candidates as { index: number; score: number; gray_score: number }[];
          const selected = ranked.find((candidate) => candidate.index === result.index);
          result.ranked_candidates = [
            ...(selected ? [selected] : []), ...ranked.filter((candidate) => candidate.index !== result.index),
          ].slice(0, 3).map((candidate) => ({ ...candidate,
            name: this.displayName(assetDir, candidate.index) }));
        }
      } else if (iconKind === 'wheel_icon') {
        const window = cropClone(canonical, wx1, wy1, wx2 - wx1, wy2 - wy1);
        try {
          result = this.matchIconWindowed(window, assetDir, slotW, slotH, true);
        } finally {
          window.delete();
        }
        if (result.match_xywh) {
          result.match_xywh = [wx1 + result.match_xywh[0], wy1 + result.match_xywh[1],
            result.match_xywh[2], result.match_xywh[3]];
        }
        result.name = this.displayName(assetDir, result.index == null ? null : Number(result.index));
      } else {
        const group = iconKind === 'character_icon' ? 'characters' : (iconKind === 'kart_icon' ? 'bodies' : 'gliders');
        let subset: Set<string> | null = null;
        if ((group === 'bodies' || group === 'gliders') && charId) {
          const subsetList = this.cleanAssets.partsSubsetForCharacter(charId, group);
          if (subsetList) subset = shadowSubset = new Set(subsetList);
        }
        const cx0 = Math.max(0, Math.min(canonical.cols - 1, x1));
        const cy0 = Math.max(0, Math.min(canonical.rows - 1, y1));
        const slotCrop = canonical.roi(new c.Rect(cx0, cy0, Math.min(slotW, canonical.cols - cx0), Math.min(slotH, canonical.rows - cy0)));
        const slotGray = new c.Mat();
        c.cvtColor(slotCrop, slotGray, c.COLOR_BGR2GRAY);
        const cropStd = matStd(slotGray);
        slotGray.delete();
        slotCrop.delete();
        if (!slotPresent('photo', 'icon', cropStd).present) {
          result = { ok: false, reason: 'low_contrast', crop_std: round1(cropStd), id: null, name: '', score: 0.0, margin: 0.0, evidence: 'contrast_gate' };
          result.slot_xywh = [x1, y1, slotW, slotH];
          out[outKey] = result;
          continue;
        }
        const kindSearch = iconKind === 'character_icon' ? 10 : 6;
        const wantTopk = iconKind === 'character_icon' ? 12 : 0;
        if (iconKind === 'character_icon') {
          let charSource = canonical;
          let roiX = 0;
          let roiY = 0;
          let boosted: any = null;
          if (!yellowCard) {
            const margin = SEARCH_PAD_PX + 8;
            roiX = Math.max(0, x1 - margin);
            roiY = Math.max(0, y1 - margin);
            const roiW = Math.min(canonical.cols - roiX, slotW + 2 * margin);
            const roiH = Math.min(canonical.rows - roiY, slotH + 2 * margin);
            const roiMat = canonical.roi(new c.Rect(roiX, roiY, roiW, roiH));
            const hsv = new c.Mat();
            c.cvtColor(roiMat, hsv, c.COLOR_BGR2HSV);
            const meanSat = c.mean(hsv)[1];
            if (meanSat > 1.0 && meanSat < 80.0) {
              const ch = new c.MatVector();
              c.split(hsv, ch);
              const s = ch.get(1);
              const sBoost = new c.Mat();
              s.convertTo(sBoost, -1, Math.min(2.0, 90.0 / meanSat), 0);
              const merged = new c.MatVector();
              merged.push_back(ch.get(0));
              merged.push_back(sBoost);
              merged.push_back(ch.get(2));
              c.merge(merged, hsv);
              boosted = new c.Mat();
              c.cvtColor(hsv, boosted, c.COLOR_HSV2BGR);
              charSource = boosted;
              s.delete();
              sBoost.delete();
              ch.delete();
              merged.delete();
            } else {
              roiX = 0;
              roiY = 0;
            }
            hsv.delete();
            roiMat.delete();
          }
          let best: IdentityEntry | null = null;
          for (const scale of [0.94, 0.96, 0.98, 1.0, 1.02, 1.04, 1.06]) {
            const w2 = slotW * scale;
            const h2 = slotH * scale;
            const sx1 = x1 + (slotW - w2) / 2.0 - roiX;
            const sy1 = y1 + (slotH - h2) / 2.0 - roiY;
            const candidate = this.cleanAssets.identifyCropSearch(charSource, sx1, sy1, w2, h2, group, subset, kindSearch, wantTopk, rawRgbCandidate, achromaticGapCandidate);
            candidate.scale = scale;
            if (!best || (candidate.score ?? 0.0) > (best.score ?? 0.0)) best = candidate;
          }
          if (boosted) boosted.delete();
          result = best!;
        } else {
          result = this.cleanAssets.identifyCropSearch(canonical, x1, y1, slotW, slotH, group, subset, kindSearch, wantTopk, rawRgbCandidate);
        }
        const margeId = result.margin_ext ?? result.margin ?? 0.0;
        let ok = (result.score ?? 0.0) >= ICON_SCORE_MIN && margeId >= ICON_MARGIN_MIN;
        if (iconKind === 'character_icon') {
          const fam = familyOf(String(result.id ?? ''));
          if (ok && (fam === 'character.inkling_girl' || fam === 'character.inkling_boy' || fam === 'character.birdo') && margeId < 0.05) {
            ok = false;
            result.reason = 'lookalike_set_margin';
          }
          if (ok) charId = result.id ? String(result.id) : null;
        }
        result.ok = ok;
        result.evidence = 'clean_assets';
        result.crop_std = round1(cropStd);
      }
      result.slot_xywh = [x1, y1, slotW, slotH];
      if (iconKind === 'character_icon' && result.ok) {
        charId = result.id ? String(result.id) : charId;
      }
      let assetRef: string | null = null;
      if (iconKind === 'flag_icon') {
        if (result.index != null) assetRef = `${ASSET_ROOT}/mk8_flags/${result.index}.png`;
      } else if (iconKind === 'wheel_icon') {
        if (result.index != null) assetRef = `${ASSET_ROOT}/tire/${result.index}.png`;
      } else if (result.id != null) {
        const group = iconKind === 'character_icon' ? 'characters' : (iconKind === 'kart_icon' ? 'bodies' : 'gliders');
        assetRef = this.cleanAssets.assetRefFor(String(result.id), group);
      }
      if (assetRef) result.asset_ref = assetRef;
      if (this.saveCrops) {
        const cropScale = result.scale ?? 1.0;
        const cw = Math.max(8, Math.round(slotW * cropScale));
        const chh = Math.max(8, Math.round(slotH * cropScale));
        const cx = Math.round(x1 + (slotW - cw) / 2.0) + (result.dx ?? 0);
        const cy = Math.round(y1 + (slotH - chh) / 2.0) + (result.dy ?? 0);
        const png = await cropPng(canonical, cx, cy, cw, chh);
        if (png) result.crop_png = png;
      }
      if (this.sharedIconQa) {
        const kind = REG_GROUP[iconKind] as VisualFieldRead['kind'];
        const profile = iconKind === 'character_icon' && ghostDetail ? 'ghost_select' : 'result';
        const scale = result.scale ?? 1.0;
        const cw = Math.max(8, Math.round(slotW * scale));
        const ch = Math.max(8, Math.round(slotH * scale));
        let box = result.match_xywh ?? [
          Math.round(x1 + (slotW - cw) / 2.0) + (result.dx ?? 0),
          Math.round(y1 + (slotH - ch) / 2.0) + (result.dy ?? 0), cw, ch,
        ];
        if (this.sharedFlagWindowQa && iconKind === 'flag_icon') {
          // Central flag position (packages/icon-matcher sharedFlagWindow):
          // the shared references choose the flag inside its padded slot, not
          // the previous reader's own match position.
          const located = await this.sharedFlagWindow(sharedSource, [x1, y1, slotW, slotH]);
          if (located) { box = located.box; result.flag_window_qa = located.read; }
        }
        result.shared_icon_qa = await this.sharedIconShadow(sharedSource, kind, profile,
          box as [number, number, number, number], result, shadowSubset,
          rawRgbCandidate, achromaticGapCandidate);
        if (iconKind === 'flag_icon' && photometricRecord && result.shared_icon_qa) {
          (result.shared_icon_qa as Record<string, unknown>).photometric_qa = photometricRecord;
        }
        if (this.sharedCharacterSlotQa && iconKind === 'character_icon') {
          result.character_slot_qa = await this.sharedIconShadow(sharedSource, kind, profile,
            [x1, y1, slotW, slotH], result, shadowSubset,
            rawRgbCandidate, achromaticGapCandidate);
        }
        if (this.sharedTireWindowQa && iconKind === 'wheel_icon') {
          result.tire_window_qa = await this.sharedTireWindow(sharedSource,
            [x1, y1, slotW, slotH]);
        }
      }
      out[outKey] = result;
    }
    try {
      await this.applyTextEvidence(canonical, out, yellowCard, px1, pw, charId, localeSlot, ghostDetail, gliderRowUpshiftCandidate);
    } catch (exc) {
      out.text_evidence_error = String(exc instanceof Error ? exc.message : exc);
    }
    if (kartVariantTextReviewCandidate) {
      const kart = out.kart;
      const id = String(kart?.id ?? '');
      if (kart?.ok && kart.evidence === 'clean_assets+text_ocr'
          && id.startsWith('body.') && this.cleanAssets.hasVariants('bodies', id)
          && (kart.margin_ext ?? kart.margin ?? 0) < ICON_MARGIN_MIN) {
        kart.ok = false;
        kart.reason = 'kart_variant_text_review';
        kart.evidence += '+variant_review';
      }
    }
    if (wheelTextConflictReviewCandidate) {
      const wheel = out.wheel;
      const textIndex = wheel?.text?.id;
      const textReliable = (wheel?.text?.fuzzy ?? 0) >= WHEEL_TEXT_PROPOSAL_FUZZY_MIN
        && (wheel?.text?.margin ?? 0) >= WHEEL_TEXT_PROPOSAL_MARGIN_MIN;
      if (wheel?.ok && wheel.index != null && textIndex != null && /^\d+$/.test(textIndex)
          && textReliable && Number(textIndex) !== Number(wheel.index)) {
        wheel.ok = false;
        wheel.reason = 'wheel_text_conflict_review';
        wheel.evidence = (wheel.evidence ?? 'v1_tire_matcher') + '+text_conflict_review';
      }
      if (wheelTextProposalCandidate && wheel?.reason === 'wheel_text_conflict_review'
          && wheel.index != null && textIndex != null && /^\d+$/.test(textIndex)
          && textReliable) {
        wheel.visual_index = wheel.index;
        wheel.index = Number(textIndex);
        wheel.name = this.displayName('tire', wheel.index);
        wheel.asset_ref = `${ASSET_ROOT}/tire/${wheel.index}.png`;
        wheel.reason = 'wheel_text_proposal_review';
        wheel.evidence += '+text_proposal';
      }
    }
    try {
      this.rescueCharacterViaParts(canonical, out, guardCrossFamilyRescue, rawRgbCandidate, achromaticGapCandidate);
    } catch {
      /* zoals Java: genegeerd */
    }
    if (this.familyColorTextAgreementCandidate) {
      const entry = out.character;
      const visualId = entry?.top3?.[0]?.[0];
      const currentId = String(entry?.id ?? '');
      if (entry?.ok && visualId && currentId && currentId !== visualId
          && entry.name_text?.id === visualId && entry.name_text.fuzzy >= 0.95
          && familyOf(currentId) === familyOf(visualId)
          && (entry.score ?? 0) >= ICON_SCORE_MIN
          && (entry.margin_ext ?? entry.margin ?? 0) >= ICON_MARGIN_MIN) {
        entry.color_text_agreement_from = currentId;
        entry.id = visualId;
        entry.name = this.cleanAssets.displayName(visualId, 'characters');
        entry.asset_ref = this.cleanAssets.assetRefFor(visualId, 'characters') ?? undefined;
        entry.evidence = (entry.evidence ?? 'clean_assets') + '+visual_text_variant_agreement';
        this.realignPartColors(out, visualId);
      }
    }
    const character = out.character;
    if (achromaticGapCandidate && !yellowCard && character?.ok
        && typeof character.achromatic_chroma_gap === 'number') {
      character.ok = false;
      character.reason = 'achromatic_chroma_gap_review';
      character.evidence = (character.evidence ?? 'clean_assets') + '+chroma_gap_review';
    }
    // Generic row text identifies a kart family, never its colour. On an
    // already review-required variant conflict, search only that family's
    // in-game icon references and keep the colour proposal review-required.
    const kart = out.kart;
    if (kartFamilySearchCandidate && kart?.reason === 'kart_variant_text_review'
        && kart.id && kart.text?.id === kart.id && kart.slot_xywh) {
      const baseId = String(kart.id);
      const familyIds = this.cleanAssets.idsForFamily('bodies', baseId);
      if (familyIds.length > 1) {
        const [x, y, w, h] = kart.slot_xywh;
        const familyRead = this.cleanAssets.identifyCropSearch(canonical, x, y, w, h,
          'bodies', new Set(familyIds), 6, 8, rawRgbCandidate);
        const proposal = String(familyRead.id ?? '');
        if (proposal !== baseId && familyOf(proposal) === baseId
            && (familyRead.score ?? 0) >= ICON_SCORE_MIN) {
          kart.family_search = { unconstrained_id: kart.id, proposed_id: proposal,
            score: familyRead.score, dx: familyRead.dx, dy: familyRead.dy,
            top3: familyRead.top3 };
          kart.id = proposal;
          kart.name = this.cleanAssets.displayName(proposal, 'bodies');
          kart.asset_ref = this.cleanAssets.assetRefFor(proposal, 'bodies') ?? undefined;
          kart.evidence = (kart.evidence ?? 'clean_assets') + '+family_search_proposal';
          kart.reason = 'kart_family_variant_review';
          kart.ok = false;
          if (this.saveCrops) {
            const png = await cropPng(canonical, x + (familyRead.dx ?? 0),
              y + (familyRead.dy ?? 0), w, h);
            if (png) kart.crop_png = png;
          }
        }
      }
    }
    // In-game row text is an independent family cue. A reliable conflict may
    // veto automatic acceptance; it must not replace the visible icon ID.
    const glider = out.glider;
    const gliderText = glider?.text;
    if (gliderTextConflictReviewCandidate && glider?.ok && glider?.id && gliderText?.id
        && (gliderText.fuzzy ?? 0) >= 0.65 && (gliderText.margin ?? 0) >= 0.15
        && familyOf(String(glider.id)) !== familyOf(String(gliderText.id))) {
      glider.ok = false;
      glider.reason = 'glider_text_conflict_review';
      glider.evidence = (glider.evidence ?? 'clean_assets') + '+text_conflict_review';
    }
    if (this.sharedIconQa && this.sharedCharacterTextQa && out.character) {
      const entry = out.character;
      const selected = entry.shared_icon_qa as VisualFieldRead | undefined;
      const slot = entry.character_slot_qa as VisualFieldRead | undefined;
      const group = await this.sharedIconQa.get('characters', ghostDetail ? 'ghost_select' : 'result');
      const families = new Map(group.ids.map((id, index) => [id, group.families[index]]));
      const name = entry.name_text;
      const clue = name?.id ? { id: name.id, fuzzy: name.fuzzy, margin: 1 } : null;
      const decide = (read: VisualFieldRead | undefined) => read?.schema === 'mk8dx.visual-field-read.v1'
        ? combineCharacter(read, clue, families) : null;
      const selectedValid = selected?.schema === 'mk8dx.visual-field-read.v1';
      const slotValid = slot?.schema === 'mk8dx.visual-field-read.v1';
      const chooseSlot = slotValid && (!selectedValid || slot.score >= selected.score);
      const selectedDecision = decide(selected);
      const slotDecision = decide(slot);
      // A slightly shifted view of the same ambiguous icon is not an
      // independent reason to turn the same visual guess into an exact ID.
      const repeatedSlotVisualOnly = chooseSlot && selectedValid && slotValid
        && selected.top1Id === slot.top1Id
        && selectedDecision?.status !== 'accepted'
        && slotDecision?.status === 'accepted'
        && slotDecision.evidence.length === 1 && slotDecision.evidence[0] === 'visual';
      const chosen = repeatedSlotVisualOnly
        ? { id: null, familyId: null, status: 'unknown' as const,
          evidence: ['repeated_slot_visual_without_independent_support'],
          visualTop1: slot.top1Id }
        : chooseSlot ? slotDecision : selectedDecision;
      entry.character_text_qa = { schema: 'mk8dx.character-text-shadow.v1',
        clue, selected: selectedDecision, slot: slotDecision,
        chosenBasis: chooseSlot ? 'slot' : 'selected',
        repeatedSlotVisualOnly, chosen };
    }
    if (this.sharedIconQa && this.sharedPartTextQa) {
      const refs = await this.sharedIconQa.getPartContext();
      const character = (out.character?.character_text_qa as {
        chosen?: ReturnType<typeof combineCharacter> | null
      } | undefined)?.chosen ?? { id: null, familyId: null, status: 'unknown' as const,
        evidence: ['character_unavailable'], visualTop1: '' };
      for (const [field, kind] of [['kart', 'bodies'], ['glider', 'gliders'],
        ['wheel', 'tires']] as const) {
        const part = out[field];
        const chosen = kind === 'tires' && this.sharedTireWindowQa
          ? part?.tire_window_qa : part?.shared_icon_qa;
        const read = chosen as VisualFieldRead | undefined;
        if (!part || read?.schema !== 'mk8dx.visual-field-read.v1') continue;
        const raw = part?.text;
        const clue = typeof raw?.id === 'string' && Number.isFinite(raw.fuzzy)
          && Number.isFinite(raw.margin)
          ? { id: raw.id, fuzzy: raw.fuzzy, margin: raw.margin } : null;
        part.part_text_qa = { schema: 'mk8dx.part-text-shadow.v1',
          basis: kind === 'tires' && this.sharedTireWindowQa ? 'tire_window' : 'selected',
          cropPixelSha256: read.cropPixelSha256, clue,
          chosen: combinePart(kind as PartKind, read, character, clue, refs,
            kind === 'tires' && this.sharedTireTextTop3GuardQa) };
      }
    }
    await this.attachSharedPartSubsetQa(canonical, out);
    // Result cards and the Select-a-Ghost panel take the same central decision:
    // per-field central reads, the printed name as text clue (character and
    // parts) and the character's catalog colour, as LiveTrial's Ghost panel.
    if (this.sharedIconQa && this.sharedCharacterTextQa && this.sharedPartTextQa) {
      out.shared_result_proposal_qa = composeResultProposal(out);
      if (this.sharedFieldIndex) {
        if (ghostDetail && this.ghostPicker) this.decideGhostPanelCentrally(sharedSource, out);
        else this.adoptSharedResultProposal(out, out.shared_result_proposal_qa);
      }
    }
    } finally {
      if (sharedSource !== canonical) sharedSource.delete();
    }
    return out;
  }

  private rescueCharacterViaParts(canonical: any, out: OwnerIdentity, guardCrossFamilyRescue: boolean, rawRgbCandidate: boolean, achromaticGapCandidate: boolean): void {
    const character = out.character;
    if (!character || character.ok) return;
    const slot = character.slot_xywh;
    if (!slot) return;
    const candidates = new Set<string>();
    for (const [part, group] of [['kart', 'bodies'], ['glider', 'gliders']] as const) {
      const entry = out[part];
      const rid = entry ? String(entry.id ?? '') : '';
      if (rid.includes('_variant.')) {
        for (const cId of this.cleanAssets.charsForPartVariant(group, rid)) candidates.add(cId);
      }
    }
    if (candidates.size === 0) return;
    const rescued = this.cleanAssets.identifyCropSearch(canonical, slot[0], slot[1], slot[2], slot[3], 'characters', candidates, 10, 0, rawRgbCandidate, achromaticGapCandidate);
    const marge = rescued.margin_ext ?? rescued.margin ?? 0.0;
    if ((rescued.score ?? 0.0) >= ICON_SCORE_MIN && rescued.id != null) {
      const rid = String(rescued.id);
      // A part-colour subset can rank a different family first even when the
      // character's own crop has stronger evidence for its original family.
      if (guardCrossFamilyRescue && character.id && familyOf(String(character.id)) !== familyOf(rid)
          && (character.score ?? 0) >= (rescued.score ?? 0)) return;
      character.id = rid;
      character.name = this.cleanAssets.displayName(rid, 'characters');
      character.asset_ref = this.cleanAssets.assetRefFor(rid, 'characters') ?? undefined;
      character.ok = marge >= ICON_MARGIN_MIN;
      character.score = rescued.score ?? 0.0;
      character.margin_ext = round4(marge);
      character.evidence = 'clean_assets+part_color_constraint';
      character.constraint_candidates = candidates.size;
    }
  }

  // ------------------------------------------------------------------
  // Tekst-tweede-bewijs
  // ------------------------------------------------------------------
  private async applyTextEvidence(canonical: any, out: OwnerIdentity, yellowCard: boolean, px1: number, pw: number, charId: string | null, localeSlot: (string | null)[] | null, ghostDetail: boolean, gliderRowUpshiftCandidate = false): Promise<void> {
    if (!this.textEvidence.enabled) return;
    // The panel's yellow names may use the text-colour OCR variant; result cards print white.
    this.textEvidence.panelTextColour = ghostDetail;
    try {
      await this.applyTextEvidenceRows(canonical, out, yellowCard, px1, pw, charId, localeSlot, ghostDetail, gliderRowUpshiftCandidate);
    } finally {
      this.textEvidence.panelTextColour = false;
    }
  }

  private async applyTextEvidenceRows(canonical: any, out: OwnerIdentity, yellowCard: boolean, px1: number, pw: number, charId: string | null, localeSlot: (string | null)[] | null, ghostDetail: boolean, gliderRowUpshiftCandidate = false): Promise<void> {
    const kart = out.kart;
    const kartSlot = kart ? kart.slot_xywh : null;
    if (!kartSlot) return;
    const stripPanel: PanelBox = { x: px1, y: 0, w: pw, h: 0, source: 'static_canonical' };
    const rowTextRight = textRight(this.frameDefs, stripPanel, ghostDetail);
    const strip = (slot: number[]) => textStrip(this.frameDefs, slot, rowTextRight);
    this.textEvidence.setCropLabel(`${yellowCard ? 'player' : 'ghost'}/kart`);
    let bestScript: Script | null = null;
    let bestLocale: string | null = null;
    let bestKartMatch: VocabMatch | null = null;
    let bestKartText = '';
    let scriptsToTry: readonly Script[] = SCRIPTS.filter((s) => this.textEvidence.scriptAvailable(s));
    if (localeSlot && localeSlot[0]) {
      scriptsToTry = [localeSlot[0] as Script];
      bestLocale = localeSlot[1];
    }
    const inheritedLocale = !!(localeSlot && localeSlot[0]);
    for (const script of scriptsToTry) {
      const kartVocab = inheritedLocale ? filterLocale(this.cleanAssets.vocabOf('bodies'), bestLocale) : this.cleanAssets.vocabOf('bodies');
      const [kx, ky, kw, kh] = strip(kartSlot);
      const text = await this.textEvidence.ocrRegion(canonical, kx, ky, kw, kh, script, kartVocab);
      const match = matchVocab(text, kartVocab);
      if (!bestKartMatch || match.fuzzy > bestKartMatch.fuzzy) {
        bestKartMatch = match;
        bestScript = script;
        bestKartText = text;
        if (!inheritedLocale) bestLocale = match.id === null ? null : match.id.substring(match.id.indexOf('#') + 1);
      }
      if (match.fuzzy >= FUZZY_MIN) break;
    }
    if (!bestScript || !bestKartMatch) return;
    // The kart row may match through a related reader (Japanese reads the kanji of a
    // traditional-Chinese card well enough); the other rows read best with the
    // locale's own reader.
    const ownScript = scriptForLocale(bestLocale);
    if (ownScript && ownScript !== bestScript && this.textEvidence.scriptAvailable(ownScript)) bestScript = ownScript;
    if (!inheritedLocale && bestKartMatch.fuzzy >= FUZZY_MIN) {
      // A kart name spelled alike in locales of different scripts ("GLA" in English and
      // Japanese) does not settle the reader for the other rows: read one more row with each
      // of those scripts and keep the one whose reading matches best (sharedNameMatch
      // sameNameLocales, the same rule as Android).
      const scripts = [...new Set(sameNameLocales(this.cleanAssets.vocabOf('bodies'), bestKartMatch.id)
        .map((loc) => scriptForLocale(loc)).filter((s): s is Script => !!s && this.textEvidence.scriptAvailable(s)))].sort();
      const probeRow = out.glider?.slot_xywh ? 'glider' : out.wheel?.slot_xywh ? 'wheel' : null;
      if (scripts.length > 1 && probeRow) {
        const slot = out[probeRow]!.slot_xywh!;
        const probeVocab = probeRow === 'wheel' ? this.tireVocab() : this.cleanAssets.vocabOf('gliders');
        let probeBest = -1;
        this.textEvidence.setCropLabel(`${yellowCard ? 'player' : 'ghost'}/${probeRow}-script`);
        for (const script of scripts) {
          const [px, py, pww, phh] = strip(slot);
          const text = await this.textEvidence.ocrRegion(canonical, px, py, pww, phh, script, probeVocab);
          const probe = matchVocab(text, probeVocab);
          if (probe.fuzzy > probeBest + 1e-9) {
            probeBest = probe.fuzzy;
            bestScript = script;
          }
        }
      }
    }
    const characterPre = out.character;
    const flagPre = out.flag;
    const charSlotPre = characterPre ? characterPre.slot_xywh : null;
    const flagSlotPre = flagPre ? flagPre.slot_xywh : null;
    let charStripText = '';
    if (yellowCard && charSlotPre && flagSlotPre) {
      this.textEvidence.setCropLabel('player/character');
      const nx = charSlotPre[0] + charSlotPre[2] + 6;
      const characterVocab = filterLocale(this.cleanAssets.vocabOf('characters'), bestLocale);
      charStripText = await this.textEvidence.ocrRegion(canonical, nx, charSlotPre[1], flagSlotPre[0] - 6 - nx, charSlotPre[3], bestScript,
        characterVocab);
      if (this.characterTextLeftProbe > 0) {
        const originalMatch = matchVocab(charStripText, characterVocab);
        if (!originalMatch.strong()) {
          this.textEvidence.setCropLabel('player/character-left-probe');
          const candidateText = await this.textEvidence.ocrRegion(canonical,
            nx - this.characterTextLeftProbe, charSlotPre[1],
            flagSlotPre[0] - 6 - nx + this.characterTextLeftProbe,
            charSlotPre[3], bestScript, characterVocab);
          const candidateMatch = matchVocab(candidateText, characterVocab);
          if (candidateMatch.strong() && candidateMatch.fuzzy - originalMatch.fuzzy >= 0.12) {
            charStripText = candidateText;
          }
        }
      }
    }
    const rowTexts = new Map<string, string>();
    for (const [row] of [['wheel', 'tires'], ['glider', 'gliders']] as const) {
      const entry = out[row];
      const slot = entry ? entry.slot_xywh : null;
      if (!slot) continue;
      this.textEvidence.setCropLabel(`${yellowCard ? 'player' : 'ghost'}/${row}`);
      const rowVocab = row === 'wheel' ? this.tireVocab() : this.cleanAssets.vocabOf('gliders');
      // The OCR variant is chosen for legibility against the names of every language: the
      // locale here is still the kart name's guess, and a name spelled alike in many
      // languages ("P-Wing") can name a language whose tyre is called otherwise, so the
      // right reading ("Normal Blue") scored low and a misread won. The row's match below
      // uses the locale decided over all rows.
      const [rx, ry, rw, rh] = strip(slot);
      rowTexts.set(row, await this.textEvidence.ocrRegion(canonical, rx, ry, rw, rh, bestScript,
        inheritedLocale ? filterLocale(rowVocab, bestLocale) : rowVocab));
    }
    if (!inheritedLocale && bestKartMatch.id !== null && bestKartText.length > 0) {
      // The console language from every printed name at once: the central locale vote
      // (packages/icon-matcher sharedNameMatch, the same rule as Android and Python). A preferred
      // language only breaks ties; a screen in another language wins on its own evidence.
      const bodies = this.cleanAssets.vocabOf('bodies');
      const rows: [string, string][] = [['bodies', bestKartText]];
      if (charStripText.length > 0) rows.push(['characters', charStripText]);
      const wheelText = rowTexts.get('wheel');
      if (wheelText) rows.push(['tires', wheelText]);
      const gliderText = rowTexts.get('glider');
      if (gliderText) rows.push(['gliders', gliderText]);
      const vote = localeVote(rows, { bodies, characters: this.cleanAssets.vocabOf('characters'),
        tires: this.tireVocab(), gliders: this.cleanAssets.vocabOf('gliders') }, vocabLocales(bodies), this.preferredLocales);
      if (vote.locale !== null && vote.firstMatch) {
        bestLocale = vote.locale;
        const km = new VocabMatch();
        km.id = vote.firstMatch.key;
        km.name = vote.firstMatch.name ?? '';
        km.fuzzy = vote.firstMatch.fuzzy;
        km.margin = vote.firstMatch.margin;
        bestKartMatch = km;
      }
    }
    if (localeSlot && !localeSlot[0] && bestKartMatch && bestKartMatch.fuzzy >= FUZZY_MIN) {
      localeSlot[0] = bestScript;
      localeSlot[1] = bestLocale;
    }
    out.text_locale = { script: bestScript, locale: bestLocale, kart_text: bestKartText, fuzzy: round2(bestKartMatch.fuzzy) };
    this.applyRowText(out, 'kart', 'bodies', bestKartMatch, bestKartText, charId);
    for (const [row, group] of [['wheel', 'tires'], ['glider', 'gliders']] as const) {
      const text = rowTexts.get(row);
      if (text === undefined) continue;
      const vocab = group === 'tires' ? this.tireVocab() : this.cleanAssets.vocabOf(group);
      const match = matchVocab(text, filterLocale(vocab, bestLocale));
      if (row === 'glider' && gliderRowUpshiftCandidate && out.glider?.ok && !match.strong()) {
        const slot = out.glider.slot_xywh;
        if (slot) {
          const x = slot[0] + slot[2] + 6;
          const shiftedText = await this.textEvidence.ocrRegion(canonical, x, slot[1] - 10,
            rowTextRight - x, slot[3] + 4, bestScript, vocab);
          const shiftedMatch = matchVocab(shiftedText, vocab);
          if (shiftedMatch.strong()) {
            this.applyRowText(out, row, group, shiftedMatch, shiftedText, charId);
            out.glider!.row_geometry_source = 'up_8';
            continue;
          }
        }
      }
      this.applyRowText(out, row, group, match, text, charId);
    }
    const character = out.character;
    const flag = out.flag;
    const charSlot = character ? character.slot_xywh : null;
    const flagSlot = flag ? flag.slot_xywh : null;
    if (charSlot && flagSlot && !yellowCard) {
      const gx = charSlot[0] + charSlot[2] + 6;
      const gWidth = ghostDetail ? ghostNameRight(this.frameDefs, stripPanel) - gx : flagSlot[0] - 6 - gx;
      const gHeight = ghostDetail ? Math.round(charSlot[3] * 0.5) : charSlot[3];
      this.textEvidence.setCropLabel('ghost');
      const ghostName = await this.textEvidence.ocrNameCaseAware(canonical, gx, charSlot[1], gWidth, gHeight, bestScript);
      if (this.textEvidence.lastNameDebug.length > 0) out.card_name_debug = this.textEvidence.lastNameDebug;
      if (ghostName.length > 0 && ghostName.length <= 12) out.card_name = ghostName;
    }
    if (yellowCard && charSlot && flagSlot && character) {
      const text = charStripText;
      const match = matchVocab(text, filterLocale(this.cleanAssets.vocabOf('characters'), bestLocale));
      if (match.id !== null) {
        character.name_text = { text, id: stripLocale(match.id), fuzzy: round2(match.fuzzy) };
      }
      if (match.fuzzy >= FUZZY_MIN && match.id !== null) {
        const rid = stripLocale(match.id);
        const iconId = String(character.id ?? '');
        if (familyOf(rid) === familyOf(iconId)) {
          character.ok = true;
          character.evidence = (character.evidence ?? 'clean_assets') + '+player_name';
        } else {
          character.ok = true;
          character.id = rid;
          character.name = this.cleanAssets.displayName(rid, 'characters');
          character.asset_ref = this.cleanAssets.assetRefFor(rid, 'characters') ?? undefined;
          character.evidence = 'player_name_text';
        }
        this.realignPartColors(out, String(character.id ?? ''));
      }
    }
  }

  /** v0.4.1: kart/glider-kleurvariant opnieuw afleiden uit het definitieve character. */
  realignPartColors(out: OwnerIdentity, charId: string): void {
    if (!charId) return;
    for (const [row, group] of [['kart', 'bodies'], ['glider', 'gliders']] as const) {
      const entry = out[row];
      const id = entry ? String(entry.id ?? '') : '';
      if (!id || !id.includes('_variant.')) continue;
      const base = familyOf(id);
      const rid = this.cleanAssets.variantFor(charId, group, base);
      if (!rid || rid === id || rid === base) continue;
      entry!.color_realigned_from = id;
      entry!.id = rid;
      entry!.name = this.cleanAssets.displayName(rid, group);
      entry!.asset_ref = this.cleanAssets.assetRefFor(rid, group) ?? undefined;
      entry!.evidence = (entry!.evidence ?? 'clean_assets') + '+char_color_realign';
    }
  }

  private applyRowText(out: OwnerIdentity, kind: 'kart' | 'wheel' | 'glider', group: string, match: VocabMatch | null, text: string, charId: string | null): void {
    const entry = out[kind];
    if (!entry || !match || match.id === null || text.length === 0) return;
    entry.text = { text, id: stripLocale(match.id), fuzzy: round2(match.fuzzy), margin: round2(match.margin) };
    if (!match.strong()) return;
    if (group === 'tires') {
      const index = parseInt(stripLocale(match.id), 10);
      entry.ok = true;
      entry.index = index;
      entry.name = this.displayName('tire', index);
      entry.asset_ref = `${ASSET_ROOT}/tire/${index}.png`;
      entry.evidence = (entry.evidence ?? 'v1_tire_matcher') + '+text_ocr';
      return;
    }
    const baseId = stripLocale(match.id);
    const iconId = String(entry.id ?? '');
    const familieAnders = familyOf(baseId) !== familyOf(iconId);
    if (!entry.ok || familieAnders) {
      const rid = this.cleanAssets.variantFor(charId, group, baseId);
      entry.ok = true;
      entry.id = rid;
      entry.name = this.cleanAssets.displayName(rid, group);
      entry.asset_ref = this.cleanAssets.assetRefFor(rid, group) ?? undefined;
      entry.evidence = 'clean_assets+text_ocr';
    } else {
      entry.evidence = (entry.evidence ?? 'clean_assets') + '+text_ocr';
    }
  }

  private tireVocab(): Record<string, string> {
    if (this.tireVocabCache) return this.tireVocabCache;
    const out: Record<string, string> = {};
    const table = this.names.tire;
    if (table) {
      for (const index of Object.keys(table)) {
        const entry = table[index];
        if (!entry) continue;
        const uk = entry.uk ?? '';
        const nl = entry.nl ?? '';
        if (uk) out[`${index}#en-GB`] = uk;
        if (nl) out[`${index}#nl-NL`] = nl;
      }
    }
    // the engine table only knows en-GB and nl-NL; the other game languages come
    // from Clean Assets (tireNames.generated.ts), so a tire name printed in any
    // console language can match
    for (const [index, names] of Object.entries(TIRE_NAMES)) {
      for (const [locale, name] of Object.entries(names)) {
        const key = `${index}#${locale}`;
        if (name && !(key in out)) out[key] = name;
      }
    }
    this.tireVocabCache = out;
    return out;
  }

  displayName(assetDir: string, index: number | null): string {
    if (index === null || index === undefined) return '';
    const table = this.names[assetDir];
    const entry = table ? table[String(index)] : null;
    if (!entry) return `#${index}`;
    const uk = entry.uk ?? '';
    const nl = entry.nl ?? '';
    return uk.length === 0 ? nl : uk;
  }

  // ------------------------------------------------------------------
  // Iconen (wielen): _match_icon
  // ------------------------------------------------------------------
  private matchIconWindowed(windowBgr: any, assetDir: string, slotW: number, slotH: number, isWheel: boolean): IdentityEntry {
    const c = cv();
    const out: IdentityEntry = {};
    const gray = new c.Mat();
    c.cvtColor(windowBgr, gray, c.COLOR_BGR2GRAY);
    const cx0 = Math.max(0, Math.trunc((windowBgr.cols - slotW) / 2));
    const cy0 = Math.max(0, Math.trunc((windowBgr.rows - slotH) / 2));
    const slotGray = gray.roi(new c.Rect(cx0, cy0, Math.min(slotW, gray.cols - cx0), Math.min(slotH, gray.rows - cy0)));
    const slotStd = matStd(slotGray);
    slotGray.delete();
    gray.delete();
    if (!slotPresent('photo', 'icon', slotStd).present) {
      return Object.assign(out, { ok: false, reason: 'low_contrast', crop_std: round1(slotStd), index: null, score: 0.0, margin: 0.0 });
    }
    const cw = windowBgr.cols;
    const ch = windowBgr.rows;
    const tw = Math.min(slotW, cw);
    const th = Math.min(slotH, ch);
    const crop = matToFloatBgr(windowBgr);
    const sized = this.sizedIcons(assetDir, tw, th);
    if (sized.length === 0) {
      return Object.assign(out, { ok: false, reason: 'no_assets', index: null, score: 0.0, margin: 0.0 });
    }
    const centerScores = new Float64Array(sized.length);
    const order: number[] = [];
    for (let i = 0; i < sized.length; i++) {
      centerScores[i] = maskedNcc(crop, cw, ch, cx0, cy0, sized[i], tw, th);
      order.push(i);
    }
    order.sort((a, b) => (centerScores[b] > centerScores[a] ? 1 : centerScores[b] < centerScores[a] ? -1 : 0));
    let bestScore: number;
    let bestIndex: number;
    let second: number;
    let bestX = cx0;
    let bestY = cy0;
    if (cw > tw || ch > th) {
      const refined = new Float64Array(Math.min(3, order.length));
      const locations: [number, number][] = [];
      for (let r = 0; r < refined.length; r++) {
        const icon = sized[order[r]];
        let best = centerScores[order[r]];
        let iconX = cx0;
        let iconY = cy0;
        for (let dy = 0; dy <= ch - th; dy += 2) {
          for (let dx = 0; dx <= cw - tw; dx += 2) {
            if (dx === cx0 && dy === cy0) continue;
            const s = maskedNcc(crop, cw, ch, dx, dy, icon, tw, th);
            if (s > best) { best = s; iconX = dx; iconY = dy; }
          }
        }
        refined[r] = best;
        locations.push([iconX, iconY]);
      }
      let bestR = 0;
      for (let r = 1; r < refined.length; r++) if (refined[r] > refined[bestR]) bestR = r;
      bestScore = refined[bestR];
      bestIndex = sized[order[bestR]].index;
      [bestX, bestY] = locations[bestR];
      second = 0.0;
      for (let r = 0; r < refined.length; r++) if (r !== bestR && refined[r] > second) second = refined[r];
    } else {
      bestScore = centerScores[order[0]];
      bestIndex = sized[order[0]].index;
      second = order.length > 1 ? centerScores[order[1]] : 0.0;
    }
    const margin = bestScore - second;
    const ok = isWheel ? bestScore >= WHEEL_SCORE_MIN : bestScore >= ICON_SCORE_MIN && margin >= ICON_MARGIN_MIN;
    return Object.assign(out, {
      ok,
      index: bestIndex,
      score: round3(bestScore),
      margin: round3(margin),
      crop_std: round1(slotStd),
      evidence: isWheel ? 'v1_tire_matcher' : 'v1_icon_ncc',
      match_xywh: [bestX, bestY, tw, th],
    });
  }

  // ------------------------------------------------------------------
  // Vlag: _match_flag
  // ------------------------------------------------------------------
  private matchFlag(windowBgr: any, assetDir: string, slotW: number, slotH: number, flagBlueBandReviewCandidate = false, flagChromaticBandReviewCandidate = false): IdentityEntry {
    const c = cv();
    const out: IdentityEntry = {};
    const cwFull = windowBgr.cols;
    const chFull = windowBgr.rows;
    let tw = Math.min(slotW, cwFull);
    let th = Math.min(slotH, chFull);
    const inset = Math.max(2, Math.round(0.055 * th));
    tw -= 2 * inset;
    th -= 2 * inset;
    if (tw < 8 || th < 8) return Object.assign(out, { ok: false, index: null, score: 0.0, reason: 'slot_too_small' });
    const flags = this.flagTemplates(assetDir, tw, th);
    if (flags.length === 0) return Object.assign(out, { ok: false, index: null, score: 0.0, reason: 'no_assets' });
    const gray8 = new c.Mat();
    c.cvtColor(windowBgr, gray8, c.COLOR_BGR2GRAY);
    let x0 = Math.trunc((cwFull - tw) / 2);
    let y0 = Math.trunc((chFull - th) / 2);
    if (cwFull > tw || chFull > th) {
      let bestVal = -1.0;
      const result = new c.Mat();
      const x0Nominal = x0;
      const y0Nominal = y0;
      for (const flag of flags) {
        c.matchTemplate(windowBgr, flag.bgr8, result, c.TM_CCOEFF_NORMED);
        const rows = result.rows;
        const cols = result.cols;
        const data = result.data32F as Float32Array;
        for (let y = 0; y < rows; y++) {
          // Java: straf t.o.v. de LOPENDE x0/y0 (die per verbetering verschuiven)
          const dyPen = FLAG_POS_PENALTY * Math.abs(y - y0);
          for (let x = 0; x < cols; x++) {
            const v = data[y * cols + x] - dyPen - FLAG_POS_PENALTY * Math.abs(x - x0);
            if (v > bestVal) {
              bestVal = v;
              x0 = x;
              y0 = y;
            }
          }
        }
      }
      void x0Nominal;
      void y0Nominal;
      result.delete();
    }
    out.match_xywh = [x0, y0, tw, th];
    const slotGray = gray8.roi(new c.Rect(x0, y0, tw, th));
    const slotStd = matStd(slotGray);
    if (!slotPresent('photo', 'flag', slotStd).present) {
      slotGray.delete();
      gray8.delete();
      return Object.assign(out, { ok: false, index: null, score: 0.0, reason: 'low_contrast', crop_std: round1(slotStd) });
    }
    const slotGrayF = new c.Mat();
    slotGray.convertTo(slotGrayF, c.CV_32F);
    const sub = new Float32Array(slotGrayF.data32F);
    slotGray.delete();
    slotGrayF.delete();
    let mean = 0.0;
    for (let i = 0; i < sub.length; i++) mean += sub[i];
    mean /= sub.length;
    let gcDen = 0.0;
    for (let i = 0; i < sub.length; i++) gcDen += (sub[i] - mean) * (sub[i] - mean);
    gcDen = Math.sqrt(gcDen);
    let best = -2.0;
    let secondScore = -2.0;
    let bestIdx = -1;
    const all = new Float64Array(flags.length);
    for (let i = 0; i < flags.length; i++) {
      const flag = flags[i];
      let num = 0.0;
      for (let p = 0; p < sub.length; p++) num += (sub[p] - mean) * flag.dt[p];
      const s = gcDen * flag.dtDen > 1e-6 ? num / (gcDen * flag.dtDen) : 0.0;
      all[i] = s;
      if (s > best) {
        secondScore = best;
        best = s;
        bestIdx = i;
      } else if (s > secondScore) {
        secondScore = s;
      }
    }
    gray8.delete();
    const g1 = best;
    Object.assign(out, { index: flags[bestIdx].index, score: round3(g1), pattern: 'gray_ncc', crop_std: round1(slotStd) });
    if (g1 < 0.55) return Object.assign(out, { ok: false, margin: 0.0, reason: 'pattern_gate' });
    if (flagChromaticBandReviewCandidate) {
      const slotBgr = cropClone(windowBgr, x0, y0, tw, th);
      const observedBand = flagChromaticBand(slotBgr);
      slotBgr.delete();
      const scored = flags.map((flag, i) => {
        const referenceBand = flagChromaticBand(flag.bgr8);
        const conflict = Math.abs(observedBand) > 12 && Math.abs(referenceBand) > 12
          && observedBand * referenceBand < 0;
        return { index: flag.index, gray_score: all[i], score: all[i] - (conflict ? 0.25 : 0),
          reference_band: referenceBand, conflict };
      }).sort((a, b) => b.score - a.score);
      out.ranked_candidates = scored.slice(0, 3).map((row) => ({ index: row.index,
        score: round3(row.score), gray_score: round3(row.gray_score) }));
      out.observed_band = round1(observedBand);
      const original = scored.find((row) => row.index === flags[bestIdx].index)!;
      const proposal = scored[0];
      if (original.conflict && !proposal.conflict && proposal.index !== original.index
          && proposal.gray_score >= 0.55 && proposal.score > original.score) {
        return Object.assign(out, { index: proposal.index, score: round3(proposal.score),
          gray_best_score: round3(g1), ok: false, reason: 'flag_chromatic_band_conflict_review',
          proposed_index: proposal.index, review_required: true,
          margin: round3(proposal.score - scored[1].score),
          alternative_index: original.index, pattern: 'gray_ncc+chromatic_band_review' });
      }
    }
    const shortlist: number[] = [];
    for (let i = 0; i < flags.length; i++) if (all[i] >= g1 - 0.05) shortlist.push(i);
    if (shortlist.length === 1) return Object.assign(out, { ok: true, margin: round3(g1 - secondScore), shortlist: 1 });
    const slotBgr = cropClone(windowBgr, x0, y0, tw, th);
    const castCrop = castFeature(slotBgr);
    let bestCast = -Number.MAX_VALUE;
    let secondCast = -Number.MAX_VALUE;
    let bestCastIdx = -1;
    let secondCastIdx = -1;
    for (const i of shortlist) {
      const castTmpl = flags[i].cast;
      let diff = 0.0;
      for (let p = 0; p < castCrop.length; p++) diff += Math.abs(castCrop[p] - castTmpl[p]);
      const score = -diff / castCrop.length;
      if (score > bestCast) {
        secondCast = bestCast;
        secondCastIdx = bestCastIdx;
        bestCast = score;
        bestCastIdx = i;
      } else if (score > secondCast) {
        secondCast = score;
        secondCastIdx = i;
      }
    }
    const castMargin = bestCast - secondCast;
    let ok = castMargin >= 0.03;
    if (flagBlueBandReviewCandidate && ok) {
      const cropBlue = blueBandDelta(slotBgr);
      const referenceBlue = blueBandDelta(flags[bestCastIdx].bgr8);
      out.blue_band_delta = round1(cropBlue);
      out.reference_blue_band_delta = round1(referenceBlue);
      if (cropBlue > 12 && referenceBlue < 5) {
        ok = false;
        out.reason = 'blue_band_reference_conflict';
      }
    }
    slotBgr.delete();
    return Object.assign(out, { index: flags[bestCastIdx].index, ok, margin: round3(castMargin),
      shortlist: shortlist.length,
      alternative_index: !ok && secondCastIdx >= 0 ? flags[secondCastIdx].index : undefined });
  }

  // ------------------------------------------------------------------
  // Asset-caches
  // ------------------------------------------------------------------
  private async loadAssets(assetDir: string): Promise<IconAsset[]> {
    const cached = this.assetCache.get(assetDir);
    if (cached) return cached;
    const files = await this.source.list(`${ASSET_ROOT}/${assetDir}`);
    const numeric = files.filter((f) => f.endsWith('.png') && /^\d+$/.test(f.slice(0, -4)));
    const loaded = await Promise.all(numeric.map(async (file) => {
      const { bgr, alpha } = await loadBgrAlpha(this.source, `${ASSET_ROOT}/${assetDir}/${file}`);
      return { index: parseInt(file.slice(0, -4), 10), bgr, alpha } as IconAsset;
    }));
    // AssetManager.list geeft alfabetisch gesorteerde namen; listings.json ook
    this.assetCache.set(assetDir, loaded);
    return loaded;
  }

  private sizedIcons(assetDir: string, tw: number, th: number): SizedIcon[] {
    const key = `${assetDir}|${tw}x${th}`;
    const cached = this.sizedIconCache.get(key);
    if (cached) return cached;
    const c = cv();
    const erodePx = Math.max(1, Math.round(Math.min(tw, th) * 0.06));
    const kernel = c.getStructuringElement(c.MORPH_ELLIPSE, new c.Size(2 * erodePx + 1, 2 * erodePx + 1));
    const sized: SizedIcon[] = [];
    for (const asset of this.assetCache.get(assetDir) ?? []) {
      const bgrResized = new c.Mat();
      const alphaResized = new c.Mat();
      const alphaEroded = new c.Mat();
      c.resize(asset.bgr, bgrResized, new c.Size(tw, th), 0, 0, c.INTER_AREA);
      c.resize(asset.alpha, alphaResized, new c.Size(tw, th), 0, 0, c.INTER_AREA);
      c.erode(alphaEroded.empty() ? alphaResized : alphaResized, alphaEroded, kernel);
      const alphaF = new c.Mat();
      alphaEroded.convertTo(alphaF, c.CV_32F, 1.0 / 255.0);
      const mask = new Float32Array(alphaF.data32F);
      let sum = 0.0;
      for (let i = 0; i < mask.length; i++) sum += mask[i];
      sized.push({ index: asset.index, bgr: matToFloatBgr(bgrResized), mask, maskSum: sum });
      alphaF.delete();
      bgrResized.delete();
      alphaResized.delete();
      alphaEroded.delete();
    }
    kernel.delete();
    this.sizedIconCache.set(key, sized);
    return sized;
  }

  private flagTemplates(assetDir: string, tw: number, th: number): FlagTemplate[] {
    const key = `${assetDir}|${tw}x${th}`;
    const cached = this.flagCache.get(key);
    if (cached) return cached;
    const c = cv();
    const templates: FlagTemplate[] = [];
    for (const asset of this.assetCache.get(assetDir) ?? []) {
      const sizedBgr = new c.Mat();
      c.resize(asset.bgr, sizedBgr, new c.Size(tw, th), 0, 0, c.INTER_AREA);
      const gray8 = new c.Mat();
      c.cvtColor(sizedBgr, gray8, c.COLOR_BGR2GRAY);
      const grayF = new c.Mat();
      gray8.convertTo(grayF, c.CV_32F);
      const gt = new Float32Array(grayF.data32F);
      grayF.delete();
      let mean = 0.0;
      for (let i = 0; i < gt.length; i++) mean += gt[i];
      mean /= gt.length;
      const dt = new Float32Array(gt.length);
      let den = 0.0;
      for (let i = 0; i < gt.length; i++) {
        dt[i] = Math.fround(gt[i] - mean);
        den += dt[i] * dt[i];
      }
      templates.push({ index: asset.index, gray8, bgr8: sizedBgr, dt, dtDen: Math.sqrt(den), cast: castFeature(sizedBgr) });
    }
    this.flagCache.set(key, templates);
    return templates;
  }
}

function edgeMagnitude(grayF32: any): any {
  const c = cv();
  const gx = new c.Mat();
  const gy = new c.Mat();
  c.Sobel(grayF32, gx, c.CV_32F, 1, 0, 3);
  c.Sobel(grayF32, gy, c.CV_32F, 0, 1, 3);
  const mag = new c.Mat();
  c.magnitude(gx, gy, mag);
  gx.delete();
  gy.delete();
  return mag;
}

/** Alpha-gemaskeerde gezamenlijke 3-kanaals-NCC — port van _ncc. */
function maskedNcc(crop: Float32Array, cw: number, ch: number, dx: number, dy: number, icon: SizedIcon, tw: number, th: number): number {
  const tmpl = icon.bgr;
  const mask = icon.mask;
  const w = icon.maskSum * 3.0;
  if (w < 24.0) return 0.0;
  let sumC = 0.0;
  let sumT = 0.0;
  for (let y = 0; y < th; y++) {
    const cRow = ((dy + y) * cw + dx) * 3;
    const tRow = y * tw * 3;
    const mRow = y * tw;
    for (let x = 0; x < tw; x++) {
      const m = mask[mRow + x];
      if (m === 0) continue;
      const ci = cRow + x * 3;
      const ti = tRow + x * 3;
      sumC += m * (crop[ci] + crop[ci + 1] + crop[ci + 2]);
      sumT += m * (tmpl[ti] + tmpl[ti + 1] + tmpl[ti + 2]);
    }
  }
  const mc = sumC / w;
  const mt = sumT / w;
  let num = 0.0;
  let den1 = 0.0;
  let den2 = 0.0;
  for (let y = 0; y < th; y++) {
    const cRow = ((dy + y) * cw + dx) * 3;
    const tRow = y * tw * 3;
    const mRow = y * tw;
    for (let x = 0; x < tw; x++) {
      const m = mask[mRow + x];
      if (m === 0) continue;
      const ci = cRow + x * 3;
      const ti = tRow + x * 3;
      for (let k = 0; k < 3; k++) {
        const dc = (crop[ci + k] - mc) * m;
        const dt = (tmpl[ti + k] - mt) * m;
        num += dc * dt;
        den1 += dc * dc;
        den2 += dt * dt;
      }
    }
  }
  const denom = Math.sqrt(den1 * den2);
  return denom > 1e-6 ? num / denom : 0.0;
}

/** Kleurzweem-feature: L en a/b gerefereerd aan het helderste kwart. */
function castFeature(bgr8: any): Float32Array {
  const c = cv();
  const lab = new c.Mat();
  c.cvtColor(bgr8, lab, c.COLOR_BGR2Lab);
  const n = lab.rows * lab.cols;
  const data = new Uint8Array(lab.data as Uint8Array);
  lab.delete();
  const lum = new Float32Array(n);
  for (let i = 0; i < n; i++) lum[i] = data[i * 3];
  const sorted = Float32Array.from(lum).sort();
  const p75 = sorted[Math.min(n - 1, Math.round(0.75 * (n - 1)))];
  let lw = 0.0;
  let aw = 0.0;
  let bw = 0.0;
  let count = 0;
  for (let i = 0; i < n; i++) {
    if (lum[i] >= p75) {
      lw += lum[i];
      aw += data[i * 3 + 1];
      bw += data[i * 3 + 2];
      count++;
    }
  }
  lw = Math.max(lw / Math.max(1, count), 1e-6);
  aw /= Math.max(1, count);
  bw /= Math.max(1, count);
  const feat = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    feat[i * 3] = Math.fround(lum[i] / lw);
    feat[i * 3 + 1] = Math.fround((data[i * 3 + 1] - aw) / 40.0);
    feat[i * 3 + 2] = Math.fround((data[i * 3 + 2] - bw) / 40.0);
  }
  return feat;
}

/** Blue-minus-green lower stripe, relative to the unobstructed middle edges. */
function blueBandDelta(bgr8: any): number {
  const w = bgr8.cols;
  const h = bgr8.rows;
  const data = bgr8.data as Uint8Array;
  const band = (top: number, bottom: number): number => {
    let sum = 0;
    let count = 0;
    for (let y = Math.round(top * h); y < Math.round(bottom * h); y++) {
      for (let x = Math.round(0.1 * w); x < Math.round(0.9 * w); x++) {
        if (x >= Math.round(0.34 * w) && x < Math.round(0.66 * w)) continue;
        const i = (y * w + x) * 3;
        sum += data[i] - data[i + 1];
        count++;
      }
    }
    return count ? sum / count : 0;
  };
  return band(0.70, 0.90) - band(0.40, 0.60);
}

/** Center stripe's green-minus-blue contrast relative to the outer stripes.
 * Sample both edges to avoid a flag's central emblem. A sign disagreement is
 * only review evidence; it does not turn a weak visual match into acceptance. */
function flagChromaticBand(bgr8: any): number {
  const w = bgr8.cols;
  const h = bgr8.rows;
  const data = bgr8.data as Uint8Array;
  const stripe = (top: number, bottom: number): number => {
    let sum = 0;
    let count = 0;
    for (let y = Math.round(top * h); y < Math.round(bottom * h); y++) {
      for (let x = Math.round(0.1 * w); x < Math.round(0.9 * w); x++) {
        if (x >= Math.round(0.34 * w) && x < Math.round(0.66 * w)) continue;
        const i = (y * w + x) * 3;
        sum += data[i + 1] - data[i];
        count++;
      }
    }
    return count ? sum / count : 0;
  };
  return stripe(0.4, 0.6) - (stripe(0.1, 0.29) + stripe(0.71, 0.9)) / 2;
}

function matToFloatBgr(bgr8: any): Float32Array {
  const d = bgr8.data as Uint8Array;
  const out = new Float32Array(d.length);
  for (let i = 0; i < d.length; i++) out[i] = d[i];
  return out;
}

function stripLocale(key: string): string {
  const idx = key.indexOf('#');
  return idx < 0 ? key : key.substring(0, idx);
}

function filterLocale(vocab: Record<string, string>, locale: string | null): Record<string, string> {
  if (!locale) return vocab;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(vocab)) {
    if (key.endsWith(`#${locale}`) || key.indexOf('#') < 0) out[key] = value;
  }
  return Object.keys(out).length === 0 ? vocab : out;
}

async function cropPng(canonical: any, x1: number, y1: number, w: number, h: number): Promise<string | null> {
  const c = cv();
  const cx = Math.max(0, Math.min(canonical.cols - 2, x1));
  const cy = Math.max(0, Math.min(canonical.rows - 2, y1));
  const cw = Math.min(w, canonical.cols - cx);
  const ch = Math.min(h, canonical.rows - cy);
  if (cw < 4 || ch < 4) return null;
  const crop = canonical.roi(new c.Rect(cx, cy, cw, ch));
  try {
    return await bgrMatToPngDataUrl(c, crop);
  } catch {
    return null;
  } finally {
    crop.delete();
  }
}
