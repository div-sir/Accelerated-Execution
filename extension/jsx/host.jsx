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
