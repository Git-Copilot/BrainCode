#!/usr/bin/env python3
"""Interpreter for BrainCode, a small event-driven neural simulation language."""

from __future__ import annotations

import argparse
import ast
import csv
import json
import math
import operator
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


class BrainCodeError(Exception):
    """Raised when a BrainCode program is invalid."""


@dataclass(frozen=True)
class Neuron:
    name: str
    threshold: float


@dataclass(frozen=True)
class Statement:
    kind: str
    value: str = ""
    expression: str = ""
    body: tuple[Statement, ...] = ()
    otherwise: tuple[Statement, ...] = ()


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
    neurons: dict[str, Neuron] = field(default_factory=dict)
    initial_states: dict[str, float] = field(default_factory=dict)
    body: tuple[Statement, ...] = ()
    input_kind: str = "Signal"
    sample_rate_hz: int | None = None
    window_samples: int | None = None
    step_samples: int | None = None
    channels: tuple[str, ...] = ()


def _strip_comment(line: str) -> str:
    quoted = False
    escaped = False
    for index, character in enumerate(line):
        if escaped:
            escaped = False
        elif character == "\\" and quoted:
            escaped = True
        elif character == '"':
            quoted = not quoted
        elif character == "#" and not quoted:
            return line[:index]
    return line


def _normalise_lines(source: str) -> list[tuple[int, str]]:
    lines: list[tuple[int, str]] = []
    brace_depth = 0
    for number, raw_line in enumerate(source.splitlines(), start=1):
        if "\t" in raw_line:
            raise BrainCodeError(f"line {number}: use spaces, not tabs")
        content = _strip_comment(raw_line).strip()
        if not content:
            continue
        raw_indent = len(raw_line) - len(raw_line.lstrip(" "))
        content = re.sub(r";+$", "", content).rstrip()
        while content.startswith("}"):
            brace_depth -= 1
            if brace_depth < 0:
                raise BrainCodeError(f"line {number}: unexpected closing brace")
            content = content[1:].lstrip()
        if not content:
            continue
        if content.endswith("{"):
            content = content[:-1].rstrip() + ":"
            lines.append((max(raw_indent, 2 * brace_depth), content))
            brace_depth += 1
            continue
        lines.append((max(raw_indent, 2 * brace_depth), content))
    if brace_depth:
        raise BrainCodeError("unmatched brace block")
    return lines


_NUMBER = r"(?:\d+(?:\.\d*)?|\.\d+)"
_IDENTIFIER = r"[A-Za-z_]\w*"
_DECLARATIONS = {
    "brain": re.compile(rf"brain ({_IDENTIFIER}):"),
    "input": re.compile(rf"input ({_IDENTIFIER}): (Signal|EEG)"),
    "memory": re.compile(rf"memory ({_IDENTIFIER})\(capacity\s*[:=]\s*(\d+)\)"),
    "neuron": re.compile(rf"neuron ({_IDENTIFIER})\(threshold\s*[:=]\s*({_NUMBER})\)"),
    "state": re.compile(rf"state ({_IDENTIFIER})\s*=\s*(-?{_NUMBER})"),
    "sample_rate": re.compile(r"sample_rate\s+(\d+)\s*Hz"),
    "window": re.compile(r"window\s+(\d+)\s*samples(?:\s+step\s+(\d+)\s*samples)?"),
    "channels": re.compile(rf"channels\s+({_IDENTIFIER}(?:\s*,\s*{_IDENTIFIER})*)"),
    "on": re.compile(rf"on ({_IDENTIFIER}) as ({_IDENTIFIER}):"),
}


def _normalise_expression(expression: str) -> str:
    expression = re.sub(r"\bfrom\s*[:=]\s*", "", expression)
    expression = re.sub(r"\brate\s*:\s*", "rate=", expression)
    if expression.startswith("(") and expression.endswith(")"):
        depth = 0
        wraps_all = True
        for index, character in enumerate(expression):
            if character == "(":
                depth += 1
            elif character == ")":
                depth -= 1
                if depth == 0 and index != len(expression) - 1:
                    wraps_all = False
                    break
        if wraps_all and depth == 0:
            expression = expression[1:-1]
    return expression


