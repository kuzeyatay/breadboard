// Vendored from simstudioai/sim (Apache-2.0) — packages/workflow-types/src/workflow.ts (handle-id subset); adapted for Breadboard.
// Minimal local copy of the handle-id contract the renderer views depend on,
// so the vendored views compile independently of the engine's vendored types.

export const WORKFLOW_CARD_SIDES = ["top", "right", "bottom", "left"] as const;
export type WorkflowCardSide = (typeof WORKFLOW_CARD_SIDES)[number];

export const WORKFLOW_CONNECTION_SIDES = ["left", "right"] as const;
export type WorkflowConnectionSide = (typeof WORKFLOW_CONNECTION_SIDES)[number];

/** Canonical source handle id persisted on edges. */
export const WORKFLOW_SOURCE_HANDLE_ID = "source";
/** Canonical target handle id persisted on edges. */
export const WORKFLOW_TARGET_HANDLE_ID = "target";
/** Error-output source handle id. */
export const WORKFLOW_ERROR_HANDLE_ID = "error";

/** Maps a legacy/null source handle onto the canonical source id. */
export function normalizeWorkflowEdgeSourceHandle(handle: string | null | undefined): string {
  if (!handle || handle === "sourceHandle") return WORKFLOW_SOURCE_HANDLE_ID;
  return handle;
}

/** Maps a legacy/null target handle onto the canonical target id. */
export function normalizeWorkflowEdgeTargetHandle(handle: string | null | undefined): string {
  if (!handle || handle === "targetHandle") return WORKFLOW_TARGET_HANDLE_ID;
  return handle;
}
