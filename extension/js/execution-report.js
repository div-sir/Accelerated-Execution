(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.AEExecutionReport = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var STATUSES = ["completed", "warning", "failed", "skipped"];

  function buildExecutionReport(plan, hostResult, executedAt) {
    if (!plan || plan.version !== "0.1" || !plan.source) throw new Error("A valid scene plan is required.");
    if (!hostResult || !hostResult.ok || !Array.isArray(hostResult.shots) || !hostResult.shots.length) {
      throw new Error("A successful host result with shot outcomes is required.");
    }
    var counts = { completed: 0, warning: 0, failed: 0, skipped: 0 };
    var shots = hostResult.shots.map(function (shot) {
      if (!shot || STATUSES.indexOf(shot.status) === -1 || !shot.id) {
        throw new Error("Host result contains an invalid shot outcome.");
      }
      counts[shot.status] += 1;
      var result = {
        id: String(shot.id),
        status: shot.status,
        action: String(shot.action || "static-mask")
      };
      if (typeof shot.coverage === "number") result.coverage = shot.coverage;
      if (shot.message) result.message = String(shot.message);
      if (shot.recommendation) result.recommendation = String(shot.recommendation);
      if (shot.fallback) result.fallback = shot.fallback;
      return result;
    });
    return {
      version: "0.1",
      planVersion: plan.version,
      executedAt: executedAt || new Date().toISOString(),
      source: plan.source,
      executor: { engine: "ae-native", action: "static-mask" },
      destination: { compName: hostResult.compName, layerName: hostResult.layerName },
      summary: counts,
      shots: shots
    };
  }

  return { buildExecutionReport: buildExecutionReport };
});
