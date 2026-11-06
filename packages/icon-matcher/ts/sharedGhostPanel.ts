/** The central Select-a-Ghost picker (Python mk8dx_icon_matcher.ghost_panel), one
 * specification in three languages. The ROI Searcher has registered the panel onto its
 * canonical frame and describes it (frame-description-v1); this module refines each icon's
 * position, compares and decides every field on its own (frame-decision-v1).
 *
 * Pixels come through a CropSource: the slot moved by (dx, dy) and scaled around its centre,
 * normalized to the field's reference size (INTER_AREA, RGB 0..1), or null when it leaves the
 * frame. Products back it with OpenCV; the parity test with Python's recorded crops.
 */
import { flagBandRatio } from './sharedFlagBandRatio';
import { matchName as centralMatchName } from './sharedNameMatch';
import { scoreIconTensorAll, type IconTensorGroup } from './sharedIconScorer';
import { partRelationKey } from './sharedPartContext';
import { rankIconShape } from './sharedShapeRank';

export const GHOST_PANEL_PICKER_VERSION = '2';
export const RELIABLE_COLOUR_RESIDUAL = 28.0;
const FAMILY_MARGIN_MIN = 0.02;
const SHAPE_BACKING_MIN = 0.75;
const NAME_STRONG_FUZZY = 0.85;
const NAME_STRONG_MARGIN = 0.15;
const NAME_ALONE_FUZZY = 0.95;
const NAME_ALONE_MARGIN = 0.15;
const NAME_WEAK_FUZZY = 0.65;
const NAME_CONFLICT_FUZZY = 0.55;
const NL = 'country.nl';
const LU = 'country.lu';

export type GhostField = 'character' | 'body' | 'tire' | 'glider' | 'flag';
type PartField = 'body' | 'tire' | 'glider';
type PartKind = 'bodies' | 'tires' | 'gliders';
const PART_KIND: Record<PartField, PartKind> = { body: 'bodies', tire: 'tires', glider: 'gliders' };
// The part-names table and Python's picker name the part fields kart / wheel / glider.
const NAME_FIELD: Record<PartField, string> = { body: 'kart', tire: 'wheel', glider: 'glider' };

export interface CropSource {
  crop(field: GhostField, dx: number, dy: number, scale: number, width: number, height: number): Float32Array | null;
}

export interface GhostPanelReferences {
  characters: IconTensorGroup; // characters / ghost_select
  bodies: IconTensorGroup; // result profile
  tires: IconTensorGroup;
  gliders: IconTensorGroup;
  flags: IconTensorGroup; // result profile
  familyById: ReadonlyMap<string, string>;
  partForCharacter: ReadonlyMap<string, string>;
  partNames: PartNameTable;
}

export interface PartNameTable {
  schema: 'mk8dx.part-names.v1';
  catalogSha256: string;
  names: Record<string, Record<string, Record<string, string>>>;
}

export interface FrameDescriptionField {
  field: string;
  slot: [number, number, number, number];
  context?: { printedText?: string | null };
  candidates?: unknown;
}
export interface FrameDescription {
  schema: 'mk8dx.frame-description.v1';
  frame: string;
  console: string;
  source: string;
  image: { width: number; height: number; sha256?: string };
  residual: number | null;
  locale?: string;
  fields: FrameDescriptionField[];
}
export interface FieldDecision {
  field: string;
  selectedId: string | null;
  acceptedId: string | null;
  basis: string;
  score: number;
  alternatives: { id: string; score: number }[];
  evidence?: Record<string, unknown>;
}
export interface FrameDecision {
  schema: 'mk8dx.frame-decision.v1';
  frame: 'timetrial_ghost_select';
  fieldSemanticsVersion: string;
  decisionVersion: string;
  reliableColour: boolean;
  fields: FieldDecision[];
}

interface Candidate { id: string; familyId: string; score: number }
interface Match {
  status: 'accepted' | 'unknown';
  score: number;
  margin: number;
  top: Candidate[];
  familyTop: { familyId: string; score: number; variants: Candidate[] }[];
}
interface Placed { match: Match; query: Float32Array; dx: number; dy: number; scale: number }

