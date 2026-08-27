import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  PACKAGE_VERIFIER_RECEIPT_KIND,
  PACKAGE_VERIFIER_RECEIPT_SCHEMA_VERSION,
  getPackageVerifierReceiptDiagnostics,
  packageVerificationBinding,
  recordPackageVerifierReceipt,
  validatePackageVerifierReceipt,
} from "./package-verifier-receipt.mjs";

const CRITICAL_FILES = Object.freeze([
  "Breadboard.exe",
  "resources/app.asar",
  "resources/app-services/dashboard/scripts/runtime-v2-dashboard.mjs",
  "resources/runtimes/node/node.exe",
  "resources/runtimes/bun/bun.exe",
  "resources/runtimes/python/python.exe",
  "resources/bin/codex.exe",
  "resources/bin/runtime-supervisor.exe",
  "resources/bin/breadboard-runtime.exe",
]);

function writeFile(root, relative, contents) {
  const target = path.join(root, ...relative.split("/"));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
  return target;
}

function makeTreeWritable(root) {
  if (!fs.existsSync(root)) return;
  const visit = (entry) => {
    const metadata = fs.lstatSync(entry, { throwIfNoEntry: false });
    if (!metadata) return;
    if (metadata.isDirectory() && !metadata.isSymbolicLink()) {
      for (const name of fs.readdirSync(entry)) visit(path.join(entry, name));
      try {
        fs.chmodSync(entry, 0o700);
      } catch {}
    } else {
      try {
        fs.chmodSync(entry, 0o600);
      } catch {}
    }
  };
  visit(root);
}

function fixture(t, mode = "ok") {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-package-receipt-"));
  t.after(() => {
    makeTreeWritable(repoRoot);
    fs.rmSync(repoRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 });
  });

  const services = `${JSON.stringify({ version: 4, services: [{ id: "required-service" }] }, null, 2)}\n`;
  const workers = `${JSON.stringify({ version: 2, workers: [{ id: "required-worker" }] }, null, 2)}\n`;
  writeFile(repoRoot, "desktop/electron-builder.yml", "appId: com.breadboard.test\nasar: true\n");
  writeFile(repoRoot, "desktop/runtime-v2/manifests/services.json", services);
  writeFile(repoRoot, "desktop/runtime-v2/manifests/workers.json", workers);
  writeFile(
    repoRoot,
    "desktop/scripts/nested/verifier-marker.mjs",
    'export const marker = "fixed-verifier-helper";\n',
  );
  writeFile(
    repoRoot,
    "desktop/scripts/verifier-helper.mjs",
    'export { marker } from "./nested/verifier-marker.mjs";\n',
  );
  writeFile(
    repoRoot,
    "desktop/scripts/verify-package.mjs",
    [
      'import fs from "node:fs";',
      'import path from "node:path";',
      'import { marker } from "./verifier-helper.mjs";',
      'if (marker !== "fixed-verifier-helper") process.exit(41);',
      'const mode = fs.readFileSync(path.join(process.cwd(), "verifier-mode.txt"), "utf8").trim();',
      'const packageRoot = path.join(process.env.BREADBOARD_DESKTOP_RELEASE_DIR, "win-unpacked");',
      'if (mode === "mutate") fs.appendFileSync(path.join(packageRoot, "resources", "extra", "asset.dat"), "mutated");',
      'if (mode === "fail") { console.error("[verify-package] FAILED:"); process.exit(9); }',
      'if (mode === "missing-ok") console.log("[verify-package] package looks fine");',
      'else console.log("[verify-package] OK");',
      "",
    ].join("\n"),
  );
  writeFile(repoRoot, "verifier-mode.txt", `${mode}\n`);

  const packageRoot = path.join(repoRoot, "release", "win-unpacked");
  for (const relative of CRITICAL_FILES) {
    writeFile(packageRoot, relative, `fixture:${relative}\n`);
  }
  writeFile(packageRoot, "resources/runtime-v2/manifests/services.json", services);
  writeFile(packageRoot, "resources/runtime-v2/manifests/workers.json", workers);
  writeFile(packageRoot, "resources/extra/asset.dat", "full-closure-only\n");
  writeFile(packageRoot, "resources/extra/.gitkeep", Buffer.alloc(0));
  fs.mkdirSync(path.join(packageRoot, "resources", "empty-directory"), { recursive: true });

  return Object.freeze({
    repoRoot,
    packageRoot,
    executablePath: path.join(packageRoot, "Breadboard.exe"),
    receiptPath: ".qa-results/package-verifier/receipt.json",
    receiptAbsolutePath: path.join(repoRoot, ".qa-results", "package-verifier", "receipt.json"),
  });
}

