import { renderSystemPrompt } from "../system-prompts/service.ts";
// The system prompt for a Career Ops run.
//
// The job-search knowledge is NOT restated here. It is read from the clone's own
// skill and mode files, so upgrading career-ops upgrades what Breadboard knows
// with no code change — the same contract Agent Reach uses. What this module
// adds is the part only Breadboard can know: which tools this sandbox offers,
// what the workspace's setup state is right now, and the reporting contract for
// the chat transcript.

import { externalRuntimeReadUtf8 } from "../external-runtime-filesystem.ts";
import { resolveExistingInsideRoot } from "./commands.ts";
import type { CareerOpsMode } from "./identity.ts";
import type { CareerOpsHealth } from "./runtime.ts";

/** A mode file bigger than this is read on demand rather than preloaded. */
export const PRELOADED_MODE_MAX_CHARS = 20_000;

function readIfPresent(root: string, relative: string): string {
  const file = resolveExistingInsideRoot(relative, root, "file");
  if (!file) return "";
  try {
    return externalRuntimeReadUtf8(file.absolute);
  } catch {
    return "";
  }
}

function modeRelativePath(mode: string): string | null {
  const segments = mode
    .trim()
    .toLowerCase()
    .split("/")
    .filter(Boolean);
  if (!segments.length || segments.length > 2) return null;
  if (segments.some((segment) => !/^[a-z0-9][a-z0-9-]*$/.test(segment))) return null;
  return ["modes", ...segments.slice(0, -1), `${segments.at(-1)}.md`].join("/");
}

/**
 * Resolve a router mode to its file. The routing table writes nested modes with
 * a slash (`interview/plan`); on disk that is a directory. Anything that is not
 * a plain mode name is refused rather than joined, so no mode argument can walk
 * out of `modes/`.
 */
export function modeFilePath(root: string, mode: string): string | null {
  const relative = modeRelativePath(mode);
  if (!relative) return null;
  return resolveExistingInsideRoot(relative, root, "file")?.absolute ?? null;
}

export function readMode(root: string, mode: string): string | null {
  const relative = modeRelativePath(mode);
  if (!relative || !modeFilePath(root, mode)) return null;
  return readIfPresent(root, relative);
}

function setupSection(health: CareerOpsHealth): string {
  const lines: string[] = [];
  const onboarding = health.onboarding;
  if (onboarding?.onboardingNeeded) {
    lines.push(
      `The candidate layer is incomplete. Missing: ${onboarding.missing.join(", ")}.`,
      "Without those files you cannot evaluate fit, tailor a CV, or write anything in the candidate's voice — every claim would be invented, which this system forbids.",
      "If the task needs them, say exactly which file is missing and what it should contain, and offer to build it from what the user tells you (write_file can create them). Modes that need no candidate layer — scan, discover, tracker, titles — still work.",
    );
  } else if (onboarding) {
    lines.push("The candidate layer (cv.md, config/profile.yml, modes/_profile.md) is in place.");
  }
  if (!health.browsersInstalled) {
    lines.push(
      "Playwright has no browser installed, so portal scanning and live URL extraction will fail. Ask the user to install it from the Agents tab; work from pasted job-description text meanwhile.",
    );
  }
  if (health.trackedApplications !== null) {
    lines.push(
      `data/applications.md currently holds ${health.trackedApplications} tracked application${health.trackedApplications === 1 ? "" : "s"}.`,
    );
  } else {
    lines.push("There is no tracker yet; the first evaluation creates data/applications.md.");
  }
  for (const warning of onboarding?.warnings ?? []) {
    lines.push(warning.split(/\r?\n/)[0]);
  }
  return lines.join("\n");
}

export interface PromptInput {
  userId?: number | null;
  root: string;
  health: CareerOpsHealth;
  /** The mode parsed out of the request, when the user named one. */
  mode: CareerOpsMode | null;
  scripts: string[];
}

export interface BuiltPrompt {
  prompt: string;
  /** The mode whose instructions were included, if any. */
  preloadedMode: string | null;
}

export function buildSystemPrompt(input: PromptInput): BuiltPrompt {
  const skill = readIfPresent(input.root, ".agents/skills/career-ops/SKILL.md");
  const shared = readIfPresent(input.root, "modes/_shared.md");
  // The user layer, which _shared.md says must be read after it and which
  // overrides its defaults. Small files, and the run is worthless without them.
  const userLayer = ["_profile.md", "_custom.md", "_brief.md"]
    .map((name) => {
      const body = readIfPresent(input.root, `modes/${name}`);
      return body ? `\n### modes/${name}\n${body}` : "";
    })
    .filter(Boolean)
    .join("\n");

  let preloadedMode: string | null = null;
  let modeSection = "";
  if (input.mode) {
    const body = readMode(input.root, input.mode);
    if (body && body.length <= PRELOADED_MODE_MAX_CHARS) {
      preloadedMode = input.mode;
      modeSection = `\n## Mode instructions: ${input.mode} (modes/${input.mode}.md)\n${body}`;
    }
  }

  const modeDirective = preloadedMode
    ? `The user asked for the \`${preloadedMode}\` mode and its instructions are included below. Follow them.`
    : input.mode
      ? `The user asked for the \`${input.mode}\` mode. Your first tool call is \`read_mode\` for it — the instructions are too long to include here.`
      : "Route the request yourself using the table in the skill below, then call `read_mode` for the mode you picked before doing its work. A pasted job description or job URL means `auto-pipeline`; a request with no mode and no job description means show the discovery menu.";

  const prompt = renderSystemPrompt("career-agent", input.userId, { "mode": String(modeDirective), "scripts": String(input.scripts.join(", ")), "setup": String(setupSection(input.health)), "skill": String(skill ? `## career-ops router (from the clone's SKILL.md)\n${skill}` : ""), "shared_rules": String(shared ? `\n## System context (modes/_shared.md)\n${shared}` : ""), "candidate_context": String(userLayer), "mode_context": String(modeSection) });

  return { prompt, preloadedMode };
}
