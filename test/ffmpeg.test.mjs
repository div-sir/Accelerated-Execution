import assert from "node:assert/strict";
import test from "node:test";
import { buildCandidateTimes, generateProxy } from "../sidecar/ffmpeg.mjs";

test("buildCandidateTimes samples every shot without touching cut boundaries", () => {
  const candidates = buildCandidateTimes(10, [4], 3);
  assert.equal(candidates.length, 6);
  assert.deepEqual(candidates.map((candidate) => candidate.shotIndex), [0, 0, 0, 1, 1, 1]);
  assert.ok(candidates.slice(0, 3).every((candidate) => candidate.time > 0 && candidate.time < 4));
  assert.ok(candidates.slice(3).every((candidate) => candidate.time > 4 && candidate.time < 10));
});

test("buildCandidateTimes ignores invalid cuts", () => {
  const candidates = buildCandidateTimes(2, [-1, 3], 1);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].shotIndex, 0);
});

test("generateProxy validates height before starting FFmpeg", async () => {
  await assert.rejects(() => generateProxy("missing.mp4", "proxy.mp4", { height: 100 }), {
    name: "RangeError",
  });
});
