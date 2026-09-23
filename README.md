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

The analyzer detects scene cuts, samples three frames per shot, calculates deterministic local
sharpness, stability, visibility, and trackability metrics, ranks the candidates, and writes
`analysis.json` plus a JPEG preview for each selected frame. No footage leaves the machine.

In the CEP panel, select a footage layer (or a footage item in the Project panel) and choose
**Analyze selected footage**. The panel launches the same local CLI, reports progress, and shows
three ranked anchor candidates for every detected shot. Choose an anchor, use **Go to anchor in
After Effects** to move the active composition's playhead, then export a schema-valid
`scene-plan.json` for the selected task and execution mode. During development, keep the repository layout
intact so the installed/symlinked `extension/` directory remains next to `sidecar/`. Set
`AE_NODE_PATH`, `AE_FFMPEG_PATH`, or `AE_FFPROBE_PATH` when the executables are in custom locations.

Validate a scene plan before handing it to the After Effects host bridge:

```bash
node sidecar/cli.mjs validate ./scene-plan.json
```

Run the repository checks and unit tests with `npm run check`.
