#!/usr/bin/env node

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const MAX_CONFIG_BYTES = 256 * 1024;
const MAX_ENVIRONMENT_VALUE_BYTES = 16 * 1024;

const VIBE_ENVIRONMENT = new Set([
  "LANGCHAIN_PROVIDER",
  "LANGCHAIN_MODEL_NAME",
  "LANGCHAIN_REASONING_EFFORT",
  "OPENAI_BASE_URL",
  "OPENAI_API_BASE",
  "OPENAI_API_KEY",
  "ENABLE_SESSION_RUNTIME",
  "VIBE_TRADING_ENABLE_SHELL_TOOLS",
  "LANGCHAIN_TEMPERATURE",
  "VT_MEMORY",
  "VIBE_TRADING_DATA_CACHE",
  "CCXT_EXCHANGE",
  "TUSHARE_TOKEN",
  "FINNHUB_API_KEY",
  "ALPHAVANTAGE_API_KEY",
  "FRED_API_KEY",
]);

const STOCK_ENVIRONMENT = new Set([
  "LITELLM_MODEL",
  "OPENAI_BASE_URL",
  "OPENAI_API_KEY",
  "GENERATION_BACKEND",
  "GENERATION_FALLBACK_BACKEND",
  "AGENT_BACKEND",
  "AGENT_GENERATION_BACKEND",
  "DSA_RUNTIME_SCHEDULER_SUPPRESS_START",
  "SCHEDULE_ENABLED",
  "RUN_IMMEDIATELY",
  "SCHEDULE_RUN_IMMEDIATELY",
  "WEBUI_AUTO_BUILD",
  "ADMIN_AUTH_ENABLED",
  "AGENT_ARCH",
  "AGENT_ORCHESTRATOR_MODE",
  "REPORT_LANGUAGE",
  "LLM_TEMPERATURE",
  "AGENT_MEMORY_ENABLED",
  "AGENT_SKILL_ROUTING",
  "AGENT_SKILLS",
  "TUSHARE_TOKEN",
  "TICKFLOW_API_KEY",
  "ANSPIRE_API_KEYS",
  "SERPAPI_API_KEYS",
  "TAVILY_API_KEYS",
  "BRAVE_API_KEYS",
]);

function fail(message) {
  process.stderr.write(`[runtime-v2-managed-python-service] ${message}\n`);
  process.exit(1);
}

function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, names) {
  return record(value) &&
    Object.keys(value).length === names.length &&
    names.every((name) => Object.hasOwn(value, name));
}

function parseArguments(argv) {
  if (argv.length !== 4 || argv[0] !== "--service" || argv[2] !== "--port") {
    fail("expected --service <vibe-trading|stock-analyst> --port <allocated-port>");
  }
  const serviceId = argv[1];
  const port = Number.parseInt(argv[3], 10);
  if (!new Set(["vibe-trading", "stock-analyst"]).has(serviceId)) {
    fail("the service id is not in the closed launcher vocabulary");
  }
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535 || String(port) !== argv[3]) {
    fail("the service port is invalid");
  }
  return { serviceId, port };
}

function requiredAbsolutePath(name) {
  const value = process.env[name]?.trim() ?? "";
  if (!value || !path.isAbsolute(value) || value.includes("\0")) {
    fail(`${name} is not a sealed absolute path`);
  }
  return path.resolve(value);
}

function samePath(left, right) {
  const normalize = (value) => process.platform === "win32"
    ? path.resolve(value).toLowerCase()
    : path.resolve(value);
  return normalize(left) === normalize(right);
}

function readConfiguration(serviceId) {
  const dataRoot = requiredAbsolutePath("BREADBOARD_DATA_DIR");
  const configuredPath = requiredAbsolutePath("BREADBOARD_MANAGED_PYTHON_SERVICE_CONFIG");
  const expectedPath = path.join(dataRoot, "runtime", serviceId, "service-config.json");
  if (!samePath(configuredPath, expectedPath)) fail("the launch configuration escaped its fixed data path");
  const stat = fs.lstatSync(configuredPath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > MAX_CONFIG_BYTES) {
    fail("the launch configuration is not a bounded direct regular file");
  }
  const value = JSON.parse(fs.readFileSync(configuredPath, "utf8"));
  if (!record(value) || value.schemaVersion !== 1 || value.serviceId !== serviceId) {
    fail("the launch configuration identity is invalid");
  }
  return { dataRoot, value };
}

function validateEnvironment(value, allowed) {
  if (!record(value) || Object.keys(value).length > allowed.size) {
    fail("the launch environment is invalid");
  }
  const result = {};
  for (const [name, entry] of Object.entries(value)) {
    if (!allowed.has(name) || typeof entry !== "string") {
      fail("the launch environment contains an unapproved field");
    }
    const bytes = Buffer.byteLength(entry, "utf8");
    if (bytes > MAX_ENVIRONMENT_VALUE_BYTES || /[\u0000-\u001f\u007f]/u.test(entry)) {
      fail(`the ${name} launch value is invalid`);
    }
    result[name] = entry;
  }
  return result;
}

function baseChildEnvironment() {
  const result = {};
  for (const name of [
    "SystemRoot",
    "PATH",
    "TEMP",
    "TMP",
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
    "PROGRAMDATA",
    "SystemDrive",
    "PROGRAMFILES",
    "PROGRAMFILES(X86)",
    "ComSpec",
    "PATHEXT",
  ]) {
    if (typeof process.env[name] === "string") result[name] = process.env[name];
  }
  result.PYTHONUNBUFFERED = "1";
  result.PYTHONDONTWRITEBYTECODE = "1";
  return result;
}

