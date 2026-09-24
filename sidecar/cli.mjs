#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { analyzeFootage, discoverFfmpeg, generateProxy } from "./ffmpeg.mjs";
import { validateExecutionReport } from "./execution-report.mjs";
import { validateScenePlan } from "./scene-plan.mjs";

function usage() {
  console.log(`Accelerated Execution sidecar

Usage:
  node sidecar/cli.mjs doctor
  node sidecar/cli.mjs analyze <video> [--output <directory>] [--threshold <0..1>] [--candidates <count>] [--events]
  node sidecar/cli.mjs proxy <video> --output <proxy.mp4> [--height <pixels>]
  node sidecar/cli.mjs validate <scene-plan.json>
  node sidecar/cli.mjs validate-report <execution-report.json>`);
}

function option(args, name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
}

async function main() {
  const [, , command, ...args] = process.argv;
  if (command === "doctor") {
    const report = await discoverFfmpeg();
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.ready ? 0 : 1;
    return;
  }
  if (command === "validate") {
    if (!args[0]) throw new Error("Provide a scene-plan JSON file.");
    const plan = JSON.parse(await fs.readFile(args[0], "utf8"));
    const result = validateScenePlan(plan);
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.valid ? 0 : 1;
    return;
  }
  if (command === "validate-report") {
    if (!args[0]) throw new Error("Provide an execution-report JSON file.");
    const report = JSON.parse(await fs.readFile(args[0], "utf8"));
    const result = validateExecutionReport(report);
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.valid ? 0 : 1;
    return;
  }
  if (command === "proxy") {
    if (!args[0]) throw new Error("Provide a video file.");
    const output = option(args, "--output");
    if (!output) throw new Error("Provide --output <proxy.mp4>.");
    const height = Number(option(args, "--height", 720));
    const proxy = await generateProxy(path.resolve(args[0]), path.resolve(output), { height });
    console.log(`Proxy: ${proxy}`);
    return;
  }
  if (command === "analyze") {
    if (!args[0]) throw new Error("Provide a video file to analyze.");
    const outputDirectory = path.resolve(option(args, "--output", "accelerated-execution-analysis"));
    const threshold = Number(option(args, "--threshold", 0.3));
    const candidatesPerShot = Number(option(args, "--candidates", 3));
    if (!Number.isInteger(candidatesPerShot) || candidatesPerShot < 1 || candidatesPerShot > 10) {
      throw new Error("--candidates must be an integer between 1 and 10.");
    }
    await fs.mkdir(outputDirectory, { recursive: true });
    const onProgress = args.includes("--events")
      ? (event) => console.log(`AE_EVENT ${JSON.stringify(event)}`)
      : undefined;
    const controller = new AbortController();
    const abort = () => controller.abort(new Error("Analysis interrupted."));
    process.once("SIGINT", abort);
    process.once("SIGTERM", abort);
    let analysis;
    try {
      analysis = await analyzeFootage(path.resolve(args[0]), {
        outputDirectory,
        threshold,
        candidatesPerShot,
        onProgress,
        signal: controller.signal,
      });
    } finally {
      process.removeListener("SIGINT", abort);
      process.removeListener("SIGTERM", abort);
    }
    const output = path.join(outputDirectory, "analysis.json");
    await fs.writeFile(output, `${JSON.stringify(analysis, null, 2)}\n`);
    console.log(`Analyzed ${analysis.shots.length} shot(s).`);
    console.log(`Results: ${output}`);
    return;
  }
  usage();
  if (command) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
