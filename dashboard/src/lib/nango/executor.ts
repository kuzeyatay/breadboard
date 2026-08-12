import "server-only";

import { embeddedProviderRequest } from "../connected-apps/broker.ts";
import { ApiError } from "../hermes/route-core.ts";
import { buildNangoActionInvocation } from "./actions.ts";
import { findNangoIntegration } from "./catalog.ts";
import { resolveNangoConnection } from "./service.ts";

export interface NangoActionResult {
  connection: string;
  action: string;
  data: unknown;
}

/**
 * Execute one Breadboard-owned action through the embedded credential broker.
 *
 * The model supplies only a logical action and validated arguments. Provider
 * credentials remain server-side and are never returned in the result.
 */
export async function executeNangoAction(input: {
  userId: number;
  action: string;
  args: unknown;
}): Promise<NangoActionResult> {
  const invocation = buildNangoActionInvocation(input.action, input.args);
  const connection = await resolveNangoConnection(
    input.userId,
    invocation.connectionSlug,
  );
  const integration = findNangoIntegration(connection.integrationId);
  if (!integration) {
    throw new ApiError(409, "connected_app_missing", "The connected app must be reconnected.");
  }
  const data = await embeddedProviderRequest({
    userId: input.userId,
    integration,
    request: invocation.request,
  });
  return {
    connection: connection.slug,
    action: invocation.action.name,
    data,
  };
}
