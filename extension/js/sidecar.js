(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.AESidecar = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var EVENT_PREFIX = "AE_EVENT ";

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
    var cliPath = path.resolve(options.extensionPath, "..", "sidecar", "cli.mjs");
    if (!fs.existsSync(cliPath)) throw new Error("Sidecar CLI not found: " + cliPath);

    var outputDirectory = options.outputDirectory || path.join(
      deps.os.tmpdir(),
      "accelerated-execution",
      String(Date.now())
    );
    fs.mkdirSync(outputDirectory, { recursive: true });

    var nodeCommand = resolveNode(fs, runtime.env, runtime.platform);
    var env = extendedEnvironment(runtime.env, runtime.platform, { fs: fs });
    var args = [cliPath, "analyze", options.source, "--output", outputDirectory, "--events"];
    var child = deps.childProcess.spawn(nodeCommand, args, {
      env: env,
      windowsHide: true
    });
    var stdoutBuffer = "";
    var stderr = "";
    var settled = false;

    function fail(error) {
      if (settled) return;
      settled = true;
      if (handlers.onError) handlers.onError(error);
    }

    child.stdout.on("data", function (chunk) {
      stdoutBuffer += chunk.toString();
      var lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop();
      lines.forEach(function (line) {
        var event = parseEventLine(line);
        if (event && handlers.onProgress) handlers.onProgress(event);
      });
    });
    child.stderr.on("data", function (chunk) { stderr += chunk.toString(); });
    child.on("error", fail);
    child.on("close", function (code) {
      if (settled) return;
      if (code !== 0) {
        fail(new Error(stderr.trim() || "Analysis exited with code " + code + "."));
        return;
      }
      fs.readFile(path.join(outputDirectory, "analysis.json"), "utf8", function (error, raw) {
        if (error) return fail(error);
        try {
          settled = true;
          if (handlers.onComplete) handlers.onComplete(JSON.parse(raw), outputDirectory);
        } catch (parseError) {
          fail(parseError);
        }
      });
    });
    return child;
  }

  return {
    executableCandidates: executableCandidates,
    fileUrl: fileUrl,
    parseEventLine: parseEventLine,
    resolveNode: resolveNode,
    startAnalysis: startAnalysis
  };
});
