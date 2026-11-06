// What each agent lets you decide up front, described once.
//
// Every runtime agent already accepts its options as inline flags typed into
// chat (`--breadth 4`, `--pcb`, `--vertical`). That is fine for a one-off run
// and useless as a preference: the same flags have to be retyped on every
// message. This catalog is the other half — the same options, held per user, so
// a run starts the way you always want it to start.
//
// The rule the whole feature rests on: a flag typed in the message always wins
// over what is stored here. Settings only fill in what the message left unsaid,
// which is why each field records the flag that overrides it.
//
// This module is imported by client components and by API routes, so it stays
// free of server-only imports.

import { MONEY_PRINTER_VOICES } from "../money-printer/identity.ts";
import { SOCIALS_MANAGER_PROVIDERS } from "../socials-manager/providers.ts";
import {
  OPENEXECUTIVE_AGENT_ID,
  OPENEXECUTIVE_AGENT_NAME,
  OPENEXECUTIVE_COMMAND,
} from "../openexecutive/identity.ts";

export interface SelectOption {
  value: string;
  label: string;
  help?: string;
}

interface FieldBase {
  key: string;
  label: string;
  /** One sentence on what the option changes about a run. */
  help: string;
  /** The inline flag that overrides this field for a single message. */
  flag?: string;
  /**
   * A named backend probe whose current state is shown under the control.
   *
   * Only for options whose usefulness depends on something outside Breadboard —
   * an application installed on this machine, say. The settings panel maps the
   * name to one read of an existing status endpoint when the panel opens; there
   * is no polling.
   */
  statusProbe?: "solidworks";
}

export type AgentSettingField =
  | (FieldBase & { kind: "select"; options: SelectOption[]; default: string })
  | (FieldBase & { kind: "toggle"; default: boolean })
  | (FieldBase & {
      kind: "number";
      min: number;
      max: number;
      default: number;
      /** Value that means "leave it to the run", shown instead of the number. */
      unsetValue?: number;
      unsetLabel?: string;
    })
  | (FieldBase & { kind: "text"; placeholder?: string; maxLength: number; default: string })
  | (FieldBase & { kind: "multiselect"; options: SelectOption[]; default: string[] })
  | (FieldBase & {
      kind: "dimensions";
      unit: string;
      min: number;
      max: number;
      axes: [string, string, string];
      default: null;
    });

export type AgentSettingValue = string | number | boolean | string[] | Dimensions | null;

export interface Dimensions {
  x: number;
  y: number;
  z: number;
}

export type AgentSettingValues = Record<string, AgentSettingValue>;

export interface ConfigurableAgent {
  id: string;
  name: string;
  /** The slash command that reaches the agent in chat. */
  command: string;
  /** What the agent does, in one line, for the settings index. */
  summary: string;
  /** When the stored settings take effect. Shown at the top of the page. */
  appliesWhen: string;
  fields: AgentSettingField[];
}

// Taken from Postiz's own provider table rather than retyped, so a network can
// never be offered here under an identifier the drafting run would reject.
const SOCIALS_MANAGER_NETWORK_OPTIONS: SelectOption[] = SOCIALS_MANAGER_PROVIDERS.map((provider) => ({
  value: provider.id,
  label: provider.name,
}));

// Likewise taken from MoneyPrinter's own vocabulary, so a narrator can never be
// offered here under a name the cloned speech engine would not recognise.
const MONEY_PRINTER_VOICE_OPTIONS: SelectOption[] = MONEY_PRINTER_VOICES.map((voice) => ({
  value: voice.value,
  label: voice.label,
}));

/**
 * The agents with something worth deciding in advance, and the decisions they
 * expose. An agent whose every run is shaped entirely by the prompt — ARIS,
 * HyperFrames, Codex, OpenCode, OpenPlanter — is deliberately absent: a page of
 * controls that change nothing is worse than no page.
 *
 * Agent TARS and Agent Browser are absent for the opposite reason. They already
 * own a full configuration surface on the Agents page, down to per-domain
 * permissions, and a second one would compete with it.
 */
