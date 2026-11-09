import { renderSystemPrompt } from "../system-prompts/service.ts";
// What Breadboard tells the coding agent before it starts making a video.
//
// The production knowledge is NOT reimplemented here. OpenMontage ships
// `AGENT_GUIDE.md`, 13 pipeline manifests and a library of stage-director and
// meta skills that already teach the state machine, the review protocol and the
// tool contract; the clone is on disk, so this prompt points at those files and
// lets the agent read them. Upgrading the clone therefore upgrades the agent.
//
// What this prompt owns is everything the guide cannot know, and one thing it
// gets wrong here. OpenMontage is written for a person sitting in a terminal:
// its Decision Communication Contract says "wait for explicit user approval"
// before every consequential choice, and its checkpoint policy stops at each
// stage for a human. In a Breadboard run the person wrote one brief and left.
// So the approval *gates* are lifted while the approval *record* is kept — the
// agent still logs every decision to `decision_log.json`, which is what the run
// card reads, and still lists its assumptions in the answer. Nothing is
// silently chosen; it is just not blocked on.

import path from "node:path";
import { externalRuntimeReadUtf8 } from "../external-runtime-filesystem.ts";
import { resolveOpenMontageRoot } from "./runtime.ts";

/** Provider keys that unlock paid generation, read from the clone's `.env`. */
const PROVIDER_KEYS = [
  "FAL_KEY",
  "FAL_AI_API_KEY",
  "REPLICATE_API_TOKEN",
  "HIGGSFIELD_API_KEY",
  "KLING_API_KEY",
  "GOOGLE_API_KEY",
  "GEMINI_API_KEY",
  "ELEVENLABS_API_KEY",
  "OPENAI_API_KEY",
  "XAI_API_KEY",
  "DASHSCOPE_API_KEY",
  "SUNO_API_KEY",
  "HEYGEN_API_KEY",
  "RUNWAY_API_KEY",
  "PEXELS_API_KEY",
  "PIXABAY_API_KEY",
  "UNSPLASH_ACCESS_KEY",
  "AZURE_SPEECH_KEY",
] as const;

/**
 * Which provider keys the clone's `.env` actually sets.
 *
 * The agent runs its own preflight against the tool registry, which is the
 * authority — but knowing up front that there is no video-generation key stops
 * it planning a Veo shoot it cannot execute and then re-planning from scratch.
 */
export function configuredProviders(env: NodeJS.ProcessEnv = process.env): string[] {
  const root = resolveOpenMontageRoot(env);
  const found = new Set<string>();
  for (const key of PROVIDER_KEYS) {
    if ((env[key] ?? "").trim()) found.add(key);
  }
  if (root) {
    try {
      const raw = externalRuntimeReadUtf8(path.join(root, ".env"));
      for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const [name, ...rest] = trimmed.split("=");
        const value = rest.join("=").trim().replace(/^['"]|['"]$/g, "");
        if (value && (PROVIDER_KEYS as readonly string[]).includes(name.trim())) {
          found.add(name.trim());
        }
      }
    } catch {
      // No .env is the common case — the keyless paths still make a video.
    }
  }
  return [...found].sort();
}

function posix(value: string): string {
  return value.split(path.sep).join("/");
}

export interface PromptInput {
  userId?: number | null;
  brief: string;
  root: string;
  projectsDirectory: string;
  /** A stable, filesystem-safe project id, so the run and its files line up. */
  projectId: string;
  env?: NodeJS.ProcessEnv;
}

/** The operating rules, prepended to the agent's task. */
export function operatingRules(input: Omit<PromptInput, "brief">): string {
  const env = input.env ?? process.env;
  const providers = configuredProviders(env);
  const providerLine = providers.length
    ? `Provider keys present on this machine: ${providers.join(", ")}. Anything not in that list is unavailable no matter what a skill suggests.`
    : "No paid provider keys are set on this machine. Generation tools for video, images and cloud TTS will report themselves unavailable — that is expected, not a fault to debug.";

  return renderSystemPrompt("openmontage-operating-rules", input.userId, { "context_1": String(posix(input.root)), "context_2": String(posix(path.join(input.root, "AGENT_GUIDE.md"))), "context_3": String(posix(input.projectsDirectory)), "context_4": String(input.projectId), "context_5": String(posix(path.join(input.root, "remotion-composer", "projects", input.projectId))), "context_6": String(providerLine) });
}

/** The full instruction handed to the agent on stdin. */
export function runInstruction(input: PromptInput): string {
  return [operatingRules(input), "", "# The brief", "", input.brief.trim()].join("\n");
}
