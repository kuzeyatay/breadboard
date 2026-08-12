// Client-safe shapes for the Processes overview. The server deliberately
// projects only the small amount of operational data the overview renders.

import type { HermesSurface } from "@/lib/hermes/config.ts";

export interface ActiveChatProcess {
  id: string;
  conversationId: string;
  title: string;
  instruction: string;
  surface: HermesSurface;
  gardenId: string | null;
  pageSlug: string | null;
  startedAt: string;
}

export interface TrackedBreadboardProcess {
  id: string;
  title: string;
  description: string | null;
  kind: "agent" | "scheduled_run";
  startedAt: string;
  updatedAt: string;
  sourceUrl: string | null;
}

export interface ProcessSchedule {
  id: number;
  title: string;
  enabled: boolean;
  cadence: string;
  target: string;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastStatus: "ok" | "failed" | null;
}

export interface ProcessHook {
  id: string;
  title: string;
  event: string;
  enabled: boolean;
}

export interface ProcessesSnapshot {
  activeChats: ActiveChatProcess[];
  activeProcesses: TrackedBreadboardProcess[];
  schedules: ProcessSchedule[];
  hooks: ProcessHook[];
  generatedAt: string;
}
