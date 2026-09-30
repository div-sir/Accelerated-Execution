import fs from "node:fs/promises";
import path from "node:path";
import { extractFrame, sourceIdentity } from "./ffmpeg.mjs";
import { segmentImage } from "./providers/local-sam.mjs";

function sameSource(left, right) {
  return left.path === right.path &&
    left.size === right.size &&
    left.modifiedAt === right.modifiedAt &&
    left.fingerprint?.algorithm === right.fingerprint?.algorithm &&
    left.fingerprint?.value === right.fingerprint?.value;
}

function validateRetryPlan(plan) {
  if (!plan || typeof plan !== "object" || plan.version !== "0.1") {
    throw new TypeError("Retry plan version 0.1 is required.");
  }
  if (!plan.source || typeof plan.source.path !== "string" || !plan.source.path ||
      !Number.isInteger(plan.source.size) || typeof plan.source.modifiedAt !== "string" ||
      !plan.source.fingerprint || !Number.isInteger(plan.media?.width) || plan.media.width < 1 ||
      !Number.isInteger(plan.media?.height) || plan.media.height < 1 || typeof plan.destination?.compName !== "string" ||
      typeof plan.destination?.layerName !== "string" || !Array.isArray(plan.jobs)) {
    throw new TypeError("Retry plan source and jobs are required.");
  }
  const ids = new Set();
  for (const job of plan.jobs) {
    if (!job || typeof job.shotId !== "string" || !job.shotId || ids.has(job.shotId)) {
      throw new TypeError("Retry jobs require unique shot IDs.");
    }
    ids.add(job.shotId);
    if (typeof job.automatic !== "boolean" || !job.task || typeof job.task !== "object" ||
        typeof job.task.engine !== "string" || typeof job.task.action !== "string") {
      throw new TypeError(`Retry job ${job.shotId} is incomplete.`);
    }
  }
}

function safeName(value) {
  return String(value).replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "") || "shot";
}

export async function executeRetryPlan(plan, options = {}) {
  validateRetryPlan(plan);
  const identify = options.sourceIdentity || sourceIdentity;
  const currentSource = await identify(plan.source.path);
  if (!sameSource(plan.source, currentSource)) {
    throw new Error("Retry plan source identity no longer matches the footage file.");
  }

  const outputDirectory = path.resolve(options.outputDirectory || "retry-execution");
  const frameDirectory = path.join(outputDirectory, "frames");
  const maskDirectory = path.join(outputDirectory, "masks");
  await fs.mkdir(frameDirectory, { recursive: true });
  await fs.mkdir(maskDirectory, { recursive: true });
  const extract = options.extractFrame || extractFrame;
  const segment = options.segmentImage || segmentImage;
  const outcomes = [];

  for (let index = 0; index < plan.jobs.length; index += 1) {
    const job = plan.jobs[index];
    if (!job.automatic) {
      outcomes.push({
        shotId: job.shotId,
        status: "skipped",
        engine: job.task.engine,
        action: job.task.action,
        message: "Manual review is required before this retry can run.",
      });
      continue;
    }
    if (job.task.engine !== "local-ai" || job.task.action !== "sam-segmentation") {
      outcomes.push({
        shotId: job.shotId,
        status: "failed",
        engine: job.task.engine,
        action: job.task.action,
        message: "No retry executor is available for this engine and action.",
      });
      continue;
    }
    if (!(typeof job.task.anchorTime === "number" && Number.isFinite(job.task.anchorTime) && job.task.anchorTime >= 0) ||
        !job.task.target || !["point", "box"].includes(job.task.target.kind)) {
      outcomes.push({
        shotId: job.shotId,
        status: "failed",
        engine: job.task.engine,
        action: job.task.action,
        message: "SAM retry requires an anchor time and point or box target.",
      });
      continue;
    }

    const stem = `${String(index + 1).padStart(3, "0")}-${safeName(job.shotId)}`;
    const framePath = path.join(frameDirectory, `${stem}.png`);
    const jobMaskDirectory = path.join(maskDirectory, stem);
    try {
      await extract(plan.source.path, job.task.anchorTime, framePath, {
        ffmpeg: options.ffmpeg,
        signal: options.signal,
      });
      const result = await segment({
        imagePath: framePath,
        target: job.task.target,
        outputDirectory: jobMaskDirectory,
      }, options.samConfig);
      if (Number(result.width) !== plan.media.width || Number(result.height) !== plan.media.height) {
        throw new Error("Local SAM mask dimensions do not match the analyzed source.");
      }
      const maskPath = path.resolve(result.maskPath);
      const relativeMaskPath = path.relative(path.resolve(jobMaskDirectory), maskPath);
      if (relativeMaskPath.startsWith(".." + path.sep) || path.isAbsolute(relativeMaskPath)) {
        throw new Error("Local SAM returned a mask outside the requested output directory.");
      }
      const maskStat = await fs.stat(maskPath);
      if (!maskStat.isFile()) throw new Error("Local SAM mask path is not a file.");
      outcomes.push({
        shotId: job.shotId,
        status: "completed",
        engine: job.task.engine,
        action: job.task.action,
        startTime: job.startTime,
        endTime: job.endTime,
        anchorTime: job.task.anchorTime,
        framePath,
        maskPath,
        width: result.width,
        height: result.height,
        confidence: typeof result.confidence === "number" ? result.confidence : null,
        provider: result.provider || "local-sam",
        model: result.model || null,
      });
    } catch (error) {
      outcomes.push({
        shotId: job.shotId,
        status: "failed",
        engine: job.task.engine,
        action: job.task.action,
        message: error.message,
      });
    }
  }

  const count = (status) => outcomes.filter((outcome) => outcome.status === status).length;
  return {
    version: "0.1",
    retryPlanVersion: plan.version,
    executedAt: options.executedAt || new Date().toISOString(),
    source: structuredClone(plan.source),
    media: structuredClone(plan.media),
    destination: structuredClone(plan.destination),
    outputDirectory,
    summary: {
      completed: count("completed"),
      failed: count("failed"),
      skipped: count("skipped"),
    },
    jobs: outcomes,
  };
}
