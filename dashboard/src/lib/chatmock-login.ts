// Drives ChatMock's own OAuth login as a child process instead of
// reimplementing the flow.
//
// `chatmock.py login` binds the fixed callback port 1455, prints an
// authorization URL, and exits 0 once it has written auth.json. We spawn it with
// --no-browser, surface the URL to the UI, and report the exit code back. The
// running `chatmock serve` process re-reads auth.json on every upstream request,
// so a successful login takes effect without restarting the proxy.

import { spawn, type ChildProcess } from "child_process";
import fs from "fs";
import path from "path";
import { repositoryRoot } from "./runtime-paths.ts";

export type ChatmockLoginStatus =
  | "idle"
  | "awaiting_authorization"
  | "completed"
  | "failed"
  | "cancelled";

export interface ChatmockLoginState {
  status: ChatmockLoginStatus;
  authorizationUrl: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
}

/** Exit code `cmd_login` uses when port 1455 is already bound. */
const PORT_IN_USE_EXIT_CODE = 13;
const URL_WAIT_MS = 20_000;
const FLOW_TIMEOUT_MS = 10 * 60_000;

interface ActiveFlow {
  child: ChildProcess;
  timer: NodeJS.Timeout;
}

let state: ChatmockLoginState = {
  status: "idle",
  authorizationUrl: null,
  startedAt: null,
  finishedAt: null,
  error: null,
};
let active: ActiveFlow | null = null;

function pythonExecutable(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.CHATMOCK_PYTHON?.trim() || env.BREADBOARD_PYTHON?.trim();
  if (configured) return configured;
  return process.platform === "win32" ? "python" : "python3";
}

export function chatmockDirectory(): string {
  const configured = process.env.CHATMOCK_DIR?.trim();
  return configured ? path.resolve(configured) : path.join(repositoryRoot(), "chatmock");
}

/** First https URL on the stream that carries OAuth authorize parameters. */
export function extractAuthorizationUrl(output: string): string | null {
  for (const candidate of output.match(/https:\/\/[^\s"'<>]+/g) ?? []) {
    if (/[?&]client_id=/.test(candidate) && /[?&]code_challenge=/.test(candidate)) {
      return candidate;
    }
  }
  return null;
}

export function describeLoginExit(code: number | null, output: string): string {
  if (code === PORT_IN_USE_EXIT_CODE) {
    return "Port 1455 is already in use, so the sign-in callback could not start. Close the other login attempt and try again.";
  }
  const reported = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^ERROR:/i.test(line))
    .at(-1);
  if (reported) return reported.replace(/^ERROR:\s*/i, "");
  return `The ChatMock sign-in exited with code ${code ?? "unknown"} before completing.`;
}

export function readChatmockLoginState(): ChatmockLoginState {
  return { ...state };
}

function finish(status: ChatmockLoginStatus, error: string | null): void {
  if (active) {
    clearTimeout(active.timer);
    active = null;
  }
  state = {
    ...state,
    status,
    error,
    finishedAt: new Date().toISOString(),
    authorizationUrl: status === "awaiting_authorization" ? state.authorizationUrl : null,
  };
}

/**
 * Start a sign-in and resolve once the authorization URL is known. A flow that
 * is already awaiting authorization is returned as-is so a double click cannot
 * race two processes for port 1455.
 */
export async function startChatmockLogin(): Promise<ChatmockLoginState> {
  if (active && state.status === "awaiting_authorization") return readChatmockLoginState();

  const directory = chatmockDirectory();
  if (!fs.existsSync(path.join(directory, "chatmock.py"))) {
    state = {
      status: "failed",
      authorizationUrl: null,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      error: `ChatMock was not found at ${directory}. Set CHATMOCK_DIR to its location.`,
    };
    return readChatmockLoginState();
  }

  const child = spawn(
    pythonExecutable(),
    ["chatmock.py", "login", "--no-browser"],
    {
      cwd: directory,
      shell: false,
      windowsHide: true,
      // ChatMock's CLI prints non-ASCII status glyphs; a cp1252 console encoding
      // makes it die with UnicodeEncodeError before the flow starts.
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  state = {
    status: "awaiting_authorization",
    authorizationUrl: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    error: null,
  };
  const timer = setTimeout(() => {
    child.kill();
    finish("failed", "The sign-in was not completed in time and has been cancelled.");
  }, FLOW_TIMEOUT_MS);
  timer.unref?.();
  active = { child, timer };

  let output = "";
  return await new Promise<ChatmockLoginState>((resolve) => {
    let resolved = false;
    const settle = () => {
      if (resolved) return;
      resolved = true;
      clearTimeout(urlTimer);
      resolve(readChatmockLoginState());
    };

    const urlTimer = setTimeout(() => {
      if (state.status === "awaiting_authorization" && !state.authorizationUrl) {
        child.kill();
        finish("failed", "ChatMock did not report an authorization URL.");
      }
      settle();
    }, URL_WAIT_MS);
    urlTimer.unref?.();

    const onOutput = (chunk: Buffer) => {
      output += chunk.toString("utf8");
      if (state.authorizationUrl) return;
      const url = extractAuthorizationUrl(output);
      if (!url) return;
      state = { ...state, authorizationUrl: url };
      settle();
    };
    child.stdout?.on("data", onOutput);
    child.stderr?.on("data", onOutput);

    child.on("error", (error: NodeJS.ErrnoException) => {
      finish(
        "failed",
        error.code === "ENOENT"
          ? `Python was not found (${pythonExecutable()}). Set CHATMOCK_PYTHON to its path.`
          : error.message,
      );
      settle();
    });

    child.on("close", (code) => {
      if (state.status === "cancelled") {
        settle();
        return;
      }
      if (code === 0) finish("completed", null);
      else finish("failed", describeLoginExit(code, output));
      settle();
    });
  });
}

export function cancelChatmockLogin(): ChatmockLoginState {
  if (!active) return readChatmockLoginState();
  const { child } = active;
  finish("cancelled", null);
  child.kill();
  return readChatmockLoginState();
}
