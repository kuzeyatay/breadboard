// Text recovery for Responses streams that never send `output_text.delta`.
//
// The Responses API lets a provider deliver an assistant message two ways: as a
// run of `response.output_text.delta` events, or as one finished item on
// `response.output_item.done`. ChatGPT's own models do both. Every `cliproxy/*`
// model — the subscription-OAuth backends: Claude, Gemini, Kimi — does only the
// second, so a reader written against deltas alone accumulates nothing and the
// turn ends with an empty answer, a `complete` status, and no error. To the user
// that is the model replying with silence.
//
// Taking the finished item unconditionally would instead duplicate the whole
// answer for the providers that stream, because they send both. So the two have
// to be reconciled per output item, which is what this does: record what the
// deltas already delivered, then hand back only the remainder the deltas missed.
//
// The same seam once hid generated images (see hermes/artifact-image-service.ts).
// Text is the second instance.

interface JsonRecord {
  [key: string]: unknown;
}

function recordFrom(value: unknown): JsonRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

/**
 * Concatenated `output_text` of a finished `message` item.
 *
 * Other item types — reasoning, tool and image calls — carry no answer text and
 * yield "". Parts are joined in order, which is the order their deltas would
 * have arrived in, so the result is comparable against streamed text.
 */
export function assistantTextFromOutputItem(item: unknown): string {
  const record = recordFrom(item);
  if (!record || record.type !== "message") return "";
  if (!Array.isArray(record.content)) return "";
  let text = "";
  for (const part of record.content) {
    const partRecord = recordFrom(part);
    if (!partRecord || partRecord.type !== "output_text") continue;
    if (typeof partRecord.text === "string") text += partRecord.text;
  }
  return text;
}

/**
 * Concatenated summary text of a finished `reasoning` item.
 *
 * Same story as the answer: providers that never stream
 * `reasoning_summary_text.delta` put the whole summary here instead.
 */
export function reasoningTextFromOutputItem(item: unknown): string {
  const record = recordFrom(item);
  if (!record || record.type !== "reasoning") return "";
  if (!Array.isArray(record.summary)) return "";
  let text = "";
  for (const part of record.summary) {
    const partRecord = recordFrom(part);
    if (!partRecord || partRecord.type !== "summary_text") continue;
    if (typeof partRecord.text === "string") text += partRecord.text;
  }
  return text;
}

export interface ResponseTextRecovery {
  /**
   * Record raw text handed to the consumer by a delta event. Raw, not whatever
   * the consumer's own filters made of it: this is compared against the
   * provider's finished item, so it has to be in the provider's terms.
   */
  recordStreamed(outputIndex: number, text: string): void;
  /**
   * The part of a finished item's text that no delta delivered — "" when the
   * deltas already delivered all of it.
   */
  missingFrom(outputIndex: number, fullText: string): string;
}

export function createResponseTextRecovery(): ResponseTextRecovery {
  const streamed = new Map<number, string>();
  return {
    recordStreamed(outputIndex, text) {
      if (!text) return;
      streamed.set(outputIndex, (streamed.get(outputIndex) ?? "") + text);
    },
    missingFrom(outputIndex, fullText) {
      if (!fullText) return "";
      const already = streamed.get(outputIndex) ?? "";
      if (!already) return fullText;
      // The normal streaming case: the finished item restates exactly what the
      // deltas already delivered, so there is nothing left to emit.
      if (fullText.startsWith(already)) return fullText.slice(already.length);
      // The item disagrees with what the user has already been shown. Emitting
      // it would splice a second, conflicting copy into the middle of the
      // answer, so the streamed text — the text already on screen — wins.
      return "";
    },
  };
}
