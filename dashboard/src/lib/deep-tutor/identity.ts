// The Deep Tutor agent's chat identity: the slash command that activates it,
// and the parsing of a prompt into a tutoring request.
//
// Deep Tutor is the cloned HKUDS/DeepTutor running for real — a tutor with
// several capabilities (explain, solve, quiz, research, visualize, animate,
// mastery path) rather than a single-shot answerer. Which one runs is an inline
// flag, so chat stays the only surface, exactly as it is for the other runtime
// agents.
//
// What makes it a *tutor over your own material* is the scope: in a Garden it
// reads that Garden, in the Terminal it reads the workspace. That decision is
// made server-side from the surface (see `materials.ts`) and is deliberately
// not something a message can widen.
//
// Imported by client components and by API routes, so it stays free of
// server-only imports.

export const DEEP_TUTOR_COMMAND = "/agents:deep-tutor";
export const DEEP_TUTOR_AGENT_ID = "deep-tutor";
export const DEEP_TUTOR_AGENT_NAME = "Deep Tutor";

/**
 * The capabilities the clone exposes through its turn runtime. These are
 * DeepTutor's own names — the bridge passes them straight through to
 * `TurnRequest.capability`, and an unknown one is rejected there rather than
 * silently downgraded.
 */
export const TUTOR_CAPABILITIES = [
  "chat",
  "deep_solve",
  "deep_question",
  "deep_research",
  "visualize",
  "math_animator",
  "mastery_path",
] as const;

export type TutorCapability = (typeof TUTOR_CAPABILITIES)[number];

/** What each capability is called in the card, and what it does. */
export const TUTOR_CAPABILITY_LABELS: Record<TutorCapability, string> = {
  chat: "Tutoring",
  deep_solve: "Deep solve",
  deep_question: "Quiz",
  deep_research: "Deep research",
  visualize: "Visualize",
  math_animator: "Math animation",
  mastery_path: "Mastery path",
};

/**
 * The flag that selects each capability. `--cap <name>` also works and is what
 * the settings dialog writes, but a word beats an enum in a chat box.
 */
const CAPABILITY_FLAGS: Array<[RegExp, TutorCapability]> = [
  [/(?:^|\s)--(?:solve|deep-solve)\b/i, "deep_solve"],
  [/(?:^|\s)--(?:quiz|questions?|deep-question)\b/i, "deep_question"],
  [/(?:^|\s)--(?:research|deep-research)\b/i, "deep_research"],
  [/(?:^|\s)--(?:visuali[sz]e|plot|chart)\b/i, "visualize"],
  [/(?:^|\s)--(?:animate|animation|manim)\b/i, "math_animator"],
  [/(?:^|\s)--(?:mastery|path)\b/i, "mastery_path"],
  [/(?:^|\s)--(?:chat|explain|teach)\b/i, "chat"],
];

/** Tools the user can turn on for a turn. The rest mount from context. */
export const TUTOR_OPTIONAL_TOOLS = [
  "web_search",
  "paper_search",
  "brainstorm",
  "reason",
] as const;

export type TutorOptionalTool = (typeof TUTOR_OPTIONAL_TOOLS)[number];

export const DEFAULT_QUESTION_COUNT = 5;
export const MAX_QUESTION_COUNT = 20;

export interface TutorRequest {
  /** What the learner asked, with every flag removed. */
  message: string;
  capability: TutorCapability;
  /** Tools switched on for this turn, beyond what context mounts. */
  tools: TutorOptionalTool[];
  /** Start a new tutoring session instead of continuing this scope's one. */
  fresh: boolean;
  /**
   * Read the material before answering. On by default: a tutor that ignores
   * your notes is just a chatbot. `--no-material` turns it off for a question
   * that is plainly general knowledge.
   */
  useMaterial: boolean;
  /** Only meaningful for `deep_question`. */
  questionCount: number;
  language: string;
}

export function deepTutorUserMessage(task: string): string {
  const trimmed = task.trim();
  return trimmed ? `${DEEP_TUTOR_COMMAND} ${trimmed}` : DEEP_TUTOR_COMMAND;
}

