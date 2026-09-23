(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.AEPreparation = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function buildPreparationManifest(analysis) {
    if (!analysis || !analysis.source || !analysis.media || !Array.isArray(analysis.shots)) {
      throw new Error("Analysis result is incomplete.");
    }

    return {
      version: "0.1",
      mode: "prepare-only",
      source: analysis.source,
      media: analysis.media,
      shots: analysis.shots.map(function (shot, index) {
        if (!shot.selected || !(Number(shot.selected.timeSeconds) >= 0)) {
          throw new Error("Shot " + (index + 1) + " has no selected preparation frame.");
        }

        return {
          id: shot.id || "shot-" + String(index + 1).padStart(3, "0"),
          startTime: Number(shot.startTime),
          endTime: Number(shot.endTime),
          preparation: {
            anchorTime: Number(shot.selected.timeSeconds),
            anchorFrame: Number.isInteger(shot.selected.sourceFrame) ? shot.selected.sourceFrame : null,
            score: Math.max(0, Math.min(1, Number(shot.selected.score) || 0)),
            preview: shot.selected.preview,
            target: shot.target || null,
            mask: shot.preparedMask || null,
            state: shot.preparedMask ? "mask-ready" : "frame-ready"
          }
        };
      })
    };
  }

  function preparationSummary(manifest) {
    var masks = 0;
    manifest.shots.forEach(function (shot) {
      if (shot.preparation && shot.preparation.mask) masks += 1;
    });
    return {
      shots: manifest.shots.length,
      frames: manifest.shots.length,
      masks: masks
    };
  }

  return {
    buildPreparationManifest: buildPreparationManifest,
    preparationSummary: preparationSummary
  };
});
