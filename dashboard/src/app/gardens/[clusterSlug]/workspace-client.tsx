"use client";

import {
  Fragment,
  memo,
  useState,
  useRef,
  useEffect,
  useCallback,
  type PointerEvent as ReactPointerEvent,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { forkCluster } from "@/app/actions/clusters";
import AssistantComposer from "@/app/components/assistant-composer";
import AssistantMessageActions, {
  MessageActionsSlot,
} from "@/app/components/assistant-message-actions";
import { isDirectModeEnabled } from "@/app/components/use-direct-mode";
import {
  chatAutoScrollContentKey,
  chatAutoScrollResponseKey,
  useChatAutoScroll,
} from "@/app/components/use-chat-auto-scroll";
import ChatTimeSeparator from "@/app/components/chat-time-separator";
import ChatMessageAttachments from "@/app/components/chat-message-attachments";
import { useAssistantIntelligence } from "@/app/components/use-assistant-intelligence";
import ActivityPanel from "@/app/components/hermes/activity-panel";
import {
  splitLeadingCommandTokens,
  UserMessageText,
} from "@/app/components/hermes/command-text";
import SavePromptDialog from "@/app/components/hermes/save-prompt-dialog";
import { useLegacyAgentActivity } from "@/app/components/hermes/use-legacy-agent-activity";
import type {
  ActivityItem,
  ConnectionState,
  PermissionPrompt,
} from "@/app/components/hermes/use-agent-session";
import type { VerificationSummary } from "@/lib/hermes/evidence";
import { interactiveVisualizerCommandForArtifact } from "@/lib/hermes/interactive-visualizer-skills";
import ChatJumpToBottom from "@/app/components/chat-jump-to-bottom";
import ChatMarkdown from "@/app/components/chat-markdown";
import DocumentIngestionTokenUsage from "@/app/components/document-ingestion-token-usage";
import DocumentIngestionVisionError from "@/app/components/document-ingestion-vision-error";
import GardenVideoImport from "@/app/components/garden-video-import";
import {
  VLM_PARSE_FILE_RE,
  VlmParseOption,
  useVlmOcrAvailability,
} from "@/app/components/vlm-parse-option";
import {
  ANYDOC_PARSE_FILE_RE,
  AnydocParseOption,
  useAnydocAvailability,
} from "@/app/components/anydoc-parse-option";
import ArtifactPanel, {
  ARTIFACT_BROWSER_EVENT,
  ARTIFACT_REVISE_EVENT,
  ArtifactArchiveIcon,
  GARDEN_DOCUMENTS_CHANGED_EVENT,
} from "@/app/components/hermes/artifact-panel";
import InlineAgentBrowserRun from "@/app/components/hermes/inline-agent-browser-run";
import InlineArtifactCards, {
  InlineArtifactCardsProvider,
  useInlineArtifactPrefetch,
} from "@/app/components/hermes/inline-artifact-cards";
import InlineDeepResearchRun from "@/app/components/hermes/inline-deep-research-run";
import InlineOpenCodeRun from "@/app/components/hermes/inline-opencode-run";
import InlineRufloRun from "@/app/components/hermes/inline-ruflo-run";
import InlineAgentReachRun from "@/app/components/hermes/inline-agent-reach-run";
import InlineGetDocRun from "@/app/components/hermes/inline-get-doc-run";
import InlineMeetingNotesRun from "@/app/components/hermes/inline-meeting-notes-run";
import InlineDeepTutorRun from "@/app/components/hermes/inline-deep-tutor-run";
import InlineCareerOpsRun from "@/app/components/hermes/inline-career-ops-run";
import InlineTradingAgentsRun from "@/app/components/hermes/inline-tradingagents-run";
import InlineVibeTradingRun from "@/app/components/hermes/inline-vibe-trading-run";
import InlineStockAnalystRun from "@/app/components/hermes/inline-stock-analyst-run";
import InlinePaperTraderRun from "@/app/components/hermes/inline-paper-trader-run";
import InlineDeerFlowRun from "@/app/components/hermes/inline-deer-flow-run";
import InlineOpenPlanterRun from "@/app/components/hermes/inline-openplanter-run";
import InlineSocialsManagerRun from "@/app/components/hermes/inline-socials-manager-run";
import InlineHardwareBlueprintRun from "@/app/components/hermes/inline-hardware-blueprint-run";
import InlineParametricCadRun from "@/app/components/hermes/inline-parametric-cad-run";
import InlineHyperframesRun from "@/app/components/hermes/inline-hyperframes-run";
import InlineResource2SkillRun from "@/app/components/hermes/inline-resource2skill-run";
import InlineOpenMontageRun from "@/app/components/hermes/inline-openmontage-run";
import InlineOpenworkRun from "@/app/components/hermes/inline-openwork-run";
import InlineOpenscienceRun from "@/app/components/hermes/inline-openscience-run";
import InlineInboxZeroRun from "@/app/components/hermes/inline-inbox-zero-run";
import InlineVimaxRun from "@/app/components/hermes/inline-vimax-run";
import InlineMoneyPrinterRun from "@/app/components/hermes/inline-money-printer-run";
import InlineLegalRun from "@/app/components/hermes/inline-legal-run";
import InlineShortsRun from "@/app/components/hermes/inline-shorts-run";
import InlineFormsmithRun from "@/app/components/hermes/inline-formsmith-run";
import InlineVideoUseRun from "@/app/components/hermes/inline-video-use-run";
import {
  hardwareBlueprintUserMessage,
  taskFromHardwareBlueprintCommand,
} from "@/lib/hardware/identity.ts";
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
import LearnConfirmationDialog, {
  type LearnDestructiveAction,
} from "@/app/components/learn-confirmation-dialog";
import ViewportPopover from "@/app/components/viewport-popover";
import KnowledgeGraph from "@/app/components/knowledge-graph";
import NavbarFlowerWind from "@/app/components/navbar-flower-wind";
import { useToast, Toaster } from "@/app/components/toast";
import { startNavigationProgress } from "@/app/components/navigation-progress";
import { useAssistantModels } from "@/app/components/use-assistant-models";
import {
  formatExactTokenCount,
  formatTokenCount,
  normalizeChatTokenUsage,
  type ChatTokenUsage,
} from "@/lib/chat-token-usage";
import { formatAssistantModelName } from "@/lib/ai-models";
import { chatTimeSeparatorLabels } from "@/lib/chat-time-separators";
import type { LocalWorkflowSummary, WorkflowRunResponse } from "@/lib/workflows/types";
import {
  attachAudioFile,
  attachModelFile,
  CHAT_ATTACHMENT_ACCEPT,
  chatMessageAttachments,
  reusableChatAttachments,
  type ChatAttachment,
  type ChatMessageAttachment,
} from "@/lib/chat-attachments";
import {
  distillAttachments,
  distillGardenDocumentSkill,
} from "@/lib/document-skills/client";
import { modelAttachmentFormat } from "@/lib/model-attachments";
import { audioAttachmentFormat } from "@/lib/audio-attachments";
import {
  currentLearnElapsedMs,
  formatLearnElapsedTime,
} from "@/lib/learn-timer";
import {
  sumIngestTokenUsage,
  type IngestTokenUsage,
} from "@/lib/ingest-token-usage";
import {
  agentBrowserUserMessage,
  taskFromAgentBrowserCommand,
} from "@/lib/agent-browser/identity";
import {
  deepResearchUserMessage,
  parseResearchRequest,
  taskFromDeepResearchCommand,
} from "@/lib/deep-research/identity";
import { loadAgentSettings } from "@/lib/agent-settings/client.ts";
import { deepResearchDefaults } from "@/lib/agent-settings/defaults.ts";
import {
  OPENPLANTER_AGENT_ID,
  OPENPLANTER_AGENT_NAME,
  openPlanterUserMessage,
  taskFromOpenPlanterCommand,
} from "@/lib/openplanter/identity.ts";
import {
  AGENT_REACH_AGENT_ID,
  AGENT_REACH_AGENT_NAME,
  agentReachUserMessage,
  taskFromAgentReachCommand,
} from "@/lib/agent-reach/identity.ts";
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
import {
  socialsManagerUserMessage,
  taskFromSocialsManagerCommand,
} from "@/lib/socials-manager/identity.ts";
import { findCapabilityConflict } from "@/lib/hermes/capability-combinations.ts";
import {
  MAX_AGENT_LAUNCH_HOPS,
  agentLaunchContinuationMessage,
  useAgentLaunchQueue,
  type AgentLaunchRequestPayload,
} from "@/app/components/hermes/use-agent-launch-queue";
import AgentLaunchPrompt from "@/app/components/hermes/agent-launch-prompt";
import {
  OPENCODE_AGENT_ID,
  OPENCODE_AGENT_NAME,
  openCodeUserMessage,
  taskFromOpenCodeCommand,
} from "@/lib/opencode/identity";
import {
  CODEX_AGENT_ID,
  CODEX_AGENT_NAME,
  codexUserMessage,
  taskFromCodexCommand,
} from "@/lib/codex/identity";
import {
  RUFLO_AGENT_ID,
  RUFLO_AGENT_NAME,
  rufloUserMessage,
  taskFromRufloCommand,
} from "@/lib/ruflo/identity";
import {
  assistantExternalAgentRunId,
  externalAgentCardContent,
  type ExternalAgentActivityEntry,
  type ExternalAgentEdits,
  type ExternalAgentOutcome,
  type ExternalAgentTerminalResult,
} from "@/lib/conversations/external-agent-runs";
import { notifyTaskCompleted } from "@/lib/task-completion-notification";
import { gardenDocumentHref } from "@/lib/garden-document-route";

interface Message {
  id?: string;
  artifactMessageId?: string;
  role: "user" | "assistant";
  content: string;
  /** Model-to-model hand-back; retained in context but hidden from the user. */
  internalAgentContinuation?: boolean;
  createdAt?: string;
  sources?: string[];
  thinking?: string;
  attachmentNames?: string[];
  attachments?: ChatMessageAttachment[];
  usage?: ChatTokenUsage;
  responseDurationMs?: number;
  verification?: VerificationSummary;
  agentBrowserRun?: { agentId: string; runId: string; task: string };
  deepResearchRun?: {
    runId: string;
    query: string;
    output: "report" | "answer";
  };
  openCodeRun?: {
    runId: string;
    task: string;
    gardenSlug: string;
    repository: string;
  };
  codexRun?: {
    runId: string;
    task: string;
    gardenSlug: string;
    repository: string;
  };
  openPlanterRun?: { runId: string; task: string };
  agentReachRun?: { runId: string; task: string };
  getDocRun?: { runId: string; query: string };
  meetingNotesRun?: { runId: string; task: string };
  deepTutorRun?: { runId: string; task: string; capability: string };
  careerOpsRun?: { runId: string; task: string };
  tradingAgentsRun?: { runId: string; task: string };
  vibeTradingRun?: { runId: string; task: string };
  stockAnalystRun?: { runId: string; task: string };
  paperTraderRun?: { runId: string; task: string };
  deerFlowRun?: { runId: string; task: string };
  socialsManagerRun?: { runId: string; brief: string };
  hardwareBlueprintRun?: { runId: string; brief: string };
  parametricCadRun?: { runId: string; brief: string };
  hyperframesRun?: { runId: string; brief: string };
  resource2SkillRun?: { runId: string; brief: string };
  openMontageRun?: { runId: string; brief: string };
  openworkRun?: { runId: string; task: string };
  openscienceRun?: { runId: string; task: string };
  inboxZeroRun?: { runId: string; task: string };
  vimaxRun?: { runId: string; brief: string };
  moneyPrinterRun?: { runId: string; brief: string };
  legalRun?: { runId: string; task: string };
  shortsRun?: { runId: string; task: string };
  formsmithRun?: { runId: string; task: string };
  videoUseRun?: { runId: string; task: string; quiet?: boolean };
  rufloRun?: {
    runId: string;
    task: string;
    gardenSlug: string;
    repository: string;
  };
  externalAgentOutcome?: ExternalAgentOutcome;
  /** Model-selected worker state; observed invisibly by the Super Agent host. */
  delegatedAgentRun?: boolean;
  /** The Super Agent text that remains visible while its worker runs. */
  delegatedAgentPreamble?: string;
  /** Worker output returned to the Super Agent without replacing its message. */
  externalAgentResult?: string;
  externalAgentName?: string;
  externalAgentActivity?: ExternalAgentActivityEntry[];
  externalAgentEdits?: ExternalAgentEdits;
  externalAgentState?: Record<string, unknown>;
}

interface ChatSession {
  id: number;
  user_id?: number;
  title: string;
  created_at: string;
  updated_at: string;
  messages: Message[];
  ownerUsername?: string;
  isOwn?: boolean;
}

interface ExternalAgentSelection {
  id: string;
  name: string;
}

/** Shared by the two repository-scoped agents (OpenCode and Ruflo). */
function explainRepositoryAgentError(
  code: unknown,
  fallback: string,
  agentName: string,
): string {
  if (typeof code !== "string" || !code.trim()) return fallback;
  switch (code) {
    case "repository_not_connected":
      return `Connect a local Git repository from this Garden's card before using ${agentName}.`;
    case "repository_unavailable":
      return "The connected repository is no longer available. Reconnect it from the Garden card.";
    case "garden_not_found":
      return "This Garden is no longer available.";
    case "garden_required":
      return `Open the Garden whose repository you want ${agentName} to use.`;
    default:
      return code;
  }
}

function explainOpenCodeError(code: unknown, fallback: string): string {
  return explainRepositoryAgentError(code, fallback, "OpenCode");
}

function explainCodexError(code: unknown, fallback: string): string {
  return explainRepositoryAgentError(code, fallback, "Codex");
}

function explainRufloError(code: unknown, fallback: string): string {
  return explainRepositoryAgentError(code, fallback, "Ruflo");
}

interface DocInfo {
  name: string;
  slug: string;
  folder: string;
  relPath: string;
  title: string;
  description: string;
  type: string;
  sourceType: string;
  sourceFile: string;
  sourcePdf: string;
  flagColor: string;
  locations: string[];
  linkCount: number;
  wordCount: number;
  date: string;
}

interface SavedLinkInfo {
  id: string;
  title: string;
  url: string;
  sourceSlug?: string;
  sourceRelPath?: string;
  contentHash?: string;
  importedAt?: string;
  provider?: string;
  createdAt: string;
  updatedAt: string;
}

function normalizedSearchText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");
}

function documentSearchText(doc: DocInfo): string {
  return normalizedSearchText(
    [
      doc.title,
      doc.description,
      doc.name,
      doc.slug,
      doc.sourceFile,
      doc.sourcePdf,
      doc.folder,
      doc.relPath,
      doc.sourceType,
      ...(Array.isArray(doc.locations) ? doc.locations : []),
    ]
      .filter(Boolean)
      .join(" "),
  );
}

interface GeneratedNoteResult {
  slug: string;
  title: string;
  action?: "created" | "merged";
  reason?: string;
}

type LearnStatus =
  | "idle"
  | "planning"
  | "awaiting_confirmation"
  | "analyzing_issues"
  | "repairing"
  | "revalidating"
  | "publishing_repair"
  | "generating_learning_pages"
  | "generating_textbook"
  | "generating_visuals"
  | "writing_quartz"
  | "building_navigation"
  | "complete"
  | "failed"
  | "cancelled";

interface LearnJobInfo {
  id: string;
  model: string;
  status: LearnStatus;
  updatedAt?: string;
  currentStep?: string;
  progressPercent?: number;
  currentSectionTitle?: string;
  currentPageTitle?: string;
  error?: string;
  elapsedMs: number;
  timerStartedAt?: string;
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cachedInputTokens: number;
    reasoningTokens: number;
    estimated: boolean;
    startedCalls: number;
    completedCalls: number;
    reportedCalls: number;
    unreportedCalls: number;
    inFlightCalls: number;
  };
}

interface LearnValidationReportInfo {
  relativePath?: string;
  url?: string;
  markdown?: string;
  truncated?: boolean;
  accepted?: boolean;
  generatedAt?: string;
}

interface LearnSubsectionInfo {
  title: string;
  purpose?: string;
  sourceAnchors?: string[];
  visualOpportunities?: string[];
}

interface LearnSectionInfo {
  title: string;
  purpose?: string;
  sourceAnchors?: string[];
  subsections: LearnSubsectionInfo[];
}

interface LearnMapInfo {
  title: string;
  summary?: string;
  sections: LearnSectionInfo[];
  warnings?: string[];
}

interface LearnStatusResponse {
  success?: boolean;
  job?: LearnJobInfo | null;
  proposedLearningMap?: LearnMapInfo | null;
  confirmedLearningMapId?: string;
  latestTextbookVersionId?: string;
  hasSources?: boolean;
  sourceCount?: number;
  selectedSourceIds?: string[];
  selectedSourceCount?: number;
  syllabusSourceId?: string | null;
  syllabusCoverage?: {
    unitCount: number;
    materialCount: number;
    availableCount: number;
    missingCount: number;
    genericCount: number;
    missingCitations: string[];
  } | null;
  hasTextbook?: boolean;
  sourceSetChanged?: boolean;
  buttonLabel?: string;
  validationReport?: LearnValidationReportInfo | null;
  scopedRepair?: {
    repairId: string;
    issueCount: number;
    unitIds: string[];
    pageIds: string[];
    sectionIds: string[];
    visualIds: string[];
    changedFiles: string[];
    modelCalls: number;
    blockersBefore: number;
    blockersAfter: number;
    unaffectedPageHashesVerified: boolean;
    accepted: boolean;
    publishReady: boolean;
    reason: string;
  } | null;
  error?: string;
}

interface MarkdownTagUpdateResult {
  slug: string;
  title: string;
  tags: string[];
  reason?: string;
}

interface Props {
  clusterSlug: string;
  clusterName: string;
  isOwner?: boolean;
  clusterVisibility: "private" | "public";
  chatAccessible: boolean;
  forkAllowed: boolean;
}

const ACCEPTED =
  ".pdf,.jpg,.jpeg,.png,.webp,.txt,.md,.csv,.docx,.pptx,.xlsx,.zip";
const HANDWRITING_FILE_RE = /\.(pdf|jpg|jpeg|png|webp)$/i;
const EMPTY_MESSAGES: Message[] = [];

function formatLearnTotalTokenCount(value: number): string {
  const count = Math.max(0, Math.trunc(value));
  if (count >= 1_000_000) return formatTokenCount(count);
  return count < 1_000 ? String(count) : `${(count / 1_000).toFixed(1)}k`;
}

function formatLearnMetricTokenCount(value: number): string {
  return formatTokenCount(value).replace(/K$/, "k");
}

function displayLearnError(message?: string): string {
  const value = message?.trim() ?? "";
  if (/^the learn worker stopped without completing\b/i.test(value)) {
    return "Learn stopped responding before completion. Your garden was restored and is safe to retry.";
  }
  if (
    /^connection error\.?$/i.test(value) ||
    /^(?:chatmock\s+)?is not connected\b/i.test(value) ||
    /^the ai service is not connected\b/i.test(value)
  ) {
    return "The AI service connection was lost during Learn. Retry Learn; if it fails again, restart Breadboard's AI service.";
  }
  return value;
}

function Spinner({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg
      className={`${className} animate-spin`}
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}

function isGardenSaveCommand(text: string): boolean {
  const normalized = text
    .trim()
    .toLowerCase()
    .replace(/[,.!?]+/g, "")
    .replace(/\s+/g, " ")
    .replace(/^(?:can|could|would) you\s+/, "")
    .replace(/^please\s+/, "")
    .replace(/^(?:can|could|would) you\s+/, "")
    .replace(/^do\s+/, "")
    .replace(/^please\s+/, "")
    .replace(/\s+please$/, "")
    .trim();

  if (/^(?:how|what|why|where|when|who)\b/.test(normalized)) return false;

  const target =
    "(?:this|it|that|above|the\\s+above|this\\s+(?:answer|response|reply|message)|that\\s+(?:answer|response|reply|message)|your\\s+(?:answer|response|reply|message)|the\\s+chat|the\\s+conversation|the\\s+answer|the\\s+response|the\\s+reply|last\\s+(?:answer|response|reply|message)|the\\s+last\\s+(?:answer|response|reply|message)|latest\\s+(?:answer|response|reply|message)|the\\s+latest\\s+(?:answer|response|reply|message)|previous\\s+(?:answer|response|reply|message)|the\\s+previous\\s+(?:answer|response|reply|message))";
  const destination =
    "(?:(?:my|the)\\s+)?(?:digital\\s+garden|garden|garden\\s+note|chat\\s+node|chat\\s+note|markdown\\s+note|note)";
  const patterns = [
    new RegExp(
      `^(?:add|save|send|put|store)\\s+${target}\\s+(?:to|in|into|as)\\s+${destination}(?:\\s+as\\s+(?:a\\s+)?(?:chat\\s+node|chat\\s+note|garden\\s+note|markdown\\s+note|note))?$`,
    ),
    new RegExp(
      `^(?:add|save|send|put|store)\\s+(?:to|in|into)\\s+${destination}$`,
    ),
    new RegExp(
      `^(?:make|create|generate)\\s+(?:a\\s+)?(?:garden\\s+note|chat\\s+node|chat\\s+note|markdown\\s+note|note)\\s+(?:from|using|out\\s+of)\\s+${target}$`,
    ),
    new RegExp(
      `^(?:turn|convert)\\s+${target}\\s+into\\s+(?:a\\s+)?${destination}$`,
    ),
    new RegExp(`^(?:garden|note)\\s+${target}$`),
  ];
  return patterns.some((pattern) => pattern.test(normalized));
}

function hasRecentMarkdownTaggingContext(messages: Message[]): boolean {
  const recentText = messages
    .slice(-8)
    .map((message) => message.content.toLowerCase())
    .join("\n\n");

  return (
    /\b(?:tags?|tagging|frontmatter)\b/.test(recentText) &&
    /\b(?:week-[1-9]|midterm-topic|final-topic|exam-prep|lab-[1-3])\b/.test(
      recentText,
    )
  );
}

function isMarkdownTagCommand(text: string, messages: Message[] = []): boolean {
  const normalized = text
    .trim()
    .toLowerCase()
    .replace(/[,.!?]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^please\s+/, "")
    .trim();

  if (!normalized) return false;
  if (/^(?:how|what|why|where|when|who)\b/.test(normalized)) return false;

  const targets =
    "(?:markdowns?|notes?|documents?|topics?|sources?|materials?|garden\\s+notes?|chat\\s+notes?)";
  const patterns = [
    new RegExp(
      `^(?:can|could|would)?\\s*(?:you\\s+)?(?:add|apply|set|update|replace|retag|tag)\\b.*\\btags?\\b.*\\b(?:to|for|on|across|in)\\b.*\\b${targets}\\b`,
    ),
    new RegExp(
      `^(?:can|could|would)?\\s*(?:you\\s+)?(?:tag|retag)\\b.*\\b${targets}\\b`,
    ),
    new RegExp(
      `^(?:can|could|would)?\\s*(?:you\\s+)?(?:categorize|classify|label|organize)\\b.*\\b${targets}\\b.*\\b(?:with|using|by|based\\s+on)\\b`,
    ),
  ];

  if (patterns.some((pattern) => pattern.test(normalized))) return true;

  if (!hasRecentMarkdownTaggingContext(messages)) return false;

  return (
    /\btags?\b/.test(normalized) &&
    /\b(?:add|apply|include|use|also|extra|suggested|relevant|them|these|those)\b/.test(
      normalized,
    )
  );
}

function markdownTypeLabel(doc: DocInfo): string {
  if (doc.type === "textbook-page") return "lesson page";
  if (doc.type === "internal-concept") return "ConceptNode";
  if (doc.type === "generated-note") return "saved chat page";
  if (doc.type === "knowledge-topic") return "legacy topic";
  if (doc.type === "learning-map") return "learning map";
  if (doc.type === "source-map") return "source map";
  if (doc.type === "scope-contract") return "scope contract";
  if (doc.type === "topic-overview") return "topic overview";
  if (doc.type === "source-document") return doc.sourceType || "source";
  return doc.type || "note";
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("Could not read image"));
      }
    };
    reader.onerror = () =>
      reject(reader.error ?? new Error("Could not read image"));
    reader.readAsDataURL(file);
  });
}

function pastedImageName(file: File, index: number): string {
  if (file.name && file.name !== "image.png") return file.name;
  const ext = file.type.split("/")[1]?.replace("jpeg", "jpg") || "png";
  return `pasted-screenshot-${index + 1}.${ext}`;
}

type FileStatus = "pending" | "uploading" | "done" | "error";

const DEFAULT_FLAG_COLOR = "#facc15";
const FLAG_COLORS = [
  DEFAULT_FLAG_COLOR,
  "#fb7185",
  "#f97316",
  "#22c55e",
  "#14b8a6",
  "#38bdf8",
  "#60a5fa",
  "#a78bfa",
  "#f472b6",
  "#a3e635",
];

function fileKey(f: File) {
  return `${f.name}-${f.size}`;
}

function appendUniqueUploadFiles(current: File[], incoming: File[]): File[] {
  const keys = new Set(current.map(fileKey));
  const unique = [...current];
  for (const file of incoming) {
    const key = fileKey(file);
    if (keys.has(key)) continue;
    keys.add(key);
    unique.push(file);
  }
  return unique;
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const tenths = Math.floor((ms % 1000) / 100);
  return minutes > 0
    ? `${minutes}:${String(seconds).padStart(2, "0")}`
    : `${seconds}.${tenths}s`;
}

function isLearnActive(status?: LearnStatus): boolean {
  return (
    status === "planning" ||
    status === "analyzing_issues" ||
    status === "repairing" ||
    status === "revalidating" ||
    status === "publishing_repair" ||
    status === "generating_learning_pages" ||
    status === "generating_textbook" ||
    status === "generating_visuals" ||
    status === "writing_quartz" ||
    status === "building_navigation"
  );
}

function hasRunningExternalAgent(message: Message): boolean {
  return (
    message.role === "assistant" &&
    Boolean(
      message.agentBrowserRun ||
        message.deepResearchRun ||
        message.codexRun ||
        message.openCodeRun ||
        message.openPlanterRun ||
        message.agentReachRun ||
        message.getDocRun ||
        message.meetingNotesRun ||
        message.deepTutorRun ||
        message.careerOpsRun ||
        message.tradingAgentsRun ||
        message.vibeTradingRun ||
        message.stockAnalystRun ||
        message.paperTraderRun ||
        message.deerFlowRun ||
        message.socialsManagerRun ||
        message.hardwareBlueprintRun ||
        message.parametricCadRun ||
        message.hyperframesRun ||
        message.resource2SkillRun ||
        message.openMontageRun ||
        message.openworkRun ||
        message.openscienceRun ||
        message.inboxZeroRun ||
        message.vimaxRun ||
        message.moneyPrinterRun ||
        message.legalRun ||
        message.shortsRun ||
        message.formsmithRun ||
        message.videoUseRun ||
        message.rufloRun,
    ) &&
    (message.externalAgentOutcome ?? "running") === "running"
  );
}

interface ChatTranscriptProps {
  clusterName: string;
  clusterSlug: string;
  chatSessionId: number | null;
  isStreaming: boolean;
  loadingChats: boolean;
  messages: Message[];
  activities: ActivityItem[];
  connection: ConnectionState;
  pendingPermission: PermissionPrompt | null;
  onPermissionDecision: (decision: "once" | "always" | "reject") => void;
  onEditMessage: (messageIndex: number, text: string) => void;
  onRetryAssistant: (messageIndex: number) => void;
  onExternalAgentTerminal: (
    runId: string,
    result: ExternalAgentTerminalResult,
  ) => void;
  inlineArtifactRetireVersion: number;
}

const ChatTranscript = memo(function ChatTranscript({
  clusterName,
  clusterSlug,
  chatSessionId,
  isStreaming,
  loadingChats,
  messages,
  activities,
  connection,
  pendingPermission,
  onPermissionDecision,
  onEditMessage,
  onRetryAssistant,
  onExternalAgentTerminal,
  inlineArtifactRetireVersion,
}: ChatTranscriptProps) {
  const copiedUserTimerRef = useRef<number | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [messageEditText, setMessageEditText] = useState("");
  const [copiedUserId, setCopiedUserId] = useState<string | null>(null);
  const [promptToSave, setPromptToSave] = useState<string | null>(null);
  const lastAssistantIndex = messages.reduce(
    (lastIndex, message, index) =>
      message.role === "assistant" ? index : lastIndex,
    -1,
  );
  const timeSeparators = chatTimeSeparatorLabels(messages);

  useEffect(
    () => () => {
      if (copiedUserTimerRef.current !== null) {
        window.clearTimeout(copiedUserTimerRef.current);
      }
    },
    [],
  );

  async function copyUserMessage(message: Message, messageId: string) {
    if (!navigator.clipboard?.writeText) return;
    try {
      await navigator.clipboard.writeText(message.content);
    } catch {
      return;
    }
    setCopiedUserId(messageId);
    if (copiedUserTimerRef.current !== null) {
      window.clearTimeout(copiedUserTimerRef.current);
    }
    copiedUserTimerRef.current = window.setTimeout(
      () => setCopiedUserId(null),
      1_600,
    );
  }

  function beginMessageEdit(message: Message, messageId: string) {
    setEditingMessageId(messageId);
    setMessageEditText(message.content);
  }

  function saveMessageEdit(messageIndex: number) {
    const text = messageEditText.trim();
    if (!text) return;
    setEditingMessageId(null);
    setMessageEditText("");
    onEditMessage(messageIndex, text);
  }

  return (
    <InlineArtifactCardsProvider
      legacyChatSessionId={chatSessionId}
      gardenSlug={clusterSlug}
      retireVersion={inlineArtifactRetireVersion}
    >
    <div className="max-w-5xl mx-auto flex flex-col gap-6">
      {loadingChats ? (
        <div className="flex items-center justify-center py-28 text-gray-700">
          <Spinner className="w-5 h-5" />
        </div>
      ) : (
        messages.length === 0 && (
          <div className="flex flex-col items-center justify-center py-28 text-center text-gray-600">
            <svg
              className="w-9 h-9 mb-3 opacity-40"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z"
              />
            </svg>
            <p className="text-sm text-gray-500">
              Chat about <span className="text-gray-400">{clusterName}</span>
            </p>
            <p className="text-xs mt-1.5 text-gray-700 max-w-xs">
              After the conversation, hit{" "}
              <span className="text-gray-500">Save page</span> to keep the
              answer in your lessons
            </p>
          </div>
        )
      )}

      {messages.map((storedMessage, i) => {
        // The worker result belongs to the hidden observer, not to the Super
        // Agent's visible assistant message.
        const msg =
          storedMessage.delegatedAgentRun === true
            ? {
                ...storedMessage,
                content: externalAgentCardContent(storedMessage),
              }
            : storedMessage;
        if (msg.internalAgentContinuation === true) return null;
        const messageInteractionId = msg.id ?? `user-message-${i}`;
        const externalRun =
          msg.agentBrowserRun ??
          msg.deepResearchRun ??
          msg.codexRun ??
          msg.openCodeRun ??
          msg.openPlanterRun ??
          msg.agentReachRun ??
          msg.getDocRun ??
          msg.meetingNotesRun ??
          msg.deepTutorRun ??
          msg.careerOpsRun ??
          msg.tradingAgentsRun ??
          msg.vibeTradingRun ??
          msg.stockAnalystRun ??
          msg.paperTraderRun ??
          msg.deerFlowRun ??
          msg.socialsManagerRun ??
          msg.hardwareBlueprintRun ??
          msg.parametricCadRun ??
          msg.hyperframesRun ??
          msg.resource2SkillRun ??
          msg.openMontageRun ??
          msg.openworkRun ??
          msg.openscienceRun ??
          msg.inboxZeroRun ??
          msg.vimaxRun ??
          msg.moneyPrinterRun ??
          msg.legalRun ??
          msg.shortsRun ??
          msg.formsmithRun ??
          msg.videoUseRun ??
          msg.rufloRun;
        return (
        <div
          key={i}
          className="flex w-full flex-col gap-3"
        >
          {timeSeparators[i] ? (
            <ChatTimeSeparator
              label={timeSeparators[i]}
              dateTime={msg.createdAt}
            />
          ) : null}
          <div
            className={`${msg.role === "user" ? "group " : ""}flex flex-col gap-2 ${msg.role === "user" ? "items-end" : "items-start"}`}
          >
            {msg.role === "user" ? (
              <div className="flex flex-col items-end gap-1 max-w-[80%]">
              <ChatMessageAttachments
                attachments={msg.attachments}
                attachmentNames={msg.attachmentNames}
              />
              {msg.content ? (
                editingMessageId === messageInteractionId ? (
                  <form
                    className="neu-chat-message neu-chat-message-user min-w-64 rounded-[22px] p-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      saveMessageEdit(i);
                    }}
                  >
                    <textarea
                      value={messageEditText}
                      onChange={(event) => setMessageEditText(event.target.value)}
                      onKeyDown={(event) => {
                        if (
                          event.key === "Enter" &&
                          (event.ctrlKey || event.metaKey)
                        ) {
                          event.preventDefault();
                          event.currentTarget.form?.requestSubmit();
                        }
                      }}
                      rows={Math.min(
                        6,
                        Math.max(2, messageEditText.split("\n").length),
                      )}
                      className="max-h-40 w-full resize-none bg-transparent px-2 py-1 text-sm leading-6 text-[var(--ink)] outline-none"
                      aria-label="Edit message"
                      autoFocus
                    />
                    <div className="mt-1 flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setEditingMessageId(null)}
                        className="rounded-full px-3 py-1 text-xs text-[var(--ink-muted)] hover:bg-[var(--paper-strong)]"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={isStreaming || !messageEditText.trim()}
                        className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[var(--botanical-hover)] bg-[var(--botanical)] px-3 text-xs font-medium text-[var(--paper-raised)] shadow-sm transition-colors hover:bg-[var(--botanical-hover)] disabled:cursor-not-allowed disabled:border-[var(--line)] disabled:bg-[var(--line)] disabled:text-[var(--ink-muted)] disabled:shadow-none"
                      >
                        <span>Save &amp; send</span>
                        <svg
                          className="h-3.5 w-3.5"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={2.2}
                          aria-hidden
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M12 19.5v-15m0 0-6 6m6-6 6 6"
                          />
                        </svg>
                      </button>
                    </div>
                  </form>
                ) : (
                  <>
                    <div className="neu-chat-message neu-chat-message-user w-full rounded-2xl rounded-tr-sm px-4 py-3 text-sm">
                      {splitLeadingCommandTokens(msg.content) ? (
                        <UserMessageText content={msg.content} />
                      ) : (
                        <ChatMarkdown content={msg.content} compact />
                      )}
                    </div>
                    <div className="mt-1 flex justify-end gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                      <button
                        type="button"
                        onClick={() =>
                          void copyUserMessage(
                            msg,
                            messageInteractionId,
                          )
                        }
                        className="rounded-md p-1.5 text-[var(--ink-muted)] transition hover:bg-[var(--paper-strong)] hover:text-[var(--ink-heading)]"
                        title={
                          copiedUserId === messageInteractionId
                            ? "Copied"
                            : "Copy message"
                        }
                        aria-label={
                          copiedUserId === messageInteractionId
                            ? "Message copied"
                            : "Copy message"
                        }
                      >
                        {copiedUserId === messageInteractionId ? (
                          <svg
                            className="h-4 w-4"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={1.8}
                            aria-hidden
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="m5 12 4 4L19 6"
                            />
                          </svg>
                        ) : (
                          <svg
                            className="h-4 w-4"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={1.7}
                            aria-hidden
                          >
                            <rect x="8" y="8" width="11" height="11" rx="2" />
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"
                            />
                          </svg>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => setPromptToSave(msg.content)}
                        className="rounded-md p-1.5 text-[var(--ink-muted)] transition hover:bg-[var(--paper-strong)] hover:text-[var(--ink-heading)]"
                        title="Save to Prompts"
                        aria-label="Save message to Prompts"
                      >
                        <svg
                          className="h-4 w-4"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={1.7}
                          aria-hidden
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M6 4.75A1.75 1.75 0 0 1 7.75 3h8.5A1.75 1.75 0 0 1 18 4.75V21l-6-3.75L6 21V4.75Z"
                          />
                          <path strokeLinecap="round" d="M9 7.5h6" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          beginMessageEdit(
                            msg,
                            messageInteractionId,
                          )
                        }
                        disabled={isStreaming}
                        className="rounded-md p-1.5 text-[var(--ink-muted)] transition hover:bg-[var(--paper-strong)] hover:text-[var(--ink-heading)] disabled:cursor-not-allowed disabled:opacity-35"
                        title="Edit message"
                        aria-label="Edit message and create a branch"
                      >
                        <svg
                          className="h-4 w-4"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={1.7}
                          aria-hidden
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.862 4.487Z"
                          />
                        </svg>
                      </button>
                    </div>
                  </>
                )
              ) : null}
            </div>
            ) : (
              <div className="flex w-full flex-col gap-2">
              <MessageActionsSlot>
              {msg.delegatedAgentPreamble ? (
                <div className="max-w-[90%] text-sm leading-relaxed text-gray-200">
                  <ChatMarkdown content={msg.delegatedAgentPreamble} />
                </div>
              ) : null}
            {!externalRun ? (
                <ActivityPanel
                  activities={i === lastAssistantIndex ? activities : []}
                  connection={i === lastAssistantIndex ? connection : "idle"}
                  pendingPermission={i === lastAssistantIndex ? pendingPermission : null}
                  usage={msg.usage}
                  responseDurationMs={msg.responseDurationMs}
                  onPermissionDecision={onPermissionDecision}
                />
              ) : null}
              {externalRun ? (
                <div
                  className={msg.delegatedAgentRun ? "hidden" : "contents"}
                  aria-hidden={msg.delegatedAgentRun || undefined}
                >
              {msg.agentBrowserRun ? (
                <InlineAgentBrowserRun
                  agentId={msg.agentBrowserRun.agentId}
                  runId={msg.agentBrowserRun.runId}
                  task={msg.agentBrowserRun.task}
                  persistedContent={msg.content}
                  persistedOutcome={msg.externalAgentOutcome}
                  onRetry={
                    i === lastAssistantIndex && !isStreaming
                      ? () => onRetryAssistant(i)
                      : undefined
                  }
                  onTerminal={(result) =>
                    onExternalAgentTerminal(msg.agentBrowserRun!.runId, result)
                  }
                />
              ) : msg.deepResearchRun ? (
                <InlineDeepResearchRun
                  runId={msg.deepResearchRun.runId}
                  query={msg.deepResearchRun.query}
                  output={msg.deepResearchRun.output}
                  persistedContent={msg.content}
                  persistedOutcome={msg.externalAgentOutcome}
                  persistedUsage={msg.usage}
                  onRetry={
                    i === lastAssistantIndex && !isStreaming
                      ? () => onRetryAssistant(i)
                      : undefined
                  }
                  onTerminal={(result) =>
                    onExternalAgentTerminal(msg.deepResearchRun!.runId, result)
                  }
                />
              ) : msg.codexRun ? (
                <InlineOpenCodeRun
                  runId={msg.codexRun.runId}
                  task={msg.codexRun.task}
                  gardenSlug={msg.codexRun.gardenSlug}
                  agentName="Codex"
                  apiSlug="codex"
                  persistedContent={msg.content}
                  persistedOutcome={msg.externalAgentOutcome}
                  persistedActivity={msg.externalAgentActivity}
                  persistedEdits={msg.externalAgentEdits}
                  onRetry={
                    i === lastAssistantIndex && !isStreaming
                      ? () => onRetryAssistant(i)
                      : undefined
                  }
                  onTerminal={(result) =>
                    onExternalAgentTerminal(msg.codexRun!.runId, result)
                  }
                />
              ) : msg.openCodeRun ? (
                <InlineOpenCodeRun
                  runId={msg.openCodeRun.runId}
                  task={msg.openCodeRun.task}
                  gardenSlug={msg.openCodeRun.gardenSlug}
                  persistedContent={msg.content}
                  persistedOutcome={msg.externalAgentOutcome}
                  persistedActivity={msg.externalAgentActivity}
                  persistedEdits={msg.externalAgentEdits}
                  onRetry={
                    i === lastAssistantIndex && !isStreaming
                      ? () => onRetryAssistant(i)
                      : undefined
                  }
                  onTerminal={(result) =>
                    onExternalAgentTerminal(msg.openCodeRun!.runId, result)
                  }
                />
              ) : msg.openPlanterRun ? (
                <InlineOpenPlanterRun
                  runId={msg.openPlanterRun.runId}
                  task={msg.openPlanterRun.task}
                  persistedContent={msg.content}
                  persistedOutcome={msg.externalAgentOutcome}
                  onRetry={
                    i === lastAssistantIndex && !isStreaming
                      ? () => onRetryAssistant(i)
                      : undefined
                  }
                  onTerminal={(result) =>
                    onExternalAgentTerminal(msg.openPlanterRun!.runId, result)
                  }
                />
              ) : msg.agentReachRun ? (
                <InlineAgentReachRun
                  runId={msg.agentReachRun.runId}
                  task={msg.agentReachRun.task}
                  persistedContent={msg.content}
                  persistedOutcome={msg.externalAgentOutcome}
                  onRetry={
                    i === lastAssistantIndex && !isStreaming
                      ? () => onRetryAssistant(i)
                      : undefined
                  }
                  onTerminal={(result) =>
                    onExternalAgentTerminal(msg.agentReachRun!.runId, result)
                  }
                />
              ) : msg.deepTutorRun ? (
                <InlineDeepTutorRun
                  runId={msg.deepTutorRun.runId}
                  task={msg.deepTutorRun.task}
                  capability={msg.deepTutorRun.capability}
                  persistedContent={msg.content}
                  persistedOutcome={msg.externalAgentOutcome}
                  onRetry={
                    i === lastAssistantIndex && !isStreaming
                      ? () => onRetryAssistant(i)
                      : undefined
                  }
                  onTerminal={(result) =>
                    onExternalAgentTerminal(msg.deepTutorRun!.runId, result)
                  }
                />
              ) : msg.meetingNotesRun ? (
                <InlineMeetingNotesRun
                  runId={msg.meetingNotesRun.runId}
                  task={msg.meetingNotesRun.task}
                  persistedContent={msg.content}
                  persistedOutcome={msg.externalAgentOutcome}
                  persistedUsage={msg.usage}
                  onRetry={
                    i === lastAssistantIndex && !isStreaming
                      ? () => onRetryAssistant(i)
                      : undefined
                  }
                  onTerminal={(result) =>
                    onExternalAgentTerminal(msg.meetingNotesRun!.runId, result)
                  }
                />
              ) : msg.getDocRun ? (
                <InlineGetDocRun
                  runId={msg.getDocRun.runId}
                  query={msg.getDocRun.query}
                  persistedContent={msg.content}
                  persistedOutcome={msg.externalAgentOutcome}
                  persistedUsage={msg.usage}
                  onRetry={
                    i === lastAssistantIndex && !isStreaming
                      ? () => onRetryAssistant(i)
                      : undefined
                  }
                  onTerminal={(result) =>
                    onExternalAgentTerminal(msg.getDocRun!.runId, result)
                  }
                />
              ) : msg.tradingAgentsRun ? (
                <InlineTradingAgentsRun
                  runId={msg.tradingAgentsRun.runId}
                  task={msg.tradingAgentsRun.task}
                  persistedContent={msg.content}
                  persistedOutcome={msg.externalAgentOutcome}
                  onRetry={
                    i === lastAssistantIndex && !isStreaming
                      ? () => onRetryAssistant(i)
                      : undefined
                  }
                  onTerminal={(result) =>
                    onExternalAgentTerminal(msg.tradingAgentsRun!.runId, result)
                  }
                />
              ) : msg.vibeTradingRun ? (
                <InlineVibeTradingRun
                  runId={msg.vibeTradingRun.runId}
                  task={msg.vibeTradingRun.task}
                  persistedContent={msg.content}
                  persistedOutcome={msg.externalAgentOutcome}
                  onRetry={
                    i === lastAssistantIndex && !isStreaming
                      ? () => onRetryAssistant(i)
                      : undefined
                  }
                  onTerminal={(result) =>
                    onExternalAgentTerminal(msg.vibeTradingRun!.runId, result)
                  }
                />
              ) : msg.stockAnalystRun ? (
                <InlineStockAnalystRun
                  runId={msg.stockAnalystRun.runId}
                  task={msg.stockAnalystRun.task}
                  persistedContent={msg.content}
                  persistedOutcome={msg.externalAgentOutcome}
                  onRetry={
                    i === lastAssistantIndex && !isStreaming
                      ? () => onRetryAssistant(i)
                      : undefined
                  }
                  onTerminal={(result) =>
                    onExternalAgentTerminal(msg.stockAnalystRun!.runId, result)
                  }
                />
              ) : msg.paperTraderRun ? (
                <InlinePaperTraderRun
                  runId={msg.paperTraderRun.runId}
                  task={msg.paperTraderRun.task}
                  persistedContent={msg.content}
                  persistedOutcome={msg.externalAgentOutcome}
                  onRetry={
                    i === lastAssistantIndex && !isStreaming
                      ? () => onRetryAssistant(i)
                      : undefined
                  }
                  onTerminal={(result) =>
                    onExternalAgentTerminal(msg.paperTraderRun!.runId, result)
                  }
                />
              ) : msg.deerFlowRun ? (
                <InlineDeerFlowRun
                  runId={msg.deerFlowRun.runId}
                  task={msg.deerFlowRun.task}
                  persistedContent={msg.content}
                  persistedOutcome={msg.externalAgentOutcome}
                  onRetry={
                    i === lastAssistantIndex && !isStreaming
                      ? () => onRetryAssistant(i)
                      : undefined
                  }
                  onTerminal={(result) =>
                    onExternalAgentTerminal(msg.deerFlowRun!.runId, result)
                  }
                />
              ) : msg.careerOpsRun ? (
                <InlineCareerOpsRun
                  runId={msg.careerOpsRun.runId}
                  task={msg.careerOpsRun.task}
                  persistedContent={msg.content}
                  persistedOutcome={msg.externalAgentOutcome}
                  onRetry={
                    i === lastAssistantIndex && !isStreaming
                      ? () => onRetryAssistant(i)
                      : undefined
                  }
                  onTerminal={(result) =>
                    onExternalAgentTerminal(msg.careerOpsRun!.runId, result)
                  }
                />
              ) : msg.socialsManagerRun ? (
                <InlineSocialsManagerRun
                  runId={msg.socialsManagerRun.runId}
                  brief={msg.socialsManagerRun.brief}
                  persistedContent={msg.content}
                  persistedOutcome={msg.externalAgentOutcome}
                  persistedUsage={msg.usage}
                  onRetry={
                    i === lastAssistantIndex && !isStreaming
                      ? () => onRetryAssistant(i)
                      : undefined
                  }
                  onTerminal={(result) =>
                    onExternalAgentTerminal(msg.socialsManagerRun!.runId, result)
                  }
                />
              ) : msg.hardwareBlueprintRun ? (
                <InlineHardwareBlueprintRun
                  runId={msg.hardwareBlueprintRun.runId}
                  brief={msg.hardwareBlueprintRun.brief}
                  persistedContent={msg.content}
                  persistedOutcome={msg.externalAgentOutcome}
                  persistedUsage={msg.usage}
                  persistedState={msg.externalAgentState}
                  onRetry={
                    i === lastAssistantIndex && !isStreaming
                      ? () => onRetryAssistant(i)
                      : undefined
                  }
                  onTerminal={(result) =>
                    onExternalAgentTerminal(msg.hardwareBlueprintRun!.runId, result)
                  }
                />
              ) : msg.parametricCadRun ? (
                <InlineParametricCadRun
                  runId={msg.parametricCadRun.runId}
                  brief={msg.parametricCadRun.brief}
                  persistedContent={msg.content}
                  persistedOutcome={msg.externalAgentOutcome}
                  persistedUsage={msg.usage}
                  onRetry={
                    i === lastAssistantIndex && !isStreaming
                      ? () => onRetryAssistant(i)
                      : undefined
                  }
                  onTerminal={(result) =>
                    onExternalAgentTerminal(msg.parametricCadRun!.runId, result)
                  }
                />
              ) : msg.hyperframesRun ? (
                <InlineHyperframesRun
                  runId={msg.hyperframesRun.runId}
                  brief={msg.hyperframesRun.brief}
                  persistedContent={msg.content}
                  persistedOutcome={msg.externalAgentOutcome}
                  persistedUsage={msg.usage}
                  onRetry={
                    i === lastAssistantIndex && !isStreaming
                      ? () => onRetryAssistant(i)
                      : undefined
                  }
                  onTerminal={(result) =>
                    onExternalAgentTerminal(msg.hyperframesRun!.runId, result)
                  }
                />
              ) : msg.resource2SkillRun ? (
                <InlineResource2SkillRun
                  runId={msg.resource2SkillRun!.runId}
                  brief={msg.resource2SkillRun!.brief}
                  persistedContent={msg.content}
                  persistedOutcome={msg.externalAgentOutcome}
                  persistedUsage={msg.usage}
                  onRetry={
                    i === lastAssistantIndex && !isStreaming
                      ? () => onRetryAssistant(i)
                      : undefined
                  }
                  onTerminal={(result) =>
                    onExternalAgentTerminal(msg.resource2SkillRun!.runId, result)
                  }
                />
              ) : msg.openMontageRun ? (
                <InlineOpenMontageRun
                  runId={msg.openMontageRun.runId}
                  brief={msg.openMontageRun.brief}
                  persistedContent={msg.content}
                  persistedOutcome={msg.externalAgentOutcome}
                  persistedUsage={msg.usage}
                  onRetry={
                    i === lastAssistantIndex && !isStreaming
                      ? () => onRetryAssistant(i)
                      : undefined
                  }
                  onTerminal={(result) =>
                    onExternalAgentTerminal(msg.openMontageRun!.runId, result)
                  }
                />
              ) : msg.openworkRun ? (
                <InlineOpenworkRun
                  runId={msg.openworkRun.runId}
                  task={msg.openworkRun.task}
                  persistedContent={msg.content}
                  persistedOutcome={msg.externalAgentOutcome}
                  persistedUsage={msg.usage}
                  onRetry={
                    i === lastAssistantIndex && !isStreaming
                      ? () => onRetryAssistant(i)
                      : undefined
                  }
                  onTerminal={(result) =>
                    onExternalAgentTerminal(msg.openworkRun!.runId, result)
                  }
                />
              ) : msg.openscienceRun ? (
                <InlineOpenscienceRun
                  runId={msg.openscienceRun.runId}
                  task={msg.openscienceRun.task}
                  persistedContent={msg.content}
                  persistedOutcome={msg.externalAgentOutcome}
                  persistedUsage={msg.usage}
                  onRetry={
                    i === lastAssistantIndex && !isStreaming
                      ? () => onRetryAssistant(i)
                      : undefined
                  }
                  onTerminal={(result) =>
                    onExternalAgentTerminal(msg.openscienceRun!.runId, result)
                  }
                />
              ) : msg.inboxZeroRun ? (
                <InlineInboxZeroRun
                  runId={msg.inboxZeroRun.runId}
                  task={msg.inboxZeroRun.task}
                  persistedContent={msg.content}
                  persistedOutcome={msg.externalAgentOutcome}
                  onRetry={
                    i === lastAssistantIndex && !isStreaming
                      ? () => onRetryAssistant(i)
                      : undefined
                  }
                  onTerminal={(result) =>
                    onExternalAgentTerminal(msg.inboxZeroRun!.runId, result)
                  }
                />
              ) : msg.vimaxRun ? (
                <InlineVimaxRun
                  runId={msg.vimaxRun.runId}
                  brief={msg.vimaxRun.brief}
                  persistedContent={msg.content}
                  persistedOutcome={msg.externalAgentOutcome}
                  persistedUsage={msg.usage}
                  onRetry={
                    i === lastAssistantIndex && !isStreaming
                      ? () => onRetryAssistant(i)
                      : undefined
                  }
                  onTerminal={(result) =>
                    onExternalAgentTerminal(msg.vimaxRun!.runId, result)
                  }
                />
              ) : msg.moneyPrinterRun ? (
                <InlineMoneyPrinterRun
                  runId={msg.moneyPrinterRun.runId}
                  brief={msg.moneyPrinterRun.brief}
                  persistedContent={msg.content}
                  persistedOutcome={msg.externalAgentOutcome}
                  onRetry={
                    i === lastAssistantIndex && !isStreaming
                      ? () => onRetryAssistant(i)
                      : undefined
                  }
                  onTerminal={(result) =>
                    onExternalAgentTerminal(msg.moneyPrinterRun!.runId, result)
                  }
                />
              ) : msg.legalRun ? (
                <InlineLegalRun
                  runId={msg.legalRun.runId}
                  task={msg.legalRun.task}
                  persistedContent={msg.content}
                  persistedOutcome={msg.externalAgentOutcome}
                  onRetry={
                    i === lastAssistantIndex && !isStreaming
                      ? () => onRetryAssistant(i)
                      : undefined
                  }
                  onTerminal={(result) =>
                    onExternalAgentTerminal(msg.legalRun!.runId, result)
                  }
                />
              ) : msg.shortsRun ? (
                <InlineShortsRun
                  runId={msg.shortsRun.runId}
                  task={msg.shortsRun.task}
                  persistedContent={msg.content}
                  persistedOutcome={msg.externalAgentOutcome}
                  onRetry={
                    i === lastAssistantIndex && !isStreaming
                      ? () => onRetryAssistant(i)
                      : undefined
                  }
                  onTerminal={(result) =>
                    onExternalAgentTerminal(msg.shortsRun!.runId, result)
                  }
                />
              ) : msg.formsmithRun ? (
                <InlineFormsmithRun
                  runId={msg.formsmithRun.runId}
                  task={msg.formsmithRun.task}
                  persistedContent={externalAgentCardContent(msg)}
                  persistedOutcome={msg.externalAgentOutcome}
                  onTerminal={(result) =>
                    onExternalAgentTerminal(msg.formsmithRun!.runId, result)
                  }
                />
              ) : msg.videoUseRun ? (
                <InlineVideoUseRun
                  runId={msg.videoUseRun.runId}
                  task={msg.videoUseRun.task}
                  quiet={msg.videoUseRun.quiet === true}
                  persistedContent={msg.content}
                  persistedOutcome={msg.externalAgentOutcome}
                  onRetry={
                    i === lastAssistantIndex && !isStreaming
                      ? () => onRetryAssistant(i)
                      : undefined
                  }
                  onTerminal={(result) =>
                    onExternalAgentTerminal(msg.videoUseRun!.runId, result)
                  }
                />
              ) : msg.rufloRun ? (
                <InlineRufloRun
                  runId={msg.rufloRun.runId}
                  task={msg.rufloRun.task}
                  gardenSlug={msg.rufloRun.gardenSlug}
                  persistedContent={msg.content}
                  persistedOutcome={msg.externalAgentOutcome}
                  persistedEdits={msg.externalAgentEdits}
                  onRetry={
                    i === lastAssistantIndex && !isStreaming
                      ? () => onRetryAssistant(i)
                      : undefined
                  }
                  onTerminal={(result) =>
                    onExternalAgentTerminal(msg.rufloRun!.runId, result)
                  }
                />
              ) : null}
                </div>
              ) : msg.content ? (
                <div className="max-w-[90%] text-sm leading-relaxed text-gray-200">
                  <ChatMarkdown content={msg.content} />
                </div>
              ) : null}
              {chatSessionId ? (
                <InlineArtifactCards
                  ownerMessageId={msg.artifactMessageId ?? msg.id ?? null}
                />
              ) : null}
              {!externalRun &&
              !(isStreaming && i === lastAssistantIndex) ? (
                <AssistantMessageActions
                  content={msg.content || "Response unavailable"}
                  verification={msg.verification}
                  onRetry={
                    i === lastAssistantIndex
                      ? () => onRetryAssistant(i)
                      : undefined
                  }
                />
              ) : null}
              </MessageActionsSlot>
              </div>
            )}
          </div>
        </div>
        );
      })}
      {chatSessionId ? (
        <InlineArtifactCards ownerMessageId={null} />
      ) : null}
    </div>
    {promptToSave !== null ? (
      <SavePromptDialog
        content={promptToSave}
        onClose={() => setPromptToSave(null)}
      />
    ) : null}
    </InlineArtifactCardsProvider>
  );
});

// ── Prompts ──────────────────────────────────────────────────────────────────

interface SavedPrompt {
  id: string;
  title: string;
  content: string;
  category: string;
  isDefault?: boolean;
}

const PROMPTS_KEY = "sb_prompts_v1";

const DEFAULT_PROMPTS: SavedPrompt[] = [
  {
    id: "dp-1",
    title: "Summarize all documents",
    content:
      "Summarize the key points from all documents in this garden into a concise, structured overview with clear headings.",
    category: "Summary",
    isDefault: true,
  },
  {
    id: "dp-2",
    title: "Study guide",
    content:
      "Create a comprehensive study guide from my materials. Include key concepts, definitions, important facts, and any formulas or equations. Organize by topic.",
    category: "Study",
    isDefault: true,
  },
  {
    id: "dp-3",
    title: "Quiz me",
    content:
      "Generate 8 quiz questions based on the content in this garden to test my understanding. Mix multiple choice and open questions. Include correct answers at the end.",
    category: "Study",
    isDefault: true,
  },
  {
    id: "dp-4",
    title: "Explain like I'm a beginner",
    content:
      "Explain the main concepts in this garden as if I have no prior background in the subject. Use simple language, analogies, and real-world examples.",
    category: "Study",
    isDefault: true,
  },
  {
    id: "dp-5",
    title: "Find connections",
    content:
      "Identify and explain the key connections, relationships, and dependencies between the topics and documents in this garden. Show how ideas link together.",
    category: "Analysis",
    isDefault: true,
  },
  {
    id: "dp-6",
    title: "Gaps & contradictions",
    content:
      "Analyze my documents and identify: (1) gaps in information where more research is needed, (2) any contradictions or conflicting information between sources, (3) assumptions that may be worth questioning.",
    category: "Analysis",
    isDefault: true,
  },
  {
    id: "dp-7",
    title: "Extract key formulas & terms",
    content:
      "List all important formulas, equations, technical terms, and definitions from my documents. Format each with a brief explanation of what it means and when to use it.",
    category: "Analysis",
    isDefault: true,
  },
  {
    id: "dp-8",
    title: "Essay outline",
    content:
      "Based on my documents, write a detailed outline for an academic essay or report covering the main topic. Include thesis, main arguments, supporting points, and a suggested conclusion.",
    category: "Writing",
    isDefault: true,
  },
  {
    id: "dp-9",
    title: "Action items & tasks",
    content:
      "Extract all action items, tasks, to-dos, deadlines, and next steps mentioned anywhere in my documents. Present as a prioritized list.",
    category: "Summary",
    isDefault: true,
  },
  {
    id: "dp-10",
    title: "Timeline of events",
    content:
      "Create a chronological timeline of all events, milestones, dates, or sequential steps mentioned in my materials. Include brief descriptions for each entry.",
    category: "Summary",
    isDefault: true,
  },
];

const PROMPT_CATEGORIES = [
  "All",
  "Summary",
  "Study",
  "Analysis",
  "Writing",
  "Custom",
];

function loadPrompts(): SavedPrompt[] {
  if (typeof window === "undefined") return DEFAULT_PROMPTS;
  try {
    const raw = localStorage.getItem(PROMPTS_KEY);
    if (!raw) return DEFAULT_PROMPTS;
    const stored = JSON.parse(raw) as SavedPrompt[];
    // Merge: keep defaults not already overridden, plus user prompts
    const storedIds = new Set(stored.map((p) => p.id));
    const missingDefaults = DEFAULT_PROMPTS.filter((d) => !storedIds.has(d.id));
    return [...missingDefaults, ...stored];
  } catch {
    return DEFAULT_PROMPTS;
  }
}

function persistPrompts(prompts: SavedPrompt[]) {
  localStorage.setItem(PROMPTS_KEY, JSON.stringify(prompts));
}

export default function WorkspaceClient({
  clusterSlug,
  clusterName,
  isOwner = true,
  clusterVisibility,
  chatAccessible,
  forkAllowed,
}: Props) {
  const router = useRouter();
  const { toasts, addToast, dismissToast } = useToast();

  // Documents sidebar
  const [documents, setDocuments] = useState<DocInfo[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    new Set(),
  );
  const [draggingSlug, setDraggingSlug] = useState<string | null>(null);
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null);
  const [movingSlug, setMovingSlug] = useState<string | null>(null);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [loadingDocs, setLoadingDocs] = useState(true);
  const [graphRefreshVersion, setGraphRefreshVersion] = useState(0);
  const [docsExpanded, setDocsExpanded] = useState(false);
  const [sourceDocsExpanded, setSourceDocsExpanded] = useState(false);
  const [linksExpanded, setLinksExpanded] = useState(false);
  const [videosExpanded, setVideosExpanded] = useState(false);
  const [artifactsExpanded, setArtifactsExpanded] = useState(false);
  const [savedLinks, setSavedLinks] = useState<SavedLinkInfo[]>([]);
  const [linksLoading, setLinksLoading] = useState(true);
  const [newLinkTitle, setNewLinkTitle] = useState("");
  const [newLinkUrl, setNewLinkUrl] = useState("");
  const [savingLink, setSavingLink] = useState(false);
  const [deletingLinkId, setDeletingLinkId] = useState<string | null>(null);
  const [sourceDocSearch, setSourceDocSearch] = useState("");

  // Left chat sidebar: width is the single source of truth so it can be
  // dragged open/closed by its edge (no toggle button). Below the threshold it
  // renders as a thin rail; releasing snaps to a clean rail or open width.
  const LEFT_SIDEBAR_DEFAULT = 256;
  const LEFT_SIDEBAR_MIN = 200;
  const LEFT_SIDEBAR_MAX = 440;
  const LEFT_SIDEBAR_THRESHOLD = 170;
  const LEFT_SIDEBAR_RAIL = 48;
  const [leftSidebarWidth, setLeftSidebarWidth] =
    useState(LEFT_SIDEBAR_DEFAULT);
  const [leftSidebarResizing, setLeftSidebarResizing] = useState(false);
  const leftSidebarOpen = leftSidebarWidth >= LEFT_SIDEBAR_THRESHOLD;

  // Window listeners (not pointer capture) so the drag survives the sidebar
  // swapping between its open and rail render at the collapse threshold.
  function handleLeftSidebarResizeStart(
    event: ReactPointerEvent<HTMLDivElement>,
  ) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = leftSidebarOpen ? leftSidebarWidth : LEFT_SIDEBAR_RAIL;
    setLeftSidebarResizing(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const handleMove = (e: PointerEvent) => {
      const next = startWidth + (e.clientX - startX);
      setLeftSidebarWidth(
        Math.min(
          LEFT_SIDEBAR_MAX,
          Math.max(LEFT_SIDEBAR_RAIL, Math.round(next)),
        ),
      );
    };
    const handleEnd = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleEnd);
      window.removeEventListener("pointercancel", handleEnd);
      setLeftSidebarResizing(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setLeftSidebarWidth((width) =>
        width < LEFT_SIDEBAR_THRESHOLD
          ? LEFT_SIDEBAR_RAIL
          : Math.min(LEFT_SIDEBAR_MAX, Math.max(LEFT_SIDEBAR_MIN, width)),
      );
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleEnd);
    window.addEventListener("pointercancel", handleEnd);
  }

  const leftSidebarResizeHandle = (
    <div
      onPointerDown={handleLeftSidebarResizeStart}
      title="Drag to resize or collapse"
      className="group absolute inset-y-0 right-0 z-20 flex w-2 translate-x-1/2 cursor-col-resize items-center justify-center"
    >
      <span
        className={`h-10 w-0.5 rounded-full transition-colors ${
          leftSidebarResizing
            ? "bg-gray-400"
            : "bg-gray-700 group-hover:bg-gray-500"
        }`}
      />
    </div>
  );
  const [savingFlagSlug, setSavingFlagSlug] = useState<string | null>(null);
  const [selectedDocumentSlugs, setSelectedDocumentSlugs] = useState<string[]>(
    [],
  );
  const documentColorClickTimersRef = useRef<Map<string, number>>(new Map());
  const showInternalConceptGraph = false;
  const [openFlagPaletteSlug, setOpenFlagPaletteSlug] = useState<string | null>(
    null,
  );
  const [deletingDocumentSlug, setDeletingDocumentSlug] = useState<
    string | null
  >(null);

  // Chat
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);
  const [activeChatId, setActiveChatId] = useState<number | null>(null);
  const activeChatIdRef = useRef<number | null>(null);
  // `null` initially means "pick the newest persisted chat". After the user
  // presses New chat it means something different: keep a blank, unsaved
  // draft selected until its first turn creates the real row. A ref keeps
  // background history reconciliation from reopening the previous chat.
  const pendingNewChatRef = useRef(false);
  // As in the Terminal rail, history responses that overlapped a rename are
  // stale by definition. Dropping them prevents a slow refresh from briefly
  // restoring the old title over the optimistic one.
  const chatHistoryEpoch = useRef(0);
  const [inlineArtifactRetireVersion, setInlineArtifactRetireVersion] = useState(0);
  const [loadingChats, setLoadingChats] = useState(true);
  const [viewPublicChats, setViewPublicChats] = useState(false);
  const [confirmDeleteChatId, setConfirmDeleteChatId] = useState<number | null>(
    null,
  );
  const [editingChatId, setEditingChatId] = useState<number | null>(null);
  const editingChatIdRef = useRef<number | null>(null);
  const [editingChatTitle, setEditingChatTitle] = useState("");
  const [isForking, setIsForking] = useState(false);
  const [input, setInput] = useState("");
  const [agentBrowserAgent, setAgentBrowserAgent] =
    useState<ExternalAgentSelection | null>(null);
  const [deepResearchAgent, setDeepResearchAgent] =
    useState<ExternalAgentSelection | null>(null);
  const [openCodeAgent, setOpenCodeAgent] =
    useState<ExternalAgentSelection | null>(null);
  const [codexAgent, setCodexAgent] =
    useState<ExternalAgentSelection | null>(null);
  const [openPlanterAgent, setOpenPlanterAgent] =
    useState<ExternalAgentSelection | null>(null);
  const [agentReachAgent, setAgentReachAgent] =
    useState<ExternalAgentSelection | null>(null);
  const [getDocAgent, setGetDocAgent] =
    useState<ExternalAgentSelection | null>(null);
  const [meetingNotesAgent, setMeetingNotesAgent] =
    useState<ExternalAgentSelection | null>(null);
  const [deepTutorAgent, setDeepTutorAgent] =
    useState<ExternalAgentSelection | null>(null);
  const [careerOpsAgent, setCareerOpsAgent] =
    useState<ExternalAgentSelection | null>(null);
  const [tradingAgentsAgent, setTradingAgentsAgent] =
    useState<ExternalAgentSelection | null>(null);
  const [vibeTradingAgent, setVibeTradingAgent] =
    useState<ExternalAgentSelection | null>(null);
  const [stockAnalystAgent, setStockAnalystAgent] =
    useState<ExternalAgentSelection | null>(null);
  const [paperTraderAgent, setPaperTraderAgent] =
    useState<ExternalAgentSelection | null>(null);
  const [deerFlowAgent, setDeerFlowAgent] =
    useState<ExternalAgentSelection | null>(null);
  // A pasted /agents:trading-agent command pre-fills the request form; it never
  // starts a run, because a symbol and a date are not a sentence.
  const [tradingAgentsSeed, setTradingAgentsSeed] =
    useState<Partial<TradingAgentsRequest> | null>(null);
  const [shortsAgent, setShortsAgent] =
    useState<ExternalAgentSelection | null>(null);
  const [formsmithAgent, setFormsmithAgent] =
    useState<ExternalAgentSelection | null>(null);
  // Same contract for Shorts: a pasted command pre-fills the form, and a video
  // still has to be chosen before anything runs.
  const [shortsSeed, setShortsSeed] = useState<Partial<ShortsRequest> | null>(null);
  const [rufloAgent, setRufloAgent] =
    useState<ExternalAgentSelection | null>(null);
  const [launchingExternalAgent, setLaunchingExternalAgent] = useState<
    | "agent-browser"
    | "deep-research"
    | "codex"
    | "opencode"
    | "openplanter"
    | "agent-reach"
    | "get-doc"
    | "meeting-notes"
    | "deep-tutor"
    | "career-ops"
    | "trading-agent"
    | "vibe-trading"
    | "stock-analyst"
    | "paper-trader"
    | "deer-flow"
    | "hardware-blueprint"
    | "parametric-cad"
    | "hyperframes"
    | "resource2skill"
    | "openmontage"
    | "openwork"
    | "openscience"
    | "inbox-zero"
    | "vimax"
    | "money-printer"
    | "legal"
    | "shorts"
    | "formsmith"
    | "socials-manager"
    | "ruflo"
    | null
  >(null);
  const externalAgentLaunchRef = useRef<
    | "agent-browser"
    | "deep-research"
    | "codex"
    | "opencode"
    | "openplanter"
    | "agent-reach"
    | "get-doc"
    | "meeting-notes"
    | "deep-tutor"
    | "career-ops"
    | "trading-agent"
    | "vibe-trading"
    | "stock-analyst"
    | "paper-trader"
    | "deer-flow"
    | "hardware-blueprint"
    | "parametric-cad"
    | "hyperframes"
    | "resource2skill"
    | "openmontage"
    | "openwork"
    | "openscience"
    | "inbox-zero"
    | "vimax"
    | "money-printer"
    | "legal"
    | "shorts"
    | "formsmith"
    | "socials-manager"
    | "ruflo"
    | null
  >(null);
  const [externalAgentStatus, setExternalAgentStatus] = useState("");
  const [streamingChatIds, setStreamingChatIds] = useState<Set<number>>(
    () => new Set(),
  );
  const streamingChatIdsRef = useRef<Set<number>>(new Set());
  const setChatStreaming = useCallback((sessionId: number, active: boolean) => {
    const next = new Set(streamingChatIdsRef.current);
    if (active) next.add(sessionId);
    else next.delete(sessionId);
    streamingChatIdsRef.current = next;
    setStreamingChatIds(next);
  }, []);
  const agentActivity = useLegacyAgentActivity();
  useEffect(() => {
    activeChatIdRef.current = activeChatId;
  }, [activeChatId]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const activeSteerContextRef = useRef<{
    sessionId: number;
    messages: Message[];
  } | null>(null);

  useEffect(() => {
    const listener = (raw: Event) => {
      const artifact = (raw as CustomEvent<{
        id?: string;
        title?: string;
        gardenId?: string | null;
        renderer?: string;
        sourceSkill?: string | null;
      }>).detail;
      if (!artifact?.id || artifact.gardenId !== clusterSlug) return;
      setInput(
        `${interactiveVisualizerCommandForArtifact(artifact)}Revise the existing artifact "${artifact.title || "Untitled artifact"}" (artifact ID: ${artifact.id}). `,
      );
      requestAnimationFrame(() => textareaRef.current?.focus());
    };
    window.addEventListener(ARTIFACT_REVISE_EVENT, listener);
    return () => window.removeEventListener(ARTIFACT_REVISE_EVENT, listener);
  }, [clusterSlug]);

  // Upload modal
  const [showUpload, setShowUpload] = useState(false);
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [uploadStatuses, setUploadStatuses] = useState<
    Record<string, FileStatus>
  >({});
  const [uploadErrors, setUploadErrors] = useState<Record<string, string>>({});
  const [uploadSteps, setUploadSteps] = useState<Record<string, string>>({});
  const [uploadTokenUsage, setUploadTokenUsage] = useState<
    Record<string, IngestTokenUsage>
  >({});
  const [uploadVisionErrors, setUploadVisionErrors] = useState<
    Record<string, string>
  >({});
  const [uploadLabel, setUploadLabel] = useState("");
  const [isHandwriting, setIsHandwriting] = useState(false);
  const [parseWithVlm, setParseWithVlm] = useState(false);
  const [parseWithAnydoc, setParseWithAnydoc] = useState(false);
  const [generateMap, setGenerateMap] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadElapsedMs, setUploadElapsedMs] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadAbortControllerRef = useRef<AbortController | null>(null);
  const uploadCanceledRef = useRef(false);

  // Chat attachments (per-message, sent directly to the AI)
  const [chatAttachments, setChatAttachments] = useState<ChatAttachment[]>([]);
  const [extractingAttachments, setExtractingAttachments] = useState(false);
  /** What a blocking document distillation is doing right now, or null. */
  const [attachmentDistillStatus, setAttachmentDistillStatus] = useState<string | null>(null);
  const chatFileInputRef = useRef<HTMLInputElement>(null);

  // Garden note generation
  const [isGenerating, setIsGenerating] = useState(false);

  // Learn pipeline
  const [learnState, setLearnState] = useState<LearnStatusResponse | null>(
    null,
  );
  const [learnBusy, setLearnBusy] = useState(false);
  const [learnCancelBusy, setLearnCancelBusy] = useState(false);
  const [learnPanelOpen, setLearnPanelOpen] = useState(false);
  const [learnConfirmationAction, setLearnConfirmationAction] =
    useState<LearnDestructiveAction | null>(null);
  const [learnSourceOnly, setLearnSourceOnly] = useState(true);
  const [learnSkipManualReview, setLearnSkipManualReview] = useState(false);
  const [learnIncludedSourceSlugs, setLearnIncludedSourceSlugs] = useState<
    string[] | null
  >(null);
  const [learnDocumentMenuOpen, setLearnDocumentMenuOpen] = useState(false);
  const learnDocumentMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  // Syllabus: the document Learn treats as the course study guide rather than as
  // subject matter. null means "no syllabus".
  const [learnSyllabusSlug, setLearnSyllabusSlug] = useState<string | null>(null);
  const [learnSyllabusMenuOpen, setLearnSyllabusMenuOpen] = useState(false);
  const learnSyllabusMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const [learnSyllabusUploading, setLearnSyllabusUploading] = useState(false);
  // "I want to learn everything introductory about electronics" — a syllabus
  // written to order, for learners who have material but no course outline.
  const [learnSyllabusPrompt, setLearnSyllabusPrompt] = useState("");
  const [learnSyllabusGenerating, setLearnSyllabusGenerating] = useState(false);
  const learnSyllabusInputRef = useRef<HTMLInputElement | null>(null);
  const [learnTimerNowMs, setLearnTimerNowMs] = useState(() => Date.now());
  const learnSkipManualReviewRef = useRef(false);
  const lastSyncedLearnSelectionRef = useRef<string | null>(null);
  const lastSyncedLearnSyllabusRef = useRef<string | null>(null);
  const autoConfirmingLearnJobRef = useRef<string | null>(null);
  const {
    model,
    setModel,
    reasoningEffort,
    setReasoningEffort,
    intelligenceModes,
    failover: modelFailover,
  } = useAssistantIntelligence();

  // Prompts
  const [prompts, setPrompts] = useState<SavedPrompt[]>([]);
  const [showPrompts, setShowPrompts] = useState(false);
  const [promptSearch, setPromptSearch] = useState("");
  const [promptCategory, setPromptCategory] = useState("All");
  const [editingPrompt, setEditingPrompt] = useState<SavedPrompt | null>(null);

  // New markdown note modal
  const [showNewNote, setShowNewNote] = useState(false);
  const [newNoteTitle, setNewNoteTitle] = useState("");
  const [newNoteTags, setNewNoteTags] = useState("");
  const [newNoteContent, setNewNoteContent] = useState("");
  const [newNoteFolder, setNewNoteFolder] = useState("");
  const [isSavingNote, setIsSavingNote] = useState(false);

  // Model selector
  const { models, modelsLoading, loadModels } = useAssistantModels();
  const canViewPublicChats =
    isOwner && clusterVisibility === "public" && chatAccessible;
  const canForkCluster =
    !isOwner && clusterVisibility === "public" && chatAccessible && forkAllowed;

  useEffect(() => {
    setPrompts(loadPrompts());
  }, []);

  const fetchDocuments = useCallback(async () => {
    try {
      const params = new URLSearchParams({ clusterSlug });
      if (showInternalConceptGraph) params.set("includeInternalConcepts", "1");
      // The document/folder listing is derived live from the filesystem and
      // changes whenever a folder or note is added, moved, or removed. Never let
      // the browser serve a cached response, or newly created folders and pages
      // (and folders synced in from disk) stay invisible until a hard refresh.
      const res = await fetch(`/api/documents?${params.toString()}`, {
        cache: "no-store",
      });
      if (res.ok) {
        const data = await res.json();
        setDocuments(data.documents ?? []);
        setFolders(Array.isArray(data.folders) ? data.folders : []);
      }
    } catch {
      // ignore
    } finally {
      setLoadingDocs(false);
    }
  }, [clusterSlug, showInternalConceptGraph]);

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  useEffect(() => {
    const handleGardenDocumentsChanged = (raw: Event) => {
      const detail = (raw as CustomEvent<{
        gardenId?: string;
        folder?: string;
      }>).detail;
      if (detail?.gardenId !== clusterSlug) return;
      if (detail.folder) {
        setExpandedFolders((current) => new Set(current).add(detail.folder!));
      }
      setGraphRefreshVersion((current) => current + 1);
      void fetchDocuments();
    };
    window.addEventListener(GARDEN_DOCUMENTS_CHANGED_EVENT, handleGardenDocumentsChanged);
    return () => window.removeEventListener(GARDEN_DOCUMENTS_CHANGED_EVENT, handleGardenDocumentsChanged);
  }, [clusterSlug, fetchDocuments]);

  const fetchSavedLinks = useCallback(async () => {
    setLinksLoading(true);
    try {
      const res = await fetch(
        `/api/gardens/${encodeURIComponent(clusterSlug)}/links`,
      );
      const data = (await res.json().catch(() => ({}))) as {
        links?: SavedLinkInfo[];
      };
      if (res.ok) setSavedLinks(Array.isArray(data.links) ? data.links : []);
    } catch {
      // Keep the workspace usable if link metadata cannot be read.
    } finally {
      setLinksLoading(false);
    }
  }, [clusterSlug]);

  useEffect(() => {
    void fetchSavedLinks();
  }, [fetchSavedLinks]);

  const fetchLearnStatus = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/gardens/${encodeURIComponent(clusterSlug)}/learn/status`,
      );
      const data = (await res.json().catch(() => ({}))) as LearnStatusResponse;
      if (res.ok) setLearnState(data);
    } catch {
      // Status polling should never interrupt the workspace.
    }
  }, [clusterSlug]);

  useEffect(() => {
    void fetchLearnStatus();
  }, [fetchLearnStatus]);

  useEffect(() => {
    if (!Array.isArray(learnState?.selectedSourceIds)) return;
    const syncKey = `${learnState.job?.id ?? learnState.confirmedLearningMapId ?? "idle"}:${learnState.selectedSourceIds.join("|")}`;
    if (lastSyncedLearnSelectionRef.current === syncKey) return;
    lastSyncedLearnSelectionRef.current = syncKey;
    setLearnIncludedSourceSlugs([...learnState.selectedSourceIds]);
  }, [
    learnState?.confirmedLearningMapId,
    learnState?.job?.id,
    learnState?.selectedSourceIds,
  ]);

  useEffect(() => {
    if (learnState?.syllabusSourceId === undefined) return;
    const syllabusSourceId = learnState.syllabusSourceId ?? null;
    const syncKey = `${learnState.job?.id ?? learnState.confirmedLearningMapId ?? "idle"}:${syllabusSourceId ?? ""}`;
    if (lastSyncedLearnSyllabusRef.current === syncKey) return;
    lastSyncedLearnSyllabusRef.current = syncKey;
    setLearnSyllabusSlug(syllabusSourceId);
  }, [
    learnState?.confirmedLearningMapId,
    learnState?.job?.id,
    learnState?.syllabusSourceId,
  ]);

  useEffect(() => {
    if (loadingDocs) return;
    const availableSourceSlugs = new Set(
      documents
        .filter((doc) => doc.type === "source-document")
        .map((doc) => doc.slug),
    );
    setLearnIncludedSourceSlugs((current) =>
      current === null
        ? null
        : current.filter((sourceSlug) => availableSourceSlugs.has(sourceSlug)),
    );
    // A deleted syllabus silently reverts to "no syllabus" rather than starting
    // a run against a document that is no longer there.
    setLearnSyllabusSlug((current) =>
      current && !availableSourceSlugs.has(current) ? null : current,
    );
  }, [documents, loadingDocs]);

  useEffect(() => {
    const active =
      isLearnActive(learnState?.job?.status) || learnBusy || learnCancelBusy;
    if (!active) return;
    void fetchLearnStatus();
    const id = window.setInterval(() => {
      void fetchLearnStatus();
    }, 2000);
    return () => window.clearInterval(id);
  }, [fetchLearnStatus, learnBusy, learnCancelBusy, learnState?.job?.status]);

  useEffect(() => {
    setLearnTimerNowMs(Date.now());
    if (!learnState?.job?.timerStartedAt) return;
    const id = window.setInterval(() => setLearnTimerNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [learnState?.job?.id, learnState?.job?.timerStartedAt]);

  const fetchChatSessions = useCallback(async () => {
    const epoch = chatHistoryEpoch.current;
    try {
      const params = new URLSearchParams({ clusterSlug });
      if (canViewPublicChats && viewPublicChats)
        params.set("includePublicChats", "1");
      const res = await fetch(`/api/chat-sessions?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to load chats");
      const data = await res.json();
      const sessions = (data.sessions ?? []) as ChatSession[];
      if (
        chatHistoryEpoch.current !== epoch ||
        editingChatIdRef.current !== null
      ) {
        return;
      }
      setConfirmDeleteChatId(null);
      setChatSessions(sessions);
      setActiveChatId((current) => {
        if (pendingNewChatRef.current) return null;
        if (current && sessions.some((s) => s.id === current)) return current;
        return sessions[0]?.id ?? null;
      });
    } catch {
      addToast("Failed to load chats");
    } finally {
      setLoadingChats(false);
    }
  }, [addToast, canViewPublicChats, clusterSlug, viewPublicChats]);

  useEffect(() => {
    fetchChatSessions();
  }, [fetchChatSessions]);
  useEffect(() => {
    if (!canViewPublicChats) setViewPublicChats(false);
  }, [canViewPublicChats]);

  const activeChat = chatSessions.find((s) => s.id === activeChatId) ?? null;
  const messages = activeChat?.messages ?? EMPTY_MESSAGES;
  // Selecting a chat is enough to ask for its artifacts; waiting for the
  // transcript to mount its cards is what made them appear a beat late.
  useInlineArtifactPrefetch({
    legacyChatSessionId: activeChatId,
    gardenSlug: clusterSlug,
  });
  const hasRunningExternalAgentInActiveChat = messages.some(
    hasRunningExternalAgent,
  );
  const hasRunningExternalAgentInAnyChat = chatSessions.some((session) =>
    session.messages.some(hasRunningExternalAgent),
  );
  // Agent selection/health checks happen before the concrete launcher's flag
  // rises. Keep the originating assistant turn active across that whole gap.
  const [delegatedAgentLaunching, setDelegatedAgentLaunching] = useState(false);
  const isStreaming =
    (activeChatId !== null && streamingChatIds.has(activeChatId)) ||
    hasRunningExternalAgentInActiveChat;
  const {
    ref: transcriptScrollRef,
    awayFromBottom: transcriptAwayFromBottom,
    scrollToBottom: jumpToNewestMessage,
  } = useChatAutoScroll<HTMLElement>({
    isResponding: isStreaming,
    responseKey: chatAutoScrollResponseKey(messages),
    contentKey: chatAutoScrollContentKey(messages),
  });

  // A runtime agent a super-agent turn asked for, and the follow-up turn its
  // result comes back on. The structured delegation goes straight to the
  // selected launcher so its slash command is never persisted as user input.
  const awaitedLaunchRef = useRef<{
    agentName: string;
    /** Runs already in the transcript when the launch was submitted. */
    knownRunIds: Set<string>;
    runId: string | null;
  } | null>(null);
  const launchHopsRef = useRef(0);
  const continuedDelegatedRunsRef = useRef(new Set<string>());
  const delegatedAgentLaunchRef = useRef<AgentLaunchRequestPayload | null>(null);
  const [pendingLaunchContinuation, setPendingLaunchContinuation] = useState<
    string | null
  >(null);

  async function launchDelegatedAgent(
    request: AgentLaunchRequestPayload,
  ): Promise<void> {
    if (!request.originClientMessageId?.trim()) {
      setExternalAgentStatus(
        `${request.agentName} could not start because the originating assistant message is missing.`,
      );
      return;
    }
    delegatedAgentLaunchRef.current = request;
    setDelegatedAgentLaunching(true);
    try {
      switch (request.agentId) {
        case "codex":
          await selectCodex();
          await launchCodex(request.brief);
          return;
        case "opencode":
          await selectOpenCode();
          await launchOpenCode(request.brief);
          return;
        case "ruflo":
          await selectRuflo();
          await launchRuflo(request.brief);
          return;
        case "deep-research":
          if (!deepResearchAgent) await selectDeepResearch();
          await launchDeepResearch(request.brief);
          return;
        case "agent-browser": {
          const selected = agentBrowserAgent ?? (await selectAgentBrowser());
          if (selected) await launchAgentBrowser(request.brief, selected);
          return;
        }
        case "openplanter":
          if (!openPlanterAgent) await selectOpenPlanter();
          await launchOpenPlanter(request.brief);
          return;
        case "agent-reach":
          if (!agentReachAgent) await selectAgentReach();
          await launchAgentReach(request.brief);
          return;
        case "get-doc":
          if (!getDocAgent) await selectGetDoc();
          await launchGetDoc(request.brief);
          return;
        case "meeting-notes":
          if (!meetingNotesAgent) await selectMeetingNotes();
          await launchMeetingNotes(request.brief);
          return;
        case "deep-tutor":
          if (!deepTutorAgent) await selectDeepTutor();
          await launchDeepTutor(request.brief);
          return;
        case "career-ops":
          if (!careerOpsAgent) await selectCareerOps();
          await launchCareerOps(request.brief);
          return;
        case "vibe-trading":
          if (!vibeTradingAgent) await selectVibeTrading();
          await launchVibeTrading(request.brief);
          return;
        case "paper-trader":
          if (!paperTraderAgent) selectPaperTrader();
          await launchPaperTrader(request.brief);
          return;
        case "stock-analyst":
          if (!stockAnalystAgent) await selectStockAnalyst();
          await launchStockAnalyst(request.brief);
          return;
        case "deer-flow":
          if (!deerFlowAgent) await selectDeerFlow();
          await launchDeerFlow(request.brief);
          return;
        case "socials-manager":
          await launchSocialsManager(request.brief);
          return;
        case "hardware-blueprint":
          await launchHardwareBlueprint(request.brief);
          return;
        case "parametric-cad":
          await launchParametricCad(request.brief);
          return;
        case "hyperframes":
          await launchHyperframes(request.brief);
          return;
        case "resource2skill":
          await launchResource2Skill(request.brief);
          return;
        case "openmontage":
          await launchOpenMontage(request.brief);
          return;
        case "openwork":
          await launchOpenwork(request.brief);
          break;
        case "openscience":
          await launchOpenscience(request.brief);
          return;
        case "inbox-zero":
          await launchInboxZero(request.brief);
          return;
        case "vimax":
          await launchVimax(request.brief);
          return;
        case "money-printer":
          await launchMoneyPrinter(request.brief);
          return;
        default:
          setExternalAgentStatus(`${request.agentName} cannot be launched from this chat.`);
      }
    } finally {
      if (delegatedAgentLaunchRef.current?.requestId === request.requestId) {
        delegatedAgentLaunchRef.current = null;
      }
      setDelegatedAgentLaunching(false);
    }
  }

  const agentLaunchQueue = useAgentLaunchQueue({
    submit: (request) => void launchDelegatedAgent(request),
    scopeKey: activeChatId,
    ready: !isStreaming && launchingExternalAgent === null,
    onLaunched: (request) => {
      launchHopsRef.current += 1;
      awaitedLaunchRef.current = request.awaitResult
        ? {
            agentName: request.agentName,
            knownRunIds: new Set(
              messages.flatMap((message) => {
                const runId = assistantExternalAgentRunId(message);
                return runId ? [runId] : [];
              }),
            ),
            runId: null,
          }
        : null;
    },
    onDismissed: () => {
      awaitedLaunchRef.current = null;
      setExternalAgentStatus("");
    },
  });
  const agentLaunchScopeRef = useRef(activeChatId);
  useEffect(() => {
    if (agentLaunchScopeRef.current === activeChatId) return;
    agentLaunchScopeRef.current = activeChatId;
    awaitedLaunchRef.current = null;
    continuedDelegatedRunsRef.current.clear();
    setPendingLaunchContinuation(null);
  }, [activeChatId]);

  // Bind the launch to the run it started. The queue never has two in flight, so
  // the first run id that was not already in the transcript is this one's — and
  // binding by id means a run the user started themselves can never be mistaken
  // for the chain's next step.
  useEffect(() => {
    const awaited = awaitedLaunchRef.current;
    if (!awaited || awaited.runId) return;
    for (const message of messages) {
      const runId = assistantExternalAgentRunId(message);
      if (runId && !awaited.knownRunIds.has(runId)) {
        awaited.runId = runId;
        return;
      }
    }
  }, [messages]);

  // Restore the private hand-back contract after a page refresh. The child
  // observer remains mounted (but hidden), while this ref tells its terminal
  // callback which Super Agent turn is waiting. A result already persisted
  // before refresh is sent straight into the hidden continuation instead.
  useEffect(() => {
    if (loadingChats || pendingLaunchContinuation) return;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message?.role !== "assistant" || message.delegatedAgentRun !== true) {
        continue;
      }
      if (messages[index + 1]) return;
      const runId = assistantExternalAgentRunId(message);
      const continuationKey = runId ?? message.id ?? `delegated-${index}`;
      if (continuedDelegatedRunsRef.current.has(continuationKey)) return;
      const agentName = message.externalAgentName ?? "The delegated agent";
      if ((message.externalAgentOutcome ?? "running") === "running") {
        if (awaitedLaunchRef.current || !runId) return;
        awaitedLaunchRef.current = {
          agentName,
          knownRunIds: new Set(),
          runId,
        };
        return;
      }
      const awaited = awaitedLaunchRef.current;
      awaitedLaunchRef.current = null;
      continuedDelegatedRunsRef.current.add(continuationKey);
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
  }, [loadingChats, messages, pendingLaunchContinuation]);

  // The result of a finished run, handed back as a new turn. It has to wait for
  // the surface to go idle: React has not yet cleared the streaming flags when
  // the run's card reports its outcome, and a submit made then is dropped.
  useEffect(() => {
    if (
      !pendingLaunchContinuation ||
      isStreaming ||
      launchingExternalAgent !== null
    )
      return;
    const continuation = pendingLaunchContinuation;
    const timer = window.setTimeout(() => {
      setPendingLaunchContinuation(null);
      void handleSubmit(continuation, undefined, undefined, true);
    }, 0);
    return () => window.clearTimeout(timer);
    // handleSubmit is redeclared every render and reads current state when it
    // runs; depending on it here would reschedule this timer on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingLaunchContinuation, isStreaming, launchingExternalAgent]);

  // External coding runs are server-owned. On return from another browser/app
  // tab, reload their durable state so a completed result replaces the running
  // card even if the browser suspended its EventSource while hidden.
  useEffect(() => {
    if (!hasRunningExternalAgentInAnyChat) return;
    const reconcile = () => {
      if (document.visibilityState === "visible") void fetchChatSessions();
    };
    document.addEventListener("visibilitychange", reconcile);
    window.addEventListener("focus", reconcile);
    return () => {
      document.removeEventListener("visibilitychange", reconcile);
      window.removeEventListener("focus", reconcile);
    };
  }, [fetchChatSessions, hasRunningExternalAgentInAnyChat]);

  // Tick an elapsed-time counter while an upload is in progress.
  useEffect(() => {
    if (!isUploading) return;
    const startedAt = Date.now();
    setUploadElapsedMs(0);
    const id = setInterval(() => {
      setUploadElapsedMs(Date.now() - startedAt);
    }, 100);
    return () => clearInterval(id);
  }, [isUploading]);

  // ── New markdown note ────────────────────────────────────────────────────────

  function openNewNoteModal(defaultFolder = "") {
    setNewNoteTitle("");
    setNewNoteTags("");
    setNewNoteContent("");
    setNewNoteFolder(defaultFolder);
    setShowNewNote(true);
  }

  async function handleSaveNewNote(e: React.FormEvent) {
    e.preventDefault();
    if (!newNoteTitle.trim() || isSavingNote) return;
    setIsSavingNote(true);
    try {
      const res = await fetch("/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clusterSlug,
          title: newNoteTitle.trim(),
          content: newNoteContent,
          folder: newNoteFolder,
          tags: newNoteTags
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        addToast(data.error ?? "Failed to save note");
        return;
      }
      setShowNewNote(false);
      await fetchDocuments();
      addToast("Note saved", "success");
    } catch {
      addToast("Failed to save note");
    } finally {
      setIsSavingNote(false);
    }
  }

  // ── Upload modal ────────────────────────────────────────────────────────────

  async function handleSaveLink(e: React.FormEvent) {
    e.preventDefault();
    if (!newLinkUrl.trim() || savingLink) return;
    setSavingLink(true);
    try {
      const res = await fetch(
        `/api/gardens/${encodeURIComponent(clusterSlug)}/links`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: newLinkTitle.trim(),
            url: newLinkUrl.trim(),
          }),
        },
      );
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        links?: SavedLinkInfo[];
        duplicate?: boolean;
        source?: { sourceTitle?: string; sourceRelPath?: string };
      };
      if (!res.ok) {
        addToast(data.error ?? "Failed to save link");
        return;
      }
      setSavedLinks(Array.isArray(data.links) ? data.links : []);
      setNewLinkTitle("");
      setNewLinkUrl("");
      setLinksExpanded(true);
      setSourceDocsExpanded(true);
      await fetchDocuments();
      setGraphRefreshVersion((value) => value + 1);
      addToast(
        data.duplicate
          ? "Link already exists as a source"
          : "Link converted to a source",
        "success",
      );
    } catch {
      addToast("Failed to save link");
    } finally {
      setSavingLink(false);
    }
  }

  async function handleDeleteLink(linkId: string) {
    if (deletingLinkId) return;
    setDeletingLinkId(linkId);
    try {
      const res = await fetch(
        `/api/gardens/${encodeURIComponent(clusterSlug)}/links`,
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: linkId }),
        },
      );
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        links?: SavedLinkInfo[];
      };
      if (!res.ok) {
        addToast(data.error ?? "Failed to delete link");
        return;
      }
      setSavedLinks(Array.isArray(data.links) ? data.links : []);
      addToast("Link deleted", "success");
    } catch {
      addToast("Failed to delete link");
    } finally {
      setDeletingLinkId(null);
    }
  }

  async function handleCopyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      addToast("Link copied", "success");
    } catch {
      addToast("Could not copy link");
    }
  }

  function handleVideoSourceCreated(info: {
    jobId: string;
    sourceTitle: string;
    sourceRelPath: string;
    sourceSlug: string;
  }) {
    // The transcript is now a regular source: refresh the tree and graph so it
    // appears immediately, and surface a Garden Chat system message.
    setSourceDocsExpanded(true);
    void fetchDocuments();
    setGraphRefreshVersion((value) => value + 1);
    addToast(`Video transcribed: ${info.sourceTitle}`, "success");
    if (activeChatId) {
      updateChatMessages(activeChatId, (previous) => [
        ...previous,
        {
          role: "assistant",
          content: `Video transcription completed. New source available: **${info.sourceTitle}** (\`${info.sourceRelPath}\`). You can now ask questions about it in this chat.`,
        },
      ]);
    }
  }

  function openUploadModal() {
    // A dismissed upload stays owned by this workspace. Reopen its live
    // progress instead of clearing the files or replacing its controller.
    if (isUploading) {
      setShowUpload(true);
      return;
    }
    uploadCanceledRef.current = false;
    uploadAbortControllerRef.current = null;
    setUploadFiles([]);
    setUploadStatuses({});
    setUploadErrors({});
    setUploadSteps({});
    setUploadTokenUsage({});
    setUploadVisionErrors({});
    setUploadElapsedMs(0);
    setUploadLabel("");
    setIsHandwriting(false);
    setParseWithVlm(false);
    setGenerateMap(true);
    setIsDragging(false);
    setShowUpload(true);
  }

  function closeUploadModal() {
    if (isUploading) {
      uploadCanceledRef.current = true;
      uploadAbortControllerRef.current?.abort();
    }
    setShowUpload(false);
  }

  function continueUploadInBackground() {
    if (!isUploading) return;
    setSourceDocsExpanded(true);
    setShowUpload(false);
  }

  function handleFileDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    const dropped = Array.from(e.dataTransfer.files);
    if (dropped.length) {
      setUploadFiles((prev) => appendUniqueUploadFiles(prev, dropped));
    }
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length) {
      setUploadFiles((prev) => appendUniqueUploadFiles(prev, files));
    }
    e.target.value = "";
  }

  function removeUploadFile(index: number) {
    setUploadFiles((prev) => {
      const removed = prev[index];
      if (removed) {
        const key = fileKey(removed);
        setUploadStatuses((statuses) => {
          const next = { ...statuses };
          delete next[key];
          return next;
        });
        setUploadErrors((errors) => {
          const next = { ...errors };
          delete next[key];
          return next;
        });
        setUploadSteps((steps) => {
          const next = { ...steps };
          delete next[key];
          return next;
        });
        setUploadTokenUsage((usage) => {
          const next = { ...usage };
          delete next[key];
          return next;
        });
        setUploadVisionErrors((errors) => {
          const next = { ...errors };
          delete next[key];
          return next;
        });
      }
      return prev.filter((_, i) => i !== index);
    });
  }

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (uploadFiles.length === 0 || isUploading) return;

    const abortController = new AbortController();
    uploadAbortControllerRef.current = abortController;
    uploadCanceledRef.current = false;
    setIsUploading(true);
    const initial: Record<string, FileStatus> = {};
    uploadFiles.forEach((f) => {
      initial[fileKey(f)] = "pending";
    });
    setUploadStatuses(initial);
    setUploadErrors({});
    setUploadSteps({});
    setUploadTokenUsage({});
    setUploadVisionErrors({});

    let successCount = 0;
    let duplicateCount = 0;
    let snapshotCount = 0;
    let figureCount = 0;
    let mapGeneratedCount = 0;
    const screenshotWarnings: string[] = [];
    const mapWarnings: string[] = [];

    for (const file of uploadFiles) {
      if (uploadCanceledRef.current || abortController.signal.aborted) break;

      const key = fileKey(file);
      setUploadStatuses((prev) => ({ ...prev, [key]: "uploading" }));
      setUploadSteps((prev) => ({ ...prev, [key]: "Starting…" }));

      // One reader per file, most specific first: the VLM reads pixels, anydoc
      // reads document packages, handwriting OCR is the fallback for the pages
      // neither of the first two was asked for.
      const usesVlm =
        parseWithVlm &&
        vlmStatus.available &&
        VLM_PARSE_FILE_RE.test(file.name);
      const usesAnydoc =
        !usesVlm &&
        parseWithAnydoc &&
        anydocStatus.available &&
        ANYDOC_PARSE_FILE_RE.test(file.name);
      const usesHandwriting =
        !usesVlm &&
        !usesAnydoc &&
        isHandwriting &&
        HANDWRITING_FILE_RE.test(file.name);
      const formData = new FormData();
      formData.append("file", file);
      formData.append("clusterSlug", clusterSlug);
      if (uploadLabel.trim())
        formData.append("sourceLabel", uploadLabel.trim());
      formData.append("isHandwriting", String(usesHandwriting));
      formData.append("parseWithVlm", String(usesVlm));
      formData.append("parseWithAnydoc", String(usesAnydoc));
      formData.append("generateMap", String(usesHandwriting || generateMap));

      try {
        const res = await fetch("/api/ingest", {
          method: "POST",
          body: formData,
          signal: abortController.signal,
        });

        // The route streams Server-Sent Events ("data: {…}\n\n"): { type:
        // "progress", step } updates while the pipeline runs, then a final
        // { type: "result" } or { type: "error" }. A non-streaming body (e.g.
        // a 400/401/500 JSON error) is handled in the !res.body branch below.
        if (!res.ok || !res.body) {
          let message = "Upload failed";
          try {
            const data = await res.json();
            if (typeof data?.error === "string" && data.error.trim()) {
              message = data.error.trim();
            }
          } catch {
            // Fall back to the generic message.
          }
          setUploadStatuses((prev) => ({ ...prev, [key]: "error" }));
          setUploadErrors((prev) => ({ ...prev, [key]: message }));
          addToast(`${file.name}: ${message}`);
          continue;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let result: Record<string, unknown> | null = null;
        let streamError = "";
        let canceledEvent = false;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const payload = line.slice(6);
            if (payload === "[DONE]") continue;

            try {
              const event = JSON.parse(payload) as {
                type: "progress" | "usage" | "result" | "error";
                step?: string;
                error?: string;
                canceled?: boolean;
                tokenUsage?: IngestTokenUsage;
                visionError?: string;
                [key: string]: unknown;
              };

              if (event.tokenUsage) {
                setUploadTokenUsage((prev) => ({
                  ...prev,
                  [key]: event.tokenUsage!,
                }));
              }
              if (
                typeof event.visionError === "string" &&
                event.visionError.trim()
              ) {
                setUploadVisionErrors((prev) => ({
                  ...prev,
                  [key]: `${file.name}: ${event.visionError!.trim()}`,
                }));
              }

              if (event.type === "progress" && typeof event.step === "string") {
                const step = event.step;
                setUploadSteps((prev) => ({ ...prev, [key]: step }));
              } else if (event.type === "result") {
                result = event;
              } else if (event.type === "error") {
                if (event.canceled) canceledEvent = true;
                streamError =
                  typeof event.error === "string"
                    ? event.error
                    : "Upload failed";
              }
            } catch {
              // malformed event — skip
            }
          }
        }

        if (canceledEvent) {
          uploadCanceledRef.current = true;
          break;
        }

        if (result?.success) {
          setUploadStatuses((prev) => ({ ...prev, [key]: "done" }));
          setUploadErrors((prev) => {
            const next = { ...prev };
            delete next[key];
            return next;
          });
          if (result.duplicate === true) {
            duplicateCount++;
            addToast(
              `${file.name} is already in Documents; duplicate upload skipped`,
            );
          } else {
            successCount++;
            snapshotCount +=
              typeof result.imageCount === "number" ? result.imageCount : 0;
            figureCount +=
              typeof result.figureCount === "number" ? result.figureCount : 0;
            if (result.mapGenerated === true) {
              mapGeneratedCount++;
            }
            if (typeof result.screenshotWarning === "string") {
              screenshotWarnings.push(
                `${file.name}: ${result.screenshotWarning}`,
              );
            }
            if (typeof result.mapGenerationWarning === "string") {
              mapWarnings.push(`${file.name}: ${result.mapGenerationWarning}`);
            }
          }
        } else {
          const message = streamError || "Upload failed";
          setUploadStatuses((prev) => ({ ...prev, [key]: "error" }));
          setUploadErrors((prev) => ({ ...prev, [key]: message }));
          addToast(`${file.name}: ${message}`);
        }
      } catch (error) {
        const aborted =
          abortController.signal.aborted ||
          (error instanceof DOMException && error.name === "AbortError");
        if (aborted) break;

        setUploadStatuses((prev) => ({ ...prev, [key]: "error" }));
        const message =
          error instanceof Error ? error.message : "Network error";
        setUploadErrors((prev) => ({ ...prev, [key]: message }));
        addToast(`${file.name}: ${message}`);
      }
    }

    const canceled =
      uploadCanceledRef.current || abortController.signal.aborted;

    if (!canceled && (successCount > 0 || duplicateCount > 0)) {
      const readerLabel = vlmUploadEnabled
        ? "VLM parsing"
        : anydocUploadEnabled
          ? "anydoc conversion"
          : isHandwriting && hasHandwritingCompatibleFile
            ? "handwriting OCR"
            : "";
      const generationLabel = !generateMap
        ? readerLabel || "no map generation"
        : mapWarnings.length > 0 && mapGeneratedCount === 0
          ? "source saving; map generation needs retry"
          : mapWarnings.length > 0
            ? "partial map generation"
            : readerLabel
              ? `${readerLabel} and map generation`
              : "map generation";
      if (successCount > 0) {
        addToast(
          `Added ${successCount} file${successCount > 1 ? "s" : ""} with ${generationLabel}${figureCount > 0 ? `, ${figureCount} figure${figureCount === 1 ? "" : "s"}` : ""}${snapshotCount > 0 ? ` and ${snapshotCount} source snapshot${snapshotCount === 1 ? "" : "s"}` : ""}`,
          "success",
          "Upload complete",
        );
        for (const warning of screenshotWarnings) addToast(warning);
        for (const warning of mapWarnings) addToast(warning);
      }
      fetchDocuments();
      void fetchLearnStatus();
      setSourceDocsExpanded(true);
      setGraphRefreshVersion((v) => v + 1);
    } else if (canceled) {
      if (successCount > 0) {
        fetchDocuments();
        void fetchLearnStatus();
        setSourceDocsExpanded(true);
        setGraphRefreshVersion((v) => v + 1);
        addToast(
          `Upload canceled after ${successCount} file${successCount > 1 ? "s were" : " was"} added`,
        );
      } else {
        addToast("Upload canceled");
      }
      setUploadStatuses({});
      setUploadErrors({});
      setUploadSteps({});
      setUploadVisionErrors({});
      setUploadFiles([]);
      setUploadLabel("");
      setIsHandwriting(false);
      setParseWithVlm(false);
      setGenerateMap(true);
      setIsDragging(false);
    }

    uploadAbortControllerRef.current = null;
    uploadCanceledRef.current = false;
    setIsUploading(false);
  }

  // ── Chat attachments ────────────────────────────────────────────────────────

  async function attachChatFiles(files: File[]) {
    if (files.length === 0) return;

    setExtractingAttachments(true);
    const results: ChatAttachment[] = [];

    for (const file of files) {
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
      try {
        // A mesh is checked and stored whole; there is no text to extract from
        // it, and /api/extract-text would attach its bytes decoded as mojibake.
        const modelFormat = modelAttachmentFormat(file.name);
        if (modelFormat) {
          results.push(await attachModelFile(file, modelFormat));
          continue;
        }

        // A song is stored whole for the same reason: its content is a
        // waveform, and the audio analyzer reads it server-side during the
        // turn. Without this branch an mp3 dropped here would go to the text
        // extractor and come back as an unreadable file.
        const audioFormat = audioAttachmentFormat(file.name);
        if (audioFormat) {
          results.push(await attachAudioFile(file, audioFormat));
          continue;
        }

        if (["jpg", "jpeg", "png", "webp"].includes(ext)) {
          // Extract via API (handles vision / OCR)
          const fd = new FormData();
          fd.append("file", file);
          fd.append(
            "isHandwriting",
            String(isHandwriting && HANDWRITING_FILE_RE.test(file.name)),
          );
          const res = await fetch("/api/extract-text", {
            method: "POST",
            body: fd,
          });
          const data = await res.json();
          if (!res.ok || data.error)
            throw new Error(data.error ?? "Extraction failed");
          if (data.warning) addToast(`${file.name}: ${data.warning}`);
          if (data.type === "image") {
            results.push({
              type: "image",
              dataUrl: data.dataUrl,
              name: file.name,
            });
          } else {
            results.push({ type: "text", text: data.text, name: file.name });
          }
        } else if (
          [
            "txt",
            "md",
            "csv",
            "json",
            "xml",
            "html",
            "js",
            "ts",
            "py",
            "java",
            "c",
            "cpp",
            "css",
            "yaml",
            "yml",
            "toml",
            "ini",
            "sql",
            "sh",
          ].includes(ext)
        ) {
          // Text files — read client-side
          const text = await file.text();
          results.push({ type: "text", text, name: file.name });
        } else {
          // Binary formats (pdf, docx, pptx, xlsx, zip) — extract server-side
          const fd = new FormData();
          fd.append("file", file);
          fd.append(
            "isHandwriting",
            String(isHandwriting && HANDWRITING_FILE_RE.test(file.name)),
          );
          const res = await fetch("/api/extract-text", {
            method: "POST",
            body: fd,
          });
          const data = await res.json();
          if (!res.ok || data.error)
            throw new Error(data.error ?? "Extraction failed");
          if (data.warning) addToast(`${file.name}: ${data.warning}`);
          results.push({ type: "text", text: data.text, name: file.name });
        }
      } catch (error) {
        addToast(
          error instanceof Error
            ? `${file.name}: ${error.message}`
            : `Could not read ${file.name}`,
        );
      }
    }

    setChatAttachments((prev) => [...prev, ...results]);
    // A document too large to paste into every turn becomes a book-to-skill
    // skill now, while the user is still typing. The turn builds it too if it
    // has to, but by then this has almost always already cached it.
    const distillErrors = await distillAttachments(results, {
      clusterSlug,
      onStatus: (status) => setAttachmentDistillStatus(status),
    });
    setAttachmentDistillStatus(null);
    for (const message of distillErrors) addToast(message);
    setExtractingAttachments(false);
  }

  async function handleChatFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    await attachChatFiles(files);
  }

  async function handleChatPaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const imageFiles = Array.from(e.clipboardData.items)
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file));

    if (imageFiles.length === 0) return;

    e.preventDefault();
    setExtractingAttachments(true);
    try {
      const pastedImages = await Promise.all(
        imageFiles.map(async (file, index) => ({
          type: "image" as const,
          dataUrl: await fileToDataUrl(file),
          name: pastedImageName(file, index),
        })),
      );
      setChatAttachments((prev) => [...prev, ...pastedImages]);
    } catch {
      addToast("Could not read pasted image");
    } finally {
      setExtractingAttachments(false);
    }
  }

  function removeChatAttachment(index: number) {
    setChatAttachments((prev) => prev.filter((_, i) => i !== index));
  }

  function toggleSelectedDocument(slug: string) {
    let selecting = false;
    setSelectedDocumentSlugs((prev) => {
      selecting = !prev.includes(slug);
      return selecting ? [...prev, slug] : prev.filter((item) => item !== slug);
    });
    // Selecting a document is the moment the user decides to ask about it, so
    // the distillation starts here rather than inside the first turn — where it
    // would block the answer for minutes with nothing on screen but "Thinking".
    // The turn builds it too if this has not finished; the second caller joins
    // the same build.
    if (selecting) void distillGardenDocument(slug);
  }

  async function distillGardenDocument(slug: string) {
    const document = documents.find((doc) => doc.slug === slug);
    const label = document?.title ?? slug;
    const result = await distillGardenDocumentSkill(clusterSlug, slug, label, {
      onStatus: setAttachmentDistillStatus,
    });
    setAttachmentDistillStatus(null);
    if (result.error) addToast(`${label}: ${result.error}`);
  }

  // ── Document delete ─────────────────────────────────────────────────────────

  async function handleDocumentFlag(slug: string, flagColor: string) {
    const previous =
      documents.find((doc) => doc.slug === slug)?.flagColor ?? "";
    setSavingFlagSlug(slug);
    setDocuments((prev) =>
      prev.map((doc) => (doc.slug === slug ? { ...doc, flagColor } : doc)),
    );

    try {
      const res = await fetch(
        `/api/documents/${encodeURIComponent(slug)}?clusterSlug=${encodeURIComponent(clusterSlug)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ flagColor }),
        },
      );
      const data = await res.json();
      if (!res.ok || !data.success)
        throw new Error(data.error ?? "Failed to save flag");
      setGraphRefreshVersion((v) => v + 1);
    } catch {
      setDocuments((prev) =>
        prev.map((doc) =>
          doc.slug === slug ? { ...doc, flagColor: previous } : doc,
        ),
      );
      addToast("Failed to save flag color");
    } finally {
      setSavingFlagSlug(null);
    }
  }

  // ── Chat sessions ───────────────────────────────────────────────────────────

  async function handleDocumentDelete(doc: DocInfo) {
    const isSource = doc.type === "source-document";
    const prompt = isSource
      ? `Delete "${doc.title ?? doc.name}" and all lesson pages from this source?`
      : `Delete "${doc.title ?? doc.name}"?`;
    if (!window.confirm(prompt)) return;

    const previousDocuments = documents;
    setDeletingDocumentSlug(doc.slug);
    setOpenFlagPaletteSlug(null);
    setDocuments((prev) => prev.filter((item) => item.slug !== doc.slug));

    try {
      const res = await fetch(
        `/api/documents/${encodeURIComponent(doc.slug)}?clusterSlug=${encodeURIComponent(clusterSlug)}`,
        { method: "DELETE" },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success)
        throw new Error(data.error ?? "Failed to delete document");

      const deletedSlugs = Array.isArray(data.deletedSlugs)
        ? data.deletedSlugs.filter(
            (slug: unknown): slug is string => typeof slug === "string",
          )
        : [doc.slug];
      const deleted = new Set(deletedSlugs);
      setDocuments((prev) => prev.filter((item) => !deleted.has(item.slug)));
      setGraphRefreshVersion((v) => v + 1);
      addToast(isSource ? "Source PDF deleted" : "Document deleted", "success");
    } catch {
      setDocuments(previousDocuments);
      addToast("Failed to delete document");
    } finally {
      setDeletingDocumentSlug(null);
    }
  }

  function updateChatMessages(
    sessionId: number,
    updater: Message[] | ((previous: Message[]) => Message[]),
  ) {
    setChatSessions((previous) =>
      previous.map((session) => {
        if (session.id !== sessionId) return session;
        const nextMessages =
          typeof updater === "function" ? updater(session.messages) : updater;
        return {
          ...session,
          messages: nextMessages,
          updated_at: new Date().toISOString(),
        };
      }),
    );
  }

  async function createChatSession(
    title = "New chat",
  ): Promise<ChatSession | null> {
    try {
      const res = await fetch("/api/chat-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clusterSlug, title }),
      });
      const data = await res.json();
      if (!res.ok || !data.session)
        throw new Error(data.error ?? "Failed to create chat");
      const session = data.session as ChatSession;
      pendingNewChatRef.current = false;
      chatHistoryEpoch.current += 1;
      setChatSessions((previous) => [session, ...previous]);
      setActiveChatId(session.id);
      return session;
    } catch {
      addToast("Failed to create chat");
      return null;
    }
  }

  async function persistChatSession(
    sessionId: number,
    nextMessages: Message[],
    title?: string,
  ) {
    const body: { messages: Message[]; title?: string } = {
      messages: nextMessages,
    };
    if (title) body.title = title;
    try {
      const res = await fetch(`/api/chat-sessions/${sessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Failed to save chat");
      setChatSessions((previous) =>
        previous
          .map((session) =>
            session.id === sessionId
              ? {
                  ...session,
                  title: title ?? session.title,
                  messages: nextMessages,
                  updated_at: new Date().toISOString(),
                }
              : session,
          )
          .sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
      );
    } catch {
      addToast("Chat was not saved");
    }
  }

  function handleNewChat() {
    // Match Terminal: switching to a fresh chat is local and immediate. The
    // durable session is created by the first message, so repeatedly pressing
    // New chat never leaves empty rows in Recents.
    pendingNewChatRef.current = true;
    chatHistoryEpoch.current += 1;
    setActiveChatId(null);
    setConfirmDeleteChatId(null);
    cancelRenameChat();
    setInput("");
    setChatAttachments([]);
    setAttachmentDistillStatus(null);
    setExternalAgentStatus("");
    setAgentBrowserAgent(null);
    setDeepResearchAgent(null);
    setOpenCodeAgent(null);
    setCodexAgent(null);
    setOpenPlanterAgent(null);
    setAgentReachAgent(null);
    setGetDocAgent(null);
    setMeetingNotesAgent(null);
    setDeepTutorAgent(null);
    setCareerOpsAgent(null);
    setTradingAgentsAgent(null);
    setVibeTradingAgent(null);
    setStockAnalystAgent(null);
    setPaperTraderAgent(null);
    setDeerFlowAgent(null);
    setShortsAgent(null);
    setFormsmithAgent(null);
    setRufloAgent(null);
    textareaRef.current?.focus();
  }

  async function handleForkCluster() {
    if (!canForkCluster || isForking) return;
    setIsForking(true);
    try {
      const forked = await forkCluster(clusterSlug);
      addToast("Forked into your private gardens", "success");
      startNavigationProgress();
      router.push(`/gardens/${forked.slug}`);
      router.refresh();
    } catch (err) {
      addToast(err instanceof Error ? err.message : "Failed to fork garden");
    } finally {
      setIsForking(false);
    }
  }

  // A streaming chat can be deleted: the route cancels the turn and any agent
  // run it started before it removes the rows.
  async function handleDeleteChat(sessionId?: number) {
    const targetId = sessionId ?? activeChatId;
    if (!targetId) return;
    const targetSession = chatSessions.find((s) => s.id === targetId);
    if (!targetSession || (targetSession.isOwn === false && !isOwner)) return;
    setConfirmDeleteChatId(null);
    const remaining = chatSessions.filter((s) => s.id !== targetId);
    setChatSessions(remaining);
    if (activeChatId === targetId) setActiveChatId(remaining[0]?.id ?? null);
    try {
      const res = await fetch(`/api/chat-sessions/${targetId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete chat");
    } catch {
      addToast("Failed to delete chat");
      fetchChatSessions();
    }
  }

  // ── Garden note generation ──────────────────────────────────────────────────

  function startRenameChat(session: ChatSession) {
    if (session.isOwn === false) return;
    setConfirmDeleteChatId(null);
    editingChatIdRef.current = session.id;
    setEditingChatId(session.id);
    setEditingChatTitle(session.title);
  }

  function cancelRenameChat() {
    editingChatIdRef.current = null;
    setEditingChatId(null);
    setEditingChatTitle("");
  }

  function commitChatRename(sessionId: number) {
    const title = editingChatTitle.trim().replace(/\s+/g, " ");
    const session = chatSessions.find((item) => item.id === sessionId);
    if (!session || session.isOwn === false) return;
    cancelRenameChat();
    if (!title || title === session.title) return;
    void renameChatSession(session, title);
  }

  async function renameChatSession(session: ChatSession, title: string) {
    chatHistoryEpoch.current += 1;
    setChatSessions((current) =>
      current.map((item) =>
        item.id === session.id ? { ...item, title } : item,
      ),
    );

    try {
      const res = await fetch(`/api/chat-sessions/${session.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.error ?? "Failed to rename chat");
      }
      const canonical = data?.session?.title;
      if (typeof canonical === "string" && canonical !== title) {
        setChatSessions((current) =>
          current.map((item) =>
            item.id === session.id && item.title === title
              ? { ...item, title: canonical }
              : item,
          ),
        );
      }
    } catch (err) {
      // Only undo this request's value. If another rename landed while the
      // request was in flight, that newer title remains authoritative.
      setChatSessions((current) =>
        current.map((item) =>
          item.id === session.id && item.title === title
            ? { ...item, title: session.title }
            : item,
        ),
      );
      addToast(err instanceof Error ? err.message : "Failed to rename chat");
    } finally {
      chatHistoryEpoch.current += 1;
    }
  }

  async function generateGardenNotes(
    sourceMessages: Message[],
    mode: "atomic" | "chat-note" = "atomic",
  ): Promise<GeneratedNoteResult[]> {
    const res = await fetch("/api/generate-notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clusterSlug,
        messages: sourceMessages,
        model,
        mode,
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error ?? "Failed to save lesson page");
    }
    return (data.notes ?? []) as GeneratedNoteResult[];
  }

  async function tagMarkdownsFromRequest(
    requestText: string,
    sourceMessages: Message[],
    pendingAttachments: ChatAttachment[],
  ): Promise<{
    summary: string;
    updated: MarkdownTagUpdateResult[];
  }> {
    const response = await fetch("/api/tag-markdowns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clusterSlug,
        request: requestText,
        messages: sourceMessages.map(({ role, content }) => ({
          role,
          content,
        })),
        model,
        attachments: pendingAttachments,
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success) {
      throw new Error(data.error ?? "Failed to update markdown tags");
    }

    return {
      summary:
        typeof data.summary === "string" && data.summary.trim()
          ? data.summary.trim()
          : "Updated markdown tags.",
      updated: Array.isArray(data.updated)
        ? (data.updated as MarkdownTagUpdateResult[])
        : [],
    };
  }

  async function handleGenerateNotes() {
    if (messages.length === 0 || isGenerating) return;
    setIsGenerating(true);
    try {
      const hasAssistantResponse = messages.some(
        (message) => message.role === "assistant" && message.content.trim(),
      );
      if (!hasAssistantResponse) {
        addToast("No assistant response to save as a lesson page yet");
        setDocsExpanded(true);
        return;
      }

      const notes = await generateGardenNotes(messages, "chat-note");
      const count = notes.length;
      const mergedCount = notes.filter(
        (note) => note.action === "merged",
      ).length;
      addToast(
        count > 0
          ? mergedCount > 0
            ? `Updated existing lesson page: ${notes.map((note) => note.title).join(", ")}`
            : `Created lesson page: ${notes.map((note) => note.title).join(", ")}`
          : "No assistant response could be saved as a lesson page",
        count > 0 ? "success" : "error",
      );
      setDocsExpanded(true);
      if (count > 0) {
        await fetchDocuments();
        setGraphRefreshVersion((v) => v + 1);
      }
    } catch (err) {
      addToast(
        err instanceof Error ? err.message : "Failed to save lesson page",
      );
    } finally {
      setIsGenerating(false);
    }
  }

  // ── Chat submit ─────────────────────────────────────────────────────────────

  const postLearnAction = useCallback(
    async (
      endpoint:
        | "plan"
        | "confirm"
        | "generate"
        | "regenerate"
        | "rebuild"
        | "clear"
        | "cancel",
      body: Record<string, unknown> = {},
    ) => {
      const isCancel = endpoint === "cancel";
      if (!isCancel) {
        setLearnPanelOpen(true);
      }
      if (isCancel) {
        setLearnCancelBusy(true);
      } else {
        setLearnBusy(true);
      }
      try {
        const res = await fetch(
          `/api/gardens/${encodeURIComponent(clusterSlug)}/learn/${endpoint}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sourceOnly: learnSourceOnly,
              ...(learnIncludedSourceSlugs !== null
                ? {
                    includedSourceIds: learnIncludedSourceSlugs.filter(
                      (sourceSlug) => sourceSlug !== learnSyllabusSlug,
                    ),
                  }
                : {}),
              ...(learnSyllabusSlug
                ? { syllabusSourceId: learnSyllabusSlug }
                : {}),
              includeSourceSnapshots: false,
              // Keep planning interruptible from the UI. The live checkbox is
              // evaluated when the proposed map reaches the review boundary.
              skipManualReview:
                endpoint === "plan" ? false : learnSkipManualReviewRef.current,
              ...body,
            }),
          },
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.error) {
          throw new Error(data.error ?? "Learn action failed");
        }

        if (data.accepted === true) {
          await fetchLearnStatus();
          if (endpoint === "plan") {
            addToast("Learning map generation started", "success");
          } else if (endpoint === "regenerate") {
            addToast("Issue repair started", "success");
          } else if (endpoint === "rebuild") {
            addToast("Garden rebuild started", "success");
          } else if (endpoint === "confirm" || endpoint === "generate") {
            addToast("Lesson generation started", "success");
          }
          return true;
        }

        if (endpoint === "clear") {
          lastSyncedLearnSelectionRef.current = null;
          lastSyncedLearnSyllabusRef.current = null;
          autoConfirmingLearnJobRef.current = null;
          learnSkipManualReviewRef.current = false;
          setLearnIncludedSourceSlugs(null);
          setLearnSkipManualReview(false);
          setLearnDocumentMenuOpen(false);
          setLearnSyllabusSlug(null);
          setLearnSyllabusMenuOpen(false);
        }
        await fetchLearnStatus();
        await fetchDocuments();
        setGraphRefreshVersion((value) => value + 1);

        if (endpoint === "plan") {
          if (!learnSkipManualReviewRef.current) {
            addToast("Learning map ready to review", "success");
          }
        } else if (endpoint === "regenerate") {
          addToast(
            "Issues repaired; unaffected pages were preserved",
            "success",
          );
        } else if (endpoint === "rebuild") {
          addToast("Garden rebuilt", "success");
        } else if (endpoint === "clear") {
          addToast(
            "Learn data cleared; sources and non-Learn notes were preserved",
            "success",
          );
        } else if (endpoint === "confirm" || endpoint === "generate") {
          addToast("Lessons generated", "success");
        } else if (endpoint === "cancel") {
          setLearnPanelOpen(false);
          addToast("Learn job cancelled");
        }
        return true;
      } catch (error) {
        await fetchLearnStatus();
        const message =
          error instanceof Error ? error.message : "Learn action failed";
        if (isCancel || endpoint === "clear") {
          addToast(message);
        }
        return false;
      } finally {
        if (isCancel) {
          setLearnCancelBusy(false);
        } else {
          setLearnBusy(false);
        }
      }
    },
    [
      addToast,
      clusterSlug,
      fetchDocuments,
      fetchLearnStatus,
      learnIncludedSourceSlugs,
      learnSourceOnly,
      learnSyllabusSlug,
    ],
  );

  const hasExistingLearnContent = Boolean(
    learnState?.latestTextbookVersionId || learnState?.hasTextbook,
  );

  async function handleCancelLearn() {
    const status = learnState?.job?.status;
    if (
      learnCancelBusy ||
      (!isLearnActive(status) && status !== "awaiting_confirmation")
    )
      return;
    await postLearnAction("cancel", { expectedJobId: learnState?.job?.id });
  }

  async function handleLearnPrimary() {
    if (learnBusy || learnCancelBusy || isLearnActive(learnState?.job?.status))
      return;
    if (learnState?.job?.status === "awaiting_confirmation") {
      if (hasExistingLearnContent) {
        await handleRepairIssues();
        return;
      }
      setLearnPanelOpen(true);
      return;
    }
    // Existing learner content always recovers through bounded repair, even if
    // a cancelled run rolled back (or hid) its learning-map id. Planning first
    // here would silently turn Regenerate into a new-garden workflow.
    if (hasExistingLearnContent) {
      await postLearnAction("regenerate", { mode: "repair" });
      return;
    }
    if (learnState?.confirmedLearningMapId) {
      await postLearnAction("generate", {
        confirmedLearningMapId: learnState.confirmedLearningMapId,
      });
      return;
    }
    await postLearnAction("plan");
  }

  async function handleConfirmAndGenerate() {
    if (learnBusy || isLearnActive(learnState?.job?.status)) return;
    await postLearnAction("confirm", { generate: true });
  }

  async function handleRegenerateLearningMap() {
    if (learnBusy || isLearnActive(learnState?.job?.status)) return;
    await postLearnAction("plan");
  }

  async function handleRepairIssues() {
    if (learnBusy || learnCancelBusy || isLearnActive(learnState?.job?.status))
      return;
    if (learnState?.job?.status === "awaiting_confirmation") {
      const cancelled = await postLearnAction("cancel", {
        expectedJobId: learnState.job.id,
      });
      if (!cancelled) return;
    }
    await postLearnAction("regenerate", { mode: "repair" });
  }

  function handleFullRebuild() {
    if (learnBusy || isLearnActive(learnState?.job?.status)) return;
    setLearnConfirmationAction("full_rebuild");
  }

  function handleClearLearnData() {
    if (learnBusy || learnCancelBusy || isLearnActive(learnState?.job?.status))
      return;
    setLearnConfirmationAction("clear");
  }

  async function handleConfirmLearnDestructiveAction() {
    const action = learnConfirmationAction;
    if (!action || learnBusy || isLearnActive(learnState?.job?.status)) return;
    setLearnConfirmationAction(null);
    if (action === "full_rebuild") {
      await postLearnAction("rebuild", {
        mode: "full_rebuild",
        forceFullRebuild: true,
      });
      return;
    }
    await postLearnAction("clear", { confirmClearLearnData: true });
  }

  async function handleGenerateAfterCancellation() {
    await handleLearnPrimary();
  }

  const autoConfirmLearnJobId = learnState?.job?.id;
  const autoConfirmLearnJobStatus = learnState?.job?.status;
  useEffect(() => {
    if (
      !learnSkipManualReview ||
      learnBusy ||
      hasExistingLearnContent ||
      autoConfirmLearnJobStatus !== "awaiting_confirmation" ||
      !autoConfirmLearnJobId ||
      autoConfirmingLearnJobRef.current === autoConfirmLearnJobId
    ) {
      return;
    }
    autoConfirmingLearnJobRef.current = autoConfirmLearnJobId;
    void postLearnAction("confirm", { generate: true });
  }, [
    autoConfirmLearnJobId,
    autoConfirmLearnJobStatus,
    hasExistingLearnContent,
    learnBusy,
    learnSkipManualReview,
    postLearnAction,
  ]);

  function handleRetryAssistant(messageIndex: number) {
    if (isStreaming || !activeChat) return;
    let userIndex = messageIndex - 1;
    while (userIndex >= 0 && messages[userIndex]?.role !== "user") {
      userIndex -= 1;
    }
    const previousUser = messages[userIndex];
    if (!previousUser || previousUser.role !== "user") return;
    const retryAttachments = reusableChatAttachments(previousUser.attachments);
    setInlineArtifactRetireVersion((current) => current + 1);
    void handleSubmit(
      previousUser.content,
      messages.slice(0, userIndex),
      retryAttachments,
    );
  }

  function handleEditUserMessage(messageIndex: number, text: string) {
    if (isStreaming || !activeChat) return;
    const previousUser = messages[messageIndex];
    if (!previousUser || previousUser.role !== "user") return;
    const editedAttachments = reusableChatAttachments(previousUser.attachments);
    setInlineArtifactRetireVersion((current) => current + 1);
    void handleSubmit(
      text,
      messages.slice(0, messageIndex),
      editedAttachments,
    );
  }

  function handleSteerActiveResponse(text: string) {
    const correction = text.trim();
    const context = activeSteerContextRef.current;
    if (!correction || !context) return;

    void agentActivity
      .steer(correction)
      .then((accepted) => {
        if (!accepted || activeSteerContextRef.current !== context) {
          setInput((current) => current || correction);
          addToast("The response finished before it could be steered. Your message was restored.");
          return;
        }

        const correctionMessage: Message = {
          role: "user",
          content: correction,
          createdAt: new Date().toISOString(),
        };
        context.messages.push(correctionMessage);
        updateChatMessages(context.sessionId, (current) => {
          let pendingAssistantIndex = current.length - 1;
          while (
            pendingAssistantIndex >= 0 &&
            current[pendingAssistantIndex]?.role !== "assistant"
          ) {
            pendingAssistantIndex -= 1;
          }
          if (pendingAssistantIndex < 0) return [...current, correctionMessage];
          return [
            ...current.slice(0, pendingAssistantIndex),
            correctionMessage,
            ...current.slice(pendingAssistantIndex),
          ];
        });
      })
      .catch((error) => {
        setInput((current) => current || correction);
        addToast(
          error instanceof Error
            ? error.message
            : "Could not steer the active response.",
        );
      });
  }

  async function selectAgentBrowser(): Promise<ExternalAgentSelection | null> {
    setExternalAgentStatus("");
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
      setDeepResearchAgent(null);
      setCodexAgent(null);
      setOpenCodeAgent(null);
      setOpenPlanterAgent(null);
      setRufloAgent(null);
      setAgentReachAgent(null);
      setGetDocAgent(null);
      setMeetingNotesAgent(null);
      setDeepTutorAgent(null);
      setCareerOpsAgent(null);
      setTradingAgentsAgent(null);
      setVibeTradingAgent(null);
      setDeerFlowAgent(null);
      setShortsAgent(null);
      setAgentBrowserAgent(selected);
      if (data.available === false) {
        setExternalAgentStatus(
          `Agent Browser selected, but the runtime is unavailable${data.reason ? ` (${data.reason})` : ""}.`,
        );
      }
      return selected;
    } catch (error) {
      setExternalAgentStatus(
        error instanceof Error ? error.message : "Agent Browser is unavailable.",
      );
      return null;
    }
  }

  async function selectDeepResearch(): Promise<ExternalAgentSelection> {
    const selected = { id: "deep-research", name: "Deep Research" };
    setExternalAgentStatus("");
    setAgentBrowserAgent(null);
    setCodexAgent(null);
    setOpenCodeAgent(null);
    setOpenPlanterAgent(null);
    setRufloAgent(null);
    setAgentReachAgent(null);
    setGetDocAgent(null);
    setMeetingNotesAgent(null);
    setDeepTutorAgent(null);
    setCareerOpsAgent(null);
    setTradingAgentsAgent(null);
    setVibeTradingAgent(null);
    setDeerFlowAgent(null);
    setShortsAgent(null);
    setDeepResearchAgent(selected);
    try {
      const response = await fetch("/api/deep-research/health");
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setExternalAgentStatus(
          typeof data?.error === "string"
            ? data.error
            : "Deep Research is unavailable.",
        );
      } else if (data.runtimeState !== "available") {
        setExternalAgentStatus(
          `Deep Research selected, but the service is ${data.runtimeState ?? "unavailable"}.`,
        );
      }
    } catch {
      setExternalAgentStatus("Deep Research is unavailable.");
    }
    return selected;
  }

  async function selectOpenPlanter(): Promise<ExternalAgentSelection | null> {
    setExternalAgentStatus("");
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
      setAgentBrowserAgent(null);
      setDeepResearchAgent(null);
      setCodexAgent(null);
      setOpenCodeAgent(null);
      setRufloAgent(null);
      setAgentReachAgent(null);
      setGetDocAgent(null);
      setMeetingNotesAgent(null);
      setDeepTutorAgent(null);
      setCareerOpsAgent(null);
      setTradingAgentsAgent(null);
      setVibeTradingAgent(null);
      setDeerFlowAgent(null);
      setShortsAgent(null);
      setOpenPlanterAgent(selected);
      return selected;
    } catch (error) {
      setExternalAgentStatus(
        error instanceof Error ? error.message : "OpenPlanter is unavailable.",
      );
      return null;
    }
  }

  async function selectAgentReach(): Promise<ExternalAgentSelection | null> {
    setExternalAgentStatus("");
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
      setAgentBrowserAgent(null);
      setDeepResearchAgent(null);
      setCodexAgent(null);
      setOpenCodeAgent(null);
      setOpenPlanterAgent(null);
      setRufloAgent(null);
      setAgentReachAgent(selected);
      const live = Array.isArray(data.channels)
        ? data.channels.filter(
            (channel: { status?: string }) => channel.status === "ok",
          ).length
        : 0;
      if (!live) {
        setExternalAgentStatus(
          "Agent Reach selected, but no platform reported itself as reachable. Run `agent-reach doctor` to see what needs setup.",
        );
      }
      return selected;
    } catch (error) {
      setExternalAgentStatus(
        error instanceof Error ? error.message : "Agent Reach is unavailable.",
      );
      return null;
    }
  }

  /**
   * Get Doc installs nothing, so selecting it only asks which catalogs will
   * answer — and warns when no contact address is configured, because that
   * quietly costs downloads Unpaywall would otherwise have found.
   */
  async function selectMeetingNotes(): Promise<ExternalAgentSelection | null> {
    setExternalAgentStatus("");
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
      setAgentBrowserAgent(null);
      setDeepResearchAgent(null);
      setCodexAgent(null);
      setOpenCodeAgent(null);
      setOpenPlanterAgent(null);
      setRufloAgent(null);
      setAgentReachAgent(null);
      setGetDocAgent(null);
      setDeepTutorAgent(null);
      setCareerOpsAgent(null);
      setTradingAgentsAgent(null);
      setVibeTradingAgent(null);
      setDeerFlowAgent(null);
      setShortsAgent(null);
      setMeetingNotesAgent(selected);
      if (data.speakerLabels !== true && typeof data.detail === "string") {
        setExternalAgentStatus("Meeting Notes selected. " + data.detail);
      }
      return selected;
    } catch (error) {
      setExternalAgentStatus(
        error instanceof Error ? error.message : "Meeting Notes is unavailable.",
      );
      return null;
    }
  }

  async function selectGetDoc(): Promise<ExternalAgentSelection | null> {
    setExternalAgentStatus("");
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
      setAgentBrowserAgent(null);
      setDeepResearchAgent(null);
      setCodexAgent(null);
      setOpenCodeAgent(null);
      setOpenPlanterAgent(null);
      setRufloAgent(null);
      setAgentReachAgent(null);
      setCareerOpsAgent(null);
      setTradingAgentsAgent(null);
      setVibeTradingAgent(null);
      setDeerFlowAgent(null);
      setShortsAgent(null);
      setGetDocAgent(selected);
      if (data.contactConfigured !== true) {
        setExternalAgentStatus(
          "Get Doc selected. Set GET_DOC_CONTACT_EMAIL to let Unpaywall find more free full texts.",
        );
      }
      return selected;
    } catch (error) {
      setExternalAgentStatus(
        error instanceof Error ? error.message : "Get Doc is unavailable.",
      );
      return null;
    }
  }

  /**
   * Activating checks the clone and this Garden at once: a tutor that runs but
   * has nothing to read is the failure worth catching before the first
   * question, not after a vague answer.
   */
  async function selectDeepTutor(): Promise<ExternalAgentSelection | null> {
    setExternalAgentStatus("");
    try {
      const response = await fetch(
        `/api/deep-tutor/health?gardenSlug=${encodeURIComponent(clusterSlug)}`,
      );
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
      setAgentBrowserAgent(null);
      setDeepResearchAgent(null);
      setCodexAgent(null);
      setOpenCodeAgent(null);
      setOpenPlanterAgent(null);
      setRufloAgent(null);
      setAgentReachAgent(null);
      setGetDocAgent(null);
      setMeetingNotesAgent(null);
      setCareerOpsAgent(null);
      setTradingAgentsAgent(null);
      setVibeTradingAgent(null);
      setDeerFlowAgent(null);
      setShortsAgent(null);
      setDeepTutorAgent(selected);
      const scope = data.scope as { rootCount?: number } | undefined;
      if (!scope?.rootCount) {
        setExternalAgentStatus(
          `Deep Tutor selected, but ${clusterName} has no files on disk yet — it will answer from the conversation alone.`,
        );
      }
      return selected;
    } catch (error) {
      setExternalAgentStatus(
        error instanceof Error ? error.message : "Deep Tutor is unavailable.",
      );
      return null;
    }
  }

  /**
   * Same contract as Trading Agent: this agent cannot partially work, so an
   * unbuilt environment is worth saying before a video is chosen.
   */
  async function selectShorts(): Promise<ExternalAgentSelection | null> {
    setExternalAgentStatus("");
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
      setAgentBrowserAgent(null);
      setDeepResearchAgent(null);
      setCodexAgent(null);
      setOpenCodeAgent(null);
      setOpenPlanterAgent(null);
      setRufloAgent(null);
      setAgentReachAgent(null);
      setGetDocAgent(null);
      setMeetingNotesAgent(null);
      setDeepTutorAgent(null);
      setCareerOpsAgent(null);
      setTradingAgentsAgent(null);
      setVibeTradingAgent(null);
      setDeerFlowAgent(null);
      setShortsAgent(selected);
      if (data.available !== true && typeof data.reason === "string") {
        setExternalAgentStatus(data.reason);
      }
      return selected;
    } catch (error) {
      setExternalAgentStatus(
        error instanceof Error ? error.message : "Shorts is unavailable.",
      );
      return null;
    }
  }

  async function selectFormsmith(): Promise<ExternalAgentSelection | null> {
    setExternalAgentStatus("");
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
      setAgentBrowserAgent(null);
      setDeepResearchAgent(null);
      setCodexAgent(null);
      setOpenCodeAgent(null);
      setOpenPlanterAgent(null);
      setRufloAgent(null);
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
      setFormsmithAgent(selected);
      if (data.available !== true && typeof data.reason === "string") {
        setExternalAgentStatus(data.reason);
      }
      return selected;
    } catch (error) {
      setExternalAgentStatus(error instanceof Error ? error.message : "Formsmith is unavailable.");
      return null;
    }
  }

  useEffect(() => {
    if (!formsmithAgent) return;
    if (
      agentBrowserAgent || deepResearchAgent || codexAgent || openCodeAgent ||
      openPlanterAgent || rufloAgent || agentReachAgent || getDocAgent || meetingNotesAgent ||
      deepTutorAgent || careerOpsAgent || tradingAgentsAgent || vibeTradingAgent ||
      deerFlowAgent || shortsAgent
    ) {
      // This synchronizes a newly added selector with the older selector states.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFormsmithAgent(null);
    }
  }, [
    agentBrowserAgent, agentReachAgent, careerOpsAgent, codexAgent, deepResearchAgent,
    deepTutorAgent, deerFlowAgent, formsmithAgent, getDocAgent, meetingNotesAgent, openCodeAgent,
    openPlanterAgent, rufloAgent, shortsAgent, tradingAgentsAgent, vibeTradingAgent,
  ]);

  async function selectTradingAgents(): Promise<ExternalAgentSelection | null> {
    setExternalAgentStatus("");
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
      setAgentBrowserAgent(null);
      setDeepResearchAgent(null);
      setCodexAgent(null);
      setOpenCodeAgent(null);
      setOpenPlanterAgent(null);
      setRufloAgent(null);
      setAgentReachAgent(null);
      setGetDocAgent(null);
      setMeetingNotesAgent(null);
      setDeepTutorAgent(null);
      setCareerOpsAgent(null);
      setTradingAgentsAgent(selected);
      // An unbuilt environment is worth saying before the request is filled in,
      // not after.
      if (data.available !== true && typeof data.reason === "string") {
        setExternalAgentStatus(data.reason);
      }
      return selected;
    } catch (error) {
      setExternalAgentStatus(
        error instanceof Error ? error.message : "Trading Agent is unavailable.",
      );
      return null;
    }
  }

  async function selectCareerOps(): Promise<ExternalAgentSelection | null> {
    setExternalAgentStatus("");
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
      const selected = {
        id: CAREER_OPS_AGENT_ID,
        name: CAREER_OPS_AGENT_NAME,
      };
      setAgentBrowserAgent(null);
      setDeepResearchAgent(null);
      setCodexAgent(null);
      setOpenCodeAgent(null);
      setOpenPlanterAgent(null);
      setRufloAgent(null);
      setAgentReachAgent(null);
      setGetDocAgent(null);
      setMeetingNotesAgent(null);
      setDeepTutorAgent(null);
      setCareerOpsAgent(selected);
      // Not being set up is worth saying now rather than three steps into a run,
      // but it is not a refusal: several modes need no candidate profile.
      if (data.available !== true && typeof data.reason === "string") {
        setExternalAgentStatus(data.reason);
      } else if (data.onboardingNeeded === true) {
        setExternalAgentStatus(
          `Career Ops selected. It has no candidate profile yet (${(data.missing ?? []).join(", ")}), so ask it to help build one before evaluating offers.`,
        );
      }
      return selected;
    } catch (error) {
      setExternalAgentStatus(
        error instanceof Error ? error.message : "Career Ops is unavailable.",
      );
      return null;
    }
  }

  async function selectCodex(): Promise<ExternalAgentSelection> {
    const selected = { id: CODEX_AGENT_ID, name: CODEX_AGENT_NAME };
    setExternalAgentStatus("");
    setAgentBrowserAgent(null);
    setDeepResearchAgent(null);
    setOpenPlanterAgent(null);
    setOpenCodeAgent(null);
    setRufloAgent(null);
    setAgentReachAgent(null);
    setGetDocAgent(null);
    setMeetingNotesAgent(null);
    setDeepTutorAgent(null);
    setCareerOpsAgent(null);
    setTradingAgentsAgent(null);
    setVibeTradingAgent(null);
    setDeerFlowAgent(null);
    setShortsAgent(null);
    setCodexAgent(selected);
    void (async () => {
      try {
        const response = await fetch(
          `/api/codex/health?gardenSlug=${encodeURIComponent(clusterSlug)}`,
        );
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.available !== true) {
          setExternalAgentStatus(
            explainCodexError(data.reason ?? data.error, "Codex is unavailable."),
          );
        }
      } catch {
        setExternalAgentStatus("Codex is unavailable.");
      }
    })();
    return selected;
  }

  async function selectOpenCode(): Promise<ExternalAgentSelection> {
    const selected = { id: OPENCODE_AGENT_ID, name: OPENCODE_AGENT_NAME };
    setExternalAgentStatus("");
    setAgentBrowserAgent(null);
    setDeepResearchAgent(null);
    setCodexAgent(null);
    setOpenPlanterAgent(null);
    setRufloAgent(null);
    setAgentReachAgent(null);
    setGetDocAgent(null);
    setMeetingNotesAgent(null);
    setDeepTutorAgent(null);
    setCareerOpsAgent(null);
    setTradingAgentsAgent(null);
    setVibeTradingAgent(null);
    setDeerFlowAgent(null);
    setShortsAgent(null);
    setOpenCodeAgent(selected);
    void (async () => {
      try {
        const response = await fetch(
          `/api/opencode/health?gardenSlug=${encodeURIComponent(clusterSlug)}`,
        );
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.available !== true) {
          setExternalAgentStatus(
            explainOpenCodeError(
              data.reason ?? data.error,
              "OpenCode is unavailable.",
            ),
          );
        } else if (data.repository?.name) {
          setExternalAgentStatus(
            `OpenCode connected to ${String(data.repository.name)}.`,
          );
        }
      } catch {
        setExternalAgentStatus("OpenCode is unavailable.");
      }
    })();
    return selected;
  }

  async function selectRuflo(): Promise<ExternalAgentSelection> {
    const selected = { id: RUFLO_AGENT_ID, name: RUFLO_AGENT_NAME };
    setExternalAgentStatus("");
    setAgentBrowserAgent(null);
    setDeepResearchAgent(null);
    setOpenPlanterAgent(null);
    setCodexAgent(null);
    setOpenCodeAgent(null);
    setAgentReachAgent(null);
    setGetDocAgent(null);
    setMeetingNotesAgent(null);
    setDeepTutorAgent(null);
    setCareerOpsAgent(null);
    setTradingAgentsAgent(null);
    setVibeTradingAgent(null);
    setDeerFlowAgent(null);
    setShortsAgent(null);
    setRufloAgent(selected);
    void (async () => {
      try {
        const response = await fetch(
          `/api/ruflo/health?gardenSlug=${encodeURIComponent(clusterSlug)}`,
        );
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.available !== true) {
          setExternalAgentStatus(
            explainRufloError(data.reason ?? data.error, "Ruflo is unavailable."),
          );
        } else if (data.repository?.name) {
          setExternalAgentStatus(
            `Ruflo ready to swarm ${String(data.repository.name)}.`,
          );
        }
      } catch {
        setExternalAgentStatus("Ruflo is unavailable.");
      }
    })();
    return selected;
  }

  async function prepareExternalAgentSession(userContent: string) {
    // The external-turn route owns first-prompt title generation.
    void userContent;
    const writableActiveChat = activeChat?.isOwn === false ? null : activeChat;
    if (delegatedAgentLaunchRef.current) {
      if (!writableActiveChat) {
        setExternalAgentStatus(
          "The delegated agent could not find its originating chat message.",
        );
        return null;
      }
      return { session: writableActiveChat, title: undefined };
    }
    const session = writableActiveChat ?? (await createChatSession());
    if (!session) return null;
    return {
      session,
      title: undefined,
    };
  }

  async function commitExternalAgentTurn(
    session: ChatSession,
    userContent: string,
    assistantMessage: Message,
    title?: string,
    userMessageFields: Pick<Message, "attachmentNames" | "attachments"> = {},
  ) {
    const createdAt = new Date().toISOString();
    if (delegatedAgentLaunchRef.current) {
      let assistantIndex = -1;
      for (let index = session.messages.length - 1; index >= 0; index -= 1) {
        if (session.messages[index]?.role === "assistant") {
          assistantIndex = index;
          break;
        }
      }
      if (assistantIndex < 0) {
        throw new Error("The assistant message for this delegated run was not found.");
      }
      const delegatedResult =
        (assistantMessage.externalAgentOutcome &&
          assistantMessage.externalAgentOutcome !== "running") ||
        (!assistantExternalAgentRunId(assistantMessage) &&
          assistantMessage.content.trim())
          ? assistantMessage.content
          : undefined;
      const nextMessages = session.messages.map((message, index) =>
        index === assistantIndex
          ? {
              ...message,
              ...assistantMessage,
              // The delegated worker is private implementation detail. Keep
              // the Super Agent's assistant text as this row's real content;
              // the worker result is durable metadata used by its hidden
              // observer and the model-to-model continuation.
              content: message.content,
              delegatedAgentRun: true,
              externalAgentOutcome:
                assistantMessage.externalAgentOutcome ??
                (delegatedResult !== undefined
                  ? "failed"
                  : message.externalAgentOutcome ?? "running"),
              ...(message.delegatedAgentPreamble?.trim()
                ? { delegatedAgentPreamble: message.delegatedAgentPreamble }
                : message.content.trim()
                  ? { delegatedAgentPreamble: message.content }
                  : {}),
              ...(delegatedResult !== undefined
                ? { externalAgentResult: delegatedResult }
                : message.externalAgentResult !== undefined
                  ? { externalAgentResult: message.externalAgentResult }
                  : {}),
              ...(delegatedAgentLaunchRef.current?.agentName
                ? { externalAgentName: delegatedAgentLaunchRef.current.agentName }
                : {}),
              createdAt: message.createdAt ?? createdAt,
            }
          : message,
      );
      updateChatMessages(session.id, nextMessages);
      await persistChatSession(session.id, nextMessages);
      return;
    }
    const nextMessages: Message[] = [
      ...session.messages,
      { role: "user", content: userContent, createdAt, ...userMessageFields },
      { ...assistantMessage, createdAt },
    ];
    updateChatMessages(session.id, nextMessages);
    await persistChatSession(session.id, nextMessages, title);
  }

  async function runWorkflowAutomation(workflow: LocalWorkflowSummary, workflowInput: string) {
    const request = workflowInput.trim();
    const userContent = request
      ? `Run the ${workflow.name} automation\n\n${request}`
      : `Run the ${workflow.name} automation`;
    const prepared = await prepareExternalAgentSession(userContent);
    if (!prepared) return;
    setChatStreaming(prepared.session.id, true);
    try {
      const response = await fetch(`/api/workflows/local/${encodeURIComponent(workflow.id)}/run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input: workflowInput }),
      });
      const payload = await response.json().catch(() => ({})) as Partial<WorkflowRunResponse> & { error?: string };
      if (!response.ok || typeof payload.assistantContent !== "string") {
        throw new Error(payload.error || `${workflow.name} could not be run.`);
      }
      await commitExternalAgentTurn(
        prepared.session,
        userContent,
        {
          role: "assistant",
          content: `${payload.assistantContent}\n\n[Open automation settings](/workflows?workflow=${encodeURIComponent(workflow.id)})`,
        },
        prepared.title,
      );
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : `${workflow.name} could not be run.`;
      await commitExternalAgentTurn(
        prepared.session,
        userContent,
        {
          role: "assistant",
          content: `**${workflow.name}** could not be run.\n\n${message}\n\n[Open automation settings](/workflows?workflow=${encodeURIComponent(workflow.id)})`,
        },
        prepared.title,
      );
    } finally {
      setChatStreaming(prepared.session.id, false);
      textareaRef.current?.focus();
    }
  }

  async function launchAgentBrowser(
    task: string,
    selection: ExternalAgentSelection,
  ) {
    if (!task || externalAgentLaunchRef.current) {
      if (!task) setExternalAgentStatus("Type a task for Agent Browser.");
      return;
    }
    externalAgentLaunchRef.current = "agent-browser";
    setLaunchingExternalAgent("agent-browser");
    setExternalAgentStatus("");
    const userContent = agentBrowserUserMessage(task);
    const prepared = await prepareExternalAgentSession(userContent);
    if (!prepared) {
      externalAgentLaunchRef.current = null;
      setLaunchingExternalAgent(null);
      return;
    }
    try {
      const response = await fetch(
        `/api/agent-browser/agents/${encodeURIComponent(selection.id)}/runs`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ task }),
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.run?.runId) {
        throw new Error(
          typeof data?.error === "string"
            ? data.error
            : "The Agent Browser run could not start.",
        );
      }
      setChatStreaming(prepared.session.id, true);
      await commitExternalAgentTurn(
        prepared.session,
        userContent,
        {
          role: "assistant",
          content: "",
          agentBrowserRun: {
            agentId: selection.id,
            runId: String(data.run.runId),
            task,
          },
          externalAgentOutcome: "running",
        },
        prepared.title,
      );
    } catch (error) {
      await commitExternalAgentTurn(
        prepared.session,
        userContent,
        {
          role: "assistant",
          content: `The Agent Browser task could not start: ${
            error instanceof Error ? error.message : "unknown error"
          }`,
        },
        prepared.title,
      );
    } finally {
      externalAgentLaunchRef.current = null;
      setLaunchingExternalAgent(null);
      textareaRef.current?.focus();
    }
  }

  async function launchDeepResearch(task: string) {
    if (externalAgentLaunchRef.current) return;
    // The saved defaults first, then whatever flags this message carries.
    const request = parseResearchRequest(
      task,
      deepResearchDefaults(await loadAgentSettings("deep-research")),
    );
    if (!request.query) {
      setExternalAgentStatus("Type a question for Deep Research.");
      return;
    }
    externalAgentLaunchRef.current = "deep-research";
    setLaunchingExternalAgent("deep-research");
    setExternalAgentStatus("");
    const userContent = deepResearchUserMessage(task);
    const prepared = await prepareExternalAgentSession(userContent);
    if (!prepared) {
      externalAgentLaunchRef.current = null;
      setLaunchingExternalAgent(null);
      return;
    }
    try {
      const response = await fetch("/api/deep-research/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.run?.runId) {
        throw new Error(
          typeof data?.error === "string"
            ? data.error
            : "The research run could not start.",
        );
      }
      const runMessage = {
        deepResearchRun: {
          runId: String(data.run.runId),
          query: request.query,
          output: request.output,
        },
        externalAgentOutcome: "running" as const,
      };
      setChatStreaming(prepared.session.id, true);
      await commitExternalAgentTurn(
        prepared.session,
        userContent,
        { role: "assistant", content: "", ...runMessage },
        prepared.title,
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "The research run could not start.";
      await commitExternalAgentTurn(
        prepared.session,
        userContent,
        {
          role: "assistant",
          content: `The Deep Research task could not start: ${message}`,
        },
        prepared.title,
      );
    } finally {
      externalAgentLaunchRef.current = null;
      setLaunchingExternalAgent(null);
      textareaRef.current?.focus();
    }
  }

  async function launchOpenPlanter(task: string) {
    if (!task || externalAgentLaunchRef.current) {
      if (!task) setExternalAgentStatus("Type a task for OpenPlanter.");
      return;
    }
    externalAgentLaunchRef.current = "openplanter";
    setLaunchingExternalAgent("openplanter");
    setExternalAgentStatus("");
    const userContent = openPlanterUserMessage(task);
    const prepared = await prepareExternalAgentSession(userContent);
    if (!prepared) {
      externalAgentLaunchRef.current = null;
      setLaunchingExternalAgent(null);
      return;
    }
    try {
      const response = await fetch("/api/openplanter/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ task, model, reasoningEffort }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.run?.runId) {
        throw new Error(
          typeof data?.error === "string"
            ? data.error
            : "The OpenPlanter run could not start.",
        );
      }
      setChatStreaming(prepared.session.id, true);
      await commitExternalAgentTurn(
        prepared.session,
        userContent,
        {
          role: "assistant",
          content: "",
          openPlanterRun: { runId: String(data.run.runId), task },
          externalAgentOutcome: "running",
        },
        prepared.title,
      );
    } catch (error) {
      await commitExternalAgentTurn(
        prepared.session,
        userContent,
        {
          role: "assistant",
          content: `The OpenPlanter task could not start: ${
            error instanceof Error ? error.message : "unknown error"
          }`,
        },
        prepared.title,
      );
    } finally {
      externalAgentLaunchRef.current = null;
      setLaunchingExternalAgent(null);
      textareaRef.current?.focus();
    }
  }

  /**
   * Start one run from Garden Chat.
   *
   * No recording is named, and that is not an omission: the Garden composer has
   * no attachment tray for one, so the run takes the newest recording already on
   * this conversation. An empty task is allowed here, unlike every other agent's
   * launcher, because "transcribe the meeting" with nothing further said is a
   * complete request.
   */
  async function launchMeetingNotes(task: string) {
    if (externalAgentLaunchRef.current) return;
    externalAgentLaunchRef.current = "meeting-notes";
    setLaunchingExternalAgent("meeting-notes");
    setExternalAgentStatus("");
    const userContent = meetingNotesUserMessage(task);
    const prepared = await prepareExternalAgentSession(userContent);
    if (!prepared) {
      externalAgentLaunchRef.current = null;
      setLaunchingExternalAgent(null);
      return;
    }
    try {
      const response = await fetch("/api/meeting-notes/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          task,
          model,
          reasoningEffort,
          chatSessionId: prepared.session.id,
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
      setChatStreaming(prepared.session.id, true);
      await commitExternalAgentTurn(
        prepared.session,
        userContent,
        {
          role: "assistant",
          content: "",
          meetingNotesRun: { runId: String(data.run.runId), task },
          externalAgentOutcome: "running",
        },
        prepared.title,
      );
    } catch (error) {
      await commitExternalAgentTurn(
        prepared.session,
        userContent,
        {
          role: "assistant",
          content: `The meeting notes could not start: ${
            error instanceof Error ? error.message : "unknown error"
          }`,
        },
        prepared.title,
      );
    } finally {
      externalAgentLaunchRef.current = null;
      setLaunchingExternalAgent(null);
      textareaRef.current?.focus();
    }
  }

  async function launchGetDoc(task: string) {
    if (!task || externalAgentLaunchRef.current) {
      if (!task) setExternalAgentStatus("Describe the paper you are looking for.");
      return;
    }
    externalAgentLaunchRef.current = "get-doc";
    setLaunchingExternalAgent("get-doc");
    setExternalAgentStatus("");
    const userContent = getDocUserMessage(task);
    const prepared = await prepareExternalAgentSession(userContent);
    if (!prepared) {
      externalAgentLaunchRef.current = null;
      setLaunchingExternalAgent(null);
      return;
    }
    try {
      const response = await fetch("/api/get-doc/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ task, model, reasoningEffort }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.run?.runId) {
        throw new Error(
          typeof data?.error === "string"
            ? data.error
            : "The document search could not start.",
        );
      }
      setChatStreaming(prepared.session.id, true);
      await commitExternalAgentTurn(
        prepared.session,
        userContent,
        {
          role: "assistant",
          content: "",
          getDocRun: { runId: String(data.run.runId), query: task },
          externalAgentOutcome: "running",
        },
        prepared.title,
      );
    } catch (error) {
      await commitExternalAgentTurn(
        prepared.session,
        userContent,
        {
          role: "assistant",
          content: `The document search could not start: ${
            error instanceof Error ? error.message : "unknown error"
          }`,
        },
        prepared.title,
      );
    } finally {
      externalAgentLaunchRef.current = null;
      setLaunchingExternalAgent(null);
      textareaRef.current?.focus();
    }
  }

  /**
   * The Garden's slug is the whole difference between this and the Terminal's
   * launch: it is what scopes the tutor to this Garden's material.
   */
  async function launchDeepTutor(task: string) {
    if (!task || externalAgentLaunchRef.current) {
      if (!task) setExternalAgentStatus("Ask Deep Tutor something about this Garden.");
      return;
    }
    externalAgentLaunchRef.current = "deep-tutor";
    setLaunchingExternalAgent("deep-tutor");
    setExternalAgentStatus("");
    const userContent = deepTutorUserMessage(task);
    const prepared = await prepareExternalAgentSession(userContent);
    if (!prepared) {
      externalAgentLaunchRef.current = null;
      setLaunchingExternalAgent(null);
      return;
    }
    try {
      const response = await fetch("/api/deep-tutor/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          task,
          model,
          reasoningEffort,
          gardenSlug: clusterSlug,
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
      setChatStreaming(prepared.session.id, true);
      await commitExternalAgentTurn(
        prepared.session,
        userContent,
        {
          role: "assistant",
          content: "",
          deepTutorRun: {
            runId: String(data.run.runId),
            task,
            capability: String(data?.request?.capability ?? "chat"),
          },
          externalAgentOutcome: "running",
        },
        prepared.title,
      );
    } catch (error) {
      await commitExternalAgentTurn(
        prepared.session,
        userContent,
        {
          role: "assistant",
          content: `The tutoring turn could not start: ${
            error instanceof Error ? error.message : "unknown error"
          }`,
        },
        prepared.title,
      );
    } finally {
      externalAgentLaunchRef.current = null;
      setLaunchingExternalAgent(null);
      textareaRef.current?.focus();
    }
  }

  async function launchAgentReach(task: string) {
    if (!task || externalAgentLaunchRef.current) {
      if (!task) setExternalAgentStatus("Ask Agent Reach what to look up.");
      return;
    }
    externalAgentLaunchRef.current = "agent-reach";
    setLaunchingExternalAgent("agent-reach");
    setExternalAgentStatus("");
    const userContent = agentReachUserMessage(task);
    const prepared = await prepareExternalAgentSession(userContent);
    if (!prepared) {
      externalAgentLaunchRef.current = null;
      setLaunchingExternalAgent(null);
      return;
    }
    try {
      const response = await fetch("/api/agent-reach/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ task, model, reasoningEffort }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.run?.runId) {
        throw new Error(
          typeof data?.error === "string"
            ? data.error
            : "The Agent Reach run could not start.",
        );
      }
      setChatStreaming(prepared.session.id, true);
      await commitExternalAgentTurn(
        prepared.session,
        userContent,
        {
          role: "assistant",
          content: "",
          agentReachRun: { runId: String(data.run.runId), task },
          externalAgentOutcome: "running",
        },
        prepared.title,
      );
    } catch (error) {
      await commitExternalAgentTurn(
        prepared.session,
        userContent,
        {
          role: "assistant",
          content: `The Agent Reach task could not start: ${
            error instanceof Error ? error.message : "unknown error"
          }`,
        },
        prepared.title,
      );
    } finally {
      externalAgentLaunchRef.current = null;
      setLaunchingExternalAgent(null);
      textareaRef.current?.focus();
    }
  }

  async function selectDeerFlow(): Promise<ExternalAgentSelection | null> {
    setExternalAgentStatus("");
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
      const selected = {
        id: DEER_FLOW_AGENT_ID,
        name: DEER_FLOW_AGENT_NAME,
      };
      setAgentBrowserAgent(null);
      setDeepResearchAgent(null);
      setCodexAgent(null);
      setOpenCodeAgent(null);
      setOpenPlanterAgent(null);
      setRufloAgent(null);
      setAgentReachAgent(null);
      setGetDocAgent(null);
      setMeetingNotesAgent(null);
      setDeepTutorAgent(null);
      setCareerOpsAgent(null);
      setTradingAgentsAgent(null);
      setVibeTradingAgent(null);
      setDeerFlowAgent(null);
      setShortsAgent(null);
      setDeerFlowAgent(selected);
      // An unbuilt environment is worth saying before the task is typed, and so
      // is the cold start the first run has to pay.
      if (data.available !== true && typeof data.reason === "string") {
        setExternalAgentStatus(data.reason);
      } else if (data.serviceRunning !== true) {
        setExternalAgentStatus(
          "DeerFlow selected. Its Gateway starts with the first run, which takes about a minute.",
        );
      }
      return selected;
    } catch (error) {
      setExternalAgentStatus(
        error instanceof Error ? error.message : "DeerFlow is unavailable.",
      );
      return null;
    }
  }

  async function selectVibeTrading(): Promise<ExternalAgentSelection | null> {
    setExternalAgentStatus("");
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
      const selected = {
        id: VIBE_TRADING_AGENT_ID,
        name: VIBE_TRADING_AGENT_NAME,
      };
      setAgentBrowserAgent(null);
      setDeepResearchAgent(null);
      setCodexAgent(null);
      setOpenCodeAgent(null);
      setOpenPlanterAgent(null);
      setRufloAgent(null);
      setAgentReachAgent(null);
      setGetDocAgent(null);
      setMeetingNotesAgent(null);
      setDeepTutorAgent(null);
      setCareerOpsAgent(null);
      setTradingAgentsAgent(null);
      setVibeTradingAgent(null);
      setDeerFlowAgent(null);
      setShortsAgent(null);
      setVibeTradingAgent(selected);
      // An unbuilt environment is worth saying before the question is typed,
      // and so is the cold start the first run has to pay.
      if (data.available !== true && typeof data.reason === "string") {
        setExternalAgentStatus(data.reason);
      } else if (data.serviceRunning !== true) {
        setExternalAgentStatus(
          "Vibe Trading selected. Its service starts with the first run, which takes about a minute.",
        );
      }
      return selected;
    } catch (error) {
      setExternalAgentStatus(
        error instanceof Error ? error.message : "Vibe Trading is unavailable.",
      );
      return null;
    }
  }

  /**
   * Selecting is a local decision and it shows immediately; the health check
   * runs behind it. See the note on the terminal's copy — the round trip was
   * long enough to read as the app having hung, and nothing in the answer
   * changes what selecting means.
   */
  function selectPaperTrader(): ExternalAgentSelection {
    const selected = {
      id: PAPER_TRADER_AGENT_ID,
      name: PAPER_TRADER_AGENT_NAME,
    };
    setAgentBrowserAgent(null);
    setDeepResearchAgent(null);
    setCodexAgent(null);
    setOpenCodeAgent(null);
    setOpenPlanterAgent(null);
    setRufloAgent(null);
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
    setPaperTraderAgent(selected);
    setExternalAgentStatus(
      "Paper Trader selected. Send to start it. It runs while Breadboard is open and resumes next time unless you stop it.",
    );

    void (async () => {
      try {
        const response = await fetch("/api/paper-trader/health");
        const data = await response.json().catch(() => ({}));
        // Two clones have to be ready for this one, and only one of them is the
        // arena; saying which is missing beats a desk that starts and never trades.
        if (!response.ok || data.cloned !== true) {
          setExternalAgentStatus(
            typeof data?.reason === "string"
              ? data.reason
              : typeof data?.error === "string"
                ? data.error
                : "Paper Trader is unavailable.",
          );
          return;
        }
        if (data.available !== true && typeof data.reason === "string") {
          setExternalAgentStatus(data.reason);
        } else if (data?.desk?.running === true) {
          setExternalAgentStatus("The trading desk is already running. Send to see it, or say stop.");
        }
      } catch {
        // The run route reports the real reason if it comes to that.
      }
    })();

    return selected;
  }

  // Selectors written before Paper Trader do not know its state, so fold it
  // into the same one-runtime-at-a-time contract here.
  useEffect(() => {
    if (!paperTraderAgent) return;
    if (
      agentBrowserAgent || deepResearchAgent || codexAgent || openCodeAgent ||
      openPlanterAgent || rufloAgent || agentReachAgent || getDocAgent || meetingNotesAgent ||
      deepTutorAgent || careerOpsAgent || tradingAgentsAgent || vibeTradingAgent ||
      stockAnalystAgent || deerFlowAgent || shortsAgent || formsmithAgent
    ) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPaperTraderAgent(null);
    }
  }, [
    agentBrowserAgent, agentReachAgent, careerOpsAgent, codexAgent, deepResearchAgent,
    deepTutorAgent, deerFlowAgent, formsmithAgent, getDocAgent, meetingNotesAgent, openCodeAgent,
    openPlanterAgent, paperTraderAgent, rufloAgent, shortsAgent, stockAnalystAgent,
    tradingAgentsAgent, vibeTradingAgent,
  ]);

  async function selectStockAnalyst(): Promise<ExternalAgentSelection | null> {
    setExternalAgentStatus("");
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
      const selected = {
        id: STOCK_ANALYST_AGENT_ID,
        name: STOCK_ANALYST_AGENT_NAME,
      };
      setAgentBrowserAgent(null);
      setDeepResearchAgent(null);
      setCodexAgent(null);
      setOpenCodeAgent(null);
      setOpenPlanterAgent(null);
      setRufloAgent(null);
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
      setStockAnalystAgent(selected);
      // An unbuilt environment is worth saying before the question is typed,
      // and so is the cold start the first run has to pay.
      if (data.available !== true && typeof data.reason === "string") {
        setExternalAgentStatus(data.reason);
      } else if (data.serviceRunning !== true) {
        setExternalAgentStatus(
          "Stock Analyst selected. Its backend starts with the first question, which takes about a minute.",
        );
      }
      return selected;
    } catch (error) {
      setExternalAgentStatus(
        error instanceof Error ? error.message : "Stock Analyst is unavailable.",
      );
      return null;
    }
  }

  // Selectors written before Stock Analyst do not know its state, so fold it
  // into the same one-runtime-at-a-time contract here.
  useEffect(() => {
    if (!stockAnalystAgent) return;
    if (
      agentBrowserAgent || deepResearchAgent || codexAgent || openCodeAgent ||
      openPlanterAgent || rufloAgent || agentReachAgent || getDocAgent || meetingNotesAgent ||
      deepTutorAgent || careerOpsAgent || tradingAgentsAgent || vibeTradingAgent ||
      deerFlowAgent || shortsAgent || formsmithAgent
    ) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStockAnalystAgent(null);
    }
  }, [
    agentBrowserAgent, agentReachAgent, careerOpsAgent, codexAgent, deepResearchAgent,
    deepTutorAgent, deerFlowAgent, formsmithAgent, getDocAgent, meetingNotesAgent, openCodeAgent,
    openPlanterAgent, rufloAgent, shortsAgent, stockAnalystAgent,
    tradingAgentsAgent, vibeTradingAgent,
  ]);

  /**
   * Start one cutting run from a Garden chat. The clips belong to this chat, so
   * the run route is given the session it was launched from and resolves the
   * conversation itself.
   */
  async function launchShorts(request: ShortsRequest) {
    if (externalAgentLaunchRef.current) return;
    externalAgentLaunchRef.current = "shorts";
    setLaunchingExternalAgent("shorts");
    setExternalAgentStatus("");
    const userContent = shortsUserMessage(request);
    const label = shortsRunLabel(request);
    const prepared = await prepareExternalAgentSession(userContent);
    if (!prepared) {
      externalAgentLaunchRef.current = null;
      setLaunchingExternalAgent(null);
      return;
    }
    try {
      const response = await fetch("/api/shorts/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ request, model, chatSessionId: prepared.session.id }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.run?.runId) {
        throw new Error(
          typeof data?.error === "string" ? data.error : "The clips could not start.",
        );
      }
      setChatStreaming(prepared.session.id, true);
      await commitExternalAgentTurn(
        prepared.session,
        userContent,
        {
          role: "assistant",
          content: "",
          shortsRun: { runId: String(data.run.runId), task: label },
          externalAgentOutcome: "running",
        },
        prepared.title,
      );
    } catch (error) {
      await commitExternalAgentTurn(
        prepared.session,
        userContent,
        {
          role: "assistant",
          content: `The clips could not start: ${
            error instanceof Error ? error.message : "unknown error"
          }`,
        },
        prepared.title,
      );
    } finally {
      externalAgentLaunchRef.current = null;
      setLaunchingExternalAgent(null);
    }
  }

  async function launchFormsmith(request: FormsmithRequest) {
    if (externalAgentLaunchRef.current) return;
    externalAgentLaunchRef.current = "formsmith";
    setLaunchingExternalAgent("formsmith");
    setExternalAgentStatus("");
    const userContent = formsmithUserMessage(request);
    const label = formsmithRunLabel(request);
    const prepared = await prepareExternalAgentSession(userContent);
    if (!prepared) {
      externalAgentLaunchRef.current = null;
      setLaunchingExternalAgent(null);
      return;
    }
    try {
      const response = await fetch("/api/shaper/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ request, chatSessionId: prepared.session.id }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.run?.runId) {
        throw new Error(typeof data?.error === "string" ? data.error : "The reconstruction could not start.");
      }
      setChatStreaming(prepared.session.id, true);
      await commitExternalAgentTurn(
        prepared.session,
        userContent,
        {
          role: "assistant",
          content: "",
          formsmithRun: { runId: String(data.run.runId), task: label },
          externalAgentOutcome: "running",
        },
        prepared.title,
      );
    } catch (error) {
      await commitExternalAgentTurn(
        prepared.session,
        userContent,
        {
          role: "assistant",
          content: `The reconstruction could not start: ${error instanceof Error ? error.message : "unknown error"}`,
        },
        prepared.title,
      );
    } finally {
      externalAgentLaunchRef.current = null;
      setLaunchingExternalAgent(null);
    }
  }

  async function launchTradingAgents(request: TradingAgentsRequest) {
    if (externalAgentLaunchRef.current) return;
    externalAgentLaunchRef.current = "trading-agent";
    setLaunchingExternalAgent("trading-agent");
    setExternalAgentStatus("");
    const userContent = tradingAgentsUserMessage(request);
    const label = tradingAgentsRunLabel(request);
    const prepared = await prepareExternalAgentSession(userContent);
    if (!prepared) {
      externalAgentLaunchRef.current = null;
      setLaunchingExternalAgent(null);
      return;
    }
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
      setChatStreaming(prepared.session.id, true);
      await commitExternalAgentTurn(
        prepared.session,
        userContent,
        {
          role: "assistant",
          content: "",
          tradingAgentsRun: { runId: String(data.run.runId), task: label },
          externalAgentOutcome: "running",
        },
        prepared.title,
      );
    } catch (error) {
      await commitExternalAgentTurn(
        prepared.session,
        userContent,
        {
          role: "assistant",
          content: `The analysis could not start: ${
            error instanceof Error ? error.message : "unknown error"
          }`,
        },
        prepared.title,
      );
    } finally {
      externalAgentLaunchRef.current = null;
      setLaunchingExternalAgent(null);
    }
  }

  async function launchCareerOps(task: string) {
    if (!task || externalAgentLaunchRef.current) {
      if (!task) {
        setExternalAgentStatus(
          "Paste a job posting, or name a mode — tracker, scan, cover, interview.",
        );
      }
      return;
    }
    externalAgentLaunchRef.current = "career-ops";
    setLaunchingExternalAgent("career-ops");
    setExternalAgentStatus("");
    const userContent = careerOpsUserMessage(task);
    const prepared = await prepareExternalAgentSession(userContent);
    if (!prepared) {
      externalAgentLaunchRef.current = null;
      setLaunchingExternalAgent(null);
      return;
    }
    try {
      const response = await fetch("/api/career-ops/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ task, model, reasoningEffort }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.run?.runId) {
        throw new Error(
          typeof data?.error === "string"
            ? data.error
            : "The Career Ops run could not start.",
        );
      }
      setChatStreaming(prepared.session.id, true);
      await commitExternalAgentTurn(
        prepared.session,
        userContent,
        {
          role: "assistant",
          content: "",
          careerOpsRun: { runId: String(data.run.runId), task },
          externalAgentOutcome: "running",
        },
        prepared.title,
      );
    } catch (error) {
      await commitExternalAgentTurn(
        prepared.session,
        userContent,
        {
          role: "assistant",
          content: `The Career Ops task could not start: ${
            error instanceof Error ? error.message : "unknown error"
          }`,
        },
        prepared.title,
      );
    } finally {
      externalAgentLaunchRef.current = null;
      setLaunchingExternalAgent(null);
      textareaRef.current?.focus();
    }
  }

  async function launchVibeTrading(task: string) {
    if (!task || externalAgentLaunchRef.current) {
      if (!task) {
        setExternalAgentStatus(
          "Ask a finance question — a strategy to backtest, a factor to test, a market to look at.",
        );
      }
      return;
    }
    externalAgentLaunchRef.current = "vibe-trading";
    setLaunchingExternalAgent("vibe-trading");
    setExternalAgentStatus("");
    const userContent = vibeTradingUserMessage(task);
    const prepared = await prepareExternalAgentSession(userContent);
    if (!prepared) {
      externalAgentLaunchRef.current = null;
      setLaunchingExternalAgent(null);
      return;
    }
    try {
      const response = await fetch("/api/vibe-trading/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ task, model, reasoningEffort }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.run?.runId) {
        throw new Error(
          typeof data?.error === "string"
            ? data.error
            : "The Vibe Trading run could not start.",
        );
      }
      setChatStreaming(prepared.session.id, true);
      await commitExternalAgentTurn(
        prepared.session,
        userContent,
        {
          role: "assistant",
          content: "",
          vibeTradingRun: { runId: String(data.run.runId), task },
          externalAgentOutcome: "running",
        },
        prepared.title,
      );
    } catch (error) {
      await commitExternalAgentTurn(
        prepared.session,
        userContent,
        {
          role: "assistant",
          content: `The Vibe Trading request could not start: ${
            error instanceof Error ? error.message : "unknown error"
          }`,
        },
        prepared.title,
      );
    } finally {
      externalAgentLaunchRef.current = null;
      setLaunchingExternalAgent(null);
      textareaRef.current?.focus();
    }
  }

  /**
   * Carry one instruction to the trading desk. The task may be empty — a bare
   * command is how the desk is opened — so nothing refuses on a blank message.
   */
  async function launchPaperTrader(task: string) {
    if (externalAgentLaunchRef.current) return;
    externalAgentLaunchRef.current = "paper-trader";
    setLaunchingExternalAgent("paper-trader");
    setExternalAgentStatus("");
    const userContent = paperTraderUserMessage(task);
    const prepared = await prepareExternalAgentSession(userContent);
    if (!prepared) {
      externalAgentLaunchRef.current = null;
      setLaunchingExternalAgent(null);
      return;
    }
    try {
      const response = await fetch("/api/paper-trader/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ task }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.run?.runId) {
        throw new Error(
          typeof data?.error === "string"
            ? data.error
            : "The trading desk could not start.",
        );
      }
      setChatStreaming(prepared.session.id, true);
      await commitExternalAgentTurn(
        prepared.session,
        userContent,
        {
          role: "assistant",
          content: "",
          paperTraderRun: { runId: String(data.run.runId), task },
          externalAgentOutcome: "running",
        },
        prepared.title,
      );
    } catch (error) {
      await commitExternalAgentTurn(
        prepared.session,
        userContent,
        {
          role: "assistant",
          content: `The trading desk could not start: ${
            error instanceof Error ? error.message : "unknown error"
          }`,
        },
        prepared.title,
      );
    } finally {
      externalAgentLaunchRef.current = null;
      setLaunchingExternalAgent(null);
    }
  }

  async function launchStockAnalyst(task: string) {
    if (!task || externalAgentLaunchRef.current) {
      if (!task) {
        setExternalAgentStatus(
          "Ask about a stock — a code or a name, and what you want to know: trend, levels, news, whether to hold.",
        );
      }
      return;
    }
    externalAgentLaunchRef.current = "stock-analyst";
    setLaunchingExternalAgent("stock-analyst");
    setExternalAgentStatus("");
    const userContent = stockAnalystUserMessage(task);
    const prepared = await prepareExternalAgentSession(userContent);
    if (!prepared) {
      externalAgentLaunchRef.current = null;
      setLaunchingExternalAgent(null);
      return;
    }
    try {
      const response = await fetch("/api/stock-analyst/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ task, model }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.run?.runId) {
        throw new Error(
          typeof data?.error === "string"
            ? data.error
            : "The Stock Analyst run could not start.",
        );
      }
      setChatStreaming(prepared.session.id, true);
      await commitExternalAgentTurn(
        prepared.session,
        userContent,
        {
          role: "assistant",
          content: "",
          stockAnalystRun: { runId: String(data.run.runId), task },
          externalAgentOutcome: "running",
        },
        prepared.title,
      );
    } catch (error) {
      await commitExternalAgentTurn(
        prepared.session,
        userContent,
        {
          role: "assistant",
          content: `The Stock Analyst question could not start: ${
            error instanceof Error ? error.message : "unknown error"
          }`,
        },
        prepared.title,
      );
    } finally {
      externalAgentLaunchRef.current = null;
      setLaunchingExternalAgent(null);
      textareaRef.current?.focus();
    }
  }

  async function launchDeerFlow(task: string) {
    if (!task || externalAgentLaunchRef.current) {
      if (!task) {
        setExternalAgentStatus(
          "Give DeerFlow a job — something to research, write, work out or produce.",
        );
      }
      return;
    }
    externalAgentLaunchRef.current = "deer-flow";
    setLaunchingExternalAgent("deer-flow");
    setExternalAgentStatus("");
    const userContent = deerFlowUserMessage(task);
    const prepared = await prepareExternalAgentSession(userContent);
    if (!prepared) {
      externalAgentLaunchRef.current = null;
      setLaunchingExternalAgent(null);
      return;
    }
    try {
      const response = await fetch("/api/deer-flow/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          task,
          model,
          reasoningEffort,
          // The files a run presents belong to this chat, which the route
          // resolves from the legacy session id this surface still runs on.
          chatSessionId: prepared.session.id,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.run?.runId) {
        throw new Error(
          typeof data?.error === "string"
            ? data.error
            : "The DeerFlow run could not start.",
        );
      }
      setChatStreaming(prepared.session.id, true);
      await commitExternalAgentTurn(
        prepared.session,
        userContent,
        {
          role: "assistant",
          content: "",
          deerFlowRun: { runId: String(data.run.runId), task },
          externalAgentOutcome: "running",
        },
        prepared.title,
      );
    } catch (error) {
      await commitExternalAgentTurn(
        prepared.session,
        userContent,
        {
          role: "assistant",
          content: `The DeerFlow run could not start: ${
            error instanceof Error ? error.message : "unknown error"
          }`,
        },
        prepared.title,
      );
    } finally {
      externalAgentLaunchRef.current = null;
      setLaunchingExternalAgent(null);
      textareaRef.current?.focus();
    }
  }

  async function launchSocialsManager(brief: string) {
    if (!brief || externalAgentLaunchRef.current) {
      if (!brief) setExternalAgentStatus("Tell the Socials Manager what the post is about.");
      return;
    }
    externalAgentLaunchRef.current = "socials-manager";
    setLaunchingExternalAgent("socials-manager");
    setExternalAgentStatus("");
    const userContent = socialsManagerUserMessage(brief);
    const prepared = await prepareExternalAgentSession(userContent);
    if (!prepared) {
      externalAgentLaunchRef.current = null;
      setLaunchingExternalAgent(null);
      return;
    }
    updateChatMessages(prepared.session.id, [
      ...prepared.session.messages,
      {
        id: `socials-manager-pending-${crypto.randomUUID()}`,
        role: "user",
        content: userContent,
        createdAt: new Date().toISOString(),
      },
    ]);
    try {
      const response = await fetch("/api/socials-manager/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          brief,
          model,
          chatSessionId: prepared.session.id,
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
      setChatStreaming(prepared.session.id, true);
      await commitExternalAgentTurn(
        prepared.session,
        userContent,
        {
          role: "assistant",
          content: "",
          socialsManagerRun: { runId: String(data.run.runId), brief },
          externalAgentOutcome: "running",
        },
        prepared.title,
      );
    } catch (error) {
      await commitExternalAgentTurn(
        prepared.session,
        userContent,
        {
          role: "assistant",
          content: `The Socials Manager task could not start: ${
            error instanceof Error ? error.message : "unknown error"
          }`,
        },
        prepared.title,
      );
    } finally {
      externalAgentLaunchRef.current = null;
      setLaunchingExternalAgent(null);
      textareaRef.current?.focus();
    }
  }

  async function launchHardwareBlueprint(brief: string) {
    if (!brief || externalAgentLaunchRef.current) {
      if (!brief) setExternalAgentStatus("Tell Hardware Blueprint what to build.");
      return;
    }
    externalAgentLaunchRef.current = "hardware-blueprint";
    setLaunchingExternalAgent("hardware-blueprint");
    setExternalAgentStatus("");
    const userContent = hardwareBlueprintUserMessage(brief);
    const launchClientMessageId = crypto.randomUUID();
    const prepared = await prepareExternalAgentSession(userContent);
    if (!prepared) {
      externalAgentLaunchRef.current = null;
      setLaunchingExternalAgent(null);
      return;
    }
    updateChatMessages(prepared.session.id, [
      ...prepared.session.messages,
      {
        id: `hardware-pending-${crypto.randomUUID()}`,
        role: "user",
        content: userContent,
        createdAt: new Date().toISOString(),
      },
    ]);
    try {
      const response = await fetch("/api/hardware-blueprint/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          brief,
          model,
          reasoningEffort,
          chatSessionId: prepared.session.id,
          clientMessageId: launchClientMessageId,
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
      setChatStreaming(prepared.session.id, true);
      await commitExternalAgentTurn(
        prepared.session,
        userContent,
        {
          role: "assistant",
          content: "",
          hardwareBlueprintRun: { runId: String(data.run.runId), brief },
          externalAgentOutcome: "running",
        },
        prepared.title,
      );
    } catch (error) {
      await commitExternalAgentTurn(
        prepared.session,
        userContent,
        {
          role: "assistant",
          content: `The hardware blueprint could not start: ${
            error instanceof Error ? error.message : "unknown error"
          }`,
        },
        prepared.title,
      );
    } finally {
      externalAgentLaunchRef.current = null;
      setLaunchingExternalAgent(null);
      textareaRef.current?.focus();
    }
  }

  async function launchParametricCad(brief: string) {
    if (!brief || externalAgentLaunchRef.current) {
      if (!brief) setExternalAgentStatus("Tell Parametric CAD what part to design.");
      return;
    }
    externalAgentLaunchRef.current = "parametric-cad";
    setLaunchingExternalAgent("parametric-cad");
    setExternalAgentStatus("");
    const userContent = parametricCadUserMessage(brief);
    // This key is scoped to the prepared Garden conversation by the run
    // manager. Replaying the launch request can therefore recover the same run
    // without changing the legacy Garden transcript owner below.
    const launchClientMessageId = crypto.randomUUID();
    const prepared = await prepareExternalAgentSession(userContent);
    if (!prepared) {
      externalAgentLaunchRef.current = null;
      setLaunchingExternalAgent(null);
      return;
    }
    updateChatMessages(prepared.session.id, [
      ...prepared.session.messages,
      {
        id: `cad-pending-${crypto.randomUUID()}`,
        role: "user",
        content: userContent,
        createdAt: new Date().toISOString(),
      },
    ]);
    try {
      const response = await fetch("/api/cad/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          brief,
          model,
          reasoningEffort,
          chatSessionId: prepared.session.id,
          clientMessageId: launchClientMessageId,
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
      setChatStreaming(prepared.session.id, true);
      await commitExternalAgentTurn(
        prepared.session,
        userContent,
        {
          role: "assistant",
          content: "",
          parametricCadRun: { runId: String(data.run.runId), brief },
          externalAgentOutcome: "running",
        },
        prepared.title,
      );
    } catch (error) {
      await commitExternalAgentTurn(
        prepared.session,
        userContent,
        {
          role: "assistant",
          content: `The parametric CAD run could not start: ${
            error instanceof Error ? error.message : "unknown error"
          }`,
        },
        prepared.title,
      );
    } finally {
      externalAgentLaunchRef.current = null;
      setLaunchingExternalAgent(null);
      textareaRef.current?.focus();
    }
  }

  /**
   * ViMax produces a film from an idea: story, screenplay, cast, storyboard and
   * drawn frames, ending in one artifact that plays as an animatic. The run is
   * long, so the turn is recorded as soon as it starts and the card streams in.
   */
  async function launchVimax(brief: string) {
    if (!brief || externalAgentLaunchRef.current) {
      if (!brief) setExternalAgentStatus("Tell ViMax what film to make.");
      return;
    }
    externalAgentLaunchRef.current = "vimax";
    setLaunchingExternalAgent("vimax");
    setExternalAgentStatus("");
    const userContent = vimaxUserMessage(brief);
    const prepared = await prepareExternalAgentSession(userContent);
    if (!prepared) {
      externalAgentLaunchRef.current = null;
      setLaunchingExternalAgent(null);
      return;
    }
    updateChatMessages(prepared.session.id, [
      ...prepared.session.messages,
      {
        id: `vimax-pending-${crypto.randomUUID()}`,
        role: "user",
        content: userContent,
        createdAt: new Date().toISOString(),
      },
    ]);
    try {
      const response = await fetch("/api/vimax/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          brief,
          model,
          reasoningEffort,
          chatSessionId: prepared.session.id,
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
      setChatStreaming(prepared.session.id, true);
      await commitExternalAgentTurn(
        prepared.session,
        userContent,
        {
          role: "assistant",
          content: "",
          vimaxRun: { runId: String(data.run.runId), brief },
          externalAgentOutcome: "running",
        },
        prepared.title,
      );
    } catch (error) {
      await commitExternalAgentTurn(
        prepared.session,
        userContent,
        {
          role: "assistant",
          content: `The film could not start: ${
            error instanceof Error ? error.message : "unknown error"
          }`,
        },
        prepared.title,
      );
    } finally {
      externalAgentLaunchRef.current = null;
      setLaunchingExternalAgent(null);
      textareaRef.current?.focus();
    }
  }

  /**
   * The Legal Agent works on the documents attached to the message: they are
   * written into the run's workspace and read there, one file at a time, so
   * the answer can cite which document a point came from. Whatever it drafts
   * comes back as an artifact of this Garden's chat.
   */
  async function launchLegal(task: string, attachments: readonly ChatAttachment[]) {
    if (!task || externalAgentLaunchRef.current) {
      if (!task) setExternalAgentStatus("Tell the Legal Agent what the assignment is.");
      return;
    }
    externalAgentLaunchRef.current = "legal";
    setLaunchingExternalAgent("legal");
    setExternalAgentStatus("");
    const userContent = legalUserMessage(task);
    const prepared = await prepareExternalAgentSession(userContent);
    if (!prepared) {
      externalAgentLaunchRef.current = null;
      setLaunchingExternalAgent(null);
      return;
    }
    updateChatMessages(prepared.session.id, [
      ...prepared.session.messages,
      {
        id: `legal-pending-${crypto.randomUUID()}`,
        role: "user",
        content: userContent,
        createdAt: new Date().toISOString(),
        attachments: chatMessageAttachments(attachments),
      },
    ]);
    try {
      const response = await fetch("/api/legal/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          task,
          model,
          reasoningEffort,
          attachments,
          chatSessionId: prepared.session.id,
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
      setChatStreaming(prepared.session.id, true);
      await commitExternalAgentTurn(
        prepared.session,
        userContent,
        {
          role: "assistant",
          content: "",
          legalRun: { runId: String(data.run.runId), task: legalRunLabel({ task }) },
          externalAgentOutcome: "running",
        },
        prepared.title,
      );
    } catch (error) {
      await commitExternalAgentTurn(
        prepared.session,
        userContent,
        {
          role: "assistant",
          content: `The assignment could not start: ${
            error instanceof Error ? error.message : "unknown error"
          }`,
        },
        prepared.title,
      );
    } finally {
      externalAgentLaunchRef.current = null;
      setLaunchingExternalAgent(null);
      textareaRef.current?.focus();
    }
  }

  /**
   * MoneyPrinter cuts stock footage to a script it writes itself, so the turn
   * carries only the subject of the video. The finished MP4 comes back as an
   * artifact of this Garden's chat rather than as text.
   */
  async function launchMoneyPrinter(brief: string) {
    if (!brief || externalAgentLaunchRef.current) {
      if (!brief) setExternalAgentStatus("Tell MoneyPrinter what the video should be about.");
      return;
    }
    externalAgentLaunchRef.current = "money-printer";
    setLaunchingExternalAgent("money-printer");
    setExternalAgentStatus("");
    const userContent = moneyPrinterUserMessage(brief);
    const prepared = await prepareExternalAgentSession(userContent);
    if (!prepared) {
      externalAgentLaunchRef.current = null;
      setLaunchingExternalAgent(null);
      return;
    }
    updateChatMessages(prepared.session.id, [
      ...prepared.session.messages,
      {
        id: `money-printer-pending-${crypto.randomUUID()}`,
        role: "user",
        content: userContent,
        createdAt: new Date().toISOString(),
      },
    ]);
    try {
      const response = await fetch("/api/money-printer/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          brief,
          model,
          chatSessionId: prepared.session.id,
        }),
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
      setChatStreaming(prepared.session.id, true);
      await commitExternalAgentTurn(
        prepared.session,
        userContent,
        {
          role: "assistant",
          content: "",
          moneyPrinterRun: { runId: String(data.run.runId), brief },
          externalAgentOutcome: "running",
        },
        prepared.title,
      );
    } catch (error) {
      await commitExternalAgentTurn(
        prepared.session,
        userContent,
        {
          role: "assistant",
          content: `The video could not start: ${
            error instanceof Error ? error.message : "unknown error"
          }`,
        },
        prepared.title,
      );
    } finally {
      externalAgentLaunchRef.current = null;
      setLaunchingExternalAgent(null);
      textareaRef.current?.focus();
    }
  }

  /**
   * OpenWork works inside its own durable workspace rather than this Garden's
   * repository, so the turn carries only the task — there is no repository to
   * name and nothing to check out.
   */
  async function launchOpenwork(task: string) {
    if (!task || externalAgentLaunchRef.current) {
      if (!task) setExternalAgentStatus("Tell OpenWork what to do in your workspace.");
      return;
    }
    externalAgentLaunchRef.current = "openwork";
    setLaunchingExternalAgent("openwork");
    setExternalAgentStatus("");
    const userContent = openworkUserMessage(task);
    const prepared = await prepareExternalAgentSession(userContent);
    if (!prepared) {
      externalAgentLaunchRef.current = null;
      setLaunchingExternalAgent(null);
      return;
    }
    updateChatMessages(prepared.session.id, [
      ...prepared.session.messages,
      {
        id: `openwork-pending-${crypto.randomUUID()}`,
        role: "user",
        content: userContent,
        createdAt: new Date().toISOString(),
      },
    ]);
    try {
      const response = await fetch("/api/openwork/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          task,
          model,
          reasoningEffort,
          chatSessionId: prepared.session.id,
        }),
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
      setChatStreaming(prepared.session.id, true);
      await commitExternalAgentTurn(
        prepared.session,
        userContent,
        {
          role: "assistant",
          content: "",
          openworkRun: { runId: String(data.run.runId), task },
          externalAgentOutcome: "running",
        },
        prepared.title,
      );
    } catch (error) {
      await commitExternalAgentTurn(
        prepared.session,
        userContent,
        {
          role: "assistant",
          content: `The OpenWork run could not start: ${
            error instanceof Error ? error.message : "unknown error"
          }`,
        },
        prepared.title,
      );
    } finally {
      externalAgentLaunchRef.current = null;
      setLaunchingExternalAgent(null);
      textareaRef.current?.focus();
    }
  }


  /**
   * Inbox Zero works on the user's mailbox rather than on this Garden, so the
   * turn carries only the instruction — there is no repository to name and
   * nothing to check out. A cold run also starts the mail app's containers,
   * which is why the turn is committed before the first event arrives.
   */
  async function launchInboxZero(task: string) {
    if (!task || externalAgentLaunchRef.current) {
      if (!task) setExternalAgentStatus("Tell Inbox Zero what to do with your email.");
      return;
    }
    externalAgentLaunchRef.current = "inbox-zero";
    setLaunchingExternalAgent("inbox-zero");
    setExternalAgentStatus("");
    const userContent = inboxZeroUserMessage(task);
    const prepared = await prepareExternalAgentSession(userContent);
    if (!prepared) {
      externalAgentLaunchRef.current = null;
      setLaunchingExternalAgent(null);
      return;
    }
    updateChatMessages(prepared.session.id, [
      ...prepared.session.messages,
      {
        id: `inbox-zero-pending-${crypto.randomUUID()}`,
        role: "user",
        content: userContent,
        createdAt: new Date().toISOString(),
      },
    ]);
    try {
      const response = await fetch("/api/inbox-zero/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          task,
          model,
          chatSessionId: prepared.session.id,
        }),
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
      setChatStreaming(prepared.session.id, true);
      await commitExternalAgentTurn(
        prepared.session,
        userContent,
        {
          role: "assistant",
          content: "",
          inboxZeroRun: { runId: String(data.run.runId), task },
          externalAgentOutcome: "running",
        },
        prepared.title,
      );
    } catch (error) {
      await commitExternalAgentTurn(
        prepared.session,
        userContent,
        {
          role: "assistant",
          content: `The Inbox Zero run could not start: ${
            error instanceof Error ? error.message : "unknown error"
          }`,
        },
        prepared.title,
      );
    } finally {
      externalAgentLaunchRef.current = null;
      setLaunchingExternalAgent(null);
      textareaRef.current?.focus();
    }
  }

  /**
   * OpenScience works inside its own durable research workspace rather than
   * this Garden's repository, so the turn carries only the goal — there is no
   * repository to name and nothing to check out.
   */
  async function launchOpenscience(task: string) {
    if (!task || externalAgentLaunchRef.current) {
      if (!task) setExternalAgentStatus("Tell OpenScience what to investigate.");
      return;
    }
    externalAgentLaunchRef.current = "openscience";
    setLaunchingExternalAgent("openscience");
    setExternalAgentStatus("");
    const userContent = openscienceUserMessage(task);
    const prepared = await prepareExternalAgentSession(userContent);
    if (!prepared) {
      externalAgentLaunchRef.current = null;
      setLaunchingExternalAgent(null);
      return;
    }
    updateChatMessages(prepared.session.id, [
      ...prepared.session.messages,
      {
        id: `openscience-pending-${crypto.randomUUID()}`,
        role: "user",
        content: userContent,
        createdAt: new Date().toISOString(),
      },
    ]);
    try {
      const response = await fetch("/api/openscience/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          task,
          model,
          reasoningEffort,
          chatSessionId: prepared.session.id,
        }),
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
      setChatStreaming(prepared.session.id, true);
      await commitExternalAgentTurn(
        prepared.session,
        userContent,
        {
          role: "assistant",
          content: "",
          openscienceRun: { runId: String(data.run.runId), task },
          externalAgentOutcome: "running",
        },
        prepared.title,
      );
    } catch (error) {
      await commitExternalAgentTurn(
        prepared.session,
        userContent,
        {
          role: "assistant",
          content: `The OpenScience run could not start: ${
            error instanceof Error ? error.message : "unknown error"
          }`,
        },
        prepared.title,
      );
    } finally {
      externalAgentLaunchRef.current = null;
      setLaunchingExternalAgent(null);
      textareaRef.current?.focus();
    }
  }

  async function launchHyperframes(brief: string) {
    if (!brief || externalAgentLaunchRef.current) {
      if (!brief) setExternalAgentStatus("Tell HyperFrames what video to make.");
      return;
    }
    externalAgentLaunchRef.current = "hyperframes";
    setLaunchingExternalAgent("hyperframes");
    setExternalAgentStatus("");
    const userContent = hyperframesUserMessage(brief);
    const prepared = await prepareExternalAgentSession(userContent);
    if (!prepared) {
      externalAgentLaunchRef.current = null;
      setLaunchingExternalAgent(null);
      return;
    }
    updateChatMessages(prepared.session.id, [
      ...prepared.session.messages,
      {
        id: `hyperframes-pending-${crypto.randomUUID()}`,
        role: "user",
        content: userContent,
        createdAt: new Date().toISOString(),
      },
    ]);
    try {
      const response = await fetch("/api/hyperframes/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          brief,
          model,
          reasoningEffort,
          chatSessionId: prepared.session.id,
        }),
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
      setChatStreaming(prepared.session.id, true);
      await commitExternalAgentTurn(
        prepared.session,
        userContent,
        {
          role: "assistant",
          content: "",
          hyperframesRun: { runId: String(data.run.runId), brief },
          externalAgentOutcome: "running",
        },
        prepared.title,
      );
    } catch (error) {
      await commitExternalAgentTurn(
        prepared.session,
        userContent,
        {
          role: "assistant",
          content: `The video build could not start: ${
            error instanceof Error ? error.message : "unknown error"
          }`,
        },
        prepared.title,
      );
    } finally {
      externalAgentLaunchRef.current = null;
      setLaunchingExternalAgent(null);
      textareaRef.current?.focus();
    }
  }

  async function launchResource2Skill(brief: string) {
    if (!brief || externalAgentLaunchRef.current) {
      if (!brief) setExternalAgentStatus("Describe the artifact Resource2Skill should build.");
      return;
    }
    externalAgentLaunchRef.current = "resource2skill";
    setLaunchingExternalAgent("resource2skill");
    setExternalAgentStatus("");
    const userContent = resource2SkillUserMessage(brief);
    const prepared = await prepareExternalAgentSession(userContent);
    if (!prepared) {
      externalAgentLaunchRef.current = null;
      setLaunchingExternalAgent(null);
      return;
    }
    updateChatMessages(prepared.session.id, [
      ...prepared.session.messages,
      { id: `resource2skill-pending-${crypto.randomUUID()}`, role: "user", content: userContent, createdAt: new Date().toISOString() },
    ]);
    try {
      const response = await fetch("/api/resource2skill/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ brief, model, reasoningEffort, chatSessionId: prepared.session.id }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.run?.runId) {
        throw new Error(typeof data?.message === "string" ? data.message : typeof data?.error === "string" ? data.error : "The Resource2Skill run could not start.");
      }
      setChatStreaming(prepared.session.id, true);
      await commitExternalAgentTurn(
        prepared.session,
        userContent,
        { role: "assistant", content: "", resource2SkillRun: { runId: String(data.run.runId), brief }, externalAgentOutcome: "running" },
        prepared.title,
      );
    } catch (error) {
      await commitExternalAgentTurn(
        prepared.session,
        userContent,
        { role: "assistant", content: `The Resource2Skill run could not start: ${error instanceof Error ? error.message : "unknown error"}` },
        prepared.title,
      );
    } finally {
      externalAgentLaunchRef.current = null;
      setLaunchingExternalAgent(null);
      textareaRef.current?.focus();
    }
  }

  async function launchOpenMontage(brief: string) {
    if (!brief || externalAgentLaunchRef.current) {
      if (!brief) setExternalAgentStatus("Tell OpenMontage what video to produce.");
      return;
    }
    externalAgentLaunchRef.current = "openmontage";
    setLaunchingExternalAgent("openmontage");
    setExternalAgentStatus("");
    const userContent = openMontageUserMessage(brief);
    const prepared = await prepareExternalAgentSession(userContent);
    if (!prepared) {
      externalAgentLaunchRef.current = null;
      setLaunchingExternalAgent(null);
      return;
    }
    updateChatMessages(prepared.session.id, [
      ...prepared.session.messages,
      {
        id: `openmontage-pending-${crypto.randomUUID()}`,
        role: "user",
        content: userContent,
        createdAt: new Date().toISOString(),
      },
    ]);
    try {
      const response = await fetch("/api/openmontage/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          brief,
          model,
          reasoningEffort,
          chatSessionId: prepared.session.id,
        }),
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
      setChatStreaming(prepared.session.id, true);
      await commitExternalAgentTurn(
        prepared.session,
        userContent,
        {
          role: "assistant",
          content: "",
          openMontageRun: { runId: String(data.run.runId), brief },
          externalAgentOutcome: "running",
        },
        prepared.title,
      );
    } catch (error) {
      await commitExternalAgentTurn(
        prepared.session,
        userContent,
        {
          role: "assistant",
          content: `The production could not start: ${
            error instanceof Error ? error.message : "unknown error"
          }`,
        },
        prepared.title,
      );
    } finally {
      externalAgentLaunchRef.current = null;
      setLaunchingExternalAgent(null);
      textareaRef.current?.focus();
    }
  }

  async function launchCodex(
    task: string,
    attachments: readonly ChatAttachment[] = [],
  ) {
    if (!task || externalAgentLaunchRef.current) {
      if (!task) setExternalAgentStatus("Type a coding task for Codex.");
      return;
    }
    externalAgentLaunchRef.current = "codex";
    setLaunchingExternalAgent("codex");
    setExternalAgentStatus("");
    const userContent = codexUserMessage(task);
    const delegatedRequest = delegatedAgentLaunchRef.current;
    const clientMessageId =
      delegatedRequest?.originClientMessageId ?? crypto.randomUUID();
    const persistedAttachments = chatMessageAttachments(attachments);
    const userMessageFields = persistedAttachments.length
      ? {
          attachmentNames: persistedAttachments.map((attachment) => attachment.name),
          attachments: persistedAttachments,
        }
      : {};
    const prepared = await prepareExternalAgentSession(userContent);
    if (!prepared) {
      externalAgentLaunchRef.current = null;
      setLaunchingExternalAgent(null);
      return;
    }
    if (!delegatedRequest) {
      updateChatMessages(prepared.session.id, [
        ...prepared.session.messages,
        {
          id: `codex-pending-${clientMessageId}`,
          role: "user",
          content: userContent,
          createdAt: new Date().toISOString(),
          ...userMessageFields,
        },
      ]);
    }
    try {
      const response = await fetch("/api/codex/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          task,
          model,
          reasoningEffort,
          gardenSlug: clusterSlug,
          chatSessionId: prepared.session.id,
          clientMessageId,
          attachToExistingTurn: Boolean(delegatedRequest),
          attachments: attachments.filter((attachment) => attachment.type === "image"),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.run?.runId || !data.run.gardenSlug || !data.run.repository) {
        throw new Error(
          data?.message ?? explainCodexError(data?.error, "The Codex task could not start."),
        );
      }
      const assistantMessage: Message = {
        role: "assistant",
        content: "",
        codexRun: {
          runId: String(data.run.runId),
          task,
          gardenSlug: String(data.run.gardenSlug),
          repository: String(data.run.repository),
        },
        externalAgentOutcome: "running",
      };
      setChatStreaming(prepared.session.id, true);
      if (data.turnPersisted === true) {
        if (delegatedRequest) {
          await commitExternalAgentTurn(
            prepared.session,
            userContent,
            assistantMessage,
            prepared.title,
            userMessageFields,
          );
        } else {
          const createdAt = new Date().toISOString();
          updateChatMessages(prepared.session.id, [
            ...prepared.session.messages,
            { role: "user", content: userContent, createdAt, ...userMessageFields },
            { ...assistantMessage, createdAt },
          ]);
        }
        // Reconcile canonical ids and the server-generated title without
        // waiting for the user to leave and reopen this Garden.
        void fetchChatSessions();
      } else {
        await commitExternalAgentTurn(
          prepared.session,
          userContent,
          assistantMessage,
          prepared.title,
          userMessageFields,
        );
      }
    } catch (error) {
      await commitExternalAgentTurn(
        prepared.session,
        userContent,
        {
          role: "assistant",
          content: `The Codex task could not start: ${
            error instanceof Error ? error.message : "unknown error"
          }`,
        },
        prepared.title,
        userMessageFields,
      );
    } finally {
      externalAgentLaunchRef.current = null;
      setLaunchingExternalAgent(null);
      textareaRef.current?.focus();
    }
  }

  async function launchOpenCode(
    task: string,
    attachments: readonly ChatAttachment[] = [],
  ) {
    if (!task || externalAgentLaunchRef.current) {
      if (!task) setExternalAgentStatus("Type a coding task for OpenCode.");
      return;
    }
    externalAgentLaunchRef.current = "opencode";
    setLaunchingExternalAgent("opencode");
    setExternalAgentStatus("");
    const userContent = openCodeUserMessage(task);
    const persistedAttachments = chatMessageAttachments(attachments);
    const userMessageFields = persistedAttachments.length
      ? {
          attachmentNames: persistedAttachments.map((attachment) => attachment.name),
          attachments: persistedAttachments,
        }
      : {};
    const prepared = await prepareExternalAgentSession(userContent);
    if (!prepared) {
      externalAgentLaunchRef.current = null;
      setLaunchingExternalAgent(null);
      return;
    }
    if (!delegatedAgentLaunchRef.current) {
      updateChatMessages(prepared.session.id, [
        ...prepared.session.messages,
        {
          id: `opencode-pending-${crypto.randomUUID()}`,
          role: "user",
          content: userContent,
          createdAt: new Date().toISOString(),
          ...userMessageFields,
        },
      ]);
    }
    try {
      const response = await fetch("/api/opencode/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          task,
          model,
          reasoningEffort,
          gardenSlug: clusterSlug,
          attachments: attachments.filter(
            (attachment) => attachment.type === "image",
          ),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (
        !response.ok ||
        !data?.run?.runId ||
        !data.run.gardenSlug ||
        !data.run.repository
      ) {
        throw new Error(
          data?.message ??
            explainOpenCodeError(
              data?.error,
              "The OpenCode task could not start.",
            ),
        );
      }
      setChatStreaming(prepared.session.id, true);
      await commitExternalAgentTurn(
        prepared.session,
        userContent,
        {
          role: "assistant",
          content: "",
          openCodeRun: {
            runId: String(data.run.runId),
            task,
            gardenSlug: String(data.run.gardenSlug),
            repository: String(data.run.repository),
          },
          externalAgentOutcome: "running",
        },
        prepared.title,
        userMessageFields,
      );
    } catch (error) {
      await commitExternalAgentTurn(
        prepared.session,
        userContent,
        {
          role: "assistant",
          content: `The OpenCode task could not start: ${
            error instanceof Error ? error.message : "unknown error"
          }`,
        },
        prepared.title,
        userMessageFields,
      );
    } finally {
      externalAgentLaunchRef.current = null;
      setLaunchingExternalAgent(null);
      textareaRef.current?.focus();
    }
  }

  async function launchRuflo(
    task: string,
    attachments: readonly ChatAttachment[] = [],
  ) {
    if (!task || externalAgentLaunchRef.current) {
      if (!task) setExternalAgentStatus("Type an objective for the Ruflo swarm.");
      return;
    }
    externalAgentLaunchRef.current = "ruflo";
    setLaunchingExternalAgent("ruflo");
    setExternalAgentStatus("");
    const userContent = rufloUserMessage(task);
    const persistedAttachments = chatMessageAttachments(attachments);
    const userMessageFields = persistedAttachments.length
      ? {
          attachmentNames: persistedAttachments.map((attachment) => attachment.name),
          attachments: persistedAttachments,
        }
      : {};
    const prepared = await prepareExternalAgentSession(userContent);
    if (!prepared) {
      externalAgentLaunchRef.current = null;
      setLaunchingExternalAgent(null);
      return;
    }
    if (!delegatedAgentLaunchRef.current) {
      updateChatMessages(prepared.session.id, [
        ...prepared.session.messages,
        {
          id: `ruflo-pending-${crypto.randomUUID()}`,
          role: "user",
          content: userContent,
          createdAt: new Date().toISOString(),
          ...userMessageFields,
        },
      ]);
    }
    try {
      const response = await fetch("/api/ruflo/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          task,
          gardenSlug: clusterSlug,
          attachments: attachments.filter(
            (attachment) => attachment.type === "image",
          ),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (
        !response.ok ||
        !data?.run?.runId ||
        !data.run.gardenSlug ||
        !data.run.repository
      ) {
        throw new Error(
          data?.message ??
            explainRufloError(data?.error, "The Ruflo swarm could not start."),
        );
      }
      setChatStreaming(prepared.session.id, true);
      await commitExternalAgentTurn(
        prepared.session,
        userContent,
        {
          role: "assistant",
          content: "",
          rufloRun: {
            runId: String(data.run.runId),
            task,
            gardenSlug: String(data.run.gardenSlug),
            repository: String(data.run.repository),
          },
          externalAgentOutcome: "running",
        },
        prepared.title,
        userMessageFields,
      );
    } catch (error) {
      await commitExternalAgentTurn(
        prepared.session,
        userContent,
        {
          role: "assistant",
          content: `The Ruflo swarm could not start: ${
            error instanceof Error ? error.message : "unknown error"
          }`,
        },
        prepared.title,
        userMessageFields,
      );
    } finally {
      externalAgentLaunchRef.current = null;
      setLaunchingExternalAgent(null);
      textareaRef.current?.focus();
    }
  }

  function handleExternalAgentTerminal(
    runId: string,
    result: ExternalAgentTerminalResult,
  ) {
    // Only the assistant half of the turn owns the run: the launch stamps the
    // same descriptor on the user message, and rewriting that one would replace
    // what the person typed with the agent's answer.
    const ownsRun = (message: Message) =>
      assistantExternalAgentRunId(message) === runId;
    const session = chatSessions.find((candidate) =>
      candidate.messages.some(ownsRun),
    );
    if (!session) return;
    const nextMessages = session.messages.map((message) => {
      return ownsRun(message)
        ? {
            ...message,
            content:
              message.delegatedAgentRun === true
                ? message.content
                : result.content,
            ...(message.delegatedAgentRun === true
              ? { externalAgentResult: result.content }
              : {}),
            externalAgentOutcome: result.outcome,
            ...(result.usage ? { usage: result.usage } : {}),
            ...(result.activity?.length
              ? { externalAgentActivity: result.activity }
              : {}),
            ...(result.edits ? { externalAgentEdits: result.edits } : {}),
            ...(result.state ? { externalAgentState: result.state } : {}),
          }
        : message;
    });
    setChatStreaming(session.id, false);
    updateChatMessages(session.id, nextMessages);
    void persistChatSession(session.id, nextMessages);

    // If the assistant started this run and asked to hear how it went, hand the
    // outcome back as a new turn. Matching on the bound run id keeps a run the
    // user started themselves out of the chain.
    const awaited = awaitedLaunchRef.current;
    if (awaited?.runId !== runId) return;
    awaitedLaunchRef.current = null;
    continuedDelegatedRunsRef.current.add(runId);
    if (launchHopsRef.current >= MAX_AGENT_LAUNCH_HOPS) {
      setExternalAgentStatus(
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
  }

  async function handleSubmit(
    textOverride?: string,
    historyOverride?: Message[],
    attachmentOverride?: readonly ChatAttachment[],
    internalAgentContinuation = false,
  ) {
    const text = (textOverride ?? input).trim();
    const pendingAttachments: ChatAttachment[] = attachmentOverride
      ? [...attachmentOverride]
      : textOverride === undefined
        ? chatAttachments
        : [];
    if (
      (!text && pendingAttachments.length === 0) ||
      isStreaming ||
      launchingExternalAgent
    )
      return;

    // Only the composer calls this with no override, so this is the one place
    // that knows a human is speaking: it ends whatever hand-off chain was
    // running and drops any launch still waiting to be confirmed.
    if (textOverride === undefined) {
      launchHopsRef.current = 0;
      awaitedLaunchRef.current = null;
      agentLaunchQueue.reset();
    }

    // Refuse an impossible combination before anything is dispatched. The
    // branches below are a priority cascade, so without this a second runtime
    // agent or a stacked skill would be silently swallowed into the winner's
    // task string instead of being reported.
    const conflict = findCapabilityConflict({
      text,
      surface: "garden_chat",
      attachmentCount: pendingAttachments.length,
      activeRuntimeAgentId:
        (codexAgent && "codex") ||
        (openCodeAgent && "opencode") ||
        (rufloAgent && "ruflo") ||
        (deepResearchAgent && "deep-research") ||
        (openPlanterAgent && "openplanter") ||
        (agentReachAgent && "agent-reach") ||
        (getDocAgent && "get-doc") ||
        (meetingNotesAgent && "meeting-notes") ||
        (deepTutorAgent && "deep-tutor") ||
        (careerOpsAgent && "career-ops") ||
        (tradingAgentsAgent && "trading-agent") ||
        (shortsAgent && "shorts") ||
        (formsmithAgent && "formsmith") ||
        (vibeTradingAgent && "vibe-trading") ||
        (stockAnalystAgent && "stock-analyst") ||
    (paperTraderAgent && "paper-trader") ||
        (deerFlowAgent && "deer-flow") ||
        (agentBrowserAgent && "agent-browser") ||
        null,
    });
    if (conflict) {
      setExternalAgentStatus(conflict.message);
      return;
    }
    setExternalAgentStatus("");

    const codexTask = taskFromCodexCommand(text);
    if (codexTask !== null) {
      const codexAttachments = pendingAttachments;
      setInput("");
      setChatAttachments([]);
      void (async () => {
        if (!codexAgent) await selectCodex();
        if (codexTask || codexAttachments.length) {
          await launchCodex(
            codexTask || "Review the attached screenshot and implement the requested fix.",
            codexAttachments,
          );
        }
      })();
      return;
    }

    const rufloTask = taskFromRufloCommand(text);
    if (rufloTask !== null) {
      const rufloAttachments = pendingAttachments;
      setInput("");
      setChatAttachments([]);
      void (async () => {
        if (!rufloAgent) await selectRuflo();
        if (rufloTask || rufloAttachments.length) {
          await launchRuflo(
            rufloTask || "Review the attached screenshot and implement the requested fix.",
            rufloAttachments,
          );
        }
      })();
      return;
    }

    const openCodeTask = taskFromOpenCodeCommand(text);
    if (openCodeTask !== null) {
      const openCodeAttachments = pendingAttachments;
      setInput("");
      setChatAttachments([]);
      void (async () => {
        if (!openCodeAgent) await selectOpenCode();
        if (openCodeTask || openCodeAttachments.length) {
          await launchOpenCode(
            openCodeTask || "Review the attached screenshot and implement the requested fix.",
            openCodeAttachments,
          );
        }
      })();
      return;
    }

    const openPlanterTask = taskFromOpenPlanterCommand(text);
    if (openPlanterTask !== null) {
      setInput("");
      setChatAttachments([]);
      void (async () => {
        const selected = openPlanterAgent ?? (await selectOpenPlanter());
        if (selected) await launchOpenPlanter(openPlanterTask);
      })();
      return;
    }

    const agentReachTask = taskFromAgentReachCommand(text);
    if (agentReachTask !== null) {
      setInput("");
      setChatAttachments([]);
      void (async () => {
        const selected = agentReachAgent ?? (await selectAgentReach());
        if (selected) await launchAgentReach(agentReachTask);
      })();
      return;
    }

    const deepTutorTask = taskFromDeepTutorCommand(text);
    if (deepTutorTask !== null) {
      setInput("");
      setChatAttachments([]);
      void (async () => {
        const selected = deepTutorAgent ?? (await selectDeepTutor());
        if (selected) await launchDeepTutor(deepTutorTask);
      })();
      return;
    }

    const meetingNotesTask = taskFromMeetingNotesCommand(text);
    if (meetingNotesTask !== null) {
      setInput("");
      setChatAttachments([]);
      void (async () => {
        const selected = meetingNotesAgent ?? (await selectMeetingNotes());
        // A bare token is already a complete request here: it means "the
        // recording in this chat", so this launches rather than waiting for a
        // sentence the way the other agents do.
        if (selected) await launchMeetingNotes(meetingNotesTask);
      })();
      return;
    }

    const getDocTask = taskFromGetDocCommand(text);
    if (getDocTask !== null) {
      setInput("");
      setChatAttachments([]);
      void (async () => {
        const selected = getDocAgent ?? (await selectGetDoc());
        if (selected) await launchGetDoc(getDocTask);
      })();
      return;
    }

    const careerOpsTask = taskFromCareerOpsCommand(text);
    if (careerOpsTask !== null) {
      setInput("");
      setChatAttachments([]);
      void (async () => {
        const selected = careerOpsAgent ?? (await selectCareerOps());
        if (selected) await launchCareerOps(careerOpsTask);
      })();
      return;
    }

    const deerFlowTask = taskFromDeerFlowCommand(text);
    if (deerFlowTask !== null) {
      setInput("");
      void (async () => {
        const selected = deerFlowAgent ?? (await selectDeerFlow());
        if (selected) await launchDeerFlow(deerFlowTask);
      })();
      return;
    }
    const vibeTradingTask = taskFromVibeTradingCommand(text);
    if (vibeTradingTask !== null) {
      setInput("");
      setChatAttachments([]);
      void (async () => {
        const selected = vibeTradingAgent ?? (await selectVibeTrading());
        if (selected) await launchVibeTrading(vibeTradingTask);
      })();
      return;
    }
    const stockAnalystTask = taskFromStockAnalystCommand(text);
    if (stockAnalystTask !== null) {
      setInput("");
      setChatAttachments([]);
      void (async () => {
        const selected = stockAnalystAgent ?? (await selectStockAnalyst());
        if (selected) await launchStockAnalyst(stockAnalystTask);
      })();
      return;
    }
    const paperTraderTask = taskFromPaperTraderCommand(text);
    if (paperTraderTask !== null) {
      setInput("");
      setChatAttachments([]);
      void (async () => {
        // A bare token selects and stops there; the locked composer's send
        // button is what opens the desk.
        const selected = paperTraderAgent ?? selectPaperTrader();
        if (selected) await launchPaperTrader(paperTraderTask);
      })();
      return;
    }

    const tradingAgents = parseTradingAgentsCommand(text);
    if (tradingAgents) {
      setInput("");
      setChatAttachments([]);
      void (async () => {
        const selected = tradingAgentsAgent ?? (await selectTradingAgents());
        // The command only opens the form: a run needs a complete request.
        if (selected) setTradingAgentsSeed(tradingAgents.partial);
      })();
      return;
    }

    const shorts = parseShortsCommand(text);
    if (shorts) {
      setInput("");
      setChatAttachments([]);
      void (async () => {
        const selected = shortsAgent ?? (await selectShorts());
        // Same: the command opens the form, and a video still has to be chosen.
        if (selected) setShortsSeed(shorts.partial);
      })();
      return;
    }

    if (isFormsmithCommand(text)) {
      setInput("");
      setChatAttachments([]);
      void selectFormsmith();
      return;
    }

    const socialsManagerBrief = taskFromSocialsManagerCommand(text);
    if (socialsManagerBrief !== null) {
      setInput("");
      setChatAttachments([]);
      void launchSocialsManager(socialsManagerBrief);
      return;
    }

    const hardwareBrief = taskFromHardwareBlueprintCommand(text);
    if (hardwareBrief !== null) {
      setInput("");
      setChatAttachments([]);
      void launchHardwareBlueprint(hardwareBrief);
      return;
    }

    const cadBrief = taskFromParametricCadCommand(text);
    if (cadBrief !== null) {
      setInput("");
      setChatAttachments([]);
      void launchParametricCad(cadBrief);
      return;
    }

    const videoBrief = briefFromHyperframesCommand(text);
    if (videoBrief !== null) {
      setInput("");
      setChatAttachments([]);
      void launchHyperframes(videoBrief);
      return;
    }

    const resource2SkillBrief = briefFromResource2SkillCommand(text);
    if (resource2SkillBrief !== null) {
      setInput("");
      setChatAttachments([]);
      void launchResource2Skill(resource2SkillBrief);
      return;
    }

    const productionBrief = briefFromOpenMontageCommand(text);
    if (productionBrief !== null) {
      setInput("");
      setChatAttachments([]);
      void launchOpenMontage(productionBrief);
      return;
    }

    const openworkTask = taskFromOpenworkCommand(text);
    if (openworkTask !== null) {
      setInput("");
      setChatAttachments([]);
      void launchOpenwork(openworkTask);
      return;
    }

    const openscienceTask = taskFromOpenscienceCommand(text);
    if (openscienceTask !== null) {
      setInput("");
      setChatAttachments([]);
      void launchOpenscience(openscienceTask);
      return;
    }

    const inboxZeroTask = taskFromInboxZeroCommand(text);
    if (inboxZeroTask !== null) {
      setInput("");
      setChatAttachments([]);
      void launchInboxZero(inboxZeroTask);
      return;
    }

    const filmBrief = briefFromVimaxCommand(text);
    if (filmBrief !== null) {
      setInput("");
      setChatAttachments([]);
      void launchVimax(filmBrief);
      return;
    }

    const moneyPrinterBrief = briefFromMoneyPrinterCommand(text);
    if (moneyPrinterBrief !== null) {
      setInput("");
      setChatAttachments([]);
      void launchMoneyPrinter(moneyPrinterBrief);
      return;
    }

    // The attachments are taken before they are cleared: for the Legal Agent
    // they are the documents the run works on, not decoration on the message.
    const legalTask = taskFromLegalCommand(text);
    if (legalTask !== null) {
      const legalDocuments = pendingAttachments;
      setInput("");
      setChatAttachments([]);
      void launchLegal(legalTask, legalDocuments);
      return;
    }

    const deepResearchTask = taskFromDeepResearchCommand(text);
    if (deepResearchTask !== null) {
      setInput("");
      setChatAttachments([]);
      void (async () => {
        if (!deepResearchAgent) await selectDeepResearch();
        await launchDeepResearch(deepResearchTask);
      })();
      return;
    }

    const agentBrowserTask = taskFromAgentBrowserCommand(text);
    if (agentBrowserTask !== null) {
      setInput("");
      setChatAttachments([]);
      void (async () => {
        const selected = agentBrowserAgent ?? (await selectAgentBrowser());
        if (selected) await launchAgentBrowser(agentBrowserTask, selected);
      })();
      return;
    }

    if (rufloAgent) {
      setInput("");
      setChatAttachments([]);
      void launchRuflo(
        text || "Review the attached screenshot and implement the requested fix.",
        pendingAttachments,
      );
      return;
    }
    if (codexAgent) {
      setInput("");
      setChatAttachments([]);
      void launchCodex(
        text || "Review the attached screenshot and implement the requested fix.",
        pendingAttachments,
      );
      return;
    }
    if (openCodeAgent) {
      setInput("");
      setChatAttachments([]);
      void launchOpenCode(
        text || "Review the attached screenshot and implement the requested fix.",
        pendingAttachments,
      );
      return;
    }
    if (openPlanterAgent) {
      setInput("");
      setChatAttachments([]);
      void launchOpenPlanter(text);
      return;
    }
    if (agentReachAgent) {
      setInput("");
      setChatAttachments([]);
      void launchAgentReach(text);
      return;
    }
    if (getDocAgent) {
      setInput("");
      setChatAttachments([]);
      void launchGetDoc(text);
      return;
    }
    if (deepTutorAgent) {
      setInput("");
      setChatAttachments([]);
      void launchDeepTutor(text);
      return;
    }
    if (careerOpsAgent) {
      setInput("");
      setChatAttachments([]);
      void launchCareerOps(text);
      return;
    }
    if (deerFlowAgent) {
      setInput("");
      void launchDeerFlow(text);
      return;
    }
    if (vibeTradingAgent) {
      setInput("");
      setChatAttachments([]);
      void launchVibeTrading(text);
      return;
    }
    if (stockAnalystAgent) {
      setInput("");
      setChatAttachments([]);
      void launchStockAnalyst(text);
      return;
    }
    if (paperTraderAgent) {
      // An empty send is "start the desk", so unlike every other agent here
      // there is nothing to refuse.
      setInput("");
      setChatAttachments([]);
      void launchPaperTrader(text);
      return;
    }
    if (deepResearchAgent) {
      setInput("");
      setChatAttachments([]);
      void launchDeepResearch(text);
      return;
    }
    if (agentBrowserAgent) {
      setInput("");
      setChatAttachments([]);
      void launchAgentBrowser(text, agentBrowserAgent);
      return;
    }

    const responseStartedAt = performance.now();

    const writableActiveChat = activeChat?.isOwn === false ? null : activeChat;
    const session = writableActiveChat ?? (await createChatSession());
    if (!session) return;

    const sessionId = session.id;
    if (streamingChatIdsRef.current.has(sessionId)) return;
    const history = historyOverride ?? session.messages;
    // The canonical first-turn pipeline replaces "New chat" with the title
    // returned by its dedicated plain-LLM request. Do not race it with a
    // browser-side heuristic when this transcript is persisted.
    const title: string | undefined = undefined;
    const steerContext = { sessionId, messages: [] as Message[] };
    activeSteerContextRef.current = steerContext;

    // Snapshot attachments and clear them immediately
    const attachmentNames = pendingAttachments.map((a) => a.name);

    const displayText =
      text ||
      (attachmentNames.length > 0
        ? `Attached: ${attachmentNames.join(", ")}`
        : "");
    const turnCreatedAt = new Date().toISOString();
    const userMsg: Message = {
      role: "user",
      content: displayText,
      createdAt: turnCreatedAt,
      ...(internalAgentContinuation ? { internalAgentContinuation: true } : {}),
      ...(attachmentNames.length > 0 ? { attachmentNames } : {}),
      ...(pendingAttachments.length > 0
        ? { attachments: chatMessageAttachments(pendingAttachments) }
        : {}),
    };
    const nextMessages = [...history, userMsg];
    const assistantMsg: Message = {
      role: "assistant",
      content: "",
      createdAt: turnCreatedAt,
      sources: [],
      thinking: "",
    };
    const messagesWithAssistant = () => [
      ...nextMessages,
      ...steerContext.messages,
      { ...assistantMsg },
    ];
    let finalMessages = messagesWithAssistant();

    setInput("");
    setChatAttachments([]);
    setChatStreaming(sessionId, true);
    updateChatMessages(sessionId, finalMessages);
    if (title) {
      setChatSessions((prev) =>
        prev.map((item) => (item.id === sessionId ? { ...item, title } : item)),
      );
    }

    if (isGardenSaveCommand(text)) {
      try {
        const sourceMessages = history.filter((message) =>
          message.content.trim(),
        );
        const hasPreviousAssistantResponse = sourceMessages.some(
          (message) => message.role === "assistant" && message.content.trim(),
        );
        if (!hasPreviousAssistantResponse) {
          assistantMsg.content =
            'I do not have an earlier answer to save yet. Ask me for the note content first, then say "add this to garden".';
        } else {
          setIsGenerating(true);
          const notes = await generateGardenNotes(sourceMessages, "chat-note");
          if (notes.length > 0) {
            const links = notes
              .map(
                (note) =>
                  `- [${note.title}](/garden/${clusterSlug}?note=${encodeURIComponent(note.slug)})`,
              )
              .join("\n");
            assistantMsg.content = `Saved the last AI response to the garden as a chat note:\n\n${links}`;
            await fetchDocuments();
            setDocsExpanded(true);
            setGraphRefreshVersion((v) => v + 1);
          } else {
            assistantMsg.content =
              "I could not find a previous AI response to save as a garden note.";
          }
        }
      } catch (err) {
        assistantMsg.content =
          err instanceof Error
            ? err.message
            : "Failed to save this to the garden.";
      } finally {
        setIsGenerating(false);
        assistantMsg.responseDurationMs = Math.round(
          performance.now() - responseStartedAt,
        );
        finalMessages = messagesWithAssistant();
        updateChatMessages(sessionId, finalMessages);
        await persistChatSession(sessionId, finalMessages, title);
        setChatStreaming(sessionId, false);
        if (activeSteerContextRef.current === steerContext) {
          activeSteerContextRef.current = null;
        }
        textareaRef.current?.focus();
      }
      return;
    }

    if (isMarkdownTagCommand(text, history)) {
      try {
        const result = await tagMarkdownsFromRequest(
          text,
          nextMessages,
          pendingAttachments,
        );
        if (result.updated.length > 0) {
          const updates = result.updated
            .map(
              (note) =>
                `- [${note.title}](/garden/${clusterSlug}?note=${encodeURIComponent(note.slug)}) — ${note.tags.map((tag) => `\`${tag}\``).join(", ")}`,
            )
            .join("\n");
          assistantMsg.content = `${result.summary}\n\n${updates}`;
          await fetchDocuments();
          setDocsExpanded(true);
          setGraphRefreshVersion((v) => v + 1);
        } else {
          assistantMsg.content = result.summary;
        }
      } catch (err) {
        assistantMsg.content =
          err instanceof Error
            ? err.message
            : "Failed to update markdown tags.";
      } finally {
        assistantMsg.responseDurationMs = Math.round(
          performance.now() - responseStartedAt,
        );
        finalMessages = messagesWithAssistant();
        updateChatMessages(sessionId, finalMessages);
        await persistChatSession(sessionId, finalMessages, title);
        setChatStreaming(sessionId, false);
        if (activeSteerContextRef.current === steerContext) {
          activeSteerContextRef.current = null;
        }
        textareaRef.current?.focus();
      }
      return;
    }

    let agentFailed = false;
    let agentCompleted = false;
    let agentReportedError = false;
    let agentSignal: AbortSignal | undefined;
    try {
      agentSignal = agentActivity.start();
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // For the last user message, send the real typed text (attachments add context separately)
          messages: nextMessages.map(({ role, content }, idx) =>
            idx === nextMessages.length - 1 && role === "user"
              ? { role, content: text || "Please review the attached file(s)." }
              : { role, content },
          ),
          clusterSlug,
          chatSessionId: sessionId,
          model,
          reasoningEffort,
          attachments: pendingAttachments,
          selectedDocumentSlugs,
          adhdMode: isDirectModeEnabled(),
        }),
        signal: agentSignal,
      });

      if (!res.ok || !res.body) {
        let message = "Something went wrong. Please try again.";
        try {
          const data = await res.json();
          if (typeof data?.error === "string" && data.error.trim()) {
            message = data.error.trim();
          } else if (
            data?.error &&
            typeof data.error.message === "string" &&
            data.error.message.trim()
          ) {
            message = data.error.message.trim();
          }
        } catch {
          // Fall back to the generic message.
        }

        throw new Error(message);
      }

      if (res.headers.get("X-Breadboard-AI-Fallback") === "1") {
        assistantMsg.thinking =
          "Hermes failed at runtime. HERMES_MODE=preferred allowed this visible legacy ChatMock fallback.\n";
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6);
          if (payload === "[DONE]") {
            agentCompleted = true;
            break;
          }

          try {
            const event = JSON.parse(payload) as
              | { type: "sources"; sources: string[] }
              | { type: "delta"; text: string }
              | { type: "replace"; text: string }
              | { type: "segment"; text: string; streamed: boolean }
              | { type: "thinking"; text: string }
              | { type: "tool"; toolName?: string; status?: string }
              | { type: "permission"; description?: string; requestId?: string }
              | { type: "error"; error?: string }
              | { type: "runtime"; backend: string; fallback: boolean }
              | { type: "verification"; verification: VerificationSummary }
              | { type: "usage"; usage: unknown }
              | {
                  type: "agent_launch";
                  requestId: string;
                  agentId: string;
                  agentName: string;
                  command: string;
                  brief: string;
                  reason: string;
                  awaitResult: boolean;
                }
              | {
                  type: `artifact.${string}`;
                  artifactId: string;
                  runId: string;
                  conversationId: string;
                  gardenId: string | null;
                  assistantMessageId: string | null;
                  status: string;
                  version: number;
                  metadata?: Record<string, unknown>;
                };

            agentActivity.handleEvent(
              event as unknown as Record<string, unknown>,
              agentSignal,
            );

            // Queued, never launched from here: this turn is still streaming,
            // and its own submit would be refused.
            if (agentLaunchQueue.handleEvent(event)) continue;

            if (event.type === "sources") {
              assistantMsg.sources = event.sources;
              finalMessages = messagesWithAssistant();
              updateChatMessages(sessionId, finalMessages);
            } else if (event.type === "delta") {
              assistantMsg.content += event.text;
              finalMessages = messagesWithAssistant();
              updateChatMessages(sessionId, finalMessages);
            } else if (event.type === "replace") {
              assistantMsg.content = event.text;
              finalMessages = messagesWithAssistant();
              updateChatMessages(sessionId, finalMessages);
            } else if (event.type === "segment") {
              // Streamed text so far was tool-call narration, not the answer.
              // Park it in the thinking strip; the bubble restarts with the
              // next segment.
              if (typeof event.text === "string" && event.text.trim()) {
                assistantMsg.thinking = `${assistantMsg.thinking ?? ""}\n${event.text}`.trim();
              }
              if (event.streamed) assistantMsg.content = "";
              finalMessages = messagesWithAssistant();
              updateChatMessages(sessionId, finalMessages);
            } else if (event.type === "usage") {
              const usage = normalizeChatTokenUsage(event.usage);
              if (usage) {
                assistantMsg.usage = {
                  ...usage,
                  responseDurationMs: Math.round(
                    performance.now() - responseStartedAt,
                  ),
                };
                finalMessages = messagesWithAssistant();
                updateChatMessages(sessionId, finalMessages);
              }
            } else if (event.type === "error") {
              agentReportedError = true;
              assistantMsg.content += `\n\n${event.error ?? "Hermes reported an error."}`;
              finalMessages = messagesWithAssistant();
              updateChatMessages(sessionId, finalMessages);
            } else if (event.type === "verification") {
              assistantMsg.verification = event.verification;
              finalMessages = messagesWithAssistant();
              updateChatMessages(sessionId, finalMessages);
            } else if (event.type === "runtime" && event.fallback) {
              assistantMsg.thinking = `${assistantMsg.thinking ?? ""}\nHermes unavailable — using the visible preferred-mode ChatMock fallback.`;
              finalMessages = messagesWithAssistant();
              updateChatMessages(sessionId, finalMessages);
            } else if (event.type.startsWith("artifact.")) {
              if (
                "assistantMessageId" in event &&
                typeof event.assistantMessageId === "string"
              ) {
                assistantMsg.artifactMessageId = event.assistantMessageId;
                finalMessages = messagesWithAssistant();
                updateChatMessages(sessionId, finalMessages);
              }
              window.dispatchEvent(new CustomEvent(ARTIFACT_BROWSER_EVENT, { detail: event }));
            }
          } catch {
            // malformed event — skip
          }
        }
      }
    } catch (error) {
      const aborted = error instanceof Error && error.name === "AbortError";
      agentFailed = !aborted;
      assistantMsg.content = aborted
        ? assistantMsg.content || "(stopped)"
        : error instanceof Error && error.message.trim()
          ? error.message
          : "Something went wrong. Please try again.";
      finalMessages = messagesWithAssistant();
      updateChatMessages(sessionId, finalMessages);
    } finally {
      agentActivity.finish(agentFailed, agentSignal);
      assistantMsg.responseDurationMs = Math.round(
        performance.now() - responseStartedAt,
      );
      finalMessages = messagesWithAssistant();
      updateChatMessages(sessionId, finalMessages);
      await persistChatSession(sessionId, finalMessages, title);
      setChatStreaming(sessionId, false);
      if (
        agentCompleted &&
        !agentReportedError &&
        assistantMsg.content.trim()
      ) {
        notifyTaskCompleted(displayText, {
          chatId: sessionId,
          activeChatId: activeChatIdRef.current,
        });
      }
      if (activeSteerContextRef.current === steerContext) {
        activeSteerContextRef.current = null;
      }
      textareaRef.current?.focus();
    }
  }

  // ── Prompt operations ────────────────────────────────────────────────────────

  function applyPrompt(p: SavedPrompt) {
    setInput(p.content);
    setShowPrompts(false);
    setTimeout(() => textareaRef.current?.focus(), 50);
  }

  function openNewPrompt() {
    setEditingPrompt({ id: "", title: "", content: "", category: "Custom" });
    setShowPrompts(false);
  }

  function openEditPrompt(p: SavedPrompt) {
    setEditingPrompt({ ...p });
    setShowPrompts(false);
  }

  function savePrompt(p: SavedPrompt) {
    const isNew = !p.id;
    const next = isNew
      ? { ...p, id: `user-${Date.now()}`, isDefault: false }
      : { ...p };
    const updated = isNew
      ? [next, ...prompts]
      : prompts.map((x) => (x.id === next.id ? next : x));
    setPrompts(updated);
    persistPrompts(updated);
    setEditingPrompt(null);
  }

  function deletePrompt(id: string) {
    const updated = prompts.filter((p) => p.id !== id);
    setPrompts(updated);
    persistPrompts(updated);
  }

  const filteredPrompts = prompts.filter((p) => {
    const matchCat = promptCategory === "All" || p.category === promptCategory;
    const q = promptSearch.toLowerCase();
    const matchSearch =
      !q ||
      p.title.toLowerCase().includes(q) ||
      p.content.toLowerCase().includes(q);
    return matchCat && matchSearch;
  });

  const hasHandwritingCompatibleFile = uploadFiles.some((f) =>
    HANDWRITING_FILE_RE.test(f.name),
  );
  const handwritingUploadEnabled =
    isHandwriting && hasHandwritingCompatibleFile;
  const hasVlmCompatibleFile = uploadFiles.some((f) =>
    VLM_PARSE_FILE_RE.test(f.name),
  );
  const { status: vlmStatus, loading: vlmStatusLoading } =
    useVlmOcrAvailability(showUpload && hasVlmCompatibleFile);
  const vlmUploadEnabled =
    parseWithVlm && hasVlmCompatibleFile && vlmStatus.available;
  const hasAnydocCompatibleFile = uploadFiles.some((f) =>
    ANYDOC_PARSE_FILE_RE.test(f.name),
  );
  const { status: anydocStatus, loading: anydocStatusLoading } =
    useAnydocAvailability(showUpload && hasAnydocCompatibleFile);
  const anydocUploadEnabled =
    parseWithAnydoc && hasAnydocCompatibleFile && anydocStatus.available;
  const allDoneOrError =
    uploadFiles.length > 0 &&
    uploadFiles.every((f) => {
      const s = uploadStatuses[fileKey(f)];
      return s === "done" || s === "error";
    });
  const ingestionTokenUsage = sumIngestTokenUsage(
    Object.values(uploadTokenUsage),
  );
  const ingestionVisionErrors = Object.values(uploadVisionErrors).filter(
    (error) => error.trim().length > 0,
  );

  const sourceDocuments = documents.filter(
    (doc) => doc.type === "source-document",
  );
  const sourceDocSearchTerms = normalizedSearchText(sourceDocSearch)
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const filteredSourceDocuments =
    sourceDocSearchTerms.length === 0
      ? sourceDocuments
      : sourceDocuments.filter((doc) => {
          const haystack = documentSearchText(doc);
          return sourceDocSearchTerms.every((term) => haystack.includes(term));
        });
  const markdownDocuments = documents.filter(
    (doc) => doc.type !== "source-document",
  );
  const selectedChatDocuments = sourceDocuments.filter((doc) =>
    selectedDocumentSlugs.includes(doc.slug),
  );
  const primarySourceDocument = sourceDocuments[0];
  const availableLearnSourceSlugSet = new Set(
    sourceDocuments.map((doc) => doc.slug),
  );
  // The syllabus controls lesson order and scope; it is not itself a teaching
  // document. Keep it out of both the usable count and the checkbox selection.
  const learnEligibleSourceDocuments = sourceDocuments.filter(
    (doc) => doc.slug !== learnSyllabusSlug,
  );
  const effectiveLearnIncludedSourceSlugs =
    learnIncludedSourceSlugs === null
      ? learnEligibleSourceDocuments.map((doc) => doc.slug)
      : learnIncludedSourceSlugs.filter((sourceSlug) =>
          availableLearnSourceSlugSet.has(sourceSlug) &&
          sourceSlug !== learnSyllabusSlug,
        );
  const effectiveLearnIncludedSourceSlugSet = new Set(
    effectiveLearnIncludedSourceSlugs,
  );

  const learnSyllabusDocument =
    sourceDocuments.find((doc) => doc.slug === learnSyllabusSlug) ?? null;
  // Only meaningful for the syllabus the last run actually read; a freshly
  // picked one has no coverage until Learn runs again.
  const learnSyllabusCoverage =
    learnSyllabusDocument &&
    learnState?.syllabusSourceId === learnSyllabusSlug
      ? (learnState?.syllabusCoverage ?? null)
      : null;

  /**
   * Upload a study guide straight from the Learn panel and designate it.
   *
   * It goes through the same ingest pipeline as any other document — so it lands
   * in Documents and can be reused later — but with map generation off: a
   * syllabus is an outline to plan against, not material to mine for concepts.
   */
  async function handleSyllabusUpload(file: File) {
    setLearnSyllabusUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("clusterSlug", clusterSlug);
      formData.append("sourceLabel", "Syllabus");
      formData.append("isHandwriting", "false");
      formData.append("generateMap", "false");

      const res = await fetch("/api/ingest", { method: "POST", body: formData });
      if (!res.ok || !res.body) {
        let message = "Syllabus upload failed";
        try {
          const data = await res.json();
          if (typeof data?.error === "string" && data.error.trim()) {
            message = data.error.trim();
          }
        } catch {
          // Fall back to the generic message.
        }
        throw new Error(message);
      }

      // Same Server-Sent Events framing as the Documents upload modal.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let result: Record<string, unknown> | null = null;
      let streamError = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6);
          if (payload === "[DONE]") continue;
          try {
            const event = JSON.parse(payload) as {
              type: "progress" | "usage" | "result" | "error";
              error?: string;
              [key: string]: unknown;
            };
            if (event.type === "result") result = event;
            else if (event.type === "error") {
              streamError =
                typeof event.error === "string"
                  ? event.error
                  : "Syllabus upload failed";
            }
          } catch {
            // malformed event — skip
          }
        }
      }

      if (!result?.success) {
        throw new Error(streamError || "Syllabus upload failed");
      }
      const slug = typeof result.slug === "string" ? result.slug : "";
      if (!slug) {
        throw new Error("Syllabus uploaded but no document slug was returned");
      }

      chooseLearnSyllabusDocument(slug);
      setLearnSyllabusMenuOpen(false);
      await fetchDocuments();
      addToast(
        result.duplicate === true
          ? `${file.name} was already in Documents; using it as the syllabus`
          : `${file.name} set as the syllabus`,
        "success",
      );
    } catch (error) {
      addToast(
        error instanceof Error ? error.message : "Syllabus upload failed",
      );
    } finally {
      setLearnSyllabusUploading(false);
    }
  }

  /**
   * Write a syllabus from a description of what the learner wants to learn.
   *
   * The result is an ordinary source document, indistinguishable downstream
   * from an uploaded study guide — so it lands in Documents, is designated the
   * same way, and can be reused or edited later.
   */
  async function handleSyllabusGenerate() {
    const prompt = learnSyllabusPrompt.trim();
    if (!prompt) return;
    setLearnSyllabusGenerating(true);
    try {
      const res = await fetch(
        `/api/gardens/${encodeURIComponent(clusterSlug)}/learn/syllabus/generate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt }),
        },
      );
      const data = await res.json().catch(() => ({}) as Record<string, unknown>);
      if (!res.ok || data?.success !== true) {
        throw new Error(
          typeof data?.error === "string" && data.error.trim()
            ? data.error.trim()
            : "Could not write a syllabus",
        );
      }
      const slug = typeof data.slug === "string" ? data.slug : "";
      if (!slug) {
        throw new Error("The syllabus was written but no document slug came back");
      }

      chooseLearnSyllabusDocument(slug);
      setLearnSyllabusPrompt("");
      setLearnSyllabusMenuOpen(false);
      await fetchDocuments();
      const unitCount = typeof data.unitCount === "number" ? data.unitCount : 0;
      addToast(
        `${data.courseTitle ?? "Syllabus"} written${unitCount ? ` — ${unitCount} unit${unitCount === 1 ? "" : "s"}` : ""} and set as the syllabus`,
        "success",
      );
    } catch (error) {
      addToast(
        error instanceof Error ? error.message : "Could not write a syllabus",
      );
    } finally {
      setLearnSyllabusGenerating(false);
    }
  }

  function chooseLearnSyllabusDocument(sourceSlug: string | null) {
    const previousSyllabusSlug = learnSyllabusSlug;
    setLearnSyllabusSlug(sourceSlug);

    // A document has one role in a Learn run. Reserving it as the syllabus
    // removes it from the teaching selection. When the role moves to another
    // document, the former syllabus becomes teaching material again.
    setLearnIncludedSourceSlugs((current) => {
      const selected = new Set(
        current ?? sourceDocuments.map((doc) => doc.slug),
      );
      if (previousSyllabusSlug) selected.add(previousSyllabusSlug);
      if (sourceSlug) selected.delete(sourceSlug);
      return sourceDocuments
        .map((doc) => doc.slug)
        .filter((slug) => selected.has(slug));
    });
  }

  function toggleLearnSourceDocument(sourceSlug: string) {
    if (sourceSlug === learnSyllabusSlug) return;
    setLearnIncludedSourceSlugs((current) => {
      const selected = new Set(
        current ??
          sourceDocuments
            .filter((doc) => doc.slug !== learnSyllabusSlug)
            .map((doc) => doc.slug),
      );
      if (selected.has(sourceSlug)) selected.delete(sourceSlug);
      else selected.add(sourceSlug);
      return sourceDocuments
        .map((doc) => doc.slug)
        .filter((slug) => selected.has(slug));
    });
  }

  const graphRefreshKey = `${graphRefreshVersion}:${documents
    .map((d) => `${d.slug}:${d.linkCount}:${d.wordCount}`)
    .join("|")}`;
  function renderLearnPanel() {
    const job = learnState?.job ?? null;
    const status = job?.status ?? "idle";
    const active = isLearnActive(status);
    const proposedMap = learnState?.proposedLearningMap ?? null;
    const hasLearnData = Boolean(
      job ||
      proposedMap ||
      learnState?.confirmedLearningMapId ||
      learnState?.latestTextbookVersionId ||
      learnState?.hasTextbook ||
      learnState?.scopedRepair,
    );
    const progress = Math.max(0, Math.min(100, job?.progressPercent ?? 0));
    // POSTing a retry briefly leaves the last settled job in learnState until
    // the new durable job is returned by status polling. Do not paint that old
    // failure as if it belonged to the retry now starting.
    const startingLearnAction = learnBusy && !isLearnActive(status);
    const showFailedState = status === "failed" && !startingLearnAction;
    const displayProgress = startingLearnAction
      ? 2
      : status === "complete" || status === "failed"
        ? 100
        : progress;
    const learnTeachingSourceSlugs = effectiveLearnIncludedSourceSlugs;
    const hasSelectedLearnSources = learnTeachingSourceSlugs.length > 0;
    const canStart =
      Boolean(learnState?.hasSources) &&
      hasSelectedLearnSources &&
      !learnBusy &&
      !learnCancelBusy &&
      !active;
    const shouldShowPanel = learnPanelOpen;
    const panelExpanded = learnPanelOpen;
    const staleReviewForExistingGarden =
      status === "awaiting_confirmation" && hasExistingLearnContent;
    const shouldRepairFailedJob =
      status === "failed" && hasExistingLearnContent;
    const shouldRepairFromPrimaryAction =
      shouldRepairFailedJob || staleReviewForExistingGarden;
    const canClosePanel =
      !active &&
      (status === "idle" ||
        status === "complete" ||
        status === "failed" ||
        status === "cancelled" ||
        staleReviewForExistingGarden);
    const showPrimaryAction =
      status === "idle" ||
      !canClosePanel ||
      status === "failed" ||
      status === "cancelled" ||
      staleReviewForExistingGarden;
    const learnDocumentSelectionLocked =
      learnBusy || active || status === "awaiting_confirmation";
    const activeStageMessage: Partial<Record<LearnStatus, string>> = {
      planning: "Planning the Learning Map",
      analyzing_issues: "Analyzing validation issues",
      repairing: "Repairing affected pages and components",
      revalidating: "Revalidating the complete garden",
      publishing_repair: "Publishing repaired projection",
      generating_learning_pages: "Writing lesson pages",
      generating_textbook: "Writing lesson pages",
      generating_visuals: "Generating lesson visuals",
      writing_quartz: "Writing Quartz files",
      building_navigation: "Validating and rebuilding navigation",
    };
    const statusMessage = active
      ? null
      : status === "complete"
        ? "Lessons complete."
        : status === "failed"
          ? null
          : status === "cancelled"
            ? "Learn run cancelled."
            : status === "awaiting_confirmation"
              ? staleReviewForExistingGarden
                ? "Ready to repair current validation issues."
                : "Learning Map ready for review."
              : learnState?.hasTextbook
                ? "Ready to repair current validation issues."
                : "Ready to generate lessons.";
    const stageMessage = startingLearnAction
      ? status === "failed"
        ? "Starting Learn retry..."
        : "Starting Learn..."
      : status === "failed" || status === "cancelled" || staleReviewForExistingGarden
        ? ""
        : job?.currentStep ||
          activeStageMessage[status] ||
          (active ? "Creating lessons" : "");
    const statusDetails = [
      stageMessage || null,
      job?.currentSectionTitle ? `Section: ${job.currentSectionTitle}.` : null,
      job?.currentPageTitle ? `Page: ${job.currentPageTitle}.` : null,
      !hasSelectedLearnSources
        ? learnSyllabusDocument
          ? "The syllabus is reserved for planning; select at least one other document to teach from."
          : `No source documents selected from ${sourceDocuments.length} available.`
        : null,
      status === "awaiting_confirmation" && !staleReviewForExistingGarden
        ? "Pipeline paused for review; timer stopped."
        : null,
    ].filter((detail): detail is string => Boolean(detail));
    const learnTokenUsage = job?.tokenUsage;
    const learnElapsedMs = currentLearnElapsedMs(
      {
        elapsedMs: job?.elapsedMs ?? 0,
        startedAt: job?.timerStartedAt,
      },
      learnTimerNowMs,
    );
    const learnTimerPaused = status === "awaiting_confirmation";
    const hasLearnTokenActivity = (learnTokenUsage?.startedCalls ?? 0) > 0;
    const showLearnTokenUsage = Boolean(
      learnTokenUsage && (active || hasLearnTokenActivity),
    );
    const learnUsageCallSummary = learnTokenUsage
      ? [
          learnTokenUsage.reportedCalls > 0
            ? `${learnTokenUsage.reportedCalls} call${learnTokenUsage.reportedCalls === 1 ? "" : "s"}`
            : null,
          learnTokenUsage.inFlightCalls > 0
            ? `${learnTokenUsage.inFlightCalls} active`
            : null,
          learnTokenUsage.unreportedCalls > 0
            ? `${learnTokenUsage.unreportedCalls} unavailable`
            : null,
        ]
          .filter(Boolean)
          .join(" · ")
      : "";

    if (
      !isOwner ||
      (!learnState?.hasSources && status !== "failed" && !hasLearnData)
    )
      return null;
    if (!shouldShowPanel) return null;

    return (
      <section className="bb-neu-learn-tray neu-surface-raised mx-auto mt-4 max-h-[55vh] w-[calc(100%_-_2rem)] max-w-5xl shrink-0 overflow-y-auto rounded-lg border border-gray-800 bg-gray-950/70 p-3">
        <div className="flex flex-col gap-2">
          <div className="flex min-h-8 items-start justify-between gap-3">
            <div className="flex h-8 shrink-0 items-center gap-2">
              <p className="text-sm font-medium text-white">Learn</p>
              {learnState?.sourceSetChanged && (
                <span className="rounded-md border border-amber-700/50 bg-amber-950/30 px-2 py-0.5 text-[10px] font-medium text-amber-300">
                  New sources
                </span>
              )}
            </div>

            <div className="flex min-w-0 flex-1 items-start gap-2">
              <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
              <div className="relative">
                <button
                  ref={learnDocumentMenuButtonRef}
                  type="button"
                  onClick={() => {
                    setLearnSyllabusMenuOpen(false);
                    setLearnDocumentMenuOpen((open) => !open);
                  }}
                  className="neu-button flex items-center gap-1.5 rounded-md border border-gray-800 px-2 py-1 text-xs text-gray-400 transition-colors hover:border-gray-700 hover:text-gray-200"
                  aria-expanded={learnDocumentMenuOpen}
                  aria-haspopup="menu"
                  title="Choose which source documents Learn may use"
                >
                  <svg
                    className="h-3.5 w-3.5"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.8}
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M6.75 3.75h7.5l3 3v13.5H6.75z"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M14.25 3.75v3h3M9.5 11h5M9.5 14.5h5"
                    />
                  </svg>
                  Documents {learnTeachingSourceSlugs.length}/
                  {learnEligibleSourceDocuments.length}
                  <svg
                    className={`h-3 w-3 transition-transform ${learnDocumentMenuOpen ? "rotate-180" : ""}`}
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path
                      fillRule="evenodd"
                      d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.17l3.71-3.94a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06Z"
                      clipRule="evenodd"
                    />
                  </svg>
                </button>
                {learnDocumentMenuOpen ? (
                  <ViewportPopover
                    anchorRef={learnDocumentMenuButtonRef}
                    ariaLabel="Documents included in Learn"
                    className="neu-popover fixed z-[100] w-80 max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-lg border border-gray-800 bg-gray-950 p-2"
                    onClose={() => setLearnDocumentMenuOpen(false)}
                  >
                    <div className="mb-2 flex items-center justify-between border-b border-gray-800 pb-2">
                      <div>
                        <p className="text-xs font-medium text-gray-200">
                          Documents for Learn
                        </p>
                        <p className="mt-0.5 text-[10px] text-gray-600">
                          The syllabus is reserved for planning. Unchecked
                          documents are excluded from this run.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setLearnIncludedSourceSlugs(
                            learnTeachingSourceSlugs.length ===
                              learnEligibleSourceDocuments.length
                              ? []
                              : learnEligibleSourceDocuments.map(
                                  (doc) => doc.slug,
                                ),
                          )
                        }
                        disabled={learnDocumentSelectionLocked}
                        className="text-[10px] text-gray-400 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {learnTeachingSourceSlugs.length ===
                        learnEligibleSourceDocuments.length
                          ? "Clear all"
                          : "Select all"}
                      </button>
                    </div>
                    <div className="max-h-56 space-y-1 overflow-y-auto">
                      {sourceDocuments.map((doc) => {
                        const isSyllabus = doc.slug === learnSyllabusSlug;
                        const checked = effectiveLearnIncludedSourceSlugSet.has(
                          doc.slug,
                        );
                        const fileLabel =
                          doc.sourcePdf ||
                          doc.sourceFile ||
                          doc.name ||
                          doc.title;
                        return (
                          <label
                            key={doc.slug}
                            className={`flex items-start gap-2 rounded-md px-2 py-1.5 ${
                              isSyllabus
                                ? "cursor-not-allowed bg-gray-900/50 opacity-60"
                                : "cursor-pointer hover:bg-gray-900"
                            }`}
                            title={
                              isSyllabus
                                ? "Used as the syllabus and excluded from teaching documents"
                                : undefined
                            }
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() =>
                                toggleLearnSourceDocument(doc.slug)
                              }
                              disabled={
                                learnDocumentSelectionLocked || isSyllabus
                              }
                              className="mt-0.5 h-3.5 w-3.5 rounded border-gray-700 bg-gray-950 accent-white disabled:opacity-40"
                            />
                            <span className="min-w-0">
                              <span className="block truncate text-xs text-gray-300">
                                {fileLabel}
                              </span>
                              {isSyllabus ? (
                                <span className="mt-0.5 block text-[10px] text-gray-500">
                                  Used as syllabus — not teaching material
                                </span>
                              ) : doc.description ? (
                                <span className="mt-0.5 block truncate text-[10px] text-gray-600">
                                  {doc.description}
                                </span>
                              ) : null}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                    {learnDocumentSelectionLocked ? (
                      <p className="mt-2 border-t border-gray-800 pt-2 text-[10px] text-gray-600">
                        This selection is locked for the current Learning Map.
                      </p>
                    ) : null}
                  </ViewportPopover>
                ) : null}
              </div>
              <div className="relative">
                <button
                  ref={learnSyllabusMenuButtonRef}
                  type="button"
                  onClick={() => {
                    setLearnDocumentMenuOpen(false);
                    setLearnSyllabusMenuOpen((open) => !open);
                  }}
                  className="neu-button flex items-center gap-1.5 rounded-md border border-gray-800 px-2 py-1 text-xs text-gray-400 transition-colors hover:border-gray-700 hover:text-gray-200"
                  aria-expanded={learnSyllabusMenuOpen}
                  aria-haspopup="menu"
                  title="Choose a syllabus or study guide for Learn to plan against"
                >
                  <svg
                    className="h-3.5 w-3.5"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.8}
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M4 5.5A1.5 1.5 0 0 1 5.5 4H10a2 2 0 0 1 2 2v13a2 2 0 0 0-2-2H5.5A1.5 1.5 0 0 1 4 15.5z"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M20 5.5A1.5 1.5 0 0 0 18.5 4H14a2 2 0 0 0-2 2v13a2 2 0 0 1 2-2h4.5a1.5 1.5 0 0 0 1.5-1.5z"
                    />
                  </svg>
                  <span
                    className="max-w-28 truncate sm:max-w-32"
                    title={
                      learnSyllabusDocument
                        ? learnSyllabusDocument.name ||
                          learnSyllabusDocument.title
                        : undefined
                    }
                  >
                    {learnSyllabusDocument
                      ? `Syllabus: ${learnSyllabusDocument.name || learnSyllabusDocument.title}`
                      : "Syllabus: none"}
                  </span>
                  <svg
                    className={`h-3 w-3 transition-transform ${learnSyllabusMenuOpen ? "rotate-180" : ""}`}
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path
                      fillRule="evenodd"
                      d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.17l3.71-3.94a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06Z"
                      clipRule="evenodd"
                    />
                  </svg>
                </button>
                {learnSyllabusMenuOpen ? (
                  <ViewportPopover
                    anchorRef={learnSyllabusMenuButtonRef}
                    ariaLabel="Syllabus for Learn"
                    className="neu-popover fixed z-[100] w-80 max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-lg border border-gray-800 bg-gray-950 p-2"
                    onClose={() => setLearnSyllabusMenuOpen(false)}
                  >
                    <div className="mb-2 border-b border-gray-800 pb-2">
                      <p className="text-xs font-medium text-gray-200">
                        Syllabus for Learn
                      </p>
                      <p className="mt-0.5 text-[10px] text-gray-600">
                        A study guide Learn plans against: it sets which topics
                        to cover, in what order, and how deep. It is not taught
                        as source material.
                      </p>
                    </div>
                    <div className="max-h-56 space-y-1 overflow-y-auto">
                      <label className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 hover:bg-gray-900">
                        <input
                          type="radio"
                          name="learn-syllabus"
                          checked={learnSyllabusSlug === null}
                          onChange={() => chooseLearnSyllabusDocument(null)}
                          disabled={learnDocumentSelectionLocked}
                          className="mt-0.5 h-3.5 w-3.5 border-gray-700 bg-gray-950 accent-white disabled:opacity-40"
                        />
                        <span className="block text-xs text-gray-300">
                          No syllabus
                        </span>
                      </label>
                      {sourceDocuments.map((doc) => {
                        const fileLabel =
                          doc.sourcePdf ||
                          doc.sourceFile ||
                          doc.name ||
                          doc.title;
                        return (
                          <label
                            key={doc.slug}
                            className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 hover:bg-gray-900"
                          >
                            <input
                              type="radio"
                              name="learn-syllabus"
                              checked={learnSyllabusSlug === doc.slug}
                              onChange={() =>
                                chooseLearnSyllabusDocument(doc.slug)
                              }
                              disabled={learnDocumentSelectionLocked}
                              className="mt-0.5 h-3.5 w-3.5 border-gray-700 bg-gray-950 accent-white disabled:opacity-40"
                            />
                            <span className="min-w-0">
                              <span className="block truncate text-xs text-gray-300">
                                {fileLabel}
                              </span>
                              {doc.description ? (
                                <span className="mt-0.5 block truncate text-[10px] text-gray-600">
                                  {doc.description}
                                </span>
                              ) : null}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                    {learnSyllabusCoverage ? (
                      <div className="mt-2 rounded-md border border-gray-800 bg-gray-900/60 px-2 py-1.5">
                        <p className="text-[10px] text-gray-400">
                          Read {learnSyllabusCoverage.unitCount} unit
                          {learnSyllabusCoverage.unitCount === 1 ? "" : "s"} and{" "}
                          {learnSyllabusCoverage.materialCount} assigned
                          material
                          {learnSyllabusCoverage.materialCount === 1 ? "" : "s"};{" "}
                          {learnSyllabusCoverage.availableCount} matched a
                          document in this garden.
                        </p>
                        {learnSyllabusCoverage.missingCount > 0 ? (
                          <>
                            <p className="mt-1 text-[10px] text-amber-300">
                              {learnSyllabusCoverage.missingCount} assigned work
                              {learnSyllabusCoverage.missingCount === 1
                                ? " is"
                                : "s are"}{" "}
                              not uploaded. Lessons are never written from{" "}
                              {learnSyllabusCoverage.missingCount === 1
                                ? "it"
                                : "them"}
                              — upload{" "}
                              {learnSyllabusCoverage.missingCount === 1
                                ? "it"
                                : "them"}{" "}
                              to have{" "}
                              {learnSyllabusCoverage.missingCount === 1
                                ? "that topic"
                                : "those topics"}{" "}
                              covered.
                            </p>
                            <ul className="mt-1 space-y-0.5">
                              {learnSyllabusCoverage.missingCitations
                                .slice(0, 5)
                                .map((citation) => (
                                  <li
                                    key={citation}
                                    className="truncate text-[10px] text-gray-500"
                                    title={citation}
                                  >
                                    · {citation}
                                  </li>
                                ))}
                              {learnSyllabusCoverage.missingCitations.length >
                              5 ? (
                                <li className="text-[10px] text-gray-600">
                                  ·{" "}
                                  {learnSyllabusCoverage.missingCitations
                                    .length - 5}{" "}
                                  more
                                </li>
                              ) : null}
                            </ul>
                          </>
                        ) : null}
                      </div>
                    ) : null}
                    <div className="mt-2 border-t border-gray-800 pt-2">
                      <label
                        className="block text-[10px] font-medium text-gray-400"
                        htmlFor="learn-syllabus-prompt"
                      >
                        Or describe what you want to learn
                      </label>
                      <textarea
                        id="learn-syllabus-prompt"
                        value={learnSyllabusPrompt}
                        onChange={(event) =>
                          setLearnSyllabusPrompt(event.target.value)
                        }
                        onKeyDown={(event) => {
                          if (
                            (event.metaKey || event.ctrlKey) &&
                            event.key === "Enter"
                          ) {
                            event.preventDefault();
                            void handleSyllabusGenerate();
                          }
                        }}
                        rows={2}
                        maxLength={4000}
                        disabled={
                          learnDocumentSelectionLocked ||
                          learnSyllabusGenerating ||
                          learnSyllabusUploading
                        }
                        placeholder="I want to learn everything introductory about electronics"
                        className="neu-input mt-1 w-full resize-y rounded-md border border-gray-800 bg-gray-950 px-2 py-1.5 text-[11px] text-gray-200 placeholder:text-gray-700 focus:border-gray-700 focus:outline-none disabled:cursor-not-allowed disabled:opacity-40"
                      />
                      <button
                        type="button"
                        onClick={() => void handleSyllabusGenerate()}
                        disabled={
                          learnDocumentSelectionLocked ||
                          learnSyllabusGenerating ||
                          learnSyllabusUploading ||
                          !learnSyllabusPrompt.trim()
                        }
                        className="neu-button mt-1.5 flex w-full items-center justify-center gap-1.5 rounded-md border border-gray-800 px-2 py-1.5 text-[11px] text-gray-300 transition-colors hover:border-gray-700 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {learnSyllabusGenerating ? (
                          <>
                            <Spinner className="h-3 w-3" />
                            Writing syllabus…
                          </>
                        ) : (
                          <>
                            <svg
                              className="h-3.5 w-3.5"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth={1.8}
                              aria-hidden="true"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="m12 3 1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8zM18 15l.9 2.3 2.3.9-2.3.9-.9 2.3-.9-2.3-2.3-.9 2.3-.9z"
                              />
                            </svg>
                            Generate a syllabus
                          </>
                        )}
                      </button>
                      <p className="mt-1.5 text-[10px] text-gray-600">
                        Written as a course outline over the documents in this
                        garden, then saved to Documents like any other syllabus.
                        It assigns no outside readings, so every unit is one your
                        material can teach.
                      </p>
                    </div>
                    <div className="mt-2 border-t border-gray-800 pt-2">
                      <input
                        ref={learnSyllabusInputRef}
                        type="file"
                        accept={ACCEPTED}
                        className="hidden"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          event.target.value = "";
                          if (file) void handleSyllabusUpload(file);
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => learnSyllabusInputRef.current?.click()}
                        disabled={
                          learnDocumentSelectionLocked ||
                          learnSyllabusUploading ||
                          learnSyllabusGenerating
                        }
                        className="neu-button flex w-full items-center justify-center gap-1.5 rounded-md border border-gray-800 px-2 py-1.5 text-[11px] text-gray-300 transition-colors hover:border-gray-700 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {learnSyllabusUploading ? (
                          <>
                            <Spinner className="h-3 w-3" />
                            Uploading syllabus…
                          </>
                        ) : (
                          <>
                            <svg
                              className="h-3.5 w-3.5"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth={1.8}
                              aria-hidden="true"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M12 16V4m0 0L8 8m4-4 4 4M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2"
                              />
                            </svg>
                            Upload a syllabus
                          </>
                        )}
                      </button>
                      <p className="mt-1.5 text-[10px] text-gray-600">
                        Uploaded syllabi are added to Documents so you can reuse
                        them later.
                      </p>
                    </div>
                    {learnDocumentSelectionLocked ? (
                      <p className="mt-2 border-t border-gray-800 pt-2 text-[10px] text-gray-600">
                        The syllabus is locked for the current Learning Map.
                      </p>
                    ) : null}
                  </ViewportPopover>
                ) : null}
              </div>
              <label className="flex items-center gap-1.5 text-xs text-gray-500">
                <input
                  type="checkbox"
                  checked={learnSourceOnly}
                  onChange={(event) => setLearnSourceOnly(event.target.checked)}
                  disabled={learnBusy || active}
                  className="h-3.5 w-3.5 rounded border-gray-700 bg-gray-950 accent-white disabled:opacity-40"
                />
                Source-only
              </label>
              <label
                className="flex items-center gap-1.5 text-xs text-gray-500"
                title="Automatically confirm the learning map and continue generating lessons"
              >
                <input
                  type="checkbox"
                  checked={learnSkipManualReview}
                  onChange={(event) => {
                    learnSkipManualReviewRef.current = event.target.checked;
                    setLearnSkipManualReview(event.target.checked);
                  }}
                  disabled={
                    status === "awaiting_confirmation" ||
                    (active && status !== "planning")
                  }
                  className="h-3.5 w-3.5 rounded border-gray-700 bg-gray-950 accent-white disabled:opacity-40"
                />
                Skip review
              </label>
              {status === "complete" && (
                <button
                  type="button"
                  onClick={handleRepairIssues}
                  disabled={!canStart}
                  title="Repairs only failing pages and components; unaffected content is preserved"
                  className="neu-button-primary flex items-center gap-1.5 px-3 py-1.5 text-sm bg-white text-gray-950 font-medium rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {learnBusy ? (
                    <Spinner className="h-3.5 w-3.5" />
                  ) : (
                    <svg
                      className="h-3.5 w-3.5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={1.8}
                      aria-hidden="true"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M12 6.75v10.5m0-10.5c-1.5-1-3.5-1.5-6-1.5v10.5c2.5 0 4.5.5 6 1.5m0-10.5c1.5-1 3.5-1.5 6-1.5v10.5c-2.5 0-4.5.5-6 1.5"
                      />
                    </svg>
                  )}
                  {learnBusy ? "Repairing..." : "Repair issues"}
                </button>
              )}
              {hasExistingLearnContent &&
                (status === "complete" ||
                  status === "failed" ||
                  status === "cancelled" ||
                  status === "awaiting_confirmation") && (
                <button
                  type="button"
                  onClick={handleFullRebuild}
                  disabled={!canStart}
                  className="neu-button-destructive rounded-lg border border-red-900/70 px-3 py-1.5 text-xs text-red-300 transition hover:border-red-700 hover:text-red-200 disabled:cursor-not-allowed disabled:opacity-40"
                  title="Destructive: recreate the Learning Map, contract, all pages, and visuals"
                >
                  Rebuild entire garden
                </button>
              )}
              {hasLearnData && !active && (
                <button
                  type="button"
                  onClick={handleClearLearnData}
                  disabled={learnBusy || learnCancelBusy || active}
                  className="neu-button-destructive rounded-lg border border-red-900/70 px-3 py-1.5 text-xs text-red-300 transition hover:border-red-700 hover:text-red-200 disabled:cursor-not-allowed disabled:opacity-40"
                  title="Destructive: remove generated Learn content and Learn history while preserving sources and non-Learn notes"
                >
                  Clear Learn data
                </button>
              )}
              {showPrimaryAction && !active && (
                <button
                  type="button"
                  onClick={
                    shouldRepairFromPrimaryAction
                      ? handleRepairIssues
                      : status === "cancelled"
                        ? handleGenerateAfterCancellation
                        : handleLearnPrimary
                  }
                  disabled={
                    learnCancelBusy ||
                    (!canStart && status !== "awaiting_confirmation")
                  }
                  className="neu-button-primary flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-gray-950 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {learnBusy || active ? (
                    <Spinner className="h-3.5 w-3.5" />
                  ) : null}
                  {shouldRepairFromPrimaryAction
                    ? learnBusy
                      ? "Repairing..."
                      : "Repair issues"
                    : status === "failed"
                      ? learnBusy
                        ? "Retrying..."
                        : "Retry Learn"
                    : status === "cancelled"
                      ? learnBusy
                        ? hasExistingLearnContent
                          ? "Repairing..."
                          : "Generating..."
                        : hasExistingLearnContent
                          ? "Repair issues"
                          : "Generate"
                      : (learnState?.buttonLabel ?? "Learn")}
                </button>
              )}
              {active && (
                <button
                  type="button"
                  onClick={handleCancelLearn}
                  disabled={learnCancelBusy}
                  className="neu-button-destructive flex items-center gap-1.5 rounded-lg border border-red-900/60 bg-red-950/30 px-3 py-1.5 text-sm font-medium text-red-300 transition-colors hover:border-red-700 hover:text-red-200 disabled:cursor-wait disabled:opacity-60"
                  title="Stop this Learn run"
                >
                  {learnCancelBusy ? <Spinner className="h-3.5 w-3.5" /> : null}
                  {learnCancelBusy ? "Stopping..." : "Stop"}
                </button>
              )}
              </div>
              {!active &&
                (status !== "awaiting_confirmation" ||
                  staleReviewForExistingGarden) && (
                  <button
                    type="button"
                    onClick={() => setLearnPanelOpen(false)}
                    className="neu-button-icon flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-gray-800 text-gray-500 transition-colors hover:border-gray-700 hover:text-gray-300"
                    aria-label="Close Learn panel"
                    title="Close"
                  >
                    <svg
                      className="h-3.5 w-3.5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M6 18 18 6M6 6l12 12"
                      />
                    </svg>
                  </button>
                )}
            </div>
          </div>
        </div>

        {!hasSelectedLearnSources ? (
          <p className="mt-2 text-xs text-amber-400">
            Select at least one teaching document before starting Learn.
          </p>
        ) : null}

        {(active || status === "complete" || status === "failed") && (
          <div className="mt-3">
            <div className="neu-progress-track h-1.5 overflow-hidden rounded-full bg-gray-800">
              <div
                className={[
                  "h-full rounded-full transition-all",
                  active ? "learn-progress-pulse" : "",
                  showFailedState
                    ? "bg-red-500"
                    : status === "complete"
                      ? "bg-emerald-400"
                      : "bg-white",
                ].join(" ")}
                style={{ width: `${displayProgress}%` }}
              />
            </div>
            {status === "complete" ? (
              <p className="mt-2 text-xs text-emerald-300">
                Finished generating lessons. The garden has been refreshed.
              </p>
            ) : null}
            {showFailedState && job?.error ? (
              <p className="mt-2 text-xs text-red-300">
                {displayLearnError(job.error)}
              </p>
            ) : null}
          </div>
        )}

        {(statusMessage || statusDetails.length > 0) && (
          <div className="mt-2 min-w-0" aria-live="polite" aria-atomic="true">
            {statusMessage ? (
              <p className="text-xs leading-5 text-gray-400">{statusMessage}</p>
            ) : null}
            {statusDetails.length > 0 ? (
              <p className="text-[11px] leading-5 text-gray-600">
                {statusDetails.join(" ")}
              </p>
            ) : null}
          </div>
        )}

        {showLearnTokenUsage && learnTokenUsage ? (
          <div
            className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-gray-800 pt-2 text-[11px]"
            aria-label="Learn token usage"
          >
            <span className="font-medium text-gray-300">Tokens</span>
            <span
              className="flex items-center gap-1 font-mono tabular-nums text-gray-400"
              title={
                learnTimerPaused
                  ? "Paused while the learning map waits for confirmation"
                  : job?.timerStartedAt
                    ? "Learn creation time"
                    : "Total Learn creation time"
              }
              aria-label={`Learn timer ${formatLearnElapsedTime(learnElapsedMs)}${learnTimerPaused ? ", paused" : ""}`}
            >
              <svg
                className="h-3 w-3"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.8}
                aria-hidden="true"
              >
                <circle cx="12" cy="13" r="8" />
                <path strokeLinecap="round" d="M12 9v4l2.5 1.5M9 2h6M12 2v3" />
              </svg>
              {formatLearnElapsedTime(learnElapsedMs)}
            </span>

            {learnTokenUsage.reportedCalls > 0 ? (
              <dl className="flex flex-wrap items-center gap-x-3 gap-y-1">
                {[
                  {
                    label: "Input",
                    value: learnTokenUsage.inputTokens,
                    title: `${formatExactTokenCount(learnTokenUsage.inputTokens)} input · ${formatExactTokenCount(learnTokenUsage.cachedInputTokens)} cached`,
                  },
                  {
                    label: "Output",
                    value: learnTokenUsage.outputTokens,
                    title: `${formatExactTokenCount(learnTokenUsage.outputTokens)} output`,
                  },
                  {
                    label: "Reasoning",
                    value: learnTokenUsage.reasoningTokens,
                    title: `${formatExactTokenCount(learnTokenUsage.reasoningTokens)} reasoning (included in output)`,
                  },
                  {
                    label: "Total",
                    value: learnTokenUsage.totalTokens,
                    title: `${formatExactTokenCount(learnTokenUsage.totalTokens)} total tokens`,
                  },
                ].map((metric) => (
                  <Fragment key={metric.label}>
                    <div className="flex items-baseline gap-1">
                      <dt className="text-gray-600">{metric.label}</dt>
                      <dd
                        className="font-mono tabular-nums text-gray-200"
                        title={metric.title}
                      >
                        {learnTokenUsage.estimated ? "~" : ""}
                        {metric.label === "Total"
                          ? formatLearnTotalTokenCount(metric.value)
                          : formatLearnMetricTokenCount(metric.value)}
                      </dd>
                    </div>
                    {metric.label === "Total" && job?.model ? (
                      <div className="flex items-baseline gap-1">
                        <dt className="text-gray-600">Model:</dt>
                        <dd
                          className="font-mono tabular-nums text-gray-200"
                          title={`Model making these calls: ${job.model}`}
                        >
                          {formatAssistantModelName(job.model)}
                        </dd>
                      </div>
                    ) : null}
                  </Fragment>
                ))}
              </dl>
            ) : (
              <span className="text-gray-600">Waiting for usage</span>
            )}

            {learnUsageCallSummary ? (
              <span className="ml-auto text-gray-600">
                {learnUsageCallSummary}
              </span>
            ) : null}
          </div>
        ) : null}

        {panelExpanded &&
          proposedMap &&
          status === "awaiting_confirmation" &&
          !staleReviewForExistingGarden && (
            <div className="mt-4 border-t border-gray-800 pt-3">
              <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-100">
                    {proposedMap.title}
                  </p>
                  {proposedMap.summary ? (
                    <p className="mt-0.5 text-xs text-gray-500">
                      {proposedMap.summary}
                    </p>
                  ) : null}
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={handleConfirmAndGenerate}
                    disabled={learnBusy}
                    className="flex items-center gap-1.5 rounded-lg bg-cyan-100 px-3 py-1.5 text-xs font-medium text-gray-950 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {learnBusy ? <Spinner className="h-3.5 w-3.5" /> : null}
                    Confirm and Learn
                  </button>
                  <button
                    type="button"
                    onClick={handleRegenerateLearningMap}
                    disabled={learnBusy}
                    className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs text-gray-300 transition hover:border-gray-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Regenerate Learning Map
                  </button>
                  <button
                    type="button"
                    onClick={handleCancelLearn}
                    disabled={learnCancelBusy}
                    className="flex items-center gap-1.5 rounded-lg border border-gray-800 px-3 py-1.5 text-xs text-gray-500 transition hover:border-gray-700 hover:text-gray-300 disabled:cursor-wait disabled:opacity-60"
                  >
                    {learnCancelBusy ? (
                      <Spinner className="h-3.5 w-3.5" />
                    ) : null}
                    {learnCancelBusy ? "Cancelling..." : "Cancel"}
                  </button>
                </div>
              </div>

              <ol className="max-h-72 space-y-2 overflow-y-auto pr-1">
                {proposedMap.sections.map((section, sectionIndex) => (
                  <li
                    key={`${section.title}-${sectionIndex}`}
                    className="rounded-lg border border-gray-800 bg-gray-900/50 p-3"
                  >
                    <div className="flex items-start gap-2">
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-gray-800 text-[11px] font-medium text-gray-300">
                        {sectionIndex + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-gray-100">
                          {section.title}
                        </p>
                        {section.purpose ? (
                          <p className="mt-1 text-xs leading-5 text-gray-500">
                            {section.purpose}
                          </p>
                        ) : null}
                        <ul className="mt-2 space-y-1">
                          {section.subsections.map(
                            (subsection, subsectionIndex) => (
                              <li
                                key={`${subsection.title}-${subsectionIndex}`}
                                className="text-xs text-gray-400"
                              >
                                <span className="text-gray-600">
                                  {sectionIndex + 1}.{subsectionIndex + 1}
                                </span>{" "}
                                {subsection.title}
                                {subsection.visualOpportunities &&
                                subsection.visualOpportunities.length > 0 ? (
                                  <span className="ml-2 text-cyan-500">
                                    {subsection.visualOpportunities.length}{" "}
                                    visual
                                    {subsection.visualOpportunities.length === 1
                                      ? ""
                                      : "s"}
                                  </span>
                                ) : null}
                              </li>
                            ),
                          )}
                        </ul>
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          )}

        {panelExpanded && status === "complete" && (
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-gray-800 pt-3">
            <Link
              href={`/garden/${clusterSlug}`}
              className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs text-gray-300 transition hover:border-gray-500 hover:text-white"
            >
              Open lessons
            </Link>
            <span className="text-xs text-gray-600">
              {learnState?.latestTextbookVersionId ?? job?.id}
            </span>
          </div>
        )}
      </section>
    );
  }

  function handleDocumentColorButtonClick(
    slug: string,
    selectableForChat: boolean,
  ) {
    const pendingTimer = documentColorClickTimersRef.current.get(slug);
    if (pendingTimer !== undefined) {
      window.clearTimeout(pendingTimer);
      documentColorClickTimersRef.current.delete(slug);
      if (!selectableForChat) {
        setOpenFlagPaletteSlug((openSlug) => (openSlug === slug ? null : slug));
        return;
      }
      setOpenFlagPaletteSlug(null);
      toggleSelectedDocument(slug);
      return;
    }

    const timer = window.setTimeout(() => {
      documentColorClickTimersRef.current.delete(slug);
      setOpenFlagPaletteSlug((openSlug) => (openSlug === slug ? null : slug));
    }, 250);
    documentColorClickTimersRef.current.set(slug, timer);
  }

  useEffect(() => {
    const clickTimers = documentColorClickTimersRef.current;
    return () => {
      for (const timer of clickTimers.values()) window.clearTimeout(timer);
      clickTimers.clear();
    };
  }, []);

  function renderMarkdownRows(items: DocInfo[]) {
    return (
      <ul className="py-1">
        {items.map((doc, index) => {
          const isSource = doc.type === "source-document";
          const isSelectedForChat =
            isSource && selectedDocumentSlugs.includes(doc.slug);
          const isPdf = isSource && doc.sourceType?.toLowerCase() === "pdf";
          const isPdfSource = isPdf && Boolean(doc.sourcePdf);
          const displayTitle =
            (isPdf ? doc.sourceFile?.trim() : "") || doc.title || doc.name;
          // Existing PDF notes predate the explicit description field and have
          // the generated description in `title`. Preserve it as a UI fallback
          // so they also adopt the filename-first presentation immediately.
          const storedDescription = doc.description?.trim() || "";
          const sourceDescription =
            (storedDescription !== displayTitle ? storedDescription : "") ||
            (isPdf && doc.title?.trim() !== displayTitle
              ? doc.title.trim()
              : "");
          const documentHref = isPdfSource
            ? `/gardens/${clusterSlug}/pdf/${encodeURIComponent(doc.slug)}`
            : gardenDocumentHref(clusterSlug, doc);
          return (
            <li
              key={`${doc.slug}:${doc.type}:${index}`}
              className={[
                "group flex items-start gap-2.5 px-4 py-2 transition-colors",
                isSource
                  ? "border-l-2 border-cyan-400/60 bg-cyan-950/10 hover:bg-cyan-950/20"
                  : "hover:bg-gray-900",
              ].join(" ")}
            >
              <div className="relative shrink-0 mt-0.5">
                <button
                  type="button"
                  onClick={() =>
                    handleDocumentColorButtonClick(doc.slug, isSource)
                  }
                  disabled={savingFlagSlug === doc.slug}
                  className={[
                    "h-5 w-5 rounded border border-gray-700 bg-gray-950",
                    "flex items-center justify-center transition-colors hover:border-gray-500",
                    isSelectedForChat
                      ? "border-cyan-300 ring-2 ring-cyan-300/80 ring-offset-1 ring-offset-gray-950"
                      : "",
                    savingFlagSlug === doc.slug
                      ? "opacity-50 cursor-wait"
                      : "cursor-pointer",
                  ].join(" ")}
                  title={`${doc.flagColor ? `Flagged ${doc.flagColor}. ` : ""}${
                    isSelectedForChat
                      ? "Selected for chat; click twice to remove."
                      : isSource
                        ? "Click twice to select for chat."
                        : ""
                  } Click once to choose a color.`}
                  aria-label={
                    isSource
                      ? isSelectedForChat
                        ? "Document color; selected for chat"
                        : "Document color; click twice to select for chat"
                      : "Document color"
                  }
                  aria-pressed={isSource ? isSelectedForChat : undefined}
                  aria-expanded={openFlagPaletteSlug === doc.slug}
                >
                  <span
                    className="h-3 w-3 rounded-sm border border-gray-800"
                    style={{ backgroundColor: doc.flagColor || "transparent" }}
                  />
                </button>
                {openFlagPaletteSlug === doc.slug && (
                  <div className="absolute left-0 top-6 z-20 w-32 rounded-lg border border-gray-800 bg-gray-950 p-2 shadow-xl">
                    <div className="grid grid-cols-5 gap-1.5">
                      {FLAG_COLORS.map((color) => (
                        <button
                          key={color}
                          type="button"
                          onClick={() => {
                            setOpenFlagPaletteSlug(null);
                            handleDocumentFlag(doc.slug, color);
                          }}
                          className={[
                            "h-4 w-4 rounded border transition-transform hover:scale-110",
                            doc.flagColor === color
                              ? "border-white"
                              : "border-gray-800",
                          ].join(" ")}
                          style={{ backgroundColor: color }}
                          aria-label={`Flag ${color}`}
                          title={color}
                        />
                      ))}
                    </div>
                    {doc.flagColor && (
                      <button
                        type="button"
                        onClick={() => {
                          setOpenFlagPaletteSlug(null);
                          handleDocumentFlag(doc.slug, "");
                        }}
                        className="mt-2 w-full rounded border border-gray-800 px-2 py-1 text-[10px] text-gray-500 transition-colors hover:border-gray-700 hover:text-white"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                )}
              </div>
              <svg
                className="w-3.5 h-3.5 text-gray-600 shrink-0 mt-0.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"
                />
              </svg>
              <div className="flex-1 min-w-0">
                <Link
                  href={documentHref}
                  className={[
                    "block text-xs truncate transition-colors",
                    isSource
                      ? "text-cyan-100 hover:text-white font-medium"
                      : "text-gray-300 hover:text-white",
                  ].join(" ")}
                  title={isPdfSource ? "Open PDF viewer" : "Open note"}
                >
                  {displayTitle}
                </Link>
                {isSource && sourceDescription && (
                  <p
                    className="mt-0.5 line-clamp-2 text-[10px] leading-4 text-gray-500"
                    title={sourceDescription}
                  >
                    {sourceDescription}
                  </p>
                )}
                <p className="text-[10px] text-gray-600 mt-0.5">
                  {isPdf
                    ? "PDF source"
                    : isSource
                      ? "full source content"
                      : markdownTypeLabel(doc)}{" "}
                  &middot; {doc.wordCount}w
                </p>
              </div>
              <button
                type="button"
                onClick={() => handleDocumentDelete(doc)}
                disabled={deletingDocumentSlug === doc.slug}
                className={[
                  "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md",
                  "text-gray-700 opacity-60 transition-colors hover:opacity-100",
                  "hover:bg-red-950/40 hover:text-red-300 disabled:cursor-wait disabled:opacity-60",
                ].join(" ")}
                title={
                  isSource
                    ? "Delete source PDF and lesson pages"
                    : "Delete document"
                }
                aria-label={
                  isSource
                    ? "Delete source PDF and lesson pages"
                    : "Delete document"
                }
              >
                {deletingDocumentSlug === doc.slug ? (
                  <Spinner className="h-3.5 w-3.5" />
                ) : (
                  <svg
                    className="h-3.5 w-3.5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={1.7}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166M19.228 5.79 18.16 19.673A2.25 2.25 0 0 1 15.916 21.75H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .563c.34-.059.68-.114 1.022-.166m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
                    />
                  </svg>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    );
  }

  type FolderTreeNode = {
    path: string;
    name: string;
    childFolders: FolderTreeNode[];
    files: DocInfo[];
  };

  const handleCreateFolder = async (parentPath = "") => {
    const input = window.prompt(
      parentPath ? `New folder inside "${parentPath}"` : "New folder name",
    );
    if (input === null) return;
    if (!input.trim()) return;
    const folder = parentPath ? `${parentPath}/${input.trim()}` : input.trim();
    setCreatingFolder(true);
    try {
      const res = await fetch("/api/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clusterSlug, folder }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        addToast(data.error ?? "Failed to create folder");
        return;
      }
      setDocsExpanded(true);
      setExpandedFolders((prev) => {
        const next = new Set(prev);
        if (typeof data.folder === "string") next.add(data.folder);
        if (parentPath) next.add(parentPath);
        return next;
      });
      await fetchDocuments();
    } catch {
      addToast("Failed to create folder");
    } finally {
      setCreatingFolder(false);
    }
  };

  const handleMoveNote = async (slug: string, toFolder: string) => {
    setDraggingSlug(null);
    setDragOverFolder(null);
    const doc = documents.find((d) => d.slug === slug);
    if (!doc || (doc.folder || "") === toFolder) return;
    setMovingSlug(slug);
    try {
      const res = await fetch("/api/folders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clusterSlug, slug, toFolder }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        addToast(data.error ?? "Failed to move note");
        return;
      }
      if (toFolder) setExpandedFolders((prev) => new Set(prev).add(toFolder));
      await fetchDocuments();
    } catch {
      addToast("Failed to move note");
    } finally {
      setMovingSlug(null);
    }
  };

  const handleRenameFolder = async (folderPath: string) => {
    const currentName = folderPath.split("/").pop() ?? folderPath;
    const input = window.prompt(`Rename folder "${currentName}"`, currentName);
    if (input === null) return;
    const name = input.trim();
    if (!name || name === currentName) return;
    setCreatingFolder(true);
    try {
      const res = await fetch("/api/folders", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clusterSlug, folder: folderPath, name }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        addToast(data.error ?? "Failed to rename folder");
        return;
      }
      const newFolder =
        typeof data.newFolder === "string" ? data.newFolder : folderPath;
      // Remap any expanded folder paths under the renamed folder to the new path.
      setExpandedFolders((prev) => {
        const next = new Set<string>();
        for (const p of prev) {
          if (p === folderPath) next.add(newFolder);
          else if (p.startsWith(`${folderPath}/`))
            next.add(`${newFolder}${p.slice(folderPath.length)}`);
          else next.add(p);
        }
        next.add(newFolder);
        return next;
      });
      await fetchDocuments();
      addToast("Folder renamed", "success");
    } catch {
      addToast("Failed to rename folder");
    } finally {
      setCreatingFolder(false);
    }
  };

  const toggleFolderExpand = (folderPath: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderPath)) next.delete(folderPath);
      else next.add(folderPath);
      return next;
    });
  };

  const handleDeleteFolder = async (folderPath: string) => {
    const inFolder = documents.filter(
      (d) =>
        (d.folder || "") === folderPath ||
        (d.folder || "").startsWith(`${folderPath}/`),
    ).length;
    const confirmed = window.confirm(
      inFolder > 0
        ? `Delete folder "${folderPath}" and its ${inFolder} note${inFolder === 1 ? "" : "s"}? This cannot be undone.`
        : `Delete folder "${folderPath}"?`,
    );
    if (!confirmed) return;
    try {
      const res = await fetch("/api/folders", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clusterSlug, folder: folderPath }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        addToast(data.error ?? "Failed to delete folder");
        return;
      }
      setExpandedFolders((prev) => {
        const next = new Set(prev);
        next.delete(folderPath);
        return next;
      });
      await fetchDocuments();
    } catch {
      addToast("Failed to delete folder");
    }
  };

  const buildMarkdownTree = (
    items: DocInfo[],
    folderPaths: string[],
  ): FolderTreeNode => {
    const root: FolderTreeNode = {
      path: "",
      name: "",
      childFolders: [],
      files: [],
    };
    const nodeByPath = new Map<string, FolderTreeNode>([["", root]]);

    const ensureFolder = (folderPath: string): FolderTreeNode => {
      if (!folderPath) return root;
      const existing = nodeByPath.get(folderPath);
      if (existing) return existing;
      const segments = folderPath.split("/");
      const parent = ensureFolder(segments.slice(0, -1).join("/"));
      const node: FolderTreeNode = {
        path: folderPath,
        name: segments[segments.length - 1],
        childFolders: [],
        files: [],
      };
      parent.childFolders.push(node);
      nodeByPath.set(folderPath, node);
      return node;
    };

    for (const folderPath of folderPaths) ensureFolder(folderPath);
    for (const doc of items) ensureFolder(doc.folder || "").files.push(doc);

    const sortNode = (node: FolderTreeNode) => {
      node.childFolders.sort((a, b) => a.name.localeCompare(b.name));
      node.childFolders.forEach(sortNode);
    };
    sortNode(root);
    return root;
  };

  const countFiles = (node: FolderTreeNode): number =>
    node.files.length +
    node.childFolders.reduce((sum, child) => sum + countFiles(child), 0);

  const renderMarkdownFileRow = (doc: DocInfo, depth: number) => (
    <li
      key={`${doc.slug}:${doc.type}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", doc.slug);
        e.dataTransfer.effectAllowed = "move";
        setDraggingSlug(doc.slug);
      }}
      onDragEnd={() => {
        setDraggingSlug(null);
        setDragOverFolder(null);
      }}
      className={[
        "group flex items-start gap-2.5 py-2 pr-4 transition-colors",
        movingSlug === doc.slug ? "opacity-50" : "",
        draggingSlug === doc.slug ? "opacity-40" : "hover:bg-gray-900",
      ].join(" ")}
      style={{ paddingLeft: `${16 + depth * 14}px` }}
    >
      <div className="relative shrink-0 mt-0.5">
        <button
          type="button"
          onClick={() =>
            setOpenFlagPaletteSlug((slug) =>
              slug === doc.slug ? null : doc.slug,
            )
          }
          disabled={savingFlagSlug === doc.slug}
          className={[
            "h-5 w-5 rounded border border-gray-700 bg-gray-950",
            "flex items-center justify-center transition-colors hover:border-gray-500",
            savingFlagSlug === doc.slug
              ? "opacity-50 cursor-wait"
              : "cursor-pointer",
          ].join(" ")}
          title={doc.flagColor ? `Flagged ${doc.flagColor}` : "Flag note"}
          aria-label="Flag note"
          aria-expanded={openFlagPaletteSlug === doc.slug}
        >
          <span
            className="h-3 w-3 rounded-sm border border-gray-800"
            style={{ backgroundColor: doc.flagColor || "transparent" }}
          />
        </button>
        {openFlagPaletteSlug === doc.slug && (
          <div className="absolute left-0 top-6 z-20 w-32 rounded-lg border border-gray-800 bg-gray-950 p-2 shadow-xl">
            <div className="grid grid-cols-5 gap-1.5">
              {FLAG_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => {
                    setOpenFlagPaletteSlug(null);
                    handleDocumentFlag(doc.slug, color);
                  }}
                  className={[
                    "h-4 w-4 rounded border transition-transform hover:scale-110",
                    doc.flagColor === color
                      ? "border-white"
                      : "border-gray-800",
                  ].join(" ")}
                  style={{ backgroundColor: color }}
                  aria-label={`Flag ${color}`}
                  title={color}
                />
              ))}
            </div>
            {doc.flagColor && (
              <button
                type="button"
                onClick={() => {
                  setOpenFlagPaletteSlug(null);
                  handleDocumentFlag(doc.slug, "");
                }}
                className="mt-2 w-full rounded border border-gray-800 px-2 py-1 text-[10px] text-gray-500 transition-colors hover:border-gray-700 hover:text-white"
              >
                Clear
              </button>
            )}
          </div>
        )}
      </div>
      <svg
        className="w-3.5 h-3.5 text-gray-600 shrink-0 mt-0.5"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.5}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"
        />
      </svg>
      <div className="flex-1 min-w-0">
        <Link
          href={`/garden/${clusterSlug}?note=${encodeURIComponent(
            doc.relPath ? doc.relPath.replace(/\.md$/i, "") : doc.slug,
          )}`}
          className="block text-xs text-gray-300 hover:text-white truncate transition-colors"
        >
          {doc.title ?? doc.name}
        </Link>
        <p className="text-[10px] text-gray-600 mt-0.5">
          {markdownTypeLabel(doc)} &middot; {doc.wordCount}w
        </p>
      </div>
    </li>
  );

  const renderFolderTree = (node: FolderTreeNode, depth: number) => {
    const isExpanded = expandedFolders.has(node.path);
    const isDropTarget = dragOverFolder === node.path;
    return (
      <li key={`folder:${node.path}`}>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            if (dragOverFolder !== node.path) setDragOverFolder(node.path);
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
              setDragOverFolder((p) => (p === node.path ? null : p));
            }
          }}
          onDrop={(e) => {
            e.preventDefault();
            const slug = e.dataTransfer.getData("text/plain") || draggingSlug;
            if (slug) handleMoveNote(slug, node.path);
          }}
          onClick={() => toggleFolderExpand(node.path)}
          className={[
            "group flex items-center gap-1.5 py-2 pr-2 text-xs cursor-pointer transition-colors",
            isDropTarget
              ? "bg-cyan-950/30 ring-1 ring-inset ring-cyan-400/40"
              : "hover:bg-gray-900",
          ].join(" ")}
          style={{ paddingLeft: `${10 + depth * 14}px` }}
        >
          <svg
            className={`w-3 h-3 shrink-0 text-gray-600 transition-transform ${isExpanded ? "rotate-90" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="m8.25 4.5 7.5 7.5-7.5 7.5"
            />
          </svg>
          <svg
            className="w-3.5 h-3.5 shrink-0 text-amber-300/70"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z"
            />
          </svg>
          <span className="flex-1 min-w-0 truncate text-gray-300 group-hover:text-white">
            {node.name}
          </span>
          <span className="text-[10px] text-gray-600">{countFiles(node)}</span>
          <span
            role="button"
            onClick={(e) => {
              e.stopPropagation();
              handleCreateFolder(node.path);
            }}
            className="p-0.5 rounded text-gray-700 opacity-0 transition hover:bg-gray-800 hover:text-white group-hover:opacity-100"
            aria-label={`New folder inside ${node.name}`}
            title="New subfolder"
          >
            <svg
              className="w-3 h-3"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 4.5v15m7.5-7.5h-15"
              />
            </svg>
          </span>
          <span
            role="button"
            onClick={(e) => {
              e.stopPropagation();
              handleRenameFolder(node.path);
            }}
            className="p-0.5 rounded text-gray-700 opacity-0 transition hover:bg-gray-800 hover:text-white group-hover:opacity-100"
            aria-label={`Rename folder ${node.name}`}
            title="Rename folder"
          >
            <svg
              className="w-3 h-3"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.7}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125"
              />
            </svg>
          </span>
          <span
            role="button"
            onClick={(e) => {
              e.stopPropagation();
              handleDeleteFolder(node.path);
            }}
            className="p-0.5 rounded text-gray-700 opacity-0 transition hover:bg-red-950/40 hover:text-red-300 group-hover:opacity-100"
            aria-label={`Delete folder ${node.name}`}
            title="Delete folder"
          >
            <svg
              className="w-3 h-3"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.7}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166M19.228 5.79 18.16 19.673A2.25 2.25 0 0 1 15.916 21.75H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .563c.34-.059.68-.114 1.022-.166m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
              />
            </svg>
          </span>
        </div>
        {isExpanded &&
          (node.childFolders.length > 0 || node.files.length > 0) && (
            <ul>
              {node.childFolders.map((child) =>
                renderFolderTree(child, depth + 1),
              )}
              {node.files.map((doc) => renderMarkdownFileRow(doc, depth + 1))}
            </ul>
          )}
      </li>
    );
  };

  const renderMarkdownTreeRoot = () => {
    const tree = buildMarkdownTree(markdownDocuments, folders);
    const isRootDrop = dragOverFolder === "";
    return (
      <div
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          if (dragOverFolder !== "") setDragOverFolder("");
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
            setDragOverFolder((p) => (p === "" ? null : p));
          }
        }}
        onDrop={(e) => {
          e.preventDefault();
          const slug = e.dataTransfer.getData("text/plain") || draggingSlug;
          if (slug) handleMoveNote(slug, "");
        }}
        className={
          isRootDrop ? "ring-1 ring-inset ring-cyan-400/40 bg-cyan-950/10" : ""
        }
      >
        <ul className="py-1">
          {tree.childFolders.map((child) => renderFolderTree(child, 0))}
          {tree.files.map((doc) => renderMarkdownFileRow(doc, 0))}
        </ul>
      </div>
    );
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  const renderDocumentLibrary = () => (
    <>
      <div className="border-t border-gray-800 shrink-0">
        <button
          onClick={() => setSourceDocsExpanded((v) => !v)}
          aria-expanded={sourceDocsExpanded}
          aria-controls="garden-source-documents"
          className={`bb-neu-accordion w-full flex items-center justify-between px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider hover:text-white transition-colors ${sourceDocsExpanded ? "bb-neu-accordion-open" : ""}`}
        >
          <div className="flex items-center gap-2">
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"
              />
            </svg>
            Documents
            {sourceDocuments.length > 0
              ? sourceDocSearchTerms.length > 0
                ? ` (${filteredSourceDocuments.length}/${sourceDocuments.length})`
                : ` (${sourceDocuments.length})`
              : ""}
          </div>
          <div className="flex items-center gap-1.5">
            <span
              role="button"
              onClick={(e) => {
                e.stopPropagation();
                openUploadModal();
              }}
              className="p-1 rounded hover:bg-gray-800 text-gray-600 hover:text-white transition-colors"
              aria-label="Add document"
            >
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 4.5v15m7.5-7.5h-15"
                />
              </svg>
            </span>
            <svg
              className={`w-3.5 h-3.5 transition-transform duration-200 ${sourceDocsExpanded ? "" : "rotate-180"}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="m4.5 15.75 7.5-7.5 7.5 7.5"
              />
            </svg>
          </div>
        </button>
        {sourceDocsExpanded && (
          <div
            id="garden-source-documents"
            className="bb-neu-accordion-panel border-t border-gray-800"
          >
            {!loadingDocs && sourceDocuments.length > 0 && (
              <div className="border-b border-gray-800 px-3 py-2">
                <div className="relative">
                  <svg
                    className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-600"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={1.7}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
                    />
                  </svg>
                  <input
                    value={sourceDocSearch}
                    onChange={(e) => setSourceDocSearch(e.target.value)}
                    placeholder="Search PDFs"
                    className="neu-control h-8 w-full rounded-md border border-gray-800 bg-gray-950 pl-8 pr-8 text-xs text-gray-200 outline-none transition-colors placeholder:text-gray-700 focus:border-gray-600"
                    aria-label="Search source PDFs"
                  />
                  {sourceDocSearch && (
                    <button
                      type="button"
                      onClick={() => setSourceDocSearch("")}
                      className="absolute right-1.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-gray-600 transition-colors hover:bg-gray-800 hover:text-white"
                      aria-label="Clear PDF search"
                      title="Clear search"
                    >
                      <svg
                        className="h-3.5 w-3.5"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M6 18 18 6M6 6l12 12"
                        />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
            )}
            <div className="max-h-44 overflow-y-auto">
              {isUploading && (
                <div className="border-b border-gray-800/70 py-1">
                  {uploadFiles.map((file) => {
                    const key = fileKey(file);
                    const status = uploadStatuses[key] ?? "pending";
                    const step = uploadSteps[key];
                    const error = uploadErrors[key];
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={openUploadModal}
                        className="group flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-gray-800/50"
                        aria-label={`View upload progress for ${file.name}`}
                        title="View upload progress"
                      >
                        {status === "done" ? (
                          <svg
                            className="h-4 w-4 shrink-0 text-green-400"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2.5}
                            aria-hidden="true"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="m4.5 12.75 6 6 9-13.5"
                            />
                          </svg>
                        ) : status === "error" ? (
                          <span
                            className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-red-400"
                            aria-hidden="true"
                          >
                            !
                          </span>
                        ) : (
                          <Spinner className="h-4 w-4 shrink-0 text-gray-500" />
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs text-gray-300 group-hover:text-white">
                            {file.name}
                          </span>
                          <span
                            className={`block truncate text-[11px] ${status === "error" ? "text-red-400" : "text-gray-600"}`}
                          >
                            {status === "done"
                              ? "Uploaded"
                              : status === "error"
                                ? error || "Upload failed"
                                : status === "uploading"
                                  ? step || "Uploading…"
                                  : "Waiting to upload…"}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
              {loadingDocs ? (
                <div className="flex justify-center py-6">
                  <Spinner className="w-4 h-4 text-gray-700" />
                </div>
              ) : sourceDocuments.length === 0 ? (
                !isUploading && (
                  <div className="flex flex-col items-center py-6 px-4 text-center">
                    <p className="text-xs text-gray-600 mb-2">
                      No source documents yet
                    </p>
                    <button
                      onClick={openUploadModal}
                      className="text-xs text-gray-500 hover:text-white underline underline-offset-2 transition-colors"
                    >
                      Upload your first
                    </button>
                  </div>
                )
              ) : filteredSourceDocuments.length === 0 ? (
                <div className="flex flex-col items-center px-4 py-6 text-center">
                  <p className="text-xs text-gray-600">
                    No PDFs match {sourceDocSearch.trim()}
                  </p>
                  <button
                    type="button"
                    onClick={() => setSourceDocSearch("")}
                    className="mt-2 text-xs text-gray-500 underline underline-offset-2 transition-colors hover:text-white"
                  >
                    Clear search
                  </button>
                </div>
              ) : (
                renderMarkdownRows(filteredSourceDocuments)
              )}
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-gray-800 shrink-0">
        <button
          onClick={() => setLinksExpanded((v) => !v)}
          className={`bb-neu-accordion w-full flex items-center justify-between px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider hover:text-white transition-colors ${linksExpanded ? "bb-neu-accordion-open" : ""}`}
        >
          <div className="flex items-center gap-2">
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.6}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M13.19 8.688a4.5 4.5 0 0 1 6.364 6.364l-2.121 2.121a4.5 4.5 0 0 1-6.364 0m-.258-1.809a4.5 4.5 0 0 1-6.364-6.364l2.121-2.121a4.5 4.5 0 0 1 6.364 0"
              />
            </svg>
            Links
            {savedLinks.length > 0 ? ` (${savedLinks.length})` : ""}
          </div>
          <div className="flex items-center gap-1.5">
            <svg
              className={`w-3.5 h-3.5 transition-transform duration-200 ${linksExpanded ? "" : "rotate-180"}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="m4.5 15.75 7.5-7.5 7.5 7.5"
              />
            </svg>
          </div>
        </button>
        {linksExpanded && (
          <div className="bb-neu-accordion-panel border-t border-gray-800">
            {isOwner && (
              <form
                onSubmit={handleSaveLink}
                className="space-y-2 border-b border-gray-800 px-3 py-3"
              >
                <input
                  type="text"
                  value={newLinkTitle}
                  onChange={(e) => setNewLinkTitle(e.target.value)}
                  placeholder="Link name"
                  className="neu-control h-8 w-full rounded-md border border-gray-800 bg-gray-950 px-2.5 text-xs text-gray-200 outline-none transition-colors placeholder:text-gray-700 focus:border-gray-600"
                  aria-label="Link name"
                />
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newLinkUrl}
                    onChange={(e) => setNewLinkUrl(e.target.value)}
                    placeholder="https://..."
                    className="neu-control h-8 min-w-0 flex-1 rounded-md border border-gray-800 bg-gray-950 px-2.5 text-xs text-gray-200 outline-none transition-colors placeholder:text-gray-700 focus:border-gray-600"
                    aria-label="Link URL"
                  />
                  <button
                    type="submit"
                    disabled={!newLinkUrl.trim() || savingLink}
                    className="neu-button-icon flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-gray-800 text-gray-500 transition-colors hover:border-gray-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                    aria-label="Save link"
                    title="Save link"
                  >
                    {savingLink ? (
                      <Spinner className="h-3.5 w-3.5" />
                    ) : (
                      <svg
                        className="h-3.5 w-3.5"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M12 4.5v15m7.5-7.5h-15"
                        />
                      </svg>
                    )}
                  </button>
                </div>
                {savingLink ? (
                  <p className="text-[11px] text-gray-600">
                    Converting link to Markdown...
                  </p>
                ) : null}
              </form>
            )}
            <div className="max-h-56 overflow-y-auto">
              {linksLoading ? (
                <div className="flex justify-center py-6">
                  <Spinner className="w-4 h-4 text-gray-700" />
                </div>
              ) : savedLinks.length === 0 ? (
                <div className="px-4 py-6 text-center">
                  <p className="text-xs text-gray-600">No saved links yet.</p>
                </div>
              ) : (
                <ul className="divide-y divide-gray-800/70">
                  {savedLinks.map((link) => (
                    <li
                      key={link.id}
                      className="group flex items-center gap-2 px-3 py-2"
                    >
                      <a
                        href={link.url}
                        target="_blank"
                        rel="noreferrer"
                        className="min-w-0 flex-1 text-left"
                        title={link.url}
                      >
                        <span className="block truncate text-xs font-medium text-gray-300 transition-colors group-hover:text-white">
                          {link.title}
                        </span>
                        <span className="block truncate text-[11px] text-gray-600">
                          {link.url}
                        </span>
                      </a>
                      <button
                        type="button"
                        onClick={() => handleCopyLink(link.url)}
                        className="shrink-0 rounded p-1 text-gray-600 transition-colors hover:bg-gray-800 hover:text-white"
                        aria-label="Copy link"
                        title="Copy link"
                      >
                        <svg
                          className="h-3.5 w-3.5"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={1.8}
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125v-9.75c0-.621.504-1.125 1.125-1.125H8.25m2.25-6.75h8.625c.621 0 1.125.504 1.125 1.125v8.625c0 .621-.504 1.125-1.125 1.125H10.5a1.125 1.125 0 0 1-1.125-1.125V4.125c0-.621.504-1.125 1.125-1.125Z"
                          />
                        </svg>
                      </button>
                      {isOwner && (
                        <button
                          type="button"
                          onClick={() => handleDeleteLink(link.id)}
                          disabled={deletingLinkId === link.id}
                          className="shrink-0 rounded p-1 text-gray-600 transition-colors hover:bg-red-950/30 hover:text-red-400 disabled:opacity-40"
                          aria-label="Delete link"
                          title="Delete link"
                        >
                          {deletingLinkId === link.id ? (
                            <Spinner className="h-3.5 w-3.5" />
                          ) : (
                            <svg
                              className="h-3.5 w-3.5"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                              strokeWidth={2}
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M6 18 18 6M6 6l12 12"
                              />
                            </svg>
                          )}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-gray-800 shrink-0">
        <button
          type="button"
          onClick={() => setVideosExpanded((value) => !value)}
          className={`bb-neu-accordion w-full flex items-center justify-between px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider hover:text-white transition-colors ${videosExpanded ? "bb-neu-accordion-open" : ""}`}
          aria-expanded={videosExpanded}
          aria-controls="garden-videos-panel"
        >
          <div className="flex items-center gap-2">
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.6}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 6.75h9A2.25 2.25 0 0 1 15.75 9v6A2.25 2.25 0 0 1 13.5 17.25h-9A2.25 2.25 0 0 1 2.25 15V9A2.25 2.25 0 0 1 4.5 6.75Z"
              />
            </svg>
            Videos
          </div>
          <svg
            className={`w-3.5 h-3.5 transition-transform duration-200 ${videosExpanded ? "" : "rotate-180"}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="m4.5 15.75 7.5-7.5 7.5 7.5"
            />
          </svg>
        </button>
        {videosExpanded && (
          <GardenVideoImport
            clusterSlug={clusterSlug}
            isOwner={isOwner}
            onSourceCreated={handleVideoSourceCreated}
          />
        )}
      </div>

      <div className="border-t border-gray-800 shrink-0">
        <button
          type="button"
          onClick={() => setArtifactsExpanded((value) => !value)}
          className={`bb-neu-accordion w-full flex items-center justify-between px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider hover:text-white transition-colors ${artifactsExpanded ? "bb-neu-accordion-open" : ""}`}
          aria-expanded={artifactsExpanded}
          aria-controls="garden-artifacts-panel"
        >
          <div className="flex items-center gap-2">
            <ArtifactArchiveIcon className="h-3.5 w-3.5 shrink-0" />
            Artifacts
          </div>
          <svg className={`w-3.5 h-3.5 transition-transform duration-200 ${artifactsExpanded ? "" : "rotate-180"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 15.75 7.5-7.5 7.5 7.5" />
          </svg>
        </button>
        {artifactsExpanded ? (
          <div id="garden-artifacts-panel" className="bb-neu-accordion-panel h-[min(58vh,620px)] border-t border-gray-800">
            <ArtifactPanel compact hideHeader gardenSlug={clusterSlug} sourceSurface="garden_chat" />
          </div>
        ) : null}
      </div>
    </>
  );

  return (
    <div className="h-screen bg-gray-950 text-white flex flex-col overflow-hidden">
      {/* Header */}
      <header
        className="bb-neu-toolbar breadboard-flower-navbar neu-surface-subtle relative flex items-center justify-between px-6 py-3.5 border-b border-gray-800 shrink-0"
      >
        <NavbarFlowerWind />
        <div className="relative z-10 flex items-center gap-3">
          {/* Garden chat is the top of its own surface: always leave to the
              dashboard. Routing it through the nav trail made it and the Quartz
              garden each other's back target, which is a loop with no exit. */}
          <Link
            href="/dashboard"
            className="text-gray-500 hover:text-white transition-colors text-sm flex items-center gap-1.5"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18"
              />
            </svg>
            Back to dashboard
          </Link>
          <span className="text-gray-700">/</span>
          <Link
            href={primarySourceDocument
              ? gardenDocumentHref(clusterSlug, primarySourceDocument)
              : `/garden/${clusterSlug}`}
            className="text-sm font-semibold text-white truncate max-w-xs hover:text-cyan-100 transition-colors"
            title={
              primarySourceDocument
                ? `Open full source note: ${primarySourceDocument.title}`
                : "Open garden"
            }
          >
            {clusterName}
          </Link>
        </div>

        <div className="relative z-10 flex items-center gap-2">
          {canForkCluster && (
            <button
              type="button"
              onClick={handleForkCluster}
              disabled={isForking}
              className="neu-button flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-300 border border-gray-700 rounded-lg hover:border-gray-500 hover:text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isForking ? (
                <>
                  <Spinner className="w-3.5 h-3.5" />
                  Forking...
                </>
              ) : (
                <>
                  <svg
                    className="w-3.5 h-3.5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={1.5}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M8.25 7.5V6A2.25 2.25 0 0 1 10.5 3.75h7.5A2.25 2.25 0 0 1 20.25 6v7.5A2.25 2.25 0 0 1 18 15.75h-1.5M5.25 8.25h7.5A2.25 2.25 0 0 1 15 10.5v7.5a2.25 2.25 0 0 1-2.25 2.25h-7.5A2.25 2.25 0 0 1 3 18v-7.5a2.25 2.25 0 0 1 2.25-2.25Z"
                    />
                  </svg>
                  Fork garden
                </>
              )}
            </button>
          )}
          {isOwner && (
            <button
              type="button"
              onClick={() => setLearnPanelOpen((open) => !open)}
              disabled={!learnState?.hasSources}
              title={
                learnState?.hasSources
                  ? learnPanelOpen
                    ? "Close Learn panel"
                    : learnBusy ||
                        learnCancelBusy ||
                        isLearnActive(learnState?.job?.status)
                      ? "Learn is running. Open Learn panel"
                      : "Open Learn panel"
                  : "Upload sources before learning"
              }
              className="neu-button-primary flex items-center gap-1.5 px-3 py-1.5 text-sm bg-white text-gray-950 font-medium rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {learnBusy ||
              learnCancelBusy ||
              isLearnActive(learnState?.job?.status) ? (
                <Spinner className="h-3.5 w-3.5" />
              ) : (
                <svg
                  className="w-3.5 h-3.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.8}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 6.75v10.5m0-10.5c-1.5-1-3.5-1.5-6-1.5v10.5c2.5 0 4.5.5 6 1.5m0-10.5c1.5-1 3.5-1.5 6-1.5v10.5c-2.5 0-4.5.5-6 1.5"
                  />
                </svg>
              )}
              {learnPanelOpen ? "Close Learn panel" : "Open Learn panel"}
            </button>
          )}
          <button
            onClick={handleGenerateNotes}
            disabled={messages.length === 0 || isGenerating}
            title="Save the latest assistant response as a lesson page"
            className="neu-button flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-300 border border-gray-700 rounded-lg hover:border-gray-500 hover:text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isGenerating ? (
              <>
                <Spinner className="w-3.5 h-3.5" />
                Saving...
              </>
            ) : (
              <>
                <svg
                  className="w-3.5 h-3.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z"
                  />
                </svg>
                Save page
              </>
            )}
          </button>
        </div>
      </header>

      {/* Body */}
      <div className="flex flex-1 min-h-0">
        {/* Left sidebar: chat sessions */}
        {leftSidebarOpen ? (
          <aside
            style={{ width: leftSidebarWidth }}
            className="bb-neu-sidebar-left neu-surface-subtle relative shrink-0 border-r border-gray-800 flex flex-col bg-gray-950"
          >
            {leftSidebarResizeHandle}
            {/* New chat */}
            <div className="px-3 pt-3 pb-2 shrink-0 flex items-center gap-2">
              <button
                onClick={handleNewChat}
                disabled={loadingChats}
                className="neu-button flex-1 min-w-0 flex items-center gap-2 px-3 py-2.5 text-sm text-gray-300 rounded-lg border border-gray-800 hover:bg-gray-900 hover:text-white hover:border-gray-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <svg
                  className="w-4 h-4 shrink-0"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 4.5v15m7.5-7.5h-15"
                  />
                </svg>
                New chat
              </button>
            </div>

            {/* Chat sessions list */}
            <div className="flex-1 overflow-y-auto px-2 py-1 min-h-0">
              {loadingChats ? (
                <div className="flex justify-center py-8">
                  <Spinner className="w-4 h-4 text-gray-700" />
                </div>
              ) : (
                <>
                  <div className="mb-1.5 mt-1 flex items-center justify-between gap-2 px-2">
                    <p className="text-[10px] uppercase tracking-wider text-gray-600">
                      Recents
                    </p>
                    {canViewPublicChats && (
                      <button
                        type="button"
                        onClick={() => setViewPublicChats((value) => !value)}
                        className={[
                          "text-[10px] transition-colors",
                          viewPublicChats
                            ? "text-[#7b97aa] hover:text-white"
                            : "text-gray-600 hover:text-gray-300",
                        ].join(" ")}
                        aria-pressed={viewPublicChats}
                      >
                        View public chats {viewPublicChats ? "on" : "off"}
                      </button>
                    )}
                  </div>
                  {chatSessions.length === 0 ? (
                    <p className="text-xs text-gray-600 text-center py-8">
                      {viewPublicChats ? "No public chats yet" : "No chats yet"}
                    </p>
                  ) : (
                    <ul className="space-y-0.5">
                      {chatSessions.map((session) => {
                        const canDeleteSession =
                          session.isOwn !== false || isOwner;
                        const canRenameSession = session.isOwn !== false;
                        const isEditingChat = editingChatId === session.id;
                        return (
                          <li key={session.id} className="relative group">
                            {isEditingChat ? (
                              <div
                                className={[
                                  "neu-inset flex items-center gap-1 rounded-lg px-2 py-1.5",
                                  session.id === activeChatId
                                    ? "bg-gray-800"
                                    : "bg-gray-900",
                                ].join(" ")}
                              >
                                <input
                                  value={editingChatTitle}
                                  onChange={(e) =>
                                    setEditingChatTitle(e.target.value)
                                  }
                                  onBlur={() => commitChatRename(session.id)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                      e.preventDefault();
                                      commitChatRename(session.id);
                                    } else if (e.key === "Escape") {
                                      e.preventDefault();
                                      cancelRenameChat();
                                    }
                                  }}
                                  autoFocus
                                  maxLength={200}
                                  aria-label={`Rename ${session.title}`}
                                  className="neu-control min-w-0 flex-1 rounded-md border border-gray-700 bg-gray-950 px-2 py-1 text-xs text-white outline-none focus:border-gray-500 disabled:opacity-50"
                                />
                              </div>
                            ) : (
                              <button
                                onClick={() => {
                                  pendingNewChatRef.current = false;
                                  setActiveChatId(session.id);
                                }}
                                onDoubleClick={() => startRenameChat(session)}
                                className={[
                                  "bb-neu-conversation-row w-full text-left px-3 py-2 pr-14 text-sm rounded-lg transition-colors flex items-center gap-2",
                                  session.id === activeChatId
                                    ? "bb-neu-conversation-row-selected bg-gray-800 text-white"
                                    : "text-gray-400 hover:bg-gray-900 hover:text-white",
                                ].join(" ")}
                              >
                                <div className="flex-1 min-w-0">
                                  <span className="block truncate">
                                    {session.title}
                                  </span>
                                  {(viewPublicChats || isOwner) &&
                                    session.ownerUsername && (
                                      <span className="block truncate text-[10px] text-gray-600 mt-0.5">
                                        {session.ownerUsername}
                                      </span>
                                    )}
                                </div>
                              </button>
                            )}
                            {canDeleteSession &&
                            confirmDeleteChatId === session.id ? (
                              <div className="neu-popover absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-1.5 rounded-lg border border-gray-700 bg-gray-900 px-2 py-1 shadow-lg">
                                <span className="text-[10px] text-gray-400">
                                  Delete?
                                </span>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDeleteChat(session.id);
                                  }}
                                  className="text-[10px] font-medium text-red-500 transition-colors hover:text-red-400 disabled:opacity-40"
                                >
                                  Yes
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setConfirmDeleteChatId(null);
                                  }}
                                  className="text-[10px] text-gray-500 transition-colors hover:text-white"
                                >
                                  No
                                </button>
                              </div>
                            ) : !isEditingChat &&
                              (canRenameSession || canDeleteSession) ? (
                              <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                                {canRenameSession && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      startRenameChat(session);
                                    }}
                                    className="shrink-0 p-0.5 text-gray-600 transition-colors hover:text-white"
                                    aria-label="Rename chat"
                                    title="Rename chat"
                                  >
                                    <svg
                                      className="w-3.5 h-3.5"
                                      fill="none"
                                      viewBox="0 0 24 24"
                                      stroke="currentColor"
                                      strokeWidth={1.8}
                                    >
                                      <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.862 4.487Z"
                                      />
                                    </svg>
                                  </button>
                                )}
                                {canDeleteSession && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setConfirmDeleteChatId(session.id);
                                    }}
                                    disabled={streamingChatIds.has(session.id)}
                                    className="shrink-0 p-0.5 text-gray-600 transition-colors hover:text-red-400 disabled:hidden"
                                    aria-label="Delete chat"
                                    title="Delete chat"
                                  >
                                    <svg
                                      className="w-3.5 h-3.5"
                                      fill="none"
                                      viewBox="0 0 24 24"
                                      stroke="currentColor"
                                      strokeWidth={2}
                                    >
                                      <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        d="M6 18 18 6M6 6l12 12"
                                      />
                                    </svg>
                                  </button>
                                )}
                              </div>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </>
              )}
            </div>

            {/* Sources — collapsible at bottom */}
            <div className="hidden">
              <button
                onClick={() => setSourceDocsExpanded((v) => !v)}
                className="w-full flex items-center justify-between px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider hover:text-white transition-colors"
              >
                <div className="flex items-center gap-2">
                  <svg
                    className="w-3.5 h-3.5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={1.5}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"
                    />
                  </svg>
                  Documents
                  {sourceDocuments.length > 0
                    ? sourceDocSearchTerms.length > 0
                      ? ` (${filteredSourceDocuments.length}/${sourceDocuments.length})`
                      : ` (${sourceDocuments.length})`
                    : ""}
                </div>
                <div className="flex items-center gap-1.5">
                  <span
                    role="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      openUploadModal();
                    }}
                    className="p-1 rounded hover:bg-gray-800 text-gray-600 hover:text-white transition-colors"
                    aria-label="Add document"
                  >
                    <svg
                      className="w-3.5 h-3.5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M12 4.5v15m7.5-7.5h-15"
                      />
                    </svg>
                  </span>
                  <svg
                    className={`w-3.5 h-3.5 transition-transform duration-200 ${sourceDocsExpanded ? "" : "rotate-180"}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="m4.5 15.75 7.5-7.5 7.5 7.5"
                    />
                  </svg>
                </div>
              </button>
              {sourceDocsExpanded && (
                <div className="border-t border-gray-800">
                  {!loadingDocs && sourceDocuments.length > 0 && (
                    <div className="border-b border-gray-800 px-3 py-2">
                      <div className="relative">
                        <svg
                          className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-600"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={1.7}
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
                          />
                        </svg>
                        <input
                          value={sourceDocSearch}
                          onChange={(e) => setSourceDocSearch(e.target.value)}
                          placeholder="Search PDFs"
                          className="h-8 w-full rounded-md border border-gray-800 bg-gray-950 pl-8 pr-8 text-xs text-gray-200 outline-none transition-colors placeholder:text-gray-700 focus:border-gray-600"
                          aria-label="Search source PDFs"
                        />
                        {sourceDocSearch && (
                          <button
                            type="button"
                            onClick={() => setSourceDocSearch("")}
                            className="absolute right-1.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-gray-600 transition-colors hover:bg-gray-800 hover:text-white"
                            aria-label="Clear PDF search"
                            title="Clear search"
                          >
                            <svg
                              className="h-3.5 w-3.5"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                              strokeWidth={2}
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M6 18 18 6M6 6l12 12"
                              />
                            </svg>
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                  <div className="max-h-44 overflow-y-auto">
                    {loadingDocs ? (
                      <div className="flex justify-center py-6">
                        <Spinner className="w-4 h-4 text-gray-700" />
                      </div>
                    ) : sourceDocuments.length === 0 ? (
                      <div className="flex flex-col items-center py-6 px-4 text-center">
                        <p className="text-xs text-gray-600 mb-2">
                          No source documents yet
                        </p>
                        <button
                          onClick={openUploadModal}
                          className="text-xs text-gray-500 hover:text-white underline underline-offset-2 transition-colors"
                        >
                          Upload your first
                        </button>
                      </div>
                    ) : filteredSourceDocuments.length === 0 ? (
                      <div className="flex flex-col items-center px-4 py-6 text-center">
                        <p className="text-xs text-gray-600">
                          No PDFs match {sourceDocSearch.trim()}
                        </p>
                        <button
                          type="button"
                          onClick={() => setSourceDocSearch("")}
                          className="mt-2 text-xs text-gray-500 underline underline-offset-2 transition-colors hover:text-white"
                        >
                          Clear search
                        </button>
                      </div>
                    ) : (
                      renderMarkdownRows(filteredSourceDocuments)
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="hidden">
              <button
                onClick={() => setDocsExpanded((v) => !v)}
                className="w-full flex items-center justify-between px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider hover:text-white transition-colors"
              >
                <div className="flex items-center gap-2">
                  <svg
                    className="w-3.5 h-3.5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={1.5}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"
                    />
                  </svg>
                  Lessons
                  {markdownDocuments.length > 0
                    ? ` (${markdownDocuments.length})`
                    : ""}
                </div>
                <div className="flex items-center gap-1.5">
                  <span
                    role="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!creatingFolder) handleCreateFolder("");
                    }}
                    className="p-1 rounded hover:bg-gray-800 text-gray-600 hover:text-white transition-colors"
                    aria-label="New folder"
                    title="New folder"
                  >
                    <svg
                      className="w-3.5 h-3.5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={1.6}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M12 10.5v6m3-3h-6M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 0 0-1.883 2.542l.857 6a2.25 2.25 0 0 0 2.227 1.932H19.05a2.25 2.25 0 0 0 2.227-1.932l.857-6a2.25 2.25 0 0 0-1.883-2.542m-16.5 0V6A2.25 2.25 0 0 1 6 3.75h3.879a1.5 1.5 0 0 1 1.06.44l2.122 2.12a1.5 1.5 0 0 0 1.061.44H18A2.25 2.25 0 0 1 20.25 9v.776"
                      />
                    </svg>
                  </span>
                  <span
                    role="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      openNewNoteModal();
                    }}
                    className="p-1 rounded hover:bg-gray-800 text-gray-600 hover:text-white transition-colors"
                    aria-label="New page"
                    title="New page"
                  >
                    <svg
                      className="w-3.5 h-3.5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M12 4.5v15m7.5-7.5h-15"
                      />
                    </svg>
                  </span>
                  <svg
                    className={`w-3.5 h-3.5 transition-transform duration-200 ${docsExpanded ? "" : "rotate-180"}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="m4.5 15.75 7.5-7.5 7.5 7.5"
                    />
                  </svg>
                </div>
              </button>
              {docsExpanded && (
                <div className="max-h-56 overflow-y-auto border-t border-gray-800">
                  {loadingDocs ? (
                    <div className="flex justify-center py-6">
                      <Spinner className="w-4 h-4 text-gray-700" />
                    </div>
                  ) : markdownDocuments.length === 0 && folders.length === 0 ? (
                    <div className="flex flex-col items-center py-6 px-4 text-center">
                      <p className="text-xs text-gray-600 mb-2">
                        No lesson pages yet
                      </p>
                      <button
                        onClick={openUploadModal}
                        className="text-xs text-gray-500 hover:text-white underline underline-offset-2 transition-colors"
                      >
                        Upload your first
                      </button>
                    </div>
                  ) : (
                    renderMarkdownTreeRoot()
                  )}
                </div>
              )}
            </div>
          </aside>
        ) : (
          <aside
            style={{ width: leftSidebarWidth }}
            className="bb-neu-sidebar-left relative shrink-0 border-r border-gray-800 flex flex-col items-center bg-gray-950 py-3"
          >
            {leftSidebarResizeHandle}
            <button
              onClick={handleNewChat}
              disabled={loadingChats}
              title="New chat"
              className="neu-button-icon flex h-9 w-9 items-center justify-center rounded-lg text-gray-600 hover:bg-gray-900 hover:text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              aria-label="New chat"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 4.5v15m7.5-7.5h-15"
                />
              </svg>
            </button>
          </aside>
        )}

        {/* Chat area — warm paper surface so the green sidebars read as a frame */}
        {/* min-w-0: without it the column keeps its ~1056px min-content width and
            a widened map panel is pushed off-screen (clipped by the root overflow). */}
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-gray-900">
          {renderLearnPanel()}
          {/* Positioning context for the jump control, so it floats at the foot
              of the transcript rather than below the composer. */}
          <div className="relative flex min-h-0 flex-1 flex-col">
            <main ref={transcriptScrollRef} className="flex-1 overflow-y-auto px-4 py-6">
            <ChatTranscript
              clusterName={clusterName}
              clusterSlug={clusterSlug}
              chatSessionId={activeChatId}
              isStreaming={
                isStreaming || agentLaunchQueue.queued || delegatedAgentLaunching
              }
              loadingChats={loadingChats}
              messages={messages}
              activities={agentActivity.activities}
              connection={agentActivity.connection}
              pendingPermission={agentActivity.pendingPermission}
              onPermissionDecision={(decision) =>
                void agentActivity.respondToPermission(decision)
              }
              onEditMessage={handleEditUserMessage}
              onRetryAssistant={handleRetryAssistant}
              onExternalAgentTerminal={handleExternalAgentTerminal}
              inlineArtifactRetireVersion={inlineArtifactRetireVersion}
            />
            </main>
            <ChatJumpToBottom
              visible={transcriptAwayFromBottom}
              busy={
                isStreaming || agentLaunchQueue.queued || delegatedAgentLaunching
              }
              onJump={jumpToNewestMessage}
            />
          </div>

          {/* Input area */}
          <div className="shrink-0 px-4 py-4">
            {/* A runtime agent the assistant chose, waiting to be started. */}
            {agentLaunchQueue.pending ? (
              <div className="mx-auto mb-2 w-full max-w-5xl">
                <AgentLaunchPrompt
                  request={agentLaunchQueue.pending}
                  waiting={agentLaunchQueue.waiting}
                  onConfirm={agentLaunchQueue.confirm}
                  onDismiss={agentLaunchQueue.dismiss}
                />
              </div>
            ) : null}
            {/* Chat attachment preview strip */}
            {selectedChatDocuments.length > 0 && (
              <div className="mx-auto mb-2 flex max-w-5xl flex-wrap items-center gap-1.5">
                <span className="text-[10px] uppercase tracking-wider text-gray-600">
                  Chat focus
                </span>
                {selectedChatDocuments.map((doc) => (
                  <span
                    key={doc.slug}
                    className="flex max-w-[220px] items-center gap-1.5 rounded-lg border border-cyan-900/60 bg-cyan-950/20 px-2.5 py-1 text-xs text-cyan-100"
                  >
                    <span className="truncate">{doc.title ?? doc.name}</span>
                    <button
                      type="button"
                      onClick={() => toggleSelectedDocument(doc.slug)}
                      className="shrink-0 text-cyan-600 transition-colors hover:text-white"
                      aria-label="Remove document from chat focus"
                    >
                      <svg
                        className="h-3 w-3"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M6 18 18 6M6 6l12 12"
                        />
                      </svg>
                    </button>
                  </span>
                ))}
              </div>
            )}

            {/* The chat picker offers what a chat accepts — including 3D
                files — not what the Garden's document ingest accepts. */}
            <input
              ref={chatFileInputRef}
              type="file"
              accept={CHAT_ATTACHMENT_ACCEPT}
              multiple
              onChange={handleChatFileInput}
              className="hidden"
            />

            <AssistantComposer
              capabilitySurface="garden_chat"
              capabilityGardenSlug={clusterSlug}
              className="mx-auto w-full max-w-5xl"
              value={input}
              onChange={setInput}
              onSubmit={handleSubmit}
              onRunWorkflow={runWorkflowAutomation}
              onPaste={handleChatPaste}
              textareaRef={textareaRef}
              placeholder="Ask about your documents…"
              disabled={loadingChats}
              isSending={isStreaming || launchingExternalAgent !== null}
              externalRunActive={
                hasRunningExternalAgentInActiveChat ||
                agentLaunchQueue.queued ||
                delegatedAgentLaunching ||
                launchingExternalAgent !== null
              }
              canSubmit={Boolean(input.trim() || chatAttachments.length > 0)}
              model={model}
              models={models}
              modelsLoading={modelsLoading}
              onLoadModels={() => void loadModels()}
              onModelChange={setModel}
              reasoningEffort={reasoningEffort}
              onReasoningEffortChange={setReasoningEffort}
          intelligenceModes={intelligenceModes}
          modelFailover={modelFailover}
              onAddDocuments={() => chatFileInputRef.current?.click()}
              isAddingDocuments={extractingAttachments}
              attachments={chatAttachments}
              onRemoveAttachment={removeChatAttachment}
              voiceMessages={messages}
              runState={
                !isStreaming
                  ? "idle"
                  : agentActivity.connection === "waiting"
                    ? "waiting_for_permission"
                    : agentActivity.connection === "connecting"
                      ? "connecting"
                      : "running"
              }
              onQueueSteer={handleSteerActiveResponse}
              onStop={agentActivity.abort}
              permissionPending={Boolean(agentActivity.pendingPermission)}
              // Distilling a book blocks the composer for minutes, so what it
              // is doing takes the status line while it runs.
              statusMessage={attachmentDistillStatus ?? externalAgentStatus}
              agentBrowserAgent={agentBrowserAgent}
              onSelectAgentBrowser={() => void selectAgentBrowser()}
              onClearAgentBrowser={() => {
                setAgentBrowserAgent(null);
                setExternalAgentStatus("");
              }}
              deepResearchAgent={deepResearchAgent}
              onSelectDeepResearch={() => void selectDeepResearch()}
              onClearDeepResearch={() => {
                setDeepResearchAgent(null);
                setExternalAgentStatus("");
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
                setExternalAgentStatus("");
              }}
              agentReachAgent={agentReachAgent}
              onSelectAgentReach={() => void selectAgentReach()}
              onClearAgentReach={() => {
                setAgentReachAgent(null);
                setExternalAgentStatus("");
              }}
              getDocAgent={getDocAgent}
              onSelectGetDoc={() => void selectGetDoc()}
              onClearGetDoc={() => {
                setGetDocAgent(null);
      setMeetingNotesAgent(null);
                setExternalAgentStatus("");
              }}
              deepTutorAgent={deepTutorAgent}
              onSelectDeepTutor={() => void selectDeepTutor()}
              onClearDeepTutor={() => {
                setDeepTutorAgent(null);
                setExternalAgentStatus("");
              }}
              careerOpsAgent={careerOpsAgent}
              onSelectCareerOps={() => void selectCareerOps()}
              onClearCareerOps={() => {
                setCareerOpsAgent(null);
                setExternalAgentStatus("");
              }}
              vibeTradingAgent={vibeTradingAgent}
              onSelectVibeTrading={() => void selectVibeTrading()}
              onClearVibeTrading={() => {
                setVibeTradingAgent(null);
                setExternalAgentStatus("");
              }}
              stockAnalystAgent={stockAnalystAgent}
              onSelectStockAnalyst={() => void selectStockAnalyst()}
              onClearStockAnalyst={() => {
                setStockAnalystAgent(null);
                setExternalAgentStatus("");
              }}
              paperTraderAgent={paperTraderAgent}
              onClearPaperTrader={() => {
                setPaperTraderAgent(null);
                setExternalAgentStatus("");
              }}
              deerFlowAgent={deerFlowAgent}
              onSelectDeerFlow={() => void selectDeerFlow()}
              onClearDeerFlow={() => {
                setDeerFlowAgent(null);
                setExternalAgentStatus("");
              }}
              tradingAgentsAgent={tradingAgentsAgent}
              tradingAgentsSeed={tradingAgentsSeed}
              onSelectTradingAgents={() => void selectTradingAgents()}
              onClearTradingAgents={() => {
                setTradingAgentsAgent(null);
                setVibeTradingAgent(null);
                setDeerFlowAgent(null);
                setTradingAgentsSeed(null);
                setExternalAgentStatus("");
              }}
              onSubmitTradingAgents={(request) => void launchTradingAgents(request)}
              shortsAgent={shortsAgent}
              shortsSeed={shortsSeed}
              onSelectShorts={() => void selectShorts()}
              onClearShorts={() => {
                setShortsAgent(null);
                setShortsSeed(null);
                setExternalAgentStatus("");
              }}
              onSubmitShorts={(request) => void launchShorts(request)}
              formsmithAgent={formsmithAgent}
              onSelectFormsmith={() => void selectFormsmith()}
              onClearFormsmith={() => {
                setFormsmithAgent(null);
                setExternalAgentStatus("");
              }}
              onSubmitFormsmith={(request) => void launchFormsmith(request)}
              openCodeAgent={openCodeAgent}
              onSelectOpenCode={() => void selectOpenCode()}
              onClearOpenCode={() => {
                setOpenCodeAgent(null);
                setExternalAgentStatus("");
              }}
              codexAgent={codexAgent}
              onSelectCodex={() => void selectCodex()}
              onClearCodex={() => {
                setCodexAgent(null);
                setExternalAgentStatus("");
              }}
              rufloAgent={rufloAgent}
              onSelectRuflo={() => void selectRuflo()}
              onClearRuflo={() => {
                setRufloAgent(null);
                setExternalAgentStatus("");
              }}
            />
          </div>
        </div>

        <KnowledgeGraph
          clusterSlug={clusterSlug}
          refreshKey={graphRefreshKey}
          sourceLibrary={renderDocumentLibrary()}
          showInternalConceptGraph={showInternalConceptGraph}
          savedLinkCount={savedLinks.length}
        />
      </div>

      {/* ── New markdown note modal ─────────────────────────────────────────── */}
      {showNewNote && (
        <div
          className="bb-modal-backdrop fixed inset-0 z-40 flex items-center justify-center p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowNewNote(false);
          }}
        >
          <div
            className="absolute inset-0"
            onClick={() => setShowNewNote(false)}
          />
          <form
            onSubmit={handleSaveNewNote}
            className="bb-modal-panel neu-dialog relative flex h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border"
          >
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-800 shrink-0">
              <div>
                <p className="text-[11px] uppercase tracking-wider text-gray-500">
                  Lessons
                </p>
                <h2 className="text-base font-semibold text-white">New page</h2>
              </div>
              <button
                type="button"
                onClick={() => setShowNewNote(false)}
                className="neu-button-icon rounded-full p-1.5 text-gray-500"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M6 18 18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-3 px-5 py-4 border-b border-gray-800 shrink-0">
              <label className="flex flex-col gap-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                  Title
                </span>
                <input
                  type="text"
                  value={newNoteTitle}
                  onChange={(e) => setNewNoteTitle(e.target.value)}
                  placeholder="Note title"
                  autoFocus
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-gray-600 transition-colors"
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                  Tags
                </span>
                <input
                  type="text"
                  value={newNoteTags}
                  onChange={(e) => setNewNoteTags(e.target.value)}
                  placeholder="comma, separated, tags"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-gray-600 transition-colors"
                />
              </label>
              <label className="flex flex-col gap-1.5 sm:min-w-40">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                  Folder
                </span>
                <select
                  value={newNoteFolder}
                  onChange={(e) => setNewNoteFolder(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-gray-600 transition-colors"
                >
                  <option value="">Garden root</option>
                  {folders.map((folder) => (
                    <option key={folder} value={folder}>
                      {folder}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="flex-1 min-h-0 px-5 py-4">
              <textarea
                value={newNoteContent}
                onChange={(e) => setNewNoteContent(e.target.value)}
                placeholder="Write your markdown here…"
                className="w-full h-full resize-none bg-gray-950/60 border border-gray-800 rounded-lg px-4 py-3 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-gray-700 transition-colors font-mono leading-relaxed"
              />
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-800 shrink-0">
              <button
                type="button"
                onClick={() => setShowNewNote(false)}
                className="neu-button px-4 py-1.5 text-sm"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!newNoteTitle.trim() || isSavingNote}
                className="neu-button-primary flex items-center gap-1.5 px-4 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-40"
              >
                {isSavingNote ? "Saving…" : "Save note"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── Prompts panel ───────────────────────────────────────────────────── */}
      {showPrompts && (
        <div
          className="bb-modal-backdrop fixed inset-0 z-40 flex items-end justify-center p-0 sm:items-center sm:p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowPrompts(false);
          }}
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0"
            onClick={() => setShowPrompts(false)}
          />

          <div className="bb-modal-panel neu-dialog relative flex max-h-[80vh] w-full flex-col overflow-hidden rounded-t-2xl border sm:max-w-2xl sm:rounded-2xl">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3.5 border-b border-gray-800 shrink-0">
              <div className="flex items-center gap-2.5">
                <svg
                  className="w-4 h-4 text-amber-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 0 1 0 3.75H5.625a1.875 1.875 0 0 1 0-3.75Z"
                  />
                </svg>
                <h2 className="text-sm font-semibold text-white">
                  Prompt library
                </h2>
                <span className="text-xs text-gray-600">
                  {filteredPrompts.length} prompts
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={openNewPrompt}
                  className="neu-button-primary flex items-center gap-1.5 px-3 py-1.5 text-xs"
                >
                  <svg
                    className="w-3.5 h-3.5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M12 4.5v15m7.5-7.5h-15"
                    />
                  </svg>
                  New prompt
                </button>
                <button
                  onClick={() => setShowPrompts(false)}
                  className="neu-button-icon rounded-full p-1.5 text-gray-500"
                >
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M6 18 18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </div>
            </div>

            {/* Search + category filter */}
            <div className="px-4 py-2.5 border-b border-gray-800 shrink-0 space-y-2">
              <div className="relative">
                <svg
                  className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-600"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
                  />
                </svg>
                <input
                  value={promptSearch}
                  onChange={(e) => setPromptSearch(e.target.value)}
                  placeholder="Search prompts…"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-gray-600 transition-colors"
                  autoFocus
                />
              </div>
              <div className="flex gap-1.5 overflow-x-auto pb-0.5">
                {PROMPT_CATEGORIES.map((cat) => (
                  <button
                    key={cat}
                    onClick={() => setPromptCategory(cat)}
                    className={[
                      "shrink-0 px-3 py-1 text-xs rounded-full transition-colors border",
                      promptCategory === cat
                        ? "bg-gray-700 text-white border-gray-600"
                        : "text-gray-500 border-gray-800 hover:text-gray-300 hover:border-gray-700",
                    ].join(" ")}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>

            {/* Prompt list */}
            <div className="flex-1 overflow-y-auto">
              {filteredPrompts.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-gray-600">
                  <p className="text-sm">No prompts match your search.</p>
                  <button
                    onClick={openNewPrompt}
                    className="mt-3 text-xs text-gray-500 hover:text-white underline underline-offset-2 transition-colors"
                  >
                    Create one
                  </button>
                </div>
              ) : (
                <ul className="divide-y divide-gray-800/60">
                  {filteredPrompts.map((p) => (
                    <li
                      key={p.id}
                      className="group flex items-start gap-3 px-4 py-3.5 hover:bg-gray-800/40 transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-sm font-medium text-white truncate">
                            {p.title}
                          </span>
                          <span
                            className={[
                              "shrink-0 text-[10px] px-1.5 py-0.5 rounded font-medium",
                              p.category === "Summary"
                                ? "bg-blue-950/60 text-blue-400"
                                : p.category === "Study"
                                  ? "bg-green-950/60 text-green-400"
                                  : p.category === "Analysis"
                                    ? "bg-purple-950/60 text-purple-400"
                                    : p.category === "Writing"
                                      ? "bg-orange-950/60 text-orange-400"
                                      : "bg-gray-800 text-gray-400",
                            ].join(" ")}
                          >
                            {p.category}
                          </span>
                        </div>
                        <p className="text-xs text-gray-500 line-clamp-2 leading-relaxed">
                          {p.content}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => openEditPrompt(p)}
                          className="neu-button-icon rounded-full p-1.5 text-gray-500"
                          title="Edit"
                        >
                          <svg
                            className="w-3.5 h-3.5"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2}
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Zm0 0L19.5 7.125"
                            />
                          </svg>
                        </button>
                        {!p.isDefault && (
                          <button
                            onClick={() => deletePrompt(p.id)}
                            className="neu-button-icon rounded-full p-1.5 text-red-400"
                            title="Delete"
                          >
                            <svg
                              className="w-3.5 h-3.5"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                              strokeWidth={2}
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
                              />
                            </svg>
                          </button>
                        )}
                        <button
                          onClick={() => applyPrompt(p)}
                          className="neu-button-primary px-3 py-1.5 text-xs"
                        >
                          Use
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Prompt edit / create modal ───────────────────────────────────────── */}
      {editingPrompt !== null && (
        <div
          className="bb-modal-backdrop fixed inset-0 z-50 flex items-center justify-center px-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setEditingPrompt(null);
          }}
        >
          <div className="bb-modal-panel neu-dialog w-full max-w-lg rounded-2xl border p-6">
            <h2 className="text-lg font-semibold mb-5">
              {editingPrompt.id ? "Edit prompt" : "New prompt"}
            </h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (
                  editingPrompt.title.trim() &&
                  editingPrompt.content.trim()
                ) {
                  savePrompt(editingPrompt);
                }
              }}
              className="space-y-4"
            >
              <div>
                <label className="block text-sm text-gray-400 mb-1.5">
                  Title
                </label>
                <input
                  type="text"
                  value={editingPrompt.title}
                  onChange={(e) =>
                    setEditingPrompt((p) =>
                      p ? { ...p, title: e.target.value } : p,
                    )
                  }
                  required
                  autoFocus
                  placeholder="e.g. Explain this concept"
                  className="w-full bg-gray-950 border border-gray-800 rounded-lg px-4 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-gray-600 transition-colors"
                />
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-1.5">
                  Category
                </label>
                <div className="flex gap-2 flex-wrap">
                  {PROMPT_CATEGORIES.filter((c) => c !== "All").map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() =>
                        setEditingPrompt((p) =>
                          p ? { ...p, category: cat } : p,
                        )
                      }
                      className={[
                        "px-3 py-1.5 text-xs rounded-lg border transition-colors",
                        editingPrompt.category === cat
                          ? "bg-gray-700 text-white border-gray-500"
                          : "text-gray-500 border-gray-800 hover:text-gray-300 hover:border-gray-700",
                      ].join(" ")}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-1.5">
                  Prompt content
                </label>
                <textarea
                  value={editingPrompt.content}
                  onChange={(e) =>
                    setEditingPrompt((p) =>
                      p ? { ...p, content: e.target.value } : p,
                    )
                  }
                  required
                  rows={5}
                  placeholder="Write the full prompt text that will be inserted into the chat…"
                  className="w-full bg-gray-950 border border-gray-800 rounded-lg px-4 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-gray-600 transition-colors resize-none"
                />
              </div>

              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => setEditingPrompt(null)}
                  className="neu-button flex-1 py-2.5 text-sm"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={
                    !editingPrompt.title.trim() || !editingPrompt.content.trim()
                  }
                  className="neu-button-primary flex-1 py-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Save prompt
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Upload modal */}
      {showUpload && (
        <div
          className="bb-modal-backdrop fixed inset-0 z-50 flex items-center justify-center px-4"
          onClick={(e) => {
            if (e.target !== e.currentTarget) return;
            if (isUploading) continueUploadInBackground();
            else closeUploadModal();
          }}
        >
          <div className="bb-modal-panel neu-dialog w-full max-w-md rounded-2xl border p-6">
            <div className="mb-5">
              <h2 className="text-lg font-semibold">Add documents</h2>
              <p className="text-sm text-gray-500 mt-0.5">{clusterName}</p>
            </div>

            <form onSubmit={handleUpload} className="space-y-4">
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPTED}
                multiple
                onChange={handleFileInput}
                className="hidden"
              />

              {/* Drop zone / file list */}
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleFileDrop}
                className={[
                  "rounded-xl border-2 border-dashed transition-colors",
                  isDragging ? "border-white/40 bg-white/5" : "border-gray-800",
                ].join(" ")}
              >
                {uploadFiles.length === 0 ? (
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    className="flex flex-col items-center justify-center gap-2 px-4 py-8 text-sm cursor-pointer text-gray-500 hover:text-gray-400 transition-colors"
                  >
                    <svg
                      className="w-6 h-6"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={1.5}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5"
                      />
                    </svg>
                    <span>
                      Drop files or{" "}
                      <span className="text-white underline underline-offset-2">
                        browse
                      </span>
                    </span>
                    <span className="text-xs text-gray-600">
                      PDF, DOCX, PPTX, XLSX, CSV, ZIP, images, TXT, MD
                    </span>
                  </div>
                ) : (
                  <div className="p-3 space-y-1.5">
                    {uploadFiles.map((f, i) => {
                      const key = fileKey(f);
                      const status = uploadStatuses[key];
                      const error = uploadErrors[key];
                      const step = uploadSteps[key];
                      return (
                        <div
                          key={key}
                          className="rounded-lg bg-gray-800/50 px-3 py-2"
                        >
                          <div className="flex items-center gap-2">
                            <svg
                              className="w-4 h-4 text-gray-500 shrink-0"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                              strokeWidth={1.5}
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"
                              />
                            </svg>
                            <span className="flex-1 text-xs text-gray-300 truncate">
                              {f.name}
                            </span>
                            {status === "uploading" && (
                              <Spinner className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                            )}
                            {status === "done" && (
                              <svg
                                className="w-3.5 h-3.5 text-green-400 shrink-0"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                                strokeWidth={2.5}
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  d="m4.5 12.75 6 6 9-13.5"
                                />
                              </svg>
                            )}
                            {status === "error" && (
                              <span className="shrink-0 text-[11px] font-medium text-red-300">
                                Failed
                              </span>
                            )}
                            {!isUploading && (
                              <button
                                type="button"
                                onClick={() => removeUploadFile(i)}
                                className="p-0.5 text-gray-600 hover:text-white transition-colors shrink-0"
                                aria-label={`Remove ${f.name}`}
                              >
                                <svg
                                  className="w-3.5 h-3.5"
                                  fill="none"
                                  viewBox="0 0 24 24"
                                  stroke="currentColor"
                                  strokeWidth={2}
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    d="M6 18 18 6M6 6l12 12"
                                  />
                                </svg>
                              </button>
                            )}
                          </div>
                          {status === "uploading" && step && (
                            <p className="mt-1.5 pl-6 text-[11px] leading-4 text-gray-400 truncate">
                              {step}
                            </p>
                          )}
                          {status === "error" && error && (
                            <p className="mt-1.5 pl-6 text-[11px] leading-4 text-red-300">
                              {error}
                            </p>
                          )}
                        </div>
                      );
                    })}
                    {!isUploading && !allDoneOrError && (
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="w-full py-1.5 text-xs text-gray-600 hover:text-white transition-colors border border-dashed border-gray-800 rounded-lg hover:border-gray-600"
                      >
                        + Add more files
                      </button>
                    )}
                  </div>
                )}
              </div>

              <DocumentIngestionVisionError errors={ingestionVisionErrors} />

              {(isUploading || ingestionTokenUsage.startedCalls > 0) && (
                <DocumentIngestionTokenUsage
                  usage={ingestionTokenUsage}
                  pending={isUploading}
                />
              )}

              {/* Parse using VLM (local HunyuanOCR GGUF) */}
              {hasVlmCompatibleFile && !allDoneOrError && (
                <VlmParseOption
                  checked={parseWithVlm}
                  onChange={(next) => {
                    setParseWithVlm(next);
                    // The two page readers are alternatives, not a stack.
                    if (next) setIsHandwriting(false);
                  }}
                  disabled={isUploading}
                  status={vlmStatus}
                  loading={vlmStatusLoading}
                />
              )}

              {/* Parse with anydoc (local document → Markdown converter) */}
              {hasAnydocCompatibleFile && !allDoneOrError && (
                <AnydocParseOption
                  checked={parseWithAnydoc}
                  onChange={setParseWithAnydoc}
                  disabled={isUploading}
                  status={anydocStatus}
                  loading={anydocStatusLoading}
                  overriddenByVlm={vlmUploadEnabled}
                />
              )}

              {/* Handwriting checkbox */}
              {hasHandwritingCompatibleFile && !allDoneOrError && (
                <label
                  className={`flex items-start gap-2.5 select-none ${
                    vlmUploadEnabled ? "cursor-not-allowed" : "cursor-pointer"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isHandwriting && !vlmUploadEnabled}
                    onChange={(e) => {
                      setIsHandwriting(e.target.checked);
                      if (e.target.checked) setGenerateMap(true);
                    }}
                    disabled={isUploading || vlmUploadEnabled}
                    className="mt-0.5 w-4 h-4 rounded border-gray-700 bg-gray-950 accent-white disabled:opacity-50"
                  />
                  <span>
                    <span className="block text-sm text-gray-400">
                      Handwritten or scanned pages
                    </span>
                    <span className="block text-[11px] text-gray-600 mt-0.5">
                      {vlmUploadEnabled
                        ? "Not used while Parse using VLM is on — the VLM already reads the pages."
                        : anydocUploadEnabled
                          ? "Used for images only while Parse with anydoc is on — anydoc reads the PDFs."
                          : "Uses vision OCR on each PDF page or image before generating the Learning Map."}
                    </span>
                  </span>
                </label>
              )}

              {/* Map generation toggle */}
              {!allDoneOrError && (
                <label className="flex items-center gap-2.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={handwritingUploadEnabled || generateMap}
                    onChange={(e) => setGenerateMap(e.target.checked)}
                    disabled={isUploading || handwritingUploadEnabled}
                    className="w-4 h-4 rounded border-gray-700 bg-gray-950 accent-white disabled:opacity-50"
                  />
                  <div>
                    <span className="text-sm text-gray-400">
                      Generate Learning Map
                    </span>
                    <p className="text-[11px] text-gray-600 mt-0.5">
                      {handwritingUploadEnabled
                        ? "Required for handwritten uploads so the map is built from OCR text."
                        : "Build the Learning Spine, Source Map, and Scope Contract - slower but richer"}
                    </p>
                  </div>
                </label>
              )}

              {/* Source label */}
              {!allDoneOrError && (
                <div>
                  <label className="block text-sm text-gray-400 mb-1.5">
                    Source label{" "}
                    <span className="text-gray-600">(optional)</span>
                  </label>
                  <input
                    type="text"
                    value={uploadLabel}
                    onChange={(e) => setUploadLabel(e.target.value)}
                    placeholder="e.g. Lecture 3, Chapter 5"
                    disabled={isUploading}
                    className="w-full bg-gray-950 border border-gray-800 rounded-lg px-4 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-gray-600 transition-colors disabled:opacity-50"
                  />
                </div>
              )}

              {/* Elapsed timer */}
              {(isUploading || (allDoneOrError && uploadElapsedMs > 0)) && (
                <div className="flex items-center justify-center gap-1.5 text-xs text-gray-400 tabular-nums">
                  <svg
                    className="w-3.5 h-3.5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={1.5}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
                    />
                  </svg>
                  <span>
                    {isUploading ? "Elapsed" : "Done in"}{" "}
                    {formatElapsed(uploadElapsedMs)}
                  </span>
                </div>
              )}

              {/* Actions */}
              <div className="space-y-3 pt-1">
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={closeUploadModal}
                    className="neu-button flex-1 py-2.5 text-sm disabled:opacity-40"
                  >
                    {allDoneOrError
                      ? "Close"
                      : isUploading
                        ? "Cancel upload"
                        : "Cancel"}
                  </button>
                  {!allDoneOrError && (
                    <button
                      type="submit"
                      disabled={uploadFiles.length === 0 || isUploading}
                      className="neu-button-primary flex flex-1 items-center justify-center gap-2 py-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isUploading && <Spinner />}
                      {isUploading
                        ? `Uploading… (${Object.values(uploadStatuses).filter((s) => s === "done").length}/${uploadFiles.length})`
                        : `Upload ${uploadFiles.length > 0 ? `${uploadFiles.length} file${uploadFiles.length > 1 ? "s" : ""}` : ""}`}
                    </button>
                  )}
                </div>
                {isUploading && (
                  <button
                    type="button"
                    onClick={continueUploadInBackground}
                    className="neu-button w-full py-2.5 text-sm"
                  >
                    Close &amp; continue in background
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>
      )}

      {learnConfirmationAction ? (
        <LearnConfirmationDialog
          action={learnConfirmationAction}
          onCancel={() => setLearnConfirmationAction(null)}
          onConfirm={() => void handleConfirmLearnDestructiveAction()}
        />
      ) : null}

      <Toaster toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
