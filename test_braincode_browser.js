const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const BrainCodeBrowser = require("./braincode-browser.js");

const SIGNAL_PROGRAM = `\
brain SignalDemo:
  input eeg: Signal
  memory recent(capacity: 3)
  neuron detector(threshold: 0.5)
  state confidence = 0.0
  on eeg as sample:
    let fired = detector.fire(sample)
    recent.store(fired)
    confidence = learn(confidence, from: recent.mean(), rate: 0.5)
    if fired and confidence >= 0.25:
      decide "active"
    elif not fired:
      emit "confidence", confidence
    else:
      emit "miss", false
`;

test("runs Signal programs with persistent state, memory, and chained conditions", () => {
  const result = BrainCodeBrowser.runProgram(SIGNAL_PROGRAM, { signals: [0.2, 0.8] });
  assert.equal(result.input_kind, "Signal");
  assert.equal(result.results[0].outputs[0].label, "confidence");
  assert.equal(result.results[1].decision, "active");
  assert.equal(result.results[1].states.confidence, 0.25);
});

test("parses expressions and executes BrainCode braced blocks safely", () => {
  const source = `\
brain Arithmetic {
  input eeg: Signal
  memory recent(capacity=1)
  neuron detector(threshold=0.5)
  state confidence = 0.0
  on eeg as sample {
    let value = clamp(2 ** 3 // 4, 0, 9);
    emit "value", value if true else 0;
  }
}
`;
  const result = BrainCodeBrowser.runProgram(source, { signals: [0.1] });
  assert.equal(result.results[0].outputs[0].value, 2);
});

test("runs the bundled EEG program over overlapping windows and computes bandpower", () => {
  const source = fs.readFileSync(path.join(__dirname, "examples", "motor_imagery.brain"), "utf8");
  const eegSamples = { C3: [], C4: [] };
  for (let index = 0; index < 512; index += 1) {
    eegSamples.C3.push(10 * Math.sin(2 * Math.PI * 10 * index / 256));
    eegSamples.C4.push(10 * Math.sin(2 * Math.PI * 20 * index / 256));
  }
  const result = BrainCodeBrowser.runProgram(source, { eegSamples });
  assert.deepEqual(result.results.map(item => item.sample_offset), [0, 128, 256]);
  assert.equal(result.results[0].decision, "left-motor-pattern");
  assert.ok(result.results[0].outputs[0].value > 0.99);
  assert.ok(result.results[0].outputs[1].value < 0.01);
});

test("reads quoted, CRLF EEG CSV and rejects missing or invalid samples", () => {
  const samples = BrainCodeBrowser.parseEegCsv(
    "Timestamp,C3,C4\r\n0,1.5,2.5\r\n1,3.5,4.5\r\n",
    ["C3", "C4"],
  );
  assert.deepEqual(samples, { C3: [1.5, 3.5], C4: [2.5, 4.5] });
  assert.throws(() => BrainCodeBrowser.parseEegCsv("C3\n1\n", ["C3", "C4"]), /missing channel/);
  assert.throws(() => BrainCodeBrowser.parseEegCsv("C3,C4\n1,NaN\n", ["C3", "C4"]), /finite numeric sample/);
});

test("surfaces parser and input errors instead of returning empty results", () => {
  assert.throws(() => BrainCodeBrowser.parseProgram("not a BrainCode program"), /invalid BrainCode declaration/);
  assert.throws(() => BrainCodeBrowser.runProgram(SIGNAL_PROGRAM, { signals: [1.1] }), /between 0 and 1/);
  const eegProgram = `\
brain EEGCheck:
  input eeg: EEG
  sample_rate 8Hz
  window 8 samples
  channels C3
  on eeg as frame:
    emit "mean", mean(frame, "C3")
`;
  assert.throws(() => BrainCodeBrowser.runProgram(eegProgram, {
    eegSamples: { C3: "not-an-array" },
  }), /must be an array/);
});

test("bounds deeply nested expressions and conditionals without losing declared state", () => {
  const nestedExpression = SIGNAL_PROGRAM.replace(
    "let fired = detector.fire(sample)",
    `let fired = ${"(".repeat(130)}sample${")".repeat(130)}`,
  );
  assert.throws(() => BrainCodeBrowser.runProgram(nestedExpression, { signals: [0.2] }), /expression nesting exceeds/);

  const nestedBlocks = Array.from({ length: 130 }, (_, index) =>
    `${" ".repeat(4 + 2 * index)}if true:`,
  ).join("\n");
  const nestedProgram = SIGNAL_PROGRAM.replace(
    /  on eeg as sample:[\s\S]*/,
    `  on eeg as sample:\n${nestedBlocks}\n${" ".repeat(264)}decide "deep"\n`,
  );
  assert.throws(() => BrainCodeBrowser.parseProgram(nestedProgram), /program nesting exceeds/);

  const specialStateProgram = `\
brain SafeState:
  input eeg: Signal
  memory recent(capacity=1)
  neuron detector(threshold=0.5)
  state __proto__ = 0.0
  on eeg as sample:
    decide "ok"
`;
  const result = BrainCodeBrowser.runProgram(specialStateProgram, { signals: [0.2] });
  assert.equal(Object.hasOwn(result.results[0].states, "__proto__"), true);
  assert.equal(result.results[0].states.__proto__, 0);
});
