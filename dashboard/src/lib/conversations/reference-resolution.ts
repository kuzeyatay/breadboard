import fs from "node:fs";
import path from "node:path";
import type { ResourceReference } from "../hermes/task-plan.ts";
import type { ConversationMessageRow } from "./store.ts";

const SINGULAR_FILE_REFERENCE =
  /\b(?:that|this|the|same|previous|above)\s+(?:file|download|document|archive|iso|item|one)\b|\b(?:delete|remove|trash|erase|move|rename|open|read|inspect|copy)\s+(?:it|that|this|the\s+one)\b/i;
const PLURAL_FILE_REFERENCE =
  /\b(?:them|those|these)\b|\b(?:all|listed|above|previous|same|those|these)\s+(?:of\s+)?(?:the\s+)?(?:files?|downloads?|documents?|archives?|items?|entries|results?|ones)\b|\b(?:files?|downloads?|documents?|archives?|items?|entries|results?)\s+(?:listed|above|from\s+(?:that|the|this)\s+(?:list|result))\b/i;
const DIRECTORY_REFERENCE =
  /\b(?:that|this|the|same|previous|above)\s+(?:folder|directory)\b|\b(?:delete|remove|move|rename|open|inspect)\s+(?:that|this)\s+(?:folder|directory)\b/i;
