import { NextResponse } from "next/server";
import { requireUserId, routeErrorResponse } from "@/lib/server-auth";
import { voiceboxJson } from "@/lib/speech/voicebox-client";

export async function POST(request: Request) {
  try {
    await requireUserId();
    const body = await request.json();
    const profile = await voiceboxJson("/profiles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return NextResponse.json(profile, { status: 201 });
  } catch (error) {
    return routeErrorResponse(error);
  }
}

