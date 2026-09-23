(function () {
  var status = document.getElementById("status");
  var comp = document.getElementById("comp");
  var analyzeButton = document.getElementById("analyze");
  var results = document.getElementById("results");

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
      var image = document.createElement("img");
      image.alt = shot.id + " selected frame";
      image.src = AESidecar.fileUrl(
        require("path").join(outputDirectory, shot.selected.preview),
        process.platform
      );
      var copy = document.createElement("div");
      var title = document.createElement("strong");
      title.textContent = shot.id + " · frame " + shot.selected.frame;
      var detail = document.createElement("span");
      detail.textContent = shot.selected.time.toFixed(2) + " s · score " + shot.selected.score.toFixed(3);
      copy.appendChild(title);
      copy.appendChild(detail);
      item.appendChild(image);
      item.appendChild(copy);
      results.appendChild(item);
    });
  }

  function startLocalAnalysis(footage) {
    if (typeof require !== "function" || typeof process === "undefined") {
      throw new Error("CEP Node.js integration is unavailable. Check the extension manifest.");
    }
    var cs = getCSInterface();
    var extensionPath = cs && cs.getSystemPath(SystemPath.EXTENSION);
    if (!extensionPath) throw new Error("Could not locate the extension directory.");

    results.textContent = "";
    AESidecar.startAnalysis({ source: footage.path, extensionPath: extensionPath }, {
      onProgress: function (event) { status.textContent = stageMessage(event); },
      onComplete: function (analysis, outputDirectory) {
        analyzeButton.disabled = false;
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
})();
