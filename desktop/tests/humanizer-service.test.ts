// The humanizer as a supervised, optional, loopback-only leaf service.
//
// Four properties matter enough to pin. It never blocks startup — a machine
// without the environment must launch exactly as it did before this existed.
// Its secret travels by environment and never by argv, because argv is
// world-readable in a process listing. The dashboard is told the same port the
// supervisor actually allocated. And the model cache is under the mutable data
// directory, which is what makes a user-downloaded checkpoint survive an
// application update and stay out of the installer.

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  buildServiceDefinitions,
  humanizerServiceUrl,
  resolveHumanizerHome,
  resolveHumanizerPython,
} from "../src/main/service-definitions";
import { resolvePaths, type ResolvedPaths } from "../src/main/path-resolver";
import {
  defaultPersistentConfig,
  redactSecrets,
  redactedConfigSummary,
  validatePersistentConfig,
  type DesktopRuntimeConfig,
} from "../src/main/runtime-config";

function fixture(overrides: Partial<ReturnType<typeof defaultPersistentConfig>> = {}) {
  const paths: ResolvedPaths = resolvePaths({
    isPackaged: true,
    forceDev: false,
    userDataDir: path.join(os.tmpdir(), "bb-ud"),
    electronResourcesPath: path.join(os.tmpdir(), "bb-res"),
    moduleDir: path.join(os.tmpdir(), "bb-repo", "desktop", "dist", "main"),
  });
  const config: DesktopRuntimeConfig = {
    persistent: { ...defaultPersistentConfig(), ...overrides },
    ports: {
      dashboard: 4300,
      chatmock: 4301,
      hermes: 4305,
      postiz: 4306,
      postizSupervisor: 4307,
      quartz: 4303,
      quartzWs: 4304,
      voicebox: 4310,
      humanizer: 4399,
    },
  };
  const binaries = {
    node: "C:/rt/node.exe",
    bun: "C:/rt/bun.exe",
    python: "C:/rt/python.exe",
  };
  return { paths, config, definitions: buildServiceDefinitions({ paths, config, binaries }) };
}

