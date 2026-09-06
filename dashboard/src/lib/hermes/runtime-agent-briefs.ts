// What each runtime agent is for, written for the model that has to choose one.
//
// `capability-combinations.ts` describes runtime agents *mechanically* — which
// surface runs them, whether a stacked skill survives, whether a model may start
// one. That is what the app needs. It is not what a chooser needs. Rendered into
// a super-agent turn, that data produced a catalogue of bare names:
//
//     - money-printer — MoneyPrinter (/agents:money-printer)
//     - vimax — ViMax (/agents:vimax)
//
// A name is not a basis for a decision, and the two failure modes that follow are
// the ones you would predict. Agents whose purpose is legible from the name got
// launched on topic match alone — anything about markets reached a trading agent,
// whether or not the question needed one — while agents whose name says nothing
// about the job were never chosen at all, because nothing in the prompt said what
// they do. Worse, several domains here hold agents that differ only in the shape
// of their input: ViMax invents footage and MoneyPrinter cuts existing footage,
// Stock Analyst answers about named tickers and Vibe Trading about conditions,
// Get Doc fetches one publication and OpenScience runs a study across many.
// Choosing correctly between those is impossible from a name, so the choice fell
// to whichever line happened to be read first.
//
// So each agent gets two sentences: what it actually does and reaches, then the
// condition under which it is the right choice — including the nearest wrong
// reason to pick it, because the wrong reasons are what the model was acting on.
// Entries are grouped by domain so the several-agents-one-domain cases are read
// against each other rather than in isolation.
//
// This module is deliberately separate from `capability-combinations.ts` rather
// than folded into it. That module is imported by client components, so this
// prose would ship in the browser bundle of every chat page to be read by
// nothing there. It is also, unlike this, a description of the runtime rather
// than an instruction to a model.
//
// Accuracy here is load-bearing: the model cannot watch these agents run, so a
// description that overstates one buys the user a wait and nothing else. Every
// entry states only what its integration really does.

/**
 * Domains, in the order they are offered. The grouping is what lets the model
 * tell same-domain agents apart instead of taking the first plausible line.
 */
export const RUNTIME_AGENT_GROUPS = [
  { key: "code", label: "Code and repositories" },
  { key: "research", label: "Research, reading, and learning" },
  { key: "markets", label: "Markets" },
  { key: "communication", label: "Mail and social accounts" },
  { key: "fitness", label: "Fitness and training" },
  { key: "work", label: "Documents, deliverables, and long-running work" },
  { key: "design", label: "Physical design and imaging" },
  { key: "video", label: "Video" },
  { key: "operating", label: "Operating a browser or a desktop" },
] as const;

export type RuntimeAgentGroupKey = (typeof RUNTIME_AGENT_GROUPS)[number]["key"];

export interface RuntimeAgentBrief {
  group: RuntimeAgentGroupKey;
  /** What it does and what it reaches. Concrete, and only what is really built. */
  does: string;
  /**
   * When it is the right choice, and the nearest wrong reason to pick it.
   * Omitted for the form-driven agents: the model cannot start those, so it
   * needs to know what they are, not when to reach for them.
   */
  choose?: string;
}

/**
 * Keyed by `RuntimeAgentProfile.id`. Every profile belongs here, and
 * `runtime-agent-briefs.test.mjs` fails when one does not — a new agent with no
 * brief is invisible to the chooser rather than visibly broken.
 */
