import OpenAI from "openai";
import {
  Agent,
  fetch as undiciFetch,
  type Dispatcher,
} from "undici";

// A non-streaming council answer sends its headers only once the whole answer
// exists, so this transport ceiling must outlast the longest provider
// generation (ChatMock's websocket lifetime, default 7200 s) or it silently
// undercuts every caller's own request timeout. Live 2026-09-25: a fixed 30
// minutes cut off a 31-minute Learn page selection that Learn itself allowed
// 62 minutes, failing the plan with "Request timed out."
const CHATMOCK_HEADERS_TIMEOUT_MS = (() => {
  const value = Number(process.env.CHATMOCK_CLIENT_HEADERS_TIMEOUT_MS);
  if (Number.isFinite(value) && value >= 60_000) return Math.floor(value);
  const websocketSeconds = Number(process.env.CHATMOCK_COUNCIL_WEBSOCKET_TOTAL_TIMEOUT);
  const lifetimeSeconds = Number.isFinite(websocketSeconds)
    ? Math.min(21_600, Math.max(901, Math.floor(websocketSeconds)))
    : 7_200; // ChatMock's default websocket lifetime
  return (lifetimeSeconds + 5 * 60) * 1000;
})();

type DispatcherFactory = (options: {
  headersTimeout: number;
  bodyTimeout: number;
}) => Dispatcher;

interface LongHeaderTimeoutFetchOptions {
  timeoutMs?: number;
  dispatcherFactory?: DispatcherFactory;
  fetchImplementation?: typeof undiciFetch;
}

/**
 * Build the transport used for long-running ChatMock council calls.
 *
 * Keep this in a small native-ESM-safe module. Falling back to Node's global
 * fetch is unsafe here: its 300-second response-header ceiling can abandon a
 * healthy council run while ChatMock is still producing the answer.
 */
export function createLongHeaderTimeoutFetch(
  options: LongHeaderTimeoutFetchOptions = {},
): typeof fetch {
  const timeoutMs = options.timeoutMs ?? CHATMOCK_HEADERS_TIMEOUT_MS;
  const dispatcher = (options.dispatcherFactory ?? ((agentOptions) => new Agent(agentOptions)))({
    headersTimeout: timeoutMs,
    bodyTimeout: timeoutMs,
  });
  const fetchImplementation = options.fetchImplementation ?? undiciFetch;

  return ((input: RequestInfo | URL, init?: RequestInit) =>
    fetchImplementation(input as Parameters<typeof undiciFetch>[0], {
      ...(init as object),
      dispatcher,
    } as never)) as unknown as typeof fetch;
}

let chatmockFetch: typeof fetch | undefined;

export function longHeaderTimeoutFetch(): typeof fetch {
  chatmockFetch ??= createLongHeaderTimeoutFetch();
  return chatmockFetch;
}

export interface ChatmockClientOptions {
  /** Whole-request deadline. The SDK's own default is ten minutes, which a
   * deep reasoning model on a long prompt routinely exceeds. */
  timeout?: number;
  /** SDK-internal retries. Defaults to zero because ChatMock owns the single
   * fallback to the profile default and its terminal failure. */
  maxRetries?: number;
}

export function createChatmockClient(
  baseURL?: string,
  options: ChatmockClientOptions = {},
): OpenAI {
  return new OpenAI({
    baseURL: baseURL ?? process.env.OPENAI_BASE_URL,
    apiKey: process.env.OPENAI_API_KEY,
    fetch: longHeaderTimeoutFetch(),
    ...(options.timeout !== undefined ? { timeout: options.timeout } : {}),
    maxRetries: options.maxRetries ?? 0,
  });
}
