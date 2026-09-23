(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.AEScenePlan = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var TASK_TYPES = ["roto", "planar-track", "point-track", "camera-track", "static-mask"];

  function engineFor(taskType, mode) {
    if (TASK_TYPES.indexOf(taskType) === -1) throw new Error("Unsupported task type: " + taskType);
    if (mode === "native") return "ae-native";
    if (taskType === "planar-track") return "mocha";
    return "ae-native";
  }

  function clamp01(value) {
    return Math.max(0, Math.min(1, Number(value) || 0));
  }

  function buildScenePlan(analysis, taskType, mode) {
    if (!analysis || !analysis.media || !Array.isArray(analysis.shots)) {
      throw new Error("Analysis result is incomplete.");
    }
    var frameRate = Number(analysis.media.frameRate);
    if (!(frameRate > 0)) throw new Error("Analysis frame rate is invalid.");
    var engine = engineFor(taskType, mode);

    return {
      version: "0.1",
      shots: analysis.shots.map(function (shot, index) {
        if (!shot.selected || !Number.isInteger(shot.selected.frame)) {
          throw new Error("Shot " + (index + 1) + " has no selected anchor frame.");
        }
        var startFrame = Math.max(0, Math.round(Number(shot.start) * frameRate));
        var endFrame = Math.max(startFrame, Math.ceil(Number(shot.end) * frameRate) - 1);
        if (shot.selected.frame < startFrame || shot.selected.frame > endFrame) {
          throw new Error("Selected anchor for shot " + (index + 1) + " falls outside the shot.");
        }
        return {
          id: shot.id || "shot-" + String(index + 1).padStart(3, "0"),
          startFrame: startFrame,
          endFrame: endFrame,
          tasks: [{
            type: taskType,
            engine: engine,
            anchorFrame: shot.selected.frame,
            confidence: clamp01(shot.selected.score)
          }]
        };
      })
    };
  }

  return { buildScenePlan: buildScenePlan, engineFor: engineFor };
});
