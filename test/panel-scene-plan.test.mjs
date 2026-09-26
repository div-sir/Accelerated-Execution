import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { validateScenePlan } from "../sidecar/scene-plan.mjs";

const require = createRequire(import.meta.url);
const { buildScenePlan, engineFor, targetFromDrag } = require("../extension/js/scene-plan.js");

function analysis(selectedTime = 1, frameRateMode = "cfr") {
  return {
    source: {
      path: "/footage/source.mp4",
      name: "source.mp4",
      size: 100,
      modifiedAt: "2026-01-01T00:00:00.000Z",
      fingerprint: { algorithm: "sha256-sampled-v1", value: "a".repeat(64) },
    },
    media: {
      width: 1920,
      height: 1080,
      duration: 2,
      frameRateMode,
      averageFrameRate: 24,
      nominalFrameRate: 24,
      timeBase: "1/12288",
      frameCount: 48,
    },
    shots: [{
      id: "shot-001",
      startTime: 0,
      endTime: 2,
      selected: { timeSeconds: selectedTime, sourceFrame: frameRateMode === "cfr" ? 24 : null, score: 0.82 },
    }],
  };
}

test("buildScenePlan produces a schema-valid plan", () => {
  const plan = buildScenePlan(analysis(), "point-track", "efficient");
  assert.deepEqual(plan, {
    version: "0.1",
    source: analysis().source,
    media: analysis().media,
    shots: [{
      id: "shot-001",
      startTime: 0,
      endTime: 2,
      startFrame: 0,
      endFrame: 47,
      tasks: [{
        type: "point-track",
        engine: "ae-native",
        action: "motion-tracker",
        anchorTime: 1,
        anchorFrame: 24,
        confidence: 0.82,
      }],
    }],
  });
  assert.equal(validateScenePlan(plan).valid, true);
});

test("buildScenePlan omits frame fields for VFR media", () => {
  const plan = buildScenePlan(analysis(1, "vfr"), "point-track", "efficient");
  assert.equal(plan.shots[0].startFrame, undefined);
  assert.equal(plan.shots[0].endFrame, undefined);
  assert.equal(plan.shots[0].tasks[0].anchorFrame, undefined);
  assert.equal(plan.shots[0].tasks[0].anchorTime, 1);
  assert.equal(validateScenePlan(plan).valid, true);
});

test("engineFor routes planar work to Mocha unless native-only mode is selected", () => {
  assert.equal(engineFor("planar-track", "efficient"), "mocha");
  assert.equal(engineFor("planar-track", "native"), "ae-native");
  assert.equal(engineFor("roto", "maximum"), "ae-native");
});

test("buildScenePlan rejects anchors outside their shot", () => {
  assert.throws(() => buildScenePlan(analysis(2.1), "point-track", "efficient"), /outside the shot/);
});

test("targetFromDrag creates normalized point and box targets", () => {
  assert.deepEqual(targetFromDrag(50, 25, 51, 27, 200, 100, 4), {
    kind: "point",
    coordinateSpace: "normalized-source",
    x: 0.255,
    y: 0.27,
  });
  assert.deepEqual(targetFromDrag(180, 90, 40, 10, 200, 100, 4), {
    kind: "box",
    coordinateSpace: "normalized-source",
    x: 0.2,
    y: 0.1,
    width: 0.7,
    height: 0.8,
  });
});

test("buildScenePlan carries a normalized target into its task", () => {
  const input = analysis();
  input.shots[0].target = {
    kind: "box",
    x: 0.25,
    y: 0.2,
    width: 0.5,
    height: 0.6,
  };
  const plan = buildScenePlan(input, "roto", "efficient");
  assert.deepEqual(plan.shots[0].tasks[0].target, {
    kind: "box",
    coordinateSpace: "normalized-source",
    x: 0.25,
    y: 0.2,
    width: 0.5,
    height: 0.6,
  });
  assert.equal(plan.shots[0].tasks[0].action, "object-matte");
  assert.deepEqual(plan.shots[0].tasks[0].fallbacks.map((fallback) => fallback.action), [
    "roto-brush",
    "sam-segmentation",
  ]);
  assert.equal(validateScenePlan(plan).valid, true);
});

test("buildScenePlan rejects targets outside the source frame", () => {
  const input = analysis();
  input.shots[0].target = { kind: "box", x: 0.8, y: 0.1, width: 0.3, height: 0.2 };
  assert.throws(() => buildScenePlan(input, "roto", "efficient"), /inside the source frame/);
});

test("buildScenePlan requires a target for mask routing", () => {
  assert.throws(() => buildScenePlan(analysis(), "roto", "efficient"), /require a point or box target/);
  const input = analysis();
  input.shots[0].target = { kind: "point", x: 0.5, y: 0.5 };
  assert.throws(() => buildScenePlan(input, "static-mask", "efficient"), /require a box target/);
});

test("buildScenePlan validates static-mask feather and expansion", () => {
  const input = analysis();
  input.shots[0].target = { kind: "box", x: 0.1, y: 0.1, width: 0.4, height: 0.4 };
  const plan = buildScenePlan(input, "static-mask", "efficient", {
    featherPixels: 18.5,
    expansionPixels: -4,
  });
  assert.deepEqual(plan.shots[0].tasks[0].parameters, {
    featherPixels: 18.5,
    expansionPixels: -4,
  });
  assert.equal(validateScenePlan(plan).valid, true);
  assert.throws(() => buildScenePlan(input, "static-mask", "efficient", {
    featherPixels: 501,
    expansionPixels: 0,
  }), /feather must be between/);
});
