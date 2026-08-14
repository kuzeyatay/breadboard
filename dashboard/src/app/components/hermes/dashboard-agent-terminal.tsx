"use client";

// The dashboard terminal keeps the original Breadboard dock, history sidebar,
// and paper styling while the selected agent adapter owns the runtime,
// streaming events, permissions, tools, persistence, and skill review.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import KnowledgeTerminal from "@/app/components/knowledge-terminal";
import { useAssistantIntelligence } from "@/app/components/use-assistant-intelligence";
import { isSuperAgentEnabled } from "@/app/components/use-agent-mode";
import { interactiveVisualizerCommandForArtifact } from "@/lib/hermes/interactive-visualizer-skills";
import AgentRuntimePanel from "./agent-runtime-panel";
import { ArtifactDockHostProvider } from "./artifact-dock-host";
import ArtifactPanel, {
  ARTIFACT_REVISE_EVENT,
} from "./artifact-panel";
import GBrainStatusBadge from "./gbrain-status-badge";
import { chatSessionIsActive, deleteChatSession } from "./history-client";
import {
  invalidateHermesSessionSummaries,
  HERMES_SESSIONS_CHANGED_EVENT,
  loadHermesSessionSummaries,
  type HermesSessionSnapshot,
} from "@/lib/hermes/session-client";
import TerminalSidebar, { type TerminalPanel, type TerminalSidebarChat } from "./terminal-sidebar";
import ChatSearchDialog from "./chat-search-dialog";
import UploadsPanel from "./uploads-panel";
import TerminalScheduledPanel from "./terminal-scheduled-panel";
import HooksPanel from "./hooks-panel";
import ProcessesPanel from "./processes-panel";
import {
  useAgentSession,
  type AgentMessage,
  type ExternalAgentTurnResult,
} from "./use-agent-session";
import { externalAgentCardContent } from "@/lib/conversations/external-agent-runs";
import { useWorkflowAutomation } from "./use-workflow-automation";
import { useAssistantModels } from "../use-assistant-models";
import { useLiquidGlassBar } from "./use-liquid-glass-bar";
import {
  TERMINAL_ATTACHMENT_ACCEPT,
  chatMessageAttachments,
  extractChatAttachments,
  reusableChatAttachments,
  type ChatAttachment,
} from "@/lib/chat-attachments";
import { distillAttachments } from "@/lib/document-skills/client";
import {
  agentBrowserUserMessage,
  taskFromAgentBrowserCommand,
} from "@/lib/agent-browser/identity.ts";
import {
  AGENT_REACH_AGENT_ID,
  AGENT_REACH_AGENT_NAME,
  agentReachUserMessage,
  taskFromAgentReachCommand,
} from "@/lib/agent-reach/identity.ts";
import {
  CAREER_OPS_AGENT_ID,
  CAREER_OPS_AGENT_NAME,
  careerOpsUserMessage,
  taskFromCareerOpsCommand,
} from "@/lib/career-ops/identity.ts";
import {
  TRADINGAGENTS_AGENT_ID,
  TRADINGAGENTS_AGENT_NAME,
  parseTradingAgentsCommand,
  tradingAgentsRunLabel,
  tradingAgentsUserMessage,
  type TradingAgentsRequest,
} from "@/lib/tradingagents/identity.ts";
import {
  SHORTS_AGENT_ID,
  SHORTS_AGENT_NAME,
  parseShortsCommand,
  shortsRunLabel,
  shortsUserMessage,
  type ShortsRequest,
} from "@/lib/shorts/identity.ts";
import {
  FORMSMITH_AGENT_ID,
  FORMSMITH_AGENT_NAME,
  formsmithRunLabel,
  formsmithUserMessage,
  isFormsmithCommand,
  type FormsmithRequest,
} from "@/lib/shaper/identity.ts";
import {
  taskFromVideoUseCommand,
  videoEditIntent,
  videoUseRunLabel,
  videoUseUserMessage,
} from "@/lib/video-use/identity.ts";
import { firstVideoSource } from "@/lib/video-sources/identity.ts";
import {
  VIBE_TRADING_AGENT_ID,
  VIBE_TRADING_AGENT_NAME,
  taskFromVibeTradingCommand,
  vibeTradingUserMessage,
} from "@/lib/vibe-trading/identity.ts";
import {
  STOCK_ANALYST_AGENT_ID,
  STOCK_ANALYST_AGENT_NAME,
  taskFromStockAnalystCommand,
  stockAnalystUserMessage,
} from "@/lib/stock-analyst/identity.ts";
import {
  PAPER_TRADER_AGENT_ID,
  PAPER_TRADER_AGENT_NAME,
  taskFromPaperTraderCommand,
  paperTraderUserMessage,
} from "@/lib/paper-trader/identity.ts";
import {
  DEER_FLOW_AGENT_ID,
  DEER_FLOW_AGENT_NAME,
  taskFromDeerFlowCommand,
  deerFlowUserMessage,
} from "@/lib/deer-flow/identity.ts";
import { taskFromDeepResearchCommand } from "@/lib/deep-research/identity.ts";
import {
  MEETING_NOTES_AGENT_ID,
  MEETING_NOTES_AGENT_NAME,
  meetingNotesUserMessage,
  taskFromMeetingNotesCommand,
} from "@/lib/meeting-notes/identity.ts";
import {
  GET_DOC_AGENT_ID,
  GET_DOC_AGENT_NAME,
  getDocUserMessage,
  taskFromGetDocCommand,
} from "@/lib/get-doc/identity.ts";
import {
  DEEP_TUTOR_AGENT_ID,
  DEEP_TUTOR_AGENT_NAME,
  deepTutorUserMessage,
  taskFromDeepTutorCommand,
} from "@/lib/deep-tutor/identity.ts";
import {
  OPENPLANTER_AGENT_ID,
  OPENPLANTER_AGENT_NAME,
  openPlanterUserMessage,
  taskFromOpenPlanterCommand,
} from "@/lib/openplanter/identity.ts";
import { socialsManagerUserMessage, taskFromSocialsManagerCommand } from "@/lib/socials-manager/identity.ts";
import {
  hardwareBlueprintUserMessage,
  taskFromHardwareBlueprintCommand,
} from "@/lib/hardware/identity.ts";
import { briefFromVimaxCommand, vimaxUserMessage } from "@/lib/vimax/identity.ts";
import {
  briefFromMoneyPrinterCommand,
  moneyPrinterUserMessage,
} from "@/lib/money-printer/identity.ts";
import {
  legalRunLabel,
  legalUserMessage,
  taskFromLegalCommand,
} from "@/lib/legal/identity.ts";
import {
  parametricCadUserMessage,
  taskFromParametricCadCommand,
} from "@/lib/cad/identity.ts";
import {
  briefFromHyperframesCommand,
  hyperframesUserMessage,
} from "@/lib/hyperframes/identity.ts";
import {
  briefFromResource2SkillCommand,
  resource2SkillUserMessage,
} from "@/lib/resource2skill/identity.ts";
import {
  briefFromOpenMontageCommand,
  openMontageUserMessage,
} from "@/lib/openmontage/identity.ts";
import {
  openworkUserMessage,
  taskFromOpenworkCommand,
} from "@/lib/openwork/identity.ts";
import {
  openscienceUserMessage,
  taskFromOpenscienceCommand,
} from "@/lib/openscience/identity.ts";
import {
  inboxZeroUserMessage,
  taskFromInboxZeroCommand,
} from "@/lib/inbox-zero/identity.ts";
import { agentTarsUserMessage, taskFromAgentTarsCommand } from "@/lib/ui-tars/identity.ts";
import { useDeepResearchAgent } from "./use-deep-research-agent";
import { useOpenCodeAgent } from "./use-opencode-agent";
import { taskFromOpenCodeCommand } from "@/lib/opencode/identity.ts";
import { useCodexAgent } from "./use-codex-agent";
import { taskFromCodexCommand } from "@/lib/codex/identity.ts";
import { useRufloAgent } from "./use-ruflo-agent";
import { taskFromRufloCommand } from "@/lib/ruflo/identity.ts";
import { findCapabilityConflict } from "@/lib/hermes/capability-combinations.ts";
import {
  MAX_AGENT_LAUNCH_HOPS,
  agentLaunchContinuationMessage,
  useAgentLaunchQueue,
  type AgentLaunchRequestPayload,
} from "./use-agent-launch-queue";
import AgentLaunchPrompt from "./agent-launch-prompt";
import type { ChatTextSelectionReference } from "@/lib/chat-text-selection";

type TerminalScope = "mine" | "public";

interface Props {
  scope: TerminalScope;
  /** Opens a route-owned panel as soon as the terminal mounts. */
  initialPanel?: TerminalPanel | null;
  /**
   * The dashboard wallpaper, so the glass bar can refract the same image the
   * page paints behind it instead of inventing its own backdrop.
   */
  backdropImage?: string | null;
}

interface RuntimeHistorySession {
  id: string;
  title: string;
  updatedAt: string;
  active: boolean;
  pinned: boolean;
  highlight: string | null;
}

const HEIGHT_KEY = "breadboard:knowledge-terminal-height";
const COLLAPSED_HEIGHT = 48;
const MIN_HEIGHT = COLLAPSED_HEIGHT;
const HEALTH_RETRY_DELAY_MS = 3_000;

const SUGGESTED_PROMPTS: Record<TerminalScope, string[]> = {
  mine: [
    "What topics span more than one of my gardens?",
    "Summarize everything I know about a concept across all gardens.",
    "Which gardens should I review before an exam?",
    "Find connections between ideas in different gardens.",
  ],
  public: [
    "What topics show up across multiple public gardens?",
    "Summarize what the public gardens cover about a concept.",
    "Which public gardens are the best starting point for a subject?",
    "Find connections between ideas in different public gardens.",
  ],
};

// The navbar scrolls away with the page, so its viewport-relative bottom turns
// negative once the page is scrolled down. Left unclamped that inflates the
// dock past the viewport: the dock is anchored to the bottom, so the extra
// height pushes the header — the only way to collapse it — above the top edge,
// and the scroll lock below then makes the state unrecoverable.
function navOffset(): number {
  if (typeof document === "undefined") return 64;
  const nav = document.querySelector("nav");
  if (!nav) return 64;
  const bottom = Math.ceil(nav.getBoundingClientRect().bottom);
  return Math.min(Math.max(0, bottom), window.innerHeight);
}

function maxHeight(): number {
  if (typeof window === "undefined") return 720;
  return Math.max(MIN_HEIGHT, Math.round(window.innerHeight - navOffset()));
}

function clampHeight(height: number): number {
  return Math.min(maxHeight(), Math.max(MIN_HEIGHT, Math.round(height)));
}

function defaultOpenHeight(): number {
  return maxHeight();
}

type HealthState = {
  status: "checking" | "runtime" | "disabled" | "unavailable";
  mode: "required" | "preferred" | "legacy";
};

// The selected runtime is server configuration and can be Hermes or Hermes,
// so this stays runtime-neutral: naming Hermes here reported the wrong
// component when a Hermes runtime was the one that was down. No legacy request
// was sent — required mode never silently falls back.
const RUNTIME_UNAVAILABLE_MESSAGE =
  "The agent runtime is required but unavailable. No legacy request was sent.";

// Liquid-glass bar: paused, not removed.
//
// The dock renders its original flat light-brown bar while this is false, and
// nothing below costs anything at runtime — the hook never initialises, so
// neither @ybouane/liquidglass nor html-to-image is even imported. Flip it back
// to true (or set NEXT_PUBLIC_LIQUID_GLASS to anything but "off") to resume.
const LIQUID_GLASS_BAR_ENABLED = false;

// Shader settings for the dock bar, tuned against Breadboard's own palette
// rather than a colourful test page — cream cards on pale green leave very
// little for a lens to bend, so the effect has to come off the rim.
//
// zRadius: the bar is only ~48px tall, so a bevel of half that turns the whole
// cross-section into a lens and the middle over-magnifies into a wash. At 16
// the centre stays a near-flat pane and only the top and bottom edges bend,
// which is where edgeHighlight, specular and the chromatic fringe do their work.
//
// blurAmount is high on purpose. You should never be able to read the page
// through a bar that has its own controls on it — a dark primary button
// scrolling underneath came through as a legible rectangle at low blur. At this
// setting it becomes a soft colour wash, which is what frosted glass does.
const TERMINAL_BAR_GLASS = {
  blurAmount: 0.66,
  refraction: 0.92,
  chromAberration: 0.16,
  edgeHighlight: 0.55,
  specular: 0.6,
  fresnel: 1.0,
  distortion: 0.05,
  cornerRadius: 22,
  zRadius: 16,
  saturation: 0.36,
  brightness: 0.08,
  shadowOpacity: 0.22,
  shadowSpread: 16,
  shadowOffsetY: -2,
};

type VideoUseLaunchSource =
  | Extract<ChatAttachment, { type: "video" }>
  | { name: string; url: string };


export default function DashboardAgentTerminal({
  scope,
  initialPanel = null,
  backdropImage = null,
}: Props) {
  const [health, setHealth] = useState<HealthState>({ status: "checking", mode: "required" });
  const [healthRefreshVersion, setHealthRefreshVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: number | null = null;

    async function checkHealth() {
      let shouldRetry = false;
      try {
        const response = await fetch("/api/hermes/health");
        if (!response.ok) throw new Error(`Runtime health returned ${response.status}`);
        const data = await response.json();
        if (cancelled) return;
        const mode = data?.dashboardMode === "preferred" || data?.dashboardMode === "legacy"
          ? data.dashboardMode
          : "required";
        if (data?.enabled && data?.healthy) setHealth({ status: "runtime", mode });
        else if (data?.enabled) {
          setHealth({ status: "unavailable", mode });
          shouldRetry = true;
        }
        else setHealth({ status: "disabled", mode });
      } catch {
        if (cancelled) return;
        setHealth((current) => ({ ...current, status: "unavailable" }));
        shouldRetry = true;
      }

      if (!cancelled && shouldRetry) {
        retryTimer = window.setTimeout(() => void checkHealth(), HEALTH_RETRY_DELAY_MS);
      }
    }

    void checkHealth();
    return () => {
      cancelled = true;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
    };
  }, [healthRefreshVersion]);

  const refreshRuntimeHealth = useCallback(() => {
    setHealth((current) => ({ ...current, status: "checking" }));
    setHealthRefreshVersion((current) => current + 1);
  }, []);

  // Route-owned panels do not depend on which chat transport is available.
  // Keep them in the shared terminal shell even when the legacy fallback would
  // otherwise replace that shell entirely.
  if (initialPanel) {
    return (
      <RuntimeTerminal
        scope={scope}
        initialPanel={initialPanel}
        backdropImage={backdropImage}
        runtimeUnavailable={health.status === "unavailable"}
        onRefreshRuntime={refreshRuntimeHealth}
      />
    );
  }

  // A health check in progress is not a failure. The runtime session can begin
  // connecting immediately while the explicit health probe finishes.
  if (health.status === "runtime" || health.status === "checking") {
    return (
      <RuntimeTerminal
        scope={scope}
        initialPanel={initialPanel}
        backdropImage={backdropImage}
        onRefreshRuntime={refreshRuntimeHealth}
      />
    );
  }
  if (health.mode === "required") {
    return (
      <RuntimeTerminal
        scope={scope}
        initialPanel={initialPanel}
        backdropImage={backdropImage}
        runtimeUnavailable
        onRefreshRuntime={refreshRuntimeHealth}
      />
    );
  }
  // Preferred and legacy modes may use the old transport. Required mode stays
  // on Hermes and surfaces unavailability instead of silently falling back.
  return (
    <>
      <KnowledgeTerminal scope={scope} />
      {health.status === "unavailable" ? (
        <div className="pointer-events-none fixed bottom-14 right-3 z-[60] rounded-md border border-amber-700/70 bg-amber-950/80 px-2.5 py-1 text-[11px] text-amber-200 shadow">
          Agent runtime unavailable — using legacy chat
        </div>
      ) : null}
    </>
  );
}

