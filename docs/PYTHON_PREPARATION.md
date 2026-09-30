# Python Preparation Layer

## Purpose

Python prepares data for After Effects. It does not render the final composition.

The default user workflow is:

```text
Select footage
  -> Prepare
  -> Python analyzes the footage
  -> preparation package is written
  -> stop
```

No effect is applied automatically.

## Responsibilities

Python MAY:

- analyze shot boundaries;
- score working frames;
- detect foreground objects and planar surfaces;
- create high-confidence masks;
- calculate optical flow and feature points;
- estimate motion;
- create tracking hints;
- prepare procedural coordinates and timing data.

Python MUST NOT duplicate After Effects rendering, animation interpolation, compositing, motion blur, or color management.

## Current integration

FFmpeg still decodes the 160×90 grayscale candidate frames. The Node sidecar sends those frames to
the Python worker in one bounded batch over standard input. Python computes sharpness, temporal
stability, visibility, trackability, and the weighted candidate score, then returns compact JSON.
This keeps media decoding deterministic while moving CV-oriented scoring behind the Python boundary.

If the worker cannot start or returns invalid data, preparation continues with the equivalent
JavaScript implementation unless strict Python scoring was requested. Every `analysis.json` records
`settings.frameMetricsEngine` as `python` or `javascript-fallback`; fallback results also include
`settings.frameMetricsFallback` so degraded environments are visible rather than silent. Set
`AE_PYTHON_PATH` when Python is not available as `python3` on macOS/Linux or `python` on Windows.

## Preparation package

Each job writes a self-contained directory:

```text
preparation/
  preparation.json
  frames/
  masks/
  tracks/
  previews/
```

After Effects consumes this package later. The package is reusable. Analysis does not need to run again when the user changes an effect.

## Execution rule

Use the following priority:

1. deterministic FFmpeg/OpenCV analysis;
2. local CV/ML model when semantic detection is required;
3. optional cloud vision only when local confidence is insufficient;
4. After Effects performs final tracking, roto refinement, animation, compositing, and rendering.

## Product rule

The primary button remains **Prepare selected footage**.

Execution features remain optional until preparation quality is reliable.
