/** The central printed-name matcher (Python name_match.py, Java NameMatch; CENTRAL_RECOGNITION
 * section 8.6, phase 3): normalized Levenshtein on UTF-16 code units, first best name wins,
 * margin against the best name spelled differently. Moved from the Web scanner's textEvidence
 * (matchVocab), which was a port of Android TextEvidence.matchVocab.
 */

export const FUZZY_MIN = 0.85;
export const MARGIN_MIN = 0.08;
export const WEAK_FUZZY_MIN = 0.78;
export const WEAK_MARGIN_MIN = 0.25;

const isLetterOrDigit = (ch: string): boolean => /[\p{L}\p{Nd}]/u.test(ch);

export function normalizeName(text: string | null | undefined): string {
  if (!text) return '';
  let out = '';
  for (const ch of text.toLowerCase()) if (isLetterOrDigit(ch)) out += ch;
  return out;
}

/** 1 - levenshtein/maxlen on UTF-16 code units (as Java). */
export function nameSimilarity(a: string, b: string): number {
  if (a.length === 0 || b.length === 0) return 0.0;
  let prev = new Int32Array(b.length + 1);
  let cur = new Int32Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(Math.min(cur[j - 1] + 1, prev[j] + 1), prev[j - 1] + cost);
    }
    const tmp = prev;
    prev = cur;
    cur = tmp;
  }
  return 1.0 - prev[b.length] / Math.max(a.length, b.length);
}

export interface NameMatchResult { key: string | null; name: string | null; fuzzy: number; margin: number }

export function nameMatchStrong(match: NameMatchResult): boolean {
  return (match.fuzzy >= FUZZY_MIN && match.margin >= MARGIN_MIN)
    || (match.fuzzy >= WEAK_FUZZY_MIN && match.margin >= WEAK_MARGIN_MIN);
}

/** ``vocab``: ordered (key, name) pairs, or a key -> name record (its iteration order). */
export function matchName(text: string | null | undefined,
  vocab: readonly (readonly [string, string])[] | Record<string, string> | null): NameMatchResult {
  const out: NameMatchResult = { key: null, name: null, fuzzy: 0.0, margin: 0.0 };
  const query = normalizeName(text);
  if (query.length < 3 || !vocab) return out;
  const entries = Array.isArray(vocab) ? vocab : Object.entries(vocab);
  let best = -1.0;
  for (const [key, name] of entries) {
    const s = nameSimilarity(query, normalizeName(name));
    if (s > best) {
      best = s;
      out.key = key;
      out.name = name;
    }
  }
  let second = -1.0;
  const bestName = normalizeName(out.name);
  for (const [, name] of entries) {
    const n = normalizeName(name);
    if (n === bestName) continue;
    const s = nameSimilarity(query, n);
    if (s > second) second = s;
  }
  out.fuzzy = Math.max(0.0, best);
  out.margin = second < 0.0 ? best : best - second;
  return out;
}

/** Printed titles (track names): see match_title in name_match.py for the measurement. */
export const TITLE_FUZZY_MIN = 0.65;
export const TITLE_MARGIN_MIN = 0.08;
const TITLE_PREFIX_MIN_UNITS = 6;
/** Chinese, Japanese and Korean titles: a clear winner from 0.55 with a lead of 0.12. */
export const CJK_TITLE_FUZZY_MIN = 0.55;
export const CJK_TITLE_MARGIN_MIN = 0.12;

function isCjk(text: string | null): boolean {
  for (const ch of text ?? '') {
    const c = ch.codePointAt(0)!;
    if ((c >= 0x3040 && c <= 0x30ff) || (c >= 0x4e00 && c <= 0x9fff) || (c >= 0xac00 && c <= 0xd7af)) return true;
  }
  return false;
}

export interface TitleMatchResult { key: string | null; name: string | null; fuzzy: number; margin: number; rule: string | null }

function nameTokens(text: string | null | undefined): string[] {
  const out: string[] = [];
  let cur = '';
  for (const ch of (text ?? '').toLowerCase()) {
    if (isLetterOrDigit(ch)) cur += ch;
    else if (cur) { out.push(cur); cur = ''; }
  }
  if (cur) out.push(cur);
  return out;
}

const itemOf = (key: string): string => key.split('#', 1)[0];
const sameList = (a: string[], b: string[]): boolean => a.length === b.length && a.every((v, i) => v === b[i]);

