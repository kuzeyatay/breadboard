import type { ResearchCoverageSummary } from "../research/session.ts";

export type VerificationState =
  | "verified"
  | "partially_verified"
  | "unverified"
  | "contradicted"
  | "not_applicable";

export type EvidenceKind =
  | "file_read"
  | "file_search"
  | "file_write"
  | "file_move"
  | "git"
  | "command"
  | "test"
  | "web_search"
  | "web_source"
  | "browser"
  | "garden"
  | "map"
  | "memory"
  | "skill"
  | "mcp"
  | "subagent"
  | "tool_metadata"
  | "user_provided";

export interface EvidenceRecord {
  id: string;
  kind: EvidenceKind;
  title: string;
  location?: string;
  success: boolean;
  toolCallId?: string;
  timestamp: string;
  details: Record<string, unknown>;
}

/**
 * A runtime agent (`/agents:*`) this turn handed work to. Recorded separately
 * from the evidence rows because a delegation is not a result: at the moment
 * the turn ends the run has not produced anything yet. It still belongs in the
 * ledger — "who else touched this answer" is exactly the question the evidence
 * panel exists to answer.
 */
export interface ExternalAgentCall {
  agentId: string;
  agentName: string;
  /** The slash command the surface submits, e.g. `/agents:vimax`. */
  command: string;
  /** The model's one-line reason for delegating. */
  reason?: string;
  /** The surface must confirm before this run starts. */
  requiresApproval: boolean;
  requestedAt: string;
}

export interface VerificationSummary {
  state: VerificationState;
  evidence: EvidenceRecord[];
  unsupportedClaims: string[];
  assumptions: string[];
  /**
   * Optional because summaries persisted before external agents were recorded
   * do not carry the field, and an old message must still open its panel.
   */
  externalAgents?: ExternalAgentCall[];
  /**
   * How much of the requested research space this turn actually settled.
   * Present only for a turn that ran the tracked pipeline; absent everywhere
   * else, including on summaries persisted before it existed.
   */
  researchCoverage?: ResearchCoverageSummary;
}

export function evidenceKindForTool(toolName: string): EvidenceKind {
  const name = toolName.toLowerCase();
  // Registry discovery proves only that Breadboard inspected its capability
  // catalogue. It is not evidence for claims about the outside world. Treating
  // a successful `tool_search` as a generic command made an answer with no web
  // sources look verified merely because the model looked for a web tool.
  if (
    name === "tool_search" ||
    name === "tool_describe" ||
    name === "capability_search"
  ) {
    return "tool_metadata";
  }
  if (name === "read") return "file_read";
  if (name === "glob" || name === "grep") return "file_search";
  if (name === "edit" || name === "write" || name === "patch" || name === "apply_patch") return "file_write";
  if (name === "task") return "subagent";
  if (name === "websearch" || name === "web_search" || name === "search") {
    return "web_search";
  }
  if (
    name === "webfetch" ||
    name === "web_extract" ||
    name === "web_extract_structured" ||
    name === "fetch"
  ) {
    return "web_source";
  }
  // Opening a chapter of a distilled document is evidence about a document the
  // user supplied, not about a skill the agent chose to load — it has to count
  // as a source read, or an answer grounded in the document reads as ungrounded.
  if (name === "document_skill_read") return "file_read";
  // Map tools are their own evidence class. Folding them into "command" would
  // let a shell invocation stand in for a verified geographic fact, which is
  // precisely the substitution the map grounding rules exist to prevent.
  if (name.startsWith("map_")) return "map";
  if (name === "skill" || name.includes("skill")) return "skill";
  if (name.startsWith("garden_")) return "garden";
  if (name === "save_memory" || name.startsWith("memory_")) return "memory";
  if (name.startsWith("gbrain_") || /(?:^|_)gbrain(?:_|$)/.test(name)) return "memory";
  if (name.includes("mcp")) return "mcp";
  if (name === "bash" || name === "shell") return "command";
  return "command";
}

