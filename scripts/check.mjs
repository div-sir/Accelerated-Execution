import fs from "node:fs";
import path from "node:path";

const required = [
  "README.md",
  "docs/ARCHITECTURE.md",
  "docs/ROADMAP.md",
  "extension/CSXS/manifest.xml",
  "extension/.debug",
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
  "scripts/cep.mjs",
];

const missing = required.filter((file) => !fs.existsSync(path.resolve(file)));

if (missing.length) {
  console.error("Missing required files:");
  for (const file of missing) console.error("- " + file);
  process.exit(1);
}

JSON.parse(fs.readFileSync("core/schema/scene-plan.schema.json", "utf8"));

const manifest = fs.readFileSync("extension/CSXS/manifest.xml", "utf8");
for (const element of ["MainPath", "ScriptPath"]) {
  const match = manifest.match(new RegExp(`<${element}>([^<]+)</${element}>`));
  if (!match) {
    console.error(`Missing ${element} in CEP manifest.`);
    process.exit(1);
  }
  const target = path.resolve("extension", match[1]);
  if (!fs.existsSync(target)) {
    console.error(`${element} does not resolve from the extension root: ${match[1]}`);
    process.exit(1);
  }
}
console.log("Accelerated Execution scaffold check passed.");
