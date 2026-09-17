import OpenAI from "openai";
import {
  Agent,
  fetch as undiciFetch,
  type Dispatcher,
} from "undici";

const CHATMOCK_HEADERS_TIMEOUT_MS = (() => {
  const value = Number(process.env.CHATMOCK_CLIENT_HEADERS_TIMEOUT_MS);
  return Number.isFinite(value) && value >= 60_000
    ? Math.floor(value)
    : 30 * 60 * 1000;
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
  /** SDK-internal retries. Callers that account for exactly one provider POST
   * per logical call (Learn) must pass 0: a retry after an ambiguous timeout
   * is a duplicate request behind their back. */
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
    ...(options.maxRetries !== undefined ? { maxRetries: options.maxRetries } : {}),
  });
}
