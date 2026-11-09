import { systemPromptText } from "../system-prompts/service.ts";
import { dashboardDataDir, repositoryRoot } from "../runtime-paths.ts";
import {
  apiAnythingAvailable, callApiAnythingTool, type ApiAnythingOptions,
} from "../../../scripts/api-anything-client.mjs";
import { API_ANYTHING_CONNECTION } from "../../../scripts/api-anything-contract.mjs";

export { API_ANYTHING_CONNECTION };

export function apiAnythingRegistry(userId?: number | null) {
  const available = apiAnythingAvailable({ repoRoot: repositoryRoot() });
  return {
    connectionNames: [API_ANYTHING_CONNECTION],
    tools: { mcp_call: true },
    systemContext: [
      "# website_api_tools",
      systemPromptText("api-anything-policy", userId),
      `Use mcp_call with connection="${API_ANYTHING_CONNECTION}" and tool="find_sites", args={query:<site, URL or task>}. Then tool="describe_site", args={site:<name>}; tool="call_operation", args={site:<name>,operation:<exact name>,args:<operation arguments>}.`,
      available ? "API Anything is embedded and ready." : "API Anything is currently unavailable; use the existing browser tools. status can check it again.",
    ].join("\n"),
    toolCount: 4,
  };
}

export function executeApiAnything(input: Omit<ApiAnythingOptions, "repoRoot" | "dataRoot">) {
  return callApiAnythingTool({ ...input, repoRoot: repositoryRoot(), dataRoot: dashboardDataDir() });
}
