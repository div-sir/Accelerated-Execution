import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";

const hostSource = fs.readFileSync(new URL("../extension/jsx/host.jsx", import.meta.url), "utf8");

class MarkerProperty {
  constructor(keys = []) {
    this.keys = keys.slice().sort((left, right) => left.time - right.time);
  }

  get numKeys() { return this.keys.length; }
  keyTime(index) { return this.keys[index - 1].time; }
  keyValue(index) { return this.keys[index - 1].value; }
  removeKey(index) { this.keys.splice(index - 1, 1); }
  setValueAtTime(time, value) {
    this.keys.push({ time, value });
    this.keys.sort((left, right) => left.time - right.time);
  }
}

class KeyframedProperty {
  constructor() { this.keys = []; }
  get numKeys() { return this.keys.length; }
  setValue(value) { this.value = value; }
  setValueAtTime(time, value) {
    const existing = this.keys.find((key) => key.time === time);
    if (existing) existing.value = value;
    else this.keys.push({ time, value, interpolation: null });
    this.keys.sort((left, right) => left.time - right.time);
  }
  setInterpolationTypeAtKey(index, incoming, outgoing) {
    this.keys[index - 1].interpolation = [incoming, outgoing];
  }
}

class MaskParade {
  constructor(names = []) {
    this.items = names.map((name) => this.createMask(name));
  }
  get numProperties() { return this.items.length; }
  property(index) { return this.items[index - 1]; }
  canAddProperty(name) { return name === "ADBE Mask Atom"; }
  createMask(name = "Mask") {
    const parade = this;
    const shape = new KeyframedProperty();
    const opacity = new KeyframedProperty();
    const feather = new KeyframedProperty();
    const expansion = new KeyframedProperty();
    return {
      name,
      shape,
      opacity,
      feather,
      expansion,
      property(propertyName) {
        if (propertyName === "ADBE Mask Shape") return shape;
        if (propertyName === "ADBE Mask Opacity") return opacity;
        if (propertyName === "ADBE Mask Feather") return feather;
        if (propertyName === "ADBE Mask Offset") return expansion;
        return null;
      },
      remove() {
        const index = parade.items.indexOf(this);
        if (index >= 0) parade.items.splice(index, 1);
      },
    };
  }
  addProperty(name) {
    assert.equal(name, "ADBE Mask Atom");
    const mask = this.createMask();
    this.items.push(mask);
    return mask;
  }
}

class PropertyParade {
  constructor(names = []) {
    this.items = names.map((name) => this.createProperty(name));
  }
  get numProperties() { return this.items.length; }
  property(index) { return this.items[index - 1]; }
  createProperty(name) {
    const parade = this;
    return {
      name,
      remove() {
        const index = parade.items.indexOf(this);
        if (index >= 0) parade.items.splice(index, 1);
      },
    };
  }
}

