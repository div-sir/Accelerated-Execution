import assert from "node:assert/strict";
import test from "node:test";
import { frameMetrics, rankCandidates, scoreCandidate } from "../sidecar/keyframe-score.mjs";

test("scoreCandidate clamps inputs and penalizes occlusion", () => {
  const clear = scoreCandidate({ sharpness: 2, stability: 1, visibility: 1, trackability: 1, occlusion: 0 });
  const occluded = scoreCandidate({ sharpness: 2, stability: 1, visibility: 1, trackability: 1, occlusion: 1 });
  assert.equal(clear, 0.9);
  assert.equal(occluded, 0.8);
});

test("rankCandidates does not mutate the input array", () => {
  const candidates = [
    { id: "soft", metrics: { sharpness: 0.1 } },
    { id: "sharp", metrics: { sharpness: 0.9 } },
  ];
  assert.deepEqual(rankCandidates(candidates).map((item) => item.id), ["sharp", "soft"]);
  assert.deepEqual(candidates.map((item) => item.id), ["soft", "sharp"]);
});

test("frameMetrics recognizes a detailed frame", () => {
  const flat = new Uint8Array(160 * 90).fill(127);
  const checker = new Uint8Array(160 * 90);
  for (let y = 0; y < 90; y += 1) {
    for (let x = 0; x < 160; x += 1) checker[y * 160 + x] = (Math.floor(x / 4) + Math.floor(y / 4)) % 2 ? 255 : 0;
  }
  const flatMetrics = frameMetrics(flat, flat, flat);
  const checkerMetrics = frameMetrics(checker, checker, checker);
  assert.ok(checkerMetrics.sharpness > flatMetrics.sharpness);
  assert.ok(checkerMetrics.trackability > flatMetrics.trackability);
  assert.equal(flatMetrics.stability, 1);
});
