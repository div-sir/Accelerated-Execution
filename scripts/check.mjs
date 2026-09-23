import fs from "node:fs";
import path from "node:path";

const required = [
  "README.md",
  "docs/ARCHITECTURE.md",
  "docs/ROADMAP.md",
  "extension/CSXS/manifest.xml",
  "extension/index.html",
  "extension/js/CSInterface.js",
  "extension/js/main.js",
  "extension/js/scene-plan.js",
  "extension/js/sidecar.js",
  "extension/jsx/host.jsx",
  "core/schema/scene-plan.schema.json",
  "sidecar/cli.mjs",
  "sidecar/ffmpeg.mjs",
  "sidecar/keyframe-score.mjs",
  "sidecar/scene-plan.mjs",
];

const missing = required.filter((file) => !fs.existsSync(path.resolve(file)));

if (missing.length) {
  console.error("Missing required files:");
  for (const file of missing) console.error("- " + file);
  process.exit(1);
}

JSON.parse(fs.readFileSync("core/schema/scene-plan.schema.json", "utf8"));
console.log("Accelerated Execution scaffold check passed.");
