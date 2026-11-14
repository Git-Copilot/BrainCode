"""A small, repository-scoped MCP server for BrainCode development."""

from __future__ import annotations

import math
import os
from pathlib import Path, PureWindowsPath
from typing import Any

from mcp.server.fastmcp import FastMCP
from mcp.types import ToolAnnotations

from braincode import BrainCodeError, Simulation, parse


WORKSPACE_ROOT = Path(__file__).resolve().parent
MAX_SOURCE_CHARS = 100_000
MAX_INPUTS = 256
MAX_EEG_SAMPLES = 100_000
MAX_FILE_BYTES = 200_000
MAX_SEARCH_RESULTS = 100
TEXT_SUFFIXES = {".brain", ".css", ".html", ".js", ".json", ".md", ".py", ".toml", ".ts", ".tsx", ".yaml", ".yml"}
BLOCKED_PARTS = {".git", ".venv", "__pycache__", "node_modules", "assets", ".github"}
BLOCKED_NAMES = {"credentials.json", "secrets.json", "id_rsa", "id_ed25519"}

mcp = FastMCP("BrainCode")


def _is_finite_number(value: Any) -> bool:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return False
    try:
        return math.isfinite(float(value))
    except OverflowError:
        return False


def _validate_program(source: str) -> dict[str, Any]:
    if not isinstance(source, str) or not source.strip():
        raise ValueError("source must be a non-empty BrainCode program")
    if len(source) > MAX_SOURCE_CHARS:
        raise ValueError(f"source exceeds the {MAX_SOURCE_CHARS}-character limit")
    try:
        program = parse(source)
    except BrainCodeError as error:
        return {"valid": False, "error": str(error)}
    return {
        "valid": True,
        "brain": program.name,
        "input_kind": program.input_kind,
        "channels": list(program.channels),
        "sample_rate_hz": program.sample_rate_hz,
        "window_samples": program.window_samples,
        "step_samples": program.step_samples,
    }


def _run_program(
    source: str,
    signals: list[float] | None = None,
    eeg_samples: dict[str, list[float]] | None = None,
) -> dict[str, Any]:
    info = _validate_program(source)
    if not info["valid"]:
        raise ValueError(info["error"])
    program = parse(source)
    simulation = Simulation(program)
    results: list[dict[str, Any]] = []

    if program.input_kind == "Signal":
        if eeg_samples is not None or signals is None:
            raise ValueError("Signal programs require signals and do not accept eeg_samples")
        if not isinstance(signals, list) or not 1 <= len(signals) <= MAX_INPUTS:
            raise ValueError(f"signals must contain between 1 and {MAX_INPUTS} values")
        for index, value in enumerate(signals):
            if not _is_finite_number(value):
                raise ValueError(f"signal {index} must be a finite number")
            simulation.step(float(value))
            results.append({
                "index": index,
                "decision": simulation.last_decision,
                "outputs": simulation.last_outputs,
                "states": simulation.states.copy(),
            })
        return {"program": program.name, "input_kind": "Signal", "results": results}

    if signals is not None or eeg_samples is None:
        raise ValueError("EEG programs require eeg_samples and do not accept signals")
    if not isinstance(eeg_samples, dict) or set(eeg_samples) != set(program.channels):
        raise ValueError(f"eeg_samples must contain exactly these channels: {', '.join(program.channels)}")
    if not eeg_samples or any(not isinstance(samples, list) for samples in eeg_samples.values()):
        raise ValueError("each EEG channel must map to a list of samples")
    lengths = {len(samples) for samples in eeg_samples.values()}
    if len(lengths) != 1:
        raise ValueError("EEG channels must contain the same number of samples")
    sample_count = lengths.pop()
    if sample_count < program.window_samples:
        raise ValueError(f"EEG input needs at least {program.window_samples} samples per channel")
    if sample_count > MAX_EEG_SAMPLES:
        raise ValueError(f"EEG input exceeds the {MAX_EEG_SAMPLES}-sample limit per channel")
    for channel, samples in eeg_samples.items():
        if any(
            not _is_finite_number(value)
            for value in samples
        ):
            raise ValueError(f"EEG channel {channel} contains a non-finite or non-numeric sample")

    window_count = 1 + (sample_count - program.window_samples) // program.step_samples
    if window_count > MAX_INPUTS:
        raise ValueError(f"EEG input creates more than {MAX_INPUTS} windows")
    for index, offset in enumerate(range(0, sample_count - program.window_samples + 1, program.step_samples)):
        window = {
            channel: [float(value) for value in eeg_samples[channel][offset:offset + program.window_samples]]
            for channel in program.channels
        }
        simulation.step_window(window)
        results.append({
            "index": index,
            "sample_offset": offset,
            "decision": simulation.last_decision,
            "outputs": simulation.last_outputs,
            "states": simulation.states.copy(),
        })
    return {"program": program.name, "input_kind": "EEG", "results": results}


