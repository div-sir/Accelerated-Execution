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
