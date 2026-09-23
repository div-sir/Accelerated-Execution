(function () {
  var status = document.getElementById("status");
  var comp = document.getElementById("comp");

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

  document.getElementById("analyze").addEventListener("click", function () {
    status.textContent = "Checking the selected footage…";
    evalHost("AE_getSelectedFootage()", function (raw) {
      try {
        var result = JSON.parse(raw);
        if (!result.ok) {
          status.textContent = result.error;
          return;
        }

        status.textContent = [
          result.name,
          result.width + " × " + result.height,
          result.duration.toFixed(2) + " s at " + result.frameRate.toFixed(3) + " fps",
          "Ready for local analysis: " + result.path
        ].join("\n");
      } catch (error) {
        status.textContent = raw;
      }
    });
  });
})();
