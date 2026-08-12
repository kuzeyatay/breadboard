import "server-only";

import { buildNangoActionInvocation } from "../nango/actions.ts";
import { composioClient } from "./client.ts";
import { resolveComposioConnection } from "./service.ts";

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
}): Promise<ComposioActionResult> {
  const invocation = buildNangoActionInvocation(input.action, input.args);
  const connection = await resolveComposioConnection(
    input.userId,
    invocation.connectionSlug,
  );
  const parameters = Object.entries(invocation.request.query ?? {})
    .filter((entry): entry is [string, string | number | boolean] => entry[1] !== undefined)
    .map(([name, value]) => ({
      in: "query" as const,
      name,
      value: typeof value === "boolean" ? String(value) : value,
    }));
  const response = await composioClient().tools.proxyExecute({
    endpoint: invocation.request.endpoint,
    method: invocation.request.method,
    body: invocation.request.body,
    parameters: parameters.length ? parameters : undefined,
    connectedAccountId: connection.connectionId,
  });
  return {
    connection: connection.slug,
    action: invocation.action.name,
    data: response.data,
  };
}
