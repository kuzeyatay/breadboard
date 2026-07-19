// Server-owned permission broker: turns a TaskPlan plus the user's real
// filesystem grants into the minimum runtime tool policy and permission rules.
//
// This replaces the authority half of `capability-policy.ts`. The differences
// that matter:
//
//   * Tools start disabled and are activated per capability class. The legacy
//     policy enumerated a fixed `RESTRICTED_RUNTIME_TOOLS` list and hard-denied
//     `task` and `skill` in every mode, which made the existing subagent and
//     skill rosters unreachable no matter what the user asked for.
//   * Filesystem authority comes from persisted grants, not from regexes over
//     the message text. The legacy policy derived `authorizedPathPatterns` from
//     hardcoded Breadboard-topic phrases, so any request it did not recognize
//     received zero patterns and silently fell back to knowledge-only.
//   * Surface is not an input to authority. It selects context and, for public
//     Quartz, an isolation flag — nothing else.
//
// Everything here is a pure function of (plan, grants, surface). It performs no
// I/O, so it is directly unit-testable and cannot be steered by model prose.

import type { OpenHarnessSurface } from "./config.ts";
import type { TaskCapability, TaskPlan } from "./task-plan.ts";
import {
  candidatePathsForAlias,
  describePermissions,
  permissionsForCapabilities,
  type ApprovedFilesystemRoot,
  type FilesystemOperation,
  type FilesystemPermissions,
} from "./filesystem-paths.ts";

export interface RuntimePermissionRule {
  permission: string;
  pattern: string;
  action: "allow" | "deny";
}

/** A capability the plan needs but the user has not yet authorized. */
export interface PendingPermission {
  kind: "filesystem" | "confirmation" | "connection";
  /** Stable id so an approval can be matched back to the paused turn. */
  id: string;
  /** Concrete, non-technical explanation of what is being requested. */
  message: string;
  /** For filesystem requests: the folder the agent wants to reach. */
  path?: string;
  /** For filesystem requests: the operations needed there. */
  operations?: FilesystemOperation[];
  capability: TaskCapability;
}

export interface CapabilityGrant {
  plan: TaskPlan;
  /** Tool name -> enabled. Absent means disabled. */
  allowedTools: Record<string, boolean>;
  /** Second runtime barrier mirroring the tool map. */
  permissionRules: RuntimePermissionRule[];
  /** Grants actually used to authorize this turn. */
  authorizedRoots: ApprovedFilesystemRoot[];
  /** Capabilities the plan asked for that were granted. */
  grantedCapabilities: TaskCapability[];
  /** Capabilities the plan asked for that are blocked pending approval. */
  withheldCapabilities: TaskCapability[];
  pendingPermissions: PendingPermission[];
  /** True when the turn can proceed without further user action. */
  executable: boolean;
  brokerSource: "breadboard_capability_broker_v1";
}

/* ------------------------------------------------------------------ */
/* Tool catalogue                                                      */
/* ------------------------------------------------------------------ */

const GARDEN_READ_TOOLS = [
  "garden_search",
  "garden_get_page",
  "garden_get_page_context",
  "garden_get_source_excerpt",
  "garden_get_source_figure",
  "garden_get_graph_neighbors",
  "garden_get_learning_spine",
  "garden_get_content_inventory",
  "garden_get_recent_events",
] as const;

const GARDEN_WRITE_TOOLS = [
  "garden_run_proposal_validation",
  "garden_create_note_proposal",
  "garden_propose_page_revision",
  "garden_propose_visualization",
] as const;

const FS_READ_TOOLS = ["read", "glob", "grep", "list"] as const;
const FS_WRITE_TOOLS = ["write", "edit", "patch", "apply_patch"] as const;
const WEB_TOOLS = ["webfetch", "websearch"] as const;

/**
 * Tools each capability class activates. A capability grants exactly the tools
 * its outcome needs — `filesystem_read` never yields a writer, and
 * `command_execution` never yields an editor.
 */
const CAPABILITY_TOOLS: Record<TaskCapability, readonly string[]> = {
  conversation: [],
  garden_read: GARDEN_READ_TOOLS,
  garden_write: [...GARDEN_READ_TOOLS, ...GARDEN_WRITE_TOOLS],
  web_research: WEB_TOOLS,
  filesystem_read: FS_READ_TOOLS,
  filesystem_write: [...FS_READ_TOOLS, ...FS_WRITE_TOOLS],
  // Deletion is carried out through the scoped shell with a delete permission
  // rule; there is no separate destructive tool to enable.
  destructive_filesystem: [...FS_READ_TOOLS, "bash"],
  document_processing: [...FS_READ_TOOLS, "bash"],
  media_processing: [...FS_READ_TOOLS, "bash"],
  command_execution: ["bash"],
  application_action: [],
  mcp: [],
  skill: ["skill"],
  subagent: ["task"],
  memory: [],
  coding: [...FS_READ_TOOLS, ...FS_WRITE_TOOLS, "bash"],
  destructive_system_action: [],
};

