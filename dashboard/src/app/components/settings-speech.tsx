"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import VoiceSampleRecorder from "@/app/components/voice-sample-recorder";
import { calibrationPassage } from "@/lib/speech/calibration";
import { decodedRecordingAsWav } from "@/lib/speech/live-dictation";
import { playSpeechBlob, stopSpeechPlayback } from "@/lib/speech/playback";
import {
  fetchSpeechApi,
  prepareLocalSpeech,
  speechErrorMessage,
} from "@/lib/speech/prepare-client";
import { nextSpeechStep, requiredModelName, voiceProfileReady } from "@/lib/speech/voice-model";

type SpeechSettings = {
  enabled: boolean;
  profileId: string | null;
  language: string;
  engine: string;
  modelSize: string;
  transcriptionLanguage: string | null;
  transcriptionModel: string;
};

type VoiceProfile = {
  id: string;
  name: string;
  description?: string | null;
  language: string;
  voice_type: "cloned" | "preset" | "designed";
  preset_engine?: string | null;
  preset_voice_id?: string | null;
  default_engine?: string | null;
  sample_count: number;
};

type PresetVoice = { voice_id: string; name: string; gender?: string; language?: string };
type ModelStatus = {
  model_name: string;
  display_name: string;
  downloaded: boolean;
  downloading: boolean;
  loaded: boolean;
  size_mb?: number | null;
};

type SpeechStatus = {
  available: boolean;
  error?: string;
  settings: SpeechSettings;
  profiles: VoiceProfile[];
  models: ModelStatus[];
  presets: { kokoro: PresetVoice[]; qwen_custom_voice: PresetVoice[] };
  startup: null | {
    phase: string;
    message: string;
    updatedAt: string;
    startedAt: string | null;
    step: number | null;
    totalSteps: number | null;
    detail: string | null;
    progress: { receivedBytes: number; totalBytes: number } | null;
    stalled: boolean;
  };
  health: null | {
    model_loaded: boolean;
    gpu_available: boolean;
    gpu_type?: string | null;
    backend_variant?: string | null;
  };
};

const LANGUAGES = [
  ["en", "English"], ["zh", "Chinese"], ["ja", "Japanese"], ["ko", "Korean"],
  ["de", "German"], ["fr", "French"], ["es", "Spanish"], ["it", "Italian"],
  ["pt", "Portuguese"], ["ru", "Russian"], ["tr", "Turkish"], ["ar", "Arabic"],
  ["nl", "Dutch"], ["pl", "Polish"], ["sv", "Swedish"], ["hi", "Hindi"],
] as const;

const LANGUAGE_LABELS = new Map<string, string>(LANGUAGES.map(([code, label]) => [code, label]));

const ENGINE_OPTIONS = [
  ["auto", "Automatic (match the voice)"],
  ["qwen", "Qwen voice clone"],
  ["qwen_custom_voice", "Qwen built-in voices"],
  ["kokoro", "Kokoro built-in voices"],
  ["luxtts", "LuxTTS voice clone"],
  ["chatterbox", "Chatterbox voice clone"],
  ["chatterbox_turbo", "Chatterbox Turbo"],
  ["tada", "TADA voice clone"],
] as const;

/** Only these two Qwen sizes exist as downloadable models. */
const QWEN_SIZES = [
  ["0.6B", "0.6B · lighter and faster"],
  ["1.7B", "1.7B · better quality"],
] as const;

const VOICE_FAMILIES = [
  { id: "kokoro", name: "Kokoro", hint: "Small download, quick to start" },
  { id: "qwen_custom_voice", name: "Qwen", hint: "More expressive, large download" },
] as const;

const SPEECH_ACCELERATORS = [
  {
    hardware: "Apple Silicon",
    platform: "M-series Macs",
    backend: "MLX + Metal",
    note: "Built in; no separate GPU package is needed.",
  },
  {
    hardware: "NVIDIA GPU",
    platform: "Windows or Linux",
    backend: "CUDA",
    note: "Uses Voicebox's CUDA-enabled PyTorch backend.",
  },
  {
    hardware: "AMD Radeon",
    platform: "Linux",
    backend: "ROCm",
    note: "Voicebox configures its ROCm compatibility path automatically.",
  },
  {
    hardware: "Intel Arc",
    platform: "Discrete Intel GPUs",
    backend: "XPU",
    note: "Uses Intel's PyTorch XPU acceleration path.",
  },
  {
    hardware: "Windows GPU",
    platform: "NVIDIA, AMD, or Intel",
    backend: "DirectML",
    note: "The universal Windows path when a vendor backend is not a fit.",
  },
] as const;

const VOICE_TYPE_LABELS: Record<VoiceProfile["voice_type"], string> = {
  preset: "Built-in",
  cloned: "Cloned",
  designed: "Designed",
};

const fieldClass =
  "neu-inset w-full rounded-xl border border-[var(--line)] bg-[var(--paper-surface)] px-3 py-2 text-sm text-[var(--ink)] outline-none transition focus:border-[var(--line-strong)] focus:ring-2 focus:ring-[var(--botanical)]/15";
const secondaryButton =
  "neu-button rounded-xl border border-[var(--line)] bg-[var(--paper-raised)] px-3 py-2 text-sm text-[var(--ink)] transition hover:bg-[var(--paper-strong)] disabled:cursor-not-allowed disabled:opacity-45";
