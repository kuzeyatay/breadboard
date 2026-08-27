// Setup actions execute only in the finite Runtime V2 managed-setup worker.
// Keep this compatibility module metadata-only so there is no direct-process
// fallback behind the dashboard or the persistent service.

export {
  SETUP_ACTIONS,
  isSetupAction,
  type SetupActionId,
  type SetupResult,
} from "./setup-contract.ts";

export class SetupError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "SetupError";
  }
}
