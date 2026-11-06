import { NextResponse } from "next/server";
import { requireUserId, routeErrorResponse, RouteError } from "@/lib/server-auth";
import { voiceboxJson } from "@/lib/speech/voicebox-client";
import { getSpeechSettings } from "@/lib/speech/settings";
import { subscriptionStatus } from "@/lib/speech/subscription-server";
import { elevenLabsCredentialStatus } from "@/lib/speech/elevenlabs-credentials";
import { webSpeechStatus } from "@/lib/speech/web-speech";
import { requiredModelName, type VoiceProfileLike } from '@/lib/speech/voice-model';
import db from '@/lib/db';
import { readVoiceAssistantPreferences } from '@/lib/speech/assistant-store';

export const dynamic = "force-dynamic";

/**
 * Prepares the selected speech provider in the background. Cloud checks
 * credentials; Local starts Voicebox and warms installed models on startup.
 */
export async function POST(request?: Request) {
  try {
    const userId = await requireUserId();
    const startup = request ? (await request.json().catch(() => null))?.startup === true : false;
    const settings = getSpeechSettings(userId);
    if (startup && (!settings.enabled || !readVoiceAssistantPreferences(db, userId).startVoiceOnStartup)) {
      return NextResponse.json({ ready: false, skipped: true });
    }
    if (settings.speechProvider === "elevenlabs") {
      const status = elevenLabsCredentialStatus(userId);
      if (!status.configured) throw new RouteError(409, status.error || "Add your ElevenLabs API key in Voice settings first.");
      return NextResponse.json({ ready: true, provider: "elevenlabs" });
    }
    if (settings.speechProvider === "chatgpt") {
      const status = await subscriptionStatus(userId);
      if (!status.configured) throw new RouteError(503, status.error || "The subscription voice connection is unavailable. Re-check it in Voice settings.");
      return NextResponse.json({ ready: true, provider: "chatgpt" });
    }
    if (settings.speechProvider === "openaiweb") {
      const status = await webSpeechStatus(userId);
      if (!status.configured) throw new RouteError(503, status.error || "OpenAI (web) speech is unavailable. Re-check it in Voice settings.");
      return NextResponse.json({ ready: true, provider: "openaiweb" });
    }
    const status = await voiceboxJson<{ models: { model_name: string; downloaded: boolean; loaded: boolean; downloading: boolean }[] }>("/models/status", {}, 10 * 60_000);
    if (startup) {
      const profile = settings.profileId ? await voiceboxJson<VoiceProfileLike>(`/profiles/${encodeURIComponent(settings.profileId)}`) : null;
      const names = [`whisper-${settings.transcriptionModel}`, requiredModelName(profile, settings)].filter((name): name is string => Boolean(name));
      const missing: string[] = [], warming: string[] = [];
      for (const name of names) {
        const model = status.models.find(model => model.model_name === name);
        if (!model?.downloaded && !model?.loaded) { missing.push(name); continue; }
        if (model.loaded) continue;
        warming.push(name);
        // This existing endpoint loads cached weights too. Startup only loads
        // installed models; downloading a new model remains an explicit setting.
        if (!model.downloading) await voiceboxJson('/models/download', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model_name: name }),
        });
      }
      return NextResponse.json({ ready: !missing.length && !warming.length, warming: warming.length > 0, missing });
    }
    return NextResponse.json({ ready: true });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