export function activityLabelForTool(toolName: string): string {
  if (toolName === "artifact_image_generate") return "Generating image";
  if (toolName === "document_skill_read") return "Reading the document";
  const kind = evidenceKindForTool(toolName);
  if (kind === "file_read") return "Reading file";
  if (kind === "file_search") return "Searching files";
  if (kind === "file_write") return "Updating files";
  if (kind === "web_search") return "Searching the web";
  if (kind === "web_source") return "Opening web source";
  if (kind === "garden") return "Consulting Garden";
  if (kind === "map") return "Checking the map";
  if (kind === "memory") return toolName === "save_memory" ||
    toolName.includes("put") ||
    toolName.includes("write") ||
    toolName.includes("save")
    ? "Saving durable memory"
    : "Consulting memory";
  if (kind === "mcp") return "Calling MCP tool";
  if (kind === "subagent") return "Running specialist";
  if (kind === "skill") return "Using skill";
  if (kind === "tool_metadata") return "Inspecting capabilities";
  return /test/i.test(toolName) ? "Running tests" : "Running command";
}

/**
 * The title an evidence row carries for one tool call.
 *
 * The runtime writes a summary for a tool that got far enough to produce one
 * ("Did 10 searches in 5.0s"). A tool that failed before that has nothing but
 * its internal name, and a bare `web_search` sitting in the ledger reads as a
 * leaked identifier rather than a record of what was attempted. Fall back to
 * the same phrasing the activity list already uses, so a failed row says which
 * action failed instead of naming a function.
 */
export function evidenceTitleForTool(
  toolName: string,
  summary?: string,
): string {
  const written = summary?.trim();
  return written || activityLabelForTool(toolName);
}

export interface VerificationOptions {
  /**
   * Breadboard decided before dispatch that this turn needs verified map data.
   * See lib/map/grounding.ts — the decision is made from the request, so an
   * answer cannot argue its way out of needing evidence for it.
   */
  geographicGroundingRequired?: boolean;
  /** The deterministic task plan required current external evidence. */
  webGroundingRequired?: boolean;
  /**
   * Runtime agents this turn delegated to. Reported in the summary, and
   * deliberately kept out of the state calculation below: a queued run is not
   * a result, so it must neither support nor undermine the answer's standing.
   */
  externalAgents?: ExternalAgentCall[];
  /**
   * The research pipeline's verdict on non-publication claims for this turn.
   * See `researchExhaustion` below and lib/research/coverage.ts.
   */
  researchExhaustion?: ResearchExhaustion;
  /** Reported straight through to the summary; never affects the verdict. */
  researchCoverage?: ResearchCoverageSummary;
}

/**
 * What a tracked research session actually proved about absence.
 *
 * The answer being guarded against is the confident one: "that team's member
 * count isn't published anywhere". It usually is — on a page nobody opened,
 * under a name nobody searched. Saying so without having searched to exhaustion
 * is a factual claim about the world made from the absence of effort, which is
 * exactly the class of statement the rest of this module refuses to let through.
 *
 * `active` is false when no research session ran, in which case the check is
 * skipped entirely rather than guessed at.
 */
export interface ResearchExhaustion {
  active: boolean;
  /** Field labels whose diversified search strategies were genuinely spent. */
  exhaustedFields: string[];
  /** True once the coverage ledger allowed the session to stop. */
  stopped: boolean;
}

/**
 * Wording that asserts something is absent from the public record.
 *
 * Kept narrower than "I couldn't find it" on purpose: reporting a personal
 * failure to find something is honest and always allowed. Declaring that the
 * thing does not exist publicly is the stronger claim, and the one that needs
 * proof. "Available" only counts when it is qualified as *publicly* available —
 * a bare "the source is not available to me right now" is a tool failure being
 * reported, which is the behaviour this file exists to encourage.
 */
const NON_PUBLICATION_CLAIM = new RegExp(
  [
    /(?:is|are|was|were) not (?:publicly |publically )?(?:published|documented|disclosed|listed|recorded)\b/
      .source,
    /(?:isn't|aren't|wasn't|weren't) (?:publicly |publically )?(?:published|documented|disclosed|listed)\b/
      .source,
    /(?:is|are|was|were) not (?:publicly|publically) available\b/.source,
    /(?:isn't|aren't|wasn't|weren't) (?:publicly|publically) available\b/.source,
    /no (?:public|published|official) (?:record|figure|number|listing|data|source)\b/.source,
    /not (?:in the )?public(?:ly available)? record\b/.source,
    /never (?:published|disclosed)\b/.source,
    /nowhere (?:to be found|published)\b/.source,
    /does not (?:appear to )?exist publicly\b/.source,
  ].join("|"),
  "i",
);

