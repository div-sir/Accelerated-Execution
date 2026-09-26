import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { frameMetrics, rankCandidates } from "./keyframe-score.mjs";

function progress(options, stage, details = {}) {
  if (typeof options.onProgress === "function") options.onProgress({ stage, ...details });
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], ...options });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      const result = { code, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr).toString("utf8") };
      if (code === 0) resolve(result);
      else reject(new Error(`${command} exited with code ${code}: ${result.stderr.trim()}`));
    });
  });
}

export async function discoverFfmpeg({ ffmpeg = process.env.AE_FFMPEG_PATH || "ffmpeg", ffprobe = process.env.AE_FFPROBE_PATH || "ffprobe" } = {}) {
  const result = { ffmpeg: null, ffprobe: null, ready: false };
  try {
    const version = await run(ffmpeg, ["-version"]);
    result.ffmpeg = { command: ffmpeg, version: version.stdout.toString("utf8").split("\n")[0] };
  } catch (error) {
    result.ffmpeg = { command: ffmpeg, error: error.message };
  }
  try {
    const version = await run(ffprobe, ["-version"]);
    result.ffprobe = { command: ffprobe, version: version.stdout.toString("utf8").split("\n")[0] };
  } catch (error) {
    result.ffprobe = { command: ffprobe, error: error.message };
  }
  result.ready = Boolean(result.ffmpeg.version && result.ffprobe.version);
  return result;
}

function parseRate(value) {
  const [numerator, denominator] = String(value || "0/0").split("/").map(Number);
  return denominator && Number.isFinite(numerator / denominator) ? numerator / denominator : 0;
}

export async function sourceIdentity(input) {
  const realPath = await fs.realpath(input).catch(() => path.resolve(input));
  const stat = await fs.stat(realPath);
  if (!stat.isFile()) throw new Error("Input is not a regular file.");
  const sampleSize = Math.min(stat.size, 1024 * 1024);
  const first = Buffer.alloc(sampleSize);
  const last = Buffer.alloc(sampleSize);
  const handle = await fs.open(realPath, "r");
  try {
    await handle.read(first, 0, sampleSize, 0);
    await handle.read(last, 0, sampleSize, Math.max(0, stat.size - sampleSize));
  } finally {
    await handle.close();
  }
  const hash = crypto.createHash("sha256");
  hash.update("accelerated-execution-sampled-v1\0");
  hash.update(String(stat.size));
  hash.update("\0");
  hash.update(first);
  hash.update(last);
  return {
    path: realPath,
    name: path.basename(realPath),
    size: stat.size,
    modifiedAt: stat.mtime.toISOString(),
    fingerprint: { algorithm: "sha256-sampled-v1", value: hash.digest("hex") },
  };
}

export async function probeMedia(input, {
  ffprobe = process.env.AE_FFPROBE_PATH || "ffprobe",
  signal,
} = {}) {
  const { stdout } = await run(ffprobe, [
    "-v", "error", "-select_streams", "v:0", "-count_frames",
    "-show_entries", "stream=width,height,avg_frame_rate,r_frame_rate,time_base,duration,nb_frames,nb_read_frames:format=duration",
    "-of", "json", input,
  ], { signal });
  const data = JSON.parse(stdout.toString("utf8"));
  const stream = data.streams && data.streams[0];
  if (!stream) throw new Error("No video stream found.");
  const duration = Number(stream.duration || data.format?.duration);
  const averageFrameRate = parseRate(stream.avg_frame_rate);
  const nominalFrameRate = parseRate(stream.r_frame_rate);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("Video duration is unavailable.");
  const comparableRates = averageFrameRate > 0 && nominalFrameRate > 0;
  const tolerance = Math.max(0.001, averageFrameRate * 0.001);
  const frameRateMode = comparableRates
    ? (Math.abs(averageFrameRate - nominalFrameRate) <= tolerance ? "cfr" : "vfr")
    : "unknown";
  const countedFrames = Number(stream.nb_read_frames || stream.nb_frames);
  return {
    width: stream.width,
    height: stream.height,
    duration,
    frameRateMode,
    averageFrameRate: averageFrameRate || null,
    nominalFrameRate: nominalFrameRate || null,
    timeBase: stream.time_base || null,
    frameCount: Number.isInteger(countedFrames) && countedFrames >= 0 ? countedFrames : null,
  };
}

export async function detectSceneCuts(input, {
  threshold = 0.3,
  ffmpeg = process.env.AE_FFMPEG_PATH || "ffmpeg",
  signal,
} = {}) {
  if (!(threshold > 0 && threshold < 1)) throw new RangeError("Scene threshold must be between 0 and 1.");
  const { stderr } = await run(ffmpeg, [
    "-hide_banner", "-i", input,
    "-vf", `select='gt(scene,${threshold})',showinfo`,
    "-an", "-f", "null", "-",
  ], { signal });
  const cuts = [];
  for (const match of stderr.matchAll(/pts_time:([0-9.]+)/g)) {
    const time = Number(match[1]);
    if (Number.isFinite(time) && (cuts.at(-1) === undefined || Math.abs(time - cuts.at(-1)) > 0.01)) cuts.push(time);
  }
  return cuts;
}

export async function generateProxy(input, output, {
  height = 720,
  ffmpeg = process.env.AE_FFMPEG_PATH || "ffmpeg",
  signal,
} = {}) {
  if (!Number.isInteger(height) || height < 144 || height > 2160) {
    throw new RangeError("Proxy height must be an integer between 144 and 2160.");
  }
  await fs.mkdir(path.dirname(path.resolve(output)), { recursive: true });
  await run(ffmpeg, [
    "-v", "error", "-y", "-i", input,
    "-map", "0:v:0", "-an", "-vf", `scale=-2:'min(${height},ih)'`,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "24",
    "-pix_fmt", "yuv420p", "-movflags", "+faststart", output,
  ], { signal });
  return path.resolve(output);
}

