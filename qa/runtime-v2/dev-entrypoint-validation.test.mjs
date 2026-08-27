import assert from "node:assert/strict";
import test from "node:test";
import { validateDevEntrypoints } from "./dev-entrypoint-validation.mjs";

const validInput = {
  rootPackage: {
    scripts: {
      dev: "npm run desktop:dev:hot",
      "desktop:dev:lean": "node desktop/scripts/dev-fast.mjs",
      "desktop:dev:hot": "npm --prefix desktop run dev",
      "desktop:dev:fast": "npm run desktop:dev:lean",
    },
  },
  desktopPackage: {
    scripts: {
      predev: "node scripts/sync-dev-runtime-manifests.mjs",
      dev: "npm run build && npm run prepare:native-runtime && node scripts/prepare-hot-dev-runtimes.mjs && npm run prepare:transcription && node scripts/sync-dev-runtime-manifests.mjs --stage-runtime-bins && node scripts/dev.mjs",
    },
  },
  leanLauncherSource: `
    spawn(process.execPath, [npmCli, "--prefix", "desktop", "run", "dev", "--", "--breadboard-internal-lean-dashboard"], {
      env: { BREADBOARD_DESKTOP_DASHBOARD_MODE: "standalone" },
    });
  `,
  electronLauncherSource: `
    const leanDashboardArgument = "--breadboard-internal-lean-dashboard";
    function launch({ dashboardMode = "hot", env }) {
      const electronEnv = { ...env, BREADBOARD_DESKTOP_DASHBOARD_MODE: dashboardMode };
    }
    spawn(electronBinary, [".", "--breadboard-dev"], { shell: false });
  `,
  runtimePreparerSource: `
    function deriveHotRuntimeClosure() {}
    if (metadata.nlink !== 1) throw new Error();
    spawnSync(process.execPath, ["prepare-runtimes.mjs", "--only", target]);
  `,
};

test("accepts hot Electron as the default and keeps lean Electron explicit", () => {
  const result = validateDevEntrypoints(validInput);
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
});

test("rejects the legacy multi-service development owner", () => {
  const result = validateDevEntrypoints({
    ...validInput,
    rootPackage: {
      scripts: {
        ...validInput.rootPackage.scripts,
        dev: "node scripts/dev-all.mjs",
      },
    },
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /primary npm run dev/u);
  assert.match(result.errors.join("\n"), /legacy process tree/u);
});

test("rejects a lean path that can launch a hot compiler directly", () => {
  const result = validateDevEntrypoints({
    ...validInput,
    leanLauncherSource: `
      BREADBOARD_DESKTOP_DASHBOARD_MODE: "standalone";
      spawn(node, [next, "dev"]);
    `,
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /hot Next/u);
});

test("rejects development that can launch against stale Runtime V2 manifests", () => {
  const result = validateDevEntrypoints({
    ...validInput,
    desktopPackage: {
      scripts: {
        dev: validInput.desktopPackage.scripts.dev,
      },
    },
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /refresh the checked-in Runtime V2 manifests/u);
});

test("rejects hot Electron launch without each ordered preparation boundary", () => {
  for (const dev of [
    "npm run build && node scripts/prepare-hot-dev-runtimes.mjs && npm run prepare:transcription && node scripts/sync-dev-runtime-manifests.mjs --stage-runtime-bins && node scripts/dev.mjs",
    "npm run build && npm run prepare:native-runtime && npm run prepare:transcription && node scripts/sync-dev-runtime-manifests.mjs --stage-runtime-bins && node scripts/dev.mjs",
    "npm run build && npm run prepare:native-runtime && node scripts/prepare-hot-dev-runtimes.mjs && npm run prepare:transcription && node scripts/dev.mjs",
  ]) {
    const result = validateDevEntrypoints({
      ...validInput,
      desktopPackage: {
        scripts: {
          ...validInput.desktopPackage.scripts,
          dev,
        },
      },
    });
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /prepare the native runtime/u);
    assert.match(result.errors.join("\n"), /incrementally prove the hot non-bin runtime closure/u);
    assert.match(result.errors.join("\n"), /strictly stage the hot bin closure/u);
  }
});

test("rejects a hot launcher whose inherited standalone mode can win", () => {
  const result = validateDevEntrypoints({
    ...validInput,
    electronLauncherSource: `
      const electronEnv = { ...env };
      spawn(electronBinary, [".", "--breadboard-dev"], { env: electronEnv });
    `,
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /overwrite inherited dashboard mode/u);
});

test("rejects a broad or hard-link-unsafe hot runtime preparer", () => {
  const result = validateDevEntrypoints({
    ...validInput,
    runtimePreparerSource: `spawnSync(process.execPath, ["prepare-runtimes.mjs"]);`,
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /manifest-derived, target-bounded, and hard-link-safe/u);
});
