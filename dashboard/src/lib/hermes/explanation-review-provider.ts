import { localChatmockBaseUrl } from "../chatmock-server.ts";
import type { ExplanationModel } from "./explanation-review.ts";

/** Use the turn's selected model through its existing authenticated provider. */
export function explanationReviewModel(model: string, fetcher: typeof fetch = fetch): ExplanationModel {
  return async (request) => {
    const response = await fetcher(`${localChatmockBaseUrl()}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY || "local"}`,
      },
      signal: request.signal,
      body: JSON.stringify({
        model, stream: false, council: false,
        reasoning_effort: "low",
        max_completion_tokens: request.maxOutputTokens,
        response_format: { type: "json_schema", json_schema: {
          name: `explanation_${request.stage}`, strict: true, schema: request.schema,
        } },
        messages: [
          // Some OpenAI-compatible bridges omit response_format upstream.
          // Keep the same contract legible there; validate the reply locally.
          { role: "system", content: `${request.instruction}\n\nRequired JSON schema:\n${JSON.stringify(request.schema)}` },
          { role: "user", content: JSON.stringify(request.data) },
        ],
      }),
    });
    if (!response.ok) throw new Error(`Explanation review HTTP ${response.status}`);
    const payload = await response.json();
    const choice = payload.choices?.[0];
    if (choice?.finish_reason !== "stop" || typeof choice.message?.content !== "string") {
      throw new Error("Explanation review did not complete");
    }
    return { content: choice.message.content, usage: payload.usage };
  };
}