export function taskFromDeepTutorCommand(value: string): string | null {
  const match = value.trimStart().match(/^\/agents:deep-tutor(?:\s+|$)/i);
  if (!match) return null;
  return value.trimStart().slice(match[0].length).trim();
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

function isCapability(value: string): value is TutorCapability {
  return (TUTOR_CAPABILITIES as readonly string[]).includes(value);
}

function isOptionalTool(value: string): value is TutorOptionalTool {
  return (TUTOR_OPTIONAL_TOOLS as readonly string[]).includes(value);
}

/**
 * Split a prompt into the question itself and the shape of the turn.
 *
 * `defaults` is where the request starts before any flag is read — the user's
 * saved settings, when the caller has them. A flag in the message still wins,
 * which is the whole precedence rule and the same one every other agent here
 * follows.
 */
export function parseTutorRequest(
  task: string,
  defaults?: Partial<Omit<TutorRequest, "message">>,
): TutorRequest {
  let capability: TutorCapability = defaults?.capability ?? "chat";
  const tools = new Set<TutorOptionalTool>(defaults?.tools ?? []);
  let fresh = defaults?.fresh ?? false;
  let useMaterial = defaults?.useMaterial ?? true;
  let questionCount = clamp(
    defaults?.questionCount ?? DEFAULT_QUESTION_COUNT,
    1,
    MAX_QUESTION_COUNT,
  );
  let language = defaults?.language ?? "en";

  let message = task;

  message = message.replace(/(?:^|\s)--cap(?:ability)?[= ]([a-z_]+)\b/gi, (_match, value: string) => {
    const requested = value.trim().toLowerCase();
    if (isCapability(requested)) capability = requested;
    return " ";
  });
  for (const [pattern, name] of CAPABILITY_FLAGS) {
    const flagged = new RegExp(pattern.source, "gi");
    if (flagged.test(message)) {
      capability = name;
      message = message.replace(new RegExp(pattern.source, "gi"), " ");
    }
  }

  message = message
    .replace(/(?:^|\s)--tool[= ]([a-z_,\s]+?)(?=\s--|\s*$)/gi, (_match, value: string) => {
      for (const entry of value.split(/[,\s]+/)) {
        const name = entry.trim().toLowerCase();
        if (isOptionalTool(name)) tools.add(name);
      }
      return " ";
    })
    .replace(/(?:^|\s)--web\b/gi, () => {
      tools.add("web_search");
      return " ";
    })
    .replace(/(?:^|\s)--papers?\b/gi, () => {
      tools.add("paper_search");
      return " ";
    })
    .replace(/(?:^|\s)--(?:fresh|new)\b/gi, () => {
      fresh = true;
      return " ";
    })
    .replace(/(?:^|\s)--no-material\b/gi, () => {
      useMaterial = false;
      return " ";
    })
    .replace(/(?:^|\s)--material\b/gi, () => {
      useMaterial = true;
      return " ";
    })
    .replace(/(?:^|\s)(?:--count|-n)[= ](\d{1,2})\b/gi, (_match, value: string) => {
      questionCount = clamp(Number(value), 1, MAX_QUESTION_COUNT);
      return " ";
    })
    .replace(/(?:^|\s)--lang(?:uage)?[= ]([a-z]{2}(?:-[a-zA-Z]{2})?)\b/gi, (_match, value: string) => {
      language = value.toLowerCase();
      return " ";
    })
    .replace(/\s+/g, " ")
    .trim();

  return {
    message,
    capability,
    tools: [...tools],
    fresh,
    useMaterial,
    questionCount,
    language,
  };
}

/** The one-line label the card shows while the turn runs. */
export function tutorRunLabel(request: TutorRequest): string {
  const capability = TUTOR_CAPABILITY_LABELS[request.capability];
  const subject = request.message.length > 60
    ? `${request.message.slice(0, 59).trimEnd()}…`
    : request.message;
  return subject ? `${capability} · ${subject}` : capability;
}
