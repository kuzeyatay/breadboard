import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { readInboxZeroStatus } from "@/lib/inbox-zero/runtime-service.ts";
import { isRuntimeV2ServiceControlConfigured, readSupervisedServiceSnapshot } from "@/lib/supervisor-control.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function stoppingResponse() {
  if (!isRuntimeV2ServiceControlConfigured()) return null;
  const snapshot = await readSupervisedServiceSnapshot("inbox-zero-stack");
  if (snapshot?.state !== "stopping") return null;
  return NextResponse.json({
    ok: true,
    available: false,
    runtimeState: "stopping",
    message: "Inbox Zero's controller is finishing its idle shutdown. Wait up to a minute, then retry the status check.",
    retryAfterSeconds: 60,
  });
}

export async function GET() {
  try {
    const userId = await requireUserId();
    const stopping = await stoppingResponse();
    if (stopping) return stopping;
    // Health never starts containers: opening a settings panel must not cost a
    // four-image pull. The Runtime-owned controller observes; only a run or an
    // explicit setup action may issue Compose commands.
    try {
      return NextResponse.json({ ok: true, ...(await readInboxZeroStatus({ userId })) });
    } catch (error) {
      // Idle shutdown can begin after the snapshot but before lease admission.
      // Only a confirmed native transition changes the error classification.
      const stopping = await stoppingResponse().catch(() => null);
      if (stopping) return stopping;
      throw error;
    }
  } catch (error) {
    if (error instanceof RouteError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
