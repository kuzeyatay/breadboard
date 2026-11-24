// Natural-language routing of a plain chat message to a runtime agent.
//
// A runtime agent normally runs only when its slash command is typed. That made
// "can you create a slide?" a Hermes turn that improvised a .pptx while the
// Bolt Slides agent that builds real decks sat unused, and the same was true of
// every other agent. This module decides, from the request itself, when a
// message is an agent's job and returns the command text the composer would
// have sent. The chat surfaces send that, and if the agent cannot start, they
// hand the original message back to the ordinary assistant (see
// `routeNextLaunchNaturally` in use-agent-session.ts and the Garden twin).
//
// Two kinds of evidence, both read from `requestedActions` rather than raw
// text, so a word routes only when it is the object of something the person
// actually asked for. "How does Codex work?", "don't make a deck", and a pasted
// log that says "create slides" stay ordinary turns.
//
//   1. The agent is named as the instrument: "use Deer Flow to…", "…with
//      Codex". Works for every launchable agent with no per-agent rule.
//   2. The deliverable is one only an agent produces: a slide deck, a song, a
//      circuit, a scheduled LinkedIn post. These rules are deliberately narrow;
//      subjects that a skill router already owns (video, CAD, diagrams, web
//      research) are left to it, so a request is never claimed twice.
//
// Client-safe: imported by the chat surfaces.

import { BOLT_SLIDES_MIN_SLIDES } from "../bolt-slides/identity.ts";
import {
  RUNTIME_AGENT_PROFILES,
  runtimeAgentById,
  type CapabilitySurface,
  type RuntimeAgentProfile,
} from "./capability-combinations.ts";
import { actionMatches, requestedActions, requestKeywords, type RequestedAction } from "./request-language.ts";

export interface RuntimeAgentRoute {
  agentId: string;
  agentName: string;
  /** The message as the composer would send it: `<command> <brief>`. */
  commandText: string;
  /** True when the brief names no topic, so the chat's recent turns supply it. */
  needsContext: boolean;
}

interface DeliverableRule {
  id: string;
  /** Requested verbs that can introduce the deliverable. */
  verbs?: RegExp;
  /** The deliverable, matched in the action's direct object (or its whole target). */
  noun?: RegExp;
  inTarget?: boolean;
  /** An imperative or question shape the verb parser cannot see ("quiz me on"). */
  phrase?: RegExp;
  /** The rule stands down when the request also matches this. */
  unless?: RegExp;
}

const CREATE = /create|make|build|generate|design|produce|prepare|draft|write|author|compose/;
const CONVERT = /convert|transform|turn\s+(?:it\s+)?into|rewrite/;
// A deliverable noun followed by one of these is software, not the deliverable:
// "a presentation layer", "a music app".
const NOT_SOFTWARE = String.raw`(?!\s+(?:app|application|apps|player|layer|component|mode|tool|software|website|site|library|database|bot|api|class|plugin|feature|service))`;
const DECK = String.raw`(?:(?:slide|pitch|presentation)\s+deck|slide\s*show|slides?|presentation)${NOT_SOFTWARE}`;
const SOCIAL = /\b(?:twitter|x\.com|linkedin|instagram|insta|facebook|threads|bluesky|tiktok|mastodon|my\s+socials?)\b/i;

