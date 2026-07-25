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

import path from "node:path";
import type { OpenHarnessSurface } from "./config.ts";
import { ARTIFACT_TOOLS } from "./tool-scopes.ts";
import type { TaskCapability, TaskPlan } from "./task-plan.ts";
import {
  candidatePathsForAlias,
  describePermissions,
  isWithinRoot,
  permissionsForCapabilities,
  realPathAllowingMissing,
  type ApprovedFilesystemRoot,
  type FilesystemOperation,
  type FilesystemPermissions,
} from "./filesystem-paths.ts";

function normalizedFolderName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\\/]+$/, "")
    .split(/[\\/]/)
    .at(-1)!
    .replace(/s$/, "");
}

function grantCoversResource(
  grant: ApprovedFilesystemRoot,
  resource: TaskPlan["requiredResources"][number],
): boolean {
  if (resource.kind !== "path") return true;
  if (resource.absolute) {
    return isWithinRoot(
      realPathAllowingMissing(grant.canonicalPath),
      realPathAllowingMissing(resource.value),
    );
  }

  // Spoken aliases are compared by their user-facing/root folder names first,
  // which also keeps tests and imported grants portable across operating
  // systems. Candidate paths then cover redirected folders such as OneDrive.
  const alias = normalizedFolderName(resource.value);
  if (
    normalizedFolderName(grant.displayName) === alias ||
    normalizedFolderName(grant.canonicalPath) === alias
  ) {
    return true;
  }
  const candidates = candidatePathsForAlias(resource.value);
  // A relative code/file path such as src/lib/auth.ts is interpreted within
  // the already granted working root; it is not a well-known-folder alias.
  if (candidates.length === 0) return true;
  return candidates.some((candidate) =>
    isWithinRoot(
      realPathAllowingMissing(grant.canonicalPath),
      realPathAllowingMissing(candidate),
    ),
  );
}

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
  /** Exact referenced item, when the grant itself targets its parent folder. */
  targetPath?: string;
  /** Exact referenced items for a bounded multi-file operation. */
  targetPaths?: string[];
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
  "garden_list",
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

