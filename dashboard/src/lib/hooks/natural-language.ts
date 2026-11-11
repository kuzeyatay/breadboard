// "when a github issue is opened, triage it" → a hook draft: which trigger,
// what to call it, and the action with the trigger clause taken back out.
//
// The sibling of src/lib/schedules/natural-language.ts, and deliberately the
// same kind of thing: a small deterministic reader whose result fills the form
// the person can see and correct, never a silent guess. Secrets are not part of
// the sentence — an external provider still asks for its token in the form.
//
// The lifecycle triggers and the matcher follow Codex's hooks
// (codex-rs/protocol/src/hooks.rs, codex-rs/hooks/src/engine/matcher.rs):
// SessionStart, UserPromptSubmit, PreToolUse, PostToolUse and Stop, each with
// a matcher where empty or "*" matches everything and anything else is a
// pattern. As in Codex, a tool trigger matches the tool's name; the chat
// triggers match the text of the turn.

/** Breadboard-owned triggers: fired by the app itself, so they have no URL. */
export const LIFECYCLE_HOOK_PROVIDERS = [
  "chat_completed",
  "session_started",
  "prompt_submitted",
  "tool_started",
  "tool_used",
] as const;

export type LifecycleHookProvider = (typeof LIFECYCLE_HOOK_PROVIDERS)[number];

export function isLifecycleHookProvider(provider: string): provider is LifecycleHookProvider {
  return (LIFECYCLE_HOOK_PROVIDERS as readonly string[]).includes(provider);
}

export const MAX_HOOK_MATCHER_LENGTH = 200;

/** Null when the pattern is usable; otherwise why it is not. */
export function hookMatcherError(pattern: unknown): string | null {
  if (pattern === undefined || pattern === null || pattern === "") return null;
  if (typeof pattern !== "string") return "A hook matcher must be text.";
  if (pattern.length > MAX_HOOK_MATCHER_LENGTH) return "This hook matcher is too long.";
  if (pattern.trim() === "*") return null;
  try {
    new RegExp(pattern, "i");
    return null;
  } catch {
    return "This hook matcher is not a valid pattern.";
  }
}

/**
 * Whether an event's text satisfies a hook's matcher. An unusable pattern
 * matches nothing: a hook that was meant to be narrow must not start firing on
 * everything because its filter broke.
 */
export function hookMatcherMatches(pattern: unknown, text: string): boolean {
  if (typeof pattern !== "string" || !pattern.trim() || pattern.trim() === "*") {
    return pattern === undefined || pattern === null || typeof pattern === "string";
  }
  if (hookMatcherError(pattern)) return false;
  // ponytail: the pattern is the hook owner's own and runs against a tool name
  // or two bounded messages; move to a linear-time engine if hooks become shared.
  return new RegExp(pattern, "i").test(text);
}

export type ParsedHookMode = "chat" | "workflow" | "command";

export interface ParsedHookRequest {
  /** A hook provider id, e.g. "chat_completed", "tool_used", "github". */
  provider: string;
  name: string;
  mode: ParsedHookMode;
  /** mode "chat": what the assistant should do; may be empty. */
  instructions: string;
  /** mode "command": the shell command, exactly as written between backticks. */
  command: string | null;
  /** mode "workflow": the workflow's name as written, to be resolved by the caller. */
  workflowName: string | null;
  /** Lifecycle triggers only: the pattern the event must match. */
  matcher: string | null;
  /** False when no trigger was recognized and the generic webhook applied. */
  recognized: boolean;
}

const TOOL_EVENT = /\btools?\b|\btool calls?\b/;
const TOOL_BEFORE = /\bbefore\b|\b(?:starts?|begins?|is about to|is called|is invoked)\b/;
const SESSION_STARTED =
  /\b(?:new\s+)?(?:chat|conversation|session)s?\b.*\b(?:start|begin|open|creat)|\b(?:start|begin|open|create)\s+(?:a\s+)?(?:new\s+)?(?:chat|conversation|session)\b/;
const PROMPT_SUBMITTED =
  /\b(?:prompt|message|question|request)s?\b.*\b(?:submit|sent|send|ask)|\bi\s+(?:send|submit|ask|type|write)\b/;
