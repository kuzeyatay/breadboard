import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  HOT_GBRAIN_PROJECT,
  PACKAGED_PARITY_ENVIRONMENT,
  parseQaRunnerOptions,
  readPackagedParityHandoff,
} from "./run-qa-options.mjs";

function fixture(t) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bb-qa-runner-"));
  t.after(() => fs.rmSync(repoRoot, { recursive: true, force: true }));
  const executablePath = path.join(repoRoot, "package", "win-unpacked", "Breadboard.exe");
  const packageReceiptPath = ".qa-results/package-verifier/parity-package.json";
  const absoluteReceiptPath = path.join(repoRoot, ...packageReceiptPath.split("/"));
  fs.mkdirSync(path.dirname(executablePath), { recursive: true });
  fs.mkdirSync(path.dirname(absoluteReceiptPath), { recursive: true });
  fs.writeFileSync(executablePath, "sealed executable\n", "utf8");
  fs.writeFileSync(absoluteReceiptPath, "{}\n", "utf8");
  return { repoRoot, executablePath, packageReceiptPath };
}

function parityArguments(f, extra = []) {
  return [
    "--project=packaged-parity",
    "--skip-desktop-build",
    `--packaged-executable=${f.executablePath}`,
    `--parity-package-receipt=${f.packageReceiptPath}`,
    "--parity-run-id=parity-run-1",
    ...extra,
  ];
}

test("packaged parity hands one validated CLI authority into the Playwright environment", (t) => {
  const f = fixture(t);
  const baseEnv = { PATH: process.env.PATH, KEEP_ME: "yes" };
  const result = parseQaRunnerOptions({
    argv: parityArguments(f),
    baseEnv,
    repoRoot: f.repoRoot,
  });

  assert.equal(result.packagedParity, true);
  assert.equal(result.skipDesktopBuild, true);
  assert.equal(result.dashboardMode, "standalone");
  assert.deepEqual(result.forwarded, ["--project=packaged-parity"]);
  assert.equal(result.env[PACKAGED_PARITY_ENVIRONMENT.executablePath], f.executablePath);
  assert.equal(
    result.env[PACKAGED_PARITY_ENVIRONMENT.packageReceiptPath],
    f.packageReceiptPath,
  );
  assert.equal(result.env[PACKAGED_PARITY_ENVIRONMENT.runId], "parity-run-1");
  assert.equal(result.env.KEEP_ME, "yes");
  assert.deepEqual(
    readPackagedParityHandoff({ env: result.env, repoRoot: f.repoRoot }),
    {
      executablePath: f.executablePath,
      packageReceiptPath: f.packageReceiptPath,
      runId: "parity-run-1",
    },
  );
  assert.deepEqual(baseEnv, { PATH: process.env.PATH, KEEP_ME: "yes" });
});

test("the consumer-side handoff rejects missing, duplicate, and unknown authority keys", (t) => {
  const f = fixture(t);
  const result = parseQaRunnerOptions({
    argv: parityArguments(f),
    baseEnv: {},
    repoRoot: f.repoRoot,
  });
  const missing = { ...result.env };
  delete missing[PACKAGED_PARITY_ENVIRONMENT.runId];
  assert.throws(
    () => readPackagedParityHandoff({ env: missing, repoRoot: f.repoRoot }),
    /requires exactly one non-empty BREADBOARD_QA_PARITY_RUN_ID/,
  );
  assert.throws(
    () => readPackagedParityHandoff({
      env: { ...result.env, breadboard_qa_parity_run_id: "duplicate" },
      repoRoot: f.repoRoot,
    }),
    /requires exactly one non-empty BREADBOARD_QA_PARITY_RUN_ID/,
  );
  assert.throws(
    () => readPackagedParityHandoff({
      env: { ...result.env, BREADBOARD_QA_PARITY_UNSEALED_INPUT: "forbidden" },
      repoRoot: f.repoRoot,
    }),
    /rejects unknown authority environment key/,
  );
});

test("packaged parity requires all three values in strict equals-form CLI arguments", (t) => {
  const f = fixture(t);
  const complete = parityArguments(f);
  for (const prefix of [
    "--packaged-executable=",
    "--parity-package-receipt=",
    "--parity-run-id=",
  ]) {
    assert.throws(
      () => parseQaRunnerOptions({
        argv: complete.filter((argument) => !argument.startsWith(prefix)),
        baseEnv: {},
        repoRoot: f.repoRoot,
      }),
      /Packaged parity requires/,
    );
  }
  assert.throws(
    () => parseQaRunnerOptions({
      argv: ["--project=packaged-parity", "--skip-desktop-build", "--packaged-executable"],
      baseEnv: {},
      repoRoot: f.repoRoot,
    }),
    /strict --packaged-executable=<value> form/,
  );
});

test("packaged parity rejects stale ambient authority even with different key casing", (t) => {
  const f = fixture(t);
  assert.throws(
    () => parseQaRunnerOptions({
      argv: parityArguments(f),
      baseEnv: { breadboard_qa_parity_run_id: "stale-run" },
      repoRoot: f.repoRoot,
    }),
    /rejects ambient BREADBOARD_QA_PARITY_RUN_ID/,
  );
});

