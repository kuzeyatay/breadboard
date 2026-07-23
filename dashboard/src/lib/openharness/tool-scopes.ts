// Per-surface tool allowlists.
//
// These are the curated Breadboard tools each surface's agent may use. They are
// enforced in two places: the OpenHarness agent permission config (defense at
// the runtime), and the capability token minted by the gateway (defense at the
// data boundary). A garden or Quartz agent can never be granted shell, file
// editing, git, package installation, or dynamic skill discovery — those names
// are simply absent from its allowlist, and its agent config denies them.

import type { OpenHarnessSurface } from "./config.ts";
import { isGBrainEnabled } from "../gbrain/config.ts";

// Read-only + proposal Breadboard tools for garden chat.
export const GARDEN_TOOLS = [
  "garden_list",
  "garden_search",
  "garden_get_page",
  "garden_get_page_context",
  "garden_get_source_excerpt",
  "garden_get_source_figure",
  "garden_get_graph_neighbors",
  "garden_get_learning_spine",
  "garden_get_content_inventory",
  "garden_get_recent_events",
  "garden_create_note_proposal",
  "garden_propose_page_revision",
  "garden_propose_visualization",
  "garden_run_proposal_validation",
] as const;

// Quartz page AI is read-only by default; write-like tools are proposal-only.
export const QUARTZ_TOOLS = [
  "garden_list",
  "garden_search",
  "garden_get_page",
  "garden_get_page_context",
  "garden_get_source_excerpt",
  "garden_get_source_figure",
  "garden_get_graph_neighbors",
  "garden_get_learning_spine",
  "garden_create_note_proposal",
  "garden_propose_page_revision",
  "garden_propose_visualization",
] as const;

// Read-only GBrain knowledge-retrieval tools. Available ONLY to authenticated
// Garden Chat and the authenticated Terminal — never anonymous/public Quartz AI.
// These never write: capture and edits route through Breadboard proposals.
export const GBRAIN_TOOLS = [
  "gbrain_status",
  "gbrain_search",
  "gbrain_retrieve",
  "gbrain_synthesize",
  "gbrain_graph_neighbors",
] as const;

export const ARTIFACT_TOOLS = [
  "artifact_create",
  "artifact_read",
  "artifact_update",
  "artifact_append",
  "artifact_render",
  "artifact_finalize",
  "artifact_list",
  "artifact_fork",
] as const;

export type GardenToolName = (typeof GARDEN_TOOLS)[number];

/** Tools whose invocation produces a typed proposal rather than a mutation. */
export const PROPOSAL_TOOLS: readonly string[] = [
  "garden_create_note_proposal",
  "garden_propose_page_revision",
  "garden_propose_visualization",
];

export function allowedToolsForSurface(surface: OpenHarnessSurface): string[] {
  // GBrain knowledge tools are added ONLY for authenticated Garden Chat and
  // Terminal, and only when GBrain is enabled. Quartz AI never receives them.
  const gbrain = isGBrainEnabled() ? [...GBRAIN_TOOLS] : [];
  if (surface === "garden_chat") return [...GARDEN_TOOLS, ...ARTIFACT_TOOLS, ...gbrain];
  if (surface === "quartz_ai") return [...QUARTZ_TOOLS];
  // The dashboard terminal's tools are governed by the OpenHarness agent config
  // and per-action permission prompts, not by a fixed Breadboard allowlist.
  return [
    ...GARDEN_TOOLS,
    ...ARTIFACT_TOOLS,
    ...gbrain,
    "terminal_execute_command",
    "capability_gap",
    "capability_search",
  ];
}

export function isProposalTool(tool: string): boolean {
  return PROPOSAL_TOOLS.includes(tool);
}
