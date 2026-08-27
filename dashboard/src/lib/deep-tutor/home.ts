// The tutoring home: one DeepTutor workspace per learner, per material scope.
//
// DeepTutor keeps everything a lifelong tutor accumulates — sessions, the three
// memory layers, notebooks, generated files — under one directory tree chosen
// by `DEEPTUTOR_HOME`. Breadboard gives each (user, scope) pair its own, so the
// tutor that teaches you inside the Signals Garden remembers Signals, and the
// Terminal tutor remembers your workspace. One shared home would blend them,
// and a per-conversation home would forget you between chats.
//
// Everything under `settings/` is generated: the model catalog points DeepTutor
// at ChatMock, and `mcp.json` registers the scoped file server. Both are
// rewritten before every run because both depend on the request (which model
// the chat is on, which roots the surface allows). Anything DeepTutor itself
// writes into the home is left alone.

import { externalRuntimePath as path } from "../external-runtime-path.ts";
import yaml from "js-yaml";
import { EMBEDDING_DIMENSION, EMBEDDING_MODEL } from "../embeddings.ts";
import { externalRuntimeFilesystem as fs } from "../external-runtime-filesystem.ts";
import { repositoryRoot } from "../runtime-paths.ts";
import { fileServerScriptPath, nodeExecutable } from "./runtime.ts";
import type { TutorScope } from "./materials.ts";

/** Stable ids so a rewritten catalog never invalidates a running session. */
const LLM_PROFILE_ID = "llm-profile-breadboard-chatmock";
const LLM_MODEL_ID = "llm-model-breadboard-chatmock";
const EMBEDDING_PROFILE_ID = "embedding-profile-breadboard-chatmock";
const EMBEDDING_MODEL_ID = "embedding-model-breadboard-chatmock";
const FILE_SERVER_NAME = "breadboard-materials";

/**
 * The embedding model a knowledge base is built with, and its width.
 *
 * Re-exported rather than redeclared: the Garden retriever and the GBrain
 * sidecar embed with the same model, and two constants that must agree but live
 * in two files are the exact failure the fingerprint exists to catch. Changing
 * either value invalidates every index built with the old one, and a Garden
 * rebuilds when it does.
 */
export { EMBEDDING_DIMENSION, EMBEDDING_MODEL, embeddingFingerprint } from "../embeddings.ts";


export function deepTutorHomeRoot(): string {
  const configured = process.env.DEEP_TUTOR_HOME_ROOT?.trim();
  if (configured) return path.resolve(configured);
  return path.join(repositoryRoot(), ".runtime", "deep-tutor");
}

/** The home for one learner's tutoring in one scope. */
export function deepTutorHome(userId: number, scopeId: string): string {
  const safeScope = scopeId.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 80) || "scope";
  return path.join(deepTutorHomeRoot(), `u${userId}`, safeScope);
}

export interface ProvisionInput {
  userId: number;
  scope: TutorScope;
  /** ChatMock's OpenAI-compatible base URL, already resolved for the request. */
  baseUrl: string;
  /** The model the chat is on — the tutor answers on the same one. */
  model: string;
  reasoningEffort: string;
  apiKey: string;
  language: string;
}

export interface ProvisionedHome {
  home: string;
  settingsDirectory: string;
  /** False when the file server could not be registered; the tutor is blind. */
  materialsMounted: boolean;
}

/**
 * Create or refresh the home for this run and return where it is.
 *
 * Idempotent: the same (user, scope) always lands on the same directory, so a
 * second question continues the first one's session and memory.
 */
export function provisionHome(input: ProvisionInput): ProvisionedHome {
  const home = deepTutorHome(input.userId, input.scope.id);
  const settingsDirectory = path.join(home, "data", "user", "settings");
  fs.mkdirSync(settingsDirectory, { recursive: true });

  writeModelCatalog(settingsDirectory, input);
  writeEmbeddingCatalog(settingsDirectory, input);
  writeMainConfig(settingsDirectory);
  writeInterface(settingsDirectory, input.language);
  const materialsMounted = writeMcpConfig(settingsDirectory, input.scope);

  return { home, settingsDirectory, materialsMounted };
}

function readJson(file: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function writeJson(file: string, payload: unknown): void {
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, file);
}

/**
 * Point DeepTutor's LLM service at ChatMock.
 *
 * `custom` is upstream's own generic OpenAI-compatible binding — it accepts any
 * model id and adds nothing provider-specific to the request, which is exactly
 * what a local relay needs. Only the `llm` service is rewritten: a user who has
 * configured an embedding or search provider inside the home keeps it.
 */
function writeModelCatalog(settingsDirectory: string, input: ProvisionInput): void {
  const file = path.join(settingsDirectory, "model_catalog.json");
  const existing = readJson(file);
  const services =
    (existing.services as Record<string, unknown> | undefined) &&
    typeof existing.services === "object"
      ? { ...(existing.services as Record<string, unknown>) }
      : {};

  services.llm = {
    active_profile_id: LLM_PROFILE_ID,
    active_model_id: LLM_MODEL_ID,
    profiles: [
      {
        id: LLM_PROFILE_ID,
        name: "Breadboard (ChatMock)",
        binding: "custom",
        base_url: input.baseUrl.replace(/\/$/, ""),
        api_key: input.apiKey,
        api_version: "",
        extra_headers: {},
        models: [
          {
            id: LLM_MODEL_ID,
            name: input.model,
            model: input.model,
            ...(input.reasoningEffort ? { reasoning_effort: input.reasoningEffort } : {}),
          },
        ],
      },
    ],
  };

  writeJson(file, { ...existing, version: 1, services });
}