def _workspace_file(relative_path: str) -> Path:
    if not isinstance(relative_path, str) or not relative_path or "\0" in relative_path:
        raise ValueError("path must be a non-empty repository-relative path")
    windows_path = PureWindowsPath(relative_path)
    path = Path(relative_path)
    if path.is_absolute() or windows_path.is_absolute() or windows_path.drive:
        raise ValueError("absolute paths are not allowed")
    parts = path.parts
    if not parts or any(part in {"..", "."} for part in parts):
        raise ValueError("path traversal is not allowed")
    if any(part.startswith(".") or part.casefold() in BLOCKED_PARTS for part in parts):
        raise ValueError("hidden, generated, asset, and workflow paths are not accessible")
    if path.name.casefold() in BLOCKED_NAMES:
        raise ValueError("sensitive credential files are not accessible")
    if path.suffix.casefold() not in TEXT_SUFFIXES:
        raise ValueError("only supported text source and documentation files are accessible")

    resolved = (WORKSPACE_ROOT / path).resolve(strict=True)
    try:
        resolved.relative_to(WORKSPACE_ROOT)
    except ValueError as error:
        raise ValueError("path resolves outside the repository") from error
    if not resolved.is_file() or resolved.stat().st_size > MAX_FILE_BYTES:
        raise ValueError(f"file must be a regular file no larger than {MAX_FILE_BYTES} bytes")
    return resolved


def _workspace_files() -> list[Path]:
    files = []
    for directory, directories, filenames in os.walk(WORKSPACE_ROOT, followlinks=False):
        current = Path(directory)
        directories[:] = [
            name for name in directories
            if not name.startswith(".")
            and name.casefold() not in BLOCKED_PARTS
            and not (current / name).is_symlink()
        ]
        for name in filenames:
            path = current / name
            if name.casefold() in BLOCKED_NAMES or path.suffix.casefold() not in TEXT_SUFFIXES:
                continue
            try:
                if not path.is_symlink() and path.stat().st_size <= MAX_FILE_BYTES:
                    files.append(path)
            except OSError:
                continue
    return sorted(files)


@mcp.tool(annotations=ToolAnnotations(readOnlyHint=True, destructiveHint=False, idempotentHint=True, openWorldHint=False))
def validate_braincode(source: str) -> dict[str, Any]:
    """Parse BrainCode source and report its input mode and EEG declarations. Does not execute it."""
    return _validate_program(source)


@mcp.tool(annotations=ToolAnnotations(readOnlyHint=True, destructiveHint=False, idempotentHint=True, openWorldHint=False))
def run_braincode(
    source: str,
    signals: list[float] | None = None,
    eeg_samples: dict[str, list[float]] | None = None,
) -> dict[str, Any]:
    """Run BrainCode against bounded synthetic signal values or caller-provided EEG samples; no device access."""
    return _run_program(source, signals, eeg_samples)


@mcp.tool(annotations=ToolAnnotations(readOnlyHint=True, destructiveHint=False, idempotentHint=True, openWorldHint=False))
def read_repository_file(path: str) -> dict[str, str]:
    """Read one supported text file inside this repository; hidden, asset, workflow, and generated paths are blocked."""
    target = _workspace_file(path)
    try:
        return {"path": target.relative_to(WORKSPACE_ROOT).as_posix(), "content": target.read_text(encoding="utf-8")}
    except UnicodeDecodeError as error:
        raise ValueError("file is not UTF-8 text") from error


@mcp.tool(annotations=ToolAnnotations(readOnlyHint=True, destructiveHint=False, idempotentHint=True, openWorldHint=False))
def search_repository(query: str, max_results: int = 50) -> dict[str, Any]:
    """Search supported repository text files without accessing hidden, asset, workflow, or generated paths."""
    if not isinstance(query, str) or not query.strip():
        raise ValueError("query must be non-empty")
    if len(query) > 200:
        raise ValueError("query must not exceed 200 characters")
    if isinstance(max_results, bool) or not isinstance(max_results, int) or not 1 <= max_results <= MAX_SEARCH_RESULTS:
        raise ValueError(f"max_results must be between 1 and {MAX_SEARCH_RESULTS}")
    matches = []
    needle = query.casefold()
    for path in _workspace_files():
        try:
            content = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        for number, line in enumerate(content.splitlines(), start=1):
            if needle in line.casefold():
                matches.append({
                    "path": path.relative_to(WORKSPACE_ROOT).as_posix(),
                    "line": number,
                    "text": line[:500],
                })
                if len(matches) >= max_results:
                    return {"matches": matches, "truncated": True}
    return {"matches": matches, "truncated": False}


@mcp.tool(annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=True, idempotentHint=False, openWorldHint=False))
def replace_repository_text(path: str, old_text: str, new_text: str) -> dict[str, Any]:
    """Replace one exact, unique text span in a supported repository file. No commands, network, or outside paths."""
    if not isinstance(old_text, str) or not old_text:
        raise ValueError("old_text must be a non-empty exact text span")
    if not isinstance(new_text, str):
        raise ValueError("new_text must be text")
    target = _workspace_file(path)
    try:
        content = target.read_text(encoding="utf-8")
    except UnicodeDecodeError as error:
        raise ValueError("file is not UTF-8 text") from error
    occurrences = content.count(old_text)
    if occurrences != 1:
        raise ValueError(f"old_text must match exactly once; found {occurrences} matches")
    updated = content.replace(old_text, new_text, 1)
    if len(updated.encode("utf-8")) > MAX_FILE_BYTES:
        raise ValueError(f"updated file exceeds the {MAX_FILE_BYTES}-byte limit")
    target.write_text(updated, encoding="utf-8", newline="")
    return {"path": target.relative_to(WORKSPACE_ROOT).as_posix(), "replacements": 1}


if __name__ == "__main__":
    mcp.run(transport="stdio")
