// Breadboard's replacement for simstudioai/sim's tools/registry.ts (Apache-2.0), which
// enumerates ~4,700 integration tools across ~250 vendor directories. None of those were
// vendored: every one of them is an HTTP client for a SaaS product with its own OAuth
// credential rows, and Breadboard reaches external services through its own connections
// layer instead. What remains is the pair the workflow engine itself cannot run without —
// the function block's sandbox and the API block's HTTP call.
//
// Adding a tool here is all it takes for the agent block to offer it to a model: the
// registry is the only thing `getTool` / `executeTool` consult.

import { functionExecuteTool } from "@/lib/sim/tools/function";
import { httpRequestTool } from "@/lib/sim/tools/http";
import type { ToolConfig } from "@/lib/sim/tools/types";

export const tools: Record<string, ToolConfig<any, any>> = {
  function_execute: functionExecuteTool,
  http_request: httpRequestTool,
};