/** Stand up a fake provisioned environment so the resolver finds something. */
function withHumanizerEnvironment<T>(run: (root: string) => T): T {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-humanizer-"));
  const previous = process.env["HUMANIZER_PYTHON"];
  const python = path.join(root, process.platform === "win32" ? "python.exe" : "python");
  fs.writeFileSync(python, "");
  process.env["HUMANIZER_PYTHON"] = python;
  try {
    return run(root);
  } finally {
    if (previous === undefined) delete process.env["HUMANIZER_PYTHON"];
    else process.env["HUMANIZER_PYTHON"] = previous;
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("the humanizer endpoint is loopback only", () => {
  const { config } = fixture();
  assert.match(humanizerServiceUrl(config), /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.equal(humanizerServiceUrl(config), "http://127.0.0.1:4399");
});

test("no interpreter means no service and no supervised process", () => {
  // The ordinary case: nobody ran `npm run setup:humanizer`.
  const { paths, definitions } = fixture();
  assert.equal(resolveHumanizerPython(paths), null);
  assert.equal(definitions.find((definition) => definition.id === "humanizer"), undefined);
});

test("without the service the dashboard is told local rewriting is unavailable", () => {
  const { definitions } = fixture();
  const dashboard = definitions.find((definition) => definition.id === "dashboard");
  assert.ok(dashboard);
  // `disabled` rather than absent: the dashboard must stop calling a service
  // that cannot answer instead of timing out once per rewrite.
  assert.equal(dashboard.env["HUMANIZER_MODE"], "disabled");
  assert.equal(dashboard.env["HUMANIZER_SERVICE_URL"], undefined);
  assert.equal(dashboard.env["HUMANIZER_SERVICE_SECRET"], undefined);
});

/**
 * The dev layout, whose appRoot is this repository — so the resolver finds the
 * real `humanizer-service/breadboard_humanizer/__main__.py` and a fake
 * interpreter is enough to register the service.
 */
function repositoryRoot(): string {
  // Walk up rather than counting `..`s: this file runs from dist-tests, whose
  // depth is a build detail nothing else should depend on.
  let directory = __dirname;
  for (let step = 0; step < 8; step += 1) {
    if (fs.existsSync(path.join(directory, "humanizer-service", "breadboard_humanizer"))) {
      return directory;
    }
    directory = path.dirname(directory);
  }
  throw new Error("could not locate the repository root from " + __dirname);
}

function devFixture(overrides: Partial<ReturnType<typeof defaultPersistentConfig>> = {}) {
  const repoRoot = repositoryRoot();
  const paths = resolvePaths({
    isPackaged: false,
    forceDev: true,
    userDataDir: fs.mkdtempSync(path.join(os.tmpdir(), "bb-ud-")),
    electronResourcesPath: path.join(os.tmpdir(), "bb-res"),
    moduleDir: path.join(repoRoot, "desktop", "dist", "main"),
  });
  const config: DesktopRuntimeConfig = {
    persistent: { ...defaultPersistentConfig(), ...overrides },
    ports: {
      dashboard: 4300,
      chatmock: 4301,
      hermes: 4305,
      postiz: 4306,
      postizSupervisor: 4307,
      quartz: 4303,
      quartzWs: 4304,
      humanizer: 4399,
    },
  };
  return {
    paths,
    config,
    definitions: buildServiceDefinitions({
      paths,
      config,
      binaries: { node: "C:/rt/node.exe", bun: "C:/rt/bun.exe", python: "C:/rt/python.exe" },
    }),
  };
}

test("a provisioned environment registers a loopback service with the secret off argv", () => {
  withHumanizerEnvironment(() => {
    const { paths, definitions } = devFixture();
    const python = resolveHumanizerPython(paths);
    assert.ok(python, "a fake interpreter plus the real service source should resolve");

    const humanizer = definitions.find((definition) => definition.id === "humanizer");
    assert.ok(humanizer, "the humanizer should be supervised once it is provisioned");
    assert.equal(humanizer.required, false);
    assert.equal(humanizer.command, python);
    assert.deepEqual(humanizer.args, [
      "-m",
      "breadboard_humanizer",
      "serve",
      "--host",
      "127.0.0.1",
      "--port",
      "4399",
      "--preload",
    ]);
    // Secrets travel by env, never argv (process-listing safety).
    const secret = humanizer.env["BREADBOARD_HUMANIZER_SECRET"] ?? "\u0000";
    assert.ok(secret.length >= 24);
    assert.ok(!humanizer.args.some((argument) => argument.includes(secret)));
    // The checkpoint is a user download. Desktop dev must use the same default
    // cache as setup-humanizer.mjs and the other launchers.
    const cache = humanizer.env["HF_HOME"] ?? "";
    assert.equal(cache, path.join(os.homedir(), ".breadboard", "humanizer", "models"));
    assert.equal(resolveHumanizerHome(paths), path.join(os.homedir(), ".breadboard", "humanizer"));
    assert.ok(!cache.startsWith(paths.resourcesRoot + path.sep + "app-services"));
    assert.equal(humanizer.env["HF_HUB_DISABLE_TELEMETRY"], "1");

    // A provisioned model warms inside the visible startup sequence. The TCP
    // socket only opens after --preload has attempted the installed checkpoint.
    assert.notEqual(humanizer.startInBackground, true);
    assert.deepEqual(humanizer.healthCheck, {
      type: "tcp",
      host: "127.0.0.1",
      port: 4399,
      timeoutMs: 2_000,
      intervalMs: 500,
    });

    // The dashboard is told the same port the supervisor allocated.
    const dashboard = definitions.find((definition) => definition.id === "dashboard");
    assert.ok(dashboard);
    assert.equal(dashboard.env["HUMANIZER_MODE"], "local");
    assert.equal(dashboard.env["HUMANIZER_SERVICE_URL"], "http://127.0.0.1:4399");
    assert.equal(dashboard.env["HUMANIZER_SERVICE_SECRET"], secret);
    assert.equal(dashboard.env["BREADBOARD_HUMANIZER_DEVICE"], "auto");
  });
});

test("disabled mode keeps the service off even when the environment exists", () => {
  withHumanizerEnvironment(() => {
    const { definitions } = devFixture({ humanizerMode: "disabled" });
    assert.equal(definitions.find((definition) => definition.id === "humanizer"), undefined);
    const dashboard = definitions.find((definition) => definition.id === "dashboard");
    assert.equal(dashboard?.env["HUMANIZER_MODE"], "disabled");
    assert.equal(dashboard?.env["HUMANIZER_SERVICE_SECRET"], undefined);
  });
});

test("the humanizer joins startup without becoming a required service", () => {
  const { definitions } = fixture();
  for (const definition of definitions) {
    if (definition.id === "humanizer") {
      assert.equal(definition.required, false);
      assert.notEqual(definition.startInBackground, true);
    }
  }
  // Whatever else changed, the services that must start still do.
  for (const id of ["chatmock", "hermes", "quartz", "dashboard"]) {
    assert.ok(
      definitions.some((definition) => definition.id === id),
      `${id} must still be registered`,
    );
  }
});

test("the persisted config carries a humanizer mode, device and secret", () => {
  const config = defaultPersistentConfig();
  assert.equal(config.humanizerMode, "local");
  assert.equal(config.humanizerDevice, "auto");
  assert.ok(config.humanizerServiceSecret.length >= 24);
});

test("an older config file gains the humanizer fields without losing anything", () => {
  const legacy = { ...defaultPersistentConfig() } as Record<string, unknown>;
  delete legacy["humanizerMode"];
  delete legacy["humanizerDevice"];
  delete legacy["humanizerServiceSecret"];
  const normalized = validatePersistentConfig(legacy);
  assert.equal(normalized.humanizerMode, "local");
  assert.equal(normalized.humanizerDevice, "auto");
  assert.ok(normalized.humanizerServiceSecret.length > 0);

  // An install that turned it off stays off.
  const off = validatePersistentConfig({ ...legacy, humanizerMode: "disabled" });
  assert.equal(off.humanizerMode, "disabled");
  // An unknown device falls back rather than being passed through.
  const odd = validatePersistentConfig({ ...legacy, humanizerDevice: "tpu" });
  assert.equal(odd.humanizerDevice, "auto");
});

test("the humanizer secret is redacted from logs and absent from diagnostics", () => {
  const config = defaultPersistentConfig();
  const line = `starting with ${config.humanizerServiceSecret} in hand`;
  assert.equal(redactSecrets(line, config), "starting with [redacted] in hand");

  const summary = redactedConfigSummary({
    persistent: config,
    ports: {
      dashboard: 1,
      chatmock: 2,
      hermes: 3,
      postiz: 4,
      postizSupervisor: 5,
      quartz: 6,
      quartzWs: 7,
      humanizer: 8,
    },
  });
  assert.equal(summary["humanizerMode"], "local");
  assert.equal(summary["humanizerDevice"], "auto");
  assert.ok(!JSON.stringify(summary).includes(config.humanizerServiceSecret));
});
