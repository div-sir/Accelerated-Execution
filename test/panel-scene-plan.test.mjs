import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { validateScenePlan } from "../sidecar/scene-plan.mjs";

const require = createRequire(import.meta.url);
const { buildScenePlan, engineFor } = require("../extension/js/scene-plan.js");

function analysis(selectedFrame = 24) {
  return {
    media: { frameRate: 24 },
    shots: [{
      id: "shot-001",
      start: 0,
      end: 2,
      selected: { frame: selectedFrame, score: 0.82 },
    }],
  };
}

test("buildScenePlan produces a schema-valid plan", () => {
  const plan = buildScenePlan(analysis(), "point-track", "efficient");
  assert.deepEqual(plan, {
    version: "0.1",
    shots: [{
      id: "shot-001",
      startFrame: 0,
      endFrame: 47,
      tasks: [{
        type: "point-track",
        engine: "ae-native",
        anchorFrame: 24,
        confidence: 0.82,
      }],
    }],
  });
  assert.equal(validateScenePlan(plan).valid, true);
});

test("engineFor routes planar work to Mocha unless native-only mode is selected", () => {
  assert.equal(engineFor("planar-track", "efficient"), "mocha");
  assert.equal(engineFor("planar-track", "native"), "ae-native");
  assert.equal(engineFor("roto", "maximum"), "ae-native");
});

test("buildScenePlan rejects anchors outside their shot", () => {
  assert.throws(() => buildScenePlan(analysis(60), "point-track", "efficient"), /outside the shot/);
});
