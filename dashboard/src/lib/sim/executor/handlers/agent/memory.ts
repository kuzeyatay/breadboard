// Vendored from simstudioai/sim (Apache-2.0) — apps/sim/executor/handlers/agent/memory.ts; adapted for Breadboard.
// Sim's agent memory persists conversations in Postgres per workspace. Breadboard
// runs the engine headless without that store, so memory is inert: reads return
// nothing and writes are dropped. Conversation state lives in Breadboard's own
// conversation tables, outside the workflow engine.

import type { AgentInputs, Message } from '@/lib/sim/executor/handlers/agent/types'
import type { ExecutionContext } from '@/lib/sim/executor/types'

export class Memory {
  async fetchMemoryMessages(_ctx: ExecutionContext, _inputs: AgentInputs): Promise<Message[]> {
    return []
  }

  async appendToMemory(
    _ctx: ExecutionContext,
    _inputs: AgentInputs,
    _message: Message
  ): Promise<void> {}

  async seedMemory(
    _ctx: ExecutionContext,
    _inputs: AgentInputs,
    _messages: Message[]
  ): Promise<void> {}
}

export const memoryService = new Memory()
