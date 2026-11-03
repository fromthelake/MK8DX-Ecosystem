"""Validate the component registry and reject forbidden source imports."""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
IMPORT = re.compile(r"(?:\bfrom\s*|\bimport\s*\(|\brequire\s*\()\s*['\"]([^'\"]+)['\"]")
SOURCE_SUFFIXES = {".ts", ".tsx", ".js", ".mjs", ".kt", ".py"}


def forbidden(source: str, reference: str) -> bool:
    web = source.startswith("apps/timetrials-web/")
    api = source.startswith("backend/api/")
    shared = source.startswith("packages/")
    if (web or shared) and ("backend/api/" in reference or reference.startswith("@mk8dx/api")):
        return True
    if (api or shared) and "apps/timetrials-web/" in reference:
        return True
    if shared and ("apps/" in reference or "infrastructure/" in reference):
        return True
    return False


def main() -> None:
    data = json.loads((ROOT / "component-registry.json").read_text(encoding="utf-8"))
    components = data["components"]
    ids = {item["id"] for item in components}
    if len(ids) != len(components):
        raise SystemExit("duplicate component ID")
    for item in components:
        if not set(item["dependencies"]) <= ids or item["id"] in item["dependencies"]:
            raise SystemExit(f"invalid dependency in {item['id']}")
        for path in item["paths"]:
            if not (ROOT / path).is_dir():
                raise SystemExit(f"missing component path: {path}")
    graph = {item["id"]: item["dependencies"] for item in components}
    graph_lines = ["# Component dependency graph", "", "Generated from `component-registry.json`; `python tooling/check_boundaries.py` verifies this view.", "", "```mermaid", "graph LR"]
    graph_lines.extend(f"    {name.replace('-', '_')}[{name}]" for name in sorted(ids))
    graph_lines.extend(
        f"    {name.replace('-', '_')} --> {dependency.replace('-', '_')}"
        for name in sorted(graph) for dependency in sorted(graph[name])
    )
    graph_lines.append("```")
    graph_document = "\n".join(graph_lines) + "\n"
    if (ROOT / "docs/architecture/COMPONENT_GRAPH.md").read_text(encoding="utf-8") != graph_document:
        raise SystemExit("component graph document is out of sync with registry")
    for item in components:
        expected = {other["id"] for other in components if item["id"] in other["dependencies"]}
        if set(item["reverseConsumers"]) != expected:
            raise SystemExit(f"reverse consumers are out of sync for {item['id']}")
    compatibility = json.loads((ROOT / "compatibility.json").read_text(encoding="utf-8"))
    migration = json.loads((ROOT / "infrastructure/mysql/migration-catalog-v1.json").read_text(encoding="utf-8"))
    if compatibility["databaseMigration"] != migration["migrations"][-1]["version"]:
        raise SystemExit("compatibility migration level is out of sync")
    visiting, visited = set(), set()

    def visit(name: str) -> None:
        if name in visiting:
            raise SystemExit(f"component cycle at {name}")
        if name in visited:
            return
        visiting.add(name)
        for dependency in graph[name]:
            visit(dependency)
        visiting.remove(name)
        visited.add(name)

    for name in ids:
        visit(name)
    violations = []
    checked = 0
    for item in components:
        for directory in item["paths"]:
            for path in (ROOT / directory).rglob("*"):
                if not path.is_file() or path.suffix not in SOURCE_SUFFIXES or any(
                    part in {"node_modules", "dist", "build", ".gradle", "__pycache__"} for part in path.parts
                ):
                    continue
                relative = path.relative_to(ROOT).as_posix()
                checked += 1
                for reference in IMPORT.findall(path.read_text(encoding="utf-8", errors="replace")):
                    if forbidden(relative, reference):
                        violations.append(f"{relative}: forbidden import")
    if not forbidden("apps/timetrials-web/src/example.ts", "../../../backend/api/src/private"):
        raise SystemExit("negative boundary fixture was accepted")
    print(f"component boundaries: components={len(ids)}, source_files={checked}, violations={len(violations)}")
    if violations:
        raise SystemExit("\n".join(violations[:20]))


if __name__ == "__main__":
    main()
