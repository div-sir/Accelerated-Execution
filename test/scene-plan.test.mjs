import assert from "node:assert/strict";
import test from "node:test";
import { validateScenePlan } from "../sidecar/scene-plan.mjs";

test("accepts a valid scene plan", () => {
  const result = validateScenePlan({
    version: "0.1",
    source: {
      path: "/footage/source.mp4",
      name: "source.mp4",
      size: 100,
      modifiedAt: "2026-01-01T00:00:00.000Z",
      fingerprint: { algorithm: "sha256-sampled-v1", value: "a".repeat(64) },
    },
    media: { width: 1920, height: 1080, duration: 4, frameRateMode: "cfr", averageFrameRate: 25, nominalFrameRate: 25, timeBase: "1/12800" },
    shots: [{
      id: "shot-001",
      startTime: 0,
      endTime: 4,
      startFrame: 0,
      endFrame: 99,
      tasks: [{
        type: "point-track",
        engine: "ae-native",
        anchorTime: 1.68,
        anchorFrame: 42,
        confidence: 0.9,
        target: { kind: "point", coordinateSpace: "normalized-source", x: 0.4, y: 0.6 },
      }],
    }],
  });
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test("rejects a target box that extends outside the source frame", () => {
  const result = validateScenePlan({
    version: "0.1",
    source: {
      path: "/footage/source.mp4",
      name: "source.mp4",
      size: 100,
      modifiedAt: "2026-01-01T00:00:00.000Z",
      fingerprint: { algorithm: "sha256-sampled-v1", value: "a".repeat(64) },
    },
    media: { width: 1920, height: 1080, duration: 4, frameRateMode: "cfr" },
    shots: [{
      id: "shot-001",
      startTime: 0,
      endTime: 4,
      tasks: [{
        type: "roto",
        engine: "ae-native",
        anchorTime: 2,
        target: {
          kind: "box",
          coordinateSpace: "normalized-source",
          x: 0.8,
          y: 0.2,
          width: 0.3,
          height: 0.4,
        },
      }],
    }],
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.path.endsWith("target.width")));
});

test("reports cross-field and uniqueness errors", () => {
  const result = validateScenePlan({
    version: "0.1",
    source: {
      path: "/footage/source.mp4",
      name: "source.mp4",
      size: 100,
      modifiedAt: "2026-01-01T00:00:00.000Z",
      fingerprint: { algorithm: "sha256-sampled-v1", value: "a".repeat(64) },
    },
    media: { width: 1920, height: 1080, duration: 4, frameRateMode: "vfr" },
    shots: [
      { id: "same", startTime: 2, endTime: 1, tasks: [] },
      { id: "same", startTime: 3, endTime: 4, tasks: [{ type: "roto", engine: "vision", anchorTime: 5 }] },
    ],
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.message === "must be unique"));
  assert.ok(result.errors.some((error) => error.message === "must be greater than startTime"));
  assert.ok(result.errors.some((error) => error.message === "must fall inside its shot"));
});
