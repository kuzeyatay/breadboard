import path from "node:path";
import type { OpenHarnessSurface } from "./config.ts";

export type CapabilityMode =
  | "knowledge"
  | "technical_read"
  | "scoped_implementation";

export type CapabilityOperation =
  | "knowledge_work"
  | "garden_read"
  | "proposal_write"
  | "web_research"
  | "connection_use"
  | "source_read"
  | "code_write"
  | "focused_test"
  | "typecheck"
  | "focused_build"
  | "dependency_install"
  | "git_inspect";

export interface CapabilityDecision {
  mode: CapabilityMode;
  requestedOutcome: string;
  implementationRequired: boolean;
  decisionReason: string;
  decisionSource: "breadboard_server_policy_v1";
  authorizedRoots: string[];
  authorizedPathPatterns: string[];
  allowedTools: string[];
  allowedOperations: CapabilityOperation[];
  allowedCommandPatterns: string[];
  selectedConditionalSkills: string[];
  selectedConnections: string[];
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
}

export interface CapabilityGateInput {
  surface: OpenHarnessSurface;
  userId: number | null;
  requestedOutcome: string;
  authorizedRoot: string;
  now?: Date;
}

const IMPLEMENTATION_VERB =
  /\b(add|build|change|code|create|delete|develop|edit|fix|implement|integrate|migrate|modify|patch|refactor|remove|repair|replace|scaffold|update|wire)\b/i;
const IMPLEMENTATION_ARTIFACT =
  /\b(api|app|application|backend|build|button|class|cli|code|component|config(?:uration)?|css|database|dependency|endpoint|feature|file|frontend|function|handler|interface|library|migration|module|package|page|parser|popup|repository|route|schema|script|server|service|software|source|style|test|typescript|ui|website)\b/i;
const TECHNICAL_MATERIAL =
  /\b(api|architecture|build|code|component|config(?:uration)?|database|dependency|error|files?|function|git|implementation|library|log|module|package|palette|repository|route|schema|source|stack trace|test|typescript)\b/i;
const READ_INTENT =
  /\b(analy[sz]e|compare|diagnose|explain|find|identify|inspect|investigate|read|review|show|trace|understand|why)\b/i;
const NON_IMPLEMENTATION_INTENT =
  /\b(brainstorm|compare|conceptual|describe|draft|explain|ideas?|outline|plan|research|summari[sz]e|teach|what is|how does)\b/i;
const KNOWLEDGE_ONLY_INTENT =
  /\b(explain (?:how|what)|how does|compare\b[^.\n]{0,100}\b(?:approach|design|option|pattern)|brainstorm|conceptual(?:ly)?|outline|plan\b|summari[sz]e)\b/i;