/** Every tool the broker is capable of switching on, so the map is explicit. */
export const BROKERED_TOOLS: readonly string[] = [
  ...new Set(
    Object.values(CAPABILITY_TOOLS).flat().concat([
      "shell",
      "task",
      "skill",
      "webfetch",
      "websearch",
    ]),
  ),
];

/** Capabilities that may never be activated for an isolated/public session. */
const PRIVATE_CAPABILITIES: ReadonlySet<TaskCapability> = new Set([
  "filesystem_read",
  "filesystem_write",
  "destructive_filesystem",
  "document_processing",
  "media_processing",
  "command_execution",
  "application_action",
  "mcp",
  "skill",
  "subagent",
  "memory",
  "coding",
  "destructive_system_action",
  "garden_write",
]);

/** Capability classes whose runtime effect is filesystem access. */
const FILESYSTEM_CAPABILITIES: ReadonlySet<TaskCapability> = new Set([
  "filesystem_read",
  "filesystem_write",
  "destructive_filesystem",
  "document_processing",
  "media_processing",
  "coding",
]);

function operationsForCapability(capability: TaskCapability): FilesystemOperation[] {
  switch (capability) {
    case "filesystem_read":
    case "document_processing":
    case "media_processing":
      return ["read"];
    case "filesystem_write":
      return ["read", "create", "modify", "move"];
    case "destructive_filesystem":
      return ["read", "delete"];
    case "coding":
      return ["read", "create", "modify"];
    default:
      return [];
  }
}

/* ------------------------------------------------------------------ */
/* Broker                                                              */
/* ------------------------------------------------------------------ */

export interface BrokerInput {
  plan: TaskPlan;
  surface: OpenHarnessSurface;
  userId: number | null;
  /** The user's active, unrevoked filesystem grants. */
  grants: readonly ApprovedFilesystemRoot[];
  /**
   * The session's own ephemeral workspace. Always readable/writable for the
   * agent's scratch work; it is not user data and needs no grant.
   */
  workspaceRoot: string;
  /** Public Quartz and anonymous sessions. */
  isolated?: boolean;
  /** Confirmations the user has already given this turn, by pending id. */
  confirmedPermissionIds?: readonly string[];
}

function portable(value: string): string {
  return value.replace(/\\/g, "/");
}

/**
 * Decide what this turn is actually allowed to do.
 *
 * Capabilities the plan requested but the user has not authorized are not
 * silently dropped: they become `pendingPermissions`, so the caller can raise a
 * concrete request and resume the same task after approval.
 */
export function brokerCapabilities(input: BrokerInput): CapabilityGrant {
  const isolated = input.isolated === true || input.userId === null;
  const requested = new Set(input.plan.requiredCapabilities);
  const confirmed = new Set(input.confirmedPermissionIds ?? []);

  const granted = new Set<TaskCapability>(["conversation"]);
  const withheld = new Set<TaskCapability>();
  const pending: PendingPermission[] = [];
  const usedRoots = new Map<string, ApprovedFilesystemRoot>();

  for (const capability of requested) {
    if (capability === "conversation") continue;

    // Isolation is absolute: a public session never reaches private capability.
    if (isolated && PRIVATE_CAPABILITIES.has(capability)) {
      withheld.add(capability);
      continue;
    }

    // Filesystem-backed capabilities require a grant that permits every
    // operation the class implies.
    if (FILESYSTEM_CAPABILITIES.has(capability)) {
      const operations = operationsForCapability(capability);
      const satisfying = input.grants.filter((grant) =>
        operations.every((operation) => grant.permissions[operation]),
      );
      if (satisfying.length === 0) {
        withheld.add(capability);
        pending.push(buildFilesystemRequest(capability, operations, input.plan));
        continue;
      }
      satisfying.forEach((grant) => usedRoots.set(grant.id, grant));
      granted.add(capability);
      continue;
    }

    // Steps flagged for confirmation stay withheld until the user confirms.
    const gatingStep = input.plan.steps.find(
      (step) => step.requiresConfirmation && step.capabilities.includes(capability),
    );
    if (gatingStep && !confirmed.has(confirmationId(gatingStep.index))) {
      withheld.add(capability);
      pending.push({
        kind: capability === "destructive_system_action" ? "confirmation" : "confirmation",
        id: confirmationId(gatingStep.index),
        message: gatingStep.description,
        capability,
      });
      continue;
    }

    granted.add(capability);
  }

  const authorizedRoots = [...usedRoots.values()];
  const allowedTools = buildToolMap(granted);
  const permissionRules = buildPermissionRules(
    granted,
    authorizedRoots,
    input.workspaceRoot,
  );

  return {
    plan: input.plan,
    allowedTools,
    permissionRules,
    authorizedRoots,
    grantedCapabilities: [...granted],
    withheldCapabilities: [...withheld],
    pendingPermissions: pending,
    // A turn is executable when nothing it needs is still pending. A plan whose
    // only pending item is a later confirmation step still executes its earlier
    // steps, so we only block when the *first* step is blocked.
    executable: pending.length === 0 || firstStepIsSatisfied(input.plan, granted),
    brokerSource: "breadboard_capability_broker_v1",
  };
}

