import "server-only";
import type { ConversationRow } from "../conversations/store.ts";
import { selectedModelForUser } from "../selected-model.ts";
import { agentSettingsFor } from "../agent-settings/store.ts";
import { deepResearchDefaults } from "../agent-settings/defaults.ts";
import type { ExternalAgentRun } from "../conversations/external-agent-runs.ts";
import { parseExternalAgentRun } from "../conversations/external-agent-runs.ts";
import { ROOM_RUNTIME_IDS } from "./runtime-catalog.ts";

type RoomRuntimeId = typeof ROOM_RUNTIME_IDS[number];
type Event = { type: string; payload: Record<string, unknown>; sequenceNumber: number };
type Adapter = {
  field: string;
  start: () => Promise<{ POST: (request: Request) => Promise<Response> }>;
  events: (userId: number, runId: string, since: number) => Promise<readonly Event[]>;
};
// Invoke the established authenticated route, retaining its validation, settings,
// workspace restrictions and tool permissions. Never dispatch an arbitrary URL.
const adapters: Record<RoomRuntimeId, Adapter> = {
  "agent-reach": { field: "task", start: () => import("@/app/api/agent-reach/runs/route.ts"), events: async (user, run, since) => (await import("../agent-reach/run-manager.ts")).getEventsSince(user, run, since) },
  "bolt-slides": { field: "brief", start: () => import("@/app/api/bolt-slides/runs/route.ts"), events: async (user, run, since) => (await import("../bolt-slides/runtime-run-manager.ts")).getEventsSince(user, run, since) },
  "parametric-cad": { field: "brief", start: () => import("@/app/api/cad/runs/route.ts"), events: async (user, run, since) => (await import("../cad/runtime-run-manager.ts")).getEventsSince(user, run, since) },
  "career-ops": { field: "task", start: () => import("@/app/api/career-ops/runs/route.ts"), events: async (user, run, since) => (await import("../career-ops/run-manager.ts")).getEventsSince(user, run, since) },
  "classroom": { field: "brief", start: () => import("@/app/api/classroom/runs/route.ts"), events: async (user, run, since) => (await import("../classroom/run-manager.ts")).getEventsSince(user, run, since) },
  "codex": { field: "task", start: () => import("@/app/api/codex/runs/route.ts"), events: async (user, run, since) => (await import("../codex/run-manager.ts")).getEventsSince(user, run, since) },
  "deep-research": { field: "query", start: () => import("@/app/api/deep-research/runs/route.ts"), events: async (user, run, since) => (await import("../deep-research/runtime-run-manager.ts")).getEventsSince(user, run, since) },
  "deep-tutor": { field: "task", start: () => import("@/app/api/deep-tutor/runs/route.ts"), events: async (user, run, since) => (await import("../deep-tutor/run-manager.ts")).getEventsSince(user, run, since) },
  "deer-flow": { field: "task", start: () => import("@/app/api/deer-flow/runs/route.ts"), events: async (user, run, since) => (await import("../deer-flow/runtime-run-manager.ts")).getEventsSince(user, run, since) },
  "get-doc": { field: "task", start: () => import("@/app/api/get-doc/runs/route.ts"), events: async (user, run, since) => (await import("../get-doc/runtime-run-manager.ts")).getEventsSince(user, run, since) },
  "gods-eye": { field: "task", start: () => import("@/app/api/gods-eye/runs/route.ts"), events: async (user, run, since) => (await import("../gods-eye/run-manager.ts")).getEventsSince(user, run, since) },
  "hardware-blueprint": { field: "brief", start: () => import("@/app/api/hardware-blueprint/runs/route.ts"), events: async (user, run, since) => (await import("../hardware/runtime-run-manager.ts")).getEventsSince(user, run, since) },
  "hyperframes": { field: "brief", start: () => import("@/app/api/hyperframes/runs/route.ts"), events: async (user, run, since) => (await import("../hyperframes/runtime-run-manager.ts")).getEventsSince(user, run, since) },
  "inbox-zero": { field: "task", start: () => import("@/app/api/inbox-zero/runs/route.ts"), events: async (user, run, since) => (await import("../inbox-zero/runtime-run-manager.ts")).getEventsSince(user, run, since) },
  "matraix": { field: "brief", start: () => import("@/app/api/matraix/runs/route.ts"), events: async (user, run, since) => (await import("../matraix/runtime-run-manager.ts")).getEventsSince(user, run, since) },
  "max-research": { field: "question", start: () => import("@/app/api/max-research/runs/route.ts"), events: async (user, run, since) => (await import("../max-research/runtime-run-manager.ts")).getEventsSince(user, run, since) },
  "money-printer": { field: "brief", start: () => import("@/app/api/money-printer/runs/route.ts"), events: async (user, run, since) => (await import("../money-printer/runtime-run-manager.ts")).getEventsSince(user, run, since) },
  "music-producer": { field: "task", start: () => import("@/app/api/music-producer/runs/route.ts"), events: async (user, run, since) => (await import("../music-producer/run-manager.ts")).getEventsSince(user, run, since) },
  "opencode": { field: "task", start: () => import("@/app/api/opencode/runs/route.ts"), events: async (user, run, since) => (await import("../opencode/run-manager.ts")).getEventsSince(user, run, since) },
  "openexecutive": { field: "task", start: () => import("@/app/api/openexecutive/runs/route.ts"), events: async (user, run, since) => (await import("../openexecutive/run-manager.ts")).getEventsSince(user, run, since) },
  "openmontage": { field: "brief", start: () => import("@/app/api/openmontage/runs/route.ts"), events: async (user, run, since) => (await import("../openmontage/runtime-run-manager.ts")).getEventsSince(user, run, since) },
  "openplanter": { field: "task", start: () => import("@/app/api/openplanter/runs/route.ts"), events: async (user, run, since) => (await import("../openplanter/runtime-run-manager.ts")).getEventsSince(user, run, since) },
  "openscience": { field: "task", start: () => import("@/app/api/openscience/runs/route.ts"), events: async (user, run, since) => (await import("../openscience/runtime-run-manager.ts")).getEventsSince(user, run, since) },
  "openwork": { field: "task", start: () => import("@/app/api/openwork/runs/route.ts"), events: async (user, run, since) => (await import("../openwork/runtime-run-manager.ts")).getEventsSince(user, run, since) },
  "praxist": { field: "task", start: () => import("@/app/api/praxist/runs/route.ts"), events: async (user, run, since) => (await import("../praxist/run-manager.ts")).getEventsSince(user, run, since) },
  "resource2skill": { field: "brief", start: () => import("@/app/api/resource2skill/runs/route.ts"), events: async (user, run, since) => (await import("../resource2skill/runtime-run-manager.ts")).getEventsSince(user, run, since) },
  "ruflo": { field: "task", start: () => import("@/app/api/ruflo/runs/route.ts"), events: async (user, run, since) => (await import("../ruflo/run-manager.ts")).getEventsSince(user, run, since) },
  "socials-manager": { field: "brief", start: () => import("@/app/api/socials-manager/runs/route.ts"), events: async (user, run, since) => (await import("../socials-manager/runtime-run-manager.ts")).getEventsSince(user, run, since) },
  "stock-analyst": { field: "task", start: () => import("@/app/api/stock-analyst/runs/route.ts"), events: async (user, run, since) => (await import("../stock-analyst/runtime-run-manager.ts")).getEventsSince(user, run, since) },
  "vibe-trading": { field: "task", start: () => import("@/app/api/vibe-trading/runs/route.ts"), events: async (user, run, since) => (await import("../vibe-trading/runtime-run-manager.ts")).getEventsSince(user, run, since) },
  "vimax": { field: "brief", start: () => import("@/app/api/vimax/runs/route.ts"), events: async (user, run, since) => (await import("../vimax/runtime-run-manager.ts")).getEventsSince(user, run, since) },
  "vox-director": { field: "brief", start: () => import("@/app/api/vox-director/runs/route.ts"), events: async (user, run, since) => (await import("../vox-director/runtime-run-manager.ts")).getEventsSince(user, run, since) },
};

