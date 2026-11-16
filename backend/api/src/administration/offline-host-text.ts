/**
 * The unlock texts of the technical host page (127.0.0.1:<host port>) in the 15 languages of the game.
 * English and Dutch are written here; tooling/i18n/extract_a2_messages.py reads this SOURCE table and
 * tooling/i18n/build_web_catalogs.mjs writes the other 13 into offline-host-text.generated.ts. A text a
 * catalog lacks stays English.
 */
import { HOST_CATALOGS } from "./offline-host-text.generated.js";

const SOURCE = {
  nl: {
    accessTitle: "Gebruik de snelkoppeling 'MK8DX beheer'",
    accessHint: "Om mensen toe te voegen, inlogkaarten te maken of een telefoon toe te voegen: dubbelklik op 'MK8DX beheer' op het bureaublad van deze computer. Dat opent MK8DX beheer meteen, zonder code.",
    accessNoShortcut: "Geen snelkoppeling? Start Start-MK8DX-LAN.cmd (Windows) of tooling/start-mk8dx.sh (Linux, macOS) in de MK8DX-map; dat opent hetzelfde scherm.",
    accessExpert: "Dit is de technische hostpagina. Ze vraagt een eenmalige beheercode die alleen een beheeropdracht op deze computer maakt; die heb je normaal nooit nodig.",
    codeLabel: "Eenmalige beheercode (niet de certificaatvingerafdruk)",
    unlock: "Ontgrendelen", unlocked: "Ontgrendeld.", invalid: "De code is ongeldig of verlopen.",
  },
  en: {
    accessTitle: "Use the 'MK8DX beheer' shortcut",
    accessHint: "To add people, make sign-in cards or add a phone: double-click 'MK8DX beheer' on this computer's desktop. It opens MK8DX beheer straight away, without a code.",
    accessNoShortcut: "No shortcut? Start Start-MK8DX-LAN.cmd (Windows) or tooling/start-mk8dx.sh (Linux, macOS) in the MK8DX folder; it opens the same screen.",
    accessExpert: "This is the technical host page. It asks for a one-time admin code that only an operator command on this computer makes; you normally never need it.",
    codeLabel: "One-time admin code (not the certificate fingerprint)",
    unlock: "Unlock", unlocked: "Unlocked.", invalid: "The code is invalid or expired.",
  },
};

export type HostAccessText = Readonly<Record<keyof typeof SOURCE.en, string>>;
export const HOST_TEXT_NL: HostAccessText = SOURCE.nl;
export const HOST_LANGUAGES = ["en", "nl", "en-US", "fr", "fr-CA", "de", "es", "es-419", "it", "pt", "ru",
  "ja", "ko", "zh-CN", "zh-TW"] as const;

/** Language -> the access texts (plus `lang`), English for any text a catalog lacks. */
export function hostAccessTexts(): Readonly<Record<string, HostAccessText & { lang: string }>> {
  const out: Record<string, HostAccessText & { lang: string }> = {};
  for (const language of HOST_LANGUAGES) {
    if (language === "nl") { out[language] = { ...SOURCE.nl, lang: language }; continue; }
    const catalog: Readonly<Record<string, string>> = HOST_CATALOGS[language] ?? {};
    const texts = Object.fromEntries(Object.entries(SOURCE.en).map(([key, english]) => {
      const translated = catalog[english];
      return [key, typeof translated === "string" && translated.trim() ? translated : english];
    })) as HostAccessText;
    out[language] = { ...texts, lang: language };
  }
  return out;
}
