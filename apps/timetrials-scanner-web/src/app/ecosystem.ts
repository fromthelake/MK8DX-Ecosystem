// Terugkoppeling naar de MK8DX-webapplicatie op dezelfde origin.
//
// De scanner weet hoe je een Switch-scherm leest en verder niets: geen spelers,
// geen circuits, geen publicatie. De webapplicatie weet dat allemaal en leest
// geen schermen. Wordt de scanner vanuit een circuit geopend, dan schrijft hij
// wat hij gelezen heeft naar session storage en keert terug; daar controleert
// en bevestigt de speler het in het gewone invoerformulier. Er wordt hier niets
// opgeslagen en niets verstuurd.
import type { LayoutProfile, ScanResult } from '../engine/types';
import { composeScanResult } from '../../../../packages/icon-matcher/ts/sharedScanResult';

export interface EcosystemHandoffRequest {
  trackId: string;
  mode: 150 | 200;
  storageKey: string;
  returnHref: string;
  /** Canonical lap count supplied by the selected track in the Web catalog. */
  lapCount: 3 | 7;
  /** Het scherm dat de speler in de taak koos (ScanSourcePicker); null = de eigen voorkeur. */
  layout: LayoutProfile | null;
}

export interface EcosystemHandoffPayload {
  trackId: string;
  mode: 150 | 200;
  totalDigits: string;
  laps: string[];
  characterId?: string;
  bodyId?: string;
  tireIndex?: number;
  /** The tyre's catalog ID (ADR-0215); the index stays for older website builds. */
  tireId?: string;
  gliderId?: string;
  /** The flag on the card (ADR-0215). */
  countryId?: string;
  observedPlayerName?: string;
  /**
   * Herkomst (ADR-0204). De scanner slaat nog steeds niets op en verstuurt niets: hij vertelt de
   * webapplicatie alleen wat hij gelezen heeft en hoe zeker hij was, zodat die het als scan kan
   * publiceren in plaats van als getypte tijd. Het verandert niets aan de geldigheid van de tijd.
   */
  layout: LayoutProfile;
  producerVersion: string;
  /** Per contract-veldgroep (0..1); alleen wat de scanner daadwerkelijk heeft gemeten. */
  confidence?: Record<string, number>;
  /** De eigen rondesom-controle van de scanner. */
  lapSumMatches?: boolean;
  /** Veldpaden waar de scanner twijfelde; de taak markeert ze met "Controleer deze even". */
  doubt?: string[];
}

const STORAGE_KEY_PATTERN = /^[a-z0-9.\-]{1,64}$/;

/** Alleen een pad op deze site; nooit een absolute of protocol-relatieve URL. */
function samePagePath(value: string | null): string | null {
  if (value === null || !value.startsWith('/') || value.startsWith('//')) return null;
  return value.length > 512 ? null : value;
}

export function readEcosystemHandoffRequest(search: string): EcosystemHandoffRequest | null {
  const parameters = new URLSearchParams(search);
  const trackId = parameters.get('track');
  const storageKey = parameters.get('handoff');
  const returnHref = samePagePath(parameters.get('return'));
  if (!trackId || !storageKey || !returnHref) return null;
  if (!/^track\.[a-z0-9_]{1,64}$/.test(trackId)) return null;
  if (!STORAGE_KEY_PATTERN.test(storageKey)) return null;
  const layout = parameters.get('layout');
  return {
    trackId,
    mode: parameters.get('mode') === '200' ? 200 : 150,
    storageKey,
    returnHref,
    lapCount: parameters.get('laps') === '7' ? 7 : 3,
    layout: layout === 'ghost_detail' ? 'ghost_detail' : layout === 'endscreen' ? 'endscreen' : null,
  };
}

/** "m:ss.mmm" -> "mssmmm"; alles wat niet exact leesbaar is wordt leeg. */
export function timeDigitsOf(value: string | undefined): string {
  if (!value || !/^\d:\d\d\.\d\d\d$/.test(value)) return '';
  return value[0] + value.substring(2, 4) + value.substring(5, 8);
}

/** The draft field paths the task knows for a central doubt (ScanResult part names and "laps"). */
const DOUBT_PATHS: Record<string, string> = {
  character: 'loadout.characterId', body: 'loadout.bodyId', tire: 'loadout.tireId', glider: 'loadout.gliderId',
  country: 'countryId',
};

