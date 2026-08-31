// The Classroom agent's chat identity: the command that reaches it, and the
// parsing of a message into a classroom request.
//
// A run turns one sentence — and whatever documents are attached to it — into
// an interactive classroom: OpenMAIC's two-stage pipeline writes a lesson
// outline, then each outline item becomes a scene (slides with narration, a
// quiz, an HTML simulation, a project-based activity) taught by its AI teacher
// and peers. The message is the brief: what to teach, to whom, and how far to
// go. The flags below are the parts of that a person may want to state exactly
// rather than leave to stored defaults — whether the slides are narrated,
// illustrated, or grounded in a web search, and whether OpenMAIC's agent mode
// generates the scenes.
//
// Imported by client components and by API routes, so it stays free of
// server-only imports.

export const CLASSROOM_COMMAND = "/agents:classroom";
export const CLASSROOM_AGENT_ID = "classroom";
export const CLASSROOM_AGENT_NAME = "Classroom";

/**
 * OpenMAIC's two generation modes. `default` runs the outline-then-scenes
 * pipeline as the web app does; `generate` hands scene generation to its agent
 * runtime, which is slower and more elaborate.
 */
export const CLASSROOM_AGENT_MODES = ["default", "generate"] as const;
export type ClassroomAgentMode = (typeof CLASSROOM_AGENT_MODES)[number];

export interface ClassroomRequest {
  /** What to teach, with every flag removed. */
  brief: string;
  /** Narrate the slides with text-to-speech. Needs a TTS provider on the runtime. */
  tts: boolean;
  /** Illustrate the slides with generated images. Needs an image provider. */
  images: boolean;
  /** Ground the outline in a web search before writing. Needs a search provider. */
  webSearch: boolean;
  agentMode: ClassroomAgentMode;
}

export type ClassroomDefaults = Partial<Omit<ClassroomRequest, "brief">>;

export const DEFAULT_CLASSROOM_REQUEST: Omit<ClassroomRequest, "brief"> = {
  tts: false,
  images: false,
  webSearch: false,
  agentMode: "default",
};

export function isClassroomAgentMode(value: unknown): value is ClassroomAgentMode {
  return (
    typeof value === "string" && (CLASSROOM_AGENT_MODES as readonly string[]).includes(value)
  );
}

export function classroomUserMessage(brief: string): string {
  const trimmed = brief.trim();
  return trimmed ? `${CLASSROOM_COMMAND} ${trimmed}` : CLASSROOM_COMMAND;
}

/**
 * Extract the brief, preserving any other slash tokens the user stacked in
 * front of the command so the capability resolver still sees them and can
 * refuse the combination in the words every surface uses.
 */
export function taskFromClassroomCommand(value: string): string | null {
  let remaining = value.trim();
  const precedingTokens: string[] = [];
  let selected = false;
  while (remaining.startsWith("/")) {
    const match = /^\/([a-z0-9][a-z0-9_.:-]*)(?:\s+|$)/i.exec(remaining);
    if (!match) break;
    if (match[1].toLowerCase() === "agents:classroom") {
      selected = true;
    } else {
      precedingTokens.push(`/${match[1]}`);
    }
    remaining = remaining.slice(match[0].length).trimStart();
  }
  if (!selected) return null;
  return [...precedingTokens, remaining].filter(Boolean).join(" ").trim();
}

/**
 * Read the flags a message may carry, and leave everything else as the brief.
 *
 * Stored preferences arrive as `defaults` and fill only what the message left
 * unsaid — a flag typed here always wins, because a preference you cannot
 * override in one message is a trap. Each toggle has both spellings for the
 * same reason: a stored "narrate everything" needs `--no-tts` to be sayable.
 */
export function parseClassroomRequest(
  message: string,
  defaults: ClassroomDefaults = {},
): ClassroomRequest {
  let tts = defaults.tts ?? DEFAULT_CLASSROOM_REQUEST.tts;
  let images = defaults.images ?? DEFAULT_CLASSROOM_REQUEST.images;
  let webSearch = defaults.webSearch ?? DEFAULT_CLASSROOM_REQUEST.webSearch;
  let agentMode: ClassroomAgentMode = defaults.agentMode ?? DEFAULT_CLASSROOM_REQUEST.agentMode;

  const brief = message
    .replace(/(^|\s)--(no-)?tts(?=\s|$)/gi, (_match, lead: string, negated?: string) => {
      tts = !negated;
      return lead;
    })
    .replace(/(^|\s)--(no-)?images(?=\s|$)/gi, (_match, lead: string, negated?: string) => {
      images = !negated;
      return lead;
    })
    .replace(/(^|\s)--(no-)?search(?=\s|$)/gi, (_match, lead: string, negated?: string) => {
      webSearch = !negated;
      return lead;
    })
    .replace(/(^|\s)--mode[= ]([a-z]+)(?=\s|$)/gi, (match, lead: string, value: string) => {
      const lowered = value.toLowerCase();
      if (!isClassroomAgentMode(lowered)) return match;
      agentMode = lowered;
      return lead;
    })
    .replace(/\s+/g, " ")
    .trim();

  return { brief: brief.slice(0, 20_000), tts, images, webSearch, agentMode };
}

/**
 * A one-line description of the request, for the run card's header. Written
 * from the request rather than the outline, so it is there before generation
 * finishes.
 */
export function describeClassroomRequest(request: Omit<ClassroomRequest, "brief">): string {
  const parts: string[] = [];
  if (request.tts) parts.push("narrated");
  if (request.images) parts.push("illustrated");
  if (request.webSearch) parts.push("web-grounded");
  if (request.agentMode === "generate") parts.push("agent mode");
  return parts.length ? parts.join(" · ") : "slides, quizzes, simulations";
}

/**
 * Where a finished classroom opens. The path is Breadboard's, not OpenMAIC's:
 * the runtime's port is chosen when it starts, so a link straight to it would
 * die with the next restart, while this route finds the running server — or
 * starts it — and redirects there. It is also what a reopened card reads back
 * out of its saved summary to show the classroom again.
 */
export function classroomOpenPath(classroomId: string): string {
  return `/api/classroom/classrooms/${encodeURIComponent(classroomId)}`;
}

const OPEN_PATH_PATTERN = /\/api\/classroom\/classrooms\/([A-Za-z0-9_-]{1,64})/;

/** The classroom a saved summary points at, if it points at one. */
export function classroomIdFromText(text: string | null | undefined): string | null {
  if (!text) return null;
  const match = OPEN_PATH_PATTERN.exec(text);
  return match ? match[1] : null;
}

export function isClassroomId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value);
}
