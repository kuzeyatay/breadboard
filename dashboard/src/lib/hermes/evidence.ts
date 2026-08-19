import type { ResearchCoverageSummary } from "../research/session.ts";
import type { CapabilitySummary } from "./capability-usage.ts";

export type {
  CapabilityKind,
  CapabilitySelection,
  CapabilitySummary,
  CapabilityUse,
} from "./capability-usage.ts";

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

export interface EvidenceWebsite {
  url: string;
  title?: string;
  domain?: string;
  snippet?: string;
}

export interface EvidenceRecord {
  id: string;
  kind: EvidenceKind;
  title: string;
  location?: string;
  success: boolean;
  toolCallId?: string;
  timestamp: string;
  details: Record<string, unknown>;
  /** Websites / URLs visited or returned by this tool call, if any. */
  websites?: EvidenceWebsite[];
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
  /**
   * Which of the user's own capabilities — skills, connected accounts,
   * automations, Breadboard's own products — this turn actually reached for.
   * The evidence rows name tool calls; this names the things those calls belong
   * to, which is the only place a `/watch` nobody typed becomes visible.
   *
   * Optional because a summary persisted before capabilities were recorded
   * cannot honestly claim that none were used.
   */
  capabilities?: CapabilitySummary;
  /**
   * What this turn owed the web-grounding obligation, and whether it paid it.
   * Present only when the obligation was set, so a summary persisted before the
   * gate stopped substituting answers cannot claim a state nobody recorded.
   */
  webGrounding?: WebGroundingReport;
}

