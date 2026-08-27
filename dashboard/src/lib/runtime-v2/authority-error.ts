export class RuntimeAuthorityUnavailableError extends Error {
  readonly status = 503;
  readonly code = "runtime_unavailable";

  constructor(message = "The Breadboard Runtime service owner is unavailable.") {
    super(message);
    this.name = "RuntimeAuthorityUnavailableError";
  }
}
