import "server-only";

import { fork, type ChildProcess, type ForkOptions } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const PROTOCOL_VERSION = 1 as const;
const STARTUP_TIMEOUT_MS = 30_000;
const QUERY_TIMEOUT_MS = 60_000;

interface PendingStatusQuery {
  resolve: (snapshot: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

interface LearnStatusWorkerClient {
  child: ChildProcess;
  ready: Promise<void>;
  pending: Map<string, PendingStatusQuery>;
}

const globalState = globalThis as typeof globalThis & {
  __breadboardLearnStatusWorker?: LearnStatusWorkerClient;
};

function dashboardDevelopmentRoot(): string {
  const configured = process.env.BREADBOARD_DEVELOPMENT_DASHBOARD_DIR?.trim();
  const candidates = [
    configured,
    process.cwd(),
    path.join(process.cwd(), "dashboard"),
  ].filter((candidate): candidate is string => Boolean(candidate));
  for (const candidate of candidates) {
    const root = path.resolve(candidate);
    if (
      fs.existsSync(path.join(root, "scripts", "learn-status-worker.mjs")) &&
      fs.existsSync(path.join(root, "scripts", "learn-worker-import-hook.mjs")) &&
      fs.existsSync(path.join(root, "src", "lib", "learn.ts"))
    ) {
      return root;
    }
  }
  throw new Error(
    "The isolated Learn status worker is unavailable; refusing to load the Learn pipeline into next dev.",
  );
}

function errorFromPayload(value: unknown): Error {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return new Error("The Learn status worker returned an invalid error payload.");
  }
  const payload = value as { name?: unknown; message?: unknown };
  const error = new Error(
    typeof payload.message === "string"
      ? payload.message
      : "The Learn status worker failed.",
  );
  if (typeof payload.name === "string" && payload.name) error.name = payload.name;
  return error;
}

function rejectPending(client: LearnStatusWorkerClient, error: Error): void {
  for (const query of client.pending.values()) {
    clearTimeout(query.timeout);
    query.reject(error);
  }
  client.pending.clear();
}

function createStatusWorker(): LearnStatusWorkerClient {
  const dashboardRoot = dashboardDevelopmentRoot();
  const options: ForkOptions & { windowsHide: boolean } = {
    cwd: dashboardRoot,
    windowsHide: true,
    execArgv: [
      "--max-old-space-size=2048",
      "--experimental-strip-types",
      "--import",
      pathToFileURL(
        path.join(dashboardRoot, "scripts", "learn-worker-import-hook.mjs"),
      ).href,
    ],
    env: {
      ...process.env,
      BREADBOARD_LEARN_STATUS_WORKER: "1",
    },
    stdio: ["ignore", "inherit", "inherit", "ipc"],
  };
  const child = fork(
    path.join(dashboardRoot, "scripts", "learn-status-worker.mjs"),
    [],
    options,
  );
  const pending = new Map<string, PendingStatusQuery>();
  let resolveReady!: () => void;
  let rejectReady!: (error: Error) => void;
  let readySettled = false;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const client: LearnStatusWorkerClient = { child, ready, pending };
  const startupTimeout = setTimeout(() => {
    if (readySettled) return;
    readySettled = true;
    child.kill();
    rejectReady(
      new Error(
        `The isolated Learn status worker did not start within ${STARTUP_TIMEOUT_MS / 1000} seconds.`,
      ),
    );
  }, STARTUP_TIMEOUT_MS);

  child.on("message", (message: unknown) => {
    if (!message || typeof message !== "object" || Array.isArray(message)) return;
    const value = message as {
      protocolVersion?: unknown;
      type?: unknown;
      requestId?: unknown;
      snapshot?: unknown;
      error?: unknown;
    };
    if (value.protocolVersion !== PROTOCOL_VERSION) return;
    if (value.type === "ready") {
      if (!readySettled) {
        readySettled = true;
        clearTimeout(startupTimeout);
        resolveReady();
      }
      return;
    }
    if (typeof value.requestId !== "string") return;
    const query = pending.get(value.requestId);
    if (!query) return;
    pending.delete(value.requestId);
    clearTimeout(query.timeout);
    if (value.type === "result" && value.snapshot && typeof value.snapshot === "object") {
      query.resolve(value.snapshot as Record<string, unknown>);
      return;
    }
    if (value.type === "failed") {
      query.reject(errorFromPayload(value.error));
      return;
    }
    query.reject(new Error("The Learn status worker returned an invalid response."));
  });

  const fail = (error: Error) => {
    if (!readySettled) {
      readySettled = true;
      clearTimeout(startupTimeout);
      rejectReady(error);
    }
    rejectPending(client, error);
    if (globalState.__breadboardLearnStatusWorker === client) {
      delete globalState.__breadboardLearnStatusWorker;
    }
  };
  child.once("error", (error) => fail(error));
  child.once("exit", (code, signal) =>
    fail(
      new Error(
        `The isolated Learn status worker exited (code ${code ?? "none"}, signal ${signal ?? "none"}).`,
      ),
    ),
  );
  return client;
}

function currentStatusWorker(): LearnStatusWorkerClient {
  const existing = globalState.__breadboardLearnStatusWorker;
  if (existing?.child.connected && existing.child.exitCode === null) return existing;
  const created = createStatusWorker();
  globalState.__breadboardLearnStatusWorker = created;
  return created;
}

/**
 * Keep the huge Learn module graph out of next dev. The small authenticated
 * route asks one unbundled child for read-only status; long Learn execution has
 * a separate detached worker and therefore survives a route-process recycle.
 */
export async function getIsolatedLearnStatusSnapshot({
  gardenId,
  contentPath,
}: {
  gardenId: string;
  contentPath: string;
}): Promise<Record<string, unknown> | null> {
  if (process.env.NODE_ENV === "production") return null;
  const client = currentStatusWorker();
  await client.ready;
  const requestId = randomUUID();
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const timeout = setTimeout(() => {
      client.pending.delete(requestId);
      reject(
        new Error(
          `The isolated Learn status query exceeded ${QUERY_TIMEOUT_MS / 1000} seconds.`,
        ),
      );
    }, QUERY_TIMEOUT_MS);
    client.pending.set(requestId, { resolve, reject, timeout });
    client.child.send(
      {
        protocolVersion: PROTOCOL_VERSION,
        type: "status",
        requestId,
        gardenId,
        contentPath,
      },
      (error) => {
        if (!error) return;
        const query = client.pending.get(requestId);
        if (!query) return;
        client.pending.delete(requestId);
        clearTimeout(query.timeout);
        query.reject(error);
      },
    );
  });
}