const RULES: readonly DeliverableRule[] = [
  // A named file format is Resource2Skill's: it writes the editable file.
  {
    id: "resource2skill",
    verbs: new RegExp(`${CREATE.source}|${CONVERT.source}`),
    noun: /\b(?:power\s*point|pptx|xlsx|excel\s+(?:file|workbook|sheet)|blender\s+scene|reaper\s+project)\b/i,
    inTarget: true,
  },
  {
    id: "bolt-slides",
    verbs: CREATE,
    noun: new RegExp(`\\b${DECK}\\b`, "i"),
    unless: /\b(?:pptx?|power\s*point|keynote|google\s+slides?)\b/i,
  },
  {
    id: "bolt-slides",
    verbs: CONVERT,
    noun: new RegExp(`\\binto\\s+(?:a\\s+|an\\s+|some\\s+)?(?:\\w+\\s+){0,2}${DECK}\\b|^(?:a\\s+|an\\s+|some\\s+)?(?:\\w+\\s+){0,2}${DECK}\\b`, "i"),
    inTarget: true,
    unless: /\b(?:pptx?|power\s*point|keynote|google\s+slides?)\b/i,
  },
  {
    id: "paper-orchestra",
    verbs: /write|draft|author|compose|prepare/,
    noun: /\b(?:research|academic|scientific|conference|journal)\s+paper\b/i,
  },
  {
    id: "classroom",
    verbs: CREATE,
    // Not "class": "create a class" is code far more often than teaching.
    noun: new RegExp(String.raw`\b(?:lesson|course|lecture|mini[- ]course)\b${NOT_SOFTWARE}`, "i"),
  },
  { id: "classroom", phrase: /\bteach\s+me\b[^.?!]*\bas\s+an?\s+(?:lesson|course|class)\b/i },
  {
    id: "music-producer",
    verbs: /create|make|generate|compose|produce/,
    noun: new RegExp(String.raw`\b(?:song|track|beat|melody|instrumental|jingle|soundtrack|music|tune)\b${NOT_SOFTWARE}`, "i"),
    unless: /\bplaylist\b/i,
  },
  {
    id: "hardware-blueprint",
    verbs: /design|build|make|create|wire\s+up|wire/,
    noun: /\b(?:circuit|schematic|wiring(?:\s+diagram)?|pcb|arduino|esp32|esp8266|raspberry\s+pi|microcontroller)\b/i,
  },
  {
    id: "socials-manager",
    verbs: /post|publish|schedule|tweet|share/,
    noun: SOCIAL,
    inTarget: true,
  },
  {
    id: "inbox-zero",
    verbs: /clear\s+out|organi[sz]e|sort|tidy|archive|summari[sz]e|review|read|check|triage/,
    noun: /\bmy\s+(?:inbox|e-?mails?|mail(?:box)?|gmail)\b/i,
  },
  { id: "inbox-zero", phrase: /\b(?:clean\s+up|triage|declutter|unsubscribe\s+me\s+from)\b[^.?!]*\b(?:inbox|e-?mails?|gmail|newsletters?)\b/i },
  {
    id: "stock-analyst",
    verbs: /analy[sz]e|assess|review|compare|examine/,
    noun: /\b(?:stocks?|shares|ticker)\b|\$[A-Z]{1,5}\b/,
  },
  {
    id: "career-ops",
    verbs: /find|search|look\s+for|locate/,
    // Cron, CI and print jobs are not careers; neither are "the roles of each component".
    noun: /(?<!\b(?:cron|ci|build|batch|failed|failing|running|background|scheduled|print|queued|worker)\s)\b(?:jobs?|internships?|vacanc(?:y|ies))\b|\b(?:job|remote|open|entry[- ]level|junior|senior|graduate)\s+(?:roles?|positions?|openings?)\b/i,
  },
  { id: "career-ops", phrase: /\btailor\s+(?:my\s+)?(?:cv|resume|résumé|cover\s+letter|application)\b/i },
  {
    id: "get-doc",
    verbs: /find|fetch|download|grab|look\s+up|get/,
    noun: /\b(?:the|this|that)\s+(?:\w+\s+){0,3}(?:paper|preprint|publication)\b|\barxiv\b|\bdoi\b|\b10\.\d{4,}\//i,
    inTarget: true,
  },
  // Not "create a meeting": that is a calendar invite.
  {
    id: "meeting-notes",
    verbs: /summari[sz]e|list|review|recap/,
    noun: /\b(?:the|that|this|our|my|today['’]?s|yesterday['’]?s|last)\s+(?:\w+\s+)?(?:meeting|call|standup|stand-up)\b/i,
  },
  {
    id: "meeting-notes",
    verbs: /write|draft|make|create|produce|prepare/,
    noun: /\bmeeting\s+(?:notes|minutes|summary|recap)\b/i,
  },
  { id: "meeting-notes", phrase: /\bwhat\s+(?:was|were|did\s+(?:we|they|i))\s+(?:said|decided|agreed|discussed|say|decide|agree|discuss)\b[^.?!]*\bmeeting\b/i },
  { id: "deep-research", phrase: /^(?:(?:please|can\s+you|could\s+you|would\s+you)\s+)*(?:do|run|start|kick\s+off)\s+(?:a\s+|some\s+)?deep\s+research\b/im },
  { id: "deep-tutor", phrase: /^(?:(?:please|can\s+you|could\s+you)\s+)*(?:quiz|test|drill)\s+me\s+on\b/im },
  { id: "matraix", phrase: /\bsimulate\s+(?:how|what|whether|a\s+(?:focus\s+group|survey|panel|population|poll))\b/i },
  { id: "gods-eye", phrase: /\bshow\s+me\b[^.?!]*\b(?:on\s+(?:the|a)\s+globe|from\s+(?:space|orbit)|live\s+(?:view|flights|aircraft|planes|ships)|satellite\s+view|thermal\s+view|night[- ]vision)\b/i },
  {
    id: "vox-director",
    verbs: CREATE,
    noun: /\bvox[- ]style\b|\bvox\s+(?:explainer|video)\b/i,
  },
];

