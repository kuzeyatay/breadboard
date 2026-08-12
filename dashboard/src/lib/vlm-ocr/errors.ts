// Typed failures for the VLM parse option. The ingest route turns these into
// user-facing text, so every message has to say what to do next rather than
// just what broke.

export class VlmOcrDisabledError extends Error {
  constructor() {
    super(
      "Parsing with the VLM is turned off. Set VLM_OCR_ENABLED=true to enable it.",
    );
    this.name = "VlmOcrDisabledError";
  }
}

export class VlmOcrUnavailableError extends Error {
  /** Everything the UI needs to tell the user how to fix the setup. */
  hint: string;

  constructor(message: string, hint: string) {
    super(hint ? `${message} ${hint}` : message);
    this.name = "VlmOcrUnavailableError";
    this.hint = hint;
  }
}

export class VlmOcrRequestError extends Error {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "VlmOcrRequestError";
    this.status = status;
  }
}

export function vlmOcrErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}
