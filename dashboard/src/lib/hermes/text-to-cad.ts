import path from "node:path";
import type { HermesSurface } from "./config.ts";

/** The reviewed upstream release vendored under hermes-skills/prebuilt/. */
export const TEXT_TO_CAD_SOURCE = "earthtojake/text-to-cad";
export const TEXT_TO_CAD_VERSION = "0.4.28";
export const TEXT_TO_CAD_COMMIT = "0e94cd1d2b5fa2013d89aa9504ecadcf16ce39f6";

export const TEXT_TO_CAD_SKILLS = [
  "bambu-labs",
  "cad",
  "cad-viewer",
  "dfam-check",
  "dxf",
  "gcode",
  "implicit-cad",
  "sdf",
  "sendcutsend",
  "srdf",
  "step-parts",
  "urdf",
] as const;

export type TextToCadSkill = (typeof TEXT_TO_CAD_SKILLS)[number];

const TEXT_TO_CAD_SKILL_SET = new Set<string>(TEXT_TO_CAD_SKILLS);

export function isTextToCadSkill(slug: string): slug is TextToCadSkill {
  return TEXT_TO_CAD_SKILL_SET.has(slug);
}

/**
 * The upstream skills speak in paths relative to their own directory. Hermes
 * executes commands from the conversation workspace, so every injected skill
 * gets the immutable installed root explicitly instead of having to guess it.
 *
 * CAD generation itself uses Breadboard's existing isolated Parametric CAD
 * worker. That worker owns the kernel, attempt budget, measurements, revision
 * store and artifact renderer; the upstream procedure supplies the richer
 * STEP-first design discipline around that trusted execution path.
 */
export function textToCadRuntimeGuidance(input: {
  slug: string;
  firstPartyRoot: string;
  surface: HermesSurface;
}): string {
  if (!isTextToCadSkill(input.slug)) return "";
  const skillRoot = path.join(input.firstPartyRoot, input.slug);
  const common = [
    "# Breadboard execution bridge",
    `This reviewed skill is vendored from ${TEXT_TO_CAD_SOURCE} ${TEXT_TO_CAD_VERSION} (${TEXT_TO_CAD_COMMIT.slice(0, 12)}).`,
    `Its immutable installed directory is ${JSON.stringify(skillRoot)}. Resolve every \`scripts/...\` and \`references/...\` path in the upstream guidance from that directory, while resolving every user artifact path from the conversation workspace. Never write generated files into the installed skill directory.`,
  ];

  if (input.slug === "cad") {
    common.push(
      "For a request to create or revise a physical CAD part or assembly, call `agent_launch` with `agent: \"parametric-cad\"`, the complete user brief, and a one-line reason naming its isolated CAD kernel, measured validation, revision history, and native artifact viewer. Do this before drafting geometry in prose. The Parametric CAD result is the authoritative build result; do not claim success from source text alone.",
      "Use the upstream command-line inspection workflow only when the request targets an existing workspace CAD file that the Parametric CAD project store does not own. On Garden Chat, where arbitrary terminal execution is unavailable, do not pretend those command-line checks ran: use the Parametric CAD worker for supported design work and state the exact unsupported inspection step otherwise.",
    );
  } else if (input.surface === "garden_chat") {
    common.push(
      "Garden Chat can author files in its confined workspace but cannot run arbitrary upstream command lines. Follow the skill's source and review rules, use available Breadboard tools, and explicitly report any validator, slicer, viewer, network, or printer step that could not actually run. Never turn an unexecuted check into a passing result.",
    );
  } else {
    common.push(
      "When the workflow needs a bundled command, invoke the fixed launcher from the installed directory with `terminal_execute_command`; keep its current working directory in the conversation workspace and pass explicit workspace-relative targets. Terminal policy and user approval still govern the command. Read only the specific references the workflow calls for.",
    );
  }
  return common.join("\n");
}

