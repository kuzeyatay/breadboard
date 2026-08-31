"use client";

// The dashboard terminal keeps the original Breadboard dock, history sidebar,
// and paper styling while the selected agent adapter owns the runtime,
// streaming events, permissions, tools, persistence, and skill review.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import KnowledgeTerminal from "@/app/components/knowledge-terminal";
import BreadboardLoader from "@/app/components/breadboard-loader";
import { useAssistantIntelligence } from "@/app/components/use-assistant-intelligence";
import { useConfirmDialog } from "@/app/components/confirm-dialog";
import { isSuperAgentEnabled } from "@/app/components/use-agent-mode";
import { interactiveVisualizerCommandForArtifact } from "@/lib/hermes/interactive-visualizer-skills";
import AgentRuntimePanel from "./agent-runtime-panel";
import ChatGreetingEmptyState from "./chat-greeting-empty-state";
import { useChatGreeting } from "./use-chat-greeting";
import { ArtifactDockHostProvider } from "./artifact-dock-host";
import ArtifactPanel, { ARTIFACT_AI_EDIT_EVENT } from "./artifact-panel";
import {
  artifactAiEditMatchesScope,
  consumeArtifactAiEdit,
  type ArtifactAiEditDetail,
} from "./artifact-ai-edit";
import {
  chatSessionIsActive,
  deleteChatSession,
  UnreadChatDot,
} from "./history-client";
import {
  chatActivityById,
  nextUnreadChats,
  readUnreadChats,
  sameChatIds,
  writeUnreadChats,
} from "@/lib/conversations/unread";
import {
  chatDraftKey,
  clearChatDraft,
  forgetChatDrafts,
} from "@/lib/conversations/drafts";
import { useChatDraft } from "./use-chat-draft";
import {
  invalidateHermesSessionSummaries,
  notifyHermesSessionsChanged,
  HERMES_SESSIONS_CHANGED_EVENT,
  loadHermesSessionSummaries,
  prefetchHermesSessionDetail,
  type HermesSessionSnapshot,
} from "@/lib/hermes/session-client";
import TerminalSidebar, {
  CHAT_RAIL_RESIZE,
  PENDING_CHAT_ROW_ID,
  type TerminalPanel,
  type TerminalSidebarChat,
} from "./terminal-sidebar";
import SidePanelDock from "./side-panel-dock";
import ProductDetailsPanel, {
  type ProductPanelSelection,
} from "./product-details-panel";
import { useRailResize } from "./use-rail-resize";
import ChatSearchDialog from "./chat-search-dialog";
import UploadsPanel from "./uploads-panel";
import TerminalScheduledPanel from "./terminal-scheduled-panel";
import HooksPanel from "./hooks-panel";
import ProcessesPanel from "./processes-panel";
import {
  externalAgentRunInFlight,
  useAgentSession,
  type AgentMessage,
  type ExternalAgentTurnResult,
} from "./use-agent-session";
import { externalAgentCardContent } from "@/lib/conversations/external-agent-runs";
import { useWorkflowAutomation } from "./use-workflow-automation";
import { useAssistantModels } from "../use-assistant-models";
import { useLiquidGlassBar } from "./use-liquid-glass-bar";
import { useTerminalHeaderClickGuard } from "../terminal-header-click-guard";
import {
  productForAction,
  safeProductUrl,
  type GenerativeUiAction,
} from "@/lib/generative-ui/contracts.ts";
import {
  TERMINAL_ATTACHMENT_ACCEPT,
  chatMessageAttachments,
  extractChatAttachments,
  reusableChatAttachments,
  type ChatAttachment,
} from "@/lib/chat-attachments";
import { distillAttachments } from "@/lib/document-skills/client";
import {
  agentBrowserStartFailure,
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
  OPENEXECUTIVE_AGENT_ID,
  OPENEXECUTIVE_AGENT_NAME,
  openExecutiveUserMessage,
  taskFromOpenExecutiveCommand,
} from "@/lib/openexecutive/identity.ts";
import {
  OPEN_GYM_AGENT_ID,
  openGymUserMessage,
  taskFromOpenGymCommand,
} from "@/lib/open-gym/identity.ts";
import { shouldRouteOpenGymFromSuperAgent } from "@/lib/open-gym/routing-client.ts";
import {
  TRADINGAGENTS_AGENT_ID,
  TRADINGAGENTS_AGENT_NAME,
  parseTradingAgentsCommand,
  tradingAgentsRequestFromBrief,
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
  DEER_FLOW_AGENT_ID,
  DEER_FLOW_AGENT_NAME,
  taskFromDeerFlowCommand,
  deerFlowUserMessage,
} from "@/lib/deer-flow/identity.ts";
import {
  directDeepResearchInvocation,
  taskFromDeepResearchIntent,
} from "@/lib/deep-research/identity.ts";
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
import {
  socialsManagerUserMessage,
  taskFromSocialsManagerCommand,
} from "@/lib/socials-manager/identity.ts";
import {
  hardwareBlueprintUserMessage,
  taskFromHardwareBlueprintCommand,
} from "@/lib/hardware/identity.ts";
import {
  briefFromVimaxCommand,
  vimaxUserMessage,
} from "@/lib/vimax/identity.ts";
import {
  briefFromVoxDirectorCommand,
  voxDirectorUserMessage,
} from "@/lib/vox-director/identity.ts";
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
  taskFromWardrobeCommand,
  wardrobeRunLabel,
  wardrobeUserMessage,
} from "@/lib/wardrobe/identity.ts";
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
  matraixUserMessage,
  taskFromMatraixCommand,
} from "@/lib/matraix/identity.ts";
import {
  boltSlidesUserMessage,
  taskFromBoltSlidesCommand,
} from "@/lib/bolt-slides/identity.ts";
import {
  classroomUserMessage,
  taskFromClassroomCommand,
} from "@/lib/classroom/identity.ts";
import {
  GODS_EYE_AGENT_ID,
  godsEyeUserMessage,
  taskFromGodsEyeCommand,
} from "@/lib/gods-eye/identity.ts";
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
  parsePraxistTaskPath,
  praxistUserMessage,
  taskFromPraxistCommand,
} from "@/lib/praxist/identity.ts";
import { maxResearchInvocation } from "@/lib/max-research/identity.ts";
import { launchMaxResearchTurn } from "./launch-max-research";
import {
  inboxZeroUserMessage,
  taskFromInboxZeroCommand,
} from "@/lib/inbox-zero/identity.ts";
import {
  agentTarsUserMessage,
  taskFromAgentTarsCommand,
} from "@/lib/ui-tars/identity.ts";
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
  agentLaunchWorkerClientMessageId,
  useAgentLaunchQueue,
  type AgentLaunchRequestPayload,
} from "./use-agent-launch-queue";
import AgentLaunchPrompt from "./agent-launch-prompt";
import type { ChatTextSelectionReference } from "@/lib/chat-text-selection";
import {
  CHAT_NOTIFICATION_OPEN_REQUEST_EVENT,
  setActiveChatNotificationTarget,
  takeChatNotificationReply,
  type ChatNotificationTarget,
} from "@/lib/chat-notification-inbox";

type TerminalScope = "mine" | "public";