const INSTRUMENT_VERBS = /use|run|launch|start|invoke|open/;

function escape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** "Bolt Slides", "bolt-slides", "boltslides" and "the Bolt Slides agent" alike. */
function namePattern(agent: RuntimeAgentProfile): string {
  // "DeerFlow" is also typed "deer flow"; split camel case before lowering.
  const spellings = new Set([agent.name, agent.id].map((value) =>
    value.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().split(/[\s'-]+/).map(escape).join("[\\s-]?"),
  ));
  return `(?:${[...spellings].join("|")})(?:\\s+agent)?`;
}

const NAMED = RUNTIME_AGENT_PROFILES.map((agent) => ({
  agent,
  asObject: new RegExp(`^(?:the\\s+)?${namePattern(agent)}\\b`, "i"),
  asInstrument: new RegExp(`\\b(?:with|using|via|through|in)\\s+(?:the\\s+)?${namePattern(agent)}\\b`, "i"),
}));

function namedAgent(action: RequestedAction): RuntimeAgentProfile | null {
  for (const entry of NAMED) {
    if (actionMatches(action, INSTRUMENT_VERBS) && entry.asObject.test(action.target)) return entry.agent;
    if (entry.asInstrument.test(action.target)) return entry.agent;
  }
  return null;
}

const FILLER_WORDS = String.raw`me|us|a|an|the|some|one|single|short|quick|simple|nice|new|for|about|on|of|from|with|into|this|that|it|these|those|above|please|now|too|again|my|our|\d+`;
const FILLER = new RegExp(`^(?:(?:${FILLER_WORDS})\\b\\s*)*$`, "i");

function topicless(target: string, noun?: RegExp): boolean {
  let rest = target.replace(/[?.!,]/g, " ");
  if (noun) rest = rest.replace(new RegExp(noun.source, noun.flags.includes("g") ? noun.flags : `${noun.flags}g`), " ");
  return FILLER.test(rest.replace(/\s+/g, " ").trim());
}

function usable(agent: RuntimeAgentProfile | null, surface: CapabilitySurface): agent is RuntimeAgentProfile {
  // Form- and attachment-driven agents (Shorts, Formsmith, Legal, Wardrobe…)
  // cannot start from a sentence; a route there would only open a dialog.
  return Boolean(agent && agent.launchableByModel && agent.surfaces.includes(surface));
}

function route(agent: RuntimeAgentProfile, text: string, needsContext: boolean, extra = ""): RuntimeAgentRoute {
  return {
    agentId: agent.id,
    agentName: agent.name,
    commandText: `${agent.command} ${text.replace(/\s+/g, " ")}${extra}`,
    needsContext,
  };
}

/** The runtime agent this message asks for, or null for an ordinary turn. */
export function runtimeAgentRoute(
  text: string,
  surface: CapabilitySurface = "dashboard_terminal",
): RuntimeAgentRoute | null {
  const trimmed = text.trim();
  if (!trimmed || trimmed.startsWith("/")) return null;
  const actions = requestedActions(trimmed);
  const keywords = requestKeywords(trimmed);

  for (const action of actions) {
    const agent = namedAgent(action);
    if (usable(agent, surface)) return route(agent, trimmed, false);
  }
  for (const rule of RULES) {
    const agent = runtimeAgentById(rule.id);
    if (!usable(agent, surface)) continue;
    if (rule.unless?.test(keywords)) continue;
    if (rule.phrase) {
      if (rule.phrase.test(keywords)) return route(agent, trimmed, false);
      continue;
    }
    for (const action of actions) {
      if (!rule.verbs || !rule.noun || !actionMatches(action, rule.verbs)) continue;
      if (!rule.noun.test(rule.inTarget ? action.target : action.object)) continue;
      const extra =
        agent.id === "bolt-slides" && /\b(?:a|one|single)\s+(?:\w+\s+)?slide\b(?!\s*(?:deck|show))/i.test(action.target)
          ? ` --slides ${BOLT_SLIDES_MIN_SLIDES}` // "a slide" is one idea; the agent's floor is a short deck.
          : "";
      return route(agent, trimmed, topicless(action.target, rule.noun), extra);
    }
  }
  return null;
}

/**
 * Give a topic-less request ("can you create a slide?") the subject the chat
 * was on. `recent` is the latest turns' text, oldest first.
 */
export function withChatContext(commandText: string, recent: readonly string[]): string {
  const context = recent
    .map((entry) => entry.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .slice(-1_500);
  return context ? `${commandText}\n\nUse what this chat was about as the topic:\n${context}` : commandText;
}
