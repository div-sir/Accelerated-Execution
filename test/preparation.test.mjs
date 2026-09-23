import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { buildPreparationManifest, preparationSummary } = require("../extension/js/preparation.js");

test("prepare-only manifest keeps the best frame ready without executing AE", () => {
  const manifest = buildPreparationManifest({
    source: { path: "/tmp/test.mp4" },
    media: { width: 1920, height: 1080, duration: 5 },
    shots: [{
      id: "shot-001",
      startTime: 0,
      endTime: 5,
      selected: { timeSeconds: 2, sourceFrame: 60, score: 0.91, preview: "shot-001/frame-60.jpg" }
    }]
  });

  assert.equal(manifest.mode, "prepare-only");
  assert.equal(manifest.shots[0].preparation.state, "frame-ready");
  assert.equal(manifest.shots[0].preparation.anchorFrame, 60);
  assert.deepEqual(preparationSummary(manifest), { shots: 1, frames: 1, masks: 0 });
});

test("prepared masks are represented without forcing application to AE", () => {
  const manifest = buildPreparationManifest({
    source: { path: "/tmp/test.mp4" },
    media: { width: 1920, height: 1080, duration: 5 },
    shots: [{
      id: "shot-001",
      startTime: 0,
      endTime: 5,
      selected: { timeSeconds: 2, score: 0.91, preview: "frame.jpg" },
      preparedMask: { path: "mask.png", confidence: 0.94 }
    }]
  });

  assert.equal(manifest.shots[0].preparation.state, "mask-ready");
  assert.equal(preparationSummary(manifest).masks, 1);
});
