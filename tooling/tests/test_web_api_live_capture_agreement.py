"""The Director's web view and the API must agree on the capture-delegation documents (security finding F05).

The web client parses these documents strictly: a key the API adds or drops makes the parser refuse the whole
list, and the Director sees "Capture delegations could not be loaded". Both sides' unit tests write their own
fixtures, so only a source-level comparison across the boundary catches that drift.
"""
from __future__ import annotations

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
API = ROOT / "backend" / "api" / "src" / "tournaments" / "tournament-connected-routes.ts"
SERVICE = ROOT / "backend" / "api" / "src" / "tournaments" / "tournament-connected-service.ts"
WEB = ROOT / "apps" / "timetrials-web" / "src" / "tournament-incoming-client.ts"
REPOSITORY = ROOT / "backend" / "api" / "src" / "tournaments" / "mysql-tournament-connected-repository.ts"
ANDROID = (ROOT / "apps" / "timetrials-android" / "app" / "src" / "main" / "java" / "nl" / "mariokart8" /
           "mk8dxtimetrials" / "tournament" / "AndroidTournamentClient.kt")


def _names(block: str) -> list[str]:
    return re.findall(r'"([A-Za-z0-9_]+)"', block)


def _schema_required(source: str, name: str) -> list[str]:
    start = source.index(f"const {name} = {{")
    block = source[start:source.index("} as const;", start)]
    match = re.search(r"required:\s*\[(.*?)\]", block, re.DOTALL)
    assert match is not None, f"{name} declares no required list"
    return _names(match.group(1))


def _exact_keys(source: str, function: str) -> list[str]:
    start = source.index(f"function {function}(")
    match = re.search(r"exact\([A-Za-z0-9_]+,\s*\[(.*?)\]\)", source[start:], re.DOTALL)
    assert match is not None, f"{function} has no exact() guard"
    return _names(match.group(1))


def _interface_fields(source: str, name: str) -> list[str]:
    start = source.index(f"export interface {name} {{")
    block = source[start:source.index("\n}", start)]
    return re.findall(r"^\s+([A-Za-z0-9_]+)\??:", block, re.MULTILINE)


class LiveCaptureDelegationAgreement(unittest.TestCase):
    def test_the_web_parser_accepts_exactly_what_the_api_serves(self) -> None:
        served = _schema_required(API.read_text(encoding="utf-8"), "liveCaptureDelegationSchema")
        parsed = _exact_keys(WEB.read_text(encoding="utf-8"), "liveCaptureDelegation")
        self.assertEqual(sorted(served), sorted(parsed),
                         "the capture-delegation document drifted between the API schema and the web parser")

    def test_the_schema_serves_every_field_the_service_returns(self) -> None:
        # The response schema drops properties it does not name; a new service field must be served on purpose.
        served = _schema_required(API.read_text(encoding="utf-8"), "liveCaptureDelegationSchema")
        fields = _interface_fields(SERVICE.read_text(encoding="utf-8"), "TournamentLiveCaptureDelegation")
        self.assertEqual(sorted(served), sorted(fields))

    def test_the_envelopes_agree(self) -> None:
        api = API.read_text(encoding="utf-8")
        web = WEB.read_text(encoding="utf-8")
        self.assertEqual(_schema_required(api, "liveCaptureDelegationListSchema"), ["delegations"])
        self.assertEqual(_schema_required(api, "liveCaptureDelegationDocumentSchema"), ["delegation"])
        self.assertIn('exact(body, ["delegations"])', web)
        self.assertEqual(web.count('exact(body, ["delegation"])'), 2)



class LiveAssociationAgreement(unittest.TestCase):
    """The evidence record's `live` object: the service type, the repository mapping, the web and the app."""

    def test_every_side_names_the_same_keys(self) -> None:
        fields = _interface_fields(SERVICE.read_text(encoding="utf-8"), "TournamentLiveAssociation")
        self.assertIn("withdrawnAtMs", fields)
        repository = REPOSITORY.read_text(encoding="utf-8")
        start = repository.index("const live = row.live_status")
        mapped = re.findall(r"^\s+([A-Za-z0-9_]+):", repository[start:repository.index("};", start)], re.MULTILINE)
        self.assertEqual(sorted(fields), sorted(mapped), "the repository does not map every live field")
        web = WEB.read_text(encoding="utf-8")
        match = re.search(r"exact\(liveRow,\s*\[(.*?)\]", web, re.DOTALL)
        assert match is not None, "the web parser reads the live association without an exact() guard"
        self.assertEqual(sorted(fields), sorted(_names(match.group(1))))
        android = ANDROID.read_text(encoding="utf-8")
        keys = re.search(r"ANDROID_LIVE_ASSOCIATION_KEYS =\s*setOf\((.*?)\)", android, re.DOTALL)
        assert keys is not None
        self.assertEqual(sorted(fields), sorted(_names(keys.group(1))))
        block = android[android.index("data class AndroidTournamentLiveAssociation("):]
        declared = re.findall(r"^\s+val ([A-Za-z0-9_]+):", block[:block.index("\n)")], re.MULTILINE)
        self.assertEqual(sorted(fields), sorted(declared))


if __name__ == "__main__":
    unittest.main()
