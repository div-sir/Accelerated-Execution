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
    if (!analysis || !analysis.source || !analysis.media || !Array.isArray(analysis.shots)) {
      throw new Error("Analysis result is incomplete.");
    }
    var engine = engineFor(taskType, mode);

    return {
      version: "0.1",
      source: analysis.source,
      media: {
        width: analysis.media.width,
        height: analysis.media.height,
        duration: analysis.media.duration,
        frameRateMode: analysis.media.frameRateMode,
        averageFrameRate: analysis.media.averageFrameRate,
        nominalFrameRate: analysis.media.nominalFrameRate,
        timeBase: analysis.media.timeBase,
        frameCount: analysis.media.frameCount
      },
      shots: analysis.shots.map(function (shot, index) {
        if (!shot.selected || !(Number(shot.selected.timeSeconds) >= 0)) {
          throw new Error("Shot " + (index + 1) + " has no selected anchor time.");
        }
        var startTime = Number(shot.startTime);
        var endTime = Number(shot.endTime);
        if (shot.selected.timeSeconds < startTime || shot.selected.timeSeconds >= endTime) {
          throw new Error("Selected anchor for shot " + (index + 1) + " falls outside the shot.");
        }
        var task = {
          type: taskType,
          engine: engine,
          anchorTime: shot.selected.timeSeconds,
          confidence: clamp01(shot.selected.score)
        };
        if (Number.isInteger(shot.selected.sourceFrame)) task.anchorFrame = shot.selected.sourceFrame;
        var result = {
          id: shot.id || "shot-" + String(index + 1).padStart(3, "0"),
          startTime: startTime,
          endTime: endTime,
          tasks: [task]
        };
        if (analysis.media.frameRateMode === "cfr" && analysis.media.averageFrameRate > 0) {
          result.startFrame = Math.max(0, Math.round(startTime * analysis.media.averageFrameRate));
          result.endFrame = Math.max(result.startFrame, Math.ceil(endTime * analysis.media.averageFrameRate) - 1);
        }
        return result;
      })
    };
  }

  return { buildScenePlan: buildScenePlan, engineFor: engineFor };
});
