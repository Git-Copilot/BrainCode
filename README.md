# BrainCode Motor Cortex Atlas

BrainCode is an interactive browser atlas focused on the human primary motor
cortex (M1). The main view renders a rotatable left-hemisphere cortical surface
from an ICBM152 template mesh. User-provided normalized regional values can
color approximate M1 zones on the real surface and the expandable body-map
schematic.

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

Write a `.brain` program in the blank editor on the showcase page and run it
from the repository root with normalized input values from `0` to `1`:

```powershell
python braincode.py PROGRAM_FILE --signal SIGNAL_VALUE --json
```

Each input advances persistent state and rolling memory. JSON mode emits a
machine-readable result for each sample, including states, decisions, and
explicitly emitted signals. Expressions are interpreted from a restricted
operator/function allowlist; BrainCode source is not executed as Python.
Inputs and neuron thresholds are normalized to `0`–`1`. This is a lightweight
simulation language, not a hardware driver, validated BCI, or clinical tool.

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
