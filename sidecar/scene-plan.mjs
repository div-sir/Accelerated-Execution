const TASK_TYPES = new Set(["roto", "planar-track", "point-track", "camera-track", "static-mask"]);
const ENGINES = new Set(["ae-native", "mocha", "local-ai", "vision"]);

export function validateScenePlan(plan) {
  const errors = [];
  const fail = (path, message) => errors.push({ path, message });

  if (!plan || typeof plan !== "object" || Array.isArray(plan)) {
    return { valid: false, errors: [{ path: "$", message: "must be an object" }] };
  }
  if (plan.version !== "0.1") fail("$.version", 'must equal "0.1"');
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
    if (!Number.isInteger(shot.startFrame) || shot.startFrame < 0) fail(`${base}.startFrame`, "must be a non-negative integer");
    if (!Number.isInteger(shot.endFrame) || shot.endFrame < 0) fail(`${base}.endFrame`, "must be a non-negative integer");
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
    });
  });

  return { valid: errors.length === 0, errors };
}
