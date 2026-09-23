# Roadmap

## v0.1 - Foundation

- [x] Define AE-first architecture.
- [x] Define task-specific keyframe model.
- [x] Add CEP panel scaffold.
- [x] Add ExtendScript host bridge scaffold.
- [x] Add FFmpeg discovery.
- [x] Add proxy generation.
- [x] Add scene-cut detection.
- [x] Add local keyframe scoring.
- [x] Add JSON scene plan validation.
- [x] Add selected-footage host detection.
- [x] Launch local analysis from the CEP panel.
- [x] Preview selected candidates in the CEP panel.
- [x] Let users choose an anchor candidate per shot.
- [x] Export selected anchors as a scene plan.
- [x] Move the active AE composition to an anchor frame.

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
- [x] Add CEP prerequisite diagnostics.
- [x] Add safe development symlink installation.
- [x] Add unsigned self-contained package output.
- [ ] Cross-platform FFmpeg setup.
- [ ] macOS Apple Silicon test.
- [ ] Windows test.
- [ ] Public installation guide.
