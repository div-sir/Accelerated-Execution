import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { validateExecutionReport } from "../sidecar/execution-report.mjs";

const require = createRequire(import.meta.url);
const { buildExecutionReport } = require("../extension/js/execution-report.js");

function source() {
  return {
    path: "/footage/source.mp4",
    name: "source.mp4",
    size: 100,
    modifiedAt: "2026-01-01T00:00:00.000Z",
    fingerprint: { algorithm: "sha256-sampled-v1", value: "a".repeat(64) },
  };
}

test("buildExecutionReport records durable per-shot outcomes", () => {
  const report = buildExecutionReport({ version: "0.1", source: source() }, {
    ok: true,
    compName: "Main Comp",
    layerName: "Footage Layer",
    shots: [
      { id: "shot-001", status: "completed", action: "static-mask", coverage: 0.2 },
      {
        id: "shot-002",
        status: "warning",
        action: "static-mask",
        coverage: 0.0004,
        message: "Target is very small.",
        recommendation: "review-target",
      },
      {
        id: "shot-003",
        status: "skipped",
        action: "static-mask",
        recommendation: "adjust-layer-range",
      },
    ],
  }, "2026-09-23T12:00:00.000Z");

  assert.deepEqual(report.summary, { completed: 1, warning: 1, failed: 0, skipped: 1 });
  assert.equal(report.executedAt, "2026-09-23T12:00:00.000Z");
  assert.equal(report.shots[1].recommendation, "review-target");
  assert.deepEqual(validateExecutionReport(report), { valid: true, errors: [] });
});

test("validateExecutionReport rejects summary drift and duplicate shots", () => {
  const report = buildExecutionReport({ version: "0.1", source: source() }, {
    ok: true,
    compName: "Main Comp",
    layerName: "Footage Layer",
    shots: [
      { id: "same", status: "completed", action: "static-mask" },
      { id: "same", status: "failed", action: "static-mask", recommendation: "use-next-fallback" },
    ],
  }, "2026-09-23T12:00:00.000Z");
  report.summary.completed = 2;
  const result = validateExecutionReport(report);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.message === "must be unique"));
  assert.ok(result.errors.some((error) => error.path === "$.summary.completed"));
});
