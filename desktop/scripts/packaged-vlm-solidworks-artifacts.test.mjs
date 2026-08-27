import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { commitAtomicDirectorySwap } from "./atomic-artifact-swap.mjs";
import {
  commitPinnedVlmOcrArtifactSet,
  declaredDecodedContentLength,
  PINNED_VLM_OCR_RUNTIME,
  stagePinnedVlmOcrRuntime,
} from "./vlm-ocr-runtime-artifact.mjs";

const scriptsRoot = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(scriptsRoot, "..");
const repoRoot = path.resolve(desktopRoot, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, ...relativePath.split("/")), "utf8");
}

function solidworksContract(source, label) {
  const start = source.indexOf('id: "solidworks-mcp"');
  assert.notEqual(start, -1, `${label} must contain the SolidWorks contract`);
  const end = source.indexOf("externalBoundary:", start);
  assert.notEqual(end, -1, `${label} SolidWorks contract must declare its real external boundary`);
  const contract = source.slice(start, end);
  const value = (name, pattern) => {
    const match = contract.match(pattern);
    assert.ok(match, `${label} SolidWorks contract must pin ${name}`);
    return match[1];
  };
  return {
    packageVersion: value("package version", /packageVersion:\s*"([^"]+)"/u),
    pythonVersion: value("Python version", /pythonVersion:\s*"([^"]+)"/u),
    pythonArchiveSize: Number(value("Python archive size", /pythonArchiveSize:\s*([0-9_]+)/u).replaceAll("_", "")),
    pythonArchiveSha256: value("Python archive", /pythonArchiveSha256:\s*"([A-F0-9]+)"/u),
    pythonRuntimeSha256: value("Python closure", /pythonRuntimeSha256:\s*"([A-F0-9]+)"/u),
    upstreamCommit: value("upstream commit", /upstreamCommit:\s*"([a-f0-9]+)"/u),
    sourceArchiveSha256: value(
      "source archive",
      /sourceArchive:\s*\{[\s\S]*?sha256:\s*"([A-F0-9]+)"/u,
    ),
    sourceGitTree: value("source Git tree", /sourceGitTree:\s*"([a-f0-9]+)"/u),
    sourceSha256: value("canonical source tree", /sourceSha256:\s*"([A-F0-9]+)"/u),
    sourceFileCount: Number(value("source file count", /sourceFileCount:\s*([0-9_]+)/u).replaceAll("_", "")),
    sourceLockSha256: value("source lock", /sourceLockSha256:\s*"([A-F0-9]+)"/u),
    lockSha256: value("exported lock", /lockSha256:\s*"([A-F0-9]+)"/u),
    packageCount: Number(value("package count", /packageCount:\s*([0-9_]+)/u).replaceAll("_", "")),
  };
}

