# BrainCode

BrainCode is an experimental **offline EEG motor-imagery prototyping workbench**
with a small domain language for brain-inspired simulations. It runs locally in
the browser: load EEG CSV, inspect C3/Cz/C4 signals, extract 8–13 Hz mu-band
features, and evaluate a simple left/right baseline on held-out epochs.

Try the [BrainCode Playground](https://git-copilot.github.io/BrainCode/) in your
browser. It also includes a small example interpreter and a focused schematic
of the human primary motor cortex.

## EEG workbench

The **Load synthetic demo** button generates a deterministic two-class example
at 128 Hz. Its simulated C3/Cz/C4 signals contain 10 Hz oscillations, noise, and
class-dependent mu-amplitude changes; the demo is illustrative, not recorded
human EEG.

To analyze your own data, import a UTF-8 CSV with a header and these columns:

```csv
time,C3,Cz,C4,label
0.000000,2.1,1.4,-0.8,left
0.007812,1.8,0.9,-1.2,left
```

`time` (in seconds) or `timestamp` (in seconds) must be evenly sampled at the
selected sampling rate; timestamps are checked to be within 5% of the expected
sample interval. C3, Cz, and C4 are required. The optional label column uses
`left` or `right` on each sample; each epoch must be at least 80% consistently
labeled for inclusion in evaluation. Values are passed through as-is—use
consistent units and preprocessing. Sampling rate and epoch duration must
produce a power-of-two sample count. Supported rates are 32–2048 Hz in the
analysis library; the interface offers 128, 256, and 512 Hz.

The baseline removes each epoch's mean, applies a Hamming window, estimates
8–13 Hz power using an FFT, and fits a standardized nearest-centroid classifier
on C3/C4 log-power features. It holds out the final 20% of epochs for each class
in recording order and reports accuracy, balanced accuracy, and a confusion
matrix. This is a simple within-recording demonstration, not a validated
classifier; it does not perform notch/band-pass filtering, artifact rejection,
cross-session validation, or personal calibration. Inspect and preprocess data
appropriately before interpreting features.

Processing stays in your browser tab. Files are not uploaded by the workbench.
It has no headset or streaming connection, no real-time inference, and no
hardware/device-control output. It is not medical software or a validated brain
technology interface.

## Human motor cortex reference

The playground focuses on **primary motor cortex (M1)** in the precentral
gyrus. Its diagram shows the classic broad medial-to-lateral somatotopic
organization—leg/foot, trunk, arm/hand, and face/mouth—described in human
cortical stimulation mapping and studied with modern functional imaging.

This is a focused teaching schematic, not an individual brain scan, precise
atlas boundary map, or exact body-part-to-cortex correspondence. Motor
representations overlap and involve distributed populations. The workbench
does not load imaging data or model real motor physiology.

Sources: [Penfield & Boldrey, human cortical stimulation maps](https://doi.org/10.1093/brain/60.4.389);
[Human Connectome Project](https://www.humanconnectome.org/study/hcp-young-adult);
[HCP task-fMRI methods](https://doi.org/10.1016/j.neuroimage.2013.05.033).

## Run a simulation

Requires Python 3.10 or newer; there are no third-party dependencies.

```powershell
python braincode.py examples\simple_perceiver.brain --signal 0.9 --signal 0.8 --signal 0.2
```

The program prints whether the neuron fired, the evolving attention state, and
whether the decision threshold was crossed. Input signals and thresholds are
normalized from `0` to `1`.

## Language sketch

BrainCode mixes readable, indentation-based blocks with familiar JavaScript
declarations. Braces and semicolons are also supported, so either style works:

```text
brain SimplePerceiver:
  input stimulus: Signal
  memory recent(capacity=8)
  neuron detector(threshold=0.65)
  state attention = 0.0

  on stimulus as signal:
    const response = detector.fire(signal)
    recent.store(response)
    attention = learn(attention, from=response, rate=0.4)
    if attention > 0.5:
      decide "notice"
```

Equivalent brace-style blocks can use `let` or `const`, optional semicolons,
and `if (attention > 0.5) { ... }`. Existing BrainCode programs using
`decide "notice" when attention > 0.5` remain supported. Python code and
JavaScript code are not embedded or executed: these are BrainCode syntax
choices interpreted by its own small runtime.

```text
brain SimplePerceiver {
  input stimulus: Signal;
  memory recent(capacity: 8);
  neuron detector(threshold: 0.65);
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
```

Each input is compared with the neuron's threshold. The learning rule moves
`attention` toward the neuron response by the configured rate; memory retains
the most recent responses. The interpreter intentionally supports one input,
one neuron, one state, and one decision rule so the behavior stays easy to
inspect.

## Tests

```powershell
python -m unittest
node --test test_bti.js
```