def _parse_block(lines: list[tuple[int, str]], position: int, indent: int) -> tuple[tuple[Statement, ...], int]:
    statements: list[Statement] = []
    while position < len(lines):
        line_indent, line = lines[position]
        if line_indent < indent:
            break
        if line_indent > indent:
            raise BrainCodeError(f"unexpected indentation: {line}")

        if line == "else:":
            break

        conditional = re.fullmatch(r"if\s+(.+):", line)
        legacy_decision = re.fullmatch(r'decide "([^"]+)" when (.+)', line)
        if legacy_decision:
            decision, condition = legacy_decision.groups()
            body = (Statement("decide", value=decision),)
            otherwise: tuple[Statement, ...] = ()
            statements.append(Statement("if", expression=condition, body=body, otherwise=otherwise))
            position += 1
            continue
        if conditional:
            if position + 1 >= len(lines) or lines[position + 1][0] <= indent:
                raise BrainCodeError("if block must contain an indented body")
            body, position = _parse_block(lines, position + 1, lines[position + 1][0])
            otherwise = ()
            if position < len(lines) and lines[position] == (indent, "else:"):
                if position + 1 >= len(lines) or lines[position + 1][0] <= indent:
                    raise BrainCodeError("else block must contain an indented body")
                otherwise, position = _parse_block(lines, position + 1, lines[position + 1][0])
            statements.append(Statement(
                "if",
                expression=_normalise_expression(conditional.group(1)),
                body=body,
                otherwise=otherwise,
            ))
            continue

        decide = re.fullmatch(r'decide "([^"]+)"', line)
        if decide:
            statements.append(Statement("decide", value=decide.group(1)))
            position += 1
            continue
        emit = re.fullmatch(r'emit "([^"]+)"(?:\s*,\s*(.+))?', line)
        if emit:
            statements.append(Statement(
                "emit",
                value=emit.group(1),
                expression=_normalise_expression(emit.group(2) or "true"),
            ))
            position += 1
            continue
        assignment = re.fullmatch(rf"(?:let|const|var)\s+({_IDENTIFIER})\s*=\s*(.+)", line)
        if assignment:
            statements.append(Statement(
                "let",
                value=assignment.group(1),
                expression=_normalise_expression(assignment.group(2)),
            ))
            position += 1
            continue
        assignment = re.fullmatch(rf"({_IDENTIFIER})\s*=\s*(.+)", line)
        if assignment:
            statements.append(Statement(
                "assign",
                value=assignment.group(1),
                expression=_normalise_expression(assignment.group(2)),
            ))
            position += 1
            continue
        store = re.fullmatch(rf"({_IDENTIFIER})\.store\((.+)\)", line)
        if store:
            statements.append(Statement(
                "store",
                value=store.group(1),
                expression=_normalise_expression(store.group(2)),
            ))
            position += 1
            continue
        raise BrainCodeError(f"invalid statement: {line}")
    return tuple(statements), position


