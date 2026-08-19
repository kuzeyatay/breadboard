/**
 * What a turn used, above the level of a single tool call.
 *
 * The evidence rows answer "which calls did it make". They cannot answer the
 * question a person actually asks of a super-agent turn — *which of my
 * capabilities did it reach for?* — because a capability does not appear in the
 * transcript under its own name. Watch shows up as a `watch_run` row, a
 * connected account as `mcp_call`, one of the user's own automations as
 * `workflow_run`. Three different-looking rows, and no way to tell from the
 * panel that the first of them is the `/watch` skill the user never typed.
 *
 * This module is that missing layer. It is deliberately pure and deliberately
 * conservative: everything it reports is either a selection Breadboard recorded
 * before dispatch, or a tool call that actually completed. Nothing here infers
 * that a capability was "used" from the fact that it was available — on a
 * super-agent turn the whole catalogue is available, and reporting that as use
 * would turn provenance into advertising.
 */

export type CapabilityKind = "skill" | "connection" | "workflow" | "integration";

/**
 * How a capability came to be in the turn. The distinction matters most for
 * `automatic`: that is Breadboard deciding on the user's behalf — a pasted
 * video link selecting Watch — and it is the one case where a person can be
 * surprised by what ran. It is never inferred; it is only ever reported for a
 * selection recorded before the model was dispatched.
 */
export type CapabilitySelection = "requested" | "automatic" | "agent";

export interface CapabilityUse {
  kind: CapabilityKind;
  /** Skill slug, connection slug, or workflow id. */
  id: string;
  label: string;
  selection: CapabilitySelection;
  /** Why an automatic selection fired, in the user's terms. */
  reason?: string;
  /** Tool calls attributed to it. Zero means selected but never actually used. */
  calls: number;
  /** How many of those failed. */
  failures: number;
  /** The slash command that names it, where one exists. */
  command?: string;
  /** The specific actions taken through it — connection tool names, mostly. */
  actions?: string[];
}

/**
 * The whole capability picture for one turn, as persisted on the verification
 * summary. `superAgent` and `inventory` describe what was on the table;
 * `used` describes what was taken off it. Keeping both is the point: "the agent
 * had 118 skills available and opened one of them" is a materially different
 * turn from "the agent had one skill and used it".
 */
export interface CapabilitySummary {
  superAgent: boolean;
  inventory?: { skills: number; connections: number; workflows: number };
  used: CapabilityUse[];
}

/**
 * Capabilities put in play before the model wrote a word, recorded on the run
 * so the finished answer is described against decisions it could not influence
 * — the same discipline the map, web and research grounding blocks already use.
 */
export interface TurnCapabilitySelection {
  superAgent?: boolean;
  skills?: Array<{
    slug: string;
    name?: string;
    selection: "requested" | "automatic";
    reason?: string;
  }>;
  /** Connections the user named with a slash command. */
  connections?: Array<{ slug: string; name?: string }>;
  /** The user's own automations this turn could run, so a run can be named. */
  workflows?: Array<{ id: string; name: string }>;
  /** Sizes of a super-agent inventory. What was offered, never what was used. */
  inventory?: { skills: number; connections: number; workflows: number };
}

interface ToolOwner {
  kind: CapabilityKind;
  id: string;
  label: string;
}

/**
 * Tools that belong to a named capability rather than to the runtime itself.
 *
 * Most of these are enforced elsewhere: the `watch_run` route refuses to run
 * unless the `watch` skill is selected for the turn, and so on down the list.
 * That gate is what makes this table a fact about the system rather than a
 * guess — a `watch_run` row in the ledger could not exist without the Watch
 * skill having been selected.
 */
