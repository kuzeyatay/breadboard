// The config.yaml the supervised DeerFlow Gateway is started with.
//
// It is written into Breadboard's own runtime directory and pointed at through
// `DEER_FLOW_CONFIG_PATH`, never into the clone. `deer-flow/config.yaml` is the
// file a user's own `make dev` reads and `make config` generates; overwriting it
// would silently take over their setup and leave their `git status` dirty.
//
// The file is rewritten before every run rather than once at boot, because most
// of it is hot: DeerFlow resolves `get_app_config()` per request and reloads it
// when the file's content signature changes, so models, tools, memory and
// subagent limits all take effect on the next message. `sandbox` is the
// exception — it is on the harness's startup-only list — which is why
// ./service.ts fingerprints exactly that part and restarts when it changes.
//
// The models block is generated from whatever ChatMock currently serves, so the
// chat's model picker and DeerFlow's own model allowlist cannot drift apart: a
// run naming a model the config does not declare is refused by the Gateway with
// a 422 before the agent ever starts.

import fs from "node:fs";
import path from "node:path";
import { stateRoot } from "./runtime.ts";
import type { DeerFlowSettings } from "./settings.ts";

export interface ConfigInput {
  /** ChatMock's OpenAI-compatible base URL, e.g. `http://127.0.0.1:8765/v1`. */
  baseUrl: string;
  apiKey: string;
  /** The model this run wants; always declared even if the model list failed. */
  model: string;
  settings: DeerFlowSettings;
}

export interface GeneratedConfig {
  configPath: string;
  extensionsPath: string;
  /** Where DeerFlow keeps threads, checkpoints, memory and outputs. */
  home: string;
  /** Only the parts DeerFlow reads once at boot. Compared to decide a restart. */
  startupFingerprint: string;
}

const MODEL_LIST_TIMEOUT_MS = 8_000;

/** A double-quoted YAML scalar. JSON's escaping is a subset of YAML's. */
function q(value: string): string {
  return JSON.stringify(value);
}

/**
 * Every model ChatMock currently serves, so the generated config declares all of
 * them and switching model in the chat does not need a new config at all. The
 * requested model is always included: a list that failed to load must not be the
 * reason a run cannot start.
 */
export async function declaredModels(input: ConfigInput): Promise<string[]> {
  const models = new Set<string>();
  if (input.model.trim()) models.add(input.model.trim());
  try {
    const response = await fetch(new URL("models", `${input.baseUrl.replace(/\/?$/, "/")}`), {
      headers: { authorization: `Bearer ${input.apiKey}` },
      signal: AbortSignal.timeout(MODEL_LIST_TIMEOUT_MS),
    });
    if (response.ok) {
      const body = (await response.json()) as { data?: { id?: unknown }[] };
      for (const entry of body.data ?? []) {
        if (typeof entry.id === "string" && entry.id.trim()) models.add(entry.id.trim());
      }
    }
  } catch {
    // ChatMock being unreachable is the run's problem to report, not config's.
  }
  return [...models];
}

/**
 * One model profile per ChatMock model.
 *
 * `supports_thinking` is deliberately absent: it exists to switch a provider's
 * own thinking parameter, and declaring it without a `when_thinking_enabled`
 * block makes DeerFlow send `reasoning_effort: minimal` on every non-thinking
 * turn. Reasoning effort is declared instead, which ChatMock reads straight off
 * the request body.
 */
function modelBlock(models: readonly string[], input: ConfigInput): string {
  return models
    .map((id) =>
      [
        `  - name: ${q(id)}`,
        `    display_name: ${q(id)}`,
        "    use: langchain_openai:ChatOpenAI",
        `    model: ${q(id)}`,
        `    api_base: ${q(input.baseUrl)}`,
        `    api_key: ${q(input.apiKey)}`,
        // A DeerFlow turn can be a long tool loop behind one model call, and the
        // relay is a local process rather than a rate-limited API.
        "    request_timeout: 900.0",
        "    max_retries: 2",
        "    context_window: 400000",
        "    supports_vision: true",
        "    supports_reasoning_effort: true",
      ].join("\n"),
    )
    .join("\n");
}

/**
 * The tools a run is offered. This is the clone's own default set, minus the
 * web group when the agent's settings turn it off — the harness filters the
 * bash tool by itself whenever host bash is not allowed, so that one is always
 * declared and `sandbox.allow_host_bash` decides.
 */
