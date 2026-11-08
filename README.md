# BrainCode Motor Cortex Atlas

BrainCode is an interactive browser atlas focused on the human primary motor
cortex (M1). The main view renders a rotatable left-hemisphere cortical surface
from an ICBM152 template mesh. An expandable schematic summarizes the broad
medial-to-lateral body map described in classic human cortical stimulation
work.

Try the [BrainCode Motor Cortex Atlas](https://git-copilot.github.io/BrainCode/).
The 3D viewer loads NiiVue 0.69.0 from jsDelivr, so an internet connection is
needed for the viewer library. A bundled copy of the atlas mesh data also
supports file-based local previews where browsers block direct access to
neighboring binary files.

## Surface assets and provenance

The surface mesh is from NiiVue's demo image directory, pinned to commit
[`2a060d5`](https://github.com/niivue/niivue/tree/2a060d5f64a15094a5147f3eae42d3382333f206/packages/niivue/demos/images).
Its local copy is in `assets/brain/`. NiiVue's BSD 2-Clause license is
included in `assets/brain/NIIVUE-LICENSE.txt`.

The surface is standard-template geometry, not an individual scan. It is
displayed in white and gray without a colored motor-activity overlay.

## Regional expression graph and CSV

The expression panel plots the selected profile as a labeled horizontal bar
graph and lists the normalized values by broad M1 region. Use **Download graph
SVG** to save a standalone vector graph, or **Download values CSV** to save the
six values as data. The schematic's expression markers use a warm orange-to-
yellow scale: higher normalized values appear brighter, larger, and glow more.
When an action command is entered, neuron-like pulses travel along the selected
region's connections; higher-expression regions fire larger, faster, brighter
pulses. The command also tints the whole 3D surface orange-to-yellow according
to the mapped region's value. This whole-surface tint is a display cue because
the atlas has no vertex-level expression mapping; it is not measured or
localized activity.

CSV imports need `gene`, `region`, and `expression` columns. Expression values
must already be normalized from `0` to `1`. Each row assigns one value to a
broad M1 body-map region:

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

An action command briefly fires warm pulses across the selected region in the
schematic and tints the 3D brain in proportion to its normalized expression.
The 3D tint covers the whole model because the atlas has no vertex-level
expression mapping; this is a display effect, not measured or predicted neural
activity.

## Scientific scope

The schematic summarizes classic human stimulation mapping
([Penfield & Boldrey](https://doi.org/10.1093/brain/60.4.389)). Functional
representations overlap and vary between people; this broad map is not an
individual atlas. The command field only changes the grayscale display and
schematic. It does not decode brain signals or control a device.
BrainCode makes no biological or clinical predictions.

## Tests

```powershell
node --test test_expression.js
node --test test_biocode.js
python -m unittest
```