const TOOL_OWNERS: Record<string, ToolOwner> = {
  watch_run: { kind: "skill", id: "watch", label: "Watch" },
  factcheck_run: { kind: "skill", id: "bullshit-detector", label: "Fact check" },
  premortem_run: { kind: "skill", id: "premortem", label: "Premortem" },
  omh_run: { kind: "skill", id: "oh-my-hermes", label: "Oh My Hermes" },
  messaging_send: {
    kind: "skill",
    id: "send-to-my-phone",
    label: "Send to my phone",
  },
  manim_create: { kind: "skill", id: "manim", label: "Manim" },
  image_to_3d: { kind: "skill", id: "image-to-3d", label: "Image to 3D" },
  audio_analyze: { kind: "skill", id: "audio-analysis", label: "Audio analysis" },
  audio_compare: { kind: "skill", id: "audio-analysis", label: "Audio analysis" },
  agent_loop_run: {
    kind: "skill",
    id: "agent-loop-engineering",
    label: "Agent loop engineering",
  },
  office_run: { kind: "skill", id: "office", label: "Office documents" },
  office_export: { kind: "skill", id: "office", label: "Office documents" },
  watermark_inspect: {
    kind: "skill",
    id: "remove-ai-marks",
    label: "Remove AI marks",
  },
  watermark_clean: {
    kind: "skill",
    id: "remove-ai-marks",
    label: "Remove AI marks",
  },
  watermark_audit: {
    kind: "skill",
    id: "remove-ai-marks",
    label: "Remove AI marks",
  },
  gadget_bindings: {
    kind: "skill",
    id: "generate-gadget",
    label: "Gadget builder",
  },
  gadget_generate: {
    kind: "skill",
    id: "generate-gadget",
    label: "Gadget builder",
  },
  gadget_revise: {
    kind: "skill",
    id: "generate-gadget",
    label: "Gadget builder",
  },
};

/**
 * Products of Breadboard's own that a turn can reach into. Not skills — nobody
 * installed them and there is no slash command — but a reader asking "what did
 * this answer touch" wants the calendar and the screen history named, not
 * eleven rows of tool identifiers.
 */
const INTEGRATION_PREFIXES: Array<{ prefix: string; id: string; label: string }> = [
  { prefix: "map_", id: "maps", label: "Maps" },
  { prefix: "calendar_", id: "calendar", label: "Calendar" },
  { prefix: "plan_", id: "plan", label: "Plan board" },
  { prefix: "recall_", id: "recall", label: "Recall" },
  { prefix: "worldmonitor_", id: "worldmonitor", label: "World Monitor" },
  { prefix: "garden_", id: "garden", label: "Garden" },
  { prefix: "gbrain_", id: "gbrain", label: "GBrain" },
  { prefix: "research_", id: "research", label: "Research pipeline" },
];

/** The capability a completed tool call belongs to, or null for a plain tool. */
export function capabilityForTool(toolName: string): ToolOwner | null {
  const name = toolName.trim().toLowerCase();
  if (!name) return null;
  const owned = TOOL_OWNERS[name];
  if (owned) return owned;
  for (const entry of INTEGRATION_PREFIXES) {
    if (name.startsWith(entry.prefix)) {
      return { kind: "integration", id: entry.id, label: entry.label };
    }
  }
  if (name === "save_memory") {
    return { kind: "integration", id: "memory", label: "Durable memory" };
  }
  return null;
}

/**
 * Why Breadboard selected a skill the user did not ask for. Each line states
 * the selector's own criterion, which is the only thing that is actually known:
 * the selector fired because that criterion held.
 */
export const AUTOMATIC_SELECTION_REASONS: Record<string, string> = {
  watch: "The message carried a video.",
  "bullshit-detector": "The message asked for a claim to be checked.",
  premortem: "The message asked for a plan to be pressure-tested.",
  "interactive-visualizer":
    "The request asked for something to be shown rather than described.",
  "interactive-visualizer-in-chat":
    "The request asked for something to be shown rather than described.",
  "send-to-my-phone": "The message asked for this to be sent to your phone.",
  "image-to-3d": "The message asked for a 3D model of an attached picture.",
  "audio-analysis": "The message was about an attached track.",
  "diagram-design": "The message asked for a diagram.",
};

interface Accumulated {
  kind: CapabilityKind;
  id: string;
  label: string;
  selection: CapabilitySelection;
  reason?: string;
  calls: number;
  failures: number;
  actions: string[];
}

