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


if __name__ == "__main__":
    unittest.main()
