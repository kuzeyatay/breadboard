import "server-only";

import { brokerRest, composioUserId } from "./client.ts";
import type { ComposioActionResult } from "./executor.ts";
import { listComposioConnections } from "./service.ts";
import { nangoActionDefinitions } from "../nango/actions.ts";
import { ApiError } from "../hermes/route-core.ts";

// ---------------------------------------------------------------------------
// Apps without hand-written Breadboard actions run their own published tools.
// ---------------------------------------------------------------------------

interface BrokerTool {
  slug: string;
  name?: string;
  description?: string;
  tags?: string[];
  toolkit?: { slug?: string };
  input_parameters?: {
    required?: string[];
    properties?: Record<string, { type?: unknown }>;
  };
}

export interface AppToolSummary {
  name: string;
  title: string;
  description: string;
  fixedConnectionSlug: string;
  risk: "read" | "write";
  readOnly: boolean;
  argumentDescription: string;
}

export interface AppTool {
  name: string;
  title: string;
  fixedConnectionSlug: string;
  risk: "read" | "write";
  readOnly: boolean;
  connectionId: string;
}

const APP_TOOL_RE = /^[A-Z][A-Z0-9_]{2,150}$/;
// ponytail: an app's first 150 tools are listed; add a per-app search tool if one outgrows that.
const APP_TOOL_LIST_LIMIT = 150;
const curatedSlugs = new Set(
  nangoActionDefinitions().map((action) => action.fixedConnectionSlug),
);
const toolListCache = new Map<string, { expiresAt: number; value: BrokerTool[] }>();

// Only an explicit read-only declaration skips approval.
const toolIsReadOnly = (tool: BrokerTool) =>
  tool.tags?.includes("readOnlyHint") === true &&
  !tool.tags.includes("destructiveHint");

async function toolkitTools(toolkit: string, signal?: AbortSignal): Promise<BrokerTool[]> {
  const cached = toolListCache.get(toolkit);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const response = await brokerRest<{ items?: BrokerTool[] }>(
    `/tools?toolkit_slug=${encodeURIComponent(toolkit)}&toolkit_versions=latest&limit=${APP_TOOL_LIST_LIMIT}`,
    { signal },
  );
  const value = response.items ?? [];
  toolListCache.set(toolkit, { expiresAt: Date.now() + 10 * 60_000, value });
  return value;
}

/** The tools of every connected app that has no hand-written actions. */
export async function connectedAppToolSummaries(
  userId: number,
  signal?: AbortSignal,
): Promise<AppToolSummary[]> {
  const connections = (await listComposioConnections(userId, signal)).filter(
    (connection) => !curatedSlugs.has(connection.slug),
  );
  const lists = await Promise.allSettled(
    connections.map(async (connection) =>
      (await toolkitTools(connection.provider, signal)).map((tool): AppToolSummary => {
        const required = new Set(tool.input_parameters?.required ?? []);
        const readOnly = toolIsReadOnly(tool);
        return {
          name: tool.slug,
          title: tool.name ?? tool.slug,
          description: (tool.description ?? "").replace(/\s+/g, " ").slice(0, 240),
          fixedConnectionSlug: connection.slug,
          risk: readOnly ? "read" : "write",
          readOnly,
          argumentDescription:
            Object.entries(tool.input_parameters?.properties ?? {})
              .map(
                ([name, property]) =>
                  `${name} (${typeof property.type === "string" ? property.type : "value"}${required.has(name) ? ", required" : ""})`,
              )
              .join(", ") || "none",
        };
      }),
    ),
  );
  // One unreachable app must not hide the others.
  return lists.flatMap((list) => (list.status === "fulfilled" ? list.value : []));
}

/** Resolve a tool name to one the user's own connected account may run, or null. */
export async function connectedAppTool(
  userId: number,
  name: string,
  signal?: AbortSignal,
): Promise<AppTool | null> {
  if (!APP_TOOL_RE.test(name)) return null;
  let tool: BrokerTool;
  try {
    tool = await brokerRest<BrokerTool>(
      `/tools/${encodeURIComponent(name)}?toolkit_versions=latest`,
      { signal },
    );
  } catch {
    return null;
  }
  // Apps with hand-written actions stay behind those actions' own policy.
  const connection = (await listComposioConnections(userId, signal)).find(
    (candidate) =>
      candidate.provider === tool.toolkit?.slug && !curatedSlugs.has(candidate.slug),
  );
  if (!connection || tool.slug !== name) return null;
  const readOnly = toolIsReadOnly(tool);
  return {
    name,
    title: tool.name ?? name,
    fixedConnectionSlug: connection.slug,
    risk: readOnly ? "read" : "write",
    readOnly,
    connectionId: connection.connectionId,
  };
}

/** Run an app's own tool. The caller has already checked approval. */
export async function executeConnectedAppTool(input: {
  userId: number;
  tool: AppTool;
  args: unknown;
  signal?: AbortSignal;
}): Promise<ComposioActionResult> {
  const response = await brokerRest<{ successful?: boolean; error?: unknown; data?: unknown }>(
    `/tools/execute/${encodeURIComponent(input.tool.name)}`,
    {
      method: "POST",
      signal: input.signal,
      body: {
        user_id: composioUserId(input.userId),
        connected_account_id: input.tool.connectionId,
        arguments: input.args ?? {},
        version: "latest",
      },
    },
  );
  if (response.successful !== true) {
    // The app's own message is what lets the agent correct its arguments.
    const detail = (typeof response.error === "string" ? response.error : "")
      .replace(/composio/gi, "the connection service")
      .slice(0, 600);
    throw new ApiError(
      502,
      "connected_app_request_failed",
      detail || "The connected app rejected the request. The action was not completed.",
    );
  }
  return { connection: input.tool.fixedConnectionSlug, action: input.tool.name, data: response.data };
}
