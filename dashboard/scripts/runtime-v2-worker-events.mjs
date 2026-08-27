import fs from "node:fs";
import { fileURLToPath } from "node:url";
import {
  isMainThread,
  parentPort,
  Worker,
  workerData,
} from "node:worker_threads";

const PROTOCOL_VERSION = 1;
const MAX_EVENT_BYTES = 64 * 1024;
const MAX_HEARTBEAT_INTERVAL_MS = 5_000;
const MAX_STAGE_BYTES = 256;
const THREAD_KIND = "runtime-v2-worker-heartbeat-v1";
const THREAD_READY = "runtime-v2-worker-heartbeat-ready-v1";
const SEQUENCE_SLOT = 0;
const WRITE_LOCK_SLOT = 1;
const TERMINAL_SLOT = 2;
const HEARTBEAT_STOP_SLOT = 3;
const STATE_SLOTS = 4;
const MAX_SHARED_SEQUENCE = 0x7fff_ffff;
const IDENTIFIER = /^[A-Za-z0-9_-]{1,128}$/u;
const ENTRYPOINT_PATH = fileURLToPath(import.meta.url);

function fail(message) {
  throw new Error(message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, keys) {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function validateIdentity(value) {
  if (
    !hasExactKeys(value, ["jobId", "attempt", "workerInstanceId"]) ||
    !IDENTIFIER.test(value.jobId) ||
    !Number.isSafeInteger(value.attempt) ||
    value.attempt < 1 ||
    !IDENTIFIER.test(value.workerInstanceId)
  ) {
    fail("The Runtime V2 event-writer identity is invalid.");
  }
  return {
    jobId: value.jobId,
    attempt: value.attempt,
    workerInstanceId: value.workerInstanceId,
  };
}

function validateHeartbeatStage(value) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    Buffer.byteLength(value, "utf8") > MAX_STAGE_BYTES ||
    /\p{Cc}/u.test(value)
  ) {
    fail("The Runtime V2 heartbeat stage is invalid.");
  }
  return value;
}

function validateHeartbeatInterval(value) {
  if (
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > MAX_HEARTBEAT_INTERVAL_MS
  ) {
    fail("The Runtime V2 heartbeat interval is invalid.");
  }
  return value;
}

function lockWriter(state) {
  while (Atomics.compareExchange(state, WRITE_LOCK_SLOT, 0, 1) !== 0) {
    Atomics.wait(state, WRITE_LOCK_SLOT, 1, 1_000);
  }
}

function unlockWriter(state) {
  Atomics.store(state, WRITE_LOCK_SLOT, 0);
  Atomics.notify(state, WRITE_LOCK_SLOT, 1);
}

function writeEvent(event) {
  const line = `${JSON.stringify(event)}\n`;
  if (Buffer.byteLength(line, "utf8") > MAX_EVENT_BYTES) {
    fail("The Runtime V2 worker event exceeded its protocol bound.");
  }
  fs.writeSync(1, line, undefined, "utf8");
}

function emit(state, identity, type, payload = {}, terminal = false) {
  lockWriter(state);
  try {
    if (Atomics.load(state, TERMINAL_SLOT) !== 0) {
      fail("A worker event was emitted after its terminal event.");
    }
    const priorSequence = Atomics.load(state, SEQUENCE_SLOT);
    if (priorSequence >= MAX_SHARED_SEQUENCE) {
      fail("The Runtime V2 worker event sequence was exhausted.");
    }
    const sequence = priorSequence + 1;
    Atomics.store(state, SEQUENCE_SLOT, sequence);
    writeEvent({ type, identity, sequence, ...payload });
    if (terminal) Atomics.store(state, TERMINAL_SLOT, 1);
    return sequence;
  } finally {
    unlockWriter(state);
  }
}

function validThreadData(value) {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "kind",
      "identity",
      "heartbeatStage",
      "heartbeatIntervalMs",
      "state",
    ]) &&
    value.kind === THREAD_KIND &&
    value.state instanceof SharedArrayBuffer
  );
}

