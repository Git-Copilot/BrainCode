import contextlib
import io
import json
import math
import tempfile
import unittest
from pathlib import Path

from braincode import BrainCodeError, Simulation, main, parse, read_eeg_csv


EXAMPLE = """\
brain SimplePerceiver {
  input stimulus: Signal
  memory recent(capacity: 2)
  neuron detector(threshold: 0.65)
  state attention = 0.0
  on stimulus as signal {
    let response = detector.fire(signal)
    recent.store(response)
    attention = learn(attention, from: response, rate: 0.4)
    decide "notice" when attention > 0.5
  }
}
"""

MIXED_EXAMPLE = """\
brain SimplePerceiver:
  input stimulus: Signal
  memory recent(capacity=2)
  neuron detector(threshold=0.65)
  state attention = 0.0

  on stimulus as signal:
    const response = detector.fire(signal)
    recent.store(response)
    attention = learn(attention, from=response, rate=0.4)
    if attention > 0.5:
      decide "notice"
"""

NETWORK_EXAMPLE = """\
brain MotorIntent:
  input eeg: Signal
  memory recent(capacity=3)
  neuron permissive(threshold=0.4)
  neuron strict(threshold=0.8)
  state confidence = 0.1
  state baseline = 0.2

  on eeg as sample:
    let active = permissive.fire(sample)
    let high_confidence = strict.fire(sample)
    recent.store(active)
    confidence = learn(confidence, from: recent.mean(), rate: 0.5)
    baseline = max(baseline, sample * 0.5)
    if recent.ratio() and active and not high_confidence:
      decide "motor-intent"
      emit "confidence", confidence
    else:
      emit "baseline", baseline
"""

BRACED_NETWORK_EXAMPLE = """\
brain BracedNetwork {
  input eeg: Signal;
  memory recent(capacity=2);
  neuron detector(threshold=0.5);
  state confidence = 0.0;
  on eeg as sample {
    let active = detector.fire(sample);
    recent.store(active);
    if (active) {
      decide "active";
      confidence = learn(confidence, from: recent.mean(), rate: 0.5);
      emit "confidence", confidence;
    } else {
      emit "confidence", confidence;
    }
  }
}
"""

BRACED_EXAMPLE = """\
brain SimplePerceiver {
  input stimulus: Signal;
  memory recent(capacity=2);
  neuron detector(threshold=0.65);
  state attention = 0.0;
  on stimulus as signal {
    const response = detector.fire(signal);
    recent.store(response);
    attention = learn(attention, from=response, rate=0.4);
    if (attention > 0.5) {
      decide "notice";
    }
  }
}
"""

EEG_EXAMPLE = """\
brain MotorImagery:
  input eeg: EEG
  sample_rate 256Hz
  window 256 samples step 128 samples
  channels C3, C4

  on eeg as frame:
    let c3_mu = bandpower(frame, "C3", 8, 13)
    let c4_mu = bandpower(frame, "C4", 8, 13)
    emit "c3_mu_power", c3_mu
    if c3_mu > 0.8:
      decide "left-motor-pattern"
    else:
      if c4_mu > 0.8:
        decide "right-motor-pattern"
"""


