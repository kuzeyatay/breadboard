import type { UITarsAgentConfiguration } from "./config.ts";

const WEB_TARGET =
  /\b(?:https?:\/\/|www\.|website|web\s+(?:app|site|version)|in\s+(?:the\s+)?browser)\b/i;
const DESKTOP_CONTEXT =
  /\b(?:on|from|using|through|via)\s+(?:my|the|this)?\s*(?:computer|desktop|pc|windows|mac|machine)\b|\b(?:desktop|native|installed)\s+(?:app|application|program)\b/i;
const OPEN_LOCAL_TARGET =
  /^\s*(?:please\s+|can\s+you\s+|could\s+you\s+|would\s+you\s+)?(?:open|launch|start|focus|switch\s+to|use)\s+(?!https?:\/\/|www\.)/i;

/**
 * Route explicit web work to the isolated browser and local-app work to the
 * actual desktop. This intentionally reasons from the requested interaction,
 * not from a catalog of application names, so newly installed or uncommon apps
 * work without code changes.
 *
 * "Open X" is treated as a local launch when no web context is present. A user
 * can always make the isolated target explicit with "in the browser" or a URL.
 * The desktop runtime still requests its mandatory high-risk session approval
 * before it can see or control the screen.
 */
export function configurationForAgentTarsTask(
  configuration: UITarsAgentConfiguration,
  task: string,
): UITarsAgentConfiguration {
  if (configuration.operator === "computer") return configuration;
  if (WEB_TARGET.test(task)) return configuration;
  if (!DESKTOP_CONTEXT.test(task) && !OPEN_LOCAL_TARGET.test(task)) return configuration;
  return {
    ...configuration,
    operator: "computer",
  };
}
