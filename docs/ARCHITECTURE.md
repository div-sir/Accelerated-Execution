# Architecture

## Goal

Accelerated Execution accelerates repetitive After Effects work without replacing After Effects.

AI MUST make small semantic decisions. Native AE tools SHOULD execute tracking, roto, keyframes, masks, and compositing whenever possible.

## MVP pipeline

```text
Footage
  -> FFmpeg/OpenCV pre-analysis
  -> keyframe candidates
  -> local decision layer
  -> optional Vision fallback
  -> action router
  -> After Effects host scripts
  -> quality check
  -> retry only failed regions
```

## Tool routing

| Scene target | Preferred execution path |
| --- | --- |
| Person / object | Object Matte or Roto Brush |
| Hair / fine edge | Roto + Refine Edge |
| Road / wall / screen | Planar tracking / Mocha AE |
| Sign / point feature | Motion Tracker -> Null |
| Camera motion | 3D Camera Tracker |
| Static region | Static mask |

## Keyframe policy

A keyframe is task-specific. Do not use one global keyframe for a shot.

The local analyzer scores candidate frames using sharpness, motion, visibility, occlusion, and trackability. Vision MAY choose between a small candidate set. AE MUST validate the result by executing the track. Failed spans are re-initialized from a new anchor.

## AI budget policy

1. Use deterministic local analysis first.
2. Use a small local model for classification or routing when required.
3. Use a vision model only for semantic ambiguity.
4. Never send every frame to a cloud model by default.

## Extension platform

The MVP uses a CEP panel plus ExtendScript because After Effects still exposes its mature automation surface there. The host bridge MUST remain isolated so a later UXP migration does not affect the analysis engine.

## Modules

```text
extension/
  panel UI
  AE host bridge
core/
  schemas
  routing rules
sidecar/
  FFmpeg/OpenCV/AI orchestration
assets/
  reusable effect presets
```