export const CONFIGURABLE_AGENTS: ConfigurableAgent[] = [
  {
    id: "music-producer", name: "Music Producer", command: "/agents:music-producer",
    summary: "Create musical audio or revise a track into playable versions.",
    appliesWhen: "Applies to one draft per music request. Explicit requests and flags override these defaults.",
    fields: [
      { key: "duration", kind: "number", label: "Draft duration (seconds)", help: "Duration conditioning; the card reports measured duration.", flag: "--duration 60", min: 10, max: 600, default: 60 },
      { key: "vocalMode", kind: "select", label: "Default vocal mode", help: "Vocal songs require original or supplied lyrics in the requested language.", flag: "--instrumental", default: "instrumental", options: [{ value: "instrumental", label: "Instrumental" }, { value: "vocal", label: "Vocal song" }] },
    ],
  },
  {
    id: "deep-research",
    name: "Deep Research",
    command: "/agents:deep-research",
    summary: "Multi-round web research that returns a sourced report.",
    appliesWhen:
      "More search directions and follow-up rounds take longer and use more AI requests.",
    fields: [
      {
        key: "breadth",
        kind: "number",
        label: "Breadth",
        help: "How many search directions each round follows.",
        flag: "--breadth 4",
        min: 1,
        max: 10,
        default: 4,
      },
      {
        key: "depth",
        kind: "number",
        label: "Depth",
        help: "How many rounds of follow-up questions a run goes through.",
        flag: "--depth 2",
        min: 1,
        max: 5,
        default: 2,
      },
      {
        key: "output",
        kind: "select",
        label: "Output",
        help: "A full written report, or a direct answer to the question.",
        flag: "--answer",
        options: [
          { value: "report", label: "Report", help: "Sections, sources, and the reasoning." },
          { value: "answer", label: "Answer", help: "The conclusion with its sources." },
        ],
        default: "report",
      },
    ],
  },
  {
    id: "get-doc",
    name: "Get Doc",
    command: "/agents:get-doc",
    summary: "Finds academic papers and saves the free full texts to your artifacts.",
    appliesWhen:
      "Only free full-text papers can be downloaded.",
    fields: [
      {
        key: "limit",
        kind: "number",
        label: "Results",
        help: "How many documents a search lists.",
        flag: "--limit 20",
        min: 1,
        max: 40,
        default: 10,
      },
      {
        key: "openAccess",
        kind: "toggle",
        label: "Downloadable only",
        help: "Hide papers with no free full text, so every result has a working download.",
        flag: "--all",
        default: true,
      },
      {
        key: "since",
        kind: "number",
        label: "Published since",
        help: "Ignore anything older than this year.",
        flag: "--since 2020",
        min: 0,
        max: 2100,
        default: 0,
        unsetValue: 0,
        unsetLabel: "Any year",
      },
      {
        key: "sources",
        kind: "multiselect",
        label: "Catalogs",
        help: "Which open catalogs to search. None selected searches all of them.",
        flag: "--source openalex,arxiv",
        options: [
          { value: "openalex", label: "OpenAlex", help: "Everything, with open-access links." },
          { value: "arxiv", label: "arXiv", help: "Physics, maths, computing preprints." },
          { value: "europepmc", label: "Europe PMC", help: "Medicine and life sciences." },
          { value: "semanticscholar", label: "Semantic Scholar", help: "Broad, with open PDFs." },
          { value: "crossref", label: "Crossref", help: "The DOI registry — metadata only." },
          { value: "core", label: "CORE", help: "Repository full texts. Needs CORE_API_KEY." },
        ],
        default: [],
      },
    ],
  },
  {
    id: "meeting-notes",
    name: "Meeting Notes",
    command: "/agents:meeting-notes",
    summary: "Transcribes a meeting recording and writes structured notes from it.",
    appliesWhen:
      "Applies to uploaded recordings, new recordings, and pasted transcripts. Longer recordings take more time.",
    fields: [
      {
        key: "speakers",
        kind: "toggle",
        label: "Separate speakers",
        help:
          "Identify speakers in the transcript and notes. Requires Scriberr; the basic local transcription option does not identify speakers.",
        flag: "--no-speakers",
        default: true,
      },
      {
        key: "language",
        kind: "text",
        label: "Spoken language",
        help:
          "Enter a language code such as en, nl, or de, or leave blank to detect it.",
        flag: "--lang nl",
        placeholder: "auto-detect",
        maxLength: 5,
        default: "",
      },
      {
        key: "transcriptOnly",
        kind: "toggle",
        label: "Transcript only",
        help:
          "Create only a transcript. Skips notes and uses fewer AI requests.",
        flag: "--transcript-only",
        default: false,
      },
    ],
  },
  {
    id: "deep-tutor",
    name: "Deep Tutor",
    command: "/agents:deep-tutor",
    summary: "Teaches from your own material — explaining, solving, quizzing, and remembering what you have covered.",
    appliesWhen:
      "In a Garden, the tutor reads that Garden. In the Terminal, it reads your workspace.",
    fields: [
      {
        key: "capability",
        kind: "select",
        label: "Default mode",
        help: "What a message does when it does not name a mode itself.",
        flag: "--solve",
        options: [
          { value: "chat", label: "Tutoring", help: "Explains, and answers follow-ups." },
          { value: "deep_solve", label: "Deep solve", help: "Works a problem through, step by step." },
          { value: "deep_question", label: "Quiz", help: "Writes questions to test yourself on." },
          { value: "deep_research", label: "Deep research", help: "Investigates a topic and reports." },
          { value: "visualize", label: "Visualize", help: "Draws the thing being explained." },
          { value: "mastery_path", label: "Mastery path", help: "Plans what to learn next, and checks." },
        ],
        default: "chat",
      },
      {
        key: "material",
        kind: "toggle",
        label: "Read your material first",
        help: "Load the notes that look relevant before answering, instead of waiting to be asked.",
        flag: "--no-material",
        default: true,
      },
      {
        key: "questions",
        kind: "number",
        label: "Quiz length",
        help: "How many questions a quiz turn writes.",
        flag: "--count 8",
        min: 1,
        max: 20,
        default: 5,
      },
      {
        key: "web",
        kind: "toggle",
        label: "Allow web search",
        help: "Let the tutor look things up online when your material does not cover them.",
        flag: "--web",
        default: false,
      },
      {
        key: "papers",
        kind: "toggle",
        label: "Allow paper search",
        help: "Let the tutor pull in academic papers on the topic.",
        flag: "--papers",
        default: false,
      },
      {
        key: "language",
        kind: "text",
        label: "Answer language",
        help: "A two-letter code. Leave empty for English.",
        flag: "--lang nl",
        placeholder: "en",
        maxLength: 5,
        default: "",
      },
    ],
  },
  {
    id: "hardware-blueprint",
    name: "Hardware Blueprint",
    command: "/agents:hardware-blueprint",
    summary: "Turns an electronics idea into a checked, buildable circuit.",
    appliesWhen:
      "Used unless your request specifies a board or build style.",
    fields: [
      {
        key: "board",
        kind: "select",
        label: "Preferred board",
        help: "The controller a design starts from when the brief does not name one.",
        flag: "--board esp32",
        options: [
          { value: "auto", label: "Let the design decide", help: "Chosen from what the circuit needs." },
          { value: "arduino-uno", label: "Arduino Uno" },
          { value: "esp32-devkit-v1", label: "ESP32 DevKit v1" },
          { value: "raspberry-pi-pico", label: "Raspberry Pi Pico" },
        ],
        default: "auto",
      },
      {
        key: "prototype",
        kind: "select",
        label: "Build style",
        help: "What the wiring is drawn for.",
        flag: "--pcb",
        options: [
          { value: "auto", label: "Let the design decide" },
          { value: "breadboard", label: "Breadboard" },
          { value: "perfboard", label: "Perfboard" },
          { value: "pcb", label: "PCB" },
        ],
        default: "auto",
      },
      {
        key: "firmware",
        kind: "select",
        label: "Firmware project",
        help: "The toolchain the generated firmware targets.",
        flag: "--arduino",
        options: [
          { value: "auto", label: "Let the design decide" },
          { value: "arduino", label: "Arduino IDE sketch" },
          { value: "platformio", label: "PlatformIO project" },
        ],
        default: "auto",
      },
      {
        key: "enclosure",
        kind: "select",
        label: "Printable enclosure",
        help: "Whether a run also designs a case for the circuit through Parametric CAD.",
        flag: "--enclosure",
        options: [
          { value: "auto", label: "Only when the brief asks" },
          { value: "always", label: "Always design one" },
          { value: "never", label: "Never, unless I type --enclosure" },
        ],
        default: "auto",
      },
      {
        key: "cadBackend",
        kind: "select",
        label: "CAD backend",
        help: "Which CAD engine is used when a run needs mechanical CAD.",
        flag: "--cad solidworks",
        statusProbe: "solidworks",
        options: [
          {
            value: "auto",
            label: "Let the design decide",
            help: "Parametric CAD, unless a design says otherwise.",
          },
          { value: "cadquery", label: "Parametric CAD (CadQuery)" },
          {
            value: "solidworks",
            label: "SolidWorks",
            help: "Windows only, and SolidWorks must be installed.",
          },
        ],
        default: "auto",
      },
    ],
  },
  {
    id: "parametric-cad",
    name: "Parametric CAD",
    command: "/agents:parametric-cad",
    summary: "Designs printable parts as parametric models you can revise.",
    appliesWhen:
      "Applies to every part designed from chat, and to the enclosures Hardware Blueprint asks this agent for.",
    fields: [
      {
        key: "process",
        kind: "select",
        label: "Manufacturing process",
        help: "The tolerances, wall thicknesses, and clearances the design starts from.",
        flag: "--sla",
        options: [
          { value: "auto", label: "FDM unless the brief says otherwise" },
          { value: "fdm", label: "FDM — fused filament" },
          { value: "sla", label: "SLA — resin" },
          { value: "sls", label: "SLS — powder" },
        ],
        default: "auto",
      },
      {
        key: "units",
        kind: "select",
        label: "Units",
        help: "The units your dimensions are written in. Geometry stays millimetre-native either way.",
        flag: "--inch",
        options: [
          { value: "mm", label: "Millimetres" },
          { value: "inch", label: "Inches" },
        ],
        default: "mm",
      },
      {
        key: "printerBed",
        kind: "dimensions",
        label: "Printer volume",
        help: "The build volume every part must fit inside. Leave empty if it should not be constrained.",
        flag: "--bed 220x220x250",
        unit: "mm",
        min: 10,
        max: 2000,
        axes: ["X", "Y", "Z"],
        default: null,
      },
    ],
  },
  {
    id: "vimax",
    name: "ViMax",
    command: "/agents:vimax",
    summary: "Writes, storyboards, and produces a short film from an idea.",
    appliesWhen:
      "Storyboard images add time and cost to each production.",
    fields: [
      {
        key: "mode",
        kind: "select",
        label: "What you usually send",
        help: "Whether a prompt is treated as an idea to write from, or as a finished screenplay.",
        flag: "--script / --idea",
        options: [
          { value: "idea2video", label: "An idea — write the story first" },
          { value: "script2video", label: "A screenplay — shoot what I wrote" },
        ],
        default: "idea2video",
      },
      {
        key: "generator",
        kind: "select",
        label: "Frame generator",
        help:
          "Choose the image model. Each uses a separate subscription quota.",
        flag: "--gemini / --chatgpt",
        options: [
          { value: "auto", label: "Auto — whichever can draw right now" },
          { value: "gemini", label: "Gemini image model" },
          { value: "chatgpt", label: "ChatGPT image tool" },
        ],
        default: "auto",
      },
      {
        key: "aspectRatio",
        kind: "select",
        label: "Frame",
        help: "The shape every frame is composed for.",
        flag: "--vertical",
        options: [
          { value: "16:9", label: "16:9 — landscape" },
          { value: "9:16", label: "9:16 — vertical" },
          { value: "1:1", label: "1:1 — square" },
        ],
        default: "16:9",
      },
      {
        key: "style",
        kind: "text",
        label: "House style",
        help: "The visual style every frame is drawn in, unless a brief asks for another.",
        flag: '--style "watercolour"',
        placeholder: "watercolour, 90s anime, photoreal…",
        maxLength: 120,
        default: "",
      },
      {
        key: "scenes",
        kind: "number",
        label: "Scenes",
        help: "How many scenes the screenwriter plans.",
        flag: "--scenes 3",
        min: 1,
        max: 12,
        default: 0,
        unsetValue: 0,
        unsetLabel: "Let the screenwriter decide",
      },
      {
        key: "shots",
        kind: "number",
        label: "Shots per scene",
        help: "The ceiling on how many shots the storyboard artist plans per scene.",
        flag: "--shots 6",
        min: 1,
        max: 12,
        default: 0,
        unsetValue: 0,
        unsetLabel: "Let the storyboard artist decide",
      },
      {
        key: "images",
        kind: "toggle",
        label: "Draw the storyboard",
        help: "Off plans the whole film in writing without drawing a frame, which is much faster.",
        flag: "--no-images",
        default: true,
      },
    ],
  },
  {
    id: "vox-director",
    name: "Vox Director",
    command: "/agents:vox-director",
    summary:
      "Turns a topic into a narrated paper-collage explainer and renders it locally as an MP4.",
    appliesWhen:
      "Creating poster images and animations takes most of the processing time.",
    fields: [
      {
        key: "duration",
        kind: "number",
        label: "Length in seconds",
        help: "How long a film runs when the brief does not say. Beats and pacing are planned from this.",
        flag: "--duration 45",
        min: 5,
        max: 90,
        default: 30,
      },
      {
        key: "aspectRatio",
        kind: "select",
        label: "Frame",
        help: "The shape every poster is composed for.",
        flag: "--vertical / --square",
        options: [
          { value: "16:9", label: "16:9 - landscape" },
          { value: "9:16", label: "9:16 - vertical" },
          { value: "1:1", label: "1:1 - square" },
        ],
        default: "16:9",
      },
      {
        key: "motion",
        kind: "select",
        label: "Motion",
        help:
          "Animate individual pieces, or choose Ken Burns for a slower camera movement that renders faster.",
        flag: "--motion kenburns",
        options: [
          { value: "local", label: "Element-level - the pieces assemble" },
          { value: "scrapbook", label: "Scrapbook - a tilted card on a desk" },
          { value: "kenburns", label: "Ken Burns - a slow push, fastest" },
          { value: "auto", label: "Auto - the best one that works" },
        ],
        default: "local",
      },
      {
        key: "style",
        kind: "text",
        label: "House look",
        help:
          "Enter a theme such as american-retro or describe a look. Leave blank to match the topic.",
        flag: '--style "punk-zine"',
        placeholder: "american-retro, punk-zine, newsprint-editorial...",
        maxLength: 120,
        default: "",
      },
      {
        key: "checkpoint",
        kind: "text",
        label: "ComfyUI checkpoint",
        help:
          "Choose a ComfyUI model file, or leave blank to use the first available one. Requires ComfyUI.",
        placeholder: "sd_xl_base_1.0.safetensors",
        maxLength: 160,
        default: "",
      },
      {
        key: "seed",
        kind: "number",
        label: "Seed",
        help: "Pin every poster to one seed so a film renders identically twice. 0 draws fresh noise each run.",
        flag: "--seed 1234",
        min: 0,
        max: 4294967295,
        default: 0,
        unsetValue: 0,
        unsetLabel: "A fresh seed each run",
      },
      {
        key: "images",
        kind: "toggle",
        label: "Draw the posters",
        help:
          "Turn off to use simple title cards. Faster, with no image model required.",
        flag: "--no-images",
        default: true,
      },
      {
        key: "music",
        kind: "toggle",
        label: "Score it",
        help:
          "Add music from your local folder. Without a local track, the video has narration only.",
        flag: "--no-music",
        default: true,
      },
    ],
  },
  {
    id: "shorts",
    name: "Shorts",
    command: "/agents:shorts",
    summary: "Cuts a long video into short vertical clips of its best moments.",
    appliesWhen:
      "Defaults for the video picker and transcription. Longer videos take more time.",
    fields: [
      {
        key: "clips",
        kind: "number",
        label: "Clips",
        help: "How many shorts a run cuts, highest-scoring first.",
        min: 1,
        max: 10,
        default: 3,
      },
      {
        key: "aspectRatio",
        kind: "select",
        label: "Shape",
        help: "The frame each clip is reframed to. Vertical tracks the speaker's face across the shot.",
        options: [
          { value: "9:16", label: "9:16 — vertical" },
          { value: "1:1", label: "1:1 — square" },
          { value: "16:9", label: "16:9 — keep the original" },
        ],
        default: "9:16",
      },
      {
        key: "resolution",
        kind: "select",
        label: "Download quality",
        help: "Choose the download quality. Higher quality takes longer to download and process.",
        options: [
          { value: "360", label: "360p" },
          { value: "480", label: "480p" },
          { value: "720", label: "720p" },
          { value: "1080", label: "1080p" },
        ],
        default: "720",
      },
      {
        key: "whisperModel",
        kind: "select",
        label: "Transcription model",
        help:
          "Larger transcription models may be more accurate but are slower on a CPU. Each downloads on first use.",
        options: [
          { value: "tiny", label: "Tiny — fastest" },
          { value: "base", label: "Base — recommended" },
          { value: "small", label: "Small" },
          { value: "medium", label: "Medium — slowest" },
        ],
        default: "base",
      },
      {
        key: "language",
        kind: "text",
        label: "Spoken language",
        help:
          "Enter a language code such as en, nl, or de, or leave blank to detect it.",
        placeholder: "auto-detect",
        maxLength: 2,
        default: "",
      },
    ],
  },
  {
    id: "money-printer",
    name: "MoneyPrinter",
    command: "/agents:money-printer",
    summary: "Turns a topic into a finished short video — script, footage, voiceover and subtitles.",
    appliesWhen:
      "Longer videos and more cuts take more time to produce.",
    fields: [
      {
        key: "aspect",
        kind: "select",
        label: "Frame",
        help: "The shape the video is cut for.",
        flag: "--landscape / --square",
        options: [
          { value: "9:16", label: "9:16 — vertical", help: "Shorts, Reels, TikTok." },
          { value: "16:9", label: "16:9 — landscape" },
          { value: "1:1", label: "1:1 — square" },
        ],
        default: "9:16",
      },
      {
        key: "source",
        kind: "select",
        label: "Footage library",
        help:
          "Online footage libraries need an API key added above. Local footage uses videos in the agent’s storage folder.",
        flag: "--pixabay",
        options: [
          { value: "pexels", label: "Pexels" },
          { value: "pixabay", label: "Pixabay" },
          { value: "coverr", label: "Coverr" },
          { value: "local", label: "Local files only" },
        ],
        default: "pexels",
      },
      {
        key: "voice",
        kind: "select",
        label: "Narrator",
        help:
          "Choose a narrator. These Edge voices are free and need no account.",
        flag: "--voice en-GB-RyanNeural-Male",
        options: MONEY_PRINTER_VOICE_OPTIONS,
        default: "en-US-JennyNeural-Female",
      },
      {
        key: "language",
        kind: "text",
        label: "Script language",
        help:
          "Enter a language code such as en, nl, or de, or leave blank to follow your request.",
        flag: "--language nl",
        placeholder: "follow the subject",
        maxLength: 12,
        default: "",
      },
      {
        key: "paragraphs",
        kind: "number",
        label: "Paragraphs of narration",
        help: "How much script to write. More paragraphs means a longer video and more footage to find.",
        flag: "--paragraphs 2",
        min: 1,
        max: 10,
        default: 1,
      },
      {
        key: "clipSeconds",
        kind: "number",
        label: "Seconds per clip",
        help: "Time before switching clips. Shorter cuts need more footage.",
        flag: "--clip 4",
        min: 1,
        max: 30,
        default: 5,
      },
      {
        key: "concat",
        kind: "select",
        label: "Clip order",
        help: "Whether the downloaded clips are shuffled or kept in the order they were found.",
        flag: "--sequential",
        options: [
          { value: "random", label: "Shuffled" },
          { value: "sequential", label: "In search order" },
        ],
        default: "random",
      },
      {
        key: "subtitles",
        kind: "toggle",
        label: "Burn in subtitles",
        help: "Captions the narration on screen, timed to the voiceover.",
        flag: "--no-subtitles",
        default: true,
      },
      {
        key: "music",
        kind: "toggle",
        label: "Background music",
        help: "Plays an included music track under the narration.",
        flag: "--no-music",
        default: true,
      },
      {
        key: "count",
        kind: "number",
        label: "Cuts per run",
        help:
          "Create multiple versions of the same script. Each extra version takes more processing time.",
        flag: "--count 3",
        min: 1,
        max: 5,
        default: 1,
      },
    ],
  },
  {
    id: "openwork",
    name: "OpenWork",
    command: "/agents:openwork",
    summary: "Works inside your OpenWork workspace — its skills, connections and files.",
    appliesWhen:
      "Files stay in the workspace between tasks.",
    fields: [
      {
        key: "deliverFiles",
        kind: "toggle",
        label: "Ask for files, not just an answer",
        help:
          "Attach generated files to the reply. When off, replies use text unless you ask for a file.",
        default: true,
      },
      {
        key: "allowCommands",
        kind: "toggle",
        label: "Let it run commands",
        help:
          "Whether the workspace agent may run shell commands inside its own directory. Off restricts a run to reading, writing and its connected services. Nothing outside the workspace is reachable either way.",
        default: true,
      },
    ],
  },
  {
    id: "openscience",
    name: "OpenScience",
    command: "/agents:openscience",
    summary: "Runs the research loop — literature, code, experiments, write-up — in its own workspace.",
    appliesWhen:
      "Files stay in the workspace between tasks.",
    fields: [
      {
        key: "harness",
        kind: "select",
        label: "How it works",
        help:
          "Research writes code, runs experiments, and reports results. Plan investigates without making changes.",
        options: [
          { value: "research", label: "Research" },
          { value: "plan", label: "Plan only (read-only)" },
        ],
        default: "research",
      },
      {
        key: "deliverFiles",
        kind: "toggle",
        label: "Keep what it makes",
        help:
          "Attach scripts, data, and figures to the reply. When off, files still stay in the workspace.",
        default: true,
      },
    ],
  },
  {
    id: "inbox-zero",
    name: "Inbox Zero",
    command: "/agents:inbox-zero",
    summary: "Reads, sorts, drafts and replies to the mail in your connected mailbox.",
    appliesWhen:
      "Choose what the agent can do with your mailbox. Sending always requires confirmation.",
    fields: [
      {
        key: "allowActions",
        kind: "toggle",
        label: "Let it change the mailbox",
        help:
          "Allow archiving, labeling, marking as read, unsubscribing, and sending after confirmation. When off, only reading and drafting are allowed.",
        default: true,
      },
      {
        key: "mailbox",
        kind: "text",
        label: "Mailbox",
        help:
          "Which address a run works on when you have connected more than one. Leave empty to use the first one you connected.",
        placeholder: "you@example.com",
        maxLength: 254,
        default: "",
      },
    ],
  },
  {
    id: "socials-manager",
    name: "Socials Manager",
    command: "/agents:socials-manager",
    summary: "Drafts and schedules social posts across your connected networks.",
    appliesWhen:
      "Posts are saved as drafts for you to review before publishing.",
    fields: [
      {
        key: "networks",
        kind: "multiselect",
        label: "Default networks",
        help: "The networks a run drafts for when the message does not name any. Leave empty to use whichever accounts are connected.",
        flag: "--on x,linkedin",
        options: SOCIALS_MANAGER_NETWORK_OPTIONS,
        default: [],
      },
      {
        key: "images",
        kind: "toggle",
        label: "Draw artwork for every post",
        help: "On costs an image generation round trip per network, so a copy-only run gets slower.",
        flag: "--image",
        default: false,
      },
    ],
  },
  {
    id: "ruflo",
    name: "Ruflo",
    command: "/agents:ruflo",
    summary: "Runs a hive-mind swarm of coding workers over a garden's repository.",
    appliesWhen:
      "Larger teams use more AI requests and may take longer to coordinate.",
    fields: [
      {
        key: "workers",
        kind: "number",
        label: "Workers",
        help: "How many workers the queen spawns for an objective.",
        min: 1,
        max: 12,
        default: 6,
      },
      {
        key: "queenType",
        kind: "select",
        label: "Queen",
        help: "How the queen decomposes the objective and directs its workers.",
        options: [
          { value: "strategic", label: "Strategic", help: "Plans the whole objective up front." },
          { value: "tactical", label: "Tactical", help: "Directs step by step as results arrive." },
          { value: "adaptive", label: "Adaptive", help: "Switches between the two as the work turns out." },
        ],
        default: "strategic",
      },
      {
        key: "consensus",
        kind: "select",
        label: "Consensus",
        help: "How workers agree on a result before it is accepted.",
        options: [
          { value: "byzantine", label: "Byzantine" },
          { value: "raft", label: "Raft" },
          { value: "gossip", label: "Gossip" },
          { value: "crdt", label: "CRDT" },
          { value: "quorum", label: "Quorum" },
        ],
        default: "byzantine",
      },
      {
        key: "topology",
        kind: "select",
        label: "Topology",
        help: "How workers are wired to each other and to the queen.",
        options: [
          { value: "hierarchical-mesh", label: "Hierarchical mesh" },
          { value: "hierarchical", label: "Hierarchical" },
          { value: "mesh", label: "Mesh" },
          { value: "adaptive", label: "Adaptive" },
        ],
        default: "hierarchical-mesh",
      },
    ],
  },
  {
    id: "matraix",
    name: "MatrAIx",
    command: "/agents:matraix",
    summary: "Puts a question to a sampled population of persona agents and reports what they said.",
    appliesWhen:
      "Choose how many simulated people respond and how they are selected.",
    fields: [
      {
        key: "respondents",
        kind: "number",
        label: "Respondents",
        help: "Each simulated person adds one AI request.",
        flag: "--personas",
        min: 1,
        max: 60,
        default: 12,
      },
      {
        key: "seed",
        kind: "number",
        label: "Sampling seed",
        help: "Use the same seed and filters to select the same simulated people across studies.",
        flag: "--seed",
        min: 0,
        max: 100000,
        default: 42,
      },
      {
        key: "allocation",
        kind: "select",
        label: "Stratified allocation",
        help: "How respondents are shared out when a study samples evenly across a dimension.",
        flag: "--allocation",
        options: [
          {
            value: "equalTotal",
            label: "Equal, capped at the total",
            help: "Every combination gets a share, then the cohort is trimmed to the requested size.",
          },
          {
            value: "proportional",
            label: "Proportional to the population",
            help: "Bigger groups get more respondents, so the cohort mirrors the pool.",
          },
          {
            value: "perCell",
            label: "A fixed number per combination",
            help: "Every combination gets the same count, so the cohort grows with the dimensions.",
          },
        ],
        default: "equalTotal",
      },
      {
        key: "sources",
        kind: "multiselect",
        label: "Persona sources",
        help: "Choose where the simulated profiles come from. Leave all unchecked to use every source.",
        flag: "--source",
        options: [
          { value: "wiki", label: "Wikipedia", help: "Grounded in public biographical records." },
          { value: "gss", label: "General Social Survey", help: "Grounded in real survey respondents." },
          { value: "real_human_survey", label: "Human survey", help: "Grounded in collected responses." },
          { value: "amazon", label: "Amazon reviews", help: "Grounded in consumer review histories." },
          { value: "stackoverflow", label: "Stack Overflow", help: "Grounded in developer activity." },
          { value: "prism", label: "PRISM", help: "Grounded in a human preference dataset." },
          { value: "synthetic", label: "Synthetic", help: "Generated from the dimension schema." },
        ],
        default: [],
      },
    ],
  },
  {
    id: "bolt-slides",
    name: "Bolt Slides",
    command: "/agents:bolt-slides",
    summary: "Builds a presentation as a running web app — every slide a live, responsive page.",
    appliesWhen:
      "Default length and style, unless your request specifies them.",
    fields: [
      {
        key: "slides",
        kind: "number",
        label: "Slides to aim for",
        help: "Target presentation length. The final length depends on the material.",
        flag: "--slides",
        min: 5,
        max: 24,
        default: 12,
      },
      {
        key: "theme",
        kind: "select",
        label: "Theme family",
        help: "Choose a style, or use Automatic to match the topic, audience, and any brand you name.",
        flag: "--theme",
        options: [
          { value: "auto", label: "Choose per deck", help: "The plan picks the family the topic calls for." },
          { value: "dark-product", label: "Dark product", help: "The default: dark surfaces, one bright accent." },
          { value: "editorial-luxury", label: "Editorial luxury", help: "Serif display type, generous space." },
          { value: "swiss", label: "Swiss", help: "Grid, rules, and restraint." },
          { value: "dark-technical", label: "Dark technical", help: "Mono figures, engineering register." },
          { value: "warm-minimal", label: "Warm minimal", help: "Light, warm neutrals, quiet accent." },
          { value: "fintech", label: "Fintech", help: "Tabular numerals and a confident accent." },
          { value: "aurora-glass", label: "Aurora glass", help: "Gradient light behind translucent panels." },
          { value: "cinematic", label: "Cinematic", help: "Full-bleed and high contrast." },
          { value: "paper-editorial", label: "Paper editorial", help: "Printed-page feel, ink on stock." },
        ],
        default: "auto",
      },
    ],
  },
  {
    id: "classroom",
    name: "Classroom",
    command: "/agents:classroom",
    summary: "Teaches a topic or your documents as an interactive classroom — slides, quizzes, simulations.",
    appliesWhen:
      "Choose which features to include in lessons. Your request can override these defaults.",
    fields: [
      {
        key: "tts",
        kind: "toggle",
        label: "Narrate the slides",
        help: "Add spoken narration. Requires a speech provider connected to OpenMAIC.",
        flag: "--tts",
        default: false,
      },
      {
        key: "images",
        kind: "toggle",
        label: "Illustrate the slides",
        help: "Generate lesson images. Requires an image provider connected to OpenMAIC.",
        flag: "--images",
        default: false,
      },
      {
        key: "webSearch",
        kind: "toggle",
        label: "Ground in a web search",
        help: "Search for current sources before planning the lesson. Requires a search provider connected to OpenMAIC.",
        flag: "--search",
        default: false,
      },
      {
        key: "agentMode",
        kind: "select",
        label: "Generation mode",
        help: "Use the standard lesson builder, or agent mode for more detailed scenes that take longer to create.",
        flag: "--mode",
        options: [
          { value: "default", label: "Pipeline", help: "Outline first, then each scene in turn." },
          { value: "generate", label: "Agent mode", help: "Creates scenes with an AI agent." },
        ],
        default: "default",
      },
    ],
  },
  {
    id: "agent-reach",
    name: "Agent Reach",
    command: "/agents:agent-reach",
    summary: "Reads the open internet — threads, posts, videos, repositories.",
    appliesWhen:
      "Limit how many steps the agent can take before answering. Each command or AI response counts as a step.",
    fields: [
      {
        key: "maxSteps",
        kind: "number",
        label: "Steps per run",
        help: "The ceiling on tool calls and model turns in a single run.",
        min: 1,
        max: 40,
        default: 16,
      },
    ],
  },
  {
    id: "career-ops",
    name: "Career Ops",
    command: "/agents:career-ops",
    summary: "Scores postings, tailors CVs, and keeps every application tracked.",
    appliesWhen:
      "Applies to every run. Long modes like a full portal scan need more steps than a single cover letter.",
    fields: [
      {
        key: "maxSteps",
        kind: "number",
        label: "Steps per run",
        help: "The ceiling on tool calls and model turns in a single run.",
        min: 1,
        max: 60,
        default: 24,
      },
    ],
  },
  {
    id: OPENEXECUTIVE_AGENT_ID,
    name: OPENEXECUTIVE_AGENT_NAME,
    command: OPENEXECUTIVE_COMMAND,
    summary:
      "A virtual executive team for strategy, finance, people, legal, operations, marketing, product, and board work.",
    appliesWhen:
      "Applies to every advisory run. Message flags --iterations N and --committee/--no-committee override these defaults.",
    fields: [
      {
        key: "maxIterations",
        kind: "number",
        label: "Maximum routing rounds",
        help: "Caps the Executive's specialist/tool loop before it returns the best partial answer.",
        flag: "--iterations N",
        min: 1,
        max: 30,
        default: 15,
      },
      {
        key: "committeeReview",
        kind: "toggle",
        label: "Committee review",
        help: "Adds three independent critiques and a final revision. It is slower and uses more model calls.",
        flag: "--committee / --no-committee",
        default: false,
      },
    ],
  },
  {
    id: "trading-agent",
    name: "Trading Agent",
    command: "/agents:trading-agent",
    summary: "A firm of analysts, researchers and risk managers argues one instrument to a call.",
    // This agent is the exception to the rule at the top of the file: it takes
    // no prompt, so there are no inline flags to override these with. The
    // request form asks for the symbol, the date and the run's shape; every
    // other decision is made here and used unchanged.
    appliesWhen:
      "Defaults for new analyses. You can change them in the request form.",
    fields: [
      {
        key: "analysts",
        kind: "multiselect",
        label: "Analysts",
        help: "Which analysts research the instrument before the debate. Each one adds model calls and time.",
        options: [
          { value: "market", label: "Market", help: "Price action and technical indicators." },
          { value: "social", label: "Sentiment", help: "News tone, StockTwits and Reddit chatter." },
          { value: "news", label: "News", help: "Company headlines and macroeconomic events." },
          {
            value: "fundamentals",
            label: "Fundamentals",
            help: "Financial statements, valuation and insider activity.",
          },
        ],
        default: ["market", "social", "news", "fundamentals"],
      },
      {
        key: "researchDepth",
        kind: "number",
        label: "Research rounds",
        help: "How many times the bull and bear researchers answer each other before the manager rules.",
        min: 1,
        max: 5,
        default: 1,
      },
      {
        key: "riskRounds",
        kind: "number",
        label: "Risk rounds",
        help: "How many times the aggressive, conservative and neutral analysts argue the trader's plan.",
        min: 1,
        max: 5,
        default: 1,
      },
      {
        key: "assetType",
        kind: "select",
        label: "Asset type",
        help: "Choose the market to analyze. Crypto uses different news and data sources.",
        options: [
          { value: "stock", label: "Stock" },
          { value: "crypto", label: "Crypto" },
        ],
        default: "stock",
      },
      {
        key: "deepModel",
        kind: "text",
        label: "Deep-thinking model",
        help: "The model the research manager, trader and portfolio manager use. Empty follows the chat's model.",
        placeholder: "Follow the chat's model",
        maxLength: 120,
        default: "",
      },
      {
        key: "quickModel",
        kind: "text",
        label: "Quick-thinking model",
        help: "The model the analysts and their tool loops use. Empty follows the chat's model.",
        placeholder: "Follow the chat's model",
        maxLength: 120,
        default: "",
      },
      {
        key: "reasoningEffort",
        kind: "select",
        label: "Reasoning effort",
        help: "How hard the models think during a run.",
        options: [
          { value: "chat", label: "Follow the chat" },
          { value: "low", label: "Low" },
          { value: "medium", label: "Medium" },
          { value: "high", label: "High" },
          { value: "xhigh", label: "Extra high" },
        ],
        default: "chat",
      },
      {
        key: "outputLanguage",
        kind: "text",
        label: "Report language",
        help: "The language the reports and the final decision are written in. The internal debate stays in English.",
        placeholder: "English",
        maxLength: 40,
        default: "English",
      },
      {
        key: "marketVendor",
        kind: "select",
        label: "Price and fundamentals data",
        help: "Choose the sources for prices, indicators, and financial statements. Only selected sources are used.",
        options: [
          { value: "yfinance", label: "Yahoo Finance", help: "No account needed." },
          { value: "alpha_vantage", label: "Alpha Vantage", help: "Needs a free API key." },
          {
            value: "yfinance,alpha_vantage",
            label: "Yahoo Finance, then Alpha Vantage",
            help: "Falls back when Yahoo returns nothing.",
          },
        ],
        default: "yfinance",
      },
      {
        key: "newsVendor",
        kind: "select",
        label: "News data",
        help: "Where company and market news comes from.",
        options: [
          { value: "yfinance", label: "Yahoo Finance", help: "No account needed." },
          { value: "alpha_vantage", label: "Alpha Vantage", help: "Needs a free API key." },
          {
            value: "yfinance,alpha_vantage",
            label: "Yahoo Finance, then Alpha Vantage",
            help: "Falls back when Yahoo returns nothing.",
          },
        ],
        default: "yfinance",
      },
    ],
  },
  {
    id: "legal",
    name: "Legal Agent",
    command: "/agents:legal",
    summary:
      "Reviews, analyses and drafts on the documents you attach, and hands back the deliverable.",
    appliesWhen:
      "Applies to the next task. Options in your message override these defaults.",
    fields: [
      {
        key: "maxTurns",
        kind: "number",
        label: "Turn budget",
        help: "Maximum steps per task. Reviewing many documents needs more steps than reviewing one.",
        flag: "--turns 40",
        min: 5,
        max: 200,
        default: 60,
      },
      {
        key: "effort",
        kind: "select",
        label: "Reasoning effort",
        help: "Higher effort gives the model more time to reason. Use the chat setting to match your conversation.",
        flag: "--effort high",
        options: [
          { value: "", label: "Follow the chat", help: "Use whatever the chat is set to." },
          { value: "low", label: "Low", help: "Fastest. Extraction and simple lookups." },
          { value: "medium", label: "Medium", help: "The usual choice for review work." },
          { value: "high", label: "High", help: "Drafting and analysis that has to hold up." },
          { value: "xhigh", label: "Maximum", help: "Slowest. Complex, multi-document questions." },
        ],
        default: "",
      },
      {
        key: "skills",
        kind: "multiselect",
        label: "Document formats",
        help: "Choose output formats. Leave all unchecked for Markdown only.",
        flag: "--skills docx,xlsx",
        options: [
          { value: "docx", label: "Word", help: "Memos, letters, agreements, redlines." },
          { value: "xlsx", label: "Excel", help: "Issue lists, term matrices, comparisons." },
          { value: "pptx", label: "PowerPoint", help: "Board and committee decks." },
        ],
        default: ["docx", "xlsx", "pptx"],
      },
      {
        key: "allowShell",
        kind: "toggle",
        label: "Let it run commands",
        help:
          "The benchmark this harness comes from runs every command in a container, which this machine has no equivalent of — so a command here runs with your own access, inside the run's own folder. Turning it off is safe but costs the Word, Excel and PowerPoint formats, which are produced by scripts.",
        flag: "--no-shell",
        default: true,
      },
      {
        key: "shellTimeout",
        kind: "number",
        label: "Command time limit",
        help: "Maximum time for each command. Longer documents may need more time.",
        min: 10,
        max: 900,
        default: 120,
      },
    ],
  },
  {
    id: "wardrobe",
    name: "Wardrobe",
    command: "/agents:wardrobe",
    summary:
      "Turns photos of your clothes into catalog cutouts and modeled photos, and files them in your wardrobe.",
    appliesWhen:
      "Applies to future imports unless your request overrides it. Changing image quality restarts Wardrobe on the next run.",
    fields: [
      {
        key: "maxItemsPerPhoto",
        kind: "number",
        label: "Pieces per photo",
        help: "Maximum garments to import from one photo. Additional items are listed in the result.",
        flag: "--items 4",
        min: 1,
        max: 8,
        default: 6,
      },
      {
        key: "quality",
        kind: "select",
        label: "Image quality",
        help: "Choose image quality. Each garment generates two images; lower settings reduce processing.",
        flag: "--quality medium",
        options: [
          { value: "auto", label: "Automatic", help: "Let the provider decide per image." },
          { value: "low", label: "Low", help: "Fastest and cheapest. Rough cutouts." },
          { value: "medium", label: "Medium", help: "Good enough for a browsable wardrobe." },
          { value: "high", label: "High", help: "The default. Detail survives on patterns and logos." },
        ],
        default: "high",
      },
    ],
  },
  {
    id: "deer-flow",
    name: "DeerFlow",
    command: "/agents:deer-flow",
    summary: "A general-purpose agent with a workspace, delegated subagents, skills and memory.",
    // The task is forwarded to DeerFlow's own lead agent verbatim, so there are
    // no inline flags to override these with: a flag would arrive as prose. The
    // fields are the harness's own switches instead.
    appliesWhen:
      "Applies to the next task. Changing command access restarts DeerFlow first.",
    fields: [
      {
        key: "subagents",
        kind: "toggle",
        label: "Delegate to subagents",
        help: "Let helper agents work on parts of a task. When off, one agent does all the work.",
        default: true,
      },
      {
        key: "maxSubagents",
        kind: "number",
        label: "Subagents per run",
        help: "The ceiling on how many helpers one run may launch in total.",
        min: 1,
        max: 12,
        default: 6,
      },
      {
        key: "planMode",
        kind: "toggle",
        label: "Plan before acting",
        help: "Write and track a todo list first. Useful on long tasks, overhead on short ones.",
        default: false,
      },
      {
        key: "web",
        kind: "toggle",
        label: "Search and read the web",
        help: "Allow web and image searches. When off, the agent uses only the material you provide and its own files.",
        default: true,
      },
      {
        key: "memory",
        kind: "toggle",
        label: "Remember across runs",
        help: "Keep facts learned in one run available to the next. Off means every run starts clean.",
        default: true,
      },
      {
        key: "shell",
        kind: "toggle",
        label: "Let it run commands",
        help:
          "Whether the agent may run shell commands. Its workspace is a folder on this machine, not a container, so a command runs with your own access — off is the safe default, and file reading and writing still work.",
        default: false,
      },
    ],
  },
  {
    id: "vibe-trading",
    name: "Vibe Trading",
    command: "/agents:vibe-trading",
    summary: "A finance-research agent with market data, factors, backtests and shadow accounts.",
    // Also an exception to the rule at the top of the file, for a different
    // reason: the cloned service reads its configuration once at boot and
    // caches it, so there is nothing a per-message flag could change. Every
    // field here is a real environment variable, and changing one restarts the
    // service before the next run rather than being quietly ignored.
    appliesWhen:
      "Changes restart Vibe Trading, so the next task may take longer to start.",
    fields: [
      {
        key: "model",
        kind: "text",
        label: "Model",
        help: "The model the research agent runs on. Empty follows the chat's model.",
        placeholder: "Follow the chat's model",
        maxLength: 120,
        default: "",
      },
      {
        key: "temperature",
        kind: "select",
        label: "Temperature",
        help: "How much the model varies its answers. Research should normally be reproducible.",
        options: [
          { value: "0", label: "0 · deterministic", help: "The project's own default." },
          { value: "0.3", label: "0.3 · slight variation" },
          { value: "0.7", label: "0.7 · exploratory" },
          { value: "1", label: "1.0 · creative" },
        ],
        default: "0",
      },
      {
        key: "memory",
        kind: "select",
        label: "Memory across runs",
        help: "Whether the agent keeps what it learned from earlier runs. Off means each run starts clean.",
        options: [
          { value: "off", label: "Off", help: "No memory between runs." },
          { value: "on", label: "On", help: "Quality scoring, decay and garbage collection." },
          {
            value: "full",
            label: "Full",
            help: "Adds hierarchy, semantic links, compression and full-text search.",
          },
        ],
        default: "off",
      },
      {
        key: "dataCache",
        kind: "toggle",
        label: "Cache market data",
        help: "Save historical prices for faster repeat tests. Today’s prices are always fetched again.",
        default: true,
      },
      {
        key: "cryptoExchange",
        kind: "select",
        label: "Crypto fallback exchange",
        help: "Used when the OKX public API is unreachable. OKX itself is always tried first and needs no account.",
        options: [
          { value: "binance", label: "Binance" },
          { value: "coinbase", label: "Coinbase" },
          { value: "kraken", label: "Kraken" },
          { value: "bybit", label: "Bybit" },
        ],
        default: "binance",
      },
    ],
  },
  {
    id: "stock-analyst",
    name: "Stock Analyst",
    command: "/agents:stock-analyst",
    summary:
      "Answers questions about named stocks using live quotes, charts, news and its own strategy playbooks.",
    // The same exception as Vibe Trading, for the same reason: the cloned
    // backend reads its configuration once at boot and caches it, so there is
    // nothing a per-message flag could change. Every field here is a real
    // setting, and changing one restarts the backend before the next run rather
    // than being quietly ignored.
    appliesWhen:
      "Changes restart Stock Analyst, so the next task may take longer to start.",
    fields: [
      {
        key: "model",
        kind: "text",
        label: "Model",
        help: "The model the analyst runs on. Empty follows the chat's model.",
        placeholder: "Follow the chat's model",
        maxLength: 120,
        default: "",
      },
      {
        key: "depth",
        kind: "select",
        label: "How far it goes",
        help:
          "Quick uses one analyst. Deeper options add news, strategy, and risk reviews, taking more time and AI requests.",
        options: [
          {
            value: "single",
            label: "Quick answer",
            help: "One agent with tools. Enough for a single question about one stock.",
          },
          { value: "multi-quick", label: "Short review", help: "A brief review of the stock’s outlook." },
          {
            value: "multi-standard",
            label: "Standard review",
            help: "Data, news, strategy, risk and a decision.",
          },
          {
            value: "multi-full",
            label: "Full decision report",
            help: "Every stage: scores, trend, levels, risks and an operating checklist.",
          },
          {
            value: "multi-specialist",
            label: "Strategy panel",
            help: "Several strategy specialists in parallel, then reconciled.",
          },
        ],
        default: "single",
      },
      {
        key: "language",
        kind: "select",
        label: "Report language",
        help: "The language the analysis is written in. The project's own default is Chinese.",
        options: [
          { value: "en", label: "English" },
          { value: "zh", label: "Chinese" },
          { value: "ko", label: "Korean" },
        ],
        default: "en",
      },
      {
        key: "watchlist",
        kind: "text",
        label: "Your stocks",
        help:
          "Default stocks when your question does not name one. Examples: 600519, hk00700, AAPL, 7203.T, 005930.KS, 2330.TW.",
        placeholder: "600519,hk00700,AAPL",
        maxLength: 400,
        default: "",
      },
      {
        key: "strategies",
        kind: "select",
        label: "Strategy playbooks",
        help:
          "Choose which built-in strategies the analyst can use.",
        options: [
          {
            value: "auto",
            label: "Chosen automatically",
            help: "Picked from the current market state.",
          },
          { value: "all", label: "All fifteen", help: "Broader and slower." },
        ],
        default: "auto",
      },
      {
        key: "memory",
        kind: "toggle",
        label: "Remember earlier calls",
        help:
          "Keep what previous runs concluded and calibrate confidence against how those calls turned out. Off means every question starts clean.",
        default: false,
      },
      {
        key: "temperature",
        kind: "select",
        label: "Temperature",
        help: "How much the model varies its answers. A verdict on a stock should be reproducible.",
        options: [
          { value: "0", label: "0 · deterministic" },
          { value: "0.2", label: "0.2 · nearly fixed" },
          { value: "0.7", label: "0.7 · the project's default" },
          { value: "1", label: "1.0 · exploratory" },
        ],
        default: "0.2",
      },
    ],
  },
  {
    id: "video-use",
    name: "Video Use",
    command: "/agents:video-use",
    summary: "Edits a video you already have — cuts, pacing, framing, look and captions.",
    appliesWhen:
      "Applies to videos edited from chat or the video editor. Higher quality takes longer.",
    fields: [
      {
        key: "quality",
        kind: "select",
        label: "Render quality",
        help:
          "Final gives full-quality output. Preview is faster and lower quality, for checking the edit.",
        flag: "quality in the studio",
        options: [
          { value: "final", label: "Final — 1080p, CRF 20" },
          { value: "preview", label: "Preview — faster, lower bitrate" },
        ],
        default: "final",
      },
      {
        key: "reasoningEffort",
        kind: "select",
        label: "Planning effort",
        help:
          "Higher effort gives the model more time to plan edits, especially for long or complex videos.",
        options: [
          { value: "low", label: "Low — quickest" },
          { value: "medium", label: "Medium — recommended" },
          { value: "high", label: "High — long or messy footage" },
        ],
        default: "medium",
      },
    ],
  },
];

