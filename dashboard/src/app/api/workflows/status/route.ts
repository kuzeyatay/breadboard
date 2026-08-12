import fs from "node:fs";
import { NextResponse } from "next/server";
import { requireUserId, routeErrorResponse } from "@/lib/server-auth";
import { n8nBaseUrl, n8nIsReady } from "@/lib/workflows/n8n";

export const dynamic = "force-dynamic";

type StartupStatus = { phase?: string; message?: string; updatedAt?: string };

function startupStatus(): StartupStatus | null {
  const file = process.env.N8N_STATUS_PATH?.trim();
  if (!file) return null;
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8")) as StartupStatus;
    return {
      phase: typeof value.phase === "string" ? value.phase : undefined,
      message: typeof value.message === "string" ? value.message : undefined,
      updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : undefined,
    };
  } catch {
    return null;
  }
}

export async function GET() {
  try {
    await requireUserId();
    const ready = await n8nIsReady();
    return NextResponse.json(
      { ready, baseUrl: ready ? n8nBaseUrl() : null, startup: startupStatus() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return routeErrorResponse(error);
  }
}
