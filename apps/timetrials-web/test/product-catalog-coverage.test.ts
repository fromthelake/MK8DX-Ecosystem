import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { CATALOG_FILES } from "../src/i18n-catalog-index.generated.js";
import { PRODUCT_LANGUAGES } from "../src/product-language.js";

// The catalogs the page loads must cover every text the code shows (roadmap LANGUAGES_15, gate B6): a text
// missing from a catalog appears in English on that language's page.
const root = fileURLToPath(new URL("../", import.meta.url));
const source = JSON.parse(readFileSync(join(root, "i18n", "messages.source.json"), "utf8")) as {
  messages: { key: string }[];
};
const keys = source.messages.map((message) => message.key);

describe("product catalogs", () => {
  it("publish one content-hashed file per catalog language, and nothing stale", () => {
    const catalogLanguages = PRODUCT_LANGUAGES.map((language) => language.code).filter((code) => code !== "en" && code !== "nl");
    expect(Object.keys(CATALOG_FILES).sort()).toEqual([...catalogLanguages].sort());
    const published = readdirSync(join(root, "styles")).filter((name) => name.startsWith("i18n-")).map((name) => `/styles/${name}`);
    expect(published.sort()).toEqual(Object.values(CATALOG_FILES).sort());
  });

  it.each(Object.entries(CATALOG_FILES).filter(([language]) => language !== "en-US"))(
    "%s covers every source text with known placeholders only",
    (language, file) => {
      const catalog = JSON.parse(readFileSync(join(root, file), "utf8")) as {
        language: string;
        messages: Record<string, string>;
      };
      expect(catalog.language).toBe(language);
      const missing = keys.filter((key) => !(key in catalog.messages));
      expect(missing.slice(0, 10)).toEqual([]);
      for (const [english, translated] of Object.entries(catalog.messages)) {
        const allowed = new Set(english.match(/\{\d+\}/g) ?? []);
        for (const placeholder of translated.match(/\{\d+\}/g) ?? []) {
          expect(allowed.has(placeholder), `${language}: ${english}`).toBe(true);
        }
      }
    },
  );
});