export async function extractFrame(input, time, output, {
  ffmpeg = process.env.AE_FFMPEG_PATH || "ffmpeg",
  signal,
} = {}) {
  if (!(typeof time === "number" && Number.isFinite(time) && time >= 0)) {
    throw new RangeError("Frame time must be a non-negative number.");
  }
  const outputPath = path.resolve(output);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await run(ffmpeg, [
    "-v", "error", "-y", "-ss", time.toFixed(6), "-i", input,
    "-map", "0:v:0", "-frames:v", "1", outputPath,
  ], { signal });
  return outputPath;
}

export function buildCandidateTimes(duration, cuts, candidatesPerShot = 3) {
  const boundaries = [0, ...cuts.filter((time) => time > 0 && time < duration), duration];
  const candidates = [];
  for (let shotIndex = 0; shotIndex < boundaries.length - 1; shotIndex += 1) {
    const start = boundaries[shotIndex];
    const end = boundaries[shotIndex + 1];
    const padding = Math.min(0.15, (end - start) * 0.08);
    for (let index = 0; index < candidatesPerShot; index += 1) {
      const fraction = (index + 1) / (candidatesPerShot + 1);
      candidates.push({
        shotIndex,
        shotStart: start,
        shotEnd: end,
        time: start + padding + (end - start - 2 * padding) * fraction,
      });
    }
  }
  return candidates;
}

async function extractGrayFrame(input, time, ffmpeg, signal) {
  const { stdout } = await run(ffmpeg, [
    "-v", "error", "-ss", Math.max(0, time).toFixed(6), "-i", input,
    "-frames:v", "1", "-vf", "scale=160:90,format=gray", "-f", "rawvideo", "pipe:1",
  ], { signal });
  if (stdout.length !== 160 * 90) throw new Error(`Could not decode frame at ${time.toFixed(3)} seconds.`);
  return new Uint8Array(stdout);
}

export async function analyzeCandidates(input, candidates, media, options = {}) {
  const ffmpeg = options.ffmpeg || process.env.AE_FFMPEG_PATH || "ffmpeg";
  const referenceRate = media.averageFrameRate || media.nominalFrameRate || 24;
  const offset = Math.min(0.1, 1 / referenceRate * 2);
  const analyzed = [];
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const [previous, current, next] = await Promise.all([
      extractGrayFrame(input, Math.max(candidate.shotStart, candidate.time - offset), ffmpeg, options.signal),
      extractGrayFrame(input, candidate.time, ffmpeg, options.signal),
      extractGrayFrame(input, Math.min(candidate.shotEnd - 0.001, candidate.time + offset), ffmpeg, options.signal),
    ]);
    const { time, ...candidateMetadata } = candidate;
    analyzed.push({
      ...candidateMetadata,
      timeSeconds: candidate.time,
      sourceFrame: media.frameRateMode === "cfr" ? Math.round(candidate.time * referenceRate) : null,
      metrics: frameMetrics(current, previous, next),
    });
    progress(options, "candidates", { completed: index + 1, total: candidates.length });
  }
  return analyzed;
}

export async function writePreviews(input, candidates, outputDirectory, options = {}) {
  const ffmpeg = options.ffmpeg || process.env.AE_FFMPEG_PATH || "ffmpeg";
  const previewDirectory = path.join(outputDirectory, "previews");
  await fs.mkdir(previewDirectory, { recursive: true });
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const position = candidate.sourceFrame === null
      ? `time-${String(Math.round(candidate.timeSeconds * 1000)).padStart(9, "0")}`
      : `frame-${String(candidate.sourceFrame).padStart(6, "0")}`;
    const filename = `shot-${String(candidate.shotIndex + 1).padStart(3, "0")}-${position}.jpg`;
    await run(ffmpeg, [
      "-v", "error", "-y", "-ss", candidate.timeSeconds.toFixed(6), "-i", input,
      "-frames:v", "1", "-vf", "scale='min(960,iw)':-2", path.join(previewDirectory, filename),
    ], { signal: options.signal });
    candidate.preview = path.join("previews", filename);
    progress(options, "previews", { completed: index + 1, total: candidates.length });
  }
}

export async function analyzeFootage(input, options = {}) {
  progress(options, "probe");
  const [source, media] = await Promise.all([sourceIdentity(input), probeMedia(input, options)]);
  progress(options, "cuts");
  const cuts = await detectSceneCuts(input, options);
  const candidateTimes = buildCandidateTimes(media.duration, cuts, options.candidatesPerShot || 3);
  progress(options, "candidates", { completed: 0, total: candidateTimes.length });
  const analyzed = await analyzeCandidates(input, candidateTimes, media, options);
  const shots = [];
  for (let index = 0; index < cuts.length + 1; index += 1) {
    const ranked = rankCandidates(analyzed.filter((candidate) => candidate.shotIndex === index));
    shots.push({
      id: `shot-${String(index + 1).padStart(3, "0")}`,
      startTime: index === 0 ? 0 : cuts[index - 1],
      endTime: index < cuts.length ? cuts[index] : media.duration,
      candidates: ranked,
      selected: ranked[0] || null,
    });
  }
  const previewCandidates = shots.flatMap((shot) => shot.candidates);
  if (options.outputDirectory && options.previews !== false) {
    progress(options, "previews", { completed: 0, total: previewCandidates.length });
    await writePreviews(input, previewCandidates, options.outputDirectory, options);
  }
  progress(options, "complete", { shots: shots.length });
  return { version: "0.1", source, media, settings: { sceneThreshold: options.threshold || 0.3 }, cuts, shots };
}