const KIND_ORDER: Record<CapabilityKind, number> = {
  skill: 0,
  connection: 1,
  workflow: 2,
  integration: 3,
};

function slashCommand(entry: Accumulated): string | undefined {
  if (entry.kind === "skill") return `/${entry.id}`;
  if (entry.kind === "connection") return `/${entry.id}`;
  return undefined;
}

/**
 * Fold the turn's pre-dispatch selections and its completed calls into one list.
 *
 * A capability appears here for exactly two reasons: Breadboard selected it
 * before dispatch (so the user is owed the fact that it was in play, even if it
 * went unused), or a call attributed to it completed. A capability that was
 * merely *available* — the whole point of a super-agent turn — never appears.
 */
export function summarizeCapabilityUse(input: {
  selection?: TurnCapabilitySelection | null;
  toolCalls?: Array<{ toolName?: unknown; success?: unknown }>;
  /** `skill_open` calls, which name their skill in an argument, not a tool name. */
  skillOpens?: Array<{ slug: string }>;
  /** `mcp_call` calls, which name the connection and its action in arguments. */
  connectionCalls?: Array<{ slug: string; tool?: string; success: boolean }>;
  /** `workflow_run` calls, which name one of the user's own automations. */
  workflowRuns?: Array<{ workflowId: string; success: boolean }>;
}): CapabilitySummary {
  const selection = input.selection ?? {};
  const entries = new Map<string, Accumulated>();
  const key = (kind: CapabilityKind, id: string) => `${kind}:${id}`;

  const upsert = (
    kind: CapabilityKind,
    id: string,
    label: string,
    selectionKind: CapabilitySelection,
    reason?: string,
  ): Accumulated => {
    const existing = entries.get(key(kind, id));
    if (existing) {
      // A recorded pre-dispatch selection is stronger than the fallback the
      // caller assumed for a bare tool call, and must not be overwritten by it.
      if (existing.selection === "agent" && selectionKind !== "agent") {
        existing.selection = selectionKind;
        if (reason) existing.reason = reason;
      }
      return existing;
    }
    const created: Accumulated = {
      kind,
      id,
      label,
      selection: selectionKind,
      ...(reason ? { reason } : {}),
      calls: 0,
      failures: 0,
      actions: [],
    };
    entries.set(key(kind, id), created);
    return created;
  };

  for (const skill of selection.skills ?? []) {
    if (!skill?.slug) continue;
    upsert(
      "skill",
      skill.slug,
      skill.name?.trim() || labelForSlug(skill.slug),
      skill.selection,
      skill.selection === "automatic"
        ? skill.reason?.trim() || AUTOMATIC_SELECTION_REASONS[skill.slug]
        : undefined,
    );
  }
  for (const connection of selection.connections ?? []) {
    if (!connection?.slug) continue;
    upsert(
      "connection",
      connection.slug,
      connection.name?.trim() || labelForSlug(connection.slug),
      "requested",
    );
  }

  const workflowNames = new Map(
    (selection.workflows ?? []).map((workflow) => [workflow.id, workflow.name]),
  );

  for (const call of input.toolCalls ?? []) {
    const toolName = typeof call?.toolName === "string" ? call.toolName : "";
    const owner = capabilityForTool(toolName);
    if (!owner) continue;
    // A tool call is only ever attributed to a capability the turn actually
    // reached. If nothing recorded a selection for it, the model chose it from
    // the inventory it was handed — which is exactly what `agent` means.
    const entry = upsert(owner.kind, owner.id, owner.label, "agent");
    entry.calls += 1;
    if (call.success === false) entry.failures += 1;
  }

  for (const open of input.skillOpens ?? []) {
    if (!open?.slug) continue;
    const entry = upsert("skill", open.slug, labelForSlug(open.slug), "agent");
    entry.calls += 1;
    if (!entry.actions.includes("opened")) entry.actions.push("opened");
  }

  for (const call of input.connectionCalls ?? []) {
    if (!call?.slug) continue;
    const entry = upsert(
      "connection",
      call.slug,
      labelForSlug(call.slug),
      "agent",
    );
    entry.calls += 1;
    if (!call.success) entry.failures += 1;
    const action = call.tool?.trim();
    if (action && !entry.actions.includes(action)) entry.actions.push(action);
  }

  for (const run of input.workflowRuns ?? []) {
    if (!run?.workflowId) continue;
    const entry = upsert(
      "workflow",
      run.workflowId,
      workflowNames.get(run.workflowId)?.trim() || `Automation ${run.workflowId}`,
      "agent",
    );
    entry.calls += 1;
    if (!run.success) entry.failures += 1;
  }

  const used = [...entries.values()]
    .sort((left, right) => {
      const byKind = KIND_ORDER[left.kind] - KIND_ORDER[right.kind];
      if (byKind !== 0) return byKind;
      // Something that ran outranks something that was merely selected: the
      // first is what the answer stands on, the second only context for it.
      if (left.calls !== right.calls) return right.calls - left.calls;
      return left.label.localeCompare(right.label);
    })
    .map((entry) => {
      const command = slashCommand(entry);
      return {
        kind: entry.kind,
        id: entry.id,
        label: entry.label,
        selection: entry.selection,
        ...(entry.reason ? { reason: entry.reason } : {}),
        calls: entry.calls,
        failures: entry.failures,
        ...(command ? { command } : {}),
        ...(entry.actions.length ? { actions: entry.actions } : {}),
      } satisfies CapabilityUse;
    });

  return {
    superAgent: selection.superAgent === true,
    ...(selection.inventory ? { inventory: selection.inventory } : {}),
    used,
  };
}

