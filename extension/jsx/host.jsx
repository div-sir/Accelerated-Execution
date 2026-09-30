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

function AE_findFootageByPath(filePath) {
  var itemIndex;
  for (itemIndex = 1; itemIndex <= app.project.numItems; itemIndex += 1) {
    var projectItem = app.project.item(itemIndex);
    if (projectItem && projectItem instanceof FootageItem && projectItem.file &&
        AE_normalizePath(projectItem.file.fsName) === AE_normalizePath(filePath)) {
      return projectItem;
    }
  }
  return null;
}

function AE_removeAllProperties(group) {
  if (!group || typeof group.numProperties !== "number") return;
  var propertyIndex;
  for (propertyIndex = group.numProperties; propertyIndex >= 1; propertyIndex -= 1) {
    var child = group.property(propertyIndex);
    if (child && typeof child.remove === "function") child.remove();
  }
}

function AE_importRetryMattes(encodedReport) {
  var undoStarted = false;
  var importedItems = [];
  try {
    var item = app.project.activeItem;
    if (!item || !(item instanceof CompItem)) {
      return AE_json({ ok: false, error: "Open or select a composition before importing retry mattes." });
    }
    if (!item.selectedLayers.length) {
      return AE_json({ ok: false, error: "Select the analyzed footage layer in the active composition." });
    }
    var layer = item.selectedLayers[0];
    if (!layer.source || !(layer.source instanceof FootageItem) || !layer.source.file) {
      return AE_json({ ok: false, error: "The selected layer is not local footage." });
    }
    if (layer.timeRemapEnabled) {
      return AE_json({ ok: false, error: "Retry matte import does not support time-remapped layers." });
    }
    if (layer.locked) {
      return AE_json({ ok: false, error: "Unlock the selected footage layer before importing retry mattes." });
    }
    if (!isFinite(Number(layer.stretch)) || Number(layer.stretch) === 0) {
      return AE_json({ ok: false, error: "The selected layer has an invalid stretch value." });
    }

    var report = JSON.parse(decodeURIComponent(String(encodedReport)));
    if (!report || report.version !== "0.1" || report.retryPlanVersion !== "0.1" ||
        !report.source || !report.source.path || !report.media || !report.destination) {
      return AE_json({ ok: false, error: "The retry execution report is incomplete or unsupported." });
    }
    if (AE_normalizePath(layer.source.file.fsName) !== AE_normalizePath(report.source.path)) {
      return AE_json({ ok: false, error: "The selected layer is not the footage used by this retry report." });
    }
    if (String(report.destination.compName) !== String(item.name) ||
        String(report.destination.layerName) !== String(layer.name)) {
      return AE_json({ ok: false, error: "The retry report targets a different composition or layer." });
    }
    if (Number(report.media.width) !== Number(layer.source.width) ||
        Number(report.media.height) !== Number(layer.source.height)) {
      return AE_json({ ok: false, error: "The retry report dimensions differ from the selected footage." });
    }
    if (!report.jobs || typeof report.jobs.length !== "number") {
      return AE_json({ ok: false, error: "The retry execution report has no job outcomes." });
    }

    var planned = [];
    var shotIds = {};
    var completedCount = 0;
    var jobIndex;
    var tolerance = Math.max(0.000001, item.frameDuration / 4);
    for (jobIndex = 0; jobIndex < report.jobs.length; jobIndex += 1) {
      var job = report.jobs[jobIndex];
      if (!job || job.status !== "completed") continue;
      completedCount += 1;
      var shotId = String(job.shotId || "");
      if (!shotId || shotIds[shotId]) {
        return AE_json({ ok: false, error: "Completed retry jobs require unique shot IDs." });
      }
      shotIds[shotId] = true;
      if (job.engine !== "local-ai" || job.action !== "sam-segmentation") {
        return AE_json({ ok: false, error: "Only completed local-ai sam-segmentation jobs can be imported." });
      }
      if (!job.maskPath || Number(job.width) !== Number(report.media.width) ||
          Number(job.height) !== Number(report.media.height)) {
        return AE_json({ ok: false, error: "Retry matte dimensions or path are invalid for " + shotId + "." });
      }
      var maskFile = new File(String(job.maskPath));
      if (!maskFile.exists) {
        return AE_json({ ok: false, error: "Retry matte file is missing for " + shotId + "." });
      }
      var sourceStart = Number(job.startTime);
      var sourceEnd = Number(job.endTime);
      var anchorTime = Number(job.anchorTime);
      if (!isFinite(sourceStart) || !isFinite(sourceEnd) || !isFinite(anchorTime) ||
          sourceStart < 0 || sourceEnd <= sourceStart || anchorTime < sourceStart || anchorTime >= sourceEnd) {
        return AE_json({ ok: false, error: "Retry matte time bounds are invalid for " + shotId + "." });
      }
      var mappedStart = layer.startTime + sourceStart * (layer.stretch / 100);
      var mappedEnd = layer.startTime + sourceEnd * (layer.stretch / 100);
      var visibleStart = Math.max(layer.inPoint, Math.min(mappedStart, mappedEnd));
      var visibleEnd = Math.min(layer.outPoint, Math.max(mappedStart, mappedEnd));
      if (visibleEnd - visibleStart <= tolerance) {
        return AE_json({ ok: false, error: "Retry matte shot is outside the selected layer range: " + shotId + "." });
      }
      planned.push({
        shotId: shotId,
        maskPath: maskFile.fsName,
        inPoint: visibleStart,
        outPoint: visibleEnd,
        confidence: Number(job.confidence)
      });
    }
    if (report.summary && Number(report.summary.completed) !== completedCount) {
      return AE_json({ ok: false, error: "Retry report summary does not match its completed jobs." });
    }
    if (!planned.length) {
      return AE_json({ ok: false, error: "The retry execution report has no completed mattes to import." });
    }

    var layerPrefix = "Accelerated Execution Matte | ";
    var managedLayers = [];
    var layerIndex;
    for (layerIndex = 1; layerIndex <= item.numLayers; layerIndex += 1) {
      var existingLayer = item.layer(layerIndex);
      if (existingLayer && String(existingLayer.name).indexOf(layerPrefix) === 0) managedLayers.push(existingLayer);
    }
    var preservedUserLayers = item.numLayers - managedLayers.length;

    app.beginUndoGroup("Import Accelerated Execution Retry Mattes");
    undoStarted = true;
    for (jobIndex = 0; jobIndex < planned.length; jobIndex += 1) {
      var entry = planned[jobIndex];
      var maskSource = AE_findFootageByPath(entry.maskPath);
      if (!maskSource) {
        maskSource = app.project.importFile(new ImportOptions(new File(entry.maskPath)));
        importedItems.push(maskSource);
      }
      if (!maskSource || Number(maskSource.width) !== Number(report.media.width) ||
          Number(maskSource.height) !== Number(report.media.height)) {
        throw new Error("Imported matte dimensions do not match the source for " + entry.shotId + ".");
      }
      entry.source = maskSource;
    }
    for (layerIndex = managedLayers.length - 1; layerIndex >= 0; layerIndex -= 1) {
      managedLayers[layerIndex].locked = false;
      managedLayers[layerIndex].remove();
    }
    var created = [];
    for (jobIndex = 0; jobIndex < planned.length; jobIndex += 1) {
      var plannedEntry = planned[jobIndex];
      var matteLayer = layer.duplicate();
      matteLayer.locked = false;
      matteLayer.replaceSource(plannedEntry.source, false);
      AE_removeAllProperties(matteLayer.property("ADBE Mask Parade") || matteLayer.property("Masks"));
      AE_removeAllProperties(matteLayer.property("ADBE Effect Parade") || matteLayer.property("Effects"));
      matteLayer.name = layerPrefix + plannedEntry.shotId + " | sam-segmentation";
      matteLayer.comment = "Managed by Accelerated Execution; source layer: " + layer.name;
      matteLayer.inPoint = plannedEntry.inPoint;
      matteLayer.outPoint = plannedEntry.outPoint;
      matteLayer.guideLayer = true;
      matteLayer.audioEnabled = false;
      matteLayer.enabled = true;
      matteLayer.solo = false;
      matteLayer.adjustmentLayer = false;
      if (typeof TrackMatteType !== "undefined") matteLayer.trackMatteType = TrackMatteType.NO_TRACK_MATTE;
      matteLayer.shy = true;
      matteLayer.moveBefore(layer);
      matteLayer.locked = true;
      created.push({
        shotId: plannedEntry.shotId,
        layerName: matteLayer.name,
        confidence: isFinite(plannedEntry.confidence) ? plannedEntry.confidence : null
      });
    }
    app.endUndoGroup();
    undoStarted = false;
    return AE_json({
      ok: true,
      compName: item.name,
      sourceLayerName: layer.name,
      created: created.length,
      replaced: managedLayers.length,
      preservedUserLayers: preservedUserLayers,
      layers: created
    });
  } catch (error) {
    var importedIndex;
    for (importedIndex = importedItems.length - 1; importedIndex >= 0; importedIndex -= 1) {
      try { importedItems[importedIndex].remove(); } catch (removeError) {}
    }
    if (undoStarted) {
      try { app.endUndoGroup(); } catch (undoError) {}
    }
    return AE_json({ ok: false, error: error.toString() });
  }
}