const FS_READ_TOOLS = ["read", "glob", "grep"] as const;
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
      "terminal_execute_command",
      ...ARTIFACT_TOOLS,
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
      const operationGrants = input.grants.filter((grant) =>
        operations.every((operation) => grant.permissions[operation]),
      );
      const pathResources = input.plan.requiredResources.filter(
        (resource) => resource.kind === "path",
      );
      const satisfying = pathResources.length
        ? operationGrants.filter((grant) =>
            pathResources.some((resource) => grantCoversResource(grant, resource)),
          )
        : operationGrants;
      const everyPathCovered = pathResources.every((resource) =>
        operationGrants.some((grant) => grantCoversResource(grant, resource)),
      );
      if (satisfying.length === 0 || !everyPathCovered) {
        withheld.add(capability);
        const uncovered = pathResources.filter((resource) =>
          !operationGrants.some((grant) => grantCoversResource(grant, resource)),
        );
        pending.push(
          ...buildFilesystemRequests(
            capability,
            operations,
            input.plan,
            uncovered,
          ),
        );
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
  const allowedTools = buildToolMap(granted, input.surface, input.userId !== null);
  const permissionRules = buildPermissionRules(
    granted,
    authorizedRoots,
    input.workspaceRoot,
  );
  const pendingPermissions = coalesceFilesystemRequests(pending, input.plan);

  return {
    plan: input.plan,
    allowedTools,
    permissionRules,
    authorizedRoots,
    grantedCapabilities: [...granted],
    withheldCapabilities: [...withheld],
    pendingPermissions,
    // A turn is executable when nothing it needs is still pending. A plan whose
    // only pending item is a later confirmation step still executes its earlier
    // steps, so we only block when the *first* step is blocked.
    executable:
      pendingPermissions.length === 0 ||
      firstStepIsSatisfied(input.plan, granted),
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

function buildFilesystemRequests(
  capability: TaskCapability,
  operations: FilesystemOperation[],
  plan: TaskPlan,
  resources: TaskPlan["requiredResources"],
): PendingPermission[] {
  const permissions: FilesystemPermissions = permissionsForCapabilities([capability]);
  const pathResources = resources.filter((resource) => resource.kind === "path");
  if (pathResources.length === 0) {
    return [{
      kind: "filesystem",
      id: `fs-${capability}`,
      message: `To ${plan.intendedOutcome.replace(/\.$/, "").toLowerCase()}, ${describePermissions(permissions)}`,
      operations,
      capability,
    }];
  }

  // A spoken alias ("Documents") is not a path the grant API can canonicalize,
  // so resolve it to a concrete candidate location here. This only *proposes* a
  // folder for the user to approve — it confers nothing on its own, and the
  // server re-validates the path when the grant is actually created.
  const groups = new Map<string, { path: string; targets: string[] }>();
  for (const resource of pathResources) {
    const resolvedTarget = resource.absolute
      ? resource.value
      : (candidatePathsForAlias(resource.value)[0] ?? resource.value);
    const grantPath = resource.resourceType === "file"
      ? portableDirname(resolvedTarget)
      : resolvedTarget;
    const key = portable(grantPath).toLowerCase();
    const group = groups.get(key) ?? { path: grantPath, targets: [] };
    if (resource.resourceType === "file") group.targets.push(resolvedTarget);
    groups.set(key, group);
  }

  return [...groups.values()].map((group) => {
    const targets = [...new Map(group.targets.map((target) => [
      portable(target).toLowerCase(),
      target,
    ])).values()];
    const scope = targets.length === 1
      ? ` for ${targets[0]}`
      : targets.length > 1
        ? ` for ${targets.length} identified files in ${group.path}`
        : ` for ${group.path}`;
    return {
      kind: "filesystem" as const,
      id: `fs-${capability}-${portable(group.path)}`,
      message: `To ${plan.intendedOutcome.replace(/\.$/, "").toLowerCase()}${scope}, ${describePermissions(permissions)}`,
      path: group.path,
      ...(targets.length === 1 ? { targetPath: targets[0] } : {}),
      ...(targets.length > 0 ? { targetPaths: targets } : {}),
      operations,
      capability,
    };
  });
}

function portableDirname(value: string): string {
  if (/^[A-Za-z]:[\\/]|^\\/.test(value)) return path.win32.dirname(value);
  if (value.startsWith("/")) return path.posix.dirname(value);
  return path.dirname(value);
}

function coalesceFilesystemRequests(
  pending: readonly PendingPermission[],
  plan: TaskPlan,
): PendingPermission[] {
  const result: PendingPermission[] = [];
  const groups = new Map<string, PendingPermission[]>();
  for (const permission of pending) {
    if (permission.kind !== "filesystem") continue;
    const key = permission.path
      ? portable(permission.path).toLowerCase()
      : `missing:${permission.id}`;
    const group = groups.get(key) ?? [];
    group.push(permission);
    groups.set(key, group);
  }

  const emitted = new Set<string>();
  for (const permission of pending) {
    if (permission.kind !== "filesystem") {
      result.push(permission);
      continue;
    }
    const key = permission.path
      ? portable(permission.path).toLowerCase()
      : `missing:${permission.id}`;
    if (emitted.has(key)) continue;
    emitted.add(key);
    const group = groups.get(key)!;
    if (group.length === 1) {
      result.push(group[0]);
      continue;
    }
    const pathValue = group[0].path;
    const operations = ["read", "create", "modify", "move", "delete", "execute"]
      .filter((operation) => group.some((permission) =>
        permission.operations?.includes(operation as FilesystemOperation))) as FilesystemOperation[];
    const targets = [...new Map(group.flatMap((permission) =>
      permission.targetPaths ?? (permission.targetPath ? [permission.targetPath] : []))
      .map((target) => [portable(target).toLowerCase(), target])).values()];
    const capability = [...group]
      .sort((left, right) => capabilityRisk(right.capability) - capabilityRisk(left.capability))[0]
      .capability;
    const permissions = permissionsFromOperations(operations);
    const scope = targets.length === 1
      ? ` for ${targets[0]}`
      : targets.length > 1
        ? ` for ${targets.length} identified files in ${pathValue}`
        : pathValue
          ? ` for ${pathValue}`
          : "";
    result.push({
      kind: "filesystem",
      id: `fs-${capability}${pathValue ? `-${portable(pathValue)}` : ""}`,
      message: `To ${plan.intendedOutcome.replace(/\.$/, "").toLowerCase()}${scope}, ${describePermissions(permissions)}`,
      path: pathValue,
      ...(targets.length === 1 ? { targetPath: targets[0] } : {}),
      ...(targets.length > 0 ? { targetPaths: targets } : {}),
      operations,
      capability,
    });
  }
  return result;
}

function permissionsFromOperations(
  operations: readonly FilesystemOperation[],
): FilesystemPermissions {
  const has = (operation: FilesystemOperation) => operations.includes(operation);
  return {
    read: has("read"),
    create: has("create"),
    modify: has("modify"),
    move: has("move"),
    delete: has("delete"),
    execute: has("execute"),
  };
}

function capabilityRisk(capability: TaskCapability): number {
  if (capability === "destructive_filesystem") return 4;
  if (capability === "filesystem_write" || capability === "coding") return 3;
  if (capability === "media_processing" || capability === "document_processing") return 2;
  return 1;
}

function buildToolMap(
  granted: ReadonlySet<TaskCapability>,
  surface: OpenHarnessSurface,
  authenticated: boolean,
): Record<string, boolean> {
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
  // Built-in bash cannot validate cwd and command semantics strongly enough for
  // this product boundary. Genuine Terminal access goes through the audited
  // server callback above; Garden and Quartz never receive either executor.
  map.bash = false;
  map.terminal_execute_command = authenticated && surface === "dashboard_terminal";
  for (const tool of ARTIFACT_TOOLS) {
    map[tool] = authenticated && (surface === "dashboard_terminal" || surface === "garden_chat");
  }
  // Garden and Quartz are always grounded in their current authorized Garden,
  // even when the user's wording does not repeat the word "garden".
  if (surface === "garden_chat" || surface === "quartz_ai") {
    for (const tool of GARDEN_READ_TOOLS) map[tool] = true;
  }
  if (surface !== "dashboard_terminal") {
    for (const tool of [...FS_READ_TOOLS, ...FS_WRITE_TOOLS, "bash", "shell", "terminal_execute_command"]) {
      map[tool] = false;
    }
  }
  if (surface === "quartz_ai") {
    for (const tool of ARTIFACT_TOOLS) map[tool] = false;
  }
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
    { permission: "webfetch", pattern: "*", action: "deny" },
    { permission: "websearch", pattern: "*", action: "deny" },
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
      // OpenHarness checks external_directory before it checks the read tool's
      // own permission. Both rules must cover the approved root or an otherwise
      // valid filesystem grant still fails at runtime.
      allow("external_directory", glob);
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
  if (granted.has("web_research")) {
    allow("webfetch", "*");
    allow("websearch", "*");
  }

  // Command execution is scoped to the granted roots rather than opened
  // globally, so a temporary script for an operational task cannot wander.
  // General built-in bash remains denied. The server-owned terminal tool is
  // not an OpenCode permission and performs its own command/root validation.

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
