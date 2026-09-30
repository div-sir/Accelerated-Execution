import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { cepExtensionsDirectory, extensionTarget, parseCsxsDomains } from "../scripts/cep.mjs";

test("cepExtensionsDirectory resolves the macOS user extension directory", () => {
  assert.equal(
    cepExtensionsDirectory({ platform: "darwin", home: "/Users/test", environment: {} }),
    path.join("/Users/test", "Library", "Application Support", "Adobe", "CEP", "extensions"),
  );
});

test("cepExtensionsDirectory uses APPDATA on Windows", () => {
  assert.equal(
    cepExtensionsDirectory({ platform: "win32", home: "C:\\Users\\test", environment: { APPDATA: "D:\\Profile" } }),
    path.join("D:\\Profile", "Adobe", "CEP", "extensions"),
  );
});

test("extensionTarget uses the manifest bundle id", () => {
  assert.equal(
    extensionTarget({ platform: "darwin", home: "/Users/test", environment: {} }),
    path.join("/Users/test", "Library", "Application Support", "Adobe", "CEP", "extensions", "com.milifix.acceleratedexecution"),
  );
});

test("parseCsxsDomains detects and numerically sorts installed runtimes", () => {
  assert.deepEqual(
    parseCsxsDomains("com.apple.TextEdit, com.adobe.CSXS.12, com.adobe.CSXS.9, com.adobe.CSXS.12"),
    ["com.adobe.CSXS.9", "com.adobe.CSXS.12"],
  );
});