function AE_buildForegroundMatteStack() {
  var undoStarted = false;
  try {
    var item = app.project.activeItem;
    if (!item || !(item instanceof CompItem)) {
      return AE_json({ ok: false, error: "Open or select a composition before building the foreground stack." });
    }
    if (!item.selectedLayers.length) {
      return AE_json({ ok: false, error: "Select the analyzed footage layer in the active composition." });
    }
    var sourceLayer = item.selectedLayers[0];
    if (!sourceLayer.source || !(sourceLayer.source instanceof FootageItem) || !sourceLayer.source.file) {
      return AE_json({ ok: false, error: "The selected layer is not local footage." });
    }
    if (sourceLayer.locked) {
      return AE_json({ ok: false, error: "Unlock the selected footage layer before building the foreground stack." });
    }
    var mattePrefix = "Accelerated Execution Matte | ";
    var foregroundPrefix = "Accelerated Execution Foreground | ";
    var mattes = [];
    var managedForegrounds = [];
    var layerIndex;
    for (layerIndex = 1; layerIndex <= item.numLayers; layerIndex += 1) {
      var candidate = item.layer(layerIndex);
      if (!candidate) continue;
      if (String(candidate.name).indexOf(mattePrefix) === 0) mattes.push(candidate);
      if (String(candidate.name).indexOf(foregroundPrefix) === 0) managedForegrounds.push(candidate);
    }
    if (!mattes.length) {
      return AE_json({ ok: false, error: "Import completed SAM retry mattes before building the foreground stack." });
    }
    if (typeof sourceLayer.setTrackMatte !== "function" || typeof TrackMatteType === "undefined") {
      return AE_json({ ok: false, error: "This After Effects version does not expose the required Track Matte API." });
    }
    var seenShots = {};
    var planned = [];
    for (layerIndex = 0; layerIndex < mattes.length; layerIndex += 1) {
      var matte = mattes[layerIndex];
      var suffix = String(matte.name).substring(mattePrefix.length);
      var delimiter = suffix.indexOf(" | ");
      var shotId = delimiter >= 0 ? suffix.substring(0, delimiter) : suffix;
      if (!shotId || seenShots[shotId]) {
        return AE_json({ ok: false, error: "Managed SAM mattes require unique shot IDs." });
      }
      seenShots[shotId] = true;
      if (!(Number(matte.inPoint) < Number(matte.outPoint)) ||
          Number(matte.inPoint) < Number(sourceLayer.inPoint) ||
          Number(matte.outPoint) > Number(sourceLayer.outPoint)) {
        return AE_json({ ok: false, error: "Managed matte timing is invalid for " + shotId + "." });
      }
      planned.push({ shotId: shotId, matte: matte });
    }

    app.beginUndoGroup("Build Accelerated Execution Foreground Stack");
    undoStarted = true;
    for (layerIndex = managedForegrounds.length - 1; layerIndex >= 0; layerIndex -= 1) {
      managedForegrounds[layerIndex].locked = false;
      managedForegrounds[layerIndex].remove();
    }
    var created = [];
    for (layerIndex = 0; layerIndex < planned.length; layerIndex += 1) {
      var entry = planned[layerIndex];
      var foreground = sourceLayer.duplicate();
      foreground.locked = false;
      if (typeof foreground.removeTrackMatte === "function") foreground.removeTrackMatte();
      foreground.name = foregroundPrefix + entry.shotId + " | luma";
      foreground.comment = "Managed by Accelerated Execution; SAM foreground for " + entry.shotId;
      foreground.inPoint = entry.matte.inPoint;
      foreground.outPoint = entry.matte.outPoint;
      foreground.guideLayer = false;
      foreground.audioEnabled = false;
      foreground.enabled = true;
      foreground.solo = false;
      foreground.adjustmentLayer = false;
      entry.matte.locked = false;
      entry.matte.guideLayer = false;
      entry.matte.solo = false;
      entry.matte.adjustmentLayer = false;
      foreground.moveBefore(sourceLayer);
      entry.matte.moveBefore(foreground);
      foreground.setTrackMatte(entry.matte, TrackMatteType.LUMA);
      entry.matte.locked = true;
      foreground.locked = true;
      created.push({
        shotId: entry.shotId,
        matteLayerName: entry.matte.name,
        foregroundLayerName: foreground.name
      });
    }
    app.endUndoGroup();
    undoStarted = false;
    return AE_json({
      ok: true,
      compName: item.name,
      sourceLayerName: sourceLayer.name,
      created: created.length,
      replaced: managedForegrounds.length,
      layers: created
    });
  } catch (error) {
    if (undoStarted) {
      try { app.endUndoGroup(); } catch (undoError) {}
    }
    return AE_json({ ok: false, error: error.toString() });
  }
}

