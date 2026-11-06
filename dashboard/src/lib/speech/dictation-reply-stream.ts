import type { ResponseStreamEvent } from 'openai/resources/responses/responses';
import { assistantTextFromOutputItem, createResponseTextRecovery } from '../responses-stream-text';
import { MAX_DICTATION_REPLY } from './dictation-reply';

export function dictationReplyStream(events: AsyncIterable<ResponseStreamEvent>, abort: () => void): ReadableStream<Uint8Array> {
  let cancelled = false;
  return new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder(), recovery = createResponseTextRecovery();
      let characters = 0, completed = false;
      const emit = (value: object) => { if (!cancelled) controller.enqueue(encoder.encode(JSON.stringify(value) + '\n')); };
      const delta = (index: number, text: string) => {
        if (!text) return;
        characters += text.length;
        if (characters > MAX_DICTATION_REPLY) throw new Error('The reply is too long.');
        recovery.recordStreamed(index, text); emit({ type: 'delta', text });
      };
      try {
        for await (const event of events) {
          if (cancelled) break;
          if (event.type === 'response.output_text.delta') delta(event.output_index, event.delta);
          else if (event.type === 'response.output_item.done') delta(event.output_index,
            recovery.missingFrom(event.output_index, assistantTextFromOutputItem(event.item)));
          else if (event.type === 'response.completed') {
            for (const [index, item] of event.response.output.entries()) delta(index,
              recovery.missingFrom(index, assistantTextFromOutputItem(item)));
            completed = true;
          } else if (event.type === 'response.failed' || event.type === 'response.incomplete' || event.type === 'error') {
            throw new Error('The voice model could not finish the reply.');
          }
        }
        if (!completed || !characters) throw new Error('The voice model returned no complete answer.');
        emit({ type: 'done' });
      } catch {
        emit({ type: 'error', message: 'The reply could not finish. Any visible draft has been kept. Try again.' });
      } finally { abort(); if (!cancelled) controller.close(); }
    },
    cancel() { cancelled = true; abort(); },
  });
}
