import "server-only";

import { embeddedProviderRequest } from "../connected-apps/broker.ts";
import { ApiError } from "../hermes/route-core.ts";
import { findNangoIntegration } from "./catalog.ts";
import { resolveNangoConnection } from "./service.ts";
import { connectedActionWithGardenAttachments, validateConnectedAction } from "../garden-transfer/mail.ts";

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
  allowedGardenIds?: readonly number[];
}): Promise<NangoActionResult> {
  const action = validateConnectedAction(input.action, input.args);
  if (["google_calendar_preview_breadboard_export", "google_calendar_export_breadboard_events"].includes(action.action.name)) {
    throw new ApiError(409, "composio_required", "Connect Google Calendar through Composio to copy Breadboard events.");
  }
  const connection = await resolveNangoConnection(
    input.userId,
    action.connectionSlug,
  );
  const integration = findNangoIntegration(connection.integrationId);
  if (!integration) {
    throw new ApiError(409, "connected_app_missing", "The connected app must be reconnected.");
  }
  const invocation = await connectedActionWithGardenAttachments(input);
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
