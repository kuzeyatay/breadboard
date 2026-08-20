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
    id: "deep-research",
    name: "Deep Research",
    command: "/agents:deep-research",
    summary: "Multi-round web research that returns a sourced report.",
    appliesWhen:
      "Applies to every research run you start from chat. Breadth times depth is roughly how many model calls with web search a run costs, so it is also how long you wait.",
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
      "Applies to every document search you start from chat. Downloads are always limited to full texts the publisher or a repository offers for free.",
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
      "Applies to every run, whether you attach a recording, record one, or paste a transcript. Transcribing is nearly all of the wait on a long meeting.",
    fields: [
      {
        key: "speakers",
        kind: "toggle",
        label: "Separate speakers",
        help:
          "Label each turn with who was talking, so an action item keeps its owner. Needs Scriberr running; with only the local speech model the notes have no attributions either way.",
        flag: "--no-speakers",
        default: true,
      },
      {
        key: "language",
        kind: "text",
        label: "Spoken language",
        help:
          "A two-letter code (en, nl, de) to stop the transcriber guessing. Leave empty to let it detect the language per recording.",
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
          "Stop after the transcript instead of writing notes from it. Much cheaper — it skips a model call per five thousand characters — and useful when you only want the record of what was said.",
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
      "Applies to every tutoring turn you start from chat. What the tutor may read is decided by where you ask, not here: in a Garden it reads that Garden, in the Terminal it reads your workspace.",
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
      "These are preferences, not orders. A brief that names its own board or build style is followed; these fill in what the brief leaves open.",
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
      "Applies to every production started from chat. Drawing the storyboard is the slow, expensive part of a run.",
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
          "Which model draws the storyboard. The two run on different subscriptions, so a quota that has run out on one does not stop the other.",
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
      "Applies to every production started from chat. Drawing the posters with ComfyUI and animating them frame by frame are the two slow parts of a run.",
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
          "Element-level motion cuts each poster into pieces and flies them back into place. Ken Burns is one slow push over the whole poster, and is much faster to render.",
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
          "A theme preset from the skill's library (american-retro, swiss-modern, punk-zine, chinese-ink...) or a look in words. Empty lets the art director match the topic, which is usually better.",
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
          "Which model file draws the posters. Empty uses the first checkpoint ComfyUI reports. Ignored when ComfyUI is not running.",
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
          "Off renders the deterministic paper title cards instead of asking ComfyUI, which is much faster and needs no model file.",
        flag: "--no-images",
        default: true,
      },
      {
        key: "music",
        kind: "toggle",
        label: "Score it",
        help:
          "Lay a track from the local music folder under the narration. Nothing is generated and nothing is downloaded; with no local track the film has narration only.",
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
      "Fills in the form when you select the agent, and decides how the audio is transcribed. Transcribing is most of the wait on a long video.",
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
        help: "How large a copy of the source video is fetched. Higher costs download time and re-encoding time.",
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
          "Which Whisper size listens to the audio. Larger is more accurate and much slower on a CPU; each one downloads once on first use.",
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
          "A two-letter code (en, nl, de) to stop Whisper guessing. Leave empty to let it detect the language per video.",
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
      "Applies to every video started from chat. Downloading footage and re-encoding it is most of the wait, so clip length and the number of cuts are what change how long a run takes.",
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
          "Where the clips come from. Each hosted library needs its own key, which you add in this agent's setup above; local cuts from files you have put in the clone's storage folder.",
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
          "Who reads the script. These are Edge voices, so they cost nothing and need no account. Any other voice the clone knows can be named with the flag.",
        flag: "--voice en-GB-RyanNeural-Male",
        options: MONEY_PRINTER_VOICE_OPTIONS,
        default: "en-US-JennyNeural-Female",
      },
      {
        key: "language",
        kind: "text",
        label: "Script language",
        help:
          "A code like en, nl or de to pin the language the narration is written in. Leave empty to follow the language of what you asked for.",
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
        help: "How long one piece of footage is held before cutting to the next. Shorter cuts feel faster and need more clips.",
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
        help: "Plays one of the clone's bundled tracks under the voiceover.",
        flag: "--no-music",
        default: true,
      },
      {
        key: "count",
        kind: "number",
        label: "Cuts per run",
        help:
          "How many videos to build from the same script, so you can pick one. Each extra cut re-encodes the whole video again.",
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
      "Applies to every run in the workspace. The workspace itself is durable: what a run leaves behind is there for the next one, whichever of these you change.",
    fields: [
      {
        key: "deliverFiles",
        kind: "toggle",
        label: "Ask for files, not just an answer",
        help:
          "Tells a run to write documents, spreadsheets and reports into the workspace outbox so they come back attached to the answer. Off leaves the answer as prose unless the task asks for a file.",
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
      "Applies to every run. The workspace is durable: what one run leaves behind is there for the next, whichever of these you change.",
    fields: [
      {
        key: "harness",
        kind: "select",
        label: "How it works",
        help:
          "Research does the work: it writes code, runs experiments and reports what came out. Plan investigates and tells you what it would do without changing anything.",
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
          "Attaches the scripts, data and figures a run produces to the answer. Off still leaves them in the workspace; they just are not listed on the turn.",
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
      "Applies to every run. Inbox Zero asks before it sends anything either way — these decide what a run is allowed to reach for in the first place.",
    fields: [
      {
        key: "allowActions",
        kind: "toggle",
        label: "Let it change the mailbox",
        help:
          "On, a run can archive, label, mark read, unsubscribe and send once you confirm. Off restricts it to reading and drafting, so it can answer questions and write replies but never act on them.",
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
      "Applies to every drafting run. Nothing is published without you — posts land on the calendar as drafts either way.",
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
      "Applies to every swarm spawned from chat. Bigger swarms are not automatically better — they cost proportionally more and coordinate worse.",
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
    id: "agent-reach",
    name: "Agent Reach",
    command: "/agents:agent-reach",
    summary: "Reads the open internet — threads, posts, videos, repositories.",
    appliesWhen:
      "Applies to every reading run. A step is one command or one model turn, so the limit is how far a run may dig before it has to answer.",
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
    id: "trading-agent",
    name: "Trading Agent",
    command: "/agents:trading-agent",
    summary: "A firm of analysts, researchers and risk managers argues one instrument to a call.",
    // This agent is the exception to the rule at the top of the file: it takes
    // no prompt, so there are no inline flags to override these with. The
    // request form asks for the symbol, the date and the run's shape; every
    // other decision is made here and used unchanged.
    appliesWhen:
      "Applies to every analysis. The form you fill in before a run starts from these, and everything the form does not ask about is taken from here.",
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
        help: "Which pipeline a run uses. Crypto reads different sentiment and market sources.",
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
        help: "Where prices, indicators and financial statements come from. The chosen chain is used exactly — nothing falls back to a vendor you did not pick.",
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
      "Applies to every assignment you start from chat, and takes effect on the next run. A flag typed in the message wins over any of these.",
    fields: [
      {
        key: "maxTurns",
        kind: "number",
        label: "Turn budget",
        help: "How many times the agent may think and act before the run is stopped. A data-room review needs far more than a single-contract read.",
        flag: "--turns 40",
        min: 5,
        max: 200,
        default: 60,
      },
      {
        key: "effort",
        kind: "select",
        label: "Reasoning effort",
        help: "How hard the model thinks on each turn. Following the chat keeps it in step with everything else you send.",
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
        help: "Which file formats the agent is taught to produce. None selected means it writes markdown only, which is faster to read and quicker to finish.",
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
        help: "Seconds one command may take before it is killed. Building a long document from a script is the slow case.",
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
      "Applies to every import you start from chat. A flag typed in the message wins over either of these, and changing the image quality restarts the wardrobe server on the next run.",
    fields: [
      {
        key: "maxItemsPerPhoto",
        kind: "number",
        label: "Pieces per photo",
        help: "How many garments one photograph may contribute. A full outfit shot yields five or six; a single laid-out item yields one. Anything found past this is named in the result rather than dropped silently.",
        flag: "--items 4",
        min: 1,
        max: 8,
        default: 6,
      },
      {
        key: "quality",
        kind: "select",
        label: "Image quality",
        help: "How hard the provider works on each cutout and modeled photo. Every piece costs two images, so a batch of holiday photos is where the lower settings earn their keep.",
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
      "Applies to every task you start from chat. Everything except running commands takes effect on the next run; that one restarts the DeerFlow service first.",
    fields: [
      {
        key: "subagents",
        kind: "toggle",
        label: "Delegate to subagents",
        help: "Let a run split work off to its own helpers and gather the results. Off keeps everything in one thread of work.",
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
        help: "Offer web search, page fetching and image search. Off leaves a run with only what you gave it and what it writes itself.",
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
      "Applies to every run. Changing any of these restarts the Vibe Trading service, so the next run takes a little longer to start.",
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
        help: "Keep settled historical bars on disk so repeat backtests skip the network. Today's bars are always re-fetched.",
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
      "Applies to every question. Changing any of these restarts the Stock Analyst backend, so the next run takes a little longer to start.",
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
          "A quick answer is one agent with tools. The deeper settings run a staged pipeline — data, news, strategy, risk, decision — which is where the full decision report comes from, at several model calls per stage.",
        options: [
          {
            value: "single",
            label: "Quick answer",
            help: "One agent with tools. Enough for a single question about one stock.",
          },
          { value: "multi-quick", label: "Short review", help: "The shortest staged pipeline." },
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
          "The codes a question can refer to without naming them, in the project's own format: 600519, hk00700, AAPL, 7203.T, 005930.KS, 2330.TW. A question that names its own stock never needs this.",
        placeholder: "600519,hk00700,AAPL",
        maxLength: 400,
        default: "",
      },
      {
        key: "strategies",
        kind: "select",
        label: "Strategy playbooks",
        help:
          "Which of the fifteen built-in strategies the analyst may reason with — moving averages, Chan theory, Elliott waves, volume breakout, sentiment cycle and the rest.",
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
      "Applies to every edit, whether it starts from a video you attach in chat or from the studio on an existing video artifact. Encoding is most of the wait, so quality is what changes how long a pass takes.",
    fields: [
      {
        key: "quality",
        kind: "select",
        label: "Render quality",
        help:
          "Final is the delivered encode. Preview is the same cut at a lower bitrate — several times faster, and enough to judge whether the edit is right.",
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
          "How hard the model thinks about where the cuts go. Higher is slower and noticeably better on long or messy footage.",
        options: [
          { value: "low", label: "Low — quickest" },
          { value: "medium", label: "Medium — recommended" },
          { value: "high", label: "High — long or messy footage" },
        ],
        default: "medium",
      },
    ],
  },
  {
    id: "paper-trader",
    name: "Paper Trader",
    command: "/agents:paper-trader",
    summary:
      "A paper trading desk that keeps running on its own, with every buy and sell argued out by the Trading Agent team first.",
    // No flags anywhere in this entry, and that is not an oversight. A message to
    // this agent only starts, stops or shows a desk — there is nothing in it for
    // a flag to modify, because the trading happens between messages rather than
    // during one. Everything the desk does is decided here.
    appliesWhen:
      "Applies from the next time the desk is started. A running desk keeps the settings it started with, so stop it and start it again to pick up a change.",
    fields: [
      {
        key: "startingCapital",
        kind: "number",
        label: "Starting capital",
        // The one field with a consequence worth spelling out. Every return
        // figure on the card is measured against this number, so it cannot move
        // underneath a portfolio without making its own history meaningless.
        help:
          "How much play money the desk starts with, in US dollars. Changing this opens a fresh portfolio the next time the desk starts — the current positions and history are retired, not carried over.",
        min: 100,
        max: 10_000_000,
        default: 10_000,
      },
      {
        key: "symbols",
        kind: "multiselect",
        label: "Coins",
        help:
          "Which coins join the rotation. US exchange-listed company shares are discovered automatically, so you never need to enter stock tickers.",
        // Lower case because the catalog's multiselect normaliser folds every
        // stored value that way; the runtime upper-cases them again on the way
        // to the arena, which spells its symbols in caps.
        options: [
          { value: "btc", label: "Bitcoin" },
          { value: "eth", label: "Ethereum" },
          { value: "sol", label: "Solana" },
          { value: "bnb", label: "Binance Coin" },
          { value: "xrp", label: "Ripple" },
          { value: "doge", label: "Dogecoin" },
        ],
        default: ["btc", "eth", "sol"],
      },
      {
        key: "cycleMinutes",
        kind: "select",
        label: "Trading cycle",
        help:
          "How often the desk acts. Each cycle carries out the previous analysis and starts the next one, and an analysis is a full multi-agent debate — several minutes and a good number of model calls.",
        options: [
          { value: "5", label: "Every 5 minutes", help: "Busiest. One debate per coin every few cycles." },
          { value: "10", label: "Every 10 minutes" },
          { value: "15", label: "Every 15 minutes", help: "Recommended." },
          { value: "30", label: "Every 30 minutes" },
          { value: "60", label: "Every hour", help: "Quietest, and the cheapest to leave running." },
        ],
        default: "15",
      },
      {
        key: "positionSize",
        kind: "number",
        label: "Maximum trade size",
        help:
          "Upper limit for a new position's exposure, measured against available cash. The desk chooses the exact size dynamically from the analyst rating and chair confidence, but never exceeds this amount.",
        min: 1,
        max: 100,
        default: 20,
      },
      {
        key: "leverage",
        kind: "number",
        label: "Leverage",
        help:
          "How much a new position is multiplied by. Above 1 the desk can be liquidated when a position moves against it, which the arena's own margin monitor enforces.",
        min: 1,
        max: 10,
        default: 2,
      },
      {
        key: "allowShorts",
        kind: "toggle",
        label: "Allow shorts",
        help:
          "Whether a bearish verdict on a coin the desk does not hold opens a short. With this off, a bearish verdict on nothing held simply does nothing.",
        default: true,
      },
      {
        key: "analysts",
        kind: "multiselect",
        label: "Analysts",
        help:
          "Which TradingAgents analysts run on each coin. Fundamentals is absent on purpose — it reads company financials and insider filings, and a coin has neither.",
        options: [
          { value: "market", label: "Market", help: "Price action and technical indicators." },
          { value: "social", label: "Sentiment", help: "Tone across social channels." },
          { value: "news", label: "News", help: "Headlines and macro." },
        ],
        default: ["market", "social", "news"],
      },
      {
        key: "researchDepth",
        kind: "number",
        label: "Research rounds",
        help: "Rounds of the bull/bear debate before the trader decides.",
        min: 1,
        max: 3,
        default: 1,
      },
      {
        key: "riskRounds",
        kind: "number",
        label: "Risk rounds",
        help: "Rounds of the aggressive/conservative/neutral discussion before the portfolio manager signs off.",
        min: 1,
        max: 3,
        default: 1,
      },
      // The committee. Breadboard's other trading agents sit on this desk as
      // advisers: they are asked about the market rather than about a trade, on
      // their own slow schedule, because each one is a whole cloned runtime.
      {
        key: "harmonise",
        kind: "toggle",
        label: "Weigh the advisers",
        help:
          "Reconcile the analyst team's verdict with the other advisers and the desk's own track record before acting. With this off the team's verdict is acted on directly.",
        default: true,
      },
      {
        key: "consultVibeTrading",
        kind: "toggle",
        label: "Ask Vibe Trading",
        help:
          "Have the quant research agent report what kind of market this is — trending or choppy, and whether volatility makes leverage dangerous right now.",
        default: true,
      },
      {
        key: "consultStockAnalyst",
        kind: "toggle",
        label: "Ask the Stock Analyst",
        help:
          "Have the equity analyst report on risk appetite in the stock markets. Off by default: it is a read on a different asset class, useful as background rather than as a signal.",
        default: false,
      },
      {
        key: "adviceEveryCycles",
        kind: "number",
        label: "Refresh advice every",
        help:
          "How many cycles an adviser's note is kept before it is asked again. Each consultation starts a whole cloned runtime, so this is the main thing that decides what leaving the desk running costs.",
        min: 1,
        max: 48,
        default: 8,
      },
      {
        key: "minConfidence",
        kind: "number",
        label: "Act above confidence",
        help:
          "How sure the committee has to be, as a percentage, before the desk acts on a verdict. Below it the desk holds.",
        min: 0,
        max: 100,
        default: 50,
      },
      {
        key: "maxOpenPositions",
        kind: "number",
        label: "Most positions at once",
        help: "The desk opens nothing new while it already holds this many coins.",
        min: 1,
        max: 6,
        default: 3,
      },
      {
        key: "maxDrawdown",
        kind: "number",
        label: "Stop opening below",
        help:
          "Percentage of the starting capital the desk may lose before it stops opening positions and only closes them. It keeps running, so a recovery still gets managed.",
        min: 5,
        max: 90,
        default: 25,
      },
      {
        key: "losingStreakLimit",
        kind: "number",
        label: "Losing closes before a coin is left alone",
        help:
          "After this many losing exits in a row on one coin, the desk stops opening new positions in it. Closing an existing one is always allowed.",
        min: 1,
        max: 10,
        default: 3,
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
