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

Timestamps are canonical throughout analysis and scene plans. Frame numbers MAY be included for
confirmed constant-frame-rate footage, but MUST NOT be synthesized from an average frame rate for
variable-frame-rate media. Every scene plan identifies its source file and media timebase so the
host bridge can refuse to apply an anchor to unrelated footage.

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

## CEP analysis flow

The panel asks the isolated ExtendScript bridge for the selected footage path, then starts the
Node sidecar without invoking a shell. The sidecar streams structured progress events and writes
analysis data plus local JPEG previews to a temporary output directory. Users select one ranked
anchor per shot; the panel converts those selections into a validated scene plan and can move the
active After Effects composition to an anchor for visual confirmation. Anchor navigation maps
source frames through the selected footage layer's start time and stretch; trimmed-out and
time-remapped anchors are rejected rather than navigating to an incorrect composition time. The
panel can also apply the plan as managed layer markers. Application validates every anchor before
opening a single AE undo group, preserves user-authored markers, and replaces only markers carrying
the Accelerated Execution prefix. These markers stage later tracking and masking execution; they do
not claim that the routed task has already run.

## Target coordinates

An optional task target is captured on the selected, uncropped preview. A click produces a point;
a two-dimensional drag produces a box. Both use `normalized-source` coordinates in the inclusive
0–1 range so the plan remains independent of preview resolution and panel size. Changing the
anchor candidate clears its target because a region selected on one decoded frame must not silently
carry over to another.

## Execution routing

Each generated task has a primary `engine` and `action`. Optional fallbacks are ordered and carry
an explicit condition: `unavailable`, `quality-failed`, or `semantic-ambiguity`. Roto boxes prefer
AE Object Matte and fall back to Roto Brush; efficient and maximum modes may then use local SAM
segmentation, while only maximum mode may add a vision-provider fallback. Native mode never emits
AI fallbacks. A route describes intended execution and does not imply that its provider has run.

## Native static-mask execution

The first executable action is `ae-native / static-mask`. Before mutation, the host verifies the
selected footage path, source dimensions, task action, box bounds, and shot times. Each normalized
box becomes a rectangular mask in layer source coordinates. Hold-interpolated Mask Opacity keys
activate it only over the visible portion of its shot. Re-execution removes only masks with the
Accelerated Execution prefix, preserves user masks, and runs in one AE undo group. Shots entirely
outside a trimmed layer are reported as skipped; time-remapped layers remain unsupported.
Static-mask tasks carry bounded feather and expansion parameters that map to AE Mask Feather and
Mask Expansion. Execution also reports suspicious normalized target coverage below 0.1% or above
90% of the source frame. Coverage warnings are advisory and do not silently rewrite user input.

## Execution reports

Successful host execution produces `execution-report.json` beside the analysis output. The report
binds back to the scene-plan source identity and records the destination composition and layer,
summary counts, and one durable outcome per shot. Supported statuses are `completed`, `warning`,
`failed`, and `skipped`; recommendations include target review, layer-range adjustment, anchor retry,
and advancing to the next fallback. Summary counts are validated against the shot outcomes so later
retry orchestration does not depend on transient panel messages.