const round4 = (value: number): number => Math.round(value * 10000) / 10000;

function matchQuery(query: Float32Array, group: IconTensorGroup, method: 'rgb' | 'ncc', topK: number): Match {
  const scores = scoreIconTensorAll(query, group, method);
  const order = Array.from(scores, (_, index) => index).sort((a, b) => scores[b] - scores[a] || a - b);
  const score = scores[order[0]];
  const margin = score - scores[order[1]];
  const threshold = method === 'ncc' ? 0.35 : 0.80;
  const status = score >= threshold && margin >= 0.02 ? 'accepted' : 'unknown';
  const candidate = (index: number): Candidate =>
    ({ id: group.ids[index], familyId: group.families[index], score: scores[index] });
  const families = new Map<string, Candidate[]>();
  for (const index of order) {
    const family = group.families[index];
    if (!families.has(family)) families.set(family, []);
    families.get(family)!.push(candidate(index));
  }
  const familyTop = [...families.entries()].slice(0, 3)
    .map(([familyId, variants]) => ({ familyId, score: variants[0].score, variants }));
  return { status, score, margin, top: order.slice(0, topK).map(candidate), familyTop };
}

function searchIcon(source: CropSource, field: GhostField, group: IconTensorGroup, wide = false): Placed | null {
  let best: Placed | null = null;
  const consider = (dx: number, dy: number, scale: number) => {
    const query = source.crop(field, dx, dy, scale, group.width, group.height);
    if (!query) return;
    const match = matchQuery(query, group, 'rgb', 8);
    if (!best || match.score > best.match.score) best = { match, query, dx, dy, scale };
  };
  if (wide) {
    for (const scale of [0.94, 1.0, 1.06]) {
      for (let dy = -8; dy <= 8; dy += 2) for (let dx = -8; dx <= 8; dx += 2) consider(dx, dy, scale);
    }
    if (!best) return null;
    const { dx: bx, dy: by, scale: bs } = best as Placed;
    for (const dy of [by - 1, by, by + 1]) for (const dx of [bx - 1, bx, bx + 1]) consider(dx, dy, bs);
    return best;
  }
  for (let dy = -6; dy <= 6; dy += 2) for (let dx = -6; dx <= 6; dx += 2) consider(dx, dy, 1.0);
  if (!best) return null;
  let { dx: bx, dy: by } = best as Placed;
  for (const dy of [by - 1, by, by + 1]) for (const dx of [bx - 1, bx, bx + 1]) consider(dx, dy, 1.0);
  ({ dx: bx, dy: by } = best as Placed);
  for (const scale of [0.94, 1.06]) consider(bx, by, scale);
  return best;
}

interface Decided {
  id: string;
  accepted: boolean;
  basis: string;
  score: number;
  top: [string, number][];
  evidence: Record<string, unknown>;
}

function readFlag(source: CropSource, flags: IconTensorGroup): Decided | null {
  let best: Placed | null = null;
  for (let dy = -4; dy <= 4; dy++) {
    for (let dx = -4; dx <= 4; dx++) {
      const query = source.crop('flag', dx, dy, 1.0, flags.width, flags.height);
      if (!query) continue;
      const match = matchQuery(query, flags, 'ncc', 3);
      if (!best || match.score > best.match.score) best = { match, query, dx, dy, scale: 1.0 };
    }
  }
  if (!best) return null;
  const placed = best as Placed;
  const top = placed.match.top.map((candidate) => candidate.id);
  let chosen = top[0];
  let accepted = placed.match.status === 'accepted';
  let basis = 'ncc';
  let bandRatio: number | null = null;
  if (top.length > 1 && new Set([top[0], top[1]]).size === 2 && [NL, LU].includes(top[0]) && [NL, LU].includes(top[1])) {
    const band = flagBandRatio(placed.query);
    bandRatio = band.ratio ?? null;
    if (band.decisionId) { chosen = band.decisionId; accepted = true; basis = 'band_ratio'; }
    else { accepted = false; basis = 'band_ratio_between'; }
  }
  return { id: chosen, accepted, basis, score: placed.match.score,
    top: placed.match.top.map((candidate) => [candidate.id, round4(candidate.score)]),
    evidence: { margin: placed.match.margin, offset: [placed.dx, placed.dy], bandRatio } };
}

