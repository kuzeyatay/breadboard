// Server code invokes the same validated handlers as the UI. No HTTP header,
// cookie, tool argument or query string can manufacture this principal.
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";

export interface SwarmInvocation {
  userId: number;
  agentId: string;
  requestId: string;
  conversationPublicId: string;
}
const state = globalThis as typeof globalThis & { __breadboardSwarmInvocation?: AsyncLocalStorage<SwarmInvocation> };
const context = state.__breadboardSwarmInvocation ??= new AsyncLocalStorage<SwarmInvocation>();

export function withSwarmInvocation<T>(value: SwarmInvocation, action: () => T): T {
  if (typeof window !== "undefined") throw new Error("Team dispatch is server-only.");
  return context.run(Object.freeze({ ...value }), action);
}
export function currentSwarmInvocation(): SwarmInvocation | undefined { return context.getStore(); }

export function swarmRuntimeIdentity(value: SwarmInvocation, scopePrefix: string, jobType: string) {
  return {
    authority: { userId: value.userId, gardenId: null,
      conversationId: `${scopePrefix}_${createHash("sha256").update(value.requestId).digest("hex").slice(0, 32)}` },
    idempotencyKey: `${jobType}-v2:${value.userId}:${value.requestId}`,
  };
}
