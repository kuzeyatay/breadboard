export type EditableOfficeFormat = "docx" | "pptx";

export interface EditableOfficeBlock {
  /** Stable address within this opened document; this is not a filesystem path. */
  anchor: string;
  kind: string;
  text: string;
  editable: boolean;
  slide?: number;
}

export interface OfficeBlockPatch {
  anchor: string;
  text: string;
}

export interface EditableOfficeDocument {
  readonly format: EditableOfficeFormat;
  readonly blocks: readonly EditableOfficeBlock[];
}

export class GenOfficeError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "GenOfficeError";
    this.status = status;
    this.code = code;
  }
}