test("VLM OCR has one immutable receipt authority shared by stage and verify", () => {
  assert.equal(PINNED_VLM_OCR_RUNTIME.llamaCpp.release, "b10369");
  assert.equal(PINNED_VLM_OCR_RUNTIME.llamaCpp.archive.size, 18_458_753);
  assert.equal(
    PINNED_VLM_OCR_RUNTIME.llamaCpp.archive.sha256,
    "D6F606412F2335BC4A2324750306E8B5B027E8327F183990B2DBE3671F7F9DBD",
  );
  assert.deepEqual(
    [
      PINNED_VLM_OCR_RUNTIME.llamaCpp.license.size,
      PINNED_VLM_OCR_RUNTIME.llamaCpp.license.sha256,
    ],
    [1_078, "94F29BBED6A22C35B992C5C6EBF0E7C92F13B836B90F36F461C9CF2F0F1D010D"],
  );
  assert.deepEqual(
    [PINNED_VLM_OCR_RUNTIME.model.weights.size, PINNED_VLM_OCR_RUNTIME.model.projector.size],
    [577_949_408, 732_938_240],
  );
  assert.deepEqual(
    [PINNED_VLM_OCR_RUNTIME.model.weights.sha256, PINNED_VLM_OCR_RUNTIME.model.projector.sha256],
    [
      "CDAFC794CAFEAE377868D7A40A70E282A737E39ABE77C0D8B73614447B364A21",
      "B77913164FF73D4C0DC4D994E236ED72BACBBE5C5DB1EC9B2828627B46C32804",
    ],
  );

  const prepare = read("desktop/scripts/prepare-app-resources.mjs");
  const verify = read("desktop/scripts/verify-package.mjs");
  assert.match(prepare, /stagePinnedVlmOcrRuntime\(\{/u);
  assert.match(verify, /import \{ PINNED_VLM_OCR_RUNTIME \} from "\.\/vlm-ocr-runtime-artifact\.mjs"/u);
  assert.doesNotMatch(prepare, /const PINNED_VLM_OCR_RUNTIME/u);
  assert.doesNotMatch(verify, /const PINNED_VLM_OCR_RUNTIME/u);
});

test("VLM OCR artifact acquisition distinguishes encoded transfer size from decoded receipt size", () => {
  assert.equal(
    declaredDecodedContentLength(new Headers({ "content-length": "1078" })),
    1_078,
  );
  assert.equal(
    declaredDecodedContentLength(
      new Headers({ "content-encoding": "gzip", "content-length": "655" }),
    ),
    null,
  );
  assert.equal(
    declaredDecodedContentLength(
      new Headers({ "content-encoding": "br", "content-length": "655" }),
    ),
    null,
  );
});

test("VLM OCR offline staging fails closed before network or target mutation", async () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-vlm-contract-test-"));
  const targetRoot = path.join(temporaryRoot, "vlm-ocr");
  const marker = path.join(targetRoot, "keep.txt");
  fs.mkdirSync(targetRoot, { recursive: true });
  fs.writeFileSync(marker, "existing target\n", "utf8");
  try {
    await assert.rejects(
      stagePinnedVlmOcrRuntime({
        targetRoot,
        licensesRoot: path.join(temporaryRoot, "licenses"),
        offline: true,
      }),
      /requires a supplied immutable artifact in offline mode/u,
    );
    assert.equal(fs.readFileSync(marker, "utf8"), "existing target\n");
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

for (const failurePoint of ["target rename", "second license rename"]) {
  test(`VLM OCR atomic swap restores the prior closure after ${failurePoint}`, () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-vlm-swap-test-"));
    const targetParent = path.join(root, "runtime");
    const targetRoot = path.join(targetParent, "vlm-ocr");
    const licensesRoot = path.join(root, "licenses");
    const llamaLicense = PINNED_VLM_OCR_RUNTIME.llamaCpp.license.name;
    const modelLicense = PINNED_VLM_OCR_RUNTIME.model.license.name;
    fs.mkdirSync(path.join(targetRoot, "models"), { recursive: true });
    fs.mkdirSync(licensesRoot, { recursive: true });
    const stagedTarget = fs.mkdtempSync(path.join(targetParent, ".vlm-ocr-test-stage-"));
    const stagedLlamaLicense = path.join(licensesRoot, ".vlm-ocr-test-llama-license.stage");
    const stagedModelLicense = path.join(licensesRoot, ".vlm-ocr-test-model-license.stage");
    fs.mkdirSync(path.join(stagedTarget, "models"), { recursive: true });
    fs.writeFileSync(path.join(targetRoot, "runtime-artifact.json"), "old receipt\n", "utf8");
    fs.writeFileSync(path.join(targetRoot, "models", "old.gguf"), "old model\n", "utf8");
    fs.writeFileSync(path.join(stagedTarget, "runtime-artifact.json"), "new receipt\n", "utf8");
    fs.writeFileSync(path.join(stagedTarget, "models", "new.gguf"), "new model\n", "utf8");
    fs.writeFileSync(path.join(licensesRoot, llamaLicense), "old llama license\n", "utf8");
    fs.writeFileSync(path.join(licensesRoot, modelLicense), "old model license\n", "utf8");
    fs.writeFileSync(stagedLlamaLicense, "new llama license\n", "utf8");
    fs.writeFileSync(stagedModelLicense, "new model license\n", "utf8");

    let injected = false;
    const operations = {
      mkdtempSync: fs.mkdtempSync,
      rmSync: fs.rmSync,
      renameSync(source, destination) {
        const isTargetInstall = source === stagedTarget && destination === targetRoot;
        const isSecondLicenseInstall =
          source === stagedModelLicense &&
          destination === path.join(licensesRoot, modelLicense);
        if (
          !injected &&
          ((failurePoint === "target rename" && isTargetInstall) ||
            (failurePoint === "second license rename" && isSecondLicenseInstall))
        ) {
          injected = true;
          throw new Error(`injected ${failurePoint}`);
        }
        return fs.renameSync(source, destination);
      },
    };

    try {
      assert.throws(
        () =>
          commitPinnedVlmOcrArtifactSet({
            stagedTarget,
            targetRoot,
            licensesRoot,
            operations,
            stagedLicenses: [
              { name: llamaLicense, staged: stagedLlamaLicense },
              { name: modelLicense, staged: stagedModelLicense },
            ],
          }),
        new RegExp(`injected ${failurePoint}`, "u"),
      );
      assert.equal(fs.readFileSync(path.join(targetRoot, "runtime-artifact.json"), "utf8"), "old receipt\n");
      assert.equal(fs.readFileSync(path.join(targetRoot, "models", "old.gguf"), "utf8"), "old model\n");
      assert.equal(fs.readFileSync(path.join(licensesRoot, llamaLicense), "utf8"), "old llama license\n");
      assert.equal(fs.readFileSync(path.join(licensesRoot, modelLicense), "utf8"), "old model license\n");
      assert.equal(
        fs.readdirSync(targetParent).some((name) => name.startsWith(".vlm-ocr-target-backup-")),
        false,
      );
      assert.equal(
        fs.readdirSync(licensesRoot).some((name) => name.startsWith(".vlm-ocr-license-backup-")),
        false,
      );
    } finally {
      fs.rmSync(stagedTarget, { recursive: true, force: true });
      fs.rmSync(stagedLlamaLicense, { force: true });
      fs.rmSync(stagedModelLicense, { force: true });
      assert.equal(
        fs.readdirSync(targetParent).some((name) => name.startsWith(".vlm-ocr-")),
        false,
      );
      assert.equal(
        fs.readdirSync(licensesRoot).some((name) => name.startsWith(".vlm-ocr-")),
        false,
      );
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
}

test("SolidWorks runtime atomic swap restores the prior closure after target replacement failure", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-solidworks-swap-test-"));
  const targetParent = path.join(root, "runtimes");
  const target = path.join(targetParent, "solidworks-python");
  fs.mkdirSync(path.join(target, "Lib", "site-packages"), { recursive: true });
  fs.writeFileSync(path.join(target, "runtime-artifact.json"), "old receipt\n", "utf8");
  fs.writeFileSync(path.join(target, "LICENSE.txt"), "old Python license\n", "utf8");
  fs.writeFileSync(path.join(target, "Lib", "site-packages", "old.txt"), "old package\n", "utf8");
  const stagedTarget = fs.mkdtempSync(path.join(targetParent, ".solidworks-python-test-stage-"));
  fs.writeFileSync(path.join(stagedTarget, "runtime-artifact.json"), "new receipt\n", "utf8");
  fs.writeFileSync(path.join(stagedTarget, "LICENSE.txt"), "new Python license\n", "utf8");

  let injected = false;
  const operations = {
    mkdtempSync: fs.mkdtempSync,
    rmSync: fs.rmSync,
    renameSync(source, destination) {
      if (!injected && source === stagedTarget && destination === target) {
        injected = true;
        throw new Error("injected SolidWorks target replacement failure");
      }
      return fs.renameSync(source, destination);
    },
  };

  try {
    assert.throws(
      () =>
        commitAtomicDirectorySwap({
          stagedTarget,
          target,
          label: "SolidWorks packaged runtime",
          operations,
        }),
      /injected SolidWorks target replacement failure/u,
    );
    assert.equal(fs.readFileSync(path.join(target, "runtime-artifact.json"), "utf8"), "old receipt\n");
    assert.equal(fs.readFileSync(path.join(target, "LICENSE.txt"), "utf8"), "old Python license\n");
    assert.equal(
      fs.readFileSync(path.join(target, "Lib", "site-packages", "old.txt"), "utf8"),
      "old package\n",
    );
    assert.equal(
      fs.readdirSync(targetParent).some((name) => name.startsWith(".artifact-backup-")),
      false,
    );
  } finally {
    fs.rmSync(stagedTarget, { recursive: true, force: true });
    assert.equal(
      fs.readdirSync(targetParent).some((name) => name.startsWith(".solidworks-python-test-stage-")),
      false,
    );
    assert.equal(
      fs.readdirSync(targetParent).some((name) => name.startsWith(".artifact-backup-")),
      false,
    );
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("SolidWorks source, runtime, and receipt validators share the exact reviewed contract", () => {
  const contracts = [
    ["prepare-runtimes", "desktop/scripts/prepare-runtimes.mjs"],
    ["prepare-app-resources", "desktop/scripts/prepare-app-resources.mjs"],
    ["verify-package", "desktop/scripts/verify-package.mjs"],
    ["prepare-solidworks-source", "desktop/scripts/prepare-solidworks-source.mjs"],
  ].map(([label, file]) => solidworksContract(read(file), label));
  assert.deepEqual(contracts[1], contracts[0]);
  assert.deepEqual(contracts[2], contracts[0]);
  assert.deepEqual(contracts[3], contracts[0]);
  assert.deepEqual(contracts[0], {
    packageVersion: "1.0.1",
    pythonVersion: "3.13.13",
    pythonArchiveSize: 10_950_201,
    pythonArchiveSha256: "8766A8775746235E23CF5AEE5027AB1060BB981D93110577ADCF3508AA0CBD55",
    pythonRuntimeSha256: "227E429CEEFA8C3D9F37AF5BAB72689D4DD1C09C25C693CF28144F1054D560E5",
    upstreamCommit: "a6d1f1be409547c43503dc4a4dcf2c39e6d99096",
    sourceArchiveSha256: "9C973CA49E8A243EA538EA61DB825CC3F8B727E0EAE5832B0D13E9EDD04907CC",
    sourceGitTree: "04ba626c25d09fe3d18079e0dc45cecae62c7256",
    sourceSha256: "E17852FA897BAD6445D8407322A2794AC2351FA0941B8E3B94E4CE908B769B9F",
    sourceFileCount: 92,
    sourceLockSha256: "189F8F7EE7FA473A1FF6E305603A58C534DB39B30854E3F16C31CFBA02DF644C",
    lockSha256: "2555A0542E322BB6DF3000AD850155AB4B0A16731AD16806981669C1265D75C9",
    packageCount: 159,
  });
});

test("SolidWorks and VLM have target-only online and offline assembly drivers", () => {
  const prepareRuntimes = read("desktop/scripts/prepare-runtimes.mjs");
  assert.match(prepareRuntimes, /--only/u);
  assert.match(prepareRuntimes, /--offline/u);
  assert.match(prepareRuntimes, /--prefetch/u);
  assert.match(prepareRuntimes, /BREADBOARD_\$\{service\.id\.toUpperCase\(\)/u);
  assert.match(prepareRuntimes, /\.\.\.\(prepareOptions\.offline \? \["--offline"\] : \[\]\)/u);
  assert.match(prepareRuntimes, /"--require-hashes",[\s\S]*?"--no-build"/u);
  assert.match(
    prepareRuntimes,
    /commitAtomicDirectorySwap\(\{[\s\S]*?stagedTarget: target,[\s\S]*?target: finalTarget/u,
  );
  assert.doesNotMatch(prepareRuntimes, /rmSync\(finalTarget,\s*\{\s*recursive:/u);

  const manifest = JSON.parse(read("desktop/package.json"));
  assert.equal(
    manifest.scripts["prepare:solidworks:download"],
    "node scripts/prepare-runtimes.mjs --only=solidworks-mcp --prefetch",
  );
  assert.equal(
    manifest.scripts["prepare:solidworks:offline"],
    "node scripts/prepare-runtimes.mjs --only=solidworks-mcp --offline",
  );
  assert.equal(
    manifest.scripts["prepare:solidworks:source"],
    "node scripts/prepare-solidworks-source.mjs",
  );
  assert.equal(
    manifest.scripts["prepare:vlm-ocr:offline"],
    "node scripts/prepare-vlm-ocr-runtime.mjs --offline",
  );

  const vlmDriver = read("desktop/scripts/prepare-vlm-ocr-runtime.mjs");
  for (const variable of [
    "BREADBOARD_VLM_OCR_LLAMA_ARCHIVE",
    "BREADBOARD_VLM_OCR_MODEL_ARTIFACT",
    "BREADBOARD_VLM_OCR_PROJECTOR_ARTIFACT",
    "BREADBOARD_VLM_OCR_LLAMA_LICENSE",
    "BREADBOARD_VLM_OCR_MODEL_LICENSE",
  ]) {
    assert.match(vlmDriver, new RegExp(variable, "u"));
  }
});

test("packaged manifests require the genuine VLM and SolidWorks artifact receipts", () => {
  const services = JSON.parse(read("desktop/runtime-v2/manifests/services.json")).services;
  const vlm = services.find((service) => service.id === "vlm-ocr");
  const solidworks = services.find((service) => service.id === "solidworks-mcp");
  assert.ok(vlm);
  assert.ok(solidworks);
  const packagedFiles = (service) =>
    service.launchProfiles
      .find((profile) => profile.modes.includes("packaged"))
      .installProbe.files.map((entry) => `${entry.authority}:${entry.path}`);
  assert.deepEqual(
    packagedFiles(vlm).filter((entry) => entry.startsWith("runtime-root:bin/vlm-ocr/")),
    [
      "runtime-root:bin/vlm-ocr/runtime/llama-server.exe",
      "runtime-root:bin/vlm-ocr/runtime-artifact.json",
      "runtime-root:bin/vlm-ocr/models/HunyuanOCR-Q8_0.gguf",
      "runtime-root:bin/vlm-ocr/models/mmproj-HunyuanOCR-Q8_0.gguf",
    ],
  );
  assert.ok(packagedFiles(solidworks).includes("runtime-root:runtimes/solidworks-python/runtime-artifact.json"));
  assert.ok(packagedFiles(solidworks).includes("app-root:SolidworksMCP-python/runtime-artifact.json"));
});