function createHost({
  sourcePath = "/Footage/source.mp4",
  keys = [],
  maskNames = [],
  effectNames = [],
  layerNames = [],
  existingFiles = [],
} = {}) {
  function CompItem() {}
  function FootageItem() {}
  function MarkerValue(comment) { this.comment = comment; }
  function Shape() {}
  function File(value) {
    this.fsName = String(value);
    this.exists = existingFiles.includes(this.fsName);
  }
  function ImportOptions(file) { this.file = file; }

  const markers = new MarkerProperty(keys);
  const masks = new MaskParade(maskNames);
  const effects = new PropertyParade(effectNames);
  const footage = new FootageItem();
  footage.file = { fsName: sourcePath };
  footage.width = 1920;
  footage.height = 1080;
  const comp = new CompItem();
  comp.name = "Main Comp";
  comp.frameDuration = 1 / 24;
  comp._layers = [];
  Object.defineProperty(comp, "numLayers", { get() { return this._layers.length; } });
  comp.layer = function (index) { return this._layers[index - 1]; };

  function attachLayerMethods(target, layerMasks, layerEffects) {
    target._masks = layerMasks;
    target._effects = layerEffects;
    target.property = function (name) {
      if (name === "ADBE Marker" || name === "Marker") return target === layer ? markers : new MarkerProperty();
      if (name === "ADBE Mask Parade" || name === "Masks") return this._masks;
      if (name === "ADBE Effect Parade" || name === "Effects") return this._effects;
      return null;
    };
    target.remove = function () {
      const index = comp._layers.indexOf(this);
      if (index >= 0) comp._layers.splice(index, 1);
    };
    target.moveBefore = function (reference) {
      const current = comp._layers.indexOf(this);
      if (current >= 0) comp._layers.splice(current, 1);
      const destination = comp._layers.indexOf(reference);
      comp._layers.splice(Math.max(0, destination), 0, this);
    };
    target.replaceSource = function (source) { this.source = source; };
    target.duplicate = function () {
      const duplicateMasks = new MaskParade(this._masks.items.map((entry) => entry.name));
      const duplicateEffects = new PropertyParade(this._effects.items.map((entry) => entry.name));
      const duplicate = attachLayerMethods({
        name: this.name + " copy",
        source: this.source,
        timeRemapEnabled: this.timeRemapEnabled,
        startTime: this.startTime,
        stretch: this.stretch,
        inPoint: this.inPoint,
        outPoint: this.outPoint,
        locked: this.locked,
        trackMatteType: this.trackMatteType,
      }, duplicateMasks, duplicateEffects);
      const index = comp._layers.indexOf(this);
      comp._layers.splice(Math.max(0, index), 0, duplicate);
      return duplicate;
    };
    return target;
  }

  const layer = attachLayerMethods({
    name: "Footage Layer",
    source: footage,
    timeRemapEnabled: false,
    startTime: 2,
    stretch: 50,
    inPoint: 2,
    outPoint: 8,
  }, masks, effects);
  comp._layers.push(layer);
  layerNames.forEach((name) => {
    comp._layers.push(attachLayerMethods({
      name,
      source: footage,
      timeRemapEnabled: false,
      startTime: 2,
      stretch: 50,
      inPoint: 2,
      outPoint: 8,
      locked: name.indexOf("Accelerated Execution Matte | ") === 0,
    }, new MaskParade(), new PropertyParade()));
  });
  comp.selectedLayers = [layer];
  const undo = [];
  const projectItems = [footage];
  footage.remove = function () {
    const index = projectItems.indexOf(this);
    if (index >= 0) projectItems.splice(index, 1);
  };
  const project = {
    activeItem: comp,
    get numItems() { return projectItems.length; },
    item(index) { return projectItems[index - 1]; },
    importFile(options) {
      const imported = new FootageItem();
      imported.file = { fsName: options.file.fsName };
      imported.width = 1920;
      imported.height = 1080;
      imported.remove = footage.remove;
      projectItems.push(imported);
      return imported;
    },
  };
  const context = {
    app: {
      project,
      beginUndoGroup: (name) => undo.push(["begin", name]),
      endUndoGroup: () => undo.push(["end"]),
    },
    CompItem,
    FootageItem,
    MarkerValue,
    Shape,
    File,
    ImportOptions,
    TrackMatteType: { NO_TRACK_MATTE: "none" },
    MaskMode: { ADD: "add" },
    KeyframeInterpolationType: { HOLD: "hold" },
    $: { os: "Macintosh" },
  };
  vm.runInNewContext(hostSource, context);
  return { context, layer, markers, masks, effects, layers: comp._layers, projectItems, undo };
}