def parse(source: str) -> Program:
    """Parse BrainCode declarations and an indented event-handler program."""
    lines = _normalise_lines(source)
    if not lines:
        raise BrainCodeError("empty BrainCode program")

    declarations: dict[str, list[tuple[str, ...]]] = {
        key: [] for key in (
            "brain", "input", "memory", "neuron", "state",
            "sample_rate", "window", "channels",
        )
    }
    handler_index = None
    brain_indent = None
    for index, (indent, line) in enumerate(lines):
        if _DECLARATIONS["brain"].fullmatch(line):
            if brain_indent is not None:
                raise BrainCodeError("program needs exactly one brain declaration")
            brain_indent = indent
            declarations["brain"].append(_DECLARATIONS["brain"].fullmatch(line).groups())
            continue
        handler = _DECLARATIONS["on"].fullmatch(line)
        if handler:
            if brain_indent is None or indent <= brain_indent:
                raise BrainCodeError("input handler must be indented inside the brain block")
            handler_index = index
            event_input, binding = handler.groups()
            break
        matched = False
        for key in declarations:
            match = _DECLARATIONS[key].fullmatch(line)
            if match:
                if brain_indent is None or indent <= brain_indent:
                    raise BrainCodeError(f"{key} declaration must be in the indented body of the brain")
                declarations[key].append(match.groups())
                matched = True
                break
        if not matched:
            raise BrainCodeError(f"invalid BrainCode declaration: {line}")

    if handler_index is None:
        raise BrainCodeError("missing input handler")
    if len(declarations["brain"]) != 1 or len(declarations["input"]) != 1:
        raise BrainCodeError("program needs exactly one brain and one input declaration")
    brain_name = declarations["brain"][0][0]
    input_name, input_kind = declarations["input"][0]
    if input_kind == "Signal":
        if len(declarations["memory"]) != 1:
            raise BrainCodeError("Signal programs need exactly one memory declaration")
        if not declarations["neuron"]:
            raise BrainCodeError("Signal programs need at least one neuron declaration")
        if not declarations["state"]:
            raise BrainCodeError("Signal programs need at least one state declaration")
        if any(declarations[key] for key in ("sample_rate", "window", "channels")):
            raise BrainCodeError("EEG declarations require an EEG input")
    else:
        for key in ("sample_rate", "window", "channels"):
            if len(declarations[key]) != 1:
                raise BrainCodeError(f"EEG programs need exactly one {key.replace('_', ' ')} declaration")
        if len(declarations["memory"]) > 1:
            raise BrainCodeError("EEG programs may declare memory only once")

    memory_name, capacity_text = declarations["memory"][0] if declarations["memory"] else ("recent", "1")
    if event_input != input_name:
        raise BrainCodeError("input handler must reference the declared input")

    sample_rate_hz = None
    window_samples = None
    step_samples = None
    channels: tuple[str, ...] = ()
    if input_kind == "EEG":
        sample_rate_hz = int(declarations["sample_rate"][0][0])
        window_text, step_text = declarations["window"][0]
        window_samples = int(window_text)
        step_samples = int(step_text) if step_text else window_samples
        channels = tuple(channel.strip() for channel in declarations["channels"][0][0].split(","))
        if sample_rate_hz < 1:
            raise BrainCodeError("sample rate must be at least 1 Hz")
        if window_samples < 2:
            raise BrainCodeError("EEG window must contain at least 2 samples")
        if step_samples < 1 or step_samples > window_samples:
            raise BrainCodeError("EEG step must be between 1 and the window size")
        if len(set(channels)) != len(channels):
            raise BrainCodeError("EEG channel names must be unique")

    neurons: dict[str, Neuron] = {}
    for neuron_name, threshold_text in declarations["neuron"]:
        if neuron_name in neurons:
            raise BrainCodeError(f"duplicate neuron declaration: {neuron_name}")
        threshold = float(threshold_text)
        if not 0.0 <= threshold <= 1.0:
            raise BrainCodeError(f"neuron {neuron_name} threshold must be between 0 and 1")
        neurons[neuron_name] = Neuron(neuron_name, threshold)

    states: dict[str, float] = {}
    for state_name, initial_text in declarations["state"]:
        if state_name in states:
            raise BrainCodeError(f"duplicate state declaration: {state_name}")
        initial = float(initial_text)
        if input_kind == "Signal" and not 0.0 <= initial <= 1.0:
            raise BrainCodeError(f"state {state_name} must be between 0 and 1")
        if not math.isfinite(initial):
            raise BrainCodeError(f"state {state_name} must be finite")
        states[state_name] = initial

    capacity = int(capacity_text)
    if capacity < 1:
        raise BrainCodeError("memory capacity must be at least 1")
    if not neurons and input_kind == "Signal":
        raise BrainCodeError("Signal programs need at least one neuron declaration")

    handler_indent, _ = lines[handler_index]
    if handler_index + 1 >= len(lines) or lines[handler_index + 1][0] <= handler_indent:
        raise BrainCodeError("input handler must contain an indented body")
    body, next_index = _parse_block(lines, handler_index + 1, lines[handler_index + 1][0])
    if next_index != len(lines):
        raise BrainCodeError(f"unexpected declaration or statement: {lines[next_index][1]}")

    for statement in _walk_statements(body):
        if statement.kind == "store" and statement.value != memory_name:
            raise BrainCodeError(f"store must reference declared memory {memory_name}")
        if statement.kind == "store" and not declarations["memory"]:
            raise BrainCodeError("memory.store requires a memory declaration")
        if statement.kind == "assign" and statement.value not in states:
            raise BrainCodeError(f"assignment to undeclared state or local: {statement.value}")

    primary_neuron_name, primary_neuron = next(iter(neurons.items()), ("detector", Neuron("detector", 0.5)))
    primary_state_name, primary_state_value = next(iter(states.items()), ("confidence", 0.0))
    decision = next(
        (statement.value for statement in _walk_statements(body) if statement.kind == "decide"),
        "decision",
    )
    decision_threshold = 0.5
    for statement in _walk_statements(body):
        condition = re.fullmatch(
            rf"{re.escape(primary_state_name)}\s*>\s*({_NUMBER})",
            statement.expression,
        )
        if statement.kind == "if" and condition:
            decision_threshold = float(condition.group(1))
            break
    return Program(
        name=brain_name,
        input_name=input_name,
        memory_name=memory_name,
        memory_capacity=capacity,
        neuron_name=primary_neuron_name,
        threshold=primary_neuron.threshold,
        state_name=primary_state_name,
        initial_state=primary_state_value,
        binding_name=binding,
        response_name="response",
        learning_rate=0.4,
        decision=decision,
        decision_threshold=decision_threshold,
        neurons=neurons,
        initial_states=states,
        body=body,
        input_kind=input_kind,
        sample_rate_hz=sample_rate_hz,
        window_samples=window_samples,
        step_samples=step_samples,
        channels=channels,
    )


