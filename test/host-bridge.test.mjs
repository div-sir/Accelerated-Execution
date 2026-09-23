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

function createHost({ sourcePath = "/Footage/source.mp4", keys = [] } = {}) {
  function CompItem() {}
  function FootageItem() {}
  function MarkerValue(comment) { this.comment = comment; }

  const markers = new MarkerProperty(keys);
  const footage = new FootageItem();
  footage.file = { fsName: sourcePath };
  const layer = {
    name: "Footage Layer",
    source: footage,
    timeRemapEnabled: false,
    startTime: 2,
    stretch: 50,
    inPoint: 2,
    outPoint: 8,
    property: (name) => name === "ADBE Marker" || name === "Marker" ? markers : null,
  };
  const comp = new CompItem();
  comp.name = "Main Comp";
  comp.frameDuration = 1 / 24;
  comp.selectedLayers = [layer];
  const undo = [];
  const context = {
    app: {
      project: { activeItem: comp },
      beginUndoGroup: (name) => undo.push(["begin", name]),
      endUndoGroup: () => undo.push(["end"]),
    },
    CompItem,
    FootageItem,
    MarkerValue,
    $: { os: "Macintosh" },
  };
  vm.runInNewContext(hostSource, context);
  return { context, layer, markers, undo };
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
  assert.match(host.markers.keys[0].value.comment, /point-track \| ae-native \| target point \| confidence 0\.910$/);
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
