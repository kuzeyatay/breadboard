// The pages a delegated research run read, attached to its evidence entry.
//
// A hand-back turn queues nothing and calls no tool, so its evidence rows are
// empty and the panel can only report "no sources" about an answer built
// entirely out of pages a worker read. The launch record names the agent; the
// run id lives on the external-agent turn that launch created, and the service
// holds what that run actually visited.
//
// Kept out of turn-service so it can be exercised on its own. The first version
// lived inline and read the run id from the wrong metadata key, which returns
// the calls untouched and renders nothing — a failure with no error and no
// symptom except an absence, and exactly the kind a test has to be able to
// reach.

import { parseExternalAgentRun } from "./external-agent-runs.ts";
import { DEEP_RESEARCH_AGENT_ID } from "../deep-research/identity.ts";
import type { EvidenceWebsite, ExternalAgentCall } from "../hermes/evidence.ts";

/** Just enough of a stored row to find a run on it. */
export interface RunBearingMessage {
  role: string;
  metadata?: string | null;
}

/**
 * The newest Deep Research run id in a conversation.
 *
 * `externalAgentRun` is the key the turn writer stores under. `deepResearchRun`
 * is the client-facing field the presenter maps it onto, and they are easy to
 * confuse — so the stored one is read here, directly, with the presentation
 * layer left out of it entirely.
 */
export function latestDeepResearchRunId(
  messages: readonly RunBearingMessage[],
): string | null {
  // Newest first: a conversation can hold several runs, and the one being
  // reported is the one that just finished.
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.role !== "assistant" || !message.metadata) continue;
    let metadata: Record<string, unknown>;
    try {
      metadata = JSON.parse(message.metadata) as Record<string, unknown>;
    } catch {
      continue;
    }
    const run = parseExternalAgentRun(metadata.externalAgentRun);
    if (run?.kind === "deep_research") return run.runId;
  }
  return null;
}

/** Injected so a test never has to stand up the loopback service. */
export type WebsiteFetcher = (
  userId: number,
  runId: string,
) => Promise<EvidenceWebsite[]>;

async function defaultFetcher(
  userId: number,
  runId: string,
): Promise<EvidenceWebsite[]> {
  // Imported at call time: the service module reaches the database and the
  // loopback client, and a turn that delegated nothing should pay for neither.
  const { runWebsites } = await import("../deep-research/service.ts");
  return runWebsites(userId, runId);
}

/**
 * Attach a delegated run's sources to its evidence entry.
 *
 * Best-effort by construction. A slow, restarted, or disabled service costs the
 * turn nothing and leaves the entry as it was — the answer is already written
 * by this point, and provenance is worth waiting for only so long.
 */
export async function withDelegatedResearchSources(
  calls: readonly ExternalAgentCall[],
  context: {
    userId: number;
    messages: readonly RunBearingMessage[];
    fetchWebsites?: WebsiteFetcher;
  },
): Promise<ExternalAgentCall[]> {
  const list = [...calls];
  if (!list.some((call) => call.agentId === DEEP_RESEARCH_AGENT_ID)) return list;

  const runId = latestDeepResearchRunId(context.messages);
  if (!runId) return list;

  const fetchWebsites = context.fetchWebsites ?? defaultFetcher;
  const websites = await fetchWebsites(context.userId, runId).catch(() => []);
  if (!websites.length) return list;

  return list.map((call) =>
    call.agentId === DEEP_RESEARCH_AGENT_ID ? { ...call, websites } : call,
  );
}
