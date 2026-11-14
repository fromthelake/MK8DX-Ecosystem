"use strict";
// The 15 languages of the game, chosen like the website and the guide: a saved or explicit choice first,
// then the browser's languages in order, each matched exactly, then by region (es-MX -> es-419,
// zh-Hant/TW/HK/MO -> zh-TW, other zh -> zh-CN), then by base language; English otherwise.
// One file, two copies: tooling/setup_wizard_static/language.js (the wizard; the /setup page inlines it)
// and infrastructure/docker/offline-invite/language.js (the invitation page). A test keeps them identical.
(function (root) {
  const LANGUAGES = [
    ["en", "English (UK)"], ["nl", "Nederlands"], ["en-US", "English (US)"], ["fr", "Français"],
    ["fr-CA", "Français (Canada)"], ["de", "Deutsch"], ["es", "Español (España)"],
    ["es-419", "Español (Latinoamérica)"], ["it", "Italiano"], ["pt", "Português"], ["ru", "Русский"],
    ["ja", "日本語"], ["ko", "한국어"], ["zh-CN", "简体中文"], ["zh-TW", "繁體中文"],
  ];
  const KNOWN = new Map(LANGUAGES.map(([code]) => [code.toLowerCase(), code]));
  const STORAGE_KEY = "mk8dx.product-language.v1";

  function match(tag) {
    if (typeof tag !== "string") return null;
    const parts = tag.trim().replace(/_/g, "-").toLowerCase().split("-");
    if (!parts[0] || parts[0] === "*") return null;
    const exact = KNOWN.get(parts.join("-"));
    if (exact) return exact;
    if (parts[0] === "zh") {
      return parts.slice(1).some((part) => ["hant", "tw", "hk", "mo"].includes(part)) ? "zh-TW" : "zh-CN";
    }
    if (parts[0] === "es" && parts.length > 1 && parts[1] !== "es") return "es-419";
    return KNOWN.get(parts[0]) || null;
  }

  // saved: an explicit choice (exact code only); preferred: the browser's languages, most wanted first.
  function choose(saved, preferred) {
    const explicit = typeof saved === "string" ? KNOWN.get(saved.trim().toLowerCase()) : null;
    if (explicit) return explicit;
    for (const tag of preferred || []) {
      const found = match(tag);
      if (found) return found;
    }
    return "en";
  }

  function saved() {
    try { return root.localStorage ? root.localStorage.getItem(STORAGE_KEY) : null; } catch { return null; }
  }

  function save(code) {
    try { if (root.localStorage) root.localStorage.setItem(STORAGE_KEY, code); } catch { /* storage refused */ }
  }

  function browser() {
    const nav = root.navigator;
    if (!nav) return [];
    return nav.languages && nav.languages.length ? Array.from(nav.languages) : [nav.language || ""];
  }

  root.MK8DXLanguage = { LANGUAGES, match, choose, saved, save, browser };
})(typeof globalThis !== "undefined" ? globalThis : this);
