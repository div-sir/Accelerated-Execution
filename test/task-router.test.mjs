import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { routeFor } = require("../extension/js/task-router.js");

test("routeFor prefers AE Object Matte for roto boxes with local fallback", () => {
  assert.deepEqual(routeFor("roto", "efficient", { kind: "box" }), {
    engine: "ae-native",
    action: "object-matte",
    fallbacks: [
      { engine: "ae-native", action: "roto-brush", condition: "unavailable" },
      { engine: "local-ai", action: "sam-segmentation", condition: "quality-failed" },
    ],
  });
});

test("routeFor keeps cloud vision opt-in to maximum mode", () => {
  const efficient = routeFor("roto", "efficient", { kind: "point" });
  const maximum = routeFor("roto", "maximum", { kind: "point" });
  assert.equal(efficient.fallbacks.some((item) => item.engine === "vision"), false);
  assert.deepEqual(maximum.fallbacks.at(-1), {
    engine: "vision",
    action: "vision-segmentation",
    condition: "semantic-ambiguity",
  });
});

test("routeFor native mode never adds an AI fallback", () => {
  const route = routeFor("roto", "native", { kind: "box" });
  assert.equal(route.fallbacks.some((item) => item.engine === "local-ai" || item.engine === "vision"), false);
});

test("routeFor requires task-appropriate mask targets", () => {
  assert.throws(() => routeFor("roto", "efficient"), /require a point or box target/);
  assert.throws(() => routeFor("static-mask", "efficient", { kind: "point" }), /require a box target/);
  assert.throws(() => routeFor("roto", "efficient", { kind: "polygon" }), /Unsupported target kind/);
});

test("routeFor preserves existing tracking routes", () => {
  assert.equal(routeFor("planar-track", "efficient").engine, "mocha");
  assert.equal(routeFor("planar-track", "native").engine, "ae-native");
  assert.equal(routeFor("point-track", "efficient").action, "motion-tracker");
  assert.equal(routeFor("camera-track", "efficient").action, "camera-tracker");
});