function shapeTop(placed: Placed, group: IconTensorGroup): [string, number] {
  const first = rankIconShape(placed.query, group, 'masked_gray_ncc').top[0];
  return [first.id, first.score];
}

const familyOf = (refs: GhostPanelReferences, id: string | null): string | null =>
  id === null ? null : refs.familyById.get(id) ?? id;

/** A whole-word catalog name can also name a more specific icon (Normal/Normal Blue). */
function nameWordsWithin(shorter: string, longer: string): boolean {
  const words = (value: string) => value.toLowerCase().match(/[\p{L}\p{Nd}]+/gu) ?? [];
  const part = words(shorter);
  const whole = words(longer);
  return part.length > 0 && whole.length > part.length
    && whole.some((_, start) => part.every((word, offset) => whole[start + offset] === word));
}

/** The second colour opinion: eroded-cutout RGB distance inside the chosen family
 * (Python refinement.refine_family_variants, cutout_rgb route). */
function cutoutTop(placed: Placed, group: IconTensorGroup, minPixels = 24): string | null {
  const family = placed.match.familyTop[0];
  if (family.variants.length < 2) return null;
  const { width, height } = group;
  const pixels = width * height;
  const index = new Map(group.ids.map((id, position) => [id, position]));
  const rows = family.variants.map((variant) => {
    const at = index.get(variant.id)!;
    const mask = group.mask.subarray(at * pixels, (at + 1) * pixels);
    // cv2.erode, 3x3, default border: pixels outside the image do not erode.
    const eroded = new Uint8Array(pixels);
    let count = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let keep = mask[y * width + x] !== 0;
        for (let dy = -1; dy <= 1 && keep; dy++) {
          for (let dx = -1; dx <= 1 && keep; dx++) {
            const yy = y + dy;
            const xx = x + dx;
            if (yy < 0 || xx < 0 || yy >= height || xx >= width) continue;
            if (mask[yy * width + xx] === 0) keep = false;
          }
        }
        if (keep) { eroded[y * width + x] = 1; count++; }
      }
    }
    return { id: variant.id, at, eroded, count };
  });
  if (Math.min(...rows.map((row) => row.count)) < minPixels) return null;
  const distances = rows.map((row) => {
    let sum = 0;
    const base = row.at * pixels * 3;
    for (let pixel = 0; pixel < pixels; pixel++) {
      if (!row.eroded[pixel]) continue;
      for (let channel = 0; channel < 3; channel++) {
        sum += Math.abs(group.rgb[base + pixel * 3 + channel] - placed.query[pixel * 3 + channel]);
      }
    }
    return sum / (row.count * 3);
  });
  const order = rows.map((_, position) => position).sort((a, b) => distances[a] - distances[b] || a - b);
  return rows[order[0]].id;
}

function decideCharacter(placed: Placed, refs: GhostPanelReferences, residual: number | null): Decided {
  const { match } = placed;
  const top = match.top[0].id;
  const families = match.familyTop;
  const familyMargin = families[0].score - (families.length > 1 ? families[1].score : 0);
  const [shapeId, shapeScore] = shapeTop(placed, refs.characters);
  const reliable = residual !== null && residual <= RELIABLE_COLOUR_RESIDUAL;
  const cutout = reliable ? cutoutTop(placed, refs.characters) : null;
  let accepted: boolean;
  let basis: string;
  if (reliable) {
    const variants = families[0].variants.length > 1;
    accepted = match.status === 'accepted' || (familyMargin >= FAMILY_MARGIN_MIN && (!variants || cutout === top));
    basis = match.status === 'accepted' ? 'colour' : 'family_then_colour';
  } else {
    accepted = match.status === 'accepted' && familyOf(refs, shapeId) === familyOf(refs, top)
      && shapeScore >= SHAPE_BACKING_MIN;
    basis = 'shape_backed';
  }
  return { id: top, accepted, basis, score: match.score,
    top: match.top.slice(0, 3).map((candidate) => [candidate.id, round4(candidate.score)]),
    evidence: { margin: match.margin, familyMargin, cutoutTop: cutout, shapeTop: shapeId, shapeScore,
      reliableColour: reliable, offset: [placed.dx, placed.dy], scale: placed.scale } };
}

