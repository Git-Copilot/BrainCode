import tempfile
import unittest
from pathlib import Path
from unittest import mock

import mcp_server
from mcp_server import (
    MAX_INPUTS,
    _run_program,
    _validate_program,
    _workspace_file,
    replace_repository_text,
)


SIGNAL_PROGRAM = """\
brain Threshold:
  input eeg: Signal
  memory recent(capacity=2)
  neuron detector(threshold=0.5)
  state confidence = 0.0
  on eeg as sample:
    let active = detector.fire(sample)
    if active:
      decide "active"
"""

EEG_PROGRAM = """\
brain EEGCheck:
  input eeg: EEG
  sample_rate 8Hz
  window 8 samples step 4 samples
  channels C3, C4
  on eeg as frame:
    emit "left_mean", mean(frame, "C3")
"""


class McpServerTests(unittest.TestCase):
    def test_validate_reports_program_metadata_and_syntax_errors(self):
        result = _validate_program(EEG_PROGRAM)
        self.assertTrue(result["valid"])
        self.assertEqual(result["channels"], ["C3", "C4"])
        self.assertEqual(result["window_samples"], 8)

        invalid = _validate_program("not BrainCode")
        self.assertFalse(invalid["valid"])
        self.assertIn("error", invalid)

    def test_run_signal_program_returns_decisions(self):
        result = _run_program(SIGNAL_PROGRAM, signals=[0.2, 0.8])
        self.assertIsNone(result["results"][0]["decision"])
        self.assertEqual(result["results"][1]["decision"], "active")

    def test_run_eeg_program_generates_overlapping_windows(self):
        result = _run_program(
            EEG_PROGRAM,
            eeg_samples={"C3": list(range(12)), "C4": [0] * 12},
        )
        self.assertEqual([item["sample_offset"] for item in result["results"]], [0, 4])
        self.assertEqual(result["results"][0]["outputs"][0]["value"], 3.5)

    def test_run_rejects_mismatched_inputs_and_excessive_work(self):
        with self.assertRaisesRegex(ValueError, "require signals"):
            _run_program(SIGNAL_PROGRAM, eeg_samples={"C3": []})
        with self.assertRaisesRegex(ValueError, "between 1 and"):
            _run_program(SIGNAL_PROGRAM, signals=[0.5] * (MAX_INPUTS + 1))

    def test_repository_tools_reject_outside_and_sensitive_paths(self):
        for path in ("..\\outside.py", ".git\\config", ".github\\workflows\\ci.yml", "assets\\brain\\mesh.js"):
            with self.subTest(path=path):
                with self.assertRaises(ValueError):
                    _workspace_file(path)

    def test_text_replacement_requires_a_unique_match(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "README.md").write_text("## Tests\n", encoding="utf-8")
            with mock.patch.object(mcp_server, "WORKSPACE_ROOT", root):
                result = replace_repository_text("README.md", "## Tests", "## Tests\n\nMCP server tests are included.")
                changed = (root / "README.md").read_text(encoding="utf-8")
                self.assertEqual(result["replacements"], 1)
                self.assertIn("MCP server tests are included.", changed)
                with self.assertRaisesRegex(ValueError, "found 0 matches"):
                    replace_repository_text("README.md", "not present", "duplicate")


if __name__ == "__main__":
    unittest.main()
