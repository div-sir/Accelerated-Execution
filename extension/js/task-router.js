(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.AETaskRouter = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var TASK_TYPES = ["roto", "planar-track", "point-track", "camera-track", "static-mask"];
  var MODES = ["efficient", "native", "maximum"];

  function fallback(engine, action, condition) {
    return { engine: engine, action: action, condition: condition };
  }

  function routeFor(taskType, mode, target) {
    if (TASK_TYPES.indexOf(taskType) === -1) throw new Error("Unsupported task type: " + taskType);
    if (MODES.indexOf(mode) === -1) throw new Error("Unsupported execution mode: " + mode);
    if (target && target.kind !== "point" && target.kind !== "box") {
      throw new Error("Unsupported target kind: " + target.kind);
    }

    var route;
    if (taskType === "roto") {
      if (!target) throw new Error("Rotoscope tasks require a point or box target.");
      route = target.kind === "box"
        ? { engine: "ae-native", action: "object-matte", fallbacks: [fallback("ae-native", "roto-brush", "unavailable")] }
        : { engine: "ae-native", action: "roto-brush", fallbacks: [] };
      if (mode !== "native") route.fallbacks.push(fallback("local-ai", "sam-segmentation", "quality-failed"));
      if (mode === "maximum") route.fallbacks.push(fallback("vision", "vision-segmentation", "semantic-ambiguity"));
      return route;
    }

    if (taskType === "static-mask") {
      if (!target || target.kind !== "box") throw new Error("Static mask tasks require a box target.");
      return { engine: "ae-native", action: "static-mask", fallbacks: [] };
    }
    if (taskType === "planar-track") {
      return mode === "native"
        ? { engine: "ae-native", action: "motion-tracker", fallbacks: [] }
        : { engine: "mocha", action: "mocha-planar-track", fallbacks: [fallback("ae-native", "motion-tracker", "unavailable")] };
    }
    if (taskType === "point-track") {
      return { engine: "ae-native", action: "motion-tracker", fallbacks: [] };
    }
    return { engine: "ae-native", action: "camera-tracker", fallbacks: [] };
  }

  return { routeFor: routeFor };
});
