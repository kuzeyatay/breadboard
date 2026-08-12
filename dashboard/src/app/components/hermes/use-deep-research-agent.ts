"use client";

// Deep Research activation + launch, shared by every chat host so the agent
// behaves identically wherever it is used: select it in the Agents tab, prompt
// it in chat, and the answer arrives as an inline run card in the transcript.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  deepResearchUserMessage,
  parseResearchRequest,
  taskFromDeepResearchCommand,
  type ResearchRequest,
} from "@/lib/deep-research/identity.ts";
import { loadAgentSettings } from "@/lib/agent-settings/client.ts";
import { deepResearchDefaults } from "@/lib/agent-settings/defaults.ts";
import type { AgentMessage } from "./use-agent-session";

export interface DeepResearchAgent {
  id: string;
  name: string;
}

const AGENT: DeepResearchAgent = { id: "deep-research", name: "Deep Research" };

interface SessionLike {
  sessionId?: string | null;
  messages?: readonly AgentMessage[];
  previewExternalAgentTurn: (input: {
    clientMessageId: string;
    userContent: string;
    branchGroupId?: string;
  }) => string;
  appendExternalAgentTurn: (input: {
    clientMessageId: string;
    userContent: string;
    assistantContent?: string;
    run?: {
      kind: "deep_research";
      runId: string;
      query: string;
      output: "report" | "answer";
    };
    outcome?: "running" | "completed" | "failed" | "aborted";
    branchGroupId?: string;
    attachToExistingTurn?: boolean;
  }) => Promise<void>;
}

export interface DeepResearchLaunchOptions {
  branchGroupId?: string;
}

const ERROR_TEXT: Record<string, string> = {
  deep_research_disabled: "Deep Research is disabled (DEEP_RESEARCH_MODE=disabled).",
  service_unavailable:
    "Breadboard could not start the local research service. Check the Deep Research checkout and try again.",
  service_misconfigured:
    "The dashboard and the research service do not share a secret (DEEP_RESEARCH_SECRET).",
  search_not_configured:
    "No search backend is configured. Set CHATMOCK_BASE_URL to use ChatMock's built-in web search.",
  model_not_configured: "The research service has no model configured. Check CHATMOCK_BASE_URL.",
  too_many_runs: "The service is already running its maximum number of research runs.",
  rate_limited: "Too many research runs started recently. Try again later.",
  invalid_query: "Add a research question after the command.",
};

function explain(code: string | undefined, fallback: string): string {
  if (!code) return fallback;
  return ERROR_TEXT[code] ?? fallback;
}

