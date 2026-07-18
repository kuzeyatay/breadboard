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
  | "memory"
  | "skill"
  | "mcp"
  | "subagent"
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
  if (name === "read") return "file_read";
  if (name === "glob" || name === "grep") return "file_search";
  if (name === "edit" || name === "write" || name === "patch" || name === "apply_patch") return "file_write";
  if (name === "task") return "subagent";
  if (name === "websearch" || name === "search") return "web_search";
  if (name === "webfetch" || name === "fetch") return "web_source";
  if (name === "skill" || name.includes("skill")) return "skill";
  if (name.startsWith("garden_")) return "garden";
  if (name.startsWith("gbrain_") || /(?:^|_)gbrain(?:_|$)/.test(name)) return "memory";
  if (name.includes("mcp")) return "mcp";
  if (name === "bash" || name === "shell") return "command";
  return "command";
}

export function activityLabelForTool(toolName: string): string {
  const kind = evidenceKindForTool(toolName);
  if (kind === "file_read") return "Reading file";
  if (kind === "file_search") return "Searching files";
  if (kind === "file_write") return "Updating files";
  if (kind === "web_search") return "Searching the web";
  if (kind === "web_source") return "Opening web source";
  if (kind === "garden") return "Consulting Garden";
  if (kind === "memory") return toolName.includes("put") || toolName.includes("write")
    ? "Saving durable memory"
    : "Consulting memory";
  if (kind === "mcp") return "Calling MCP tool";
  if (kind === "subagent") return "Running specialist";
  if (kind === "skill") return "Using skill";
  return /test/i.test(toolName) ? "Running tests" : "Running command";
}

export function assessVerification(text: string, evidence: EvidenceRecord[]): VerificationSummary {
  const normalized = text.toLowerCase();
  const successful = evidence.filter((item) => item.success);
  const unsupportedClaims: string[] = [];
  const requires = (pattern: RegExp, kinds: EvidenceKind[], label: string) => {
    if (pattern.test(normalized) && !successful.some((item) => kinds.includes(item.kind))) {
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

  const factual = /\b(found|verified|confirmed|current|latest|changed|fixed|passed|source|according to)\b/i.test(text);
  let state: VerificationState;
  if (unsupportedClaims.length) state = "contradicted";
  else if (!factual && successful.length === 0) state = "not_applicable";
  else if (successful.length === 0) state = "unverified";
  else if (evidence.some((item) => !item.success)) state = "partially_verified";
  else state = "verified";
  return { state, evidence, unsupportedClaims, assumptions: [] };
}
