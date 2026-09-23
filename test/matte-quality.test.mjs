import assert from "node:assert/strict";
import test from "node:test";
import { evaluateMatteSequence, scoreMatteFrame } from "../sidecar/matte-quality.mjs";
import { buildRetryPlan } from "../sidecar/retry-plan.mjs";

test("stable matte metrics pass quality checks", () => {
  const result = scoreMatteFrame({
    coverage: 0.25,
    temporalIoU: 0.82,
    areaDrift: 0.08,
    centroidJump: 0.03,
  });
  assert.equal(result.pass, true);
  assert.ok(result.score > 0.8);
});

test("temporal collapse creates explicit failure reasons", () => {
  const result = scoreMatteFrame({
    coverage: 0.01,
    temporalIoU: 0.2,
    areaDrift: 0.8,
    centroidJump: 0.4,
  });
  assert.equal(result.pass, false);
  assert.ok(result.reasons.includes("temporal-overlap-low"));
  assert.ok(result.reasons.includes("area-drift-high"));
});

test("retry planner groups failed spans and chooses a nearby strong anchor", () => {
  const evaluation = evaluateMatteSequence([
    { frame: 10, metrics: { coverage: 0.2, temporalIoU: 0.9, areaDrift: 0.02, centroidJump: 0.01 } },
    { frame: 11, metrics: { coverage: 0.2, temporalIoU: 0.1, areaDrift: 0.8, centroidJump: 0.5 } },
    { frame: 12, metrics: { coverage: 0.2, temporalIoU: 0.1, areaDrift: 0.8, centroidJump: 0.5 } },
    { frame: 13, metrics: { coverage: 0.2, temporalIoU: 0.9, areaDrift: 0.02, centroidJump: 0.01 } },
  ]);
  const plan = buildRetryPlan(evaluation, [
    { frame: 8, score: 0.7 },
    { frame: 14, score: 0.95 },
  ], { padFrames: 1 });
  assert.equal(plan.length, 1);
  assert.deepEqual(plan[0], {
    startFrame: 10,
    endFrame: 13,
    anchorFrame: 14,
    anchorScore: 0.95,
    strategy: "reinitialize",
  });
});
