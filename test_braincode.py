import unittest

from braincode import BrainCodeError, Simulation, parse


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


if __name__ == "__main__":
    unittest.main()
