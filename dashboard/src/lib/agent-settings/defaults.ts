// The bridge between a settings page and a run.
//
// The catalog stores plain, UI-shaped values ("auto", 0 for "let the run
// decide"). A run wants its own request shape, where "unset" is null and a
// board is a component id. Translating in one place keeps that vocabulary out
// of both the form and the agents, and keeps the precedence rule honest: every
// function here answers "what should this field be when the message says
// nothing", never "what should this field be".

import type { AgentSettingValues, Dimensions } from "./catalog.ts";
import type { ResearchRequest } from "../deep-research/identity.ts";
import {
  DOCUMENT_SOURCE_IDS,
  type DocumentSearchRequest,
  type DocumentSourceId,
} from "../get-doc/identity.ts";
import {
  TUTOR_CAPABILITIES,
  type TutorOptionalTool,
  type TutorRequest,
} from "../deep-tutor/identity.ts";
import type { MeetingNotesDefaults } from "../meeting-notes/identity.ts";
import type { ParametricCadRequest } from "../cad/identity.ts";
import type { ShortsAspectRatio, ShortsResolution } from "../shorts/identity.ts";
import type {
  VimaxAspectRatio,
  VimaxImageGenerator,
  VimaxMode,
} from "../vimax/identity.ts";
import type { HardwareBlueprintRequest } from "../hardware/identity.ts";

function text(values: AgentSettingValues, key: string): string {
  const value = values[key];
  return typeof value === "string" ? value.trim() : "";
}

function flag(values: AgentSettingValues, key: string, fallback: boolean): boolean {
  const value = values[key];
  return typeof value === "boolean" ? value : fallback;
}

function count(values: AgentSettingValues, key: string, fallback: number): number {
  const value = values[key];
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : fallback;
}