function RuntimeTerminal({
  scope,
  initialPanel = null,
  backdropImage = null,
  runtimeUnavailable = false,
  onRefreshRuntime,
}: Props & {
  runtimeUnavailable?: boolean;
  onRefreshRuntime: () => void;
}) {
  const resizeStartRef = useRef<{ startY: number; startHeight: number } | null>(null);
  const preferredOpenHeightRef = useRef<number | null>(null);
  const [height, setHeight] = useState(COLLAPSED_HEIGHT);

  useEffect(() => {
    const saved = Number(window.localStorage.getItem(HEIGHT_KEY));
    if (Number.isFinite(saved) && saved > COLLAPSED_HEIGHT + 8) {
      preferredOpenHeightRef.current = clampHeight(saved);
    }
    if (initialPanel) {
      // A route-owned panel is the requested page, so it cannot stay hidden in
      // the normally collapsed dock on first arrival.
      setHeight(preferredOpenHeightRef.current ?? defaultOpenHeight());
    }
  }, [initialPanel]);
  const [isResizing, setIsResizing] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [input, setInput] = useState("");
  const {
    model,
    setModel,
    reasoningEffort,
    setReasoningEffort,
    intelligenceModes,
    failover: modelFailover,
  } = useAssistantIntelligence();
  const { models } = useAssistantModels({ eager: true });
  const [history, setHistory] = useState<RuntimeHistorySession[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  // Bumped when a rename/pin/highlight/delete starts and again when it
  // settles. A poll response carrying an older epoch overlapped a local
  // mutation, so its snapshot may predate it — showing it would revert the
  // change until the next tick. Such responses are dropped; a poll dispatched
  // after the settle bump can only see the committed state.
  const historyEpoch = useRef(0);
  const [refreshingTerminal, setRefreshingTerminal] = useState(false);
  const [chatAttachments, setChatAttachments] = useState<ChatAttachment[]>([]);
  const [extractingAttachments, setExtractingAttachments] = useState(false);
  const [attachmentStatus, setAttachmentStatus] = useState("");
  // One panel at a time opens beside the transcript: the artifact archive,
  // uploads, scheduling, or route-owned automations. All live in the left rail.
  const [sidePanel, setSidePanel] = useState<TerminalPanel | null>(initialPanel);
  // The lane an opened artifact fills, beside the transcript and inside the
  // dock. Held in state rather than a ref so the viewers below re-render once
  // it exists and can portal into it.
  const [artifactLane, setArtifactLane] = useState<HTMLDivElement | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  // Linking a phone (WhatsApp, Telegram) lives in Settings → Messaging, reached
  // from the Intelligence menu. It is a once-a-year setup task, not a control
  // that earned permanent space in the chat bar.
  const [browserAgent, setBrowserAgent] = useState<{ id: string; name: string } | null>(null);
  const [agentBrowserAgent, setAgentBrowserAgent] = useState<{ id: string; name: string } | null>(null);
  const [openPlanterAgent, setOpenPlanterAgent] = useState<{ id: string; name: string } | null>(null);
  const [agentReachAgent, setAgentReachAgent] = useState<{ id: string; name: string } | null>(null);
  const [getDocAgent, setGetDocAgent] = useState<{ id: string; name: string } | null>(null);
  const [meetingNotesAgent, setMeetingNotesAgent] = useState<{ id: string; name: string } | null>(null);
  const [deepTutorAgent, setDeepTutorAgent] = useState<{ id: string; name: string } | null>(null);
  const [careerOpsAgent, setCareerOpsAgent] = useState<{ id: string; name: string } | null>(null);
  const [tradingAgentsAgent, setTradingAgentsAgent] = useState<{ id: string; name: string } | null>(
    null,
  );
  const [vibeTradingAgent, setVibeTradingAgent] = useState<{ id: string; name: string } | null>(
    null,
  );
  const [stockAnalystAgent, setStockAnalystAgent] = useState<{ id: string; name: string } | null>(
    null,
  );
  const [paperTraderAgent, setPaperTraderAgent] = useState<{ id: string; name: string } | null>(
    null,
  );
  const [deerFlowAgent, setDeerFlowAgent] = useState<{ id: string; name: string } | null>(null);
  const [shortsAgent, setShortsAgent] = useState<{ id: string; name: string } | null>(null);
  const [launchingShortsRun, setLaunchingShortsRun] = useState(false);
  const [formsmithAgent, setFormsmithAgent] = useState<{ id: string; name: string } | null>(null);
  const [launchingFormsmithRun, setLaunchingFormsmithRun] = useState(false);
  const [launchingVideoUseRun, setLaunchingVideoUseRun] = useState(false);
  // A typed or pasted /agents:shorts command pre-fills the request form rather
  // than running, for the same reason Trading Agent's does.
  const [shortsSeed, setShortsSeed] = useState<Partial<ShortsRequest> | null>(null);
  const [launchingBrowserRun, setLaunchingBrowserRun] = useState(false);
  const [launchingOpenPlanterRun, setLaunchingOpenPlanterRun] = useState(false);
  const [launchingAgentReachRun, setLaunchingAgentReachRun] = useState(false);
  const [launchingGetDocRun, setLaunchingGetDocRun] = useState(false);
  const [launchingMeetingNotesRun, setLaunchingMeetingNotesRun] = useState(false);
  const [launchingDeepTutorRun, setLaunchingDeepTutorRun] = useState(false);
  const [launchingCareerOpsRun, setLaunchingCareerOpsRun] = useState(false);
  const [launchingTradingAgentsRun, setLaunchingTradingAgentsRun] = useState(false);
  const [launchingVibeTradingRun, setLaunchingVibeTradingRun] = useState(false);
  const [launchingStockAnalystRun, setLaunchingStockAnalystRun] = useState(false);
  const [launchingPaperTraderRun, setLaunchingPaperTraderRun] = useState(false);
  const [launchingDeerFlowRun, setLaunchingDeerFlowRun] = useState(false);
  // A typed or pasted /agents:trading-agent command pre-fills the request form
  // rather than running: whatever it carries is a starting point, and anything
  // unrecognised in it is dropped instead of being forwarded as a prompt.
  const [tradingAgentsSeed, setTradingAgentsSeed] = useState<
    Partial<TradingAgentsRequest> | null
  >(null);
  const [launchingSocialsManagerRun, setLaunchingSocialsManagerRun] = useState(false);
  const [launchingHardwareRun, setLaunchingHardwareRun] = useState(false);
  const [launchingVimaxRun, setLaunchingVimaxRun] = useState(false);
  const [launchingMoneyPrinterRun, setLaunchingMoneyPrinterRun] = useState(false);
  const [launchingLegalRun, setLaunchingLegalRun] = useState(false);
  const [launchingCadRun, setLaunchingCadRun] = useState(false);
  const [launchingHyperframesRun, setLaunchingHyperframesRun] = useState(false);
  const [launchingResource2SkillRun, setLaunchingResource2SkillRun] = useState(false);
  const [launchingOpenMontageRun, setLaunchingOpenMontageRun] = useState(false);
  const [launchingOpenworkRun, setLaunchingOpenworkRun] = useState(false);
  const [launchingOpenscienceRun, setLaunchingOpenscienceRun] = useState(false);
  const [launchingInboxZeroRun, setLaunchingInboxZeroRun] = useState(false);
  // Covers the hand-off before an individual launcher raises its own flag
  // (health checks and agent selection can take seconds).
  const [delegatedAgentLaunching, setDelegatedAgentLaunching] = useState(false);
  const deepResearchDispatchingRef = useRef(false);
  const socialsManagerDispatchingRef = useRef(false);
  const hardwareDispatchingRef = useRef(false);
  const cadDispatchingRef = useRef(false);
  const hyperframesDispatchingRef = useRef(false);
  const resource2SkillDispatchingRef = useRef(false);
  const openMontageDispatchingRef = useRef(false);
  const openworkDispatchingRef = useRef(false);
  const openscienceDispatchingRef = useRef(false);
  const inboxZeroDispatchingRef = useRef(false);
  const vimaxDispatchingRef = useRef(false);
  const moneyPrinterDispatchingRef = useRef(false);
  const legalDispatchingRef = useRef(false);
  const attachmentInputRef = useRef<HTMLInputElement>(null);

  const isOpen = height > COLLAPSED_HEIGHT + 8;

  // Keep the header items mounted through their exit animation so they can
  // retract (not just vanish) when the terminal collapses. `headerMounted`
  // drives DOM presence; `headerClosing` swaps the reveal for the conceal.
  const [headerMounted, setHeaderMounted] = useState(false);
  const [headerClosing, setHeaderClosing] = useState(false);
  const headerMountedRef = useRef(false);
  const headerCloseTimer = useRef<number | null>(null);

  useEffect(() => {
    if (isOpen) {
      if (headerCloseTimer.current !== null) {
        window.clearTimeout(headerCloseTimer.current);
        headerCloseTimer.current = null;
      }
      headerMountedRef.current = true;
      setHeaderClosing(false);
      setHeaderMounted(true);
    } else if (headerMountedRef.current) {
      setHeaderClosing(true);
      // The last header item starts concealing at 380ms and the animation runs
      // 320ms; unmount only after both have finished.
      headerCloseTimer.current = window.setTimeout(() => {
        headerMountedRef.current = false;
        setHeaderMounted(false);
        setHeaderClosing(false);
        headerCloseTimer.current = null;
      }, 760);
    }
  }, [isOpen]);

  useEffect(
    () => () => {
      if (headerCloseTimer.current !== null) {
        window.clearTimeout(headerCloseTimer.current);
      }
    },
    [],
  );

  const session = useAgentSession("dashboard_terminal", { title: "Assistant conversation" });
  const runWorkflowAutomation = useWorkflowAutomation(session);
  const deepResearch = useDeepResearchAgent(session, setAttachmentStatus);
  const { clear: clearDeepResearch } = deepResearch;
  const openCode = useOpenCodeAgent(
    session,
    model,
    reasoningEffort,
    null,
    setAttachmentStatus,
  );
  const {
    clear: clearOpenCode,
    launch: launchOpenCodeRun,
    select: selectOpenCodeRuntime,
  } = openCode;
  const codex = useCodexAgent(
    session,
    model,
    reasoningEffort,
    null,
    setAttachmentStatus,
  );
  const {
    clear: clearCodex,
    launch: launchCodexRun,
    select: selectCodexRuntime,
  } = codex;
  const ruflo = useRufloAgent(session, null, setAttachmentStatus);
  const {
    clear: clearRuflo,
    launch: launchRufloRun,
    select: selectRufloRuntime,
  } = ruflo;
  const finishExternalAgentTurn = session.finishExternalAgentTurn;
  const runtimeOnline = !runtimeUnavailable;
  const busy =
    session.connection === "connecting" ||
    session.connection === "streaming" ||
    session.connection === "waiting";
  // An external agent is dispatching: the run exists on the client but has no
  // transcript turn yet, so nothing in `session` reflects it.
  const externalRunLaunching =
    delegatedAgentLaunching ||
    launchingBrowserRun ||
    launchingOpenPlanterRun ||
    launchingAgentReachRun ||
    launchingGetDocRun ||
    launchingMeetingNotesRun ||
    launchingCareerOpsRun ||
    launchingTradingAgentsRun ||
    launchingVibeTradingRun ||
    launchingStockAnalystRun ||
    launchingPaperTraderRun ||
    launchingDeerFlowRun ||
    launchingShortsRun ||
    launchingFormsmithRun ||
    launchingVideoUseRun ||
    launchingSocialsManagerRun ||
    launchingHardwareRun ||
    launchingVimaxRun ||
    launchingMoneyPrinterRun ||
    launchingLegalRun ||
    launchingCadRun ||
    launchingHyperframesRun ||
    launchingResource2SkillRun ||
    launchingOpenMontageRun ||
    launchingOpenworkRun ||
    launchingOpenscienceRun ||
    launchingInboxZeroRun ||
    deepResearch.launching ||
    codex.launching ||
    openCode.launching ||
    ruflo.launching;
  const currentChatActive =
    busy ||
    externalRunLaunching ||
    chatSessionIsActive(null, session.messages);
  const isPublic = scope === "public";

  const refreshTerminal = useCallback(async () => {
    if (runtimeOnline || refreshingTerminal) return;
    setRefreshingTerminal(true);
    onRefreshRuntime();
    try {
      if (session.sessionId) {
        await session.openSession(session.sessionId, session.messages);
      } else {
        session.reset();
      }
    } finally {
      setRefreshingTerminal(false);
    }
  }, [
    onRefreshRuntime,
    refreshingTerminal,
    runtimeOnline,
    session,
  ]);

  useEffect(() => {
    const listener = (raw: Event) => {
      const artifact = (raw as CustomEvent<{ id?: string; title?: string; conversationId?: string; renderer?: string; sourceSkill?: string | null }>).detail;
      if (!artifact?.id || artifact.conversationId !== session.sessionId) return;
      setSidePanel((current) => (current === "artifacts" ? null : current));
      setInput(`${interactiveVisualizerCommandForArtifact(artifact)}Revise the selected artifact "${artifact.title ?? "artifact"}" (${artifact.id}): `);
    };
    window.addEventListener(ARTIFACT_REVISE_EVENT, listener);
    return () => window.removeEventListener(ARTIFACT_REVISE_EVENT, listener);
  }, [session.sessionId]);

  useEffect(() => {
    const onResize = () => setHeight((current) => clampHeight(current));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (height <= COLLAPSED_HEIGHT + 8) return;
    const preferredHeight = clampHeight(height);
    preferredOpenHeightRef.current = preferredHeight;
    window.localStorage.setItem(HEIGHT_KEY, String(preferredHeight));
  }, [height]);

  // At full height the dock covers everything below the nav, so the page behind
  // it must stop scrolling — otherwise the wheel chains through to content
  // nobody can see. Padding replaces the scrollbar's width while it is hidden,
  // so the still-visible nav does not jump sideways.
  useEffect(() => {
    const { body } = document;
    const previousOverflow = body.style.overflow;
    const previousPaddingRight = body.style.paddingRight;

    const sync = () => {
      if (height < maxHeight() - 1) {
        body.style.overflow = previousOverflow;
        body.style.paddingRight = previousPaddingRight;
        return;
      }

      const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
      body.style.overflow = "hidden";
      if (scrollbarWidth > 0) body.style.paddingRight = `${scrollbarWidth}px`;
    };

    sync();
    window.addEventListener("resize", sync);
    return () => {
      window.removeEventListener("resize", sync);
      body.style.overflow = previousOverflow;
      body.style.paddingRight = previousPaddingRight;
    };
  }, [height]);

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    const refreshHistory = (force = false) => {
      if (inFlight || document.visibilityState === "hidden") return;
      inFlight = true;
      const epoch = historyEpoch.current;
      void loadHermesSessionSummaries("dashboard_terminal", { force })
        .then((sessions) => {
          if (cancelled || historyEpoch.current !== epoch) return;
          setHistory(
            sessions
              .filter((item): item is HermesSessionSnapshot & { id: string } =>
                typeof item.id === "string" && item.id.startsWith("conv_"),
              )
              .map((item) => {
                return {
                  id: item.id,
                  title: typeof item.title === "string" ? item.title : "New chat",
                  updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : "",
                  active: Boolean(item.activeRun) || item.externalAgentActive === true,
                  pinned: item.pinned === true,
                  // The server already rejected anything outside the palette.
                  highlight: typeof item.highlight === "string" ? item.highlight : null,
                };
              }),
          );
        })
        .catch(() => undefined)
        .finally(() => {
          inFlight = false;
          if (!cancelled) setHistoryLoading(false);
        });
    };
    setHistoryLoading(true);
    refreshHistory();
    const timer = window.setInterval(() => refreshHistory(true), 10_000);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") refreshHistory(true);
    };
    const onSessionsChanged = (event: Event) => {
      const changedSurface = (event as CustomEvent<{ surface?: string }>).detail?.surface;
      if (changedSurface === "dashboard_terminal") refreshHistory(true);
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener(HERMES_SESSIONS_CHANGED_EVENT, onSessionsChanged);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener(HERMES_SESSIONS_CHANGED_EVENT, onSessionsChanged);
    };
  }, [scope]);

  // Keep the open conversation's sidebar snapshot current without another
  // network request for every streamed token or external-agent terminal event.
  useEffect(() => {
    if (!session.sessionId) return;
    setHistory((current) =>
      current.map((item) =>
        item.id === session.sessionId
          ? {
              ...item,
              active: currentChatActive,
            }
          : item,
      ),
    );
  }, [currentChatActive, session.messages, session.sessionId]);

  // Selecting Agent TARS resolves the browser-operator agent to run against.
  // The runtime, workspace, and secrets stay server-side; we only need its id.
  const selectBrowserAgent = useCallback(async () => {
    setAttachmentStatus("");
    try {
      const response = await fetch("/api/ui-tars/agents");
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof data?.error === "string" ? data.error : "Agent TARS is unavailable.");
      }
      const agents = Array.isArray(data?.agents) ? data.agents : [];
      const pick =
        agents.find((agent: { runtimeState?: string }) => agent.runtimeState === "available") ??
        agents.find((agent: { isDefault?: boolean }) => agent.isDefault) ??
        agents[0];
      if (!pick?.id) throw new Error("No Agent TARS agent is configured.");
      const selected = { id: String(pick.id), name: String(pick.name ?? "Agent TARS") };
      setAgentBrowserAgent(null);
      setOpenPlanterAgent(null);
      setAgentReachAgent(null);
      setGetDocAgent(null);
      setMeetingNotesAgent(null);
      setDeepTutorAgent(null);
      setCareerOpsAgent(null);
      setTradingAgentsAgent(null);
      setVibeTradingAgent(null);
      setDeerFlowAgent(null);
      setShortsAgent(null);
      clearDeepResearch();
      clearCodex();
      clearOpenCode();
      clearRuflo();
      setBrowserAgent(selected);
      if (pick.runtimeState && pick.runtimeState !== "available") {
        setAttachmentStatus(
          `Agent TARS selected, but the runtime is ${pick.runtimeState}. A task may not start until it is available.`,
        );
      }
      return selected;
    } catch (cause) {
      setAttachmentStatus(cause instanceof Error ? cause.message : "Agent TARS is unavailable.");
      return null;
    }
  }, [clearCodex, clearDeepResearch, clearOpenCode, clearRuflo]);

  // A prompt sent while Agent TARS is active becomes a real browser run. The
  // user + run-card messages are appended to the transcript; the card mounts
  // the live workspace (screenshot, timeline, approvals) for the new run id.
  const launchBrowserRun = useCallback(
    async (task: string, agentOverride?: { id: string; name: string }) => {
      const selectedAgent = agentOverride ?? browserAgent;
      if (!selectedAgent || launchingBrowserRun) return;
      setLaunchingBrowserRun(true);
      let clientMessageId = crypto.randomUUID();
      const userMessage: AgentMessage = {
        id: clientMessageId,
        role: "user",
        content: agentTarsUserMessage(task),
      };
      const userContent = userMessage.content;
      clientMessageId = session.previewExternalAgentTurn({ clientMessageId, userContent });
      let runStarted = false;
      try {
        const response = await fetch(`/api/ui-tars/agents/${selectedAgent.id}/runs`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ task }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data?.run?.id) {
          throw new Error(
            typeof data?.error === "string" ? data.error : "The Agent TARS run could not start.",
          );
        }
        runStarted = true;
        await session.appendExternalAgentTurn({
          clientMessageId,
          userContent,
          run: {
            kind: "agent_tars",
            agentId: selectedAgent.id,
            runId: String(data.run.id),
            task,
          },
        });
      } catch (cause) {
        if (runStarted) {
          setAttachmentStatus(
            cause instanceof Error
              ? cause.message
              : "The Agent TARS run started, but its chat turn could not be saved.",
          );
          return;
        }
        const assistantContent = `The Agent TARS task could not start: ${
          cause instanceof Error ? cause.message : "unknown error"
        }`;
        try {
          await session.appendExternalAgentTurn({
            clientMessageId,
            userContent,
            assistantContent,
            outcome: "failed",
          });
        } catch (persistenceError) {
          setAttachmentStatus(
            persistenceError instanceof Error
              ? persistenceError.message
              : "The Agent TARS turn could not be saved.",
          );
        }
      } finally {
        setLaunchingBrowserRun(false);
      }
    },
    [browserAgent, launchingBrowserRun, session],
  );

  // Selecting Agent Browser resolves the agent-browser runtime agent (a separate
  // browser runtime from Agent TARS, driven by ChatMock via the agent-browser CLI).
  const selectAgentBrowser = useCallback(async () => {
    setAttachmentStatus("");
    try {
      const response = await fetch("/api/agent-browser/agents");
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof data?.error === "string" ? data.error : "Agent Browser is unavailable.");
      }
      const agents = Array.isArray(data?.agents) ? data.agents : [];
      const pick =
        agents.find((agent: { runtimeState?: string }) => agent.runtimeState === "available") ??
        agents.find((agent: { isDefault?: boolean }) => agent.isDefault) ??
        agents[0];
      if (!pick?.id) throw new Error("No Agent Browser agent is configured.");
      const selected = { id: String(pick.id), name: String(pick.name ?? "Agent Browser") };
      setBrowserAgent(null);
      setOpenPlanterAgent(null);
      setAgentReachAgent(null);
      setGetDocAgent(null);
      setMeetingNotesAgent(null);
      setDeepTutorAgent(null);
      setCareerOpsAgent(null);
      setTradingAgentsAgent(null);
      setVibeTradingAgent(null);
      setDeerFlowAgent(null);
      setShortsAgent(null);
      clearDeepResearch();
      clearCodex();
      clearOpenCode();
      clearRuflo();
      setAgentBrowserAgent(selected);
      if (data.available === false) {
        setAttachmentStatus(
          `Agent Browser selected, but the runtime is unavailable${data.reason ? ` (${data.reason})` : ""}.`,
        );
      }
      return selected;
    } catch (cause) {
      setAttachmentStatus(cause instanceof Error ? cause.message : "Agent Browser is unavailable.");
      return null;
    }
  }, [clearCodex, clearDeepResearch, clearOpenCode, clearRuflo]);

  const launchAgentBrowserRun = useCallback(
    async (task: string, agentOverride?: { id: string; name: string }) => {
      const selectedAgent = agentOverride ?? agentBrowserAgent;
      if (!selectedAgent || launchingBrowserRun) return;
      setLaunchingBrowserRun(true);
      let clientMessageId = crypto.randomUUID();
      const userMessage: AgentMessage = {
        id: clientMessageId,
        role: "user",
        content: agentBrowserUserMessage(task),
      };
      const userContent = userMessage.content;
      clientMessageId = session.previewExternalAgentTurn({ clientMessageId, userContent });
      let runStarted = false;
      try {
        const response = await fetch(`/api/agent-browser/agents/${selectedAgent.id}/runs`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ task }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data?.run?.runId) {
          throw new Error(
            typeof data?.error === "string" ? data.error : "The Agent Browser run could not start.",
          );
        }
        runStarted = true;
        await session.appendExternalAgentTurn({
          clientMessageId,
          userContent,
          run: {
            kind: "agent_browser",
            agentId: selectedAgent.id,
            runId: String(data.run.runId),
            task,
          },
        });
      } catch (cause) {
        if (runStarted) {
          setAttachmentStatus(
            cause instanceof Error
              ? cause.message
              : "The Agent Browser run started, but its chat turn could not be saved.",
          );
          return;
        }
        const assistantContent = `The Agent Browser task could not start: ${
          cause instanceof Error ? cause.message : "unknown error"
        }`;
        try {
          await session.appendExternalAgentTurn({
            clientMessageId,
            userContent,
            assistantContent,
            outcome: "failed",
          });
        } catch (persistenceError) {
          setAttachmentStatus(
            persistenceError instanceof Error
              ? persistenceError.message
              : "The Agent Browser turn could not be saved.",
          );
        }
      } finally {
        setLaunchingBrowserRun(false);
      }
    },
    [agentBrowserAgent, launchingBrowserRun, session],
  );

  const selectOpenPlanter = useCallback(async () => {
    setAttachmentStatus("");
    try {
      const response = await fetch("/api/openplanter/health");
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.available !== true) {
        throw new Error(
          typeof data?.reason === "string"
            ? data.reason
            : typeof data?.error === "string"
              ? data.error
              : "OpenPlanter is unavailable.",
        );
      }
      const selected = { id: OPENPLANTER_AGENT_ID, name: OPENPLANTER_AGENT_NAME };
      setBrowserAgent(null);
      setAgentBrowserAgent(null);
      setAgentReachAgent(null);
      setGetDocAgent(null);
      setMeetingNotesAgent(null);
      setDeepTutorAgent(null);
      setCareerOpsAgent(null);
      setTradingAgentsAgent(null);
      setVibeTradingAgent(null);
      setDeerFlowAgent(null);
      setShortsAgent(null);
      clearDeepResearch();
      clearCodex();
      clearOpenCode();
      clearRuflo();
      setOpenPlanterAgent(selected);
      return selected;
    } catch (cause) {
      setAttachmentStatus(cause instanceof Error ? cause.message : "OpenPlanter is unavailable.");
      return null;
    }
  }, [clearCodex, clearDeepResearch, clearOpenCode, clearRuflo]);

  /** Activating checks the clone so an unprepared runtime says so up front. */
  const selectAgentReach = useCallback(async () => {
    setAttachmentStatus("");
    try {
      const response = await fetch("/api/agent-reach/health");
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.available !== true) {
        throw new Error(
          typeof data?.reason === "string"
            ? data.reason
            : typeof data?.error === "string"
              ? data.error
              : "Agent Reach is unavailable.",
        );
      }
      const selected = { id: AGENT_REACH_AGENT_ID, name: AGENT_REACH_AGENT_NAME };
      setBrowserAgent(null);
      setAgentBrowserAgent(null);
      setOpenPlanterAgent(null);
      clearDeepResearch();
      clearCodex();
      clearOpenCode();
      clearRuflo();
      setAgentReachAgent(selected);
      const live = Array.isArray(data.channels)
        ? data.channels.filter((channel: { status?: string }) => channel.status === "ok").length
        : 0;
      if (!live) {
        setAttachmentStatus(
          "Agent Reach selected, but no platform reported itself as reachable. Run `agent-reach doctor` to see what needs setup.",
        );
      }
      return selected;
    } catch (cause) {
      setAttachmentStatus(cause instanceof Error ? cause.message : "Agent Reach is unavailable.");
      return null;
    }
  }, [clearCodex, clearDeepResearch, clearOpenCode, clearRuflo]);

  /**
   * Activating checks which catalogs will answer. Get Doc installs nothing, so
   * this is only ever a configuration answer — but a missing contact address
   * quietly costs downloads, and that is worth knowing before the search.
   */
  /**
   * Selecting checks which transcriber this machine has, and says what it costs
   * when the answer is the weaker one. Health never refuses the agent outright:
   * a machine with no transcriber at all can still be handed a transcript, and
   * blocking selection would take that away too.
   */
  const selectMeetingNotes = useCallback(async () => {
    setAttachmentStatus("");
    try {
      const response = await fetch("/api/meeting-notes/health");
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.available !== true) {
        throw new Error(
          typeof data?.reason === "string"
            ? data.reason
            : typeof data?.error === "string"
              ? data.error
              : "Meeting Notes is unavailable.",
        );
      }
      const selected = { id: MEETING_NOTES_AGENT_ID, name: MEETING_NOTES_AGENT_NAME };
      setBrowserAgent(null);
      setAgentBrowserAgent(null);
      setOpenPlanterAgent(null);
      setAgentReachAgent(null);
      setGetDocAgent(null);
      setDeepTutorAgent(null);
      setCareerOpsAgent(null);
      setTradingAgentsAgent(null);
      setVibeTradingAgent(null);
      setDeerFlowAgent(null);
      setShortsAgent(null);
      clearDeepResearch();
      clearCodex();
      clearOpenCode();
      clearRuflo();
      setMeetingNotesAgent(selected);
      if (data.speakerLabels !== true && typeof data.detail === "string") {
        setAttachmentStatus("Meeting Notes selected. " + data.detail);
      }
      return selected;
    } catch (cause) {
      setAttachmentStatus(
        cause instanceof Error ? cause.message : "Meeting Notes is unavailable.",
      );
      return null;
    }
  }, [clearCodex, clearDeepResearch, clearOpenCode, clearRuflo]);

  const selectGetDoc = useCallback(async () => {
    setAttachmentStatus("");
    try {
      const response = await fetch("/api/get-doc/health");
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.available !== true) {
        throw new Error(
          typeof data?.reason === "string"
            ? data.reason
            : typeof data?.error === "string"
              ? data.error
              : "Get Doc is unavailable.",
        );
      }
      const selected = { id: GET_DOC_AGENT_ID, name: GET_DOC_AGENT_NAME };
      setBrowserAgent(null);
      setAgentBrowserAgent(null);
      setOpenPlanterAgent(null);
      setAgentReachAgent(null);
      setCareerOpsAgent(null);
      setTradingAgentsAgent(null);
      setVibeTradingAgent(null);
      setDeerFlowAgent(null);
      setShortsAgent(null);
      clearDeepResearch();
      clearCodex();
      clearOpenCode();
      clearRuflo();
      setGetDocAgent(selected);
      if (data.contactConfigured !== true) {
        setAttachmentStatus(
          "Get Doc selected. Set GET_DOC_CONTACT_EMAIL to let Unpaywall find more free full texts.",
        );
      }
      return selected;
    } catch (cause) {
      setAttachmentStatus(cause instanceof Error ? cause.message : "Get Doc is unavailable.");
      return null;
    }
  }, [clearCodex, clearDeepResearch, clearOpenCode, clearRuflo]);

  /**
   * Activating checks two things at once, because a tutor that can run but
   * cannot read is the failure worth catching early: the clone's environment,
   * and whether this surface actually has material in scope.
   */
  const selectDeepTutor = useCallback(async () => {
    setAttachmentStatus("");
    try {
      const response = await fetch("/api/deep-tutor/health");
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.available !== true) {
        throw new Error(
          typeof data?.reason === "string"
            ? data.reason
            : typeof data?.error === "string"
              ? data.error
              : "Deep Tutor is unavailable.",
        );
      }
      const selected = { id: DEEP_TUTOR_AGENT_ID, name: DEEP_TUTOR_AGENT_NAME };
      setBrowserAgent(null);
      setAgentBrowserAgent(null);
      setOpenPlanterAgent(null);
      setAgentReachAgent(null);
      setGetDocAgent(null);
      setMeetingNotesAgent(null);
      setCareerOpsAgent(null);
      setTradingAgentsAgent(null);
      clearDeepResearch();
      clearCodex();
      clearOpenCode();
      clearRuflo();
      setDeepTutorAgent(selected);
      const scope = data.scope as { rootCount?: number; label?: string } | undefined;
      if (!scope?.rootCount) {
        setAttachmentStatus(
          "Deep Tutor selected, but there are no files in scope here — it will answer from the conversation alone.",
        );
      }
      return selected;
    } catch (cause) {
      setAttachmentStatus(cause instanceof Error ? cause.message : "Deep Tutor is unavailable.");
      return null;
    }
  }, [clearCodex, clearDeepResearch, clearOpenCode, clearRuflo]);

  /** Activating checks the clone so an unprepared workspace says so up front. */
  const selectCareerOps = useCallback(async () => {
    setAttachmentStatus("");
    try {
      const response = await fetch("/api/career-ops/health");
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.cloned !== true) {
        throw new Error(
          typeof data?.reason === "string"
            ? data.reason
            : typeof data?.error === "string"
              ? data.error
              : "Career Ops is unavailable.",
        );
      }
      const selected = { id: CAREER_OPS_AGENT_ID, name: CAREER_OPS_AGENT_NAME };
      setBrowserAgent(null);
      setAgentBrowserAgent(null);
      setOpenPlanterAgent(null);
      setAgentReachAgent(null);
      setGetDocAgent(null);
      setMeetingNotesAgent(null);
      setDeepTutorAgent(null);
      clearDeepResearch();
      clearCodex();
      clearOpenCode();
      clearRuflo();
      setCareerOpsAgent(selected);
      // Not being set up is worth saying now rather than three steps into a run,
      // but it is not a refusal: several modes need no candidate profile.
      if (data.available !== true && typeof data.reason === "string") {
        setAttachmentStatus(data.reason);
      } else if (data.onboardingNeeded === true) {
        setAttachmentStatus(
          `Career Ops selected. It has no candidate profile yet (${(data.missing ?? []).join(", ")}), so ask it to help build one before evaluating offers.`,
        );
      }
      return selected;
    } catch (cause) {
      setAttachmentStatus(cause instanceof Error ? cause.message : "Career Ops is unavailable.");
      return null;
    }
  }, [clearCodex, clearDeepResearch, clearOpenCode, clearRuflo]);

  /**
   * Selecting checks the clone and its environment, because this agent cannot
   * partially work: without the Python environment there is nothing to run, and
   * finding that out after filling in a request would waste the request.
   */
  const selectTradingAgents = useCallback(async () => {
    setAttachmentStatus("");
    try {
      const response = await fetch("/api/tradingagents/health");
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.cloned !== true) {
        throw new Error(
          typeof data?.reason === "string"
            ? data.reason
            : typeof data?.error === "string"
              ? data.error
              : "Trading Agent is unavailable.",
        );
      }
      const selected = { id: TRADINGAGENTS_AGENT_ID, name: TRADINGAGENTS_AGENT_NAME };
      setBrowserAgent(null);
      setAgentBrowserAgent(null);
      setOpenPlanterAgent(null);
      setAgentReachAgent(null);
      setGetDocAgent(null);
      setMeetingNotesAgent(null);
      setDeepTutorAgent(null);
      setCareerOpsAgent(null);
      clearDeepResearch();
      clearCodex();
      clearOpenCode();
      clearRuflo();
      setTradingAgentsAgent(selected);
      if (data.available !== true && typeof data.reason === "string") {
        setAttachmentStatus(data.reason);
      }
      return selected;
    } catch (cause) {
      setAttachmentStatus(cause instanceof Error ? cause.message : "Trading Agent is unavailable.");
      return null;
    }
  }, [clearCodex, clearDeepResearch, clearOpenCode, clearRuflo]);

  /**
   * Same contract as Trading Agent: the clone cannot partially work, and
   * finding that out after choosing a video would waste the upload.
   */
  const selectShorts = useCallback(async () => {
    setAttachmentStatus("");
    try {
      const response = await fetch("/api/shorts/health");
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.cloned !== true) {
        throw new Error(
          typeof data?.reason === "string"
            ? data.reason
            : typeof data?.error === "string"
              ? data.error
              : "Shorts is unavailable.",
        );
      }
      const selected = { id: SHORTS_AGENT_ID, name: SHORTS_AGENT_NAME };
      setBrowserAgent(null);
      setAgentBrowserAgent(null);
      setOpenPlanterAgent(null);
      setAgentReachAgent(null);
      setGetDocAgent(null);
      setMeetingNotesAgent(null);
      setDeepTutorAgent(null);
      setCareerOpsAgent(null);
      setTradingAgentsAgent(null);
      setVibeTradingAgent(null);
      setDeerFlowAgent(null);
      setShortsAgent(null);
      clearDeepResearch();
      clearCodex();
      clearOpenCode();
      clearRuflo();
      setShortsAgent(selected);
      if (data.available !== true && typeof data.reason === "string") {
        setAttachmentStatus(data.reason);
      }
      return selected;
    } catch (cause) {
      setAttachmentStatus(cause instanceof Error ? cause.message : "Shorts is unavailable.");
      return null;
    }
  }, [clearCodex, clearDeepResearch, clearOpenCode, clearRuflo]);

  /** Select the image-only local ShapeR surface and report setup gaps up front. */
  const selectFormsmith = useCallback(async () => {
    setAttachmentStatus("");
    try {
      const response = await fetch("/api/shaper/health");
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.cloned !== true) {
        throw new Error(
          typeof data?.reason === "string"
            ? data.reason
            : typeof data?.error === "string"
              ? data.error
              : "Formsmith is unavailable.",
        );
      }
      const selected = { id: FORMSMITH_AGENT_ID, name: FORMSMITH_AGENT_NAME };
      setBrowserAgent(null);
      setAgentBrowserAgent(null);
      setOpenPlanterAgent(null);
      setAgentReachAgent(null);
      setGetDocAgent(null);
      setMeetingNotesAgent(null);
      setDeepTutorAgent(null);
      setCareerOpsAgent(null);
      setTradingAgentsAgent(null);
      setVibeTradingAgent(null);
      setDeerFlowAgent(null);
      setShortsAgent(null);
      setChatAttachments([]);
      clearDeepResearch();
      clearCodex();
      clearOpenCode();
      clearRuflo();
      setFormsmithAgent(selected);
      if (data.available !== true && typeof data.reason === "string") {
        setAttachmentStatus(data.reason);
      }
      return selected;
    } catch (cause) {
      setAttachmentStatus(cause instanceof Error ? cause.message : "Formsmith is unavailable.");
      return null;
    }
  }, [clearCodex, clearDeepResearch, clearOpenCode, clearRuflo]);

  // Other selectors predate Formsmith and already clear one another. This one
  // guard folds the new selection into that existing mutual-exclusion contract.
  useEffect(() => {
    if (!formsmithAgent) return;
    if (
      browserAgent || agentBrowserAgent || openPlanterAgent || agentReachAgent ||
      getDocAgent || meetingNotesAgent || deepTutorAgent || careerOpsAgent || tradingAgentsAgent ||
      vibeTradingAgent || deerFlowAgent || shortsAgent || deepResearch.agent ||
      codex.agent || openCode.agent || ruflo.agent
    ) {
      // This synchronizes a newly added selector with the older selector states.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFormsmithAgent(null);
    }
  }, [
    agentBrowserAgent, agentReachAgent, browserAgent, careerOpsAgent, codex.agent,
    deepResearch.agent, deepTutorAgent, deerFlowAgent, formsmithAgent, getDocAgent, meetingNotesAgent,
    openCode.agent, openPlanterAgent, ruflo.agent, shortsAgent, tradingAgentsAgent,
    vibeTradingAgent,
  ]);

  /**
   * Selecting checks the clone and its environment. Like Trading Agent this one
   * cannot partially work — without the Python environment there is no service
   * to start — so an unbuilt environment is worth saying before a prompt is
   * typed rather than after.
   */
  const selectVibeTrading = useCallback(async () => {
    setAttachmentStatus("");
    try {
      const response = await fetch("/api/vibe-trading/health");
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.cloned !== true) {
        throw new Error(
          typeof data?.reason === "string"
            ? data.reason
            : typeof data?.error === "string"
              ? data.error
              : "Vibe Trading is unavailable.",
        );
      }
      const selected = { id: VIBE_TRADING_AGENT_ID, name: VIBE_TRADING_AGENT_NAME };
      setBrowserAgent(null);
      setAgentBrowserAgent(null);
      setOpenPlanterAgent(null);
      setAgentReachAgent(null);
      setGetDocAgent(null);
      setMeetingNotesAgent(null);
      setDeepTutorAgent(null);
      setCareerOpsAgent(null);
      setTradingAgentsAgent(null);
      setVibeTradingAgent(null);
      setDeerFlowAgent(null);
      setShortsAgent(null);
      clearDeepResearch();
      clearCodex();
      clearOpenCode();
      clearRuflo();
      setVibeTradingAgent(selected);
      if (data.available !== true && typeof data.reason === "string") {
        setAttachmentStatus(data.reason);
      } else if (data.serviceRunning !== true) {
        setAttachmentStatus(
          "Vibe Trading selected. Its service starts with the first run, which takes about a minute.",
        );
      }
      return selected;
    } catch (cause) {
      setAttachmentStatus(cause instanceof Error ? cause.message : "Vibe Trading is unavailable.");
      return null;
    }
  }, [clearCodex, clearDeepResearch, clearOpenCode, clearRuflo]);

  /**
   * Selecting checks the clone and its environment, for the same reason Vibe
   * Trading does: without the Python environment there is no backend to start.
   */
  const selectStockAnalyst = useCallback(async () => {
    setAttachmentStatus("");
    try {
      const response = await fetch("/api/stock-analyst/health");
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.cloned !== true) {
        throw new Error(
          typeof data?.reason === "string"
            ? data.reason
            : typeof data?.error === "string"
              ? data.error
              : "Stock Analyst is unavailable.",
        );
      }
      const selected = { id: STOCK_ANALYST_AGENT_ID, name: STOCK_ANALYST_AGENT_NAME };
      setBrowserAgent(null);
      setAgentBrowserAgent(null);
      setOpenPlanterAgent(null);
      setAgentReachAgent(null);
      setGetDocAgent(null);
      setMeetingNotesAgent(null);
      setDeepTutorAgent(null);
      setCareerOpsAgent(null);
      setTradingAgentsAgent(null);
      setVibeTradingAgent(null);
      setDeerFlowAgent(null);
      setShortsAgent(null);
      setFormsmithAgent(null);
      clearDeepResearch();
      clearCodex();
      clearOpenCode();
      clearRuflo();
      setStockAnalystAgent(selected);
      if (data.available !== true && typeof data.reason === "string") {
        setAttachmentStatus(data.reason);
      } else if (data.serviceRunning !== true) {
        setAttachmentStatus(
          "Stock Analyst selected. Its backend starts with the first question, which takes about a minute.",
        );
      }
      return selected;
    } catch (cause) {
      setAttachmentStatus(cause instanceof Error ? cause.message : "Stock Analyst is unavailable.");
      return null;
    }
  }, [clearCodex, clearDeepResearch, clearOpenCode, clearRuflo]);

  /**
   * Selecting checks both clones, because this agent needs two: the arena it
   * trades in, and the TradingAgents environment that decides for it. Saying
   * which one is missing before a message is typed is the difference between a
   * desk that will not start and a desk that starts and never trades.
   */
  const selectPaperTrader = useCallback(() => {
    // Selecting is a local decision and it shows immediately.
    //
    // Every other agent here checks its health first and only then changes the
    // composer, which is a round trip the person is left watching — and this
    // agent's health route is the slowest of them to compile, so the pause was
    // long enough to read as the app having hung. Nothing about the answer
    // changes what selecting *means*, so the check runs behind the selection and
    // reports into the same status line. An unusable desk still refuses at the
    // point it would actually matter, when the run is started.
    const selected = { id: PAPER_TRADER_AGENT_ID, name: PAPER_TRADER_AGENT_NAME };
    setBrowserAgent(null);
    setAgentBrowserAgent(null);
    setOpenPlanterAgent(null);
    setAgentReachAgent(null);
    setGetDocAgent(null);
    setMeetingNotesAgent(null);
    setDeepTutorAgent(null);
    setCareerOpsAgent(null);
    setTradingAgentsAgent(null);
    setVibeTradingAgent(null);
    setStockAnalystAgent(null);
    setDeerFlowAgent(null);
    setShortsAgent(null);
    setFormsmithAgent(null);
    clearDeepResearch();
    clearCodex();
    clearOpenCode();
    clearRuflo();
    setPaperTraderAgent(selected);
    setAttachmentStatus(
      "Paper Trader selected. Send to start it. It runs while Breadboard is open and resumes next time unless you stop it.",
    );

    void (async () => {
      try {
        const response = await fetch("/api/paper-trader/health");
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.cloned !== true) {
          setAttachmentStatus(
            typeof data?.reason === "string"
              ? data.reason
              : typeof data?.error === "string"
                ? data.error
                : "Paper Trader is unavailable.",
          );
          return;
        }
        if (data.available !== true && typeof data.reason === "string") {
          setAttachmentStatus(data.reason);
        } else if (data?.desk?.running === true) {
          setAttachmentStatus("The trading desk is already running. Send to see it, or say stop.");
        }
      } catch {
        // The run route reports the real reason if it comes to that.
      }
    })();

    return selected;
  }, [clearCodex, clearDeepResearch, clearOpenCode, clearRuflo]);

  // Selectors added before Paper Trader do not know its state, so fold it into
  // the same one-runtime-at-a-time contract here.
  useEffect(() => {
    if (!paperTraderAgent) return;
    if (
      browserAgent || agentBrowserAgent || openPlanterAgent || agentReachAgent ||
      getDocAgent || meetingNotesAgent || deepTutorAgent || careerOpsAgent || tradingAgentsAgent ||
      vibeTradingAgent || stockAnalystAgent || deerFlowAgent || shortsAgent ||
      formsmithAgent || deepResearch.agent || codex.agent || openCode.agent || ruflo.agent
    ) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPaperTraderAgent(null);
    }
  }, [
    agentBrowserAgent, agentReachAgent, browserAgent, careerOpsAgent, codex.agent,
    deepResearch.agent, deepTutorAgent, deerFlowAgent, formsmithAgent, getDocAgent, meetingNotesAgent,
    openCode.agent, openPlanterAgent, paperTraderAgent, ruflo.agent, shortsAgent,
    stockAnalystAgent, tradingAgentsAgent, vibeTradingAgent,
  ]);

  // Selectors added before Stock Analyst do not know its state, so fold it into
  // the same one-runtime-at-a-time contract here.
  useEffect(() => {
    if (!stockAnalystAgent) return;
    if (
      browserAgent || agentBrowserAgent || openPlanterAgent || agentReachAgent ||
      getDocAgent || meetingNotesAgent || deepTutorAgent || careerOpsAgent || tradingAgentsAgent ||
      vibeTradingAgent || deerFlowAgent || shortsAgent || formsmithAgent ||
      deepResearch.agent || codex.agent || openCode.agent || ruflo.agent
    ) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStockAnalystAgent(null);
    }
  }, [
    agentBrowserAgent, agentReachAgent, browserAgent, careerOpsAgent, codex.agent,
    deepResearch.agent, deepTutorAgent, deerFlowAgent, formsmithAgent, getDocAgent, meetingNotesAgent,
    openCode.agent, openPlanterAgent, ruflo.agent, shortsAgent,
    stockAnalystAgent, tradingAgentsAgent, vibeTradingAgent,
  ]);

  /**
   * Selecting checks the clone and its environment. Like Vibe Trading this one
   * cannot partially work — without the Python environment there is no Gateway
   * to start — so an unbuilt environment is worth saying before a task is typed
   * rather than after.
   */
  const selectDeerFlow = useCallback(async () => {
    setAttachmentStatus("");
    try {
      const response = await fetch("/api/deer-flow/health");
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.cloned !== true) {
        throw new Error(
          typeof data?.reason === "string"
            ? data.reason
            : typeof data?.error === "string"
              ? data.error
              : "DeerFlow is unavailable.",
        );
      }
      const selected = { id: DEER_FLOW_AGENT_ID, name: DEER_FLOW_AGENT_NAME };
      setBrowserAgent(null);
      setAgentBrowserAgent(null);
      setOpenPlanterAgent(null);
      setAgentReachAgent(null);
      setGetDocAgent(null);
      setMeetingNotesAgent(null);
      setDeepTutorAgent(null);
      setCareerOpsAgent(null);
      setTradingAgentsAgent(null);
      setVibeTradingAgent(null);
      setDeerFlowAgent(null);
      clearDeepResearch();
      clearCodex();
      clearOpenCode();
      clearRuflo();
      setDeerFlowAgent(selected);
      if (data.available !== true && typeof data.reason === "string") {
        setAttachmentStatus(data.reason);
      } else if (data.serviceRunning !== true) {
        setAttachmentStatus(
          "DeerFlow selected. Its Gateway starts with the first run, which takes about a minute.",
        );
      }
      return selected;
    } catch (cause) {
      setAttachmentStatus(cause instanceof Error ? cause.message : "DeerFlow is unavailable.");
      return null;
    }
  }, [clearCodex, clearDeepResearch, clearOpenCode, clearRuflo]);

  const selectCodex = useCallback(async () => {
    setBrowserAgent(null);
    setAgentBrowserAgent(null);
    setOpenPlanterAgent(null);
    setAgentReachAgent(null);
    setGetDocAgent(null);
    setMeetingNotesAgent(null);
    setDeepTutorAgent(null);
    setCareerOpsAgent(null);
    setTradingAgentsAgent(null);
    setVibeTradingAgent(null);
    setDeerFlowAgent(null);
    setShortsAgent(null);
    clearDeepResearch();
    clearOpenCode();
    clearRuflo();
    return selectCodexRuntime();
  }, [clearDeepResearch, clearOpenCode, clearRuflo, selectCodexRuntime]);

  const selectOpenCode = useCallback(async () => {
    setBrowserAgent(null);
    setAgentBrowserAgent(null);
    setOpenPlanterAgent(null);
    setAgentReachAgent(null);
    setGetDocAgent(null);
    setMeetingNotesAgent(null);
    setDeepTutorAgent(null);
    setCareerOpsAgent(null);
    setTradingAgentsAgent(null);
    setVibeTradingAgent(null);
    setDeerFlowAgent(null);
    setShortsAgent(null);
    clearDeepResearch();
    clearCodex();
    clearRuflo();
    return selectOpenCodeRuntime();
  }, [clearCodex, clearDeepResearch, clearRuflo, selectOpenCodeRuntime]);

  const selectRuflo = useCallback(async () => {
    setBrowserAgent(null);
    setAgentBrowserAgent(null);
    setOpenPlanterAgent(null);
    setAgentReachAgent(null);
    setGetDocAgent(null);
    setMeetingNotesAgent(null);
    setDeepTutorAgent(null);
    setCareerOpsAgent(null);
    setTradingAgentsAgent(null);
    setVibeTradingAgent(null);
    setDeerFlowAgent(null);
    setShortsAgent(null);
    clearDeepResearch();
    clearCodex();
    clearOpenCode();
    return selectRufloRuntime();
  }, [clearCodex, clearDeepResearch, clearOpenCode, selectRufloRuntime]);

  const launchOpenPlanterRun = useCallback(
    async (task: string, agentOverride?: { id: string; name: string }) => {
      const selectedAgent = agentOverride ?? openPlanterAgent;
      if (!selectedAgent || launchingOpenPlanterRun) return;
      setLaunchingOpenPlanterRun(true);
      let clientMessageId = crypto.randomUUID();
      const userContent = openPlanterUserMessage(task);
      clientMessageId = session.previewExternalAgentTurn({ clientMessageId, userContent });
      let runStarted = false;
      try {
        const response = await fetch("/api/openplanter/runs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ task, model, reasoningEffort }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data?.run?.runId) {
          throw new Error(
            typeof data?.error === "string" ? data.error : "The OpenPlanter run could not start.",
          );
        }
        runStarted = true;
        await session.appendExternalAgentTurn({
          clientMessageId,
          userContent,
          run: {
            kind: "openplanter",
            runId: String(data.run.runId),
            task,
          },
        });
      } catch (cause) {
        if (runStarted) {
          setAttachmentStatus(
            cause instanceof Error
              ? cause.message
              : "OpenPlanter started, but its chat turn could not be saved.",
          );
          return;
        }
        const assistantContent = `The OpenPlanter task could not start: ${
          cause instanceof Error ? cause.message : "unknown error"
        }`;
        try {
          await session.appendExternalAgentTurn({
            clientMessageId,
            userContent,
            assistantContent,
            outcome: "failed",
          });
        } catch (persistenceError) {
          setAttachmentStatus(
            persistenceError instanceof Error
              ? persistenceError.message
              : "The OpenPlanter turn could not be saved.",
          );
        }
      } finally {
        setLaunchingOpenPlanterRun(false);
      }
    },
    [launchingOpenPlanterRun, model, openPlanterAgent, reasoningEffort, session],
  );

  const launchAgentReachRun = useCallback(
    async (task: string, agentOverride?: { id: string; name: string }) => {
      const selectedAgent = agentOverride ?? agentReachAgent;
      if (!selectedAgent || launchingAgentReachRun) return;
      setLaunchingAgentReachRun(true);
      let clientMessageId = crypto.randomUUID();
      const userContent = agentReachUserMessage(task);
      clientMessageId = session.previewExternalAgentTurn({ clientMessageId, userContent });
      let runStarted = false;
      try {
        const response = await fetch("/api/agent-reach/runs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ task, model, reasoningEffort }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data?.run?.runId) {
          throw new Error(
            typeof data?.error === "string" ? data.error : "The Agent Reach run could not start.",
          );
        }
        runStarted = true;
        await session.appendExternalAgentTurn({
          clientMessageId,
          userContent,
          run: { kind: "agent_reach", runId: String(data.run.runId), task },
        });
      } catch (cause) {
        if (runStarted) {
          setAttachmentStatus(
            cause instanceof Error
              ? cause.message
              : "Agent Reach started, but its chat turn could not be saved.",
          );
          return;
        }
        const assistantContent = `The Agent Reach task could not start: ${
          cause instanceof Error ? cause.message : "unknown error"
        }`;
        try {
          await session.appendExternalAgentTurn({
            clientMessageId,
            userContent,
            assistantContent,
            outcome: "failed",
          });
        } catch (persistenceError) {
          setAttachmentStatus(
            persistenceError instanceof Error
              ? persistenceError.message
              : "The Agent Reach turn could not be saved.",
          );
        }
      } finally {
        setLaunchingAgentReachRun(false);
      }
    },
    [agentReachAgent, launchingAgentReachRun, model, reasoningEffort, session],
  );

  /**
   * Start one run.
   *
   * The recording is named when there is one to name — an attachment in this
   * message, or a capture the composer just staged — and left unnamed
   * otherwise, which tells the run to take the newest recording already on the
   * conversation. That is the same path a Super Agent delegation takes, so the
   * delegated case is exercised by ordinary use rather than only in a test.
   */
  const launchMeetingNotesRun = useCallback(
    async (
      task: string,
      agentOverride?: { id: string; name: string },
      source?: { blobId?: string; uploadId?: string; filename?: string },
    ) => {
      const selectedAgent = agentOverride ?? meetingNotesAgent;
      if (!selectedAgent || launchingMeetingNotesRun) return;
      setLaunchingMeetingNotesRun(true);
      let clientMessageId = crypto.randomUUID();
      const userContent = meetingNotesUserMessage(task);
      // An attached recording is already a normal message attachment. Preserving
      // it on the external-agent turn keeps the playable card from disappearing
      // the moment the run takes the turn over.
      const messageAttachments = chatMessageAttachments(
        chatAttachments.filter(
          (item) => item.type === "video" && item.blobId === source?.blobId,
        ),
      );
      clientMessageId = session.previewExternalAgentTurn({
        clientMessageId,
        userContent,
        attachments: messageAttachments,
      });
      let runStarted = false;
      try {
        const conversationPublicId = await session.ensureConversation(clientMessageId);
        const response = await fetch("/api/meeting-notes/runs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          signal: AbortSignal.timeout(60_000),
          body: JSON.stringify({
            task,
            model,
            reasoningEffort,
            conversationPublicId,
            ...(source?.blobId ? { blobId: source.blobId } : {}),
            ...(source?.uploadId ? { uploadId: source.uploadId } : {}),
            ...(source?.filename ? { filename: source.filename } : {}),
          }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data?.run?.runId) {
          throw new Error(
            typeof data?.error === "string" ? data.error : "The meeting notes could not start.",
          );
        }
        runStarted = true;
        await session.appendExternalAgentTurn({
          clientMessageId,
          userContent,
          attachments: messageAttachments,
          run: { kind: "meeting_notes", runId: String(data.run.runId), task },
        });
      } catch (cause) {
        if (runStarted) {
          setAttachmentStatus(
            cause instanceof Error
              ? cause.message
              : "The run started, but its chat turn could not be saved.",
          );
          return;
        }
        const assistantContent = "The meeting notes could not start: " +
          (cause instanceof Error ? cause.message : "unknown error");
        try {
          await session.appendExternalAgentTurn({
            clientMessageId,
            userContent,
            assistantContent,
            outcome: "failed",
          });
        } catch (persistenceError) {
          setAttachmentStatus(
            persistenceError instanceof Error
              ? persistenceError.message
              : "The Meeting Notes turn could not be saved.",
          );
        }
      } finally {
        setLaunchingMeetingNotesRun(false);
      }
    },
    [chatAttachments, launchingMeetingNotesRun, meetingNotesAgent, model, reasoningEffort, session],
  );

  const launchGetDocRun = useCallback(
    async (task: string, agentOverride?: { id: string; name: string }) => {
      const selectedAgent = agentOverride ?? getDocAgent;
      if (!selectedAgent || launchingGetDocRun) return;
      setLaunchingGetDocRun(true);
      let clientMessageId = crypto.randomUUID();
      const userContent = getDocUserMessage(task);
      clientMessageId = session.previewExternalAgentTurn({ clientMessageId, userContent });
      let runStarted = false;
      try {
        const response = await fetch("/api/get-doc/runs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ task, model, reasoningEffort }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data?.run?.runId) {
          throw new Error(
            typeof data?.error === "string" ? data.error : "The document search could not start.",
          );
        }
        runStarted = true;
        await session.appendExternalAgentTurn({
          clientMessageId,
          userContent,
          run: { kind: "get_doc", runId: String(data.run.runId), query: task },
        });
      } catch (cause) {
        if (runStarted) {
          setAttachmentStatus(
            cause instanceof Error
              ? cause.message
              : "The search started, but its chat turn could not be saved.",
          );
          return;
        }
        const assistantContent = `The document search could not start: ${
          cause instanceof Error ? cause.message : "unknown error"
        }`;
        try {
          await session.appendExternalAgentTurn({
            clientMessageId,
            userContent,
            assistantContent,
            outcome: "failed",
          });
        } catch (persistenceError) {
          setAttachmentStatus(
            persistenceError instanceof Error
              ? persistenceError.message
              : "The Get Doc turn could not be saved.",
          );
        }
      } finally {
        setLaunchingGetDocRun(false);
      }
    },
    [getDocAgent, launchingGetDocRun, model, reasoningEffort, session],
  );

  /**
   * Deep Tutor carries its whole question in the command. The Terminal has no
   * Garden, so no `gardenSlug` is sent — which is exactly what tells the run
   * route to scope the tutor to the workspace rather than to one Garden.
   */
  const launchDeepTutorRun = useCallback(
    async (task: string, agentOverride?: { id: string; name: string }) => {
      const selectedAgent = agentOverride ?? deepTutorAgent;
      if (!selectedAgent || launchingDeepTutorRun) return;
      setLaunchingDeepTutorRun(true);
      let clientMessageId = crypto.randomUUID();
      const userContent = deepTutorUserMessage(task);
      clientMessageId = session.previewExternalAgentTurn({ clientMessageId, userContent });
      let runStarted = false;
      try {
        const response = await fetch("/api/deep-tutor/runs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ task, model, reasoningEffort }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data?.run?.runId) {
          throw new Error(
            typeof data?.error === "string" ? data.error : "The tutoring turn could not start.",
          );
        }
        runStarted = true;
        await session.appendExternalAgentTurn({
          clientMessageId,
          userContent,
          run: {
            kind: "deep_tutor",
            runId: String(data.run.runId),
            task,
            capability: String(data?.request?.capability ?? "chat"),
          },
        });
      } catch (cause) {
        if (runStarted) {
          setAttachmentStatus(
            cause instanceof Error
              ? cause.message
              : "The tutoring turn started, but its chat turn could not be saved.",
          );
          return;
        }
        const assistantContent = `The tutoring turn could not start: ${
          cause instanceof Error ? cause.message : "unknown error"
        }`;
        try {
          await session.appendExternalAgentTurn({
            clientMessageId,
            userContent,
            assistantContent,
            outcome: "failed",
          });
        } catch (persistenceError) {
          setAttachmentStatus(
            persistenceError instanceof Error
              ? persistenceError.message
              : "The Deep Tutor turn could not be saved.",
          );
        }
      } finally {
        setLaunchingDeepTutorRun(false);
      }
    },
    [deepTutorAgent, launchingDeepTutorRun, model, reasoningEffort, session],
  );

  const launchCareerOpsRun = useCallback(
    async (task: string, agentOverride?: { id: string; name: string }) => {
      const selectedAgent = agentOverride ?? careerOpsAgent;
      if (!selectedAgent || launchingCareerOpsRun) return;
      setLaunchingCareerOpsRun(true);
      let clientMessageId = crypto.randomUUID();
      const userContent = careerOpsUserMessage(task);
      clientMessageId = session.previewExternalAgentTurn({ clientMessageId, userContent });
      let runStarted = false;
      try {
        const response = await fetch("/api/career-ops/runs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ task, model, reasoningEffort }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data?.run?.runId) {
          throw new Error(
            typeof data?.error === "string" ? data.error : "The Career Ops run could not start.",
          );
        }
        runStarted = true;
        await session.appendExternalAgentTurn({
          clientMessageId,
          userContent,
          run: { kind: "career_ops", runId: String(data.run.runId), task },
        });
      } catch (cause) {
        if (runStarted) {
          setAttachmentStatus(
            cause instanceof Error
              ? cause.message
              : "Career Ops started, but its chat turn could not be saved.",
          );
          return;
        }
        const assistantContent = `The Career Ops task could not start: ${
          cause instanceof Error ? cause.message : "unknown error"
        }`;
        try {
          await session.appendExternalAgentTurn({
            clientMessageId,
            userContent,
            assistantContent,
            outcome: "failed",
          });
        } catch (persistenceError) {
          setAttachmentStatus(
            persistenceError instanceof Error
              ? persistenceError.message
              : "The Career Ops turn could not be saved.",
          );
        }
      } finally {
        setLaunchingCareerOpsRun(false);
      }
    },
    [careerOpsAgent, launchingCareerOpsRun, model, reasoningEffort, session],
  );

  const launchVibeTradingRun = useCallback(
    async (task: string, agentOverride?: { id: string; name: string }) => {
      const selectedAgent = agentOverride ?? vibeTradingAgent;
      if (!selectedAgent || launchingVibeTradingRun) return;
      setLaunchingVibeTradingRun(true);
      let clientMessageId = crypto.randomUUID();
      const userContent = vibeTradingUserMessage(task);
      clientMessageId = session.previewExternalAgentTurn({ clientMessageId, userContent });
      let runStarted = false;
      try {
        const response = await fetch("/api/vibe-trading/runs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ task, model, reasoningEffort }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data?.run?.runId) {
          throw new Error(
            typeof data?.error === "string" ? data.error : "The Vibe Trading run could not start.",
          );
        }
        runStarted = true;
        await session.appendExternalAgentTurn({
          clientMessageId,
          userContent,
          run: { kind: "vibe_trading", runId: String(data.run.runId), task },
        });
      } catch (cause) {
        if (runStarted) {
          setAttachmentStatus(
            cause instanceof Error
              ? cause.message
              : "Vibe Trading started, but its chat turn could not be saved.",
          );
          return;
        }
        const assistantContent = `The Vibe Trading request could not start: ${
          cause instanceof Error ? cause.message : "unknown error"
        }`;
        try {
          await session.appendExternalAgentTurn({
            clientMessageId,
            userContent,
            assistantContent,
            outcome: "failed",
          });
        } catch (persistenceError) {
          setAttachmentStatus(
            persistenceError instanceof Error
              ? persistenceError.message
              : "The Vibe Trading turn could not be saved.",
          );
        }
      } finally {
        setLaunchingVibeTradingRun(false);
      }
    },
    [launchingVibeTradingRun, model, reasoningEffort, session, vibeTradingAgent],
  );

  const launchStockAnalystRun = useCallback(
    async (task: string, agentOverride?: { id: string; name: string }) => {
      const selectedAgent = agentOverride ?? stockAnalystAgent;
      if (!selectedAgent || launchingStockAnalystRun) return;
      setLaunchingStockAnalystRun(true);
      let clientMessageId = crypto.randomUUID();
      const userContent = stockAnalystUserMessage(task);
      clientMessageId = session.previewExternalAgentTurn({ clientMessageId, userContent });
      let runStarted = false;
      try {
        const response = await fetch("/api/stock-analyst/runs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ task, model }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data?.run?.runId) {
          throw new Error(
            typeof data?.error === "string" ? data.error : "The Stock Analyst run could not start.",
          );
        }
        runStarted = true;
        await session.appendExternalAgentTurn({
          clientMessageId,
          userContent,
          run: { kind: "stock_analyst", runId: String(data.run.runId), task },
        });
      } catch (cause) {
        if (runStarted) {
          setAttachmentStatus(
            cause instanceof Error
              ? cause.message
              : "Stock Analyst started, but its chat turn could not be saved.",
          );
          return;
        }
        const assistantContent = `The Stock Analyst question could not start: ${
          cause instanceof Error ? cause.message : "unknown error"
        }`;
        try {
          await session.appendExternalAgentTurn({
            clientMessageId,
            userContent,
            assistantContent,
            outcome: "failed",
          });
        } catch (persistenceError) {
          setAttachmentStatus(
            persistenceError instanceof Error
              ? persistenceError.message
              : "The Stock Analyst turn could not be saved.",
          );
        }
      } finally {
        setLaunchingStockAnalystRun(false);
      }
    },
    [launchingStockAnalystRun, model, session, stockAnalystAgent],
  );

  /**
   * Carry one instruction to the trading desk. Unlike every other launcher here
   * the task may be empty — a bare `/agents:paper-trader` is how the desk is
   * opened — so nothing refuses on a blank message.
   */
  const launchPaperTraderRun = useCallback(
    async (task: string, agentOverride?: { id: string; name: string }) => {
      const selectedAgent = agentOverride ?? paperTraderAgent;
      if (!selectedAgent || launchingPaperTraderRun) return;
      setLaunchingPaperTraderRun(true);
      let clientMessageId = crypto.randomUUID();
      const userContent = paperTraderUserMessage(task);
      clientMessageId = session.previewExternalAgentTurn({ clientMessageId, userContent });
      let runStarted = false;
      try {
        const response = await fetch("/api/paper-trader/runs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ task }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data?.run?.runId) {
          throw new Error(
            typeof data?.error === "string" ? data.error : "The trading desk could not start.",
          );
        }
        runStarted = true;
        await session.appendExternalAgentTurn({
          clientMessageId,
          userContent,
          run: { kind: "paper_trader", runId: String(data.run.runId), task },
        });
      } catch (cause) {
        if (runStarted) {
          setAttachmentStatus(
            cause instanceof Error
              ? cause.message
              : "The trading desk started, but its chat turn could not be saved.",
          );
          return;
        }
        const assistantContent = `The trading desk could not start: ${
          cause instanceof Error ? cause.message : "unknown error"
        }`;
        try {
          await session.appendExternalAgentTurn({
            clientMessageId,
            userContent,
            assistantContent,
            outcome: "failed",
          });
        } catch (persistenceError) {
          setAttachmentStatus(
            persistenceError instanceof Error
              ? persistenceError.message
              : "The Paper Trader turn could not be saved.",
          );
        }
      } finally {
        setLaunchingPaperTraderRun(false);
      }
    },
    [launchingPaperTraderRun, paperTraderAgent, session],
  );

  /**
   * Start one DeerFlow task. The turn is recorded before the first event
   * arrives so the card streams into it. The conversation must exist first:
   * every file the run presents is stored as an artifact belonging to this chat.
   */
  const launchDeerFlowRun = useCallback(
    async (task: string, agentOverride?: { id: string; name: string }) => {
      const selectedAgent = agentOverride ?? deerFlowAgent;
      if (!selectedAgent || launchingDeerFlowRun) return;
      setLaunchingDeerFlowRun(true);
      let clientMessageId = crypto.randomUUID();
      const userContent = deerFlowUserMessage(task);
      clientMessageId = session.previewExternalAgentTurn({ clientMessageId, userContent });
      let runStarted = false;
      try {
        const conversationPublicId = await session.ensureConversation(clientMessageId);
        const response = await fetch("/api/deer-flow/runs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ task, model, reasoningEffort, conversationPublicId }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data?.run?.runId) {
          throw new Error(
            typeof data?.message === "string"
              ? data.message
              : typeof data?.error === "string"
                ? data.error
                : "The DeerFlow run could not start.",
          );
        }
        runStarted = true;
        await session.appendExternalAgentTurn({
          clientMessageId,
          userContent,
          run: { kind: "deer_flow", runId: String(data.run.runId), task },
        });
      } catch (cause) {
        if (runStarted) {
          setAttachmentStatus(
            cause instanceof Error
              ? cause.message
              : "DeerFlow started, but its chat turn could not be saved.",
          );
          return;
        }
        const assistantContent = `The DeerFlow run could not start: ${
          cause instanceof Error ? cause.message : "unknown error"
        }`;
        try {
          await session.appendExternalAgentTurn({
            clientMessageId,
            userContent,
            assistantContent,
            outcome: "failed",
          });
        } catch (persistenceError) {
          setAttachmentStatus(
            persistenceError instanceof Error
              ? persistenceError.message
              : "The DeerFlow turn could not be saved.",
          );
        }
      } finally {
        setLaunchingDeerFlowRun(false);
      }
    },
    [deerFlowAgent, launchingDeerFlowRun, model, reasoningEffort, session],
  );

  /**
   * Start one analysis. The request is a typed object, not a prompt: the user
   * half of the turn is rendered from it so the transcript reads like a message,
   * but nothing free-form ever reaches the framework.
   */
  const launchTradingAgentsRun = useCallback(
    async (request: TradingAgentsRequest) => {
      if (launchingTradingAgentsRun) return;
      setLaunchingTradingAgentsRun(true);
      let clientMessageId = crypto.randomUUID();
      const userContent = tradingAgentsUserMessage(request);
      const label = tradingAgentsRunLabel(request);
      clientMessageId = session.previewExternalAgentTurn({ clientMessageId, userContent });
      let runStarted = false;
      try {
        const response = await fetch("/api/tradingagents/runs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ request, model, reasoningEffort }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data?.run?.runId) {
          throw new Error(
            typeof data?.error === "string" ? data.error : "The analysis could not start.",
          );
        }
        runStarted = true;
        await session.appendExternalAgentTurn({
          clientMessageId,
          userContent,
          run: { kind: "trading_agents", runId: String(data.run.runId), task: label },
        });
      } catch (cause) {
        if (runStarted) {
          setAttachmentStatus(
            cause instanceof Error
              ? cause.message
              : "The analysis started, but its chat turn could not be saved.",
          );
          return;
        }
        const assistantContent = `The analysis could not start: ${
          cause instanceof Error ? cause.message : "unknown error"
        }`;
        try {
          await session.appendExternalAgentTurn({
            clientMessageId,
            userContent,
            assistantContent,
            outcome: "failed",
          });
        } catch (persistenceError) {
          setAttachmentStatus(
            persistenceError instanceof Error
              ? persistenceError.message
              : "The analysis turn could not be saved.",
          );
        }
      } finally {
        setLaunchingTradingAgentsRun(false);
      }
    },
    [launchingTradingAgentsRun, model, reasoningEffort, session],
  );

  /**
   * Start one video edit.
   *
   * This is the only launcher that can fire without anybody choosing an agent:
   * a video attached to an editing instruction is an edit, and making the person
   * find a menu first would be making them do the routing. The gate is
   * `videoEditIntent`, which is deliberately narrow — a video attached to a
   * question stays a question.
   *
   * The video travels as the blob id the composer already stored it under, so
   * nothing is uploaded twice and no path ever comes from the page.
   */
  const launchVideoUseRun = useCallback(
    async (
      prompt: string,
      video: VideoUseLaunchSource,
      options: { branchGroupId?: string; userContent?: string } = {},
    ) => {
      if (launchingVideoUseRun) return;
      setLaunchingVideoUseRun(true);
      let clientMessageId = crypto.randomUUID();
      // The transcript shows what the person wrote. This agent selects itself,
      // so synthesising `/agents:video-use …` into their message would put a
      // command there that they never typed — and, in Super Agent mode where no
      // agent was chosen at all, would misrepresent the turn entirely. The
      // rendered form is only the fallback for a caller with nothing better.
      const userContent = options.userContent ?? videoUseUserMessage(prompt);
      const label = videoUseRunLabel({ prompt, sourceName: video.name });
      // An uploaded video is already a normal message attachment. Preserve it
      // on the external-agent turn so auto-routing to Video Use does not make
      // the playable card (and the Uploads entry) disappear. A linked video's
      // attachment is added by the run after the download creates its blob id.
      const messageAttachments = "blobId" in video ? [video] : [];
      clientMessageId = session.previewExternalAgentTurn({
        clientMessageId,
        userContent,
        branchGroupId: options.branchGroupId,
        attachments: messageAttachments,
      });
      let runStarted = false;
      try {
        const conversationPublicId = await session.ensureConversation(clientMessageId);
        // Bounded: the run card — and with it the only Stop button — does not
        // exist until this resolves, so a request that never answers would
        // leave the composer inert with nothing to press. Starting a run is
        // bookkeeping; the work itself happens after, on its own stream.
        const response = await fetch("/api/video-use/runs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          signal: AbortSignal.timeout(60_000),
          body: JSON.stringify({
            request: {
              ...("blobId" in video ? { blobId: video.blobId } : { url: video.url }),
              filename: video.name,
              prompt,
            },
            model,
            conversationPublicId,
          }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data?.run?.runId) {
          throw new Error(
            typeof data?.error === "string" ? data.error : "The edit could not start.",
          );
        }
        runStarted = true;
        await session.appendExternalAgentTurn({
          clientMessageId,
          userContent,
          run: {
            kind: "video_use",
            runId: String(data.run.runId),
            task: label,
            // Read at launch, stored on the turn: what the toggle says later
            // must not change how a finished turn reads.
            ...(isSuperAgentEnabled() ? { quiet: true } : {}),
          },
          branchGroupId: options.branchGroupId,
          attachments: messageAttachments,
        });
      } catch (cause) {
        if (runStarted) {
          setAttachmentStatus(
            cause instanceof Error
              ? cause.message
              : "The edit started, but its chat turn could not be saved.",
          );
          return;
        }
        const assistantContent = `The edit could not start: ${
          cause instanceof Error
            ? cause.name === "TimeoutError"
              ? "the runtime did not answer in time."
              : cause.message
            : "unknown error"
        }`;
        try {
          await session.appendExternalAgentTurn({
            clientMessageId,
            userContent,
            assistantContent,
            outcome: "failed",
            branchGroupId: options.branchGroupId,
            attachments: messageAttachments,
          });
        } catch (persistenceError) {
          setAttachmentStatus(
            persistenceError instanceof Error
              ? persistenceError.message
              : "The Video Use turn could not be saved.",
          );
        }
      } finally {
        setLaunchingVideoUseRun(false);
      }
    },
    [launchingVideoUseRun, model, session],
  );

  /**
   * The video an instruction is aimed at, and only when it really is an
   * instruction. Shared by the composer and by retry, because Video Use has no
   * slash token in the message — it selects itself from the wording — so a
   * retry that did not ask this question would quietly hand a re-run of an edit
   * to the general agent, which then does it by hand.
   */
  const videoUseSource = useCallback(
    (
      text: string,
      attachments: readonly ChatAttachment[],
    ): VideoUseLaunchSource | null => {
      // An attached video wins over a link in the same message: it is already
      // here, so there is nothing to fetch.
      const attached = attachments.find((item) => item.type === "video");
      if (attached) return attached;
      const linked = firstVideoSource(text);
      return linked ? { url: linked.canonicalUrl, name: linked.label } : null;
    },
    [],
  );

  const videoUseTarget = useCallback(
    (
      text: string,
      attachments: readonly ChatAttachment[],
    ): VideoUseLaunchSource | null => {
      if (!text || launchingVideoUseRun || !videoEditIntent(text).edit) return null;
      return videoUseSource(text, attachments);
    },
    [launchingVideoUseRun, videoUseSource],
  );


  /**
   * Start one cutting run. Like Trading Agent the request is a typed object,
   * not a prompt: the user half of the turn is rendered from it so the
   * transcript reads like a message, but nothing free-form ever reaches the
   * pipeline. The conversation must exist first — every clip is stored as an
   * artifact that belongs to this chat.
   */
  const launchShortsRun = useCallback(
    async (request: ShortsRequest) => {
      if (launchingShortsRun) return;
      setLaunchingShortsRun(true);
      let clientMessageId = crypto.randomUUID();
      const userContent = shortsUserMessage(request);
      const label = shortsRunLabel(request);
      clientMessageId = session.previewExternalAgentTurn({ clientMessageId, userContent });
      let runStarted = false;
      try {
        const conversationPublicId = await session.ensureConversation(clientMessageId);
        const response = await fetch("/api/shorts/runs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ request, model, conversationPublicId }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data?.run?.runId) {
          throw new Error(
            typeof data?.error === "string" ? data.error : "The clips could not start.",
          );
        }
        runStarted = true;
        await session.appendExternalAgentTurn({
          clientMessageId,
          userContent,
          run: { kind: "shorts", runId: String(data.run.runId), task: label },
        });
      } catch (cause) {
        if (runStarted) {
          setAttachmentStatus(
            cause instanceof Error
              ? cause.message
              : "The run started, but its chat turn could not be saved.",
          );
          return;
        }
        const assistantContent = `The clips could not start: ${
          cause instanceof Error ? cause.message : "unknown error"
        }`;
        try {
          await session.appendExternalAgentTurn({
            clientMessageId,
            userContent,
            assistantContent,
            outcome: "failed",
          });
        } catch (persistenceError) {
          setAttachmentStatus(
            persistenceError instanceof Error
              ? persistenceError.message
              : "The Shorts turn could not be saved.",
          );
        }
      } finally {
        setLaunchingShortsRun(false);
      }
    },
    [launchingShortsRun, model, session],
  );

  /** Start one picture-to-GLB run; no free-form prompt enters ShapeR. */
  const launchFormsmithRun = useCallback(
    async (request: FormsmithRequest) => {
      if (launchingFormsmithRun) return;
      setLaunchingFormsmithRun(true);
      let clientMessageId = crypto.randomUUID();
      const userContent = formsmithUserMessage(request);
      const label = formsmithRunLabel(request);
      clientMessageId = session.previewExternalAgentTurn({ clientMessageId, userContent });
      let runStarted = false;
      try {
        const conversationPublicId = await session.ensureConversation(clientMessageId);
        const response = await fetch("/api/shaper/runs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ request, conversationPublicId }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data?.run?.runId) {
          throw new Error(typeof data?.error === "string" ? data.error : "The reconstruction could not start.");
        }
        runStarted = true;
        await session.appendExternalAgentTurn({
          clientMessageId,
          userContent,
          run: { kind: "formsmith", runId: String(data.run.runId), task: label },
        });
      } catch (cause) {
        if (runStarted) {
          setAttachmentStatus(cause instanceof Error ? cause.message : "The run started, but its chat turn could not be saved.");
          return;
        }
        const assistantContent = `The reconstruction could not start: ${cause instanceof Error ? cause.message : "unknown error"}`;
        try {
          await session.appendExternalAgentTurn({
            clientMessageId,
            userContent,
            assistantContent,
            outcome: "failed",
          });
        } catch (persistenceError) {
          setAttachmentStatus(persistenceError instanceof Error ? persistenceError.message : "The Formsmith turn could not be saved.");
        }
      } finally {
        setLaunchingFormsmithRun(false);
      }
    },
    [launchingFormsmithRun, session],
  );

  /**
   * The Socials Manager needs no agent selection — the command carries the whole brief, so
   * the run starts straight from the token. `session.sessionId` is the
   * conversation the posts and artifacts hang off. Ensure it before starting
   * the run so first-turn artifacts are just as durable as later ones.
   */
  const launchSocialsManagerRun = useCallback(
    async (
      brief: string,
      options: { branchGroupId?: string } = {},
    ) => {
      if (socialsManagerDispatchingRef.current) return;
      socialsManagerDispatchingRef.current = true;
      setLaunchingSocialsManagerRun(true);
      let clientMessageId = crypto.randomUUID();
      const userContent = socialsManagerUserMessage(brief);
      clientMessageId = session.previewExternalAgentTurn({
        clientMessageId,
        userContent,
        branchGroupId: options.branchGroupId,
      });
      let runStarted = false;
      try {
        const conversationPublicId = await session.ensureConversation(clientMessageId);
        const response = await fetch("/api/socials-manager/runs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            brief,
            model,
            conversationPublicId,
          }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data?.run?.runId) {
          throw new Error(
            typeof data?.error === "string" ? data.error : "The Socials Manager run could not start.",
          );
        }
        runStarted = true;
        await session.appendExternalAgentTurn({
          clientMessageId,
          userContent,
          run: {
            kind: "socials_manager",
            runId: String(data.run.runId),
            brief,
          },
          branchGroupId: options.branchGroupId,
        });
      } catch (cause) {
        if (runStarted) {
          setAttachmentStatus(
            cause instanceof Error
              ? cause.message
              : "The Socials Manager started, but its chat turn could not be saved.",
          );
          return;
        }
        const assistantContent = `The Socials Manager task could not start: ${
          cause instanceof Error ? cause.message : "unknown error"
        }`;
        try {
          await session.appendExternalAgentTurn({
            clientMessageId,
            userContent,
            assistantContent,
            outcome: "failed",
            branchGroupId: options.branchGroupId,
          });
        } catch (persistenceError) {
          setAttachmentStatus(
            persistenceError instanceof Error
              ? persistenceError.message
              : "The Socials Manager turn could not be saved.",
          );
        }
      } finally {
        socialsManagerDispatchingRef.current = false;
        setLaunchingSocialsManagerRun(false);
      }
    },
    [model, session],
  );

  /**
   * Hardware Blueprint needs no agent selection either: the command carries the
   * whole brief. The conversation must exist first so the compiled blueprint can
   * be stored as an artifact that belongs to this chat.
   */
  const launchHardwareBlueprintRun = useCallback(
    async (
      brief: string,
      options: { branchGroupId?: string } = {},
    ) => {
      if (hardwareDispatchingRef.current) return;
      hardwareDispatchingRef.current = true;
      setLaunchingHardwareRun(true);
      const normalizedBrief = brief.trim();
      const requestedClientMessageId = crypto.randomUUID();
      let clientMessageId = requestedClientMessageId;
      const userContent = hardwareBlueprintUserMessage(normalizedBrief);
      clientMessageId = session.previewExternalAgentTurn({
        clientMessageId,
        userContent,
        branchGroupId: options.branchGroupId,
      });
      const attachToExistingTurn = clientMessageId !== requestedClientMessageId;
      let runStarted = false;
      try {
        const conversationPublicId = await session.ensureConversation(clientMessageId);
        const response = await fetch("/api/hardware-blueprint/runs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            brief: normalizedBrief,
            model,
            reasoningEffort,
            conversationPublicId,
            clientMessageId,
            attachToExistingTurn,
            branchGroupId: options.branchGroupId,
          }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data?.run?.runId) {
          throw new Error(
            typeof data?.error === "string"
              ? data.error
              : "The hardware blueprint run could not start.",
          );
        }
        runStarted = true;
        await session.appendExternalAgentTurn({
          clientMessageId,
          userContent,
          run: {
            kind: "hardware_blueprint",
            runId: String(data.run.runId),
            brief: normalizedBrief,
          },
          branchGroupId: options.branchGroupId,
        });
      } catch (cause) {
        if (runStarted) {
          setAttachmentStatus(
            cause instanceof Error
              ? cause.message
              : "The blueprint started, but its chat turn could not be saved.",
          );
          return;
        }
        const assistantContent = `The hardware blueprint could not start: ${
          cause instanceof Error ? cause.message : "unknown error"
        }`;
        try {
          await session.appendExternalAgentTurn({
            clientMessageId,
            userContent,
            assistantContent,
            outcome: "failed",
            branchGroupId: options.branchGroupId,
          });
        } catch (persistenceError) {
          setAttachmentStatus(
            persistenceError instanceof Error
              ? persistenceError.message
              : "The Hardware Blueprint turn could not be saved.",
          );
        }
      } finally {
        hardwareDispatchingRef.current = false;
        setLaunchingHardwareRun(false);
      }
    },
    [model, reasoningEffort, session],
  );

  const routeHardwareBlueprintCommand = useCallback(
    (text: string, options: { branchGroupId?: string } = {}): boolean => {
      const brief = taskFromHardwareBlueprintCommand(text);
      if (brief === null) return false;
      setAttachmentStatus("");
      if (brief && !hardwareDispatchingRef.current) {
        void launchHardwareBlueprintRun(brief, options);
      }
      return true;
    },
    [launchHardwareBlueprintRun],
  );

  /**
   * Parametric CAD needs no agent selection either: the command carries the
   * whole brief. The conversation must exist first so the built design can be
   * stored as an artifact that belongs to this chat.
   */
  const launchParametricCadRun = useCallback(
    async (
      brief: string,
      options: { branchGroupId?: string } = {},
    ) => {
      if (cadDispatchingRef.current) return;
      cadDispatchingRef.current = true;
      setLaunchingCadRun(true);
      const normalizedBrief = brief.trim();
      const requestedClientMessageId = crypto.randomUUID();
      let clientMessageId = requestedClientMessageId;
      const userContent = parametricCadUserMessage(normalizedBrief);
      clientMessageId = session.previewExternalAgentTurn({
        clientMessageId,
        userContent,
        branchGroupId: options.branchGroupId,
      });
      const attachToExistingTurn = clientMessageId !== requestedClientMessageId;
      let runStarted = false;
      try {
        const conversationPublicId = await session.ensureConversation(clientMessageId);
        const response = await fetch("/api/cad/runs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            brief: normalizedBrief,
            model,
            reasoningEffort,
            conversationPublicId,
            clientMessageId,
            attachToExistingTurn,
            branchGroupId: options.branchGroupId,
          }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data?.run?.runId) {
          throw new Error(
            typeof data?.error === "string"
              ? data.error
              : "The parametric CAD run could not start.",
          );
        }
        runStarted = true;
        await session.appendExternalAgentTurn({
          clientMessageId,
          userContent,
          run: {
            kind: "parametric_cad",
            runId: String(data.run.runId),
            brief: normalizedBrief,
          },
          branchGroupId: options.branchGroupId,
        });
      } catch (cause) {
        if (runStarted) {
          setAttachmentStatus(
            cause instanceof Error
              ? cause.message
              : "The design started, but its chat turn could not be saved.",
          );
          return;
        }
        const assistantContent = `The parametric CAD run could not start: ${
          cause instanceof Error ? cause.message : "unknown error"
        }`;
        try {
          await session.appendExternalAgentTurn({
            clientMessageId,
            userContent,
            assistantContent,
            outcome: "failed",
            branchGroupId: options.branchGroupId,
          });
        } catch (persistenceError) {
          setAttachmentStatus(
            persistenceError instanceof Error
              ? persistenceError.message
              : "The Parametric CAD turn could not be saved.",
          );
        }
      } finally {
        cadDispatchingRef.current = false;
        setLaunchingCadRun(false);
      }
    },
    [model, reasoningEffort, session],
  );

  const routeParametricCadCommand = useCallback(
    (text: string, options: { branchGroupId?: string } = {}): boolean => {
      const brief = taskFromParametricCadCommand(text);
      if (brief === null) return false;
      setAttachmentStatus("");
      if (brief && !cadDispatchingRef.current) {
        void launchParametricCadRun(brief, options);
      }
      return true;
    },
    [launchParametricCadRun],
  );

  /**
   * HyperFrames carries its whole brief in the command too. The run is long —
   * a video is written, checked in a browser and encoded — so the turn is
   * recorded before the first event arrives and the card streams into it.
   */
  const launchHyperframesRun = useCallback(
    async (brief: string, options: { branchGroupId?: string } = {}) => {
      if (hyperframesDispatchingRef.current) return;
      hyperframesDispatchingRef.current = true;
      setLaunchingHyperframesRun(true);
      let clientMessageId = crypto.randomUUID();
      const userContent = hyperframesUserMessage(brief);
      clientMessageId = session.previewExternalAgentTurn({
        clientMessageId,
        userContent,
        branchGroupId: options.branchGroupId,
      });
      let runStarted = false;
      try {
        await session.ensureConversation(clientMessageId);
        const response = await fetch("/api/hyperframes/runs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ brief, model, reasoningEffort }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data?.run?.runId) {
          throw new Error(
            typeof data?.message === "string"
              ? data.message
              : typeof data?.error === "string"
                ? data.error
                : "The video build could not start.",
          );
        }
        runStarted = true;
        await session.appendExternalAgentTurn({
          clientMessageId,
          userContent,
          run: {
            kind: "hyperframes",
            runId: String(data.run.runId),
            brief,
          },
          branchGroupId: options.branchGroupId,
        });
      } catch (cause) {
        if (runStarted) {
          setAttachmentStatus(
            cause instanceof Error
              ? cause.message
              : "The video build started, but its chat turn could not be saved.",
          );
          return;
        }
        const assistantContent = `The video build could not start: ${
          cause instanceof Error ? cause.message : "unknown error"
        }`;
        try {
          await session.appendExternalAgentTurn({
            clientMessageId,
            userContent,
            assistantContent,
            outcome: "failed",
            branchGroupId: options.branchGroupId,
          });
        } catch (persistenceError) {
          setAttachmentStatus(
            persistenceError instanceof Error
              ? persistenceError.message
              : "The HyperFrames turn could not be saved.",
          );
        }
      } finally {
        hyperframesDispatchingRef.current = false;
        setLaunchingHyperframesRun(false);
      }
    },
    [model, reasoningEffort, session],
  );

  const routeHyperframesCommand = useCallback(
    (text: string, options: { branchGroupId?: string } = {}): boolean => {
      const brief = briefFromHyperframesCommand(text);
      if (brief === null) return false;
      setAttachmentStatus("");
      if (brief && !hyperframesDispatchingRef.current) {
        void launchHyperframesRun(brief, options);
      }
      return true;
    },
    [launchHyperframesRun],
  );

  const launchResource2SkillRun = useCallback(
    async (brief: string, options: { branchGroupId?: string } = {}) => {
      if (resource2SkillDispatchingRef.current) return;
      resource2SkillDispatchingRef.current = true;
      setLaunchingResource2SkillRun(true);
      let clientMessageId = crypto.randomUUID();
      const userContent = resource2SkillUserMessage(brief);
      clientMessageId = session.previewExternalAgentTurn({
        clientMessageId,
        userContent,
        branchGroupId: options.branchGroupId,
      });
      let runStarted = false;
      try {
        await session.ensureConversation(clientMessageId);
        const response = await fetch("/api/resource2skill/runs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ brief, model, reasoningEffort }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data?.run?.runId) {
          throw new Error(
            typeof data?.message === "string"
              ? data.message
              : typeof data?.error === "string"
                ? data.error
                : "The Resource2Skill run could not start.",
          );
        }
        runStarted = true;
        await session.appendExternalAgentTurn({
          clientMessageId,
          userContent,
          run: { kind: "resource2skill", runId: String(data.run.runId), brief },
          branchGroupId: options.branchGroupId,
        });
      } catch (cause) {
        if (runStarted) {
          setAttachmentStatus(cause instanceof Error ? cause.message : "The run started, but its chat turn could not be saved.");
          return;
        }
        const assistantContent = `The Resource2Skill run could not start: ${cause instanceof Error ? cause.message : "unknown error"}`;
        try {
          await session.appendExternalAgentTurn({ clientMessageId, userContent, assistantContent, outcome: "failed", branchGroupId: options.branchGroupId });
        } catch (persistenceError) {
          setAttachmentStatus(persistenceError instanceof Error ? persistenceError.message : "The Resource2Skill turn could not be saved.");
        }
      } finally {
        resource2SkillDispatchingRef.current = false;
        setLaunchingResource2SkillRun(false);
      }
    },
    [model, reasoningEffort, session],
  );

  const routeResource2SkillCommand = useCallback(
    (text: string, options: { branchGroupId?: string } = {}): boolean => {
      const brief = briefFromResource2SkillCommand(text);
      if (brief === null) return false;
      setAttachmentStatus("");
      if (brief && !resource2SkillDispatchingRef.current) void launchResource2SkillRun(brief, options);
      return true;
    },
    [launchResource2SkillRun],
  );

  /**
   * OpenMontage carries its whole production brief in the command. A production
   * is the longest run in the palette — it plans, generates, edits and renders —
   * so the turn is recorded as soon as the run starts and the card reports the
   * pipeline's own stages while it works.
   */
  const launchOpenMontageRun = useCallback(
    async (brief: string, options: { branchGroupId?: string } = {}) => {
      if (openMontageDispatchingRef.current) return;
      openMontageDispatchingRef.current = true;
      setLaunchingOpenMontageRun(true);
      let clientMessageId = crypto.randomUUID();
      const userContent = openMontageUserMessage(brief);
      clientMessageId = session.previewExternalAgentTurn({
        clientMessageId,
        userContent,
        branchGroupId: options.branchGroupId,
      });
      let runStarted = false;
      try {
        await session.ensureConversation(clientMessageId);
        const response = await fetch("/api/openmontage/runs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ brief, model, reasoningEffort }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data?.run?.runId) {
          throw new Error(
            typeof data?.message === "string"
              ? data.message
              : typeof data?.error === "string"
                ? data.error
                : "The production could not start.",
          );
        }
        runStarted = true;
        await session.appendExternalAgentTurn({
          clientMessageId,
          userContent,
          run: {
            kind: "openmontage",
            runId: String(data.run.runId),
            brief,
          },
          branchGroupId: options.branchGroupId,
        });
      } catch (cause) {
        if (runStarted) {
          setAttachmentStatus(
            cause instanceof Error
              ? cause.message
              : "The production started, but its chat turn could not be saved.",
          );
          return;
        }
        const assistantContent = `The production could not start: ${
          cause instanceof Error ? cause.message : "unknown error"
        }`;
        try {
          await session.appendExternalAgentTurn({
            clientMessageId,
            userContent,
            assistantContent,
            outcome: "failed",
            branchGroupId: options.branchGroupId,
          });
        } catch (persistenceError) {
          setAttachmentStatus(
            persistenceError instanceof Error
              ? persistenceError.message
              : "The OpenMontage turn could not be saved.",
          );
        }
      } finally {
        openMontageDispatchingRef.current = false;
        setLaunchingOpenMontageRun(false);
      }
    },
    [model, reasoningEffort, session],
  );

  const routeOpenMontageCommand = useCallback(
    (text: string, options: { branchGroupId?: string } = {}): boolean => {
      const brief = briefFromOpenMontageCommand(text);
      if (brief === null) return false;
      setAttachmentStatus("");
      if (brief && !openMontageDispatchingRef.current) {
        void launchOpenMontageRun(brief, options);
      }
      return true;
    },
    [launchOpenMontageRun],
  );

  /**
   * OpenWork carries its whole task in the command. A cold run pays for opening
   * the workspace — the engine and the OpenWork server both have to start — so
   * the turn is recorded before the first event arrives and the card says what
   * is happening while it waits.
   */
  const launchOpenworkRun = useCallback(
    async (task: string, options: { branchGroupId?: string } = {}) => {
      if (openworkDispatchingRef.current) return;
      openworkDispatchingRef.current = true;
      setLaunchingOpenworkRun(true);
      let clientMessageId = crypto.randomUUID();
      const userContent = openworkUserMessage(task);
      clientMessageId = session.previewExternalAgentTurn({
        clientMessageId,
        userContent,
        branchGroupId: options.branchGroupId,
      });
      let runStarted = false;
      try {
        await session.ensureConversation(clientMessageId);
        const response = await fetch("/api/openwork/runs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ task, model, reasoningEffort }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data?.run?.runId) {
          throw new Error(
            typeof data?.message === "string"
              ? data.message
              : typeof data?.error === "string"
                ? data.error
                : "The OpenWork run could not start.",
          );
        }
        runStarted = true;
        await session.appendExternalAgentTurn({
          clientMessageId,
          userContent,
          run: {
            kind: "openwork",
            runId: String(data.run.runId),
            task,
          },
          branchGroupId: options.branchGroupId,
        });
      } catch (cause) {
        if (runStarted) {
          setAttachmentStatus(
            cause instanceof Error
              ? cause.message
              : "The OpenWork run started, but its chat turn could not be saved.",
          );
          return;
        }
        const assistantContent = `The OpenWork run could not start: ${
          cause instanceof Error ? cause.message : "unknown error"
        }`;
        try {
          await session.appendExternalAgentTurn({
            clientMessageId,
            userContent,
            assistantContent,
            outcome: "failed",
            branchGroupId: options.branchGroupId,
          });
        } catch (persistenceError) {
          setAttachmentStatus(
            persistenceError instanceof Error
              ? persistenceError.message
              : "The OpenWork turn could not be saved.",
          );
        }
      } finally {
        openworkDispatchingRef.current = false;
        setLaunchingOpenworkRun(false);
      }
    },
    [model, reasoningEffort, session],
  );

  const routeOpenworkCommand = useCallback(
    (text: string, options: { branchGroupId?: string } = {}): boolean => {
      const task = taskFromOpenworkCommand(text);
      if (task === null) return false;
      setAttachmentStatus("");
      if (task && !openworkDispatchingRef.current) {
        void launchOpenworkRun(task, options);
      }
      return true;
    },
    [launchOpenworkRun],
  );

  /**
   * OpenScience carries its whole research goal in the command. A cold run pays
   * for booting the runtime — it loads its skill library and opens its storage
   * before the first token — so the turn is recorded before the first event
   * arrives and the card says what is happening while it waits.
   */
  const launchOpenscienceRun = useCallback(
    async (task: string, options: { branchGroupId?: string } = {}) => {
      if (openscienceDispatchingRef.current) return;
      openscienceDispatchingRef.current = true;
      setLaunchingOpenscienceRun(true);
      let clientMessageId = crypto.randomUUID();
      const userContent = openscienceUserMessage(task);
      clientMessageId = session.previewExternalAgentTurn({
        clientMessageId,
        userContent,
        branchGroupId: options.branchGroupId,
      });
      let runStarted = false;
      try {
        await session.ensureConversation(clientMessageId);
        const response = await fetch("/api/openscience/runs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ task, model, reasoningEffort }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data?.run?.runId) {
          throw new Error(
            typeof data?.message === "string"
              ? data.message
              : typeof data?.error === "string"
                ? data.error
                : "The OpenScience run could not start.",
          );
        }
        runStarted = true;
        await session.appendExternalAgentTurn({
          clientMessageId,
          userContent,
          run: {
            kind: "openscience",
            runId: String(data.run.runId),
            task,
          },
          branchGroupId: options.branchGroupId,
        });
      } catch (cause) {
        if (runStarted) {
          setAttachmentStatus(
            cause instanceof Error
              ? cause.message
              : "The OpenScience run started, but its chat turn could not be saved.",
          );
          return;
        }
        const assistantContent = `The OpenScience run could not start: ${
          cause instanceof Error ? cause.message : "unknown error"
        }`;
        try {
          await session.appendExternalAgentTurn({
            clientMessageId,
            userContent,
            assistantContent,
            outcome: "failed",
            branchGroupId: options.branchGroupId,
          });
        } catch (persistenceError) {
          setAttachmentStatus(
            persistenceError instanceof Error
              ? persistenceError.message
              : "The OpenScience turn could not be saved.",
          );
        }
      } finally {
        openscienceDispatchingRef.current = false;
        setLaunchingOpenscienceRun(false);
      }
    },
    [model, reasoningEffort, session],
  );

  const routeOpenscienceCommand = useCallback(
    (text: string, options: { branchGroupId?: string } = {}): boolean => {
      const task = taskFromOpenscienceCommand(text);
      if (task === null) return false;
      setAttachmentStatus("");
      if (task && !openscienceDispatchingRef.current) {
        void launchOpenscienceRun(task, options);
      }
      return true;
    },
    [launchOpenscienceRun],
  );


  /**
   * Inbox Zero carries its whole instruction in the command. A cold run pays for
   * starting the mail app's containers — the first one pulls images and migrates
   * a database — so the turn is recorded before the first event arrives and the
   * card says what is happening while it waits.
   */
  const launchInboxZeroRun = useCallback(
    async (task: string, options: { branchGroupId?: string } = {}) => {
      if (inboxZeroDispatchingRef.current) return;
      inboxZeroDispatchingRef.current = true;
      setLaunchingInboxZeroRun(true);
      let clientMessageId = crypto.randomUUID();
      const userContent = inboxZeroUserMessage(task);
      clientMessageId = session.previewExternalAgentTurn({
        clientMessageId,
        userContent,
        branchGroupId: options.branchGroupId,
      });
      let runStarted = false;
      try {
        await session.ensureConversation(clientMessageId);
        const response = await fetch("/api/inbox-zero/runs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ task, model }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data?.run?.runId) {
          throw new Error(
            typeof data?.message === "string"
              ? data.message
              : typeof data?.error === "string"
                ? data.error
                : "The Inbox Zero run could not start.",
          );
        }
        runStarted = true;
        await session.appendExternalAgentTurn({
          clientMessageId,
          userContent,
          run: {
            kind: "inbox_zero",
            runId: String(data.run.runId),
            task,
          },
          branchGroupId: options.branchGroupId,
        });
      } catch (cause) {
        if (runStarted) {
          setAttachmentStatus(
            cause instanceof Error
              ? cause.message
              : "The Inbox Zero run started, but its chat turn could not be saved.",
          );
          return;
        }
        const assistantContent = `The Inbox Zero run could not start: ${
          cause instanceof Error ? cause.message : "unknown error"
        }`;
        try {
          await session.appendExternalAgentTurn({
            clientMessageId,
            userContent,
            assistantContent,
            outcome: "failed",
            branchGroupId: options.branchGroupId,
          });
        } catch (persistenceError) {
          setAttachmentStatus(
            persistenceError instanceof Error
              ? persistenceError.message
              : "The Inbox Zero turn could not be saved.",
          );
        }
      } finally {
        inboxZeroDispatchingRef.current = false;
        setLaunchingInboxZeroRun(false);
      }
    },
    [model, session],
  );

  const routeInboxZeroCommand = useCallback(
    (text: string, options: { branchGroupId?: string } = {}): boolean => {
      const task = taskFromInboxZeroCommand(text);
      if (task === null) return false;
      setAttachmentStatus("");
      if (task && !inboxZeroDispatchingRef.current) {
        void launchInboxZeroRun(task, options);
      }
      return true;
    },
    [launchInboxZeroRun],
  );

  /**
   * ViMax carries its whole brief in the command too. The run writes a story,
   * storyboards it and draws the frames, so the turn is recorded before the
   * first event arrives and the card streams into it. The conversation must
   * exist first: the film — and every frame drawn for it — is stored as an
   * artifact that belongs to this chat.
   */
  const launchVimaxRun = useCallback(
    async (brief: string, options: { branchGroupId?: string } = {}) => {
      if (vimaxDispatchingRef.current) return;
      vimaxDispatchingRef.current = true;
      setLaunchingVimaxRun(true);
      let clientMessageId = crypto.randomUUID();
      const userContent = vimaxUserMessage(brief);
      clientMessageId = session.previewExternalAgentTurn({
        clientMessageId,
        userContent,
        branchGroupId: options.branchGroupId,
      });
      let runStarted = false;
      try {
        const conversationPublicId = await session.ensureConversation(clientMessageId);
        const response = await fetch("/api/vimax/runs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ brief, model, reasoningEffort, conversationPublicId }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data?.run?.runId) {
          throw new Error(
            typeof data?.message === "string"
              ? data.message
              : typeof data?.error === "string"
                ? data.error
                : "The film could not start.",
          );
        }
        runStarted = true;
        await session.appendExternalAgentTurn({
          clientMessageId,
          userContent,
          run: { kind: "vimax", runId: String(data.run.runId), brief },
          branchGroupId: options.branchGroupId,
        });
      } catch (cause) {
        if (runStarted) {
          setAttachmentStatus(
            cause instanceof Error
              ? cause.message
              : "The film started, but its chat turn could not be saved.",
          );
          return;
        }
        const assistantContent = `The film could not start: ${
          cause instanceof Error ? cause.message : "unknown error"
        }`;
        try {
          await session.appendExternalAgentTurn({
            clientMessageId,
            userContent,
            assistantContent,
            outcome: "failed",
            branchGroupId: options.branchGroupId,
          });
        } catch (persistenceError) {
          setAttachmentStatus(
            persistenceError instanceof Error
              ? persistenceError.message
              : "The ViMax turn could not be saved.",
          );
        }
      } finally {
        vimaxDispatchingRef.current = false;
        setLaunchingVimaxRun(false);
      }
    },
    [model, reasoningEffort, session],
  );

  const routeVimaxCommand = useCallback(
    (text: string, options: { branchGroupId?: string } = {}): boolean => {
      const brief = briefFromVimaxCommand(text);
      if (brief === null) return false;
      setAttachmentStatus("");
      if (brief && !vimaxDispatchingRef.current) {
        void launchVimaxRun(brief, options);
      }
      return true;
    },
    [launchVimaxRun],
  );

  const launchMoneyPrinterRun = useCallback(
    async (brief: string, options: { branchGroupId?: string } = {}) => {
      if (moneyPrinterDispatchingRef.current) return;
      moneyPrinterDispatchingRef.current = true;
      setLaunchingMoneyPrinterRun(true);
      let clientMessageId = crypto.randomUUID();
      const userContent = moneyPrinterUserMessage(brief);
      clientMessageId = session.previewExternalAgentTurn({
        clientMessageId,
        userContent,
        branchGroupId: options.branchGroupId,
      });
      let runStarted = false;
      try {
        // The video is an artifact of this conversation, so the conversation has
        // to exist before the run that produces it.
        const conversationPublicId = await session.ensureConversation(clientMessageId);
        const response = await fetch("/api/money-printer/runs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ brief, model, conversationPublicId }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data?.run?.runId) {
          throw new Error(
            typeof data?.message === "string"
              ? data.message
              : typeof data?.error === "string"
                ? data.error
                : "The video could not start.",
          );
        }
        runStarted = true;
        await session.appendExternalAgentTurn({
          clientMessageId,
          userContent,
          run: { kind: "money_printer", runId: String(data.run.runId), brief },
          branchGroupId: options.branchGroupId,
        });
      } catch (cause) {
        if (runStarted) {
          setAttachmentStatus(
            cause instanceof Error
              ? cause.message
              : "The video started, but its chat turn could not be saved.",
          );
          return;
        }
        const assistantContent = `The video could not start: ${
          cause instanceof Error ? cause.message : "unknown error"
        }`;
        try {
          await session.appendExternalAgentTurn({
            clientMessageId,
            userContent,
            assistantContent,
            outcome: "failed",
            branchGroupId: options.branchGroupId,
          });
        } catch (persistenceError) {
          setAttachmentStatus(
            persistenceError instanceof Error
              ? persistenceError.message
              : "The MoneyPrinter turn could not be saved.",
          );
        }
      } finally {
        moneyPrinterDispatchingRef.current = false;
        setLaunchingMoneyPrinterRun(false);
      }
    },
    [model, session],
  );

  /**
   * Start one legal assignment.
   *
   * The attachments are the documents: they travel with the request rather than
   * being pasted into the prompt, because the harness reads them file by file
   * with its own tools and cites what it found where. They are also recorded on
   * the user's turn, so the chat shows what was handed over.
   */
  const launchLegalRun = useCallback(
    async (
      task: string,
      attachments: readonly ChatAttachment[],
      options: { branchGroupId?: string } = {},
    ) => {
      if (legalDispatchingRef.current) return;
      legalDispatchingRef.current = true;
      setLaunchingLegalRun(true);
      let clientMessageId = crypto.randomUUID();
      const userContent = legalUserMessage(task);
      const turnAttachments = chatMessageAttachments(attachments);
      clientMessageId = session.previewExternalAgentTurn({
        clientMessageId,
        userContent,
        attachments: turnAttachments,
        branchGroupId: options.branchGroupId,
      });
      let runStarted = false;
      try {
        // The deliverables are artifacts of this conversation, so the
        // conversation has to exist before the run that writes them.
        const conversationPublicId = await session.ensureConversation(clientMessageId);
        const response = await fetch("/api/legal/runs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            task,
            model,
            reasoningEffort,
            attachments,
            conversationPublicId,
          }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data?.run?.runId) {
          throw new Error(
            typeof data?.message === "string"
              ? data.message
              : typeof data?.error === "string"
                ? data.error
                : "The assignment could not start.",
          );
        }
        runStarted = true;
        await session.appendExternalAgentTurn({
          clientMessageId,
          userContent,
          attachments: turnAttachments,
          run: {
            kind: "legal_agent",
            runId: String(data.run.runId),
            task: legalRunLabel({ task }),
          },
          branchGroupId: options.branchGroupId,
        });
      } catch (cause) {
        if (runStarted) {
          setAttachmentStatus(
            cause instanceof Error
              ? cause.message
              : "The assignment started, but its chat turn could not be saved.",
          );
          return;
        }
        const assistantContent = `The assignment could not start: ${
          cause instanceof Error ? cause.message : "unknown error"
        }`;
        try {
          await session.appendExternalAgentTurn({
            clientMessageId,
            userContent,
            assistantContent,
            outcome: "failed",
            branchGroupId: options.branchGroupId,
          });
        } catch (persistenceError) {
          setAttachmentStatus(
            persistenceError instanceof Error
              ? persistenceError.message
              : "The Legal Agent turn could not be saved.",
          );
        }
      } finally {
        legalDispatchingRef.current = false;
        setLaunchingLegalRun(false);
      }
    },
    [model, reasoningEffort, session],
  );

  /**
   * A retry or a queued send has no attachment tray to draw on — the text of a
   * document is not kept with the turn, only its name — so those paths route
   * with no documents and the run says so rather than pretending it had them.
   */
  const routeLegalCommand = useCallback(
    (
      text: string,
      attachments: readonly ChatAttachment[] = [],
      options: { branchGroupId?: string } = {},
    ): boolean => {
      const task = taskFromLegalCommand(text);
      if (task === null) return false;
      setAttachmentStatus("");
      if (task && !legalDispatchingRef.current) {
        void launchLegalRun(task, attachments, options);
      }
      return true;
    },
    [launchLegalRun],
  );

  const routeMoneyPrinterCommand = useCallback(
    (text: string, options: { branchGroupId?: string } = {}): boolean => {
      const brief = briefFromMoneyPrinterCommand(text);
      if (brief === null) return false;
      setAttachmentStatus("");
      if (brief && !moneyPrinterDispatchingRef.current) {
        void launchMoneyPrinterRun(brief, options);
      }
      return true;
    },
    [launchMoneyPrinterRun],
  );

  const routeSocialsManagerCommand = useCallback(
    (text: string, options: { branchGroupId?: string } = {}): boolean => {
      const brief = taskFromSocialsManagerCommand(text);
      if (brief === null) return false;
      setAttachmentStatus("");
      if (brief && !socialsManagerDispatchingRef.current) {
        void launchSocialsManagerRun(brief, options);
      }
      return true;
    },
    [launchSocialsManagerRun],
  );

  const routeDeepResearchCommand = useCallback(
    (
      text: string,
      options: {
        branchGroupId?: string;
      } = {},
    ): boolean => {
      const task = taskFromDeepResearchCommand(text);
      if (task === null) return false;
      if (deepResearch.launching || deepResearchDispatchingRef.current) return true;
      deepResearchDispatchingRef.current = true;
      setBrowserAgent(null);
      setAgentBrowserAgent(null);
      setOpenPlanterAgent(null);
      setAgentReachAgent(null);
      setGetDocAgent(null);
      setMeetingNotesAgent(null);
      setDeepTutorAgent(null);
      setCareerOpsAgent(null);
      setTradingAgentsAgent(null);
      setVibeTradingAgent(null);
      setDeerFlowAgent(null);
      setShortsAgent(null);
      clearCodex();
      clearOpenCode();
      clearRuflo();
      setAttachmentStatus("");
      void (async () => {
        try {
          if (!deepResearch.agent) await deepResearch.select();
          await deepResearch.launch(task, options);
        } finally {
          deepResearchDispatchingRef.current = false;
        }
      })();
      return true;
    },
    [clearCodex, clearOpenCode, clearRuflo, deepResearch],
  );

  /** The runtime agent that owns the next turn when the composer names none. */
  const activeRuntimeAgentId =
    (codex.agent && "codex") ||
    (openCode.agent && "opencode") ||
    (ruflo.agent && "ruflo") ||
    (deepResearch.agent && "deep-research") ||
    (openPlanterAgent && "openplanter") ||
    (agentReachAgent && "agent-reach") ||
    (getDocAgent && "get-doc") ||
    (deepTutorAgent && "deep-tutor") ||
    (careerOpsAgent && "career-ops") ||
    (tradingAgentsAgent && "trading-agent") ||
    (vibeTradingAgent && "vibe-trading") ||
    (stockAnalystAgent && "stock-analyst") ||
    (paperTraderAgent && "paper-trader") ||
    (deerFlowAgent && "deer-flow") ||
    (shortsAgent && "shorts") ||
    (formsmithAgent && "formsmith") ||
    (agentBrowserAgent && "agent-browser") ||
    (browserAgent && "agent-tars") ||
    null;

  // A runtime agent a super-agent turn asked for, and the follow-up turn its
  // result comes back on. See use-agent-launch-queue: the launch is an ordinary
  // submit, so all that is tracked here is which run belongs to the chain.
  const awaitedLaunchRef = useRef<{
    agentName: string;
    /** Turns already in the transcript when the launch was submitted. */
    knownMessageIds: Set<string>;
    /** Existing assistant turn used by an approval-free delegation. */
    clientMessageId: string | null;
  } | null>(null);
  const launchHopsRef = useRef(0);
  const continuedDelegatedTurnsRef = useRef(new Set<string>());
  const [pendingLaunchContinuation, setPendingLaunchContinuation] = useState<
    string | null
  >(null);

  const submit = useCallback((
    textOverride?: string,
  ) => {
    const text = (textOverride ?? input).trim();
    // Only the composer calls this with no override, so this is the one place
    // that knows a human is speaking: it ends whatever hand-off chain was
    // running.
    if (textOverride === undefined) {
      launchHopsRef.current = 0;
      awaitedLaunchRef.current = null;
    }
    // Refuse an impossible combination before anything is dispatched. The
    // branches below are a priority cascade, so without this a second runtime
    // agent or a stacked skill would be silently swallowed into the winner's
    // task string instead of being reported.
    const conflict = findCapabilityConflict({
      text,
      surface: "dashboard_terminal",
      attachmentCount: chatAttachments.length,
      activeRuntimeAgentId,
    });
    if (conflict) {
      setAttachmentStatus(conflict.message);
      return;
    }
    const codexTask = taskFromCodexCommand(text);
    if (codexTask !== null) {
      if (codex.launching) return;
      const pendingAttachments = chatAttachments;
      setInput("");
      setChatAttachments([]);
      setAttachmentStatus("");
      void (async () => {
        const selected = codex.agent ?? (await selectCodex());
        if (selected && (codexTask || pendingAttachments.length)) {
          await launchCodexRun(
            codexTask || "Review the attached screenshot and implement the requested fix.",
            pendingAttachments,
          );
        }
      })();
      return;
    }
    const rufloTask = taskFromRufloCommand(text);
    if (rufloTask !== null) {
      if (ruflo.launching) return;
      setInput("");
      setAttachmentStatus("");
      void (async () => {
        const selected = ruflo.agent ?? (await selectRuflo());
        if (selected && rufloTask) await launchRufloRun(rufloTask);
      })();
      return;
    }
    const openCodeTask = taskFromOpenCodeCommand(text);
    if (openCodeTask !== null) {
      if (openCode.launching) return;
      const pendingAttachments = chatAttachments;
      setInput("");
      setChatAttachments([]);
      setAttachmentStatus("");
      void (async () => {
        const selected = openCode.agent ?? (await selectOpenCode());
        if (selected && (openCodeTask || pendingAttachments.length)) {
          await launchOpenCodeRun(
            openCodeTask || "Review the attached screenshot and implement the requested fix.",
            pendingAttachments,
          );
        }
      })();
      return;
    }
    const openPlanterTask = taskFromOpenPlanterCommand(text);
    if (openPlanterTask !== null) {
      if (launchingOpenPlanterRun) return;
      setInput("");
      setAttachmentStatus("");
      void (async () => {
        const selected = openPlanterAgent ?? await selectOpenPlanter();
        if (selected && openPlanterTask) await launchOpenPlanterRun(openPlanterTask, selected);
      })();
      return;
    }
    const agentReachTask = taskFromAgentReachCommand(text);
    if (agentReachTask !== null) {
      if (launchingAgentReachRun) return;
      setInput("");
      setAttachmentStatus("");
      void (async () => {
        const selected = agentReachAgent ?? (await selectAgentReach());
        if (selected && agentReachTask) await launchAgentReachRun(agentReachTask, selected);
      })();
      return;
    }
    const deepTutorTask = taskFromDeepTutorCommand(text);
    if (deepTutorTask !== null) {
      if (launchingDeepTutorRun) return;
      setInput("");
      setAttachmentStatus("");
      void (async () => {
        const selected = deepTutorAgent ?? (await selectDeepTutor());
        if (selected && deepTutorTask) await launchDeepTutorRun(deepTutorTask, selected);
      })();
      return;
    }
    const meetingNotesTask = taskFromMeetingNotesCommand(text);
    if (meetingNotesTask !== null) {
      if (launchingMeetingNotesRun) return;
      setInput("");
      setAttachmentStatus("");
      const attachedRecording = chatAttachments.find((item) => item.type === "video");
      void (async () => {
        const selected = meetingNotesAgent ?? (await selectMeetingNotes());
        // Unlike the other agents, a bare token is already a complete request:
        // it means "the recording in this chat". So this launches either way
        // rather than leaving the chip up waiting for a sentence.
        if (!selected) return;
        if (attachedRecording) setChatAttachments([]);
        await launchMeetingNotesRun(
          meetingNotesTask,
          selected,
          attachedRecording
            ? { blobId: attachedRecording.blobId, filename: attachedRecording.name }
            : undefined,
        );
      })();
      return;
    }
    const getDocTask = taskFromGetDocCommand(text);
    if (getDocTask !== null) {
      if (launchingGetDocRun) return;
      setInput("");
      setAttachmentStatus("");
      void (async () => {
        const selected = getDocAgent ?? (await selectGetDoc());
        // A bare token selects the agent and leaves the chip up; the next
        // message is the description of the paper.
        if (selected && getDocTask) await launchGetDocRun(getDocTask, selected);
      })();
      return;
    }
    const careerOpsTask = taskFromCareerOpsCommand(text);
    if (careerOpsTask !== null) {
      if (launchingCareerOpsRun) return;
      setInput("");
      setAttachmentStatus("");
      void (async () => {
        const selected = careerOpsAgent ?? (await selectCareerOps());
        // A bare token selects the agent and leaves the chip up, the same as
        // every other runtime agent; the next message carries the request.
        if (selected && careerOpsTask) await launchCareerOpsRun(careerOpsTask, selected);
      })();
      return;
    }
    const vibeTradingTask = taskFromVibeTradingCommand(text);
    if (vibeTradingTask !== null) {
      if (launchingVibeTradingRun) return;
      setInput("");
      setAttachmentStatus("");
      void (async () => {
        const selected = vibeTradingAgent ?? (await selectVibeTrading());
        // A bare token selects the agent and leaves the chip up; the next
        // message carries the research question.
        if (selected && vibeTradingTask) await launchVibeTradingRun(vibeTradingTask, selected);
      })();
      return;
    }
    const stockAnalystTask = taskFromStockAnalystCommand(text);
    if (stockAnalystTask !== null) {
      if (launchingStockAnalystRun) return;
      setInput("");
      setAttachmentStatus("");
      void (async () => {
        const selected = stockAnalystAgent ?? (await selectStockAnalyst());
        // A bare token selects the agent and leaves the chip up; the next
        // message carries the question.
        if (selected && stockAnalystTask) await launchStockAnalystRun(stockAnalystTask, selected);
      })();
      return;
    }
    const paperTraderTask = taskFromPaperTraderCommand(text);
    if (paperTraderTask !== null) {
      if (launchingPaperTraderRun) return;
      setInput("");
      setAttachmentStatus("");
      void (async () => {
        const selected = paperTraderAgent ?? selectPaperTrader();
        // A bare token selects the agent and leaves the chip up, the same as
        // every other agent. The composer then locks — the desk takes no
        // instructions — and the send button is what opens it.
        if (selected) await launchPaperTraderRun(paperTraderTask, selected);
      })();
      return;
    }
    const deerFlowTask = taskFromDeerFlowCommand(text);
    if (deerFlowTask !== null) {
      if (launchingDeerFlowRun) return;
      setInput("");
      setAttachmentStatus("");
      void (async () => {
        const selected = deerFlowAgent ?? (await selectDeerFlow());
        // A bare token selects the agent and leaves the chip up; the next
        // message carries the task.
        if (selected && deerFlowTask) await launchDeerFlowRun(deerFlowTask, selected);
      })();
      return;
    }
    const tradingAgents = parseTradingAgentsCommand(text);
    if (tradingAgents) {
      setInput("");
      setAttachmentStatus("");
      void (async () => {
        const selected = tradingAgentsAgent ?? (await selectTradingAgents());
        // The command never starts a run on its own: the form is the input, and
        // a half-specified request has to be completed before it can go.
        if (selected) setTradingAgentsSeed(tradingAgents.partial);
      })();
      return;
    }
    // Typed explicitly rather than detected. The agent still needs a video, so
    // the command runs when one is attached and explains itself when not.
    const videoUseTask = taskFromVideoUseCommand(text);
    if (videoUseTask !== null) {
      setInput("");
      // Typing the command *is* the instruction, so this asks only which video
      // — attached, or linked in what was typed. Requiring an attachment here
      // was the bug: a pasted link read as "no video at all".
      const commandVideo = videoUseSource(videoUseTask, chatAttachments);
      if (!commandVideo) {
        setAttachmentStatus(
          "Video Use edits a video you already have. Attach one, paste its link, or open a video artifact and use its studio.",
        );
        return;
      }
      if (!videoUseTask.trim()) {
        setAttachmentStatus("Say what should change about the video.");
        return;
      }
      if (launchingVideoUseRun) return;
      setChatAttachments([]);
      setAttachmentStatus("");
      void launchVideoUseRun(videoUseTask, commandVideo, { userContent: text });
      return;
    }
    const shorts = parseShortsCommand(text);
    if (shorts) {
      setInput("");
      setAttachmentStatus("");
      void (async () => {
        const selected = shortsAgent ?? (await selectShorts());
        // The command never starts a run on its own either: a video has to be
        // chosen, and a link typed into chat is only a starting point.
        if (selected) setShortsSeed(shorts.partial);
      })();
      return;
    }
    if (isFormsmithCommand(text)) {
      setInput("");
      setAttachmentStatus("");
      void selectFormsmith();
      return;
    }
    // The Legal Agent is routed here rather than in the block below because it
    // is the one agent whose input is the attachment tray: the documents have
    // to be taken and cleared in the same step that starts the run, exactly as
    // an ordinary send does.
    if (taskFromLegalCommand(text) !== null) {
      const pendingAttachments = chatAttachments;
      setInput("");
      setChatAttachments([]);
      routeLegalCommand(text, pendingAttachments);
      return;
    }
    if (
      routeSocialsManagerCommand(text) ||
      routeHardwareBlueprintCommand(text) ||
      routeParametricCadCommand(text) ||
      routeHyperframesCommand(text) ||
      routeResource2SkillCommand(text) ||
      routeOpenMontageCommand(text) ||
      routeOpenworkCommand(text) ||
      routeOpenscienceCommand(text) ||
      routeInboxZeroCommand(text) ||
      routeVimaxCommand(text) ||
      routeMoneyPrinterCommand(text)
    ) {
      setInput("");
      return;
    }
    if (
      routeDeepResearchCommand(text)
    ) {
      setInput("");
      return;
    }
    if (deepResearch.agent) {
      if (!text || deepResearch.launching) return;
      setInput("");
      setAttachmentStatus("");
      void deepResearch.launch(text);
      return;
    }
    if (codex.agent) {
      if ((!text && chatAttachments.length === 0) || codex.launching) return;
      const pendingAttachments = chatAttachments;
      setInput("");
      setChatAttachments([]);
      setAttachmentStatus("");
      void launchCodexRun(
        text || "Review the attached screenshot and implement the requested fix.",
        pendingAttachments,
      );
      return;
    }
    if (ruflo.agent) {
      if (!text || ruflo.launching) return;
      setInput("");
      setAttachmentStatus("");
      void launchRufloRun(text);
      return;
    }
    if (openCode.agent) {
      if ((!text && chatAttachments.length === 0) || openCode.launching) return;
      const pendingAttachments = chatAttachments;
      setInput("");
      setChatAttachments([]);
      setAttachmentStatus("");
      void launchOpenCodeRun(
        text || "Review the attached screenshot and implement the requested fix.",
        pendingAttachments,
      );
      return;
    }
    const agentBrowserTask = taskFromAgentBrowserCommand(text);
    if (agentBrowserTask !== null) {
      if (launchingBrowserRun) return;
      setInput("");
      setAttachmentStatus("");
      void (async () => {
        const selected = agentBrowserAgent ?? await selectAgentBrowser();
        if (selected && agentBrowserTask) await launchAgentBrowserRun(agentBrowserTask, selected);
      })();
      return;
    }
    const agentTarsTask = taskFromAgentTarsCommand(text);
    if (agentTarsTask !== null) {
      if (launchingBrowserRun) return;
      setInput("");
      setAttachmentStatus("");
      void (async () => {
        const selected = browserAgent ?? await selectBrowserAgent();
        if (selected && agentTarsTask) await launchBrowserRun(agentTarsTask, selected);
      })();
      return;
    }
    if (openPlanterAgent) {
      if (!text || launchingOpenPlanterRun) return;
      setInput("");
      setAttachmentStatus("");
      void launchOpenPlanterRun(text);
      return;
    }
    if (agentReachAgent) {
      if (!text || launchingAgentReachRun) return;
      setInput("");
      setAttachmentStatus("");
      void launchAgentReachRun(text);
      return;
    }
    if (getDocAgent) {
      if (!text || launchingGetDocRun) return;
      setInput("");
      setAttachmentStatus("");
      void launchGetDocRun(text);
      return;
    }
    if (deepTutorAgent) {
      if (!text || launchingDeepTutorRun) return;
      setInput("");
      setAttachmentStatus("");
      void launchDeepTutorRun(text);
      return;
    }
    if (careerOpsAgent) {
      if (!text || launchingCareerOpsRun) return;
      setInput("");
      setAttachmentStatus("");
      void launchCareerOpsRun(text);
      return;
    }
    if (vibeTradingAgent) {
      if (!text || launchingVibeTradingRun) return;
      setInput("");
      setAttachmentStatus("");
      void launchVibeTradingRun(text);
      return;
    }
    if (stockAnalystAgent) {
      if (!text || launchingStockAnalystRun) return;
      setInput("");
      setAttachmentStatus("");
      void launchStockAnalystRun(text);
      return;
    }
    if (paperTraderAgent) {
      // No `!text` guard: an empty send is "start the desk".
      if (launchingPaperTraderRun) return;
      setInput("");
      setAttachmentStatus("");
      void launchPaperTraderRun(text);
      return;
    }
    if (deerFlowAgent) {
      if (!text || launchingDeerFlowRun) return;
      setInput("");
      setAttachmentStatus("");
      void launchDeerFlowRun(text);
      return;
    }
    if (agentBrowserAgent) {
      if (!text || launchingBrowserRun) return;
      setInput("");
      setAttachmentStatus("");
      void launchAgentBrowserRun(text);
      return;
    }
    if (browserAgent) {
      if (!text || launchingBrowserRun) return;
      setInput("");
      setAttachmentStatus("");
      void launchBrowserRun(text);
      return;
    }
    // A video attached to — or linked in — an instruction to change it is an
    // edit, not a message, and this is where that turn is rerouted. Narrow on
    // purpose: `videoEditIntent` says no to anything that reads as a question
    // about the video, because a render nobody asked for costs minutes and
    // replaces the answer they wanted.
    //
    // A link is handed over as a link. Fetching it is work, and work belongs in
    // the run — where it has a progress line and a stop button — rather than in
    // front of the send button.
    const editableVideo = videoUseTarget(text, chatAttachments);
    if (editableVideo) {
      setInput("");
      setChatAttachments([]);
      setAttachmentStatus("");
      void launchVideoUseRun(text, editableVideo, { userContent: text });
      return;
    }
    if ((!text && chatAttachments.length === 0) || runtimeUnavailable || busy) return;
    const pendingAttachments = chatAttachments;
    const displayText = text || "Please review the attached document(s).";
    setInput("");
    setChatAttachments([]);
    setAttachmentStatus("");
    void session.send(displayText, {
      model,
      reasoningEffort,
      attachments: pendingAttachments,
    });
  }, [
    activeRuntimeAgentId,
    browserAgent,
    agentBrowserAgent,
    launchVideoUseRun,
    launchingVideoUseRun,
    videoUseSource,
    videoUseTarget,
    deepResearch,
    codex,
    openCode,
    ruflo,
    openPlanterAgent,
    agentReachAgent,
    getDocAgent,
    meetingNotesAgent,
    tradingAgentsAgent,
    selectTradingAgents,
    careerOpsAgent,
    vibeTradingAgent,
    selectVibeTrading,
    launchVibeTradingRun,
    launchingVibeTradingRun,
    stockAnalystAgent,
    selectStockAnalyst,
    launchStockAnalystRun,
    launchingStockAnalystRun,
    paperTraderAgent,
    selectPaperTrader,
    launchPaperTraderRun,
    launchingPaperTraderRun,
    deerFlowAgent,
    selectDeerFlow,
    launchDeerFlowRun,
    launchingDeerFlowRun,
    launchAgentBrowserRun,
    launchOpenPlanterRun,
    launchAgentReachRun,
    launchGetDocRun,
    launchMeetingNotesRun,
    launchCareerOpsRun,
    launchCodexRun,
    launchOpenCodeRun,
    launchRufloRun,
    launchingBrowserRun,
    launchingOpenPlanterRun,
    launchingAgentReachRun,
    launchingGetDocRun,
    launchingMeetingNotesRun,
    launchingDeepTutorRun,
    deepTutorAgent,
    selectDeepTutor,
    launchDeepTutorRun,
    launchingCareerOpsRun,
    launchBrowserRun,
    selectBrowserAgent,
    selectAgentBrowser,
    selectOpenPlanter,
    selectAgentReach,
    selectGetDoc,
    selectMeetingNotes,
    selectCareerOps,
    selectShorts,
    shortsAgent,
    selectFormsmith,
    selectCodex,
    selectOpenCode,
    selectRuflo,
    busy,
    chatAttachments,
    input,
    model,
    reasoningEffort,
    routeDeepResearchCommand,
    routeSocialsManagerCommand,
    routeHardwareBlueprintCommand,
    routeParametricCadCommand,
    routeHyperframesCommand,
    routeResource2SkillCommand,
    routeOpenMontageCommand,
    routeOpenworkCommand,
    routeOpenscienceCommand,
    routeInboxZeroCommand,
    routeVimaxCommand,
    routeMoneyPrinterCommand,
    routeLegalCommand,
    runtimeUnavailable,
    session,
  ]);

  /**
   * Start a model-selected runtime agent without replaying its slash command as
   * a user message. The session remaps the launcher's next preview onto the
   * assistant turn that called `agent_launch`, so every existing launcher and
   * run API keeps its normal persistence and terminal behavior.
   */
  async function launchDelegatedAgent(
    request: AgentLaunchRequestPayload,
  ): Promise<void> {
    const originClientMessageId = request.originClientMessageId?.trim();
    if (!originClientMessageId) {
      setAttachmentStatus(
        `${request.agentName} could not start because the originating assistant message is missing.`,
      );
      return;
    }
    if (
      !session.messages.some(
        (message) =>
          message.role === "assistant" &&
          message.clientMessageId === originClientMessageId,
      )
    ) {
      setAttachmentStatus(
        `${request.agentName} was not started because its originating chat is no longer open.`,
      );
      return;
    }
    session.beginDelegatedExternalAgentTurn(originClientMessageId);
    setDelegatedAgentLaunching(true);
    try {
      switch (request.agentId) {
        case "codex": {
          const selected = codex.agent ?? (await selectCodex());
          if (selected) await launchCodexRun(request.brief);
          return;
        }
        case "opencode": {
          const selected = openCode.agent ?? (await selectOpenCode());
          if (selected) await launchOpenCodeRun(request.brief);
          return;
        }
        case "ruflo": {
          const selected = ruflo.agent ?? (await selectRuflo());
          if (selected) await launchRufloRun(request.brief);
          return;
        }
        case "deep-research":
          if (!deepResearch.agent) await deepResearch.select();
          await deepResearch.launch(request.brief);
          return;
        case "agent-browser": {
          const selected = agentBrowserAgent ?? (await selectAgentBrowser());
          if (selected) await launchAgentBrowserRun(request.brief, selected);
          return;
        }
        case "agent-tars": {
          const selected = browserAgent ?? (await selectBrowserAgent());
          if (selected) await launchBrowserRun(request.brief, selected);
          return;
        }
        case "openplanter": {
          const selected = openPlanterAgent ?? (await selectOpenPlanter());
          if (selected) await launchOpenPlanterRun(request.brief, selected);
          return;
        }
        case "agent-reach": {
          const selected = agentReachAgent ?? (await selectAgentReach());
          if (selected) await launchAgentReachRun(request.brief, selected);
          return;
        }
        case "meeting-notes": {
          const selected = meetingNotesAgent ?? (await selectMeetingNotes());
          // No source is passed: a delegated brief never carries a file, so the
          // run finds the newest recording on this conversation itself.
          if (selected) await launchMeetingNotesRun(request.brief, selected);
          return;
        }
        case "get-doc": {
          const selected = getDocAgent ?? (await selectGetDoc());
          if (selected) await launchGetDocRun(request.brief, selected);
          return;
        }
        case "deep-tutor": {
          const selected = deepTutorAgent ?? (await selectDeepTutor());
          if (selected) await launchDeepTutorRun(request.brief, selected);
          return;
        }
        case "career-ops": {
          const selected = careerOpsAgent ?? (await selectCareerOps());
          if (selected) await launchCareerOpsRun(request.brief, selected);
          return;
        }
        case "vibe-trading": {
          const selected = vibeTradingAgent ?? (await selectVibeTrading());
          if (selected) await launchVibeTradingRun(request.brief, selected);
          return;
        }
        case "stock-analyst": {
          const selected = stockAnalystAgent ?? (await selectStockAnalyst());
          if (selected) await launchStockAnalystRun(request.brief, selected);
          return;
        }
        case "paper-trader": {
          const selected = paperTraderAgent ?? selectPaperTrader();
          if (selected) await launchPaperTraderRun(request.brief, selected);
          return;
        }
        case "deer-flow": {
          const selected = deerFlowAgent ?? (await selectDeerFlow());
          if (selected) await launchDeerFlowRun(request.brief, selected);
          return;
        }
        case "socials-manager":
          await launchSocialsManagerRun(request.brief);
          return;
        case "hardware-blueprint":
          await launchHardwareBlueprintRun(request.brief);
          return;
        case "parametric-cad":
          await launchParametricCadRun(request.brief);
          return;
        case "hyperframes":
          await launchHyperframesRun(request.brief);
          return;
        case "resource2skill":
          await launchResource2SkillRun(request.brief);
          return;
        case "openmontage":
          await launchOpenMontageRun(request.brief);
          return;
        case "openwork":
          await launchOpenworkRun(request.brief);
          break;
        case "openscience":
          await launchOpenscienceRun(request.brief);
          return;
        case "inbox-zero":
          await launchInboxZeroRun(request.brief);
          return;
        case "vimax":
          await launchVimaxRun(request.brief);
          return;
        case "money-printer":
          await launchMoneyPrinterRun(request.brief);
          return;
        default:
          setAttachmentStatus(`${request.agentName} cannot be launched from this chat.`);
      }
    } finally {
      const neverReachedLauncher =
        session.cancelDelegatedExternalAgentTurn(originClientMessageId);
      if (neverReachedLauncher) {
        try {
          await session.appendExternalAgentTurn({
            clientMessageId: originClientMessageId,
            userContent: "",
            assistantContent: `${request.agentName} could not start.`,
            outcome: "failed",
            attachToExistingTurn: true,
          });
        } catch {
          setAttachmentStatus(`${request.agentName} could not start.`);
        }
      }
      setDelegatedAgentLaunching(false);
    }
  }

  const launchReady = !busy && !externalRunLaunching && !runtimeUnavailable;
  const agentLaunchQueue = useAgentLaunchQueue({
    submit: (request) => {
      void launchDelegatedAgent(request);
    },
    scopeKey: session.sessionId ?? null,
    ready: launchReady,
    onLaunched: (request) => {
      launchHopsRef.current += 1;
      awaitedLaunchRef.current = request.awaitResult
        ? {
            agentName: request.agentName,
            knownMessageIds: new Set(
              session.messages.flatMap((message) =>
                message.clientMessageId ? [message.clientMessageId] : [],
              ),
            ),
            clientMessageId: request.originClientMessageId ?? null,
          }
        : null;
    },
    onDismissed: () => {
      awaitedLaunchRef.current = null;
    },
  });
  const agentLaunchScopeRef = useRef(session.sessionId ?? null);
  useEffect(() => {
    const scope = session.sessionId ?? null;
    if (agentLaunchScopeRef.current === scope) return;
    agentLaunchScopeRef.current = scope;
    awaitedLaunchRef.current = null;
    continuedDelegatedTurnsRef.current.clear();
    setPendingLaunchContinuation(null);
  }, [session.sessionId]);

  // A refresh reconstructs the private worker from durable metadata, but the
  // in-memory `awaitedLaunchRef` that owned its hand-back is gone. Re-arm a live
  // worker, or resume a terminal result that has not yet produced its hidden
  // continuation. Any later transcript row proves that continuation was
  // already consumed (or the user moved on), so it is never replayed.
  useEffect(() => {
    if (
      session.loadingSession ||
      pendingLaunchContinuation
    ) {
      return;
    }
    for (let index = session.messages.length - 1; index >= 0; index -= 1) {
      const message = session.messages[index];
      if (message?.role !== "assistant" || message.delegatedAgentRun !== true) {
        continue;
      }
      if (session.messages[index + 1]) return;
      const continuationKey =
        message.clientMessageId ?? message.id ?? `delegated-${index}`;
      if (continuedDelegatedTurnsRef.current.has(continuationKey)) return;
      const agentName = message.externalAgentName ?? "The delegated agent";
      if ((message.externalAgentOutcome ?? "running") === "running") {
        if (awaitedLaunchRef.current) return;
        if (!message.clientMessageId) return;
        awaitedLaunchRef.current = {
          agentName,
          knownMessageIds: new Set(),
          clientMessageId: message.clientMessageId,
        };
        return;
      }
      const awaited = awaitedLaunchRef.current;
      awaitedLaunchRef.current = null;
      continuedDelegatedTurnsRef.current.add(continuationKey);
      launchHopsRef.current = Math.max(1, launchHopsRef.current);
      setPendingLaunchContinuation(
        agentLaunchContinuationMessage({
          agentName: awaited?.agentName ?? agentName,
          outcome: message.externalAgentOutcome ?? "failed",
          content: externalAgentCardContent(message),
        }),
      );
      return;
    }
  }, [pendingLaunchContinuation, session.loadingSession, session.messages]);
  // The stream hands launch requests to the session hook, which does not launch
  // anything itself; this is where they meet the surface that can.
  const handleAgentLaunchEvent = agentLaunchQueue.handleEvent;
  useEffect(() => {
    for (const request of session.agentLaunchRequests) {
      handleAgentLaunchEvent({ type: "agent_launch", ...request });
    }
  }, [session.agentLaunchRequests, handleAgentLaunchEvent]);

  // The result of a finished run, handed back as a new turn once the surface is
  // idle — a submit made while the run's turn is still settling is dropped.
  const sendAgentContinuation = session.send;
  useEffect(() => {
    if (!pendingLaunchContinuation || !launchReady) return;
    const continuation = pendingLaunchContinuation;
    const timer = window.setTimeout(() => {
      setPendingLaunchContinuation(null);
      void sendAgentContinuation(continuation, {
        model,
        reasoningEffort,
        internalAgentContinuation: true,
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [
    pendingLaunchContinuation,
    launchReady,
    model,
    reasoningEffort,
    sendAgentContinuation,
  ]);

  const askSelection = useCallback(
    async (question: string, selection: ChatTextSelectionReference) => {
      if (runtimeUnavailable || busy) return;
      const pendingAttachments = chatAttachments;
      setChatAttachments([]);
      setAttachmentStatus("");
      await session.send(question, {
        model,
        reasoningEffort,
        attachments: pendingAttachments,
        textSelection: selection,
      });
    },
    [
      busy,
      chatAttachments,
      model,
      reasoningEffort,
      runtimeUnavailable,
      session,
    ],
  );

  const steer = useCallback(async (text: string): Promise<boolean> => {
    const trimmed = text.trim();
    if (!trimmed || runtimeUnavailable) return false;
    return session.steer(trimmed);
  }, [runtimeUnavailable, session]);

  const sendQueued = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || runtimeUnavailable) return;
    if (
      routeSocialsManagerCommand(trimmed) ||
      routeHardwareBlueprintCommand(trimmed) ||
      routeParametricCadCommand(trimmed) ||
      routeHyperframesCommand(trimmed) ||
      routeResource2SkillCommand(trimmed) ||
      routeOpenMontageCommand(trimmed) ||
      routeOpenworkCommand(trimmed) ||
      routeOpenscienceCommand(trimmed) ||
      routeInboxZeroCommand(trimmed) ||
      routeVimaxCommand(trimmed) ||
      routeMoneyPrinterCommand(trimmed) ||
      routeLegalCommand(trimmed)
    ) {
      return;
    }
    if (routeDeepResearchCommand(trimmed)) return;
    if (deepResearch.agent) {
      await deepResearch.launch(trimmed);
      return;
    }
    await session.send(trimmed, { model, reasoningEffort });
  }, [
    deepResearch,
    model,
    reasoningEffort,
    routeDeepResearchCommand,
    routeSocialsManagerCommand,
    routeHardwareBlueprintCommand,
    routeParametricCadCommand,
    routeHyperframesCommand,
    routeResource2SkillCommand,
    routeOpenMontageCommand,
    routeOpenworkCommand,
    routeOpenscienceCommand,
    routeInboxZeroCommand,
    routeVimaxCommand,
    routeMoneyPrinterCommand,
    routeLegalCommand,
    runtimeUnavailable,
    session,
  ]);

  const handleExternalAgentTerminal = useCallback(
    (clientMessageId: string, result: Omit<ExternalAgentTurnResult, "clientMessageId">) => {
      void finishExternalAgentTurn({ clientMessageId, ...result }).catch((cause) => {
        setAttachmentStatus(
          cause instanceof Error
            ? cause.message
            : "The external agent result could not be saved.",
        );
      });
      // If the assistant started this run and asked to hear how it went, hand
      // the outcome back as a new turn. The turn is identified by not having
      // existed when the launch was submitted, so a run the user started
      // themselves never joins the chain.
      const awaited = awaitedLaunchRef.current;
      if (
        !awaited ||
        (awaited.clientMessageId
          ? awaited.clientMessageId !== clientMessageId
          : awaited.knownMessageIds.has(clientMessageId))
      ) return;
      awaitedLaunchRef.current = null;
      continuedDelegatedTurnsRef.current.add(clientMessageId);
      if (launchHopsRef.current >= MAX_AGENT_LAUNCH_HOPS) {
        setAttachmentStatus(
          `${awaited.agentName} finished. The assistant has handed off ${launchHopsRef.current} times in a row, so it is waiting for you before going further.`,
        );
        return;
      }
      setPendingLaunchContinuation(
        agentLaunchContinuationMessage({
          agentName: awaited.agentName,
          outcome: result.outcome,
          content: result.content,
        }),
      );
    },
    [finishExternalAgentTurn],
  );

  const editMessage = useCallback(
    (messageIndex: number, text: string, branchGroupId: string) => {
      if (runtimeUnavailable) return;
      if (
        routeSocialsManagerCommand(text, { branchGroupId }) ||
        routeHardwareBlueprintCommand(text, { branchGroupId }) ||
        routeParametricCadCommand(text, { branchGroupId }) ||
        routeHyperframesCommand(text, { branchGroupId }) ||
        routeResource2SkillCommand(text, { branchGroupId }) ||
        routeOpenMontageCommand(text, { branchGroupId }) ||
        routeOpenworkCommand(text, { branchGroupId }) ||
        routeOpenscienceCommand(text, { branchGroupId }) ||
        routeInboxZeroCommand(text, { branchGroupId }) ||
        routeVimaxCommand(text, { branchGroupId }) ||
        routeMoneyPrinterCommand(text, { branchGroupId }) ||
        routeLegalCommand(text, [], { branchGroupId })
      ) {
        return;
      }
      if (routeDeepResearchCommand(text, { branchGroupId })) return;
      void session.send(text, {
        model,
        reasoningEffort,
        historyOverride: session.messages.slice(0, messageIndex),
        branchGroupId,
        // An edit rewrites the words, not what they were about: the screenshot
        // the question referred to has to come with it.
        attachments: reusableChatAttachments(
          session.messages[messageIndex]?.attachments,
        ),
      });
    },
    [
      model,
      reasoningEffort,
      routeDeepResearchCommand,
      routeSocialsManagerCommand,
    routeHardwareBlueprintCommand,
    routeParametricCadCommand,
    routeHyperframesCommand,
    routeResource2SkillCommand,
    routeOpenMontageCommand,
    routeOpenworkCommand,
    routeOpenscienceCommand,
    routeInboxZeroCommand,
    routeVimaxCommand,
    routeMoneyPrinterCommand,
    routeLegalCommand,
      runtimeUnavailable,
      session,
    ],
  );

  const selectBranch = useCallback(
    (messages: typeof session.messages) => session.setMessages(messages),
    [session],
  );

  const addAttachmentFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      setExtractingAttachments(true);
      // The add-documents button spins while the read runs, so a status line
      // saying the same thing only adds noise under the composer. Clear it so a
      // message from an earlier attachment does not sit there stale.
      setAttachmentStatus("");
      try {
        const result = await extractChatAttachments(files, {
          allowVideo: true,
          onStatus: setAttachmentStatus,
        });
        setChatAttachments((current) => [...current, ...result.attachments]);
        setAttachmentStatus([...result.errors, ...result.warnings].join(" · "));
        // A document too large to paste into every turn is distilled into a
        // book-to-skill skill now, while the user is still typing, rather than
        // after they hit send.
        const distillErrors = await distillAttachments(result.attachments, {
          onStatus: setAttachmentStatus,
        });
        if (distillErrors.length > 0) setAttachmentStatus(distillErrors.join(" · "));
      } finally {
        setExtractingAttachments(false);
      }
    },
    [],
  );

  const handleAttachmentInput = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files ?? []);
      event.target.value = "";
      void addAttachmentFiles(files);
    },
    [addAttachmentFiles],
  );

  const sendSuggestedPrompt = useCallback(
    (text: string) => {
      if (runtimeUnavailable || busy) return;
      if (
        routeSocialsManagerCommand(text) ||
        routeHardwareBlueprintCommand(text) ||
        routeParametricCadCommand(text) ||
        routeHyperframesCommand(text) ||
        routeResource2SkillCommand(text) ||
      routeOpenMontageCommand(text) ||
        routeOpenworkCommand(text) ||
        routeOpenscienceCommand(text) ||
        routeInboxZeroCommand(text) ||
        routeVimaxCommand(text) ||
        routeMoneyPrinterCommand(text) ||
        routeLegalCommand(text)
      ) {
        return;
      }
      if (routeDeepResearchCommand(text)) return;
      if (deepResearch.agent) {
        void deepResearch.launch(text);
        return;
      }
      void session.send(text, { model, reasoningEffort });
    },
    [
      busy,
      deepResearch,
      model,
      reasoningEffort,
      routeDeepResearchCommand,
      routeSocialsManagerCommand,
    routeHardwareBlueprintCommand,
    routeParametricCadCommand,
    routeHyperframesCommand,
    routeResource2SkillCommand,
    routeOpenMontageCommand,
    routeOpenworkCommand,
    routeOpenscienceCommand,
    routeInboxZeroCommand,
    routeVimaxCommand,
    routeMoneyPrinterCommand,
    routeLegalCommand,
      runtimeUnavailable,
      session,
    ],
  );

  const retryMessage = useCallback(
    (userMessageIndex: number, branchGroupId: string) => {
      if (runtimeUnavailable) return;
      const previousUser = session.messages[userMessageIndex];
      if (previousUser) {
        if (
          routeSocialsManagerCommand(previousUser.content, { branchGroupId }) ||
          routeHardwareBlueprintCommand(previousUser.content, { branchGroupId }) ||
          routeParametricCadCommand(previousUser.content, { branchGroupId }) ||
          routeHyperframesCommand(previousUser.content, { branchGroupId }) ||
          routeResource2SkillCommand(previousUser.content, { branchGroupId }) ||
          routeOpenMontageCommand(previousUser.content, { branchGroupId }) ||
          routeOpenworkCommand(previousUser.content, { branchGroupId }) ||
          routeOpenscienceCommand(previousUser.content, { branchGroupId }) ||
          routeInboxZeroCommand(previousUser.content, { branchGroupId }) ||
          routeVimaxCommand(previousUser.content, { branchGroupId }) ||
          routeMoneyPrinterCommand(previousUser.content, { branchGroupId }) ||
          routeLegalCommand(previousUser.content, [], { branchGroupId })
        ) {
          return;
        }
        if (
          routeDeepResearchCommand(previousUser.content, { branchGroupId })
        ) {
          return;
        }
        const retryVideo = videoUseTarget(
          previousUser.content,
          reusableChatAttachments(previousUser.attachments),
        );
        if (retryVideo) {
          void launchVideoUseRun(previousUser.content, retryVideo, {
            branchGroupId,
            userContent: previousUser.content,
          });
          return;
        }
        void session.send(previousUser.content, {
          model,
          reasoningEffort,
          historyOverride: session.messages.slice(0, userMessageIndex),
          branchGroupId,
          // Regenerating re-asks the same question, and an attached image is
          // half of it. Without this the retry reached the model as bare text
          // and it answered that nothing had been attached.
          attachments: reusableChatAttachments(previousUser.attachments),
        });
      }
    },
    [
      launchVideoUseRun,
      videoUseTarget,
      model,
      reasoningEffort,
      routeDeepResearchCommand,
      routeSocialsManagerCommand,
    routeHardwareBlueprintCommand,
    routeParametricCadCommand,
      routeHyperframesCommand,
      routeResource2SkillCommand,
    routeOpenMontageCommand,
    routeOpenworkCommand,
    routeOpenscienceCommand,
    routeInboxZeroCommand,
    routeVimaxCommand,
    routeMoneyPrinterCommand,
    routeLegalCommand,
      runtimeUnavailable,
      session,
    ],
  );

  function startNewChat() {
    deepResearch.clear();
    clearCodex();
    clearOpenCode();
    clearRuflo();
    setBrowserAgent(null);
    setAgentBrowserAgent(null);
    setOpenPlanterAgent(null);
    setAgentReachAgent(null);
    setGetDocAgent(null);
    setMeetingNotesAgent(null);
    setDeepTutorAgent(null);
    setCareerOpsAgent(null);
    setTradingAgentsAgent(null);
    setVibeTradingAgent(null);
    setDeerFlowAgent(null);
    setShortsAgent(null);
    setFormsmithAgent(null);
    setStockAnalystAgent(null);
    setPaperTraderAgent(null);
    session.reset();
    setInput("");
    setChatAttachments([]);
    setAttachmentStatus("");
  }

  function openHistorySession(sessionId: string) {
    clearCodex();
    clearOpenCode();
    clearRuflo();
    setBrowserAgent(null);
    setAgentBrowserAgent(null);
    setOpenPlanterAgent(null);
    setAgentReachAgent(null);
    setGetDocAgent(null);
    setMeetingNotesAgent(null);
    setDeepTutorAgent(null);
    setCareerOpsAgent(null);
    setTradingAgentsAgent(null);
    setVibeTradingAgent(null);
    setDeerFlowAgent(null);
    setShortsAgent(null);
    setFormsmithAgent(null);
    setStockAnalystAgent(null);
    setPaperTraderAgent(null);
    // The selected transcript loads independently from the lightweight rail.
    void session.openSession(sessionId);
    setChatAttachments([]);
    setAttachmentStatus("");
  }

  // Deleting a chat stops it: the route cancels the turn, the terminal command
  // and any agent run it still has going before it removes the rows. So this no
  // longer refuses while a response is streaming — that was a rule about our
  // bookkeeping, and the confirmation says what will happen instead.
  async function deleteHistorySession(item: TerminalSidebarChat) {
    if (
      !window.confirm(
        `Delete "${item.title}"? Anything it is still running is stopped, and its messages and any artifacts it produced are removed for good.`,
      )
    ) {
      return;
    }
    setHistoryError(null);
    const result = await deleteChatSession(item.id);
    if (!result.deleted) {
      setHistoryError(result.error ?? "This chat could not be deleted.");
      return;
    }
    // The server has committed; drop polls still in flight so a pre-delete
    // snapshot cannot ghost the chat back into the rail for a tick.
    historyEpoch.current += 1;
    invalidateHermesSessionSummaries("dashboard_terminal");
    setHistory((current) => current.filter((entry) => entry.id !== item.id));
    // The open chat no longer exists; fall back to an empty one.
    if (item.id === session.sessionId) startNewChat();
  }

  // Bulk delete from the rail's Recents menu. Deletes run one at a time: the
  // route stops each chat's live work and then removes the conversation and its
  // runtime sessions in one transaction, so a partial result is still possible
  // and has to be reported rather than assumed away.
  async function deleteHistorySessions(items: TerminalSidebarChat[]) {
    if (items.length === 0) return;
    const subject =
      items.length === 1 ? `"${items[0].title}"` : `${items.length} chats`;
    if (
      !window.confirm(
        `Delete ${subject}? Anything they are still running is stopped, and their messages and any artifacts they produced are removed for good.`,
      )
    ) {
      return;
    }
    setHistoryError(null);
    const deleted = new Set<string>();
    let firstError: string | null = null;
    for (const item of items) {
      const result = await deleteChatSession(item.id);
      if (result.deleted) deleted.add(item.id);
      else firstError ??= result.error ?? "This chat could not be deleted.";
    }
    if (deleted.size > 0) {
      // As in the single delete: polls that overlapped the removals may still
      // carry the deleted chats and would ghost them back for a tick.
      historyEpoch.current += 1;
      invalidateHermesSessionSummaries("dashboard_terminal");
      setHistory((current) => current.filter((entry) => !deleted.has(entry.id)));
      // The open chat may have been one of them; fall back to an empty one.
      if (session.sessionId && deleted.has(session.sessionId)) startNewChat();
    }
    const failed = items.length - deleted.size;
    if (failed > 0) {
      setHistoryError(
        failed === 1 && firstError
          ? firstError
          : `${failed} of ${items.length} chats could not be deleted.`,
      );
    }
  }

  // The rail only receives summary rows; transcripts load for the selected chat.
  const sidebarChats: TerminalSidebarChat[] = history.map((item) => ({
    id: item.id,
    title: item.title,
    updatedAt: item.updatedAt,
    active: item.active,
    pinned: item.pinned,
    highlight: item.highlight,
  }));

  function togglePanel(panel: TerminalPanel) {
    setSidePanel((current) => (current === panel ? null : panel));
  }

  // Rename, pin and highlight are optimistic: the change lands in the rail
  // immediately, and the epoch guard above keeps a refresh from showing a
  // snapshot that predates it. Highlighting especially — marking six chats is
  // six clicks, and waiting for a round trip between them would make the pen
  // feel stuck.
  async function patchHistorySession(
    item: TerminalSidebarChat,
    body: { title?: string; pinned?: boolean; highlight?: string | null },
    failure: string,
  ) {
    setHistoryError(null);
    historyEpoch.current += 1;
    setHistory((current) =>
      current.map((entry) =>
        entry.id === item.id
          ? {
              ...entry,
              ...(body.title === undefined ? {} : { title: body.title }),
              ...(body.pinned === undefined ? {} : { pinned: body.pinned }),
              ...(body.highlight === undefined ? {} : { highlight: body.highlight }),
            }
          : entry,
      ),
    );
    try {
      const response = await fetch(`/api/hermes/sessions/${encodeURIComponent(item.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(failure);
      invalidateHermesSessionSummaries("dashboard_terminal");
      if (body.title !== undefined) {
        // The route answers with the canonical session. Only the title can
        // come back normalized (the 200-char cap), so adopt it here rather
        // than letting the next poll silently shorten what the row shows.
        const data = await response.json().catch(() => null);
        const canonical = data?.session?.title;
        if (typeof canonical === "string" && canonical !== body.title) {
          setHistory((current) =>
            current.map((entry) =>
              entry.id === item.id && entry.title === body.title
                ? { ...entry, title: canonical }
                : entry,
            ),
          );
        }
      }
    } catch {
      setHistoryError(failure);
      // Roll back only the fields this call patched, and only where the row
      // still holds the value this call wrote — a later edit that landed in
      // the meantime is the newer truth and keeps it.
      setHistory((current) =>
        current.map((entry) => {
          if (entry.id !== item.id) return entry;
          const next = { ...entry };
          if (body.title !== undefined && entry.title === body.title) next.title = item.title;
          if (body.pinned !== undefined && entry.pinned === body.pinned) next.pinned = item.pinned;
          if (body.highlight !== undefined && entry.highlight === body.highlight) {
            next.highlight = item.highlight;
          }
          return next;
        }),
      );
    } finally {
      historyEpoch.current += 1;
    }
  }

  // LiquidGlass samples the root's own children, so the dock is the root and
  // the bar is the one glass panel inside it. The three backdrop layers below
  // exist purely to give the shader something to bend: the dock's own
  // background is invisible to it by design.
  const dockRef = useRef<HTMLElement | null>(null);
  const barRef = useRef<HTMLElement | null>(null);
  const glassWallpaperRef = useRef<HTMLImageElement | null>(null);
  const glassSceneRef = useRef<HTMLCanvasElement | null>(null);

  const { phase: glassPhase, refreshBackdrops } = useLiquidGlassBar({
    rootRef: dockRef,
    glassRef: barRef,
    enabled: LIQUID_GLASS_BAR_ENABLED,
    backdropRefs: [glassWallpaperRef, glassSceneRef],
    config: TERMINAL_BAR_GLASS,
    scene: {
      canvasRef: glassSceneRef,
      rootSelector: "[data-glass-scene-root]",
      // A wallpaper sits below the scene canvas and has to show through it.
      transparentFloor: Boolean(backdropImage),
    },
  });
  const glassMounted = glassPhase !== "off";
  const glassActive = glassPhase === "active";

  function handleResizeStart(event: ReactPointerEvent<HTMLElement>) {
    event.preventDefault();
    resizeStartRef.current = { startY: event.clientY, startHeight: height };
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsResizing(true);
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
  }

  function handleResizeMove(event: ReactPointerEvent<HTMLElement>) {
    const start = resizeStartRef.current;
    if (!start) return;
    setHeight(clampHeight(start.startHeight + (start.startY - event.clientY)));
  }

  function handleResizeEnd(event: ReactPointerEvent<HTMLElement>) {
    const start = resizeStartRef.current;
    if (!start) return;
    const moved = Math.abs(start.startY - event.clientY) >= 4;
    const clickedHeader = event.currentTarget.tagName === "HEADER";
    const wasOpen = start.startHeight > COLLAPSED_HEIGHT + 8;
    resizeStartRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setIsResizing(false);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    if (!moved && event.type !== "pointercancel" && clickedHeader) {
      setHeight(
        wasOpen
          ? COLLAPSED_HEIGHT
          : (preferredOpenHeightRef.current ?? defaultOpenHeight()),
      );
    }
  }

  const terminalStyle: CSSProperties = {
    height,
    // Once the shader owns the bar, the dock's fill has to get out of the way:
    // the scene layer paints above it, and a solid dock would just be a second,
    // flatter surface behind the glass.
    background: glassActive
      ? "transparent"
      : isOpen
        ? "var(--paper-surface)"
        : "var(--terminal-bar)",
    borderTopColor: glassActive ? "transparent" : "rgba(169, 193, 177, 0.7)",
  };
  const headerItemAnim = headerClosing
    ? "terminal-boot-conceal"
    : "terminal-boot-reveal";

  return (
    <section
      ref={dockRef}
      // Positioned against the viewport, so page padding cannot move it: the
      // artifact dock shortens its right edge through this attribute instead.
      data-terminal-dock
      style={terminalStyle}
      className={`bb-neu-tray neu-surface-raised fixed inset-x-0 bottom-0 z-40 flex flex-col overflow-hidden text-gray-100 ${
        glassActive ? "rounded-t-[22px]" : "border-t"
      }`}
    >
      {/* Refraction source: direct children of the dock, painted below the
          shader canvas. Both are media elements, so the library draws them
          with drawImage and never rasterises them. */}
      {glassMounted ? (
        <>
          {backdropImage ? (
            // An <img> is drawn straight into the scene by the library, which
            // skips html-to-image entirely. Boxed to the viewport so its cover
            // crop lands exactly where the page's own fixed wallpaper does.
            // next/image is not an option: this is a locally stored data URL
            // with no origin to optimise through, and the library needs the
            // raw element as a direct child of its root.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              ref={glassWallpaperRef}
              src={backdropImage}
              alt=""
              aria-hidden
              draggable={false}
              onLoad={refreshBackdrops}
              className="bb-terminal-glass-wallpaper"
            />
          ) : null}
          {/* Page-background floor, the live page blitted from a cached raster
              on every scroll, and a warm sheen — all in one canvas, so nothing
              here depends on a rasterisation succeeding. */}
          <canvas ref={glassSceneRef} aria-hidden className="bb-terminal-glass-scene" />
        </>
      ) : null}

      <div
        onPointerDown={handleResizeStart}
        onPointerMove={handleResizeMove}
        onPointerUp={handleResizeEnd}
        onPointerCancel={handleResizeEnd}
        className="group absolute inset-x-0 -top-1.5 z-10 flex h-3 cursor-row-resize items-center justify-center"
      >
        <span
          className={`h-1.5 w-14 rounded-full border border-[rgba(169,193,177,0.7)] shadow-[0_1px_4px_rgba(74,91,70,0.10)] transition-colors ${
            isResizing ? "bg-[#8faf9a]" : "bg-[#A9C1B1] group-hover:bg-[#8faf9a]"
          }`}
        />
      </div>

      <header
        onPointerDown={handleResizeStart}
        onPointerMove={handleResizeMove}
        onPointerUp={handleResizeEnd}
        onPointerCancel={handleResizeEnd}
        role={isOpen ? undefined : "button"}
        tabIndex={isOpen ? undefined : 0}
        aria-expanded={isOpen ? undefined : false}
        aria-label={isOpen ? undefined : "Open terminal"}
        title={
          isOpen
            ? "Click empty space to close, or drag to resize the terminal"
            : "Click to fully open, or drag up to resize the terminal"
        }
        onKeyDown={(event) => {
          if (
            !isOpen &&
            (event.key === "Enter" || event.key === " ")
          ) {
            event.preventDefault();
            setHeight(preferredOpenHeightRef.current ?? defaultOpenHeight());
          }
        }}
        ref={barRef}
        style={{ background: glassActive ? "transparent" : "var(--terminal-bar)" }}
        className={`bb-neu-toolbar flex shrink-0 cursor-row-resize touch-none select-none items-center gap-3 border-b border-[rgba(169,193,177,0.55)] px-4 ${
          headerMounted ? "py-2.5" : "h-full justify-center py-0"
        } ${glassActive ? "bb-terminal-glass-bar" : ""}`}
      >
        {headerMounted ? (
          <>
            <button
              type="button"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => setSidebarOpen((value) => !value)}
              style={{ animationDelay: "40ms" }}
              className={`${headerItemAnim} neu-button-icon flex h-7 w-7 items-center justify-center rounded-md border border-gray-800 text-gray-400 transition hover:border-gray-700 hover:text-white`}
              title={sidebarOpen ? "Hide the sidebar" : "Show the sidebar"}
              aria-label="Toggle the sidebar"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5M3.75 17.25h16.5" />
              </svg>
            </button>
            <div
              style={{ animationDelay: "210ms" }}
              className={`${headerItemAnim} flex min-w-0 items-center gap-2`}
            >
              <span
                role="status"
                aria-label={`Agent runtime is ${runtimeOnline ? "available" : "unavailable"}`}
                title={`Agent runtime ${runtimeOnline ? "available" : "unavailable"}`}
                className={`h-2 w-2 shrink-0 rounded-full ${
                  runtimeOnline ? "bg-[#4F805E]" : "bg-[#B65B5B]"
                }`}
              />
              <p
                className="truncate text-sm font-semibold text-[#172A22]"
              >
                Terminal
              </p>
              {!runtimeOnline ? (
                <button
                  type="button"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => void refreshTerminal()}
                  disabled={refreshingTerminal}
                  aria-label={
                    refreshingTerminal
                      ? "Refreshing terminal connection"
                      : "Reconnect terminal"
                  }
                  title={
                    refreshingTerminal
                      ? "Refreshing terminal connection"
                      : "Refresh and reconnect this terminal"
                  }
                  className="neu-button inline-flex h-7 items-center gap-1.5 rounded-lg border border-[color-mix(in_srgb,var(--danger)_32%,var(--line))] bg-[var(--paper-raised)] px-2 text-[11px] font-medium text-[var(--danger)] transition hover:bg-[var(--paper-strong)] disabled:cursor-wait disabled:opacity-65"
                >
                  <svg
                    aria-hidden="true"
                    className={`h-3.5 w-3.5 ${refreshingTerminal ? "animate-spin" : ""}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={1.8}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M16.023 9.348h4.992V4.356m-1.291 5.001a8.25 8.25 0 10.219 5.062M7.977 14.652H2.985v4.992m1.291-5.001a8.25 8.25 0 0015.485-2.288"
                    />
                  </svg>
                  <span>{refreshingTerminal ? "Refreshing" : "Reconnect"}</span>
                </button>
              ) : null}
              <GBrainStatusBadge />
            </div>
            {/* Artifacts, Uploads and Scheduled all live in the left rail now;
                the header keeps only the rail toggle and the runtime state. */}
          </>
        ) : null}
      </header>

      {isOpen ? (
        // Carries the surface the dock used to paint itself. Without it the
        // wallpaper layer behind the glass bar would show through the chat.
        //
        // z-1 is load-bearing, not cosmetic: it stacks the body after the bar,
        // which is what keeps LiquidGlass from treating the chat panel as
        // refraction source. The bar samples 20px past its own box, so an
        // unstacked body would land in that margin and get run through
        // html-to-image on every frame of a dock resize.
        <div className="relative z-[1] flex min-h-0 flex-1 bg-[var(--paper-surface)]">
          {/* Everything in the dock shares one lane for opened artifacts: the
              transcript's own cards and the Artifacts archive both file into
              it, so an artifact never leaves the dock it was made in. */}
          <ArtifactDockHostProvider host={artifactLane}>
          {sidebarOpen ? (
            <TerminalSidebar
              chats={sidebarChats}
              loading={historyLoading}
              error={historyError}
              activeChatId={session.sessionId}
              openPanel={sidePanel}
              onNewChat={startNewChat}
              onTogglePanel={togglePanel}
              onOpenSearch={() => setSearchOpen(true)}
              onOpenChat={(chat) => openHistorySession(chat.id)}
              onRenameChat={(chat, title) =>
                void patchHistorySession(chat, { title }, "This chat could not be renamed.")
              }
              onTogglePin={(chat) =>
                void patchHistorySession(
                  chat,
                  { pinned: !chat.pinned },
                  chat.pinned ? "This chat could not be unpinned." : "This chat could not be pinned.",
                )
              }
              onDeleteChat={(chat) => void deleteHistorySession(chat)}
              onDeleteChats={(selected) => void deleteHistorySessions(selected)}
              onHighlightChat={(chat, highlight) =>
                void patchHistorySession(
                  chat,
                  { highlight },
                  "This chat could not be highlighted.",
                )
              }
            />
          ) : null}

          <div className="flex min-w-0 flex-1 flex-col">
            <input
              ref={attachmentInputRef}
              type="file"
              accept={TERMINAL_ATTACHMENT_ACCEPT}
              multiple
              onChange={handleAttachmentInput}
              className="hidden"
            />
            <AgentRuntimePanel
                sessionId={session.sessionId}
                surface="dashboard_terminal"
                messages={session.messages}
                connection={session.connection}
                runState={session.runState}
                externalRunLaunching={
                  externalRunLaunching || agentLaunchQueue.queued
                }
                steerError={session.steerError}
                error={runtimeUnavailable ? RUNTIME_UNAVAILABLE_MESSAGE : session.error}
                pendingPermission={session.pendingPermission}
                activities={session.activities}
                input={input}
                onInputChange={setInput}
                onSubmit={submit}
                beforeComposer={
                  agentLaunchQueue.pending ? (
                    <AgentLaunchPrompt
                      request={agentLaunchQueue.pending}
                      waiting={agentLaunchQueue.waiting}
                      onConfirm={agentLaunchQueue.confirm}
                      onDismiss={agentLaunchQueue.dismiss}
                    />
                  ) : null
                }
                onRunWorkflow={runWorkflowAutomation}
                onAskSelection={askSelection}
                onSteer={steer}
                onSendQueued={sendQueued}
                onEditMessage={editMessage}
                onSelectBranch={selectBranch}
                disabled={runtimeUnavailable}
                onAbort={() => void session.abort()}
                onPermissionDecision={(decision) => void session.respondToPermission(decision)}
                onRetryMessage={retryMessage}
                onExternalAgentTerminal={handleExternalAgentTerminal}
                onExternalAgentSourceReady={() => {
                  void session.refreshSession();
                }}
                placeholder={isPublic ? "Ask anything across all public gardens…" : "Ask anything across your gardens…"}
                model={model}
                models={models}
                onModelChange={setModel}
                reasoningEffort={reasoningEffort}
                onReasoningEffortChange={setReasoningEffort}
                intelligenceModes={intelligenceModes}
                modelFailover={modelFailover}
                browserAgent={browserAgent}
                onSelectBrowserAgent={() => void selectBrowserAgent()}
                onClearBrowserAgent={() => {
                  setBrowserAgent(null);
                  setAttachmentStatus("");
                }}
                agentBrowserAgent={agentBrowserAgent}
                onSelectAgentBrowser={() => void selectAgentBrowser()}
                onClearAgentBrowser={() => {
                  setAgentBrowserAgent(null);
                  setAttachmentStatus("");
                }}
                deepResearchAgent={deepResearch.agent}
                onSelectDeepResearch={() => {
                  // One runtime agent owns the conversation at a time.
                  setBrowserAgent(null);
                  setAgentBrowserAgent(null);
                  setOpenPlanterAgent(null);
                  setAgentReachAgent(null);
                  setGetDocAgent(null);
                  setMeetingNotesAgent(null);
                  setDeepTutorAgent(null);
                  setCareerOpsAgent(null);
                  setTradingAgentsAgent(null);
                  setVibeTradingAgent(null);
                  setDeerFlowAgent(null);
                  setShortsAgent(null);
                  clearCodex();
                  clearOpenCode();
                  clearRuflo();
                  void deepResearch.select();
                }}
                onClearDeepResearch={() => {
                  deepResearch.clear();
                  setAttachmentStatus("");
                }}
                openPlanterAgent={openPlanterAgent}
                onSelectOpenPlanter={() => void selectOpenPlanter()}
                onSelectSocialsManager={() => {}}
                onSelectHardwareBlueprint={() => {}}
                onSelectParametricCad={() => {}}
                onSelectHyperframes={() => {}}
                onSelectResource2Skill={() => {}}
                onSelectOpenMontage={() => {}}
                onSelectOpenwork={() => {}}
                onSelectOpenscience={() => {}}
                onSelectInboxZero={() => {}}
                onSelectVimax={() => {}}
                onSelectMoneyPrinter={() => {}}
                onSelectLegal={() => {}}
                onClearOpenPlanter={() => {
                  setOpenPlanterAgent(null);
                  setAttachmentStatus("");
                }}
                agentReachAgent={agentReachAgent}
                onSelectAgentReach={() => void selectAgentReach()}
                onClearAgentReach={() => {
                  setAgentReachAgent(null);
                  setAttachmentStatus("");
                }}
                meetingNotesAgent={meetingNotesAgent}
                onSelectMeetingNotes={() => void selectMeetingNotes()}
                onMeetingRecorded={(recording) => {
                  // The capture is the request. Waiting for a sentence after a
                  // two-hour call would be one more thing to do at the moment
                  // somebody most wants to close the laptop.
                  void launchMeetingNotesRun(input.trim(), meetingNotesAgent ?? undefined, {
                    uploadId: recording.uploadId,
                    filename: recording.filename,
                  });
                  setInput("");
                }}
                onClearMeetingNotes={() => {
                  setMeetingNotesAgent(null);
                  setAttachmentStatus("");
                }}
                getDocAgent={getDocAgent}
                onSelectGetDoc={() => void selectGetDoc()}
                onClearGetDoc={() => {
                  setGetDocAgent(null);
                  setMeetingNotesAgent(null);
                  setAttachmentStatus("");
                }}
                deepTutorAgent={deepTutorAgent}
                onSelectDeepTutor={() => void selectDeepTutor()}
                onClearDeepTutor={() => {
                  setDeepTutorAgent(null);
                  setAttachmentStatus("");
                }}
                careerOpsAgent={careerOpsAgent}
                onSelectCareerOps={() => void selectCareerOps()}
                onClearCareerOps={() => {
                  setCareerOpsAgent(null);
                  setAttachmentStatus("");
                }}
                vibeTradingAgent={vibeTradingAgent}
                onSelectVibeTrading={() => void selectVibeTrading()}
                onClearVibeTrading={() => {
                  setVibeTradingAgent(null);
                  setAttachmentStatus("");
                }}
                stockAnalystAgent={stockAnalystAgent}
                onSelectStockAnalyst={() => void selectStockAnalyst()}
                onClearStockAnalyst={() => {
                  setStockAnalystAgent(null);
                  setAttachmentStatus("");
                }}
                paperTraderAgent={paperTraderAgent}
                onClearPaperTrader={() => {
                  setPaperTraderAgent(null);
                  setAttachmentStatus("");
                }}
                deerFlowAgent={deerFlowAgent}
                onSelectDeerFlow={() => void selectDeerFlow()}
                onClearDeerFlow={() => {
                  setDeerFlowAgent(null);
                  setAttachmentStatus("");
                }}
                tradingAgentsAgent={tradingAgentsAgent}
                tradingAgentsSeed={tradingAgentsSeed}
                onSelectTradingAgents={() => void selectTradingAgents()}
                onClearTradingAgents={() => {
                  setTradingAgentsAgent(null);
                  setVibeTradingAgent(null);
                  setDeerFlowAgent(null);
                  setTradingAgentsSeed(null);
                  setAttachmentStatus("");
                }}
                onSubmitTradingAgents={(request) => void launchTradingAgentsRun(request)}
                shortsAgent={shortsAgent}
                shortsSeed={shortsSeed}
                onSelectShorts={() => void selectShorts()}
                onClearShorts={() => {
                  setShortsAgent(null);
                  setShortsSeed(null);
                  setAttachmentStatus("");
                }}
                onSubmitShorts={(request) => void launchShortsRun(request)}
                formsmithAgent={formsmithAgent}
                onSelectFormsmith={() => void selectFormsmith()}
                onClearFormsmith={() => {
                  setFormsmithAgent(null);
                  setAttachmentStatus("");
                }}
                onSubmitFormsmith={(request) => void launchFormsmithRun(request)}
                openCodeAgent={openCode.agent}
                onSelectOpenCode={() => void selectOpenCode()}
                onClearOpenCode={() => {
                  clearOpenCode();
                  setAttachmentStatus("");
                }}
                codexAgent={codex.agent}
                onSelectCodex={() => void selectCodex()}
                onClearCodex={() => {
                  clearCodex();
                  setAttachmentStatus("");
                }}
                rufloAgent={ruflo.agent}
                onSelectRuflo={() => void selectRuflo()}
                onClearRuflo={() => {
                  clearRuflo();
                  setAttachmentStatus("");
                }}
                onAddDocuments={() => attachmentInputRef.current?.click()}
                onPasteFiles={addAttachmentFiles}
                isAddingDocuments={extractingAttachments}
                attachments={chatAttachments}
                onRemoveAttachment={(index) =>
                  setChatAttachments((current) =>
                    current.filter((_, itemIndex) => itemIndex !== index),
                  )
                }
                statusMessage={attachmentStatus}
                loadingTranscript={session.loadingSession}
                emptyState={
                  <div className="flex flex-col items-center gap-5 py-8 text-center">
                    <div>
                      <p className="text-lg font-medium text-white">
                        {isPublic ? "Ask the public knowledge hub" : "Ask your whole knowledge base"}
                      </p>
                      <p className="mt-1.5 text-sm text-gray-500">
                        {isPublic
                          ? "Answers are grounded in the notes across every public garden on Breadboard."
                          : "Answers are grounded in the notes across every garden you own."}
                      </p>
                    </div>
                    <div className="grid w-full max-w-xl gap-2 sm:grid-cols-2">
                      {SUGGESTED_PROMPTS[scope].map((prompt) => (
                        <button
                          type="button"
                          key={prompt}
                          onClick={() => sendSuggestedPrompt(prompt)}
                          disabled={busy || runtimeUnavailable}
                          className="neu-button rounded-lg border border-gray-800 bg-gray-900/40 px-3 py-2.5 text-left text-sm text-gray-300 transition hover:border-gray-600 hover:bg-gray-900 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {prompt}
                        </button>
                      ))}
                    </div>
                  </div>
                }
              />
          </div>
          {sidePanel ? (
            <aside
              aria-label={
                sidePanel === "artifacts"
                  ? "Artifacts"
                  : sidePanel === "uploads"
                    ? "Uploads"
                    : sidePanel === "scheduled"
                      ? "Scheduled chats"
                      : sidePanel === "hooks"
                        ? "Hooks"
                        : "Processes"
              }
              className="bb-neu-sidebar-right w-[min(42vw,520px)] shrink-0 border-l border-[var(--line)]"
            >
              {sidePanel === "artifacts" ? (
                <ArtifactPanel
                  compact
                  sourceSurface="dashboard_terminal"
                  creationConversationId={session.sessionId}
                  ensureCreationConversation={session.ensureConversation}
                />
              ) : sidePanel === "uploads" ? (
                <UploadsPanel onOpenChat={(conversationId) => openHistorySession(conversationId)} />
              ) : sidePanel === "scheduled" ? (
                <TerminalScheduledPanel surface="dashboard_terminal" />
              ) : sidePanel === "hooks" ? (
                <HooksPanel />
              ) : (
                <ProcessesPanel
                  onOpenChat={(conversationId) => openHistorySession(conversationId)}
                  onOpenPanel={(panel) => setSidePanel(panel)}
                />
              )}
            </aside>
          ) : null}
          {/* Empty until an artifact is opened, and then an even half of what
              is left beside the transcript — the chat keeps the other half. */}
          <div
            ref={setArtifactLane}
            className="bb-artifact-lane"
            data-artifact-lane
          />
          </ArtifactDockHostProvider>
        </div>
      ) : null}

      {searchOpen ? (
        <ChatSearchDialog
          surface="dashboard_terminal"
          recents={sidebarChats}
          onClose={() => setSearchOpen(false)}
          onSelect={(chatId) => openHistorySession(chatId)}
        />
      ) : null}
    </section>
  );
}