function plan(sourcePath = "/Footage/source.mp4") {
  return {
    version: "0.1",
    source: { path: sourcePath },
    shots: [
      {
        id: "shot-001",
        startTime: 0,
        endTime: 2,
        tasks: [{
          type: "point-track",
          engine: "ae-native",
          action: "motion-tracker",
          anchorTime: 1,
          confidence: 0.91,
          target: { kind: "point", coordinateSpace: "normalized-source", x: 0.4, y: 0.6 },
        }],
      },
      {
        id: "shot-002",
        startTime: 2,
        endTime: 4,
        tasks: [{ type: "point-track", engine: "ae-native", anchorTime: 3, confidence: 0.82 }],
      },
    ],
  };
}

function apply(host, value) {
  return JSON.parse(host.context.AE_applyScenePlan(encodeURIComponent(JSON.stringify(value))));
}

function staticMaskPlan() {
  return {
    version: "0.1",
    source: { path: "/Footage/source.mp4" },
    media: { width: 1920, height: 1080, duration: 24 },
    shots: [{
      id: "shot-001",
      startTime: 0,
      endTime: 2,
      tasks: [{
        type: "static-mask",
        engine: "ae-native",
        action: "static-mask",
        anchorTime: 1,
        target: {
          kind: "box",
          coordinateSpace: "normalized-source",
          x: 0.1,
          y: 0.2,
          width: 0.5,
          height: 0.4,
        },
        parameters: { featherPixels: 12.5, expansionPixels: -3 },
      }],
    }],
  };
}

function executeStaticMasks(host, value) {
  return JSON.parse(host.context.AE_executeStaticMasks(encodeURIComponent(JSON.stringify(value))));
}

function retryExecutionReport(maskPath = "/masks/shot-001.png") {
  return {
    version: "0.1",
    retryPlanVersion: "0.1",
    executedAt: "2026-09-26T12:00:00.000Z",
    source: { path: "/Footage/source.mp4" },
    media: { width: 1920, height: 1080 },
    destination: { compName: "Main Comp", layerName: "Footage Layer" },
    summary: { completed: 1, failed: 0, skipped: 0 },
    jobs: [{
      shotId: "shot-001",
      status: "completed",
      engine: "local-ai",
      action: "sam-segmentation",
      startTime: 0,
      endTime: 2,
      anchorTime: 1,
      maskPath,
      width: 1920,
      height: 1080,
      confidence: 0.93,
    }],
  };
}

function importRetryMattes(host, value) {
  return JSON.parse(host.context.AE_importRetryMattes(encodeURIComponent(JSON.stringify(value))));
}

test("AE_applyScenePlan replaces managed markers and preserves user markers", () => {
  const host = createHost({
    keys: [
      { time: 2.1, value: { comment: "Accelerated Execution | old-shot" } },
      { time: 7, value: { comment: "Director note" } },
    ],
  });

  const result = apply(host, plan());
  assert.deepEqual(result, {
    ok: true,
    compName: "Main Comp",
    layerName: "Footage Layer",
    added: 2,
    replaced: 1,
  });
  assert.deepEqual(host.markers.keys.map((entry) => entry.time), [2.5, 3.5, 7]);
  assert.equal(host.markers.keys[0].value.chapter, "shot-001");
  assert.match(host.markers.keys[0].value.comment, /point-track \| ae-native \| motion-tracker \| target point \| confidence 0\.910$/);
  assert.equal(host.markers.keys[2].value.comment, "Director note");
  assert.deepEqual(host.undo, [
    ["begin", "Apply Accelerated Execution Scene Plan"],
    ["end"],
  ]);
});

test("AE_applyScenePlan rejects a source mismatch without mutating the layer", () => {
  const host = createHost();
  const result = apply(host, plan("/Footage/other.mp4"));
  assert.equal(result.ok, false);
  assert.match(result.error, /not the footage used/);
  assert.equal(host.markers.numKeys, 0);
  assert.deepEqual(host.undo, []);
});

test("AE_applyScenePlan refuses to overwrite a user marker", () => {
  const host = createHost({ keys: [{ time: 2.5, value: { comment: "Keep me" } }] });
  const result = apply(host, plan());
  assert.equal(result.ok, false);
  assert.match(result.error, /user marker already occupies/);
  assert.equal(host.markers.numKeys, 1);
  assert.equal(host.markers.keyValue(1).comment, "Keep me");
  assert.deepEqual(host.undo, []);
});

