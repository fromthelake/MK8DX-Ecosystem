"""MK8DX beheer "Add a phone or device": the step machine, the sign-in card's expiry, the card state and the
printable welcome card."""
from __future__ import annotations

import http.client
import json
import re
import shutil
import subprocess
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

from tooling import setup_wizard

ROOT = Path(__file__).resolve().parents[2]
STATIC = ROOT / "tooling" / "setup_wizard_static"
CARD = "offline_invitation.12345678-1234-1234-1234-123456789abc"


def run_node(body: str):
    """Runs `body` with MK8DXAddDevice loaded; `body` prints one JSON value."""
    script = (STATIC / "add-device.js").read_text(encoding="utf-8") + "\nconst D = globalThis.MK8DXAddDevice;\n" + body
    result = subprocess.run(["node", "-e", script], capture_output=True, text=True, check=True, timeout=30)
    return json.loads(result.stdout)


@unittest.skipUnless(shutil.which("node"), "needs Node.js")
class StepMachineTest(unittest.TestCase):
    def test_prepare_signin_done_and_back(self):
        out = run_node("""
const person = { accountKey: "offline_account.a", name: "Sam", role: "account" };
const seen = [];
let s = D.start(person); seen.push([s.step, s.wanted]);
s = D.step(s, { type: "next" }, 0); seen.push([s.step, s.wanted]);          // a card is wanted
const card = { invitationId: "x", expiresAtMs: 900000, qr: "data:image/png;base64,AA", url: "u" };
s = D.step(s, { type: "card", card }, 0); seen.push([s.step, s.cardState, s.wanted, D.polling(s)]);
s = D.step(s, { type: "status", state: "open" }, 1000); seen.push([s.step, s.cardState]);
s = D.step(s, { type: "back" }, 1000); seen.push([s.step, s.card === card]);  // back keeps the valid card
s = D.step(s, { type: "next" }, 2000); seen.push([s.step, s.wanted]);        // ... and reuses it
s = D.step(s, { type: "status", state: "used" }, 3000); seen.push([s.step, s.cardState, D.polling(s)]);
s = D.step(s, { type: "next" }, 3000); seen.push([s.step]);
let e = D.step(D.start(person), { type: "back" }, 0); seen.push([e.step]);
console.log(JSON.stringify(seen));
""")
        self.assertEqual(out, [["prepare", False], ["signin", True], ["signin", "open", False, True],
                               ["signin", "open"], ["prepare", True], ["signin", False],
                               ["done", "used", False], ["exit"], ["exit"]])

    def test_expiry_revocation_new_card_and_an_older_host(self):
        out = run_node("""
const person = { accountKey: "k", name: "Sam", role: "account" };
const card = { invitationId: "x", expiresAtMs: 60000 };
let s = D.step(D.step(D.start(person), { type: "next" }, 0), { type: "card", card }, 0);
const seen = [];
seen.push(D.step(s, { type: "tick" }, 59999).cardState);
const expired = D.step(s, { type: "tick" }, 60000); seen.push(expired.cardState, D.polling(expired));
seen.push(D.step(s, { type: "status", state: "revoked" }, 1).cardState);
seen.push(D.step(s, { type: "status", state: "nonsense" }, 1).cardState);
const fresh = D.step(expired, { type: "new" }, 61000); seen.push(fresh.card, fresh.wanted, fresh.cardState);
const old = D.step(s, { type: "status", state: "unsupported" }, 1); seen.push(old.cardState, D.polling(old));
seen.push(D.step(old, { type: "confirm" }, 1).step);
// a used state for a card no longer on screen changes nothing
seen.push(D.step(fresh, { type: "status", state: "used" }, 1).step);
// a card made earlier is reused only with at least 30 seconds left
seen.push(D.usable(card, 29999), D.usable(card, 30001));
console.log(JSON.stringify(seen));
""")
        self.assertEqual(out, ["open", "expired", False, "revoked", "open", None, True, None, "unsupported", False,
                               "done", "signin", True, False])

    def test_countdown_and_short_code(self):
        out = run_node("""
console.log(JSON.stringify([D.remaining({ expiresAtMs: 900000 }, 0), D.remaining({ expiresAtMs: 900000 }, 899001),
  D.remaining({ expiresAtMs: 1000 }, 5000), D.shortCode("ab12cd34ef56ab78" + "0".repeat(48)), D.shortCode("short")]));
""")
        self.assertEqual(out, ["15:00", "0:01", "0:00", "AB12 CD34 EF56 AB78", ""])


