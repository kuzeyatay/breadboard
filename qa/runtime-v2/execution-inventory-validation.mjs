const RUNTIME_V2_CURRENT_STATE =
  /(?:^|;)runtime[_-]v2_(?!incompatible(?:[;_\-]|$))/i;
const NOT_MIGRATED_CURRENT_STATE = /(?:not[_-]migrated|not[_-]cut[_-]over)/i;

export const GBRAIN_NODE_EXECUTABLE_RUNTIME =
  "Bundled Node 24 TypeScript adapter with a checked-in compatibility loader, GBrain backend, and ChatMock embeddings";
export const GBRAIN_NODE_ROOT_COMMAND =
  "runtimes/node/node.exe --no-warnings --experimental-transform-types gbrain-adapter/src/node-entrypoint.mjs";

/**
 * A future Runtime V2 target or incompatibility note is not a cutover.
 * Once current ownership is described as Runtime V2, capability reconciliation
 * fails closed unless that same state explicitly says it is not cut over.
 */
export function isRuntimeV2MigratedInventoryEntry(entry) {
  const state = typeof entry?.current_state === "string" ? entry.current_state : "";
  return RUNTIME_V2_CURRENT_STATE.test(state) && !NOT_MIGRATED_CURRENT_STATE.test(state);
}

export function unreconciledMigratedCapabilityIds(entry, knownCapabilityIds) {
  if (!isRuntimeV2MigratedInventoryEntry(entry)) return [];
  const ids = Array.isArray(entry?.capability_ids) ? entry.capability_ids : [];
  return ids.filter((capabilityId) => !knownCapabilityIds.has(capabilityId));
}