export const RUNTIME_AGENT_BRIEFS: Record<string, RuntimeAgentBrief> = {
  codex: {
    group: "code",
    does: "Runs the Codex CLI on the repository connected to this Garden: reads the code, edits files, runs commands, and reports what changed as a diff.",
    choose:
      "Choose it for real changes to real files — a feature, a fix, a refactor, a test run. Not for explaining code, and not when no repository is connected, where it has nothing to open.",
  },
  opencode: {
    group: "code",
    does: "The same job as Codex on the same connected repository, through a different engine, and it can carry a stacked skill, prompt, or connection into the run.",
    choose:
      "Choose it when the user asked for OpenCode by name, or when Codex has already tried this task and failed. Running both on one task duplicates the work rather than checking it.",
  },
  ruflo: {
    group: "code",
    does: "A hive-mind swarm over the connected repository: it plans the work across parallel agents, then drives Claude Code to carry each part out.",
    choose:
      "Choose it for a large change spanning many files that genuinely benefits from being decomposed first. Its coordination overhead is real, so a single-file fix belongs with Codex.",
  },

  "deep-research": {
    group: "research",
    does: "The multi-round research worker: many sources gathered, compared against each other, and cited.",
    choose:
      "The web-research section below governs this one and the two after it — read it before launching any of them.",
  },
  "max-research": {
    group: "research",
    does: "Commissions the other research agents at once — indexed web, open internet, published literature, and a workspace that can run things — then reconciles their findings into one answer and audits it against them before returning it.",
    choose:
      "For a question worth an hour: where sources are likely to disagree, where a repeated figure needs tracing to its origin, or where the web and the literature would answer differently. It runs for tens of minutes, so send anything a single search settles to Deep Research.",
  },
  "agent-reach": {
    group: "research",
    does: "Reads named places on the internet — specific sites, directories, listings — by running the upstream retrieval tools behind an allowlist and pulling structured detail out of the pages.",
    choose:
      "Depth rather than breadth: you already know where the answer lives and the work is opening it. See the web-research section below.",
  },
  "get-doc": {
    group: "research",
    does: "Finds papers and reports through open catalogs, downloads the ones that are free, and leaves each as a PDF artifact on the conversation.",
    choose:
      "Choose it when the evidence the user wants is a publication rather than a web page. It finds and fetches; surveying what a field concluded is Deep Research's work.",
  },
  "deer-flow": {
    group: "research",
    does: "Hands the request to the cloned DeerFlow harness's own lead agent, which plans a multi-step investigation across its own workers and writes a structured, sectioned report.",
    choose:
      "Choose it when that report is the deliverable. It owns its skills and its workspace, so anything stacked onto the message reaches it as prose rather than as a capability.",
  },
  openplanter: {
    group: "research",
    does: "Investigates entities across public records — corporate registries, campaign finance, lobbying disclosures, government contracts, sanctions — resolves the same entity across those datasets, and returns a knowledge graph with evidence-backed source documents.",
    choose:
      "Choose it for who-is-connected-to-whom, who owns this, follow-the-relationship questions over public filings. Ordinary web research about a company is not its work.",
  },
  "deep-tutor": {
    group: "research",
    does: "Teaches the material already in the workspace: it reads the Garden it was called on and explains, works through, and quizzes against those actual notes.",
    choose:
      "Choose it when the user wants to learn or be tested on their own material. An explanation you can simply give is not a reason to launch it.",
  },

  "vibe-trading": {
    group: "markets",
    does: "Conversational market analysis through the cloned service's own agent loop: it takes a sentence and answers about conditions, strategies, and reasoning. It reads and reports; it cannot place a trade.",
    choose:
      "Choose it for the open-ended market question. When the question names particular symbols, Stock Analyst is the closer fit.",
  },
  "stock-analyst": {
    group: "markets",
    does: "Named-equity analysis on the cloned daily-analysis backend: live quotes, K-lines, chip distribution, sector rankings, and fifteen strategy skills across six markets. It reads and reports; it cannot place a trade.",
    choose:
      "Choose it when the question is about specific tickers or a named sector. General market commentary belongs to Vibe Trading.",
  },
  "trading-agent": {
    group: "markets",
    does: "The LangGraph analyst firm — market, sentiment, news, and fundamentals specialists debate one ticker, then a risk team produces a research report. It reads and reports; it cannot place a trade.",
    choose:
      "Choose it when a named firm's analysis benefits from the full bull/bear and risk debate. Start the brief with the exchange symbol and optional ISO date, for example `NVDA 2026-08-30`; the date defaults to today.",
  },
  praxist: {
    group: "research",
    does: "Runs an already prepared Praxist task-project directory through its own multi-agent, multi-generation autonomous research-and-development loop, preserving its experiment artifacts and accepted findings.",
    choose:
      "Choose it only when the user supplied an absolute path to an existing Praxist task project with task.yaml, or explicitly asked to run the configured Praxist project. It is not a general web-research agent and cannot turn an arbitrary question into a valid measurable task project.",
  },

  "inbox-zero": {
    group: "communication",
    does: "The user's real mailbox, through the mail app's own assistant: reading, searching, drafting, sending, archiving, labelling, and standing rules.",
    choose:
      "Anything touching their mail goes here, and the email section below states that rule in full, including the one case that stays with you.",
  },
  "socials-manager": {
    group: "communication",
    does: "Runs the real Postiz stack: composes posts, schedules them onto the calendar, and publishes for real — though only to networks the user has already connected inside it, otherwise the scheduled draft stands.",
    choose:
      "Choose it when the deliverable is a scheduled or published post. Wording the user asked you for, to post themselves, is writing — do that here.",
  },

  "music-producer": {
    group: "work",
    does: "Creates original instrumental or vocal musical audio and versions changes to a track in the owning chat.",
    choose: "Choose for creating or changing musical audio using ACE-Step. Not music questions, transcription, song identification, Spotify playback or analysis-only requests. Resource2Skill handles REAPER project authoring; Music Producer returns playable audio. Setup must be explicitly performed by the user.",
  },
  "career-ops": {
    group: "work",
    does: "The job-search desk: a router over roughly eighty-four deterministic scripts with its own persistent workspace, so searches, tailored applications, and tracking accumulate across runs.",
    choose:
      "Choose it for finding roles, tailoring an application to a real posting, or anything that should build on what earlier runs stored. A CV you are simply writing is writing.",
  },

  openexecutive: {
    group: "work",
    does: "Runs the cloned OpenExecutive orchestrator: one coherent executive voice backed by strategy, finance, people, legal, operations, marketing, product, and board specialists, with private decision memory across runs.",
    choose:
      "Choose it for a consequential company decision or cross-functional operating question that benefits from several executive disciplines. A narrow factual question or ordinary writing request does not need an executive-team run.",
  },

  "open-gym": {
    group: "fitness",
    does: "Uses openGym's 1,324-exercise catalogue to plan and remember workouts, persist preferences and programs, and pair exercise-form answers with the registered animation. When delegated, that guidance and framed animation render directly without exposing the agent's run card.",
    choose:
      "Always choose it for a named exercise how-to, a full training program, or a saved-plan continuation: those need its animation catalogue or persistent state, not prose. Do not choose it for pain, injury, rehabilitation, nutrition, or a general fitness fact needing neither capability.",
  },
  openwork: {
    group: "work",
    does: "Carries out a knowledge-work task inside its own workspace, with its own installed skills, on the OpenCode engine. The message is the entire brief.",
    choose:
      "Choose it when the deliverable needs a workspace and several steps rather than one answer. A question you can answer in a paragraph does not need it.",
  },
  openscience: {
    group: "work",
    does: "A full scientific research loop with roughly two hundred and ninety skills and live scientific-database tools, working toward the goal named in the message.",
    choose:
      "Choose it for a literature-grounded study. One publication is Get Doc's job and a web survey is Deep Research's; this is for the long investigation that needs both kinds of source and its own workspace.",
  },
  resource2skill: {
    group: "work",
    does: "Produces real files through real software: web pages, PowerPoint decks, Excel workbooks, Blender scenes, and REAPER audio projects, built by distilled skills rather than described in prose.",
    choose:
      "Choose when an editable PowerPoint, spreadsheet, Blender scene, REAPER project or web page is the deliverable. Choose Music Producer for playable generated music. For an interactive slide deck presented as a link, choose Bolt Slides.",
  },
  "meeting-notes": {
    group: "work",
    does: "Reads a meeting recording and writes structured notes — summary, decisions, action items — back into this chat. Handed no file, it falls back to the newest recording already on the conversation.",
    choose:
      "Choose it when the user asks what was said, decided, or agreed in a recorded meeting. It is the one attachment-shaped agent you can launch, precisely because it can find its own recording.",
  },
  legal: {
    group: "work",
    does: "Harvey LAB's legal harness working over the documents attached to the message — review, comparison, and drafting against the actual files. The attachment tray is its input, which is why only the user can start it.",
  },
  "bolt-slides": {
    group: "work",
    does: "Plans a deck slide by slide, themes it, and compiles React source with Vite into a running web app: every slide a responsive page with click-builds, a thumbnail rail, annotation, and a synced presenter view. It returns a link and files the deck as an artifact here.",
    choose:
      "Choose it when the deck will be presented or shared as a link and the interactivity is the point — a punchline that lands on a click, a live product mock. Resource2Skill makes the .pptx; this makes the web deck.",
  },
  "gods-eye": {
    group: "research",
    does: "Aims a photorealistic live globe — aircraft, ships, satellites, earthquakes, fires, public cameras — at the place the message names, and answers with that view framed in the chat. When delegated, the framed globe renders directly without a run card.",
    choose:
      "Choose it when the user wants to see a place or the live activity over it, including a thermal or night-vision look. It shows the live world, not facts about it — routing and nearby-places questions belong to the map tools.",
  },
  classroom: {
    group: "research",
    does: "Turns a topic, or the documents attached to the message, into an interactive OpenMAIC classroom: an outline, then slides taught by an AI teacher, quizzes with grading, HTML simulations, and project work — opened as a live lesson and filed as an artifact here.",
    choose:
      "Choose it when the user wants to be taught something as a lesson — a course, a class, a walkthrough with checks on understanding — rather than told it. Deep Tutor answers questions one turn at a time; this builds the whole lesson up front.",
  },
  matraix: {
    group: "work",
    does: "Writes a questionnaire from the brief, draws a cohort from a pool of persona records on a 1,290-dimension schema, and runs each persona as its own agent — returning how the answers split, the breakdown by any dimension, and every respondent's stated reason.",
    choose:
      "Choose it when the question is what a population would say: would people pay this, which wording lands, who objects. It simulates opinion rather than finding it — for what people actually said, Deep Research reads the web.",
  },

  "hardware-blueprint": {
    group: "design",
    does: "Turns a described circuit into a real wiring blueprint — parts, pins, and nets validated by a deterministic compiler — rendered as an interactive artifact.",
    choose:
      "Choose it when the user wants electronics wired up. The pin assignments and the validation are compiled rather than guessed, which is exactly why prose from you is not a substitute.",
  },
  "parametric-cad": {
    group: "design",
    does: "Designs a manufacturable part from a brief and returns real CAD geometry, honouring a named process (--fdm, --sla, --sls) and printer bed.",
    choose:
      "Choose it when the user wants a physical part modelled or printed. A described shape is not a model.",
  },
  formsmith: {
    group: "design",
    does: "Turns one photograph into a 3D mesh through Meta's ShapeR runtime. The picture arrives through its own picker, which no model can populate.",
  },
  wardrobe: {
    group: "design",
    does: "Generates outfit images from photographs of real clothes, gated on the user's own identity photo. The photographs are the whole request, so only the user can start it.",
  },

  hyperframes: {
    group: "video",
    does: "Builds video by writing and rendering code inside a scaffolded project, which is how it produces exact motion graphics and explanatory animation.",
    choose:
      "Choose it when the content has to be precise — data, diagrams, text, timed motion. It draws; it does not film. Vox Director covers the explainer whose look matters more than its precision.",
  },
  openmontage: {
    group: "video",
    does: "Runs a whole production pipeline from one brief, with its own checkpoints and decision log that the run card reads back as it works.",
    choose:
      "Choose it for a long, multi-scene production where the pipeline's own directing decisions are wanted. Overkill for one short clip.",
  },
  vimax: {
    group: "video",
    does: "Generates a film that does not exist yet: script, shots, and generated imagery assembled into a finished video.",
    choose:
      "Choose it when the footage has to be invented and the piece is a story — characters, scenes, a screenplay. MoneyPrinter is the opposite end of the same job; Vox Director is the narrated explainer with no story in it.",
  },
  "vox-director": {
    group: "video",
    does: "Turns one topic into a narrated editorial explainer: a beat map, a torn-paper collage poster per beat, cut-out pieces animated locally, a spoken narration, and a finished MP4. Everything renders on this machine.",
    choose:
      "Choose it for a fast, narrator-led explainer with a graphic collage look — the Vox house style. ViMax is for invented cinematic footage with characters; HyperFrames is for exact, code-authored motion graphics.",
  },
  "money-printer": {
    group: "video",
    does: "Cuts existing stock footage to a script, with voiceover and subtitles, through the cloned MoneyPrinterTurbo service.",
    choose:
      "Choose it when the video is narration over illustrative footage. When the imagery itself must be invented, that is ViMax.",
  },
  shorts: {
    group: "video",
    does: "Cuts one long video into vertical short-form clips. The video is chosen in its own form, so only the user can start it.",
  },
  "video-use": {
    group: "video",
    does: "Edits a video that already exists — attached to the message, or open in the studio — by replaying an edit program against the retained original. There is no way for a model to hand it a video.",
  },

  "agent-browser": {
    group: "operating",
    does: "Drives a real browser, one page at a time, for pages that plain extraction cannot read.",
    choose:
      "The last resort, and the web-research section below states exactly when it is allowed. Never part of an opening plan.",
  },
  "agent-tars": {
    group: "operating",
    does: "Operates a real browser or the actual desktop — mouse, keyboard, windows — to carry out a task inside an application. Terminal only.",
    choose:
      "Choose it only when the work genuinely requires operating software that has no other interface. It is the slowest and most failure-prone instrument here.",
  },
};

export function runtimeAgentBrief(id: string): RuntimeAgentBrief | null {
  return RUNTIME_AGENT_BRIEFS[id] ?? null;
}
