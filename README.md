# BrainCode

BrainCode is an experimental **biotech protocol language and workflow
simulator**. Write protocols with samples, reagents, liquid transfers, mixing,
incubation, measurements, and reports; run them locally in the
[BrainCode playground](https://git-copilot.github.io/BrainCode/).

## Protocol language

```text
protocol DemoAssay:
  sample specimen volume=50 uL signal=0.72
  reagent buffer volume=200 uL

  step prepare:
    transfer 100 uL from buffer to specimen
    mix specimen for 30 seconds
  step read:
    incubate specimen for 5 minutes at 25 C
    measure signal of specimen as response
  report response
```

Indentation defines protocol blocks. Declare at least one sample and reagent,
then list ordered steps. Volumes support `uL` and `mL`; durations support
seconds and minutes. Samples require a normalized `signal` from 0 to 1, which
is a fictional tracer value used only to demonstrate measurement and dilution.
Reagent signal defaults to zero. Transfers update remaining volumes and blend
that tracer by volume. `mix` and `incubate` are recorded in the trace only.
Measurements read the simulated signal, and `report` names a value measured
earlier in the protocol.

The runner checks syntax, indentation, declared containers, positive volumes,
transfer overdraw, and measurement/report references. It runs in the browser
without uploading data, connecting to equipment, or calling a service. The
same parser and simulator can be tested with Node:

```powershell
node --test test_biocode.js
```

This is a language and bookkeeping demonstration, **not** a validated
biological model or a source of laboratory procedures. Incubation and mixing
do not model kinetics or outcomes, and the simulator does not assess safety or
real-world protocol suitability. Never use its output to run experiments or
control lab equipment.

## Earlier brain-simulation example

The repository also retains the original small neuron/learning demo as a
separate Python interpreter. It is not the biotech protocol simulator.

```powershell
python -m unittest
python braincode.py examples\simple_perceiver.brain --signal 0.9 --signal 0.8 --signal 0.2
```
