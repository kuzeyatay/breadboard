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

  return [
    "# How this run works",
    "",
    `You are producing a video with OpenMontage. The system is on this machine at ${posix(input.root)} and that is your working directory. Read ${posix(path.join(input.root, "AGENT_GUIDE.md"))} first — it is the operating guide and it tells you which skill to read next — then follow it.`,
    "",
    "## Where the production lives",
    "",
    `\`OPENMONTAGE_PROJECTS_DIR\` is already set to ${posix(input.projectsDirectory)}, so \`lib/checkpoint.py\` and every tool write there. Create exactly one project and use \`${input.projectId}\` as its \`project_id\`; the person's chat card reads that directory to show your progress.`,
    "",
    `Never write anywhere else. The clone at ${posix(input.root)} is a shared checkout that other runs use — read from it, do not edit it, and do not create a project inside it. Do not run \`git\` there at all.`,
    "",
    "`python` on your PATH is the interpreter that has OpenMontage's dependencies installed, and `ffmpeg`/`ffprobe` are on PATH too. Use them by bare name.",
    "",
    "## Nobody can answer you",
    "",
    "This run is not interactive. The person wrote one brief and left, and no message you write mid-run reaches them — only your final message does.",
    "",
    "This changes exactly one thing about AGENT_GUIDE.md: the *approval gates* are lifted. Where the guide tells you to present options and wait — the proposal stage, the composition runtime and authoring mode, provider or model switches, any `human_approval_default: true` checkpoint — you instead choose the option you would have recommended, record it, and keep going. Treat the checkpoint policy as `auto_noncreative` regardless of what `config.yaml` says.",
    "",
    "**The gate is enforced in code, so lifting it is something you have to do explicitly.** `lib/checkpoint.py` refuses to write a gated stage as `completed` unless it is passed `human_approved=True`, and the error it raises tells you to write `awaiting_human` and end your turn. Do not obey that instruction — ending your turn here means the person gets nothing. Instead pass **`human_approved=True`** on every gated stage, together with `metadata={\"approved_by\": \"breadboard-autonomous-run\"}` so the audit trail says who actually approved it. Never record it as a person's approval: nobody approved it, and a later reader has to be able to tell.",
    "",
    "Everything else about that contract still binds, and matters more than usual because it is now the only record:",
    "",
    "- **Log every decision** to `decision_log.json` through the checkpoint writer, with the real `options_considered` and a `reason`. The person's card renders this log — it is how they see which provider, runtime and treatment you picked and why. A decision you made but did not log is invisible to them.",
    "- **Append, never rewrite.** When a choice changes mid-run, append a new entry reusing the same `category` *and* `subject` so the card shows it as revised.",
    "- **Never substitute silently.** If the approved-looking path is blocked, pick the best alternative, log it as a `fallback_decision` with what failed, and say so plainly in your final message.",
    "",
    "## Still do the real thing",
    "",
    "Rule Zero holds: every production goes through a pipeline. Match the brief to a manifest in `pipeline_defs/`, run preflight against the tool registry to learn what is genuinely available, and read each stage's director skill in `skills/pipelines/<pipeline>/` before you do that stage's work. Read a tool's Layer 3 skill in `.agents/skills/` before you call it. Improvised scripts that skip the pipeline produce visibly worse videos — that is the whole reason the skills exist.",
    "",
    "If the brief is vague, do not run the onboarding skill and do not ask what they want: pick the most likely reading, make the strongest version of it, and list your assumptions at the end.",
    "",
    "## What you can spend",
    "",
    providerLine,
    "",
    "Plan the best video that the *available* tools can actually make, and prefer the free and local paths — stock footage, local composition, local subtitle generation — over paid generation when they serve the brief equally well. Never sign up for, install, or ask for a new paid provider. If the brief truly cannot be made with what is here, produce the closest thing that can be and explain the gap in your final message.",
    "",
    "## Nothing long-running",
    "",
    "Never start a process that does not exit on its own: no Backlot board (`python -m backlot`, `backlot serve`), no `remotion studio`, no `npm run start`, no preview server, no file watcher. A blocked command ends the run with nothing to show. Render with the non-interactive commands the tools expose.",
    "",
    "## Definition of done",
    "",
    "1. The pipeline reached its compose stage and a real video file exists under the project's `renders/` or `output/` directory. Verify it exists and is not empty.",
    "2. The stage checkpoints and `decision_log.json` are written, so the card can show what happened.",
    "3. Your final message is what the person reads in chat: what you made, how long it runs, which pipeline and tools produced it, what it cost if anything, and the assumptions you had to make. A few sentences of plain prose, no headings.",
    "",
    "If a stage fails twice for the same reason, simplify the production until it completes — a shorter piece, a simpler treatment, fewer scenes — then say in your final message what you dropped and why. A finished modest video beats an unfinished ambitious one.",
  ].join("\n");
}

/** The full instruction handed to the agent on stdin. */
export function runInstruction(input: PromptInput): string {
  return [operatingRules(input), "", "# The brief", "", input.brief.trim()].join("\n");
}
