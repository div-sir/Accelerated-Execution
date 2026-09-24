const STATUSES = new Set(["completed", "warning", "failed", "skipped"]);
const ENGINES = new Set(["ae-native", "mocha", "local-ai", "vision"]);
const RECOMMENDATIONS = new Set(["review-target", "adjust-layer-range", "retry-anchor", "use-next-fallback"]);
const CONDITIONS = new Set(["unavailable", "quality-failed", "semantic-ambiguity"]);

export function validateExecutionReport(report) {
  const errors = [];
  const fail = (path, message) => errors.push({ path, message });
  if (!report || typeof report !== "object" || Array.isArray(report)) {
    return { valid: false, errors: [{ path: "$", message: "must be an object" }] };
  }
  if (report.version !== "0.1") fail("$.version", 'must equal "0.1"');
  if (report.planVersion !== "0.1") fail("$.planVersion", 'must equal "0.1"');
  if (typeof report.executedAt !== "string" || !Number.isFinite(Date.parse(report.executedAt))) {
    fail("$.executedAt", "must be an ISO date-time string");
  }
  if (!report.source || typeof report.source.path !== "string" || !report.source.path) {
    fail("$.source.path", "must be a non-empty string");
  } else {
    if (typeof report.source.name !== "string" || !report.source.name) fail("$.source.name", "must be a non-empty string");
    if (!Number.isInteger(report.source.size) || report.source.size < 0) fail("$.source.size", "must be a non-negative integer");
    if (typeof report.source.modifiedAt !== "string" || !Number.isFinite(Date.parse(report.source.modifiedAt))) {
      fail("$.source.modifiedAt", "must be an ISO date-time string");
    }
    if (!report.source.fingerprint || report.source.fingerprint.algorithm !== "sha256-sampled-v1" ||
        !/^[a-f0-9]{64}$/.test(report.source.fingerprint.value || "")) {
      fail("$.source.fingerprint", "must be a sha256-sampled-v1 fingerprint");
    }
  }
  if (!report.executor || !ENGINES.has(report.executor.engine) || typeof report.executor.action !== "string") {
    fail("$.executor", "must identify a supported engine and action");
  }
  if (!report.destination || typeof report.destination.compName !== "string" ||
      typeof report.destination.layerName !== "string") {
    fail("$.destination", "must identify a composition and layer");
  }
  if (!Array.isArray(report.shots)) {
    fail("$.shots", "must be an array");
    return { valid: false, errors };
  }
  if (!report.shots.length) fail("$.shots", "must contain at least one outcome");
  const actual = { completed: 0, warning: 0, failed: 0, skipped: 0 };
  const ids = new Set();
  report.shots.forEach((shot, index) => {
    const base = `$.shots[${index}]`;
    if (!shot || typeof shot !== "object" || Array.isArray(shot)) {
      fail(base, "must be an object");
      return;
    }
    if (typeof shot.id !== "string" || !shot.id) fail(`${base}.id`, "must be a non-empty string");
    else if (ids.has(shot.id)) fail(`${base}.id`, "must be unique");
    else ids.add(shot.id);
    if (!STATUSES.has(shot.status)) fail(`${base}.status`, "is not supported");
    else actual[shot.status] += 1;
    if (typeof shot.action !== "string" || !shot.action) fail(`${base}.action`, "must be a non-empty string");
    if (shot.coverage !== undefined &&
        !(typeof shot.coverage === "number" && shot.coverage >= 0 && shot.coverage <= 1)) {
      fail(`${base}.coverage`, "must be between 0 and 1");
    }
    if (shot.recommendation !== undefined && !RECOMMENDATIONS.has(shot.recommendation)) {
      fail(`${base}.recommendation`, "is not supported");
    }
    if (shot.fallback !== undefined) {
      if (!shot.fallback || !ENGINES.has(shot.fallback.engine) || typeof shot.fallback.action !== "string" ||
          !CONDITIONS.has(shot.fallback.condition)) {
        fail(`${base}.fallback`, "must identify a supported fallback");
      }
    }
  });
  if (!report.summary || typeof report.summary !== "object") {
    fail("$.summary", "must be an object");
  } else {
    for (const status of STATUSES) {
      if (report.summary[status] !== actual[status]) fail(`$.summary.${status}`, "must match shot outcomes");
    }
  }
  return { valid: errors.length === 0, errors };
}
