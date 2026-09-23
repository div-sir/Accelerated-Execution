function AE_json(value) {
  if (typeof JSON !== "undefined" && JSON.stringify) return JSON.stringify(value);
  return '{"ok":false,"error":"JSON unavailable"}';
}

function AE_getHostState() {
  try {
    var item = app.project.activeItem;
    if (!item || !(item instanceof CompItem)) {
      return AE_json({ ok: false, error: "Open or select a composition." });
    }

    return AE_json({
      ok: true,
      compName: item.name,
      duration: item.duration,
      frameRate: item.frameRate,
      width: item.width,
      height: item.height
    });
  } catch (error) {
    return AE_json({ ok: false, error: error.toString() });
  }
}

function AE_footageResult(item) {
  if (!item || !(item instanceof FootageItem) || !item.file) return null;
  if (item.mainSource && item.mainSource.isStill) return null;

  return {
    ok: true,
    name: item.name,
    path: item.file.fsName,
    duration: item.duration,
    frameRate: item.frameRate,
    width: item.width,
    height: item.height
  };
}

function AE_getSelectedFootage() {
  try {
    var item;
    var active = app.project.activeItem;

    if (active && active instanceof CompItem && active.selectedLayers.length) {
      item = active.selectedLayers[0].source;
      var layerResult = AE_footageResult(item);
      if (layerResult) return AE_json(layerResult);
    }

    if (app.project.selection && app.project.selection.length) {
      item = app.project.selection[0];
      var projectResult = AE_footageResult(item);
      if (projectResult) return AE_json(projectResult);
    }

    return AE_json({ ok: false, error: "Select a footage layer or a footage item in the Project panel." });
  } catch (error) {
    return AE_json({ ok: false, error: error.toString() });
  }
}

function AE_normalizePath(value) {
  var normalized = String(value).replace(/\\/g, "/");
  if ($.os.toLowerCase().indexOf("windows") !== -1) normalized = normalized.toLowerCase();
  return normalized;
}

function AE_setCurrentSourceTime(sourceTimeValue, encodedSourcePath) {
  try {
    var item = app.project.activeItem;
    if (!item || !(item instanceof CompItem)) {
      return AE_json({ ok: false, error: "Open or select a composition before setting an anchor." });
    }
    if (!item.selectedLayers.length) {
      return AE_json({ ok: false, error: "Select the analyzed footage layer in the active composition." });
    }
    var layer = item.selectedLayers[0];
    if (!layer.source || !(layer.source instanceof FootageItem)) {
      return AE_json({ ok: false, error: "The selected layer is not footage." });
    }
    if (layer.timeRemapEnabled) {
      return AE_json({ ok: false, error: "Anchor navigation does not yet support time-remapped layers." });
    }
    if (!layer.source.file) {
      return AE_json({ ok: false, error: "The selected footage has no local file." });
    }
    var expectedPath = decodeURIComponent(String(encodedSourcePath));
    if (AE_normalizePath(layer.source.file.fsName) !== AE_normalizePath(expectedPath)) {
      return AE_json({ ok: false, error: "The selected layer is not the footage used for this analysis." });
    }
    var sourceTime = Number(sourceTimeValue);
    if (!isFinite(sourceTime) || sourceTime < 0) {
      return AE_json({ ok: false, error: "Anchor time is invalid." });
    }
    var compTime = layer.startTime + sourceTime * (layer.stretch / 100);
    if (compTime < layer.inPoint || compTime >= layer.outPoint) {
      return AE_json({ ok: false, error: "The anchor is outside the selected layer's trimmed range." });
    }
    item.time = compTime;
    return AE_json({
      ok: true,
      sourceTime: sourceTime,
      compFrame: Math.round(item.time * item.frameRate),
      time: item.time
    });
  } catch (error) {
    return AE_json({ ok: false, error: error.toString() });
  }
}
