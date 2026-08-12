// Structured errors for Recall. Every failure the browser or a model can see
// maps to a stable code with a specific, sanitized message — never a bare
// "something went wrong", and never a filesystem path, bearer token, or
// command line.

export type RecallErrorCode =
  | "feature_disabled"
  | "not_installed"
  | "install_in_progress"
  | "install_failed"
  | "engine_unavailable"
  | "engine_auth_failed"
  | "engine_rejected"
  | "engine_already_running"
  | "engine_not_running"
  | "engine_start_failed"
  | "engine_stop_failed"
  | "capture_disabled"
  | "agent_access_disabled"
  | "recall_permission_required"
  | "invalid_input"
  | "unsupported_platform"
  | "internal_error";

const USER_MESSAGES: Record<RecallErrorCode, string> = {
  feature_disabled:
    "Recall is turned off. Enable it in Settings → Recall.",
  not_installed:
    "The Recall capture engine is not installed yet. Install it from Settings → Recall.",
  install_in_progress:
    "The Recall capture engine is still installing. Watch the progress in Settings → Recall.",
  install_failed:
    "Installing the Recall capture engine failed. Check your network connection and try again from Settings → Recall.",
  engine_unavailable:
    "The Recall capture engine is not running, so there is no history to read.",
  engine_auth_failed:
    "The Recall capture engine rejected Breadboard's key. Restart capture from Settings → Recall.",
  engine_rejected: "The Recall capture engine rejected the request.",
  engine_already_running: "Recall capture is already running.",
  engine_not_running: "Recall capture is not running.",
  engine_start_failed: "Starting Recall capture failed.",
  engine_stop_failed: "Stopping Recall capture failed.",
  capture_disabled:
    "Recall capture is switched off, so nothing is being recorded.",
  agent_access_disabled:
    "The agent is not allowed to read your Recall history. Turn on agent access in Settings → Recall.",
  // Not a failure: the runtime turns this into a prompt and retries once the
  // user answers, so the message reads as the question they will be asked.
  recall_permission_required: "Change what Recall is recording?",
  invalid_input: "The request was invalid.",
  unsupported_platform:
    "Recall capture is not supported on this operating system.",
  internal_error: "Recall failed due to an internal error.",
};

export function userMessageForRecallCode(code: RecallErrorCode): string {
  return USER_MESSAGES[code] ?? USER_MESSAGES.internal_error;
}

const HTTP_STATUS: Partial<Record<RecallErrorCode, number>> = {
  feature_disabled: 403,
  not_installed: 409,
  install_in_progress: 409,
  install_failed: 500,
  engine_unavailable: 503,
  engine_auth_failed: 502,
  engine_rejected: 502,
  engine_already_running: 409,
  engine_not_running: 409,
  engine_start_failed: 500,
  engine_stop_failed: 500,
  capture_disabled: 409,
  agent_access_disabled: 403,
  recall_permission_required: 428,
  invalid_input: 400,
  unsupported_platform: 501,
  internal_error: 500,
};

/** HTTP status a route should answer with for a given failure. */
export function statusForRecallError(code: RecallErrorCode): number {
  return HTTP_STATUS[code] ?? 500;
}

/** Failures worth retrying once the user has fixed the cause. */
const RETRYABLE_CODES: ReadonlySet<RecallErrorCode> = new Set([
  "engine_unavailable",
  "engine_auth_failed",
  "engine_start_failed",
  "engine_stop_failed",
  "install_failed",
  "internal_error",
]);

export class RecallError extends Error {
  code: RecallErrorCode;
  /** Message safe to show in the browser or hand to a model. */
  userMessage: string;
  retryable: boolean;
  httpStatus: number;

  constructor(
    code: RecallErrorCode,
    options: {
      userMessage?: string;
      /** Server-log-only detail; never sent to the browser. */
      detail?: string;
      retryable?: boolean;
      httpStatus?: number;
      cause?: unknown;
    } = {},
  ) {
    const userMessage = options.userMessage ?? userMessageForRecallCode(code);
    super(options.detail ? `${userMessage} [${options.detail}]` : userMessage);
    this.name = "RecallError";
    this.code = code;
    this.userMessage = userMessage;
    this.retryable = options.retryable ?? RETRYABLE_CODES.has(code);
    this.httpStatus = options.httpStatus ?? statusForRecallError(code);
    if (options.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

export function isRecallError(error: unknown): error is RecallError {
  return error instanceof RecallError;
}

/** Collapse any error into a browser-safe `{ code, message }` pair. */
export function sanitizeRecallError(error: unknown): {
  code: RecallErrorCode;
  message: string;
  status: number;
} {
  if (isRecallError(error)) {
    return { code: error.code, message: error.userMessage, status: error.httpStatus };
  }
  return {
    code: "internal_error",
    message: userMessageForRecallCode("internal_error"),
    status: 500,
  };
}
