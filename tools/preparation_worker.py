#!/usr/bin/env python3
"""Accelerated Execution preparation worker.

This process is intentionally preparation-only.
It analyzes media and writes machine-readable hints for After Effects.
It does not modify an After Effects project.
"""

from __future__ import annotations

import argparse
import base64
import binascii
import json
import math
from pathlib import Path
import sys
from typing import Any


def package_layout(output: Path) -> dict[str, Path]:
    paths = {
        "root": output,
        "frames": output / "frames",
        "masks": output / "masks",
        "tracks": output / "tracks",
        "previews": output / "previews",
    }
    for path in paths.values():
        path.mkdir(parents=True, exist_ok=True)
    return paths


def write_manifest(output: Path, source: Path, analysis: dict[str, Any] | None = None) -> Path:
    layout = package_layout(output)
    manifest = {
        "version": "0.2",
        "mode": "prepare-only",
        "source": {"path": str(source.resolve())},
        "analysis": analysis or {},
        "artifacts": {
            "frames": "frames",
            "masks": "masks",
            "tracks": "tracks",
            "previews": "previews",
        },
        "policy": {
            "applyToAfterEffects": False,
            "renderFinalFrames": False,
            "cloudVisionRequired": False,
        },
    }
    destination = layout["root"] / "preparation.json"
    destination.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return destination


def _clamp01(value: Any) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0.0
    if not math.isfinite(number):
        return 0.0
    return max(0.0, min(1.0, number))


def score_candidate(metrics: dict[str, Any], weights: dict[str, float] | None = None) -> float:
    values = {
        "sharpness": 0.25,
        "stability": 0.20,
        "visibility": 0.20,
        "trackability": 0.25,
        "occlusion": 0.10,
    }
    if weights:
        values.update(weights)
    return (
        values["sharpness"] * _clamp01(metrics.get("sharpness"))
        + values["stability"] * _clamp01(metrics.get("stability"))
        + values["visibility"] * _clamp01(metrics.get("visibility"))
        + values["trackability"] * _clamp01(metrics.get("trackability"))
        - values["occlusion"] * _clamp01(metrics.get("occlusion"))
    )


def frame_metrics(gray: bytes, previous: bytes, following: bytes, width: int, height: int) -> dict[str, float]:
    pixel_count = width * height
    if width < 3 or height < 3 or len(gray) != pixel_count:
        raise ValueError("current frame dimensions are invalid")
    if len(previous) != pixel_count or len(following) != pixel_count:
        raise ValueError("neighbor frame dimensions do not match")

    total = sum(gray)
    sum_squares = sum(value * value for value in gray)
    laplacian_energy = 0
    gradient_pixels = 0
    for y in range(1, height - 1):
        for x in range(1, width - 1):
            index = y * width + x
            laplacian = (
                4 * gray[index]
                - gray[index - 1]
                - gray[index + 1]
                - gray[index - width]
                - gray[index + width]
            )
            laplacian_energy += laplacian * laplacian
            gradient = abs(gray[index + 1] - gray[index - 1]) + abs(
                gray[index + width] - gray[index - width]
            )
            if gradient > 48:
                gradient_pixels += 1

    mean = total / pixel_count
    variance = max(0.0, sum_squares / pixel_count - mean * mean)
    interior_count = (width - 2) * (height - 2)
    sharpness = min(1.0, laplacian_energy / interior_count / 2500)
    contrast = min(1.0, math.sqrt(variance) / 64)
    exposure = max(0.0, 1 - abs(mean - 127.5) / 127.5)
    visibility = 0.55 * exposure + 0.45 * contrast
    trackability = min(1.0, (gradient_pixels / interior_count) / 0.22)

    motion = 0.0
    for neighbor in (previous, following):
        difference = sum(abs(gray[index] - neighbor[index]) for index in range(pixel_count))
        motion += difference / pixel_count / 255
    motion /= 2
    return {
        "sharpness": sharpness,
        "stability": max(0.0, 1 - motion / 0.20),
        "visibility": visibility,
        "trackability": trackability,
        "occlusion": 0.0,
    }


def _decode_frame(value: Any, expected_length: int, label: str) -> bytes:
    if not isinstance(value, str):
        raise ValueError(f"{label} must be base64 text")
    try:
        frame = base64.b64decode(value, validate=True)
    except (binascii.Error, ValueError) as error:
        raise ValueError(f"{label} is not valid base64") from error
    if len(frame) != expected_length:
        raise ValueError(f"{label} must contain {expected_length} bytes")
    return frame


def score_batch_payload(payload: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(payload, dict) or payload.get("version") != 1:
        raise ValueError("score batch version must be 1")
    width = payload.get("width")
    height = payload.get("height")
    if not isinstance(width, int) or not isinstance(height, int) or width < 3 or height < 3:
        raise ValueError("score batch dimensions are invalid")
    candidates = payload.get("candidates")
    if not isinstance(candidates, list) or not candidates or len(candidates) > 10000:
        raise ValueError("score batch candidates must contain between 1 and 10000 entries")
    expected_length = width * height
    results = []
    for index, candidate in enumerate(candidates):
        if not isinstance(candidate, dict):
            raise ValueError(f"candidate {index} must be an object")
        previous = _decode_frame(candidate.get("previous"), expected_length, f"candidate {index} previous")
        current = _decode_frame(candidate.get("current"), expected_length, f"candidate {index} current")
        following = _decode_frame(candidate.get("next"), expected_length, f"candidate {index} next")
        metrics = frame_metrics(current, previous, following, width, height)
        results.append({"metrics": metrics, "score": score_candidate(metrics)})
    return {"ok": True, "version": 1, "candidates": results}


def score_batch_stream() -> None:
    try:
        payload = json.load(sys.stdin)
        result = score_batch_payload(payload)
    except (json.JSONDecodeError, ValueError, TypeError) as error:
        raise SystemExit(f"Invalid score batch: {error}") from error
    print(json.dumps(result, separators=(",", ":")))


def main() -> None:
    if len(sys.argv) > 1 and sys.argv[1] == "score-batch":
        score_batch_stream()
        return
    parser = argparse.ArgumentParser(description="Prepare footage metadata for Accelerated Execution.")
    parser.add_argument("source", type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()

    if not args.source.is_file():
        raise SystemExit("Source footage does not exist.")

    destination = write_manifest(args.output, args.source)
    print(json.dumps({"ok": True, "manifest": str(destination)}))


if __name__ == "__main__":
    main()
