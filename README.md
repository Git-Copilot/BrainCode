# BrainCode Motor Cortex Atlas

BrainCode is an interactive browser atlas focused on the human primary motor
cortex (M1). The main view renders a rotatable left-hemisphere cortical surface
from an ICBM152 template mesh. An expandable schematic summarizes the broad
medial-to-lateral body map described in classic human cortical stimulation
work.

Try the [BrainCode Motor Cortex Atlas](https://git-copilot.github.io/BrainCode/).
The 3D viewer loads NiiVue 0.69.0 from jsDelivr, so an internet connection is
needed to display the surface.

## BrainCode language

[Explore the BrainCode language showcase](https://git-copilot.github.io/BrainCode/language.html).

The `.brain` language runs small, event-driven neural simulations. A program
declares a normalized signal input, rolling memory, one or more threshold
neurons, and persistent states; its `on` handler describes what happens for
each input sample. It supports `let`/`const`, arithmetic and comparisons,
`and`/`or`/`not`, nested `if`/`else`, rolling-window statistics, state updates,
decisions, and named output signals. Indentation-based blocks and brace-based
blocks are both accepted.

```brain
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
```

Run a stream of normalized samples from the repository root:

```powershell
python braincode.py examples/simple_perceiver.brain --signal 0.6 --signal 0.9 --signal 0.1 --json
```

Each input advances persistent state and rolling memory. JSON mode emits a
machine-readable result for each sample, including states, decisions, and
explicitly emitted signals. Expressions are interpreted from a restricted
operator/function allowlist; BrainCode source is not executed as Python.
Inputs and neuron thresholds are normalized to `0`–`1`. This is a lightweight
simulation language, not a hardware driver, validated BCI, or clinical tool.

## Surface assets and provenance

The surface mesh and motor-labeled example layer are from NiiVue's demo image
directory, pinned to commit
[`2a060d5`](https://github.com/niivue/niivue/tree/2a060d5f64a15094a5147f3eae42d3382333f206/packages/niivue/demos/images).
Their local copies are in `assets/brain/`. NiiVue's BSD 2-Clause license is
included in `assets/brain/NIIVUE-LICENSE.txt`.

The surface is standard-template geometry, not an individual scan. The bundled
motor layer is labeled as a motor example in NiiVue's demo assets, but its file
does not provide study-level provenance. It is included for visualization and
must not be treated as measured activity or a validated functional atlas.

## Schematic values CSV

The optional side panel lets you explore normalized values on the schematic
only; it does not recolor the 3D surface. CSV files need `gene`, `region`, and
`expression` columns. Expression values must already be normalized from `0` to
`1`. Each row assigns one value to a broad M1 body-map region:

| Region ID | Display |
|---|---|
| `leg_foot` | Leg / foot |
| `trunk` | Trunk |
| `arm` | Arm |
| `hand` | Hand / fingers |
| `face` | Face |
| `tongue` | Mouth / tongue |

```csv
gene,region,expression
GENE-X,leg_foot,0.82
GENE-X,trunk,0.61
GENE-X,arm,0.34
GENE-X,hand,0.73
GENE-X,face,0.22
GENE-X,tongue,0.47
```

The built-in demo profiles are invented examples, not genes or observed
expression. Imported CSV values are displayed as supplied; the page does not
normalize or validate their biological provenance, and data stays in the
browser.

## Scientific scope

The schematic summarizes classic human stimulation mapping
([Penfield & Boldrey](https://doi.org/10.1093/brain/60.4.389)). Functional
representations overlap and vary between people; this broad map is not an
individual atlas. The command field only highlights schematic regions. It does
not decode brain signals, alter the 3D example layer, or control a device.
BrainCode makes no biological or clinical predictions.

## Tests

```powershell
node --test test_expression.js
node --test test_biocode.js
python -m unittest
```