test("packaged parity cannot select, repeat, shard, or replace its dedicated project", (t) => {
  const f = fixture(t);
  for (const extra of [
    ["--repeat-each=2"],
    ["--workers=2"],
    ["--grep=only-one-capability"],
    ["specs/packaged-parity/one.spec.ts"],
    ["--project=critical"],
  ]) {
    assert.throws(
      () => parseQaRunnerOptions({
        argv: parityArguments(f, extra),
        baseEnv: {},
        repoRoot: f.repoRoot,
      }),
      /rejects Playwright selectors|require exactly/,
    );
  }
});

test("packaged parity rejects build and hot-dashboard paths that invalidate package authority", (t) => {
  const f = fixture(t);
  assert.throws(
    () => parseQaRunnerOptions({
      argv: parityArguments(f).filter((argument) => argument !== "--skip-desktop-build"),
      baseEnv: {},
      repoRoot: f.repoRoot,
    }),
    /requires --skip-desktop-build/,
  );
  assert.throws(
    () => parseQaRunnerOptions({
      argv: parityArguments(f),
      baseEnv: { BREADBOARD_QA_DASHBOARD_MODE: "hot" },
      repoRoot: f.repoRoot,
    }),
    /rejects --hot-dashboard/,
  );
});

test("packaged parity pins Breadboard.exe to win-unpacked and its receipt to evidence roots", (t) => {
  const f = fixture(t);
  const otherDirectory = path.join(f.repoRoot, "other");
  const otherExecutable = path.join(otherDirectory, "Breadboard.exe");
  fs.mkdirSync(otherDirectory, { recursive: true });
  fs.writeFileSync(otherExecutable, "wrong package root\n", "utf8");

  assert.throws(
    () => parseQaRunnerOptions({
      argv: parityArguments(f).map((argument) =>
        argument.startsWith("--packaged-executable=")
          ? `--packaged-executable=${otherExecutable}`
          : argument,
      ),
      baseEnv: {},
      repoRoot: f.repoRoot,
    }),
    /direct child of win-unpacked/,
  );
  assert.throws(
    () => parseQaRunnerOptions({
      argv: parityArguments(f).map((argument) =>
        argument.startsWith("--parity-package-receipt=")
          ? "--parity-package-receipt=package/win-unpacked/Breadboard.exe"
          : argument,
      ),
      baseEnv: {},
      repoRoot: f.repoRoot,
    }),
    /must live under/,
  );
  assert.throws(
    () => parseQaRunnerOptions({
      argv: parityArguments(f).map((argument) =>
        argument.startsWith("--parity-package-receipt=")
          ? "--parity-package-receipt=.qa-results/../package-verifier/receipt.json"
          : argument,
      ),
      baseEnv: {},
      repoRoot: f.repoRoot,
    }),
    /canonical forward-slash/,
  );
});

test("parity authority arguments are forbidden on ordinary QA projects", (t) => {
  const f = fixture(t);
  assert.throws(
    () => parseQaRunnerOptions({
      argv: parityArguments(f).map((argument) =>
        argument === "--project=packaged-parity" ? "--project=critical" : argument,
      ),
      baseEnv: {},
      repoRoot: f.repoRoot,
    }),
    /require exactly --project=packaged-parity/,
  );
});

test("the dedicated GBrain project requires an explicit hot-dashboard argument", (t) => {
  const f = fixture(t);
  for (const baseEnv of [
    {},
    { BREADBOARD_QA_DASHBOARD_MODE: "hot" },
  ]) {
    assert.throws(
      () => parseQaRunnerOptions({
        argv: [`--project=${HOT_GBRAIN_PROJECT}`],
        baseEnv,
        repoRoot: f.repoRoot,
      }),
      /gbrain-hot project requires an explicit --hot-dashboard/,
    );
  }

  const result = parseQaRunnerOptions({
    argv: [`--project=${HOT_GBRAIN_PROJECT}`, "--hot-dashboard", "--no-trace"],
    baseEnv: { BREADBOARD_QA_DASHBOARD_MODE: "standalone" },
    repoRoot: f.repoRoot,
  });
  assert.equal(result.dashboardMode, "hot");
  assert.equal(result.env.BREADBOARD_QA_DASHBOARD_MODE, "hot");
  assert.equal(result.env.BREADBOARD_QA_NO_TRACE, "1");
  assert.deepEqual(result.forwarded, [`--project=${HOT_GBRAIN_PROJECT}`]);
});

test("ordinary QA parsing remains backward compatible", (t) => {
  const f = fixture(t);
  const result = parseQaRunnerOptions({
    argv: ["--project=critical", "--headed", "--trace", "--preserve-runtime", "--grep=chat"],
    baseEnv: { PATH: process.env.PATH },
    repoRoot: f.repoRoot,
  });
  assert.equal(result.packagedParity, false);
  assert.equal(result.skipDesktopBuild, false);
  assert.deepEqual(result.forwarded, ["--project=critical", "--grep=chat"]);
  assert.equal(result.env.BREADBOARD_QA_HEADED, "1");
  assert.equal(result.env.BREADBOARD_QA_TRACE, "1");
  assert.equal(result.env.BREADBOARD_QA_PRESERVE_RUNTIME, "1");
});