function runHeartbeatThread(data) {
  if (!validThreadData(data) || !parentPort) {
    fail("The Runtime V2 heartbeat thread launch is invalid.");
  }
  const identity = validateIdentity(data.identity);
  const heartbeatStage = validateHeartbeatStage(data.heartbeatStage);
  const heartbeatIntervalMs = validateHeartbeatInterval(
    data.heartbeatIntervalMs,
  );
  const state = new Int32Array(data.state);
  if (state.length !== STATE_SLOTS) {
    fail("The Runtime V2 heartbeat protocol state is invalid.");
  }
  parentPort.postMessage(THREAD_READY);
  while (Atomics.load(state, HEARTBEAT_STOP_SLOT) === 0) {
    Atomics.wait(state, HEARTBEAT_STOP_SLOT, 0, heartbeatIntervalMs);
    if (
      Atomics.load(state, HEARTBEAT_STOP_SLOT) === 0 &&
      Atomics.load(state, TERMINAL_SLOT) === 0
    ) {
      emit(state, identity, "heartbeat", { stage: heartbeatStage });
    }
  }
}

function startHeartbeatThread(
  identity,
  state,
  heartbeatStage,
  heartbeatIntervalMs,
) {
  let heartbeatWorker;
  let expectedExit = false;
  let stopped = false;
  let fault = null;
  let resolveReady;
  let rejectReady;
  let resolveExit;
  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const exited = new Promise((resolve) => {
    resolveExit = resolve;
  });

  try {
    heartbeatWorker = new Worker(ENTRYPOINT_PATH, {
      // This helper is plain ESM and must not inherit launch-only flags such
      // as --eval/--input-type from probes or wrapper processes.
      execArgv: [],
      workerData: {
        kind: THREAD_KIND,
        identity,
        heartbeatStage,
        heartbeatIntervalMs,
        state: state.buffer,
      },
    });
    heartbeatWorker.once("message", (message) => {
      if (message !== THREAD_READY) {
        fault = new Error(
          "The Runtime V2 heartbeat thread returned an invalid ready record.",
        );
        rejectReady(fault);
        return;
      }
      heartbeatWorker.unref();
      resolveReady();
    });
    heartbeatWorker.once("error", (error) => {
      fault = error;
      rejectReady(error);
    });
    heartbeatWorker.once("exit", (code) => {
      if (code !== 0 && !fault) {
        fault = new Error(
          `The Runtime V2 heartbeat thread exited with status ${code}.`,
        );
      } else if (!expectedExit && !fault) {
        fault = new Error(
          "The Runtime V2 heartbeat thread exited unexpectedly.",
        );
      }
      if (fault) rejectReady(fault);
      resolveExit();
    });
  } catch (error) {
    fault = error;
    rejectReady(error);
    resolveExit();
  }

  return {
    ready,
    async stop() {
      if (!stopped) {
        stopped = true;
        expectedExit = true;
        heartbeatWorker?.ref();
        Atomics.store(state, HEARTBEAT_STOP_SLOT, 1);
        Atomics.notify(state, HEARTBEAT_STOP_SLOT, 1);
      }
      try {
        await ready;
      } catch {
        // The joined exit below carries the same stored fault.
      }
      await exited;
      if (fault) throw fault;
    },
  };
}

export function createRuntimeV2WorkerEventWriter(
  rawIdentity,
  {
    heartbeatStage,
    heartbeatIntervalMs = MAX_HEARTBEAT_INTERVAL_MS,
  },
) {
  const identity = validateIdentity(rawIdentity);
  const stage = validateHeartbeatStage(heartbeatStage);
  const interval = validateHeartbeatInterval(heartbeatIntervalMs);
  const state = new Int32Array(
    new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * STATE_SLOTS),
  );
  let heartbeatStarted = false;
  const publish = (type, payload = {}, terminal = false) =>
    emit(state, identity, type, payload, terminal);
  return {
    ready: () => publish("ready", { protocolVersion: PROTOCOL_VERSION }),
    progress: (progressStage, current, total) =>
      publish("progress", { stage: progressStage, current, total }),
    checkpoint: (kind, checkpointPath) =>
      publish("checkpoint", { kind, path: checkpointPath }),
    artifact: (kind, artifactPath) =>
      publish("artifact", { kind, path: artifactPath }),
    cancellationAcknowledged: () => publish("cancellation-acknowledged"),
    failed: (code, message) => publish("failed", { code, message }, true),
    nextSequence: () => Atomics.load(state, SEQUENCE_SLOT) + 1,
    complete: (resultPath) => publish("complete", { resultPath }, true),
    startHeartbeat() {
      if (heartbeatStarted) {
        fail("The Runtime V2 heartbeat thread was already started.");
      }
      heartbeatStarted = true;
      return startHeartbeatThread(identity, state, stage, interval);
    },
  };
}

if (!isMainThread && validThreadData(workerData)) {
  runHeartbeatThread(workerData);
}
