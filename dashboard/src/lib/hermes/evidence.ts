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

export interface VerificationSummary {
  state: VerificationState;
  evidence: EvidenceRecord[];
  unsupportedClaims: string[];
  assumptions: string[];
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

export interface VerificationOptions {
  /**
   * Breadboard decided before dispatch that this turn needs verified map data.
   * See lib/map/grounding.ts — the decision is made from the request, so an
   * answer cannot argue its way out of needing evidence for it.
   */
  geographicGroundingRequired?: boolean;
  /** The deterministic task plan required current external evidence. */
  webGroundingRequired?: boolean;
}

export const WEB_GROUNDING_UNAVAILABLE_MESSAGE =
  "I couldn't verify this with a live web source, so I won't give you an unverified answer.";

function hasSuccessfulWebEvidence(evidence: EvidenceRecord[]): boolean {
  return evidence.some(
    (item) =>
      item.success &&
      (item.kind === "web_search" || item.kind === "web_source"),
  );
}

/** Replace a model-authored factual answer when its required web lookup failed. */
export function enforceRequiredWebEvidence(
  text: string,
  evidence: EvidenceRecord[],
  required: boolean,
): string {
  if (!required || !text.trim() || hasSuccessfulWebEvidence(evidence)) {
    return text;
  }
  return WEB_GROUNDING_UNAVAILABLE_MESSAGE;
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

  if (
    options.webGroundingRequired &&
    text.trim() &&
    text !== WEB_GROUNDING_UNAVAILABLE_MESSAGE &&
    !hasSuccessfulWebEvidence(evidence)
  ) {
    unsupportedClaims.push(
      "This request needed current web evidence, and no web tool returned a result.",
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
  if (text === WEB_GROUNDING_UNAVAILABLE_MESSAGE) state = "unverified";
  else if (unsupportedClaims.length) state = "contradicted";
  // A registry lookup with no source-bearing result is a failed grounding
  // attempt, not successful verification. Keep it visible in the evidence
  // ledger while refusing to upgrade the answer's factual status.
  else if (supporting.length === 0 && successful.length > 0) state = "unverified";
  else if (!factual && supporting.length === 0) state = "not_applicable";
  else if (supporting.length === 0) state = "unverified";
  else if (evidence.some((item) => !item.success)) state = "partially_verified";
  else state = "verified";
  return { state, evidence, unsupportedClaims, assumptions: [] };
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