export function findConfigurableAgent(agentId: string): ConfigurableAgent | null {
  const id = agentId.trim().toLowerCase();
  return CONFIGURABLE_AGENTS.find((agent) => agent.id === id) ?? null;
}

function defaultFor(field: AgentSettingField): AgentSettingValue {
  return field.kind === "multiselect" ? [...field.default] : field.default;
}

/** Every field at its shipped value — what a user who never opened the page gets. */
export function agentSettingDefaults(agent: ConfigurableAgent): AgentSettingValues {
  const values: AgentSettingValues = {};
  for (const field of agent.fields) values[field.key] = defaultFor(field);
  return values;
}

function normalizeNumber(field: Extract<AgentSettingField, { kind: "number" }>, raw: unknown): number {
  const parsed = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : Number.NaN;
  if (!Number.isFinite(parsed)) return field.default;
  const rounded = Math.trunc(parsed);
  // The "leave it to the run" value sits outside the usable range on purpose,
  // so it has to be allowed through before clamping.
  if (field.unsetValue !== undefined && rounded === field.unsetValue) return rounded;
  return Math.min(field.max, Math.max(field.min, rounded));
}

function normalizeDimensions(
  field: Extract<AgentSettingField, { kind: "dimensions" }>,
  raw: unknown,
): Dimensions | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const source = raw as Record<string, unknown>;
  const axes = (["x", "y", "z"] as const).map((axis) => {
    const value = source[axis];
    const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
    // Below the minimum means "not filled in yet", not "clamp me up to 10mm" —
    // a half-typed volume must not silently become a real constraint.
    if (!Number.isFinite(parsed) || parsed < field.min) return null;
    return Math.min(field.max, Math.round(parsed));
  });
  // A half-filled volume is not a volume. Either all three axes are usable or
  // the field is empty and the run is left unconstrained.
  if (axes.some((axis) => axis === null)) return null;
  return { x: axes[0] as number, y: axes[1] as number, z: axes[2] as number };
}

