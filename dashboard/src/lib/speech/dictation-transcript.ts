import { speechRequest } from './request-client';

function nestedMessage(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  return nestedMessage(record.message) || nestedMessage(record.detail) || nestedMessage(record.error);
}
export async function dictationResponseError(response: Response): Promise<string> {
  return nestedMessage(await response.json().catch(() => null)) || `Dictation failed (${response.status}).`;
}

/** One transcript request for garden, terminal and desktop dictation.
 * speechRequest always dispatches through the user's existing Voice selection. */
export async function requestTranscript(blob: Blob, filename: string, signal: AbortSignal, waitForModel: boolean): Promise<string | null> {
  const deadline = Date.now() + 10 * 60_000;
  for (;;) {
    signal.throwIfAborted();
    const form = new FormData(); form.set('file', blob, filename);
    const response = await speechRequest('/api/speech/transcribe', { method: 'POST', body: form, signal });
    if (response.status === 202) {
      if (!waitForModel) return null;
      if (Date.now() >= deadline) throw new Error(await dictationResponseError(response));
      await new Promise<void>((resolve, reject) => {
        const abort = () => { clearTimeout(timer); reject(signal.reason); };
        const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, 2000);
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
      });
      continue;
    }
    if (!response.ok) throw new Error(await dictationResponseError(response));
    const result = await response.json() as { text?: unknown };
    signal.throwIfAborted();
    return typeof result.text === 'string' ? result.text.trim() : '';
  }
}
