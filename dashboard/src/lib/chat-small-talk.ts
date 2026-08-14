export type SmallTalkIntent = "greeting" | "wellbeing" | "gratitude" | "farewell";

export type SmallTalkReply = {
  intent: SmallTalkIntent;
  text: string;
};

/**
 * Recognize only complete, self-contained small-talk turns.
 *
 * This is deliberately stricter than keyword matching: a message such as
 * "hi, explain chapter 2" must continue through the normal grounded assistant
 * path. Punctuation and harmless forms of address are accepted, but any task
 * text makes the expression fail closed.
 */
export function resolveSmallTalkReply(value: string): SmallTalkReply | null {
  const text = value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[\u2018\u2019']/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!text || text.length > 80) return null;

  const addressed = "(?: bread| assistant)?";
  if (
    new RegExp(
      `^(?:(?:hi|hello|hey|hiya|howdy|greetings|yo)(?: there)?|good (?:morning|afternoon|evening)|morning|afternoon|evening)${addressed}$`,
    ).test(text)
  ) {
    return {
      intent: "greeting",
      text: "Hi! I'm Bread. What can I help with?",
    };
  }

  if (
    new RegExp(
      `^(?:how are you|hows it going|how is it going|whats up|what is up|how do you do|are you there)${addressed}$`,
    ).test(text)
  ) {
    return {
      intent: "wellbeing",
      text: "I'm here and ready to help. What would you like to work on?",
    };
  }

  if (
    /^(?:thanks|thank you|thanks a lot|thank you very much|many thanks|thx|much appreciated)$/.test(
      text,
    )
  ) {
    return {
      intent: "gratitude",
      text: "You're welcome. What else can I help with?",
    };
  }

  if (
    /^(?:bye|goodbye|good night|see you|see you later|talk to you later|catch you later)$/.test(
      text,
    )
  ) {
    return {
      intent: "farewell",
      text: "See you later!",
    };
  }

  return null;
}

/** Return the same minimal SSE contract consumed by both Garden chat clients. */
export function smallTalkEventStream(reply: SmallTalkReply): Response {
  const events = [
    { type: "runtime", backend: "breadboard-fast-path", fallback: false },
    { type: "sources", sources: [] },
    { type: "delta", text: reply.text },
    {
      type: "usage",
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        cachedInputTokens: 0,
        reasoningTokens: 0,
        scope: "turn",
        apiCalls: 0,
        contextUsedTokens: 0,
      },
    },
  ];
  const body = `${events
    .map((event) => `data: ${JSON.stringify(event)}\n\n`)
    .join("")}data: [DONE]\n\n`;

  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Breadboard-AI-Backend": "breadboard-fast-path",
      "X-Breadboard-AI-Fallback": "0",
    },
  });
}
