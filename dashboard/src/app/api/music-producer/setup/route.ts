import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { requireUserId } from "@/lib/server-auth";
import { readJsonBody } from "@/lib/hermes/route-helpers.ts";
import { cancelRuntimeJobByIdempotencyKey, inspectRuntimeJob, lookupRuntimeJobByIdempotencyKey, submitRuntimeJob, RuntimeJobControlError } from "@/lib/supervisor-control.ts";
import { musicRouteError } from "@/lib/music-producer/route-error.ts";
import { musicSetup, saveMusicSetup, claimMusicSetup } from "@/lib/music-producer/setup-state.ts";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const terminal = new Set(["succeeded", "failed", "cancelled", "resource_exhausted", "interrupted", "uncertain"]);
async function current(userId: number) {
  const saved = musicSetup(userId);
  if (!saved)
    return null;
  const authority = { userId, gardenId: null, conversationId: null };
  let job;
  try {
    job = saved.job_id ? await inspectRuntimeJob(authority, saved.job_id) : await lookupRuntimeJobByIdempotencyKey(authority, saved.request_id);
  }
  catch (error) {
    if (error instanceof RuntimeJobControlError && error.code === "JOB_NOT_FOUND")
      return null;
    throw error;
  }
  if (job && (job.jobType !== "managed-setup" || job.workerKind !== "managed-setup-node"))
    throw new Error("setup_scope_mismatch");
  return job;
}
export async function POST(request: Request) {
  try {
    const userId = await requireUserId(), body = await readJsonBody(request, 1024);
    if (body.confirmDownloads !== true || Object.keys(body).some(key => key !== "confirmDownloads"))
      return NextResponse.json({ error: "Explicit setup authorization is required." }, { status: 400 });
    const observed = musicSetup(userId);
    const previous = await current(userId);
    if (previous && !terminal.has(previous.state))
      return NextResponse.json({ ok: true, jobId: previous.jobId, state: previous.state }, { status: 202 });
    const requestId = claimMusicSetup(userId, observed?.request_id ?? null, `acestep-setup:${userId}:${randomUUID()}`);
    const job = await submitRuntimeJob({ userId, gardenId: null, conversationId: null }, {
      jobType: "managed-setup", idempotencyKey: requestId,
      requestPayload: { protocolVersion: 1, operation: "acestep", action: "install" }, inputUploads: [],
    });
    saveMusicSetup(userId, requestId, job.jobId);
    return NextResponse.json({ ok: true, jobId: job.jobId, state: job.state }, { status: 202 });
  }
  catch (error) {
    return musicRouteError(error);
  }
}
export async function GET() {
  try {
    const userId = await requireUserId(), job = await current(userId);
    return NextResponse.json(job ? { ok: true, jobId: job.jobId, state: job.state, stage: job.stage, failureCode: job.failureCode } : { ok: true, jobId: null });
  }
  catch (error) {
    return musicRouteError(error);
  }
}
export async function DELETE() {
  try {
    const userId = await requireUserId(), saved = musicSetup(userId);
    if (saved)
      await cancelRuntimeJobByIdempotencyKey({ userId, gardenId: null, conversationId: null }, saved.request_id);
    return NextResponse.json({ ok: true });
  }
  catch (error) {
    return musicRouteError(error);
  }
}
