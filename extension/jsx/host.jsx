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
        action: task.action ? String(task.action) : null,
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
      if (entry.action) comment += " | " + entry.action;
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

function AE_executeStaticMasks(encodedScenePlan) {
  var undoStarted = false;
  try {
    var item = app.project.activeItem;
    if (!item || !(item instanceof CompItem)) {
      return AE_json({ ok: false, error: "Open or select a composition before executing static masks." });
    }
    if (!item.selectedLayers.length) {
      return AE_json({ ok: false, error: "Select the analyzed footage layer in the active composition." });
    }
    var layer = item.selectedLayers[0];
    if (!layer.source || !(layer.source instanceof FootageItem) || !layer.source.file) {
      return AE_json({ ok: false, error: "The selected layer is not local footage." });
    }
    if (layer.timeRemapEnabled) {
      return AE_json({ ok: false, error: "Static-mask execution does not yet support time-remapped layers." });
    }
    if (layer.locked) {
      return AE_json({ ok: false, error: "Unlock the selected footage layer before executing static masks." });
    }
    if (!isFinite(Number(layer.stretch)) || Number(layer.stretch) === 0) {
      return AE_json({ ok: false, error: "The selected layer has an invalid stretch value." });
    }

    var plan = JSON.parse(decodeURIComponent(String(encodedScenePlan)));
    if (!plan || plan.version !== "0.1" || !plan.source || !plan.source.path || !plan.media) {
      return AE_json({ ok: false, error: "The scene plan is missing its version, source, or media metadata." });
    }
    if (AE_normalizePath(layer.source.file.fsName) !== AE_normalizePath(plan.source.path)) {
      return AE_json({ ok: false, error: "The selected layer is not the footage used by this scene plan." });
    }
    if (Number(plan.media.width) !== Number(layer.source.width) ||
        Number(plan.media.height) !== Number(layer.source.height)) {
      return AE_json({ ok: false, error: "The selected footage dimensions differ from the analyzed source." });
    }
    var mediaDuration = Number(plan.media.duration);
    if (!isFinite(mediaDuration) || mediaDuration <= 0) {
      return AE_json({ ok: false, error: "The scene plan has an invalid media duration." });
    }
    if (!plan.shots || typeof plan.shots.length !== "number" || !plan.shots.length) {
      return AE_json({ ok: false, error: "The scene plan has no shots to execute." });
    }

    var planned = [];
    var skipped = 0;
    var warnings = [];
    var shotResults = [];
    var tolerance = Math.max(0.000001, item.frameDuration / 4);
    var shotIndex;
    for (shotIndex = 0; shotIndex < plan.shots.length; shotIndex += 1) {
      var shot = plan.shots[shotIndex];
      if (!shot || !shot.tasks || shot.tasks.length !== 1) {
        return AE_json({ ok: false, error: "Each shot must contain exactly one static-mask task." });
      }
      var task = shot.tasks[0];
      if (task.type !== "static-mask" || task.engine !== "ae-native" || task.action !== "static-mask") {
        return AE_json({ ok: false, error: "This executor only supports ae-native static-mask tasks." });
      }
      var target = task.target;
      if (!target || target.kind !== "box" || target.coordinateSpace !== "normalized-source") {
        return AE_json({ ok: false, error: "Static-mask tasks require a normalized source box." });
      }
      var parameters = task.parameters;
      var featherPixels = parameters ? Number(parameters.featherPixels) : NaN;
      var expansionPixels = parameters ? Number(parameters.expansionPixels) : NaN;
      if (!isFinite(featherPixels) || featherPixels < 0 || featherPixels > 500 ||
          !isFinite(expansionPixels) || expansionPixels < -500 || expansionPixels > 500) {
        return AE_json({ ok: false, error: "Static-mask feather or expansion parameters are invalid." });
      }
      var x = Number(target.x);
      var y = Number(target.y);
      var width = Number(target.width);
      var height = Number(target.height);
      if (!isFinite(x) || !isFinite(y) || !isFinite(width) || !isFinite(height) ||
          x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 1.000001 || y + height > 1.000001) {
        return AE_json({ ok: false, error: "Static-mask target bounds are invalid." });
      }
      var shotId = String(shot.id || "shot-" + (shotIndex + 1));
      var right = Math.min(1, x + width);
      var bottom = Math.min(1, y + height);
      var coverage = Math.round((right - x) * (bottom - y) * 1000000) / 1000000;
      var qualityMessage = null;
      if (coverage < 0.001) qualityMessage = shotId + " covers less than 0.1% of the source frame.";
      if (coverage > 0.9) qualityMessage = shotId + " covers more than 90% of the source frame.";
      var sourceStart = Number(shot.startTime);
      var sourceEnd = Number(shot.endTime);
      if (!isFinite(sourceStart) || !isFinite(sourceEnd) || sourceStart < 0 ||
          sourceEnd <= sourceStart || sourceEnd > mediaDuration + tolerance) {
        return AE_json({ ok: false, error: "Shot " + (shotIndex + 1) + " has invalid time bounds." });
      }
      var mappedStart = layer.startTime + sourceStart * (layer.stretch / 100);
      var mappedEnd = layer.startTime + sourceEnd * (layer.stretch / 100);
      var visibleStart = Math.max(layer.inPoint, Math.min(mappedStart, mappedEnd));
      var visibleEnd = Math.min(layer.outPoint, Math.max(mappedStart, mappedEnd));
      if (visibleEnd - visibleStart <= tolerance) {
        skipped += 1;
        shotResults.push({
          id: shotId,
          status: "skipped",
          action: "static-mask",
          coverage: coverage,
          message: "Shot does not overlap the selected layer's visible range.",
          recommendation: "adjust-layer-range"
        });
        continue;
      }
      if (qualityMessage) warnings.push(qualityMessage);
      var shotResult = {
        id: shotId,
        status: qualityMessage ? "warning" : "completed",
        action: "static-mask",
        coverage: coverage
      };
      if (qualityMessage) {
        shotResult.message = qualityMessage;
        shotResult.recommendation = "review-target";
      }
      shotResults.push(shotResult);
      planned.push({
        shotId: shotId,
        startTime: visibleStart,
        endTime: visibleEnd,
        featherPixels: featherPixels,
        expansionPixels: expansionPixels,
        vertices: [
          [x * layer.source.width, y * layer.source.height],
          [right * layer.source.width, y * layer.source.height],
          [right * layer.source.width, bottom * layer.source.height],
          [x * layer.source.width, bottom * layer.source.height]
        ]
      });
    }
    if (!planned.length) {
      return AE_json({ ok: false, error: "No static-mask shot overlaps the selected layer's visible range." });
    }

    var masks = layer.property("ADBE Mask Parade") || layer.property("Masks");
    if (!masks || typeof masks.canAddProperty !== "function" || !masks.canAddProperty("ADBE Mask Atom")) {
      return AE_json({ ok: false, error: "The selected layer cannot accept masks." });
    }
    var maskPrefix = "Accelerated Execution | ";
    var managed = [];
    var userMaskCount = 0;
    var maskIndex;
    for (maskIndex = 1; maskIndex <= masks.numProperties; maskIndex += 1) {
      var existingMask = masks.property(maskIndex);
      if (existingMask && String(existingMask.name).indexOf(maskPrefix) === 0) managed.push(existingMask);
      else userMaskCount += 1;
    }

    app.beginUndoGroup("Execute Accelerated Execution Static Masks");
    undoStarted = true;
    for (maskIndex = managed.length - 1; maskIndex >= 0; maskIndex -= 1) managed[maskIndex].remove();
    for (shotIndex = 0; shotIndex < planned.length; shotIndex += 1) {
      var entry = planned[shotIndex];
      var mask = masks.addProperty("ADBE Mask Atom");
      mask.name = maskPrefix + entry.shotId + " | static-mask";
      mask.maskMode = MaskMode.ADD;
      var shape = new Shape();
      shape.vertices = entry.vertices;
      shape.inTangents = [[0, 0], [0, 0], [0, 0], [0, 0]];
      shape.outTangents = [[0, 0], [0, 0], [0, 0], [0, 0]];
      shape.closed = true;
      mask.property("ADBE Mask Shape").setValue(shape);
      mask.property("ADBE Mask Feather").setValue([entry.featherPixels, entry.featherPixels]);
      mask.property("ADBE Mask Offset").setValue(entry.expansionPixels);

      var opacity = mask.property("ADBE Mask Opacity");
      if (entry.startTime - layer.inPoint > tolerance) opacity.setValueAtTime(layer.inPoint, 0);
      opacity.setValueAtTime(entry.startTime, 100);
      opacity.setValueAtTime(entry.endTime, 0);
      var opacityKey;
      for (opacityKey = 1; opacityKey <= opacity.numKeys; opacityKey += 1) {
        opacity.setInterpolationTypeAtKey(opacityKey, KeyframeInterpolationType.HOLD, KeyframeInterpolationType.HOLD);
      }
    }
    app.endUndoGroup();
    undoStarted = false;
    return AE_json({
      ok: true,
      compName: item.name,
      layerName: layer.name,
      created: planned.length,
      replaced: managed.length,
      skipped: skipped,
      preservedUserMasks: userMaskCount,
      warnings: warnings,
      shots: shotResults
    });
  } catch (error) {
    if (undoStarted) {
      try { app.endUndoGroup(); } catch (undoError) {}
    }
    return AE_json({ ok: false, error: error.toString() });
  }
}
