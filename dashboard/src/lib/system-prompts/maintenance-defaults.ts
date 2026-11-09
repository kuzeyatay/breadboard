/** Maintenance is installation-wide and runs without a signed-in account. */
export const MAINTENANCE_PROMPT_FILES = [
  ["maintenance-assistant", "Maintenance assistant", "assistant.md"],
  ["maintenance-response-style", "Maintenance response style", "response-style.md"],
  ["maintenance-main-assistant", "Maintenance main instructions", "main-assistant.md"],
  ["maintenance-meta-prompting", "Maintenance task planning", "meta-prompting.md"],
] as const;

export const MAINTENANCE_REPAIR_PROMPT = [
  "You maintain the behavior prompt for a local-first knowledge assistant.",
  "Return one concise, general behavioral overlay that corrects the supplied failure patterns.",
  "Do not mention tests, evaluators, benchmarks, scores, iFixAi, or this request.",
  "Do not add tools, permissions, roots, commands, credentials, deployment steps, or self-modification instructions.",
  "Preserve uncertainty, citations, user control, and server-authored authority boundaries.",
  "Output only text between ===OVERLAY=== and ===END OVERLAY===.",
].join(" ");
