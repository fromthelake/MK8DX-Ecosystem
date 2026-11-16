import { afterEach, describe, expect, it, vi } from "vitest";

import {
  adoptBrowserLanguages,
  browserProductLanguage,
  matchBrowserLanguage,
  productLanguage,
} from "../src/product-language.js";

function storage(saved: string | null) {
  return { getItem: () => saved, setItem: vi.fn(), removeItem: vi.fn() };
}

describe("the product language without an explicit choice", () => {
  afterEach(() => {
    adoptBrowserLanguages([]);
    vi.unstubAllGlobals();
  });

  it("follows the browser's languages, most wanted first", () => {
    vi.stubGlobal("localStorage", storage(null));
    expect(adoptBrowserLanguages(["nl-NL", "en-US"])).toBe("nl");
    expect(productLanguage()).toBe("nl");
    expect(adoptBrowserLanguages(["xx", "de-AT", "nl"])).toBe("de");
    expect(adoptBrowserLanguages(["en-US"])).toBe("en-US");
    expect(adoptBrowserLanguages(["en-GB"])).toBe("en");
    expect(adoptBrowserLanguages([])).toBe("en");
  });

  it("keeps an explicit choice and stores nothing for the browser default", () => {
    const saved = storage("en");
    vi.stubGlobal("localStorage", saved);
    expect(adoptBrowserLanguages(["nl-NL"])).toBe("en");
    expect(productLanguage()).toBe("en");
    expect(saved.setItem).not.toHaveBeenCalled();
    vi.stubGlobal("localStorage", storage("ja"));
    expect(productLanguage()).toBe("ja");
  });

  it("matches regions like the A2 pages' language.js", () => {
    expect(matchBrowserLanguage("es-MX")).toBe("es-419");
    expect(matchBrowserLanguage("es-ES")).toBe("es");
    expect(matchBrowserLanguage("zh-Hant-HK")).toBe("zh-TW");
    expect(matchBrowserLanguage("zh")).toBe("zh-CN");
    expect(matchBrowserLanguage("fr_CA")).toBe("fr-CA");
    expect(matchBrowserLanguage("pt-BR")).toBe("pt");
    expect(matchBrowserLanguage("*")).toBeNull();
    expect(matchBrowserLanguage(42)).toBeNull();
    expect(browserProductLanguage(["", "sv-SE"])).toBe("en");
  });

  it("falls back to the browser when storage is refused", () => {
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("blocked"); } });
    adoptBrowserLanguages(["nl"]);
    expect(productLanguage()).toBe("nl");
  });
});
