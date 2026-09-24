import { validateExecutionReport } from "./execution-report.mjs";
import { validateScenePlan } from "./scene-plan.mjs";

function contiguousRanges(values) {
  if (!values.length) return [];
  const sorted = [...new Set(values)].sort((a, b) => a - b);
  const ranges = [];
  let start = sorted[0];
  let end = sorted[0];

  for (let index = 1; index < sorted.length; index += 1) {
    const value = sorted[index];
    if (value === end + 1) {
      end = value;
      continue;
    }
    ranges.push({ startFrame: start, endFrame: end });
    start = value;
    end = value;
  }
  ranges.push({ startFrame: start, endFrame: end });
  return ranges;
}

export function buildRetryPlan(evaluation, candidates, options = {}) {
  if (!evaluation || !Array.isArray(evaluation.failedFrames)) {
    throw new TypeError("evaluation.failedFrames must be an array");
  }
  if (!Array.isArray(candidates)) throw new TypeError("candidates must be an array");

  const pad = Math.max(0, Number.isInteger(options.padFrames) ? options.padFrames : 2);
  const maxAnchorDistance = Math.max(1, Number.isInteger(options.maxAnchorDistance) ? options.maxAnchorDistance : 90);
  const ranges = contiguousRanges(evaluation.failedFrames);

  return ranges.map((range) => {
    const center = (range.startFrame + range.endFrame) / 2;
    const eligible = candidates
      .filter((candidate) => Number.isInteger(candidate.frame) && candidate.score >= (options.minCandidateScore ?? 0.6))
      .map((candidate) => ({ ...candidate, distance: Math.abs(candidate.frame - center) }))
      .filter((candidate) => candidate.distance <= maxAnchorDistance)
      .sort((a, b) => a.distance - b.distance || b.score - a.score);

    const anchor = eligible[0] || null;
    return {
      startFrame: Math.max(0, range.startFrame - pad),
      endFrame: range.endFrame + pad,
      anchorFrame: anchor ? anchor.frame : null,
      anchorScore: anchor ? anchor.score : null,
      strategy: anchor ? "reinitialize" : "manual-review",
    };
  });
}

function assertValid(label, result) {
  if (result.valid) return;
  const detail = result.errors.map((error) => `${error.path} ${error.message}`).join("; ");
  throw new TypeError(`${label} is invalid: ${detail}`);
}

function sameSource(left, right) {
  return left.path === right.path &&
    left.size === right.size &&
    left.modifiedAt === right.modifiedAt &&
    left.fingerprint.algorithm === right.fingerprint.algorithm &&
    left.fingerprint.value === right.fingerprint.value;
}

function retryTask(task, engine, action) {
  const result = structuredClone(task);
  result.engine = engine;
  result.action = action;
  delete result.fallbacks;
  return result;
}

function fallbackFor(outcome, task) {
  const planned = Array.isArray(task.fallbacks) ? task.fallbacks : [];
  if (outcome.fallback) {
    const match = planned.find((candidate) => candidate.engine === outcome.fallback.engine &&
      candidate.action === outcome.fallback.action && candidate.condition === outcome.fallback.condition);
    if (!match) throw new Error(`Execution report fallback was not planned for shot: ${outcome.id}`);
    return match;
  }
  if (outcome.recommendation !== "use-next-fallback" && outcome.status !== "failed") return null;
  return planned[0] || null;
}

export function buildExecutionRetryPlan(report, scenePlan, options = {}) {
  assertValid("Execution report", validateExecutionReport(report));
  assertValid("Scene plan", validateScenePlan(scenePlan));
  if (report.planVersion !== scenePlan.version) throw new Error("Execution report and scene plan versions do not match.");
  if (!sameSource(report.source, scenePlan.source)) throw new Error("Execution report and scene plan sources do not match.");

  const shots = new Map(scenePlan.shots.map((shot) => [shot.id, shot]));
  const jobs = [];
  for (const outcome of report.shots) {
    if (outcome.status === "completed") continue;
    const shot = shots.get(outcome.id);
    if (!shot) throw new Error(`Execution report references unknown shot: ${outcome.id}`);
    const task = shot.tasks.find((candidate) => candidate.action === outcome.action);
    if (!task) throw new Error(`Execution outcome action was not planned for shot: ${outcome.id}`);
    const fallback = fallbackFor(outcome, task);
    const strategy = fallback ? "fallback" : outcome.recommendation === "retry-anchor" ? "reinitialize" : "manual-review";
    const job = {
      shotId: outcome.id,
      status: outcome.status,
      strategy,
      automatic: strategy !== "manual-review",
      startTime: shot.startTime,
      endTime: shot.endTime,
      task: fallback
        ? retryTask(task, fallback.engine, fallback.action)
        : retryTask(task, task.engine, task.action),
      recommendation: outcome.recommendation || (strategy === "manual-review" ? "review-target" : "use-next-fallback"),
      reason: outcome.message || `Previous ${outcome.action} execution ended with status ${outcome.status}.`,
    };
    if (Number.isInteger(shot.startFrame)) job.startFrame = shot.startFrame;
    if (Number.isInteger(shot.endFrame)) job.endFrame = shot.endFrame;
    if (fallback) job.trigger = fallback.condition;
    jobs.push(job);
  }

  return {
    version: "0.1",
    reportVersion: report.version,
    createdAt: options.createdAt || new Date().toISOString(),
    source: structuredClone(report.source),
    destination: structuredClone(report.destination),
    summary: {
      automatic: jobs.filter((job) => job.automatic).length,
      manualReview: jobs.filter((job) => !job.automatic).length,
      ignored: report.shots.length - jobs.length,
    },
    jobs,
  };
}