interface Props {
  scope: TerminalScope;
  /** Stable account identity used only to scope tab-local reload recovery. */
  restoreOwnerKey: string;
  /** Opens a route-owned panel as soon as the terminal mounts. */
  initialPanel?: TerminalPanel | null;
  /**
   * The dashboard wallpaper, so the glass bar can refract the same image the
   * page paints behind it instead of inventing its own backdrop.
   */
  backdropImage?: string | null;
  /** A notification deep-link can request one durable Terminal conversation. */
  initialChatId?: string | null;
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
const OPEN_STATE_KEY = "breadboard:knowledge-terminal-open";
const ACTIVE_CHAT_KEY = "breadboard:terminal:active-chat";
const ACTIVE_CHAT_SNAPSHOT_KEY = "breadboard:terminal:active-chat-snapshot";
const ACTIVE_CHAT_SNAPSHOT_MAX_CHARS = 1_500_000;

interface ActiveTerminalChatSnapshot {
  ownerKey: string;
  sessionId: string;
  messages: AgentMessage[];
}

function readActiveTerminalChatId(ownerKey: string): string | null {
  const stored = window.sessionStorage.getItem(ACTIVE_CHAT_KEY)?.trim();
  if (!stored) return null;
  try {
    const parsed = JSON.parse(stored) as {
      ownerKey?: unknown;
      sessionId?: unknown;
    };
    return parsed.ownerKey === ownerKey &&
      typeof parsed.sessionId === "string" &&
      parsed.sessionId.startsWith("conv_")
      ? parsed.sessionId
      : null;
  } catch {
    // Unscoped ids from an earlier build cannot be safely attributed after an
    // account switch, so they deliberately fall back to a fresh terminal.
    return null;
  }
}

function readActiveTerminalChatSnapshot(
  ownerKey: string,
  sessionId: string,
): AgentMessage[] {
  try {
    const parsed = JSON.parse(
      window.sessionStorage.getItem(ACTIVE_CHAT_SNAPSHOT_KEY) ?? "null",
    ) as ActiveTerminalChatSnapshot | null;
    return parsed?.ownerKey === ownerKey &&
      parsed.sessionId === sessionId &&
      Array.isArray(parsed.messages)
      ? parsed.messages
      : [];
  } catch {
    return [];
  }
}

function writeActiveTerminalChatSnapshot(
  ownerKey: string,
  sessionId: string,
  messages: AgentMessage[],
): void {
  // This is a paint-through cache, not another source of truth. Bound it to
  // the recent transcript so a tool-heavy chat cannot exhaust sessionStorage;
  // the authoritative server read replaces it immediately after a reload.
  let recent = messages.slice(-40);
  while (recent.length > 0) {
    const encoded = JSON.stringify({ ownerKey, sessionId, messages: recent });
    if (encoded.length <= ACTIVE_CHAT_SNAPSHOT_MAX_CHARS) {
      try {
        window.sessionStorage.setItem(ACTIVE_CHAT_SNAPSHOT_KEY, encoded);
      } catch {
        window.sessionStorage.removeItem(ACTIVE_CHAT_SNAPSHOT_KEY);
      }
      return;
    }
    recent = recent.slice(Math.max(1, Math.floor(recent.length / 2)));
  }
  window.sessionStorage.removeItem(ACTIVE_CHAT_SNAPSHOT_KEY);
}
/**
 * Shown when a Recents refresh does not land. Named so the next successful
 * refresh can retract exactly this note and leave a real error — a delete that
 * failed, say — standing.
 */
const HISTORY_REFRESH_FAILED =
  "The chat list could not be refreshed. Showing the last one that loaded.";
const COLLAPSED_HEIGHT = 48;
// The shortest the dock can stand open. The composer is anchored to the bottom
// of the body (`.bb-composer-overlay`), so a body with no room for it does not
// clip it — it draws the pill back up over the header bar, with the transcript
// squeezed to nothing behind. There is no height between this and the collapsed
// bar that renders, so the dock never rests in that band.
const MIN_OPEN_HEIGHT = 260;
const MIN_HEIGHT = COLLAPSED_HEIGHT;
const HEALTH_RETRY_DELAY_MS = 3_000;
const HEALTH_FAILURE_THRESHOLD = 3;

// Clicking the bar opens or closes the dock outright, and that travel is
// animated. Dragging it never is — an edge with a transition on it trails the
// pointer instead of sitting under it.
//
// Opening has room to establish the large surface. Closing answers immediately
// and settles instead of gathering speed, which made the panel appear stuck
// for a beat and then race through its final frames.
const DOCK_OPEN_MS = 420;
const DOCK_CLOSE_MS = 240;
const DOCK_OPEN_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";
const DOCK_CLOSE_EASING = "var(--neu-easing)";

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

// The open height on this viewport, which on a very short one is all the room
// there is rather than the constant.
function minOpenHeight(): number {
  return Math.min(MIN_OPEN_HEIGHT, maxHeight());
}

// The two heights a drag may leave the dock at: shut, or tall enough to lay
// out. In between the edge snaps to whichever it is nearer, so the band where
// the composer rides over the header is passed through rather than rested in.
function settleHeight(height: number): number {
  const open = minOpenHeight();
  if (height >= open) return clampHeight(height);
  return height >= (COLLAPSED_HEIGHT + open) / 2 ? open : COLLAPSED_HEIGHT;
}

// Where the navbar's underside lands once the page is back at the top. Opening
// the dock sends the page there, so this — not wherever the bar happens to be
// right now — is the room the dock has to leave above itself. Reached through
// the scroll offset because the bar is in normal flow and travels with the page.
function navOffsetAtTop(): number {
  if (typeof document === "undefined") return 64;
  const nav = document.querySelector("nav");
  if (!nav) return 64;
  const bottom = Math.ceil(nav.getBoundingClientRect().bottom + window.scrollY);
  return Math.min(Math.max(0, bottom), window.innerHeight);
}

// A height remembered from an earlier drag is still capped by the room the
// navbar needs, so "fully open" always means the same thing: the page at the
// top, the bar above the dock. Dragged up while the page was scrolled down the
// dock can be a whole viewport tall, and opening it that way after the scroll
// would bury the top it just went to fetch.
function openHeight(preferred: number | null): number {
  if (typeof window === "undefined") return 720;
  const max = Math.max(
    MIN_HEIGHT,
    Math.round(window.innerHeight - navOffsetAtTop()),
  );
  // Floored as well as capped: a height remembered from a drag that ended just
  // short of shut would otherwise reopen the dock into the band it cannot
  // render, and go on doing so on every visit.
  return preferred === null
    ? max
    : Math.min(Math.max(preferred, MIN_OPEN_HEIGHT), max);
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

type HealthState = {
  status: "checking" | "runtime" | "disabled" | "unavailable";
  mode: "required" | "preferred" | "legacy";
};

async function loadRuntimeHealth({
  reconnect = false,
}: {
  reconnect?: boolean;
} = {}): Promise<HealthState> {
  const response = await fetch("/api/hermes/health", {
    method: reconnect ? "POST" : "GET",
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Runtime health returned ${response.status}`);
  }
  const data = await response.json();
  const mode =
    data?.dashboardMode === "preferred" || data?.dashboardMode === "legacy"
      ? data.dashboardMode
      : "required";
  if (data?.enabled && (data?.healthy || data?.available === true)) {
    return { status: "runtime", mode };
  }
  if (data?.enabled) return { status: "unavailable", mode };
  return { status: "disabled", mode };
}

// Keep the failure actionable and runtime-neutral. Required mode still never
// silently falls back to the legacy transport.
const RUNTIME_UNAVAILABLE_MESSAGE =
  "The agent runtime is temporarily unavailable. Reconnect and try again.";

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
  Extract<ChatAttachment, { type: "video" }> | { name: string; url: string };

export default function DashboardAgentTerminal({
  scope,
  restoreOwnerKey,
  initialPanel = null,
  backdropImage = null,
  initialChatId = null,
}: Props) {
  const [health, setHealth] = useState<HealthState>({
    status: "checking",
    mode: "required",
  });
  // Once this renderer has accepted a chat, a later health downgrade must not
  // replace the whole Hermes tree with the legacy terminal. Doing so unmounts
  // the live session and looks exactly like the terminal restarted mid-send.
  const [runtimeSurfaceEngaged, setRuntimeSurfaceEngaged] = useState(false);
  const markRuntimeSurfaceEngaged = useCallback(
    () => setRuntimeSurfaceEngaged(true),
    [],
  );

  useEffect(() => {
    let cancelled = false;
    let retryTimer: number | null = null;
    let consecutiveFailures = 0;

    async function checkHealth() {
      let shouldRetry = false;
      try {
        // Mount and background retries are observational. A stopped on-demand
        // runtime remains available here; the retained user submission acquires
        // the actual service lease in the server-side Hermes adapter.
        const nextHealth = await loadRuntimeHealth();
        if (cancelled) return;
        if (nextHealth.status === "unavailable") {
          consecutiveFailures += 1;
          if (consecutiveFailures >= HEALTH_FAILURE_THRESHOLD) {
            setHealth(nextHealth);
          }
          shouldRetry = true;
        } else {
          consecutiveFailures = 0;
          setHealth(nextHealth);
        }
      } catch {
        if (cancelled) return;
        // The dashboard itself may be recompiling or reconnecting while Hermes
        // stays healthy. A transport miss is not evidence that the agent runtime
        // is down, so retain the last known state and try again quietly.
        consecutiveFailures += 1;
        shouldRetry = true;
      }

      if (!cancelled && shouldRetry) {
        retryTimer = window.setTimeout(
          () => void checkHealth(),
          HEALTH_RETRY_DELAY_MS,
        );
      }
    }

    void checkHealth();
    return () => {
      cancelled = true;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
    };
  }, []);

  const refreshRuntimeHealth = useCallback(async (): Promise<boolean> => {
    try {
      // Keep the known red state visible while the button spins. Switching to
      // the initial "checking" state used to remove the button immediately,
      // shrink the brown bar, and make a failed retry look like no action at
      // all. Commit green only after the active reconnect succeeds.
      const nextHealth = await loadRuntimeHealth({ reconnect: true });
      setHealth(nextHealth);
      return nextHealth.status === "runtime";
    } catch {
      setHealth((current) => ({ ...current, status: "unavailable" }));
      return false;
    }
  }, []);

  // Route-owned panels do not depend on which chat transport is available.
  // Keep them in the shared terminal shell even when the legacy fallback would
  // otherwise replace that shell entirely.
  if (initialPanel) {
    return (
      <RuntimeTerminal
        scope={scope}
        restoreOwnerKey={restoreOwnerKey}
        initialChatId={initialChatId}
        initialPanel={initialPanel}
        backdropImage={backdropImage}
        runtimeUnavailable={health.status === "unavailable"}
        onRefreshRuntime={refreshRuntimeHealth}
        onConversationEngaged={markRuntimeSurfaceEngaged}
      />
    );
  }

  // A health check in progress is not a failure. The runtime session can begin
  // connecting immediately while the explicit health probe finishes.
  if (
    health.status === "runtime" ||
    health.status === "checking" ||
    runtimeSurfaceEngaged
  ) {
    return (
      <RuntimeTerminal
        scope={scope}
        restoreOwnerKey={restoreOwnerKey}
        initialChatId={initialChatId}
        initialPanel={initialPanel}
        backdropImage={backdropImage}
        runtimeUnavailable={health.status === "unavailable"}
        onRefreshRuntime={refreshRuntimeHealth}
        onConversationEngaged={markRuntimeSurfaceEngaged}
      />
    );
  }
  if (health.mode === "required") {
    return (
      <RuntimeTerminal
        scope={scope}
        restoreOwnerKey={restoreOwnerKey}
        initialChatId={initialChatId}
        initialPanel={initialPanel}
        backdropImage={backdropImage}
        runtimeUnavailable
        onRefreshRuntime={refreshRuntimeHealth}
        onConversationEngaged={markRuntimeSurfaceEngaged}
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
  restoreOwnerKey,
  initialPanel = null,
  backdropImage = null,
  initialChatId = null,
  runtimeUnavailable = false,
  onRefreshRuntime,
  onConversationEngaged,
}: Props & {
  runtimeUnavailable?: boolean;
  onRefreshRuntime: () => Promise<boolean>;
  onConversationEngaged: () => void;
}) {
  const resizeStartRef = useRef<{
    startY: number;
    startHeight: number;
    wasOpen: boolean;
  } | null>(null);
  const preferredOpenHeightRef = useRef<number | null>(null);
  const openStatePersistenceReadyRef = useRef(false);
  const activeChatRestoreStartedRef = useRef(false);
  const activeChatPersistenceReadyRef = useRef(false);
  const activeChatSnapshotRef = useRef<ActiveTerminalChatSnapshot | null>(null);
  const openedNotificationChatRef = useRef<string | null>(null);
  const [height, setHeight] = useState(COLLAPSED_HEIGHT);

  useEffect(() => {
    const saved = Number(window.localStorage.getItem(HEIGHT_KEY));
    if (Number.isFinite(saved) && saved > COLLAPSED_HEIGHT + 8) {
      preferredOpenHeightRef.current = clampHeight(saved);
    }
    const wasOpen = window.sessionStorage.getItem(OPEN_STATE_KEY) === "true";
    if (initialPanel || wasOpen) {
      // A route-owned panel is the requested page, so it cannot stay hidden in
      // the normally collapsed dock on first arrival. An already-open dock is
      // also restored after a renderer reload so a dev-server restart does not
      // look like the user closed Terminal. Nothing is scrolled yet, so this
      // opens to exactly what a click would.
      setHeight(openHeight(preferredOpenHeightRef.current));
    }
  }, [initialPanel]);
  const [isResizing, setIsResizing] = useState(false);
  // The rail's edge drags to any width and clicks between the icon rail and
  // whatever width it was last opened to — the same edge the learning map and
  // the side panel have, so a garden has one boundary vocabulary rather than
  // three.
  const rail = useRailResize({
    ...CHAT_RAIL_RESIZE,
    storageKey: "breadboard:terminal:sidebar-width",
  });
  const [input, setInput] = useState("");
  // Keep the just-submitted words in the draft store until the server confirms
  // the user turn is durable. The composer can still clear immediately.
  const [submittedDraft, setSubmittedDraft] = useState<string | null>(null);
  // A persistence acknowledgement can arrive after the reader has switched
  // chats and submitted the same words somewhere else. Only the acknowledgement
  // for the current retained draft may clear its React shadow; each callback
  // still clears the localStorage keys for the turn it actually persisted.
  const submittedDraftSequence = useRef(0);
  // Handed down to the panel so picking an opener can put the caret where the
  // text just landed.
  const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  // A click or keyboard press on the collapsed bar is an intent to start
  // chatting. Remember it across the render that mounts the textarea so focus
  // can follow the dock open instead of remaining on the header.
  const focusComposerAfterOpenRef = useRef(false);
  const {
    model: selectedModel,
    setModel: setSelectedModel,
    reasoningEffort: selectedReasoningEffort,
    setReasoningEffort,
    intelligenceModes: selectedIntelligenceModes,
    failover: modelFailover,
  } = useAssistantIntelligence();
  // A model picked while this answer is active is a setting for the next
  // answer. Keep every callback in the current run on the intelligence pair it
  // started with, including delegated/external-agent continuations.
  const [activeAnswerIntelligence, setActiveAnswerIntelligence] = useState<{
    model: string;
    reasoningEffort: typeof selectedReasoningEffort;
    intelligenceModes: typeof selectedIntelligenceModes;
  } | null>(null);
  const model = activeAnswerIntelligence?.model ?? selectedModel;
  const reasoningEffort =
    activeAnswerIntelligence?.reasoningEffort ?? selectedReasoningEffort;
  const intelligenceModes =
    activeAnswerIntelligence?.intelligenceModes ?? selectedIntelligenceModes;
  const { models } = useAssistantModels({ eager: true });
  const [history, setHistory] = useState<RuntimeHistorySession[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  // Destructive questions are asked in the app's own sheet rather than the
  // shell's dialog; `confirmDialog` is rendered at the foot of the dock.
  const { confirm, confirmDialog } = useConfirmDialog();
  // Chats whose run finished while the user was somewhere else. Restored from
  // localStorage in an effect rather than in the initial state, so the first
  // render matches the server's.
  const [unreadChats, setUnreadChats] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
  // Activity as of the previous refresh. The dot is raised on the edge from
  // running to finished, so a list that arrives already-finished — a reload,
  // a first paint — marks nothing.
  const chatActivity = useRef<ReadonlyMap<string, boolean>>(new Map());
  const unreadRestored = useRef(false);
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
  const [sidePanel, setSidePanel] = useState<TerminalPanel | null>(
    initialPanel,
  );
  const [productPanel, setProductPanel] = useState<ProductPanelSelection | null>(
    null,
  );
  const handleGenerativeUiAction = useCallback(
    (action: GenerativeUiAction) => {
      const product = productForAction(action);
      if (!product) return;

      if (action.type === "product.find-similar") {
        setInput(`Find products similar to ${product.title} from ${product.merchant}.`);
        setProductPanel(null);
        window.setTimeout(() => composerTextareaRef.current?.focus(), 0);
        return;
      }
      if (action.type === "product.visit") {
        const url = safeProductUrl(product.url);
        if (!url) return;
        const link = document.createElement("a");
        link.href = url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.click();
        return;
      }

      setSidePanel(null);
      setProductPanel((current) => {
        if (action.type === "product.open-details") {
          return {
            resource: action.resource,
            productId: action.productId,
            compareProductIds: [],
          };
        }
        const prior = current?.resource.id === action.resource.id
          ? current.compareProductIds
          : [];
        const compareProductIds = prior.includes(action.productId)
          ? prior.filter((id) => id !== action.productId)
          : [...prior, action.productId].slice(-4);
        return {
          resource: action.resource,
          productId: action.productId,
          compareProductIds,
        };
      });
    },
    [composerTextareaRef],
  );
  // The lane an opened artifact fills, beside the transcript and inside the
  // dock. Held in state rather than a ref so the viewers below re-render once
  // it exists and can portal into it.
  const [artifactLane, setArtifactLane] = useState<HTMLDivElement | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  // Linking a phone (WhatsApp, Telegram) lives in Settings → Messaging, reached
  // from the Intelligence menu. It is a once-a-year setup task, not a control
  // that earned permanent space in the chat bar.
  const [browserAgent, setBrowserAgent] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [agentBrowserAgent, setAgentBrowserAgent] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [openPlanterAgent, setOpenPlanterAgent] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [agentReachAgent, setAgentReachAgent] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [getDocAgent, setGetDocAgent] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [meetingNotesAgent, setMeetingNotesAgent] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [deepTutorAgent, setDeepTutorAgent] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [careerOpsAgent, setCareerOpsAgent] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [openExecutiveAgent, setOpenExecutiveAgent] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [tradingAgentsAgent, setTradingAgentsAgent] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [vibeTradingAgent, setVibeTradingAgent] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [stockAnalystAgent, setStockAnalystAgent] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [deerFlowAgent, setDeerFlowAgent] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [shortsAgent, setShortsAgent] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [launchingShortsRun, setLaunchingShortsRun] = useState(false);
  const [formsmithAgent, setFormsmithAgent] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [launchingFormsmithRun, setLaunchingFormsmithRun] = useState(false);
  const [launchingVideoUseRun, setLaunchingVideoUseRun] = useState(false);
  // A typed or pasted /agents:shorts command pre-fills the request form rather
  // than running, for the same reason Trading Agent's does.
  const [shortsSeed, setShortsSeed] = useState<Partial<ShortsRequest> | null>(
    null,
  );
  const [launchingBrowserRun, setLaunchingBrowserRun] = useState(false);
  const [launchingOpenPlanterRun, setLaunchingOpenPlanterRun] = useState(false);
  const [launchingAgentReachRun, setLaunchingAgentReachRun] = useState(false);
  const [launchingGetDocRun, setLaunchingGetDocRun] = useState(false);
  const [launchingMeetingNotesRun, setLaunchingMeetingNotesRun] =
    useState(false);
  const [launchingDeepTutorRun, setLaunchingDeepTutorRun] = useState(false);
  const [launchingCareerOpsRun, setLaunchingCareerOpsRun] = useState(false);
  const [launchingOpenExecutiveRun, setLaunchingOpenExecutiveRun] = useState(false);
  const [launchingOpenGymRun, setLaunchingOpenGymRun] = useState(false);
  const [launchingTradingAgentsRun, setLaunchingTradingAgentsRun] =
    useState(false);
  const [launchingVibeTradingRun, setLaunchingVibeTradingRun] = useState(false);
  const [launchingStockAnalystRun, setLaunchingStockAnalystRun] =
    useState(false);
  const [launchingDeerFlowRun, setLaunchingDeerFlowRun] = useState(false);
  // A typed or pasted /agents:trading-agent command pre-fills the request form
  // rather than running: whatever it carries is a starting point, and anything
  // unrecognised in it is dropped instead of being forwarded as a prompt.
  const [tradingAgentsSeed, setTradingAgentsSeed] =
    useState<Partial<TradingAgentsRequest> | null>(null);
  const [launchingSocialsManagerRun, setLaunchingSocialsManagerRun] =
    useState(false);
  const [launchingHardwareRun, setLaunchingHardwareRun] = useState(false);
  const [launchingVimaxRun, setLaunchingVimaxRun] = useState(false);
  const [launchingVoxDirectorRun, setLaunchingVoxDirectorRun] = useState(false);
  const [launchingMoneyPrinterRun, setLaunchingMoneyPrinterRun] =
    useState(false);
  const [launchingLegalRun, setLaunchingLegalRun] = useState(false);
  const [launchingWardrobeRun, setLaunchingWardrobeRun] = useState(false);
  const [launchingCadRun, setLaunchingCadRun] = useState(false);
  const [launchingHyperframesRun, setLaunchingHyperframesRun] = useState(false);
  const [launchingResource2SkillRun, setLaunchingResource2SkillRun] =
    useState(false);
  const [launchingMatraixRun, setLaunchingMatraixRun] = useState(false);
  const [launchingBoltSlidesRun, setLaunchingBoltSlidesRun] = useState(false);
  const [launchingClassroomRun, setLaunchingClassroomRun] = useState(false);
  const [launchingGodsEyeRun, setLaunchingGodsEyeRun] = useState(false);
  const [launchingOpenMontageRun, setLaunchingOpenMontageRun] = useState(false);
  const [launchingOpenworkRun, setLaunchingOpenworkRun] = useState(false);
  const [launchingOpenscienceRun, setLaunchingOpenscienceRun] = useState(false);
  const [launchingPraxistRun, setLaunchingPraxistRun] = useState(false);
  const [launchingMaxResearchRun, setLaunchingMaxResearchRun] = useState(false);
  const [launchingInboxZeroRun, setLaunchingInboxZeroRun] = useState(false);
  // Covers the hand-off before an individual launcher raises its own flag
  // (health checks and agent selection can take seconds).
  const [delegatedAgentLaunching, setDelegatedAgentLaunching] = useState(false);
  const deepResearchDispatchingRef = useRef(false);
  const socialsManagerDispatchingRef = useRef(false);
  const hardwareDispatchingRef = useRef(false);
  const openGymDispatchingRef = useRef(false);
  const openGymRoutingRef = useRef(false);
  const cadDispatchingRef = useRef(false);
  const hyperframesDispatchingRef = useRef(false);
  const resource2SkillDispatchingRef = useRef(false);
  const matraixDispatchingRef = useRef(false);
  const boltSlidesDispatchingRef = useRef(false);
  const classroomDispatchingRef = useRef(false);
  const godsEyeDispatchingRef = useRef(false);
  const openMontageDispatchingRef = useRef(false);
  const openworkDispatchingRef = useRef(false);
  const openscienceDispatchingRef = useRef(false);
  const praxistDispatchingRef = useRef(false);
  const maxResearchDispatchingRef = useRef(false);
  const inboxZeroDispatchingRef = useRef(false);
  const vimaxDispatchingRef = useRef(false);
  const voxDirectorDispatchingRef = useRef(false);
  const moneyPrinterDispatchingRef = useRef(false);
  const legalDispatchingRef = useRef(false);
  const wardrobeDispatchingRef = useRef(false);
  const attachmentInputRef = useRef<HTMLInputElement>(null);

  const isOpen = height > COLLAPSED_HEIGHT + 8;

  // The height is state, so a toggle would otherwise land in a single frame.
  // `glide` holds the direction of a click-driven change for as long as its
  // animation lasts, and it does two jobs: it puts the transition on the dock,
  // and while closing it keeps the body rendered, so the dock carries the
  // transcript down with it instead of shrinking an emptied surface.
  //
  // What the animation moves is a translation, never the height. This is the
  // most expensive box on the page — rail, transcript, composer — and the page
  // behind it watches this element with a ResizeObserver to keep scrollable
  // room under it. Animating the height relaid out the whole terminal and the
  // whole page beneath it on every frame, which is what made the dock stutter
  // open. A dock already at its final size, merely pushed down, costs the
  // compositor one translation and the main thread nothing.
  const [glide, setGlide] = useState<"opening" | "closing" | null>(null);
  // The size the box holds for the length of a glide: the open height in both
  // directions, because a closing dock is still full until the moment it shuts.
  const [glideBox, setGlideBox] = useState<number | null>(null);
  // How far below that box the dock currently sits, and whether that distance
  // is being animated — the opening frame has to land unanimated, or there is
  // no start point for the transition to run from.
  const [glideShift, setGlideShift] = useState(0);
  const [glideMoving, setGlideMoving] = useState(false);
  const glideTimer = useRef<number | null>(null);
  const glideRaf = useRef<number | null>(null);
  const headerClickGuard = useTerminalHeaderClickGuard();
  // Set while a press on the collapsed bar has already built the opening
  // glide's first frame, before the release that asks for it. See prewarmOpen.
  const prewarmRef = useRef(false);
  const bodyMounted = isOpen || glide === "closing";
  // The body is in the DOM slightly wider than the dock counts as open: a
  // prewarming press mounts it while the finger is still down, so the release
  // has nothing left to build and can start moving on its next frame.
  const bodyRendered = bodyMounted || glide === "opening";

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
      // The controls conceal without an exit stagger and finish just before
      // the dock settles, so no hidden header work trails the close.
      headerCloseTimer.current = window.setTimeout(() => {
        headerMountedRef.current = false;
        setHeaderMounted(false);
        setHeaderClosing(false);
        headerCloseTimer.current = null;
      }, DOCK_CLOSE_MS);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !focusComposerAfterOpenRef.current) return;
    const frame = window.requestAnimationFrame(() => {
      if (!focusComposerAfterOpenRef.current) return;
      focusComposerAfterOpenRef.current = false;
      composerTextareaRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [isOpen]);

  useEffect(
    () => () => {
      if (headerCloseTimer.current !== null) {
        window.clearTimeout(headerCloseTimer.current);
      }
      if (glideTimer.current !== null) {
        window.clearTimeout(glideTimer.current);
      }
      if (glideRaf.current !== null) {
        window.cancelAnimationFrame(glideRaf.current);
      }
    },
    [],
  );

  // Temporary chat. While this is on, every chat started here is off the
  // record: kept out of history and search, given none of the memory the
  // assistant has about the person, and unable to leave any behind. It is a
  // property of the conversation, fixed when that conversation is created, so
  // turning it on or off always means starting a different chat rather than
  // changing the one on screen — the same bargain ChatGPT's toggle makes.
  const [temporaryChat, setTemporaryChat] = useState(false);
  // What a blank chat says, and the four openers under it. Both are drawn from
  // pools that step forward on the hour and narrow to what the reader has been
  // doing, so this is the only thing the empty state needs from up here.
  const chatGreeting = useChatGreeting({ scope, temporary: temporaryChat });
  // The chat to come back to when the reader leaves temporary mode, so the
  // toggle behaves like a detour rather than a reset.
  const chatBeforeTemporary = useRef<string | null>(null);
  // The terminal always comes up on a blank chat rather than reopening the one
  // it was last left in. A conversation with a turn still running is not lost
  // by this: the run belongs to the server-side pump, and opening the chat from
  // history reattaches to it mid-flight.
  const sessionCreateOptions = useMemo(
    () => ({
      title: "New chat",
      temporary: temporaryChat,
      restoreLastConversation: false,
    }),
    [temporaryChat],
  );
  const session = useAgentSession("dashboard_terminal", sessionCreateOptions);
  useEffect(() => {
    if (session.sessionId || session.messages.length > 0) {
      onConversationEngaged();
    }
  }, [onConversationEngaged, session.messages.length, session.sessionId]);
  const openTerminalSession = session.openSession;
  // A fresh app window intentionally starts on New chat, but a renderer reload
  // is not a new visit. Keep the selected conversation in sessionStorage so a
  // dev-server refresh or desktop renderer recovery reattaches the transcript
  // and any live run instead of replacing them with the blank state. New chat
  // clears this pointer below, and closing the window clears it naturally.
  useEffect(() => {
    if (activeChatRestoreStartedRef.current) return;
    activeChatRestoreStartedRef.current = true;
    const savedSessionId = readActiveTerminalChatId(restoreOwnerKey);
    activeChatPersistenceReadyRef.current = true;
    if (savedSessionId?.startsWith("conv_")) {
      void openTerminalSession(
        savedSessionId,
        readActiveTerminalChatSnapshot(restoreOwnerKey, savedSessionId),
      );
    }
  }, [openTerminalSession, restoreOwnerKey]);

  useEffect(() => {
    const requested = initialChatId?.trim() ?? "";
    if (
      !requested.startsWith("conv_") ||
      openedNotificationChatRef.current === requested
    ) {
      return;
    }
    openedNotificationChatRef.current = requested;
    setHeight(openHeight(preferredOpenHeightRef.current));
    openHistorySession(requested);
    // The deep link changes only when a notification chooses another chat.
    // Depending on this component-local function would reopen on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialChatId]);

  // A notice on this page asks for its chat without a navigation. The opener
  // is read through a ref so the listener is registered once and still calls
  // the current render's functions.
  const openNotificationChatRef = useRef<(chatId: string) => void>(() => undefined);
  openNotificationChatRef.current = (chatId: string) => {
    openedNotificationChatRef.current = chatId;
    setHeight(openHeight(preferredOpenHeightRef.current));
    openHistorySession(chatId);
  };
  useEffect(() => {
    const listener = (raw: Event) => {
      const target = (raw as CustomEvent<ChatNotificationTarget>).detail;
      if (target?.surface !== "dashboard_terminal") return;
      const chatId = target.chatId?.trim() ?? "";
      if (!chatId.startsWith("conv_")) return;
      openNotificationChatRef.current(chatId);
    };
    window.addEventListener(CHAT_NOTIFICATION_OPEN_REQUEST_EVENT, listener);
    return () =>
      window.removeEventListener(CHAT_NOTIFICATION_OPEN_REQUEST_EVENT, listener);
  }, []);

  useEffect(() => {
    // The hook begins in a loading state. Waiting for it prevents the initial
    // null session from erasing the id that the restore effect just read.
    if (
      !activeChatPersistenceReadyRef.current ||
      session.loadingSession
    ) {
      return;
    }
    if (temporaryChat || !session.sessionId) {
      window.sessionStorage.removeItem(ACTIVE_CHAT_KEY);
      window.sessionStorage.removeItem(ACTIVE_CHAT_SNAPSHOT_KEY);
      return;
    }
    window.sessionStorage.setItem(
      ACTIVE_CHAT_KEY,
      JSON.stringify({ ownerKey: restoreOwnerKey, sessionId: session.sessionId }),
    );
  }, [restoreOwnerKey, session.loadingSession, session.sessionId, temporaryChat]);

  useEffect(() => {
    if (
      !activeChatPersistenceReadyRef.current ||
      temporaryChat ||
      session.loadingSession ||
      !session.sessionId ||
      session.messages.length === 0
    ) {
      return;
    }
    const persist = () => {
      writeActiveTerminalChatSnapshot(
        restoreOwnerKey,
        session.sessionId!,
        session.messages,
      );
    };
    const timer = window.setTimeout(persist, 150);
    // A real renderer navigation may happen before the debounce lands. Capture
    // the latest visible rows synchronously while the old page still exists.
    window.addEventListener("pagehide", persist);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pagehide", persist);
    };
  }, [
    session.loadingSession,
    session.messages,
    session.sessionId,
    restoreOwnerKey,
    temporaryChat,
  ]);
  useLayoutEffect(() => {
    activeChatSnapshotRef.current =
      activeChatPersistenceReadyRef.current &&
      !temporaryChat &&
      !session.loadingSession &&
      session.sessionId &&
      session.messages.length > 0
        ? {
            ownerKey: restoreOwnerKey,
            sessionId: session.sessionId,
            messages: session.messages,
          }
        : null;
  }, [restoreOwnerKey, session.loadingSession, session.messages, session.sessionId, temporaryChat]);
  useEffect(
    () => () => {
      // Client-side route changes unmount the terminal without firing
      // `pagehide`. Persist the last committed rows synchronously, especially
      // for the first 150 ms after Send when the debounce has not landed.
      const snapshot = activeChatSnapshotRef.current;
      if (snapshot?.ownerKey === restoreOwnerKey) {
        writeActiveTerminalChatSnapshot(
          snapshot.ownerKey,
          snapshot.sessionId,
          snapshot.messages,
        );
      }
    },
    [restoreOwnerKey],
  );
  // A half-written message survives a reload, and stays with the chat it was
  // written in. A temporary chat is excluded: it keeps no record anywhere else,
  // so it may not leave one here either.
  useChatDraft({
    surface: "dashboard_terminal",
    sessionId: session.sessionId,
    createdSessionId: session.createdSessionId,
    value: input || submittedDraft || "",
    onRestore: setInput,
    enabled: !temporaryChat,
  });
  const runWorkflowAutomation = useWorkflowAutomation(session);
  const deepResearch = useDeepResearchAgent(
    session,
    setAttachmentStatus,
    model,
  );
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
    launchingOpenExecutiveRun ||
    launchingOpenGymRun ||
    launchingTradingAgentsRun ||
    launchingVibeTradingRun ||
    launchingStockAnalystRun ||
    launchingDeerFlowRun ||
    launchingShortsRun ||
    launchingFormsmithRun ||
    launchingVideoUseRun ||
    launchingSocialsManagerRun ||
    launchingHardwareRun ||
    launchingVimaxRun ||
    launchingVoxDirectorRun ||
    launchingMoneyPrinterRun ||
    launchingLegalRun ||
    launchingWardrobeRun ||
    launchingCadRun ||
    launchingHyperframesRun ||
    launchingResource2SkillRun ||
    launchingMatraixRun ||
    launchingBoltSlidesRun ||
    launchingClassroomRun ||
    launchingGodsEyeRun ||
    launchingOpenMontageRun ||
    launchingOpenworkRun ||
    launchingOpenscienceRun ||
    launchingPraxistRun ||
    launchingMaxResearchRun ||
    launchingInboxZeroRun ||
    deepResearch.launching ||
    codex.launching ||
    openCode.launching ||
    ruflo.launching;
  const currentChatActive =
    Boolean(session.activeRunId) ||
    busy ||
    externalRunLaunching ||
    chatSessionIsActive(null, session.messages);
  const newChatPageSelected =
    session.sessionId === null &&
    session.messages.length === 0 &&
    !currentChatActive;
  const blankSavedChatSelected =
    !temporaryChat &&
    session.sessionId === null &&
    session.messages.length === 0 &&
    !currentChatActive;
  const isPublic = scope === "public";
  const sendNotificationReply = session.send;

  useEffect(() => {
    if (
      currentChatActive ||
      session.loadingSession ||
      !session.sessionId
    ) {
      return;
    }
    const reply = takeChatNotificationReply(window.sessionStorage, {
      surface: "dashboard_terminal",
      chatId: session.sessionId,
    });
    if (reply) void sendNotificationReply(reply);
  }, [
    currentChatActive,
    sendNotificationReply,
    session.loadingSession,
    session.sessionId,
  ]);

  useLayoutEffect(() => {
    if (!currentChatActive) setActiveAnswerIntelligence(null);
  }, [currentChatActive]);

  const changeModel = useCallback(
    (nextModel: string) => {
      if (nextModel === selectedModel) return;
      if (currentChatActive) {
        setActiveAnswerIntelligence((current) =>
          current ?? { model, reasoningEffort, intelligenceModes },
        );
      }
      void session.queueModelChange(nextModel).catch(() => undefined);
      setSelectedModel(nextModel);
    },
    [
      currentChatActive,
      intelligenceModes,
      model,
      reasoningEffort,
      selectedModel,
      session,
      setSelectedModel,
    ],
  );

  const refreshTerminal = useCallback(async () => {
    if (runtimeOnline || refreshingTerminal) return;
    setRefreshingTerminal(true);
    try {
      const runtimeReady = await onRefreshRuntime();
      if (!runtimeReady) return;
      if (session.sessionId) {
        await session.openSession(session.sessionId, session.messages);
      } else {
        session.reset();
      }
    } finally {
      setRefreshingTerminal(false);
    }
  }, [onRefreshRuntime, refreshingTerminal, runtimeOnline, session]);

  useEffect(() => {
    const apply = ({ artifact, prompt }: ArtifactAiEditDetail) => {
      if (
        !artifact?.id ||
        !artifactAiEditMatchesScope(artifact, { surface: "dashboard_terminal" })
      )
        return;
      setSidePanel((current) => (current === "artifacts" ? null : current));
      setInput(
        `${interactiveVisualizerCommandForArtifact(artifact)}${prompt}`,
      );
    };
    const listener = (raw: Event) => apply((raw as CustomEvent<ArtifactAiEditDetail>).detail);
    const queued = consumeArtifactAiEdit({ surface: "dashboard_terminal" });
    const timer = queued ? window.setTimeout(() => apply(queued), 0) : null;
    window.addEventListener(ARTIFACT_AI_EDIT_EVENT, listener);
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      window.removeEventListener(ARTIFACT_AI_EDIT_EVENT, listener);
    };
  }, []);

  useEffect(() => {
    const onResize = () =>
      setHeight((current) => settleHeight(clampHeight(current)));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (height < minOpenHeight()) return;
    const preferredHeight = clampHeight(height);
    preferredOpenHeightRef.current = preferredHeight;
    window.localStorage.setItem(HEIGHT_KEY, String(preferredHeight));
  }, [height]);

  useEffect(() => {
    // The initial collapsed React state is only a hydration-safe placeholder.
    // Do not let that first commit overwrite an open state that the mount
    // effect above is in the process of restoring.
    if (!openStatePersistenceReadyRef.current) {
      openStatePersistenceReadyRef.current = true;
      return;
    }
    window.sessionStorage.setItem(
      OPEN_STATE_KEY,
      height > COLLAPSED_HEIGHT + 8 ? "true" : "false",
    );
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

      const scrollbarWidth =
        window.innerWidth - document.documentElement.clientWidth;
      body.style.overflow = "hidden";
      if (scrollbarWidth > 0) body.style.paddingRight = `${scrollbarWidth}px`;
    };

    sync();
    window.addEventListener("resize", sync);
    // The threshold is measured against the navbar, and the navbar rides the
    // page, so scrolling changes the answer — including the ride to the top
    // that opening the dock sets off. Without this the lock would be decided
    // from where the page stood when the dock opened and never revisited.
    // Collapsed the threshold cannot be met at any scroll position, so the
    // listener is only worth its layout read while the dock is open.
    const watchesScroll = height > COLLAPSED_HEIGHT + 8;
    if (watchesScroll)
      window.addEventListener("scroll", sync, { passive: true });
    return () => {
      window.removeEventListener("resize", sync);
      if (watchesScroll) window.removeEventListener("scroll", sync);
      body.style.overflow = previousOverflow;
      body.style.paddingRight = previousPaddingRight;
    };
  }, [height]);

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    let refreshQueued = false;
    const historyController = new AbortController();
    const refreshHistory = (force = false): void => {
      if (inFlight) {
        // A title can finish while the creation refresh is still in flight.
        // Remember that invalidation so "New chat" cannot survive merely
        // because its generated title arrived one request too early.
        if (force) refreshQueued = true;
        return;
      }
      if (document.visibilityState === "hidden") return;
      inFlight = true;
      const epoch = historyEpoch.current;
      void loadHermesSessionSummaries("dashboard_terminal", {
        force,
        signal: historyController.signal,
      })
        .then((sessions) => {
          if (cancelled || historyEpoch.current !== epoch) return;
          // A list that lands clears the note a previous miss left behind.
          setHistoryError((current) =>
            current === HISTORY_REFRESH_FAILED ? null : current,
          );
          setHistory(
            sessions
              .filter(
                (item): item is HermesSessionSnapshot & { id: string } =>
                  typeof item.id === "string" && item.id.startsWith("conv_"),
              )
              .map((item) => {
                return {
                  id: item.id,
                  title:
                    typeof item.title === "string" ? item.title : "New chat",
                  updatedAt:
                    typeof item.updatedAt === "string" ? item.updatedAt : "",
                  active:
                    Boolean(item.activeRun) ||
                    item.externalAgentActive === true,
                  pinned: item.pinned === true,
                  // The server already rejected anything outside the palette.
                  highlight:
                    typeof item.highlight === "string" ? item.highlight : null,
                };
              }),
          );
        })
        .catch(() => {
          // A refresh that does not land says nothing about which chats exist.
          // Swallowing it left `history` at its empty initial value, and the
          // rail renders an empty list as "No chats yet" — so one failed poll
          // erased every conversation from view and left the reader on what
          // looked like a fresh terminal. The chats are in the local database
          // and are still there; keep showing the last list that did land and
          // let the ten-second poll repair it.
          if (cancelled || historyEpoch.current !== epoch) return;
          setHistoryError(HISTORY_REFRESH_FAILED);
        })
        .finally(() => {
          inFlight = false;
          if (!cancelled) setHistoryLoading(false);
          if (refreshQueued && !cancelled) {
            refreshQueued = false;
            refreshHistory(true);
          }
        });
    };
    setHistoryLoading(true);
    refreshHistory();
    const timer = window.setInterval(() => refreshHistory(true), 10_000);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") refreshHistory(true);
    };
    const onSessionsChanged = (event: Event) => {
      const changedSurface = (event as CustomEvent<{ surface?: string }>).detail
        ?.surface;
      if (changedSurface === "dashboard_terminal") refreshHistory(true);
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener(HERMES_SESSIONS_CHANGED_EVENT, onSessionsChanged);
    return () => {
      cancelled = true;
      historyController.abort();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener(
        HERMES_SESSIONS_CHANGED_EVENT,
        onSessionsChanged,
      );
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

  // A chat counts as read only while the dock is actually showing it. An answer
  // that lands in the open chat while the terminal is collapsed is as unseen as
  // one that lands in a chat the user walked away from.
  const viewingChatId = bodyMounted ? session.sessionId : null;

  useEffect(() => {
    setActiveChatNotificationTarget(
      viewingChatId
        ? { surface: "dashboard_terminal", chatId: viewingChatId }
        : null,
    );
    return () => setActiveChatNotificationTarget(null);
  }, [viewingChatId]);

  useEffect(() => {
    setUnreadChats(readUnreadChats(window.localStorage));
  }, []);

  // One pass per refresh of the rail: raise the dot on every chat that stopped
  // running out of sight, and take it off the one being read. The previous
  // activity map is read before it is replaced — a state updater runs during
  // the next render, by which time the ref would already hold this snapshot.
  useEffect(() => {
    const previousActive = chatActivity.current;
    chatActivity.current = chatActivityById(history);
    setUnreadChats((current) => {
      const next = nextUnreadChats({
        unread: current,
        previousActive,
        chats: history,
        viewingChatId,
      });
      return sameChatIds(current, next) ? current : next;
    });
  }, [history, viewingChatId]);

  useEffect(() => {
    if (!unreadRestored.current) {
      // The first commit carries the empty starting value rather than anything
      // that happened, and the restore above has not landed yet: writing it
      // would erase the dots this browser was still holding.
      unreadRestored.current = true;
      return;
    }
    writeUnreadChats(window.localStorage, unreadChats);
  }, [unreadChats]);

  // Deleting a chat takes its dot with it. The pass above cannot be relied on
  // for this: it deliberately leaves the set alone when the list arrives empty,
  // which is exactly what deleting the last chat produces.
  const forgetUnreadChats = useCallback((ids: Iterable<string>) => {
    setUnreadChats((current) => {
      const next = new Set(current);
      for (const id of ids) next.delete(id);
      return sameChatIds(current, next) ? current : next;
    });
  }, []);

  // Selecting Agent TARS resolves the browser-operator agent to run against.
  // The runtime, workspace, and secrets stay server-side; we only need its id.
  const selectBrowserAgent = useCallback(async () => {
    setAttachmentStatus("");
    try {
      const response = await fetch("/api/ui-tars/agents");
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof data?.error === "string"
            ? data.error
            : "Agent TARS is unavailable.",
        );
      }
      const agents = Array.isArray(data?.agents) ? data.agents : [];
      const pick =
        agents.find(
          (agent: { runtimeState?: string }) =>
            agent.runtimeState === "available",
        ) ??
        agents.find((agent: { isDefault?: boolean }) => agent.isDefault) ??
        agents[0];
      if (!pick?.id) throw new Error("No Agent TARS agent is configured.");
      const selected = {
        id: String(pick.id),
        name: String(pick.name ?? "Agent TARS"),
      };
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
      setAttachmentStatus(
        cause instanceof Error ? cause.message : "Agent TARS is unavailable.",
      );
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
      const runtimeRequestId = crypto.randomUUID();
      let clientMessageId = crypto.randomUUID();
      const userMessage: AgentMessage = {
        id: clientMessageId,
        role: "user",
        content: agentTarsUserMessage(task),
      };
      const userContent = userMessage.content;
      clientMessageId = session.previewExternalAgentTurn({
        clientMessageId,
        userContent,
      });
      let runStarted = false;
      try {
        const response = await fetch(
          `/api/ui-tars/agents/${selectedAgent.id}/runs`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ task, requestId: runtimeRequestId }),
          },
        );
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data?.run?.id) {
          throw new Error(
            typeof data?.error === "string"
              ? data.error
              : "The Agent TARS run could not start.",
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
        throw new Error(
          typeof data?.error === "string"
            ? data.error
            : "Agent Browser is unavailable.",
        );
      }
      const agents = Array.isArray(data?.agents) ? data.agents : [];
      const pick =
        agents.find(
          (agent: { runtimeState?: string }) =>
            agent.runtimeState === "available",
        ) ??
        agents.find((agent: { isDefault?: boolean }) => agent.isDefault) ??
        agents[0];
      if (!pick?.id) throw new Error("No Agent Browser agent is configured.");
      const selected = {
        id: String(pick.id),
        name: String(pick.name ?? "Agent Browser"),
      };
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
      setAttachmentStatus(
        cause instanceof Error
          ? cause.message
          : "Agent Browser is unavailable.",
      );
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
      clientMessageId = session.previewExternalAgentTurn({
        clientMessageId,
        userContent,
      });
      let runStarted = false;
      try {
        const response = await fetch(
          `/api/agent-browser/agents/${selectedAgent.id}/runs`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ task }),
          },
        );
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data?.run?.runId) {
          throw new Error(agentBrowserStartFailure(data?.error));
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
      const selected = {
        id: OPENPLANTER_AGENT_ID,
        name: OPENPLANTER_AGENT_NAME,
      };
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
      setAttachmentStatus(
        cause instanceof Error ? cause.message : "OpenPlanter is unavailable.",
      );
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
      const selected = {
        id: AGENT_REACH_AGENT_ID,
        name: AGENT_REACH_AGENT_NAME,
      };
      setBrowserAgent(null);
      setAgentBrowserAgent(null);
      setOpenPlanterAgent(null);
      clearDeepResearch();
      clearCodex();
      clearOpenCode();
      clearRuflo();
      setAgentReachAgent(selected);
      const live = Array.isArray(data.channels)
        ? data.channels.filter(
            (channel: { status?: string }) => channel.status === "ok",
          ).length
        : 0;
      if (!live) {
        setAttachmentStatus(
          "Agent Reach selected, but no platform reported itself as reachable. Run `agent-reach doctor` to see what needs setup.",
        );
      }
      return selected;
    } catch (cause) {
      setAttachmentStatus(
        cause instanceof Error ? cause.message : "Agent Reach is unavailable.",
      );
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
      const selected = {
        id: MEETING_NOTES_AGENT_ID,
        name: MEETING_NOTES_AGENT_NAME,
      };
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
        cause instanceof Error
          ? cause.message
          : "Meeting Notes is unavailable.",
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
      setAttachmentStatus(
        cause instanceof Error ? cause.message : "Get Doc is unavailable.",
      );
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
      const scope = data.scope as
        { rootCount?: number; label?: string } | undefined;
      if (!scope?.rootCount) {
        setAttachmentStatus(
          "Deep Tutor selected, but there are no files in scope here — it will answer from the conversation alone.",
        );
      }
      return selected;
    } catch (cause) {
      setAttachmentStatus(
        cause instanceof Error ? cause.message : "Deep Tutor is unavailable.",
      );
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
      setAttachmentStatus(
        cause instanceof Error ? cause.message : "Career Ops is unavailable.",
      );
      return null;
    }
  }, [clearCodex, clearDeepResearch, clearOpenCode, clearRuflo]);

  /** Select the cloned executive-team runtime and surface setup status early. */
  const selectOpenExecutive = useCallback(async () => {
    setAttachmentStatus("");
    try {
      const response = await fetch("/api/openexecutive/health");
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.cloned !== true) {
        throw new Error(
          typeof data?.reason === "string"
            ? data.reason
            : typeof data?.error === "string"
              ? data.error
              : "OpenExecutive is unavailable.",
        );
      }
      const selected = {
        id: OPENEXECUTIVE_AGENT_ID,
        name: OPENEXECUTIVE_AGENT_NAME,
      };
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
      setOpenExecutiveAgent(selected);
      if (data.available !== true && typeof data.reason === "string") {
        setAttachmentStatus(data.reason);
      }
      return selected;
    } catch (cause) {
      setAttachmentStatus(
        cause instanceof Error ? cause.message : "OpenExecutive is unavailable.",
      );
      return null;
    }
  }, [clearCodex, clearDeepResearch, clearOpenCode, clearRuflo]);

  // Older selectors already exclude one another; this folds OpenExecutive into
  // that contract without changing each established selector independently.
  useEffect(() => {
    if (!openExecutiveAgent) return;
    if (
      browserAgent ||
      agentBrowserAgent ||
      openPlanterAgent ||
      agentReachAgent ||
      getDocAgent ||
      meetingNotesAgent ||
      deepTutorAgent ||
      careerOpsAgent ||
      tradingAgentsAgent ||
      vibeTradingAgent ||
      stockAnalystAgent ||
      deerFlowAgent ||
      shortsAgent ||
      formsmithAgent ||
      deepResearch.agent ||
      codex.agent ||
      openCode.agent ||
      ruflo.agent
    ) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOpenExecutiveAgent(null);
    }
  }, [
    agentBrowserAgent,
    agentReachAgent,
    browserAgent,
    careerOpsAgent,
    codex.agent,
    deepResearch.agent,
    deepTutorAgent,
    deerFlowAgent,
    formsmithAgent,
    getDocAgent,
    meetingNotesAgent,
    openCode.agent,
    openExecutiveAgent,
    openPlanterAgent,
    ruflo.agent,
    shortsAgent,
    stockAnalystAgent,
    tradingAgentsAgent,
    vibeTradingAgent,
  ]);

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
      const selected = {
        id: TRADINGAGENTS_AGENT_ID,
        name: TRADINGAGENTS_AGENT_NAME,
      };
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
      setAttachmentStatus(
        cause instanceof Error
          ? cause.message
          : "Trading Agent is unavailable.",
      );
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
      setAttachmentStatus(
        cause instanceof Error ? cause.message : "Shorts is unavailable.",
      );
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
      setAttachmentStatus(
        cause instanceof Error ? cause.message : "Formsmith is unavailable.",
      );
      return null;
    }
  }, [clearCodex, clearDeepResearch, clearOpenCode, clearRuflo]);

  // Other selectors predate Formsmith and already clear one another. This one
  // guard folds the new selection into that existing mutual-exclusion contract.
  useEffect(() => {
    if (!formsmithAgent) return;
    if (
      browserAgent ||
      agentBrowserAgent ||
      openPlanterAgent ||
      agentReachAgent ||
      getDocAgent ||
      meetingNotesAgent ||
      deepTutorAgent ||
      careerOpsAgent ||
      tradingAgentsAgent ||
      vibeTradingAgent ||
      deerFlowAgent ||
      shortsAgent ||
      deepResearch.agent ||
      codex.agent ||
      openCode.agent ||
      ruflo.agent
    ) {
      // This synchronizes a newly added selector with the older selector states.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFormsmithAgent(null);
    }
  }, [
    agentBrowserAgent,
    agentReachAgent,
    browserAgent,
    careerOpsAgent,
    codex.agent,
    deepResearch.agent,
    deepTutorAgent,
    deerFlowAgent,
    formsmithAgent,
    getDocAgent,
    meetingNotesAgent,
    openCode.agent,
    openPlanterAgent,
    ruflo.agent,
    shortsAgent,
    tradingAgentsAgent,
    vibeTradingAgent,
  ]);

  /** Select Vibe Trading immediately; health only supplies advisory status. */
  const selectVibeTrading = useCallback(async () => {
    setAttachmentStatus("");
    const selected = {
      id: VIBE_TRADING_AGENT_ID,
      name: VIBE_TRADING_AGENT_NAME,
    };
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
    try {
      const response = await fetch("/api/vibe-trading/health");
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.cloned !== true) {
        setAttachmentStatus(
          typeof data?.reason === "string"
            ? data.reason
            : typeof data?.error === "string"
              ? data.error
              : "Vibe Trading is unavailable.",
        );
      } else if (data.available !== true && typeof data.reason === "string") {
        // Do not turn an observational health failure into a hidden agent. A
        // real run is what asks Runtime V2 to start the service.
        setAttachmentStatus(data.reason);
      } else if (data.serviceRunning !== true) {
        setAttachmentStatus(
          "Vibe Trading selected. Its service starts with the first run, which takes about a minute.",
        );
      }
      return selected;
    } catch (cause) {
      setAttachmentStatus(
        cause instanceof Error ? cause.message : "Vibe Trading is unavailable.",
      );
      return selected;
    }
  }, [clearCodex, clearDeepResearch, clearOpenCode, clearRuflo]);

  /** Select Stock Analyst immediately; health only supplies advisory status. */
  const selectStockAnalyst = useCallback(async () => {
    setAttachmentStatus("");
    const selected = {
      id: STOCK_ANALYST_AGENT_ID,
      name: STOCK_ANALYST_AGENT_NAME,
    };
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
    try {
      const response = await fetch("/api/stock-analyst/health");
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.cloned !== true) {
        setAttachmentStatus(
          typeof data?.reason === "string"
            ? data.reason
            : typeof data?.error === "string"
              ? data.error
              : "Stock Analyst is unavailable.",
        );
      } else if (data.available !== true && typeof data.reason === "string") {
        // Selection is independent of setup state; the run returns the exact
        // Runtime setup/resource failure if admission cannot proceed.
        setAttachmentStatus(data.reason);
      } else if (data.serviceRunning !== true) {
        setAttachmentStatus(
          "Stock Analyst selected. Its backend starts with the first question, which takes about a minute.",
        );
      }
      return selected;
    } catch (cause) {
      setAttachmentStatus(
        cause instanceof Error
          ? cause.message
          : "Stock Analyst is unavailable.",
      );
      return selected;
    }
  }, [clearCodex, clearDeepResearch, clearOpenCode, clearRuflo]);

  // Selectors added before Stock Analyst do not know its state, so fold it into
  // the same one-runtime-at-a-time contract here.
  useEffect(() => {
    if (!stockAnalystAgent) return;
    if (
      browserAgent ||
      agentBrowserAgent ||
      openPlanterAgent ||
      agentReachAgent ||
      getDocAgent ||
      meetingNotesAgent ||
      deepTutorAgent ||
      careerOpsAgent ||
      tradingAgentsAgent ||
      vibeTradingAgent ||
      deerFlowAgent ||
      shortsAgent ||
      formsmithAgent ||
      deepResearch.agent ||
      codex.agent ||
      openCode.agent ||
      ruflo.agent
    ) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStockAnalystAgent(null);
    }
  }, [
    agentBrowserAgent,
    agentReachAgent,
    browserAgent,
    careerOpsAgent,
    codex.agent,
    deepResearch.agent,
    deepTutorAgent,
    deerFlowAgent,
    formsmithAgent,
    getDocAgent,
    meetingNotesAgent,
    openCode.agent,
    openPlanterAgent,
    ruflo.agent,
    shortsAgent,
    stockAnalystAgent,
    tradingAgentsAgent,
    vibeTradingAgent,
  ]);

  /** Select DeerFlow immediately; health only supplies advisory status. */
  const selectDeerFlow = useCallback(async () => {
    setAttachmentStatus("");
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
    try {
      const response = await fetch("/api/deer-flow/health");
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.cloned !== true) {
        setAttachmentStatus(
          typeof data?.reason === "string"
            ? data.reason
            : typeof data?.error === "string"
              ? data.error
              : "DeerFlow is unavailable.",
        );
      } else if (data.available !== true && typeof data.reason === "string") {
        // Polling is status-only and never decides whether this mandatory
        // capability can remain selected.
        setAttachmentStatus(data.reason);
      } else if (data.serviceRunning !== true) {
        setAttachmentStatus(
          "DeerFlow selected. Its Gateway starts with the first run, which takes about a minute.",
        );
      }
      return selected;
    } catch (cause) {
      setAttachmentStatus(
        cause instanceof Error ? cause.message : "DeerFlow is unavailable.",
      );
      return selected;
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
      clientMessageId = session.previewExternalAgentTurn({
        clientMessageId,
        userContent,
      });
      let runStarted = false;
      try {
        // The run reads the chat it was launched from, so the conversation is
        // materialized before it starts. The call is idempotent and the turn
        // binds to the same conversation either way.
        const conversationPublicId =
          await session.ensureConversation(clientMessageId);
        const response = await fetch("/api/openplanter/runs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            task,
            model,
            reasoningEffort,
            conversationPublicId,
            clientMessageId,
          }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data?.run?.runId) {
          throw new Error(
            typeof data?.error === "string"
              ? data.error
              : "The OpenPlanter run could not start.",
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
    [
      launchingOpenPlanterRun,
      model,
      openPlanterAgent,
      reasoningEffort,
      session,
    ],
  );

  const launchAgentReachRun = useCallback(
    async (task: string, agentOverride?: { id: string; name: string }) => {
      const selectedAgent = agentOverride ?? agentReachAgent;
      if (!selectedAgent || launchingAgentReachRun) return;
      setLaunchingAgentReachRun(true);
      let clientMessageId = crypto.randomUUID();
      const userContent = agentReachUserMessage(task);
      clientMessageId = session.previewExternalAgentTurn({
        clientMessageId,
        userContent,
      });
      let runStarted = false;
      try {
        // The run reads the chat it was launched from, so the conversation is
        // materialized before it starts. The call is idempotent and the turn
        // binds to the same conversation either way.
        const conversationPublicId =
          await session.ensureConversation(clientMessageId);
        const response = await fetch("/api/agent-reach/runs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            task,
            model,
            reasoningEffort,
            conversationPublicId,
            clientMessageId,
          }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data?.run?.runId) {
          throw new Error(
            typeof data?.error === "string"
              ? data.error
              : "The Agent Reach run could not start.",
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
        const conversationPublicId =
          await session.ensureConversation(clientMessageId);
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
            typeof data?.error === "string"
              ? data.error
              : "The meeting notes could not start.",
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
        const assistantContent =
          "The meeting notes could not start: " +
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
    [
      chatAttachments,
      launchingMeetingNotesRun,
      meetingNotesAgent,
      model,
      reasoningEffort,
      session,
    ],
  );

  const launchGetDocRun = useCallback(
    async (task: string, agentOverride?: { id: string; name: string }) => {
      const selectedAgent = agentOverride ?? getDocAgent;
      if (!selectedAgent || launchingGetDocRun) return;
      setLaunchingGetDocRun(true);
      let clientMessageId = crypto.randomUUID();
      const userContent = getDocUserMessage(task);
      clientMessageId = session.previewExternalAgentTurn({
        clientMessageId,
        userContent,
      });
      let runStarted = false;
      try {
        // The run reads the chat it was launched from, so the conversation is
        // materialized before it starts. The call is idempotent and the turn
        // binds to the same conversation either way.
        const conversationPublicId =
          await session.ensureConversation(clientMessageId);
        const response = await fetch("/api/get-doc/runs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            task,
            model,
            reasoningEffort,
            conversationPublicId,
            clientMessageId,
          }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data?.run?.runId) {
          throw new Error(
            typeof data?.error === "string"
              ? data.error
              : "The document search could not start.",
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
      clientMessageId = session.previewExternalAgentTurn({
        clientMessageId,
        userContent,
      });
      let runStarted = false;
      try {
        // The run reads the chat it was launched from, so the conversation is
        // materialized before it starts. The call is idempotent and the turn
        // binds to the same conversation either way.
        const conversationPublicId =
          await session.ensureConversation(clientMessageId);
        const response = await fetch("/api/deep-tutor/runs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            task,
            model,
            reasoningEffort,
            conversationPublicId,
            clientMessageId,
          }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data?.run?.runId) {
          throw new Error(
            typeof data?.error === "string"
              ? data.error
              : "The tutoring turn could not start.",
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
      clientMessageId = session.previewExternalAgentTurn({
        clientMessageId,
        userContent,
      });
      let runStarted = false;
      try {
        // The run reads the chat it was launched from, so the conversation is
        // materialized before it starts. The call is idempotent and the turn
        // binds to the same conversation either way.
        const conversationPublicId =
          await session.ensureConversation(clientMessageId);
        const response = await fetch("/api/career-ops/runs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            task,
            model,
            reasoningEffort,
            conversationPublicId,
            clientMessageId,
          }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data?.run?.runId) {
          throw new Error(
            typeof data?.error === "string"
              ? data.error
              : "The Career Ops run could not start.",
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

  const launchOpenExecutiveRun = useCallback(
    async (task: string, agentOverride?: { id: string; name: string }) => {
      const selectedAgent = agentOverride ?? openExecutiveAgent;
      if (!selectedAgent || launchingOpenExecutiveRun) return;
      setLaunchingOpenExecutiveRun(true);
      let clientMessageId = crypto.randomUUID();
      const userContent = openExecutiveUserMessage(task);
      clientMessageId = session.previewExternalAgentTurn({
        clientMessageId,
        userContent,
      });
      let runStarted = false;
      try {
        const conversationPublicId =
          await session.ensureConversation(clientMessageId);
        const response = await fetch("/api/openexecutive/runs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            task,
            model,
            reasoningEffort,
            conversationPublicId,
            clientMessageId,
          }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data?.run?.runId) {
          throw new Error(
            typeof data?.message === "string"
              ? data.message
              : typeof data?.error === "string"
                ? data.error
                : "The OpenExecutive run could not start.",
          );
        }
        runStarted = true;
        await session.appendExternalAgentTurn({
          clientMessageId,
          userContent,
          run: {
            kind: "openexecutive",
            runId: String(data.run.runId),
            task: typeof data.task === "string" ? data.task : task,
          },
        });
      } catch (cause) {
        if (runStarted) {
          setAttachmentStatus(
            cause instanceof Error
              ? cause.message
              : "OpenExecutive started, but its chat turn could not be saved.",
          );
          return;
        }
        const assistantContent = `The OpenExecutive task could not start: ${
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
              : "The OpenExecutive turn could not be saved.",
          );
        }
      } finally {
        setLaunchingOpenExecutiveRun(false);
      }
    },
    [
      launchingOpenExecutiveRun,
      model,
      openExecutiveAgent,
      reasoningEffort,
      session,
    ],
  );

