#!/usr/bin/env python3
"""A tiny interpreter for BrainCode, a brain-inspired simulation language."""

from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path


class BrainCodeError(Exception):
    """Raised when a BrainCode program is invalid."""


@dataclass
class Program:
    name: str
    input_name: str
    memory_name: str
    memory_capacity: int
    neuron_name: str
    threshold: float
    state_name: str
    initial_state: float
    binding_name: str
    response_name: str
    learning_rate: float
    decision: str
    decision_threshold: float


@dataclass
class Simulation:
    program: Program
    attention: float = field(init=False)
    recent: list[bool] = field(default_factory=list)

    def __post_init__(self) -> None:
        self.attention = self.program.initial_state

    def step(self, signal: float) -> tuple[bool, bool]:
        """Process one normalized signal and return (neuron_fired, decided)."""
        if not 0.0 <= signal <= 1.0:
            raise BrainCodeError(f"signal must be between 0 and 1, got {signal}")

        fired = signal >= self.program.threshold
        self.recent.append(fired)
        del self.recent[:-self.program.memory_capacity]
        self.attention += self.program.learning_rate * (
            float(fired) - self.attention
        )
        decided = self.attention > self.program.decision_threshold
        return fired, decided


_NUMBER = r"(?:\d+(?:\.\d*)?|\.\d+)"