export function useDeepResearchAgent(session: SessionLike, onStatus?: (message: string) => void) {
  const [agent, setAgent] = useState<DeepResearchAgent | null>(null);
  const [launching, setLaunching] = useState(false);
  const launchingRef = useRef(false);
  const restoredConversationRef = useRef<string | null>(null);

  // External-agent selection is conversation state from the user's point of
  // view. Rehydrate it from the latest durable user turn after a restart or
  // history switch; otherwise a plain follow-up silently falls back to the
  // normal runtime.
  useEffect(() => {
    const conversationId = session.sessionId ?? null;
    if (!conversationId) {
      if (restoredConversationRef.current !== null) {
        restoredConversationRef.current = null;
        setAgent(null);
      }
      return;
    }
    const transcript = session.messages;
    if (!transcript?.length || restoredConversationRef.current === conversationId) {
      return;
    }
    restoredConversationRef.current = conversationId;
    const latestUser = [...transcript].reverse().find((message) => message.role === "user");
    setAgent(
      latestUser && taskFromDeepResearchCommand(latestUser.content) !== null
        ? AGENT
        : null,
    );
  }, [session.messages, session.sessionId]);

  /** Activating checks the service so an unusable agent says so up front. */
  const select = useCallback(async (): Promise<DeepResearchAgent | null> => {
    onStatus?.("");
    setAgent(AGENT);
    // Warm the settings cache while the person is still typing, so the launch
    // itself never waits on it.
    void loadAgentSettings("deep-research");
    try {
      const response = await fetch("/api/deep-research/health");
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        runtimeState?: string;
        health?: { search?: { backend?: string | null } };
      };
      if (!response.ok) {
        onStatus?.(explain(data.error, "Deep Research is unavailable."));
      } else if (data.runtimeState !== "available") {
        onStatus?.(
          data.runtimeState === "misconfigured"
            ? "Deep Research selected, but the service is misconfigured — a run will be refused until it is fixed."
            : `Deep Research selected, but the service is ${data.runtimeState ?? "unavailable"}.`,
        );
      }
    } catch {
      onStatus?.("Deep Research is unavailable.");
    }
    return AGENT;
  }, [onStatus]);

  const clear = useCallback(() => setAgent(null), []);

  /**
   * A prompt sent while Deep Research is active becomes a real run: the user
   * message and a run card are appended to the transcript, and the card streams
   * the run's progress, learnings, sources, and final report.
   */
  const launch = useCallback(
    async (task: string, options: DeepResearchLaunchOptions = {}) => {
      // React state updates do not synchronously lock the callback. Keep the
      // authoritative launch lock in a ref so duplicate submit events from the
      // same render cannot create two runs.
      if (launchingRef.current) return;
      launchingRef.current = true;
      setLaunching(true);
      onStatus?.("");
      // The saved defaults, then the flags in this message on top of them. The
      // lookup is cached per page and falls back to the shipped defaults, so it
      // cannot delay or fail a launch.
      const request: ResearchRequest = parseResearchRequest(
        task,
        deepResearchDefaults(await loadAgentSettings("deep-research")),
      );
      let clientMessageId = crypto.randomUUID();
      const userContent = deepResearchUserMessage(task);
      clientMessageId = session.previewExternalAgentTurn({
        clientMessageId,
        userContent,
        branchGroupId: options.branchGroupId,
      });

      if (!request.query) {
        try {
          await session.appendExternalAgentTurn({
            clientMessageId,
            userContent,
            assistantContent: ERROR_TEXT.invalid_query,
            outcome: "failed",
            branchGroupId: options.branchGroupId,
          });
        } catch (cause) {
          onStatus?.(
            cause instanceof Error
              ? cause.message
              : "The Deep Research turn could not be saved.",
          );
        }
        launchingRef.current = false;
        setLaunching(false);
        return;
      }

      let runStarted = false;
      try {
        const response = await fetch("/api/deep-research/runs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(request),
        });
        const data = (await response.json().catch(() => ({}))) as {
          error?: string;
          run?: { runId?: string };
        };
        if (!response.ok || !data.run?.runId) {
          throw new Error(explain(data.error, "The research run could not start."));
        }
        const run = {
          runId: String(data.run.runId),
          query: request.query,
          output: request.output,
        };
        const assistantMessage: AgentMessage = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: "",
          deepResearchRun: {
            ...run,
          },
        };
        const deepResearchRun = assistantMessage.deepResearchRun!;
        runStarted = true;
        await session.appendExternalAgentTurn({
          clientMessageId,
          userContent,
          run: {
            kind: "deep_research",
            ...deepResearchRun,
          },
          branchGroupId: options.branchGroupId,
        });
      } catch (cause) {
        if (runStarted) {
          onStatus?.(
            cause instanceof Error
              ? cause.message
              : "The research run started, but its chat turn could not be saved.",
          );
          return;
        }
        const assistantContent =
          cause instanceof Error ? cause.message : "The research run could not start.";
        try {
          await session.appendExternalAgentTurn({
            clientMessageId,
            userContent,
            assistantContent,
            outcome: "failed",
            branchGroupId: options.branchGroupId,
          });
        } catch (persistenceError) {
          onStatus?.(
            persistenceError instanceof Error
              ? persistenceError.message
              : "The Deep Research turn could not be saved.",
          );
        }
      } finally {
        launchingRef.current = false;
        setLaunching(false);
      }
    },
    [onStatus, session],
  );

  return { agent, select, clear, launch, launching };
}