class BrainCodeTests(unittest.TestCase):
    def setUp(self):
        self.program = parse(EXAMPLE)
        self.simulation = Simulation(self.program)

    def test_neuron_and_learning_reach_decision(self):
        fired, decided = self.simulation.step(0.9)
        self.assertTrue(fired)
        self.assertFalse(decided)
        fired, decided = self.simulation.step(0.8)
        self.assertTrue(fired)
        self.assertTrue(decided)
        self.assertAlmostEqual(self.simulation.attention, 0.64)

    def test_signal_below_threshold_does_not_fire(self):
        fired, decided = self.simulation.step(0.4)
        self.assertFalse(fired)
        self.assertFalse(decided)
        self.assertEqual(self.simulation.attention, 0.0)

    def test_memory_keeps_only_recent_responses(self):
        self.simulation.step(0.9)
        self.simulation.step(0.1)
        self.simulation.step(0.8)
        self.assertEqual(self.simulation.recent, [False, True])

    def test_invalid_signal_is_rejected(self):
        with self.assertRaises(BrainCodeError):
            self.simulation.step(1.1)

    def test_invalid_reference_is_rejected(self):
        with self.assertRaises(BrainCodeError):
            parse(EXAMPLE.replace("recent.store(response)", "unknown.store(response)"))

    def test_python_and_javascript_style_syntax(self):
        for source in (MIXED_EXAMPLE, BRACED_EXAMPLE):
            with self.subTest(source=source):
                program = parse(source)
                self.assertEqual(program, self.program)

    def test_brace_blocks_must_balance(self):
        with self.assertRaisesRegex(BrainCodeError, "unmatched brace"):
            parse(BRACED_EXAMPLE.replace("  }\n}", "}"))

    def test_python_blocks_require_indentation(self):
        with self.assertRaisesRegex(BrainCodeError, "indented body"):
            parse(MIXED_EXAMPLE.replace("  input stimulus", "input stimulus"))

    def test_multiple_neurons_states_memory_and_outputs(self):
        program = parse(NETWORK_EXAMPLE)
        simulation = Simulation(program)

        fired, decided = simulation.step(0.6)

        self.assertTrue(fired)
        self.assertTrue(decided)
        self.assertEqual(simulation.last_decision, "motor-intent")
        self.assertAlmostEqual(simulation.states["confidence"], 0.55)
        self.assertAlmostEqual(simulation.states["baseline"], 0.3)
        self.assertEqual(simulation.last_outputs, [
            {"type": "decision", "label": "motor-intent"},
            {"type": "signal", "label": "confidence", "value": 0.55},
        ])

    def test_memory_window_and_else_branch_evolve_across_samples(self):
        simulation = Simulation(parse(NETWORK_EXAMPLE))
        simulation.step(0.6)
        simulation.step(0.9)
        _, decided = simulation.step(0.1)

        self.assertFalse(decided)
        self.assertEqual(simulation.recent, [True, True, False])
        self.assertEqual(simulation.last_outputs[0]["label"], "baseline")
        self.assertAlmostEqual(simulation.last_outputs[0]["value"], 0.45)

    def test_braced_nested_conditions_and_same_line_else(self):
        simulation = Simulation(parse(BRACED_NETWORK_EXAMPLE))
        _, decided = simulation.step(0.9)
        self.assertTrue(decided)
        self.assertEqual(simulation.last_decision, "active")
        self.assertEqual(simulation.last_outputs[1]["value"], 0.5)

        _, decided = simulation.step(0.1)
        self.assertFalse(decided)
        self.assertEqual(simulation.last_outputs, [
            {"type": "signal", "label": "confidence", "value": 0.5},
        ])

    def test_unknown_state_assignment_and_unsafe_expressions_are_rejected(self):
        with self.assertRaisesRegex(BrainCodeError, "undeclared state"):
            parse(NETWORK_EXAMPLE.replace(
                "baseline = max(baseline, sample * 0.5)",
                "unknown = sample",
            ))
        unsafe = NETWORK_EXAMPLE.replace(
            "let active = permissive.fire(sample)",
            "let active = __import__('os').system('echo unsafe')",
        )
        with self.assertRaisesRegex(BrainCodeError, "unsupported function"):
            Simulation(parse(unsafe)).step(0.6)

    def test_eeg_program_classifies_windowed_multichannel_data(self):
        program = parse(EEG_EXAMPLE)
        simulation = Simulation(program)
        c3 = [math.sin(2 * math.pi * 10 * index / 256) for index in range(256)]
        c4 = [math.sin(2 * math.pi * 20 * index / 256) for index in range(256)]

        fired, decided = simulation.step_window({"C3": c3, "C4": c4})

        self.assertFalse(fired)
        self.assertTrue(decided)
        self.assertEqual(simulation.last_decision, "left-motor-pattern")
        self.assertGreater(simulation.last_outputs[0]["value"], 0.95)
        self.assertEqual(program.channels, ("C3", "C4"))

    def test_eeg_memory_persists_between_windows(self):
        source = EEG_EXAMPLE.replace(
            "  channels C3, C4",
            "  channels C3, C4\n  memory recent(capacity=2)",
        ).replace(
            '    emit "c3_mu_power", c3_mu',
            '    recent.store(c3_mu)\n    emit "recent_mu", recent.mean()',
        )
        simulation = Simulation(parse(source))
        window = {
            "C3": [math.sin(2 * math.pi * 10 * i / 256) for i in range(256)],
            "C4": [math.sin(2 * math.pi * 20 * i / 256) for i in range(256)],
        }

        simulation.step_window(window)
        simulation.step_window(window)

        self.assertEqual(len(simulation.recent), 2)
        self.assertGreater(simulation.last_outputs[0]["value"], 0.95)

    def test_eeg_spectral_features_reuse_fft_and_measure_signal_quality(self):
        source = EEG_EXAMPLE.replace(
            '    let c4_mu = bandpower(frame, "C4", 8, 13)\n',
            '    let c4_mu = bandpower(frame, "C4", 8, 13)\n'
            '    let c3_beta = bandpower(frame, "C3", 14, 30)\n'
            '    let c3_ptp = peak_to_peak(frame, "C3")\n'
            '    emit "c3_beta", c3_beta\n'
            '    emit "c3_ptp", c3_ptp\n',
        )
        simulation = Simulation(parse(source))
        c3 = [2 * math.sin(2 * math.pi * 10 * i / 256) for i in range(256)]
        c4 = [math.sin(2 * math.pi * 20 * i / 256) for i in range(256)]

        simulation.step_window({"C3": c3, "C4": c4})

        self.assertGreater(simulation.last_outputs[2]["value"], 0.95)
        self.assertAlmostEqual(simulation.last_outputs[1]["value"], 4, delta=0.1)
        self.assertEqual(set(simulation.spectrum_cache), {"C3", "C4"})

    def test_eeg_state_can_store_unscaled_feature_values(self):
        source = EEG_EXAMPLE.replace(
            "  channels C3, C4",
            "  channels C3, C4\n  state baseline = -2.0",
        ).replace(
            '    emit "c3_mu_power", c3_mu',
            '    baseline = mean(frame, "C3")\n    emit "baseline", baseline',
        )
        simulation = Simulation(parse(source))
        samples = [4.0 + math.sin(2 * math.pi * 10 * i / 256) for i in range(256)]

        simulation.step_window({"C3": samples, "C4": samples})

        self.assertAlmostEqual(simulation.states["baseline"], 4.0)

    def test_eeg_declarations_and_windows_are_validated(self):
        with self.assertRaisesRegex(BrainCodeError, "sample rate"):
            parse(EEG_EXAMPLE.replace("256Hz", "0Hz"))
        with self.assertRaisesRegex(BrainCodeError, "step must be"):
            parse(EEG_EXAMPLE.replace("step 128 samples", "step 300 samples"))
        simulation = Simulation(parse(EEG_EXAMPLE))
        with self.assertRaisesRegex(BrainCodeError, "exactly 256 samples"):
            simulation.step_window({"C3": [0.0], "C4": [0.0]})
        with self.assertRaisesRegex(BrainCodeError, "undeclared EEG channel"):
            Simulation(parse(EEG_EXAMPLE.replace('"C3"', '"Pz"'))).step_window({
                "C3": [0.0] * 256,
                "C4": [0.0] * 256,
            })

    def test_eeg_bandpower_rejects_invalid_frequency_ranges(self):
        source = EEG_EXAMPLE.replace("8, 13", "8, 129")
        simulation = Simulation(parse(source))
        with self.assertRaisesRegex(BrainCodeError, "within 0..128 Hz"):
            simulation.step_window({"C3": [0.0] * 256, "C4": [0.0] * 256})

        source = EEG_EXAMPLE.replace("8, 13", "8.01, 8.02")
        simulation = Simulation(parse(source))
        with self.assertRaisesRegex(BrainCodeError, "no frequency bins"):
            simulation.step_window({"C3": [0.0] * 256, "C4": [0.0] * 256})

    def test_eeg_csv_cli_replays_overlapping_windows_as_json(self):
        with tempfile.TemporaryDirectory() as directory:
            program_path = Path(__file__).parent / "examples" / "motor_imagery.brain"
            csv_path = Path(directory) / "eeg.csv"
            rows = ["C3,C4"]
            for index in range(384):
                c3 = math.sin(2 * math.pi * 10 * index / 256)
                c4 = math.sin(2 * math.pi * 20 * index / 256)
                rows.append(f"{c3},{c4}")
            csv_path.write_text("\n".join(rows), encoding="utf-8")
            output = io.StringIO()

            with contextlib.redirect_stdout(output):
                result = main([str(program_path), "--csv", str(csv_path), "--json"])

        self.assertEqual(result, 0)
        records = [json.loads(line) for line in output.getvalue().splitlines()]
        self.assertEqual([record["sample_start"] for record in records], [0, 128])
        self.assertEqual([record["decision"] for record in records], [
            "left-motor-pattern",
            "left-motor-pattern",
        ])

    def test_eeg_csv_requires_declared_channel_columns_and_numeric_samples(self):
        with tempfile.TemporaryDirectory() as directory:
            csv_path = Path(directory) / "eeg.csv"
            csv_path.write_text("C3\n0.1\n", encoding="utf-8")
            with self.assertRaisesRegex(BrainCodeError, "missing channel"):
                read_eeg_csv(csv_path, ("C3", "C4"))
            csv_path.write_text("C3,C4\n0.1,invalid\n", encoding="utf-8")
            with self.assertRaisesRegex(BrainCodeError, "numeric sample"):
                read_eeg_csv(csv_path, ("C3", "C4"))
            csv_path.write_text("C3,C4\n0.1,0.2,0.3\n", encoding="utf-8")
            with self.assertRaisesRegex(BrainCodeError, "too many columns"):
                read_eeg_csv(csv_path, ("C3", "C4"))

    def test_legacy_signal_cli_remains_available(self):
        with tempfile.TemporaryDirectory() as directory:
            program_path = Path(directory) / "signal.brain"
            program_path.write_text(EXAMPLE, encoding="utf-8")
            output = io.StringIO()

            with contextlib.redirect_stdout(output):
                result = main([str(program_path), "--signal", "0.9", "--json"])

        self.assertEqual(result, 0)
        record = json.loads(output.getvalue())
        self.assertTrue(record["fired"])


if __name__ == "__main__":
    unittest.main()