def parse(source: str) -> Program:
    """Parse BrainCode's indentation, brace, and mixed-style block syntax."""
    lines: list[tuple[int, str]] = []
    brace_headers = 0
    brace_closers = 0
    for line_number, raw_line in enumerate(source.splitlines(), start=1):
        if "\t" in raw_line:
            raise BrainCodeError(f"line {line_number}: use spaces, not tabs")
        content = raw_line.split("#", 1)[0].strip()
        if not content:
            continue
        indent = len(raw_line) - len(raw_line.lstrip(" "))
        content = re.sub(r";+$", "", content).rstrip()
        if content == "}":
            brace_closers += 1
            continue
        if content.endswith("{"):
            brace_headers += 1
            content = content[:-1].rstrip() + ":"
        lines.append((indent, content))

    if brace_headers != brace_closers:
        raise BrainCodeError("unmatched brace block")

    patterns = [
        (rf"brain ([A-Za-z_]\w*):", "brain"),
        (r"input ([A-Za-z_]\w*): Signal", "input"),
        (r"memory ([A-Za-z_]\w*)\(capacity\s*[:=]\s*(\d+)\)", "memory"),
        (rf"neuron ([A-Za-z_]\w*)\(threshold\s*[:=]\s*({_NUMBER})\)", "neuron"),
        (rf"state ([A-Za-z_]\w*) = ({_NUMBER})", "state"),
        (r"on ([A-Za-z_]\w*) as ([A-Za-z_]\w*):", "on"),
        (
            r"(?:let|const|var) ([A-Za-z_]\w*)(?:\s*:\s*[A-Za-z_]\w*)? = "
            r"([A-Za-z_]\w*)\.fire\(([A-Za-z_]\w*)\)",
            "fire",
        ),
        (r"([A-Za-z_]\w*)\.store\(([A-Za-z_]\w*)\)", "store"),
        (
            rf"([A-Za-z_]\w*) = learn\(([A-Za-z_]\w*), from\s*[:=]\s*"
            rf"([A-Za-z_]\w*), rate\s*[:=]\s*({_NUMBER})\)",
            "learn",
        ),
        (
            rf'decide "([^"]+)" when ([A-Za-z_]\w*) > ({_NUMBER})',
            "decide",
        ),
    ]

    if len(lines) not in (10, 11):
        raise BrainCodeError(
            "incomplete program: expected a brain, declarations, and one input handler"
        )

    values: dict[str, tuple[str, ...]] = {}
    for index, (pattern, key) in enumerate(patterns):
        if index >= len(lines):
            break
        indent, line = lines[index]
        match = re.fullmatch(pattern, line)
        if match is None:
            break
        values[key] = match.groups()
        if line.endswith(":"):
            if index + 1 >= len(lines) or lines[index + 1][0] <= indent:
                raise BrainCodeError(f"{key} block must contain an indented body")

    required = {"brain", "input", "memory", "neuron", "state", "on", "fire", "store", "learn"}
    if "decide" not in values:
        conditional_match = None
        if len(lines) >= 10:
            conditional_match = re.fullmatch(
                rf"if\s+\(?([A-Za-z_]\w*)\s*>\s*({_NUMBER})\)?\s*:",
                lines[9][1],
            )
        if conditional_match is None or len(lines) != 11:
            invalid_index = min(len(values), len(lines) - 1)
            invalid_line = lines[invalid_index][1] if lines else ""
            raise BrainCodeError(f"invalid BrainCode declaration: {invalid_line}")

        values["if"] = conditional_match.groups()
        if lines[10][0] <= lines[9][0]:
            raise BrainCodeError("if block must contain an indented body")
        decision_match = re.fullmatch(r'decide "([^"]+)"', lines[10][1])
        if decision_match is None:
            raise BrainCodeError(f"invalid decision declaration: {lines[10][1]}")
        values["decide"] = (
            decision_match.group(1),
            values["if"][0],
            values["if"][1],
        )
    if "decide" not in values:
        raise BrainCodeError("missing decision rule")
    if not required.issubset(values):
        raise BrainCodeError("missing required BrainCode declaration")
    if len(lines) != (11 if "if" in values else 10):
        raise BrainCodeError(
            f"unexpected statements: found {len(lines)} non-empty statements"
        )

    name = values["brain"][0]
    input_name = values["input"][0]
    memory_name, capacity_text = values["memory"]
    neuron_name, threshold_text = values["neuron"]
    state_name, initial_text = values["state"]
    event_input, binding_name = values["on"]
    response_name, fire_neuron, fire_binding = values["fire"]
    store_memory, stored_response = values["store"]
    learned_state, learn_state, learn_response, rate_text = values["learn"]
    decision, decision_state, decision_threshold_text = values["decide"]

    if event_input != input_name or fire_neuron != neuron_name:
        raise BrainCodeError("on/fire references must match declared input and neuron")
    if fire_binding != binding_name or stored_response != response_name:
        raise BrainCodeError("signal and response references must match their declarations")
    if store_memory != memory_name:
        raise BrainCodeError("store must reference the declared memory")
    if learned_state != state_name or learn_state != state_name:
        raise BrainCodeError("learn must update the declared state")
    if learn_response != response_name:
        raise BrainCodeError("learn must use the declared neuron response")
    if decision_state != state_name:
        raise BrainCodeError("decision must check the declared state")

    capacity = int(capacity_text)
    threshold = float(threshold_text)
    initial_state = float(initial_text)
    learning_rate = float(rate_text)
    decision_threshold = float(decision_threshold_text)
    if capacity < 1:
        raise BrainCodeError("memory capacity must be at least 1")
    if not 0.0 <= threshold <= 1.0:
        raise BrainCodeError("neuron threshold must be between 0 and 1")
    if not 0.0 <= initial_state <= 1.0:
        raise BrainCodeError("state must be between 0 and 1")
    if not 0.0 < learning_rate <= 1.0:
        raise BrainCodeError("learning rate must be greater than 0 and at most 1")
    if not 0.0 <= decision_threshold <= 1.0:
        raise BrainCodeError("decision threshold must be between 0 and 1")

    return Program(
        name=name,
        input_name=input_name,
        memory_name=memory_name,
        memory_capacity=capacity,
        neuron_name=neuron_name,
        threshold=threshold,
        state_name=state_name,
        initial_state=initial_state,
        binding_name=binding_name,
        response_name=response_name,
        learning_rate=learning_rate,
        decision=decision,
        decision_threshold=decision_threshold,
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run a BrainCode simulation")
    parser.add_argument("program", type=Path, help="path to a .brain file")
    parser.add_argument(
        "--signal",
        type=float,
        action="append",
        required=True,
        help="normalized input signal (0 to 1); repeat to process a sequence",
    )
    args = parser.parse_args(argv)

    try:
        program = parse(args.program.read_text(encoding="utf-8"))
        simulation = Simulation(program)
        print(f"BrainCode simulation: {program.name}")
        for index, signal in enumerate(args.signal, start=1):
            fired, decided = simulation.step(signal)
            status = f"decision={program.decision}" if decided else "decision=none"
            print(
                f"{index}: signal={signal:.3f} fired={str(fired).lower()} "
                f"attention={simulation.attention:.3f} {status}"
            )
        return 0
    except (OSError, BrainCodeError) as error:
        print(f"braincode: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
