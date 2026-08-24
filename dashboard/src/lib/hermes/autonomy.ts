// How much the agent may do without asking, and what it must always ask about.
//
// The switch this replaces was binary: off meant every capability the plan
// needed paused the turn for a permission card, on meant every one of them was
// granted automatically. That is a bad shape for the same reason a car with
// one pedal is: reading a folder and deleting one are not the same act, and a
// user who wants the first without the second has no way to say so.
//
// So the switch selects a tier, and each capability carries a risk class. A
// tier auto-approves everything at or below its ceiling and stops at anything
// above it — reading a project folder proceeds while `rm -rf` still waits for
// a human, from the same switch position.
//
// Two things are deliberately not changed. Nothing here can approve something
// the capability broker did not already decide the plan needs; this only
// chooses whether the user is asked. And every automatic approval is written
// to the audit log with its tier and its class, because an action taken
// without being asked about is exactly the one you want a record of.

import type { PendingPermission } from "./capability-broker.ts";
import type { TaskCapability } from "./task-plan.ts";

/**
 * The three positions, from most cautious to least.
 *
 * `supervised` is the switch off: nothing that needs a grant proceeds without
 * one. `autonomous` is the switch on, and it is the default — it is exactly
 * what the switch has always done, and changing what an existing switch means
 * under someone is not a change to make on their behalf. `semi_autonomous`
 * sits between them for anyone who wants it, and has to be chosen.
 */
export type AutonomyTier = "supervised" | "semi_autonomous" | "autonomous";

export const AUTONOMY_TIERS: readonly AutonomyTier[] = [
  "supervised",
  "semi_autonomous",
  "autonomous",
];

/** The switch's long-standing behaviour. Opt into anything narrower. */
export const DEFAULT_AUTONOMY_TIER: AutonomyTier = "autonomous";

/**
 * What kind of act a capability is, in the terms a person would use.
 *
 * `read` looks at something. `write` changes something that can be changed
 * back. `network` sends something outward, which cannot be recalled. `install`
 * changes the machine's own tooling. `destructive` removes something, and is
 * the class that never auto-approves below the top tier.
 */
export type RiskClass = "read" | "write" | "network" | "install" | "destructive";

export const RISK_ORDER: readonly RiskClass[] = [
  "read",
  "write",
  "network",
  "install",
  "destructive",
];

// The highest class each tier acts on unasked. Written out rather than
// derived, so the table is the documentation.
const CEILINGS: Record<AutonomyTier, RiskClass | null> = {
  // Nothing. A capability that reached the broker as pending is by definition
  // one the user has not granted, and supervised means they are asked.
  supervised: null,
  // Reversible work and outbound reads proceed. Anything that changes the
  // machine's own tooling or removes data stops.
  semi_autonomous: "network",
  autonomous: "destructive",
};

const CAPABILITY_RISK: Record<TaskCapability, RiskClass> = {
  conversation: "read",
  garden_read: "read",
  filesystem_read: "read",
  memory: "read",
  document_processing: "read",
  media_processing: "read",
  garden_write: "write",
  filesystem_write: "write",
  coding: "write",
  application_action: "write",
  web_research: "network",
  mcp: "network",
  subagent: "network",
  // A skill can run its own scripts, and a command can install anything. Both
  // sit above ordinary writes because what they do is not bounded by what the
  // plan said they would do.
  skill: "install",
  command_execution: "install",
  destructive_filesystem: "destructive",
  destructive_system_action: "destructive",
};

/** Where a capability sits. Unknown capabilities are treated as destructive. */
export function riskClassForCapability(capability: TaskCapability): RiskClass {
  return CAPABILITY_RISK[capability] ?? "destructive";
}

/**
 * Where a pending permission sits.
 *
 * The capability is the main signal, but a filesystem request that asks for
 * delete is destructive whatever capability carried it — the operations are
 * the more specific claim, so they win.
 */
export function riskClassForPermission(permission: PendingPermission): RiskClass {
  const operations = permission.operations ?? [];
  // Removing or relocating a file is not undoable from inside the turn, so it
  // is destructive regardless of which capability asked.
  if (operations.some((operation) => operation === "delete" || operation === "move")) {
    return "destructive";
  }
  // Running a file is how a bounded write becomes an unbounded one.
  if (operations.includes("execute")) return "install";

  const base = riskClassForCapability(permission.capability);
  const writes = operations.some(
    (operation) => operation === "create" || operation === "modify",
  );
  if (permission.kind === "filesystem" && writes) {
    return rank(base) > rank("write") ? base : "write";
  }
  if (permission.kind === "connection") {
    return rank(base) > rank("network") ? base : "network";
  }
  return base;
}

function rank(risk: RiskClass): number {
  return RISK_ORDER.indexOf(risk);
}

/** Does this tier act on this class without asking? */
export function tierAllows(tier: AutonomyTier, risk: RiskClass): boolean {
  const ceiling = CEILINGS[tier];
  if (ceiling === null) return false;
  return rank(risk) <= rank(ceiling);
}

export interface AutonomyDecision {
  tier: AutonomyTier;
  /** Permissions this tier approves without asking. */
  autoApprove: PendingPermission[];
  /** Permissions that still need a human, with why. */
  withheld: Array<{ permission: PendingPermission; risk: RiskClass }>;
  /** True when the whole turn can proceed unattended. */
  clearsEverything: boolean;
  /** For the audit log and the permission card. */
  summary: string;
}

/**
 * Split what the plan needs into what this tier grants and what it does not.
 *
 * Reports both halves rather than a yes/no, so the caller can approve the
 * grantable part and still raise a card for the rest — which is what makes a
 * middle tier useful instead of just a stricter off.
 */
export function decideAutonomy(input: {
  tier: AutonomyTier;
  pendingPermissions: readonly PendingPermission[];
}): AutonomyDecision {
  const autoApprove: PendingPermission[] = [];
  const withheld: AutonomyDecision["withheld"] = [];

  for (const permission of input.pendingPermissions) {
    const risk = riskClassForPermission(permission);
    if (tierAllows(input.tier, risk)) autoApprove.push(permission);
    else withheld.push({ permission, risk });
  }

  const blockedClasses = Array.from(new Set(withheld.map((entry) => entry.risk)));
  const summary =
    withheld.length === 0
      ? autoApprove.length === 0
        ? "Nothing needed approval."
        : `Approved ${autoApprove.length} request${autoApprove.length === 1 ? "" : "s"} at the ${label(input.tier)} setting.`
      : `${withheld.length} request${withheld.length === 1 ? "" : "s"} still need you: ${blockedClasses.join(", ")}.`;

  return {
    tier: input.tier,
    autoApprove,
    withheld,
    clearsEverything: withheld.length === 0,
    summary,
  };
}

export function label(tier: AutonomyTier): string {
  if (tier === "supervised") return "ask every time";
  if (tier === "semi_autonomous") return "act, but ask before anything destructive";
  return "act without asking";
}

/** Read a stored value defensively; anything unrecognised is the default. */
export function normalizeAutonomyTier(value: unknown): AutonomyTier {
  return typeof value === "string" && (AUTONOMY_TIERS as readonly string[]).includes(value)
    ? (value as AutonomyTier)
    : DEFAULT_AUTONOMY_TIER;
}
