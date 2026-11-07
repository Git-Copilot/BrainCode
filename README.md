# BrainCode

BrainCode is a tiny, experimental language for describing **brain-inspired
simulations**: threshold neurons, short-term signal memory, a simple learning
rule, and decisions. It is an educational software model, not a model of a
whole brain, a medical tool, or a way to connect to or control a biological
brain.

Try the [BrainCode Playground](https://git-copilot.github.io/BrainCode/) in your
browser. It includes a front-view, nerves-only schematic of selected major
human nervous-system pathways alongside the simulator. The nerve-map panel is an
interactive 3D schematic: drag to orbit, scroll or pinch to zoom, or use the
Front, Side, and Reset views.

## Mapped brain reference

The playground includes a schematic coverage view for the **MICrONS mouse
visual-cortex dataset**. MICrONS paired visual-response recordings with
electron-microscopy anatomy in the same cortical tissue, spanning all six
layers of primary visual cortex (V1) and higher visual areas LM, AL, and RL.
The dataset site reports roughly 75,000 functionally recorded pyramidal
neurons, over 200,000 reconstructed cells, and more than 523 million detected
synapses in approximately 1 mm³ of cortex from a P87 mouse. Direct matching
between functional recordings and reconstructed cells is available only for a
subset.

The illustration is a coverage schematic, not the measured cell layout or a
connectivity reconstruction. BrainCode's interpreter does not load or simulate
MICrONS data. This mouse dataset is a research reference—not a human brain map,
a validated brain-tech interface model, or a clinical tool.

Sources: [MICrONS dataset and explorer](https://www.microns-explorer.org/cortical-mm3);
[MICrONS Consortium, *Nature* (2025)](https://doi.org/10.1038/s41586-025-08790-w).

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
```