def _walk_statements(statements: tuple[Statement, ...]):
    for statement in statements:
        yield statement
        yield from _walk_statements(statement.body)
        yield from _walk_statements(statement.otherwise)


_BINARY_OPERATORS = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.Mod: operator.mod,
}
_COMPARISON_OPERATORS = {
    ast.Eq: operator.eq,
    ast.NotEq: operator.ne,
    ast.Lt: operator.lt,
    ast.LtE: operator.le,
    ast.Gt: operator.gt,
    ast.GtE: operator.ge,
}


def _power_spectrum(samples: list[float]) -> tuple[list[float], int]:
    """Return one-sided Hann-windowed FFT powers and their FFT size."""
    size = 1 << (len(samples) - 1).bit_length()
    real = [0.0] * size
    imaginary = [0.0] * size
    scale = max(abs(sample) for sample in samples)
    if scale == 0:
        return [0.0] * (size // 2 + 1), size
    scaled = [sample / scale for sample in samples]
    mean = math.fsum(scaled) / len(scaled)
    for index, sample in enumerate(samples):
        taper = 0.5 - 0.5 * math.cos(2 * math.pi * index / (len(samples) - 1))
        real[index] = (scaled[index] - mean) * taper

    reversed_index = 0
    for index in range(1, size):
        bit = size >> 1
        while reversed_index & bit:
            reversed_index ^= bit
            bit >>= 1
        reversed_index ^= bit
        if index < reversed_index:
            real[index], real[reversed_index] = real[reversed_index], real[index]
            imaginary[index], imaginary[reversed_index] = imaginary[reversed_index], imaginary[index]

    length = 2
    while length <= size:
        angle = -2 * math.pi / length
        step_real = math.cos(angle)
        step_imaginary = math.sin(angle)
        for start in range(0, size, length):
            twiddle_real = 1.0
            twiddle_imaginary = 0.0
            half = length // 2
            for offset in range(half):
                even = start + offset
                odd = even + half
                product_real = (
                    real[odd] * twiddle_real - imaginary[odd] * twiddle_imaginary
                )
                product_imaginary = (
                    real[odd] * twiddle_imaginary + imaginary[odd] * twiddle_real
                )
                real[odd] = real[even] - product_real
                imaginary[odd] = imaginary[even] - product_imaginary
                real[even] += product_real
                imaginary[even] += product_imaginary
                twiddle_real, twiddle_imaginary = (
                    twiddle_real * step_real - twiddle_imaginary * step_imaginary,
                    twiddle_real * step_imaginary + twiddle_imaginary * step_real,
                )
        length *= 2

    powers = [
        real[index] * real[index] + imaginary[index] * imaginary[index]
        for index in range(size // 2 + 1)
    ]
    return powers, size


class _Expression:
    def __init__(
        self,
        simulation: Simulation,
        variables: dict[str, Any],
    ) -> None:
        self.simulation = simulation
        self.variables = variables

    def evaluate(self, expression: str) -> Any:
        try:
            node = ast.parse(expression, mode="eval").body
            return self._visit(node)
        except BrainCodeError:
            raise
        except (SyntaxError, ArithmeticError, TypeError, ValueError) as error:
            raise BrainCodeError(f"invalid expression {expression!r}: {error}") from error

    def _visit(self, node: ast.AST) -> Any:
        if isinstance(node, ast.Constant) and isinstance(node.value, (bool, float, int, str)):
            return node.value
        if isinstance(node, ast.Name):
            if node.id in self.variables:
                return self.variables[node.id]
            if node.id == "true":
                return True
            if node.id == "false":
                return False
            if node.id == "pi":
                return 3.141592653589793
            raise BrainCodeError(f"unknown value: {node.id}")
        if isinstance(node, ast.BinOp) and type(node.op) in _BINARY_OPERATORS:
            return _BINARY_OPERATORS[type(node.op)](self._visit(node.left), self._visit(node.right))
        if isinstance(node, ast.UnaryOp):
            value = self._visit(node.operand)
            if isinstance(node.op, ast.Not):
                return not value
            if isinstance(node.op, ast.USub):
                return -value
            if isinstance(node.op, ast.UAdd):
                return +value
        if isinstance(node, ast.BoolOp):
            if isinstance(node.op, ast.And):
                return all(self._visit(value) for value in node.values)
            if isinstance(node.op, ast.Or):
                return any(self._visit(value) for value in node.values)
        if isinstance(node, ast.Compare):
            left = self._visit(node.left)
            for operation, comparator in zip(node.ops, node.comparators):
                if type(operation) not in _COMPARISON_OPERATORS:
                    break
                right = self._visit(comparator)
                if not _COMPARISON_OPERATORS[type(operation)](left, right):
                    return False
                left = right
            else:
                return True
        if isinstance(node, ast.Call):
            arguments = [self._visit(argument) for argument in node.args]
            keywords = {
                keyword.arg: self._visit(keyword.value)
                for keyword in node.keywords
                if keyword.arg is not None
            }
            if any(keyword.arg is None for keyword in node.keywords):
                raise BrainCodeError("expanded keyword arguments are not supported")
            if isinstance(node.func, ast.Name):
                if node.func.id == "learn":
                    if len(arguments) == 2 and "rate" in keywords:
                        arguments.append(keywords["rate"])
                    if (
                        len(arguments) != 3
                        or keywords.keys() - {"rate"}
                        or (len(node.args) == 3 and "rate" in keywords)
                    ):
                        raise BrainCodeError("learn expects current value, observation, and rate")
                    current, observation, rate = map(float, arguments)
                    if not all(0 <= value <= 1 for value in (current, observation, rate)):
                        raise BrainCodeError("learn values and rate must be between 0 and 1")
                    return current + rate * (observation - current)
                if node.func.id in {
                    "mean", "rms", "line_length", "peak_to_peak", "bandpower"
                } and not keywords:
                    if node.func.id == "bandpower":
                        if len(arguments) != 4:
                            raise BrainCodeError('bandpower expects an EEG frame, channel name, low Hz, and high Hz')
                        frame, channel, low_hz, high_hz = arguments
                        return self.simulation._bandpower(
                            frame, str(channel), float(low_hz), float(high_hz)
                        )
                    if len(arguments) != 2:
                        raise BrainCodeError(f"{node.func.id} expects an EEG frame and channel name")
                    frame, channel = arguments
                    samples = self.simulation._channel_samples(frame, str(channel))
                    if node.func.id == "mean":
                        scale = max(abs(sample) for sample in samples)
                        return 0.0 if scale == 0 else scale * (
                            math.fsum(sample / scale for sample in samples) / len(samples)
                        )
                    if node.func.id == "rms":
                        scale = max(abs(sample) for sample in samples)
                        return 0.0 if scale == 0 else scale * math.sqrt(
                            math.fsum((sample / scale) ** 2 for sample in samples) / len(samples)
                        )
                    if node.func.id == "line_length":
                        scale = max(abs(sample) for sample in samples)
                        if scale == 0:
                            return 0.0
                        value = scale * math.fsum(
                            abs(right / scale - left / scale)
                            for left, right in zip(samples, samples[1:])
                        )
                    else:
                        scale = max(abs(sample) for sample in samples)
                        value = 0.0 if scale == 0 else scale * (
                            max(sample / scale for sample in samples)
                            - min(sample / scale for sample in samples)
                        )
                    if not math.isfinite(value):
                        raise BrainCodeError(f"{node.func.id} feature exceeds the finite numeric range")
                    return value
                functions = {"abs": abs, "min": min, "max": max, "round": round}
                if node.func.id in functions and not keywords:
                    return functions[node.func.id](*arguments)
            if isinstance(node.func, ast.Attribute) and isinstance(node.func.value, ast.Name):
                owner = node.func.value.id
                method = node.func.attr
                if owner in self.simulation.program.neurons and method == "fire":
                    if len(arguments) != 1:
                        raise BrainCodeError(f"{owner}.fire expects one value")
                    value = float(arguments[0])
                    self.simulation._validate_signal(value)
                    return value >= self.simulation.program.neurons[owner].threshold
                if owner == self.simulation.program.memory_name:
                    if arguments:
                        raise BrainCodeError(f"{owner}.{method} does not take arguments")
                    return self.simulation._memory_value(method)
            raise BrainCodeError("unsupported function or method call")
        raise BrainCodeError(f"unsupported expression element: {type(node).__name__}")


@dataclass
class Simulation:
    program: Program
    attention: float = field(init=False)
    recent: list[bool | float] = field(default_factory=list)
    states: dict[str, float] = field(init=False)
    last_outputs: list[dict[str, Any]] = field(default_factory=list)
    last_decision: str | None = None
    current_window: dict[str, list[float]] = field(default_factory=dict)
    spectrum_cache: dict[str, tuple[list[float], int]] = field(default_factory=dict)

    def __post_init__(self) -> None:
        self.states = dict(self.program.initial_states or {
            self.program.state_name: self.program.initial_state
        } if self.program.state_name else {})
        self.attention = self.states.get(self.program.state_name, 0.0)

    @staticmethod
    def _validate_signal(signal: float) -> None:
        if not 0.0 <= signal <= 1.0:
            raise BrainCodeError(f"signal must be between 0 and 1, got {signal}")

    def _validate_state(self, value: float) -> None:
        if not math.isfinite(value):
            raise BrainCodeError("state values must be finite")
        if self.program.input_kind == "Signal":
            self._validate_signal(value)

    def _memory_value(self, method: str) -> float | int | bool:
        if method == "count":
            return len(self.recent)
        if method == "last":
            return self.recent[-1] if self.recent else 0.0
        if method in {"mean", "ratio"}:
            mean = sum(float(value) for value in self.recent) / len(self.recent) if self.recent else 0.0
            return mean > 0.5 if method == "ratio" else mean
        raise BrainCodeError(f"unknown memory method: {method}")

    def _channel_samples(self, frame: Any, channel: str) -> list[float]:
        if self.program.input_kind != "EEG":
            raise BrainCodeError("EEG channel features require an EEG input")
        if frame is not self.current_window:
            raise BrainCodeError("EEG features must use the current input frame")
        if channel not in self.program.channels:
            raise BrainCodeError(f"undeclared EEG channel: {channel}")
        if channel not in self.current_window:
            raise BrainCodeError(f"no current window for EEG channel: {channel}")
        return self.current_window[channel]

    def _bandpower(self, frame: Any, channel: str, low_hz: float, high_hz: float) -> float:
        samples = self._channel_samples(frame, channel)
        sample_rate = self.program.sample_rate_hz
        if not math.isfinite(low_hz) or not math.isfinite(high_hz):
            raise BrainCodeError("bandpower frequencies must be finite")
        if low_hz < 0 or high_hz <= low_hz or high_hz > sample_rate / 2:
            raise BrainCodeError(f"bandpower range must be within 0..{sample_rate / 2:g} Hz")

        if channel not in self.spectrum_cache:
            self.spectrum_cache[channel] = _power_spectrum(samples)
        powers, fft_size = self.spectrum_cache[channel]
        first_bin = max(1, math.ceil(low_hz * fft_size / sample_rate))
        last_bin = min(len(powers) - 1, math.floor(high_hz * fft_size / sample_rate))
        if first_bin > last_bin:
            raise BrainCodeError(
                "bandpower range has no frequency bins at this sample rate; widen the band or use a longer window"
            )
        total_power = powers[0] + powers[-1] + 2 * sum(powers[1:-1])
        if total_power == 0:
            return 0.0
        band_power = 2 * sum(powers[first_bin:last_bin + 1])
        if last_bin == len(powers) - 1:
            band_power -= powers[last_bin]
        return min(1.0, band_power / total_power)

    def _execute(
        self,
        statements: tuple[Statement, ...],
        variables: dict[str, Any],
        outputs: list[dict[str, Any]],
    ) -> None:
        evaluator = _Expression(self, variables)
        for statement in statements:
            if statement.kind in {"assign", "let"}:
                value = evaluator.evaluate(statement.expression)
                variables[statement.value] = value
                if statement.value in self.states:
                    numeric = float(value)
                    self._validate_state(numeric)
                    self.states[statement.value] = numeric
            elif statement.kind == "store":
                value = evaluator.evaluate(statement.expression)
                if isinstance(value, (int, float, bool)):
                    self.recent.append(value)
                    del self.recent[:-self.program.memory_capacity]
                else:
                    raise BrainCodeError("memory.store accepts only numeric or boolean values")
            elif statement.kind == "if":
                branch = statement.body if evaluator.evaluate(statement.expression) else statement.otherwise
                self._execute(branch, variables, outputs)
            elif statement.kind == "decide":
                outputs.append({"type": "decision", "label": statement.value})
            elif statement.kind == "emit":
                value = evaluator.evaluate(statement.expression)
                if not isinstance(value, (bool, int, float, str)):
                    raise BrainCodeError("emit accepts only scalar values")
                if isinstance(value, float) and not math.isfinite(value):
                    raise BrainCodeError("emit values must be finite")
                outputs.append({
                    "type": "signal",
                    "label": statement.value,
                    "value": value,
                })
            else:
                raise BrainCodeError(f"unsupported statement: {statement.kind}")

    def step(self, signal: float) -> tuple[bool, bool]:
        """Process one normalized input and return (primary_neuron_fired, decided)."""
        if self.program.input_kind != "Signal":
            raise BrainCodeError("EEG programs must be run with CSV windows, not --signal")
        self._validate_signal(signal)
        return self._run_sample(signal)

    def step_window(self, window: dict[str, list[float]]) -> tuple[bool, bool]:
        """Process one multichannel EEG window."""
        if self.program.input_kind != "EEG":
            raise BrainCodeError("Signal programs cannot process EEG windows")
        expected = self.program.window_samples
        normalized: dict[str, list[float]] = {}
        for channel in self.program.channels:
            samples = window.get(channel)
            if samples is None or len(samples) != expected:
                raise BrainCodeError(f"channel {channel} needs exactly {expected} samples per window")
            if not all(math.isfinite(sample) for sample in samples):
                raise BrainCodeError(f"channel {channel} contains a non-finite sample")
            normalized[channel] = samples
        self.current_window = normalized
        self.spectrum_cache.clear()
        return self._run_sample(0.0)

    def _run_sample(self, signal: float) -> tuple[bool, bool]:
        outputs: list[dict[str, Any]] = []
        variables: dict[str, Any] = dict(self.states)
        variables[self.program.binding_name] = (
            self.current_window if self.program.input_kind == "EEG" else signal
        )
        variables["signal"] = signal
        self._execute(self.program.body, variables, outputs)
        self.last_outputs = outputs
        decision = next(
            (item["label"] for item in reversed(outputs) if item["type"] == "decision"),
            None,
        )
        self.last_decision = decision
        self.states.update({
            name: float(variables[name])
            for name in self.states
            if name in variables and isinstance(variables[name], (int, float, bool))
        })
        self.attention = self.states.get(self.program.state_name, 0.0)
        primary_fired = signal >= self.program.threshold
        return primary_fired, decision is not None


def read_eeg_csv(path: Path, channels: tuple[str, ...]) -> dict[str, list[float]]:
    """Read continuous EEG samples from a CSV with one named column per channel."""
    try:
        with path.open(newline="", encoding="utf-8-sig") as file:
            reader = csv.DictReader(file)
            headers = [header.strip() for header in (reader.fieldnames or [])]
            if not headers:
                raise BrainCodeError("EEG CSV needs a header row with channel names")
            reader.fieldnames = headers
            if len(set(headers)) != len(headers):
                raise BrainCodeError("EEG CSV column names must be unique")
            missing = [channel for channel in channels if channel not in headers]
            if missing:
                raise BrainCodeError(f"EEG CSV is missing channel(s): {', '.join(missing)}")
            samples = {channel: [] for channel in channels}
            for line, row in enumerate(reader, start=2):
                if None in row:
                    raise BrainCodeError(f"EEG CSV line {line}: too many columns")
                for channel in channels:
                    try:
                        value = float((row.get(channel) or "").strip())
                    except ValueError as error:
                        raise BrainCodeError(
                            f"EEG CSV line {line}: {channel} must be a numeric sample"
                        ) from error
                    if not math.isfinite(value):
                        raise BrainCodeError(f"EEG CSV line {line}: {channel} must be finite")
                    samples[channel].append(value)
    except UnicodeDecodeError as error:
        raise BrainCodeError("EEG CSV must be UTF-8 encoded") from error
    except csv.Error as error:
        raise BrainCodeError(f"invalid EEG CSV: {error}") from error
    if not samples or not next(iter(samples.values())):
        raise BrainCodeError("EEG CSV needs at least one sample row")
    return samples


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run a BrainCode signal or EEG replay")
    parser.add_argument("program", type=Path, help="path to a .brain file")
    inputs = parser.add_mutually_exclusive_group(required=True)
    inputs.add_argument(
        "--signal",
        type=float,
        action="append",
        help="normalized input signal (0 to 1); repeat to process a sequence",
    )
    inputs.add_argument("--csv", type=Path, help="multichannel EEG sample CSV for an EEG program")
    parser.add_argument("--json", action="store_true", help="print one JSON result per input")
    args = parser.parse_args(argv)

    try:
        program = parse(args.program.read_text(encoding="utf-8"))
        simulation = Simulation(program)
        if program.input_kind == "EEG":
            if args.csv is None:
                raise BrainCodeError("EEG programs require --csv")
            samples = read_eeg_csv(args.csv, program.channels)
            window_size = program.window_samples
            step_size = program.step_samples
            windows = range(0, len(next(iter(samples.values()))) - window_size + 1, step_size)
            if len(windows) == 0:
                raise BrainCodeError(
                    f"EEG CSV contains fewer than {window_size} samples required by the window"
                )
            if not args.json:
                print(
                    f"BrainCode EEG replay: {program.name} "
                    f"({program.sample_rate_hz} Hz, {len(windows)} windows)"
                )
            for index, start in enumerate(windows, start=1):
                frame = {
                    channel: values[start:start + window_size]
                    for channel, values in samples.items()
                }
                _, decided = simulation.step_window(frame)
                result = {
                    "window": index,
                    "sample_start": start,
                    "sample_end": start + window_size,
                    "time_start_s": start / program.sample_rate_hz,
                    "sample_rate_hz": program.sample_rate_hz,
                    "states": simulation.states,
                    "decision": simulation.last_decision if decided else None,
                    "outputs": simulation.last_outputs,
                }
                if args.json:
                    print(json.dumps(result, separators=(",", ":")))
                else:
                    print(
                        f"{index}: samples={start}:{start + window_size} "
                        f"decision={simulation.last_decision or 'none'}"
                    )
                    for output in simulation.last_outputs:
                        if output["type"] == "signal":
                            print(f"  emit {output['label']}={output['value']}")
        else:
            if args.signal is None:
                raise BrainCodeError("Signal programs require --signal")
            if not args.json:
                print(f"BrainCode simulation: {program.name}")
            for index, signal in enumerate(args.signal, start=1):
                fired, decided = simulation.step(signal)
                result = {
                    "step": index,
                    "signal": signal,
                    "fired": fired,
                    "states": simulation.states,
                    "decision": simulation.last_decision if decided else None,
                    "outputs": simulation.last_outputs,
                }
                if args.json:
                    print(json.dumps(result, separators=(",", ":")))
                else:
                    print(
                        f"{index}: signal={signal:.3f} fired={str(fired).lower()} "
                        f"states={json.dumps(simulation.states, sort_keys=True)} "
                        f"decision={simulation.last_decision or 'none'}"
                    )
                    for output in simulation.last_outputs:
                        if output["type"] == "signal":
                            print(f"  emit {output['label']}={output['value']}")
        return 0
    except (OSError, BrainCodeError) as error:
        print(f"braincode: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
