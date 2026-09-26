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
- [x] Use timestamp-first anchors for CFR and VFR footage.
- [x] Bind scene plans and AE navigation to source identity.
- [x] Run real FFmpeg CFR/VFR fixtures in CI.
- [x] Apply scene-plan anchors as safe, replaceable AE layer markers.

## v0.2 - Smart Preparation

- [x] Make prepare-only workflow the default.
- [x] Automatically keep the highest-ranked working frame for every shot.
- [x] Write a preparation manifest without modifying the AE composition.
- [x] Move execution controls behind an optional section.
- [ ] Add automatic subject detection for likely foreground objects.
- [ ] Precompute masks only when confidence is high.
- [ ] Mark uncertain masks for optional review instead of blocking preparation.
- [ ] Reuse prepared frames and masks across later effect operations.

## v0.3 - Smart Mask

- [x] Select a candidate frame from local scores.
- [x] Let the user click or box a target.
- [x] Define task actions and ordered native/local/vision fallback routes.
- [x] Execute box targets as time-gated native AE static masks.
- [x] Add static-mask feather, expansion, and target-coverage preflight.
- [x] Persist per-shot execution outcomes and retry recommendations.
- [ ] Route people and objects to AE native matte tools when possible.
- [x] Add local SAM-family fallback worker.
- [x] Add model-agnostic localhost SAM provider adapter.
- [x] Add matte quality checks.
- [x] Detect failed temporal spans and build retry plans.
- [x] Convert execution outcomes into automatic fallback and manual-review jobs.
- [x] Execute local SAM retry jobs from full-resolution anchors.
- [x] Import completed SAM masks as managed AE guide matte layers.
- [ ] Execute native AE and other provider retry jobs automatically.

## v0.4 - Smart Track

- [ ] Route planar surfaces to Mocha / planar tracking.
- [ ] Route point features to Motion Tracker.
- [ ] Route camera movement to 3D Camera Tracker.
- [ ] Add multi-anchor recovery.

## v0.5 - Semantic Compositing

- [ ] Ground Paint.
- [ ] Wall Art.
- [ ] Particle Scatter.
- [ ] Foreground occlusion.
- [ ] Prompt to effect parameters.

## v0.6 - Distribution

- [ ] Signed development package.
- [x] Add CEP prerequisite diagnostics.
- [x] Add safe development symlink installation.
- [x] Add unsigned self-contained package output.
- [ ] Cross-platform FFmpeg setup.
- [ ] macOS Apple Silicon test.
- [ ] Windows test.
- [ ] Public installation guide.
