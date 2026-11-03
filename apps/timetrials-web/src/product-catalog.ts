/**
 * Translations for the product languages beyond English and Dutch (roadmap LANGUAGES_15, part B).
 *
 * English is the source text and the key. `localized(en, nl)` and the page-wide text translator look an English
 * text up here: first exactly, then against the message templates — an English source with `{0}`, `{1}` where the
 * code interpolates a value — whose captured values fill the translated template. Game names (tracks, characters,
 * parts, cups) come from Clean Assets per locale and travel inside the same catalog, never translated by hand.
 *
 * A catalog is one JSON file per language under `styles/i18n/`, named with its content hash
 * (`i18n-catalog-index.generated.ts`), fetched once before the first render; a language change reloads the page.
 */
import { CATALOG_FILES } from "./i18n-catalog-index.generated.js";

export const CATALOG_SCHEMA = "mk8dx.web-message-catalog.v1";

export type CatalogDocument = Readonly<{
  schemaVersion: typeof CATALOG_SCHEMA;
  language: string;
  messages: Readonly<Record<string, string>>;
  gameNames?: Readonly<Record<string, string>>;
}>;

type CompiledTemplate = Readonly<{
  pattern: RegExp;
  translation: string;
  placeholders: number;
}>;

type Catalog = Readonly<{
  language: string;
  exact: ReadonlyMap<string, string>;
  byPrefix: ReadonlyMap<string, readonly CompiledTemplate[]>;
  leading: readonly CompiledTemplate[];
  gameNames: readonly (readonly [string, string])[];
}>;

const PLACEHOLDER = /\{(\d+)\}/g;
const PREFIX_LENGTH = 6;
let active: Catalog | null = null;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function compile(document: CatalogDocument): Catalog {
  const exact = new Map<string, string>();
  const byPrefix = new Map<string, CompiledTemplate[]>();
  const leading: CompiledTemplate[] = [];
  for (const [source, translation] of Object.entries(document.messages)) {
    if (typeof translation !== "string" || translation.length === 0) { continue; }
    const literals = source.split(PLACEHOLDER).filter((_, index) => index % 2 === 0);
    const placeholders = (source.match(PLACEHOLDER) ?? []).length;
    if (placeholders === 0) {
      exact.set(source, translation);
      continue;
    }
    // Placeholder numbers in the source are in reading order ({0}, {1}, ...); the translation may reorder them.
    const template: CompiledTemplate = {
      pattern: new RegExp(`^${literals.map(escapeRegex).join("([\\s\\S]*?)")}$`),
      translation,
      placeholders,
    };
    const first = literals[0] ?? "";
    if (first.length === 0) {
      leading.push(template);
    } else {
      const key = first.slice(0, PREFIX_LENGTH);
      const bucket = byPrefix.get(key) ?? [];
      bucket.push(template);
      byPrefix.set(key, bucket);
    }
  }
  const gameNames = Object.entries(document.gameNames ?? {})
    .filter(([english, translated]) => english.length > 0 && translated.length > 0 && english !== translated)
    .sort(([left], [right]) => right.length - left.length);
  return { language: document.language, exact, byPrefix, leading, gameNames };
}

function fill(template: CompiledTemplate, values: readonly string[]): string {
  return template.translation.replace(PLACEHOLDER, (whole, index: string) => values[Number(index)] ?? whole);
}

/**
 * A translation may leave out a placeholder that only carried an English plural ("{0} player{1}"); such a value
 * must then be a short ending, or the template swallowed text it would lose ("36 players · 2026-09-11").
 */
function keepsDroppedValuesShort(template: CompiledTemplate, values: readonly string[]): boolean {
  const used = new Set([...template.translation.matchAll(/\{(\d+)\}/g)].map((found) => Number(found[1])));
  return values.every((value, index) => used.has(index) || /^[A-Za-z]{0,3}$/.test(value));
}

function matchTemplates(text: string, templates: readonly CompiledTemplate[] | undefined): string | undefined {
  for (const template of templates ?? []) {
    const match = template.pattern.exec(text);
    if (match !== null && match.length - 1 === template.placeholders && keepsDroppedValuesShort(template, match.slice(1))) {
      return fill(template, match.slice(1).map((value) => translateEnglish(value) ?? value));
    }
  }
  return undefined;
}

/** The active language's text for an English source, or undefined when the catalog has none. */
export function translateEnglish(text: string): string | undefined {
  if (active === null || text.length === 0) { return undefined; }
  const exact = active.exact.get(text);
  if (exact !== undefined) { return exact; }
  for (let length = Math.min(PREFIX_LENGTH, text.length); length > 0; length -= 1) {
    const found = matchTemplates(text, active.byPrefix.get(text.slice(0, length)));
    if (found !== undefined) { return found; }
  }
  return matchTemplates(text, active.leading) ?? gameName(text);
}

/** A game name (track, character, part, cup) in the active language, matched whole. */
export function gameName(text: string): string | undefined {
  if (active === null) { return undefined; }
  return active.gameNames.find(([english]) => english === text)?.[1];
}

/** Every game name inside a longer English text replaced, longest first (the Dutch page translator's rule). */
export function replaceGameNames(text: string): string {
  if (active === null) { return text; }
  let result = text;
  for (const [english, translated] of active.gameNames) {
    if (result.includes(english)) { result = result.replaceAll(english, translated); }
  }
  return result;
}

export function activeCatalogLanguage(): string | null {
  return active?.language ?? null;
}

export function setActiveCatalog(document: CatalogDocument | null): void {
  active = document === null ? null : compile(document);
}

/**
 * Fetch and activate the catalog of `language`. English and Dutch have none (their text is in the code); a
 * missing or broken catalog leaves the page in English rather than failing it.
 */
export async function loadProductCatalog(
  language: string,
  fetchPort: (input: string) => Promise<Response> = (input) => globalThis.fetch(input, { credentials: "same-origin" }),
): Promise<boolean> {
  const file = CATALOG_FILES[language];
  if (file === undefined) {
    setActiveCatalog(null);
    return false;
  }
  try {
    const response = await fetchPort(file);
    if (!response.ok) { throw new Error(`catalog ${file} answered ${response.status}`); }
    const document = await response.json() as CatalogDocument;
    if (document.schemaVersion !== CATALOG_SCHEMA || document.language !== language) {
      throw new Error(`catalog ${file} is not ${CATALOG_SCHEMA} for ${language}`);
    }
    setActiveCatalog(document);
    return true;
  } catch {
    setActiveCatalog(null);
    return false;
  }
}
