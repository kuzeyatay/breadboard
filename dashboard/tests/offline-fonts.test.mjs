import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import localLoaderModule from "next/dist/compiled/@next/font/dist/local/loader.js";

const appRoot = fileURLToPath(new URL("../src/app/", import.meta.url));
const loadLocalFont = localLoaderModule.default;

test("dashboard routes have no build-time Google Fonts dependency", () => {
  for (const entry of fs.readdirSync(appRoot, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !/\.[jt]sx?$/.test(entry.name)) continue;
    const source = fs.readFileSync(path.join(entry.parentPath, entry.name), "utf8");
    assert.doesNotMatch(source, /["']next\/font\/google["']/, entry.name);
  }
});

test("Next builds every dashboard font from checked-in files with fetch unavailable", async (t) => {
  t.mock.method(globalThis, "fetch", () => {
    throw new Error("Network unavailable during offline font build");
  });
  let emitted = 0;
  for (const relative of ["layout.tsx", "pomodoro/page.tsx"]) {
    const filename = path.join(appRoot, relative);
    const source = ts.createSourceFile(filename, fs.readFileSync(filename, "utf8"), ts.ScriptTarget.Latest, true);
    const calls = [];
    function visit(node) {
      if (ts.isVariableDeclaration(node) && node.initializer && ts.isCallExpression(node.initializer)
          && node.initializer.expression.getText(source) === "localFont") {
        calls.push({ name: node.name.getText(source), options: node.initializer.arguments[0].getText(source) });
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
    assert.equal(calls.length, relative === "layout.tsx" ? 3 : 1);
    for (const call of calls) {
      const options = vm.runInNewContext(`(${call.options})`);
      const result = await loadLocalFont({
        functionName: "",
        variableName: call.name,
        data: [options],
        resolve: (file) => path.resolve(path.dirname(filename), file),
        loaderContext: { fs },
        emitFontFile: (buffer, ext) => {
          assert.equal(ext, "ttf");
          assert.equal(buffer.readUInt32BE(0), 0x00010000, "valid TrueType header");
          emitted += 1;
          return `/_next/static/media/offline-font-${emitted}.ttf`;
        },
      });
      assert.equal(result.variable, options.variable);
      assert.match(result.css, /@font-face/);
      assert.doesNotMatch(result.css, /https?:\/\//);
      if (options.adjustFontFallback !== false) {
        assert.ok(result.adjustFontFallback?.ascentOverride, "Next must parse font metrics");
      }
    }
  }
  assert.equal(emitted, 8, "all families, weights, and italic files were emitted");
  assert.equal(globalThis.fetch.mock.callCount(), 0);
});
