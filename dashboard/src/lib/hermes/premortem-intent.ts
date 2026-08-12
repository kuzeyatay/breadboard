import type { HermesSurface } from "./config.ts";

const EXPLICIT_PREMORTEM =
  /\b(?:pre[-\s]?mortem|prospective hindsight|gary klein)\b/i;
const PREMORTEM_CONTEXT =
  /\b(?:pre[-\s]?mortem|failure statement|completed-fact failure|persona set|causal graph|root causes?|terminal outcomes?|mitigations?|risk report|workflow phase)\b/i;
const CONTINUATION =
  /^(?:(?:yes|no|okay|ok|sure|approved?|continue|next|proceed|go ahead|retry|try again)\b|(?:add|change|edit|replace|revise|remove|keep|score|map|generate|publish)\b[\s\S]{0,220}|[\s\S]{0,220}\b(?:persona|failure statement|cause|risk|graph|node|edge|likelihood|impact|mitigation|owner|research question|report)\b)/i;
const AWAITING_WORKFLOW_INPUT =
  /\b(?:what planned initiative should we analyze|which should i revise|approve (?:or edit|this)|does this (?:look|capture)|what would you change|should we proceed|review (?:the )?(?:personas|causal graph))\b/i;

function isPremortemContinuation(input: {
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
    AWAITING_WORKFLOW_INPUT.test(latestAssistant) ||
    (
      recentAssistants.some((message) => PREMORTEM_CONTEXT.test(message)) &&
      /\?\s*$/.test(latestAssistant)
    )
  ) {
    return input.text.trim().length <= 2_000;
  }
  return PREMORTEM_CONTEXT.test(latestAssistant) &&
    CONTINUATION.test(input.text.trim());
}

export function premortemCommandText(input: {
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
    !text.startsWith("/") &&
    (
      EXPLICIT_PREMORTEM.test(text) ||
      isPremortemContinuation({
        text,
        priorMessages: input.priorMessages,
      })
    );
  return {
    text: automatic ? `/premortem ${input.text}` : input.text,
    automatic,
  };
}
