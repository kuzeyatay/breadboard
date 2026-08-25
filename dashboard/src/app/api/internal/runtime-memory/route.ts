import { timingSafeEqual } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { MEMORY_BENCHMARK_PROBE } from "@/lib/runtime-memory-benchmark-probe.ts";
import {
  runtimeMemoryHistory,
  runtimeMemoryCapacity,
  sampleRuntimeMemory,
} from "@/lib/runtime-memory.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function expectedToken(): string {
  return (
    process.env.BREADBOARD_MEMORY_DIAGNOSTIC_TOKEN?.trim() ||
    process.env.BREADBOARD_SUPERVISOR_CONTROL_TOKEN?.trim() ||
    ""
  );
}

function authorized(request: NextRequest, expected: string): boolean {
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}

export async function GET(request: NextRequest) {
  const token = expectedToken();
  if (!token) return new NextResponse(null, { status: 404 });
  if (!authorized(request, token)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const phase = request.nextUrl.searchParams.get("phase")?.slice(0, 80) || "diagnostic";
  const current = sampleRuntimeMemory(phase);
  const includeHistory = request.nextUrl.searchParams.get("history") === "1";
  return NextResponse.json(
    {
      current,
      history: includeHistory ? runtimeMemoryHistory() : undefined,
      benchmarkProbe: MEMORY_BENCHMARK_PROBE,
      historyCapacity: runtimeMemoryCapacity(),
    },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
