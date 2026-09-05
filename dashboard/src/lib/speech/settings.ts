import db from "@/lib/db";
import { SPEECH_PROVIDERS, OPENAI_SPEECH_VOICES, type SpeechProvider, type OpenAISpeechVoice } from "./providers.ts";

export const SPEECH_LANGUAGES = [
  "en",
  "zh",
  "ja",
  "ko",
  "de",
  "fr",
  "ru",
  "pt",
  "es",
  "it",
  "he",
  "ar",
  "da",
  "el",
  "fi",
  "hi",
  "ms",
  "nl",
  "no",
  "pl",
  "sv",
  "sw",
  "tr",
] as const;

export const SPEECH_ENGINES = [
  "auto",
  "qwen",
  "qwen_custom_voice",
  "luxtts",
  "chatterbox",
  "chatterbox_turbo",
  "tada",
  "kokoro",
] as const;

export const SPEECH_MODEL_SIZES = ["0.6B", "1.7B", "1B", "3B"] as const;
export const TRANSCRIPTION_MODELS = ["base", "small", "medium", "large", "turbo"] as const;

export type SpeechLanguage = (typeof SPEECH_LANGUAGES)[number];
export type SpeechEngine = (typeof SPEECH_ENGINES)[number];
export type SpeechModelSize = (typeof SPEECH_MODEL_SIZES)[number];
export type TranscriptionModel = (typeof TRANSCRIPTION_MODELS)[number];

export interface SpeechSettings {
  speechProvider: SpeechProvider;
  openaiVoice: OpenAISpeechVoice;
  enabled: boolean;
  profileId: string | null;
  language: SpeechLanguage;
  engine: SpeechEngine;
  modelSize: SpeechModelSize;
  transcriptionLanguage: SpeechLanguage | null;
  transcriptionModel: TranscriptionModel;
}

const DEFAULT_SETTINGS: SpeechSettings = {
  speechProvider: "local",
  openaiVoice: "cove",
  enabled: true,
  profileId: null,
  language: "en",
  engine: "auto",
  modelSize: "1.7B",
  transcriptionLanguage: null,
  transcriptionModel: "base",
};

