(() => {
  const MAX_SAMPLES = 500000;
  const BAND = [8, 13];

  function parseCsv(text) {
    const records = [];
    let row = [];
    let field = "";
    let quoted = false;
    for (let index = 0; index < text.length; index++) {
      const character = text[index];
      if (quoted) {
        if (character === '"' && text[index + 1] === '"') {
          field += '"';
          index++;
        } else if (character === '"') {
          quoted = false;
        } else {
          field += character;
        }
      } else if (character === '"' && field.length === 0) {
        quoted = true;
      } else if (character === ",") {
        row.push(field.trim());
        field = "";
      } else if (character === "\n" || character === "\r") {
        row.push(field.trim());
        field = "";
        if (row.some(value => value !== "")) records.push(row);
        row = [];
        if (character === "\r" && text[index + 1] === "\n") index++;
      } else {
        field += character;
      }
    }
    if (quoted) throw Error("CSV contains an unclosed quoted field.");
    row.push(field.trim());
    if (row.some(value => value !== "")) records.push(row);
    if (records.length < 2) throw Error("CSV needs a header and at least one sample row.");

    const headers = records[0].map(value => value.replace(/^\uFEFF/, "").toLowerCase());
    const indexes = Object.fromEntries(headers.map((header, index) => [header, index]));
    for (const header of ["c3", "cz", "c4"]) {
      if (!(header in indexes)) throw Error(`CSV is missing the required ${header.toUpperCase()} channel.`);
    }
    if (!("time" in indexes) && !("timestamp" in indexes)) {
      throw Error("CSV must include a time or timestamp column.");
    }
    const timeIndex = indexes.time ?? indexes.timestamp;
    const labelIndex = indexes.label;
    const samples = [];
    for (let line = 1; line < records.length; line++) {
      const values = records[line];
      const time = Number(values[timeIndex]);
      const c3 = Number(values[indexes.c3]);
      const cz = Number(values[indexes.cz]);
      const c4 = Number(values[indexes.c4]);
      if (![time, c3, cz, c4].every(Number.isFinite)) {
        throw Error(`CSV row ${line + 1} has a missing or non-numeric time/channel value.`);
      }
      if (samples.length && time <= samples[samples.length - 1].time) {
        throw Error(`CSV timestamps must increase (row ${line + 1}).`);
      }
      let label = null;
      if (labelIndex !== undefined && values[labelIndex]) {
        label = values[labelIndex].toLowerCase();
        if (label !== "left" && label !== "right") {
          throw Error(`CSV row ${line + 1} label must be "left" or "right".`);
        }
      }
      samples.push({ time, c3, cz, c4, label });
      if (samples.length > MAX_SAMPLES) {
        throw Error(`CSV exceeds the ${MAX_SAMPLES.toLocaleString()}-sample browser limit.`);
      }
    }
    return samples;
  }

  function randomGenerator(seed) {
    let state = seed >>> 0;
    return () => {
      state = (1664525 * state + 1013904223) >>> 0;
      return state / 4294967296;
    };
  }

  function createSyntheticData(sampleRate = 128, epochSeconds = 2, trialsPerClass = 30) {
    const random = randomGenerator(20261107);
    const sampleCount = sampleRate * epochSeconds;
    const samples = [];
    let trial = 0;
    for (const label of ["left", "right"]) {
      for (let repetition = 0; repetition < trialsPerClass; repetition++) {
        const phase = random() * Math.PI * 2;
        for (let sample = 0; sample < sampleCount; sample++) {
          const time = (trial * sampleCount + sample) / sampleRate;
          const t = sample / sampleRate;
          const mu = Math.sin(2 * Math.PI * 10 * t + phase);
          const noise = () => (random() + random() + random() - 1.5) * 2.4;
          const leftAmplitude = label === "right" ? 9 : 3.2;
          const rightAmplitude = label === "left" ? 9 : 3.2;
          samples.push({
            time,
            c3: leftAmplitude * mu + noise(),
            cz: 5.2 * Math.sin(2 * Math.PI * 10 * t + phase * 0.7) + noise(),
            c4: rightAmplitude * mu + noise(),
            label,
          });
        }
        trial++;
      }
    }
    return samples;
  }

  function fftPower(values, sampleRate, lowHz = BAND[0], highHz = BAND[1]) {
    const size = values.length;
    if (size < 2 || (size & (size - 1)) !== 0) {
      throw Error("Epoch sample count must be a power of two (for example 256 samples).");
    }
    const real = new Float64Array(size);
    const imaginary = new Float64Array(size);
    const mean = values.reduce((sum, value) => sum + value, 0) / size;
    for (let index = 0; index < size; index++) {
      const hamming = 0.54 - 0.46 * Math.cos(2 * Math.PI * index / (size - 1));
      real[index] = (values[index] - mean) * hamming;
    }

    let target = 0;
    for (let source = 1; source < size; source++) {
      let bit = size >> 1;
      for (; target & bit; bit >>= 1) target ^= bit;
      target ^= bit;
      if (source < target) {
        [real[source], real[target]] = [real[target], real[source]];
      }
    }

    for (let length = 2; length <= size; length <<= 1) {
      const angle = -2 * Math.PI / length;
      const stepReal = Math.cos(angle);
      const stepImaginary = Math.sin(angle);
      for (let start = 0; start < size; start += length) {
        let twiddleReal = 1;
        let twiddleImaginary = 0;
        for (let offset = 0; offset < length / 2; offset++) {
          const even = start + offset;
          const odd = even + length / 2;
          const productReal = twiddleReal * real[odd] - twiddleImaginary * imaginary[odd];
          const productImaginary = twiddleReal * imaginary[odd] + twiddleImaginary * real[odd];
          real[odd] = real[even] - productReal;
          imaginary[odd] = imaginary[even] - productImaginary;
          real[even] += productReal;
          imaginary[even] += productImaginary;
          const nextReal = twiddleReal * stepReal - twiddleImaginary * stepImaginary;
          twiddleImaginary = twiddleReal * stepImaginary + twiddleImaginary * stepReal;
          twiddleReal = nextReal;
        }
      }
    }

    const powers = [];
    for (let bin = 1; bin <= size / 2; bin++) {
      const frequency = bin * sampleRate / size;
      if (frequency >= lowHz && frequency <= highHz) {
        powers.push((real[bin] ** 2 + imaginary[bin] ** 2) / size ** 2);
      }
    }
    if (!powers.length) throw Error("Sampling settings do not resolve the 8–13 Hz mu band.");
    return powers.reduce((sum, power) => sum + power, 0) / powers.length;
  }

  function extractEpochs(samples, sampleRate = 128, epochSeconds = 2) {
    if (!Number.isFinite(sampleRate) || sampleRate < 32 || sampleRate > 2048) {
      throw Error("Sampling rate must be between 32 and 2048 Hz.");
    }
    if (!Number.isFinite(epochSeconds) || epochSeconds <= 0 || epochSeconds > 16) {
      throw Error("Epoch duration must be greater than 0 and at most 16 seconds.");
    }
    const epochSize = Math.round(sampleRate * epochSeconds);
    if ((epochSize & (epochSize - 1)) !== 0) {
      throw Error(`Epoch duration must give a power-of-two sample count. At ${sampleRate} Hz, try 1, 2, 4, or 8 seconds.`);
    }
    if (sampleRate / 2 < BAND[1]) throw Error("Sampling rate must be greater than 26 Hz to measure the mu band.");
    const expectedStep = 1 / sampleRate;
    for (let index = 1; index < samples.length; index++) {
      const actualStep = samples[index].time - samples[index - 1].time;
      if (Math.abs(actualStep - expectedStep) > expectedStep * 0.05) {
        throw Error(`Timestamps must be evenly sampled at ${sampleRate} Hz in seconds (row ${index + 1}).`);
      }
    }

    const epochs = [];
    for (let start = 0; start + epochSize <= samples.length; start += epochSize) {
      const segment = samples.slice(start, start + epochSize);
      const labels = segment.map(sample => sample.label).filter(Boolean);
      let label = null;
      if (labels.length) {
        const left = labels.filter(value => value === "left").length;
        const right = labels.filter(value => value === "right").length;
        const majority = Math.max(left, right) / labels.length;
        if (majority < 0.8) continue;
        label = left > right ? "left" : "right";
      }
      const c3 = fftPower(segment.map(sample => sample.c3), sampleRate);
      const c4 = fftPower(segment.map(sample => sample.c4), sampleRate);
      const cz = fftPower(segment.map(sample => sample.cz), sampleRate);
      epochs.push({
        startTime: segment[0].time,
        label,
        c3Mu: Math.log10(Math.max(c3, 1e-12)),
        czMu: Math.log10(Math.max(cz, 1e-12)),
        c4Mu: Math.log10(Math.max(c4, 1e-12)),
      });
    }
    if (!epochs.length) throw Error("No complete, consistently labeled epochs found in this file.");
    return { epochs, epochSize, discardedSamples: samples.length % epochSize };
  }

  function predictNearestCentroid(model, feature) {
    const standardized = feature.map((value, index) => (value - model.mean[index]) / model.scale[index]);
    let bestLabel = null;
    let bestDistance = Infinity;
    for (const label of ["left", "right"]) {
      const centroid = model.centroids[label];
      const distance = standardized.reduce(
        (sum, value, index) => sum + (value - centroid[index]) ** 2,
        0,
      );
      if (distance < bestDistance) {
        bestDistance = distance;
        bestLabel = label;
      }
    }
    return { label: bestLabel, distance: bestDistance };
  }

  function trainAndEvaluate(epochs) {
    const labeled = epochs.filter(epoch => epoch.label === "left" || epoch.label === "right");
    const grouped = { left: [], right: [] };
    for (const epoch of labeled) grouped[epoch.label].push(epoch);
    for (const label of ["left", "right"]) {
      if (grouped[label].length < 5) {
        throw Error(`Need at least 5 labeled ${label}-imagery epochs for training and held-out evaluation; found ${grouped[label].length}.`);
      }
    }

    const training = [];
    const testing = [];
    for (const label of ["left", "right"]) {
      const holdoutStart = Math.floor(grouped[label].length * 0.8);
      grouped[label].forEach((epoch, index) => {
        (index < holdoutStart ? training : testing).push(epoch);
      });
    }
    const features = epoch => [epoch.c3Mu, epoch.c4Mu];
    const mean = [0, 1].map(index =>
      training.reduce((sum, epoch) => sum + features(epoch)[index], 0) / training.length
    );
    const scale = [0, 1].map(index => {
      const variance = training.reduce((sum, epoch) =>
        sum + (features(epoch)[index] - mean[index]) ** 2, 0
      ) / training.length;
      return Math.sqrt(variance) || 1;
    });
    const centroids = {};
    for (const label of ["left", "right"]) {
      const members = training.filter(epoch => epoch.label === label);
      centroids[label] = [0, 1].map(index =>
        members.reduce((sum, epoch) => sum + (features(epoch)[index] - mean[index]) / scale[index], 0) / members.length
      );
    }
    const model = { mean, scale, centroids };
    const confusion = { left: { left: 0, right: 0 }, right: { left: 0, right: 0 } };
    for (const epoch of testing) {
      const prediction = predictNearestCentroid(model, features(epoch)).label;
      confusion[epoch.label][prediction]++;
    }
    const recalls = ["left", "right"].map(label =>
      confusion[label][label] / (confusion[label].left + confusion[label].right)
    );
    return {
      model,
      confusion,
      trainCount: training.length,
      testCount: testing.length,
      accuracy: testing.reduce((sum, epoch) =>
        sum + Number(predictNearestCentroid(model, features(epoch)).label === epoch.label), 0
      ) / testing.length,
      balancedAccuracy: (recalls[0] + recalls[1]) / 2,
      predictions: epochs.map(epoch => ({
        ...epoch,
        predicted: predictNearestCentroid(model, features(epoch)).label,
      })),
    };
  }

  function summarize(samples, sampleRate, epochSeconds) {
    const extracted = extractEpochs(samples, sampleRate, epochSeconds);
    const labeledCount = extracted.epochs.filter(epoch => epoch.label).length;
    if (!labeledCount) {
      return { ...extracted, labeledCount: 0, unlabeled: true };
    }
    const evaluation = trainAndEvaluate(extracted.epochs);
    return { ...extracted, ...evaluation, labeledCount, unlabeled: false };
  }

  function createCsv(samples) {
    const lines = ["time,C3,Cz,C4,label"];
    for (const sample of samples) {
      lines.push([
        sample.time.toFixed(6),
        sample.c3.toFixed(6),
        sample.cz.toFixed(6),
        sample.c4.toFixed(6),
        sample.label,
      ].join(","));
    }
    return lines.join("\n");
  }

  const api = { parseCsv, createSyntheticData, fftPower, extractEpochs, trainAndEvaluate, summarize, createCsv };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.BTI = api;
})();
