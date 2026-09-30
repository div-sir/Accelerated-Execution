import assert from "node:assert/strict";
import test from "node:test";
import { scoreFrameBatch } from "../sidecar/python-preparation.mjs";

test("Python preparation bridge scores grayscale frame batches", async (context) => {
  const flat = new Uint8Array(160 * 90).fill(127);
  const checker = new Uint8Array(160 * 90);
  for (let y = 0; y < 90; y += 1) {
    for (let x = 0; x < 160; x += 1) checker[y * 160 + x] = (Math.floor(x / 4) + Math.floor(y / 4)) % 2 ? 255 : 0;
  }
  let result;
  try {
    result = await scoreFrameBatch([
      { previous: flat, current: flat, next: flat },
      { previous: checker, current: checker, next: checker },
    ]);
  } catch (error) {
    if (error.code === "ENOENT") {
      context.skip("Python is not installed.");
      return;
    }
    throw error;
  }
  assert.equal(result.length, 2);
  assert.equal(result[0].metrics.stability, 1);
  assert.ok(result[1].metrics.sharpness > result[0].metrics.sharpness);
  assert.ok(result[1].metrics.trackability > result[0].metrics.trackability);
  assert.ok(result[1].score > result[0].score);
});

test("Python preparation bridge preserves cancellation", async () => {
  const frame = new Uint8Array(160 * 90).fill(127);
  const controller = new AbortController();
  controller.abort(new Error("cancelled by test"));
  await assert.rejects(
    scoreFrameBatch([{ previous: frame, current: frame, next: frame }], { signal: controller.signal }),
    /cancelled by test|aborted/i,
  );
});