const EXPLICIT_NO_MUTATION =
  /\b(?:do not|don't|without)\b[^.\n]{0,80}\b(?:change|edit|implement|modify|patch|write)\b/i;
const HIGH_IMPACT =
  /\b(commit|push|deploy|publish|release|rebase|reset|force[- ]push|delete (?:the )?(?:database|repository|branch)|production infrastructure|secret|credential)\b/i;

const KNOWLEDGE_TOOLS = [
  "webfetch",
  "websearch",
  "garden_search",
  "garden_get_page",
  "garden_get_page_context",
  "garden_get_source_excerpt",
  "garden_get_source_figure",
  "garden_get_graph_neighbors",
  "garden_get_learning_spine",
  "garden_get_content_inventory",
  "garden_get_recent_events",
  "garden_create_note_proposal",
  "garden_propose_page_revision",
  "garden_propose_visualization",
  "garden_run_proposal_validation",
] as const;

const TECHNICAL_READ_TOOLS = ["read", "glob", "grep"] as const;
const IMPLEMENTATION_TOOLS = [
  ...TECHNICAL_READ_TOOLS,
  "edit",
  "write",
  "patch",
  "apply_patch",
  "bash",
] as const;

export const RESTRICTED_RUNTIME_TOOLS = [
  "read",
  "glob",
  "grep",
  "edit",
  "write",
  "patch",
  "apply_patch",
  "bash",
  "shell",
  "task",
  "skill",
] as const;

/** Remove slash selectors before classification so a crafted token cannot escalate. */
export function outcomeWithoutCapabilityTokens(value: string): string {
  let remaining = value.trimStart();
  const token = /^\/(?:skill:|mcp:|prompt:)?[a-z0-9][a-z0-9_.-]*(?:\s+|$)/i;
  while (remaining.startsWith("/")) {
    const match = remaining.match(token);
    if (!match) break;
    remaining = remaining.slice(match[0].length).trimStart();
  }
  return remaining.trim();
}

function dependencyPackageForOutcome(outcome: string): string | null {
  const match = outcome.match(
    /\b(?:install|upgrade)\s+(?:the\s+)?(?:npm\s+)?(?:package\s+|dependency\s+)?(@?[a-z0-9][a-z0-9._/-]*)\b/i,
  );
  const value = match?.[1]?.toLowerCase();
  if (!value || /^(?:a|an|dependency|package|required|specific|the)$/.test(value))
    return null;
  return value;
}

function implementationOperations(
  outcome: string,
  dependencyPackage: string | null,
): CapabilityOperation[] {
  const operations: CapabilityOperation[] = [
    "source_read",
    "code_write",
    "git_inspect",
    "typecheck",
  ];
  if (/\b(test|bug|fix|repair|regression|verify)\b/i.test(outcome)) {
    operations.push("focused_test");
  }
  if (/\b(build|bundle|compile)\b/i.test(outcome)) {
    operations.push("focused_build");
  }
  if (dependencyPackage) {
    operations.push("dependency_install");
  }
  return operations;
}

function safeAuthorizedRoot(value: string): string | null {
  if (!value || !path.isAbsolute(value)) return null;
  return path.resolve(value);
}

function portable(value: string): string {
  return value.replace(/\\/g, "/");
}

function pathPattern(root: string, relative: string): string {
  const dashboardRoot =
    path.basename(root).toLowerCase() === "dashboard"
      ? relative.replace(/^dashboard\//, "")
      : relative;
  return portable(path.join(root, dashboardRoot));
}

/** Derive bounded path patterns from explicit paths or known mounted surfaces. */
export function implementationPathPatterns(
  outcome: string,
  root: string,
): string[] {
  const patterns = new Set<string>();
  const explicit =
    /(?:^|[\s`'"])([a-z0-9_.-]+(?:[\\/][a-z0-9_.-]+)+\.(?:cjs|css|html|js|jsx|json|md|mjs|py|scss|sql|ts|tsx|yaml|yml))(?=$|[\s`'",:;])/gi;
  for (const match of outcome.matchAll(explicit)) {
    const relative = match[1].replace(/\\/g, "/").replace(/^\.\//, "");
    const resolved = path.resolve(root, relative);
    const relation = path.relative(root, resolved);
    if (!relation.startsWith("..") && !path.isAbsolute(relation)) {
      patterns.add(portable(resolved));
    }
  }
  const add = (...values: string[]) =>
    values.forEach((value) => patterns.add(pathPattern(root, value)));
  if (/\b(?:capabilit(?:y|ies)|slash)\s+(?:palette|picker)|command hub|composer\b/i.test(outcome)) {
    add(
      "dashboard/src/app/components/assistant-composer.tsx",
      "dashboard/src/app/components/openharness/command-hub.tsx",
      "dashboard/src/lib/openharness/commands.ts",
      "dashboard/src/app/api/openharness/commands/**",
      "dashboard/tests/openharness-capability-palette.test.mjs",
      "dashboard/tests/openharness-commands.test.mjs",
    );
  }
  if (/\b(?:connection flow|add connection|mcp connection)\b/i.test(outcome)) {
    add(
      "dashboard/src/app/components/openharness/command-hub.tsx",
      "dashboard/src/app/api/openharness/mcp/**",
      "dashboard/src/lib/openharness/mcp-connections.ts",
      "dashboard/tests/openharness-mcp-connections.test.mjs",
    );
  }
  if (/\b(?:quartz|published page|page assistant)\b/i.test(outcome)) {
    add(
      "quartz/quartz/components/BreadboardAI.tsx",
      "quartz/quartz/components/scripts/breadboardAI.inline.ts",
      "quartz/quartz/styles/**",
      "dashboard/src/app/api/quartz-ai/**",
      "dashboard/tests/quartz-ai-parity.test.mjs",
    );
  }
  if (/\b(?:garden chat|garden assistant|garden tool|proposal)\b/i.test(outcome)) {
    add(
      "dashboard/src/app/components/openharness/garden-agent-chat.tsx",
      "dashboard/src/lib/openharness/garden-chat-adapter.ts",
      "dashboard/src/app/api/chat/**",
      "openharness-config/agent/breadboard-garden.md",
      "dashboard/tests/openharness-live-routing.test.mjs",
    );
  }
  if (/\b(?:server[- ]side|authorization|api route|endpoint|session policy|permission)\b/i.test(outcome)) {
    add(
      "dashboard/src/app/api/openharness/**",
      "dashboard/src/lib/openharness/**",
      "dashboard/tests/openharness-*.test.mjs",
    );
  }
  if (/\b(?:react (?:component|interface)|interface component|visuali[sz]er|ui component|escape closes|button behavior)\b/i.test(outcome)) {
    add(
      "dashboard/src/app/components/**",
      "dashboard/tests/**",
    );
  }
  return [...patterns];
}

function commandPatternsForImplementation(
  outcome: string,
  dependencyPackage: string | null,
): string[] {
  const commands = new Set(["git status --short*", "git diff*", "rg *"]);
  if (/\b(test|bug|fix|repair|regression|verify)\b/i.test(outcome)) {
    commands.add("node --test --experimental-strip-types tests/*.test.mjs");
    commands.add(
      "npm --prefix dashboard exec -- node --test --experimental-strip-types tests/*.test.mjs",
    );
  }
  commands.add("npx tsc --noEmit*");
  commands.add("npm --prefix dashboard exec tsc -- --noEmit*");
  if (/\b(build|bundle|compile)\b/i.test(outcome)) {
    commands.add("npm run build");
    commands.add("npm --prefix dashboard run build");
  }
  if (dependencyPackage) {
    commands.add(`npm install ${dependencyPackage}`);
    commands.add(`npm --prefix dashboard install ${dependencyPackage}`);
  }
  return [...commands];
}

/**
 * Deterministic, server-owned coding necessity gate. Model prose and slash
 * selectors are deliberately not inputs to authority. Ambiguity stays in the
 * least-privileged mode.
 */
export function decideCapabilityMode(
  input: CapabilityGateInput,
): CapabilityDecision {
  const now = input.now ?? new Date();
  const requestedOutcome = outcomeWithoutCapabilityTokens(
    input.requestedOutcome,
  ).slice(0, 4_000);
  const root = safeAuthorizedRoot(input.authorizedRoot);
  const authorizedPathPatterns = root
    ? implementationPathPatterns(requestedOutcome, root)
    : [];
  const explicitNoMutation = EXPLICIT_NO_MUTATION.test(requestedOutcome);
  const implementationIntent =
    IMPLEMENTATION_VERB.test(requestedOutcome) &&
    IMPLEMENTATION_ARTIFACT.test(requestedOutcome) &&
    !explicitNoMutation;
  const clearlyNonImplementation =
    (NON_IMPLEMENTATION_INTENT.test(requestedOutcome) &&
      !implementationIntent) ||
    KNOWLEDGE_ONLY_INTENT.test(requestedOutcome) ||
    explicitNoMutation;
  const highImpactIntent = HIGH_IMPACT.test(requestedOutcome);
  const implementationCapableSurface =
    input.surface === "dashboard_terminal" && input.userId !== null;

  let mode: CapabilityMode = "knowledge";
  let implementationRequired = false;
  let decisionReason =
    "The requested outcome can be handled as knowledge work without repository mutation.";
  let allowedOperations: CapabilityOperation[] = ["knowledge_work"];
  let allowedTools: string[] = [...KNOWLEDGE_TOOLS];
  let allowedCommandPatterns: string[] = [];
  let expiresAt: string | null = null;

  if (
    implementationIntent &&
    !clearlyNonImplementation &&
    implementationCapableSurface &&
    root &&
    authorizedPathPatterns.length > 0 &&
    !highImpactIntent
  ) {
    const dependencyPackage = dependencyPackageForOutcome(requestedOutcome);
    mode = "scoped_implementation";
    implementationRequired = true;
    decisionReason =
      "The authenticated request asks for a concrete software change that cannot be completed without modifying the authorized workspace.";
    allowedOperations = implementationOperations(
      requestedOutcome,
      dependencyPackage,
    );
    allowedTools = [...KNOWLEDGE_TOOLS, ...IMPLEMENTATION_TOOLS];
    allowedCommandPatterns = commandPatternsForImplementation(
      requestedOutcome,
      dependencyPackage,
    );
    expiresAt = new Date(now.getTime() + 30 * 60_000).toISOString();
  } else if (
    READ_INTENT.test(requestedOutcome) &&
    TECHNICAL_MATERIAL.test(requestedOutcome) &&
    !KNOWLEDGE_ONLY_INTENT.test(requestedOutcome) &&
    implementationCapableSurface &&
    root
  ) {
    mode = "technical_read";
    decisionReason =
      "The request concerns technical material but does not require a code change.";
    allowedOperations = ["knowledge_work", "source_read", "git_inspect"];
    allowedTools = [...KNOWLEDGE_TOOLS, ...TECHNICAL_READ_TOOLS];
    expiresAt = new Date(now.getTime() + 15 * 60_000).toISOString();
  } else if (highImpactIntent) {
    decisionReason =
      "High-impact repository or production actions require a separate dedicated authorization and were not granted.";
  } else if (implementationIntent && !implementationCapableSurface) {
    decisionReason =
      "This surface is knowledge-only and cannot receive implementation capability.";
  } else if (implementationIntent && !root) {
    decisionReason =
      "No server-authorized workspace root was available, so implementation capability was not granted.";
  } else if (implementationIntent && authorizedPathPatterns.length === 0) {
    decisionReason =
      "The requested change could not be limited to a concrete task path, so implementation capability was not granted.";
  }

  return {
    mode,
    requestedOutcome,
    implementationRequired,
    decisionReason,
    decisionSource: "breadboard_server_policy_v1",
    authorizedRoots: root && mode !== "knowledge" ? [root] : [],
    authorizedPathPatterns:
      mode === "scoped_implementation" ? authorizedPathPatterns : [],
    allowedTools: [...new Set(allowedTools)],
    allowedOperations: [...new Set(allowedOperations)],
    allowedCommandPatterns:
      mode === "scoped_implementation" ? allowedCommandPatterns : [],
    selectedConditionalSkills: [],
    selectedConnections: [],
    createdAt: now.toISOString(),
    expiresAt,
    revokedAt: null,
  };
}

export function toolPolicyForDecision(
  decision: CapabilityDecision,
): Record<string, boolean> {
  const allowed = new Set(decision.allowedTools);
  return Object.fromEntries(
    RESTRICTED_RUNTIME_TOOLS.map((tool) => [tool, allowed.has(tool)]),
  );
}

/** Merge a selected MCP/skill tool map without allowing it to widen policy. */
export function mergeCapabilityToolPolicy(
  decision: CapabilityDecision,
  selected?: Record<string, boolean>,
): Record<string, boolean> {
  const policy = toolPolicyForDecision(decision);
  if (!selected) return policy;
  const restricted = new Set<string>(RESTRICTED_RUNTIME_TOOLS);
  for (const [tool, enabled] of Object.entries(selected)) {
    policy[tool] = restricted.has(tool)
      ? Boolean(enabled && policy[tool])
      : Boolean(enabled && connectionToolAllowed(tool));
  }
  return policy;
}

function connectionToolAllowed(tool: string): boolean {
  // Connected applications are knowledge/data capabilities. Development and
  // high-impact mutations require dedicated Breadboard workflows and cannot be
  // smuggled in under an arbitrary MCP namespace.
  return !/(?:^|[_-])(?:build|commit|create[_-]?branch|delete[_-]?(?:branch|repository)|deploy|edit[_-]?(?:code|file)|force[_-]?push|git[_-]?write|install[_-]?(?:dependency|package)|merge[_-]?(?:branch|pull[_-]?request)|push|rebase|reset|run[_-]?(?:build|test)|shell|write[_-]?(?:code|file))(?:$|[_-])/i.test(
    tool,
  );
}

export interface RuntimePermissionRule {
  permission: string;
  pattern: string;
  action: "allow" | "deny";
}

/** Session permissions mirror the prompt tool map as a second runtime barrier. */
export function permissionRulesForDecision(
  decision: CapabilityDecision,
): RuntimePermissionRule[] {
  const rules: RuntimePermissionRule[] = [
    { permission: "external_directory", pattern: "*", action: "deny" },
    { permission: "read", pattern: "*", action: "deny" },
    { permission: "glob", pattern: "*", action: "deny" },
    { permission: "grep", pattern: "*", action: "deny" },
    { permission: "edit", pattern: "*", action: "deny" },
    { permission: "write", pattern: "*", action: "deny" },
    { permission: "patch", pattern: "*", action: "deny" },
    { permission: "bash", pattern: "*", action: "deny" },
    { permission: "task", pattern: "*", action: "deny" },
    { permission: "skill", pattern: "*", action: "deny" },
    { permission: "webfetch", pattern: "*", action: "deny" },
    { permission: "websearch", pattern: "*", action: "deny" },
  ];

  const tools = new Set(decision.allowedTools);
  if (tools.has("webfetch")) {
    rules.push({ permission: "webfetch", pattern: "*", action: "allow" });
  }
  if (tools.has("websearch")) {
    rules.push({ permission: "websearch", pattern: "*", action: "allow" });
  }

  for (const pattern of decision.authorizedPathPatterns ?? []) {
    if (tools.has("read") || tools.has("glob") || tools.has("grep")) {
      rules.push({ permission: "external_directory", pattern, action: "allow" });
    }
    if (tools.has("read")) {
      rules.push({ permission: "read", pattern, action: "allow" });
    }
    if (tools.has("glob")) {
      rules.push({ permission: "glob", pattern, action: "allow" });
    }
    if (tools.has("grep")) {
      rules.push({ permission: "grep", pattern, action: "allow" });
    }
    if (tools.has("edit")) {
      rules.push({ permission: "edit", pattern, action: "allow" });
    }
    if (tools.has("write")) {
      rules.push({ permission: "write", pattern, action: "allow" });
    }
    if (tools.has("patch") || tools.has("apply_patch")) {
      rules.push({ permission: "patch", pattern, action: "allow" });
    }
  }

  if (tools.has("bash")) {
    for (const pattern of decision.allowedCommandPatterns ?? []) {
      rules.push({ permission: "bash", pattern, action: "allow" });
    }
  }
  if (tools.has("task")) {
    rules.push({ permission: "task", pattern: "*", action: "allow" });
  }
  if (tools.has("skill")) {
    rules.push({ permission: "skill", pattern: "*", action: "allow" });
  }
  return rules;
}
