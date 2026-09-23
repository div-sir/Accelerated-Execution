const TASK_TYPES = new Set(["roto", "planar-track", "point-track", "camera-track", "static-mask"]);
const ENGINES = new Set(["ae-native", "mocha", "local-ai", "vision"]);
const TARGET_KINDS = new Set(["point", "box"]);

export function validateScenePlan(plan) {
  const errors = [];
  const fail = (path, message) => errors.push({ path, message });

  if (!plan || typeof plan !== "object" || Array.isArray(plan)) {
    return { valid: false, errors: [{ path: "$", message: "must be an object" }] };
  }
  if (plan.version !== "0.1") fail("$.version", 'must equal "0.1"');
  if (!plan.source || typeof plan.source !== "object" || Array.isArray(plan.source)) {
    fail("$.source", "must be an object");
  } else {
    if (typeof plan.source.path !== "string" || !plan.source.path) fail("$.source.path", "must be a non-empty string");
    if (typeof plan.source.name !== "string" || !plan.source.name) fail("$.source.name", "must be a non-empty string");
    if (!Number.isInteger(plan.source.size) || plan.source.size < 0) fail("$.source.size", "must be a non-negative integer");
    if (typeof plan.source.modifiedAt !== "string" || !Number.isFinite(Date.parse(plan.source.modifiedAt))) {
      fail("$.source.modifiedAt", "must be an ISO date-time string");
    }
    if (!plan.source.fingerprint || plan.source.fingerprint.algorithm !== "sha256-sampled-v1" ||
        !/^[a-f0-9]{64}$/.test(plan.source.fingerprint.value || "")) {
      fail("$.source.fingerprint", "must be a sha256-sampled-v1 fingerprint");
    }
  }
  if (!plan.media || typeof plan.media !== "object" || Array.isArray(plan.media)) {
    fail("$.media", "must be an object");
  } else {
    if (!Number.isInteger(plan.media.width) || plan.media.width < 1) fail("$.media.width", "must be a positive integer");
    if (!Number.isInteger(plan.media.height) || plan.media.height < 1) fail("$.media.height", "must be a positive integer");
    if (!(typeof plan.media.duration === "number" && plan.media.duration > 0)) fail("$.media.duration", "must be positive");
    if (!["cfr", "vfr", "unknown"].includes(plan.media.frameRateMode)) {
      fail("$.media.frameRateMode", "must be cfr, vfr, or unknown");
    }
  }
  if (!Array.isArray(plan.shots)) {
    fail("$.shots", "must be an array");
    return { valid: false, errors };
  }

  const ids = new Set();
  plan.shots.forEach((shot, shotIndex) => {
    const base = `$.shots[${shotIndex}]`;
    if (!shot || typeof shot !== "object" || Array.isArray(shot)) {
      fail(base, "must be an object");
      return;
    }
    if (typeof shot.id !== "string" || !shot.id.trim()) fail(`${base}.id`, "must be a non-empty string");
    else if (ids.has(shot.id)) fail(`${base}.id`, "must be unique");
    else ids.add(shot.id);
    if (!(typeof shot.startTime === "number" && shot.startTime >= 0)) fail(`${base}.startTime`, "must be non-negative");
    if (!(typeof shot.endTime === "number" && shot.endTime > shot.startTime)) fail(`${base}.endTime`, "must be greater than startTime");
    if (shot.startFrame !== undefined && (!Number.isInteger(shot.startFrame) || shot.startFrame < 0)) {
      fail(`${base}.startFrame`, "must be a non-negative integer");
    }
    if (shot.endFrame !== undefined && (!Number.isInteger(shot.endFrame) || shot.endFrame < 0)) {
      fail(`${base}.endFrame`, "must be a non-negative integer");
    }
    if (Number.isInteger(shot.startFrame) && Number.isInteger(shot.endFrame) && shot.endFrame < shot.startFrame) {
      fail(`${base}.endFrame`, "must be greater than or equal to startFrame");
    }
    if (!Array.isArray(shot.tasks)) {
      fail(`${base}.tasks`, "must be an array");
      return;
    }
    shot.tasks.forEach((task, taskIndex) => {
      const taskBase = `${base}.tasks[${taskIndex}]`;
      if (!task || typeof task !== "object" || Array.isArray(task)) {
        fail(taskBase, "must be an object");
        return;
      }
      if (!TASK_TYPES.has(task.type)) fail(`${taskBase}.type`, "is not a supported task type");
      if (!ENGINES.has(task.engine)) fail(`${taskBase}.engine`, "is not a supported engine");
      if (!(typeof task.anchorTime === "number" && task.anchorTime >= shot.startTime && task.anchorTime < shot.endTime)) {
        fail(`${taskBase}.anchorTime`, "must fall inside its shot");
      }
      if (task.confidence !== undefined &&
          (typeof task.confidence !== "number" || task.confidence < 0 || task.confidence > 1)) {
        fail(`${taskBase}.confidence`, "must be between 0 and 1");
      }
      if (task.anchorFrame !== undefined) {
        if (!Number.isInteger(task.anchorFrame) || task.anchorFrame < 0) {
          fail(`${taskBase}.anchorFrame`, "must be a non-negative integer");
        } else if (Number.isInteger(shot.startFrame) && Number.isInteger(shot.endFrame) &&
                   (task.anchorFrame < shot.startFrame || task.anchorFrame > shot.endFrame)) {
          fail(`${taskBase}.anchorFrame`, "must fall inside its shot");
        }
      }
      if (task.target !== undefined) {
        const target = task.target;
        if (!target || typeof target !== "object" || Array.isArray(target)) {
          fail(`${taskBase}.target`, "must be an object");
        } else {
          if (!TARGET_KINDS.has(target.kind)) fail(`${taskBase}.target.kind`, "must be point or box");
          if (target.coordinateSpace !== "normalized-source") {
            fail(`${taskBase}.target.coordinateSpace`, 'must equal "normalized-source"');
          }
          for (const coordinate of ["x", "y"]) {
            if (!(typeof target[coordinate] === "number" && target[coordinate] >= 0 && target[coordinate] <= 1)) {
              fail(`${taskBase}.target.${coordinate}`, "must be between 0 and 1");
            }
          }
          if (target.kind === "box") {
            if (!(typeof target.width === "number" && target.width > 0 && target.width <= 1)) {
              fail(`${taskBase}.target.width`, "must be greater than 0 and at most 1");
            }
            if (!(typeof target.height === "number" && target.height > 0 && target.height <= 1)) {
              fail(`${taskBase}.target.height`, "must be greater than 0 and at most 1");
            }
            if (typeof target.x === "number" && typeof target.width === "number" && target.x + target.width > 1.000001) {
              fail(`${taskBase}.target.width`, "must stay inside the source frame");
            }
            if (typeof target.y === "number" && typeof target.height === "number" && target.y + target.height > 1.000001) {
              fail(`${taskBase}.target.height`, "must stay inside the source frame");
            }
          }
        }
      }
    });
  });

  return { valid: errors.length === 0, errors };
}
