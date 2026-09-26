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