const CHAT_FINISHED =
  /\b(?:chat|conversation|answer|response|reply|turn)s?\b.*\b(?:finish|complet|end|done|answered|saved)|\b(?:you|we)\s+(?:finish|complete|end|answer)/;

// Most specific first: "merge request" must reach GitLab before the word
// "request" is read as anything else, and a named product beats a generic noun.
const PROVIDER_CUES: Array<{ provider: string; pattern: RegExp }> = [
  { provider: "gitlab", pattern: /\bgitlab\b|\bmerge request\b/ },
  { provider: "github", pattern: /\bgithub\b|\bpull request\b|\bprs?\b|\b(?:repo|repository)\b/ },
  { provider: "stripe", pattern: /\bstripe\b|\bpayments?\b|\bcharges?\b|\bsubscriptions?\b|\brefunds?\b/ },
  { provider: "slack", pattern: /\bslack\b/ },
  { provider: "linear", pattern: /\blinear\b/ },
  { provider: "telegram", pattern: /\btelegram\b/ },
  { provider: "generic", pattern: /\bwebhooks?\b|\bhttp\b|\bpost request\b|\bscript\b|\bservice\b|\bapi\b/ },
];

const TRIGGER_LEAD = String.raw`when(?:ever)?|after|before|every time|each time|once|as soon as|if|on`;
const TRIGGER_FIRST = new RegExp(
  String.raw`^(${TRIGGER_LEAD})\s+(.+?)(?:,\s*(?:then\s+)?|\s+then\s+|:\s+)(.+)$`,
  "is",
);
const TRIGGER_LAST = new RegExp(
  String.raw`^(.+?)\s+(when(?:ever)?|every time|each time|as soon as|after|before)\s+(.+)$`,
  "is",
);
const MENTIONS =
  /\b(?:mentions?|mentioning|about|containing|contains|includes|including)\s+(?:the (?:word|phrase)s?\s+)?(.+?)(?=\s+(?:finish(?:es)?|completes?|ends?|starts?|begins?|is (?:done|finished|complete|completed|answered|saved|sent|submitted))\b|$)/i;
/** "the terminal tool", "the web_search or web_extract tools". */
const NAMED_TOOLS = /\b(?:the\s+)?([a-z0-9_]+(?:(?:\s*,\s*(?:or\s+)?|\s+or\s+)[a-z0-9_]+)*)\s+tools?\b/i;
const TOOL_NOISE = new Set(["a", "an", "any", "the", "each", "every", "some", "that", "this"]);
const LEADING_NOISE =
  /^(?:please\s+)?(?:can you\s+)?(?:(?:create|make|add|set up)\s+(?:a\s+)?hook\s+(?:that|to|which|so that)?\s*)?(?:then\s+)?/i;
