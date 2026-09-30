(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.AEJizuraPlan = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var MAX_BEATS = 10000;
  var MAX_LINES = 5000;
  var MAX_CUTS = 10000;

  function fail(message) {
    throw new Error("Invalid JIZURA plan: " + message);
  }

  function finiteNumber(value, label) {
    var number = Number(value);
    if (!isFinite(number)) fail(label + " must be a finite number.");
    return number;
  }

  function cleanText(value) {
    return String(value === undefined || value === null ? "" : value)
      .replace(/[\r\n\t]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120);
  }

  function timedEntries(values, label, maximum, duration) {
    if (!Array.isArray(values)) fail(label + " must be an array.");
    if (values.length > maximum) fail(label + " exceeds the supported limit of " + maximum + ".");
    return values.map(function (entry, index) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        fail(label + "[" + index + "] must be an object.");
      }
      var start = finiteNumber(entry.start, label + "[" + index + "].start");
      if (start < 0 || start >= duration) fail(label + "[" + index + "].start falls outside the plan duration.");
      if (entry.end !== undefined && entry.end !== null) {
        var end = finiteNumber(entry.end, label + "[" + index + "].end");
        if (end <= start || end > duration + 0.001) fail(label + "[" + index + "].end is invalid.");
      }
      return {
        index: Number.isInteger(entry.index) && entry.index >= 0 ? entry.index : index,
        start: Math.round(start * 1000000) / 1000000,
        text: cleanText(entry.text)
      };
    }).sort(function (left, right) { return left.start - right.start || left.index - right.index; });
  }

  function normalizePlan(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) fail("the root must be an object.");
    if (String(value.generator || "").toUpperCase() !== "JIZURA") fail("generator must be JIZURA.");
    var version = Number(value.version);
    if (version !== 1 && version !== 2) fail("version must be 1 or 2.");
    var duration = finiteNumber(value.duration, "duration");
    if (!(duration > 0 && duration <= 86400)) fail("duration must be greater than 0 and no more than 86400 seconds.");
    var fps = finiteNumber(value.fps, "fps");
    if (!(fps > 0 && fps <= 240)) fail("fps must be greater than 0 and no more than 240.");
    if (!Array.isArray(value.beats)) fail("beats must be an array.");
    if (value.beats.length > MAX_BEATS) fail("beats exceeds the supported limit of " + MAX_BEATS + ".");
    var previousBeat = -1;
    var beats = value.beats.map(function (beat, index) {
      var time = finiteNumber(beat, "beats[" + index + "]");
      if (time < 0 || time >= duration) fail("beats[" + index + "] falls outside the plan duration.");
      if (time < previousBeat) fail("beats must be sorted in ascending order.");
      previousBeat = time;
      return Math.round(time * 1000000) / 1000000;
    });
    var lines = timedEntries(value.lines, "lines", MAX_LINES, duration);
    var cuts = timedEntries(value.cuts, "cuts", MAX_CUTS, duration);
    if (!beats.length && !lines.length && !cuts.length) fail("the plan contains no timing events.");
    return {
      format: "accelerated-execution/jizura-timing",
      version: 1,
      sourceVersion: version,
      title: cleanText(value.title),
      duration: Math.round(duration * 1000000) / 1000000,
      fps: Math.round(fps * 1000000) / 1000000,
      beats: beats,
      lines: lines,
      cuts: cuts
    };
  }

  return { normalizePlan: normalizePlan };
});
