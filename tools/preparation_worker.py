#!/usr/bin/env python3
"""Accelerated Execution preparation worker.

This process is intentionally preparation-only.
It analyzes media and writes machine-readable hints for After Effects.
It does not modify an After Effects project.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
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


def main() -> None:
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