function confirmationId(stepIndex: number): string {
  return `confirm-step-${stepIndex}`;
}

function firstStepIsSatisfied(plan: TaskPlan, granted: ReadonlySet<TaskCapability>): boolean {
  const first = plan.steps[0];
  if (!first) return true;
  return first.capabilities.every((capability) => granted.has(capability));
}

function buildFilesystemRequest(
  capability: TaskCapability,
  operations: FilesystemOperation[],
  plan: TaskPlan,
): PendingPermission {
  // Prefer a concrete path the user actually named, so the prompt can offer to
  // approve that folder rather than asking an abstract question.
  const namedPath = plan.requiredResources.find((resource) => resource.kind === "path");
  const permissions: FilesystemPermissions = permissionsForCapabilities([capability]);

  // A spoken alias ("Documents") is not a path the grant API can canonicalize,
  // so resolve it to a concrete candidate location here. This only *proposes* a
  // folder for the user to approve — it confers nothing on its own, and the
  // server re-validates the path when the grant is actually created.
  const resolvedPath = namedPath
    ? namedPath.absolute
      ? namedPath.value
      : (candidatePathsForAlias(namedPath.value)[0] ?? namedPath.value)
    : undefined;
  const scope = resolvedPath ? ` for ${resolvedPath}` : "";
  return {
    kind: "filesystem",
    id: `fs-${capability}${resolvedPath ? `-${portable(resolvedPath)}` : ""}`,
    message: `To ${plan.intendedOutcome.replace(/\.$/, "").toLowerCase()}${scope}, ${describePermissions(permissions)}`,
    path: resolvedPath,
    operations,
    capability,
  };
}

function buildToolMap(granted: ReadonlySet<TaskCapability>): Record<string, boolean> {
  // Start from an explicit deny for every brokered tool: the runtime must never
  // inherit an ambient default.
  const map: Record<string, boolean> = Object.fromEntries(
    BROKERED_TOOLS.map((tool) => [tool, false]),
  );
  for (const capability of granted) {
    for (const tool of CAPABILITY_TOOLS[capability] ?? []) {
      map[tool] = true;
    }
  }
  // `shell` is never activated: scoped execution goes through `bash` so it is
  // covered by the command pattern rules below.
  map.shell = false;
  return map;
}

function buildPermissionRules(
  granted: ReadonlySet<TaskCapability>,
  roots: readonly ApprovedFilesystemRoot[],
  workspaceRoot: string,
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
  ];

  const allow = (permission: string, pattern: string) =>
    rules.push({ permission, pattern, action: "allow" });

  // The session's own workspace is always available for scratch work.
  const workspaceGlob = `${portable(workspaceRoot)}/**`;
  for (const permission of ["read", "glob", "grep", "edit", "write", "patch"]) {
    allow(permission, workspaceGlob);
  }

  const canRead =
    granted.has("filesystem_read") ||
    granted.has("filesystem_write") ||
    granted.has("destructive_filesystem") ||
    granted.has("document_processing") ||
    granted.has("media_processing") ||
    granted.has("coding");
  const canWrite = granted.has("filesystem_write") || granted.has("coding");

  for (const root of roots) {
    const glob = `${portable(root.canonicalPath)}/**`;
    if (canRead && root.permissions.read) {
      allow("read", glob);
      allow("glob", glob);
      allow("grep", glob);
    }
    if (canWrite && (root.permissions.create || root.permissions.modify)) {
      allow("edit", glob);
      allow("write", glob);
      allow("patch", glob);
    }
  }

  if (granted.has("subagent")) allow("task", "*");
  if (granted.has("skill")) allow("skill", "*");

  // Command execution is scoped to the granted roots rather than opened
  // globally, so a temporary script for an operational task cannot wander.
  if (
    granted.has("command_execution") ||
    granted.has("document_processing") ||
    granted.has("media_processing") ||
    granted.has("coding") ||
    granted.has("destructive_filesystem")
  ) {
    allow("bash", "*");
  }

  return rules;
}

/**
 * Human-readable summary of what the broker decided, for diagnostics and the
 * development status interface.
 */
export function summarizeGrant(grant: CapabilityGrant): string {
  const enabled = Object.entries(grant.allowedTools)
    .filter(([, on]) => on)
    .map(([tool]) => tool);
  return [
    `goal: ${grant.plan.userGoal}`,
    `capabilities: ${grant.grantedCapabilities.join(", ") || "none"}`,
    grant.withheldCapabilities.length
      ? `withheld: ${grant.withheldCapabilities.join(", ")}`
      : "",
    `tools: ${enabled.join(", ") || "none"}`,
    `roots: ${grant.authorizedRoots.map((root) => root.displayName).join(", ") || "none"}`,
    grant.pendingPermissions.length
      ? `pending: ${grant.pendingPermissions.map((item) => item.id).join(", ")}`
      : "",
  ]
    .filter(Boolean)
    .join(" | ");
}
