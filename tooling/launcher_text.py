"""The launcher windows' texts in the 15 game languages (start-mk8dx.ps1/.sh, the No-Docker files, install.py).

English is the key, as in every other product catalog: `t("Checking Python")` returns the text in the chosen
language, `t("Website: {0}", origin)` fills the numbered values after the lookup. Catalogs live in
tooling/launcher_i18n/<language>.json (built by tooling/i18n/build_web_catalogs.mjs from the shared translations;
nl.json from the Dutch in tooling/i18n/launcher/dutch.json). A missing catalog or text stays English.

Language choice, the same in the PowerShell (mk8dx-ui.ps1) and sh (mk8dx-ui.sh) launchers: MK8DX_LANGUAGE when set,
else the operating system's UI language; each matched exactly, then by region (es-MX -> es-419, zh-Hant/TW/HK/MO ->
zh-TW, other zh -> zh-CN, fr-CA), then by base language; English otherwise.

  python tooling/launcher_text.py --language        the chosen language code
  python tooling/launcher_text.py --tsv             "English<TAB>translation" lines for the sh launcher
  python tooling/launcher_text.py "Text {0}" value  one translated text
"""
from __future__ import annotations

import json
import os
import sys
from functools import lru_cache
from pathlib import Path

CATALOGS = Path(__file__).resolve().parent / "launcher_i18n"
LANGUAGES = ("en", "nl", "en-US", "fr", "fr-CA", "de", "es", "es-419", "it", "pt", "ru", "ja", "ko",
             "zh-CN", "zh-TW")
_KNOWN = {code.lower(): code for code in LANGUAGES}


def match(tag: object) -> str | None:
    """One language tag (de-DE, es_MX.UTF-8, zh-Hant-TW, ...) as a product language, else None."""
    if not isinstance(tag, str):
        return None
    tag = tag.strip().split(".")[0].split("@")[0].replace("_", "-").lower()
    parts = tag.split("-")
    if not parts[0] or parts[0] in ("*", "c", "posix"):
        return None
    exact = _KNOWN.get("-".join(parts))
    if exact:
        return exact
    if parts[0] == "zh":
        return "zh-TW" if any(part in ("hant", "tw", "hk", "mo") for part in parts[1:]) else "zh-CN"
    if parts[0] == "es" and len(parts) > 1 and parts[1] != "es":
        return "es-419"
    return _KNOWN.get(parts[0])


def system_tags(environ=os.environ) -> list[str]:
    """The operating system's UI languages, most wanted first."""
    tags = [environ.get(name, "") for name in ("LC_ALL", "LC_MESSAGES", "LANG")]
    tags += environ.get("LANGUAGE", "").split(":")
    if sys.platform == "win32":
        try:
            import ctypes
            import locale
            tags.insert(0, locale.windows_locale.get(ctypes.windll.kernel32.GetUserDefaultUILanguage(), ""))
        except (AttributeError, OSError):
            pass
    return [tag for tag in tags if tag]


def choose(environ=os.environ, tags: list[str] | None = None) -> str:
    explicit = match(environ.get("MK8DX_LANGUAGE", ""))
    if explicit:
        return explicit
    for tag in system_tags(environ) if tags is None else tags:
        found = match(tag)
        if found:
            return found
    return "en"


@lru_cache(maxsize=16)
def messages(code: str) -> dict[str, str]:
    if code == "en":
        return {}
    try:
        document = json.loads((CATALOGS / f"{code}.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return {key: value for key, value in (document.get("messages") or {}).items()
            if isinstance(value, str) and value.strip()}


def fill(template: str, values) -> str:
    for index, value in enumerate(values):
        template = template.replace("{%d}" % index, str(value))
    return template


def t(english: str, *values, language: str | None = None) -> str:
    code = language or choose()
    return fill(messages(code).get(english, english), values)


def utf8_output() -> None:
    """Print CJK/Cyrillic text safely: a redirected stream on Windows would otherwise use the ANSI code page."""
    for stream in (sys.stdout, sys.stderr):
        try:
            if stream.encoding.lower().replace("-", "") != "utf8":
                stream.reconfigure(errors="replace")
        except (AttributeError, ValueError):
            pass


def main(argv: list[str]) -> int:
    utf8_output()
    code = choose()
    if argv[:1] == ["--language"]:
        print(code)
    elif argv[:1] == ["--tsv"]:
        # UTF-8 bytes with LF only (Windows text mode would add CR): the sh launcher reads them with awk.
        sys.stdout.flush()
        for english, text in sorted(messages(code).items()):
            if "\t" not in english + text and "\n" not in english + text:
                sys.stdout.buffer.write(f"{english}\t{text}\n".encode("utf-8"))
        sys.stdout.buffer.flush()
    elif argv:
        print(t(argv[0], *argv[1:], language=code))
    else:
        print(__doc__)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