/** A printed title (a track name) in a vocabulary keyed "<id>#<locale>" (Python match_title). */
export function matchTitle(text: string | null | undefined,
  vocab: readonly (readonly [string, string])[] | Record<string, string> | null): TitleMatchResult {
  const none: TitleMatchResult = { key: null, name: null, fuzzy: 0.0, margin: 0.0, rule: null };
  const words = nameTokens(text);
  if (!words.length || !vocab) return none;
  const entries = Array.isArray(vocab) ? vocab : Object.entries(vocab);
  if (!entries.length) return none;
  const wanted = [...words].sort();
  const exact = new Map<string, readonly [string, string]>();
  for (const entry of entries) {
    const item = itemOf(entry[0]);
    if (!exact.has(item) && sameList([...nameTokens(entry[1])].sort(), wanted)) exact.set(item, entry);
  }
  if (exact.size > 1) return { ...none, rule: 'ambiguous' };
  if (exact.size === 1) {
    const [key, name] = [...exact.values()][0];
    return { key, name, fuzzy: 1.0, margin: 1.0, rule: 'tokens' };
  }
  const query = normalizeName(text);
  if (words.length >= 2 && query.length >= TITLE_PREFIX_MIN_UNITS) {
    const starts = new Map<string, readonly [string, string]>();
    for (const entry of entries) {
      const item = itemOf(entry[0]);
      if (!starts.has(item) && sameList(nameTokens(entry[1]).slice(0, words.length), words)) starts.set(item, entry);
    }
    if (starts.size === 1) {
      const [key, name] = [...starts.values()][0];
      return { key, name, fuzzy: nameSimilarity(query, normalizeName(name)), margin: 1.0, rule: 'prefix' };
    }
  }
  if (query.length < 3) return none;
  let best = -1.0;
  let bestKey: string | null = null;
  let bestName: string | null = null;
  for (const [key, name] of entries) {
    const s = nameSimilarity(query, normalizeName(name));
    if (s > best) { best = s; bestKey = key; bestName = name; }
  }
  let second = -1.0;
  for (const [key, name] of entries) {
    if (itemOf(key) === itemOf(bestKey!)) continue;
    const s = nameSimilarity(query, normalizeName(name));
    if (s > second) second = s;
  }
  const margin = second < 0.0 ? best : best - second;
  if (best >= TITLE_FUZZY_MIN && margin >= TITLE_MARGIN_MIN) return { key: bestKey, name: bestName, fuzzy: best, margin, rule: 'fuzzy' };
  if (isCjk(bestName) && best >= CJK_TITLE_FUZZY_MIN && margin >= CJK_TITLE_MARGIN_MIN) {
    return { key: bestKey, name: bestName, fuzzy: best, margin, rule: 'fuzzy_cjk' };
  }
  return { key: null, name: bestName, fuzzy: Math.max(0.0, best), margin, rule: null };
}

/** The names of one locale (keys "<id>#<locale>"; keys without a locale stay); all when it has none. */
export function filterLocale(vocab: Record<string, string>, locale: string | null): Record<string, string> {
  if (!locale) return vocab;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(vocab)) {
    if (key.endsWith(`#${locale}`) || key.indexOf('#') < 0) out[key] = value;
  }
  return Object.keys(out).length === 0 ? vocab : out;
}

export function vocabLocales(vocab: Record<string, string>): string[] {
  const locales = new Set<string>();
  for (const key of Object.keys(vocab)) {
    const h = key.indexOf('#');
    if (h >= 0) locales.add(key.substring(h + 1));
  }
  return [...locales].sort();
}

export interface LocaleVote { locale: string | null; score: number; tied: string[]; firstMatch: NameMatchResult | null }

/** The console language from every printed name of one card at once (Python locale_vote): each
 * locale scores the sum of the rows' best fuzzy match among its names; the highest sum wins; on a
 * tie the earlier locale in preferred + sorted(rest) wins, so a remembered language only breaks
 * ties. ``rows``: [kind, text], kart first. */
export function localeVote(rows: readonly (readonly [string, string])[], vocabs: Record<string, Record<string, string>>,
  locales: readonly string[], preferred: readonly string[] = []): LocaleVote {
  const pref = preferred.filter((loc) => locales.includes(loc));
  const order = [...pref, ...[...locales].filter((loc) => !pref.includes(loc)).sort()];
  const scores = new Map<string, number>();
  const firstMatches = new Map<string, NameMatchResult>();
  for (const locale of order) {
    let joint = 0;
    rows.forEach(([kind, text], index) => {
      if (!text) return;
      const found = matchName(text, filterLocale(vocabs[kind], locale));
      joint += found.fuzzy;
      if (index === 0) firstMatches.set(locale, found);
    });
    scores.set(locale, joint);
  }
  let bestLocale: string | null = null;
  let best = -1.0;
  for (const locale of order) {
    const score = scores.get(locale)!;
    if (score > best + 1e-9) { bestLocale = locale; best = score; }
  }
  const tied = order.filter((loc) => Math.abs(scores.get(loc)! - best) <= 1e-9);
  return { locale: bestLocale, score: best, tied, firstMatch: bestLocale === null ? null : firstMatches.get(bestLocale) ?? null };
}

const OWN_SCRIPT: Record<string, string> = { 'ja-JP': 'ja', 'zh-CN': 'zh', 'zh-TW': 'zh_tw', 'ko-KR': 'ko', 'ru-RU': 'ru' };

/** The OCR reader (script) that prints a game locale's names; null for no locale. */
export function scriptForLocale(locale: string | null | undefined): string | null {
  if (!locale) return null;
  return OWN_SCRIPT[locale] ?? 'latin';
}

/** Every locale whose name for the matched item is spelled like the match (Python same_name_locales). */
export function sameNameLocales(vocab: Record<string, string>, key: string | null | undefined): string[] {
  if (!key || key.indexOf('#') < 0) return [];
  const item = key.substring(0, key.indexOf('#'));
  const target = normalizeName(vocab[key]);
  const out = new Set<string>();
  for (const [k, n] of Object.entries(vocab)) {
    const h = k.indexOf('#');
    if (h >= 0 && k.substring(0, h) === item && normalizeName(n) === target) out.add(k.substring(h + 1));
  }
  return [...out].sort();
}