/**
 * Catalog IDs for the positions the scanner reads tyres and flags by: the staged
 * `shared-icon/field-index.json` (built from the recognition pack, the same table the reader uses),
 * inverted. ADR-0215: the website receives IDs, not positions.
 */
export interface EcosystemIdTable { tires: Record<number, string>; flags: Record<number, string> }

export function idTableFromFieldIndex(index: unknown): EcosystemIdTable | null {
  if (!index || typeof index !== 'object') return null;
  const record = index as { schema?: unknown; tires?: unknown; flags?: unknown };
  if (record.schema !== 'mk8dx.scanner-field-index.v1') return null;
  const invert = (map: unknown): Record<number, string> => {
    const out: Record<number, string> = {};
    if (map && typeof map === 'object') {
      for (const [id, position] of Object.entries(map as Record<string, unknown>)) {
        if (typeof position === 'number' && Number.isInteger(position)) out[position] = id;
      }
    }
    return out;
  };
  return { tires: invert(record.tires), flags: invert(record.flags) };
}

/**
 * The handoff from the central scan result (packages/icon-matcher sharedScanResult, the same rules
 * as the APK; CENTRAL_RECOGNITION section 8.6, phase 4): which rider counts (the yellow player card,
 * else the only rider of a Select-a-Ghost panel), which times are readable, whether complete laps
 * add up, which parts are accepted and where the player must check.
 */
export function buildEcosystemHandoff(
  request: EcosystemHandoffRequest,
  result: ScanResult,
  ids: EcosystemIdTable | null = null,
): EcosystemHandoffPayload | null {
  const central = composeScanResult(result as unknown as Record<string, unknown>, request.lapCount);
  if (central.status !== 'ok') return null;
  const totalDigits = timeDigitsOf(central.totalTime ?? undefined);
  if (totalDigits === '') return null;
  const laps = central.laps.map((lap) => timeDigitsOf(lap.time ?? undefined));
  const accepted = (name: 'character' | 'body' | 'tire' | 'glider' | 'country') => {
    const part = central.parts[name];
    return part && part.accepted ? part : null;
  };
  const character = accepted('character');
  const body = accepted('body');
  const tire = accepted('tire');
  const glider = accepted('glider');
  const country = accepted('country');
  const tireId = typeof tire?.index === 'number' ? ids?.tires[tire.index] : undefined;
  const countryId = typeof country?.index === 'number' ? ids?.flags[country.index] : undefined;
  // Herkomst: wat de scanner gelezen heeft en hoe zeker. De taak beslist wat ze ermee doet.
  const confidence: Record<string, number> = {};
  for (const name of ['character', 'body', 'tire', 'glider', 'country'] as const) {
    const score = central.confidence[name];
    if (typeof score === 'number') confidence[name] = score;
  }
  const doubt: string[] = [];
  for (const name of central.doubt) {
    if (name === 'laps') laps.forEach((_lap, index) => doubt.push(`laps[${index}].timeDigits`));
    else if (DOUBT_PATHS[name]) doubt.push(DOUBT_PATHS[name]);
  }
  return {
    trackId: request.trackId,
    mode: request.mode,
    totalDigits,
    laps,
    ...(character?.id ? { characterId: character.id } : {}),
    ...(body?.id ? { bodyId: body.id } : {}),
    ...(typeof tire?.index === 'number' ? { tireIndex: tire.index } : {}),
    ...(tireId ? { tireId } : {}),
    ...(glider?.id ? { gliderId: glider.id } : {}),
    ...(countryId ? { countryId } : {}),
    ...(central.observedPlayerName ? { observedPlayerName: central.observedPlayerName } : {}),
    layout: central.layout,
    producerVersion: `tt-scan-web/${__MK8_WEB_VERSION__}`,
    ...(Object.keys(confidence).length ? { confidence } : {}),
    ...(central.lapSumMatches !== null ? { lapSumMatches: central.lapSumMatches } : {}),
    ...(doubt.length ? { doubt } : {}),
  };
}

/** Schrijft het resultaat weg en gaat terug; false als opslag geweigerd wordt. */
export function returnToEcosystem(
  request: EcosystemHandoffRequest,
  payload: EcosystemHandoffPayload,
  storage: Storage,
  navigate: (href: string) => void,
): boolean {
  try {
    storage.setItem(request.storageKey, JSON.stringify(payload));
  } catch {
    return false;
  }
  navigate(request.returnHref);
  return true;
}
