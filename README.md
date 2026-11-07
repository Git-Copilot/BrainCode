# BrainCode

BrainCode is a tiny, experimental language for describing **brain-inspired
simulations**: threshold neurons, short-term signal memory, a simple learning
rule, and decisions. It is an educational software model, not a model of a
whole brain, a medical tool, or a way to connect to or control a biological
brain.

Try the [BrainCode Playground](https://git-copilot.github.io/BrainCode/) in your
browser. It includes a focused, schematic view of the human primary motor
cortex alongside the simulator.

## Human motor cortex reference

The playground focuses on **primary motor cortex (M1)** in the precentral
gyrus. Its diagram shows the classic broad medial-to-lateral somatotopic
organization—leg/foot, trunk, arm/hand, and face/mouth—described in human
cortical stimulation mapping and studied with modern functional imaging.

This is a focused teaching schematic, not an individual brain scan, precise
atlas boundary map, or exact body-part-to-cortex correspondence. Motor
representations overlap and involve distributed populations. The simulator
does not load imaging data or model real motor physiology. The diagram does not
cover speech cortex, which involves interacting language, motor, auditory, and
other systems; it is not a validated BTI or clinical model.

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
```