function AE_placeSelectedOverlay(encodedSourcePath) {
  var undoStarted = false;
  try {
    var item = app.project.activeItem;
    if (!item || !(item instanceof CompItem)) {
      return AE_json({ ok: false, error: "Open or select a composition before placing an overlay." });
    }
    if (!item.selectedLayers || item.selectedLayers.length !== 2) {
      return AE_json({ ok: false, error: "Select exactly the source footage layer and one overlay layer." });
    }
    var expectedPath = decodeURIComponent(String(encodedSourcePath));
    var sourceLayer = null;
    var overlayLayer = null;
    var selectedIndex;
    for (selectedIndex = 0; selectedIndex < item.selectedLayers.length; selectedIndex += 1) {
      var selected = item.selectedLayers[selectedIndex];
      if (selected.source && selected.source instanceof FootageItem && selected.source.file &&
          AE_normalizePath(selected.source.file.fsName) === AE_normalizePath(expectedPath)) {
        sourceLayer = selected;
      } else {
        overlayLayer = selected;
      }
    }
    if (!sourceLayer || !overlayLayer) {
      return AE_json({ ok: false, error: "The selection must contain the analyzed footage and one overlay layer." });
    }
    var overlayName = String(overlayLayer.name || "");
    if (overlayName.indexOf("Accelerated Execution Matte | ") === 0 ||
        overlayName.indexOf("Accelerated Execution Foreground | ") === 0) {
      return AE_json({ ok: false, error: "Select a lyric or graphic overlay, not a managed matte layer." });
    }
    var foregroundCount = 0;
    var layerIndex;
    for (layerIndex = 1; layerIndex <= item.numLayers; layerIndex += 1) {
      if (String(item.layer(layerIndex).name).indexOf("Accelerated Execution Foreground | ") === 0) {
        foregroundCount += 1;
      }
    }
    if (!foregroundCount) {
      return AE_json({ ok: false, error: "Build the SAM foreground stack before placing an overlay." });
    }
    if (overlayLayer.locked) {
      return AE_json({ ok: false, error: "Unlock the overlay layer before placing it." });
    }
    app.beginUndoGroup("Place Overlay Between SAM Foreground and Background");
    undoStarted = true;
    overlayLayer.moveBefore(sourceLayer);
    app.endUndoGroup();
    undoStarted = false;
    return AE_json({
      ok: true,
      compName: item.name,
      sourceLayerName: sourceLayer.name,
      overlayLayerName: overlayLayer.name,
      foregroundLayers: foregroundCount
    });
  } catch (error) {
    if (undoStarted) {
      try { app.endUndoGroup(); } catch (undoError) {}
    }
    return AE_json({ ok: false, error: error.toString() });
  }
}

