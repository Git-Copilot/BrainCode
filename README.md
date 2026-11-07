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

## Human functional-atlas reference

The playground shows the seven broad cortical functional networks from the
human Yeo et al. atlas: visual, somatomotor, dorsal attention, ventral
attention, limbic, frontoparietal control, and default mode. The atlas also
provides a 17-network parcellation. These groupings were estimated from
resting-state functional connectivity in 1,000 healthy adults, and the Human
Connectome Project provides further large-scale human structural and functional
neuroimaging data.

The colored lateral and medial views are orientation schematics—not the
original atlas surfaces, exact region boundaries, or individual-specific scan
data. Functional connectivity means correlated activity; it does not by itself
establish direct anatomical connections or causation. These datasets do not
provide a human synapse-level whole-brain map, and BrainCode does not load or
simulate the atlas data. This is a research reference, not a validated BTI or
clinical model.

Sources: [Yeo 7/17 network atlas](https://surfer.nmr.mgh.harvard.edu/fswiki/CorticalParcellation_Yeo2011);
[Yeo et al., *Journal of Neurophysiology* (2011)](https://doi.org/10.1152/jn.00338.2011);
[Human Connectome Project](https://www.humanconnectome.org/study/hcp-young-adult).

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
