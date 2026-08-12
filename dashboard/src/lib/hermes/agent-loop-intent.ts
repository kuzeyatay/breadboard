import type { HermesSurface } from "./config.ts";

// Deliberately explicit. Breadboard already has its own scheduler for
// "run this every morning", so recurrence wording alone must not hijack a turn
// into loop design — the user has to be asking about the loop contract itself.
const EXPLICIT_AGENT_LOOP =
  /\b(?:agent[-\s]loops?|loop[-\s]specs?|loop[-\s]contracts?|loop[-\s]engineering|hermes[-\s]loop|loop[-\s]receipts?|activation[-\s]plan)\b/i;
const AGENT_LOOP_CONTEXT =
  /\b(?:loop[-\s]spec|loop[-\s]contract|risk class|stop conditions?|human gates?|forbidden actions?|deterministic checks?|verification contract|dry[-\s]run record|loop receipt|activation plan|isolation mode)\b/i;
const CONTINUATION =
  /^(?:(?:yes|no|okay|ok|sure|approved?|continue|next|proceed|go ahead|retry|try again)\b|(?:add|change|edit|replace|revise|remove|keep|validate|score|tighten|loosen|raise|lower)\b[\s\S]{0,220}|[\s\S]{0,220}\b(?:trigger|input|state|tool|forbidden|isolation|verification|check|stop condition|iteration|timeout|human gate|approval|receipt|risk class|score|dry run)\b)/i;
const AWAITING_LOOP_INPUT =
  /\b(?:what repeated task|which risk class|should i validate|does this contract|what would you change|approve (?:this|the) (?:spec|contract|gate)|ready to dry[-\s]run|shall we score)\b/i;

function isAgentLoopContinuation(input: {
  text: string;
  priorMessages?: ReadonlyArray<{ role: string; content: string }>;
}): boolean {
  const recentAssistants = [...(input.priorMessages ?? [])]
    .reverse()
    .filter((message) => message.role === "assistant")
    .slice(0, 3)
    .map((message) => message.content.trim());
  const latestAssistant = recentAssistants[0];
  if (!latestAssistant) return false;
  if (
    AWAITING_LOOP_INPUT.test(latestAssistant) ||
    (
      recentAssistants.some((message) => AGENT_LOOP_CONTEXT.test(message)) &&
      /\?\s*$/.test(latestAssistant)
    )
  ) {
    return input.text.trim().length <= 2_000;
  }
  return AGENT_LOOP_CONTEXT.test(latestAssistant) &&
    CONTINUATION.test(input.text.trim());
}

export function agentLoopCommandText(input: {
  text: string;
  surface: HermesSurface;
  authenticated: boolean;
  priorMessages?: ReadonlyArray<{ role: string; content: string }>;
}): { text: string; automatic: boolean } {
  const text = input.text.trim();
  const available =
    input.authenticated &&
    (input.surface === "dashboard_terminal" ||
      input.surface === "garden_chat");
  const automatic =
    available &&
    Boolean(text) &&
    // A turn that already carries a capability token keeps it: only one skill
    // may run per turn, so a second prefix would be rejected outright.
    !text.startsWith("/") &&
    (
      EXPLICIT_AGENT_LOOP.test(text) ||
      isAgentLoopContinuation({
        text,
        priorMessages: input.priorMessages,
      })
    );
  return {
    text: automatic ? `/agent-loop-engineering ${input.text}` : input.text,
    automatic,
  };
}
