import assert from "node:assert/strict";
import test from "node:test";
import { localSamConfig } from "../sidecar/providers/local-sam.mjs";

test("local SAM adapter defaults to a loopback endpoint", () => {
  assert.equal(localSamConfig({}).endpoint, "http://127.0.0.1:8765");
});

test("local SAM adapter rejects remote endpoints", () => {
  assert.throws(
    () => localSamConfig({ AE_LOCAL_SAM_ENDPOINT: "https://example.com" }),
    /localhost or 127\.0\.0\.1/,
  );
});
