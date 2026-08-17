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
import type { HermesSurface } from "./config.ts";
import {
  AGENT_LOOP_TOOLS,
  ARTIFACT_TOOLS,
  CALENDAR_TOOLS,
  GADGET_TOOLS,
  DOCUMENT_SKILL_TOOLS,
  MEMORY_TOOLS,
  SKILL_LESSON_TOOLS,
  MESSAGING_TOOLS,
  MANIM_TOOLS,
  MAP_TOOLS,
  OFFICE_TOOLS,
  WATERMARK_TOOLS,
  OMH_TOOLS,
  PLAN_TOOLS,
  IMAGE_TO_3D_TOOLS,
  AUDIO_ANALYSIS_TOOLS,
  PREMORTEM_TOOLS,
  FACTCHECK_TOOLS,
  RECALL_TOOLS,
  SUPER_AGENT_TOOLS,
  WATCH_TOOLS,
  WORKSPACE_TOOLS,
  WORLDMONITOR_TOOLS,
} from "./tool-scopes.ts";
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
  // Reading the folder tree says nothing about a note's contents, so it is a
  // read even though the tools that act on it are writes.
  "garden_list_files",
] as const;

const GARDEN_WRITE_TOOLS = [
  "garden_run_proposal_validation",
  "garden_save_note",
  "garden_create_folder",
  "garden_move_page",
  "garden_rename_folder",
  "garden_delete_folder",
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
      ...GADGET_TOOLS,
      ...MEMORY_TOOLS,
      ...SKILL_LESSON_TOOLS,
      ...DOCUMENT_SKILL_TOOLS,
      ...PREMORTEM_TOOLS,
      ...FACTCHECK_TOOLS,
      ...WATCH_TOOLS,
      ...IMAGE_TO_3D_TOOLS,
      ...AUDIO_ANALYSIS_TOOLS,
      ...MANIM_TOOLS,
      ...AGENT_LOOP_TOOLS,
      ...OMH_TOOLS,
      ...MESSAGING_TOOLS,
      ...RECALL_TOOLS,
      ...WORLDMONITOR_TOOLS,
      ...MAP_TOOLS,
      ...CALENDAR_TOOLS,
      ...PLAN_TOOLS,
      ...OFFICE_TOOLS,
      ...WATERMARK_TOOLS,
      ...WORKSPACE_TOOLS,
      ...SUPER_AGENT_TOOLS,
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
  surface: HermesSurface;
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
  /** Whether this delivery surface can present an interactive command approval. */
  interactiveApprovals?: boolean;
  /**
   * The user had Super agent on for this message. It opens the inventory tools
   * (`skill_open`, `workflow_run`, `agent_launch`) on the authenticated
   * conversational surfaces; it never widens filesystem, command, or isolation
   * authority, and `agent_launch` only queues a launch the surface still
   * performs under the user's confirmation.
   */
  superAgent?: boolean;
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
      // Deletion is authorized against identified targets, never against the
      // grant list in general. A standing approval that happens to carry the
      // delete bit for one folder is not authority to remove whatever an
      // unresolved request meant, so an untargeted deletion asks instead of
      // borrowing it.
      if (capability === "destructive_filesystem" && pathResources.length === 0) {
        withheld.add(capability);
        pending.push(
          ...buildFilesystemRequests(capability, operations, input.plan, []),
        );
        continue;
      }
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
  const allowedTools = buildToolMap(
    granted,
    input.surface,
    input.userId !== null,
    {
      superAgent: input.superAgent === true && !isolated,
      interactiveApprovals: input.interactiveApprovals !== false,
    },
  );
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
    // steps, so we only block when the *first* step is blocked. Removal is the
    // exception: a turn whose point is deletion must not run with deletion
    // withheld, because the only thing left for it to do is improvise an
    // explanation of authority the server already decided it does not have.
    executable:
      (pendingPermissions.length === 0 ||
        firstStepIsSatisfied(input.plan, granted)) &&
      !withheld.has("destructive_filesystem"),
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
  surface: HermesSurface,
  authenticated: boolean,
  options: { superAgent?: boolean; interactiveApprovals?: boolean } = {},
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
  const needsTerminal = [
    "filesystem_read",
    "filesystem_write",
    "destructive_filesystem",
    "document_processing",
    "media_processing",
    "command_execution",
    "coding",
  ].some((capability) => granted.has(capability as TaskCapability));
  map.terminal_execute_command =
    authenticated &&
    surface === "dashboard_terminal" &&
    needsTerminal &&
    options.interactiveApprovals !== false;
  for (const tool of ARTIFACT_TOOLS) {
    map[tool] = authenticated && (surface === "dashboard_terminal" || surface === "garden_chat");
  }
  // A gadget is an artifact, so it follows the artifact rule exactly: the two
  // authenticated conversational surfaces, never anonymous Quartz.
  for (const tool of GADGET_TOOLS) {
    map[tool] = authenticated && (surface === "dashboard_terminal" || surface === "garden_chat");
  }
  // Durable memory is always available to the authenticated conversational
  // surfaces regardless of the turn's capability class: saving a preference on
  // a plain knowledge turn must work. Anonymous Quartz never receives it.
  for (const tool of MEMORY_TOOLS) {
    map[tool] = authenticated && (surface === "dashboard_terminal" || surface === "garden_chat");
  }
  // A lesson is recorded at the moment a skill's guidance turns out to be wrong
  // here, which can happen on any kind of turn — the skill may have been in play
  // for a plain knowledge question. So this follows memory's scope rather than
  // the turn's capability class, and is likewise never given to anonymous Quartz.
  for (const tool of SKILL_LESSON_TOOLS) {
    map[tool] = authenticated && (surface === "dashboard_terminal" || surface === "garden_chat");
  }
  // Reading a distilled document is how the model answers a question about a
  // file the user attached, so it cannot depend on the turn's capability class
  // either — asking "what does chapter 4 say" is a plain knowledge turn. The
  // reader is read-only and scoped to the session user's own skills.
  for (const tool of DOCUMENT_SKILL_TOOLS) {
    map[tool] = authenticated && (surface === "dashboard_terminal" || surface === "garden_chat");
  }
  for (const tool of PREMORTEM_TOOLS) {
    map[tool] = authenticated && (surface === "dashboard_terminal" || surface === "garden_chat");
  }
  // "Is this video bullshit?" is a knowledge question, not coding work, so like
  // the premortem callback this does not depend on the turn's capability class.
  // What it reaches is a public URL and the turn's own workspace; the scripts
  // are read-only apart from the report gate rewriting a line in a report this
  // same turn wrote.
  for (const tool of FACTCHECK_TOOLS) {
    map[tool] = authenticated && (surface === "dashboard_terminal" || surface === "garden_chat");
  }
  // Loop design is a knowledge-work activity: it reads and writes only the
  // session's own workspace, so it does not depend on the turn's coding class.
  for (const tool of AGENT_LOOP_TOOLS) {
    map[tool] = authenticated && (surface === "dashboard_terminal" || surface === "garden_chat");
  }
  // Asking OMH which workflow a request belongs to is advisory reading over the
  // clone's own local catalogs, so like loop design it does not depend on the
  // turn's capability class.
  for (const tool of OMH_TOOLS) {
    map[tool] = authenticated && (surface === "dashboard_terminal" || surface === "garden_chat");
  }
  // Sending to the user's own phone is an errand, not a capability class: it
  // does not depend on the turn being coding work, and the destination is the
  // owner's own account either way. Anonymous Quartz never gets it (below).
  for (const tool of MESSAGING_TOOLS) {
    map[tool] = authenticated && (surface === "dashboard_terminal" || surface === "garden_chat");
  }
  for (const tool of WATCH_TOOLS) {
    map[tool] = authenticated && surface === "dashboard_terminal";
  }
  // Reconstructing an attached picture needs no workspace and no filesystem, so
  // unlike Watch it is not confined to the Terminal. The skill still has to be
  // selected for the turn, and the route still resolves the picture from a
  // message this user owns.
  for (const tool of IMAGE_TO_3D_TOOLS) {
    map[tool] = authenticated && (surface === "dashboard_terminal" || surface === "garden_chat");
  }
  // Analysing an attached track needs no workspace either: the route resolves
  // the stored file from a message this user owns, so the tool cannot be aimed
  // at anything else. Same rule as the 3D tool, and for the same reason.
  for (const tool of AUDIO_ANALYSIS_TOOLS) {
    map[tool] = authenticated && (surface === "dashboard_terminal" || surface === "garden_chat");
  }
  // Manim receives source, not a host path. Its route validates the selected
  // skill and renders inside a network-disabled container on both chat surfaces.
  for (const tool of MANIM_TOOLS) {
    map[tool] = authenticated && (surface === "dashboard_terminal" || surface === "garden_chat");
  }
  // "What was I doing at four?" is a plain knowledge turn, so Recall does not
  // depend on the turn's capability class either. What it can reach is decided
  // by the user's own Recall settings, checked on every call server-side.
  for (const tool of RECALL_TOOLS) {
    map[tool] = authenticated && (surface === "dashboard_terminal" || surface === "garden_chat");
  }
  // "What is happening in Taiwan" and "what's on my calendar tomorrow" are
  // plain knowledge turns too, so neither depends on the turn's capability
  // class. Both are reads: the monitor has no user state at all, and the
  // calendar tools reach only the store's query methods.
  for (const tool of [...WORLDMONITOR_TOOLS, ...CALENDAR_TOOLS]) {
    map[tool] = authenticated && (surface === "dashboard_terminal" || surface === "garden_chat");
  }
  // "How far is the station" is a plain knowledge turn as well, and it is the
  // one where being wrong is least visible: a model that answers it from memory
  // sounds exactly like one that looked it up. So the map tools follow the same
  // rule as the monitor and the calendar — always available to the
  // authenticated conversational surfaces, independent of the turn's capability
  // class — because the alternative to having them is not silence, it is a
  // confident guess.
  for (const tool of MAP_TOOLS) {
    map[tool] = authenticated && (surface === "dashboard_terminal" || surface === "garden_chat");
  }
  // "Add a card for the Berlin follow-up" is a plain knowledge turn too, so the
  // board does not depend on the turn's capability class either. It is the one
  // scope here that writes, which is deliberate: a board the assistant can read
  // but not keep would need the user to transcribe everything it worked out.
  // Its writes are all reversible and none of them delete anything.
  for (const tool of PLAN_TOOLS) {
    map[tool] = authenticated && (surface === "dashboard_terminal" || surface === "garden_chat");
  }
  // "Draft the report as a .docx" is document work over the turn's own
  // workspace, so like loop design it does not depend on the turn's capability
  // class. Every file OfficeCLI touches is confined to that workspace, and the
  // export path reuses artifact_import's containment.
  for (const tool of OFFICE_TOOLS) {
    map[tool] = authenticated && (surface === "dashboard_terminal" || surface === "garden_chat");
  }
  // "What metadata does this photo carry?" and "strip the Content Credentials
  // from it" are hygiene over the user's own files, so like document authoring
  // they do not depend on the turn's capability class. The scripts only ever
  // see the turn's workspace or a file the user attached to this very
  // conversation, and cleaning writes a new copy rather than overwriting.
  for (const tool of WATERMARK_TOOLS) {
    map[tool] = authenticated && (surface === "dashboard_terminal" || surface === "garden_chat");
  }
  // The build loop works the same directory OfficeCLI and the loop kit already
  // work, so it follows the same rule: no dependence on the turn's capability
  // class, because nothing here reaches the user's filesystem. That is the whole
  // reason these exist instead of Hermes's own `file` toolset, whose tools take
  // absolute paths and would need the filesystem capability classes to mean
  // something they cannot enforce.
  for (const tool of WORKSPACE_TOOLS) {
    map[tool] = authenticated && (surface === "dashboard_terminal" || surface === "garden_chat");
  }
  // The inventory tools exist for the turn the user asked to be run that way.
  // Outside a super-agent turn they stay off, so an ordinary turn cannot pull an
  // arbitrary skill's guidance or fire one of the user's automations.
  for (const tool of SUPER_AGENT_TOOLS) {
    map[tool] =
      options.superAgent === true &&
      authenticated &&
      (surface === "dashboard_terminal" || surface === "garden_chat");
  }
  // Garden and Quartz are always grounded in their current authorized Garden,
  // even when the user's wording does not repeat the word "garden".
  if (surface === "garden_chat" || surface === "quartz_ai") {
    for (const tool of GARDEN_READ_TOOLS) map[tool] = true;
  }
  if (surface !== "dashboard_terminal") {
    for (const tool of [...FS_READ_TOOLS, ...FS_WRITE_TOOLS, ...WATCH_TOOLS, "bash", "shell", "terminal_execute_command"]) {
      map[tool] = false;
    }
  }
  if (surface === "quartz_ai") {
    for (const tool of ARTIFACT_TOOLS) map[tool] = false;
    for (const tool of GADGET_TOOLS) map[tool] = false;
    for (const tool of PREMORTEM_TOOLS) map[tool] = false;
    // Fetching arbitrary URLs and writing files belongs to a signed-in
    // workspace, not to the anonymous public surface.
    for (const tool of FACTCHECK_TOOLS) map[tool] = false;
    for (const tool of AGENT_LOOP_TOOLS) map[tool] = false;
    for (const tool of OMH_TOOLS) map[tool] = false;
    for (const tool of MESSAGING_TOOLS) map[tool] = false;
    for (const tool of RECALL_TOOLS) map[tool] = false;
    // Quartz AI is the anonymous public surface: the calendar is one person's
    // schedule, and the monitor is a signed-in feature of the dashboard.
    for (const tool of WORLDMONITOR_TOOLS) map[tool] = false;
    for (const tool of CALENDAR_TOOLS) map[tool] = false;
    // Geographic state is one signed-in person's map session, and this surface
    // is the anonymous public one.
    for (const tool of MAP_TOOLS) map[tool] = false;
    // The board is one person's work, and this surface is the anonymous public
    // one — doubly disqualifying, since these tools also write.
    for (const tool of PLAN_TOOLS) map[tool] = false;
    // Office documents live in one person's workspace, and these tools write.
    for (const tool of OFFICE_TOOLS) map[tool] = false;
    // The files these read are one person's uploads and one person's workspace,
    // and this surface is the anonymous public one.
    for (const tool of WATERMARK_TOOLS) map[tool] = false;
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
      // Hermes checks external_directory before it checks the read tool's
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
