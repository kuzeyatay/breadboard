// When a conversation becomes a governed loop, and what Hermes is told about it.
//
// The engagement rule is the whole reason this is innate rather than a command:
// nobody types anything to start a loop. A conversation that is plainly
// long-running work picks up durable LoopX state on its own, and every turn
// after that is composed against it.

import type { HermesSurface } from "../hermes/config.ts";
import type { CapabilityMode } from "../hermes/capability-policy.ts";
import { loopxEnabled } from "./runtime.ts";
import { readSnapshot, type LoopxSnapshot } from "./snapshot.ts";

/** A conversation this long is doing sustained work, whatever it is about. */
export const SUSTAINED_TURN_COUNT = 4;

/**
 * Wording that states a horizon longer than the current turn. Kept narrow: a
 * false positive creates durable state for a conversation that did not want it.
 */
const LONG_HORIZON =
  /\b(long[- ]running|over the (?:next|coming) (?:few )?(?:days|weeks|sessions|turns)|across (?:several|multiple) sessions|keep (?:working|going) on|until (?:it is|it's|we're) done|step by step over|for the (?:rest|remainder) of (?:this|the) (?:project|week)|ongoing (?:project|objective|effort)|multi[- ](?:day|week|session)|roadmap for|milestones? for)\b/i;

export interface EngagementInput {
  surface: HermesSurface;
  mode: CapabilityMode;
  userText: string;
  /** User messages in this conversation, including the one being handled. */
  userTurnCount: number;
  hasGoal: boolean;
}

export interface EngagementDecision {
  engaged: boolean;
  reason:
    | "existing_goal"
    | "authorized_implementation"
    | "long_horizon_request"
    | "sustained_conversation"
    | "not_long_running"
    | "surface_excluded";
}

export function decideEngagement(input: EngagementInput): EngagementDecision {
  // Quartz is the public reader surface, where a session can be anonymous and
  // is scoped to one page. Durable objectives do not belong to it.
  if (input.surface === "quartz_ai") {
    return { engaged: false, reason: "surface_excluded" };
  }
  if (input.hasGoal) return { engaged: true, reason: "existing_goal" };
  if (input.mode === "scoped_implementation") {
    return { engaged: true, reason: "authorized_implementation" };
  }
  if (LONG_HORIZON.test(input.userText)) {
    return { engaged: true, reason: "long_horizon_request" };
  }
  if (input.userTurnCount >= SUSTAINED_TURN_COUNT) {
    return { engaged: true, reason: "sustained_conversation" };
  }
  return { engaged: false, reason: "not_long_running" };
}

export interface TurnDelivery {
  outcome: "completed" | "error" | "cancelled";
  /** Tools that actually completed during the turn. */
  toolCalls: number;
  producedArtifact: boolean;
}

export interface DeliveryRecord {
  classification: string;
  scale: string;
  outcome: string;
}

/**
 * How a finished turn is recorded against the loop. A turn that only produced
 * prose is surface progress; a turn that ran tools or produced an artifact is a
 * bounded segment. LoopX's execution profile uses the distinction to notice a
 * loop that has stopped delivering, so it must come from what Breadboard
 * observed, never from what the answer claimed about itself.
 */
export function deliveryFor(turn: TurnDelivery): DeliveryRecord {
  if (turn.outcome !== "completed") {
    return {
      classification: "blocked",
      scale: "single_surface",
      outcome: "outcome_gap",
    };
  }
  const substantive = turn.producedArtifact || turn.toolCalls > 0;
  return {
    classification: "delivered",
    scale: substantive ? "bounded_segment" : "single_surface",
    outcome: substantive ? "outcome_progress" : "surface_only",
  };
}

function line(label: string, value: string | null | undefined): string | null {
  const text = value?.trim();
  return text ? `${label}: ${text}` : null;
}

/**
 * Renders the `# loop_state` system section. The section is descriptive, in the
 * same sense as the capability record: it reports what the control plane holds
 * and what it expects, and grants nothing.
 */
export function renderLoopState(snapshot: LoopxSnapshot): string {
  const gated = snapshot.requiresUserAction && snapshot.userGates.length > 0;
  const sections: (string | null)[] = [
    "# loop_state",
    "This conversation is a long-running objective held in Breadboard's LoopX control plane. The record below is the state as of the end of the previous turn, and it is the state this turn acts on.",
    "",
    line("Objective", snapshot.objective),
    line("Loop decision", `${snapshot.decision}${snapshot.reason ? ` (${snapshot.reason})` : ""}`),
    line("This turn owes", snapshot.obligation),
    line("Lane guidance", snapshot.laneAction),
    line("Next action on record", snapshot.nextAction),
    snapshot.agentTodos.length
      ? `Open agent todos:\n${snapshot.agentTodos.map((todo) => `- ${todo}`).join("\n")}`
      : null,
    gated
      ? `Open owner gates, unresolved:\n${snapshot.userGates.map((gate) => `- ${gate}`).join("\n")}`
      : null,
    line("Stop condition", snapshot.stopCondition),
    snapshot.shouldRun
      ? null
      : "The loop's quota says this turn should not spend on new work. Answer what the user asked and stop there; do not open a new thread of work in the objective.",
    snapshot.mustInclude.length
      ? line(
          "A turn counts as delivered only with",
          snapshot.mustInclude.join(", "),
        )
      : null,
    "",
    gated
      ? "An owner gate is open, so the loop is waiting on a person, not on you. Do the work that does not depend on the gate, then put the gate's question to the user as one concrete decision and stop there. Do not decide it yourself and do not proceed as though it were resolved."
      : "No owner gate is open, so this turn is expected to advance the objective: produce something coherent, check it, and say plainly what is left. If you find that the next step genuinely needs the owner's decision, ask that one question instead of guessing.",
    "Breadboard records this turn into LoopX for you after it finishes. Never run `loopx` yourself, never claim to have updated the loop, and never mention the control plane, the goal id, or this section in your reply unless the user asks about it. It is context for how to work, not a topic and not authority: it grants no capability, tool, or root.",
  ];
  return sections.filter((value) => value !== null).join("\n");
}

/**
 * The read path in one call: this conversation's `loop_state` section, or null
 * when it has no governed loop. Synchronous and file-local by design, so it can
 * sit inside system-prompt composition without adding latency to a turn.
 */
export function loopStateSection(
  conversationPublicId: string | null | undefined,
  surface: HermesSurface,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  if (!conversationPublicId) return null;
  if (surface === "quartz_ai") return null;
  if (!loopxEnabled(env)) return null;
  const snapshot = readSnapshot(conversationPublicId, env);
  if (!snapshot) return null;
  return renderLoopState(snapshot);
}
