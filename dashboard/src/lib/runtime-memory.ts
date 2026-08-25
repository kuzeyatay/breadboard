import "server-only";

import { performance, type EventLoopUtilization } from "node:perf_hooks";
import {
  getHeapSpaceStatistics,
  getHeapStatistics,
  getHeapCodeStatistics,
} from "node:v8";

export interface RuntimeMemorySample {
  sampledAt: string;
  phase: string;
  pid: number;
  parentPid: number;
  uptimeSeconds: number;
  bundler: string;
  memory: ReturnType<typeof process.memoryUsage>;
  heap: ReturnType<typeof getHeapStatistics>;
  heapCode: ReturnType<typeof getHeapCodeStatistics>;
  heapSpaces: ReturnType<typeof getHeapSpaceStatistics>;
  cpu: ReturnType<typeof process.resourceUsage>;
  eventLoop: EventLoopUtilization;
}

type RuntimeMemoryState = {
  history: RuntimeMemorySample[];
  timer?: ReturnType<typeof setInterval>;
  previousEventLoop: EventLoopUtilization;
};

const globalState = globalThis as typeof globalThis & {
  __breadboardRuntimeMemory?: RuntimeMemoryState;
};

function state(): RuntimeMemoryState {
  if (!globalState.__breadboardRuntimeMemory) {
    globalState.__breadboardRuntimeMemory = {
      history: [],
      previousEventLoop: performance.eventLoopUtilization(),
    };
  }
  return globalState.__breadboardRuntimeMemory;
}

function boundedInteger(raw: string | undefined, fallback: number, min: number, max: number) {
  if (!raw || !/^\d+$/.test(raw)) return fallback;
  return Math.min(max, Math.max(min, Number(raw)));
}

export function runtimeMemoryCapacity(): number {
  return boundedInteger(process.env.BREADBOARD_MEMORY_TELEMETRY_SAMPLES, 240, 12, 720);
}

export function sampleRuntimeMemory(phase = "interval"): RuntimeMemorySample {
  const currentState = state();
  const eventLoop = performance.eventLoopUtilization(currentState.previousEventLoop);
  currentState.previousEventLoop = performance.eventLoopUtilization();
  const sample: RuntimeMemorySample = {
    sampledAt: new Date().toISOString(),
    phase,
    pid: process.pid,
    parentPid: process.ppid,
    uptimeSeconds: process.uptime(),
    bundler: process.env.BREADBOARD_DASHBOARD_BUNDLER?.trim() || "standalone",
    memory: process.memoryUsage(),
    heap: getHeapStatistics(),
    heapCode: getHeapCodeStatistics(),
    heapSpaces: getHeapSpaceStatistics(),
    cpu: process.resourceUsage(),
    eventLoop,
  };
  currentState.history.push(sample);
  const excess = currentState.history.length - runtimeMemoryCapacity();
  if (excess > 0) currentState.history.splice(0, excess);
  return sample;
}

export function runtimeMemoryHistory(): readonly RuntimeMemorySample[] {
  return state().history;
}

export function startRuntimeMemorySampling(): void {
  const currentState = state();
  if (currentState.timer) return;
  sampleRuntimeMemory("startup");
  const intervalMs = boundedInteger(
    process.env.BREADBOARD_MEMORY_TELEMETRY_INTERVAL_MS,
    15_000,
    1_000,
    300_000,
  );
  currentState.timer = setInterval(() => sampleRuntimeMemory(), intervalMs);
  currentState.timer.unref();
}