export function evidenceKindForTool(toolName: string): EvidenceKind {
  const raw = toolName.toLowerCase().trim();
  const name = raw.replace(/[-_]/g, "");
  // Registry discovery proves only that Breadboard inspected its capability
  // catalogue. It is not evidence for claims about the outside world. Treating
  // a successful `tool_search` as a generic command made an answer with no web
  // sources look verified merely because the model looked for a web tool.
  if (
    name === "toolsearch" ||
    name === "tooldescribe" ||
    name === "capabilitysearch"
  ) {
    return "tool_metadata";
  }
  if (name === "read" || name === "fileread" || name === "documentskillread") return "file_read";
  if (name === "glob" || name === "grep" || name === "filesearch" || name === "searchfiles") return "file_search";
  if (name === "edit" || name === "write" || name === "patch" || name === "applypatch" || name === "writefile") return "file_write";
  if (name === "task") return "subagent";
  if (name.startsWith("map")) return "map";
  if (name.startsWith("garden")) return "garden";
  if (name.startsWith("gbrain") || name.includes("gbrain") || name.startsWith("memory") || name === "savememory") return "memory";
  if (name.includes("mcp")) return "mcp";
  if (name.includes("skill") && !name.includes("read")) return "skill";
  if (
    name === "websearch" ||
    name === "websearchtool" ||
    name === "search" ||
    name === "bravesearch" ||
    name === "ddgsearch" ||
    name === "ddgssearch" ||
    name === "duckduckgosearch" ||
    name === "googlesearch" ||
    name === "tavilysearch" ||
    name === "exasearch" ||
    name === "searxngsearch" ||
    name === "parallelsearch" ||
    name === "searchweb" ||
    name === "webquery" ||
    name === "internetsearch" ||
    (name.includes("web") && name.includes("search"))
  ) {
    return "web_search";
  }
  if (
    name === "webfetch" ||
    name === "webextract" ||
    name === "webextracttool" ||
    name === "webextractstructured" ||
    name === "fetch" ||
    name === "directfetch" ||
    name === "fetchwebpage" ||
    name === "readurl" ||
    name === "fetchurl" ||
    name === "readwebpage" ||
    name === "websource" ||
    name === "webpageread" ||
    (name.includes("web") && (name.includes("extract") || name.includes("fetch")))
  ) {
    return "web_source";
  }
  if (name.startsWith("browser") || name === "browsernavigate" || name === "browserclick" || name === "browseropen") {
    return "browser";
  }
  if (name === "bash" || name === "shell" || name === "terminal" || name === "terminalexecutecommand" || name === "exec" || name === "command") {
    return "command";
  }
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
  /**
   * Reported straight through as well, and for the same reason delegation is:
   * which capability produced a result is provenance, not proof. A skill that
   * ran already put its own row in the evidence list, and counting it twice
   * would let one tool call talk its way from partially verified to verified.
   */
  capabilities?: CapabilitySummary;
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

/**
 * Panel wording for the same two states.
 *
 * Separate constants rather than a reword of the two above, which must stay
 * byte-stable: `isWebGroundingNotice` recognises answers the old substituting
 * gate already persisted by exact string, and editing them would make every
 * historical refusal look like a fresh unsourced claim. These are what the
 * evidence panel says now that the answer itself survives — they describe the
 * turn's evidence, where the old ones spoke in place of the answer.
 */
export const WEB_GROUNDING_UNVERIFIED_NOTICE =
  "This answer was not checked against a live web source.";

export const WEB_GROUNDING_LOOKUP_FAILED_NOTICE =
  "The web lookup for this answer failed, so nothing here is backed by a live source. Send the message again to retry the search.";

/** True for any text the old substituting gate wrote in place of a model answer. */
export function isWebGroundingNotice(text: string): boolean {
  return (
    text === WEB_GROUNDING_UNAVAILABLE_MESSAGE ||
    text === WEB_GROUNDING_FAILED_MESSAGE
  );
}

/**
 * Skill tools that open the very source the user pasted. A `watch_run` on a
 * video URL downloads that video; a `factcheck_run` fetches the page it is
 * checking. Each is a live retrieval of the linked source — stronger evidence
 * about it than a search snippet — so the web-grounding gate must accept them,
 * or a turn that answered from the actual video is discarded for not having
 * called a browser-shaped tool about it. (`watch_run` also runs on local
 * attachments; in that case no link set the obligation, so this widened match
 * never decides anything.)
 */
const LIVE_SOURCE_TOOLS = new Set(["watch_run", "factcheck_run"]);

function opensLiveSource(item: EvidenceRecord): boolean {
  const toolName = item.details?.["toolName"];
  return typeof toolName === "string" && LIVE_SOURCE_TOOLS.has(toolName);
}

function hasSuccessfulWebEvidence(evidence: EvidenceRecord[]): boolean {
  return evidence.some(
    (item) =>
      item.success &&
      (item.kind === "web_search" ||
        item.kind === "web_source" ||
        opensLiveSource(item)),
  );
}

function attemptedWebEvidence(evidence: EvidenceRecord[]): boolean {
  return evidence.some(
    (item) =>
      item.kind === "web_search" ||
      item.kind === "web_source" ||
      opensLiveSource(item),
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
 * What a turn owed the web-grounding obligation and did not deliver.
 *
 * `never_attempted` and `lookup_failed` are different facts about the turn and
 * the user's next move differs — retrying is worth something in the second case
 * and pointless in the first — so the panel is told which one it is.
 */
export type WebGroundingShortfall = "never_attempted" | "lookup_failed";

export interface WebGroundingReport {
  required: boolean;
  satisfied: boolean;
  shortfall?: WebGroundingShortfall;
  /** Human wording for the evidence panel. Never substituted into the answer. */
  notice?: string;
}

/**
 * Report — never repair — a required web lookup that did not happen.
 *
 * This function used to return replacement text, and the three stream call
 * sites used to assign that text over the model's answer. That was the wrong
 * remedy for a real problem. The obligation is set before dispatch by a
 * classifier that cannot read a sentence (see task-plan.ts and the decider in
 * web-grounding-decider.ts), so every classifier mistake destroyed a finished
 * answer: a blood-test report the user pasted for review was read as a request
 * for venue recommendations, and a correct 30k-token analysis was replaced with
 * "I couldn't verify this with a live web source". The user lost the turn; no
 * false claim had been prevented, because the answer made none about the world.
 *
 * Deletion was never proportionate to the risk. An unsourced claim that reaches
 * the user carrying a visible "not verified" marker is a smaller harm than a
 * sound answer the user never gets to see — and the marker already exists, in
 * `unsupportedClaims` below, which the evidence panel already renders. So the
 * answer now always survives, and this reports what the panel should say about
 * it.
 *
 * Reporting is still reserved for an answer that actually states something: see
 * `assertsExternalFact`. An answer that asserts nothing about the world cannot
 * have outrun evidence about it.
 */
export function reportWebGrounding(
  text: string,
  evidence: EvidenceRecord[],
  required: boolean,
): WebGroundingReport {
  if (!required) return { required: false, satisfied: true };
  if (hasSuccessfulWebEvidence(evidence)) {
    return { required: true, satisfied: true };
  }
  // A notice persisted by the old substituting gate, or an answer that claims
  // nothing, has nothing to flag.
  if (!text.trim() || isWebGroundingNotice(text) || !assertsExternalFact(text)) {
    return { required: true, satisfied: false };
  }
  return attemptedWebEvidence(evidence)
    ? {
        required: true,
        satisfied: false,
        shortfall: "lookup_failed",
        notice: WEB_GROUNDING_LOOKUP_FAILED_NOTICE,
      }
    : {
        required: true,
        satisfied: false,
        shortfall: "never_attempted",
        notice: WEB_GROUNDING_UNVERIFIED_NOTICE,
      };
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
  const webGrounding = reportWebGrounding(
    text,
    evidence,
    options.webGroundingRequired === true,
  );
  return {
    state,
    evidence,
    unsupportedClaims,
    assumptions: [],
    externalAgents: options.externalAgents ?? [],
    ...(webGrounding.required ? { webGrounding } : {}),
    ...(options.researchCoverage
      ? { researchCoverage: options.researchCoverage }
      : {}),
    ...(options.capabilities ? { capabilities: options.capabilities } : {}),
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

/** Returns true when a candidate string is an absolute http or https URL. */
export function isHttpUrl(candidate: unknown): boolean {
  if (typeof candidate !== "string") return false;
  const trimmed = candidate.trim();
  if (!/^https?:\/\//i.test(trimmed)) return false;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/** Extracts the clean domain from a URL (e.g. "www.example.com" -> "example.com"). */
export function extractDomain(urlStr: string): string {
  try {
    const url = new URL(urlStr.startsWith("http") ? urlStr : `https://${urlStr}`);
    return url.hostname.replace(/^www\./i, "");
  } catch {
    return "";
  }
}

/** Normalizes a website object or URL string into a well-formed EvidenceWebsite. */
export function normalizeWebsite(input: unknown): EvidenceWebsite | null {
  if (!input) return null;
  if (typeof input === "string") {
    const trimmed = input.trim();
    if (!isHttpUrl(trimmed)) return null;
    return {
      url: trimmed,
      domain: extractDomain(trimmed) || undefined,
    };
  }
  if (typeof input === "object" && input !== null) {
    const rec = input as Record<string, unknown>;
    const rawUrl =
      typeof rec.url === "string"
        ? rec.url
        : typeof rec.link === "string"
          ? rec.link
          : typeof rec.href === "string"
            ? rec.href
            : typeof rec.uri === "string"
              ? rec.uri
              : typeof rec.page_url === "string"
                ? rec.page_url
                : undefined;
    if (!rawUrl || !isHttpUrl(rawUrl)) return null;
    const url = rawUrl.trim();
    const rawTitle =
      typeof rec.title === "string"
        ? rec.title
        : typeof rec.name === "string"
          ? rec.name
          : undefined;
    const title = rawTitle?.trim() || undefined;
    const rawSnippet =
      typeof rec.snippet === "string"
        ? rec.snippet
        : typeof rec.body === "string"
          ? rec.body
          : typeof rec.description === "string"
            ? rec.description
            : undefined;
    const snippet = rawSnippet?.trim() || undefined;
    const domain =
      typeof rec.domain === "string" && rec.domain.trim()
        ? rec.domain.trim()
        : extractDomain(url) || undefined;
    return {
      url,
      ...(title ? { title } : {}),
      ...(domain ? { domain } : {}),
      ...(snippet ? { snippet } : {}),
    };
  }
  return null;
}

/**
 * Array fields that hold one search result per entry.
 *
 * `web` is the one that mattered in practice: Hermes's search tool answers
 * `{"success": true, "data": {"web": […]}}`, and with that key missing the walk
 * below reached the wrapper, found no list it recognised, and returned nothing.
 * Every row in the evidence panel could then say "did 5 searches" while naming
 * no page at all. The rest cover the other providers' spellings.
 */
const RESULT_LIST_KEYS = [
  "websites",
  "sources",
  "results",
  "web",
  "organic",
  "pages",
  "documents",
  "hits",
  "entries",
  "items",
  "citations",
  "links",
  "urls",
  "data_web",
  "search_results",
];

/** Object fields that wrap a result set rather than being one. */
const RESULT_WRAPPER_KEYS = [
  "output",
  "result",
  "content",
  "summary",
  "context",
  "response",
  "data",
  "action",
  "args",
  "payload",
  "details",
  "value",
  "raw",
  "body",
  "json",
  "searchResults",
];

/** Extracts website links from structured tool output, markdown, or JSON payloads. */
export function extractWebsitesFromPayload(payload: unknown): EvidenceWebsite[] {
  if (!payload) return [];
  const results: EvidenceWebsite[] = [];
  const seen = new Set<string>();

  const add = (site: EvidenceWebsite | null) => {
    if (!site || !site.url) return;
    const key = site.url.trim().toLowerCase().replace(/\/$/, "");
    if (seen.has(key)) {
      const existing = results.find((r) => r.url.trim().toLowerCase().replace(/\/$/, "") === key);
      if (existing) {
        if (!existing.title && site.title) existing.title = site.title;
        if (!existing.snippet && site.snippet) existing.snippet = site.snippet;
        if (!existing.domain && site.domain) existing.domain = site.domain;
      }
      return;
    }
    seen.add(key);
    results.push(site);
  };

  if (typeof payload === "string") {
    try {
      const parsed = JSON.parse(payload);
      if (parsed && typeof parsed === "object") {
        for (const site of extractWebsitesFromPayload(parsed)) add(site);
        return results;
      }
    } catch {
      // plain text or markdown
    }
    let match: RegExpExecArray | null;
    const mdRe = /\[([^\]]+)\]\((https?:\/\/[^\s\)]+)\)/g;
    while ((match = mdRe.exec(payload)) !== null) {
      add(normalizeWebsite({ url: match[2], title: match[1] }));
    }
    const urlRe = /https?:\/\/[^\s<>"')\]]+/g;
    while ((match = urlRe.exec(payload)) !== null) {
      add(normalizeWebsite(match[0]));
    }
    return results;
  }

  if (Array.isArray(payload)) {
    for (const item of payload) {
      for (const site of extractWebsitesFromPayload(item)) add(site);
    }
    return results;
  }

  if (typeof payload === "object" && payload !== null) {
    const obj = payload as Record<string, unknown>;
    const direct = normalizeWebsite(obj);
    if (direct) {
      // A object that already *is* a result — `{url, title, content}` from an
      // extract call — is a leaf. Recursing into its body text would harvest
      // every link the page happens to contain and list them as pages this
      // answer consulted, which is a claim the turn cannot support.
      add(direct);
      return results;
    }
    for (const key of RESULT_LIST_KEYS) {
      if (Array.isArray(obj[key])) {
        for (const item of obj[key] as unknown[]) {
          for (const site of extractWebsitesFromPayload(item)) add(site);
        }
      }
    }
    if (obj.action && typeof obj.action === "object") {
      const actionObj = obj.action as Record<string, unknown>;
      if (Array.isArray(actionObj.sources)) {
        for (const item of actionObj.sources) {
          for (const site of extractWebsitesFromPayload(item)) add(site);
        }
      }
    }
    for (const field of RESULT_WRAPPER_KEYS) {
      if (typeof obj[field] === "string") {
        for (const site of extractWebsitesFromPayload(obj[field])) add(site);
      } else if (typeof obj[field] === "object" && obj[field] !== null) {
        for (const site of extractWebsitesFromPayload(obj[field])) add(site);
      }
    }
  }

  return results;
}

/** Extracts the list of consulted websites from an EvidenceRecord. */
export function extractWebsitesFromEvidence(item: EvidenceRecord): EvidenceWebsite[] {
  const list: EvidenceWebsite[] = [];
  const seen = new Set<string>();

  const add = (site: EvidenceWebsite | null) => {
    if (!site || !site.url) return;
    const key = site.url.trim().toLowerCase().replace(/\/$/, "");
    if (seen.has(key)) {
      const existing = list.find((r) => r.url.trim().toLowerCase().replace(/\/$/, "") === key);
      if (existing) {
        if (!existing.title && site.title) existing.title = site.title;
        if (!existing.snippet && site.snippet) existing.snippet = site.snippet;
        if (!existing.domain && site.domain) existing.domain = site.domain;
      }
      return;
    }
    seen.add(key);
    list.push(site);
  };

  if (Array.isArray(item.websites)) {
    for (const site of item.websites) add(normalizeWebsite(site));
  }
  if (Array.isArray(item.details?.websites)) {
    for (const site of item.details.websites as unknown[]) add(normalizeWebsite(site));
  }
  if (Array.isArray(item.details?.sources)) {
    for (const site of item.details.sources as unknown[]) add(normalizeWebsite(site));
  }
  if (Array.isArray(item.details?.urls)) {
    for (const u of item.details.urls as unknown[]) add(normalizeWebsite(u));
  }
  if (typeof item.details?.url === "string") {
    add(normalizeWebsite(item.details.url));
  }
  if (typeof item.location === "string" && isHttpUrl(item.location)) {
    add(normalizeWebsite(item.location));
  }

  if (item.kind === "web_search" || item.kind === "web_source" || item.kind === "browser") {
    if (item.details) {
      for (const site of extractWebsitesFromPayload(item.details)) add(site);
    }
    if (item.title) {
      for (const site of extractWebsitesFromPayload(item.title)) add(site);
    }
  }

  return list;
}
