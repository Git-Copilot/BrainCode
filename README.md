# BrainCode Expression Atlas

BrainCode's site is an interactive, local expression-profile viewer. A
schematic lateral brain sits beside normalized expression values by broad
region; the neuron-like markers brighten as the selected profile's values
increase. Select a region, edit its value, add a profile, or import/export CSV.

Try the [BrainCode Expression Atlas](https://git-copilot.github.io/BrainCode/).

## Expression CSV

Import a CSV with `gene`, `region`, and `expression` columns. Expression values
must already be normalized from `0` to `1`. Each row assigns one value to a
gene-region pair. Supported region IDs are `frontal`, `motor`, `parietal`,
`occipital`, `temporal`, and `hippocampus`; their displayed names are also
accepted. Example:

```csv
gene,region,expression
GENE-X,frontal,0.82
GENE-X,motor,0.61
GENE-X,parietal,0.34
GENE-X,occipital,0.22
GENE-X,temporal,0.47
GENE-X,hippocampus,0.73
```

The viewer displays imported values as provided; it does not normalize,
interpret, or validate their biological provenance. Data is processed in the
browser and is not uploaded.

## Important limitations

The brain drawing, region positions, node locations, and built-in Demo gene
profiles are illustrative placeholders, not measured data, an anatomical
atlas, or cell-level coordinates. Brightness is only a visual encoding of the
normalized values—not a prediction of gene expression or neuronal activity.
This project does not include a real expression dataset or a biological model.

## Tests

```powershell
node --test test_expression.js
node --test test_biocode.js
python -m unittest
```

The repository retains the separate experimental protocol simulator and
neuron-language example as code; they are not used by the expression-atlas
page.
