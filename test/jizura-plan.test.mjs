import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { normalizePlan } = require("../extension/js/jizura-plan.js");

function plan() {
  return {
    version: 2,
    generator: "JIZURA",
    title: "  Example\nSong  ",
    duration: 5,
    fps: 24,
    beats: [0.5, 1, 1.5],
    lines: [{ index: 1, start: 2, end: 4, text: " second " }, { index: 0, start: 0.5, end: 2, text: "first" }],
    cuts: [{ start: 1, end: 2, text: "cut one" }],
  };
}

test("normalizePlan keeps beat-snapped JIZURA timing in a compact host payload", () => {
  assert.deepEqual(normalizePlan(plan()), {
    format: "accelerated-execution/jizura-timing",
    version: 1,
    sourceVersion: 2,
    title: "Example Song",
    duration: 5,
    fps: 24,
    beats: [0.5, 1, 1.5],
    lines: [
      { index: 0, start: 0.5, text: "first" },
      { index: 1, start: 2, text: "second" },
    ],
    cuts: [{ index: 0, start: 1, text: "cut one" }],
  });
});

test("normalizePlan rejects unrelated, unsorted, and out-of-range input", () => {
  assert.throws(() => normalizePlan({ ...plan(), generator: "OTHER" }), /generator must be JIZURA/);
  assert.throws(() => normalizePlan({ ...plan(), beats: [1, 0.5] }), /ascending order/);
  assert.throws(() => normalizePlan({ ...plan(), cuts: [{ start: 5, end: 6 }] }), /outside the plan duration/);
});