  const launchVibeTradingRun = useCallback(
    async (task: string, agentOverride?: { id: string; name: string }) => {
      const selectedAgent = agentOverride ?? vibeTradingAgent;
      if (!selectedAgent || launchingVibeTradingRun) return;
      setLaunchingVibeTradingRun(true);
      let clientMessageId = crypto.randomUUID();
      const userContent = vibeTradingUserMessage(task);
      clientMessageId = session.previewExternalAgentTurn({
        clientMessageId,
        userContent,
      });
      let runStarted = false;
      try {
        // The run reads the chat it was launched from, so the conversation is
        // materialized before it starts. The call is idempotent and the turn
        // binds to the same conversation either way.
        const conversationPublicId =
          await session.ensureConversation(clientMessageId);
        const response = await fetch("/api/vibe-trading/runs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            task,
            model,
            reasoningEffort,
            conversationPublicId,
            clientMessageId,
          }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data?.run?.runId) {
          throw new Error(
            typeof data?.error === "string"
              ? data.error
              : "The Vibe Trading run could not start.",
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
    [
      launchingVibeTradingRun,
      model,
      reasoningEffort,
      session,
      vibeTradingAgent,
    ],
  );

  const launchStockAnalystRun = useCallback(
    async (task: string, agentOverride?: { id: string; name: string }) => {
      const selectedAgent = agentOverride ?? stockAnalystAgent;
      if (!selectedAgent || launchingStockAnalystRun) return;
      setLaunchingStockAnalystRun(true);
      let clientMessageId = crypto.randomUUID();
      const userContent = stockAnalystUserMessage(task);
      clientMessageId = session.previewExternalAgentTurn({
        clientMessageId,
        userContent,
      });
      let runStarted = false;
      try {
        // The launching chat decides whether this run may be given memory, so
        // the conversation is materialized before the run starts rather than
        // when its turn is saved. The call is idempotent and the turn binds to
        // the same conversation either way.
        const conversationPublicId =
          await session.ensureConversation(clientMessageId);
        const response = await fetch("/api/stock-analyst/runs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            task,
            model,
            conversationPublicId,
            clientMessageId,
          }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data?.run?.runId) {
          throw new Error(
            typeof data?.error === "string"
              ? data.error
              : "The Stock Analyst run could not start.",
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
      clientMessageId = session.previewExternalAgentTurn({
        clientMessageId,
        userContent,
      });
      let runStarted = false;
      try {
        const conversationPublicId =
          await session.ensureConversation(clientMessageId);
        const response = await fetch("/api/deer-flow/runs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            task,
            model,
            reasoningEffort,
            conversationPublicId,
            clientMessageId,
          }),
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
      clientMessageId = session.previewExternalAgentTurn({
        clientMessageId,
        userContent,
      });
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
            typeof data?.error === "string"
              ? data.error
              : "The analysis could not start.",
          );
        }
        runStarted = true;
        await session.appendExternalAgentTurn({
          clientMessageId,
          userContent,
          run: {
            kind: "trading_agents",
            runId: String(data.run.runId),
            task: label,
          },
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
        const conversationPublicId =
          await session.ensureConversation(clientMessageId);
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
              ...("blobId" in video
                ? { blobId: video.blobId }
                : { url: video.url }),
              filename: video.name,
              prompt,
            },
            model,
            conversationPublicId,
            clientMessageId,
          }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data?.run?.runId) {
          throw new Error(
            typeof data?.error === "string"
              ? data.error
              : "The edit could not start.",
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
      if (!text || launchingVideoUseRun || !videoEditIntent(text).edit)
        return null;
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
      clientMessageId = session.previewExternalAgentTurn({
        clientMessageId,
        userContent,
      });
      let runStarted = false;
      try {
        const conversationPublicId =
          await session.ensureConversation(clientMessageId);
        const response = await fetch("/api/shorts/runs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ request, model, conversationPublicId }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data?.run?.runId) {
          throw new Error(
            typeof data?.error === "string"
              ? data.error
              : "The clips could not start.",
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
      clientMessageId = session.previewExternalAgentTurn({
        clientMessageId,
        userContent,
      });
      let runStarted = false;
      try {
        const conversationPublicId =
          await session.ensureConversation(clientMessageId);
        const response = await fetch("/api/shaper/runs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ request, conversationPublicId }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data?.run?.runId) {
          throw new Error(
            typeof data?.error === "string"
              ? data.error
              : "The reconstruction could not start.",
          );
        }
        runStarted = true;
        await session.appendExternalAgentTurn({
          clientMessageId,
          userContent,
          run: {
            kind: "formsmith",
            runId: String(data.run.runId),
            task: label,
          },
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
        const assistantContent = `The reconstruction could not start: ${cause instanceof Error ? cause.message : "unknown error"}`;
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
              : "The Formsmith turn could not be saved.",
          );
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
    async (brief: string, options: { branchGroupId?: string } = {}) => {
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
        const conversationPublicId =
          await session.ensureConversation(clientMessageId);
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
            typeof data?.error === "string"
              ? data.error
              : "The Socials Manager run could not start.",
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
    async (brief: string, options: { branchGroupId?: string } = {}) => {
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
        const conversationPublicId =
          await session.ensureConversation(clientMessageId);
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

  /** openGym is command-carried and available with the dashboard at startup. */
  const launchOpenGymRun = useCallback(
    async (
      task: string,
      options: { branchGroupId?: string; userContent?: string; quiet?: boolean } = {},
    ) => {
      if (openGymDispatchingRef.current) return;
      openGymDispatchingRef.current = true;
      setLaunchingOpenGymRun(true);
      const normalizedTask = task.trim();
      const requestedClientMessageId = crypto.randomUUID();
      let clientMessageId = requestedClientMessageId;
      const userContent =
        options.userContent?.trim() || openGymUserMessage(normalizedTask);
      clientMessageId = session.previewExternalAgentTurn({
        clientMessageId,
        userContent,
        branchGroupId: options.branchGroupId,
      });
      const attachToExistingTurn = clientMessageId !== requestedClientMessageId;
      let runStarted = false;
      try {
        const conversationPublicId = await session.ensureConversation(clientMessageId);
        const response = await fetch("/api/open-gym/runs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            task: normalizedTask,
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
          throw new Error(typeof data?.error === "string" ? data.error : "The openGym run could not start.");
        }
        runStarted = true;
        await session.appendExternalAgentTurn({
          clientMessageId,
          userContent,
          run: {
            kind: "open_gym",
            runId: String(data.run.runId),
            task: normalizedTask,
            ...(options.quiet === true ? { quiet: true } : {}),
          },
          branchGroupId: options.branchGroupId,
        });
      } catch (cause) {
        if (runStarted) {
          setAttachmentStatus(cause instanceof Error ? cause.message : "openGym started, but its chat turn could not be saved.");
          return;
        }
        const assistantContent = `openGym could not start: ${cause instanceof Error ? cause.message : "unknown error"}`;
        try {
          await session.appendExternalAgentTurn({
            clientMessageId,
            userContent,
            assistantContent,
            outcome: "failed",
            branchGroupId: options.branchGroupId,
          });
        } catch (persistenceError) {
          setAttachmentStatus(persistenceError instanceof Error ? persistenceError.message : "The openGym turn could not be saved.");
        }
      } finally {
        openGymDispatchingRef.current = false;
        setLaunchingOpenGymRun(false);
      }
    },
    [model, reasoningEffort, session],
  );

  const routeOpenGymCommand = useCallback(
    (text: string, options: { branchGroupId?: string } = {}): boolean => {
      const task = taskFromOpenGymCommand(text);
      if (task === null) return false;
      setAttachmentStatus("");
      if (task && !openGymDispatchingRef.current) void launchOpenGymRun(task, options);
      return true;
    },
    [launchOpenGymRun],
  );

  /**
   * God's Eye is command-carried too: the sentence is the tasking. A quiet
   * launch (a Super Agent delegation) keeps the run's card chrome hidden and
   * lets the framed globe stand as the answer.
   */
  const launchGodsEyeRun = useCallback(
    async (
      task: string,
      options: { branchGroupId?: string; userContent?: string; quiet?: boolean } = {},
    ) => {
      if (godsEyeDispatchingRef.current) return;
      godsEyeDispatchingRef.current = true;
      setLaunchingGodsEyeRun(true);
      const normalizedTask = task.trim();
      const requestedClientMessageId = crypto.randomUUID();
      let clientMessageId = requestedClientMessageId;
      const userContent =
        options.userContent?.trim() || godsEyeUserMessage(normalizedTask);
      clientMessageId = session.previewExternalAgentTurn({
        clientMessageId,
        userContent,
        branchGroupId: options.branchGroupId,
      });
      const attachToExistingTurn = clientMessageId !== requestedClientMessageId;
      let runStarted = false;
      try {
        const conversationPublicId = await session.ensureConversation(clientMessageId);
        const response = await fetch("/api/gods-eye/runs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            task: normalizedTask,
            model,
            conversationPublicId,
            clientMessageId,
            attachToExistingTurn,
            branchGroupId: options.branchGroupId,
          }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data?.run?.runId) {
          throw new Error(typeof data?.error === "string" ? data.error : "The God's Eye run could not start.");
        }
        runStarted = true;
        await session.appendExternalAgentTurn({
          clientMessageId,
          userContent,
          run: {
            kind: "gods_eye",
            runId: String(data.run.runId),
            task: normalizedTask,
            ...(options.quiet === true ? { quiet: true } : {}),
          },
          branchGroupId: options.branchGroupId,
        });
      } catch (cause) {
        if (runStarted) {
          setAttachmentStatus(cause instanceof Error ? cause.message : "God's Eye started, but its chat turn could not be saved.");
          return;
        }
        const assistantContent = `God's Eye could not start: ${cause instanceof Error ? cause.message : "unknown error"}`;
        try {
          await session.appendExternalAgentTurn({
            clientMessageId,
            userContent,
            assistantContent,
            outcome: "failed",
            branchGroupId: options.branchGroupId,
          });
        } catch (persistenceError) {
          setAttachmentStatus(persistenceError instanceof Error ? persistenceError.message : "The God's Eye turn could not be saved.");
        }
      } finally {
        godsEyeDispatchingRef.current = false;
        setLaunchingGodsEyeRun(false);
      }
    },
    [model, session],
  );

  const routeGodsEyeCommand = useCallback(
    (text: string, options: { branchGroupId?: string } = {}): boolean => {
      const task = taskFromGodsEyeCommand(text);
      if (task === null) return false;
      setAttachmentStatus("");
      if (task && !godsEyeDispatchingRef.current) void launchGodsEyeRun(task, options);
      return true;
    },
    [launchGodsEyeRun],
  );

  /**
   * Parametric CAD needs no agent selection either: the command carries the
   * whole brief. The conversation must exist first so the built design can be
   * stored as an artifact that belongs to this chat.
   */
  const launchParametricCadRun = useCallback(
    async (brief: string, options: { branchGroupId?: string } = {}) => {
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
        const conversationPublicId =
          await session.ensureConversation(clientMessageId);
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
          setAttachmentStatus(
            cause instanceof Error
              ? cause.message
              : "The run started, but its chat turn could not be saved.",
          );
          return;
        }
        const assistantContent = `The Resource2Skill run could not start: ${cause instanceof Error ? cause.message : "unknown error"}`;
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
              : "The Resource2Skill turn could not be saved.",
          );
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
      if (brief && !resource2SkillDispatchingRef.current)
        void launchResource2SkillRun(brief, options);
      return true;
    },
    [launchResource2SkillRun],
  );

  /**
   * MatrAIx carries the whole study in the command: what to ask about, and any
   * cohort flags typed with it. The turn is recorded as soon as the run starts,
   * because a study of a dozen respondents is a dozen sequential model calls and
   * the person will not be watching the whole time.
   */
  const launchMatraixRun = useCallback(
    async (brief: string, options: { branchGroupId?: string } = {}) => {
      if (matraixDispatchingRef.current) return;
      matraixDispatchingRef.current = true;
      setLaunchingMatraixRun(true);
      let clientMessageId = crypto.randomUUID();
      const userContent = matraixUserMessage(brief);
      clientMessageId = session.previewExternalAgentTurn({
        clientMessageId,
        userContent,
        branchGroupId: options.branchGroupId,
      });
      let runStarted = false;
      try {
        // The study reads the chat it was launched from, so the conversation is
        // materialized before it starts. The call is idempotent and the turn
        // binds to the same conversation either way.
        const conversationPublicId = await session.ensureConversation(clientMessageId);
        const response = await fetch("/api/matraix/runs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            brief,
            model,
            reasoningEffort,
            conversationPublicId,
            clientMessageId,
          }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data?.run?.runId) {
          throw new Error(
            typeof data?.message === "string"
              ? data.message
              : typeof data?.error === "string"
                ? data.error
                : "The MatrAIx study could not start.",
          );
        }
        runStarted = true;
        await session.appendExternalAgentTurn({
          clientMessageId,
          userContent,
          run: { kind: "matraix", runId: String(data.run.runId), brief },
          branchGroupId: options.branchGroupId,
        });
      } catch (cause) {
        if (runStarted) {
          setAttachmentStatus(
            cause instanceof Error
              ? cause.message
              : "The study started, but its chat turn could not be saved.",
          );
          return;
        }
        const assistantContent = `The MatrAIx study could not start: ${cause instanceof Error ? cause.message : "unknown error"}`;
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
              : "The MatrAIx turn could not be saved.",
          );
        }
      } finally {
        matraixDispatchingRef.current = false;
        setLaunchingMatraixRun(false);
      }
    },
    [model, reasoningEffort, session],
  );

  const routeMatraixCommand = useCallback(
    (text: string, options: { branchGroupId?: string } = {}): boolean => {
      const brief = taskFromMatraixCommand(text);
      if (brief === null) return false;
      setAttachmentStatus("");
      if (brief && !matraixDispatchingRef.current) void launchMatraixRun(brief, options);
      return true;
    },
    [launchMatraixRun],
  );

  /**
   * Bolt Slides carries the whole deck in the command: what it is about, and
   * any flags typed with it. The turn is recorded as soon as the run starts —
   * planning, writing and building a deck takes minutes, and the person will
   * not be watching all of it.
   */
  const launchBoltSlidesRun = useCallback(
    async (brief: string, options: { branchGroupId?: string } = {}) => {
      if (boltSlidesDispatchingRef.current) return;
      boltSlidesDispatchingRef.current = true;
      setLaunchingBoltSlidesRun(true);
      let clientMessageId = crypto.randomUUID();
      const userContent = boltSlidesUserMessage(brief);
      clientMessageId = session.previewExternalAgentTurn({
        clientMessageId,
        userContent,
        branchGroupId: options.branchGroupId,
      });
      let runStarted = false;
      try {
        // The finished deck is filed as an artifact of this chat, so the
        // conversation is materialized before the run starts. The call is
        // idempotent and the turn binds to the same conversation either way.
        const conversationPublicId = await session.ensureConversation(clientMessageId);
        const response = await fetch("/api/bolt-slides/runs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            brief,
            model,
            reasoningEffort,
            conversationPublicId,
            clientMessageId,
          }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data?.run?.runId) {
          throw new Error(
            typeof data?.message === "string"
              ? data.message
              : typeof data?.error === "string"
                ? data.error
                : "The deck could not be started.",
          );
        }
        runStarted = true;
        await session.appendExternalAgentTurn({
          clientMessageId,
          userContent,
          run: { kind: "bolt_slides", runId: String(data.run.runId), brief },
          branchGroupId: options.branchGroupId,
        });
      } catch (cause) {
        if (runStarted) {
          setAttachmentStatus(
            cause instanceof Error
              ? cause.message
              : "The deck started, but its chat turn could not be saved.",
          );
          return;
        }
        const assistantContent = `The deck could not be started: ${cause instanceof Error ? cause.message : "unknown error"}`;
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
              : "The Bolt Slides turn could not be saved.",
          );
        }
      } finally {
        boltSlidesDispatchingRef.current = false;
        setLaunchingBoltSlidesRun(false);
      }
    },
    [model, reasoningEffort, session],
  );

  const routeBoltSlidesCommand = useCallback(
    (text: string, options: { branchGroupId?: string } = {}): boolean => {
      const brief = taskFromBoltSlidesCommand(text);
      if (brief === null) return false;
      setAttachmentStatus("");
      if (brief && !boltSlidesDispatchingRef.current) void launchBoltSlidesRun(brief, options);
      return true;
    },
    [launchBoltSlidesRun],
  );

  /**
   * Classroom carries the lesson in the command — what to teach, and any flags
   * typed with it — and the attachments are its material: documents and images
   * travel with the request and are recorded on the user's turn. The turn is
   * recorded as soon as the run starts; generating a classroom takes minutes,
   * and the person will not be watching all of it.
   */
  const launchClassroomRun = useCallback(
    async (
      brief: string,
      attachments: readonly ChatAttachment[] = [],
      options: { branchGroupId?: string } = {},
    ) => {
      if (classroomDispatchingRef.current) return;
      classroomDispatchingRef.current = true;
      setLaunchingClassroomRun(true);
      let clientMessageId = crypto.randomUUID();
      const userContent = classroomUserMessage(brief);
      const turnAttachments = chatMessageAttachments(attachments);
      clientMessageId = session.previewExternalAgentTurn({
        clientMessageId,
        userContent,
        attachments: turnAttachments,
        branchGroupId: options.branchGroupId,
      });
      let runStarted = false;
      try {
        // The finished lesson is filed as an artifact of this chat, so the
        // conversation is materialized before the run starts.
        const conversationPublicId = await session.ensureConversation(clientMessageId);
        const response = await fetch("/api/classroom/runs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            brief,
            model,
            attachments,
            conversationPublicId,
            clientMessageId,
          }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data?.run?.runId) {
          throw new Error(
            typeof data?.message === "string"
              ? data.message
              : typeof data?.error === "string"
                ? data.error
                : "The classroom could not be started.",
          );
        }
        runStarted = true;
        await session.appendExternalAgentTurn({
          clientMessageId,
          userContent,
          attachments: turnAttachments,
          run: { kind: "classroom", runId: String(data.run.runId), brief },
          branchGroupId: options.branchGroupId,
        });
      } catch (cause) {
        if (runStarted) {
          setAttachmentStatus(
            cause instanceof Error
              ? cause.message
              : "The classroom started, but its chat turn could not be saved.",
          );
          return;
        }
        const assistantContent =
          "The classroom could not be started: " +
          (cause instanceof Error ? cause.message : "unknown error");
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
              : "The Classroom turn could not be saved.",
          );
        }
      } finally {
        classroomDispatchingRef.current = false;
        setLaunchingClassroomRun(false);
      }
    },
    [model, session],
  );

  const routeClassroomCommand = useCallback(
    (
      text: string,
      attachments: readonly ChatAttachment[] = [],
      options: { branchGroupId?: string } = {},
    ): boolean => {
      const brief = taskFromClassroomCommand(text);
      if (brief === null) return false;
      setAttachmentStatus("");
      if (brief && !classroomDispatchingRef.current) {
        void launchClassroomRun(brief, attachments, options);
      }
      return true;
    },
    [launchClassroomRun],
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

  const launchPraxistRun = useCallback(
    async (task: string, options: { branchGroupId?: string } = {}) => {
      if (praxistDispatchingRef.current) return;
      const taskPath = parsePraxistTaskPath(task);
      praxistDispatchingRef.current = true;
      setLaunchingPraxistRun(true);
      let clientMessageId = crypto.randomUUID();
      const userContent = praxistUserMessage(taskPath);
      clientMessageId = session.previewExternalAgentTurn({
        clientMessageId,
        userContent,
        branchGroupId: options.branchGroupId,
      });
      let runStarted = false;
      try {
        await session.ensureConversation(clientMessageId);
        const response = await fetch("/api/praxist/runs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ task: taskPath, model }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data?.run?.runId) {
          throw new Error(
            typeof data?.error === "string" ? data.error : "The Praxist run could not start.",
          );
        }
        runStarted = true;
        await session.appendExternalAgentTurn({
          clientMessageId,
          userContent,
          run: { kind: "praxist", runId: String(data.run.runId), task: taskPath },
          branchGroupId: options.branchGroupId,
        });
      } catch (cause) {
        if (runStarted) {
          setAttachmentStatus(cause instanceof Error
            ? cause.message
            : "The Praxist run started, but its chat turn could not be saved.");
          return;
        }
        const assistantContent = `The Praxist run could not start: ${
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
          setAttachmentStatus(persistenceError instanceof Error
            ? persistenceError.message
            : "The Praxist turn could not be saved.");
        }
      } finally {
        praxistDispatchingRef.current = false;
        setLaunchingPraxistRun(false);
      }
    },
    [model, session],
  );

  /**
   * Max Research carries its whole question in the message and then runs for
   * tens of minutes. The turn is therefore recorded the moment the run starts
   * rather than when it finishes: the card is where the person watches five
   * agents work, and a chat that showed nothing until the end would hide the
   * only part of an hour-long run they can act on.
   */
  const launchMaxResearchRun = useCallback(
    async (
      question: string,
      options: { branchGroupId?: string; userContent?: string } = {},
    ) => {
      if (maxResearchDispatchingRef.current) return;
      maxResearchDispatchingRef.current = true;
      setLaunchingMaxResearchRun(true);
      try {
        await launchMaxResearchTurn({
          session,
          question,
          model,
          reasoningEffort,
          ...(options.branchGroupId ? { branchGroupId: options.branchGroupId } : {}),
          ...(options.userContent ? { userContent: options.userContent } : {}),
          onStatus: setAttachmentStatus,
        });
      } finally {
        maxResearchDispatchingRef.current = false;
        setLaunchingMaxResearchRun(false);
      }
    },
    [model, reasoningEffort, session],
  );

  /**
   * Both ways in, and the plain-language one is honoured here rather than being
   * left to Super Agent. A person who typed "max research" is asking to watch
   * six agents work, not to be told afterwards that something happened.
   */
  const routeMaxResearchCommand = useCallback(
    (text: string, options: { branchGroupId?: string } = {}): boolean => {
      // Under Super Agent the model owns the turn and delegates Max Research
      // privately. Only the explicit slash command bypasses that orchestration.
      const invocation = maxResearchInvocation(text, isSuperAgentEnabled());
      if (!invocation) return false;
      setAttachmentStatus("");
      if (invocation.question && !maxResearchDispatchingRef.current) {
        void launchMaxResearchRun(invocation.question, {
          ...options,
          // Typed as a slash command, the canonical form *is* what they wrote.
          // Typed in their own words, those words are what the transcript keeps
          // — the same rule Deep Research follows.
          ...(invocation.selectAgent ? {} : { userContent: text }),
        });
      }
      return true;
    },
    [launchMaxResearchRun],
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

  const routePraxistCommand = useCallback(
    (text: string, options: { branchGroupId?: string } = {}): boolean => {
      const task = taskFromPraxistCommand(text);
      if (task === null) return false;
      setAttachmentStatus("");
      if (task && !praxistDispatchingRef.current) void launchPraxistRun(task, options);
      return true;
    },
    [launchPraxistRun],
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
        const conversationPublicId = await session.ensureConversation(clientMessageId);
        const response = await fetch("/api/inbox-zero/runs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ task, model, conversationPublicId }),
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
        const conversationPublicId =
          await session.ensureConversation(clientMessageId);
        const response = await fetch("/api/vimax/runs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            brief,
            model,
            reasoningEffort,
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

  /**
   * Vox Director carries its whole topic in the command too. The production
   * plans a beat map, draws a poster per beat, animates each one locally and
   * narrates it, so the turn is recorded before the first event arrives and the
   * card streams into it. The conversation must exist first: the film — and
   * every poster drawn for it — is an artifact that belongs to this chat.
   */
  const launchVoxDirectorRun = useCallback(
    async (brief: string, options: { branchGroupId?: string } = {}) => {
      if (voxDirectorDispatchingRef.current) return;
      voxDirectorDispatchingRef.current = true;
      setLaunchingVoxDirectorRun(true);
      let clientMessageId = crypto.randomUUID();
      const userContent = voxDirectorUserMessage(brief);
      clientMessageId = session.previewExternalAgentTurn({
        clientMessageId,
        userContent,
        branchGroupId: options.branchGroupId,
      });
      let runStarted = false;
      try {
        const conversationPublicId = await session.ensureConversation(clientMessageId);
        const response = await fetch("/api/vox-director/runs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            brief,
            model,
            reasoningEffort,
            conversationPublicId,
            clientMessageId,
          }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data?.run?.runId) {
          throw new Error(
            typeof data?.message === "string"
              ? data.message
              : typeof data?.error === "string"
                ? data.error
                : "The explainer could not start.",
          );
        }
        runStarted = true;
        await session.appendExternalAgentTurn({
          clientMessageId,
          userContent,
          run: { kind: "vox_director", runId: String(data.run.runId), brief },
          branchGroupId: options.branchGroupId,
        });
      } catch (cause) {
        if (runStarted) {
          setAttachmentStatus(
            cause instanceof Error
              ? cause.message
              : "The explainer started, but its chat turn could not be saved.",
          );
          return;
        }
        const assistantContent = `The explainer could not start: ${
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
              : "The Vox Director turn could not be saved.",
          );
        }
      } finally {
        voxDirectorDispatchingRef.current = false;
        setLaunchingVoxDirectorRun(false);
      }
    },
    [model, reasoningEffort, session],
  );

  const routeVoxDirectorCommand = useCallback(
    (text: string, options: { branchGroupId?: string } = {}): boolean => {
      const brief = briefFromVoxDirectorCommand(text);
      if (brief === null) return false;
      setAttachmentStatus("");
      if (brief && !voxDirectorDispatchingRef.current) {
        void launchVoxDirectorRun(brief, options);
      }
      return true;
    },
    [launchVoxDirectorRun],
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
        const conversationPublicId =
          await session.ensureConversation(clientMessageId);
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
        const conversationPublicId =
          await session.ensureConversation(clientMessageId);
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

  /**
   * Start one wardrobe import.
   *
   * The attachments are the clothes: this agent has no useful run without them,
   * so they travel with the request and are recorded on the user's turn, which
   * is what makes a reopened chat show which photos were handed over. The typed
   * text is optional direction rather than the task.
   */
  const launchWardrobeRun = useCallback(
    async (
      direction: string,
      attachments: readonly ChatAttachment[],
      options: { branchGroupId?: string } = {},
    ) => {
      if (wardrobeDispatchingRef.current) return;
      wardrobeDispatchingRef.current = true;
      setLaunchingWardrobeRun(true);
      let clientMessageId = crypto.randomUUID();
      const userContent = wardrobeUserMessage(direction);
      const turnAttachments = chatMessageAttachments(attachments);
      clientMessageId = session.previewExternalAgentTurn({
        clientMessageId,
        userContent,
        attachments: turnAttachments,
        branchGroupId: options.branchGroupId,
      });
      let runStarted = false;
      try {
        // The cutouts and modeled photos are artifacts of this conversation, so
        // the conversation has to exist before the run that makes them.
        const conversationPublicId =
          await session.ensureConversation(clientMessageId);
        const response = await fetch("/api/wardrobe/runs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            task: direction,
            model,
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
                : "The import could not start.",
          );
        }
        runStarted = true;
        await session.appendExternalAgentTurn({
          clientMessageId,
          userContent,
          attachments: turnAttachments,
          run: {
            kind: "wardrobe",
            runId: String(data.run.runId),
            task: wardrobeRunLabel({
              photos: attachments.filter((item) => item.type === "image")
                .length,
              direction,
            }),
          },
          branchGroupId: options.branchGroupId,
        });
      } catch (cause) {
        if (runStarted) {
          setAttachmentStatus(
            cause instanceof Error
              ? cause.message
              : "The import started, but its chat turn could not be saved.",
          );
          return;
        }
        const assistantContent = `The import could not start: ${
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
              : "The Wardrobe turn could not be saved.",
          );
        }
      } finally {
        wardrobeDispatchingRef.current = false;
        setLaunchingWardrobeRun(false);
      }
    },
    [model, session],
  );

  /**
   * Unlike every other agent's router, a bare token still launches: the photos
   * are the request, so `/agents:wardrobe` with pictures attached is a complete
   * instruction. A send with no pictures reaches the run route, which refuses it
   * with a sentence saying what is missing.
   */
  const routeWardrobeCommand = useCallback(
    (
      text: string,
      attachments: readonly ChatAttachment[] = [],
      options: { branchGroupId?: string } = {},
    ): boolean => {
      const direction = taskFromWardrobeCommand(text);
      if (direction === null) return false;
      setAttachmentStatus("");
      if (!wardrobeDispatchingRef.current) {
        void launchWardrobeRun(direction, attachments, options);
      }
      return true;
    },
    [launchWardrobeRun],
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
      const invocation = directDeepResearchInvocation(
        text,
        isSuperAgentEnabled(),
      );
      if (!invocation) {
        if (
          isSuperAgentEnabled() &&
          taskFromDeepResearchIntent(text) !== null
        ) {
          deepResearch.clear();
        }
        return false;
      }
      if (deepResearch.launching || deepResearchDispatchingRef.current)
        return true;
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
          if (invocation.selectAgent && !deepResearch.agent) {
            await deepResearch.select();
          }
          await deepResearch.launch(invocation.task, {
            ...options,
            ...(invocation.selectAgent ? {} : { userContent: text }),
          });
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
    (meetingNotesAgent && "meeting-notes") ||
    (deepTutorAgent && "deep-tutor") ||
    (careerOpsAgent && "career-ops") ||
    (openExecutiveAgent && "openexecutive") ||
    (tradingAgentsAgent && "trading-agent") ||
    (vibeTradingAgent && "vibe-trading") ||
    (stockAnalystAgent && "stock-analyst") ||
    (deerFlowAgent && "deer-flow") ||
    (shortsAgent && "shorts") ||
    (formsmithAgent && "formsmith") ||
    (agentBrowserAgent && "agent-browser") ||
    (browserAgent && "agent-tars") ||
    null;

  // Runtime agents a Super Agent turn asked for. Each worker owns a distinct
  // hidden transcript turn, so several may run at once and report back in the
  // order they finish.
  interface AwaitedLaunch {
    agentName: string;
    requestId: string;
    clientMessageId: string;
  }
  const awaitedLaunchesRef = useRef(new Map<string, AwaitedLaunch>());
  const launchHopsRef = useRef(0);
  const launchRoundOriginsRef = useRef(new Set<string>());
  const continuedDelegatedTurnsRef = useRef(new Set<string>());
  const settlingExternalTurnsRef = useRef(new Set<string>());
  const [pendingLaunchContinuations, setPendingLaunchContinuations] = useState<
    string[]
  >([]);

  const submit = useCallback(
    async (textOverride?: string) => {
      // Nothing may be dispatched into a chat that is still arriving -- not a
      // Hermes turn and not one of the runtime-agent launches below, which bind
      // their run to whichever conversation is selected when they start.
      if (session.loadingSession || openGymRoutingRef.current) return;
      const text = (textOverride ?? input).trim();
      // Only the composer calls this with no override, so this is the one place
      // that knows a human is speaking: it ends whatever hand-off chain was
      // running.
      if (textOverride === undefined) {
        launchHopsRef.current = 0;
        launchRoundOriginsRef.current.clear();
        awaitedLaunchesRef.current.clear();
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
              codexTask ||
                "Review the attached screenshot and implement the requested fix.",
              pendingAttachments,
            );
          }
        })();
        return;
      }
      const rufloTask = taskFromRufloCommand(text);
      if (rufloTask !== null) {
        if (ruflo.launching) return;
        const pendingAttachments = chatAttachments;
        setInput("");
        setChatAttachments([]);
        setAttachmentStatus("");
        void (async () => {
          const selected = ruflo.agent ?? (await selectRuflo());
          if (selected && (rufloTask || pendingAttachments.length)) {
            await launchRufloRun(
              rufloTask ||
                "Review the attached screenshot and implement the requested fix.",
              pendingAttachments,
            );
          }
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
              openCodeTask ||
                "Review the attached screenshot and implement the requested fix.",
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
          const selected = openPlanterAgent ?? (await selectOpenPlanter());
          if (selected && openPlanterTask)
            await launchOpenPlanterRun(openPlanterTask, selected);
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
          if (selected && agentReachTask)
            await launchAgentReachRun(agentReachTask, selected);
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
          if (selected && deepTutorTask)
            await launchDeepTutorRun(deepTutorTask, selected);
        })();
        return;
      }
      const meetingNotesTask = taskFromMeetingNotesCommand(text);
      if (meetingNotesTask !== null) {
        if (launchingMeetingNotesRun) return;
        setInput("");
        setAttachmentStatus("");
        const attachedRecording = chatAttachments.find(
          (item) => item.type === "video",
        );
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
              ? {
                  blobId: attachedRecording.blobId,
                  filename: attachedRecording.name,
                }
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
          if (selected && getDocTask)
            await launchGetDocRun(getDocTask, selected);
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
          if (selected && careerOpsTask)
            await launchCareerOpsRun(careerOpsTask, selected);
        })();
        return;
      }
      const openExecutiveTask = taskFromOpenExecutiveCommand(text);
      if (openExecutiveTask !== null) {
        if (launchingOpenExecutiveRun) return;
        setInput("");
        setAttachmentStatus("");
        void (async () => {
          const selected =
            openExecutiveAgent ?? (await selectOpenExecutive());
          if (selected && openExecutiveTask) {
            await launchOpenExecutiveRun(openExecutiveTask, selected);
          }
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
          if (selected && vibeTradingTask)
            await launchVibeTradingRun(vibeTradingTask, selected);
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
          if (selected && stockAnalystTask)
            await launchStockAnalystRun(stockAnalystTask, selected);
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
          if (selected && deerFlowTask)
            await launchDeerFlowRun(deerFlowTask, selected);
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
        void launchVideoUseRun(videoUseTask, commandVideo, {
          userContent: text,
        });
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
      // Wardrobe is routed here for the same reason: the photographs are its
      // input, so they have to be taken and cleared in the step that starts the
      // run rather than left in the tray for the next message.
      if (taskFromWardrobeCommand(text) !== null) {
        const pendingAttachments = chatAttachments;
        setInput("");
        setChatAttachments([]);
        routeWardrobeCommand(text, pendingAttachments);
        return;
      }
      // Classroom likewise: the attachments are its material — the documents
      // and images the lesson is written from — so they go with the launch.
      if (taskFromClassroomCommand(text) !== null) {
        const pendingAttachments = chatAttachments;
        setInput("");
        setChatAttachments([]);
        routeClassroomCommand(text, pendingAttachments);
        return;
      }
      if (
        routeSocialsManagerCommand(text) ||
        routeOpenGymCommand(text) ||
        routeGodsEyeCommand(text) ||
        routeHardwareBlueprintCommand(text) ||
        routeParametricCadCommand(text) ||
        routeHyperframesCommand(text) ||
        routeResource2SkillCommand(text) ||
        routeMatraixCommand(text) ||
        routeBoltSlidesCommand(text) ||
        routeOpenMontageCommand(text) ||
        routeOpenworkCommand(text) ||
        routeOpenscienceCommand(text) ||
        routePraxistCommand(text) ||
        routeMaxResearchCommand(text) ||
        routeInboxZeroCommand(text) ||
        routeVimaxCommand(text) ||
      routeVoxDirectorCommand(text) ||
        routeMoneyPrinterCommand(text)
      ) {
        setInput("");
        return;
      }
      if (routeDeepResearchCommand(text)) {
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
          text ||
            "Review the attached screenshot and implement the requested fix.",
          pendingAttachments,
        );
        return;
      }
      if (ruflo.agent) {
        if ((!text && chatAttachments.length === 0) || ruflo.launching) return;
        const pendingAttachments = chatAttachments;
        setInput("");
        setChatAttachments([]);
        setAttachmentStatus("");
        void launchRufloRun(
          text ||
            "Review the attached screenshot and implement the requested fix.",
          pendingAttachments,
        );
        return;
      }
      if (openCode.agent) {
        if ((!text && chatAttachments.length === 0) || openCode.launching)
          return;
        const pendingAttachments = chatAttachments;
        setInput("");
        setChatAttachments([]);
        setAttachmentStatus("");
        void launchOpenCodeRun(
          text ||
            "Review the attached screenshot and implement the requested fix.",
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
          const selected = agentBrowserAgent ?? (await selectAgentBrowser());
          if (selected && agentBrowserTask)
            await launchAgentBrowserRun(agentBrowserTask, selected);
        })();
        return;
      }
      const agentTarsTask = taskFromAgentTarsCommand(text);
      if (agentTarsTask !== null) {
        if (launchingBrowserRun) return;
        setInput("");
        setAttachmentStatus("");
        void (async () => {
          const selected = browserAgent ?? (await selectBrowserAgent());
          if (selected && agentTarsTask)
            await launchBrowserRun(agentTarsTask, selected);
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
      if (openExecutiveAgent) {
        if (!text || launchingOpenExecutiveRun) return;
        setInput("");
        setAttachmentStatus("");
        void launchOpenExecutiveRun(text);
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
      // Exercise presentation is an output contract, not a model preference.
      // In Super Agent mode, resolve likely form/program prompts against the
      // registered catalogue before Hermes sees them. A match launches the
      // quiet openGym result directly, so no model response can replace it with
      // prose. Explicit agent selections and attachments have already been
      // handled above and therefore retain their normal routing.
      if (
        isSuperAgentEnabled() &&
        text &&
        chatAttachments.length === 0 &&
        !runtimeUnavailable &&
        !busy
      ) {
        openGymRoutingRef.current = true;
        let routeToOpenGym = false;
        try {
          routeToOpenGym = await shouldRouteOpenGymFromSuperAgent(text);
        } finally {
          openGymRoutingRef.current = false;
        }
        if (routeToOpenGym) {
          setInput("");
          setAttachmentStatus("");
          await launchOpenGymRun(text, { userContent: text, quiet: true });
          return;
        }
      }
      if ((!text && chatAttachments.length === 0) || runtimeUnavailable || busy)
        return;
      const pendingAttachments = chatAttachments;
      const displayText = text || "Please review the attached document(s).";
      const draftSessionId = session.sessionId;
      const draftSubmission = submittedDraftSequence.current + 1;
      submittedDraftSequence.current = draftSubmission;
      if (!temporaryChat) setSubmittedDraft(displayText);
      setInput("");
      setChatAttachments([]);
      setAttachmentStatus("");
      void session.send(displayText, {
        model,
        reasoningEffort,
        attachments: pendingAttachments,
        onTurnPersisted: (persistedSessionId) => {
          setSubmittedDraft((current) =>
            submittedDraftSequence.current === draftSubmission &&
            current === displayText
              ? null
              : current,
          );
          if (temporaryChat) return;
          // React may batch the new session id with this acknowledgement. Clear
          // both possible keys explicitly so the sent text cannot be restored
          // into either the unstarted composer or its newly-created chat.
          clearChatDraft(
            window.localStorage,
            chatDraftKey("dashboard_terminal", draftSessionId),
          );
          clearChatDraft(
            window.localStorage,
            chatDraftKey("dashboard_terminal", persistedSessionId),
          );
        },
      });
    },
    [
      activeRuntimeAgentId,
      browserAgent,
      agentBrowserAgent,
      launchVideoUseRun,
      launchOpenGymRun,
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
      openExecutiveAgent,
      vibeTradingAgent,
      selectVibeTrading,
      launchVibeTradingRun,
      launchingVibeTradingRun,
      stockAnalystAgent,
      selectStockAnalyst,
      launchStockAnalystRun,
      launchingStockAnalystRun,
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
      launchOpenExecutiveRun,
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
      launchingOpenExecutiveRun,
      launchBrowserRun,
      selectBrowserAgent,
      selectAgentBrowser,
      selectOpenPlanter,
      selectAgentReach,
      selectGetDoc,
      selectMeetingNotes,
      selectCareerOps,
      selectOpenExecutive,
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
      routeMaxResearchCommand,
      routeSocialsManagerCommand,
      routeOpenGymCommand,
      routeGodsEyeCommand,
      routeHardwareBlueprintCommand,
      routeParametricCadCommand,
      routeHyperframesCommand,
      routeResource2SkillCommand,
      routeMatraixCommand,
      routeBoltSlidesCommand,
      routeClassroomCommand,
      routeOpenMontageCommand,
      routeOpenworkCommand,
      routeOpenscienceCommand,
      routePraxistCommand,
      routeInboxZeroCommand,
      routeVimaxCommand,
    routeVoxDirectorCommand,
      routeMoneyPrinterCommand,
      routeLegalCommand,
      routeWardrobeCommand,
      runtimeUnavailable,
      session,
      temporaryChat,
    ],
  );

  /**
   * The composer's agent chip is the person's own choice — it is set when they
   * pick an agent and restored from their last `/agents:*` message. A delegated
   * launch has to resolve a runtime through the same `select*` pickers, and
   * those set that chip as a side effect. Left there, `/agents:agent-browser`
   * sits in the composer after a launch nobody asked for, and the next thing
   * typed is routed into that agent instead of the chat. So the selection is
   * snapshotted around a delegated launch and put back once it is dispatched.
   */
  function readComposerAgentSelection() {
    return {
      browser: browserAgent,
      agentBrowser: agentBrowserAgent,
      openPlanter: openPlanterAgent,
      agentReach: agentReachAgent,
      getDoc: getDocAgent,
      meetingNotes: meetingNotesAgent,
      deepTutor: deepTutorAgent,
      careerOps: careerOpsAgent,
      openExecutive: openExecutiveAgent,
      tradingAgents: tradingAgentsAgent,
      vibeTrading: vibeTradingAgent,
      stockAnalyst: stockAnalystAgent,
      deerFlow: deerFlowAgent,
      shorts: shortsAgent,
      formsmith: formsmithAgent,
      deepResearch: deepResearch.agent,
      codex: codex.agent,
      openCode: openCode.agent,
      ruflo: ruflo.agent,
    };
  }

  function restoreComposerAgentSelection(
    snapshot: ReturnType<typeof readComposerAgentSelection>,
  ) {
    setBrowserAgent(snapshot.browser);
    setAgentBrowserAgent(snapshot.agentBrowser);
    setOpenPlanterAgent(snapshot.openPlanter);
    setAgentReachAgent(snapshot.agentReach);
    setGetDocAgent(snapshot.getDoc);
    setMeetingNotesAgent(snapshot.meetingNotes);
    setDeepTutorAgent(snapshot.deepTutor);
    setCareerOpsAgent(snapshot.careerOps);
    setOpenExecutiveAgent(snapshot.openExecutive);
    setTradingAgentsAgent(snapshot.tradingAgents);
    setVibeTradingAgent(snapshot.vibeTrading);
    setStockAnalystAgent(snapshot.stockAnalyst);
    setDeerFlowAgent(snapshot.deerFlow);
    setShortsAgent(snapshot.shorts);
    setFormsmithAgent(snapshot.formsmith);
    // These four own their selection inside their hook, which rehydrates from
    // the transcript. Only the chip a delegation put there is taken back; one
    // the person had chosen is left exactly as they left it.
    if (!snapshot.deepResearch) clearDeepResearch();
    if (!snapshot.codex) clearCodex();
    if (!snapshot.openCode) clearOpenCode();
    if (!snapshot.ruflo) clearRuflo();
  }

  /**
   * Start a model-selected runtime agent without replaying its slash command as
   * a visible user message. The session gives the launcher's next preview a
   * distinct hidden worker turn, so existing launchers keep their normal run
   * APIs while several delegated runs can remain active together.
   */
  async function launchDelegatedAgent(
    request: AgentLaunchRequestPayload,
  ): Promise<void> {
    const composerSelection = readComposerAgentSelection();
    const workerClientMessageId = agentLaunchWorkerClientMessageId(request);
    const originClientMessageId = request.originClientMessageId?.trim();
    if (!originClientMessageId) {
      awaitedLaunchesRef.current.delete(workerClientMessageId);
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
      awaitedLaunchesRef.current.delete(workerClientMessageId);
      setAttachmentStatus(
        `${request.agentName} was not started because its originating chat is no longer open.`,
      );
      return;
    }
    const attachToExistingTurn = !request.workerClientMessageId;
    if (request.startedRun) {
      // Max Research was started and attached at the server-side tool boundary.
      // This is only the observer hand-off; starting again would create a
      // duplicate run and make navigation timing authoritative again.
      setDelegatedAgentLaunching(true);
      try {
        await session.appendExternalAgentTurn({
          clientMessageId: workerClientMessageId,
          userContent: request.brief,
          run: request.startedRun,
          attachToExistingTurn,
          delegatedAgentRun: !attachToExistingTurn,
        });
      } catch (error) {
        setAttachmentStatus(
          error instanceof Error
            ? error.message
            : `${request.agentName} started, but this view could not attach its observer.`,
        );
      } finally {
        setDelegatedAgentLaunching(false);
      }
      return;
    }
    session.beginDelegatedExternalAgentTurn(workerClientMessageId, {
      attachToExistingTurn,
    });
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
          // Deliberately not selected. `launch` needs nothing from the chip,
          // so selecting would only put `/agents:deep-research` in the
          // composer — and the snapshot below cannot take it back until the
          // whole launch settles, which is long enough for the person to type
          // into it and have their next message routed into Deep Research.
          await deepResearch.launch(request.brief);
          return;
        case "max-research":
          // Same reasoning as Deep Research: the launcher needs nothing from
          // the composer chip, and selecting one would strand
          // `/agents:max-research` in the composer for the length of an
          // hour-long run.
          await launchMaxResearchRun(request.brief);
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
        case "openexecutive": {
          const selected =
            openExecutiveAgent ?? (await selectOpenExecutive());
          if (selected) {
            await launchOpenExecutiveRun(request.brief, selected);
          }
          return;
        }
        case "open-gym":
          await launchOpenGymRun(request.brief, { quiet: true });
          return;
        case "trading-agent": {
          const parsed = tradingAgentsRequestFromBrief(request.brief);
          if (!parsed.ok) {
            setAttachmentStatus(parsed.error);
            session.cancelDelegatedExternalAgentTurn(workerClientMessageId);
            await session.appendExternalAgentTurn({
              clientMessageId: workerClientMessageId,
              userContent: request.brief,
              assistantContent: parsed.error,
              outcome: "failed",
              attachToExistingTurn,
              delegatedAgentRun: !attachToExistingTurn,
            });
            return;
          }
          const selected =
            tradingAgentsAgent ?? (await selectTradingAgents());
          if (selected) await launchTradingAgentsRun(parsed.request);
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
        case "matraix":
          await launchMatraixRun(request.brief);
          return;
        case "bolt-slides":
          await launchBoltSlidesRun(request.brief);
          return;
        case "classroom":
          await launchClassroomRun(request.brief);
          return;
        case "gods-eye":
          await launchGodsEyeRun(request.brief, { quiet: true });
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
        case "praxist":
          await launchPraxistRun(request.brief);
          return;
        case "inbox-zero":
          await launchInboxZeroRun(request.brief);
          return;
        case "vimax":
          await launchVimaxRun(request.brief);
          return;
        case "vox-director":
          await launchVoxDirectorRun(request.brief);
          return;
        case "money-printer":
          await launchMoneyPrinterRun(request.brief);
          return;
        default:
          setAttachmentStatus(
            `${request.agentName} cannot be launched from this chat.`,
          );
      }
    } finally {
      restoreComposerAgentSelection(composerSelection);
      const neverReachedLauncher = session.cancelDelegatedExternalAgentTurn(
        workerClientMessageId,
      );
      if (neverReachedLauncher) {
        try {
          await session.appendExternalAgentTurn({
            clientMessageId: workerClientMessageId,
            userContent: request.brief,
            assistantContent: `${request.agentName} could not start.`,
            outcome: "failed",
            attachToExistingTurn,
            delegatedAgentRun: !attachToExistingTurn,
          });
        } catch {
          setAttachmentStatus(`${request.agentName} could not start.`);
        }
      }
      setDelegatedAgentLaunching(false);
    }
  }

  const launchReady =
    !busy &&
    !externalRunLaunching &&
    !runtimeUnavailable &&
    !session.loadingSession;
  const agentLaunchQueue = useAgentLaunchQueue({
    submit: (request) => {
      void launchDelegatedAgent(request);
    },
    scopeKey: session.sessionId ?? null,
    ready: launchReady,
    onLaunched: (request) => {
      // openGym owns the self-contained guidance-and-animation answer. Treating
      // it like a private worker would create a second Super Agent "Thinking"
      // turn as soon as it completes, replacing that answer with redundant
      // prose synthesis.
      if (
        request.agentId === OPEN_GYM_AGENT_ID ||
        request.agentId === GODS_EYE_AGENT_ID
      ) {
        awaitedLaunchesRef.current.delete(
          agentLaunchWorkerClientMessageId(request),
        );
        return;
      }
      const origin = request.originClientMessageId ?? request.requestId;
      if (!launchRoundOriginsRef.current.has(origin)) {
        launchRoundOriginsRef.current.add(origin);
        launchHopsRef.current += 1;
      }
      if (request.awaitResult) {
        const clientMessageId = agentLaunchWorkerClientMessageId(request);
        awaitedLaunchesRef.current.set(clientMessageId, {
          agentName: request.agentName,
          requestId: request.requestId,
          clientMessageId,
        });
      }
    },
    onDismissed: (request) => {
      awaitedLaunchesRef.current.delete(
        agentLaunchWorkerClientMessageId(request),
      );
    },
  });
  // A delegated worker has no visible card and no chat connection of its own,
  // so nothing in `session` says the conversation is still working while one
  // runs. This flag is that missing signal, and it deliberately spans the whole
  // hand-off rather than any single step of it: queued behind the turn that
  // asked for it, being started, and finished but not yet handed back. Each of
  // those gaps used to settle the turn's status row into its past tense, freeze
  // its timer and free the composer — an answer that had visibly stopped
  // mid-sentence while the work it promised was still going on.
  const delegationInFlight =
    agentLaunchQueue.queued ||
    delegatedAgentLaunching ||
    session.messages.some(
      (message) =>
        message.delegatedAgentRun === true &&
        externalAgentRunInFlight(message),
    ) ||
    awaitedLaunchesRef.current.size > 0 ||
    pendingLaunchContinuations.length > 0;
  const agentLaunchScopeRef = useRef(session.sessionId ?? null);
  useEffect(() => {
    const scope = session.sessionId ?? null;
    if (agentLaunchScopeRef.current === scope) return;
    agentLaunchScopeRef.current = scope;
    awaitedLaunchesRef.current.clear();
    launchRoundOriginsRef.current.clear();
    continuedDelegatedTurnsRef.current.clear();
    setPendingLaunchContinuations([]);
  }, [session.sessionId]);

  // A refresh reconstructs every private worker from durable metadata, but the
  // in-memory map that owns their hand-backs is gone. Re-arm live workers and
  // enqueue terminal results that do not yet have a marked continuation.
  useLayoutEffect(() => {
    if (session.loadingSession) return;
    const continuedKeys = new Set<string>();
    for (const message of session.messages) {
      if (message.role !== "user" || !message.internalAgentContinuation) {
        continue;
      }
      for (const match of message.content.matchAll(
        /<!-- agent-launch-result:([^>]+) -->/g,
      )) {
        if (match[1]) continuedKeys.add(match[1]);
      }
    }

    const terminalResults: Array<{
      continuationKey: string;
      agentName: string;
      outcome: "completed" | "failed";
      content: string;
    }> = [];
    let runningWorkers = 0;
    for (let index = 0; index < session.messages.length; index += 1) {
      const message = session.messages[index];
      if (message?.role !== "assistant" || message.delegatedAgentRun !== true) {
        continue;
      }
      const continuationKey =
        message.clientMessageId ?? message.id ?? `delegated-${index}`;
      if (message.openGymRun) {
        continuedDelegatedTurnsRef.current.add(continuationKey);
        awaitedLaunchesRef.current.delete(continuationKey);
        continue;
      }
      const agentName = message.externalAgentName ?? "The delegated agent";
      if (message.externalAgentOutcome === "aborted") {
        continuedDelegatedTurnsRef.current.add(continuationKey);
        awaitedLaunchesRef.current.delete(continuationKey);
        continue;
      }
      if ((message.externalAgentOutcome ?? "running") === "running") {
        runningWorkers += 1;
        if (message.clientMessageId) {
          awaitedLaunchesRef.current.set(message.clientMessageId, {
            agentName,
            requestId: continuationKey,
            clientMessageId: message.clientMessageId,
          });
        }
        continue;
      }
      awaitedLaunchesRef.current.delete(continuationKey);
      if (
        continuedKeys.has(continuationKey) ||
        continuedDelegatedTurnsRef.current.has(continuationKey)
      ) {
        continuedDelegatedTurnsRef.current.add(continuationKey);
        continue;
      }
      continuedDelegatedTurnsRef.current.add(continuationKey);
      terminalResults.push({
        continuationKey,
        agentName,
        outcome:
          message.externalAgentOutcome === "completed" ? "completed" : "failed",
        content: externalAgentCardContent(message),
      });
    }
    if (terminalResults.length === 0) return;
    launchHopsRef.current = Math.max(1, launchHopsRef.current);
    const continuations = terminalResults.map((result, index) =>
      agentLaunchContinuationMessage({
        continuationId: result.continuationKey,
        agentName: result.agentName,
        outcome: result.outcome,
        content: result.content,
        remaining: runningWorkers + terminalResults.length - index - 1,
      }),
    );
    setPendingLaunchContinuations((current) => [
      ...current,
      ...continuations,
    ]);
  }, [session.loadingSession, session.messages]);
  // The stream hands launch requests to the session hook, which does not launch
  // anything itself; this is where they meet the surface that can.
  const handleAgentLaunchEvent = agentLaunchQueue.handleEvent;
  useLayoutEffect(() => {
    // Restored messages can arrive from the tab snapshot one paint before the
    // authoritative conversation id. Feeding their recovered launch into the
    // scoped queue in that paint marks it seen under the null scope; once the
    // real id arrives the request is still in the queue, but can no longer be
    // selected or re-enqueued. Wait until the owning conversation is known so
    // leaving Terminal during agent_launch cannot strand the hand-off.
    if (session.loadingSession || !session.sessionId) return;
    for (const request of session.agentLaunchRequests) {
      handleAgentLaunchEvent({ type: "agent_launch", ...request });
    }
  }, [
    session.agentLaunchRequests,
    session.loadingSession,
    session.sessionId,
    handleAgentLaunchEvent,
  ]);

  // The result of a finished run, handed back as a new turn once the surface is
  // idle — a submit made while the run's turn is still settling is dropped.
  const sendAgentContinuation = session.send;
  const pendingLaunchContinuation = pendingLaunchContinuations[0] ?? null;
  useEffect(() => {
    if (!pendingLaunchContinuation || !launchReady) return;
    const continuation = pendingLaunchContinuation;
    const timer = window.setTimeout(() => {
      void sendAgentContinuation(continuation, {
        model,
        reasoningEffort,
        internalAgentContinuation: true,
        // `send` can still refuse a stale callback at its ref-backed guards.
        // Keep the hand-off live until it has actually accepted the optimistic
        // continuation rows; clearing before this callback stranded the exact
        // "I've handed it off" response shown in the bug report.
        onTurnStarted: () =>
          setPendingLaunchContinuations((current) =>
            current[0] === continuation
              ? current.slice(1)
              : current.filter((item) => item !== continuation),
          ),
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

  const steer = useCallback(
    async (text: string): Promise<boolean> => {
      const trimmed = text.trim();
      if (!trimmed || runtimeUnavailable) return false;
      return session.steer(trimmed);
    },
    [runtimeUnavailable, session],
  );

  const sendQueued = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || runtimeUnavailable) return;
      if (
        routeSocialsManagerCommand(trimmed) ||
        routeOpenGymCommand(trimmed) ||
        routeGodsEyeCommand(trimmed) ||
        routeHardwareBlueprintCommand(trimmed) ||
        routeParametricCadCommand(trimmed) ||
        routeHyperframesCommand(trimmed) ||
        routeResource2SkillCommand(trimmed) ||
        routeMatraixCommand(trimmed) ||
        routeBoltSlidesCommand(trimmed) ||
        routeClassroomCommand(trimmed) ||
        routeOpenMontageCommand(trimmed) ||
        routeOpenworkCommand(trimmed) ||
        routeOpenscienceCommand(trimmed) ||
        routePraxistCommand(trimmed) ||
        routeInboxZeroCommand(trimmed) ||
        routeVimaxCommand(trimmed) ||
      routeVoxDirectorCommand(trimmed) ||
        routeMoneyPrinterCommand(trimmed) ||
        routeLegalCommand(trimmed) ||
        routeWardrobeCommand(trimmed)
      ) {
        return;
      }
      if (routeDeepResearchCommand(trimmed)) return;
      if (deepResearch.agent) {
        await deepResearch.launch(trimmed);
        return;
      }
      await session.send(trimmed, { model, reasoningEffort });
    },
    [
      deepResearch,
      model,
      reasoningEffort,
      routeDeepResearchCommand,
      routeSocialsManagerCommand,
      routeOpenGymCommand,
      routeGodsEyeCommand,
      routeHardwareBlueprintCommand,
      routeParametricCadCommand,
      routeHyperframesCommand,
      routeResource2SkillCommand,
      routeMatraixCommand,
      routeBoltSlidesCommand,
      routeClassroomCommand,
      routeOpenMontageCommand,
      routeOpenworkCommand,
      routeOpenscienceCommand,
      routePraxistCommand,
      routeInboxZeroCommand,
      routeVimaxCommand,
    routeVoxDirectorCommand,
      routeMoneyPrinterCommand,
      routeLegalCommand,
      routeWardrobeCommand,
      runtimeUnavailable,
      session,
    ],
  );

  const handleExternalAgentTerminal = useCallback(
    (
      clientMessageId: string,
      result: Omit<ExternalAgentTurnResult, "clientMessageId">,
    ) => {
      if (settlingExternalTurnsRef.current.has(clientMessageId)) return;
      settlingExternalTurnsRef.current.add(clientMessageId);
      void (async () => {
        try {
          // The terminal owner must be in the transcript before a delegated
          // handback starts. Otherwise the new assistant turn can render while
          // its owner is still "running", which suppresses message actions and
          // leaves the composer Stop button latched.
          await finishExternalAgentTurn({ clientMessageId, ...result });
        } catch (cause) {
          settlingExternalTurnsRef.current.delete(clientMessageId);
          setAttachmentStatus(
            cause instanceof Error
              ? cause.message
              : "The external agent result could not be saved.",
          );
          return;
        }
        const presentationOwned = session.messages.some(
          (message) =>
            message.role === "assistant" &&
            message.clientMessageId === clientMessageId &&
            Boolean(message.openGymRun),
        );
        if (presentationOwned) {
          continuedDelegatedTurnsRef.current.add(clientMessageId);
          awaitedLaunchesRef.current.delete(clientMessageId);
          return;
        }
        if (result.outcome === "aborted") {
          continuedDelegatedTurnsRef.current.add(clientMessageId);
          awaitedLaunchesRef.current.delete(clientMessageId);
          return;
        }
        // If the assistant started this run and asked to hear how it went, hand
        // the outcome back as a new turn. The turn is identified by not having
        // existed when the launch was submitted, so a run the user started
        // themselves never joins the chain.
        const awaited = awaitedLaunchesRef.current.get(clientMessageId);
        if (!awaited) return;
        awaitedLaunchesRef.current.delete(clientMessageId);
        if (continuedDelegatedTurnsRef.current.has(clientMessageId)) return;
        continuedDelegatedTurnsRef.current.add(clientMessageId);
        if (launchHopsRef.current >= MAX_AGENT_LAUNCH_HOPS) {
          setAttachmentStatus(
            `${awaited.agentName} finished. The assistant has handed off ${launchHopsRef.current} times in a row, so it is waiting for you before going further.`,
          );
          return;
        }
        setPendingLaunchContinuations((current) => [
          ...current,
          agentLaunchContinuationMessage({
            continuationId: clientMessageId,
            agentName: awaited.agentName,
            outcome: result.outcome,
            content: result.content,
            remaining: awaitedLaunchesRef.current.size,
          }),
        ]);
      })();
    },
    [finishExternalAgentTurn, session.messages],
  );

  const handleStopRequested = useCallback(
    (externalClientMessageIds: string[]) => {
      for (const clientMessageId of externalClientMessageIds) {
        continuedDelegatedTurnsRef.current.add(clientMessageId);
        awaitedLaunchesRef.current.delete(clientMessageId);
      }
      setPendingLaunchContinuations([]);
      if (awaitedLaunchesRef.current.size === 0) launchHopsRef.current = 0;
    },
    [],
  );

  const editMessage = useCallback(
    (messageIndex: number, text: string, branchGroupId: string) => {
      if (runtimeUnavailable) return;
      if (
        routeSocialsManagerCommand(text, { branchGroupId }) ||
        routeOpenGymCommand(text, { branchGroupId }) ||
        routeGodsEyeCommand(text, { branchGroupId }) ||
        routeHardwareBlueprintCommand(text, { branchGroupId }) ||
        routeParametricCadCommand(text, { branchGroupId }) ||
        routeHyperframesCommand(text, { branchGroupId }) ||
        routeResource2SkillCommand(text, { branchGroupId }) ||
        routeMatraixCommand(text, { branchGroupId }) ||
        routeBoltSlidesCommand(text, { branchGroupId }) ||
        routeClassroomCommand(text, [], { branchGroupId }) ||
        routeOpenMontageCommand(text, { branchGroupId }) ||
        routeOpenworkCommand(text, { branchGroupId }) ||
        routeOpenscienceCommand(text, { branchGroupId }) ||
        routePraxistCommand(text, { branchGroupId }) ||
        routeInboxZeroCommand(text, { branchGroupId }) ||
        routeVimaxCommand(text, { branchGroupId }) ||
        routeVoxDirectorCommand(text, { branchGroupId }) ||
        routeMoneyPrinterCommand(text, { branchGroupId }) ||
        routeLegalCommand(text, [], { branchGroupId }) ||
        routeWardrobeCommand(text, [], { branchGroupId })
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
      routeOpenGymCommand,
      routeGodsEyeCommand,
      routeHardwareBlueprintCommand,
      routeParametricCadCommand,
      routeHyperframesCommand,
      routeResource2SkillCommand,
      routeMatraixCommand,
      routeBoltSlidesCommand,
      routeClassroomCommand,
      routeOpenMontageCommand,
      routeOpenworkCommand,
      routeOpenscienceCommand,
      routePraxistCommand,
      routeInboxZeroCommand,
      routeVimaxCommand,
    routeVoxDirectorCommand,
      routeMoneyPrinterCommand,
      routeLegalCommand,
      routeWardrobeCommand,
      runtimeUnavailable,
      session,
    ],
  );

  const selectBranch = useCallback(
    (messages: typeof session.messages) => session.setMessages(messages),
    [session],
  );

  const addAttachmentFiles = useCallback(async (files: File[]) => {
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
      if (distillErrors.length > 0)
        setAttachmentStatus(distillErrors.join(" · "));
    } finally {
      setExtractingAttachments(false);
    }
  }, []);

  const handleAttachmentInput = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files ?? []);
      event.target.value = "";
      void addAttachmentFiles(files);
    },
    [addAttachmentFiles],
  );

  // An opener is a starting point, not a message. It lands in the composer with
  // the caret at the end, so the obvious next move is to finish the sentence
  // rather than to undo a turn that has already left. Every routing decision
  // the openers used to make for themselves now happens on the ordinary submit
  // path, which is the only place that has to be right about it.
  const fillComposerWithPrompt = useCallback((text: string) => {
    setInput(text);
    window.setTimeout(() => {
      const composer = composerTextareaRef.current;
      if (!composer) return;
      composer.focus();
      composer.setSelectionRange(composer.value.length, composer.value.length);
    }, 0);
  }, []);

  const retryMessage = useCallback(
    (userMessageIndex: number, branchGroupId: string) => {
      if (runtimeUnavailable) return;
      const previousUser = session.messages[userMessageIndex];
      if (previousUser) {
        if (
          routeSocialsManagerCommand(previousUser.content, { branchGroupId }) ||
          routeOpenGymCommand(previousUser.content, { branchGroupId }) ||
          routeGodsEyeCommand(previousUser.content, { branchGroupId }) ||
          routeHardwareBlueprintCommand(previousUser.content, {
            branchGroupId,
          }) ||
          routeParametricCadCommand(previousUser.content, { branchGroupId }) ||
          routeHyperframesCommand(previousUser.content, { branchGroupId }) ||
          routeResource2SkillCommand(previousUser.content, { branchGroupId }) ||
          routeMatraixCommand(previousUser.content, { branchGroupId }) ||
        routeBoltSlidesCommand(previousUser.content, { branchGroupId }) ||
          routeClassroomCommand(previousUser.content, [], { branchGroupId }) ||
          routeOpenMontageCommand(previousUser.content, { branchGroupId }) ||
          routeOpenworkCommand(previousUser.content, { branchGroupId }) ||
          routeOpenscienceCommand(previousUser.content, { branchGroupId }) ||
          routePraxistCommand(previousUser.content, { branchGroupId }) ||
          routeInboxZeroCommand(previousUser.content, { branchGroupId }) ||
          routeVimaxCommand(previousUser.content, { branchGroupId }) ||
          routeVoxDirectorCommand(previousUser.content, { branchGroupId }) ||
          routeMoneyPrinterCommand(previousUser.content, { branchGroupId }) ||
          routeLegalCommand(previousUser.content, [], { branchGroupId }) ||
          routeWardrobeCommand(previousUser.content, [], { branchGroupId })
        ) {
          return;
        }
        if (routeMaxResearchCommand(previousUser.content, { branchGroupId })) {
          return;
        }
        if (routeDeepResearchCommand(previousUser.content, { branchGroupId })) {
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
      routeMaxResearchCommand,
      routeSocialsManagerCommand,
      routeOpenGymCommand,
      routeGodsEyeCommand,
      routeHardwareBlueprintCommand,
      routeParametricCadCommand,
      routeHyperframesCommand,
      routeResource2SkillCommand,
      routeMatraixCommand,
      routeBoltSlidesCommand,
      routeClassroomCommand,
      routeOpenMontageCommand,
      routeOpenworkCommand,
      routeOpenscienceCommand,
      routePraxistCommand,
      routeInboxZeroCommand,
      routeVimaxCommand,
    routeVoxDirectorCommand,
      routeMoneyPrinterCommand,
      routeLegalCommand,
      routeWardrobeCommand,
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
    setOpenExecutiveAgent(null);
    setTradingAgentsAgent(null);
    setVibeTradingAgent(null);
    setDeerFlowAgent(null);
    setShortsAgent(null);
    setFormsmithAgent(null);
    setStockAnalystAgent(null);
    // The retained text has already been written under the outgoing chat's
    // draft key. Release its in-memory shadow before changing keys so a late
    // acknowledgement cannot clear a newer submission with identical text.
    submittedDraftSequence.current += 1;
    setSubmittedDraft(null);
    session.reset();
    setInput("");
    // The unstarted chat's draft is deliberately left alone. It is only ever
    // written by someone typing into a blank composer and never sending, and
    // since a send clears it explicitly, anything still in it is an unsent
    // message — the one kind of text nothing else has a copy of. Clearing it
    // here used to be harmless because an unsent draft was carried onto
    // whichever chat opened next; now that it stays where it was written,
    // this was the only thing that could destroy it.
    setChatAttachments([]);
    setAttachmentStatus("");
  }

  function openHistorySession(sessionId: string) {
    setProductPanel(null);
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
    setOpenExecutiveAgent(null);
    setTradingAgentsAgent(null);
    setVibeTradingAgent(null);
    setDeerFlowAgent(null);
    setShortsAgent(null);
    setFormsmithAgent(null);
    setStockAnalystAgent(null);
    if (sessionId !== session.sessionId) {
      // Let useChatDraft restore this text if the original request never became
      // durable. Keeping the shadow across chats would make the outgoing words
      // look like the incoming chat's current draft instead.
      submittedDraftSequence.current += 1;
      setSubmittedDraft(null);
    }
    // Only chats that are on the record can be reopened at all, so arriving at
    // one always ends temporary mode.
    setTemporaryChat(false);
    chatBeforeTemporary.current = null;
    // The selected transcript loads independently from the lightweight rail.
    void session.openSession(sessionId);
    setChatAttachments([]);
    setAttachmentStatus("");
  }

  /**
   * Turn temporary chat on or off. Either direction starts or restores a
   * different conversation, because the promise is made when a chat is created
   * and cannot be added to or taken from one that has already spoken.
   */
  function toggleTemporaryChat() {
    // Switching modes resets the selected session. During the first beat of a
    // turn, the optimistic transcript can already say "Thinking" while its
    // conversation is still being created; resetting then would leave those
    // rows with nowhere durable to land. A temporary chat is also intentionally
    // absent from history, so leaving one mid-turn would make it unreachable.
    if (currentChatActive) return;
    if (temporaryChat) {
      const previous = chatBeforeTemporary.current;
      chatBeforeTemporary.current = null;
      setTemporaryChat(false);
      // Back to where the detour started, or to a blank ordinary chat if that
      // one is gone (or if temporary mode was entered from a blank one).
      if (previous) openHistorySession(previous);
      else startNewChat();
      return;
    }
    chatBeforeTemporary.current = session.sessionId;
    setTemporaryChat(true);
    startNewChat();
  }

  /**
   * The rail's New chat. It always makes an ordinary, saved chat: asking for a
   * new chat from inside a temporary one is how you leave.
   */
  function startNewSavedChat() {
    // New chat is a destination, not a reset command. Repeating it while the
    // untouched destination is already selected used to detach state a second
    // time and could make a finishing background chat look newly unread.
    if (blankSavedChatSelected) return;
    chatBeforeTemporary.current = null;
    setTemporaryChat(false);
    startNewChat();
  }

  // Deleting a chat stops it: the route cancels the turn, the terminal command
  // and any agent run it still has going before it removes the rows. So this no
  // longer refuses while a response is streaming — that was a rule about our
  // bookkeeping, and the confirmation says what will happen instead.
  //
  // All that stopping is round trips of its own, so the delete is optimistic:
  // the row leaves on the click and the request finishes behind it. The epoch
  // bump drops polls already in flight, and deleteChatSession hides the id from
  // the ones that start while it works, so a pre-delete snapshot cannot ghost
  // the chat back into the rail. Only a refusal brings the row back.
  async function deleteHistorySession(item: TerminalSidebarChat) {
    const confirmed = await confirm({
      title: "Delete this chat?",
      subject: `“${item.title}”`,
      body: "Anything it is still running is stopped, and its messages and any artifacts it produced are removed for good.",
      confirmLabel: "Delete chat",
    });
    if (!confirmed) return;
    setHistoryError(null);
    historyEpoch.current += 1;
    setHistory((current) => current.filter((entry) => entry.id !== item.id));
    // The open chat is on its way out; fall back to an empty one.
    if (item.id === session.sessionId) startNewChat();
    const result = await deleteChatSession(item.id);
    historyEpoch.current += 1;
    if (!result.deleted) {
      setHistoryError(result.error ?? "This chat could not be deleted.");
      // The chat is still on the server, so ask for the list again rather than
      // guessing where its row belonged. The reader stays in the blank chat
      // they were moved to: reopening the survivor over whatever they have
      // since typed would cost more than the click of opening it themselves.
      notifyHermesSessionsChanged("dashboard_terminal");
      return;
    }
    invalidateHermesSessionSummaries("dashboard_terminal");
    // Local traces go only once the chat is really gone — a failed delete
    // would otherwise take the unsent draft with it.
    forgetUnreadChats([item.id]);
    forgetChatDrafts(window.localStorage, "dashboard_terminal", [item.id]);
  }

  // Bulk delete from the rail's Recents menu. Every row leaves at once and the
  // requests run behind them one at a time: the route stops each chat's live
  // work and then removes the conversation and its runtime sessions in one
  // transaction, so a partial result is still possible and has to be reported
  // rather than assumed away. Ten chats therefore cost one click rather than
  // ten waits — the rail is settled long before the last request lands.
  async function deleteHistorySessions(items: TerminalSidebarChat[]) {
    if (items.length === 0) return;
    const single = items.length === 1;
    const confirmed = await confirm({
      title: single ? "Delete this chat?" : `Delete ${items.length} chats?`,
      subject: single ? `“${items[0].title}”` : null,
      body: single
        ? "Anything it is still running is stopped, and its messages and any artifacts it produced are removed for good."
        : "Anything they are still running is stopped, and their messages and any artifacts they produced are removed for good.",
      confirmLabel: single ? "Delete chat" : `Delete ${items.length} chats`,
    });
    if (!confirmed) return;
    setHistoryError(null);
    const targets = new Set(items.map((item) => item.id));
    historyEpoch.current += 1;
    setHistory((current) => current.filter((entry) => !targets.has(entry.id)));
    // The open chat may be among them; fall back to an empty one.
    if (session.sessionId && targets.has(session.sessionId)) startNewChat();
    const deleted = new Set<string>();
    let firstError: string | null = null;
    for (const item of items) {
      const result = await deleteChatSession(item.id);
      if (result.deleted) deleted.add(item.id);
      else firstError ??= result.error ?? "This chat could not be deleted.";
    }
    historyEpoch.current += 1;
    invalidateHermesSessionSummaries("dashboard_terminal");
    if (deleted.size > 0) {
      forgetUnreadChats(deleted);
      forgetChatDrafts(window.localStorage, "dashboard_terminal", deleted);
    }
    const failed = items.length - deleted.size;
    if (failed > 0) {
      setHistoryError(
        failed === 1 && firstError
          ? firstError
          : `${failed} of ${items.length} chats could not be deleted.`,
      );
      // Some of these chats survived. Reload rather than reinsert, so the ones
      // that are still there come back in their real order.
      notifyHermesSessionsChanged("dashboard_terminal");
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
    unread: unreadChats.has(item.id),
  }));
  // A blank conversation has no durable id until its first turn is sent. Put
  // its row in Recents from the first typed character, so the rail responds to
  // the draft immediately instead of waiting for session creation and a
  // history refresh. It adopts the real id during send and stays put until the
  // durable summary replaces it.
  const pendingChatId = !temporaryChat
    ? session.sessionId === null &&
      (input || submittedDraft || "").trim().length > 0
      ? PENDING_CHAT_ROW_ID
      : session.sessionId !== null &&
          session.createdSessionId === session.sessionId &&
          !history.some((item) => item.id === session.sessionId)
        ? session.sessionId
        : null
    : null;
  const railChats: TerminalSidebarChat[] = pendingChatId !== null
    ? [
        {
          id: pendingChatId,
          title: "New chat",
          updatedAt: "",
          active: false,
          pinned: false,
          pending: true,
          highlight: null,
          unread: false,
        },
        ...sidebarChats,
      ]
    : sidebarChats;
  // The rollup the dock bar carries. A chat still running is not counted: the
  // dot says something is waiting to be read, not that something is happening.
  const unreadCount = sidebarChats.filter(
    (chat) => chat.unread && !chat.active,
  ).length;
  const unreadLabel =
    unreadCount === 1
      ? "1 chat finished and has not been read"
      : `${unreadCount} chats finished and have not been read`;
  // The shut bar shows a dot with no words beside it, so the words go on the
  // bar itself — it is the button that opens the terminal.
  const unreadSuffix = unreadCount > 0 ? ` — ${unreadLabel}` : "";

  function togglePanel(panel: TerminalPanel) {
    setProductPanel(null);
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
              ...(body.highlight === undefined
                ? {}
                : { highlight: body.highlight }),
            }
          : entry,
      ),
    );
    try {
      const response = await fetch(
        `/api/hermes/sessions/${encodeURIComponent(item.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
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
          if (body.title !== undefined && entry.title === body.title)
            next.title = item.title;
          if (body.pinned !== undefined && entry.pinned === body.pinned)
            next.pinned = item.pinned;
          if (
            body.highlight !== undefined &&
            entry.highlight === body.highlight
          ) {
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

  function cancelGlide() {
    if (glideTimer.current !== null) {
      window.clearTimeout(glideTimer.current);
      glideTimer.current = null;
    }
    if (glideRaf.current !== null) {
      window.cancelAnimationFrame(glideRaf.current);
      glideRaf.current = null;
    }
    prewarmRef.current = false;
    setGlide(null);
    setGlideBox(null);
    setGlideShift(0);
    setGlideMoving(false);
  }

  // Pressing the collapsed bar builds the opening glide's first frame there and
  // then — the box at its open size, pushed far enough down that only the bar
  // shows, which is pixel for pixel what was already on screen. Nothing moves,
  // but the body mounts and lays out while the finger is still down, so the
  // release only has to flip the offset. Without this the release paid for the
  // mount of the most expensive box on the page before it could move at all,
  // and that wait is the lag between the click and the dock answering it.
  function prewarmOpen() {
    if (isOpen || glide || prefersReducedMotion()) return;
    // Clicking the collapsed bar is an explicit request for the full terminal,
    // not for the last height left behind by a drag.
    const box = Math.max(openHeight(null), MIN_HEIGHT);
    prewarmRef.current = true;
    setGlide("opening");
    setGlideBox(box);
    setGlideShift(box - COLLAPSED_HEIGHT);
    setGlideMoving(false);
  }

  // Where the dock's top edge actually is: neither the height in state nor the
  // box's own height, once a glide has the box sitting below the viewport.
  function visualHeight(): number {
    const dock = dockRef.current;
    if (!dock) return height;
    return Math.max(
      MIN_HEIGHT,
      Math.round(window.innerHeight - dock.getBoundingClientRect().top),
    );
  }

  // The one place the dock is opened or closed outright; everything else moves
  // it by dragging. The timer only outlives the animation to put the box back
  // on its own height, so the next drag starts unencumbered.
  function toggleDock(open: boolean) {
    // Read the edge before cancelling: a glide caught mid-flight is reversed
    // from wherever it had got to, not from where it was headed.
    const from = visualHeight();
    // Whether the dock is mid-travel decides how it may be restarted, and it
    // has to be read before the state below is rewritten. A prewarm is not
    // travel: it holds a start frame and moves nothing.
    const moving = glideMoving;
    // A prewarmed open must not be torn down and rebuilt: the frame it starts
    // from is the one already on screen, and cancelling would throw away the
    // mount this release was waiting for.
    const warm = open && prewarmRef.current;
    if (!warm) cancelGlide();
    prewarmRef.current = false;
    const reduced = prefersReducedMotion();
    if (open) {
      focusComposerAfterOpenRef.current = true;
      // Fully open, the dock is the page: everything the reader had scrolled
      // past is behind it, and the strip left showing above it should be the
      // top of the dashboard rather than whichever row of gardens happened to
      // be under the cursor. The height it opens to already reserves the navbar
      // this brings back, so the two movements arrive together.
      window.scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" });
    }
    // Header clicks and keyboard activation always open the dock fully. The
    // remembered drag height is still useful for renderer/session restores,
    // but must not turn a deliberate open into a partial-height terminal.
    const target = open ? openHeight(null) : COLLAPSED_HEIGHT;
    setHeight(target);
    if (reduced) {
      cancelGlide();
      return;
    }
    // Opening, the box takes the size it will end at; closing, it keeps the one
    // it had. Either way the height above has already settled what counts as
    // open, so the header retracts and the body learns it is on its way out
    // while the box it lives in stays exactly as big as it was.
    const box = Math.max(open ? target : from, MIN_HEIGHT);
    const settle = () => {
      glideTimer.current = window.setTimeout(
        () => {
          glideTimer.current = null;
          setGlide(null);
          setGlideBox(null);
          setGlideShift(0);
          setGlideMoving(false);
        },
        open ? DOCK_OPEN_MS : DOCK_CLOSE_MS,
      );
    };
    setGlide(open ? "opening" : "closing");
    setGlideBox(box);

    // A dock standing still is already painting the frame its glide starts
    // from: a prewarmed open has been holding its offset since the press, and a
    // close starts from the dock's own resting position, which this commit
    // leaves where it is because glideBox holds the height the box already had.
    // Neither has anything to wait for, so the move goes in this commit and the
    // dock is travelling on the very next frame.
    if (!moving && (warm || !open)) {
      setGlideMoving(true);
      setGlideShift(open ? 0 : box - COLLAPSED_HEIGHT);
      settle();
      return;
    }

    // Everything else owes two frames of stillness first. A cold open —
    // keyboard, or a press that never got to prewarm — mounts the entire
    // terminal in the commit above, and a transition started in the same frame
    // spends its first stretch waiting on that work, which is the stutter this
    // exists to remove. A reversal has a subtler debt: the box is mid-travel
    // and about to be resized under itself, so its new resting offset has to be
    // painted once before it can be animated away from, or the dock jumps.
    setGlideShift(open ? box - from : 0);
    glideRaf.current = window.requestAnimationFrame(() => {
      glideRaf.current = window.requestAnimationFrame(() => {
        glideRaf.current = null;
        setGlideMoving(true);
        setGlideShift(open ? 0 : box - COLLAPSED_HEIGHT);
        settle();
      });
    });
  }

  function handleResizeStart(event: ReactPointerEvent<HTMLElement>) {
    event.preventDefault();
    const isHeader = event.currentTarget.tagName === "HEADER";
    if (isHeader) headerClickGuard.beginPointerSequence();
    resizeStartRef.current = {
      startY: event.clientY,
      // Where the edge actually is, which is not the height in state while a
      // glide is still running.
      startHeight: visualHeight(),
      // Whether it counts as open, though, is the state's call: caught halfway
      // through closing the dock is still tall, and a click there means "open
      // it again", not "close it twice".
      wasOpen: isOpen,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsResizing(true);
    document.body.style.cursor = "var(--bb-cursor-row-resize, row-resize)";
    document.body.style.userSelect = "none";
    // Only the header toggles on release, so only a press there is worth
    // prewarming; the thin edge handle above it is always a drag.
    if (isHeader && !isOpen) prewarmOpen();
  }

  function handleResizeMove(event: ReactPointerEvent<HTMLElement>) {
    const start = resizeStartRef.current;
    if (!start) return;
    // Past the click threshold the pointer owns the edge, so a glide still
    // running has to let go of it. Below the threshold this is the jitter of a
    // click being held, and cancelling there would snap a dock mid-travel.
    if (glide && Math.abs(start.startY - event.clientY) >= 4) cancelGlide();
    setHeight(
      settleHeight(
        clampHeight(start.startHeight + (start.startY - event.clientY)),
      ),
    );
  }

  function handleResizeEnd(event: ReactPointerEvent<HTMLElement>) {
    const start = resizeStartRef.current;
    if (!start) return;
    const moved = Math.abs(start.startY - event.clientY) >= 4;
    const clickedHeader = event.currentTarget.tagName === "HEADER";
    resizeStartRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setIsResizing(false);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    if (clickedHeader) headerClickGuard.endPointerSequence();
    if (!moved && event.type !== "pointercancel" && clickedHeader) {
      toggleDock(!start.wasOpen);
    } else if (prewarmRef.current) {
      // The press prewarmed an open this release turned out not to want — a
      // cancelled pointer, or a drag that ended within the click threshold.
      // Nothing of it was ever visible, so putting it back is invisible too.
      cancelGlide();
    }
  }

  async function stopHistorySession(item: TerminalSidebarChat) {
    if (!item.active || item.pending) return;
    setHistoryError(null);
    try {
      const response = await fetch(
        `/api/hermes/sessions/${encodeURIComponent(item.id)}/abort`,
        { method: "POST" },
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof body.error === "string"
            ? body.error
            : "This chat could not be stopped.",
        );
      }
      setHistory((current) =>
        current.map((entry) =>
          entry.id === item.id ? { ...entry, active: false } : entry,
        ),
      );
      invalidateHermesSessionSummaries("dashboard_terminal");
      if (session.sessionId === item.id) {
        // The rail can stop a run after its browser stream disconnected. Reopen
        // from the now-terminal durable row so the transcript and composer do
        // not retain that disconnected local state.
        await session.openSession(item.id);
      }
    } catch (cause) {
      setHistoryError(
        cause instanceof Error ? cause.message : "This chat could not be stopped.",
      );
    }
  }

  function handleHeaderClick(event: ReactMouseEvent<HTMLElement>) {
    if (
      event.target instanceof Element &&
      event.target.closest("button, a, input, select, textarea")
    ) {
      return;
    }
    if (!headerClickGuard.shouldHandleClick() || isOpen) return;
    // Pointer events normally own this interaction. A standalone click is the
    // hydration bridge replaying a gesture that landed before those handlers
    // existed, so it must still be able to open the collapsed terminal.
    toggleDock(true);
  }

  const terminalStyle: CSSProperties = {
    // A glide lends the box its own height and moves it by offset instead, so
    // nothing inside is resized while it travels; dragging owns the height
    // directly, one frame at a time, exactly as before.
    height: glideBox ?? height,
    transform: glide ? `translate3d(0, ${glideShift}px, 0)` : undefined,
    // Set for the span of a click-driven open or close and no longer: a dragged
    // edge carrying a transition trails the pointer rather than tracking it.
    transition: glideMoving
      ? glide === "opening"
        ? `transform ${DOCK_OPEN_MS}ms ${DOCK_OPEN_EASING}`
        : `transform ${DOCK_CLOSE_MS}ms ${DOCK_CLOSE_EASING}`
      : undefined,
    willChange: glide ? "transform" : undefined,
    // Once the shader owns the bar, the dock's fill has to get out of the way:
    // the scene layer paints above it, and a solid dock would just be a second,
    // flatter surface behind the glass.
    //
    // The surface follows the body rather than `isOpen`, or a closing dock
    // would drop to the bar's color for the length of its own animation, with
    // the transcript still standing on it.
    background: glassActive
      ? "transparent"
      : bodyMounted
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
          <canvas
            ref={glassSceneRef}
            aria-hidden
            className="bb-terminal-glass-scene"
          />
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
            isResizing
              ? "bg-[#8faf9a]"
              : "bg-[#A9C1B1] group-hover:bg-[#8faf9a]"
          }`}
        />
      </div>

      <header
        onPointerDown={handleResizeStart}
        onPointerMove={handleResizeMove}
        onPointerUp={handleResizeEnd}
        onPointerCancel={handleResizeEnd}
        onClick={handleHeaderClick}
        role={isOpen ? undefined : "button"}
        tabIndex={isOpen ? undefined : 0}
        aria-expanded={isOpen ? undefined : false}
        aria-label={isOpen ? undefined : `Open terminal${unreadSuffix}`}
        title={
          isOpen
            ? "Click empty space to close, or drag to resize the terminal"
            : `Click to fully open, or drag up to resize the terminal${unreadSuffix}`
        }
        onKeyDown={(event) => {
          if (!isOpen && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            toggleDock(true);
          }
        }}
        ref={barRef}
        style={{
          background: glassActive ? "transparent" : "var(--terminal-bar)",
        }}
        className={`bb-neu-toolbar flex h-12 shrink-0 cursor-row-resize touch-none select-none items-center gap-3 border-b border-[rgba(169,193,177,0.55)] px-4 py-0 ${
          // The brown bar has one invariant height. The reconnect button is
          // taller than the title, so content-driven vertical padding made the
          // whole dock jump whenever that button appeared or disappeared.
          headerMounted ? "" : "justify-center"
        } ${glassActive ? "bb-terminal-glass-bar" : ""}`}
      >
        {headerMounted ? (
          <>
            {/* No rail toggle here: the rail is opened and closed by its own
                edge, the divider between it and the transcript. */}
            <div
              style={{ animationDelay: headerClosing ? "0ms" : "40ms" }}
              className={`${headerItemAnim} flex min-w-0 items-center gap-2`}
            >
              {/* One dot, one job: Terminal connectivity. Optional knowledge
                  retrieval has its own status surface and must not make a
                  working Terminal look disconnected. */}
              {!runtimeOnline ? (
                <span
                  role="status"
                  aria-label="Agent runtime is unavailable"
                  title="Agent runtime unavailable"
                  className="h-2 w-2 shrink-0 rounded-full bg-[#B65B5B]"
                />
              ) : (
                <UnreadChatDot
                  label={
                    unreadCount > 0 ? unreadLabel : "Agent runtime is available"
                  }
                />
              )}
              <p className="truncate text-sm font-semibold text-[var(--terminal-bar-ink)]">
                Terminal
              </p>
              {unreadCount > 1 ? (
                <span
                  aria-hidden
                  title={unreadLabel}
                  className="shrink-0 text-[11px] font-medium text-[var(--terminal-bar-ink-muted)]"
                >
                  {unreadCount}
                </span>
              ) : null}
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
                  className="neu-button inline-flex h-7 w-7 items-center justify-center rounded-lg border border-[color-mix(in_srgb,var(--danger)_32%,var(--line))] bg-[var(--paper-raised)] p-0 text-[var(--danger)] transition-[transform,background-color,opacity] duration-150 hover:bg-[var(--paper-strong)] active:scale-[0.97] disabled:cursor-wait disabled:opacity-65"
                >
                  {refreshingTerminal ? (
                    <BreadboardLoader className="h-3.5 w-3.5" />
                  ) : (
                    <svg
                      aria-hidden="true"
                      className="h-3.5 w-3.5"
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
                  )}
                </button>
              ) : null}
            </div>
            {/* Artifacts, Uploads and Scheduled all live in the left rail now,
                and the rail's own divider opens it, so the header is down to
                the runtime state alone. Temporary chat sits in the chat itself,
                below this bar. */}
          </>
        ) : unreadCount > 0 ? (
          // Shut, the bar says nothing at all — except that an answer landed
          // while the terminal was closed. The count is spoken through the
          // header's own label, so the mark itself stays out of the reading.
          <span
            aria-hidden
            className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[var(--terminal-bar-ink-muted)]"
          >
            <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--signal-live)] shadow-[0_0_0_1px_var(--signal-live-ring)]" />
            {unreadCount > 1 ? unreadCount : null}
          </span>
        ) : null}
      </header>

      {bodyRendered ? (
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
            {/* The rail is always mounted. Closed, it keeps a narrow column of
              actions and its divider; there is no toolbar button to bring it
              back, so it must never leave the layout entirely. */}
            <TerminalSidebar
              surface="tinted"
              collapsed={rail.collapsed}
              onToggleCollapsed={rail.toggle}
              resize={rail}
              chats={railChats}
              loading={historyLoading}
              error={historyError}
              activeChatId={pendingChatId ?? session.sessionId}
              openPanel={sidePanel}
              onNewChat={startNewSavedChat}
              newChatDisabled={blankSavedChatSelected}
              onTogglePanel={togglePanel}
              onOpenSearch={() => setSearchOpen(true)}
              onPrefetchChat={(chat) => {
                void prefetchHermesSessionDetail("dashboard_terminal", chat.id).catch(
                  () => undefined,
                );
              }}
              onOpenChat={(chat) => {
                if (chat.pending) {
                  setSidePanel(null);
                  composerTextareaRef.current?.focus();
                  return;
                }
                openHistorySession(chat.id);
              }}
              onStopChat={stopHistorySession}
              onRenameChat={(chat, title) =>
                void patchHistorySession(
                  chat,
                  { title },
                  "This chat could not be renamed.",
                )
              }
              onTogglePin={(chat) =>
                void patchHistorySession(
                  chat,
                  { pinned: !chat.pinned },
                  chat.pinned
                    ? "This chat could not be unpinned."
                    : "This chat could not be pinned.",
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

            <div className="relative flex min-w-0 flex-1 flex-col">
              <input
                ref={attachmentInputRef}
                type="file"
                accept={TERMINAL_ATTACHMENT_ACCEPT}
                multiple
                onChange={handleAttachmentInput}
                className="hidden"
              />
              {/* Temporary chat is a choice made before the first turn, so its
                switch only belongs on the new-chat page. The banner below keeps
                an active temporary conversation identified after the switch is
                gone. */}
              {newChatPageSelected ? (
                <button
                  type="button"
                  onClick={toggleTemporaryChat}
                  disabled={currentChatActive}
                  aria-pressed={temporaryChat}
                  className={`absolute right-3 top-2 z-20 flex h-10 w-10 items-center justify-center rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
                    temporaryChat
                      ? "text-[#2F5C41]"
                      : "text-[#9AAAA1] hover:text-[#172A22]"
                  }`}
                  title={
                    currentChatActive
                      ? "Temporary chat can be changed after the current response finishes"
                      : temporaryChat
                        ? "Temporary chat is on — click to leave it. This chat is not in your history and is not used or saved as memory."
                        : "Temporary chat: start a chat that is kept out of your history and out of memory, both ways"
                  }
                  aria-label={
                    temporaryChat
                      ? "Turn off temporary chat"
                      : "Turn on temporary chat"
                  }
                >
                  {/* A message bubble drawn as a broken line: the shape of a chat,
                    without the part that lasts. While the mode is on it carries a
                    tick, so "this is on" is legible without comparing shades. */}
                  <svg
                    className="h-[26px] w-[26px]"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.7}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path
                      strokeDasharray="3.6 3"
                      d="M20.25 12a8.25 8.25 0 01-11.9 7.4L4 20.5l1.16-4.2A8.25 8.25 0 1120.25 12z"
                    />
                    {temporaryChat ? (
                      <path strokeWidth={2} d="M8.6 12.1l2.4 2.4 4.6-5" />
                    ) : null}
                  </svg>
                </button>
              ) : null}
              {/* The mode is a promise about what happens to what you type, so it
                says so in words rather than only through a lit-up icon. The
                right padding is the seat the floating switch occupies. */}
              {temporaryChat ? (
                <div
                  role="status"
                  className="flex shrink-0 items-center gap-2 border-b border-[rgba(169,193,177,0.45)] bg-[rgba(169,193,177,0.14)] py-2 pl-4 pr-12 text-[11px] text-[#2F5C41]"
                >
                  <svg
                    className="h-3.5 w-3.5 shrink-0"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.8}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path
                      strokeDasharray="3.6 3"
                      d="M20.25 12a8.25 8.25 0 01-11.9 7.4L4 20.5l1.16-4.2A8.25 8.25 0 1120.25 12z"
                    />
                  </svg>
                  <span>
                    <strong className="font-semibold">
                      Temporary chat enabled
                    </strong>
                  </span>
                </div>
              ) : null}
              <AgentRuntimePanel
                sessionId={session.sessionId}
                createdSessionId={session.createdSessionId}
                surface="dashboard_terminal"
                messages={session.messages}
                connection={session.connection}
                runState={session.runState}
                persistedRunActive={Boolean(session.activeRunId)}
                externalRunLaunching={externalRunLaunching || delegationInFlight}
                delegationInFlight={delegationInFlight}
                temporaryChat={temporaryChat}
                steerError={session.steerError}
                error={
                  runtimeUnavailable
                    ? RUNTIME_UNAVAILABLE_MESSAGE
                    : session.error
                }
                pendingPermission={session.pendingPermission}
                pendingClarification={session.pendingClarification}
                activities={session.activities}
                input={input}
                onInputChange={setInput}
                onGenerativeUiAction={handleGenerativeUiAction}
                composerTextareaRef={composerTextareaRef}
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
                steerableRun={Boolean(session.activeRunId) && !runtimeUnavailable}
                onSendQueued={sendQueued}
                onEditMessage={editMessage}
                onDeleteMessage={session.deleteMessage}
                onSelectBranch={selectBranch}
                disabled={runtimeUnavailable}
                onAbort={() => void session.abort()}
                onStopRequested={handleStopRequested}
                onPermissionDecision={(decision) =>
                  void session.respondToPermission(decision)
                }
                onClarificationAnswer={(answer) =>
                  void session.respondToClarification(answer)
                }
                onRetryMessage={retryMessage}
                onExternalAgentTerminal={handleExternalAgentTerminal}
                onExternalAgentSourceReady={() => {
                  void session.refreshSession();
                }}
                placeholder={
                  isPublic
                    ? "Ask anything across all public gardens…"
                    : "Ask anything."
                }
                model={selectedModel}
                models={models}
                onModelChange={changeModel}
                reasoningEffort={selectedReasoningEffort}
                onReasoningEffortChange={setReasoningEffort}
                intelligenceModes={selectedIntelligenceModes}
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
                onSelectMatraix={() => {}}
                onSelectBoltSlides={() => {}}
                onSelectClassroom={() => {}}
                onSelectGodsEye={() => {}}
                onSelectOpenMontage={() => {}}
                onSelectOpenwork={() => {}}
                onSelectOpenscience={() => {}}
                onSelectPraxist={() => {}}
                onSelectMaxResearch={() => {}}
                onSelectInboxZero={() => {}}
                onSelectVimax={() => {}}
                onSelectVoxDirector={() => {}}
                onSelectMoneyPrinter={() => {}}
                onSelectLegal={() => {}}
                onSelectWardrobe={() => {}}
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
                  void launchMeetingNotesRun(
                    input.trim(),
                    meetingNotesAgent ?? undefined,
                    {
                      uploadId: recording.uploadId,
                      filename: recording.filename,
                    },
                  );
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
                openExecutiveAgent={openExecutiveAgent}
                onSelectOpenExecutive={() => void selectOpenExecutive()}
                onClearOpenExecutive={() => {
                  setOpenExecutiveAgent(null);
                  setAttachmentStatus("");
                }}
                onSelectOpenGym={() => {}}
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
                onSubmitTradingAgents={(request) =>
                  void launchTradingAgentsRun(request)
                }
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
                onSubmitFormsmith={(request) =>
                  void launchFormsmithRun(request)
                }
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
                  // The mode still changes what is said — an off-the-record
                  // chat greets differently and opens with different questions
                  // — but the greeting itself is chosen by the hour and by what
                  // this person has actually been doing, not written into the
                  // markup.
                  <ChatGreetingEmptyState
                    greeting={chatGreeting.greeting}
                    suggestions={chatGreeting.suggestions}
                    onSelectSuggestion={fillComposerWithPrompt}
                    disabled={runtimeUnavailable}
                  />
                }
              />
            </div>
            {productPanel ? (
              <SidePanelDock
                label="Product details"
                defaultWidth={520}
                storageKey="breadboard:terminal:panel-width"
              >
                <ProductDetailsPanel
                  selection={productPanel}
                  onClose={() => setProductPanel(null)}
                  onAction={handleGenerativeUiAction}
                />
              </SidePanelDock>
            ) : sidePanel ? (
              <SidePanelDock
                label={
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
                defaultWidth={520}
                storageKey="breadboard:terminal:panel-width"
              >
                {sidePanel === "artifacts" ? (
                  <ArtifactPanel
                    compact
                    sourceSurface="dashboard_terminal"
                    creationConversationId={session.sessionId}
                    ensureCreationConversation={session.ensureConversation}
                  />
                ) : sidePanel === "uploads" ? (
                  <UploadsPanel
                    onOpenChat={(conversationId) =>
                      openHistorySession(conversationId)
                    }
                  />
                ) : sidePanel === "scheduled" ? (
                  <TerminalScheduledPanel surface="dashboard_terminal" />
                ) : sidePanel === "hooks" ? (
                  <HooksPanel />
                ) : (
                  <ProcessesPanel
                    onOpenChat={(conversationId) =>
                      openHistorySession(conversationId)
                    }
                    onOpenPanel={(panel) => setSidePanel(panel)}
                  />
                )}
              </SidePanelDock>
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

      {confirmDialog}
    </section>
  );
}