/** The printed-name clue through the central name matcher (sharedNameMatch). */
export function matchName(text: string | null | undefined, names: Record<string, string>):
  [string | null, number, number] {
  const found = centralMatchName(text, Object.entries(names));
  return [found.key, found.fuzzy, found.margin];
}

export function namesForLocale(table: PartNameTable, locale: string): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const [field, byId] of Object.entries(table.names)) {
    out[field] = {};
    for (const [id, byLocale] of Object.entries(byId).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
      const name = byLocale[locale] || byLocale['en-GB'] || byLocale['en-US'];
      if (name) out[field][id] = name;
    }
  }
  return out;
}

function decidePart(field: PartField, placed: Placed, refs: GhostPanelReferences, text: string | null | undefined,
  names: Record<string, string>, character: string | null, reliable: boolean, wide: Placed | null): Decided {
  const kind = PART_KIND[field];
  const group = refs[kind];
  const [nameId, fuzzy, margin] = matchName(text, names);
  const nameFamily = familyOf(refs, nameId);
  const strong = nameId && fuzzy >= NAME_STRONG_FUZZY && margin >= NAME_STRONG_MARGIN ? nameFamily : null;
  const used = wide ?? placed;
  const topIds = used.match.top.slice(0, 3).map((candidate) => candidate.id);
  const [shapeId, shapeScore] = shapeTop(used, group);
  const related = (family: string | null): string | null => {
    if (field === 'tire' || !character || !family) return null;
    return refs.partForCharacter.get(partRelationKey(kind as 'bodies' | 'gliders', family, character)) ?? null;
  };
  const hasVariants = (family: string | null): boolean => {
    if (field === 'tire') return false;
    let count = 0;
    for (const value of refs.familyById.values()) if (value === family) count++;
    return count > 1;
  };
  const result = (id: string, accepted: boolean, basis: string): Decided => ({
    id, accepted: Boolean(accepted), basis, score: used.match.score,
    top: used.match.top.slice(0, 3).map((candidate) => [candidate.id, round4(candidate.score)]),
    evidence: { margin: used.match.margin, name: nameId, nameFuzzy: fuzzy, nameMargin: margin,
      shapeTop: shapeId, shapeScore, wide: wide !== null, offset: [used.dx, used.dy], scale: used.scale },
  });
  if (strong) {
    // A shorter printed name is incomplete evidence when the independently
    // accepted top icon names a longer catalog entry containing those words.
    const topFamily = familyOf(refs, topIds[0]);
    if (reliable && used.match.status === 'accepted' && topFamily !== strong
        && nameWordsWithin(names[nameId!] ?? '', topFamily ? names[topFamily] ?? '' : '')) {
      return result(topIds[0], true, 'partial_name_top_icon');
    }
    const inIcons = topIds.filter((id) => familyOf(refs, id) === strong);
    if (familyOf(refs, shapeId) === strong) inIcons.push(shapeId);
    const relation = related(strong);
    if (relation) return result(relation, inIcons.length > 0, 'name_family_character_colour');
    if (inIcons.length) return result(inIcons[0], !hasVariants(strong) || reliable, 'name_family_icon_colour');
    if (familyOf(refs, shapeId) === topFamily && topFamily && topFamily.startsWith(`${strong}_`)) {
      return result(topIds[0], true, 'icons_over_name_prefix');
    }
    if (fuzzy >= NAME_ALONE_FUZZY && margin >= NAME_ALONE_MARGIN) {
      return result(related(strong) ?? strong, true, 'name_alone');
    }
    return result(strong, false, 'name_icon_conflict');
  }
  const topFamily = familyOf(refs, topIds[0]);
  if (nameId && fuzzy >= NAME_CONFLICT_FUZZY && nameFamily !== topFamily) {
    return result(topIds[0], false, 'half_legible_name_conflict');
  }
  if (nameId && fuzzy >= NAME_WEAK_FUZZY && nameFamily === topFamily) {
    const relation = related(topFamily);
    return result(relation ?? topIds[0], Boolean(relation) || !hasVariants(topFamily) || reliable,
      'weak_name_and_icon');
  }
  const shapeAgrees = familyOf(refs, shapeId) === topFamily;
  const relation = shapeAgrees ? related(topFamily) : null;
  if (relation) return result(relation, true, 'icon_shape_character_colour');
  const accepted = used.match.status === 'accepted' && shapeAgrees && (!hasVariants(topFamily) || reliable);
  return result(topIds[0], accepted, 'icon_and_shape');
}

