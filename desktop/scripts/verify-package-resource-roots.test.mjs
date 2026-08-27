import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const scriptsRoot = import.meta.dirname;
const desktopRoot = path.resolve(scriptsRoot, "..");
const verifier = fs.readFileSync(path.join(scriptsRoot, "verify-package.mjs"), "utf8");
const preparer = fs.readFileSync(path.join(scriptsRoot, "prepare-app-resources.mjs"), "utf8");
const nativeBuilder = fs.readFileSync(
  path.join(scriptsRoot, "build-runtime-supervisor.mjs"),
  "utf8",
);
const electronBuilder = fs.readFileSync(path.join(desktopRoot, "electron-builder.yml"), "utf8");

function verifierFunctionSource(name, nextName) {
  const start = verifier.indexOf(`function ${name}(`);
  const end = verifier.indexOf(`function ${nextName}(`, start);
  assert.ok(start >= 0 && end > start, `${name} must remain directly testable`);
  return verifier.slice(start, end);
}

test("runtime-root bin authorities use the separately staged immutable bin root", () => {
  const source = verifierFunctionSource("packagedAuthorityPath", "checkPackagedServiceProfiles");
  const packagedAuthorityPath = Function(
    "path",
    `"use strict";\n${source}\nreturn packagedAuthorityPath;`,
  )(path);
  const resources = path.join("C:", "breadboard", "desktop", "build-resources");
  const binRoot = path.join("C:", "breadboard", "desktop", "resources", "bin");

  assert.equal(
    packagedAuthorityPath(resources, binRoot, "runtime-root", "bin/voicebox-server.exe"),
    path.join(binRoot, "voicebox-server.exe"),
  );
  assert.equal(
    packagedAuthorityPath(resources, binRoot, "runtime-root", "runtimes/node/node.exe"),
    path.join(resources, "runtimes", "node", "node.exe"),
  );
  assert.equal(
    packagedAuthorityPath(resources, binRoot, "app-root", "dashboard/server.js"),
    path.join(resources, "app-services", "dashboard", "server.js"),
  );
  assert.throws(
    () => packagedAuthorityPath(resources, binRoot, "data-root", "managed/file"),
    /not an immutable packaged authority/u,
  );
});

test("staging verification keeps split resource ownership while packaged verification is unified", () => {
  assert.match(
    verifier,
    /function checkResourcesRoot\(resources, binRoot, label\)/u,
  );
  assert.match(
    verifier,
    /function checkMandatoryPackagedClosures\(resources, binRoot, label, bundledNode\)/u,
  );
  assert.match(
    verifier,
    /function checkPackagedServiceProfiles\(resources, binRoot, label, manifest\)/u,
  );
  assert.match(verifier, /const node = path\.join\(resources, "runtimes", "node", "node\.exe"\);/u);
  assert.match(
    verifier,
    /const dashboard = path\.join\(resources, "app-services", "dashboard-standalone", "dashboard"\);/u,
  );
  assert.match(
    verifier,
    /const runtimeV2Manifests = path\.join\(resources, "runtime-v2", "manifests"\);/u,
  );
  assert.match(
    verifier,
    /const cliProxyLicense = path\.join\(resources, "licenses", "cliproxy-LICENSE\.txt"\);/u,
  );
  assert.doesNotMatch(
    verifier,
    /path\.join\(resources,\s*"bin"/u,
    "no staged binary check may fall back to build-resources/bin",
  );
  assert.match(
    verifier,
    /const stagedResourcesRoot = path\.join\(desktopRoot, "build-resources"\);\s*const stagedBinRoot = path\.join\(desktopRoot, "resources", "bin"\);\s*checkResourcesRoot\(stagedResourcesRoot, stagedBinRoot, "build-resources"\);/u,
  );
  assert.match(
    verifier,
    /checkResourcesRoot\(\s*packagedResourcesRoot,\s*path\.join\(packagedResourcesRoot, "bin"\),\s*"win-unpacked",\s*\);/u,
  );
});

test("producers and electron-builder agree that native artifacts stage in resources/bin", () => {
  assert.match(
    nativeBuilder,
    /const stagedBinDir = path\.join\(desktopRoot, "resources", "bin"\);/u,
  );
  assert.match(preparer, /const binRoot = path\.join\(desktopRoot, "resources", "bin"\);/u);
  assert.match(
    preparer,
    /const voiceboxTarget = path\.join\(desktopRoot, "resources", "bin", voiceboxExecutable\);/u,
  );
  assert.match(electronBuilder, /- from: resources\/bin\s+to: bin/u);
  assert.doesNotMatch(nativeBuilder, /"build-resources", "bin"/u);
  assert.doesNotMatch(preparer, /"build-resources", "bin"/u);
});

test("electron-builder preserves immutable zero-byte closure markers", () => {
  for (const relative of [
    "deer-flow/backend/packages/harness/deerflow/persistence/migrations/versions/.gitkeep",
    "dashboard/node_modules/mem0ai/node_modules/openai/node_modules/node-fetch/node_modules/whatwg-url/node_modules/tr46/lib/.gitkeep",
  ]) {
    assert.match(
      electronBuilder,
      new RegExp(
        `- from: build-resources/app-services/${relative.replaceAll(".", "\\.")}\\s+` +
          `to: app-services/${relative.replaceAll(".", "\\.")}`,
        "u",
      ),
      `${relative} must use the single-file copier because directory walking drops .gitkeep`,
    );
  }
});

test("verification applies canonical sizes and preserves only documented env examples", () => {
  assert.match(
    verifier,
    /const actual = check\.canonical\s*\? canonicalFileIdentity\(check\.filePath\)[\s\S]*actual\.size !== check\.expectedSize/u,
  );
  assert.match(
    verifier,
    /\^\\\.env\(\?:\\\.|\$\)[\s\S]*!name\.endsWith\("\.example"\)/u,
  );
  assert.match(preparer, /onnxruntime\\\/datasets/u);
  assert.match(preparer, /\\\.venv\(\?:\\\/\|\$\)/u);
});
