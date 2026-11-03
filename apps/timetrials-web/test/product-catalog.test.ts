import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  CATALOG_SCHEMA,
  loadProductCatalog,
  replaceGameNames,
  setActiveCatalog,
  translateEnglish,
} from "../src/product-catalog.js";
import {
  localized,
  parseProductLanguage,
  productLocaleTag,
  sourceLanguage,
  usesProductCatalog,
} from "../src/product-language.js";

const storage = new Map<string, string>();

beforeEach(() => {
  storage.clear();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
  };
});

afterEach(() => {
  setActiveCatalog(null);
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

const german = {
  schemaVersion: CATALOG_SCHEMA,
  language: "de",
  messages: {
    "Settings": "Einstellungen",
    "Asked on {0}": "Angefragt am {0}",
    "{0} of {1} links": "{0} von {1} Verknüpfungen",
    "Open {0}'s profile": "Profil von {0} öffnen",
    "Your request for {0} waits for {1} since {2}.": "Deine Anfrage für {0} wartet seit {2} auf {1}.",
  },
  gameNames: { "Mario Kart Stadium": "Mario Kart-Stadion", "Water Park": "Wasserpark", "Mario": "Mario" },
} as const;

describe("product catalog lookup", () => {
  it("translates exact texts and fills message templates, reordering placeholders", () => {
    setActiveCatalog(german);
    expect(translateEnglish("Settings")).toBe("Einstellungen");
    expect(translateEnglish("Asked on 31 Oct 2026")).toBe("Angefragt am 31 Oct 2026");
    expect(translateEnglish("3 of 12 links")).toBe("3 von 12 Verknüpfungen");
    expect(translateEnglish("Your request for Mal waits for Evan since 30 Oct."))
      .toBe("Deine Anfrage für Mal wartet seit 30 Oct auf Evan.");
    expect(translateEnglish("Nothing like this")).toBeUndefined();
  });

  it("translates a game name inside a value and replaces names in other text", () => {
    setActiveCatalog(german);
    expect(translateEnglish("Open Water Park's profile")).toBe("Profil von Wasserpark öffnen");
    expect(translateEnglish("Mario Kart Stadium")).toBe("Mario Kart-Stadion");
    expect(replaceGameNames("Best on Mario Kart Stadium and Water Park")).toBe("Best on Mario Kart-Stadion and Wasserpark");
  });
});

describe("product languages", () => {
  it("keeps English and Dutch in the code and sends the others through the catalog", () => {
    setActiveCatalog(german);
    expect(localized("Settings", "Instellingen")).toBe("Settings");
    storage.set("mk8dx.product-language.v1", "nl");
    expect(localized("Settings", "Instellingen")).toBe("Instellingen");
    expect(sourceLanguage()).toBe("nl");
    storage.set("mk8dx.product-language.v1", "de");
    expect(localized("Settings", "Instellingen")).toBe("Einstellungen");
    expect(localized("Untranslated", "Onvertaald")).toBe("Untranslated");
    expect(sourceLanguage()).toBe("en");
    expect(usesProductCatalog()).toBe(true);
    expect(productLocaleTag()).toBe("de-DE");
  });

  it("knows all 15 codes in any case and nothing else", () => {
    expect(parseProductLanguage("ZH-tw")).toBe("zh-TW");
    expect(parseProductLanguage("es-419")).toBe("es-419");
    expect(parseProductLanguage("pt-BR")).toBeNull();
    storage.set("mk8dx.product-language.v1", "xx");
    expect(productLocaleTag()).toBe("en-GB");
  });

  it("loads a catalog and falls back to English when it is missing or wrong", async () => {
    // No catalog file is published for a language in an empty index: English stays.
    expect(await loadProductCatalog("de", async () => new Response("{}"))).toBe(false);
    expect(translateEnglish("Settings")).toBeUndefined();
  });
});

describe("templates that drop a plural placeholder", () => {
  it("never swallow the rest of a joined line", () => {
    setActiveCatalog({
      schemaVersion: "mk8dx.web-message-catalog.v1",
      language: "de",
      messages: { "{0} player{1}": "{0} Spieler", "Final results": "Endergebnisse" },
    });
    expect(translateEnglish("36 players")).toBe("36 Spieler");
    expect(translateEnglish("36 players · 2026-09-11")).toBeUndefined();
    setActiveCatalog(null);
  });
});