@unittest.skipUnless(shutil.which("node"), "needs Node.js")
class WelcomeCardTest(unittest.TestCase):
    TEXTS = {"welcomeCardTitle": "Welcome to MK8DX, {name}!", "welcomeStep1": "Trust", "welcomeStep1Text": "Scan this.",
             "welcomeCode": "Check code", "welcomeStep2": "Scan the sign-in card",
             "welcomeStep2Text": "Signed in as {name}.", "welcomePersonal": "PERSONAL: only for {name}, works once",
             "welcomeExpires": "Valid until {until}", "welcomeNoCard": "Ask the administrator",
             "welcomeStep3": "Done", "welcomeStep3Text": "You are {name}."}

    def sheet(self, card, card_state, now, fmt):
        setup = {"origin": "https://192.168.1.50", "setupUrl": "http://192.168.1.50/setup", "qr": "data:trust",
                 "fingerprint": "ab" * 32}
        return run_node(f"""
console.log(JSON.stringify(D.sheet({{ person: {{ name: "Sam" }}, setup: {json.dumps(setup)},
  card: {json.dumps(card)}, cardState: {json.dumps(card_state)}, now: {now}, texts: {json.dumps(self.TEXTS)},
  format: {json.dumps(fmt)} }})));
""")

    def test_three_numbered_steps_both_codes_and_the_address(self):
        model = self.sheet({"qr": "data:personal", "expiresAtMs": 900000}, "open", 1000, "a6")
        self.assertEqual(model["format"], "a6")
        self.assertEqual(model["title"], "Welcome to MK8DX, Sam!")
        self.assertEqual(model["address"], "https://192.168.1.50")
        self.assertEqual([s["number"] for s in model["steps"]], [1, 2, 3])
        trust, signin, done = model["steps"]
        self.assertEqual((trust["qr"], trust["code"]), ("data:trust", "ABAB ABAB ABAB ABAB"))
        self.assertEqual(signin["qr"], "data:personal")
        self.assertTrue(signin["personal"])
        self.assertEqual(signin["mark"], "PERSONAL: only for Sam, works once")
        self.assertEqual(signin["expiry"], "Valid until {until}")
        self.assertEqual(model["until"], 900000)
        self.assertEqual(done["text"], "You are Sam.")

    def test_a_dead_card_is_never_printed(self):
        for card, state, now in (({"qr": "data:personal", "expiresAtMs": 900000}, "open", 900000),
                                 ({"qr": "data:personal", "expiresAtMs": 900000}, "used", 1000),
                                 ({"qr": "data:personal", "expiresAtMs": 900000}, "revoked", 1000),
                                 (None, None, 1000)):
            with self.subTest(state=state, now=now):
                model = self.sheet(card, state, now, "a4")
                self.assertEqual(model["format"], "a4")
                self.assertIsNone(model["steps"][1]["qr"])
                self.assertEqual(model["steps"][1]["expiry"], "Ask the administrator")
                self.assertIsNone(model["until"])
                self.assertEqual(model["steps"][0]["qr"], "data:trust")  # the trust half stays printable

    def test_print_css_has_a6_and_a4_pages_and_hides_the_wizard(self):
        css = (STATIC / "wizard.css").read_text(encoding="utf-8")
        self.assertRegex(css, r"@page welcome-a6 \{ size: A6;")
        self.assertRegex(css, r"@page welcome-a4 \{ size: A4;")
        self.assertIn("body.print-welcome .frame { display: none; }", css)
        self.assertRegex(css, r"\.welcome-sheet\.a6 \{ page: welcome-a6;")
        script = (STATIC / "wizard.js").read_text(encoding="utf-8")
        # Text only through textContent; no inline style (the wizard's CSP is style-src 'self').
        self.assertNotIn(".style.", script)
        self.assertNotIn("innerHTML", script)


class CardStateTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.wizard = setup_wizard.Wizard(Path(self.tmp.name) / "state", qa_candidate=True)

    def tearDown(self):
        self.tmp.cleanup()

    def test_card_state_answers_only_known_states(self):
        for status, payload, expected in ((200, {"state": "used"}, {"state": "used"}),
                                          (200, {"state": "open"}, {"state": "open"}),
                                          (404, {"message": "Route not found"}, {"state": "unsupported"})):
            with self.subTest(status=status, payload=payload), \
                    patch.object(self.wizard, "host_call", return_value=(status, payload)) as call:
                self.assertEqual(self.wizard.card_state(CARD), expected)
                call.assert_called_once_with("POST", "/api/invitations/status", {"invitationId": CARD})
        for status, payload in ((200, {"state": "hacked"}), (404, {"code": "invitation_unavailable"}), (429, {}),
                                (500, {})):
            with self.subTest(status=status, payload=payload), \
                    patch.object(self.wizard, "host_call", return_value=(status, payload)):
                with self.assertRaises(RuntimeError):
                    self.wizard.card_state(CARD)

    def test_card_state_refuses_anything_but_a_card_id(self):
        with patch.object(self.wizard, "host_call") as call:
            for bad in ("", "offline_account.12345678-1234-1234-1234-123456789abc", CARD + "/../x", "x" * 80):
                with self.subTest(bad=bad), self.assertRaises(ValueError):
                    self.wizard.card_state(bad)
            call.assert_not_called()

    def test_a_new_card_carries_its_expiry_and_a_refusal_is_an_error(self):
        made = {"qrDataUrl": "data:qr", "invitationUrl": "https://192.168.1.50/offline-invite#token=x",
                "expiresAtMs": 1_900_000_900_000, "invitationId": CARD}
        with patch.object(self.wizard, "host_call", return_value=(200, made)) as call:
            card = self.wizard.card("offline_account.a", "account")
        call.assert_called_once_with("POST", "/api/invitations", {"accountKey": "offline_account.a", "role": "account"})
        self.assertEqual(card, {"qr": "data:qr", "url": made["invitationUrl"], "expiresAtMs": 1_900_000_900_000,
                                "invitationId": CARD})
        with patch.object(self.wizard, "host_call", return_value=(404, {"code": "invitation_unavailable"})):
            with self.assertRaises(RuntimeError):
                self.wizard.card("offline_account.a", "account")


class WizardRouteTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.wizard = setup_wizard.Wizard(Path(self.tmp.name) / "state", qa_candidate=True)
        self.server = setup_wizard.ThreadingHTTPServer(("127.0.0.1", 0), None)
        self.host = f"127.0.0.1:{self.server.server_port}"
        self.server.RequestHandlerClass = setup_wizard.make_handler(self.wizard, "token-1", self.host)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.tmp.cleanup()

    def request(self, method, path, headers, body=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=5)
        try:
            connection.request(method, path, body=body, headers=headers)
            response = connection.getresponse()
            return response.status, response.read()
        finally:
            connection.close()

    def test_status_route_needs_the_secret_and_same_origin(self):
        headers = {"Host": self.host, "X-MK8DX-Wizard": "token-1", "Content-Type": "application/json"}
        body = json.dumps({"invitationId": CARD}).encode()
        self.assertEqual(self.request("POST", "/api/card/status", headers, body)[0], 403)  # no Origin
        with patch.object(self.wizard, "card_state", return_value={"state": "used"}) as state:
            status, raw = self.request("POST", "/api/card/status", {**headers, "Origin": f"http://{self.host}"}, body)
        self.assertEqual((status, json.loads(raw)), (200, {"state": "used"}))
        state.assert_called_once_with(CARD)

    def test_the_step_script_is_served_and_loaded_before_the_wizard(self):
        status, raw = self.request("GET", "/add-device.js", {"Host": self.host})
        self.assertEqual(status, 200)
        self.assertIn(b"MK8DXAddDevice", raw)
        page = (STATIC / "index.html").read_text(encoding="utf-8")
        self.assertLess(page.index("/add-device.js"), page.index("/wizard.js"))
        bundle = (ROOT / "tooling" / "release" / "host_bundle.py").read_text(encoding="utf-8")
        self.assertIn('"tooling/setup_wizard_static/add-device.js"', bundle)

    def test_every_new_text_exists_in_english_and_dutch(self):
        script = (STATIC / "wizard.js").read_text(encoding="utf-8")
        for key in ("addDevice", "devStep1", "devStep2", "devStep3", "devLeft", "printWelcome", "printNote",
                    "welcomeCardTitle", "welcomePersonal", "welcomeExpires", "welcomeNoCard"):
            with self.subTest(key=key):
                self.assertEqual(len(re.findall(rf"\b{key}: \"", script)), 2)


if __name__ == "__main__":
    unittest.main()