const primaryButton =
  "neu-button-accent rounded-xl border border-[var(--botanical)] bg-[var(--botanical)] px-3 py-2 text-sm font-medium text-[var(--paper-raised)] transition hover:bg-[var(--botanical-hover)] disabled:cursor-not-allowed disabled:opacity-45";

async function apiError(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  return body?.error || `Request failed (${response.status}).`;
}

/** Setup phases that are an outcome rather than work still in flight. */
const SETTLED_STARTUP_PHASES = new Set(["ready", "installed", "error", "stopped", "interrupted"]);

function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
  if (bytes >= 1_000_000) return `${Math.round(bytes / 1_000_000)} MB`;
  if (bytes >= 1_000) return `${Math.round(bytes / 1_000)} kB`;
  return `${bytes} B`;
}

function formatSince(iso: string | null | undefined, now: number): string | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return null;
  const seconds = Math.max(0, Math.round((now - then) / 1_000));
  if (seconds < 60) return `${seconds} second${seconds === 1 ? "" : "s"}`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"}`;
  return `${Math.round(hours / 24)} days`;
}

function describeVoice(profile: VoiceProfile): string {
  const language = LANGUAGE_LABELS.get(profile.language) || profile.language;
  return `${VOICE_TYPE_LABELS[profile.voice_type]} · ${language}`;
}

