/**
 * One sentence an installed user can act on when a Runtime V2 service cannot
 * start, keyed by the supervisor's lifecycle state. Health routes attach it as
 * `message`, which the Agent Manager shows under "Needs attention".
 */
export function unavailableServiceMessage(label: string, state: string | null | undefined): string {
  switch (state) {
    case "installation-unavailable":
      return `${label} is missing from this Breadboard installation. Reinstalling Breadboard restores it.`;
    case "resource-blocked":
      return `Breadboard does not have enough memory headroom to start ${label} right now. Close other work and retry.`;
    case "failed":
      return `${label} failed to start. Export diagnostics from Profile and check the Breadboard logs.`;
    default:
      return `The Breadboard runtime did not report ${label}. Restart Breadboard and retry.`;
  }
}
