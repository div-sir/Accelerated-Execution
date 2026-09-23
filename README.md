# Accelerated Execution

AI-assisted workflow acceleration for Adobe After Effects.

The project uses **After Effects as the execution engine** and keeps AI in a small decision layer. The first goal is fast semantic compositing: select useful keyframes, route work to the correct native AE tool, and only call vision models when local analysis is insufficient.

## Principles

- AE first.
- Local first.
- Cloud AI is optional.
- Use FFmpeg/OpenCV for cheap video analysis.
- Use AI for semantic decisions, not per-frame rendering.
- Keep all AI providers replaceable.

Development continues on feature branches until the MVP is usable.

## Local analysis

Requirements: Node.js 20+ plus `ffmpeg` and `ffprobe` on `PATH`. Override their locations with
`AE_FFMPEG_PATH` and `AE_FFPROBE_PATH` when needed.

```bash
npm run doctor
npm run proxy -- /path/to/footage.mp4 --output ./proxy.mp4 --height 720
npm run analyze -- /path/to/footage.mp4 --output ./analysis
```

The analyzer detects scene cuts, samples three timestamps per shot, calculates deterministic local
sharpness, stability, visibility, and trackability metrics, ranks the candidates, and writes
`analysis.json` plus JPEG previews. Timestamps are canonical so variable-frame-rate footage is not
forced onto an inaccurate average-frame-rate timeline. CFR inputs also receive source-frame labels.
No footage leaves the machine.

In the CEP panel, select a footage layer (or a footage item in the Project panel) and choose
**Analyze selected footage**. The panel launches the same local CLI, reports progress, and shows
three ranked anchor candidates for every detected shot. Choose an anchor, use **Go to anchor in
After Effects** to move the active composition's playhead, then export a schema-valid
`scene-plan.json` containing source identity, media timebase, and timestamp anchors. Navigation
refuses to control a selected layer whose source path differs from the analyzed footage. A running
analysis can be cancelled from the panel and is stopped automatically after 30 minutes. Cancelled,
timed-out, and failed runs remove their panel-owned temporary output; completed results remain
available for preview and scene-plan export. **Apply anchor markers in AE** writes the selected
anchors to the analyzed footage layer in one undo group. Reapplying replaces only markers managed
by Accelerated Execution and refuses to overwrite a user marker on the same frame. The markers are
execution guides; tracking and masking remain explicit later steps. During development, keep the
repository layout intact so the installed/symlinked `extension/` directory remains next to `sidecar/`. Set
`AE_NODE_PATH`, `AE_FFMPEG_PATH`, or `AE_FFPROBE_PATH` when the executables are in custom locations.

Validate a scene plan before handing it to the After Effects host bridge:

```bash
node sidecar/cli.mjs validate ./scene-plan.json
```

Run the repository checks and unit tests with `npm run check`.

## After Effects development install

Install a development symlink into the current user's Adobe CEP extensions directory and inspect
all runtime prerequisites:

```bash
npm run cep:install
npm run cep:doctor
```

Unsigned development extensions require CEP PlayerDebugMode. If the doctor reports it disabled,
enable it explicitly with `npm run cep:debug`, restart After Effects, then open the panel from
**Window → Extensions (Legacy) → Accelerated Execution**. The debug command modifies the current
user's installed Adobe CSXS preference domains only.

Create a self-contained unsigned directory under `dist/` with:

```bash
npm run cep:package
```

The installer refuses to replace an existing directory or a symlink owned by another checkout.
Development installs expose the CEP Chromium debugger on localhost port 8088; `.debug` is excluded
from packaged output.
