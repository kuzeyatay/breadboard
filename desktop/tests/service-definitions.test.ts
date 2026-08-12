import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  buildServiceDefinitions,
  n8nServiceUrl,
  resolveAgencyAgentsPath,
  resolveN8nRuntime,
  resolveHermesPython,
  resolveVoiceboxRuntime,
  serviceUrls,
  voiceboxServiceUrl,
} from "../src/main/service-definitions";
import { resolvePaths, type ResolvedPaths } from "../src/main/path-resolver";
import { defaultPersistentConfig, type DesktopRuntimeConfig } from "../src/main/runtime-config";
import { DEFAULT_BREADBOARD_SKILLS_CATALOG_URL } from "../src/main/skills-catalog-config";

function fixture(mode: "dev" | "packaged", overrides: Partial<ReturnType<typeof defaultPersistentConfig>> = {}) {
  const paths = resolvePaths({
    isPackaged: mode === "packaged",
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
      n8n: 4311,
    },
  };
  const binaries = {
    node: "C:/rt/node.exe",
    bun: "C:/rt/bun.exe",
    python: "C:/rt/python.exe",
  };
  return { paths, config, binaries, definitions: buildServiceDefinitions({ paths, config, binaries }) };
}

test("all service URLs bind loopback only", () => {
  const { config } = fixture("packaged");
  for (const url of Object.values(serviceUrls(config))) {
    assert.match(url, /^http:\/\/127\.0\.0\.1:\d+/);
  }
});

test("dashboard env propagates dynamic ports, secrets and data locations", () => {
  const { config, definitions, paths } = fixture("packaged");
  const dashboard = definitions.find((d) => d.id === "dashboard");
  assert.ok(dashboard);
  assert.equal(dashboard.env["PORT"], "4300");
  assert.equal(dashboard.env["HOSTNAME"], "127.0.0.1");
  assert.equal(dashboard.env["NEXTAUTH_URL"], "http://127.0.0.1:4300");
  assert.equal(dashboard.env["NEXTAUTH_SECRET"], config.persistent.nextAuthSecret);
  assert.equal(dashboard.env["CHATMOCK_BASE_URL"], "http://127.0.0.1:4301/v1");
  assert.equal(dashboard.env["HERMES_MODE"], "required");
  assert.equal(dashboard.env["CODEX_BIN"], path.join(paths.binDir, "codex.exe"));
  assert.equal(dashboard.env["CODEX_HOME"], paths.codexHome);
  assert.equal(
    dashboard.env["ARIS_ROOT"],
    path.join(paths.appRoot, "auto-claude-code-research-in-sleep"),
  );
  assert.equal(dashboard.env["HERMES_BASE_URL"], "http://127.0.0.1:4305");
  assert.equal(
    dashboard.env["HERMES_DASHBOARD_SESSION_TOKEN"],
    config.persistent.hermesSessionToken,
  );
  assert.equal(dashboard.env["NEXT_PUBLIC_QUARTZ_URL"], "http://127.0.0.1:4303");
  assert.equal(dashboard.env["VOICEBOX_BASE_URL"], "http://127.0.0.1:4310");
  assert.equal(dashboard.env["SOCIALS_MANAGER_MODE"], "stack");
  assert.equal(dashboard.env["SOCIALS_MANAGER_URL"], "http://127.0.0.1:4306");
  assert.equal(dashboard.env["BREADBOARD_DATA_DIR"], paths.dataRoot);
  assert.equal(dashboard.env["QUARTZ_CONTENT_PATH"], paths.quartzContent);
  assert.equal(dashboard.env["NODE_ENV"], "production");
  assert.equal(dashboard.env["VIDEO_TRANSCRIPTION_ENABLED"], "true");
  assert.equal(dashboard.env["SCRIBERR_USERNAME"], config.persistent.scriberrUsername);
  assert.equal(dashboard.env["SCRIBERR_PASSWORD"], config.persistent.scriberrPassword);
  assert.equal(dashboard.env["FFMPEG_PATH"], path.join(paths.binDir, "ffmpeg.exe"));
  assert.equal(dashboard.env["BREADBOARD_WATCH_PYTHON"], "C:/rt/python.exe");
  assert.equal(dashboard.env["HERMES_ROOT"], paths.hermesWorkspaceRoot);
  assert.equal(
    dashboard.env["HERMES_FIRST_PARTY_SKILLS_ROOT"],
    path.join(paths.appRoot, "hermes-skills", "prebuilt"),
  );
  assert.equal(
    dashboard.env["HERMES_CAPABILITY_SECRET"],
    config.persistent.hermesCapabilitySecret,
  );
  assert.equal(
    dashboard.env["BREADBOARD_SKILLS_CATALOG_URL"],
    DEFAULT_BREADBOARD_SKILLS_CATALOG_URL,
  );
  // No default/dev secrets.
  assert.notEqual(dashboard.env["NEXTAUTH_SECRET"], "change-me");
});

