import test from "node:test";
import assert from "node:assert/strict";
import { classifyToolCall } from "../src/agent-tars-runtime.ts";

test("explicit browser download tools are classified for a permission badge", () => {
  const action = classifyToolCall("browser_download_file", {
    url: "https://example.com/builds/archive.custom",
    filename: "archive.custom",
  });
  assert.equal(action.action, "download");
  assert.equal(action.isDownload, true);
  assert.equal(action.target, "https://example.com/builds/archive.custom");
});

test("explicit download hints are classified even when the upstream tool name is generic", () => {
  const action = classifyToolCall("browser_click", {
    selector: "#release",
    action: "download",
  });
  assert.equal(action.action, "download");
  assert.equal(action.isDownload, true);
});

test("a DOM-probed download click uses the resolved target in its badge", () => {
  const action = classifyToolCall("browser_click", {
    index: 7,
    __downloadIntent: true,
    __downloadTarget: "https://example.com/files/report.bin",
  });
  assert.equal(action.action, "download");
  assert.equal(action.target, "https://example.com/files/report.bin");
});
