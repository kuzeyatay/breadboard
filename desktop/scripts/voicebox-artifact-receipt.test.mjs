import assert from "node:assert/strict";
import test from "node:test";

import {
  VOICEBOX_ARTIFACT_AUTHORITY,
  assertVoiceboxArtifactReceipt,
  voiceboxArtifactReceiptProblems,
} from "./voicebox-artifact-receipt.mjs";

const HASH_A = "A".repeat(64);
const HASH_B = "B".repeat(64);
const HASH_C = "C".repeat(64);
const HASH_D = "D".repeat(64);

function file(path, size, sha256) {
  return { path, size, sha256 };
}

function reviewedReceipt() {
  const authority = VOICEBOX_ARTIFACT_AUTHORITY;
  return {
    schemaVersion: authority.schemaVersion,
    name: authority.name,
    version: authority.version,
    backendVersion: authority.backendVersion,
    platform: authority.platform,
    architecture: authority.architecture,
    sourceCommit: authority.sourceCommit,
    executable: authority.executable,
    size: 337_000_000,
    sha256: HASH_A,
    sourceTree: {
      format: authority.sourceTreeFormat,
      fileCount: 512,
      sha256: HASH_B,
    },
    buildPython: { ...authority.buildPython },
    pyinstallerVersion: authority.pyinstaller.version,
    builderArtifacts: authority.builderArtifacts.map((artifact) => ({ ...artifact })),
    cpuRuntimeArtifacts: authority.cpuRuntimeArtifacts.map((artifact) => ({ ...artifact })),
    dependencyInventorySha256: HASH_C,
    dependencyInventory: {
      format: authority.dependencyInventoryFormat,
      entryCount: 187,
      sha256: HASH_C,
    },
    directVcs: [
      {
        distribution: "zipvoice",
        version: "0.0.11",
        vcs: "git",
        url: "https://github.com/example/zipvoice.git",
        commitId: "1".repeat(40),
      },
    ],
    build: {
      variant: "cpu",
      bundleMode: "onefile",
      entrypoint: "backend/server.py",
      arguments: [],
      requirements: [file("backend/requirements.txt", 2_371, HASH_D)],
      buildScript: file("backend/build_binary.py", 29_823, HASH_A),
      sourceSpec: file("backend/voicebox-server.spec", 5_702, HASH_B),
      generatedSpec: file("backend/voicebox-server.spec", 7_500, HASH_C),
      normalizedPyinstallerArguments: {
        format: authority.normalizedArgumentsFormat,
        argumentCount: 143,
        sha256: HASH_D,
      },
    },
    smoke: {
      dynamicPort: true,
      host: "127.0.0.1",
      healthPath: "/health",
      httpStatus: 200,
      reportedStatus: "healthy",
      backendVariant: "cpu",
      modelLoaded: false,
      reportedVersion: authority.version,
      isolatedDataDirectory: true,
      zeroDescendantsAfterStop: true,
    },
  };
}

test("the complete reviewed Voicebox provenance envelope is accepted", () => {
  const receipt = reviewedReceipt();
  assert.deepEqual(voiceboxArtifactReceiptProblems(receipt), []);
  assert.equal(assertVoiceboxArtifactReceipt(receipt), receipt);
});

test("Voicebox receipt keys and pinned builder artifacts are exact", () => {
  const extra = reviewedReceipt();
  extra.builtAt = "2026-08-26T00:00:00Z";
  assert.match(voiceboxArtifactReceiptProblems(extra).join("\n"), /exact reviewed top-level keys/u);

  const wrongWheel = reviewedReceipt();
  wrongWheel.builderArtifacts[3].sha256 = HASH_A;
  assert.match(voiceboxArtifactReceiptProblems(wrongWheel).join("\n"), /official PyPI wheel closure/u);

  const extraBuilderWheel = reviewedReceipt();
  extraBuilderWheel.builderArtifacts.push({ ...extraBuilderWheel.builderArtifacts[0] });
  assert.match(
    voiceboxArtifactReceiptProblems(extraBuilderWheel).join("\n"),
    /official PyPI wheel closure/u,
  );

  const mutableBuilderUrl = reviewedReceipt();
  mutableBuilderUrl.builderArtifacts[0].url = "https://pypi.org/project/altgraph/";
  assert.match(
    voiceboxArtifactReceiptProblems(mutableBuilderUrl).join("\n"),
    /official PyPI wheel closure/u,
  );

  const wrongPython = reviewedReceipt();
  wrongPython.buildPython.version = "3.12.12";
  assert.match(voiceboxArtifactReceiptProblems(wrongPython).join("\n"), /buildPython\.version/u);

  const cudaTorch = reviewedReceipt();
  cudaTorch.cpuRuntimeArtifacts[0].version = "2.11.0+cu128";
  assert.match(
    voiceboxArtifactReceiptProblems(cudaTorch).join("\n"),
    /official CPU wheel closure/u,
  );
});

test("Voicebox provenance rejects unsafe paths, mutable VCS references, and inconsistent inventories", () => {
  const unsafe = reviewedReceipt();
  unsafe.build.requirements[0].path = "C:\\Users\\builder\\requirements.txt";
  unsafe.directVcs[0].url = "https://user:secret@github.com/example/zipvoice.git";
  unsafe.directVcs[0].commitId = "main";
  unsafe.dependencyInventory.sha256 = HASH_D;
  const output = voiceboxArtifactReceiptProblems(unsafe).join("\n");
  assert.match(output, /safe relative path/u);
  assert.match(output, /credential-free immutable HTTPS/u);
  assert.match(output, /full immutable Git commit/u);
  assert.match(output, /hashes are invalid or inconsistent/u);
});

test("Voicebox smoke evidence must prove an isolated CPU start and complete stop", () => {
  const unsafe = reviewedReceipt();
  unsafe.smoke.backendVariant = "cuda";
  unsafe.smoke.modelLoaded = true;
  unsafe.smoke.isolatedDataDirectory = false;
  unsafe.smoke.zeroDescendantsAfterStop = false;
  const output = voiceboxArtifactReceiptProblems(unsafe).join("\n");
  assert.match(output, /smoke\.backendVariant/u);
  assert.match(output, /smoke\.modelLoaded/u);
  assert.match(output, /smoke\.isolatedDataDirectory/u);
  assert.match(output, /smoke\.zeroDescendantsAfterStop/u);
});
