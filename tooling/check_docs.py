"""Documentation drift check.

1. Every relative link in the tracked Markdown documentation points to an existing file, and a `#fragment`
   into a Markdown file names one of its headings (GitHub's heading anchors).
2. A stated number of database migrations ("82 migrations", "82 migraties") matches the migration catalog.

    python tooling/check_docs.py
"""
import json
import re
import subprocess
import sys
from pathlib import Path
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parent.parent
# Documentation written for readers; component READMEs and generated material are outside this check.
DOC_GLOBS = ("*.md", "docs/**/*.md", "docs/install/*.txt", ".github/**/*.md", "tooling/README.md")
LINK = re.compile(r"(?<!!)\[[^\]]*\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)")
FENCE = re.compile(r"^(```|~~~)")
MIGRATION_COUNT = re.compile(r"\b(\d+)\s+(?:applied\s+)?(?:migrations|migraties)\b", re.IGNORECASE)


def tracked(patterns):
    result = subprocess.run(["git", "ls-files", "--", *patterns], cwd=ROOT, check=True,
                            capture_output=True, text=True)
    return [ROOT / line for line in result.stdout.splitlines() if line]


def slug(heading):
    text = re.sub(r"[`*_]|\[([^\]]*)\]\([^)]*\)", lambda m: m.group(1) or "", heading.strip().lower())
    text = re.sub(r"[^\w\- ]", "", text, flags=re.UNICODE)
    return text.replace(" ", "-")


def anchors(path):
    found, counts, fenced = set(), {}, False
    for line in path.read_text(encoding="utf-8").splitlines():
        if FENCE.match(line.strip()):
            fenced = not fenced
            continue
        match = None if fenced else re.match(r"^#{1,6}\s+(.*?)\s*#*\s*$", line)
        if match:
            base = slug(match.group(1))
            number = counts.get(base, 0)
            counts[base] = number + 1
            found.add(base if number == 0 else f"{base}-{number}")
    return found


def links(path):
    fenced = False
    for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if FENCE.match(line.strip()):
            fenced = not fenced
            continue
        if not fenced:
            for match in LINK.finditer(re.sub(r"`[^`]*`", "", line)):
                yield number, match.group(1)


def main():
    findings = []
    catalog = json.loads((ROOT / "infrastructure/mysql/migration-catalog-v1.json").read_text(encoding="utf-8"))
    migration_count = len(catalog["migrations"])
    for path in tracked(DOC_GLOBS):
        relative = path.relative_to(ROOT).as_posix()
        text = path.read_text(encoding="utf-8")
        # The changelog and the audit record past states; they keep their historical numbers.
        historical = relative == "CHANGELOG.md" or relative.startswith("docs/audits/")
        for match in ([] if historical else MIGRATION_COUNT.finditer(text)):
            if int(match.group(1)) != migration_count:
                findings.append(f"{relative}: says {match.group(0)!r}; the catalog has {migration_count}")
        if path.suffix != ".md":
            continue
        for number, target in links(path):
            if re.match(r"^[a-z][a-z0-9+.-]*:", target, re.IGNORECASE):
                continue
            file_part, _, fragment = target.partition("#")
            destination = (path.parent / unquote(file_part)).resolve() if file_part else path
            if not destination.exists():
                findings.append(f"{relative}:{number}: missing link target {target}")
            elif fragment and destination.suffix == ".md" and destination.is_file():
                if unquote(fragment).lower() not in anchors(destination):
                    findings.append(f"{relative}:{number}: no heading for #{fragment} in {destination.relative_to(ROOT).as_posix()}")
    print(f"documentation check: migrations={migration_count}, findings={len(findings)}")
    for finding in findings:
        print(finding, file=sys.stderr)
    if findings:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
