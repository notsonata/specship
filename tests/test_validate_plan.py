import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
VALIDATOR = ROOT / ".agents/skills/spec/scripts/validate_plan.py"
SHIP_VALIDATOR = ROOT / ".agents/skills/ship/scripts/validate_plan.py"
FIXTURE = ROOT / "tests/fixtures/draft-plan"


class PlanProtocolTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.plan = Path(self.temp.name) / "fixture-plan"
        shutil.copytree(FIXTURE, self.plan)

    def tearDown(self):
        self.temp.cleanup()

    def run_validator(self, *args, ok=True):
        result = subprocess.run(
            ["python3", str(VALIDATOR), *map(str, args)],
            capture_output=True,
            text=True,
        )
        if ok and result.returncode != 0:
            self.fail(result.stdout + result.stderr)
        if not ok and result.returncode == 0:
            self.fail("validator unexpectedly succeeded\n" + result.stdout)
        return result

    def state(self):
        text = (self.plan / "STATE.md").read_text()
        block = text.split("```json\n", 1)[1].split("\n```", 1)[0]
        return json.loads(block)

    def seal(self):
        self.run_validator("seal", self.plan, "--note", "fixture ready")

    def test_skill_bundles_do_not_drift(self):
        self.assertEqual(VALIDATOR.read_bytes(), SHIP_VALIDATOR.read_bytes())
        for name in ("protocol.md", "artifact-templates.md"):
            self.assertEqual(
                (ROOT / ".agents/skills/spec/references" / name).read_bytes(),
                (ROOT / ".agents/skills/ship/references" / name).read_bytes(),
            )

    def test_seal_creates_digest_and_ready_state(self):
        self.seal()
        state = self.state()
        self.assertEqual("Ready", state["lifecycle_state"])
        self.assertTrue(state["contract_digest"].startswith("sha256:"))
        self.run_validator("validate", self.plan)

    def test_tampered_contract_fails_validation(self):
        self.seal()
        with (self.plan / "SPEC.md").open("a") as handle:
            handle.write("\nTampered.\n")
        result = self.run_validator("validate", self.plan, ok=False)
        self.assertIn("contract digest mismatch", result.stdout)

    def test_open_blocking_question_prevents_seal(self):
        with (self.plan / "CONTEXT.md").open("a") as handle:
            handle.write(
                "\n### Q-001: Which output?\n\n"
                "- **Blocking**: Yes\n- **Status**: Open\n- **Why it matters**: Contract output.\n"
            )
        result = self.run_validator("seal", self.plan, ok=False)
        self.assertIn("open blocking questions", result.stderr)

    def test_dependency_cycle_fails_validation(self):
        plan_path = self.plan / "PLAN.md"
        text = plan_path.read_text().replace("- **Dependencies**: None", "- **Dependencies**: TASK-001")
        plan_path.write_text(text)
        result = self.run_validator("seal", self.plan, ok=False)
        self.assertIn("depends on itself", result.stderr)

    def test_revision_increments_and_unseals_contract(self):
        self.seal()
        self.run_validator("revise", self.plan, "--note", "new evidence")
        state = self.state()
        self.assertEqual(2, state["contract_revision"])
        self.assertEqual("Draft", state["lifecycle_state"])
        self.assertEqual("UNSEALED", state["contract_digest"])
        for name in ("CONTEXT.md", "SPEC.md", "PLAN.md"):
            self.assertIn('"contract_revision": 2', (self.plan / name).read_text())

    def test_complete_execution_requires_current_evidence(self):
        self.seal()
        self.run_validator("start", self.plan, "--note", "start fixture")
        self.run_validator("task", self.plan, "TASK-001", "InProgress")
        result = self.run_validator("task", self.plan, "TASK-001", "Done", ok=False)
        self.assertIn("RESULTS evidence", result.stderr)

        state = self.state()
        digest = state["contract_digest"]
        (self.plan / "RESULTS.md").write_text(
            "# Results: Fixture plan\n\n"
            "## TASK-001 — Attempt 1\n\n"
            "- **Contract revision**: 1\n"
            f"- **Contract digest**: {digest}\n"
            "- **Outcome**: Completed\n"
            "- **Files changed**: `src/greeting.py`\n"
            "- **Implementation**: Added helper.\n"
            "- **Validation**: Focused test passed.\n"
            "- **Deviations**: None\n"
            "- **Remaining risks**: None\n"
            "- **Review notes**: None\n\n"
            "## Plan execution summary\n\n"
            "- **Contract revision**: 1\n"
            f"- **Contract digest**: {digest}\n"
            "- **Outcome**: Implemented\n"
            "- **Tasks**: TASK-001\n"
            "- **Files changed**: `src/greeting.py`\n"
            "- **Plan-wide validation**: Passed.\n"
            "- **Deviations**: None\n"
            "- **Remaining risks**: None\n"
        )
        self.run_validator("task", self.plan, "TASK-001", "Done")
        self.run_validator("finish", self.plan, "--note", "fixture complete")
        self.assertEqual("Implemented", self.state()["lifecycle_state"])
        self.run_validator("validate", self.plan)

        result = self.run_validator(
            "transition",
            self.plan,
            "ReadyForConfirmation",
            "--actor",
            "spec",
            ok=False,
        )
        self.assertIn("requires a current review", result.stderr)
        (self.plan / "REVIEW.md").write_text(
            "# Review: Fixture plan\n\n"
            "## Review round 1\n\n"
            "- **Contract revision**: 1\n"
            f"- **Contract digest**: {digest}\n"
            "- **Implementation baseline**: Fixture baseline\n"
            "- **Status**: Ready for user confirmation\n"
            "- **Reviewed scope**: Complete plan.\n"
            "- **Findings**: None.\n"
            "- **Acceptance criteria**: Passed.\n"
            "- **Validation**: Passed.\n"
            "- **Remaining risks**: None.\n"
        )
        self.run_validator(
            "transition",
            self.plan,
            "ReadyForConfirmation",
            "--actor",
            "spec",
        )
        result = self.run_validator(
            "transition", self.plan, "Finalized", "--actor", "spec", ok=False
        )
        self.assertIn("explicit finalization record", result.stderr)
        with (self.plan / "REVIEW.md").open("a") as handle:
            handle.write(
                "\n## Finalization\n\n"
                "- **Contract revision**: 1\n"
                f"- **Contract digest**: {digest}\n"
                "- **User confirmation**: Confirmed in the user conversation.\n"
                "- **Canonical documentation updates**: None required.\n"
                "- **Validation freshness**: Implementation unchanged.\n"
            )
        self.run_validator("transition", self.plan, "Finalized", "--actor", "spec")
        self.run_validator("validate", self.plan)

    @unittest.skipUnless(shutil.which("git"), "git is required")
    def test_start_rejects_dirty_file_drift(self):
        subprocess.run(["git", "init", "-q", self.temp.name], check=True)
        subprocess.run(["git", "-C", self.temp.name, "config", "user.email", "fixture@example.com"], check=True)
        subprocess.run(["git", "-C", self.temp.name, "config", "user.name", "Fixture"], check=True)
        subprocess.run(["git", "-C", self.temp.name, "add", "."], check=True)
        subprocess.run(["git", "-C", self.temp.name, "commit", "-qm", "fixture"], check=True)
        self.seal()
        (Path(self.temp.name) / "unrelated.txt").write_text("user change\n")
        result = self.run_validator("start", self.plan, ok=False)
        self.assertIn("dirty-file set differs", result.stderr)

    @unittest.skipUnless(shutil.which("git"), "git is required")
    def test_start_rejects_dirty_content_drift_at_same_path(self):
        unrelated = Path(self.temp.name) / "unrelated.txt"
        unrelated.write_text("committed\n")
        subprocess.run(["git", "init", "-q", self.temp.name], check=True)
        subprocess.run(["git", "-C", self.temp.name, "config", "user.email", "fixture@example.com"], check=True)
        subprocess.run(["git", "-C", self.temp.name, "config", "user.name", "Fixture"], check=True)
        subprocess.run(["git", "-C", self.temp.name, "add", "."], check=True)
        subprocess.run(["git", "-C", self.temp.name, "commit", "-qm", "fixture"], check=True)
        unrelated.write_text("dirty at planning\n")
        self.seal()
        unrelated.write_text("different dirty content\n")
        result = self.run_validator("start", self.plan, ok=False)
        self.assertIn("dirty-file content differs", result.stderr)


if __name__ == "__main__":
    unittest.main()
