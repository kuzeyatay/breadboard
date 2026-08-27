// The configuration Breadboard writes for the OpenScience runtime.
//
// Three decisions are encoded here, each of which took a failing run to find.
//
// 1. The provider package is `@ai-sdk/openai`, NOT `@ai-sdk/openai-compatible`.
//    ChatMock's native protocol is the Responses API; `/v1/chat/completions` is
//    a translation on top of it that reports `finish_reason: "stop"` on a
//    response that carried tool calls. The agent loop reads that as "the model
//    is done" and ends the turn after a single tool call — the agent announces
//    what it is about to do, writes one file, and stops. Pointed at
//    `/v1/responses` the same task runs the full multi-step loop.
//
// 2. Every model must declare `tool_call: true`. A custom provider gets no
//    models.dev metadata, and `session/llm.ts` sends NO tools at all when the
//    capability is absent — the run then reads as a model that refuses to work
//    rather than one that was never given anything to work with.
//
// 3. The execution sandbox is disabled. It is macOS Seatbelt / Linux
//    bubblewrap only; on Windows there is no backend, and the default
//    `onUnavailable: "error"` denies every shell, kernel and job capability, so
//    the agent can write a script but never run it. Sandbox policy is read from
//    the GLOBAL config only (a project's own file is deliberately ignored), so
//    this file — which Breadboard owns — is the only place it can be set.

import { externalRuntimePath as path } from "../external-runtime-path.ts";
import { randomUUID } from "node:crypto";
import { externalRuntimeFilesystem as fs } from "../external-runtime-filesystem.ts";
import { configRoot } from "./state-paths.ts";
import { DEFAULT_MODEL_ID, PROVIDER_ID } from "./contract.ts";
export { DEFAULT_MODEL_ID, PROVIDER_ID } from "./contract.ts";

const REASONING_VARIANTS = ["none", "low", "medium", "high", "xhigh", "max"] as const;

export interface ConfigShape {
  baseUrl: string;
  apiKey: string;
  /** Model ids to declare, so switching between them never rewrites the file. */
  models: readonly string[];
}

function modelEntry(id: string): Record<string, unknown> {
  return {
    name: id === DEFAULT_MODEL_ID ? "Background model (Settings → Accounts)" : id,
    // Without this the runtime sends no tools whatsoever.
    tool_call: true,
    reasoning: true,
    attachment: true,
    modalities: { input: ["text", "image"], output: ["text"] },
    variants: Object.fromEntries(
      REASONING_VARIANTS.map((effort) => [effort, { reasoningEffort: effort }]),
    ),
  };
}

export function buildConfig(shape: ConfigShape): Record<string, unknown> {
  const ids = Array.from(new Set([DEFAULT_MODEL_ID, ...shape.models])).filter(Boolean);
  return {
    $schema: "https://syntheticsciences.ai/config.json",
    model: `${PROVIDER_ID}/${DEFAULT_MODEL_ID}`,
    // No backend exists on Windows and the runtime is already confined to the
    // Breadboard-owned workspace by its own filesystem grants.
    sandbox: { enabled: false, onUnavailable: "allow" },
    // A headless run has nobody to answer a question, and the runtime waits
    // forever when one is asked. Sessions deny it too; this is the outer guard.
    permission: { question: "deny" },
    autoupdate: false,
    provider: {
      [PROVIDER_ID]: {
        npm: "@ai-sdk/openai",
        name: "ChatMock (Breadboard)",
        options: { baseURL: shape.baseUrl, apiKey: shape.apiKey },
        models: Object.fromEntries(ids.map((id) => [id, modelEntry(id)])),
      },
    },
  };
}

function configFile(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(configRoot(env), "openscience.json");
}

/** The config as it currently stands on disk, or null when unwritten. */
export function readConfig(env: NodeJS.ProcessEnv = process.env): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(configFile(env), "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** The model ids the written config already declares. */
export function declaredModels(env: NodeJS.ProcessEnv = process.env): string[] {
  const current = readConfig(env);
  const provider = (current?.provider as Record<string, unknown> | undefined)?.[PROVIDER_ID];
  const models = (provider as Record<string, unknown> | undefined)?.models;
  return models && typeof models === "object" ? Object.keys(models as object) : [];
}

/**
 * Write the runtime's configuration, returning whether the file changed. A
 * caller uses that to decide whether a running server has to be restarted —
 * the config is read once at boot.
 */
export function writeConfig(shape: ConfigShape, env: NodeJS.ProcessEnv = process.env): boolean {
  const next = buildConfig(shape);
  const serialized = `${JSON.stringify(next, null, 2)}\n`;
  const target = configFile(env);
  let previous = "";
  try {
    previous = fs.readFileSync(target, "utf8");
  } catch {
    // Nothing written yet.
  }
  if (previous === serialized) return false;
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = path.join(
    path.dirname(target),
    `.${path.basename(target)}.${process.pid}.${randomUUID()}.tmp`,
  );
  try {
    fs.writeFileSync(temporary, serialized, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    fs.renameSync(temporary, target);
  } finally {
    try {
      fs.unlinkSync(temporary);
    } catch (error) {
      if (
        !error ||
        typeof error !== "object" ||
        !("code" in error) ||
        (error as { code?: unknown }).code !== "ENOENT"
      ) {
        throw error;
      }
    }
  }
  return true;
}
