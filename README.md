# BrainCode Expression Atlas

BrainCode focuses the interactive expression viewer on **human primary motor
cortex (M1)**. A small hemisphere view marks the precentral gyrus; the larger
view zooms into the classic broad functional body map. Select a gene profile to
change the brightness of neuron-like markers, edit normalized values, or
import/export CSV. Enter a simple action such as `move hand`, `walk`, `reach`,
or `speak` to briefly flare its mapped region.

Try the [BrainCode Expression Atlas](https://git-copilot.github.io/BrainCode/).

## Functional regions and expression CSV

CSV files need `gene`, `region`, and `expression` columns. Expression values
must already be normalized from `0` to `1`. Each row assigns one value to a
gene and a broad M1 body-map region:

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

The viewer displays imported values as provided; it does not normalize,
interpret, or validate their biological provenance. Data is processed in the
browser and is not uploaded.

## Scientific scope

The medial-to-lateral body-part arrangement is a broad summary of classic
human motor-cortex stimulation mapping. Representations overlap and vary
between people; this diagram is not a precise or individual atlas. See
[Penfield & Boldrey's human cortical stimulation maps](https://doi.org/10.1093/brain/60.4.389).

This functional map does **not** measure gene expression. The built-in Demo
gene profiles are invented examples to exercise the visualization, not
observations. Brightness only encodes supplied normalized values. The
neuron-like markers are decorative rather than cell locations, and the page
does not make biological or clinical predictions. Action commands only trigger
a timed visual effect on the mapped body region; they are not decoded from
brain signals and do not control a device.

## Tests

```powershell
node --test test_expression.js
node --test test_biocode.js
python -m unittest
```
