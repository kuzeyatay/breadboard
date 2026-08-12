// The parts of a model-initiated agent launch that are neither React nor
// server: reading a launch request off a stream event, and the wording of the
// follow-up turn a finished run comes back on.
//
// Split out from the queue hook so the rules can be exercised directly, and
// because both chat surfaces, the session hook, and the tests all need them
// without dragging a component's imports along. Nothing here performs a launch.

/** A launch a super-agent turn asked for, as it reaches the chat surface. */
export interface AgentLaunchRequestPayload {
  requestId: string;
  agentId: string;
  agentName: string;
  /** The agent's command identity, e.g. `/agents:vimax`; never user input. */
  command: string;
  brief: string;
  reason: string;
  /** Send the run's result back as a follow-up turn when it finishes. */
  awaitResult: boolean;
  /** True for write/action agents; false for read-only internal delegation. */
  requiresApproval: boolean;
  /** Assistant turn that owns this privately observed delegated run. */
  originClientMessageId?: string;
}

/**
 * How many agents one chain may start before it has to stop and let the user
 * speak. A chain is only useful because each step reacts to the last, and that
 * is exactly what lets it run away — four is enough for the real sequences
 * (research → write → publish) and short enough that a loop is cheap.
 */
export const MAX_AGENT_LAUNCH_HOPS = 4;

/** How much of a run's output the follow-up turn carries back. */
const MAX_CONTINUATION_CONTENT = 6_000;

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Read a launch request out of a raw stream event, or null when it is not one.
 *
 * The two surfaces name the event differently — the Garden's SSE frames are
 * flat and lowercase, the Terminal's are the runtime's dotted event names — so
 * both spellings are accepted rather than making each caller normalize first.
 */
export function parseAgentLaunchRequest(
  value: unknown,
): AgentLaunchRequestPayload | null {
  if (!value || typeof value !== "object") return null;
  const event = value as Record<string, unknown>;
  const type = text(event.type);
  if (type !== "agent_launch" && type !== "agent.launch_requested") return null;
  const source =
    event.payload && typeof event.payload === "object"
      ? (event.payload as Record<string, unknown>)
      : event;
  const requestId = text(source.requestId).trim();
  const command = text(source.command).trim();
  const brief = text(source.brief).trim();
  // A request missing any of these would submit something other than a launch —
  // the bare command opens a palette entry and runs nothing.
  if (!requestId || !command || !brief) return null;
  return {
    requestId,
    agentId: text(source.agentId).trim(),
    agentName: text(source.agentName).trim() || "The agent",
    command,
    brief,
    reason: text(source.reason).trim(),
    // Chaining is the default: an event that omits the flag must not read as a
    // hand-off with no follow-up.
    awaitResult: source.awaitResult !== false,
    // Old/replayed events remain gated. Only an explicit false removes the
    // confirmation boundary.
    requiresApproval: source.requiresApproval !== false,
    ...(text(source.originClientMessageId).trim()
      ? { originClientMessageId: text(source.originClientMessageId).trim() }
      : {}),
  };
}

/**
 * The follow-up turn a finished run comes back on.
 *
 * This is model-to-model context, not a message from the person. Surfaces keep
 * it in durable history for audit and runtime reconstruction but hide the input
 * row from the transcript; only the Super Agent's resulting response is visible.
 */
export function agentLaunchContinuationMessage(input: {
  agentName: string;
  outcome: string;
  content: string;
}): string {
  const body = input.content.trim().slice(0, MAX_CONTINUATION_CONTENT);
  const verdict =
    input.outcome === "completed"
      ? `${input.agentName} finished.`
      : `${input.agentName} did not finish — it ${input.outcome}.`;
  return [
    `${verdict} This is its result, handed back to you:`,
    "",
    body || "(it returned no output)",
    "",
    input.outcome === "completed"
      ? "Respond as the Super Agent. Summarize the useful result in your own words. If the result contains an artifact, file, download, URL, or artifact ID, present that exact output clearly and preserve its link; do not merely say the worker finished. Launch another worker only if the plan genuinely requires it."
      : "Say what failed and what you would do about it. Do not relaunch it without being asked.",
  ].join("\n");
}