function writePrivateFile(target, contents) {
  const bytes = Buffer.from(contents, "utf8");
  if (bytes.length > 64 * 1024 || bytes.includes(0)) fail("the generated environment file is invalid");
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporary, bytes, { flag: "wx", mode: 0o600 });
    fs.renameSync(temporary, target);
  } finally {
    try { fs.unlinkSync(temporary); } catch (error) {
      if (!error || typeof error !== "object" || error.code !== "ENOENT") throw error;
    }
  }
}

function launchShape(serviceId, port, configuration, dataRoot) {
  const python = requiredAbsolutePath("BREADBOARD_MANAGED_PYTHON_EXECUTABLE");
  const sourceRoot = requiredAbsolutePath("BREADBOARD_MANAGED_PYTHON_SOURCE_ROOT");
  const configuredId = process.env.BREADBOARD_MANAGED_PYTHON_SERVICE_ID;
  const configuredPort = process.env.BREADBOARD_MANAGED_PYTHON_SERVICE_PORT;
  if (configuredId !== serviceId || configuredPort !== String(port)) {
    fail("the sealed launch identity does not match the manifest argv");
  }
  for (const candidate of [python, sourceRoot]) {
    const stat = fs.lstatSync(candidate);
    if ((candidate === python && !stat.isFile()) || (candidate === sourceRoot && !stat.isDirectory()) || stat.isSymbolicLink()) {
      fail("a sealed launch path is unavailable or indirect");
    }
  }
  const common = baseChildEnvironment();
  if (serviceId === "vibe-trading") {
    if (!exactKeys(configuration, [
      "schemaVersion",
      "serviceId",
      "environment",
      "bindHost",
      "serviceAuthentication",
    ]) || configuration.bindHost !== "127.0.0.1" ||
      configuration.serviceAuthentication !== "runtime-injected") {
      fail("the Vibe Trading launch shape is invalid");
    }
    const apiKey = process.env.VIBE_TRADING_SERVICE_API_KEY ?? "";
    if (apiKey.length < 32 || apiKey.length > 1024 || !/^[\x21-\x7e]+$/u.test(apiKey)) {
      fail("the Vibe Trading service key is invalid");
    }
    const home = requiredAbsolutePath("VIBE_TRADING_HOME");
    const expectedHome = path.join(dataRoot, "runtime", "vibe-trading", "home");
    if (!samePath(home, expectedHome)) fail("the Vibe Trading home escaped its fixed data path");
    fs.mkdirSync(home, { recursive: true, mode: 0o700 });
    return {
      python,
      cwd: sourceRoot,
      args: [
        "-c",
        "import sys; from api_server import serve_main; raise SystemExit(serve_main(sys.argv[1:]))",
        "--host",
        "127.0.0.1",
        "--port",
        String(port),
      ],
      env: {
        ...common,
        ...validateEnvironment(configuration.environment, VIBE_ENVIRONMENT),
        API_AUTH_KEY: apiKey,
        VIBE_TRADING_HOME: home,
      },
    };
  }

  if (!exactKeys(configuration, [
    "schemaVersion",
    "serviceId",
    "environment",
    "envFileContents",
    "stateLayout",
    "bindHost",
  ]) || configuration.bindHost !== "127.0.0.1" ||
    !exactKeys(configuration.stateLayout, ["database", "logs"]) ||
    configuration.stateLayout.database !== "data/stock_analysis.db" ||
    configuration.stateLayout.logs !== "logs" ||
    typeof configuration.envFileContents !== "string") {
    fail("the Stock Analyst launch shape is invalid");
  }
  const home = requiredAbsolutePath("STOCK_ANALYST_HOME");
  const expectedHome = path.join(dataRoot, "runtime", "stock-analyst", "home");
  if (!samePath(home, expectedHome)) fail("the Stock Analyst home escaped its fixed data path");
  const data = path.join(home, "data");
  const logs = path.join(home, "logs");
  fs.mkdirSync(data, { recursive: true, mode: 0o700 });
  fs.mkdirSync(logs, { recursive: true, mode: 0o700 });
  const envFile = path.join(home, "breadboard.env");
  writePrivateFile(envFile, configuration.envFileContents);
  return {
    python,
    cwd: sourceRoot,
    args: [
      "-c",
      [
        "import os, sys, uvicorn",
        "from src.config import setup_env",
        "from src.logging_config import setup_logging",
        "setup_env()",
        "setup_logging(log_prefix='api_server', log_dir=os.environ['LOG_DIR'], extra_quiet_loggers=['uvicorn', 'fastapi'])",
        "uvicorn.run('api.app:app', host=sys.argv[1], port=int(sys.argv[2]), log_level='warning')",
      ].join("; "),
      "127.0.0.1",
      String(port),
    ],
    env: {
      ...common,
      ...validateEnvironment(configuration.environment, STOCK_ENVIRONMENT),
      ENV_FILE: envFile,
      DATABASE_PATH: path.join(data, "stock_analysis.db"),
      LOG_DIR: logs,
    },
  };
}

const { serviceId, port } = parseArguments(process.argv.slice(2));
let loaded;
try {
  loaded = readConfiguration(serviceId);
} catch (error) {
  fail(error instanceof Error ? error.message : "the launch configuration could not be read");
}
const shape = launchShape(serviceId, port, loaded.value, loaded.dataRoot);
const child = spawn(shape.python, shape.args, {
  cwd: shape.cwd,
  env: shape.env,
  stdio: ["ignore", "inherit", "inherit"],
  windowsHide: true,
});

let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  try { child.kill(); } catch {}
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
child.once("error", (error) => fail(`the managed Python child could not start: ${error.message}`));
child.once("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
