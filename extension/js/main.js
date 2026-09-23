(function () {
  var status = document.getElementById("status");
  var comp = document.getElementById("comp");
  var analyzeButton = document.getElementById("analyze");
  var cancelButton = document.getElementById("cancel");
  var applyButton = document.getElementById("apply");
  var exportButton = document.getElementById("export");
  var results = document.getElementById("results");
  var currentAnalysis = null;
  var currentOutputDirectory = null;
  var activeAnalysis = null;

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
      detail.textContent = "anchor " + shot.selected.timeSeconds.toFixed(3) + " s";
      header.appendChild(title);
      header.appendChild(detail);
      item.appendChild(header);

      var candidates = document.createElement("div");
      candidates.className = "candidates";
      shot.candidates.forEach(function (candidate) {
        var button = document.createElement("button");
        button.type = "button";
        button.className = "candidate" + (candidate.timeSeconds === shot.selected.timeSeconds ? " selected" : "");
        button.setAttribute("aria-label", "Select " + candidate.timeSeconds.toFixed(3) + " seconds for " + shot.id);
        var image = document.createElement("img");
        image.alt = "Candidate at " + candidate.timeSeconds.toFixed(3) + " seconds";
        image.src = AESidecar.fileUrl(
          require("path").join(outputDirectory, candidate.preview),
          process.platform
        );
        var label = document.createElement("span");
        label.textContent = candidate.sourceFrame === null
          ? candidate.timeSeconds.toFixed(3) + "s · " + candidate.score.toFixed(3)
          : "f" + candidate.sourceFrame + " · " + candidate.score.toFixed(3);
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
        var sourceTime = Number(shot.selected.timeSeconds);
        var sourcePath = encodeURIComponent(analysis.source.path);
        evalHost("AE_setCurrentSourceTime(" + sourceTime + ",\"" + sourcePath + "\")", function (raw) {
          try {
            var result = JSON.parse(raw);
            status.textContent = result.ok
              ? "After Effects moved to comp frame " + result.compFrame +
                " for source time " + result.sourceTime.toFixed(3) + " s."
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

  function applyScenePlan() {
    if (!currentAnalysis) return;
    try {
      var taskType = document.getElementById("task").value;
      var mode = document.getElementById("mode").value;
      var plan = AEScenePlan.buildScenePlan(currentAnalysis, taskType, mode);
      var encodedPlan = encodeURIComponent(JSON.stringify(plan));
      applyButton.disabled = true;
      status.textContent = "Applying scene-plan markers in After Effects…";
      evalHost("AE_applyScenePlan(\"" + encodedPlan + "\")", function (raw) {
        applyButton.disabled = false;
        try {
          var result = JSON.parse(raw);
          status.textContent = result.ok
            ? "Applied " + result.added + " anchor marker(s) to " + result.layerName +
              (result.replaced ? "; replaced " + result.replaced + " previous marker(s)." : ".")
            : result.error;
        } catch (error) {
          status.textContent = raw;
        }
      });
    } catch (error) {
      applyButton.disabled = false;
      status.textContent = "Apply failed: " + error.message;
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
    applyButton.disabled = true;
    exportButton.disabled = true;
    activeAnalysis = AESidecar.startAnalysis({ source: footage.path, extensionPath: extensionPath }, {
      onProgress: function (event) { status.textContent = stageMessage(event); },
      onComplete: function (analysis, outputDirectory) {
        activeAnalysis = null;
        analyzeButton.disabled = false;
        cancelButton.disabled = true;
        applyButton.disabled = false;
        exportButton.disabled = false;
        currentAnalysis = analysis;
        currentOutputDirectory = outputDirectory;
        status.textContent = "Analyzed " + analysis.shots.length + " shot(s). Results: " + outputDirectory;
        renderResults(analysis, outputDirectory);
      },
      onError: function (error) {
        activeAnalysis = null;
        analyzeButton.disabled = false;
        cancelButton.disabled = true;
        status.textContent = "Analysis failed: " + error.message;
      }
    });
    cancelButton.disabled = false;
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
  applyButton.addEventListener("click", applyScenePlan);
  cancelButton.addEventListener("click", function () {
    if (!activeAnalysis) return;
    cancelButton.disabled = true;
    status.textContent = "Cancelling analysis…";
    activeAnalysis.cancel("Analysis cancelled by user.");
  });
})();