test("Voicebox is supervised from its dev environment and remains server-only", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-voicebox-"));
  const savedPython = process.env["VOICEBOX_PYTHON"];
  try {
    const backend = path.join(root, "voicebox", "backend");
    fs.mkdirSync(backend, { recursive: true });
    fs.writeFileSync(path.join(backend, "main.py"), "");
    const python = path.join(root, "voicebox-python.exe");
    fs.writeFileSync(python, "");
    process.env["VOICEBOX_PYTHON"] = python;

    const base = fixture("packaged");
    const paths = { ...base.paths, mode: "dev" as const, appRoot: root };
    const runtime = resolveVoiceboxRuntime(paths);
    assert.ok(runtime);
    assert.equal(runtime.command, python);
    assert.deepEqual(runtime.argsPrefix, ["-m", "backend.main"]);
    assert.equal(voiceboxServiceUrl(base.config), "http://127.0.0.1:4310");

    const launcher = path.join(root, "scripts", "start-voicebox.mjs");
    fs.mkdirSync(path.dirname(launcher), { recursive: true });
    fs.writeFileSync(launcher, "");
    const definitions = buildServiceDefinitions({ paths, config: base.config, binaries: base.binaries });
    const voicebox = definitions.find((definition) => definition.id === "voicebox");
    const dashboard = definitions.find((definition) => definition.id === "dashboard");
    assert.ok(voicebox && dashboard);
    assert.equal(voicebox.required, false);
    assert.equal(voicebox.startInBackground, true);
    assert.equal(voicebox.command, base.binaries.node);
    assert.deepEqual(voicebox.args, [launcher]);
    assert.equal(voicebox.env["VOICEBOX_AUTOINSTALL"], "true");
    assert.equal(voicebox.env["VOICEBOX_PORT"], "4310");
    const statusPath = voicebox.env["VOICEBOX_STATUS_PATH"] ?? "";
    assert.match(statusPath, /startup-status\.json$/);
    // Voicebox is supervised for liveness only: a readiness deadline would
    // terminate its multi-gigabyte first-run install mid-download, so Settings
    // reports readiness from /health and the status file instead.
    assert.equal(voicebox.healthCheck, undefined);
    assert.equal(dashboard.env["VOICEBOX_BASE_URL"], "http://127.0.0.1:4310");
    assert.equal(dashboard.env["VOICEBOX_STATUS_PATH"], statusPath);
    assert.ok(!Object.values(serviceUrls(base.config)).includes(voiceboxServiceUrl(base.config)));
  } finally {
    if (savedPython === undefined) delete process.env["VOICEBOX_PYTHON"];
    else process.env["VOICEBOX_PYTHON"] = savedPython;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("dashboard account switching and ChatMock requests share one credential home", () => {
  const { definitions, paths } = fixture("packaged");
  const dashboard = definitions.find((definition) => definition.id === "dashboard");
  const chatmock = definitions.find((definition) => definition.id === "chatmock");
  assert.ok(dashboard && chatmock);
  assert.equal(dashboard.env["CODEX_HOME"], paths.codexHome);
  assert.equal(chatmock.env["CODEX_HOME"], paths.codexHome);
  assert.equal(chatmock.env["CODEX_HOME"], dashboard.env["CODEX_HOME"]);
  assert.equal(chatmock.restartOnChange, undefined);
});

test("n8n is supervised from the cloned checkout and stays out of public endpoints", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-n8n-"));
  try {
    const source = path.join(root, "n8n");
    const launcher = path.join(root, "scripts", "start-n8n.mjs");
    fs.mkdirSync(source, { recursive: true });
    fs.mkdirSync(path.dirname(launcher), { recursive: true });
    fs.writeFileSync(path.join(source, "package.json"), "{}");
    fs.writeFileSync(launcher, "");
    const base = fixture("packaged");
    const paths = { ...base.paths, mode: "dev" as const, appRoot: root };
    const runtime = resolveN8nRuntime(paths, base.binaries);
    assert.ok(runtime);
    assert.equal(runtime.command, base.binaries.node);
    assert.deepEqual(runtime.args, [launcher]);
    assert.equal(n8nServiceUrl(base.config), "http://127.0.0.1:4311");

    const definitions = buildServiceDefinitions({ paths, config: base.config, binaries: base.binaries });
    const n8n = definitions.find((definition) => definition.id === "n8n");
    const dashboard = definitions.find((definition) => definition.id === "dashboard");
    assert.ok(n8n && dashboard);
    assert.equal(n8n.required, false);
    assert.equal(n8n.startInBackground, true);
    assert.equal(n8n.healthCheck, undefined);
    assert.equal(n8n.env["N8N_PORT"], "4311");
    assert.equal(n8n.env["N8N_DASHBOARD_URL"], "http://127.0.0.1:4300");
    assert.equal(n8n.env["N8N_SOURCE_DIR"], source);
    assert.equal(n8n.env["N8N_RUNTIME_ENTRY"], undefined);
    assert.equal(dashboard.env["N8N_BASE_URL"], "http://127.0.0.1:4311");
    assert.equal(dashboard.env["N8N_STATUS_PATH"], n8n.env["N8N_STATUS_PATH"]);
    assert.equal(dashboard.env["N8N_CREDENTIALS_PATH"], n8n.env["N8N_CREDENTIALS_PATH"]);
    assert.ok(!Object.values(serviceUrls(base.config)).includes(n8nServiceUrl(base.config)));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("packaged startup supervises the prebuilt n8n runtime", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-n8n-packaged-"));
  try {
    const launcher = path.join(root, "scripts", "start-n8n.mjs");
    const runtimeEntry = path.join(root, "n8n-runtime", "bin", "n8n");
    fs.mkdirSync(path.dirname(launcher), { recursive: true });
    fs.mkdirSync(path.dirname(runtimeEntry), { recursive: true });
    fs.writeFileSync(launcher, "");
    fs.writeFileSync(runtimeEntry, "");
    const base = fixture("packaged");
    const paths = { ...base.paths, appRoot: root };
    const runtime = resolveN8nRuntime(paths, base.binaries);
    assert.ok(runtime);
    assert.equal(runtime.runtimeEntry, runtimeEntry);
    const definitions = buildServiceDefinitions({ paths, config: base.config, binaries: base.binaries });
    const n8n = definitions.find((definition) => definition.id === "n8n");
    assert.ok(n8n);
    assert.equal(n8n.startInBackground, true);
    assert.equal(n8n.env["N8N_RUNTIME_ENTRY"], runtimeEntry);
    assert.equal(n8n.env["N8N_SOURCE_DIR"], undefined);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("dashboard catalog proxy URL honors a server-side environment override", () => {
  const previous = process.env["BREADBOARD_SKILLS_CATALOG_URL"];
  process.env["BREADBOARD_SKILLS_CATALOG_URL"] = "http://127.0.0.1:4545/api/v1";
  try {
    const { definitions } = fixture("packaged");
    const dashboard = definitions.find((definition) => definition.id === "dashboard");
    assert.equal(dashboard?.env["BREADBOARD_SKILLS_CATALOG_URL"], "http://127.0.0.1:4545/api/v1");
    assert.ok(!(dashboard?.dependsOn ?? []).includes("skills-catalog-proxy"));
  } finally {
    if (previous === undefined) delete process.env["BREADBOARD_SKILLS_CATALOG_URL"];
    else process.env["BREADBOARD_SKILLS_CATALOG_URL"] = previous;
  }
});

test("dev dashboard retains the historical dashboard/db data layout", () => {
  const packaged = fixture("packaged");
  const devPaths = {
    ...packaged.paths,
    mode: "dev" as const,
    dataRoot: packaged.paths.appRoot,
  };
  const definitions = buildServiceDefinitions({
    paths: devPaths,
    config: packaged.config,
    binaries: packaged.binaries,
  });
  const dashboard = definitions.find((definition) => definition.id === "dashboard");
  assert.ok(dashboard);
  assert.equal(dashboard.env["BREADBOARD_DATA_DIR"], "");
  assert.equal(dashboard.env["NODE_ENV"], "development");
  assert.ok(dashboard.args.includes("--webpack"));
  assert.ok(!dashboard.args.includes("--turbopack"));
});

test("fast dev dashboard uses an existing standalone build", () => {
  const base = fixture("packaged");
  const dashboardRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bb-fast-dashboard-"));
  const server = path.join(
    dashboardRoot,
    ".next-desktop",
    "standalone",
    "dashboard",
    "server.js",
  );
  fs.mkdirSync(path.dirname(server), { recursive: true });
  fs.writeFileSync(server, "");
  const previous = process.env["BREADBOARD_DESKTOP_DASHBOARD_MODE"];
  process.env["BREADBOARD_DESKTOP_DASHBOARD_MODE"] = "standalone";
  try {
    const paths: ResolvedPaths = {
      ...base.paths,
      mode: "dev",
      appRoot: path.dirname(dashboardRoot),
      dashboardServerDir: dashboardRoot,
    };
    const definitions = buildServiceDefinitions({
      paths,
      config: base.config,
      binaries: base.binaries,
    });
    const dashboard = definitions.find((definition) => definition.id === "dashboard");
    assert.deepEqual(dashboard?.args, [server]);
    assert.equal(dashboard?.cwd, path.dirname(server));
    assert.equal(dashboard?.env["NODE_ENV"], "production");
  } finally {
    if (previous === undefined) delete process.env["BREADBOARD_DESKTOP_DASHBOARD_MODE"];
    else process.env["BREADBOARD_DESKTOP_DASHBOARD_MODE"] = previous;
    fs.rmSync(dashboardRoot, { recursive: true, force: true });
  }
});

test("dashboard explicitly receives a configured Agency Agents checkout", () => {
  const previous = process.env["AGENCY_AGENTS_PATH"];
  const catalog = fs.mkdtempSync(path.join(os.tmpdir(), "bb-agency-override-"));
  fs.writeFileSync(path.join(catalog, "divisions.json"), "{}");
  process.env["AGENCY_AGENTS_PATH"] = catalog;
  try {
    const { definitions } = fixture("packaged");
    const dashboard = definitions.find((definition) => definition.id === "dashboard");
    assert.equal(
      dashboard?.env["AGENCY_AGENTS_PATH"],
      path.resolve(process.env["AGENCY_AGENTS_PATH"]),
    );
  } finally {
    if (previous === undefined) delete process.env["AGENCY_AGENTS_PATH"];
    else process.env["AGENCY_AGENTS_PATH"] = previous;
    fs.rmSync(catalog, { recursive: true, force: true });
  }
});

test("a stale Agency Agents override falls back to the managed catalog", () => {
  const previous = process.env["AGENCY_AGENTS_PATH"];
  process.env["AGENCY_AGENTS_PATH"] = path.join(os.tmpdir(), "agency-agents-checkout-that-moved");
  try {
    const { definitions, paths } = fixture("packaged");
    const managed = path.join(paths.appRoot, "agency-agents");
    assert.equal(resolveAgencyAgentsPath(paths), managed);
    const dashboard = definitions.find((definition) => definition.id === "dashboard");
    assert.equal(dashboard?.env["AGENCY_AGENTS_PATH"], managed);
  } finally {
    if (previous === undefined) delete process.env["AGENCY_AGENTS_PATH"];
    else process.env["AGENCY_AGENTS_PATH"] = previous;
  }
});

test("dev Hermes runs on the checkout virtualenv, packaged on the bundled runtime", () => {
  // The system python has ChatMock's dependencies but not Hermes's, so dev
  // startup died with `No module named 'yaml'` and the runtime looked
  // unavailable while every other service was healthy.
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bb-hermes-python-"));
  const savedOverride = process.env["HERMES_PYTHON"];
  delete process.env["HERMES_PYTHON"];
  try {
    const hermesAppDir = path.join(repoRoot, "hermes-agent");
    const binaries = { node: "node.exe", bun: "bun.exe", python: "python.exe" };
    const devPaths = { mode: "dev", hermesAppDir } as ResolvedPaths;

    // No virtualenv yet: fall back rather than pointing at a missing file.
    assert.equal(resolveHermesPython(devPaths, binaries), "python.exe");

    const scripts = path.join(hermesAppDir, ".venv", process.platform === "win32" ? "Scripts" : "bin");
    fs.mkdirSync(scripts, { recursive: true });
    const venvPython = path.join(scripts, process.platform === "win32" ? "python.exe" : "python");
    fs.writeFileSync(venvPython, "");
    assert.equal(resolveHermesPython(devPaths, binaries), venvPython);

    process.env["HERMES_PYTHON"] = "C:/custom/python.exe";
    assert.equal(resolveHermesPython(devPaths, binaries), "C:/custom/python.exe");

    // Packaged always uses the bundled CPython that carries the pinned wheel.
    assert.equal(
      resolveHermesPython({ mode: "packaged", hermesAppDir } as ResolvedPaths, binaries),
      "python.exe",
    );
  } finally {
    if (savedOverride === undefined) delete process.env["HERMES_PYTHON"];
    else process.env["HERMES_PYTHON"] = savedOverride;
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("Hermes is a hidden-loopback supervised runtime and its endpoint is not published", () => {
  const { config, definitions, paths } = fixture("packaged");
  const hermes = definitions.find((definition) => definition.id === "hermes");
  if (!hermes) throw new Error("Hermes service should be registered");
  assert.equal(hermes.command, "C:/rt/python.exe");
  assert.equal(hermes.required, false);
  assert.deepEqual(hermes.dependsOn, ["chatmock"]);
  assert.deepEqual(
    hermes.args.slice(0, 3),
    ["-m", "hermes_cli.main", "serve"],
  );
  assert.ok(hermes.args.includes("127.0.0.1"));
  assert.ok(!hermes.args.includes(config.persistent.hermesSessionToken));
  assert.ok(!hermes.args.includes(config.persistent.hermesToolSecret));
  assert.equal(
    hermes.env["HERMES_DASHBOARD_SESSION_TOKEN"],
    config.persistent.hermesSessionToken,
  );
  assert.equal(
    hermes.env["BREADBOARD_HERMES_TOOL_SECRET"],
    config.persistent.hermesToolSecret,
  );
  assert.equal(hermes.env["HERMES_HOME"], paths.hermesHome);
  if (!hermes.healthCheck || hermes.healthCheck.type !== "http") {
    throw new Error("Hermes should use an HTTP readiness check");
  }
  assert.equal(hermes.healthCheck.url, "http://127.0.0.1:4305/api/status");
  assert.equal(
    Object.prototype.hasOwnProperty.call(serviceUrls(config), "hermes"),
    false,
  );
  assert.equal(hermes.restartOnChange, undefined);
});

test("dev Hermes reloads when its Breadboard integration changes", () => {
  const packaged = fixture("packaged");
  const paths = { ...packaged.paths, mode: "dev" as const };
  const definitions = buildServiceDefinitions({
    paths,
    config: packaged.config,
    binaries: packaged.binaries,
  });
  const hermes = definitions.find((definition) => definition.id === "hermes");
  assert.deepEqual(hermes?.restartOnChange, [
    path.join(paths.hermesAppDir, "plugins", "breadboard", "__init__.py"),
  ]);
});

test("dashboard receives an explicit ARIS clone override", () => {
  const previous = process.env["ARIS_ROOT"];
  process.env["ARIS_ROOT"] = path.join("C:\\", "research", "aris");
  try {
    const { definitions } = fixture("packaged");
    const dashboard = definitions.find((definition) => definition.id === "dashboard");
    assert.equal(dashboard?.env["ARIS_ROOT"], path.resolve(process.env["ARIS_ROOT"]));
  } finally {
    if (previous === undefined) delete process.env["ARIS_ROOT"];
    else process.env["ARIS_ROOT"] = previous;
  }
});

test("dev ChatMock reloads when its provider integration changes", () => {
  const packaged = fixture("packaged");
  const paths = { ...packaged.paths, mode: "dev" as const };
  const definitions = buildServiceDefinitions({
    paths,
    config: packaged.config,
    binaries: packaged.binaries,
  });
  const chatmock = definitions.find((definition) => definition.id === "chatmock");
  assert.deepEqual(chatmock?.restartOnChange, [
    path.join(paths.appRoot, "chatmock", "chatmock", "providers", "catalog.py"),
    path.join(paths.appRoot, "chatmock", "chatmock", "providers", "dispatch.py"),
    path.join(paths.appRoot, "chatmock", "chatmock", "providers", "registry.py"),
    path.join(paths.appRoot, "chatmock", "chatmock", "providers", "store.py"),
  ]);
});

test("native Scriberr is enabled by default, optional, and bypassed for an external URL", () => {
  const withScriberr = fixture("packaged");
  const scriberr = withScriberr.definitions.find((d) => d.id === "scriberr");
  assert.ok(scriberr);
  assert.equal(scriberr.required, false);
  assert.equal(scriberr.restartPolicy, "on-failure");
  assert.equal(scriberr.command, path.join(withScriberr.paths.binDir, "scriberr.exe"));
  assert.deepEqual(scriberr.args, []);
  assert.equal(scriberr.healthCheck, undefined);
  assert.equal(scriberr.env["HOST"], "127.0.0.1");
  assert.equal(scriberr.env["PORT"], "8091");
  assert.equal(scriberr.env["SCRIBERR_LAZY_MODEL_INIT"], "true");
  assert.match(scriberr.env["PATH"] ?? "", /bin/);
  assert.ok(!scriberr.command.toLowerCase().includes("docker"));
  const external = fixture("packaged", { scriberrEnabled: true, scriberrBaseUrl: "http://127.0.0.1:9999" });
  assert.ok(!external.definitions.some((d) => d.id === "scriberr"));
  const dashboard = external.definitions.find((d) => d.id === "dashboard");
  assert.equal(dashboard?.env["SCRIBERR_BASE_URL"], "http://127.0.0.1:9999");
});

test("quartz receives allocated ports and uses its early readiness endpoint", () => {
  // The Quartz CLI always opens a websocket listener; leaving it on the
  // default 3001 made startup fail with EADDRINUSE next to any other Quartz.
  const { definitions } = fixture("packaged");
  const quartz = definitions.find((d) => d.id === "quartz");
  assert.ok(quartz);
  const portIndex = quartz.args.indexOf("--port");
  const wsIndex = quartz.args.indexOf("--wsPort");
  assert.ok(portIndex >= 0 && wsIndex >= 0, "both --port and --wsPort must be passed");
  assert.equal(quartz.args[portIndex + 1], "4303");
  assert.equal(quartz.args[wsIndex + 1], "4304");
  assert.deepEqual(quartz.healthCheck, {
    type: "http",
    url: "http://127.0.0.1:4303/__health",
    expectBodyIncludes: '"ready":true',
    timeoutMs: 3_000,
    intervalMs: 1_000,
  });
});

test("packaged services never rely on PATH lookups for runtimes", () => {
  const { definitions } = fixture("packaged");
  for (const definition of definitions) {
    assert.ok(
      path.isAbsolute(definition.command),
      `${definition.id} must use an absolute runtime path, got ${definition.command}`,
    );
  }
});

test("no secret values leak into non-secret env keys or args", () => {
  const { config, definitions } = fixture("packaged");
  const secrets = [
    config.persistent.nextAuthSecret,
    config.persistent.hermesCapabilitySecret,
    config.persistent.hermesSessionToken,
    config.persistent.hermesToolSecret,
  ];
  for (const definition of definitions) {
    for (const arg of definition.args) {
      for (const secret of secrets) {
        assert.ok(!arg.includes(secret), `${definition.id} leaks a secret on the command line`);
      }
    }
  }
});

test("GBrain is absent by default and supervised as a loopback sidecar when enabled", () => {
  // Off by default: no gbrain service, no GBRAIN_* env on the dashboard.
  const off = fixture("packaged");
  assert.ok(!off.definitions.some((d) => d.id === "gbrain"));
  const dashOff = off.definitions.find((d) => d.id === "dashboard");
  assert.ok(dashOff);
  assert.equal(dashOff.env["GBRAIN_MODE"], undefined);

  // Enabled: a supervised Bun sidecar with a per-install secret, loopback health,
  // and mutable data under the desktop data dir (never in packaged resources).
  const on = fixture("packaged", { gbrainMode: "preferred" });
  const gbrain = on.definitions.find((d) => d.id === "gbrain");
  if (!gbrain) throw new Error("gbrain service should be registered when enabled");
  if (!gbrain.healthCheck || gbrain.healthCheck.type !== "http") {
    throw new Error("gbrain should use an HTTP health check");
  }
  assert.equal(gbrain.command, "C:/rt/bun.exe");
  assert.match(gbrain.healthCheck.url, /^http:\/\/127\.0\.0\.1:\d+\/health$/);
  assert.equal(gbrain.env["GBRAIN_ADAPTER_SECRET"], on.config.persistent.gbrainAdapterSecret);
  assert.ok((gbrain.env["GBRAIN_ADAPTER_SECRET"] ?? "").length >= 8);
  assert.ok((gbrain.env["GBRAIN_DATA_DIR"] ?? "").startsWith(on.paths.dataRoot));
  // Mutable data must not live inside packaged resources.
  assert.ok(!(gbrain.env["GBRAIN_DATA_DIR"] ?? "").includes("bb-res"));

  // The dashboard learns the adapter URL + shared secret, but the secret never
  // appears in a non-secret place unexpectedly (it is the per-install secret).
  const dashOn = on.definitions.find((d) => d.id === "dashboard");
  assert.ok(dashOn);
  assert.equal(dashOn.env["GBRAIN_MODE"], "preferred");
  assert.equal(dashOn.env["GBRAIN_ADAPTER_SECRET"], on.config.persistent.gbrainAdapterSecret);
});

test("ui-tars adapter is registered (optional default), loopback, secret via env not argv", () => {
  const { config, definitions, paths } = fixture("packaged");
  const uiTars = definitions.find((d) => d.id === "ui-tars");
  if (!uiTars) throw new Error("ui-tars service should be registered by default (optional mode)");
  assert.equal(uiTars.required, false, "ui-tars must never block startup");
  assert.equal(uiTars.command, "C:/rt/node.exe");
  if (!uiTars.healthCheck || uiTars.healthCheck.type !== "http") {
    throw new Error("ui-tars should use an HTTP health check");
  }
  assert.match(uiTars.healthCheck.url, /^http:\/\/127\.0\.0\.1:\d+\/health$/);
  assert.equal(uiTars.env["UI_TARS_ADAPTER_HOST"], "127.0.0.1");
  assert.equal(uiTars.env["UI_TARS_ADAPTER_SECRET"], config.persistent.uiTarsAdapterSecret);
  assert.ok((uiTars.env["UI_TARS_ADAPTER_SECRET"] ?? "").length >= 8);
  // Secret must NOT appear in argv (process listing safety).
  assert.ok(!uiTars.args.some((a) => a.includes(config.persistent.uiTarsAdapterSecret)));
  // Mutable data under the data dir, never inside packaged resources.
  assert.ok((uiTars.env["UI_TARS_DATA_DIR"] ?? "").startsWith(paths.dataRoot));
  assert.ok(!(uiTars.env["UI_TARS_DATA_DIR"] ?? "").includes("bb-res"));
  // Real runtime is the default; fake is test-only.
  assert.equal(uiTars.env["UI_TARS_RUNTIME"], process.env["UI_TARS_RUNTIME"] ?? "agent-tars");
});

test("dashboard receives UI_TARS_MODE + adapter secret when enabled", () => {
  const { config, definitions } = fixture("packaged");
  const dashboard = definitions.find((d) => d.id === "dashboard");
  assert.ok(dashboard);
  assert.equal(dashboard.env["UI_TARS_MODE"], "optional");
  assert.equal(dashboard.env["UI_TARS_ADAPTER_SECRET"], config.persistent.uiTarsAdapterSecret);
});

test("ui-tars disabled mode removes the service and its adapter secret from dashboard", () => {
  const { definitions } = fixture("packaged", { uiTarsMode: "disabled" });
  assert.equal(definitions.find((d) => d.id === "ui-tars"), undefined);
  const dashboard = definitions.find((d) => d.id === "dashboard");
  assert.ok(dashboard);
  assert.equal(dashboard.env["UI_TARS_MODE"], "disabled");
  assert.equal(dashboard.env["UI_TARS_ADAPTER_SECRET"], undefined);
});

/**
 * Subscription proxy (CLIProxyAPI).
 *
 * These pin the property that was actually broken: the desktop app supervised
 * every other service but not this one, so the Subscriptions panel could sign
 * an account in and sync its models into ChatMock while nothing was listening
 * to serve them.
 */
function withCliproxyHome<T>(install: boolean, run: (home: string) => T): T {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "bb-cliproxy-"));
  const previous = process.env["CLIPROXY_HOME"];
  process.env["CLIPROXY_HOME"] = home;
  try {
    if (install) {
      const bin = path.join(home, "bin");
      fs.mkdirSync(bin, { recursive: true });
      fs.writeFileSync(
        path.join(bin, process.platform === "win32" ? "cli-proxy-api.exe" : "cli-proxy-api"),
        "",
      );
    }
    return run(home);
  } finally {
    if (previous === undefined) delete process.env["CLIPROXY_HOME"];
    else process.env["CLIPROXY_HOME"] = previous;
    fs.rmSync(home, { recursive: true, force: true });
  }
}

test("cliproxy is supervised when installed, loopback-only and never required", () => {
  withCliproxyHome(true, (home) => {
    const { definitions } = fixture("packaged");
    const cliproxy = definitions.find((d) => d.id === "cliproxy");
    if (!cliproxy) throw new Error("cliproxy should be registered when the binary is present");
    assert.equal(cliproxy.required, false, "subscriptions must never block startup");
    assert.equal(cliproxy.command, path.join(home, "bin", process.platform === "win32" ? "cli-proxy-api.exe" : "cli-proxy-api"));
    assert.deepEqual(cliproxy.args, ["--config", path.join(home, "config.yaml")]);
    if (!cliproxy.healthCheck || cliproxy.healthCheck.type !== "http") {
      throw new Error("cliproxy should use an HTTP health check");
    }
    // Authenticated probe: /v1/models 401s without the bearer, so an
    // unauthenticated check would never go healthy.
    assert.match(cliproxy.healthCheck.url, /^http:\/\/127\.0\.0\.1:\d+\/v1\/models$/);
    assert.match(cliproxy.healthCheck.headers?.["Authorization"] ?? "", /^Bearer .+/);
  });
});

test("Codex is a dashboard-launched coding agent, not a supervised chat runtime", () => {
  const { definitions, paths } = fixture("packaged");
  const codex = definitions.find((definition) => definition.id === "codex");
  assert.equal(codex, undefined);
  const dashboard = definitions.find((definition) => definition.id === "dashboard");
  if (!dashboard) throw new Error("Dashboard service should be registered");
  assert.equal(dashboard.env["CODEX_BIN"], path.join(paths.binDir, "codex.exe"));
  assert.equal(dashboard.env["CODEX_HOME"], paths.codexHome);
});

test("Postiz starts silently in the background and never blocks the workspace", () => {
  const { definitions, paths } = fixture("packaged");
  const postiz = definitions.find((definition) => definition.id === "postiz");
  const dashboard = definitions.find((definition) => definition.id === "dashboard");
  assert.ok(postiz && dashboard);
  assert.equal(postiz.required, false);
  assert.equal(postiz.startInBackground, true);
  assert.equal(postiz.command, "C:/rt/node.exe");
  assert.deepEqual(postiz.args, [
    "--experimental-strip-types",
    path.join(paths.appRoot, "scripts", "start-postiz-supervisor.mjs"),
  ]);
  assert.equal(postiz.env["SOCIALS_MANAGER_MODE"], "stack");
  assert.equal(postiz.env["SOCIALS_MANAGER_URL"], "http://127.0.0.1:4306");
  assert.equal(postiz.env["SOCIALS_MANAGER_ROOT"], path.join(paths.appRoot, "postiz-app"));
  assert.equal(postiz.env["SOCIALS_MANAGER_SUPPRESS_DOCKER_UI"], "true");
  if (!postiz.healthCheck || postiz.healthCheck.type !== "http") {
    throw new Error("Postiz should use the supervisor readiness endpoint");
  }
  assert.equal(postiz.healthCheck.url, "http://127.0.0.1:4307/health");
  assert.equal(postiz.healthCheck.expectBodyIncludes, '"ready":true');
  assert.ok(!(dashboard.dependsOn ?? []).includes("postiz"));
  assert.equal(dashboard.env["SOCIALS_MANAGER_SUPPRESS_DOCKER_UI"], "true");
});

test("cliproxy is not registered when the binary has not been downloaded yet", () => {
  withCliproxyHome(false, () => {
    const { definitions } = fixture("packaged");
    assert.equal(definitions.find((d) => d.id === "cliproxy"), undefined);
    // No half-configured wiring either: a dashboard pointed at a proxy that is
    // not running would report subscriptions as available.
    const dashboard = definitions.find((d) => d.id === "dashboard");
    assert.ok(dashboard);
    assert.equal(dashboard.env["CLIPROXY_BASE_URL"], undefined);
    assert.equal(dashboard.env["CLIPROXY_API_KEY"], undefined);
  });
});

test("cliproxy disabled mode removes the service even when the binary exists", () => {
  withCliproxyHome(true, () => {
    const { definitions } = fixture("packaged", { cliproxyMode: "disabled" });
    assert.equal(definitions.find((d) => d.id === "cliproxy"), undefined);
    const dashboard = definitions.find((d) => d.id === "dashboard");
    assert.ok(dashboard);
    assert.equal(dashboard.env["CLIPROXY_MODE"], "disabled");
    assert.equal(dashboard.env["CLIPROXY_BASE_URL"], undefined);
  });
});

test("dashboard and ChatMock are told the same proxy the supervisor starts", () => {
  withCliproxyHome(true, (home) => {
    const { definitions } = fixture("packaged");
    const cliproxy = definitions.find((d) => d.id === "cliproxy");
    const dashboard = definitions.find((d) => d.id === "dashboard");
    const chatmock = definitions.find((d) => d.id === "chatmock");
    assert.ok(cliproxy && dashboard && chatmock);
    if (!cliproxy.healthCheck || cliproxy.healthCheck.type !== "http") {
      throw new Error("cliproxy should use an HTTP health check");
    }
    // The port the proxy actually serves on is the one both clients are given:
    // a disagreement here is invisible until a model call 401s or times out.
    const servedOrigin = new URL(cliproxy.healthCheck.url).origin;
    assert.equal(dashboard.env["CLIPROXY_BASE_URL"], `${servedOrigin}/v1`);
    assert.equal(chatmock.env["CLIPROXY_BASE_URL"], `${servedOrigin}/v1`);
    assert.equal(dashboard.env["CLIPROXY_API_KEY"], chatmock.env["CLIPROXY_API_KEY"]);
    assert.equal(
      `Bearer ${dashboard.env["CLIPROXY_API_KEY"]}`,
      cliproxy.healthCheck.headers?.["Authorization"],
    );
    assert.equal(dashboard.env["CLIPROXY_HOME"], home);
    // Secrets travel by env, never argv (process-listing safety).
    assert.ok(!cliproxy.args.some((a) => a.includes(dashboard.env["CLIPROXY_API_KEY"] ?? "\u0000")));
  });
});
