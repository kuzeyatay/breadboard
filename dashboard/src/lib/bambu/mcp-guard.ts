/** Reserve the audited printer MCP for Breadboard's private adapter service.
 * Generic MCP approval/YOLO cannot grant its physical operations. */
export function isUnguardedBambuConnection(connection: { slug?: string; displayName?: string; config?: unknown }): boolean {
  return /bambu|bblp|bambu-printer-mcp/i.test(`${connection.slug ?? ""} ${connection.displayName ?? ""} ${JSON.stringify(connection.config ?? {})}`);
}
export function assertGuardedPrinterMcp(connection: { slug?: string; displayName?: string; config?: unknown }) {
  if (isUnguardedBambuConnection(connection)) throw Object.assign(new Error("Use the Bambu Lab connection and its print-review card. Unguarded printer MCP servers cannot be exposed to agents."), { status: 403, code: "bambu_guarded_workflow_required" });
}
