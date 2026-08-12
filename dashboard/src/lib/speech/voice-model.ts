/**
 * Which local model a chosen voice actually speaks through.
 *
 * Synthesis downloads a missing model on demand, which reads as a hang: the
 * request outlives its timeout while gigabytes arrive in the background. The
 * Speech panel resolves the model up front so it can offer the download as a
 * visible step instead. Kept apart from the component so the mapping — the one
 * piece that silently lies if it drifts from the backend registry — is
 * testable on its own.
 */

export type VoiceProfileLike = {
  voice_type: "cloned" | "preset" | "designed";
  preset_engine?: string | null;
  default_engine?: string | null;
  sample_count?: number;
};

export type SpeechSettingsLike = {
  engine: string;
  modelSize: string;
};

export type SpeechStepInput = {
  serviceAvailable: boolean;
  voiceName: string | null;
  modelDisplayName: string | null;
  modelReady: boolean;
  modelDownloading: boolean;
  readAloudEnabled: boolean;
  voiceReady?: boolean;
};

/**
 * The single sentence the Speech panel leads with: what is left to do, in the
 * order it has to happen. `null` means the service itself is not ready, which
 * the status card above already explains.
 */
export function nextSpeechStep(input: SpeechStepInput): string | null {
  if (!input.serviceAvailable) return null;
  if (!input.voiceName) return "Pick a voice to get started.";
  if (input.voiceReady === false) {
    return `Finish cloning ${input.voiceName} by adding a voice recording.`;
  }
  if (input.modelDownloading) {
    return `Downloading ${input.modelDisplayName}. ${input.voiceName} can speak once it finishes.`;
  }
  if (!input.modelReady) {
    return `${input.voiceName} needs ${input.modelDisplayName} downloaded before it can speak.`;
  }
  if (!input.readAloudEnabled) {
    return "Turn on “Read responses aloud” to use the speaker button under any response.";
  }
  return `Ready: the speaker button under any AI response speaks as ${input.voiceName}.`;
}

/** A cloned profile is only a playable voice after Voicebox accepts a sample. */
export function voiceProfileReady(profile: VoiceProfileLike | undefined | null): boolean {
  return Boolean(profile) && (profile?.voice_type !== "cloned" || (profile.sample_count ?? 0) > 0);
}

/** The engine a voice will be spoken with, honouring an explicit override. */
export function engineForProfile(profile: VoiceProfileLike, settings: SpeechSettingsLike): string {
  if (settings.engine && settings.engine !== "auto") return settings.engine;
  return profile.default_engine || profile.preset_engine || "qwen";
}

/** `null` when the engine is unknown: never block a voice on a guess. */
export function requiredModelName(
  profile: VoiceProfileLike | undefined | null,
  settings: SpeechSettingsLike,
): string | null {
  if (!profile) return null;
  switch (engineForProfile(profile, settings)) {
    case "kokoro":
      return "kokoro";
    case "qwen_custom_voice":
      return `qwen-custom-voice-${settings.modelSize}`;
    case "qwen":
      return `qwen-tts-${settings.modelSize}`;
    case "luxtts":
      return "luxtts";
    case "chatterbox":
      return "chatterbox-tts";
    case "chatterbox_turbo":
      return "chatterbox-turbo";
    case "tada":
      return settings.modelSize === "3B" ? "tada-3b-ml" : "tada-1b";
    default:
      return null;
  }
}
