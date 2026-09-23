import assert from "node:assert/strict";
import test from "node:test";
import { validateScenePlan } from "../sidecar/scene-plan.mjs";

test("accepts a valid scene plan", () => {
  const result = validateScenePlan({
    version: "0.1",
    shots: [{
      id: "shot-001",
      startFrame: 0,
      endFrame: 99,
      tasks: [{ type: "point-track", engine: "ae-native", anchorFrame: 42, confidence: 0.9 }],
    }],
  });
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test("reports cross-field and uniqueness errors", () => {
  const result = validateScenePlan({
    version: "0.1",
    shots: [
      { id: "same", startFrame: 20, endFrame: 10, tasks: [] },
      { id: "same", startFrame: 30, endFrame: 40, tasks: [{ type: "roto", engine: "vision", anchorFrame: 50 }] },
    ],
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.message === "must be unique"));
  assert.ok(result.errors.some((error) => error.message === "must be greater than or equal to startFrame"));
  assert.ok(result.errors.some((error) => error.message === "must fall inside its shot"));
});
