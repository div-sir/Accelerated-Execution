import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { executeRetryPlan } from "../sidecar/retry-executor.mjs";

function source(value = "a") {
  return {
    path: "/footage/source.mp4",
    name: "source.mp4",
    size: 100,
    modifiedAt: "2026-01-01T00:00:00.000Z",
    fingerprint: { algorithm: "sha256-sampled-v1", value: value.repeat(64) },
  };
}

function retryPlan() {
  const task = {
    type: "roto",
    engine: "local-ai",
    action: "sam-segmentation",
    anchorTime: 1.5,
    target: { kind: "box", coordinateSpace: "normalized-source", x: 0.1, y: 0.1, width: 0.4, height: 0.5 },
  };
  return {
    version: "0.1",
    source: source(),
    destination: { compName: "Main", layerName: "Footage" },
    jobs: [
      { shotId: "shot-001", automatic: true, task },
      { shotId: "shot-002", automatic: false, task },
    ],
  };
}

test("retry executor extracts a full-resolution anchor and runs local SAM", async (context) => {
  const outputDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "ae-retry-executor-"));
  context.after(() => fs.rm(outputDirectory, { recursive: true, force: true }));
  const calls = [];
  const report = await executeRetryPlan(retryPlan(), {
    outputDirectory,
    executedAt: "2026-09-25T12:00:00.000Z",
    sourceIdentity: async () => source(),
    extractFrame: async (input, time, output) => {
      calls.push({ kind: "extract", input, time, output });
      await fs.writeFile(output, "frame");
      return output;
    },
    segmentImage: async (request) => {
      calls.push({ kind: "segment", request });
      await fs.mkdir(request.outputDirectory, { recursive: true });
      const maskPath = path.join(request.outputDirectory, "mask.png");
      await fs.writeFile(maskPath, "mask");
      return { ok: true, maskPath, confidence: 0.93, provider: "test-sam", model: "tiny" };
    },
  });

  assert.deepEqual(report.summary, { completed: 1, failed: 0, skipped: 1 });
  assert.equal(report.executedAt, "2026-09-25T12:00:00.000Z");
  assert.equal(report.jobs[0].confidence, 0.93);
  assert.equal(report.jobs[1].status, "skipped");
  assert.deepEqual(calls.map((call) => call.kind), ["extract", "segment"]);
  assert.equal(calls[0].time, 1.5);
  assert.equal(calls[1].request.target.kind, "box");
});

test("retry executor refuses changed source footage before extracting frames", async () => {
  let extracted = false;
  await assert.rejects(() => executeRetryPlan(retryPlan(), {
    sourceIdentity: async () => source("b"),
    extractFrame: async () => { extracted = true; },
  }), /source identity no longer matches/);
  assert.equal(extracted, false);
});

test("retry executor records unsupported automatic providers as failed", async (context) => {
  const outputDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "ae-retry-executor-"));
  context.after(() => fs.rm(outputDirectory, { recursive: true, force: true }));
  const plan = retryPlan();
  plan.jobs = [{
    shotId: "shot-003",
    automatic: true,
    task: { ...plan.jobs[0].task, engine: "vision", action: "vision-segmentation" },
  }];
  const report = await executeRetryPlan(plan, {
    outputDirectory,
    sourceIdentity: async () => source(),
  });
  assert.deepEqual(report.summary, { completed: 0, failed: 1, skipped: 0 });
  assert.match(report.jobs[0].message, /No retry executor/);
});

test("retry executor rejects a SAM mask outside its job directory", async (context) => {
  const outputDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "ae-retry-executor-"));
  context.after(() => fs.rm(outputDirectory, { recursive: true, force: true }));
  const outsideMask = path.join(outputDirectory, "outside.png");
  await fs.writeFile(outsideMask, "mask");
  const plan = retryPlan();
  plan.jobs = [plan.jobs[0]];
  const report = await executeRetryPlan(plan, {
    outputDirectory,
    sourceIdentity: async () => source(),
    extractFrame: async (input, time, output) => {
      await fs.writeFile(output, "frame");
      return output;
    },
    segmentImage: async () => ({ ok: true, maskPath: outsideMask }),
  });
  assert.equal(report.summary.failed, 1);
  assert.match(report.jobs[0].message, /outside the requested output directory/);
});
