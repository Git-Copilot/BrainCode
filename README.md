# BrainCode Motor Cortex Atlas

BrainCode is an interactive browser atlas focused on the human primary motor
cortex (M1). The main view renders a rotatable left-hemisphere cortical surface
from an ICBM152 template mesh. User-provided normalized regional values can
color approximate M1 zones on the real surface and the expandable body-map
schematic.

Try the [BrainCode Motor Cortex Atlas](https://git-copilot.github.io/BrainCode/).
The 3D viewer loads NiiVue 0.69.0 from jsDelivr, so an internet connection is
needed to display the surface.

## BrainCode for BCI prototyping

[Explore the BrainCode language showcase](https://git-copilot.github.io/BrainCode/language.html).

BrainCode can replay multichannel EEG recordings from CSV in overlapping
windows, compute channel features, classify patterns, and emit event labels
and telemetry as JSON. For example, the included motor-pattern program reads
`C3` and `C4`, compares their normalized 8–13 Hz band power, and emits a label:

```powershell
python braincode.py examples/motor_imagery.brain --csv RECORDING.csv --json
```

The CSV needs one header per declared EEG channel (such as `C3,C4`), followed
by uniformly sampled numeric rows. The program declares the sampling rate and
window/step sizes in samples. `bandpower(frame, channel, low_hz, high_hz)`
returns the fraction of window power in a frequency band using a Hann-windowed
FFT; the spectrum is computed once per channel and reused within each window.
`mean`, `rms`, `line_length`, and `peak_to_peak` provide additional channel
features useful for checking amplitude and artifacts. EEG state variables can
hold finite feature values in the recording's units. Add
`emit` statements for telemetry and `decide` statements for intent labels.
JSON mode emits one record per window with sample/time offsets, decisions,
states, and emitted values.

The original normalized-signal simulator remains available with repeated
`--signal` arguments. Both modes use a restricted expression allowlist;
BrainCode source is not executed as Python. EEG mode is offline CSV replay: it
does not acquire live signals or control hardware. The example labels are
illustrative, not a trained classifier or medical interpretation. Validate
feature extraction, calibration, latency, and safety independently before
considering any real BCI/BTI application.

## Surface assets and provenance

The surface mesh is from NiiVue's demo image directory, pinned to commit
[`2a060d5`](https://github.com/niivue/niivue/tree/2a060d5f64a15094a5147f3eae42d3382333f206/packages/niivue/demos/images).
Their local copies are in `assets/brain/`. NiiVue's BSD 2-Clause license is
included in `assets/brain/NIIVUE-LICENSE.txt`.

The surface is standard-template geometry, not an individual scan. No values
are preloaded. When a profile is supplied, the viewer projects each broad M1
region's value onto approximate surface zones based on mesh coordinates; this
is a visualization, not measured per-vertex expression. A local `file://`
preview retrieves the pinned template mesh from the repository; the 3D viewer
also loads NiiVue from jsDelivr.

## M1 expression projection CSV

Create a blank profile in the page or import a CSV with `gene`, `region`, and
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

Imported CSV values are displayed on both the schematic and the approximate
3D M1 surface zones. The page does not normalize or validate their biological
provenance, and data stays in the browser.

## Scientific scope

The schematic summarizes classic human stimulation mapping
([Penfield & Boldrey](https://doi.org/10.1093/brain/60.4.389)). Functional
representations overlap and vary between people; this broad map is not an
individual atlas. The command field only highlights schematic regions. It does
not decode brain signals, alter the 3D surface, or control a device.
BrainCode makes no biological or clinical predictions.

## Tests

```powershell
node --test test_expression.js
node --test test_biocode.js
python -m unittest
```
