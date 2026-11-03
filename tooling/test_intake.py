"""Synthetic two-line development rehearsal; set MK8DX_INTAKE_TEST_ROOT to a workspace directory."""
import json
import hashlib
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


TOOL = Path(__file__).with_name("intake.py")


class IntakeRehearsal(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="mk8dx-intake-", dir=os.environ.get("MK8DX_INTAKE_TEST_ROOT"))
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        intended_root = Path(os.environ.get("MK8DX_INTAKE_TEST_ROOT", tempfile.gettempdir())).resolve()
        if not self.root.resolve().is_relative_to(intended_root):
            raise RuntimeError("Synthetic test directory escaped its target root")
        self.source = self.root / "upstream"
        self.public = self.root / "public"
        self.state = self.root / "state"
        self.baseline = self.root / "initial"
        for folder in (self.source, self.public, self.baseline):
            (folder / "src").mkdir(parents=True)
        self.mapping = {f"src/{name}": f"src/{name}" for name in ("common.txt", "contract.txt", "client.txt", "old.txt", "migration.sql")}
        for name, value in (("common.txt", "first\n"), ("contract.txt", "v1\n"),
                            ("client.txt", "v1\n"), ("old.txt", "old\n"),
                            ("migration.sql", "CREATE TABLE demo(id INT);\n")):
            for folder in (self.source, self.public, self.baseline):
                (folder / "src" / name).write_text(value, encoding="utf-8")
        (self.public / "Dockerfile").write_text("FROM scratch\n", encoding="utf-8")
        self.policy = {
            "source": str(self.source), "public": str(self.public), "state": str(self.state),
            "policyVersion": "v1", "mapping": self.mapping,
            "scanRoots": ["src"], "deletions": [], "excluded": [],
            "blockedPatterns": ["owner\\.private\\.test"], "replacements": {},
            "commands": [[sys.executable, "-c", "from pathlib import Path; assert Path('src/contract.txt').read_text()==Path('src/client.txt').read_text()"]],
        }
        self.config = self.root / "policy.json"
        self.save_policy()
        subprocess.run(["git", "init", "-q", str(self.public)], check=True)
        subprocess.run(["git", "-C", str(self.public), "config", "user.email", "synthetic@example.test"], check=True)
        subprocess.run(["git", "-C", str(self.public), "config", "user.name", "Synthetic"], check=True)
        self.commit()
        self.run_tool("init", "--baseline-dir", str(self.baseline))

    def save_policy(self):
        self.config.write_text(json.dumps(self.policy), encoding="utf-8")

    def run_tool(self, action, *args, success=True, env=None):
        result = subprocess.run([sys.executable, str(TOOL), action, "--config", str(self.config), *args],
                                capture_output=True, text=True, env={**os.environ, **(env or {})})
        if success:
            self.assertEqual(result.returncode, 0, result.stderr)
            return json.loads(result.stdout)
        self.assertNotEqual(result.returncode, 0, result.stdout)
        return result.stderr

    def commit(self):
        subprocess.run(["git", "-C", str(self.public), "add", "-A"], check=True)
        subprocess.run(["git", "-C", str(self.public), "commit", "-qm", "synthetic checkpoint"], check=True)

    def plan(self):
        return self.run_tool("plan")

    def test_missing_impacted_component_check_blocks_plan(self):
        self.policy["impactRules"] = [{"prefix": "src/common.txt", "components": ["native"]}]
        self.policy["componentCommands"] = {}
        self.save_policy()
        prior_policy = json.loads((self.state / "current.json").read_text())["policy"]
        self.run_tool("migrate-policy", "--baseline-dir", str(self.baseline), "--old-policy-id", prior_policy)
        (self.source / "src/common.txt").write_text("changed\n", encoding="utf-8")
        report = self.plan()
        self.assertEqual(report["status"], "blocked")
        self.assertEqual(report["missingChecks"], ["native"])
        self.run_tool("validate", "--plan-id", report["planId"], success=False)
        self.assertEqual((self.public / "src/common.txt").read_text(), "first\n")

    def test_explicit_conflict_resolution_is_bound_to_bytes(self):
        (self.public / "src/common.txt").write_text("public change\n", encoding="utf-8")
        self.commit()
        (self.source / "src/common.txt").write_text("source change\n", encoding="utf-8")
        blocked = self.plan()
        self.assertEqual(blocked["status"], "blocked")
        directory = self.root / "resolution"
        (directory / "src").mkdir(parents=True)
        content = b"public and source change\n"
        (directory / "src/common.txt").write_bytes(content)
        (directory / "resolutions.json").write_text(json.dumps({"src/common.txt": hashlib.sha256(content).hexdigest()}), encoding="utf-8")
        resolved = self.run_tool("resolve", "--plan-id", blocked["planId"], "--resolution-dir", str(directory))
        self.assertEqual(resolved["status"], "ready")
        self.validate_apply(resolved)
        self.assertEqual((self.public / "src/common.txt").read_bytes(), content)

    def test_several_overlapping_edits_in_one_file_are_one_conflict(self):
        lines = [f"line {n}\n" for n in range(12)]
        (self.source / "src/common.txt").write_text("".join(lines), encoding="utf-8")
        self.validate_apply(self.plan())
        self.commit()
        public, source = list(lines), list(lines)
        public[1], public[10] = "public 1\n", "public 10\n"
        source[1], source[10] = "source 1\n", "source 10\n"
        (self.public / "src/common.txt").write_text("".join(public), encoding="utf-8")
        self.commit()
        (self.source / "src/common.txt").write_text("".join(source), encoding="utf-8")
        report = self.plan()
        self.assertEqual(report["status"], "blocked")
        self.assertEqual(report["conflicts"], ["src/common.txt: overlapping edits"])

    def validate_apply(self, report):
        identifier = report["planId"]
        self.run_tool("validate", "--plan-id", identifier)
        self.run_tool("apply", "--plan-id", identifier)

    def test_sequential_import_conflict_and_preservation(self):
        self.policy["impactRules"] = [
            {"prefix": "src/common.txt", "components": ["api"]},
            {"prefix": "src/contract.txt", "components": ["api", "web"]},
            {"prefix": "src/client.txt", "components": ["web"]},
        ]
        check = [sys.executable, "-c", "from pathlib import Path; assert Path('src/contract.txt').read_text()==Path('src/client.txt').read_text()"]
        self.policy["componentCommands"] = {"api": [check], "web": [check]}
        self.save_policy()
        prior_policy = json.loads((self.state / "current.json").read_text())["policy"]
        self.run_tool("migrate-policy", "--baseline-dir", str(self.baseline), "--old-policy-id", prior_policy)
        initial = json.loads((self.state / "current.json").read_text())["baseline"]
        noop = self.plan()
        self.assertEqual(noop["status"], "noop")
        self.run_tool("apply", "--plan-id", noop["planId"])
        self.assertEqual(json.loads((self.state / "current.json").read_text())["baseline"], initial)

        (self.public / "Dockerfile").write_text("FROM scratch\n# public-only setting\n")
        self.commit()
        (self.source / "src/common.txt").write_text("fixed\n")
        first = self.plan()
        self.assertEqual(first["status"], "ready")
        self.assertEqual(first["components"], ["api"])
        self.validate_apply(first)
        self.assertIn("public-only", (self.public / "Dockerfile").read_text())
        self.commit()

        (self.source / "src/contract.txt").write_text("v2\n")
        incompatible = self.plan()
        self.assertEqual(incompatible["components"], ["api", "web"])
        self.run_tool("validate", "--plan-id", incompatible["planId"], success=False)
        self.assertEqual((self.public / "src/contract.txt").read_text(), "v1\n")
        (self.source / "src/client.txt").write_text("v2\n")
        second = self.plan()
        self.validate_apply(second)
        self.assertEqual((self.public / "src/client.txt").read_text(), "v2\n")
        self.commit()

        (self.public / "src/common.txt").write_text("public fix\n")
        self.commit()
        (self.source / "src/common.txt").write_text("upstream fix\n")
        conflict = self.plan()
        self.assertEqual(conflict["status"], "blocked")
        self.run_tool("apply", "--plan-id", conflict["planId"], success=False)
        self.assertEqual((self.public / "src/common.txt").read_text(), "public fix\n")

    def test_privacy_unknown_path_migration_and_missing_input(self):
        path = self.source / "src/common.txt"
        original = path.read_text()
        for marker in ("PRIVATE_MARKER", "https://owner.private.test/api"):
            path.write_text(marker)
            self.run_tool("plan", success=False)
        path.write_text(original)
        (self.source / "src/unknown.txt").write_text("new")
        self.run_tool("plan", success=False)
        (self.source / "src/unknown.txt").unlink()
        (self.source / "src/migration.sql").write_text("DROP TABLE demo;\n")
        self.assertEqual(self.plan()["status"], "blocked")
        (self.source / "src/migration.sql").write_text("CREATE TABLE demo(id INT);\n")
        path.unlink()
        self.run_tool("plan", success=False)

    def test_deletion_stale_plan_interrupt_and_recovery(self):
        old = self.source / "src/old.txt"
        old.unlink()
        self.policy["deletions"] = ["src/old.txt"]
        self.save_policy()
        self.run_tool("plan", success=False)  # A changed policy requires explicit migration.
        previous = json.loads((self.state / "current.json").read_text())["policy"]
        self.run_tool("migrate-policy", "--baseline-dir", str(self.baseline), "--old-policy-id", previous)
        deletion = self.plan()
        self.validate_apply(deletion)
        self.assertFalse((self.public / "src/old.txt").exists())
        self.commit()

        (self.source / "src/common.txt").write_text("interrupted\n")
        candidate = self.plan()
        self.run_tool("validate", "--plan-id", candidate["planId"])
        original = (self.public / "src/common.txt").read_text()
        self.run_tool("apply", "--plan-id", candidate["planId"], success=False,
                      env={"MK8DX_INTAKE_TEST_INTERRUPT_AFTER": "1"})
        self.assertNotEqual((self.public / "src/common.txt").read_text(), original)
        self.run_tool("recover", "--plan-id", candidate["planId"])
        self.assertEqual((self.public / "src/common.txt").read_text(), original)
        self.validate_apply(candidate)
        self.commit()
        (self.source / "src/common.txt").write_text("next\n")
        stale = self.plan()
        (self.public / "Dockerfile").write_text("FROM scratch\n# newer setting\n")
        self.commit()
        self.run_tool("validate", "--plan-id", stale["planId"], success=False)

    def test_pinned_bytes_with_a_marker_pass_only_when_exactly_pinned(self):
        # A reviewed file that legitimately names a marker (for example a test of the marker check) is admitted by
        # its exact bytes; a later reviewed byte change (re-pinned) must plan, an unpinned change must not.
        marked = "assert scanner.rejects('PRIVATE_MARKER')\r\n"
        for folder in (self.source, self.public, self.baseline):
            (folder / "src/common.txt").write_text(marked, encoding="utf-8", newline="")
        self.commit()
        self.policy["binaryPinned"] = {"src/common.txt": hashlib.sha256(marked.encode()).hexdigest()}
        self.save_policy()
        previous = json.loads((self.state / "current.json").read_text())["policy"]
        self.run_tool("migrate-policy", "--baseline-dir", str(self.baseline), "--old-policy-id", previous)
        relined = marked.replace("\r\n", "\n")
        (self.source / "src/common.txt").write_text(relined, encoding="utf-8", newline="")
        self.run_tool("plan", success=False)  # the pin no longer matches: separate admission required
        self.policy["binaryPinned"] = {"src/common.txt": hashlib.sha256(relined.encode()).hexdigest()}
        self.save_policy()
        previous = json.loads((self.state / "current.json").read_text())["policy"]
        self.run_tool("migrate-policy", "--baseline-dir", str(self.baseline), "--old-policy-id", previous)
        self.assertEqual(self.plan()["status"], "ready")

    def test_new_source_identical_to_public_file_is_already_present(self):
        (self.public / "src/shared.txt").write_text("same\n", encoding="utf-8")
        (self.public / "src/other.txt").write_text("public\n", encoding="utf-8")
        self.commit()
        (self.source / "src/shared.txt").write_text("same\n", encoding="utf-8")
        self.policy["mapping"]["src/shared.txt"] = "src/shared.txt"
        self.policy["policyVersion"] = "v2"
        self.save_policy()
        previous = json.loads((self.state / "current.json").read_text())["policy"]
        self.run_tool("migrate-policy", "--baseline-dir", str(self.baseline), "--old-policy-id", previous)
        report = self.plan()
        self.assertEqual(report["status"], "ready")
        self.assertEqual(report["changes"], [])
        self.validate_apply(report)
        baseline = json.loads((self.state / "current.json").read_text())["baseline"]
        self.assertTrue((self.state / "baselines" / baseline / "src/shared.txt").is_file())

        (self.source / "src/other.txt").write_text("source\n", encoding="utf-8")
        self.policy["mapping"]["src/other.txt"] = "src/other.txt"
        self.policy["policyVersion"] = "v3"
        self.save_policy()
        previous = json.loads((self.state / "current.json").read_text())["policy"]
        self.run_tool("migrate-policy", "--baseline-dir", str(self.state / "baselines" / baseline),
                      "--old-policy-id", previous)
        collision = self.plan()
        self.assertEqual(collision["status"], "blocked")
        self.assertEqual(collision["conflicts"], ["src/other.txt: new source collides with public file"])

    def test_modified_deletion_and_explicit_source_rename(self):
        (self.public / "src/old.txt").write_text("public history\n")
        self.commit()
        (self.source / "src/old.txt").unlink()
        self.policy["deletions"] = ["src/old.txt"]
        self.save_policy()
        old_policy = json.loads((self.state / "current.json").read_text())["policy"]
        self.run_tool("migrate-policy", "--baseline-dir", str(self.baseline), "--old-policy-id", old_policy)
        self.assertEqual(self.plan()["status"], "blocked")
        self.assertEqual((self.public / "src/old.txt").read_text(), "public history\n")

        # A source rename maps the new source name to the existing public name.
        (self.source / "src/renamed.txt").write_text("old\n")
        self.policy["mapping"].pop("src/old.txt")
        self.policy["mapping"]["src/renamed.txt"] = "src/old.txt"
        self.policy["deletions"] = []
        self.policy["policyVersion"] = "v2"
        self.save_policy()
        previous = json.loads((self.state / "current.json").read_text())["policy"]
        self.run_tool("migrate-policy", "--baseline-dir", str(self.baseline), "--old-policy-id", previous)
        self.assertEqual(self.plan()["status"], "noop")
        self.assertEqual((self.public / "src/old.txt").read_text(), "public history\n")

    def test_excluded_path_symlink_case_collision_and_append_only_sql(self):
        (self.source / "src/private.txt").write_text("PRIVATE_MARKER")
        self.policy["excluded"] = ["src/private.txt"]
        self.save_policy()
        previous = json.loads((self.state / "current.json").read_text())["policy"]
        self.run_tool("migrate-policy", "--baseline-dir", str(self.baseline), "--old-policy-id", previous)
        self.assertEqual(self.plan()["status"], "noop")

        self.policy["mapping"]["../escape.txt"] = "src/escape.txt"
        self.save_policy()
        self.run_tool("plan", success=False)
        self.policy["mapping"].pop("../escape.txt")
        self.policy["mapping"]["src/Migration.sql"] = "src/migration.sql"
        self.save_policy()
        self.run_tool("plan", success=False)
        self.policy["mapping"].pop("src/Migration.sql")
        self.save_policy()

        link = self.source / "src/link.txt"
        try:
            link.symlink_to(self.source / "src/common.txt")
        except OSError:
            link = None
        if link is not None:
            self.run_tool("plan", success=False)
            link.unlink()

        (self.source / "src/migration2.sql").write_text("ALTER TABLE demo ADD COLUMN value INT;\n")
        self.policy["mapping"]["src/migration2.sql"] = "src/migration2.sql"
        self.policy["policyVersion"] = "v2"
        self.save_policy()
        previous = json.loads((self.state / "current.json").read_text())["policy"]
        self.run_tool("migrate-policy", "--baseline-dir", str(self.baseline), "--old-policy-id", previous)
        report = self.plan()
        self.assertIn("src/migration2.sql", report["changes"])
        self.validate_apply(report)
        self.assertTrue((self.public / "src/migration2.sql").exists())

    @unittest.skipUnless(os.name == "nt", "Windows junction safety is platform-specific")
    def test_windows_junction_is_rejected_without_following_target(self):
        external = self.root / "external"
        external.mkdir()
        marker = external / "marker.txt"
        marker.write_text("untouched")
        junction = self.source / "src/junction"
        quoted_link = str(junction).replace("'", "''")
        quoted_target = str(external).replace("'", "''")
        result = subprocess.run(["powershell", "-NoProfile", "-Command",
                                 f"$ErrorActionPreference='Stop'; New-Item -ItemType Junction -Path '{quoted_link}' -Target '{quoted_target}' | Out-Null"],
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        try:
            self.run_tool("plan", success=False)
            self.assertEqual(marker.read_text(), "untouched")
        finally:
            junction.rmdir()  # Removes the junction itself, never its target.
        self.assertEqual(marker.read_text(), "untouched")


if __name__ == "__main__":
    unittest.main()
