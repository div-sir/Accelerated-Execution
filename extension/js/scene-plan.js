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

  function rounded(value) {
    return Math.round(value * 1000000) / 1000000;
  }

  function normalizeTarget(target) {
    if (!target || (target.kind !== "point" && target.kind !== "box")) {
      throw new Error("Target must be a point or box.");
    }
    var x = Number(target.x);
    var y = Number(target.y);
    if (!isFinite(x) || !isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) {
      throw new Error("Target coordinates must be normalized between 0 and 1.");
    }
    var normalized = {
      kind: target.kind,
      coordinateSpace: "normalized-source",
      x: rounded(x),
      y: rounded(y)
    };
    if (target.kind === "box") {
      var width = Number(target.width);
      var height = Number(target.height);
      if (!isFinite(width) || !isFinite(height) || width <= 0 || height <= 0 ||
          x + width > 1.000001 || y + height > 1.000001) {
        throw new Error("Target box must have positive dimensions inside the source frame.");
      }
      normalized.width = rounded(Math.min(width, 1 - normalized.x));
      normalized.height = rounded(Math.min(height, 1 - normalized.y));
      if (normalized.width <= 0 || normalized.height <= 0) {
        throw new Error("Target box is too small after coordinate normalization.");
      }
    }
    return normalized;
  }

  function targetFromDrag(startX, startY, endX, endY, width, height, minimumDragPixels) {
    width = Number(width);
    height = Number(height);
    if (!(width > 0) || !(height > 0)) throw new Error("Preview dimensions are unavailable.");
    var minimum = Number(minimumDragPixels);
    if (!(minimum >= 0)) minimum = 4;
    var x1 = Math.max(0, Math.min(width, Number(startX)));
    var y1 = Math.max(0, Math.min(height, Number(startY)));
    var x2 = Math.max(0, Math.min(width, Number(endX)));
    var y2 = Math.max(0, Math.min(height, Number(endY)));
    if (Math.abs(x2 - x1) < minimum || Math.abs(y2 - y1) < minimum) {
      return normalizeTarget({ kind: "point", x: x2 / width, y: y2 / height });
    }
    return normalizeTarget({
      kind: "box",
      x: Math.min(x1, x2) / width,
      y: Math.min(y1, y2) / height,
      width: Math.abs(x2 - x1) / width,
      height: Math.abs(y2 - y1) / height
    });
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
        if (shot.target) task.target = normalizeTarget(shot.target);
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

  return {
    buildScenePlan: buildScenePlan,
    engineFor: engineFor,
    normalizeTarget: normalizeTarget,
    targetFromDrag: targetFromDrag
  };
});
