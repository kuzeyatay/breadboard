export class AudioAnalyzerError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "AudioAnalyzerError";
    this.code = code;
  }
}
