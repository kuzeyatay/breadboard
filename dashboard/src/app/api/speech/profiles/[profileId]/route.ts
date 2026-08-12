import { NextResponse } from "next/server";
import { requireUserId, routeErrorResponse } from "@/lib/server-auth";
import { voiceboxJson } from "@/lib/speech/voicebox-client";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ profileId: string }> },
) {
  try {
    await requireUserId();
    const { profileId } = await params;
    const result = await voiceboxJson(`/profiles/${encodeURIComponent(profileId)}`, {
      method: "DELETE",
    });
    return NextResponse.json(result);
  } catch (error) {
    return routeErrorResponse(error);
  }
}

