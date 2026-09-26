import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { analyzeFootage, extractFrame, probeMedia } from "../sidecar/ffmpeg.mjs";
import { validateScenePlan } from "../sidecar/scene-plan.mjs";

const execute = promisify(execFile);
const require = createRequire(import.meta.url);
const { buildScenePlan } = require("../extension/js/scene-plan.js");

test("FFmpeg integration preserves CFR frames and treats VFR timestamps as canonical", async (context) => {
  try {
    await execute("ffmpeg", ["-version"]);
    await execute("ffprobe", ["-version"]);
  } catch (error) {
    context.skip("FFmpeg and ffprobe are not installed.");
    return;
  }

  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "accelerated-execution-test-"));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const cfrInput = path.join(directory, "cfr.mp4");
  const vfrInput = path.join(directory, "vfr.mp4");

  await execute("ffmpeg", [
    "-v", "error", "-y", "-f", "lavfi",
    "-i", "testsrc2=size=160x90:rate=24:duration=1",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", cfrInput,
  ]);
  await execute("ffmpeg", [
    "-v", "error", "-y",
    "-f", "lavfi", "-i", "testsrc2=size=160x90:rate=10:duration=1",
    "-f", "lavfi", "-i", "testsrc2=size=160x90:rate=30:duration=1",
    "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0[v]",
    "-map", "[v]", "-fps_mode", "vfr", "-c:v", "libx264", "-pix_fmt", "yuv420p", vfrInput,
  ]);

  const cfr = await probeMedia(cfrInput);
  assert.equal(cfr.frameRateMode, "cfr");
  assert.equal(cfr.frameCount, 24);
  assert.equal(cfr.averageFrameRate, 24);
  const anchorFrame = path.join(directory, "anchor.png");
  await extractFrame(cfrInput, 0.5, anchorFrame);
  const { stdout: anchorProbe } = await execute("ffprobe", [
    "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height",
    "-of", "csv=p=0:s=x", anchorFrame,
  ]);
  assert.equal(anchorProbe.trim(), "160x90");

  const vfr = await probeMedia(vfrInput);
  assert.equal(vfr.frameRateMode, "vfr");
  assert.equal(vfr.frameCount, 40);

  const outputDirectory = path.join(directory, "analysis");
  const analysis = await analyzeFootage(vfrInput, {
    outputDirectory,
    candidatesPerShot: 1,
    threshold: 0.99,
  });
  assert.equal(analysis.source.fingerprint.algorithm, "sha256-sampled-v1");
  assert.match(analysis.source.fingerprint.value, /^[a-f0-9]{64}$/);
  assert.equal(analysis.shots.length, 1);
  assert.equal(analysis.shots[0].selected.sourceFrame, null);
  assert.ok(analysis.shots[0].selected.timeSeconds > 0);
  await fs.access(path.join(outputDirectory, analysis.shots[0].selected.preview));
  const plan = buildScenePlan(analysis, "point-track", "efficient");
  assert.equal(plan.shots[0].tasks[0].anchorFrame, undefined);
  assert.equal(plan.shots[0].tasks[0].anchorTime, analysis.shots[0].selected.timeSeconds);
  assert.equal(plan.source.fingerprint.value, analysis.source.fingerprint.value);
  assert.equal(validateScenePlan(plan).valid, true);
});
