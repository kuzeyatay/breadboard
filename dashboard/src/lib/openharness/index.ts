// Server-only barrel for the OpenHarness integration. Import from
// `@/lib/openharness` in route handlers and server modules. Never import this
// (or anything under it) into a client component — it reaches OpenHarness
// credentials, the DB, and Node built-ins.

export * from "./config.ts";
export * from "./events.ts";
export * from "./capability-token.ts";
export * from "./workspace.ts";
export * from "./tool-scopes.ts";
export { OpenHarnessError } from "./client.ts";
export type { OpenHarnessAgent, OpenHarnessModel, OpenHarnessHealth } from "./client.ts";
export {
  OpenHarnessGateway,
  getOpenHarnessGateway,
  resetOpenHarnessGateway,
  type AgentSession,
  type CreateAgentSessionInput,
  type SendAgentMessageInput,
  type PermissionResponseInput,
} from "./gateway.ts";
export * from "./runtime-store.ts";