export default function SettingsSpeech() {
  const [status, setStatus] = useState<SpeechStatus | null>(null);
  const [draft, setDraft] = useState<SpeechSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [preparing, setPreparing] = useState(false);
  const [working, setWorking] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [previewText, setPreviewText] = useState("Breadboard can read this response aloud in your chosen voice.");
  const [addingVoice, setAddingVoice] = useState(false);
  const [source, setSource] = useState<"preset" | "clone">("preset");
  const [profileName, setProfileName] = useState("");
  const [profileLanguage, setProfileLanguage] = useState("en");
  const [repairProfile, setRepairProfile] = useState<VoiceProfile | null>(null);
  const [presetEngine, setPresetEngine] = useState<"kokoro" | "qwen_custom_voice">("kokoro");
  const [presetLanguage, setPresetLanguage] = useState("en");
  const [sampleMode, setSampleMode] = useState<"record" | "upload">("record");
  const [sample, setSample] = useState<File | null>(null);
  const [sampleTranscript, setSampleTranscript] = useState("");
  const [recorderKey, setRecorderKey] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const mountedRef = useRef(true);
  const pickerDecidedRef = useRef(false);
  const sampleFileRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetchSpeechApi("/api/speech/status", { cache: "no-store" });
      if (!response.ok) throw new Error(await apiError(response));
      const next = (await response.json()) as SpeechStatus;
      if (!mountedRef.current) return;
      setStatus(next);
      setDraft(next.settings);
      // Open the picker for someone with no voice yet, but only decide that
      // once: polling must not reopen a panel they closed.
      if (!pickerDecidedRef.current) {
        pickerDecidedRef.current = true;
        setAddingVoice(next.profiles.length === 0);
      }
    } catch (error) {
      if (mountedRef.current) {
        setNotice(speechErrorMessage(error, "Speech settings could not be loaded."));
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  const prepare = useCallback(async () => {
    setPreparing(true);
    setNotice(null);
    try {
      await prepareLocalSpeech();
      if (mountedRef.current) await load();
    } catch (error) {
      if (mountedRef.current) {
        setNotice(speechErrorMessage(error, "Local speech could not start."));
      }
    } finally {
      if (mountedRef.current) setPreparing(false);
    }
  }, [load]);

  useEffect(() => {
    mountedRef.current = true;
    void load();
    void prepare();
    return () => {
      mountedRef.current = false;
      stopSpeechPlayback();
    };
  }, [load, prepare]);

  const startup = status?.startup ?? null;
  const installActive = Boolean(
    startup && !SETTLED_STARTUP_PHASES.has(startup.phase) && !startup.stalled,
  );
  const serviceStarting = preparing || installActive;
  const modelsDownloading = Boolean(status?.models.some((model) => model.downloading));

  useEffect(() => {
    if (!status || status.available) return;
    const timer = window.setTimeout(() => void load(), installActive ? 2_000 : 5_000);
    return () => window.clearTimeout(timer);
  }, [installActive, load, status]);

  // A model download runs in the background; keep the row honest without
  // making the user press Re-check.
  useEffect(() => {
    if (!modelsDownloading) return;
    const timer = window.setInterval(() => void load(), 3_000);
    return () => window.clearInterval(timer);
  }, [load, modelsDownloading]);

  // Elapsed times are rendered from timestamps, so they need their own tick to
  // stay honest between polls.
  useEffect(() => {
    if (status?.available !== false) return;
    const timer = window.setInterval(() => setNow(Date.now()), installActive ? 1_000 : 15_000);
    return () => window.clearInterval(timer);
  }, [installActive, status?.available]);

  /** Preferences save as they are changed: there is nothing to submit. */
  const updateSettings = useCallback(
    async (patch: Partial<SpeechSettings>): Promise<SpeechSettings | null> => {
      const base = draft;
      if (!base) return null;
      const next = { ...base, ...patch };
      setDraft(next);
      setSaveState("saving");
      try {
        const response = await fetch("/api/speech/settings", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(next),
        });
        if (!response.ok) throw new Error(await apiError(response));
        const result = (await response.json()) as { settings: SpeechSettings };
        if (!mountedRef.current) return result.settings;
        setDraft(result.settings);
        setStatus((current) => (current ? { ...current, settings: result.settings } : current));
        setSaveState("saved");
        window.setTimeout(() => {
          if (mountedRef.current) setSaveState((state) => (state === "saved" ? "idle" : state));
        }, 1_800);
        return result.settings;
      } catch (error) {
        if (mountedRef.current) {
          setSaveState("idle");
          setNotice(error instanceof Error ? error.message : "Speech preferences could not be saved.");
        }
        return null;
      }
    },
    [draft],
  );

  async function previewVoice(profileId?: string) {
    const target = profileId ?? draft?.profileId ?? null;
    if (!target) return;
    setWorking("preview");
    setNotice(null);
    try {
      // Speaking is gated on both the voice and the master switch, so make the
      // preview mean "use this voice" rather than fail with a 409.
      if (target !== draft?.profileId || !draft?.enabled) {
        await updateSettings({ profileId: target, enabled: true });
      }
      const response = await fetch("/api/speech/synthesize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: previewText }),
      });
      if (!response.ok) throw new Error(await apiError(response));
      await playSpeechBlob(await response.blob(), () => setWorking(null));
      setWorking("playing");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The voice preview could not be played.");
      setWorking(null);
    }
  }

  async function createProfile(body: Record<string, unknown>, label: string) {
    const response = await fetch("/api/speech/profiles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(await apiError(response));
    const profile = (await response.json()) as VoiceProfile;
    await updateSettings({ profileId: profile.id, engine: "auto", enabled: true });
    await load();
    setAddingVoice(false);
    setNotice(`${label} is ready to use.`);
    return profile;
  }

  async function addBuiltInVoice(voice: PresetVoice) {
    setWorking(`preset:${voice.voice_id}`);
    setNotice(null);
    try {
      await createProfile(
        {
          name: voice.name,
          language: voice.language || presetLanguage,
          voice_type: "preset",
          preset_engine: presetEngine,
          preset_voice_id: voice.voice_id,
          default_engine: presetEngine,
        },
        voice.name,
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The voice could not be added.");
    } finally {
      setWorking(null);
    }
  }

  /** Drops whatever sample is staged, whichever way it was staged. */
  function clearStagedSample() {
    setSample(null);
    setSampleTranscript("");
    setRecorderKey((key) => key + 1);
    if (sampleFileRef.current) sampleFileRef.current.value = "";
  }

  async function createClonedVoice() {
    if (!repairProfile && !profileName.trim()) {
      setNotice("Give the cloned voice a name.");
      return;
    }
    if (!sample) {
      setNotice(
        sampleMode === "record"
          ? "Record the passage before creating the voice."
          : "Choose an audio file to clone the voice from.",
      );
      return;
    }
    if (!sampleTranscript.trim()) {
      setNotice(
        sampleMode === "upload"
          ? "Add a transcript for the uploaded audio."
          : "Record the passage again so Breadboard can pair it with the voice sample.",
      );
      return;
    }
    setWorking("create");
    setNotice(null);
    let createdProfileId: string | null = null;
    try {
      let profile = repairProfile;
      if (!profile) {
        const profileResponse = await fetch("/api/speech/profiles", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: profileName.trim(),
            language: profileLanguage,
            voice_type: "cloned",
            default_engine: "qwen",
          }),
        });
        if (!profileResponse.ok) throw new Error(await apiError(profileResponse));
        profile = (await profileResponse.json()) as VoiceProfile;
        createdProfileId = profile.id;
      }
      const form = new FormData();
      let preparedSample = sample;
      if (sample.type !== "audio/wav" && !sample.name.toLowerCase().endsWith(".wav")) {
        const wav = await decodedRecordingAsWav(sample, 48_000);
        if (wav?.size) {
          preparedSample = new File([wav], "voice-sample.wav", { type: "audio/wav" });
        } else if (sampleMode === "record") {
          throw new Error("Breadboard could not prepare that recording. Record it again, or upload a WAV file instead.");
        }
      }
      form.set("file", preparedSample);
      form.set("reference_text", sampleTranscript.trim());
      const sampleResponse = await fetch(`/api/speech/profiles/${encodeURIComponent(profile.id)}/samples`, {
        method: "POST",
        body: form,
      });
      if (!sampleResponse.ok) throw new Error(await apiError(sampleResponse));
      await updateSettings({ profileId: profile.id, engine: "auto", enabled: true });
      setProfileName("");
      clearStagedSample();
      await load();
      setRepairProfile(null);
      setAddingVoice(false);
      setNotice(`${profile.name} is ready to use.`);
    } catch (error) {
      // Profile creation and sample validation are two Voicebox requests. If
      // the sample is rejected, roll the new shell back so it cannot appear as
      // a playable "0 samples" clone. Existing shells remain repairable.
      if (createdProfileId) {
        await fetch(`/api/speech/profiles/${encodeURIComponent(createdProfileId)}`, {
          method: "DELETE",
        }).catch(() => null);
      }
      setNotice(error instanceof Error ? error.message : "The voice profile could not be created.");
    } finally {
      setWorking(null);
    }
  }

  function finishClonedVoice(profile: VoiceProfile) {
    stopSpeechPlayback();
    clearStagedSample();
    setRepairProfile(profile);
    setProfileLanguage(profile.language);
    setSource("clone");
    setAddingVoice(true);
    setNotice(`${profile.name} still needs a recording. Add one below to finish the clone.`);
  }

  async function deleteProfile(profile: VoiceProfile) {
    if (!window.confirm(`Delete the voice “${profile.name}”? This cannot be undone.`)) return;
    setWorking("delete");
    try {
      const response = await fetch(`/api/speech/profiles/${encodeURIComponent(profile.id)}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await apiError(response));
      if (draft?.profileId === profile.id) await updateSettings({ profileId: null });
      await load();
      setNotice(`${profile.name} was deleted.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The voice profile could not be deleted.");
    } finally {
      setWorking(null);
    }
  }

  async function downloadModel(modelName: string) {
    setWorking(modelName);
    setNotice(null);
    try {
      const response = await fetch("/api/speech/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelName }),
      });
      if (!response.ok) throw new Error(await apiError(response));
      setNotice("Download started. You can close this panel; it continues in the background.");
      window.setTimeout(() => void load(), 1_200);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The model download could not be started.");
    } finally {
      setWorking(null);
    }
  }

  if (loading && !draft) {
    return <div className="py-10 text-center text-sm text-[var(--ink-muted)]">Checking the local speech service…</div>;
  }

  if (!draft) {
    return <div role="alert" className="rounded-xl border border-[var(--line)] bg-[var(--paper-surface)] p-4 text-sm text-[var(--ink)]">{notice || "Speech settings are unavailable."}</div>;
  }

  const profiles = status?.profiles || [];
  const selectedProfile = profiles.find((profile) => profile.id === draft.profileId);
  const presetVoices = (status?.presets[presetEngine] || []).filter(
    (voice) => presetLanguage === "all" || !voice.language || voice.language === presetLanguage,
  );
  const presetLanguagesAvailable = Array.from(
    new Set((status?.presets[presetEngine] || []).map((voice) => voice.language).filter(Boolean)),
  ) as string[];
  const passage = calibrationPassage(profileLanguage);

  /** Switching how the sample arrives abandons the one staged the other way. */
  function selectSampleMode(mode: "record" | "upload") {
    if (mode === sampleMode) return;
    setSampleMode(mode);
    clearStagedSample();
  }

  const findModel = (name: string | null) =>
    name ? status?.models.find((model) => model.model_name === name) ?? null : null;
  const requiredModel = findModel(requiredModelName(selectedProfile, draft));
  const modelReady = !requiredModel || requiredModel.downloaded || requiredModel.loaded;
  const whisperModel = findModel(`whisper-${draft.transcriptionModel}`);

  const stalled = Boolean(startup?.stalled);
  const failed = startup?.phase === "error";
  const progress = startup?.progress ?? null;
  const percent = progress
    ? Math.min(100, Math.round((progress.receivedBytes / progress.totalBytes) * 100))
    : null;
  const runningFor = formatSince(startup?.startedAt, now);
  const lastUpdate = formatSince(startup?.updatedAt, now);
  const stepLabel =
    startup?.step && startup.totalSteps ? `Step ${startup.step} of ${startup.totalSteps}` : null;
  const showHardwareGuide =
    status?.available === false &&
    startup?.phase !== "installed" &&
    startup?.phase !== "ready";

  // One always-true sentence about what is left to do.
  const nextStep = nextSpeechStep({
    serviceAvailable: Boolean(status?.available),
    voiceName: selectedProfile?.name ?? null,
    modelDisplayName: requiredModel?.display_name ?? null,
    modelReady,
    modelDownloading: Boolean(requiredModel?.downloading),
    readAloudEnabled: draft.enabled,
    voiceReady: selectedProfile ? voiceProfileReady(selectedProfile) : true,
  });

  /**
   * Status reads on the left, actions on the right. A bare status dot in the
   * button slot looked like a button that had stopped working — and there is
   * no honest action to put there mid-download: Voicebox's cancel endpoint
   * only forgets the task, leaving the transfer running with nothing tracking
   * it.
   */
  function modelRow(model: ModelStatus, emphasis: boolean) {
    const ready = model.downloaded || model.loaded;
    const state = model.loaded
      ? "Loaded and ready"
      : model.downloaded
        ? "Downloaded"
        : model.downloading
          ? "Downloading… this continues in the background"
          : "Not downloaded";
    return (
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={`h-2.5 w-2.5 shrink-0 rounded-full ${ready ? "bg-[var(--botanical)]" : model.downloading ? "animate-pulse bg-[#c78b58]" : "bg-[var(--line-strong)]"}`}
            aria-hidden
          />
          <div className="min-w-0">
            <p className={`truncate text-xs ${emphasis ? "font-medium text-[var(--ink)]" : "text-[var(--ink)]"}`}>{model.display_name}</p>
            <p className="text-[11px] text-[var(--ink-muted)]">
              {state}
              {model.size_mb ? ` · ${Math.round(model.size_mb)} MB` : ""}
            </p>
          </div>
        </div>
        {ready || model.downloading ? null : (
          <button
            type="button"
            className={emphasis ? primaryButton : secondaryButton}
            onClick={() => void downloadModel(model.model_name)}
            disabled={Boolean(working)}
          >
            {working === model.model_name ? "Starting…" : "Download"}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <section className="neu-surface rounded-2xl border border-[var(--line)] bg-[var(--paper-surface)] p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className={`h-2.5 w-2.5 rounded-full ${status?.available ? "bg-[var(--botanical)]" : stalled || failed ? "bg-[var(--danger)]" : "bg-[#c78b58]"} ${serviceStarting ? "animate-pulse" : ""}`} aria-hidden />
              <h3 className="text-sm font-medium text-[var(--ink-heading)]">Local speech service</h3>
            </div>
            <p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">
              {status?.available
                ? `Voicebox is ready${status.health?.gpu_type ? ` on ${status.health.gpu_type}` : ""}. Voice audio and recordings stay on this machine.`
                : preparing
                  ? "Voicebox is starting for Voice settings. The first cold start can take a little while."
                  : stalled
                  ? "Setup stopped before it finished."
                  : startup?.message || status?.error || "Voicebox is starting with Breadboard."}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void (status?.available ? load() : prepare())}
            className={secondaryButton}
            disabled={loading || preparing}
          >
            {preparing ? "Starting…" : status?.available ? "Re-check" : "Start"}
          </button>
        </div>
        {!status?.available ? (
          <div className="mt-3 space-y-2 rounded-xl border border-[var(--line)] bg-[var(--paper-raised)] p-3 text-xs leading-5 text-[var(--ink-muted)]">
            {installActive ? (
              <>
                <p className="text-[var(--ink)]">
                  {stepLabel ? `${stepLabel} · ` : ""}
                  {startup?.message}
                </p>
                {startup?.detail ? (
                  <p>
                    {startup.detail}
                    {progress
                      ? ` · ${formatBytes(progress.receivedBytes)} of ${formatBytes(progress.totalBytes)} (${percent}%)`
                      : ""}
                  </p>
                ) : null}
                {percent !== null ? (
                  <div
                    className="neu-progress-track h-1.5 overflow-hidden rounded-full bg-[var(--line)]"
                    role="progressbar"
                    aria-label="Speech setup download"
                    aria-valuenow={percent}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <div className="h-full rounded-full bg-[var(--botanical)] transition-[width] duration-500" style={{ width: `${percent}%` }} />
                  </div>
                ) : null}
                <p>
                  {runningFor ? `Running for ${runningFor}. ` : ""}
                  You can close this panel and keep using Breadboard; speech becomes ready on its
                  own. The speech engines and GPU packages are several gigabytes, so the first
                  setup usually takes a while.
                </p>
              </>
            ) : stalled ? (
              <>
                <p className="text-[var(--ink)]">Nothing is installing right now.</p>
                <p>
                  Setup last reported progress {lastUpdate} ago
                  {stepLabel ? `, at ${stepLabel.toLowerCase()}` : ""}
                  {startup?.message ? ` (${startup.message})` : ""}, and then stopped. Restart
                  Breadboard to pick it up again: finished downloads are cached, so it continues
                  rather than starting over.
                </p>
              </>
            ) : failed ? (
              <>
                <p className="text-[var(--ink)]">Speech setup could not finish.</p>
                <p>{startup?.message}</p>
                <p>
                  Breadboard retries on the next app start; the Voicebox service log holds the full
                  installer output.
                </p>
              </>
            ) : startup?.phase === "installed" ? (
              "Speech dependencies are installed. The service is loading its models and will be ready shortly."
            ) : (
              "Breadboard starts and prepares Voicebox automatically with the rest of its local services. It may still be warming up, so this panel will keep checking in the background."
            )}
          </div>
        ) : null}
      </section>

      {showHardwareGuide ? (
        <section className="space-y-3 rounded-2xl border border-[var(--line)] bg-[var(--paper-surface)] p-4">
          <div>
            <h3 className="text-sm font-medium text-[var(--ink-heading)]">Hardware compatibility</h3>
            <p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">
              A dedicated GPU is optional. Voicebox works on CPU-only computers too, but larger
              voices and transcription models will take longer. These accelerators are supported:
            </p>
          </div>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {SPEECH_ACCELERATORS.map((item) => (
              <li
                key={item.hardware}
                className="rounded-xl border border-[var(--line)] bg-[var(--paper-raised)] p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-[var(--ink)]">{item.hardware}</p>
                    <p className="mt-0.5 text-[11px] text-[var(--ink-muted)]">{item.platform}</p>
                  </div>
                  <span className="shrink-0 rounded-full border border-[var(--line)] bg-[var(--paper-surface)] px-2 py-0.5 text-[10px] text-[var(--botanical)]">
                    {item.backend}
                  </span>
                </div>
                <p className="mt-2 text-[11px] leading-4 text-[var(--ink-muted)]">{item.note}</p>
              </li>
            ))}
          </ul>
          <div className="rounded-xl border border-[var(--line)] bg-[var(--paper-raised)] px-3 py-2.5 text-xs leading-5 text-[var(--ink-muted)]">
            <strong className="font-medium text-[var(--ink)]">No supported GPU?</strong>{" "}
            You can still install Voicebox. Start with Kokoro or LuxTTS for the lightest CPU use;
            choose not to install only if slower local generation would not be useful to you.
          </div>
        </section>
      ) : null}

      {status?.available ? (
        <>
          <section className="space-y-3 rounded-2xl border border-[var(--line)] p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-sm font-medium text-[var(--ink-heading)]">Your voice</h3>
                <p className="mt-0.5 text-xs leading-5 text-[var(--ink-muted)]">{nextStep}</p>
              </div>
              {saveState !== "idle" ? (
                <span className="shrink-0 text-[11px] text-[var(--ink-muted)]">
                  {saveState === "saving" ? "Saving…" : "Saved"}
                </span>
              ) : null}
            </div>

            {profiles.length ? (
              <ul className="space-y-2">
                {profiles.map((profile) => {
                  const active = profile.id === draft.profileId;
                  const voiceReady = voiceProfileReady(profile);
                  // Playing a voice switches to it, so each row answers for its
                  // own model rather than the selected one's.
                  const rowModel = findModel(requiredModelName(profile, draft));
                  const rowReady = voiceReady && (!rowModel || rowModel.downloaded || rowModel.loaded);
                  return (
                    <li key={profile.id}>
                      <div className={`flex items-center gap-3 rounded-xl border p-3 transition ${active ? "border-[var(--botanical)] bg-[var(--paper-strong)]" : "border-[var(--line)] bg-[var(--paper-surface)]"}`}>
                        <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                          <input
                            type="radio"
                            name="speech-voice"
                            className="h-4 w-4 shrink-0 accent-[var(--botanical)]"
                            checked={active}
                            onChange={() => void updateSettings({ profileId: profile.id, engine: "auto" })}
                          />
                          <span className="min-w-0">
                            <span className="block truncate text-sm text-[var(--ink)]">{profile.name}</span>
                            <span className="block text-[11px] text-[var(--ink-muted)]">
                              {describeVoice(profile)}
                              {profile.voice_type === "cloned"
                                ? profile.sample_count > 0
                                  ? ` · ${profile.sample_count} sample${profile.sample_count === 1 ? "" : "s"}`
                                  : " · needs a recording"
                                : ""}
                            </span>
                          </span>
                        </label>
                        {voiceReady ? (
                          <button
                            type="button"
                            className={secondaryButton}
                            onClick={working === "playing" ? stopSpeechPlayback : () => void previewVoice(profile.id)}
                            disabled={!rowReady || Boolean(working && working !== "playing")}
                            title={rowReady ? "Hear this voice" : `${rowModel?.display_name} has to finish downloading first`}
                          >
                            {working === "preview" && active ? "Preparing…" : working === "playing" && active ? "Stop" : "Play"}
                          </button>
                        ) : (
                          <button
                            type="button"
                            className={primaryButton}
                            onClick={() => finishClonedVoice(profile)}
                            disabled={Boolean(working)}
                            title={`Add a recording to finish ${profile.name}`}
                          >
                            Finish
                          </button>
                        )}
                        <button
                          type="button"
                          className="rounded-lg px-2 py-1.5 text-xs text-[var(--danger)] transition hover:bg-[color-mix(in_srgb,var(--danger)_10%,transparent)]"
                          onClick={() => void deleteProfile(profile)}
                          disabled={Boolean(working)}
                          aria-label={`Delete ${profile.name}`}
                        >
                          Delete
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="rounded-xl border border-dashed border-[var(--line-strong)] bg-[var(--paper-surface)] p-3 text-xs leading-5 text-[var(--ink-muted)]">
                No voice yet. Choose a built-in voice below — Breadboard downloads that voice&rsquo;s
                model once, then everything runs on this machine.
              </p>
            )}

            {selectedProfile && voiceProfileReady(selectedProfile) && requiredModel && !modelReady ? (
              <div className="rounded-xl border border-[#c78b58] bg-[color-mix(in_srgb,#c78b58_8%,var(--paper-raised))] p-3">
                <p className="text-xs leading-5 text-[var(--ink)]">
                  {selectedProfile.name} speaks through <strong>{requiredModel.display_name}</strong>
                  {requiredModel.downloading
                    ? ", which is downloading now. You can close this panel; Play switches on by itself once it lands. Stopping it early means restarting the speech service."
                    : ", which is not on this machine yet. Downloading it first avoids a long silent wait the first time you press Play."}
                </p>
                <div className="mt-2">{modelRow(requiredModel, true)}</div>
              </div>
            ) : null}

            {selectedProfile && modelReady && voiceProfileReady(selectedProfile) ? (
              <div className="flex gap-2">
                <input
                  value={previewText}
                  onChange={(event) => setPreviewText(event.target.value)}
                  className={`${fieldClass} min-w-0 flex-1`}
                  aria-label="Voice preview text"
                />
                <button
                  type="button"
                  className={secondaryButton}
                  onClick={working === "playing" ? stopSpeechPlayback : () => void previewVoice()}
                  disabled={Boolean(working && working !== "playing")}
                >
                  {working === "preview" ? "Preparing…" : working === "playing" ? "Stop" : "Try it"}
                </button>
              </div>
            ) : null}

            <details
              className="rounded-xl border border-[var(--line)] bg-[var(--paper-surface)] p-3"
              open={addingVoice}
              onToggle={(event) => {
                const open = (event.target as HTMLDetailsElement).open;
                setAddingVoice(open);
                if (!open) setRepairProfile(null);
              }}
            >
              <summary className="cursor-pointer text-xs font-medium text-[var(--ink-heading)]">
                {repairProfile
                  ? `Finish ${repairProfile.name}`
                  : profiles.length
                    ? "Add another voice"
                    : "Add a voice"}
              </summary>
              <div className="mt-3 space-y-3">
                {!repairProfile ? (
                  <div className="neu-segmented inline-flex rounded-xl p-1">
                    <button type="button" onClick={() => setSource("preset")} className={`rounded-lg px-3 py-1.5 text-xs ${source === "preset" ? "neu-selected text-[var(--ink-heading)]" : "text-[var(--ink-muted)]"}`}>Built-in voice</button>
                    <button type="button" onClick={() => setSource("clone")} className={`rounded-lg px-3 py-1.5 text-xs ${source === "clone" ? "neu-selected text-[var(--ink-heading)]" : "text-[var(--ink-muted)]"}`}>Clone your own</button>
                  </div>
                ) : null}

                {source === "preset" ? (
                  <>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <label className="text-xs text-[var(--ink-muted)]">
                        Voice family
                        <select
                          className={`${fieldClass} mt-1`}
                          value={presetEngine}
                          onChange={(event) => setPresetEngine(event.target.value as typeof presetEngine)}
                        >
                          {VOICE_FAMILIES.map((family) => (
                            <option key={family.id} value={family.id}>{`${family.name} · ${family.hint}`}</option>
                          ))}
                        </select>
                      </label>
                      <label className="text-xs text-[var(--ink-muted)]">
                        Language
                        <select className={`${fieldClass} mt-1`} value={presetLanguage} onChange={(event) => setPresetLanguage(event.target.value)}>
                          <option value="all">All languages</option>
                          {presetLanguagesAvailable.map((code) => (
                            <option key={code} value={code}>{LANGUAGE_LABELS.get(code) || code}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <ul className="max-h-64 space-y-1 overflow-y-auto pr-1">
                      {presetVoices.length ? (
                        presetVoices.map((voice) => (
                          <li key={voice.voice_id} className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 hover:bg-[var(--paper-strong)]">
                            <span className="min-w-0">
                              <span className="block truncate text-xs text-[var(--ink)]">{voice.name}</span>
                              <span className="block text-[11px] text-[var(--ink-muted)]">
                                {[voice.gender, LANGUAGE_LABELS.get(voice.language || "") || voice.language].filter(Boolean).join(" · ")}
                              </span>
                            </span>
                            <button
                              type="button"
                              className={secondaryButton}
                              onClick={() => void addBuiltInVoice(voice)}
                              disabled={Boolean(working)}
                            >
                              {working === `preset:${voice.voice_id}` ? "Adding…" : "Use"}
                            </button>
                          </li>
                        ))
                      ) : (
                        <li className="px-2 py-3 text-xs text-[var(--ink-muted)]">No built-in voices for that language.</li>
                      )}
                    </ul>
                  </>
                ) : (
                  <div className="space-y-3">
                    <p className="text-xs leading-5 text-[var(--ink-muted)]">
                      {repairProfile
                        ? `${repairProfile.name}'s original recording was not saved. Add a clean 5–15 second recording to finish it; the audio stays on this machine.`
                        : "Clone a voice from a clean 5–15 second recording of someone who has agreed to it. The audio never leaves this machine."}
                    </p>
                    {repairProfile ? null : (
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <label className="text-xs text-[var(--ink-muted)]">Voice name<input className={`${fieldClass} mt-1`} value={profileName} onChange={(event) => setProfileName(event.target.value)} placeholder="Warm narrator" /></label>
                        <label className="text-xs text-[var(--ink-muted)]">Language spoken<select className={`${fieldClass} mt-1`} value={profileLanguage} onChange={(event) => setProfileLanguage(event.target.value)}>{LANGUAGES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                      </div>
                    )}

                    <div className="neu-segmented inline-flex rounded-xl p-1">
                      <button type="button" onClick={() => selectSampleMode("record")} className={`rounded-lg px-3 py-1.5 text-xs ${sampleMode === "record" ? "neu-selected text-[var(--ink-heading)]" : "text-[var(--ink-muted)]"}`}>Record now</button>
                      <button type="button" onClick={() => selectSampleMode("upload")} className={`rounded-lg px-3 py-1.5 text-xs ${sampleMode === "upload" ? "neu-selected text-[var(--ink-heading)]" : "text-[var(--ink-muted)]"}`}>Upload a file</button>
                    </div>

                    {sampleMode === "record" ? (
                      <VoiceSampleRecorder
                        key={recorderKey}
                        passage={passage}
                        disabled={Boolean(working)}
                        onRecorded={(file) => {
                          setSample(file);
                          // The visible passage is the recording transcript, so
                          // save it automatically instead of asking the user to
                          // review the same text in a second field.
                          setSampleTranscript(file ? passage.text : "");
                        }}
                      />
                    ) : (
                      <label className="block text-xs text-[var(--ink-muted)]">Voice sample<input ref={sampleFileRef} type="file" accept="audio/wav,audio/mpeg,audio/mp4,audio/ogg,audio/flac,audio/webm" className="mt-1 block w-full text-xs text-[var(--ink)] file:mr-3 file:rounded-lg file:border-0 file:bg-[var(--paper-strong)] file:px-3 file:py-2 file:text-xs file:text-[var(--ink)]" onChange={(event) => setSample(event.target.files?.[0] || null)} /></label>
                    )}

                    {sampleMode === "upload" ? (
                      <label className="block text-xs text-[var(--ink-muted)]">
                        Transcript
                        <textarea className={`${fieldClass} mt-1 min-h-20 resize-y`} value={sampleTranscript} onChange={(event) => setSampleTranscript(event.target.value)} placeholder="What is said in the uploaded audio?" />
                        <span className="mt-1 block text-[11px] leading-5">
                          Voicebox uses this to align an uploaded recording with the voice.
                        </span>
                      </label>
                    ) : null}
                    <div className="flex justify-end">
                      <button type="button" className={primaryButton} onClick={() => void createClonedVoice()} disabled={Boolean(working)}>
                        {working === "create" ? "Saving recording…" : repairProfile ? "Finish clone" : "Create voice"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </details>

            <div className="flex items-center justify-between gap-3 rounded-xl bg-[var(--paper-surface)] p-3">
              <div className="min-w-0">
                <p className="text-sm text-[var(--ink)]">Read responses aloud</p>
                <p className="mt-0.5 text-xs leading-5 text-[var(--ink-muted)]">
                  Turns on the speaker button under every AI response. Off means Breadboard never
                  speaks.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-label="Read responses aloud"
                aria-checked={draft.enabled}
                onClick={() => void updateSettings({ enabled: !draft.enabled })}
                className={`neu-inset relative h-6 w-11 shrink-0 rounded-full transition ${draft.enabled ? "bg-[var(--botanical)]" : "bg-[var(--line-strong)]"}`}
              >
                <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-[var(--paper-raised)] shadow transition-transform ${draft.enabled ? "translate-x-5" : ""}`} />
              </button>
            </div>
          </section>

          <section className="space-y-3 rounded-2xl border border-[var(--line)] p-4">
            <div>
              <h3 className="text-sm font-medium text-[var(--ink-heading)]">Dictation</h3>
              <p className="mt-0.5 text-xs leading-5 text-[var(--ink-muted)]">Words appear in the composer while you speak. When you stop, Voicebox replaces the live draft with a final local Whisper transcription.</p>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="text-xs text-[var(--ink-muted)]">Spoken language<select className={`${fieldClass} mt-1`} value={draft.transcriptionLanguage || ""} onChange={(event) => void updateSettings({ transcriptionLanguage: event.target.value || null })}><option value="">Detect automatically</option>{LANGUAGES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label className="text-xs text-[var(--ink-muted)]">Accuracy<select className={`${fieldClass} mt-1`} value={draft.transcriptionModel} onChange={(event) => void updateSettings({ transcriptionModel: event.target.value })}><option value="base">Base · fastest</option><option value="small">Small · balanced</option><option value="medium">Medium · more accurate</option><option value="large">Large · most accurate</option><option value="turbo">Turbo · fast and accurate</option></select></label>
            </div>
            {whisperModel ? (
              <div className="rounded-xl border border-[var(--line)] bg-[var(--paper-surface)] p-3">{modelRow(whisperModel, false)}</div>
            ) : null}
          </section>

          <details className="rounded-2xl border border-[var(--line)] p-4">
            <summary className="cursor-pointer text-sm font-medium text-[var(--ink-heading)]">Advanced</summary>
            <div className="mt-3 space-y-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="text-xs text-[var(--ink-muted)]">
                  Engine
                  <select className={`${fieldClass} mt-1`} value={draft.engine} onChange={(event) => void updateSettings({ engine: event.target.value })}>
                    {ENGINE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                  <span className="mt-1 block text-[11px]">Automatic follows the voice you picked.</span>
                </label>
                <label className="text-xs text-[var(--ink-muted)]">
                  Qwen model size
                  <select className={`${fieldClass} mt-1`} value={draft.modelSize} onChange={(event) => void updateSettings({ modelSize: event.target.value })}>
                    {QWEN_SIZES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                  <span className="mt-1 block text-[11px]">Each size is a separate download.</span>
                </label>
              </div>
              <label className="block text-xs text-[var(--ink-muted)]">
                Written language
                <select className={`${fieldClass} mt-1`} value={draft.language} onChange={(event) => void updateSettings({ language: event.target.value })}>
                  {LANGUAGES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              {status.models.length ? (
                <div className="space-y-2">
                  <div>
                    <h4 className="text-xs font-medium text-[var(--ink-heading)]">Local speech models</h4>
                    <p className="mt-0.5 text-[11px] leading-5 text-[var(--ink-muted)]">Voicebox downloads a model only when you choose it. Downloads can be several gigabytes.</p>
                  </div>
                  <div className="divide-y divide-[var(--line)]">
                    {status.models.map((model) => (
                      <div key={model.model_name} className="py-2.5">{modelRow(model, false)}</div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </details>
        </>
      ) : null}

      {notice ? <p role="status" className="rounded-xl bg-[var(--paper-strong)] px-3 py-2 text-xs leading-5 text-[var(--ink)]">{notice}</p> : null}
    </div>
  );
}
