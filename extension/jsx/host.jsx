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