test("AE_executeStaticMasks replaces managed masks and preserves user masks", () => {
  const host = createHost({
    maskNames: ["Accelerated Execution | old | static-mask", "User Mask"],
  });
  const result = executeStaticMasks(host, staticMaskPlan());
  assert.deepEqual(result, {
    ok: true,
    compName: "Main Comp",
    layerName: "Footage Layer",
    created: 1,
    replaced: 1,
    skipped: 0,
    preservedUserMasks: 1,
    warnings: [],
    shots: [{ id: "shot-001", status: "completed", action: "static-mask", coverage: 0.2 }],
  });
  assert.deepEqual(host.masks.items.map((mask) => mask.name), [
    "User Mask",
    "Accelerated Execution | shot-001 | static-mask",
  ]);
  const created = host.masks.items[1];
  assert.equal(created.maskMode, "add");
  assert.deepEqual(Array.from(created.feather.value), [12.5, 12.5]);
  assert.equal(created.expansion.value, -3);
  const vertices = JSON.parse(JSON.stringify(created.shape.value.vertices)).map((vertex) => {
    return vertex.map((coordinate) => Number(coordinate.toFixed(6)));
  });
  assert.deepEqual(vertices, [
    [192, 216],
    [1152, 216],
    [1152, 648],
    [192, 648],
  ]);
  assert.deepEqual(created.opacity.keys, [
    { time: 2, value: 100, interpolation: ["hold", "hold"] },
    { time: 3, value: 0, interpolation: ["hold", "hold"] },
  ]);
  assert.deepEqual(host.undo, [
    ["begin", "Execute Accelerated Execution Static Masks"],
    ["end"],
  ]);
});

test("AE_executeStaticMasks rejects unsupported tasks before mutating masks", () => {
  const host = createHost({ maskNames: ["Accelerated Execution | keep-until-valid"] });
  const invalidPlan = staticMaskPlan();
  invalidPlan.shots[0].tasks[0].action = "roto-brush";
  const result = executeStaticMasks(host, invalidPlan);
  assert.equal(result.ok, false);
  assert.match(result.error, /only supports ae-native static-mask/);
  assert.equal(host.masks.numProperties, 1);
  assert.deepEqual(host.undo, []);
});

test("AE_executeStaticMasks skips shots outside the selected layer range", () => {
  const host = createHost();
  const value = staticMaskPlan();
  value.shots.push({
    id: "shot-002",
    startTime: 20,
    endTime: 22,
    tasks: [JSON.parse(JSON.stringify(value.shots[0].tasks[0]))],
  });
  const result = executeStaticMasks(host, value);
  assert.equal(result.ok, true);
  assert.equal(result.created, 1);
  assert.equal(result.skipped, 1);
});

test("AE_executeStaticMasks gates a later shot with hold opacity keys", () => {
  const host = createHost();
  const value = staticMaskPlan();
  value.shots[0].startTime = 2;
  value.shots[0].endTime = 4;
  const result = executeStaticMasks(host, value);
  assert.equal(result.ok, true);
  assert.deepEqual(host.masks.items[0].opacity.keys, [
    { time: 2, value: 0, interpolation: ["hold", "hold"] },
    { time: 3, value: 100, interpolation: ["hold", "hold"] },
    { time: 4, value: 0, interpolation: ["hold", "hold"] },
  ]);
});

test("AE_executeStaticMasks rejects source dimension drift before mutation", () => {
  const host = createHost({ maskNames: ["Accelerated Execution | existing"] });
  const value = staticMaskPlan();
  value.media.width = 1280;
  const result = executeStaticMasks(host, value);
  assert.equal(result.ok, false);
  assert.match(result.error, /dimensions differ/);
  assert.equal(host.masks.numProperties, 1);
  assert.deepEqual(host.undo, []);
});

