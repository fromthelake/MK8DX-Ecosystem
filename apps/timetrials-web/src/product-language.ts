import { translateEnglish } from "./product-catalog.js";

/**
 * The product languages: the game's 15 localisations (Clean Assets `gameLocales`), English and Dutch being the
 * reviewed source languages whose text lives in the code; the other 13 come from catalogs (product-catalog.ts).
 */
export type ProductLanguage =
  | "en" | "nl" | "en-US" | "fr" | "fr-CA" | "de" | "es" | "es-419"
  | "it" | "pt" | "ru" | "ja" | "ko" | "zh-CN" | "zh-TW";

export const PRODUCT_LANGUAGES: readonly Readonly<{
  code: ProductLanguage;
  label: string;
  /** BCP 47 tag for dates and numbers. */
  locale: string;
  /** Clean Assets template folder for in-game images (`images/hud/templates/<bucket>/`). */
  templateBucket: string;
}>[] = [
  { code: "en", label: "English (UK)", locale: "en-GB", templateBucket: "en" },
  { code: "nl", label: "Nederlands", locale: "nl-NL", templateBucket: "nl" },
  { code: "en-US", label: "English (US)", locale: "en-US", templateBucket: "en-us" },
  { code: "fr", label: "Français", locale: "fr-FR", templateBucket: "fr" },
  { code: "fr-CA", label: "Français (Canada)", locale: "fr-CA", templateBucket: "fr-ca" },
  { code: "de", label: "Deutsch", locale: "de-DE", templateBucket: "de" },
  { code: "es", label: "Español (España)", locale: "es-ES", templateBucket: "es" },
  { code: "es-419", label: "Español (Latinoamérica)", locale: "es-419", templateBucket: "es-419" },
  { code: "it", label: "Italiano", locale: "it-IT", templateBucket: "it" },
  { code: "pt", label: "Português", locale: "pt-PT", templateBucket: "pt" },
  { code: "ru", label: "Русский", locale: "ru-RU", templateBucket: "ru" },
  { code: "ja", label: "日本語", locale: "ja-JP", templateBucket: "ja" },
  { code: "ko", label: "한국어", locale: "ko-KR", templateBucket: "ko" },
  { code: "zh-CN", label: "简体中文", locale: "zh-CN", templateBucket: "zh-cn" },
  { code: "zh-TW", label: "繁體中文", locale: "zh-TW", templateBucket: "zh-tw" },
];

const STORAGE_KEY = "mk8dx.product-language.v1";
const KNOWN = new Map(PRODUCT_LANGUAGES.map((language) => [language.code.toLowerCase(), language.code]));

/** A product language code in any case, else null. */
export function parseProductLanguage(value: unknown): ProductLanguage | null {
  return typeof value === "string" ? KNOWN.get(value.trim().toLowerCase()) ?? null : null;
}

export function productLanguage(): ProductLanguage {
  try {
    return parseProductLanguage(globalThis.localStorage?.getItem(STORAGE_KEY)) ?? "en";
  } catch {
    return "en";
  }
}

export function setProductLanguage(language: ProductLanguage): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, language);
  } catch {
    // A blocked storage area must not make Settings unusable; the current
    // page still adopts the explicit language choice.
  }
  globalThis.document?.documentElement.setAttribute("lang", language);
  globalThis.document?.dispatchEvent(new CustomEvent("mk8dx-language-change", {
    detail: language,
  }));
}

function languageEntry(language: ProductLanguage = productLanguage()) {
  return PRODUCT_LANGUAGES.find((entry) => entry.code === language) ?? PRODUCT_LANGUAGES[0]!;
}

/** The BCP 47 tag for formatting dates and numbers in the product language. */
export function productLocaleTag(): string {
  return languageEntry().locale;
}

/**
 * The source language whose text the code holds for the product language: Dutch for Dutch, English for every
 * other language (whose page is then translated from the English by its catalog).
 */
export function sourceLanguage(language: ProductLanguage = productLanguage()): "en" | "nl" {
  return language === "nl" ? "nl" : "en";
}

/**
 * Whether the product language uses a catalog: every language except UK English and Dutch, whose text is in the
 * code. US English keeps the English text and takes the US game names from its catalog.
 */
export function usesProductCatalog(language: ProductLanguage = productLanguage()): boolean {
  return language !== "en" && language !== "nl";
}

export function localized(en: string, nl: string): string {
  const language = productLanguage();
  if (language === "nl") { return nl; }
  if (!usesProductCatalog(language)) { return en; }
  return translateEnglish(en) ?? en;
}

export function finishBannerPath(
  outcome: "won" | "record" | "lost",
): string {
  const file = outcome === "won" ? "070_finish_banner_won.png"
    : outcome === "record" ? "071_finish_banner_new_record.png"
      : "072_finish_banner_lost.png";
  return `images/hud/templates/${languageEntry().templateBucket}/${file}`;
}

globalThis.document?.documentElement.setAttribute("lang", productLanguage());
