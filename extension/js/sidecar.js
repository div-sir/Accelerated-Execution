(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.AESidecar = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var EVENT_PREFIX = "AE_EVENT ";
  var MAX_CAPTURED_OUTPUT = 64 * 1024;
  var DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;

  function parseEventLine(line) {
    if (line.indexOf(EVENT_PREFIX) !== 0) return null;
    try {
      return JSON.parse(line.slice(EVENT_PREFIX.length));
    } catch (error) {
      return null;
    }
  }

  function fileUrl(filePath, platform) {
    var normalized = String(filePath).replace(/\\/g, "/");
    var prefix = (platform || "").indexOf("win") === 0 ? "file:///" : "file://";
    return encodeURI(prefix + normalized).replace(/#/g, "%23");
  }

  function executableCandidates(environment, platform) {
    var candidates = [];
    if (environment.AE_NODE_PATH) candidates.push(environment.AE_NODE_PATH);
    if (platform === "darwin") {
      candidates.push("/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node");
    } else if (platform === "win32") {
      if (environment.ProgramFiles) candidates.push(environment.ProgramFiles + "\\nodejs\\node.exe");
      if (environment.LOCALAPPDATA) candidates.push(environment.LOCALAPPDATA + "\\Programs\\nodejs\\node.exe");
    } else {
      candidates.push("/usr/local/bin/node", "/usr/bin/node");
    }
    candidates.push("node");
    return candidates;
  }

  function resolveNode(fs, environment, platform) {
    var candidates = executableCandidates(environment, platform);
    for (var index = 0; index < candidates.length; index += 1) {
      if (candidates[index] === "node" || fs.existsSync(candidates[index])) return candidates[index];
    }
    return "node";
  }

  function resolveSidecar(fs, path, extensionPath) {
    var candidates = [path.join(extensionPath, "sidecar", "cli.mjs")];
    var realExtensionPath = extensionPath;
    try {
      if (typeof fs.realpathSync === "function") realExtensionPath = fs.realpathSync(extensionPath);
    } catch (error) {
      realExtensionPath = extensionPath;
    }
    candidates.push(path.resolve(realExtensionPath, "..", "sidecar", "cli.mjs"));
    for (var index = 0; index < candidates.length; index += 1) {
      if (fs.existsSync(candidates[index])) return candidates[index];
    }
    throw new Error("Sidecar CLI not found. Checked: " + candidates.join(", "));
  }

  function extendedEnvironment(environment, platform, path) {
    var result = {};
    Object.keys(environment).forEach(function (key) { result[key] = environment[key]; });
    var delimiter = platform === "win32" ? ";" : ":";
    var additions = platform === "darwin" ? ["/opt/homebrew/bin", "/usr/local/bin"] : ["/usr/local/bin"];
    result.PATH = additions.concat([environment.PATH || ""]).join(delimiter);
    if (!result.AE_FFMPEG_PATH && platform === "darwin" && path.fs.existsSync("/opt/homebrew/bin/ffmpeg")) {
      result.AE_FFMPEG_PATH = "/opt/homebrew/bin/ffmpeg";
    }
    if (!result.AE_FFPROBE_PATH && platform === "darwin" && path.fs.existsSync("/opt/homebrew/bin/ffprobe")) {
      result.AE_FFPROBE_PATH = "/opt/homebrew/bin/ffprobe";
    }
    return result;
  }

  function removeOwnedOutput(fs, directory, owned) {
    if (!owned || !directory) return;
    try {
      if (typeof fs.rmSync === "function") {
        fs.rmSync(directory, { recursive: true, force: true });
      } else if (typeof fs.rmdirSync === "function") {
        fs.rmdirSync(directory, { recursive: true });
      }
    } catch (error) {
      // Cleanup failure must not hide the analysis error.
    }
  }

  function startAnalysis(options, handlers) {
    handlers = handlers || {};
    var deps = options.dependencies || {
      childProcess: require("child_process"),
      fs: require("fs"),
      os: require("os"),
      path: require("path"),
      process: process
    };
    var fs = deps.fs;
    var path = deps.path;
    var runtime = deps.process;
    var cliPath = resolveSidecar(fs, path, options.extensionPath);

    var ownsOutput = !options.outputDirectory;
    var outputDirectory = options.outputDirectory;
    if (!outputDirectory) {
      outputDirectory = fs.mkdtempSync(path.join(deps.os.tmpdir(), "accelerated-execution-"));
    } else {
      fs.mkdirSync(outputDirectory, { recursive: true });
    }

    var nodeCommand = resolveNode(fs, runtime.env, runtime.platform);
    var env = extendedEnvironment(runtime.env, runtime.platform, { fs: fs });
    var args = [cliPath, "analyze", options.source, "--output", outputDirectory, "--events"];
    var child;
    try {
      child = deps.childProcess.spawn(nodeCommand, args, {
        env: env,
        windowsHide: true
      });
    } catch (error) {
      removeOwnedOutput(fs, outputDirectory, ownsOutput);
      throw error;
    }
    var stdoutBuffer = "";
    var stderr = "";
    var settled = false;
    var cleanupWhenSettled = false;
    var timeoutMs = options.timeoutMs === undefined ? DEFAULT_TIMEOUT_MS : Number(options.timeoutMs);
    var timeout = null;

    function finish() {
      if (timeout) clearTimeout(timeout);
      timeout = null;
    }

    function fail(error, cleanup) {
      if (settled) return;
      settled = true;
      cleanupWhenSettled = cleanupWhenSettled || cleanup;
      finish();
      if (cleanup) removeOwnedOutput(fs, outputDirectory, ownsOutput);
      if (handlers.onError) handlers.onError(error);
    }

    function cancel(reason) {
      if (settled) return false;
      try {
        if (runtime.platform === "win32") {
          deps.childProcess.spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
        } else {
          child.kill("SIGTERM");
        }
      } catch (error) {
        // The child may already have exited; fail still settles the UI.
      }
      fail(new Error(reason || "Analysis cancelled."), true);
      return true;
    }

    if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
      timeout = setTimeout(function () {
        var duration = timeoutMs < 1000
          ? timeoutMs + " milliseconds"
          : Math.round(timeoutMs / 1000) + " seconds";
        cancel("Analysis timed out after " + duration + ".");
      }, timeoutMs);
    }

    child.stdout.on("data", function (chunk) {
      stdoutBuffer += chunk.toString();
      if (stdoutBuffer.length > MAX_CAPTURED_OUTPUT) stdoutBuffer = stdoutBuffer.slice(-MAX_CAPTURED_OUTPUT);
      var lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop();
      lines.forEach(function (line) {
        var event = parseEventLine(line);
        if (event && handlers.onProgress) handlers.onProgress(event);
      });
    });
    child.stderr.on("data", function (chunk) {
      stderr = (stderr + chunk.toString()).slice(-MAX_CAPTURED_OUTPUT);
    });
    child.on("error", function (error) { fail(error, true); });
    child.on("close", function (code) {
      if (settled) {
        if (cleanupWhenSettled) removeOwnedOutput(fs, outputDirectory, ownsOutput);
        return;
      }
      if (code !== 0) {
        fail(new Error(stderr.trim() || "Analysis exited with code " + code + "."), true);
        return;
      }
      fs.readFile(path.join(outputDirectory, "analysis.json"), "utf8", function (error, raw) {
        if (error) return fail(error, true);
        try {
          var analysis = JSON.parse(raw);
          settled = true;
          finish();
          if (handlers.onComplete) handlers.onComplete(analysis, outputDirectory);
        } catch (parseError) {
          if (!settled) fail(parseError, true);
          else if (handlers.onError) handlers.onError(parseError);
        }
      });
    });
    return {
      child: child,
      cancel: cancel,
      cleanup: function () { removeOwnedOutput(fs, outputDirectory, ownsOutput); },
      outputDirectory: outputDirectory
    };
  }

  return {
    executableCandidates: executableCandidates,
    fileUrl: fileUrl,
    parseEventLine: parseEventLine,
    resolveNode: resolveNode,
    resolveSidecar: resolveSidecar,
    startAnalysis: startAnalysis
  };
});
