export const NOTE_TITLE_LIMIT = 160;
export const NOTE_BODY_LIMIT = 20_000;

export interface TerminalNote {
  title: string;
  body: string;
  revision: number;
  updatedAt: string | null;
}
export const EMPTY_TERMINAL_NOTE: TerminalNote = {title: "", body: "", revision: 0, updatedAt: null};

export function validNoteText(value: unknown): value is Pick<TerminalNote, "title" | "body"> {
  if (!value || typeof value !== "object") return false;
  const note = value as TerminalNote;
  return typeof note.title === "string" && note.title.length <= NOTE_TITLE_LIMIT &&
    typeof note.body === "string" && note.body.length <= NOTE_BODY_LIMIT;
}
export function validTerminalNote(value: unknown): value is TerminalNote {
  if (!validNoteText(value)) return false;
  const note = value as TerminalNote;
  return Number.isSafeInteger(note.revision) && note.revision >= 0 &&
    (note.updatedAt === null || typeof note.updatedAt === "string");
}

export const DEFAULT_NOTE_ID = "default";
export interface TerminalNoteSummary {
  id: string; title: string; preview: string; revision: number; updatedAt: string | null;
}
export function validNoteId(value: unknown): value is string {
  return typeof value === "string" && /^(default|[a-zA-Z0-9_-]{8,80})$/.test(value);
}
export function validNoteSummary(value: unknown): value is TerminalNoteSummary {
  if (!value || typeof value !== "object") return false;
  const note = value as TerminalNoteSummary;
  return validNoteId(note.id) && typeof note.preview === "string" &&
    validTerminalNote({...note, body: ""});
}
