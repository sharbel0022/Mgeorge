"""Safety and orchestration tests, independent of bank/Gmail/Sites services."""
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "codex_24h.py"
spec = importlib.util.spec_from_file_location("codex_24h", SCRIPT)
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class RunnerTests(unittest.TestCase):
    def test_repo_remotes(self):
        self.assertIsNotNone(runner.REPO.search("https://github.com/sharbel0022/Mgeorge.git"))
        self.assertIsNotNone(runner.REPO.search("git@github.com:sharbel0022/Mgeorge.git"))
        self.assertIsNone(runner.REPO.search("git@github.com:other/Mgeorge.git"))

    def test_protected_paths(self):
        self.assertIn("scripts/codex_24h.py", runner.PROTECTED)
        self.assertIn("package.json", runner.PROTECTED)
        self.assertIn("sites/package.json", runner.PROTECTED)

    def test_detect_secrets_but_allow_examples(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / ".env.example").write_text("NO_SECRET=1")
            (root / "node_modules").mkdir()
            (root / "node_modules" / ".env").write_text("ignored")
            (root / "sites").mkdir()
            (root / "sites" / "local.pem").write_text("DO_NOT_SEND")
            (root / "data").mkdir()
            with mock.patch.object(runner, "ROOT", root):
                found = runner.sensitive_files()
            self.assertIn("sites/local.pem", found)
            self.assertIn("data", found)
            self.assertNotIn(".env.example", found)
            self.assertNotIn("node_modules/.env", found)

    def test_environment_sanitizes_external_credentials(self):
        with mock.patch.dict(os.environ, {"GITHUB_TOKEN": "secret", "BANK_DATA_KEY": "key", "OPENAI_API_KEY": "api"}):
            self.assertNotIn("BANK_DATA_KEY", runner.scrubbed_env(codex=True))
            self.assertNotIn("GITHUB_TOKEN", runner.scrubbed_env(codex=True))
            self.assertNotIn("OPENAI_API_KEY", runner.scrubbed_env(codex=False))
            self.assertEqual("api", runner.scrubbed_env(codex=True)["OPENAI_API_KEY"])

    def test_test_summary_and_declining_coverage(self):
        with tempfile.TemporaryDirectory() as tmp:
            file = Path(tmp) / "test.stdout.txt"
            file.write_text("TAP version 13\n# tests 238\n# pass 238\n# fail 0\n# skipped 0\n")
            self.assertEqual(238, runner.test_counts(file)["tests"])
            self.assertIsNone(runner.test_counts(Path(tmp) / "missing"))

    def test_green_requires_all_successful_gates(self):
        results = {name: {"exit_code": 0, "timed_out": False} for name, _, _ in runner.GATES}
        self.assertTrue(runner.green(results))
        results["node-tests"]["reason"] = "test count decreased"
        self.assertFalse(runner.green(results))
        del results["node-audit"]
        self.assertFalse(runner.green(results))

    def test_structured_result_schema(self):
        schema = json.loads((SCRIPT.parents[1] / "docs/codex-autopilot/result.schema.json").read_text())
        self.assertFalse(schema["additionalProperties"])
        self.assertEqual(set(schema["required"]), set(schema["properties"]))
        self.assertIn("done", schema["properties"])

    def test_logged_subprocess_collects_logs(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            with mock.patch.object(runner, "ROOT", root):
                result = runner.run_logged([sys.executable, "-c", "print('OK')"], root,
                                           root / "logs" / "unit", timeout=5)
            self.assertEqual(0, result["exit_code"])
            self.assertFalse(result["timed_out"])
            self.assertIn("OK", (root / result["stdout"]).read_text())

    def test_logged_subprocess_is_stopped_at_timeout(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            with mock.patch.object(runner, "ROOT", root):
                result = runner.run_logged([sys.executable, "-c", "import time;time.sleep(5)"], root,
                                           root / "logs" / "slow", timeout=0.2)
            self.assertTrue(result["timed_out"])
            self.assertNotEqual(0, result["exit_code"])

    def test_protected_file_modification_aborts(self):
        def fake_git(args, **kwargs):
            if "--name-only" in args:
                return "scripts/codex_24h.py"
            return ""
        with mock.patch.object(runner, "command", side_effect=fake_git):
            with self.assertRaisesRegex(RuntimeError, "Protected files"):
                runner.check_protected()

    def test_dry_run_makes_no_repo_mutation(self):
        import argparse
        status = runner.run(argparse.Namespace(hours=24, max_rounds=48, round_minutes=40,
                                              dry_run=True, resume=False, model=""))
        self.assertEqual(0, status)


if __name__ == "__main__":
    unittest.main()