function recordFixture(f) {
  return recordPackageVerifierReceipt({
    repoRoot: f.repoRoot,
    executablePath: f.executablePath,
    receiptPath: f.receiptPath,
    runId: "package-test-run",
  });
}

test("CLI records through --output and rejects conflicting output aliases", (t) => {
  const f = fixture(t);
  const cli = fileURLToPath(new URL("./record-package-verifier-receipt.mjs", import.meta.url));
  const output = ".qa-results/package-verifier/cli-receipt.json";
  const common = [
    cli,
    `--repo=${f.repoRoot}`,
    `--executable=${f.executablePath}`,
    "--run-id=package-cli-test",
  ];
  const conflict = spawnSync(
    process.execPath,
    [...common, `--output=${output}`, "--receipt=.qa-results/package-verifier/other.json"],
    { encoding: "utf8", windowsHide: true },
  );
  assert.equal(conflict.status, 1);
  assert.match(conflict.stderr, /cannot be combined/u);

  const result = spawnSync(process.execPath, [...common, `--output=${output}`], {
    encoding: "utf8",
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr);
  const binding = JSON.parse(result.stdout);
  assert.equal(binding.receipt.path, output);
  assert.doesNotThrow(() =>
    validatePackageVerifierReceipt({
      repoRoot: f.repoRoot,
      receiptPath: output,
      expectedFileIdentity: binding.receipt,
      executablePath: f.executablePath,
      verifyClosure: true,
    }),
  );
});

test("records and validates a fixed-verifier package closure receipt", (t) => {
  const f = fixture(t);
  const recorded = recordFixture(f);

  assert.equal(recorded.receipt.kind, PACKAGE_VERIFIER_RECEIPT_KIND);
  assert.equal(recorded.receipt.schemaVersion, PACKAGE_VERIFIER_RECEIPT_SCHEMA_VERSION);
  assert.equal(recorded.receipt.verifier.stdout, "[verify-package] OK\n");
  assert.equal(recorded.receipt.package.closure.fileCount, 13);
  assert.ok(recorded.receipt.package.closure.directoryCount > 0);
  assert.deepEqual(
    recorded.receipt.sourceAuthority.verifierImportClosure.files.map((entry) => entry.path),
    [
      "desktop/scripts/nested/verifier-marker.mjs",
      "desktop/scripts/verifier-helper.mjs",
      "desktop/scripts/verify-package.mjs",
    ],
  );
  assert.deepEqual(Object.keys(recorded.binding).sort(), [
    "closureBytes",
    "closureFileCount",
    "closureSha256",
    "packageRootPathSha256",
    "receipt",
    "verifierSourceClosureSha256",
  ]);
  assert.deepEqual(Object.keys(recorded.binding.receipt).sort(), [
    "bytes",
    "capturedAt",
    "path",
    "sha256",
  ]);
  assert.deepEqual(Object.keys(recorded.executableIdentity).sort(), [
    "bytes",
    "fileName",
    "pathSha256",
    "sha256",
  ]);
  assert.equal(recorded.executableIdentity.fileName, "Breadboard.exe");
  assert.ok(Object.isFrozen(recorded.binding));
  assert.deepEqual(packageVerificationBinding(recorded), recorded.binding);
  assert.throws(
    () => packageVerificationBinding(structuredClone(recorded)),
    /genuine in-process validated package authority/u,
  );
  assert.equal(fs.statSync(f.receiptAbsolutePath).mode & 0o222, 0);

  const diagnosticsBeforeValidation = getPackageVerifierReceiptDiagnostics();
  assert.ok(Object.isFrozen(diagnosticsBeforeValidation));
  assert.deepEqual(Object.keys(diagnosticsBeforeValidation).sort(), [
    "criticalArtifactOnlySnapshotCount",
    "fullPackageTreeSnapshotCount",
  ]);
  const validated = validatePackageVerifierReceipt({
    repoRoot: f.repoRoot,
    receiptPath: f.receiptPath,
    expectedFileIdentity: recorded.binding.receipt,
    executablePath: f.executablePath,
    verifyClosure: true,
  });
  const diagnosticsAfterValidation = getPackageVerifierReceiptDiagnostics();
  assert.equal(
    diagnosticsAfterValidation.fullPackageTreeSnapshotCount -
      diagnosticsBeforeValidation.fullPackageTreeSnapshotCount,
    1,
  );
  assert.equal(
    diagnosticsAfterValidation.criticalArtifactOnlySnapshotCount -
      diagnosticsBeforeValidation.criticalArtifactOnlySnapshotCount,
    0,
  );
  assert.deepEqual(validated.binding, recorded.binding);
  assert.throws(
    () =>
      validatePackageVerifierReceipt({
        repoRoot: f.repoRoot,
        receiptPath: f.receiptPath,
        expectedFileIdentity: { ...recorded.reference, sha256: "A".repeat(64) },
        executablePath: f.executablePath,
      }),
    /does not match expectedFileIdentity/u,
  );
  assert.throws(() => recordFixture(f), /already exists/u);
});

test("fast validation rejects tampered app.asar even when Breadboard.exe is unchanged", (t) => {
  const f = fixture(t);
  const recorded = recordFixture(f);
  fs.appendFileSync(path.join(f.packageRoot, "resources", "app.asar"), "tampered");
  const diagnosticsBeforeValidation = getPackageVerifierReceiptDiagnostics();
  assert.throws(
    () =>
      validatePackageVerifierReceipt({
        repoRoot: f.repoRoot,
        receiptPath: f.receiptPath,
        expectedFileIdentity: recorded.reference,
        executablePath: f.executablePath,
        verifyClosure: false,
      }),
    /critical packaged artifacts|critical artifact aggregate/u,
  );
  const diagnosticsAfterValidation = getPackageVerifierReceiptDiagnostics();
  assert.equal(
    diagnosticsAfterValidation.fullPackageTreeSnapshotCount -
      diagnosticsBeforeValidation.fullPackageTreeSnapshotCount,
    0,
  );
  assert.equal(
    diagnosticsAfterValidation.criticalArtifactOnlySnapshotCount -
      diagnosticsBeforeValidation.criticalArtifactOnlySnapshotCount,
    1,
  );
  assert.deepEqual(recorded.executableIdentity, {
    fileName: "Breadboard.exe",
    pathSha256: recorded.receipt.package.criticalArtifacts.breadboardExecutable.pathSha256,
    bytes: recorded.receipt.package.criticalArtifacts.breadboardExecutable.bytes,
    sha256: recorded.receipt.package.criticalArtifacts.breadboardExecutable.sha256,
  });
});

test("full validation rejects a tampered non-critical extra resource", (t) => {
  const f = fixture(t);
  const recorded = recordFixture(f);
  fs.appendFileSync(path.join(f.packageRoot, "resources", "extra", "asset.dat"), "tampered");

  assert.doesNotThrow(() =>
    validatePackageVerifierReceipt({
      repoRoot: f.repoRoot,
      receiptPath: f.receiptPath,
      expectedFileIdentity: recorded.reference,
      executablePath: f.executablePath,
      verifyClosure: false,
    }),
  );
  assert.throws(
    () =>
      validatePackageVerifierReceipt({
        repoRoot: f.repoRoot,
        receiptPath: f.receiptPath,
        expectedFileIdentity: recorded.reference,
        executablePath: f.executablePath,
        verifyClosure: true,
      }),
    /package closure no longer matches/u,
  );
});

test("full closure accepts and binds intentional zero-byte marker files", (t) => {
  const f = fixture(t);
  const recorded = recordFixture(f);
  const marker = path.join(f.packageRoot, "resources", "extra", ".gitkeep");
  assert.equal(fs.statSync(marker).size, 0);
  fs.appendFileSync(marker, "no longer empty");
  assert.throws(
    () =>
      validatePackageVerifierReceipt({
        repoRoot: f.repoRoot,
        receiptPath: f.receiptPath,
        expectedFileIdentity: recorded.reference,
        executablePath: f.executablePath,
        verifyClosure: true,
      }),
    /package closure no longer matches/u,
  );
});

test("fast validation rejects a tampered Runtime V2 manifest", (t) => {
  const f = fixture(t);
  const recorded = recordFixture(f);
  fs.appendFileSync(
    path.join(f.packageRoot, "resources", "runtime-v2", "manifests", "workers.json"),
    " ",
  );
  assert.throws(
    () =>
      validatePackageVerifierReceipt({
        repoRoot: f.repoRoot,
        receiptPath: f.receiptPath,
        expectedFileIdentity: recorded.reference,
        executablePath: f.executablePath,
        verifyClosure: false,
      }),
    /critical packaged artifacts/u,
  );
});

test("recorder rejects a verifier that mutates the package during its run", (t) => {
  const f = fixture(t, "mutate");
  assert.throws(() => recordFixture(f), /pre\/post package closure|metadata changed/u);
  assert.equal(fs.existsSync(f.receiptAbsolutePath), false);
});

test("recorder publishes no receipt for verifier failure or missing exact OK", async (t) => {
  await t.test("nonzero verifier", (inner) => {
    const f = fixture(inner, "fail");
    assert.throws(() => recordFixture(f), /exited with status 9/u);
    assert.equal(fs.existsSync(f.receiptAbsolutePath), false);
  });
  await t.test("missing exact OK", (inner) => {
    const f = fixture(inner, "missing-ok");
    assert.throws(() => recordFixture(f), /did not emit exactly one exact/u);
    assert.equal(fs.existsSync(f.receiptAbsolutePath), false);
  });
});

test("validator rejects verifier import-closure source tampering", (t) => {
  const f = fixture(t);
  const recorded = recordFixture(f);
  fs.appendFileSync(
    path.join(f.repoRoot, "desktop", "scripts", "nested", "verifier-marker.mjs"),
    "// tampered\n",
  );
  assert.throws(
    () =>
      validatePackageVerifierReceipt({
        repoRoot: f.repoRoot,
        receiptPath: f.receiptPath,
        expectedFileIdentity: recorded.reference,
        executablePath: f.executablePath,
        verifyClosure: false,
      }),
    /source authority no longer matches/u,
  );
});

test("validator rejects a self-seal-tampered receipt", (t) => {
  const f = fixture(t);
  recordFixture(f);
  fs.chmodSync(f.receiptAbsolutePath, 0o600);
  const receipt = JSON.parse(fs.readFileSync(f.receiptAbsolutePath, "utf8"));
  receipt.runId = "tampered-run";
  fs.writeFileSync(f.receiptAbsolutePath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  fs.chmodSync(f.receiptAbsolutePath, 0o444);
  assert.throws(
    () =>
      validatePackageVerifierReceipt({
        repoRoot: f.repoRoot,
        receiptPath: f.receiptPath,
        executablePath: f.executablePath,
        verifyClosure: false,
      }),
    /contentSha256 does not match/u,
  );
});

test("freshness enforcement can be disabled without disabling identities", (t) => {
  const f = fixture(t);
  const recorded = recordFixture(f);
  const thirteenHoursLater = Date.parse(recorded.receipt.recordedAt) + 13 * 60 * 60_000;
  assert.throws(
    () =>
      validatePackageVerifierReceipt({
        repoRoot: f.repoRoot,
        receiptPath: f.receiptPath,
        executablePath: f.executablePath,
        nowMs: thirteenHoursLater,
        enforceFreshness: true,
        verifyClosure: false,
      }),
    /receipt is stale/u,
  );
  assert.doesNotThrow(() =>
    validatePackageVerifierReceipt({
      repoRoot: f.repoRoot,
      receiptPath: f.receiptPath,
      executablePath: f.executablePath,
      nowMs: thirteenHoursLater,
      enforceFreshness: false,
      verifyClosure: false,
    }),
  );

  fs.appendFileSync(path.join(f.packageRoot, "resources", "bin", "codex.exe"), "tampered");
  assert.throws(
    () =>
      validatePackageVerifierReceipt({
        repoRoot: f.repoRoot,
        receiptPath: f.receiptPath,
        executablePath: f.executablePath,
        nowMs: thirteenHoursLater,
        enforceFreshness: false,
        verifyClosure: false,
      }),
    /critical packaged artifacts/u,
  );
});

test("JSON schema declares the production receipt kind and critical closure", () => {
  const schema = JSON.parse(
    fs.readFileSync(new URL("./package-verifier-receipt.schema.json", import.meta.url), "utf8"),
  );
  assert.equal(schema.properties.schemaVersion.const, PACKAGE_VERIFIER_RECEIPT_SCHEMA_VERSION);
  assert.equal(schema.properties.kind.const, PACKAGE_VERIFIER_RECEIPT_KIND);
  assert.deepEqual(
    schema.$defs.criticalArtifacts.required.sort(),
    [
      "breadboardExecutable",
      "appAsar",
      "runtimeServicesManifest",
      "runtimeWorkersManifest",
      "dashboardRuntimeEntrypoint",
      "bundledNode",
      "bundledBun",
      "bundledPython",
      "codex",
      "runtimeSupervisor",
      "breadboardRuntime",
    ].sort(),
  );
});
