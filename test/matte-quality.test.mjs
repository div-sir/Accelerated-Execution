import assert from "node:assert/strict";
import test from "node:test";
import { evaluateMatteSequence, scoreMatteFrame } from "../sidecar/matte-quality.mjs";
import { buildExecutionRetryPlan, buildRetryPlan } from "../sidecar/retry-plan.mjs";

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

function source(value = "a") {
  return {
    path: "/footage/source.mp4",
    name: "source.mp4",
    size: 100,
    modifiedAt: "2026-01-01T00:00:00.000Z",
    fingerprint: { algorithm: "sha256-sampled-v1", value: value.repeat(64) },
  };
}

function executionFixture() {
  return {
    version: "0.1",
    planVersion: "0.1",
    executedAt: "2026-09-24T12:00:00.000Z",
    source: source(),
    executor: { engine: "ae-native", action: "object-matte" },
    destination: { compName: "Main", layerName: "Footage" },
    summary: { completed: 1, warning: 1, failed: 1, skipped: 0 },
    shots: [
      { id: "shot-001", status: "completed", action: "object-matte" },
      { id: "shot-002", status: "failed", action: "object-matte", recommendation: "use-next-fallback" },
      { id: "shot-003", status: "warning", action: "object-matte", recommendation: "review-target" },
    ],
  };
}

function scenePlanFixture() {
  const task = (anchorTime) => ({
    type: "roto",
    engine: "ae-native",
    action: "object-matte",
    anchorTime,
    target: { kind: "box", coordinateSpace: "normalized-source", x: 0.1, y: 0.1, width: 0.4, height: 0.5 },
    fallbacks: [{ engine: "local-ai", action: "sam-segmentation", condition: "quality-failed" }],
  });
  return {
    version: "0.1",
    source: source(),
    media: { width: 1920, height: 1080, duration: 3, frameRateMode: "cfr" },
    shots: [
      { id: "shot-001", startTime: 0, endTime: 1, startFrame: 0, endFrame: 29, tasks: [task(0.5)] },
      { id: "shot-002", startTime: 1, endTime: 2, startFrame: 30, endFrame: 59, tasks: [task(1.5)] },
      { id: "shot-003", startTime: 2, endTime: 3, startFrame: 60, endFrame: 89, tasks: [task(2.5)] },
    ],
  };
}

test("execution retry planner creates automatic fallback and manual-review jobs", () => {
  const plan = buildExecutionRetryPlan(executionFixture(), scenePlanFixture(), {
    createdAt: "2026-09-24T12:01:00.000Z",
  });
  assert.deepEqual(plan.summary, { automatic: 1, manualReview: 1, ignored: 1 });
  assert.equal(plan.jobs[0].strategy, "fallback");
  assert.equal(plan.jobs[0].task.engine, "local-ai");
  assert.equal(plan.jobs[0].task.action, "sam-segmentation");
  assert.equal(plan.jobs[0].trigger, "quality-failed");
  assert.equal(plan.jobs[1].strategy, "manual-review");
  assert.equal(plan.jobs[1].automatic, false);
});

test("execution retry planner rejects mismatched source identity", () => {
  const scenePlan = scenePlanFixture();
  scenePlan.source = source("b");
  assert.throws(
    () => buildExecutionRetryPlan(executionFixture(), scenePlan),
    /sources do not match/,
  );
});

test("execution retry planner rejects an outcome action absent from the scene plan", () => {
  const report = executionFixture();
  report.shots[1].action = "vision-segmentation";
  assert.throws(
    () => buildExecutionRetryPlan(report, scenePlanFixture()),
    /action was not planned/,
  );
});
