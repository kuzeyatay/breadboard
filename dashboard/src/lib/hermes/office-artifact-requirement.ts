import type { RuntimeArtifactRequirement } from "./run-store.ts";
import { actionMatches, requestedActions } from "./request-language.ts";

/**
 * The Office skill can author several file families. Once the resolver selects
 * it, only an explicit file request can require a durable artifact. Source
 * formats and ordinary prose-writing requests must not create an export debt.
 */
export function officeArtifactRequirement(
  request: string,
): RuntimeArtifactRequirement | null {
  for (const action of requestedActions(request)) {
    if (/\b(?:in|into)\s+(?:(?:the|this)\s+)?chat\b/i.test(action.target)) continue;
    // A destination is an output even for "summarize this PDF as a Word
    // document". Only an immediate format after the preposition counts; a
    // source named later in the clause cannot lend it a file type.
    const destination = action.target.match(
      /\b(?:as|into|to|in)\s+(?:(?:a|an|the)\s+)?((?:Word(?:\s+document)?|DOCX?|PDF|PowerPoint|PPTX?|Excel|XLSX?|CSV|TSV|spreadsheet|workbook|presentation|slide\s+deck|document|file)s?)\b/i,
    )?.[1];
    if (destination) return formatRequirement(destination);
    if (!actionMatches(action, /create|make|generate|produce|build|draft|write|prepare|author|compose|deliver|export|render|save(?:\s+as)?|edit|revise|rewrite|update|modify|fix|patch/)) continue;
    const output = formatRequirement(action.object);
    if (output) return output;
    // Quoted filenames are legitimate objects, but quoted instructions are
    // evidence. Only a native filename extension may contribute a format.
    const extension = action.objectSource.match(/\.(docx?|pdf|pptx?|xlsx?|csv|tsv)\b/i)?.[1];
    if (extension) return formatRequirement(extension);
  }
  return null;
}

function formatRequirement(format: string): RuntimeArtifactRequirement | null {
  if (/\b(?:powerpoint|pptx?|presentations?|slide\s*decks?|slides?)\b/i.test(format)) {
    return requirement("presentation", "presentation-file");
  }
  if (/\b(?:excel|xlsx?|spreadsheets?|workbooks?|csv|tsv)\b/i.test(format)) {
    return requirement("spreadsheet", "spreadsheet-file");
  }
  if (/\b(?:docx?|word\s+(?:documents?|files?|reports?))\b/i.test(format) || /^word$/i.test(format)) {
    return requirement("document", "document-file");
  }
  if (/\bpdfs?\b/i.test(format)) {
    return requirement("pdf", "pdf-file");
  }
  return /\b(?:documents?|files?)\b/i.test(format)
    ? requirement("document", "document-file") : null;
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