test("AE_executeStaticMasks rejects a locked layer before mutation", () => {
  const host = createHost();
  host.layer.locked = true;
  const result = executeStaticMasks(host, staticMaskPlan());
  assert.equal(result.ok, false);
  assert.match(result.error, /Unlock the selected footage layer/);
  assert.equal(host.masks.numProperties, 0);
  assert.deepEqual(host.undo, []);
});

test("AE_executeStaticMasks reports suspicious target coverage", () => {
  const host = createHost();
  const value = staticMaskPlan();
  value.shots[0].tasks[0].target.width = 0.02;
  value.shots[0].tasks[0].target.height = 0.02;
  const result = executeStaticMasks(host, value);
  assert.equal(result.ok, true);
  assert.deepEqual(result.warnings, ["shot-001 covers less than 0.1% of the source frame."]);
  assert.deepEqual(result.shots, [{
    id: "shot-001",
    status: "warning",
    action: "static-mask",
    coverage: 0.0004,
    message: "shot-001 covers less than 0.1% of the source frame.",
    recommendation: "review-target",
  }]);
});

test("AE_importRetryMattes replaces managed layers and preserves user content", () => {
  const maskPath = "/masks/shot-001.png";
  const host = createHost({
    maskNames: ["User Mask"],
    effectNames: ["User Effect"],
    layerNames: ["User Solid", "Accelerated Execution Matte | old | sam-segmentation"],
    existingFiles: [maskPath],
  });
  const result = importRetryMattes(host, retryExecutionReport(maskPath));
  assert.deepEqual(result, {
    ok: true,
    compName: "Main Comp",
    sourceLayerName: "Footage Layer",
    created: 1,
    replaced: 1,
    preservedUserLayers: 2,
    layers: [{
      shotId: "shot-001",
      layerName: "Accelerated Execution Matte | shot-001 | sam-segmentation",
      confidence: 0.93,
    }],
  });
  assert.deepEqual(host.layers.map((layer) => layer.name), [
    "Accelerated Execution Matte | shot-001 | sam-segmentation",
    "Footage Layer",
    "User Solid",
  ]);
  const matte = host.layers[0];
  assert.equal(matte.source.file.fsName, maskPath);
  assert.equal(matte.inPoint, 2);
  assert.equal(matte.outPoint, 3);
  assert.equal(matte.guideLayer, true);
  assert.equal(matte.audioEnabled, false);
  assert.equal(matte.enabled, true);
  assert.equal(matte.solo, false);
  assert.equal(matte.adjustmentLayer, false);
  assert.equal(matte.trackMatteType, "none");
  assert.equal(matte.shy, true);
  assert.equal(matte.locked, true);
  assert.equal(matte._masks.numProperties, 0);
  assert.equal(matte._effects.numProperties, 0);
  assert.deepEqual(host.masks.items.map((mask) => mask.name), ["User Mask"]);
  assert.deepEqual(host.effects.items.map((effect) => effect.name), ["User Effect"]);
  assert.equal(host.projectItems.length, 2);
  assert.deepEqual(host.undo, [
    ["begin", "Import Accelerated Execution Retry Mattes"],
    ["end"],
  ]);

  const rerun = importRetryMattes(host, retryExecutionReport(maskPath));
  assert.equal(rerun.ok, true);
  assert.equal(rerun.replaced, 1);
  assert.equal(host.projectItems.length, 2);
});

test("AE_importRetryMattes rejects a missing mask before mutating layers", () => {
  const host = createHost({ layerNames: ["User Solid"] });
  const result = importRetryMattes(host, retryExecutionReport("/masks/missing.png"));
  assert.equal(result.ok, false);
  assert.match(result.error, /matte file is missing/);
  assert.deepEqual(host.layers.map((layer) => layer.name), ["Footage Layer", "User Solid"]);
  assert.deepEqual(host.undo, []);
});