/**
 * Point DeepTutor's embedding service at ChatMock's local embedder.
 *
 * This is what makes knowledge bases possible at all: DeepTutor's RAG needs
 * vectors, and until ChatMock grew `/v1/embeddings` there was no provider
 * behind it that did not need a paid key.
 *
 * `custom` is the OpenAI-compatible binding, and its adapter posts to the
 * configured URL **verbatim** — no path is appended — so `base_url` here is the
 * whole endpoint rather than a base. That is upstream's documented contract
 * (`EmbeddingProviderSpec.default_api_base`), and getting it wrong produces a
 * 404 at index time rather than a config error.
 */
function writeEmbeddingCatalog(settingsDirectory: string, input: ProvisionInput): void {
  const file = path.join(settingsDirectory, "model_catalog.json");
  const existing = readJson(file);
  const services =
    existing.services && typeof existing.services === "object" && !Array.isArray(existing.services)
      ? { ...(existing.services as Record<string, unknown>) }
      : {};

  const endpoint = `${input.baseUrl.replace(/\/$/, "")}/embeddings`;
  services.embedding = {
    active_profile_id: EMBEDDING_PROFILE_ID,
    active_model_id: EMBEDDING_MODEL_ID,
    profiles: [
      {
        id: EMBEDDING_PROFILE_ID,
        name: "Breadboard (local)",
        binding: "custom",
        base_url: endpoint,
        api_key: input.apiKey,
        api_version: "",
        extra_headers: {},
        models: [
          {
            id: EMBEDDING_MODEL_ID,
            name: EMBEDDING_MODEL,
            model: EMBEDDING_MODEL,
            dimension: String(EMBEDDING_DIMENSION),
            supported_dimensions: String(EMBEDDING_DIMENSION),
          },
        ],
      },
    ],
  };

  writeJson(file, { ...existing, version: 1, services });
}

/**
 * Runtime knobs. Console logging is off because DeepTutor's console handler is
 * `StreamHandler(sys.stdout)` — the same stream the bridge writes NDJSON to.
 * Nothing is lost by silencing it: the reason a turn failed reaches Breadboard
 * as the bridge's own `failed` event, and a hard crash still puts its traceback
 * on stderr, which the run manager tails.
 */
function writeMainConfig(settingsDirectory: string): void {
  const file = path.join(settingsDirectory, "main.yaml");
  let existing: Record<string, unknown> = {};
  try {
    const parsed = yaml.load(fs.readFileSync(file, "utf8")) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      existing = parsed as Record<string, unknown>;
    }
  } catch {
    // A missing or unreadable file is simply regenerated.
  }
  const merged = {
    ...existing,
    logging: { level: "WARNING", save_to_file: true, console_output: false },
    tools: {
      ...((existing.tools as Record<string, unknown>) ?? {}),
      web_search: { enabled: true },
    },
  };
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, yaml.dump(merged, { lineWidth: 100 }), "utf8");
  fs.renameSync(temporary, file);
}

function writeInterface(settingsDirectory: string, language: string): void {
  const file = path.join(settingsDirectory, "interface.json");
  writeJson(file, { ...readJson(file), theme: "snow", language: language || "en" });
}

/**
 * Register Breadboard's read-only file server for this scope.
 *
 * Roots travel in the environment rather than the arguments so they never show
 * up in a process listing next to a learner's folder names. A scope with no
 * roots removes the server outright — an empty Garden should leave the tutor
 * with no file tools at all, not with tools that answer "nothing found" and
 * make it look like the material is empty when it is simply out of reach.
 */
function writeMcpConfig(settingsDirectory: string, scope: TutorScope): boolean {
  const file = path.join(settingsDirectory, "mcp.json");
  const existing = readJson(file);
  const servers =
    existing.servers && typeof existing.servers === "object" && !Array.isArray(existing.servers)
      ? { ...(existing.servers as Record<string, unknown>) }
      : {};

  const script = fileServerScriptPath();
  if (!script || !scope.roots.length) {
    delete servers[FILE_SERVER_NAME];
    writeJson(file, { ...existing, servers });
    return false;
  }

  servers[FILE_SERVER_NAME] = {
    type: "stdio",
    command: nodeExecutable(),
    args: [script],
    env: {
      BREADBOARD_TUTOR_ROOTS: scope.roots.join(path.delimiter),
      BREADBOARD_TUTOR_SCOPE_LABEL: scope.label,
      ELECTRON_RUN_AS_NODE: "1",
    },
    cwd: path.dirname(script),
    tool_timeout: 60,
    enabled_tools: ["*"],
    enabled: true,
  };
  writeJson(file, { ...existing, servers });
  return true;
}

/** Remove one scope's home — used when a learner resets the tutor's memory. */
export function clearHome(userId: number, scopeId: string): boolean {
  const home = deepTutorHome(userId, scopeId);
  if (!fs.existsSync(home)) return false;
  fs.rmSync(home, { recursive: true, force: true });
  return true;
}
