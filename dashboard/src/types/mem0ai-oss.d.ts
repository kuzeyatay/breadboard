// Minimal ambient types for the vendored mem0 OSS bundle (mem0/mem0-ts).
//
// The clone's own .d.ts build needs ~25 optional provider SDKs installed just
// to typecheck (each provider statically imports its SDK's types), so the
// dashboard declares only the surface lib/mem0/client.ts actually uses. The
// runtime code is the clone's real built bundle, not a reimplementation.

declare module "mem0ai/oss" {
  export interface Mem0Message {
    role: "user" | "assistant" | "system";
    content: string;
  }

  export interface Mem0Item {
    id: string;
    memory: string;
    score?: number;
    metadata?: Record<string, unknown>;
  }

  export interface Mem0SearchResult {
    results: Mem0Item[];
  }

  export class Memory {
    constructor(config?: Record<string, unknown>);
    add(
      messages: string | Mem0Message[],
      options: Record<string, unknown>,
    ): Promise<Mem0SearchResult>;
    search(
      query: string,
      options: Record<string, unknown>,
    ): Promise<Mem0SearchResult>;
    getAll(options: Record<string, unknown>): Promise<Mem0SearchResult>;
    update(
      memoryId: string,
      data: string | Record<string, unknown>,
    ): Promise<{ message: string }>;
    delete(memoryId: string): Promise<{ message: string }>;
    reset(): Promise<void>;
  }
}