/**
 * Turn whatever arrived — an old stored blob, a hand-written request body — into
 * a complete, valid set of values. Unknown keys are dropped and unusable values
 * fall back to the field's default, so a normalized object is always safe to
 * hand to a run.
 */
export function normalizeAgentSettings(
  agent: ConfigurableAgent,
  raw: unknown,
): AgentSettingValues {
  const source =
    raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const values: AgentSettingValues = {};

  for (const field of agent.fields) {
    const value = source[field.key];
    if (value === undefined) {
      values[field.key] = defaultFor(field);
      continue;
    }

    switch (field.kind) {
      case "select": {
        const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
        values[field.key] = field.options.some((option) => option.value === normalized)
          ? normalized
          : field.default;
        break;
      }
      case "toggle": {
        values[field.key] = typeof value === "boolean" ? value : field.default;
        break;
      }
      case "number": {
        values[field.key] = normalizeNumber(field, value);
        break;
      }
      case "text": {
        values[field.key] =
          typeof value === "string" ? value.trim().slice(0, field.maxLength) : field.default;
        break;
      }
      case "multiselect": {
        const allowed = new Set(field.options.map((option) => option.value));
        const selected = Array.isArray(value)
          ? value
              .map((entry) => (typeof entry === "string" ? entry.trim().toLowerCase() : ""))
              .filter((entry) => allowed.has(entry))
          : [];
        values[field.key] = [...new Set(selected)];
        break;
      }
      case "dimensions": {
        values[field.key] = normalizeDimensions(field, value);
        break;
      }
    }
  }

  return values;
}

