const assert = require("node:assert/strict");
const test = require("node:test");
const { parse, run } = require("./biocode.js");

const EXAMPLE = `protocol DemoAssay:
  sample specimen volume=50 uL signal=0.72
  reagent buffer volume=200 uL

  step prepare:
    transfer 100 uL from buffer to specimen
    mix specimen for 30 seconds
  step read:
    incubate specimen for 5 minutes at 25 C
    measure signal of specimen as response
  report response
`;

test("parses and simulates a protocol with a transparent dilution model", () => {
  const result = run(parse(EXAMPLE));
  assert.equal(result.report, 0.24);
  assert.equal(result.containers.specimen.volumeUl, 150);
  assert.equal(result.containers.buffer.volumeUl, 100);
  assert.match(result.trace.join("\n"), /simulated signal/);
});

test("simulation is deterministic and does not mutate the parsed program", () => {
  const program = parse(EXAMPLE);
  const first = run(program);
  const second = run(program);
  assert.deepEqual(first, second);
  assert.equal(program.containers.specimen.volumeUl, 50);
});

test("supports milliliter declarations and transfer amounts", () => {
  const source = EXAMPLE
    .replace("volume=50 uL", "volume=0.05 mL")
    .replace("volume=200 uL", "volume=0.2 mL")
    .replace("transfer 100 uL", "transfer 0.1 mL");
  assert.equal(run(parse(source)).report, 0.24);
});

test("rejects transfer volumes larger than available stock", () => {
  const source = EXAMPLE.replace("transfer 100 uL", "transfer 250 uL");
  assert.throws(() => run(parse(source)), /buffer has 200 uL; 250 uL requested/);
});

test("rejects operations on containers emptied by earlier steps", () => {
  const source = EXAMPLE
    .replace("transfer 100 uL", "transfer 200 uL")
    .replace("mix specimen for 30 seconds", "mix buffer for 30 seconds");
  assert.throws(() => run(parse(source)), /cannot mix an empty container/);
});

test("rejects undeclared containers, invalid signals, and unknown commands", () => {
  assert.throws(
    () => parse(EXAMPLE.replace("to specimen", "to missing")),
    /"missing" is not a declared sample or reagent/,
  );
  assert.throws(
    () => parse(EXAMPLE.replace("signal=0.72", "signal=1.2")),
    /signal must be between 0 and 1/,
  );
  assert.throws(
    () => parse(EXAMPLE.replace("25 C", `${"9".repeat(400)} C`)),
    /temperature must be finite/,
  );
  assert.throws(
    () => parse(EXAMPLE.replace("mix specimen for 30 seconds", "shake specimen")),
    /unsupported protocol command/,
  );
});

test("requires a report value that was measured", () => {
  assert.throws(
    () => parse(EXAMPLE.replace("report response", "report missing")),
    /Report "missing" is not a measured value/,
  );
  assert.throws(() => parse(EXAMPLE.replace("  report response\n", "")), /report statement/);
});

test("rejects malformed indentation and non-positive volumes", () => {
  assert.throws(
    () => parse(EXAMPLE.replace("    mix specimen", "   mix specimen")),
    /commands must be indented four spaces/,
  );
  assert.throws(
    () => parse(EXAMPLE.replace("volume=50 uL", "volume=0 uL")),
    /volume must be greater than zero/,
  );
});

test("rejects protocols with no sample or empty steps", () => {
  assert.throws(() => parse(EXAMPLE.replace(/^  sample.*\n/m, "")), /Declare at least one sample/);
  assert.throws(
    () => parse(EXAMPLE.replace(
      "    transfer 100 uL from buffer to specimen\n    mix specimen for 30 seconds\n",
      "",
    )),
    /step "prepare" is empty/,
  );
});
