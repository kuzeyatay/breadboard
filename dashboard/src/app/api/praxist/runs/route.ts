import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { resolveChatmockBaseUrl } from "@/lib/chatmock-server.ts";
import { parsePraxistTaskPath } from "@/lib/praxist/identity.ts";
import { resolvePraxistTaskProject } from "@/lib/praxist/runtime.ts";
import { startRun } from "@/lib/praxist/run-manager.ts";
import { runtimeAuthorityErrorResponse } from "@/lib/runtime-v2/authority-errors.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const text = await request.text();
    if (text.length > 16 * 1024) {
      return NextResponse.json({ ok: false, error: "payload_too_large" }, { status: 413 });
    }
    const body = text ? JSON.parse(text) as Record<string, unknown> : {};
    const rawTask = typeof body.task === "string" ? body.task : "";
    const model = typeof body.model === "string" ? body.model.trim() : "";
    const taskPath = resolvePraxistTaskProject(parsePraxistTaskPath(rawTask));
    if (!model || model.length > 256 || /[\u0000\r\n]/u.test(model)) {
      return NextResponse.json({ ok: false, error: "model_not_configured" }, { status: 400 });
    }
    const { baseURL } = resolveChatmockBaseUrl(request);
    const run = await startRun({ userId, taskPath, model, baseUrl: baseURL });
    return NextResponse.json({ ok: true, run }, { status: 201 });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
    }
    if (error instanceof RouteError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    const runtimeResponse = runtimeAuthorityErrorResponse(error);
    if (runtimeResponse) return runtimeResponse;
    const message = error instanceof Error ? error.message : "runtime_error";
    const invalidTask = /task project|task-project|absolute task/iu.test(message);
    return NextResponse.json(
      { ok: false, error: message },
      { status: invalidTask ? 400 : 502 },
    );
  }
}