/** True when nothing has been changed away from the shipped values. */
export function isDefaultAgentSettings(
  agent: ConfigurableAgent,
  values: AgentSettingValues,
): boolean {
  const defaults = agentSettingDefaults(agent);
  return agent.fields.every(
    (field) => JSON.stringify(values[field.key] ?? null) === JSON.stringify(defaults[field.key] ?? null),
  );
}

/** A short human summary of what is set, for the settings index cards. */
export function describeAgentSettings(
  agent: ConfigurableAgent,
  values: AgentSettingValues,
): string {
  const parts = agent.fields.flatMap((field) => {
    const value = values[field.key];
    if (field.kind === "toggle") return [`${field.label}: ${value ? "on" : "off"}`];
    if (field.kind === "select") {
      const option = field.options.find((entry) => entry.value === value);
      return option ? [`${field.label}: ${option.label}`] : [];
    }
    if (field.kind === "number") {
      if (field.unsetValue !== undefined && value === field.unsetValue) return [];
      return [`${field.label}: ${String(value)}`];
    }
    if (field.kind === "text") return value ? [`${field.label}: ${String(value)}`] : [];
    if (field.kind === "multiselect") {
      const selected = Array.isArray(value) ? value : [];
      return selected.length ? [`${field.label}: ${selected.length} selected`] : [];
    }
    const bed = value as Dimensions | null;
    return bed ? [`${field.label}: ${bed.x}×${bed.y}×${bed.z} ${field.unit}`] : [];
  });
  return parts.join(" · ");
}
