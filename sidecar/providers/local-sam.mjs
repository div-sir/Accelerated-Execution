import fs from "node:fs/promises";
import path from "node:path";

function normalizeEndpoint(value) {
  if (!value) return null;
  const endpoint = String(value).replace(/\/+$/, "");
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(endpoint)) {
    throw new Error("Local SAM endpoint must use localhost or 127.0.0.1.");
  }
  return endpoint;
}

export function localSamConfig(env = process.env) {
  return {
    endpoint: normalizeEndpoint(env.AE_LOCAL_SAM_ENDPOINT || "http://127.0.0.1:8765"),
    timeoutMs: Math.max(1000, Number(env.AE_LOCAL_SAM_TIMEOUT_MS) || 30000),
  };
}

export async function checkLocalSam(config = localSamConfig()) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(config.timeoutMs, 3000));
    const response = await fetch(config.endpoint + "/health", { signal: controller.signal });
    clearTimeout(timer);
    if (!response.ok) return { available: false, error: "health returned HTTP " + response.status };
    const body = await response.json();
    return { available: body && body.ok === true, provider: body.provider || "local-sam", model: body.model || null };
  } catch (error) {
    return { available: false, error: error.message };
  }
}

export async function segmentImage(request, config = localSamConfig()) {
  if (!request || typeof request !== "object") throw new TypeError("request is required");
  if (!request.imagePath) throw new Error("imagePath is required");
  if (!request.target || !["point", "box"].includes(request.target.kind)) {
    throw new Error("target must be a point or box");
  }

  const imagePath = path.resolve(request.imagePath);
  await fs.access(imagePath);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetch(config.endpoint + "/segment", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        imagePath,
        target: request.target,
        outputDirectory: request.outputDirectory ? path.resolve(request.outputDirectory) : path.dirname(imagePath),
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const message = await response.text();
      throw new Error("Local SAM returned HTTP " + response.status + ": " + message.slice(0, 300));
    }
    const result = await response.json();
    if (!result || result.ok !== true || !result.maskPath) {
      throw new Error("Local SAM returned an invalid result.");
    }
    return result;
  } finally {
    clearTimeout(timer);
  }
}
