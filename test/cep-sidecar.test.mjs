import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const sidecar = require("../extension/js/sidecar.js");

test("parseEventLine accepts only valid sidecar events", () => {
  assert.deepEqual(sidecar.parseEventLine('AE_EVENT {"stage":"cuts"}'), { stage: "cuts" });
  assert.equal(sidecar.parseEventLine("ordinary output"), null);
  assert.equal(sidecar.parseEventLine("AE_EVENT invalid"), null);
});

test("fileUrl handles POSIX, Windows, spaces, and fragments", () => {
  assert.equal(sidecar.fileUrl("/tmp/a b#1.jpg", "darwin"), "file:///tmp/a%20b%231.jpg");
  assert.equal(sidecar.fileUrl("C:\\Temp\\a b.jpg", "win32"), "file:///C:/Temp/a%20b.jpg");
});

test("resolveNode prefers an explicit environment override", () => {
  const fs = { existsSync: (filename) => filename === "/custom/node" };
  assert.equal(sidecar.resolveNode(fs, { AE_NODE_PATH: "/custom/node" }, "darwin"), "/custom/node");
});

test("resolveNode discovers common Apple Silicon installations", () => {
  const fs = { existsSync: (filename) => filename === "/opt/homebrew/bin/node" };
  assert.equal(sidecar.resolveNode(fs, {}, "darwin"), "/opt/homebrew/bin/node");
});

test("startAnalysis passes paths as spawn arguments and returns parsed output", async () => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  let spawned;
  const progress = [];
  const completed = new Promise((resolve, reject) => {
    sidecar.startAnalysis({
      source: "/Footage/source with spaces.mp4",
      extensionPath: "/repo/extension",
      outputDirectory: "/tmp/ae output",
      dependencies: {
        childProcess: {
          spawn(command, args, options) {
            spawned = { command, args, options };
            return child;
          },
        },
        fs: {
          existsSync: () => true,
          mkdirSync: () => {},
          readFile: (_filename, _encoding, callback) => callback(null, '{"shots":[]}'),
        },
        os: { tmpdir: () => "/tmp" },
        path,
        process: { env: { PATH: "/bin" }, platform: "darwin" },
      },
    }, {
      onProgress: (event) => progress.push(event),
      onComplete: resolve,
      onError: reject,
    });
  });

  child.stdout.emit("data", Buffer.from('AE_EVENT {"stage":"cuts"}\n'));
  child.emit("close", 0);
  const analysis = await completed;
  assert.equal(spawned.args[2], "/Footage/source with spaces.mp4");
  assert.equal(spawned.args[4], "/tmp/ae output");
  assert.equal(spawned.options.windowsHide, true);
  assert.deepEqual(progress, [{ stage: "cuts" }]);
  assert.deepEqual(analysis, { shots: [] });
});