export const WEB_GROUNDING_UNAVAILABLE_MESSAGE =
  "I couldn't verify this with a live web source, so I won't give you an unverified answer.";

/**
 * Wording for a lookup that was actually attempted and came back failing.
 * That is a different fact about the turn than never having looked, and the
 * user's next move differs too — retrying is worth something here and is
 * pointless in the other case — so it does not share the message above.
 */
export const WEB_GROUNDING_FAILED_MESSAGE =
  "My web lookup for this failed, so I don't have a live source to stand behind an answer. Send the message again to retry the search.";

/** True for any text this module substituted in place of a model answer. */
export function isWebGroundingNotice(text: string): boolean {
  return (
    text === WEB_GROUNDING_UNAVAILABLE_MESSAGE ||
    text === WEB_GROUNDING_FAILED_MESSAGE
  );
}

function hasSuccessfulWebEvidence(evidence: EvidenceRecord[]): boolean {
  return evidence.some(
    (item) =>
      item.success &&
      (item.kind === "web_search" || item.kind === "web_source"),
  );
}

function attemptedWebEvidence(evidence: EvidenceRecord[]): boolean {
  return evidence.some(
    (item) => item.kind === "web_search" || item.kind === "web_source",
  );
}

/** Naive sentence split. The gate only needs to know whether any span survives. */
function sentenceSpans(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** Openers, acknowledgements and sign-offs — sociable, but claims about nothing. */
const CONVERSATIONAL_SENTENCE =
  /^(?:hi|hey|hello|yo|greetings|good\s+(?:morning|afternoon|evening)|thanks|thank\s+you|cheers|sure|of\s+course|absolutely|okay|ok|got\s+it|understood|no\s+problem|you'?re\s+welcome|happy\s+to\s+help|glad\s+to\s+help|welcome\s+back)\b/i;

/** A sentence whose subject is the assistant rather than the world. */
const FIRST_PERSON_SENTENCE =
  /^(?:i\b|i'(?:m|ll|ve|d)\b|my\b|let\s+me\b|let'?s\b|here'?s\s+what\s+i\b)/i;

/**
 * Something a live source would have to settle: a currency marker, an
 * attribution, or a concrete figure. Used only to decide that a sentence about
 * the assistant is *also* a claim about the world — "I'm your assistant" is not,
 * "I found the price is $12" is.
 */
const EXTERNAL_CLAIM_MARKER =
  /\b(?:as\s+of|according\s+to|currently|current|today|tonight|tomorrow|this\s+(?:week|month|year)|latest|newest|most\s+recent|right\s+now|prices?|costs?|version\s+\d|released?|announced|launched|reported)\b|[$€£]\s?\d|\b\d{4}\b/i;

/**
 * The assistant reporting its own limits. Checked before the marker above
 * because a currency word inside one of these ("I can't reach that service
 * right now") describes the failure, not a fact being asserted through it —
 * and withholding an admission of failure is the one substitution that can
 * never improve the answer.
 */
const ASSISTANT_LIMITATION =
  /\b(?:couldn'?t|could\s+not|can'?t|cannot|unable|not\s+able|don'?t\s+have|do\s+not\s+have|didn'?t\s+find|did\s+not\s+find|no\s+luck|failed\s+to)\b/i;

/**
 * Does this answer assert anything a live web source would have to support?
 *
 * The gate below exists to stop an *unsourced factual claim* reaching the user,
 * not to stop the turn. A greeting, a clarifying question, a status note, or an
 * admission that nothing was found asserts nothing about the world, so replacing
 * one with a refusal deletes a good answer and puts an error in its place — with
 * no claim having been prevented, because there was no claim.
 *
 * This matters well beyond greetings. The planner's web signal fires on bare
 * words like "latest", "current", "news" and "research" (see task-plan.ts), so
 * "what's the current implementation of X" is routinely planned as a web turn.
 * Judging the answer instead of the question is what keeps that misread cheap:
 * the worst case becomes an unnecessary evidence-panel warning rather than a
 * destroyed reply.
 */
export function assertsExternalFact(text: string): boolean {
  return sentenceSpans(text).some((sentence) => {
    if (sentence.endsWith("?")) return false;
    if (CONVERSATIONAL_SENTENCE.test(sentence)) return false;
    if (FIRST_PERSON_SENTENCE.test(sentence)) {
      if (ASSISTANT_LIMITATION.test(sentence)) return false;
      if (!EXTERNAL_CLAIM_MARKER.test(sentence)) return false;
    }
    return true;
  });
}

/**
 * Replace a model-authored factual answer when its required web lookup failed.
 *
 * Withholding is reserved for an answer that actually states something: see
 * `assertsExternalFact`. Everything else is returned untouched and left to the
 * verification summary, which records the missing evidence without throwing the
 * turn away.
 */
export function enforceRequiredWebEvidence(
  text: string,
  evidence: EvidenceRecord[],
  required: boolean,
): string {
  if (!required || !text.trim() || hasSuccessfulWebEvidence(evidence)) {
    return text;
  }
  if (isWebGroundingNotice(text) || !assertsExternalFact(text)) return text;
  return attemptedWebEvidence(evidence)
    ? WEB_GROUNDING_FAILED_MESSAGE
    : WEB_GROUNDING_UNAVAILABLE_MESSAGE;
}

export function assessVerification(
  text: string,
  evidence: EvidenceRecord[],
  options: VerificationOptions = {},
): VerificationSummary {
  const normalized = text.toLowerCase();
  const successful = evidence.filter((item) => item.success);
  const supporting = successful.filter((item) => item.kind !== "tool_metadata");
  const unsupportedClaims: string[] = [];
  const requires = (pattern: RegExp, kinds: EvidenceKind[], label: string) => {
    if (pattern.test(normalized) && !supporting.some((item) => kinds.includes(item.kind))) {
      unsupportedClaims.push(label);
    }
  };
  requires(/\b(i searched|searched) (?:the )?web\b/, ["web_search"], "Web-search claim has no successful web-search evidence.");
  requires(/\b(i opened|opened) (?:the )?(?:page|url|site)\b/, ["web_source", "browser"], "Page-open claim has no successful fetch/browser evidence.");
  requires(/\b(i read|read) (?:the )?file\b/, ["file_read"], "File-read claim has no successful file-read evidence.");
  requires(/\b(i changed|changed|updated|fixed) (?:the )?(?:file|code|implementation)\b/, ["file_write"], "Change claim has no successful write evidence.");
  requires(/\btests? (?:pass|passed|are passing)\b/, ["test"], "Passing-test claim has no successful test evidence.");
  requires(/\b(i remember|remembered|from memory)\b/, ["memory", "user_provided"], "Memory claim has no successful retrieval evidence.");
  requires(/\b(saved|wrote|stored).{0,24}\bmemory\b/, ["memory"], "Memory-write claim has no successful memory evidence.");
  requires(/\bgbrain is (?:connected|integrated)\b/, ["memory"], "GBrain status claim has no successful GBrain evidence.");
  requires(
    /\b(?:academic|scholarly|peer-reviewed)\s+(?:references?|sources?|citations?)\b|\bdoi\s+links?\b|\baccording to\b/,
    ["garden", "web_search", "web_source", "user_provided"],
    "Source-backed claim has no successful Garden, web, or user-provided evidence.",
  );

  // Held to the same standard as the withholding gate above: an answer that
  // asserts nothing about the world cannot have made an unsupported claim about
  // it, and reporting one for a greeting or a clarifying question mislabels a
  // sound turn as contradicted.
  if (
    options.webGroundingRequired &&
    text.trim() &&
    !isWebGroundingNotice(text) &&
    assertsExternalFact(text) &&
    !hasSuccessfulWebEvidence(evidence)
  ) {
    unsupportedClaims.push(
      "This request needed current web evidence, and no web tool returned a result.",
    );
  }

  // Absence is a claim like any other. A research session that never reached an
  // exhausted gap has established that this answer did not find something —
  // which is not the same statement as the thing not being published, and only
  // the ledger can tell the two apart.
  const research = options.researchExhaustion;
  if (
    research?.active &&
    text.trim() &&
    NON_PUBLICATION_CLAIM.test(text) &&
    research.exhaustedFields.length === 0
  ) {
    unsupportedClaims.push(
      "The answer states something is not publicly available, but no research gap was searched to exhaustion — report it as not established instead.",
    );
  }

  // Geographic claims are checked against successful map evidence specifically:
  // a Garden page or a web page that happens to mention a place is not a
  // verified distance, and neither is a memory of one.
  const mapEvidence = supporting.filter((item) => item.kind === "map");
  if (!mapEvidence.length) {
    for (const { pattern, claim } of geographicClaimRules()) {
      if (pattern.test(text) && !unsupportedClaims.includes(claim)) {
        unsupportedClaims.push(claim);
      }
    }
    if (options.geographicGroundingRequired && text.trim() && !unsupportedClaims.length) {
      unsupportedClaims.push(
        "This request needed verified map data, and no map tool returned a result.",
      );
    }
  }

  const factual = /\b(found|verified|confirmed|current|latest|changed|fixed|passed|source|according to)\b/i.test(text);
  let state: VerificationState;
  if (isWebGroundingNotice(text)) state = "unverified";
  else if (unsupportedClaims.length) state = "contradicted";
  // A registry lookup with no source-bearing result is a failed grounding
  // attempt, not successful verification. Keep it visible in the evidence
  // ledger while refusing to upgrade the answer's factual status.
  else if (supporting.length === 0 && successful.length > 0) state = "unverified";
  else if (!factual && supporting.length === 0) state = "not_applicable";
  else if (supporting.length === 0) state = "unverified";
  else if (evidence.some((item) => !item.success)) state = "partially_verified";
  else state = "verified";
  return {
    state,
    evidence,
    unsupportedClaims,
    assumptions: [],
    externalAgents: options.externalAgents ?? [],
    ...(options.researchCoverage
      ? { researchCoverage: options.researchCoverage }
      : {}),
  };
}

/**
 * Sentences that assert a particular real place's geography. Each is a claim
 * whose only honest source is a map-tool result, so matching one with no
 * successful map evidence behind it is reported rather than tolerated.
 *
 * Kept beside the other `requires` rules above, in the same shape, because it
 * is the same idea: the answer may not out-run the evidence.
 */
function geographicClaimRules(): { pattern: RegExp; claim: string }[] {
  return [
    {
      pattern:
        /\b\d+(?:[.,]\d+)?\s?(?:km|kilometres?|kilometers?|miles?|metres?|meters?|m)\b[^.\n]{0,60}\b(?:away|from|to|walk\w*|driv\w*|cycl\w*|apart|on foot|by car|by bike|journey|trip)\b/i,
      claim: "Distance claim has no successful map-service result.",
    },
    {
      pattern:
        /\b(?:about|roughly|around|approximately|takes?|it'?s)\b[^.\n]{0,30}\b\d+\s?(?:minutes?|min|hours?|hrs?)\b[^.\n]{0,40}\b(?:walk|on foot|drive|driving|cycle|cycling|away|to get)\b/i,
      claim: "Travel-time claim has no successful routing result.",
    },
    {
      pattern: /\b(?:the address is|located at|situated at)\b\s+\S/i,
      claim: "Address claim has no successful map-service result.",
    },
    {
      pattern: /\b(?:coordinates?|latitude|longitude)\b[^.\n]{0,20}-?\d/i,
      claim: "Coordinate claim has no successful map-service result.",
    },
    {
      pattern: /\b(?:opens? at|closes? at|open from|opening hours are)\b/i,
      claim: "Opening-hours claim has no successful place-details result.",
    },
    {
      pattern: /\b(?:the nearest|the closest)\b[^.\n]{0,40}\b(?:is|are)\b/i,
      claim: "Nearest-place claim has no successful POI result.",
    },
  ];
}
