(function () {
  var status = document.getElementById("status");
  var comp = document.getElementById("comp");
  var analyzeButton = document.getElementById("analyze");
  var cancelButton = document.getElementById("cancel");
  var applyButton = document.getElementById("apply");
  var executeButton = document.getElementById("execute");
  var importMattesButton = document.getElementById("import-mattes");
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
      complete: "Preparation complete."
    };
    var message = messages[event.stage] || "Analyzing…";
    if (event.total) message += " " + event.completed + "/" + event.total;
    return message;
  }

  function taskOptions() {
    var feather = document.getElementById("mask-feather").value;
    var expansion = document.getElementById("mask-expansion").value;
    return {
      featherPixels: feather === "" ? NaN : Number(feather),
      expansionPixels: expansion === "" ? NaN : Number(expansion)
    };
  }

  function updateTaskControls() {
    document.getElementById("mask-settings").hidden = document.getElementById("task").value !== "static-mask";
  }

  function drawTargetOverlay(container, target, draft) {
    var overlay = document.createElement("span");
    overlay.className = "target-overlay " + target.kind + (draft ? " draft" : "");
    overlay.style.left = (target.x * 100) + "%";
    overlay.style.top = (target.y * 100) + "%";
    if (target.kind === "box") {
      overlay.style.width = (target.width * 100) + "%";
      overlay.style.height = (target.height * 100) + "%";
    }
    container.appendChild(overlay);
    return overlay;
  }

  function bindTargetSelection(preview, shot, analysis, outputDirectory, suppressClick) {
    preview.addEventListener("mousedown", function (downEvent) {
      if (downEvent.button !== 0) return;
      downEvent.preventDefault();
      downEvent.stopPropagation();
      var bounds = preview.getBoundingClientRect();
      var startX = downEvent.clientX - bounds.left;
      var startY = downEvent.clientY - bounds.top;
      var draft = null;

      function update(event) {
        if (draft && draft.parentNode) draft.parentNode.removeChild(draft);
        var target = AEScenePlan.targetFromDrag(
          startX,
          startY,
          event.clientX - bounds.left,
          event.clientY - bounds.top,
          bounds.width,
          bounds.height,
          4
        );
        draft = drawTargetOverlay(preview, target, true);
      }

      function finish(upEvent) {
        window.removeEventListener("mousemove", update);
        window.removeEventListener("mouseup", finish);
        window.removeEventListener("blur", cancel);
        suppressClick.value = true;
        shot.target = AEScenePlan.targetFromDrag(
          startX,
          startY,
          upEvent.clientX - bounds.left,
          upEvent.clientY - bounds.top,
          bounds.width,
          bounds.height,
          4
        );
        status.textContent = shot.target.kind === "box"
          ? "Target box saved for " + shot.id + "."
          : "Target point saved for " + shot.id + ".";
        renderResults(analysis, outputDirectory);
      }

      function cancel() {
        window.removeEventListener("mousemove", update);
        window.removeEventListener("mouseup", finish);
        window.removeEventListener("blur", cancel);
        if (draft && draft.parentNode) draft.parentNode.removeChild(draft);
      }

      window.addEventListener("mousemove", update);
      window.addEventListener("mouseup", finish);
      window.addEventListener("blur", cancel);
      update(downEvent);
    });
  }

  function renderResults(analysis, outputDirectory) {
    results.textContent = "";
    executeButton.disabled = !analysis.shots.length || document.getElementById("task").value !== "static-mask" ||
      !analysis.shots.every(function (shot) { return shot.target && shot.target.kind === "box"; });
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
        var selected = candidate.timeSeconds === shot.selected.timeSeconds;
        var suppressClick = { value: false };
        var button = document.createElement("button");
        button.type = "button";
        button.className = "candidate" + (selected ? " selected" : "");
        button.setAttribute("aria-label", "Select " + candidate.timeSeconds.toFixed(3) + " seconds for " + shot.id);
        var preview = document.createElement("span");
        preview.className = "candidate-preview" + (selected ? " targetable" : "");
        var image = document.createElement("img");
        image.alt = "Candidate at " + candidate.timeSeconds.toFixed(3) + " seconds";
        image.draggable = false;
        image.src = AESidecar.fileUrl(
          require("path").join(outputDirectory, candidate.preview),
          process.platform
        );
        preview.appendChild(image);
        if (selected && shot.target) drawTargetOverlay(preview, shot.target, false);
        if (selected) bindTargetSelection(preview, shot, analysis, outputDirectory, suppressClick);
        var label = document.createElement("span");
        label.className = "candidate-label";
        label.textContent = candidate.sourceFrame === null
          ? candidate.timeSeconds.toFixed(3) + "s · " + candidate.score.toFixed(3)
          : "f" + candidate.sourceFrame + " · " + candidate.score.toFixed(3);
        button.appendChild(preview);
        button.appendChild(label);
        button.addEventListener("click", function () {
          if (suppressClick.value) {
            suppressClick.value = false;
            return;
          }
          if (shot.selected.timeSeconds !== candidate.timeSeconds) shot.target = null;
          shot.selected = candidate;
          renderResults(analysis, outputDirectory);
        });
        candidates.appendChild(button);
      });
      item.appendChild(candidates);

      var targetControls = document.createElement("div");
      targetControls.className = "target-controls";
      var targetStatus = document.createElement("span");
      targetStatus.textContent = shot.target
        ? "Target: " + shot.target.kind + " · click or drag to replace"
        : "Target: click for a point or drag a box on the selected preview";
      targetControls.appendChild(targetStatus);
      if (shot.target) {
        var clearTarget = document.createElement("button");
        clearTarget.type = "button";
        clearTarget.className = "target-clear";
        clearTarget.textContent = "Clear target";
        clearTarget.addEventListener("click", function () {
          shot.target = null;
          status.textContent = "Target cleared for " + shot.id + ".";
          renderResults(analysis, outputDirectory);
        });
        targetControls.appendChild(clearTarget);
      }
      item.appendChild(targetControls);

      var routeStatus = document.createElement("div");
      routeStatus.className = "route-status";
      try {
        var route = AETaskRouter.routeFor(
          document.getElementById("task").value,
          document.getElementById("mode").value,
          shot.target || null
        );
        routeStatus.textContent = "Route: " + route.engine + " / " + route.action +
          (route.fallbacks.length ? " · " + route.fallbacks.length + " fallback(s)" : "");
      } catch (routeError) {
        routeStatus.textContent = "Route pending: " + routeError.message;
      }
      item.appendChild(routeStatus);

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
      var plan = AEScenePlan.buildScenePlan(currentAnalysis, taskType, mode, taskOptions());
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
      var plan = AEScenePlan.buildScenePlan(currentAnalysis, taskType, mode, taskOptions());
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

  function executeStaticMasks() {
    if (!currentAnalysis) return;
    try {
      var taskType = document.getElementById("task").value;
      var mode = document.getElementById("mode").value;
      var plan = AEScenePlan.buildScenePlan(currentAnalysis, taskType, mode, taskOptions());
      var encodedPlan = encodeURIComponent(JSON.stringify(plan));
      executeButton.disabled = true;
      status.textContent = "Executing static masks in After Effects…";
      evalHost("AE_executeStaticMasks(\"" + encodedPlan + "\")", function (raw) {
        try {
          var result = JSON.parse(raw);
          if (result.ok) {
            var message = "Created " + result.created + " static mask(s) on " + result.layerName +
              (result.replaced ? "; replaced " + result.replaced + " managed mask(s)" : "") +
              (result.skipped ? "; skipped " + result.skipped + " out-of-range shot(s)" : "") +
              (result.preservedUserMasks ? "; preserved " + result.preservedUserMasks + " user mask(s)" : "") + ".";
            if (result.warnings && result.warnings.length) message += "\nWarnings:\n- " + result.warnings.join("\n- ");
            try {
              var report = AEExecutionReport.buildExecutionReport(plan, result);
              var reportPath = require("path").join(currentOutputDirectory, "execution-report.json");
              require("fs").writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");
              message += "\nReport: " + reportPath;
            } catch (reportError) {
              message += "\nReport save failed: " + reportError.message;
            }
            status.textContent = message;
          } else {
            status.textContent = result.error;
          }
        } catch (error) {
          status.textContent = raw;
        }
        renderResults(currentAnalysis, currentOutputDirectory);
      });
    } catch (error) {
      status.textContent = "Execution failed: " + error.message;
      renderResults(currentAnalysis, currentOutputDirectory);
    }
  }

  function importRetryMattes() {
    if (!currentAnalysis || !currentOutputDirectory) return;
    try {
      var fs = require("fs");
      var path = require("path");
      var candidates = [
        path.join(currentOutputDirectory, "retry-execution", "retry-execution-report.json"),
        path.join(currentOutputDirectory, "retry-execution-report.json")
      ];
      var reportPath = null;
      var candidateIndex;
      for (candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
        if (fs.existsSync(candidates[candidateIndex])) {
          reportPath = candidates[candidateIndex];
          break;
        }
      }
      if (!reportPath) {
        status.textContent = "No retry execution report found. Run execute-retries with --output " +
          path.join(currentOutputDirectory, "retry-execution") + ".";
        return;
      }
      var report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
      importMattesButton.disabled = true;
      status.textContent = "Importing managed retry matte layers in After Effects…";
      evalHost("AE_importRetryMattes(\"" + encodeURIComponent(JSON.stringify(report)) + "\")", function (raw) {
        importMattesButton.disabled = false;
        try {
          var result = JSON.parse(raw);
          status.textContent = result.ok
            ? "Imported " + result.created + " managed guide matte layer(s)" +
              (result.replaced ? "; replaced " + result.replaced + " previous layer(s)." : ".")
            : result.error;
        } catch (error) {
          status.textContent = raw;
        }
      });
    } catch (error) {
      importMattesButton.disabled = false;
      status.textContent = "Retry matte import failed: " + error.message;
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
    executeButton.disabled = true;
    importMattesButton.disabled = true;
    exportButton.disabled = true;
    activeAnalysis = AESidecar.startAnalysis({ source: footage.path, extensionPath: extensionPath }, {
      onProgress: function (event) { status.textContent = stageMessage(event); },
      onComplete: function (analysis, outputDirectory) {
        activeAnalysis = null;
        analyzeButton.disabled = false;
        cancelButton.disabled = true;
        applyButton.disabled = false;
        exportButton.disabled = false;
        importMattesButton.disabled = false;
        currentAnalysis = analysis;
        currentOutputDirectory = outputDirectory;
        try {
          var preparation = AEPreparation.buildPreparationManifest(analysis);
          var preparationPath = require("path").join(outputDirectory, "preparation.json");
          require("fs").writeFileSync(preparationPath, JSON.stringify(preparation, null, 2) + "\n", "utf8");
          var summary = AEPreparation.preparationSummary(preparation);
          status.textContent = "Prepared " + summary.frames + " working frame(s) across " + summary.shots +
            " shot(s)" + (summary.masks ? " and " + summary.masks + " mask(s)" : "") +
            ". No effects were applied.\nPreparation: " + preparationPath;
        } catch (preparationError) {
          status.textContent = "Preparation finished, but the manifest could not be written: " + preparationError.message;
        }
        renderResults(analysis, outputDirectory);
      },
      onError: function (error) {
        activeAnalysis = null;
        analyzeButton.disabled = false;
        cancelButton.disabled = true;
        status.textContent = "Preparation failed: " + error.message;
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
  executeButton.addEventListener("click", executeStaticMasks);
  importMattesButton.addEventListener("click", importRetryMattes);
  document.getElementById("task").addEventListener("change", function () {
    updateTaskControls();
    if (currentAnalysis && currentOutputDirectory) renderResults(currentAnalysis, currentOutputDirectory);
  });
  document.getElementById("mode").addEventListener("change", function () {
    if (currentAnalysis && currentOutputDirectory) renderResults(currentAnalysis, currentOutputDirectory);
  });
  cancelButton.addEventListener("click", function () {
    if (!activeAnalysis) return;
    cancelButton.disabled = true;
    status.textContent = "Cancelling preparation…";
    activeAnalysis.cancel("Preparation cancelled by user.");
  });
  updateTaskControls();
})();
