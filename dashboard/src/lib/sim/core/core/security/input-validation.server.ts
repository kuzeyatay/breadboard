// Breadboard stand-in for sim's lib/core/security/input-validation.server.ts
// (simstudioai/sim, Apache-2.0). Sim resolves every hostname through DNS, rejects
// records that land in private ranges, and pins the resolved IP for the subsequent
// fetch. Breadboard's API block runs against operator-configured endpoints on the
// user's own machine, so pinning would block the loopback services it exists to call.
// The syntactic checks (protocol, obviously-internal host, blocked ports) still apply.

import {
  type ValidationResult,
  validateExternalUrl,
} from "@/lib/sim/tools/support/input-validation";

export type AsyncValidationResult = ValidationResult & {
  /** Sim pins this resolved address into the request agent; unused here. */
  resolvedIp?: string;
};

export async function validateUrlWithDNS(
  url: string | null | undefined,
  paramName = "url",
  options: { allowHttp?: boolean } = {},
): Promise<AsyncValidationResult> {
  return validateExternalUrl(url, paramName, options);
}
