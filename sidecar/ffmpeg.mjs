import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { frameMetrics, rankCandidates } from "./keyframe-score.mjs";

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

export async function probeMedia(input, { ffprobe = process.env.AE_FFPROBE_PATH || "ffprobe" } = {}) {
  const { stdout } = await run(ffprobe, [
    "-v", "error", "-select_streams", "v:0",
    "-show_entries", "stream=width,height,avg_frame_rate,duration:format=duration",
    "-of", "json", input,
  ]);
  const data = JSON.parse(stdout.toString("utf8"));
  const stream = data.streams && data.streams[0];
  if (!stream) throw new Error("No video stream found.");
  const [numerator, denominator] = String(stream.avg_frame_rate || "0/1").split("/").map(Number);
  const duration = Number(stream.duration || data.format?.duration);
  const frameRate = denominator ? numerator / denominator : 0;
  if (!Number.isFinite(duration) || duration <= 0 || !frameRate) throw new Error("Video duration or frame rate is unavailable.");
  return { width: stream.width, height: stream.height, duration, frameRate, frameCount: Math.round(duration * frameRate) };
}

export async function detectSceneCuts(input, { threshold = 0.3, ffmpeg = process.env.AE_FFMPEG_PATH || "ffmpeg" } = {}) {
  if (!(threshold > 0 && threshold < 1)) throw new RangeError("Scene threshold must be between 0 and 1.");
  const { stderr } = await run(ffmpeg, [
    "-hide_banner", "-i", input,
    "-vf", `select='gt(scene,${threshold})',showinfo`,
    "-an", "-f", "null", "-",
  ]);
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
  ]);
  return path.resolve(output);
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

async function extractGrayFrame(input, time, ffmpeg) {
  const { stdout } = await run(ffmpeg, [
    "-v", "error", "-ss", Math.max(0, time).toFixed(6), "-i", input,
    "-frames:v", "1", "-vf", "scale=160:90,format=gray", "-f", "rawvideo", "pipe:1",
  ]);
  if (stdout.length !== 160 * 90) throw new Error(`Could not decode frame at ${time.toFixed(3)} seconds.`);
  return new Uint8Array(stdout);
}

export async function analyzeCandidates(input, candidates, media, { ffmpeg = process.env.AE_FFMPEG_PATH || "ffmpeg" } = {}) {
  const offset = Math.min(0.1, 1 / media.frameRate * 2);
  const analyzed = [];
  for (const candidate of candidates) {
    const [previous, current, next] = await Promise.all([
      extractGrayFrame(input, Math.max(candidate.shotStart, candidate.time - offset), ffmpeg),
      extractGrayFrame(input, candidate.time, ffmpeg),
      extractGrayFrame(input, Math.min(candidate.shotEnd - 0.001, candidate.time + offset), ffmpeg),
    ]);
    analyzed.push({ ...candidate, frame: Math.round(candidate.time * media.frameRate), metrics: frameMetrics(current, previous, next) });
  }
  return analyzed;
}

export async function writePreviews(input, candidates, outputDirectory, { ffmpeg = process.env.AE_FFMPEG_PATH || "ffmpeg" } = {}) {
  const previewDirectory = path.join(outputDirectory, "previews");
  await fs.mkdir(previewDirectory, { recursive: true });
  for (const candidate of candidates) {
    const filename = `shot-${String(candidate.shotIndex + 1).padStart(3, "0")}-frame-${String(candidate.frame).padStart(6, "0")}.jpg`;
    await run(ffmpeg, [
      "-v", "error", "-y", "-ss", candidate.time.toFixed(6), "-i", input,
      "-frames:v", "1", "-vf", "scale='min(960,iw)':-2", path.join(previewDirectory, filename),
    ]);
    candidate.preview = path.join("previews", filename);
  }
}

export async function analyzeFootage(input, options = {}) {
  const media = await probeMedia(input, options);
  const cuts = await detectSceneCuts(input, options);
  const candidateTimes = buildCandidateTimes(media.duration, cuts, options.candidatesPerShot || 3);
  const analyzed = await analyzeCandidates(input, candidateTimes, media, options);
  const shots = [];
  for (let index = 0; index < cuts.length + 1; index += 1) {
    const ranked = rankCandidates(analyzed.filter((candidate) => candidate.shotIndex === index));
    shots.push({
      id: `shot-${String(index + 1).padStart(3, "0")}`,
      start: index === 0 ? 0 : cuts[index - 1],
      end: index < cuts.length ? cuts[index] : media.duration,
      candidates: ranked,
      selected: ranked[0] || null,
    });
  }
  const selected = shots.map((shot) => shot.selected).filter(Boolean);
  if (options.outputDirectory && options.previews !== false) await writePreviews(input, selected, options.outputDirectory, options);
  return { version: "0.1", source: path.resolve(input), media, settings: { sceneThreshold: options.threshold || 0.3 }, cuts, shots };
}
