import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const PORT_IN_USE_EXIT_CODE = 13;
const DEFAULT_URL_WAIT_MS = 20_000;
const DEFAULT_FLOW_TIMEOUT_MS = 10 * 60_000;
const STOP_GRACE_MS = 5_000;
const MAX_OUTPUT_BYTES = 64 * 1024;
const MAX_AUTHORIZATION_URL_BYTES = 16 * 1024;

function fail(message, code = "chatmock_login_failed") {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function samePath(left, right, platform = process.platform) {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function directFile(filePath, label, platform = process.platform) {
  const metadata = fs.lstatSync(filePath, { throwIfNoEntry: false });
  if (!metadata?.isFile() || metadata.isSymbolicLink()) fail(`${label} is unavailable.`);
  const canonical = fs.realpathSync.native(filePath);
  if (!samePath(canonical, filePath, platform)) fail(`${label} is indirect.`);
  return canonical;
}

function resolveConfiguredPython(value, platform) {
  const candidate = value?.trim();
  if (!candidate) return null;
  if (!path.isAbsolute(candidate)) fail("The configured ChatMock Python path is not absolute.");
  return directFile(path.resolve(candidate), "The configured ChatMock Python", platform);
}

function resolvePythonOnPath(env, platform) {
  const configured = resolveConfiguredPython(env.CHATMOCK_PYTHON, platform);
  if (configured) return configured;
  const names = platform === "win32" ? ["python.exe"] : ["python3", "python"];
  const directories = (env.PATH ?? "").split(path.delimiter).filter(Boolean);
  for (const directory of directories) {
    if (!path.isAbsolute(directory)) continue;
    for (const name of names) {
      const candidate = path.resolve(directory, name);
      try {
        return directFile(candidate, "The Runtime Python interpreter", platform);
      } catch {
        // Keep looking within Runtime's closed PATH.
      }
    }
  }
  fail("The Runtime Python interpreter for ChatMock is unavailable.", "chatmock_python_unavailable");
}

/** First bounded HTTPS URL carrying the OAuth authorize parameters. */
export function extractChatmockAuthorizationUrl(output) {
  for (const candidate of output.match(/https:\/\/[^\s"'<>]+/gu) ?? []) {
    if (
      Buffer.byteLength(candidate, "utf8") <= MAX_AUTHORIZATION_URL_BYTES &&
      /[?&]client_id=/u.test(candidate) &&
      /[?&]code_challenge=/u.test(candidate)
    ) {
      return candidate;
    }
  }
  return null;
}

export function describeChatmockLoginExit(code, output) {
  if (code === PORT_IN_USE_EXIT_CODE) {
    return "Port 1455 is already in use, so the sign-in callback could not start. Close the other login attempt and try again.";
  }
  const reported = output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => /^ERROR:/iu.test(line))
    .at(-1);
  if (reported) return reported.replace(/^ERROR:\s*/iu, "").slice(0, 8_000);
  return `The ChatMock sign-in exited with code ${code ?? "unknown"} before completing.`;
}

export function validateChatmockLoginRequest(value) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(",") !== "operation,protocolVersion" ||
    value.protocolVersion !== 1 ||
    value.operation !== "login"
  ) {
    fail("The ChatMock login request is invalid.", "chatmock_login_request_invalid");
  }
  return value;
}

function appendBounded(current, chunk) {
  const combined = `${current}${chunk}`;
  if (Buffer.byteLength(combined, "utf8") <= MAX_OUTPUT_BYTES) return combined;
  return Buffer.from(combined, "utf8").subarray(-MAX_OUTPUT_BYTES).toString("utf8");
}

function loginState(status, startedAt, overrides = {}) {
  return {
    status,
    authorizationUrl: null,
    startedAt,
    finishedAt: status === "awaiting_authorization" ? null : new Date().toISOString(),
    error: null,
    ...overrides,
  };
}

/**
 * Own ChatMock's interactive OAuth child until success, cancellation, or a
 * fixed deadline. Every executable and argument is worker-owned.
 */
export async function executeChatmockLogin(request, options) {
  validateChatmockLoginRequest(request);
  if (!(options?.signal instanceof AbortSignal)) fail("ChatMock login requires cancellation authority.");
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const spawnImpl = options.spawnImpl ?? spawn;
  const onState = typeof options.onState === "function" ? options.onState : () => undefined;
  const urlWaitMs = options.urlWaitMs ?? DEFAULT_URL_WAIT_MS;
  const flowTimeoutMs = options.flowTimeoutMs ?? DEFAULT_FLOW_TIMEOUT_MS;
  if (!Number.isSafeInteger(urlWaitMs) || urlWaitMs < 1 || urlWaitMs > DEFAULT_URL_WAIT_MS) {
    fail("The ChatMock authorization URL deadline is invalid.");
  }
  if (!Number.isSafeInteger(flowTimeoutMs) || flowTimeoutMs < urlWaitMs || flowTimeoutMs > DEFAULT_FLOW_TIMEOUT_MS) {
    fail("The ChatMock login deadline is invalid.");
  }

  const appRoot = fs.realpathSync.native(path.resolve(options.appRoot));
  const directory = path.join(appRoot, "chatmock");
  const directoryMetadata = fs.lstatSync(directory, { throwIfNoEntry: false });
  if (
    !directoryMetadata?.isDirectory() ||
    directoryMetadata.isSymbolicLink() ||
    !samePath(fs.realpathSync.native(directory), directory, platform)
  ) {
    fail("The staged ChatMock source is unavailable.", "chatmock_source_unavailable");
  }
  const entry = directFile(path.join(directory, "chatmock.py"), "The staged ChatMock entrypoint", platform);
  const python = resolvePythonOnPath(env, platform);
  const startedAt = new Date().toISOString();
  let currentState = loginState("awaiting_authorization", startedAt);
  onState(currentState);

  return await new Promise((resolve, reject) => {
    let child;
    let output = "";
    let settled = false;
    let forcedState = null;
    let urlTimer;
    let flowTimer;
    let stopTimer;

    const cleanup = () => {
      clearTimeout(urlTimer);
      clearTimeout(flowTimer);
      clearTimeout(stopTimer);
      options.signal.removeEventListener("abort", onAbort);
    };
    const publish = (next) => {
      currentState = next;
      onState(currentState);
    };
    const settle = (value, error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve(value);
    };
    const forceStop = (status, message) => {
      if (forcedState) return;
      forcedState = loginState(status, startedAt, { error: message });
      try {
        publish(forcedState);
      } catch (error) {
        settle(null, error);
      }
      try {
        child?.kill();
      } catch {
        // Native Runtime remains the final process-tree reaper.
      }
      stopTimer = setTimeout(() => {
        child?.stdout?.destroy();
        child?.stderr?.destroy();
        child?.unref?.();
        settle(forcedState);
      }, STOP_GRACE_MS);
      stopTimer.unref?.();
    };
    const onAbort = () => forceStop("cancelled", null);

    try {
      child = spawnImpl(python, [entry, "login", "--no-browser"], {
        cwd: directory,
        shell: false,
        detached: false,
        windowsHide: true,
        env: { ...env, PYTHONIOENCODING: "utf-8" },
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "ChatMock could not be started.";
      const failed = loginState("failed", startedAt, { error: message });
      publish(failed);
      settle(failed);
      return;
    }

    const onOutput = (chunk) => {
      output = appendBounded(output, Buffer.from(chunk).toString("utf8"));
      if (currentState.authorizationUrl || forcedState) return;
      const authorizationUrl = extractChatmockAuthorizationUrl(output);
      if (authorizationUrl) {
        clearTimeout(urlTimer);
        publish({ ...currentState, authorizationUrl });
      }
    };
    child.stdout?.on("data", onOutput);
    child.stderr?.on("data", onOutput);
    child.once("error", (error) => {
      if (settled || forcedState) return;
      const message = error?.code === "ENOENT"
        ? "The Runtime Python interpreter for ChatMock is unavailable."
        : error instanceof Error ? error.message : "ChatMock could not be started.";
      const failed = loginState("failed", startedAt, { error: message });
      publish(failed);
      settle(failed);
    });
    child.once("close", (code) => {
      if (settled) return;
      if (forcedState) {
        settle(forcedState);
        return;
      }
      const finished = code === 0
        ? loginState("completed", startedAt)
        : loginState("failed", startedAt, { error: describeChatmockLoginExit(code, output) });
      publish(finished);
      settle(finished);
    });

    urlTimer = setTimeout(() => {
      if (!currentState.authorizationUrl) {
        forceStop("failed", "ChatMock did not report an authorization URL.");
      }
    }, urlWaitMs);
    urlTimer.unref?.();
    flowTimer = setTimeout(
      () => forceStop("failed", "The sign-in was not completed in time and has been cancelled."),
      flowTimeoutMs,
    );
    flowTimer.unref?.();
    options.signal.addEventListener("abort", onAbort, { once: true });
    if (options.signal.aborted) onAbort();
  });
}
