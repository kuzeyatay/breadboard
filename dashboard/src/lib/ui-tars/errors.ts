export class UITarsServiceError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
    this.name = "UITarsServiceError";
  }
}