const BACKTICKED = /`([^`\n]+)`/;
const WORKFLOW_ACTION =
  /^(?:then\s+)?(?:please\s+)?(?:run|start|execute|trigger|launch)\s+(?:the\s+|my\s+)?(?:workflow\s+(?:called\s+|named\s+)?["“']?(.+?)["”']?|["“']?(.+?)["”']?\s+workflow)\s*\.?$/i;

function titleFrom(text: string, fallback: string): string {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (words.length === 0) return fallback;
  const title = words.slice(0, 6).join(" ");
  return `${title.charAt(0).toUpperCase()}${title.slice(1)}`.slice(0, 80);
}

function matcherFromTopic(topic: string): string | null {
  const alternatives = topic
    .replace(/["“”'‘’]/g, "")
    .split(/\s*,\s*(?:or\s+)?|\s+or\s+/i)
    .map((part) => part.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .filter((part) => part && !TOOL_NOISE.has(part.toLowerCase()));
  const matcher = alternatives.join("|");
  return matcher && matcher.length <= MAX_HOOK_MATCHER_LENGTH ? matcher : null;
}

function readTrigger(
  trigger: string,
  lead: string,
): { provider: string; matcher: string | null; recognized: boolean } {
  const lower = trigger.toLowerCase();
  if (TOOL_EVENT.test(lower)) {
    const named = NAMED_TOOLS.exec(trigger);
    return {
      provider: lead === "before" || TOOL_BEFORE.test(lower) ? "tool_started" : "tool_used",
      matcher: named ? matcherFromTopic(named[1]) : null,
      recognized: true,
    };
  }
  const topic = MENTIONS.exec(trigger);
  const matcher = topic ? matcherFromTopic(topic[1]) : null;
  if (CHAT_FINISHED.test(lower)) return { provider: "chat_completed", matcher, recognized: true };
  if (SESSION_STARTED.test(lower)) return { provider: "session_started", matcher: null, recognized: true };
  if (PROMPT_SUBMITTED.test(lower)) return { provider: "prompt_submitted", matcher, recognized: true };
  const cue = PROVIDER_CUES.find((candidate) => candidate.pattern.test(lower));
  return { provider: cue?.provider ?? "generic", matcher: null, recognized: Boolean(cue) };
}

export function parseHookRequest(input: string): ParsedHookRequest {
  const text = input.replace(/\s+/g, " ").trim().replace(LEADING_NOISE, "");
  const first = TRIGGER_FIRST.exec(text);
  const last = first ? null : TRIGGER_LAST.exec(text);
  const lead = (first?.[1] ?? last?.[2] ?? "").toLowerCase();
  const trigger = (first?.[2] ?? last?.[3] ?? text).trim();
  const action = (first?.[3] ?? last?.[1] ?? "")
    .replace(/^(?:then|please)\s+/i, "")
    .replace(/[\s,]+$/g, "")
    .trim();

  // A command is only ever what the person put between backticks: prose is
  // never promoted to something a shell will run.
  const command = BACKTICKED.exec(action)?.[1].trim() || null;
  const workflow = command ? null : WORKFLOW_ACTION.exec(action);
  const workflowName = (workflow?.[1] ?? workflow?.[2] ?? "").trim() || null;

  return {
    ...readTrigger(trigger, lead),
    name: titleFrom(trigger, "New hook"),
    mode: command ? "command" : workflowName ? "workflow" : "chat",
    instructions: command || workflowName ? "" : action,
    command,
    workflowName,
  };
}

/** The saved workflow a sentence named, or null when it is ambiguous or unknown. */
export function resolveWorkflowByName<T extends { id: string; name: string }>(
  workflowName: string | null,
  workflows: T[],
): T | null {
  const wanted = workflowName?.trim().toLowerCase();
  if (!wanted) return null;
  const exact = workflows.filter((workflow) => workflow.name.trim().toLowerCase() === wanted);
  if (exact.length === 1) return exact[0];
  const partial = workflows.filter((workflow) => workflow.name.toLowerCase().includes(wanted));
  return exact.length === 0 && partial.length === 1 ? partial[0] : null;
}

const STANDING_LEAD = /^(?:whenever|every time|each time)\b/i;
const EXPLICIT_HOOK = /^(?:please\s+)?(?:can you\s+)?(?:create|make|add|set up)\s+(?:a\s+)?hook\b/i;

/**
 * Conservative intent gate for the ordinary chat composer.
 *
 * The Hooks form can read any draft and show its assumption. A normal chat
 * must be stricter: "when you finish, summarize it" is a one-off request and
 * must still be sent as a message. Only a standing instruction ("whenever…",
 * "every time…") or an explicit "create a hook…" is diverted, and only for the
 * triggers Breadboard fires itself — a webhook needs a URL and often a secret,
 * and those belong in the form, not in a chat transcript.
 */
export function parseExplicitHookRequest(input: string): ParsedHookRequest | null {
  const text = input.replace(/```[\s\S]*?```/g, " ").replace(/\s+/g, " ").trim();
  if (!text || text.endsWith("?")) return null;
  if (!STANDING_LEAD.test(text) && !EXPLICIT_HOOK.test(text)) return null;
  const parsed = parseHookRequest(input);
  if (!parsed.recognized || !isLifecycleHookProvider(parsed.provider)) return null;
  if (!parsed.instructions && !parsed.command && !parsed.workflowName) return null;
  return parsed;
}
