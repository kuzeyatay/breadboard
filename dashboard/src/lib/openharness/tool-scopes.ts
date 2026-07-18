// Per-surface tool allowlists.
//
// These are the curated Breadboard tools each surface's agent may use. They are
// enforced in two places: the OpenHarness agent permission config (defense at
// the runtime), and the capability token minted by the gateway (defense at the
// data boundary). A garden or Quartz agent can never be granted shell, file
// editing, git, package installation, or dynamic skill discovery — those names
// are simply absent from its allowlist, and its agent config denies them.

import type { OpenHarnessSurface } from "./config.ts";

// Read-only + proposal Breadboard tools for garden chat.
export const GARDEN_TOOLS = [
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

export type GardenToolName = (typeof GARDEN_TOOLS)[number];

/** Tools whose invocation produces a typed proposal rather than a mutation. */
export const PROPOSAL_TOOLS: readonly string[] = [
  "garden_create_note_proposal",
  "garden_propose_page_revision",
  "garden_propose_visualization",
];

export function allowedToolsForSurface(surface: OpenHarnessSurface): string[] {
  if (surface === "garden_chat") return [...GARDEN_TOOLS];
  if (surface === "quartz_ai") return [...QUARTZ_TOOLS];
  // The dashboard terminal's tools are governed by the OpenHarness agent config
  // and per-action permission prompts, not by a fixed Breadboard allowlist.
  return ["capability_gap", "capability_search"];
}

export function isProposalTool(tool: string): boolean {
  return PROPOSAL_TOOLS.includes(tool);
}
