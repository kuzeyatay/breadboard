import "server-only";

import { composioClient } from "./client.ts";
import { resolveComposioConnection } from "./service.ts";
import { connectedActionWithGardenAttachments, validateConnectedAction } from "../garden-transfer/mail.ts";
import { ApiError } from "../hermes/route-core.ts";
import { CalendarError } from "../calendar/store.ts";
import { getCalendarStore } from "../calendar/instance.ts";
import { exportGoogleCalendarEvents, previewGoogleCalendarExport, readGoogleExportOptions, type GoogleExportClient } from "../calendar/google-export.ts";

export interface ComposioActionResult {
  connection: string;
  action: string;
  data: unknown;
}

/** Execute a policy-checked Breadboard connected-app action through Composio. */
export async function executeComposioAction(input: {
  userId: number;
  action: string;
  args: unknown;
  allowedGardenIds?: readonly number[];
  signal?: AbortSignal;
}): Promise<ComposioActionResult> {
  input.signal?.throwIfAborted();
  const action = validateConnectedAction(input.action, input.args);
  const connection = await resolveComposioConnection(
    input.userId,
    action.connectionSlug,
  );
  if (["google_calendar_preview_breadboard_export", "google_calendar_export_breadboard_events"].includes(action.action.name)) {
    const client: GoogleExportClient = {
      request: async (method, path, body) => {
        const response = await composioClient().tools.proxyExecute({
          connectedAccountId: connection.connectionId,
          endpoint: `https://www.googleapis.com${path}`, method, body,
        }, { signal: input.signal
          ? AbortSignal.any([input.signal, AbortSignal.timeout(15_000)])
          : AbortSignal.timeout(15_000) });
        return { status: response.status, data: response.data };
      },
    };
    try {
      const handler = action.action.name === "google_calendar_preview_breadboard_export"
        ? previewGoogleCalendarExport : exportGoogleCalendarEvents;
      const data = await handler(getCalendarStore(), input.userId, readGoogleExportOptions(input.args), client);
      return { connection: connection.slug, action: action.action.name, data };
    } catch (error) {
      if (error instanceof CalendarError) throw new ApiError(error.status, "google_calendar_export_failed", error.message);
      throw error;
    }
  }
  const invocation = await connectedActionWithGardenAttachments(input);
  const parameters = Object.entries(invocation.request.query ?? {})
    .filter((entry): entry is [string, string | number | boolean] => entry[1] !== undefined)
    .map(([name, value]) => ({
      in: "query" as const,
      name,
      value: typeof value === "boolean" ? String(value) : value,
    }));
  const response = await composioClient().tools.proxyExecute({
    endpoint: connection.slug === "google-calendar" && invocation.request.endpoint.startsWith("/calendar/v3/")
      ? `https://www.googleapis.com${invocation.request.endpoint}`
      : invocation.request.endpoint,
    method: invocation.request.method,
    body: invocation.request.body,
    parameters: parameters.length ? parameters : undefined,
    connectedAccountId: connection.connectionId,
  });
  if (!Number.isInteger(response.status) || response.status < 200 || response.status >= 300) {
    throw new ApiError(502, "connected_app_request_failed", "The connected app rejected the request. The action was not completed.");
  }
  if (["gmail_send_message", "gmail_create_draft"].includes(input.action) &&
      (!response.data || typeof response.data !== "object" ||
       !("id" in response.data) || typeof response.data.id !== "string" || !response.data.id)) {
    throw new ApiError(502, "gmail_confirmation_missing", "Gmail did not return a message or draft ID. Check Gmail before retrying; delivery could not be confirmed.");
  }
  if (["google_calendar_create_event", "google_calendar_update_event"].includes(action.action.name) &&
      (!response.data || typeof response.data !== "object" ||
       !("id" in response.data) || typeof response.data.id !== "string" || !response.data.id)) {
    throw new ApiError(502, "google_calendar_confirmation_missing", "Google Calendar did not return an event ID. Check Google Calendar before retrying; the change could not be confirmed.");
  }
  return {
    connection: connection.slug,
    action: invocation.action.name,
    data: response.data,
  };
}
