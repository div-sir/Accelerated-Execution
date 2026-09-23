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

function AE_applyScenePlan(encodedScenePlan) {
  var undoStarted = false;
  try {
    var item = app.project.activeItem;
    if (!item || !(item instanceof CompItem)) {
      return AE_json({ ok: false, error: "Open or select a composition before applying a scene plan." });
    }
    if (!item.selectedLayers.length) {
      return AE_json({ ok: false, error: "Select the analyzed footage layer in the active composition." });
    }
    var layer = item.selectedLayers[0];
    if (!layer.source || !(layer.source instanceof FootageItem) || !layer.source.file) {
      return AE_json({ ok: false, error: "The selected layer is not local footage." });
    }
    if (layer.timeRemapEnabled) {
      return AE_json({ ok: false, error: "Scene-plan application does not yet support time-remapped layers." });
    }

    var plan = JSON.parse(decodeURIComponent(String(encodedScenePlan)));
    if (!plan || plan.version !== "0.1" || !plan.source || !plan.source.path) {
      return AE_json({ ok: false, error: "The scene plan is missing its version or source identity." });
    }
    if (AE_normalizePath(layer.source.file.fsName) !== AE_normalizePath(plan.source.path)) {
      return AE_json({ ok: false, error: "The selected layer is not the footage used by this scene plan." });
    }
    if (!plan.shots || typeof plan.shots.length !== "number" || !plan.shots.length) {
      return AE_json({ ok: false, error: "The scene plan has no shots to apply." });
    }

    var markerProperty = layer.property("ADBE Marker") || layer.property("Marker");
    if (!markerProperty) {
      return AE_json({ ok: false, error: "The selected layer does not expose a marker property." });
    }
    var markerPrefix = "Accelerated Execution | ";
    var tolerance = Math.max(0.000001, item.frameDuration / 4);
    var managedKeys = [];
    var keyIndex;
    for (keyIndex = 1; keyIndex <= markerProperty.numKeys; keyIndex += 1) {
      var existingValue = markerProperty.keyValue(keyIndex);
      if (existingValue && String(existingValue.comment).indexOf(markerPrefix) === 0) {
        managedKeys.push(keyIndex);
      }
    }

    var planned = [];
    var shotIndex;
    for (shotIndex = 0; shotIndex < plan.shots.length; shotIndex += 1) {
      var shot = plan.shots[shotIndex];
      if (!shot || !shot.tasks || !shot.tasks.length) {
        return AE_json({ ok: false, error: "Shot " + (shotIndex + 1) + " has no task." });
      }
      var task = shot.tasks[0];
      var startTime = Number(shot.startTime);
      var endTime = Number(shot.endTime);
      var anchorTime = Number(task.anchorTime);
      if (!isFinite(startTime) || !isFinite(endTime) || !isFinite(anchorTime) ||
          startTime < 0 || endTime <= startTime || anchorTime < startTime || anchorTime >= endTime) {
        return AE_json({ ok: false, error: "Shot " + (shotIndex + 1) + " has invalid time bounds." });
      }
      var compTime = layer.startTime + anchorTime * (layer.stretch / 100);
      if (compTime < layer.inPoint || compTime >= layer.outPoint) {
        return AE_json({ ok: false, error: "Anchor for shot " + (shotIndex + 1) + " is outside the selected layer's trimmed range." });
      }
      var plannedIndex;
      for (plannedIndex = 0; plannedIndex < planned.length; plannedIndex += 1) {
        if (Math.abs(planned[plannedIndex].compTime - compTime) < tolerance) {
          return AE_json({ ok: false, error: "Two scene-plan anchors resolve to the same composition frame." });
        }
      }
      for (keyIndex = 1; keyIndex <= markerProperty.numKeys; keyIndex += 1) {
        var value = markerProperty.keyValue(keyIndex);
        var isManaged = value && String(value.comment).indexOf(markerPrefix) === 0;
        if (!isManaged && Math.abs(markerProperty.keyTime(keyIndex) - compTime) < tolerance) {
          return AE_json({ ok: false, error: "A user marker already occupies the anchor frame for " + shot.id + "." });
        }
      }
      planned.push({
        shotId: String(shot.id || "shot-" + (shotIndex + 1)),
        taskType: String(task.type || "unknown"),
        engine: String(task.engine || "unknown"),
        anchorTime: anchorTime,
        compTime: compTime,
        confidence: Number(task.confidence),
        targetKind: task.target ? String(task.target.kind) : null
      });
    }

    app.beginUndoGroup("Apply Accelerated Execution Scene Plan");
    undoStarted = true;
    for (keyIndex = managedKeys.length - 1; keyIndex >= 0; keyIndex -= 1) {
      markerProperty.removeKey(managedKeys[keyIndex]);
    }
    for (shotIndex = 0; shotIndex < planned.length; shotIndex += 1) {
      var entry = planned[shotIndex];
      var comment = markerPrefix + entry.shotId + " | " + entry.taskType + " | " + entry.engine;
      if (entry.targetKind) comment += " | target " + entry.targetKind;
      if (isFinite(entry.confidence)) comment += " | confidence " + entry.confidence.toFixed(3);
      var marker = new MarkerValue(comment);
      marker.chapter = entry.shotId;
      markerProperty.setValueAtTime(entry.compTime, marker);
    }
    app.endUndoGroup();
    undoStarted = false;
    return AE_json({
      ok: true,
      compName: item.name,
      layerName: layer.name,
      added: planned.length,
      replaced: managedKeys.length
    });
  } catch (error) {
    if (undoStarted) {
      try { app.endUndoGroup(); } catch (undoError) {}
    }
    return AE_json({ ok: false, error: error.toString() });
  }
}
