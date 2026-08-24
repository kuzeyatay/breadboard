import type { RuntimeArtifactRequirement } from "./run-store.ts";

/**
 * The Office skill can author several file families. Once the resolver selects
 * it, the user's requested format fixes which durable artifact must exist
 * before the turn may claim success. A generic report defaults to Word.
 */
export function officeArtifactRequirement(
  request: string,
): RuntimeArtifactRequirement | null {
  const normalized = request.toLowerCase();
  // The Office skill can also inspect a document or answer usage questions.
  // Arm the completion gate only when the request asks it to produce/change a
  // file, otherwise a read-only turn would owe an artifact nobody requested.
  if (
    !/\b(?:create|make|generate|produce|build|draft|write|prepare|author|compose|deliver|export|convert|transform|save|edit|revise|update|modify|fix|patch)\w*\b/.test(
      normalized,
    )
  ) {
    return null;
  }
  if (/\b(?:powerpoint|pptx?|presentations?|slide\s*decks?|slides?)\b/.test(normalized)) {
    return requirement("presentation", "presentation-file");
  }
  if (/\b(?:excel|xlsx?|spreadsheets?|workbooks?|csv|tsv)\b/.test(normalized)) {
    return requirement("spreadsheet", "spreadsheet-file");
  }
  // Prefer an explicit Word destination over a mentioned input format, as in
  // "convert this PDF to a Word document."
  if (/\b(?:word|docx?|word\s+documents?)\b/.test(normalized)) {
    return requirement("document", "document-file");
  }
  if (/\bpdfs?\b/.test(normalized)) {
    return requirement("pdf", "pdf-file");
  }
  return requirement("document", "document-file");
}

function requirement(
  kind: string,
  rendererId: string,
): RuntimeArtifactRequirement {
  return {
    kind,
    rendererId,
    sourceSkill: "office",
    readyEventType: "artifact.completed",
  };
}
