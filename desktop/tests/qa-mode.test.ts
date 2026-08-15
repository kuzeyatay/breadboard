import { test } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import { prepareQaServiceDefinitions } from "../src/main/qa-mode";
import type { ResolvedPaths } from "../src/main/path-resolver";
import type { DesktopServiceDefinition } from "../src/main/service-manager";

const definition = (id: string): DesktopServiceDefinition => ({
  id,
  displayName: id,
  required: id === "dashboard",
  command: "node",
  args: [],
  cwd: ".",
  env: {
    BREADBOARD_DATA_DIR: "",
    BREADBOARD_DEVELOPMENT_DASHBOARD_DIR: "C:/checkout/dashboard",
  },
  startupTimeoutMs: 1_000,
  gracefulShutdownMs: 1_000,
  restartPolicy: "never",
});

test("critical QA profile excludes expensive and credentialed integrations", () => {
  const paths = {
    qaMode: true,
    dataRoot: path.resolve("C:/qa-user-data/Data"),
    runtimeDir: path.resolve("C:/qa-user-data/Data/runtime"),
  } as ResolvedPaths;
  const prepared = prepareQaServiceDefinitions(
    [
      definition("chatmock"),
      definition("postiz"),
      definition("hermes"),
      definition("ui-tars"),
      definition("scriberr"),
      definition("quartz"),
      {
        ...definition("dashboard"),
        healthCheck: {
          type: "http",
          url: "http://127.0.0.1:4300/api/health",
          timeoutMs: 3_000,
          intervalMs: 750,
        },
      },
    ],
    paths,
    "critical",
  );
  assert.deepEqual(
    prepared.map((entry) => entry.id),
    ["chatmock", "hermes", "quartz", "dashboard"],
  );
  const dashboard = prepared.find((entry) => entry.id === "dashboard");
  const chatmock = prepared.find((entry) => entry.id === "chatmock");
  const hermes = prepared.find((entry) => entry.id === "hermes");
  assert.ok(dashboard);
  assert.ok(chatmock);
  assert.ok(hermes);
  const councilLedgerDir = path.join(
    paths.dataRoot,
    "chatmock",
    "council-runs",
  );
  assert.equal(
    chatmock.env["COUNCIL_LEDGER_DIR"],
    councilLedgerDir,
  );
  assert.equal(dashboard.env["COUNCIL_LEDGER_DIR"], councilLedgerDir);
  assert.equal(dashboard.env["COMFYUI_ENABLED"], "false");
  assert.equal(dashboard.env["COMFYUI_MANAGED"], "false");
  assert.equal(dashboard.env["COMFYUI_AUTOSTART"], "false");
  assert.equal(dashboard.env["SOCIALS_MANAGER_MODE"], "disabled");
  assert.equal(dashboard.env["SOCIALS_MANAGER_AUTOSTART_DOCKER"], "false");
  assert.equal(dashboard.env["INBOX_ZERO_MODE"], "disabled");
  assert.equal(dashboard.env["INBOX_ZERO_AUTOSTART_DOCKER"], "false");
  assert.equal(
    dashboard.env["COMFYUI_ENV_DIR"],
    path.join(paths.dataRoot, "runtime", "comfyui-venv"),
  );
  assert.equal(
    dashboard.env["COMFYUI_RUNTIME_DIR"],
    path.join(paths.dataRoot, "runtime", "comfyui"),
  );
  assert.equal(dashboard.env["BREADBOARD_IFIXAI_MODE"], "off");
  for (const key of [
    "AGENT_BROWSER_HOME",
    "AGENT_REACH_ROOT",
    "AUDIO_ANALYZER_BIN_DIR",
    "DEEP_TUTOR_HOME_ROOT",
    "DEER_FLOW_STATE_DIR",
    "HF_HOME",
    "LEGAL_AGENT_STATE_DIR",
    "MONEY_PRINTER_CREDENTIALS_FILE",
    "PAPER_TRADER_DATABASE_PATH",
    "PENECHO_STATE_DIR",
    "RESOURCE2SKILL_VENV",
    "SF3D_VENV",
    "STOCK_ANALYST_CREDENTIALS_FILE",
    "TRADINGAGENTS_CREDENTIALS_FILE",
    "VIBE_TRADING_CREDENTIALS_FILE",
    "VOICEBOX_STATUS_PATH",
  ]) {
    const candidate = dashboard.env[key];
    if (!candidate) throw new Error(`${key} should be configured`);
    assert.ok(path.isAbsolute(candidate), `${key} should be absolute`);
    const relative = path.relative(paths.dataRoot, candidate);
    assert.ok(
      relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative),
      `${key} should stay below the disposable data root`,
    );
  }
  assert.equal(hermes.env["HERMES_QA_ISOLATED"], "1");
  assert.equal(
    hermes.env["HERMES_MANAGED_DIR"],
    path.join(paths.dataRoot, "runtime", "hermes-managed"),
  );
  assert.equal(
    hermes.env["HERMES_DASHBOARD_FILES_ROOT"],
    path.join(paths.dataRoot, "runtime", "hermes-files"),
  );
  assert.equal(hermes.env["HERMES_DISABLE_LAZY_INSTALLS"], "1");
  assert.equal(dashboard.env["BREADBOARD_DATA_DIR"], paths.dataRoot);
  assert.equal(dashboard.env["BREADBOARD_DEVELOPMENT_DASHBOARD_DIR"], "");
  assert.equal(dashboard.env["BREADBOARD_QA_MODE"], "1");
  assert.equal(dashboard.env["NEXT_TELEMETRY_DISABLED"], "1");
  assert.equal(dashboard.env["PYTHONDONTWRITEBYTECODE"], "1");
  assert.equal(dashboard.env["BREADBOARD_TELEGRAM_ENABLED"], "false");
  assert.equal(dashboard.env["BREADBOARD_WHATSAPP_ENABLED"], "false");
  assert.equal(dashboard.startupTimeoutMs, 300_000);
  assert.equal(dashboard.healthCheck?.type, "http");
  if (dashboard.healthCheck?.type === "http") {
    assert.equal(dashboard.healthCheck.timeoutMs, 15_000);
  }
});

test("non-QA definitions are returned unchanged", () => {
  const definitions = [definition("dashboard")];
  const result = prepareQaServiceDefinitions(
    definitions,
    { qaMode: false } as ResolvedPaths,
    "critical",
  );
  assert.equal(result, definitions);
});