function AE_applyJizuraTiming(encodedPlan) {
  var undoStarted = false;
  try {
    var item = app.project.activeItem;
    if (!item || !(item instanceof CompItem)) {
      return AE_json({ ok: false, error: "Open or select a composition before importing JIZURA timing." });
    }
    if (!item.selectedLayers || item.selectedLayers.length !== 1) {
      return AE_json({ ok: false, error: "Select exactly one JIZURA overlay layer." });
    }
    var layer = item.selectedLayers[0];
    if (layer.locked) {
      return AE_json({ ok: false, error: "Unlock the selected JIZURA layer before importing timing." });
    }
    if (layer.timeRemapEnabled) {
      return AE_json({ ok: false, error: "JIZURA timing import does not support time-remapped layers." });
    }
    var stretch = Number(layer.stretch);
    if (!isFinite(stretch) || stretch === 0) {
      return AE_json({ ok: false, error: "The selected JIZURA layer has an invalid stretch value." });
    }
    var markerProperty = layer.property("ADBE Marker") || layer.property("Marker");
    if (!markerProperty) {
      return AE_json({ ok: false, error: "The selected JIZURA layer does not expose markers." });
    }
    var plan = JSON.parse(decodeURIComponent(String(encodedPlan)));
    if (!plan || plan.format !== "accelerated-execution/jizura-timing" || Number(plan.version) !== 1) {
      return AE_json({ ok: false, error: "The JIZURA timing payload is unsupported." });
    }
    if (!(Number(plan.duration) > 0) || Number(plan.duration) > 86400) {
      return AE_json({ ok: false, error: "The JIZURA timing duration is invalid." });
    }
    if (!Array.isArray(plan.beats) || !Array.isArray(plan.lines) || !Array.isArray(plan.cuts)) {
      return AE_json({ ok: false, error: "The JIZURA timing payload is incomplete." });
    }
    if (plan.beats.length > 10000 || plan.lines.length > 5000 || plan.cuts.length > 10000) {
      return AE_json({ ok: false, error: "The JIZURA timing payload exceeds supported limits." });
    }
    var prefix = "Accelerated Execution JIZURA | ";
    var tolerance = Number(item.frameDuration) / 4;
    if (!(tolerance > 0)) tolerance = 1 / 120;
    var events = [];
    var counts = { beats: 0, lines: 0, cuts: 0 };

    function addEvent(sourceTime, label, type) {
      sourceTime = Number(sourceTime);
      if (!isFinite(sourceTime) || sourceTime < 0 || sourceTime >= Number(plan.duration)) {
        throw new Error("Invalid JIZURA " + type + " time.");
      }
      var compTime = Number(layer.startTime) + sourceTime * (stretch / 100);
      events.push({ sourceTime: sourceTime, compTime: compTime, label: label, type: type });
      counts[type] += 1;
    }

    var eventIndex;
    for (eventIndex = 0; eventIndex < plan.beats.length; eventIndex += 1) {
      addEvent(plan.beats[eventIndex], "beat " + String(eventIndex + 1), "beats");
    }
    for (eventIndex = 0; eventIndex < plan.lines.length; eventIndex += 1) {
      var line = plan.lines[eventIndex];
      if (!line || typeof line !== "object") throw new Error("Invalid JIZURA lyric entry.");
      addEvent(line.start, "line " + String(Number(line.index) + 1) + (line.text ? " | " + String(line.text) : ""), "lines");
    }
    for (eventIndex = 0; eventIndex < plan.cuts.length; eventIndex += 1) {
      var cut = plan.cuts[eventIndex];
      if (!cut || typeof cut !== "object") throw new Error("Invalid JIZURA cut entry.");
      addEvent(cut.start, "cut " + String(Number(cut.index) + 1) + (cut.text ? " | " + String(cut.text) : ""), "cuts");
    }

    var grouped = {};
    var skipped = 0;
    for (eventIndex = 0; eventIndex < events.length; eventIndex += 1) {
      var event = events[eventIndex];
      if (event.compTime < Number(layer.inPoint) - tolerance || event.compTime >= Number(layer.outPoint) - tolerance) {
        skipped += 1;
        continue;
      }
      var frame = Math.round(event.compTime / Number(item.frameDuration));
      var key = String(frame);
      if (!grouped[key]) grouped[key] = { compTime: frame * Number(item.frameDuration), labels: [] };
      grouped[key].labels.push(event.label);
    }
    var planned = [];
    var groupKey;
    for (groupKey in grouped) {
      if (grouped.hasOwnProperty(groupKey)) planned.push(grouped[groupKey]);
    }
    planned.sort(function (left, right) { return left.compTime - right.compTime; });
    if (!planned.length) {
      return AE_json({ ok: false, error: "No JIZURA timing events fall inside the selected layer trim." });
    }

    var managedKeys = [];
    var keyIndex;
    for (keyIndex = 1; keyIndex <= markerProperty.numKeys; keyIndex += 1) {
      var existing = markerProperty.keyValue(keyIndex);
      if (existing && String(existing.comment).indexOf(prefix) === 0) managedKeys.push(keyIndex);
    }
    for (eventIndex = 0; eventIndex < planned.length; eventIndex += 1) {
      for (keyIndex = 1; keyIndex <= markerProperty.numKeys; keyIndex += 1) {
        var markerValue = markerProperty.keyValue(keyIndex);
        var isManaged = markerValue && String(markerValue.comment).indexOf(prefix) === 0;
        if (!isManaged && Math.abs(markerProperty.keyTime(keyIndex) - planned[eventIndex].compTime) < tolerance) {
          return AE_json({ ok: false, error: "A user marker already occupies a JIZURA timing frame." });
        }
      }
    }

    app.beginUndoGroup("Import JIZURA Timing Markers");
    undoStarted = true;
    for (keyIndex = managedKeys.length - 1; keyIndex >= 0; keyIndex -= 1) {
      markerProperty.removeKey(managedKeys[keyIndex]);
    }
    for (eventIndex = 0; eventIndex < planned.length; eventIndex += 1) {
      var entry = planned[eventIndex];
      var marker = new MarkerValue(prefix + entry.labels.join(" / "));
      marker.chapter = "JIZURA";
      markerProperty.setValueAtTime(entry.compTime, marker);
    }
    app.endUndoGroup();
    undoStarted = false;
    return AE_json({
      ok: true,
      compName: item.name,
      layerName: layer.name,
      added: planned.length,
      replaced: managedKeys.length,
      skipped: skipped,
      beats: counts.beats,
      lines: counts.lines,
      cuts: counts.cuts
    });
  } catch (error) {
    if (undoStarted) {
      try { app.endUndoGroup(); } catch (undoError) {}
    }
    return AE_json({ ok: false, error: error.toString() });
  }
}
