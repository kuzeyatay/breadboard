import { renderSystemPrompt } from "../system-prompts/service.ts";
export interface ResearchMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

export interface RetrievedSource {
  sourceId: string;
  request: string;
  content: string;
}

export function retrievedSources(messages: ResearchMessage[]): RetrievedSource[] {
  const calls = new Map(messages.flatMap(message => (message.tool_calls ?? []).map(call => [
    call.id, `${call.function.name}: ${call.function.arguments}`,
  ] as const)));
  return messages.filter(message => message.role === "tool" && message.content?.trim()).map((message, index) => ({
    sourceId: `source-${index + 1}`,
    request: calls.get(message.tool_call_id ?? "") ?? "Retrieved file or tool result",
    content: message.content!,
  }));
}

/** Keep every retrieved character while bounding each model's evidence input. */
export function evidenceBatches(sources: RetrievedSource[], limit = 90_000): RetrievedSource[][] {
  if (!Number.isInteger(limit) || limit < 2) throw new Error("Invalid evidence batch limit.");
  const batches: RetrievedSource[][] = [];
  let batch: RetrievedSource[] = [], size = 0;
  for (const source of sources) {
    let offset = 0;
    while (offset < source.content.length) {
      let end = Math.min(source.content.length, offset + limit);
      // Do not split a UTF-16 surrogate pair at a batch boundary.
      if (end < source.content.length && /[\uD800-\uDBFF]/.test(source.content[end - 1])) end--;
      const content = source.content.slice(offset, end);
      if (size + content.length > limit && batch.length) {
        batches.push(batch); batch = []; size = 0;
      }
      batch.push({...source, content}); size += content.length;
      offset = end;
    }
  }
  if (batch.length) batches.push(batch);
  return batches;
}

function sourceText(sources: RetrievedSource[]): string {
  return sources.map(source => `### ${source.sourceId}\nRequest: ${source.request}\n\n${source.content}`).join("\n\n");
}



/** Separate source reduction from the final answer instead of replaying a huge tool transcript. */
export async function writeRetrievedFindings(input: {
  userId?: number | null;
  messages: ResearchMessage[];
  signal: AbortSignal;
  complete: (messages: ResearchMessage[], signal: AbortSignal) => Promise<string>;
  onProgress?: (summary: string) => void;
}): Promise<string> {
  const task = input.messages.filter(message => message.role === "user").map(message => message.content ?? "").join("\n\n");
  const sources = retrievedSources(input.messages);
  if (!sources.length) throw new Error("Agent Reach has no retrieved evidence to write up.");
  const batches = evidenceBatches(sources);
  let evidence: string;
  if (batches.length === 1) {
    evidence = sourceText(batches[0]);
  } else {
    const reduction = new AbortController();
    const forward = () => reduction.abort(input.signal.reason);
    if (input.signal.aborted) forward();
    else input.signal.addEventListener("abort", forward, {once: true});
    const timer = setTimeout(() => reduction.abort(new DOMException("Evidence summarization timed out.", "TimeoutError")), 8 * 60_000);
    timer.unref?.();
    const notes: string[] = new Array(batches.length);
    let next = 0;
    const worker = async () => {
      while (next < batches.length) {
        reduction.signal.throwIfAborted();
        const index = next++;
        input.onProgress?.(`Summarizing retrieved sources (${index + 1}/${batches.length})`);
        try {
          const answer = await input.complete([
            {role: "system", content: renderSystemPrompt("research-evidence", input.userId, {  })},
            {role: "user", content: `Full research request:\n${task}\n\nEvidence batch ${index + 1}/${batches.length}:\n${sourceText(batches[index])}`},
          ], reduction.signal);
          if (!answer.trim()) throw new Error("An evidence batch returned no findings.");
          notes[index] = answer;
          input.onProgress?.(`Evidence summary completed (${index + 1}/${batches.length})`);
        } catch (error) {
          reduction.abort(error);
          throw error;
        }
      }
    };
    try {
      const results = await Promise.allSettled(Array.from({length: Math.min(2, batches.length)}, worker));
      const failure = results.find(result => result.status === "rejected");
      if (failure?.status === "rejected") throw failure.reason;
      evidence = notes.map((note, index) => `## Evidence batch ${index + 1}\n${note}`).join("\n\n");
    } finally {
      clearTimeout(timer);
      input.signal.removeEventListener("abort", forward);
    }
  }
  input.signal.throwIfAborted();
  input.onProgress?.("Writing the cited findings from the collected evidence");
  const answer = await input.complete([
    {role: "system", content: renderSystemPrompt("research-report", input.userId, {  })},
    {role: "user", content: `Full research request:\n${task}\n\nCollected evidence${batches.length > 1 ? " (source summaries; do not claim to have inspected material beyond them)" : ""}:\n${evidence}`},
  ], input.signal);
  if (!answer.trim()) throw new Error("Agent Reach finished writing without findings.");
  return answer;
}
