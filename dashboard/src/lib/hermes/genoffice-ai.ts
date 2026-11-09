export type GenOfficeAiRole = "user" | "assistant";

export interface GenOfficeAiHistoryEntry {
  role: GenOfficeAiRole;
  text: string;
}

export type GenOfficeAiActionName =
  | "insert_content"
  | "replace_blocks"
  | "apply_commands"
  | "insert_chart"
  | "edit_chart";

export interface GenOfficeAiAction {
  name: GenOfficeAiActionName;
  input: Record<string, unknown>;
}

export interface GenOfficeAiReply {
  message: string;
  actions: GenOfficeAiAction[];
}

const ACTION_NAMES = new Set<GenOfficeAiActionName>([
  "insert_content",
  "replace_blocks",
  "apply_commands",
  "insert_chart",
  "edit_chart",
]);

export const GENOFFICE_AI_LIMITS = Object.freeze({
  prompt: 8_000,
  historyEntries: 12,
  historyEntry: 4_000,
  documentContext: 16_000,
  documentHtml: 96_000,
  actions: 12,
  actionInput: 48_000,
  message: 6_000,
});

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stripJsonFence(value: string): string {
  const trimmed = value.trim();
  const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return match?.[1]?.trim() ?? trimmed;
}

function boundedText(value: unknown, limit: number): string {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

export function parseGenOfficeAiHistory(value: unknown): GenOfficeAiHistoryEntry[] {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((entry) => {
      const item = record(entry);
      const role = item?.role;
      const text = boundedText(item?.text, GENOFFICE_AI_LIMITS.historyEntry);
      return (role === "user" || role === "assistant") && text
        ? [{ role: role as GenOfficeAiRole, text }]
        : [];
    })
    .slice(-GENOFFICE_AI_LIMITS.historyEntries);
}

export function parseGenOfficeAiReply(raw: string): GenOfficeAiReply {
  const candidate = stripJsonFence(raw);
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = record(JSON.parse(candidate));
  } catch {
    // A provider that ignored JSON mode can still answer document questions.
  }

  if (!parsed) {
    const message = boundedText(candidate, GENOFFICE_AI_LIMITS.message);
    if (!message) throw new Error("Bread returned an empty reply.");
    return { message, actions: [] };
  }

  const actions = (Array.isArray(parsed.actions) ? parsed.actions : [])
    .slice(0, GENOFFICE_AI_LIMITS.actions)
    .flatMap((value) => {
      const action = record(value);
      const input = record(action?.input);
      const name = action?.name;
      if (typeof name !== "string" || !ACTION_NAMES.has(name as GenOfficeAiActionName) || !input) {
        return [];
      }
      if (JSON.stringify(input).length > GENOFFICE_AI_LIMITS.actionInput) return [];
      return [{ name: name as GenOfficeAiActionName, input }];
    });
  const message = boundedText(parsed.message, GENOFFICE_AI_LIMITS.message)
    || (actions.length > 0 ? "I prepared the requested document changes." : "");
  if (!message && actions.length === 0) throw new Error("Bread returned an empty reply.");
  return { message, actions };
}

export { GENOFFICE_AI_SYSTEM_PROMPT } from "../system-prompts/feature-defaults.ts";
