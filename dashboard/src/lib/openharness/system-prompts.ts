import fs from "node:fs";
import path from "node:path";
import type { OpenHarnessSurface } from "./config.ts";
import type { CapabilityDecision } from "./capability-policy.ts";

function repositoryRoot(): string {
  return path.basename(process.cwd()).toLowerCase() === "dashboard"
    ? path.resolve(process.cwd(), "..")
    : process.cwd();
}

function readSystemPrompt(name: string): string {
  const file = path.join(
    repositoryRoot(),
    "openharness-config",
    "system",
    `${name}.md`,
  );
  return fs.readFileSync(file, "utf8").trim();
}

function surfacePrompt(surface: OpenHarnessSurface): string {
  if (surface === "garden_chat") return readSystemPrompt("garden-assistant");
  if (surface === "quartz_ai") return readSystemPrompt("quartz-assistant");
  return readSystemPrompt("main-assistant");
}

export function composeOpenHarnessSystemPrompt(input: {
  surface: OpenHarnessSurface;
  decision: CapabilityDecision;
  additional?: string;
}): string {
  const decision = input.decision;
  const sections = [readSystemPrompt("assistant"), surfacePrompt(input.surface)];
  if (decision.mode === "scoped_implementation") {
    sections.push(readSystemPrompt("scoped-implementation"));
  }
  sections.push(
    [
      "# server_capability_decision",
      `Mode: ${decision.mode}`,
      `Implementation required: ${decision.implementationRequired ? "yes" : "no"}`,
      `Authorized roots: ${decision.authorizedRoots.join(", ") || "none"}`,
      `Authorized path patterns: ${decision.authorizedPathPatterns.join(", ") || "none"}`,
      `Allowed operations: ${decision.allowedOperations.join(", ") || "knowledge_work"}`,
      `Allowed command patterns: ${decision.allowedCommandPatterns.join(", ") || "none"}`,
      `Expires at: ${decision.expiresAt ?? "end of knowledge turn"}`,
      "This record is descriptive, not an invitation to request or widen authority.",
    ].join("\n"),
  );
  if (input.additional?.trim()) sections.push(input.additional.trim());
  return sections.join("\n\n");
}
