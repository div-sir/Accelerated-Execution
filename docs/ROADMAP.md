# Roadmap

## v0.1 - Foundation

- [x] Define AE-first architecture.
- [x] Define task-specific keyframe model.
- [x] Add CEP panel scaffold.
- [x] Add ExtendScript host bridge scaffold.
- [ ] Add FFmpeg discovery and proxy generation.
- [ ] Add scene-cut detection.
- [ ] Add local keyframe scoring.
- [ ] Add JSON scene plan validation.
- [ ] Add host capability detection.

## v0.2 - Smart Mask

- [ ] Select a candidate frame from local scores.
- [ ] Let the user click or box a target.
- [ ] Route people and objects to AE native matte tools when possible.
- [ ] Add local SAM-family fallback provider.
- [ ] Add matte quality checks.
- [ ] Retry failed temporal spans.

## v0.3 - Smart Track

- [ ] Route planar surfaces to Mocha / planar tracking.
- [ ] Route point features to Motion Tracker.
- [ ] Route camera movement to 3D Camera Tracker.
- [ ] Add multi-anchor recovery.

## v0.4 - Semantic Compositing

- [ ] Ground Paint.
- [ ] Wall Art.
- [ ] Particle Scatter.
- [ ] Foreground occlusion.
- [ ] Prompt to effect parameters.

## v0.5 - Distribution

- [ ] Signed development package.
- [ ] Cross-platform FFmpeg setup.
- [ ] macOS Apple Silicon test.
- [ ] Windows test.
- [ ] Public installation guide.
