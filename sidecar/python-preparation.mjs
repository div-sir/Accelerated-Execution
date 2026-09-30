import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_WORKER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../tools/preparation_worker.py");
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const MAX_ERROR_BYTES = 64 * 1024;

function pythonCommand(options = {}) {
  if (options.python) return options.python;
  if (process.env.AE_PYTHON_PATH) return process.env.AE_PYTHON_PATH;
  return process.platform === "win32" ? "python" : "python3";
}

function appendBounded(chunks, chunk, state, maximum, label, child) {
  state.size += chunk.length;
  if (state.size > maximum) {
    child.kill();
    throw new Error(`Python preparation ${label} exceeded ${maximum} bytes.`);
  }
  chunks.push(chunk);
}

function runWorker(payload, options = {}) {
  return new Promise((resolve, reject) => {
    const command = pythonCommand(options);
    const worker = path.resolve(options.workerPath || DEFAULT_WORKER);
    const child = spawn(command, [worker, "score-batch"], {
      stdio: ["pipe", "pipe", "pipe"],
      signal: options.signal,
    });
    const stdout = [];
    const stderr = [];
    const outState = { size: 0 };
    const errorState = { size: 0 };
    let settled = false;
    function fail(error) {
      if (settled) return;
      settled = true;
      reject(error);
    }
    child.on("error", fail);
    child.stdout.on("data", (chunk) => {
      try { appendBounded(stdout, chunk, outState, MAX_OUTPUT_BYTES, "output", child); } catch (error) { fail(error); }
    });
    child.stderr.on("data", (chunk) => {
      try { appendBounded(stderr, chunk, errorState, MAX_ERROR_BYTES, "error output", child); } catch (error) { fail(error); }
    });
    child.on("close", (code) => {
      if (settled) return;
      if (code !== 0) {
        fail(new Error(`Python preparation worker exited with code ${code}: ${Buffer.concat(stderr).toString("utf8").trim()}`));
        return;
      }
      try {
        const parsed = JSON.parse(Buffer.concat(stdout).toString("utf8"));
        settled = true;
        resolve(parsed);
      } catch (error) {
        fail(new Error(`Python preparation worker returned invalid JSON: ${error.message}`));
      }
    });
    child.stdin.on("error", fail);
    child.stdin.end(JSON.stringify(payload));
  });
}

function encodedFrame(frame, label, expectedLength) {
  if (!(frame instanceof Uint8Array) || frame.length !== expectedLength) {
    throw new TypeError(`${label} must be a ${expectedLength}-byte grayscale frame.`);
  }
  return Buffer.from(frame.buffer, frame.byteOffset, frame.byteLength).toString("base64");
}

export async function scoreFrameBatch(frameSets, options = {}) {
  if (!Array.isArray(frameSets) || !frameSets.length) throw new TypeError("frameSets must be a non-empty array.");
  if (frameSets.length > 10000) throw new RangeError("frameSets exceeds the supported limit of 10000.");
  const width = Number(options.width || 160);
  const height = Number(options.height || 90);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 3 || height < 3) {
    throw new RangeError("Frame dimensions must be integers of at least 3 by 3.");
  }
  const expectedLength = width * height;
  const payload = {
    version: 1,
    width,
    height,
    candidates: frameSets.map((set, index) => ({
      previous: encodedFrame(set.previous, `frameSets[${index}].previous`, expectedLength),
      current: encodedFrame(set.current, `frameSets[${index}].current`, expectedLength),
      next: encodedFrame(set.next, `frameSets[${index}].next`, expectedLength),
    })),
  };
  const result = await runWorker(payload, options);
  if (!result || result.ok !== true || !Array.isArray(result.candidates) || result.candidates.length !== frameSets.length) {
    throw new Error("Python preparation worker returned an incomplete candidate batch.");
  }
  return result.candidates.map((candidate, index) => {
    const metrics = candidate && candidate.metrics;
    if (!metrics || typeof metrics !== "object") throw new Error(`Python candidate ${index} has no metrics.`);
    for (const key of ["sharpness", "stability", "visibility", "trackability", "occlusion"]) {
      if (!Number.isFinite(metrics[key]) || metrics[key] < 0 || metrics[key] > 1) {
        throw new Error(`Python candidate ${index} has invalid ${key}.`);
      }
    }
    if (!Number.isFinite(candidate.score)) throw new Error(`Python candidate ${index} has an invalid score.`);
    return { metrics, score: candidate.score };
  });
}

export { DEFAULT_WORKER };