/**
 * Turn Breadboard's own pre-dispatch bookkeeping into the block that travels on
 * the run. The two callers — the Terminal turn service and the Garden chat
 * adapter — resolve commands the same way and differ only in what they have to
 * offer, so the shape of "what was selected" is decided once, here.
 *
 * The rule that keeps this honest: a skill is `automatic` only when Breadboard
 * selected it *and* the resolver kept it. An automatic selection that was
 * dropped by the availability fallback never ran, and reporting it would be a
 * claim about the turn that the turn cannot support.
 */
export function turnCapabilitySelection(input: {
  invocations: ReadonlyArray<{ kind: string; slug: string }>;
  /** Slugs Breadboard selected from the message, with why, where it knows. */
  automaticSkills?: ReadonlyArray<{ slug: string; reason?: string }>;
  superAgent?: boolean;
  inventory?: { skills: number; connections: number; workflows: number };
  /** Named so a `workflow_run` can be reported as the automation it ran. */
  workflows?: ReadonlyArray<{ id: string; name: string }>;
  skillNames?: ReadonlyMap<string, string>;
}): TurnCapabilitySelection {
  const automatic = new Map(
    (input.automaticSkills ?? []).map((entry) => [entry.slug, entry.reason]),
  );
  const skills = input.invocations
    .filter((invocation) => invocation.kind === "skill" && invocation.slug)
    .map((invocation) => {
      const reason = automatic.get(invocation.slug);
      const name = input.skillNames?.get(invocation.slug);
      return {
        slug: invocation.slug,
        ...(name ? { name } : {}),
        selection: automatic.has(invocation.slug)
          ? ("automatic" as const)
          : ("requested" as const),
        ...(reason ? { reason } : {}),
      };
    });
  const connections = input.invocations
    .filter((invocation) => invocation.kind === "mcp" && invocation.slug)
    .map((invocation) => ({ slug: invocation.slug }));
  return {
    ...(input.superAgent ? { superAgent: true } : {}),
    ...(skills.length ? { skills } : {}),
    ...(connections.length ? { connections } : {}),
    ...(input.workflows?.length
      ? { workflows: input.workflows.map((w) => ({ id: w.id, name: w.name })) }
      : {}),
    ...(input.inventory ? { inventory: input.inventory } : {}),
  };
}

/** "bullshit-detector" -> "Bullshit detector". Only ever a fallback label. */
export function labelForSlug(slug: string): string {
  const words = slug.replace(/[_-]+/g, " ").trim();
  if (!words) return slug;
  return words.charAt(0).toUpperCase() + words.slice(1);
}
