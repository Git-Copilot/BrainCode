const assert = require("node:assert/strict");
const test = require("node:test");
const {
  createSyntheticData,
  extractEpochs,
  fftPower,
  parseCsv,
  summarize,
} = require("./bti.js");

test("FFT mu-band feature separates 10 Hz from 20 Hz", () => {
  const sampleRate = 128;
  const samples = Array.from({ length: 256 }, (_, index) => ({
    ten: Math.sin(2 * Math.PI * 10 * index / sampleRate),
    twenty: Math.sin(2 * Math.PI * 20 * index / sampleRate),
  }));
  const mu = fftPower(samples.map(sample => sample.ten), sampleRate);
  const outside = fftPower(samples.map(sample => sample.twenty), sampleRate);
  assert.ok(mu > outside * 1000);
});

test("CSV parser reads labeled C3, Cz, and C4 samples", () => {
  const samples = parseCsv(
    "time,C3,Cz,C4,label\n0,1,2,3,left\n0.01,2,3,4,left\n",
  );
  assert.deepEqual(samples[0], { time: 0, c3: 1, cz: 2, c4: 3, label: "left" });
  assert.equal(samples.length, 2);
});

test("CSV parser rejects non-monotonic timestamps and unknown labels", () => {
  assert.throws(
    () => parseCsv("time,C3,Cz,C4\n0,1,2,3\n0,2,3,4\n"),
    /timestamps must increase/,
  );
  assert.throws(
    () => parseCsv("time,C3,Cz,C4,label\n0,1,2,3,rest\n"),
    /label must be "left" or "right"/,
  );
});

test("epoch extraction rejects timestamps that disagree with the selected rate", () => {
  const samples = createSyntheticData(128, 2, 5);
  samples[1].time += 0.001;
  assert.throws(() => extractEpochs(samples, 128, 2), /evenly sampled at 128 Hz/);
});

test("synthetic motor imagery produces deterministic held-out evaluation", () => {
  const samples = createSyntheticData(128, 2, 20);
  const result = summarize(samples, 128, 2);
  assert.equal(result.epochs.length, 40);
  assert.equal(result.trainCount, 32);
  assert.equal(result.testCount, 8);
  assert.ok(result.balancedAccuracy >= 0.75);
  assert.equal(result.confusion.left.left + result.confusion.left.right, 4);
  assert.equal(result.confusion.right.left + result.confusion.right.right, 4);
});

test("unlabeled data yields features without a misleading accuracy score", () => {
  const samples = createSyntheticData(128, 2, 5).map(({ label, ...sample }) => sample);
  const result = summarize(samples, 128, 2);
  assert.equal(result.unlabeled, true);
  assert.equal(result.epochs.length, 10);
  assert.equal(result.accuracy, undefined);
});

test("invalid epochs and insufficient labels produce explicit errors", () => {
  const samples = createSyntheticData(128, 2, 3);
  assert.throws(() => extractEpochs(samples, 128, 1.5), /power-of-two sample count/);
  assert.throws(() => summarize(samples, 128, 2), /Need at least 5 labeled/);
});