db.exec(`
  CREATE TABLE IF NOT EXISTS speech_user_settings (
    user_id                INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    enabled                INTEGER NOT NULL DEFAULT 1,
    profile_id             TEXT,
    language               TEXT NOT NULL DEFAULT 'en',
    engine                 TEXT NOT NULL DEFAULT 'auto',
    model_size             TEXT NOT NULL DEFAULT '1.7B',
    transcription_language TEXT,
    transcription_model    TEXT NOT NULL DEFAULT 'base',
    updated_at             TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Preserve existing local profiles and preferences when upgrading an old database.
db.transaction(() => {
  const columns = db.prepare("PRAGMA table_info(speech_user_settings)").all() as { name: string }[];
  if (!columns.some((column) => column.name === "speech_provider")) {
    db.exec("ALTER TABLE speech_user_settings ADD COLUMN speech_provider TEXT NOT NULL DEFAULT 'local'");
  }
  if (!columns.some((column) => column.name === "openai_voice")) {
    db.exec("ALTER TABLE speech_user_settings ADD COLUMN openai_voice TEXT NOT NULL DEFAULT 'marin'");
  }
}).immediate();

type SpeechSettingsRow = {
  speech_provider: string;
  openai_voice: string;
  enabled: number;
  profile_id: string | null;
  language: string;
  engine: string;
  model_size: string;
  transcription_language: string | null;
  transcription_model: string;
};

function includes<T extends readonly string[]>(values: T, value: string): value is T[number] {
  return values.includes(value as T[number]);
}

function rowToSettings(row: SpeechSettingsRow | undefined): SpeechSettings {
  if (!row) return { ...DEFAULT_SETTINGS };
  return {
    // Upgrade the earlier API-key selection without activating any billed API.
    speechProvider: row.speech_provider === "openai" ? "chatgpt" : includes(SPEECH_PROVIDERS, row.speech_provider) ? row.speech_provider : "local",
    openaiVoice: includes(OPENAI_SPEECH_VOICES, row.openai_voice) ? row.openai_voice : "cove",
    enabled: row.enabled === 1,
    profileId: row.profile_id,
    language: includes(SPEECH_LANGUAGES, row.language) ? row.language : DEFAULT_SETTINGS.language,
    engine: includes(SPEECH_ENGINES, row.engine) ? row.engine : DEFAULT_SETTINGS.engine,
    modelSize: includes(SPEECH_MODEL_SIZES, row.model_size)
      ? row.model_size
      : DEFAULT_SETTINGS.modelSize,
    transcriptionLanguage:
      row.transcription_language && includes(SPEECH_LANGUAGES, row.transcription_language)
        ? row.transcription_language
        : null,
    transcriptionModel: includes(TRANSCRIPTION_MODELS, row.transcription_model)
      ? row.transcription_model
      : DEFAULT_SETTINGS.transcriptionModel,
  };
}

export function getSpeechSettings(userId: number): SpeechSettings {
  const row = db
    .prepare(
      `SELECT enabled, profile_id, language, engine, model_size,
              transcription_language, transcription_model, speech_provider, openai_voice
       FROM speech_user_settings
       WHERE user_id = ?`,
    )
    .get(userId) as SpeechSettingsRow | undefined;
  return rowToSettings(row);
}

export function updateSpeechSettings(
  userId: number,
  input: Partial<SpeechSettings>,
): SpeechSettings {
  const current = getSpeechSettings(userId);
  const next: SpeechSettings = {
    speechProvider: typeof input.speechProvider === "string" && includes(SPEECH_PROVIDERS, input.speechProvider)
      ? input.speechProvider : current.speechProvider,
    openaiVoice: typeof input.openaiVoice === "string" && includes(OPENAI_SPEECH_VOICES, input.openaiVoice)
      ? input.openaiVoice : current.openaiVoice,
    enabled: typeof input.enabled === "boolean" ? input.enabled : current.enabled,
    profileId:
      input.profileId === null || typeof input.profileId === "string"
        ? input.profileId?.trim() || null
        : current.profileId,
    language:
      typeof input.language === "string" && includes(SPEECH_LANGUAGES, input.language)
        ? input.language
        : current.language,
    engine:
      typeof input.engine === "string" && includes(SPEECH_ENGINES, input.engine)
        ? input.engine
        : current.engine,
    modelSize:
      typeof input.modelSize === "string" && includes(SPEECH_MODEL_SIZES, input.modelSize)
        ? input.modelSize
        : current.modelSize,
    transcriptionLanguage:
      input.transcriptionLanguage === null ||
      (typeof input.transcriptionLanguage === "string" &&
        includes(SPEECH_LANGUAGES, input.transcriptionLanguage))
        ? input.transcriptionLanguage
        : current.transcriptionLanguage,
    transcriptionModel:
      typeof input.transcriptionModel === "string" &&
      includes(TRANSCRIPTION_MODELS, input.transcriptionModel)
        ? input.transcriptionModel
        : current.transcriptionModel,
  };

  db.prepare(
    `INSERT INTO speech_user_settings (
       user_id, enabled, profile_id, language, engine, model_size,
       transcription_language, transcription_model, speech_provider, openai_voice, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET
       enabled = excluded.enabled,
       profile_id = excluded.profile_id,
       language = excluded.language,
       engine = excluded.engine,
       model_size = excluded.model_size,
       transcription_language = excluded.transcription_language,
       transcription_model = excluded.transcription_model,
       speech_provider = excluded.speech_provider,
       openai_voice = excluded.openai_voice,
       updated_at = excluded.updated_at`,
  ).run(
    userId,
    next.enabled ? 1 : 0,
    next.profileId,
    next.language,
    next.engine,
    next.modelSize,
    next.transcriptionLanguage,
    next.transcriptionModel,
    next.speechProvider,
    next.openaiVoice,
  );
  return next;
}
