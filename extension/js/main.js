(function () {
  var status = document.getElementById("status");
  var comp = document.getElementById("comp");
  var analyzeButton = document.getElementById("analyze");
  var exportButton = document.getElementById("export");
  var results = document.getElementById("results");
  var currentAnalysis = null;
  var currentOutputDirectory = null;

  function getCSInterface() {
    if (typeof CSInterface !== "undefined") return new CSInterface();
    return null;
  }

  function evalHost(script, callback) {
    var cs = getCSInterface();
    if (!cs) {
      callback(JSON.stringify({ ok: false, error: "CSInterface is not loaded." }));
      return;
    }
    cs.evalScript(script, callback);
  }

  function stageMessage(event) {
    var messages = {
      probe: "Reading video metadata…",
      cuts: "Detecting scene cuts…",
      candidates: "Scoring candidate frames…",
      previews: "Writing selected previews…",
      complete: "Analysis complete."
    };
    var message = messages[event.stage] || "Analyzing…";
    if (event.total) message += " " + event.completed + "/" + event.total;
    return message;
  }

  function renderResults(analysis, outputDirectory) {
    results.textContent = "";
    analysis.shots.forEach(function (shot) {
      if (!shot.selected) return;
      var item = document.createElement("div");
      item.className = "shot";
      var header = document.createElement("div");
      header.className = "shot-header";
      var title = document.createElement("strong");
      title.textContent = shot.id;
      var detail = document.createElement("span");
      detail.textContent = "anchor " + shot.selected.frame;
      header.appendChild(title);
      header.appendChild(detail);
      item.appendChild(header);

      var candidates = document.createElement("div");
      candidates.className = "candidates";
      shot.candidates.forEach(function (candidate) {
        var button = document.createElement("button");
        button.type = "button";
        button.className = "candidate" + (candidate.frame === shot.selected.frame ? " selected" : "");
        button.setAttribute("aria-label", "Select frame " + candidate.frame + " for " + shot.id);
        var image = document.createElement("img");
        image.alt = "Frame " + candidate.frame;
        image.src = AESidecar.fileUrl(
          require("path").join(outputDirectory, candidate.preview),
          process.platform
        );
        var label = document.createElement("span");
        label.textContent = "f" + candidate.frame + " · " + candidate.score.toFixed(3);
        button.appendChild(image);
        button.appendChild(label);
        button.addEventListener("click", function () {
          shot.selected = candidate;
          renderResults(analysis, outputDirectory);
        });
        candidates.appendChild(button);
      });
      item.appendChild(candidates);

      var locate = document.createElement("button");
      locate.type = "button";
      locate.textContent = "Go to anchor in After Effects";
      locate.addEventListener("click", function () {
        var frame = Number(shot.selected.frame);
        var sourceFrameRate = Number(analysis.media.frameRate);
        evalHost("AE_setCurrentSourceFrame(" + frame + "," + sourceFrameRate + ")", function (raw) {
          try {
            var result = JSON.parse(raw);
            status.textContent = result.ok
              ? "After Effects moved to comp frame " + result.compFrame +
                " for source frame " + result.sourceFrame + "."
              : result.error;
          } catch (error) {
            status.textContent = raw;
          }
        });
      });
      item.appendChild(locate);
      results.appendChild(item);
    });
  }

  function exportScenePlan() {
    if (!currentAnalysis || !currentOutputDirectory) return;
    try {
      var taskType = document.getElementById("task").value;
      var mode = document.getElementById("mode").value;
      var plan = AEScenePlan.buildScenePlan(currentAnalysis, taskType, mode);
      var path = require("path");
      var output = path.join(currentOutputDirectory, "scene-plan.json");
      require("fs").writeFileSync(output, JSON.stringify(plan, null, 2) + "\n", "utf8");
      status.textContent = "Scene plan exported: " + output;
    } catch (error) {
      status.textContent = "Export failed: " + error.message;
    }
  }

  function startLocalAnalysis(footage) {
    if (typeof require !== "function" || typeof process === "undefined") {
      throw new Error("CEP Node.js integration is unavailable. Check the extension manifest.");
    }
    var cs = getCSInterface();
    var extensionPath = cs && cs.getSystemPath(SystemPath.EXTENSION);
    if (!extensionPath) throw new Error("Could not locate the extension directory.");

    results.textContent = "";
    exportButton.disabled = true;
    AESidecar.startAnalysis({ source: footage.path, extensionPath: extensionPath }, {
      onProgress: function (event) { status.textContent = stageMessage(event); },
      onComplete: function (analysis, outputDirectory) {
        analyzeButton.disabled = false;
        exportButton.disabled = false;
        currentAnalysis = analysis;
        currentOutputDirectory = outputDirectory;
        status.textContent = "Analyzed " + analysis.shots.length + " shot(s). Results: " + outputDirectory;
        renderResults(analysis, outputDirectory);
      },
      onError: function (error) {
        analyzeButton.disabled = false;
        status.textContent = "Analysis failed: " + error.message;
      }
    });
  }

  document.getElementById("inspect").addEventListener("click", function () {
    evalHost("AE_getHostState()", function (raw) {
      try {
        var result = JSON.parse(raw);
        comp.textContent = result.ok ? result.compName + " — " + result.duration.toFixed(2) + " s" : result.error;
      } catch (error) {
        comp.textContent = raw;
      }
    });
  });

  analyzeButton.addEventListener("click", function () {
    analyzeButton.disabled = true;
    status.textContent = "Checking the selected footage…";
    evalHost("AE_getSelectedFootage()", function (raw) {
      try {
        var result = JSON.parse(raw);
        if (!result.ok) {
          analyzeButton.disabled = false;
          status.textContent = result.error;
          return;
        }
        startLocalAnalysis(result);
      } catch (error) {
        analyzeButton.disabled = false;
        status.textContent = "Analysis failed: " + error.message;
      }
    });
  });

  exportButton.addEventListener("click", exportScenePlan);
})();
