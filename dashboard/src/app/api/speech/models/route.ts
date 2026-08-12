import { NextResponse } from "next/server";
import { requireUserId, routeErrorResponse, RouteError } from "@/lib/server-auth";
import { voiceboxJson } from "@/lib/speech/voicebox-client";

export async function POST(request: Request) {
  try {
    await requireUserId();
    const body = (await request.json()) as { modelName?: unknown };
    const modelName = typeof body.modelName === "string" ? body.modelName.trim() : "";
    if (!/^[a-zA-Z0-9._-]{1,80}$/.test(modelName)) throw new RouteError(400, "Invalid model name.");
    const result = await voiceboxJson("/models/download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model_name: modelName }),
    });
    return NextResponse.json(result, { status: 202 });
  } catch (error) {
    return routeErrorResponse(error);
  }
}

