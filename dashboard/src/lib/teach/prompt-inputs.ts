// Turns the small, human instruction attached to a chat-triggered workflow run
// into the named inputs learned during the demonstration.
//
// This is deliberately a bounded parser rather than a general-purpose prompt
// interpreter: it may fill only inputs the compiled procedure already declares.
// A sentence cannot add steps, relax an approval boundary, or otherwise rewrite
// the learned procedure.

import type { WorkflowInput } from "./types.ts";

export interface ParsedWorkflowInputs {
  inputs: Record<string, string>;
  missingRequired: WorkflowInput[];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizedWords(value: string): string {
  return value
    .replace(/_/gu, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .toLocaleLowerCase();
}

function aliasesByInput(definitions: WorkflowInput[]): Map<string, string[]> {
  const tokenOwners = new Map<string, Set<string>>();
  for (const definition of definitions) {
    const fullAliases = [normalizedWords(definition.label), normalizedWords(definition.name)];
    for (const alias of fullAliases) {
      for (const token of alias.split(/\s+/u).filter((part) => part.length >= 3)) {
        const owners = tokenOwners.get(token) ?? new Set<string>();
        owners.add(definition.name);
        tokenOwners.set(token, owners);
      }
    }
  }

  return new Map(
    definitions.map((definition) => {
      const aliases = new Set<string>([
        normalizedWords(definition.label),
        normalizedWords(definition.name),
      ]);
      for (const alias of [...aliases]) {
        for (const token of alias.split(/\s+/u)) {
          if (token.length >= 3 && tokenOwners.get(token)?.size === 1) aliases.add(token);
        }
      }
      return [
        definition.name,
        [...aliases].filter(Boolean).sort((left, right) => right.length - left.length),
      ];
    }),
  );
}

function unwrapValue(value: string): string {
  let result = value.trim();
  const quoted = result.match(/^(?:"([\s\S]*)"|'([\s\S]*)')$/u);
  if (quoted) result = quoted[1] ?? quoted[2] ?? "";
  return result.replace(/[\s.!?]+$/u, "").trim();
}

function capturedValue(match: RegExpMatchArray | null): string | null {
  if (!match) return null;
  const value = unwrapValue(match[1] ?? match[2] ?? match[3] ?? "");
  return value || null;
}

function valuePattern(nextAssignment: string): string {
  return `(?:"([^"]+)"|'([^']+)'|(.+?))(?=\\s+(?:and|then)\\s+(?:(?:change|set|update|replace|make)\\s+)?(?:the\\s+)?(?:${nextAssignment})\\b|[,;]|$)`;
}

/**
 * Parse phrases such as:
 *
 * - "change the name entered to Mike"
 * - "use Mike for customer name"
 * - "with customer name: Mike"
 *
 * Only declared input names are returned. Ambiguous shorthand (for example
 * "name" when both first_name and last_name exist) is intentionally ignored.
 */
export function parseWorkflowInputPrompt(
  definitions: WorkflowInput[],
  prompt: string,
): ParsedWorkflowInputs {
  const text = prompt.trim();
  const aliases = aliasesByInput(definitions);
  const everyAlias = [...aliases.values()]
    .flat()
    .sort((left, right) => right.length - left.length)
    .map(escapeRegExp)
    .join("|") || "(?!)";
  const values: Record<string, string> = {};

  for (const definition of definitions) {
    const inputAliases = aliases.get(definition.name) ?? [];
    const aliasPattern = inputAliases.map(escapeRegExp).join("|");
    if (!aliasPattern || !text) continue;
    const value = valuePattern(everyAlias);

    const afterLabel = text.match(
      new RegExp(
        `(?:change|set|update|replace|make|enter|type|use)?\\s*(?:the\\s+)?(?:${aliasPattern})(?:\\s+(?:entered|typed))?(?:\\s+value)?\\s*(?:to|as|=|:|is)\\s*${value}`,
        "iu",
      ),
    );
    const reversed = text.match(
      new RegExp(
        `(?:use|enter|type)\\s+${value}\\s+(?:for|as|into|in)\\s+(?:the\\s+)?(?:${aliasPattern})\\b`,
        "iu",
      ),
    );
    const withLabel = text.match(
      new RegExp(
        `(?:with|using)\\s+(?:the\\s+)?(?:${aliasPattern})\\s+(?:set\\s+)?(?:to|as|=|:)?\\s*${value}`,
        "iu",
      ),
    );
    const found = capturedValue(afterLabel) ?? capturedValue(reversed) ?? capturedValue(withLabel);
    if (found !== null) values[definition.name] = found;
  }

  // A one-input workflow also supports the compact forms people naturally use
  // after selecting it: "run this with Mike", "use Mike", or simply "Mike".
  if (definitions.length === 1 && !values[definitions[0].name] && text) {
    const compact = text.match(
      /(?:\b(?:with|using|use|enter|type)\s+)(?:"([^"]+)"|'([^']+)'|([^,;]+))$/iu,
    );
    const bare = text.match(/^(?:"([^"]+)"|'([^']+)'|([^\s,;]+))$/u);
    const found = capturedValue(compact) ?? capturedValue(bare);
    if (found !== null) values[definitions[0].name] = found;
  }

  return {
    inputs: values,
    missingRequired: definitions.filter(
      (definition) => definition.required && !(values[definition.name] ?? "").trim(),
    ),
  };
}