function toolsBlock(settings: DeerFlowSettings): string {
  const web = [
    "  - name: web_search",
    "    group: web",
    "    use: deerflow.community.ddg_search.tools:web_search_tool",
    "    max_results: 5",
    "  - name: web_fetch",
    "    group: web",
    "    use: deerflow.community.jina_ai.tools:web_fetch_tool",
    "    timeout: 10",
    "  - name: image_search",
    "    group: web",
    "    use: deerflow.community.image_search.tools:image_search_tool",
    "    max_results: 5",
  ];
  const files = [
    "  - name: ls",
    "    group: file:read",
    "    use: deerflow.sandbox.tools:ls_tool",
    "  - name: read_file",
    "    group: file:read",
    "    use: deerflow.sandbox.tools:read_file_tool",
    "  - name: glob",
    "    group: file:read",
    "    use: deerflow.sandbox.tools:glob_tool",
    "    max_results: 200",
    "  - name: grep",
    "    group: file:read",
    "    use: deerflow.sandbox.tools:grep_tool",
    "    max_results: 100",
    "  - name: write_file",
    "    group: file:write",
    "    use: deerflow.sandbox.tools:write_file_tool",
    "  - name: str_replace",
    "    group: file:write",
    "    use: deerflow.sandbox.tools:str_replace_tool",
    "  - name: bash",
    "    group: bash",
    "    use: deerflow.sandbox.tools:bash_tool",
  ];
  return [...(settings.web ? web : []), ...files].join("\n");
}

/** The parts DeerFlow reads once at boot, as one comparable string. */
function startupFingerprint(input: ConfigInput, home: string): string {
  return [`home=${home}`, `shell=${input.settings.shell ? "1" : "0"}`].join("|");
}

function render(models: readonly string[], input: ConfigInput, home: string): string {
  const settings = input.settings;
  return `# Generated by Breadboard for /agents:deer-flow. Rewritten before every
# run — edit the agent's settings, not this file. The clone's own
# deer-flow/config.yaml is untouched and still governs \`make dev\`.
config_version: 33
log_level: info

models:
${modelBlock(models, input)}

tool_groups:
  - name: web
  - name: file:read
  - name: file:write
  - name: bash

tools:
${toolsBlock(settings)}

sandbox:
  use: deerflow.sandbox.local:LocalSandboxProvider
  # Startup-only. See ./service.ts: changing this restarts the Gateway.
  allow_host_bash: ${settings.shell ? "true" : "false"}
  bash_output_max_chars: 20000
  read_file_output_max_chars: 50000
  ls_output_max_chars: 20000
  bash_command_timeout: 600

skills:
  container_path: /mnt/skills

title:
  # A local heuristic rather than a model call: Breadboard titles the chat, and
  # a second model streaming into the same run would land in the answer.
  enabled: true
  model_name: null

summarization:
  enabled: true
  model_name: null
  trigger:
    - type: tokens
      value: 32000
  keep:
    type: messages
    value: 10

memory:
  enabled: ${settings.memory ? "true" : "false"}
  injection_enabled: ${settings.memory ? "true" : "false"}
  mode: middleware
  manager_class: deermem

subagents:
  enabled: ${settings.subagents ? "true" : "false"}
  max_total_per_run: ${settings.maxSubagents}

tool_output:
  enabled: true

loop_detection:
  enabled: true

read_before_write:
  enabled: true

# Nothing here is reachable from Breadboard, and each one would otherwise open a
# surface this integration does not supervise.
agents_api:
  enabled: false
scheduler:
  enabled: false
authorization:
  enabled: false
skill_evolution:
  enabled: false

database:
  backend: sqlite
  sqlite_dir: ${q(path.join(home, "data"))}

run_events:
  backend: memory
`;
}

/**
 * Write the config for this run and report where it landed. Also writes an
 * empty extensions config: `DEER_FLOW_EXTENSIONS_CONFIG_PATH` is an explicit
 * assertion that one file must be used, and DeerFlow raises rather than falls
 * back when it is missing.
 */
export async function writeConfig(input: ConfigInput): Promise<GeneratedConfig> {
  const root = stateRoot();
  const home = path.join(root, "home");
  fs.mkdirSync(path.join(home, "data"), { recursive: true });

  const configPath = path.join(root, "config.yaml");
  const extensionsPath = path.join(root, "extensions_config.json");
  const models = await declaredModels(input);
  fs.writeFileSync(configPath, render(models, input, home), "utf8");
  if (!fs.existsSync(extensionsPath)) {
    fs.writeFileSync(extensionsPath, `${JSON.stringify({ mcpServers: {}, skills: {} }, null, 2)}\n`, "utf8");
  }

  return {
    configPath,
    extensionsPath,
    home,
    startupFingerprint: startupFingerprint(input, home),
  };
}
