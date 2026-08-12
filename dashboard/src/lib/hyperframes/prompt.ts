// What Breadboard tells the coding agent before it starts making a video.
//
// The video-making knowledge is NOT reimplemented here. HyperFrames ships 19
// markdown skills that already teach the composition contract, the animation
// rules, and the CLI loop; the clone is on disk, so this prompt points at those
// files by absolute path and lets the agent read them. Upgrading the clone
// therefore upgrades the agent.
//
// What this prompt does own is everything the skills cannot know: that no human
// is available to answer an interview question mid-run, that the CLI is already
// installed and must not be re-fetched from npm, that no long-running server
// may be started inside a one-shot run, and what the finished turn has to say.

import fs from "node:fs";
import path from "node:path";
import { skillsRoot } from "./runtime.ts";

/** Skill directories that exist in this clone, as `/name` router entries. */
export function installedSkills(env: NodeJS.ProcessEnv = process.env): string[] {
  const root = skillsRoot(env);
  if (!root) return [];
  try {
    return fs
      .readdirSync(root, { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isDirectory() && fs.existsSync(path.join(root, entry.name, "SKILL.md")),
      )
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

function posix(value: string): string {
  return value.split(path.sep).join("/");
}

export interface PromptInput {
  brief: string;
  projectDirectory: string;
  outputRelativePath: string;
  env?: NodeJS.ProcessEnv;
}

/**
 * The operating rules, written once and used twice: they are prepended to the
 * agent's task and appended to the project's own `AGENTS.md`, so a later turn
 * that only reads the project still finds them.
 */
export function operatingRules(input: Omit<PromptInput, "brief">): string {
  const env = input.env ?? process.env;
  const root = skillsRoot(env);
  const skills = installedSkills(env);
  const skillLines = root
    ? [
        `The HyperFrames skills are on this machine at ${posix(root)}.`,
        `Read ${posix(path.join(root, "hyperframes", "SKILL.md"))} FIRST — it is the router and capability map — then read the SKILL.md of whichever workflow it routes to, plus the domain skills that workflow names. Read them with your file tools; do not run \`hyperframes skills\` or \`npx skills\`, which would try to install them over the network.`,
        skills.length ? `Available skills: ${skills.map((name) => `/${name}`).join(", ")}.` : "",
      ].filter(Boolean)
    : [
        "The HyperFrames skills are not on this machine. Work from the project's own AGENTS.md and the CLI's `--help` output.",
      ];

  return [
    "# How this run works",
    "",
    `You are making a video with HyperFrames. The scaffolded project is your working directory (${posix(input.projectDirectory)}) and it already contains index.html, hyperframes.json and the framework's own AGENTS.md.`,
    "",
    ...skillLines,
    "",
    "## Nobody can answer you",
    "",
    "This run is not interactive. The person wrote one brief and left. Skip every interview, confirmation and clarifying question the skills ask you to run — decide instead. When the brief leaves something open, choose the option a professional would choose, and list the choices you made in your final message so the person can correct them in a follow-up.",
    "",
    "## Tool rules",
    "",
    "- `hyperframes` is already installed and on your PATH. Run it as `hyperframes …` (the project's `npm run lint` / `check` / `render` scripts call the same binary). Never run `npx hyperframes`, `hyperframes@latest`, `hyperframes upgrade`, or `hyperframes init` — the CLI is pinned and the project already exists.",
    "- Never start anything that does not exit on its own: no `hyperframes preview`, `play`, `present`, `studio`, or any dev server or watcher. A blocked command ends the run with nothing to show.",
    "- Keep the composition self-contained. No render-time network requests, no remote fonts, images, or scripts, no `Date.now()`, no unseeded `Math.random()` — the renderer seeks frame by frame and anything non-deterministic tears. Generate visuals with CSS, SVG, and canvas rather than reaching for stock media that is not on disk.",
    "- Use only media files that already exist locally, plus anything the brief points at.",
    "",
    "## Definition of done",
    "",
    "1. `hyperframes lint` passes.",
    "2. `hyperframes check` passes (the headless-browser gate: runtime errors, layout, motion, contrast).",
    `3. \`hyperframes render --output ${input.outputRelativePath}\` produced a real MP4. Verify the file exists and is not empty before you finish.`,
    "4. Your final message is the answer the person reads in chat: what you made, how long it runs, which file it is, and the assumptions you had to make. No headings, a few sentences.",
    "",
    "If the render fails twice for the same reason, simplify the composition until it renders, then say in your final message what you dropped and why.",
  ].join("\n");
}

/** The full instruction handed to the agent on stdin. */
export function runInstruction(input: PromptInput): string {
  return [
    operatingRules(input),
    "",
    "# The brief",
    "",
    input.brief.trim(),
  ].join("\n");
}

const MARKER = "<!-- breadboard-hyperframes -->";

/**
 * Append Breadboard's rules to the project's AGENTS.md. The template's own
 * AGENTS.md stays first — it is upstream's guidance for this exact scaffold —
 * and the marker keeps a retry from stacking a second copy.
 */
export function writeProjectGuidance(input: Omit<PromptInput, "brief">): void {
  const file = path.join(input.projectDirectory, "AGENTS.md");
  let existing = "";
  try {
    existing = fs.readFileSync(file, "utf8");
  } catch {
    existing = "";
  }
  if (existing.includes(MARKER)) return;
  const section = `\n\n${MARKER}\n\n${operatingRules(input)}\n`;
  fs.writeFileSync(file, `${existing.trimEnd()}${section}`, "utf8");
}