export async function startRoomRuntime(input: {
  agentId: string; request: Request; userId: number; conversation: ConversationRow;
  clientMessageId: string; task: string; model?: string | null;
}): Promise<ExternalAgentRun> {
  const adapter = adapters[input.agentId as RoomRuntimeId];
  if (!adapter) throw new Error("This agent needs its own input form in chat.");
  const body = {
    [adapter.field]: input.task,
    model: input.model || selectedModelForUser(input.userId), reasoningEffort: "medium",
    conversationPublicId: input.conversation.public_id, conversationId: input.conversation.public_id,
    clientMessageId: input.clientMessageId, userContent: input.task,
    ...(input.agentId === "deep-research" ? deepResearchDefaults(agentSettingsFor(input.userId, "deep-research")) : {}),
  };
  const response = await (await adapter.start()).POST(new Request(input.request.url, {
    method: "POST", headers: new Headers(input.request.headers), body: JSON.stringify(body),
  }));
  const result = await response.json() as { error?: string; message?: string; run?: { runId?: string; id?: string; gardenSlug?: string; repository?: string }; request?: { capability?: string } };
  if (!response.ok) throw new Error(result.message || result.error || "The agent could not start.");
  const runId = result.run?.runId ?? result.run?.id;
  const descriptor = parseExternalAgentRun({ ...result.run, kind: input.agentId.replaceAll("-", "_"), runId, task: input.task, query: input.task, brief: input.task, output: "output" in body ? body.output : "report", capability: result.request?.capability ?? "ask" });
  if (!descriptor) throw new Error("The agent did not return a recoverable run.");
  return descriptor;
}

export async function roomRuntimeEvents(agentId: string, userId: number, runId: string, since = 0) {
  const adapter = adapters[agentId as RoomRuntimeId];
  if (!adapter) throw new Error("Unknown room agent.");
  return adapter.events(userId, runId, since);
}

export { runtimeOutput } from "./runtime-output.ts";