function needsWideSearch(placed: Placed, refs: GhostPanelReferences, text: string | null | undefined,
  names: Record<string, string>): boolean {
  const [nameId, fuzzy, margin] = matchName(text, names);
  if (!nameId || fuzzy < NAME_STRONG_FUZZY || margin < NAME_STRONG_MARGIN) return false;
  const family = familyOf(refs, nameId);
  return !placed.match.top.slice(0, 3).some((candidate) => familyOf(refs, candidate.id) === family);
}

/** frame-description-v1 (timetrial_ghost_select) in, frame-decision-v1 out. */
export function decideGhostSelectFrame(description: FrameDescription, source: CropSource,
  refs: GhostPanelReferences, fieldSemanticsVersion: string): FrameDecision {
  if (description.schema !== 'mk8dx.frame-description.v1' || description.frame !== 'timetrial_ghost_select') {
    throw new Error('Expected a timetrial_ghost_select frame description');
  }
  const wanted = new Set<string>(['character', 'body', 'tire', 'glider', 'flag']);
  const texts = new Map<string, string | null | undefined>();
  for (const item of description.fields) {
    if (!wanted.has(item.field)) throw new Error(`Field ${item.field} is not part of the Select-a-Ghost decision`);
    if (item.candidates) throw new Error('Candidate scopes are not supported by the Select-a-Ghost decision yet');
    texts.set(item.field, item.context?.printedText);
  }
  const present = new Set(description.fields.map((item) => item.field));
  const residual = description.residual;
  const reliable = residual !== null && residual <= RELIABLE_COLOUR_RESIDUAL;
  const decided = new Map<string, Decided | null>();
  if (present.has('flag')) decided.set('flag', readFlag(source, refs.flags));
  let character: string | null = null;
  if (present.has('character')) {
    const placed = searchIcon(source, 'character', refs.characters);
    if (placed) {
      const read = decideCharacter(placed, refs, residual);
      decided.set('character', read);
      if (read.accepted) character = read.id;
    }
  }
  const names = namesForLocale(refs.partNames, description.locale ?? 'en-GB');
  for (const field of ['body', 'tire', 'glider'] as PartField[]) {
    if (!present.has(field)) continue;
    const group = refs[PART_KIND[field]];
    const placed = searchIcon(source, field, group);
    if (!placed) continue;
    const fieldNames = names[NAME_FIELD[field]] ?? {};
    const text = texts.get(field);
    const wide = needsWideSearch(placed, refs, text, fieldNames) ? searchIcon(source, field, group, true) : null;
    decided.set(field, decidePart(field, placed, refs, text, fieldNames, character, reliable, wide));
  }
  const fields: FieldDecision[] = description.fields.map((item) => {
    const read = decided.get(item.field);
    if (!read) {
      return { field: item.field, selectedId: null, acceptedId: null, basis: 'not_placed', score: 0, alternatives: [] };
    }
    return { field: item.field, selectedId: read.id, acceptedId: read.accepted ? read.id : null,
      basis: read.basis, score: read.score,
      alternatives: read.top.slice(0, 3).map(([id, score]) => ({ id, score })), evidence: read.evidence };
  });
  return { schema: 'mk8dx.frame-decision.v1', frame: 'timetrial_ghost_select', fieldSemanticsVersion,
    decisionVersion: `ghost_panel_picker.${GHOST_PANEL_PICKER_VERSION}`, reliableColour: reliable, fields };
}