const FILE_NAME_REFERENCE = /(?:^|[\s'"`(])[^\r\n'"`<>]+\.[A-Za-z0-9]{1,12}(?=$|[\s'"`),.;:])/i;
const EXCLUSION_MARKER =
  /\b(?:except(?:\s+for)?|excluding|other\s+than|but\s+keep|keep|do\s+not\s+delete|don'?t\s+delete)\b/i;
const MAX_RESOLVED_FILES = 32;
const MAX_STATTED_CANDIDATES = 64;

/**
 * Whether the wording relies on prior filesystem context rather than naming a
 * complete path. Callers use this to give a reference-specific clarification
 * instead of incorrectly asking which folder to inspect.
 */
export function hasFilesystemReferenceIntent(request: string): boolean {
  return referencedResourceType(request) !== null;
}

/**
 * Resolve filesystem references for capability planning. This function does
 * not grant authority: it only gives the broker concrete resources for the
 * permission prompt it was already going to raise.
 *
 * Current-chat safety constraints:
 *  - only the immediately preceding completed assistant message is eligible;
 *  - that message must contain successful tool evidence;
 *  - singular, plural, named, ordinal, and exclusion references are resolved
 *    only against the structured paths/list entries in that message;
 *  - unknown exclusions, ambiguous selections, and oversized lists fail shut.
 *
 * Folders are referents in their own right: a verified answer whose findings
 * are folders ("5.55 GB in `C:\\Users\\Public\\wpilib`") is exactly what "delete
 * them all" refers to. They are only read that way when the message listed
 * nothing but folders, because a message that lists files also names the folder
 * those files live in, and that folder is the container, not a target.
 */
export function resolveVerifiedFilesystemReferences(
  request: string,
  priorMessages: readonly ConversationMessageRow[],
): ResourceReference[] {
  const previous = priorMessages.at(-1);
  return previous
    ? resolveFilesystemReferencesFromAssistant(request, previous)
    : [];
}

/**
 * Resolve an explicit cross-chat reference. More than one matching verified
 * assistant result is deliberately ambiguous; weak chat-memory retrieval can
 * provide context, but it cannot choose destructive targets by itself.
 */
export function resolveVerifiedCrossChatFilesystemReferences(
  request: string,
  messages: readonly ConversationMessageRow[],
): ResourceReference[] {
  if (!hasExplicitCrossChatReference(request)) return [];
  const matches = messages
    .filter((message) => message.role === "assistant")
    .map((message) => resolveFilesystemReferencesFromAssistant(request, message))
    .filter((resources) => resources.length > 0);
  if (matches.length !== 1) return [];
  return matches[0];
}

export function hasExplicitCrossChatReference(request: string): boolean {
  return /\b(?:other|another|previous|last|earlier|old)\s+(?:chat|conversation|thread)\b|\b(?:chat|conversation|thread)\s+(?:from|before|we\s+had)\b/i.test(
    request,
  );
}

function resolveFilesystemReferencesFromAssistant(
  request: string,
  message: ConversationMessageRow,
): ResourceReference[] {
  const resourceType = referencedResourceType(request);
  if (
    !resourceType ||
    message.role !== "assistant" ||
    message.status !== "complete" ||
    !hasSuccessfulToolEvidence(message.metadata)
  ) {
    return [];
  }

  const inventory = extractFilesystemInventory(message.content);
  if (resourceType === "directory") {
    return inventory.directories.length === 1
      ? [asResource(inventory.directories[0], "directory")]
      : [];
  }

  // Folders answer a plural reference only when the verified message found
  // nothing else; alongside files they are the location of those files.
  const candidates: ResourceReference[] = inventory.files.length
    ? inventory.files.map((value) => asResource(value, "file"))
    : PLURAL_FILE_REFERENCE.test(request)
      ? inventory.directories.map((value) => asResource(value, "directory"))
      : [];
  if (candidates.length === 0 || candidates.length > MAX_RESOLVED_FILES) {
    return [];
  }

  return selectReferencedEntries(request, candidates);
}

function referencedResourceType(request: string): "file" | "directory" | null {
  if (DIRECTORY_REFERENCE.test(request)) return "directory";
  if (
    SINGULAR_FILE_REFERENCE.test(request) ||
    PLURAL_FILE_REFERENCE.test(request) ||
    FILE_NAME_REFERENCE.test(request)
  ) {
    return "file";
  }
  return null;
}

function asResource(
  value: string,
  resourceType: "file" | "directory",
): ResourceReference {
  return { kind: "path", value, absolute: true, resourceType };
}

function selectReferencedEntries(
  request: string,
  entries: readonly ResourceReference[],
): ResourceReference[] {
  const exclusionMatch = request.match(EXCLUSION_MARKER);
  const selectionText = exclusionMatch
    ? request.slice(0, exclusionMatch.index)
    : request;
  const exclusionText = exclusionMatch
    ? request.slice((exclusionMatch.index ?? 0) + exclusionMatch[0].length)
    : "";

  const exclusions = exclusionMatch
    ? matchNamedOrOrdinalEntries(exclusionText, entries)
    : [];
  // An exclusion that cannot be matched exactly is unsafe: proceeding could
  // delete the item the user explicitly asked to preserve.
  if (exclusionMatch && exclusions.length === 0) return [];

  const plural = PLURAL_FILE_REFERENCE.test(selectionText) ||
    /\b(?:delete|remove|trash|erase|move)\s+all\b/i.test(selectionText);
  let selected: ResourceReference[];
  if (plural) {
    selected = [...entries];
  } else {
    selected = matchNamedOrOrdinalEntries(selectionText, entries);
    if (selected.length === 0 && entries.length === 1 && SINGULAR_FILE_REFERENCE.test(selectionText)) {
      selected = [entries[0]];
    }
  }

  const excluded = new Set(exclusions.map((entry) => pathKey(entry.value)));
  return deduplicateEntries(
    selected.filter((entry) => !excluded.has(pathKey(entry.value))),
  );
}

function matchNamedOrOrdinalEntries(
  text: string,
  entries: readonly ResourceReference[],
): ResourceReference[] {
  const matches: ResourceReference[] = [];
  const normalizedText = text.toLocaleLowerCase();
  for (const entry of entries) {
    const basename = portableBasename(entry.value).toLocaleLowerCase();
    if (basename && normalizedText.includes(basename)) matches.push(entry);
  }

  const ordinals = ordinalIndexes(text, entries.length);
  for (const index of ordinals) {
    const entry = entries[index];
    if (entry) matches.push(entry);
  }
  return deduplicateEntries(matches);
}

function ordinalIndexes(text: string, length: number): number[] {
  const indexes = new Set<number>();
  const lower = text.toLowerCase();
  const words: Readonly<Record<string, number>> = {
    first: 0,
    second: 1,
    third: 2,
    fourth: 3,
    fifth: 4,
    sixth: 5,
    seventh: 6,
    eighth: 7,
    ninth: 8,
    tenth: 9,
  };
  for (const [word, index] of Object.entries(words)) {
    if (new RegExp(`\\b${word}\\b`, "i").test(lower)) indexes.add(index);
  }
  if (/\blast\b/i.test(lower) && length > 0) indexes.add(length - 1);
  for (const match of lower.matchAll(/\b(?:number|item|file|#)\s*#?\s*(\d{1,2})\b|\b(\d{1,2})(?:st|nd|rd|th)\b/g)) {
    const value = Number(match[1] ?? match[2]);
    if (value >= 1 && value <= length) indexes.add(value - 1);
  }
  const firstCount = lower.match(/\bfirst\s+(\d{1,2})\b/);
  if (firstCount) {
    const count = Math.min(length, Number(firstCount[1]));
    for (let index = 0; index < count; index += 1) indexes.add(index);
  }
  const lastCount = lower.match(/\blast\s+(\d{1,2})\b/);
  if (lastCount) {
    const count = Math.min(length, Number(lastCount[1]));
    for (let index = Math.max(0, length - count); index < length; index += 1) {
      indexes.add(index);
    }
  }
  return [...indexes].filter((index) => index >= 0 && index < length);
}

function hasSuccessfulToolEvidence(metadataValue: string | null): boolean {
  if (!metadataValue) return false;
  try {
    const metadata = JSON.parse(metadataValue) as Record<string, unknown>;
    const toolCalls = Array.isArray(metadata.toolCalls) ? metadata.toolCalls : [];
    if (toolCalls.some((item) => isSuccessfulRecord(item))) return true;

    const verification = asRecord(metadata.verification);
    const evidence = Array.isArray(verification?.evidence)
      ? verification.evidence
      : [];
    return evidence.some((item) => isSuccessfulRecord(item));
  } catch {
    return false;
  }
}

function isSuccessfulRecord(value: unknown): boolean {
  return asRecord(value)?.success === true;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function extractFilesystemInventory(content: string): {
  directories: string[];
  files: string[];
} {
  const directories: string[] = [];
  const absoluteFiles: string[] = [];
  const listedNames: string[] = [];
  const budget = { remaining: MAX_STATTED_CANDIDATES };

  for (const line of content.split(/\r?\n/)) {
    const field = line.match(
      /^\s*[-*]?\s*(?:\*\*)?(Path|Folder|Directory|File)(?:\*\*)?\s*:\s*(.+?)\s*$/i,
    );
    if (field) {
      const candidate = cleanCandidate(field[2]);
      if (isPortableAbsolute(candidate)) {
        if (/^(?:folder|directory)$/i.test(field[1]) || !looksLikeFilePath(candidate, budget)) {
          directories.push(candidate);
        } else {
          absoluteFiles.push(candidate);
        }
      } else if (/^file$/i.test(field[1]) && isSafeBasename(candidate)) {
        listedNames.push(candidate);
      }
    }

    const listItem = line.match(/^\s*(?:\d+[.)]|[-*])\s+`([^`\r\n]+)`/);
    if (listItem) {
      const candidate = cleanCandidate(listItem[1]);
      // A listed absolute path is classified like any other: a bulleted list of
      // folders is a list of folders, not of files without extensions.
      if (isPortableAbsolute(candidate)) {
        if (looksLikeFilePath(candidate, budget)) absoluteFiles.push(candidate);
        else directories.push(candidate);
      } else if (isSafeBasename(candidate)) listedNames.push(candidate);
    }

    for (const match of line.matchAll(/`([^`\r\n]+)`/g)) {
      const candidate = cleanCandidate(match[1]);
      if (!isPortableAbsolute(candidate)) continue;
      if (looksLikeFilePath(candidate, budget)) absoluteFiles.push(candidate);
      else directories.push(candidate);
    }
  }

  const uniqueDirectories = deduplicatePaths(directories);
  const files = [...absoluteFiles];
  if (listedNames.length > 0 && uniqueDirectories.length === 1) {
    for (const name of listedNames) {
      const joined = joinPortable(uniqueDirectories[0], name);
      if (joined) files.push(joined);
    }
  }
  return {
    directories: uniqueDirectories,
    files: deduplicatePaths(files),
  };
}

function cleanCandidate(value: string): string {
  return value
    .trim()
    .replace(/^['"`]+|['"`]+$/g, "")
    .replace(/[.,;:]+$/g, "")
    .trim();
}

function isPortableAbsolute(value: string): boolean {
  if (!value || value.length > 2_048 || /[\u0000-\u001f\u007f]/.test(value)) {
    return false;
  }
  return path.win32.isAbsolute(value) || path.posix.isAbsolute(value);
}

/**
 * Whether this path names a file rather than a folder.
 *
 * The filesystem answers this whenever the path exists, because the name alone
 * gets it wrong in the case that matters: `C:\Users\me\.gradle` reads as a
 * 7-character extension, so a cache *folder* was classified as a file and its
 * permission request pointed at the whole parent profile directory. The name
 * heuristic remains the fallback for paths that no longer exist.
 */
function looksLikeFilePath(value: string, budget: { remaining: number }): boolean {
  const observed = observedIsFile(value, budget);
  if (observed !== null) return observed;
  const basename = portableBasename(value);
  return /\.[A-Za-z0-9]{1,12}$/.test(basename);
}

/** Null when the path does not exist, or when the stat budget is spent. */
function observedIsFile(
  value: string,
  budget: { remaining: number },
): boolean | null {
  if (budget.remaining <= 0) return null;
  budget.remaining -= 1;
  try {
    return !fs.statSync(value).isDirectory();
  } catch {
    return null;
  }
}

function portableBasename(value: string): string {
  return /^[A-Za-z]:[\\/]|^\\\\/.test(value)
    ? path.win32.basename(value)
    : path.posix.basename(value);
}

function isSafeBasename(value: string): boolean {
  if (!value || value === "." || value === ".." || value.length > 500) return false;
  if (/[\u0000-\u001f\u007f]/.test(value)) return false;
  return path.win32.basename(value) === value && path.posix.basename(value) === value;
}

function joinPortable(directory: string, basename: string): string | null {
  if (!isPortableAbsolute(directory) || !isSafeBasename(basename)) return null;
  return /^[A-Za-z]:[\\/]|^\\\\/.test(directory)
    ? path.win32.join(directory, basename)
    : path.posix.join(directory, basename);
}

function pathKey(value: string): string {
  return /^[A-Za-z]:[\\/]|^\\\\/.test(value)
    ? value.replace(/\//g, "\\").toLowerCase()
    : value;
}

function deduplicateEntries(
  entries: readonly ResourceReference[],
): ResourceReference[] {
  const unique = new Map<string, ResourceReference>();
  for (const entry of entries) {
    const key = pathKey(entry.value);
    if (!unique.has(key)) unique.set(key, entry);
  }
  return [...unique.values()];
}

function deduplicatePaths(values: readonly string[]): string[] {
  const unique = new Map<string, string>();
  for (const value of values) {
    const cleaned = cleanCandidate(value);
    if (isPortableAbsolute(cleaned) && !unique.has(pathKey(cleaned))) {
      unique.set(pathKey(cleaned), cleaned);
    }
  }
  return [...unique.values()];
}
