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

test("resolveSidecar supports packaged and development-symlink layouts", () => {
  const packagedFs = {
    existsSync: (filename) => filename === "/package/sidecar/cli.mjs",
    realpathSync: (filename) => filename,
  };
  assert.equal(sidecar.resolveSidecar(packagedFs, path, "/package"), "/package/sidecar/cli.mjs");

  const developmentFs = {
    existsSync: (filename) => filename === "/repo/sidecar/cli.mjs",
    realpathSync: () => "/repo/extension",
  };
  assert.equal(sidecar.resolveSidecar(developmentFs, path, "/cep/extensions/accelerated"), "/repo/sidecar/cli.mjs");
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

function lifecycleHarness() {
  const child = new EventEmitter();
  child.pid = 4242;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  let killedWith = null;
  child.kill = (signal) => { killedWith = signal; };
  const removed = [];
  const dependencies = {
    childProcess: { spawn: () => child },
    fs: {
      existsSync: () => true,
      mkdtempSync: () => "/tmp/accelerated-execution-owned",
      mkdirSync: () => {},
      readFile: (_filename, _encoding, callback) => callback(null, '{"shots":[]}'),
      rmSync: (directory, options) => removed.push({ directory, options }),
    },
    os: { tmpdir: () => "/tmp" },
    path,
    process: { env: { PATH: "/bin" }, platform: "darwin" },
  };
  return { child, dependencies, removed, killedWith: () => killedWith };
}

test("startAnalysis cancellation terminates the child and removes owned output", async () => {
  const harness = lifecycleHarness();
  let rejectAnalysis;
  const failed = new Promise((resolve) => { rejectAnalysis = resolve; });
  const controller = sidecar.startAnalysis({
    source: "/Footage/source.mp4",
    extensionPath: "/repo/extension",
    dependencies: harness.dependencies,
  }, { onError: rejectAnalysis });

  assert.equal(controller.cancel("Stopped for test."), true);
  assert.equal(controller.cancel("Second cancellation."), false);
  const error = await failed;
  assert.equal(error.message, "Stopped for test.");
  assert.equal(harness.killedWith(), "SIGTERM");
  assert.deepEqual(harness.removed, [{
    directory: "/tmp/accelerated-execution-owned",
    options: { recursive: true, force: true },
  }]);
});

test("startAnalysis bounds captured stderr and cleans up after failure", async () => {
  const harness = lifecycleHarness();
  const failed = new Promise((resolve) => {
    sidecar.startAnalysis({
      source: "/Footage/source.mp4",
      extensionPath: "/repo/extension",
      dependencies: harness.dependencies,
    }, { onError: resolve });
  });

  harness.child.stderr.emit("data", Buffer.from(`discarded-${"x".repeat(100_000)}`));
  harness.child.emit("close", 1);
  const error = await failed;
  assert.equal(error.message.length, 64 * 1024);
  assert.equal(error.message, "x".repeat(64 * 1024));
  assert.equal(harness.removed.length, 1);
});

test("startAnalysis times out and terminates a stalled child", async () => {
  const harness = lifecycleHarness();
  const failed = new Promise((resolve) => {
    sidecar.startAnalysis({
      source: "/Footage/source.mp4",
      extensionPath: "/repo/extension",
      timeoutMs: 5,
      dependencies: harness.dependencies,
    }, { onError: resolve });
  });

  const error = await failed;
  assert.equal(error.message, "Analysis timed out after 5 milliseconds.");
  assert.equal(harness.killedWith(), "SIGTERM");
  assert.equal(harness.removed.length, 1);
});
