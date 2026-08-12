// Process-local liveness for agent and scheduled work.
//
// The Plan board is durable history, not a heartbeat: a crash can leave a card
// in its In progress column forever. This registry is intentionally ephemeral.
// It is populated by the same universal start/finish boundary that writes the
// board, and a server restart clears it instead of resurrecting dead work.

import type { TrackedBreadboardProcess } from "./types.ts";

interface LiveProcessRecord extends TrackedBreadboardProcess {
  userId: number;
}

const processGlobals = globalThis as typeof globalThis & {
  __breadboardLiveProcesses?: Map<string, LiveProcessRecord>;
};

const liveProcesses =
  processGlobals.__breadboardLiveProcesses ?? new Map<string, LiveProcessRecord>();
processGlobals.__breadboardLiveProcesses = liveProcesses;

function key(userId: number, kind: TrackedBreadboardProcess["kind"], runId: string): string {
  return `${userId}:${kind}:${runId}`;
}

export function beginLiveBreadboardProcess(input: {
  userId: number;
  runId: string;
  title: string;
  description?: string | null;
  kind: TrackedBreadboardProcess["kind"];
  now?: Date;
}): void {
  const now = (input.now ?? new Date()).toISOString();
  liveProcesses.set(key(input.userId, input.kind, input.runId), {
    id: `${input.kind}:${input.runId}`,
    userId: input.userId,
    title: input.title,
    description: input.description ?? null,
    kind: input.kind,
    startedAt: now,
    updatedAt: now,
    sourceUrl: null,
  });
}

export function finishLiveBreadboardProcess(input: {
  userId: number;
  runId: string;
  kind: TrackedBreadboardProcess["kind"];
}): void {
  liveProcesses.delete(key(input.userId, input.kind, input.runId));
}

export function listLiveBreadboardProcesses(userId: number): TrackedBreadboardProcess[] {
  return [...liveProcesses.values()]
    .filter((process) => process.userId === userId)
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt))
    .map((process) => ({
      id: process.id,
      title: process.title,
      description: process.description,
      kind: process.kind,
      startedAt: process.startedAt,
      updatedAt: process.updatedAt,
      sourceUrl: process.sourceUrl,
    }));
}
