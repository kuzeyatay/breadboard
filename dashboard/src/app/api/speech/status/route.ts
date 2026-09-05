import { NextResponse } from "next/server";
import { requireUserId, routeErrorResponse } from "@/lib/server-auth";
import { getSpeechSettings } from "@/lib/speech/settings";
import { subscriptionStatus } from "@/lib/speech/subscription-server";
import {
  voiceboxObservationJson,
  voiceboxStartupStatus,
} from "@/lib/speech/voicebox-client";

export const dynamic = "force-dynamic";

type VoiceboxHealth = {
  status: string;
  model_loaded: boolean;
  model_downloaded?: boolean | null;
  model_size?: string | null;
  gpu_available: boolean;
  gpu_type?: string | null;
  backend_type?: string | null;
  backend_variant?: string | null;
};

export async function GET() {
  try {
    const userId = await requireUserId();
    const settings = getSpeechSettings(userId);
    const cloud = await subscriptionStatus(userId);
    if (settings.speechProvider === "chatgpt") {
      return NextResponse.json({
        available: cloud.configured, cloud, settings, health: null, startup: null,
        profiles: [], models: [], presets: { kokoro: [], qwen_custom_voice: [] },
      }, { headers: { "Cache-Control": "no-store" } });
    }
    try {
      const health = await voiceboxObservationJson<VoiceboxHealth>("/health");
      const [profiles, models, kokoro, qwen] = await Promise.all([
        voiceboxObservationJson<unknown[]>("/profiles"),
        voiceboxObservationJson<{ models: unknown[] }>("/models/status").catch(() => ({ models: [] })),
        voiceboxObservationJson<{ voices: unknown[] }>("/profiles/presets/kokoro").catch(() => ({ voices: [] })),
        voiceboxObservationJson<{ voices: unknown[] }>("/profiles/presets/qwen_custom_voice").catch(() => ({ voices: [] })),
      ]);
      return NextResponse.json({
        available: true,
        cloud,
        health,
        profiles,
        models: models.models,
        presets: { kokoro: kokoro.voices, qwen_custom_voice: qwen.voices },
        settings,
        startup: voiceboxStartupStatus(),
      });
    } catch (error) {
      return NextResponse.json({
        available: false,
        cloud,
        error: error instanceof Error ? error.message : "Voicebox is unavailable.",
        health: null,
        profiles: [],
        models: [],
        presets: { kokoro: [], qwen_custom_voice: [] },
        settings,
        startup: voiceboxStartupStatus(),
      });
    }
  } catch (error) {
    return routeErrorResponse(error);
  }
}
