const SPEECH_RECONNECT_DELAYS_MS = [300, 750, 1_500, 3_000] as const;

let voiceboxPreparation: Promise<void> | null = null;

function nestedMessage(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  return nestedMessage(record.message) || nestedMessage(record.detail) || nestedMessage(record.error);
}

export function speechErrorMessage(error: unknown, fallback: string): string {
  const message = nestedMessage(error);
  if (!message) return fallback;
  if (/^(?:failed to fetch|fetch failed|networkerror\b)/iu.test(message)) {
    return "Breadboard lost its connection to local speech. Try again in a moment.";
  }
  return message;
}

async function responseError(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => null);
  return nestedMessage(body) || fallback;
}

function abortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason;
  return new DOMException("Aborted", "AbortError");
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Same-origin speech requests can briefly lose the dashboard while its local
 * development server reconnects. Retry only network failures: an HTTP response
 * is authoritative and must be shown immediately.
 */
export async function fetchSpeechApi(
  input: string,
  init: RequestInit = {},
): Promise<Response> {
  let lastFailure: unknown = null;
  for (let attempt = 0; attempt <= SPEECH_RECONNECT_DELAYS_MS.length; attempt += 1) {
    if (init.signal?.aborted) throw abortError(init.signal);
    try {
      return await fetch(input, init);
    } catch (error) {
      if (init.signal?.aborted) throw abortError(init.signal);
      lastFailure = error;
      const delay = SPEECH_RECONNECT_DELAYS_MS[attempt];
      if (delay === undefined) break;
      await wait(delay);
    }
  }
  throw new Error(
    "Breadboard could not reach local speech. It will try to start Voicebox again next time.",
    { cause: lastFailure },
  );
}

function waitForCaller<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortError(signal));
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(abortError(signal));
    signal.addEventListener("abort", abort, { once: true });
    void promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

/**
 * Ask Runtime V2 to start Voicebox and wait until its HTTP service is ready.
 * One in-flight request is shared by Dictate live, full voice mode, and Voice
 * settings so opening two surfaces cannot create duplicate cold starts.
 */
export function prepareLocalSpeech(signal?: AbortSignal): Promise<void> {
  if (!voiceboxPreparation) {
    const request = (async () => {
      const response = await fetchSpeechApi("/api/speech/prepare", {
        method: "POST",
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(await responseError(response, "Local speech could not start."));
      }
    })();
    voiceboxPreparation = request;
    const clear = () => {
      if (voiceboxPreparation === request) voiceboxPreparation = null;
    };
    void request.then(clear, clear);
  }
  return waitForCaller(voiceboxPreparation, signal);
}