/** A select whose "auto" option means the run decides for itself. */
function choice<T extends string>(values: AgentSettingValues, key: string, allowed: readonly T[]): T | null {
  const value = text(values, key);
  return (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

// ---- Deep Research ---------------------------------------------------------

export type DeepResearchDefaults = Pick<ResearchRequest, "breadth" | "depth" | "output">;

export function deepResearchDefaults(values: AgentSettingValues): DeepResearchDefaults {
  return {
    breadth: count(values, "breadth", 3),
    depth: count(values, "depth", 1),
    output: choice(values, "output", ["report", "answer"] as const) ?? "report",
  };
}

// ---- Get Doc ---------------------------------------------------------------

export type GetDocDefaults = Partial<Omit<DocumentSearchRequest, "query">>;

export function getDocDefaults(values: AgentSettingValues): GetDocDefaults {
  const since = count(values, "since", 0);
  const chosen = Array.isArray(values.sources)
    ? values.sources.filter((entry): entry is DocumentSourceId =>
        (DOCUMENT_SOURCE_IDS as readonly string[]).includes(entry as string),
      )
    : [];
  return {
    limit: count(values, "limit", 10),
    openAccessOnly: flag(values, "openAccess", true),
    // 0 is the form's way of saying "any year"; the request says it with null.
    yearFrom: since > 0 ? since : null,
    // An empty selection means every catalog, not none of them.
    sources: chosen.length ? chosen : null,
  };
}

// ---- Meeting Notes ---------------------------------------------------------

export function meetingNotesDefaults(values: AgentSettingValues): MeetingNotesDefaults {
  const language = text(values, "language").toLowerCase();
  return {
    // An empty box means "let the transcriber work it out", which the request
    // spells null rather than "".
    language: /^[a-z]{2,3}$/.test(language) ? language : null,
    speakers: flag(values, "speakers", true),
    transcriptOnly: flag(values, "transcriptOnly", false),
  };
}

// ---- Deep Tutor ------------------------------------------------------------

export type DeepTutorDefaults = Partial<Omit<TutorRequest, "message">>;

export function deepTutorDefaults(values: AgentSettingValues): DeepTutorDefaults {
  const tools: TutorOptionalTool[] = [];
  if (flag(values, "web", false)) tools.push("web_search");
  if (flag(values, "papers", false)) tools.push("paper_search");
  return {
    capability: choice(values, "capability", TUTOR_CAPABILITIES) ?? "chat",
    tools,
    useMaterial: flag(values, "material", true),
    questionCount: count(values, "questions", 5),
    // An empty box means English rather than "no language at all".
    language: text(values, "language") || "en",
  };
}

// ---- Parametric CAD --------------------------------------------------------

export type ParametricCadDefaults = Pick<
  ParametricCadRequest,
  "process" | "printerBed" | "units"
>;

export function parametricCadDefaults(values: AgentSettingValues): ParametricCadDefaults {
  const bed = values.printerBed;
  const printerBed =
    bed && typeof bed === "object" && !Array.isArray(bed) ? (bed as Dimensions) : null;
  return {
    process: choice(values, "process", ["fdm", "sla", "sls"] as const),
    printerBed,
    units: choice(values, "units", ["mm", "inch"] as const),
  };
}

// ---- OpenWork ---------------------------------------------------------------

export interface OpenworkDefaults {
  /** Ask a run to leave documents in the workspace outbox. */
  deliverFiles: boolean;
  /** Whether the workspace agent may run shell commands inside its directory. */
  allowCommands: boolean;
}

export function openworkDefaults(values: AgentSettingValues): OpenworkDefaults {
  return {
    deliverFiles: flag(values, "deliverFiles", true),
    allowCommands: flag(values, "allowCommands", true),
  };
}

// ---- OpenScience ------------------------------------------------------------

export type OpenscienceHarnessSetting = "research" | "plan";

export interface OpenscienceDefaults {
  /** `research` does the work; `plan` investigates without changing anything. */
  harness: OpenscienceHarnessSetting;
  /** Ask a run to leave its scripts, data and figures in the workspace. */
  deliverFiles: boolean;
}

export function openscienceDefaults(values: AgentSettingValues): OpenscienceDefaults {
  return {
    harness: choice(values, "harness", ["research", "plan"] as const) ?? "research",
    deliverFiles: flag(values, "deliverFiles", true),
  };
}

// ---- Inbox Zero -------------------------------------------------------------

export interface InboxZeroDefaults {
  /**
   * Whether a run may carry out actions that change the mailbox — archiving,
   * labelling, sending, deleting — or is restricted to reading and drafting.
   *
   * Off does not weaken Inbox Zero's own confirmation step; it is a second,
   * blunter switch for people who want the agent to answer questions about
   * their mail and never touch it.
   */
  allowActions: boolean;
  /**
   * Which mailbox a run works on when more than one is connected. Empty uses
   * whichever was connected first, which is what every other Inbox Zero surface
   * defaults to.
   */
  mailbox: string;
}

export function inboxZeroDefaults(values: AgentSettingValues): InboxZeroDefaults {
  return {
    allowActions: flag(values, "allowActions", true),
    mailbox: text(values, "mailbox"),
  };
}

// ---- ViMax -----------------------------------------------------------------

export interface VimaxDefaults {
  mode: VimaxMode;
  aspectRatio: VimaxAspectRatio;
  style: string | null;
  sceneCount: number | null;
  shotBudget: number | null;
  images: boolean;
  imageGenerator: VimaxImageGenerator;
}

export function vimaxDefaults(values: AgentSettingValues): VimaxDefaults {
  // 0 is the form's way of saying "let the writer decide"; the request says it
  // with null.
  const scenes = count(values, "scenes", 0);
  const shots = count(values, "shots", 0);
  return {
    mode: choice(values, "mode", ["idea2video", "script2video"] as const) ?? "idea2video",
    aspectRatio: choice(values, "aspectRatio", ["16:9", "9:16", "1:1"] as const) ?? "16:9",
    style: text(values, "style") || null,
    sceneCount: scenes > 0 ? scenes : null,
    shotBudget: shots > 0 ? shots : null,
    images: flag(values, "images", true),
    imageGenerator:
      choice(values, "generator", ["auto", "gemini", "chatgpt"] as const) ?? "auto",
  };
}

// ---- Socials Manager --------------------------------------------------------

export interface SocialsManagerDefaults {
  providerIds: string[];
  withImages: boolean;
}

export function socialsManagerDefaults(values: AgentSettingValues): SocialsManagerDefaults {
  const networks = values.networks;
  return {
    providerIds: Array.isArray(networks)
      ? networks.filter((entry): entry is string => typeof entry === "string")
      : [],
    withImages: flag(values, "images", false),
  };
}

// ---- Hardware Blueprint ----------------------------------------------------

/**
 * Hardware is the one agent whose settings are not merged into the parsed
 * request. Its flags override what the model read out of the brief, so filling
 * them from a preference would let a stored default beat a brief that says
 * "using an ESP32". These travel to the interpretation step as preferences
 * instead, where the brief still wins.
 */
export interface HardwarePreferences {
  board: string | null;
  prototypeType: HardwareBlueprintRequest["prototypeType"];
  firmwarePlatform: HardwareBlueprintRequest["firmwarePlatform"];
  enclosure: "auto" | "always" | "never";
}

export function hardwarePreferences(values: AgentSettingValues): HardwarePreferences {
  return {
    board: choice(values, "board", ["arduino-uno", "esp32-devkit-v1", "raspberry-pi-pico"] as const),
    prototypeType: choice(values, "prototype", ["breadboard", "perfboard", "pcb"] as const),
    firmwarePlatform: choice(values, "firmware", ["arduino", "platformio"] as const),
    enclosure: choice(values, "enclosure", ["auto", "always", "never"] as const) ?? "auto",
  };
}

const BOARD_NAMES: Record<string, string> = {
  "arduino-uno": "Arduino Uno",
  "esp32-devkit-v1": "ESP32 DevKit v1",
  "raspberry-pi-pico": "Raspberry Pi Pico",
};

/**
 * The preferences as a sentence for the interpretation model, or null when
 * there is nothing to say. Deliberately worded as a tie-breaker: the brief is
 * the instruction, this is only what to reach for when the brief is silent.
 */
export function hardwarePreferenceNote(preferences: HardwarePreferences): string | null {
  const lines: string[] = [];
  if (preferences.board) {
    lines.push(`- Preferred board: ${BOARD_NAMES[preferences.board] ?? preferences.board}`);
  }
  if (preferences.prototypeType) lines.push(`- Preferred build style: ${preferences.prototypeType}`);
  if (preferences.firmwarePlatform) {
    lines.push(`- Preferred firmware project: ${preferences.firmwarePlatform}`);
  }
  if (!lines.length) return null;
  return [
    "This person's standing preferences, to use only where the brief does not say otherwise.",
    "If the brief names a board, a build style or a toolchain, the brief wins.",
    ...lines,
  ].join("\n");
}

// ---- Shorts ----------------------------------------------------------------

export interface ShortsDefaults {
  clipCount: number;
  aspectRatio: ShortsAspectRatio;
  resolution: ShortsResolution;
  /** Whisper size. Not a form field — the run reads it and nothing else does. */
  whisperModel: string;
  /** ISO-639-1 code, or "" to let Whisper detect the language. */
  language: string;
}

const SHORTS_WHISPER_MODELS = ["tiny", "base", "small", "medium"] as const;

export function shortsDefaults(values: AgentSettingValues): ShortsDefaults {
  const language = text(values, "language").toLowerCase();
  return {
    clipCount: count(values, "clips", 3),
    aspectRatio: choice(values, "aspectRatio", ["9:16", "1:1", "16:9"] as const) ?? "9:16",
    resolution: choice(values, "resolution", ["360", "480", "720", "1080"] as const) ?? "720",
    whisperModel: choice(values, "whisperModel", SHORTS_WHISPER_MODELS) ?? "base",
    // A half-typed code would make Whisper fail rather than guess, so only a
    // complete one counts as a preference.
    language: /^[a-z]{2}$/.test(language) ? language : "",
  };
}

// ---- Ruflo -----------------------------------------------------------------

export interface RufloDefaults {
  workers: number;
  queenType: string;
  consensus: string;
  topology: string;
}

export function rufloDefaults(values: AgentSettingValues): RufloDefaults {
  return {
    workers: count(values, "workers", 6),
    queenType: text(values, "queenType") || "strategic",
    consensus: text(values, "consensus") || "byzantine",
    topology: text(values, "topology") || "hierarchical-mesh",
  };
}

// ---- Agent Reach / Career Ops ----------------------------------------------

/** Both step-limited agents store the same single number. */
export function maxStepsSetting(values: AgentSettingValues, fallback: number): number {
  return count(values, "maxSteps", fallback);
}

// ---- Video Use -------------------------------------------------------------

export interface VideoUseDefaults {
  quality: "final" | "preview";
  reasoningEffort: "low" | "medium" | "high";
}

export function videoUseDefaults(values: AgentSettingValues): VideoUseDefaults {
  return {
    quality: choice(values, "quality", ["final", "preview"] as const) ?? "final",
    reasoningEffort:
      choice(values, "reasoningEffort", ["low", "medium", "high"] as const) ?? "medium",
  };
}
