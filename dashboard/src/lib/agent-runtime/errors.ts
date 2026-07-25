import type { RuntimeKind } from "./contracts.ts";

export class AgentRuntimeError extends Error {
  constructor(
    readonly runtime: RuntimeKind,
    readonly code: string,
    readonly recoverable: boolean,
    message = "The agent runtime is unavailable.",
  ) {
    super(message);
  }
}
