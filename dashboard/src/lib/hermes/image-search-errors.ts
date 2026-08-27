export class ImageSearchServiceError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ImageSearchServiceError";
    this.code = code;
  }
}
