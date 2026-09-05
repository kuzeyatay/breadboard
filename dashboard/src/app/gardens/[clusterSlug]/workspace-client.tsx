"use client";

import { GARDEN_SOURCE_IMPORTED_EVENT, handleGardenSourceImportResult } from "@/lib/hermes/garden-source-import-client";

import {
  memo,
  useState,
  useRef,
  useEffect,
  useLayoutEffect,
  useCallback,
  useMemo,
  useSyncExternalStore,
  type RefObject,
} from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import TerminalSidebar, {
  CHAT_RAIL_RESIZE,
  PENDING_CHAT_ROW_ID,
  type TerminalPanel,
  type TerminalSidebarChat,
} from "@/app/components/hermes/terminal-sidebar";
import SidePanelDock from "@/app/components/hermes/side-panel-dock";
import ProductDetailsPanel, {
  type ProductPanelSelection,
} from "@/app/components/hermes/product-details-panel";
import GenerativeUiRenderer from "@/app/components/hermes/generative-ui-renderer";
import { useRailResize } from "@/app/components/hermes/use-rail-resize";
import {
  chatActivityById,
  nextUnreadChats,
  readUnreadChats,
  sameChatIds,
  writeUnreadChats,
} from "@/lib/conversations/unread";
import { recordLastOpenedChat } from "@/lib/conversations/last-opened";
import { forkCluster } from "@/app/actions/clusters";
import AssistantComposer from "@/app/components/assistant-composer";
import BreadboardLoader from "@/app/components/breadboard-loader";
import DocumentContextMenu from "@/app/components/document-context-menu";
import LinkContextMenu from "@/app/components/link-context-menu";
import { useHumanizerMode } from "@/app/components/use-humanizer-mode";
import {
  restoreQueuedFollowUpDraft,
  useQueuedFollowUps,
} from "@/app/components/hermes/queued-follow-ups";
import { useComposerInset } from "@/app/components/chat/use-composer-inset";
import { useSmoothStreamText } from "@/app/components/chat/use-smooth-stream-text";
import ChatDisclaimer from "@/app/components/chat/chat-disclaimer";
import CollapsibleUserMessage from "@/app/components/chat/collapsible-user-message";
import ChatGreetingEmptyState from "@/app/components/hermes/chat-greeting-empty-state";
import type { ChatGreeting } from "@/lib/hermes/chat-greeting";
import { useChatGreeting } from "@/app/components/hermes/use-chat-greeting";
import { useChatDraft } from "@/app/components/hermes/use-chat-draft";
import { forgetChatDrafts } from "@/lib/conversations/drafts";
import AssistantMessageActions, {
  MessageActionsSlot,
  AssistantResponseBranchNavigation,
} from "@/app/components/assistant-message-actions";
import { isDirectModeEnabled } from "@/app/components/use-direct-mode";
import { isSuperAgentEnabled } from "@/app/components/use-agent-mode";
import { isPersonalizeEnabled } from "@/app/components/use-personalize";
import {
  applyBranchVariant,
  cloneMessages,
  createConversationBranch,
  messageBranchId,
  previousUserMessageIndex,
  retryTargetUserMessageIndex,
  type ConversationBranchGroup,
} from "@/app/components/hermes/conversation-branches";
import {
  chatAutoScrollContentKey,
  chatAutoScrollResponseKey,
  useChatAutoScroll,
  useChatVirtualBridge,
  type ChatVirtualBridge,
} from "@/app/components/use-chat-auto-scroll";
import VirtualizedMessageList from "@/app/components/chat/virtualized-message-list";
import {
  chatRowKey,
  estimateChatRowHeight,
} from "@/app/components/chat/chat-row-identity";
import ChatTimeSeparator from "@/app/components/chat-time-separator";
import ChatMessageAttachments from "@/app/components/chat-message-attachments";
import AttachmentPreviewDialog, {
  type AttachmentPreviewSource,
} from "@/app/components/attachment-preview-dialog";
import ChatVideoLinkEmbeds from "@/app/components/chat-video-link-embed";
import { useAssistantIntelligence } from "@/app/components/use-assistant-intelligence";
import ActivityPanel from "@/app/components/hermes/activity-panel";
import AssistantResponseNotice from "@/app/components/assistant-response-notice";
import type { ClarificationPrompt } from "@/app/components/hermes/use-agent-session";
import {
  splitLeadingCommandTokens,
  UserMessageText,
} from "@/app/components/hermes/command-text";
import SavePromptDialog from "@/app/components/hermes/save-prompt-dialog";
import GardenSettingsDialog, {
  GardenSettingsIcon,
} from "@/app/components/garden-settings-dialog";
import { useLegacyAgentActivity } from "@/app/components/hermes/use-legacy-agent-activity";
import { isRecoverableAgentStreamDisconnect } from "@/app/components/hermes/agent-stream-watchdog";
import type {
  ActivityItem,
  ConnectionState,
  PermissionPrompt,
} from "@/app/components/hermes/use-agent-session";
import type { VerificationSummary } from "@/lib/hermes/evidence";
import { applyGardenStableTextEvent } from "@/lib/hermes/garden-stable-stream";
import { assistantVisibleContent } from "@/lib/hermes/assistant-visible-content";
import {
  delegatedAgentActivityLabelForMessage,
  delegatedAgentCompletedLabelForMessage,
  delegatedAgentOutcomeLabelForMessage,
  delegatedWorkersForMessage,
  delegatedWorkersOutcome,
  delegatedWorkersOutcomeNote,
  delegatedContinuationPreamble,
  delegatedThinkingUpdates,
  delegatedAgentStartedAtForMessage,
  delegatedTurnCarriedDurationMs,
  delegatedTurnTotalUsage,
  supersededDelegationAssistantIndices,
} from "@/lib/hermes/super-agent-activity";
import { isClarificationAnswerMessage } from "@/lib/steered-response";
import { interactiveVisualizerCommandForArtifact } from "@/lib/hermes/interactive-visualizer-skills";
import ChatJumpToBottom from "@/app/components/chat-jump-to-bottom";
import ChatMessageRail, {
  type ChatMessageRailItem,
} from "@/app/components/chat-message-rail";
import ChatMarkdown, {
  type ChatTextAnnotation,
} from "@/app/components/chat-markdown";
import {
  ChatSelectionMenu,
  InlineSelectionAnswerPopover,
  QuotedChatSelection,
  SelectableAssistantMarkdown,
  SelectionComposerContext,
  type ChatTextSelectionCandidate,
  type FloatingAnchorRect,
} from "@/app/components/chat-text-selection-ui";
import {
  chatTextSelectionsOverlap,
  normalizeChatTextSelectionReference,
  type ChatTextSelectionReference,
} from "@/lib/chat-text-selection";
import {
  DEFAULT_CHAT_HIGHLIGHT_COLOR,
  isChatHighlightColor,
  type ChatHighlightColor,
} from "@/lib/chat-highlights";
import DocumentIngestionTokenUsage from "@/app/components/document-ingestion-token-usage";
import DocumentIngestionVisionError from "@/app/components/document-ingestion-vision-error";
import GardenVideoImport from "@/app/components/garden-video-import";
import OverflowMarquee from "@/app/components/overflow-marquee";
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
  ARTIFACT_AI_EDIT_EVENT,
  ArtifactArchiveIcon,
  GARDEN_DOCUMENTS_CHANGED_EVENT,
} from "@/app/components/hermes/artifact-panel";
import GardenArtifactDock from "@/app/components/hermes/garden-artifact-dock";
import { consumeArtifactAiEdit, type ArtifactAiEditDetail } from "@/app/components/hermes/artifact-ai-edit";
import InlineAgentBrowserRun from "@/app/components/hermes/inline-agent-browser-run";
import InlineArtifactCards, {
  InlineArtifactCardsProvider,
  InlineArtifactEmptyState,
  useInlineArtifactPrefetch,
} from "@/app/components/hermes/inline-artifact-cards";
import InlineDeepResearchRun from "@/app/components/hermes/inline-deep-research-run";
import InlineMaxResearchRun from "@/app/components/hermes/inline-max-research-run";
import InlineOpenCodeRun from "@/app/components/hermes/inline-opencode-run";
import InlineRufloRun from "@/app/components/hermes/inline-ruflo-run";
import InlineAgentReachRun from "@/app/components/hermes/inline-agent-reach-run";
import InlineGetDocRun from "@/app/components/hermes/inline-get-doc-run";
import InlineMeetingNotesRun from "@/app/components/hermes/inline-meeting-notes-run";
import InlineDeepTutorRun from "@/app/components/hermes/inline-deep-tutor-run";
import InlineCareerOpsRun from "@/app/components/hermes/inline-career-ops-run";
import InlineOpenExecutiveRun from "@/app/components/hermes/inline-openexecutive-run";
import InlineOpenGymRun from "@/app/components/hermes/inline-open-gym-run";
import InlineTradingAgentsRun from "@/app/components/hermes/inline-tradingagents-run";
import InlineVibeTradingRun from "@/app/components/hermes/inline-vibe-trading-run";
import InlineStockAnalystRun from "@/app/components/hermes/inline-stock-analyst-run";
import InlineDeerFlowRun from "@/app/components/hermes/inline-deer-flow-run";
import InlineOpenPlanterRun from "@/app/components/hermes/inline-openplanter-run";
import InlineSocialsManagerRun from "@/app/components/hermes/inline-socials-manager-run";
import InlineHardwareBlueprintRun from "@/app/components/hermes/inline-hardware-blueprint-run";
import InlineParametricCadRun from "@/app/components/hermes/inline-parametric-cad-run";
import InlineHyperframesRun from "@/app/components/hermes/inline-hyperframes-run";
import InlineResource2SkillRun from "@/app/components/hermes/inline-resource2skill-run";
import InlineMatraixRun from "@/app/components/hermes/inline-matraix-run";
import InlineBoltSlidesRun from "@/app/components/hermes/inline-bolt-slides-run";
import InlineClassroomRun from "@/app/components/hermes/inline-classroom-run";
import InlineGodsEyeRun from "@/app/components/hermes/inline-gods-eye-run";
import InlineOpenMontageRun from "@/app/components/hermes/inline-openmontage-run";
import InlineOpenworkRun from "@/app/components/hermes/inline-openwork-run";
import InlineOpenscienceRun from "@/app/components/hermes/inline-openscience-run";
import InlinePraxistRun from "@/app/components/hermes/inline-praxist-run";
import InlineInboxZeroRun from "@/app/components/hermes/inline-inbox-zero-run";
import InlineVimaxRun from "@/app/components/hermes/inline-vimax-run";
import InlineVoxDirectorRun from "@/app/components/hermes/inline-vox-director-run";
import InlineMoneyPrinterRun from "@/app/components/hermes/inline-money-printer-run";
import InlineLegalRun from "@/app/components/hermes/inline-legal-run";
import InlineWardrobeRun from "@/app/components/hermes/inline-wardrobe-run";
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
import {
  inboxZeroUserMessage,
  taskFromInboxZeroCommand,
} from "@/lib/inbox-zero/identity.ts";
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
import LearnConfirmationDialog, {
  type LearnDestructiveAction,
} from "@/app/components/learn-confirmation-dialog";
import { useConfirmDialog } from "@/app/components/confirm-dialog";
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
import {
  formatAssistantModelName,
  groupAssistantModels,
} from "@/lib/ai-models";
import { chatTimeSeparatorLabels } from "@/lib/chat-time-separators";
import {
  documentUploadTimeTitle,
  formatDocumentUploadTime,
} from "@/lib/document-upload-time";
import { requestChatTitleFromFirstMessage } from "@/lib/chat-session-title";
import {
  normalizeFocusedDocumentNames,
  normalizeFocusedDocumentSlugs,
} from "@/lib/garden-document-focus";
import type {
  LocalWorkflowSummary,
  WorkflowRunResponse,
} from "@/lib/workflows/types";
import {
  CHAT_ATTACHMENT_ACCEPT,
  attachmentOnlyMessageText,
  chatMessageAttachments,
  extractChatAttachments,
  reusableChatAttachments,
  visibleChatMessageText,
  type ChatAttachment,
  type ChatMessageAttachment,
} from "@/lib/chat-attachments";
import {
  distillAttachments,
  distillGardenDocumentSkill,
} from "@/lib/document-skills/client";
import {
  currentLearnElapsedMs,
  formatLearnElapsedTime,
} from "@/lib/learn-timer";
import { sumIngestTokenUsage } from "@/lib/ingest-token-usage";
import {
  beginRuntimeIngestRecovery,
  bindRuntimeIngestResponse,
  cancelPendingRuntimeIngest,
  forgetRuntimeIngestRecovery,
  recoverRuntimeIngest,
  runtimeIngestRecoveries,
  runtimeIngestRecoveryRecord,
} from "@/lib/runtime-v2/ingest-recovery-client";
import {
  cancelGardenUploadTask,
  gardenUploadTasksServerSnapshot,
  gardenUploadTasksSnapshot,
  hasLiveGardenUploadRequest,
  registerGardenUploadSink,
  removeGardenUploadTask,
  startGardenUploadTask,
  subscribeGardenUploads,
} from "@/lib/garden-upload-store";
import {
  agentBrowserStartFailure,
  agentBrowserUserMessage,
  taskFromAgentBrowserCommand,
} from "@/lib/agent-browser/identity";
import {
  desktopTabsBridge,
  openBrowserAgentRunInDesktop,
} from "@/lib/desktop-browser-tabs";
import {
  directDeepResearchInvocation,
  deepResearchUserMessage,
  parseResearchRequest,
} from "@/lib/deep-research/identity";
import { maxResearchUserMessage } from "@/lib/max-research/identity.ts";
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
  socialsManagerUserMessage,
  taskFromSocialsManagerCommand,
} from "@/lib/socials-manager/identity.ts";
import { findCapabilityConflict } from "@/lib/hermes/capability-combinations.ts";
import {
  MAX_AGENT_LAUNCH_HOPS,
  agentLaunchContinuationMessage,
  agentLaunchWorkerClientMessageId,
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
  externalAgentResponseDurationMs,
  type ExternalAgentActivityEntry,
  type ExternalAgentEdits,
  type ExternalAgentOutcome,
  type ExternalAgentTerminalResult,
} from "@/lib/conversations/external-agent-runs";
import {
  notifyChatResponseFailed,
  notifyChatResponseReady,
} from "@/lib/task-completion-notification";
import {
  setActiveChatNotificationTarget,
  setActiveLearnNotificationGarden,
  takeChatNotificationReply,
  type ChatNotificationTarget,
} from "@/lib/chat-notification-inbox";
import { LEARN_ACTIVE_STAGE_LABELS } from "@/lib/learn-stage-labels";
import {
  abortGardenTurnCheckpoint,
  reserveGardenTurnCheckpoint,
} from "@/lib/conversations/garden-turn-client";
import { gardenDocumentHref } from "@/lib/garden-document-route";
import {
  isPlayableVideoFormat,
  videoAttachmentFormat,
} from "@/lib/video-attachments";
import { audioAttachmentFormat } from "@/lib/audio-attachments";
import {
  normalizeGenerativeUiResources,
  productForAction,
  productForResource,
  safeProductUrl,
  type GenerativeUiAction,
  type GenerativeUiResource,
} from "@/lib/generative-ui/contracts.ts";

interface Message {
  id?: string;
  artifactMessageId?: string;
  /** Set on messages that live in a retry branch; see conversation-branches. */
  clientMessageId?: string;
  branchGroupId?: string;
  role: "user" | "assistant";
  content: string;
  /** Model-to-model hand-back; retained in context but hidden from the user. */
  internalAgentContinuation?: boolean;
  /** Runtime input that answered the assistant's own mid-turn question. */
  clarificationAnswer?: boolean;
  /**
   * Selected assistant text this turn quotes ("Ask in chat") or answers in
   * place ("Ask here"). Inline turns are hidden from the transcript and read
   * through the highlight's popover instead.
   */
  textSelection?: ChatTextSelectionReference;
  createdAt?: string;
  sources?: string[];
  thinking?: string;
  progressNotes?: string[];
  attachmentNames?: string[];
  attachments?: ChatMessageAttachment[];
  /** Garden documents selected as context when this question was sent. */
  focusedDocumentNames?: string[];
  /** Stable references for re-sending those exact Garden documents. */
  focusedDocumentSlugs?: string[];
  usage?: ChatTokenUsage;
  responseDurationMs?: number;
  responseCompletedAt?: string;
  verification?: VerificationSummary;
  uiResources?: GenerativeUiResource[];
  agentBrowserRun?: { agentId: string; runId: string; task: string };
  deepResearchRun?: {
    runId: string;
    query: string;
    output: "report" | "answer";
  };
  maxResearchRun?: {
    runId: string;
    query: string;
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
  openExecutiveRun?: { runId: string; task: string };
  openGymRun?: { runId: string; task: string; quiet?: boolean };
  tradingAgentsRun?: { runId: string; task: string };
  vibeTradingRun?: { runId: string; task: string };
  stockAnalystRun?: { runId: string; task: string };
  deerFlowRun?: { runId: string; task: string };
  socialsManagerRun?: { runId: string; brief: string };
  hardwareBlueprintRun?: { runId: string; brief: string };
  parametricCadRun?: { runId: string; brief: string };
  hyperframesRun?: { runId: string; brief: string };
  resource2SkillRun?: { runId: string; brief: string };
  matraixRun?: { runId: string; brief: string };
  boltSlidesRun?: { runId: string; brief: string };
  classroomRun?: { runId: string; brief: string };
  godsEyeRun?: { runId: string; task: string; quiet?: boolean };
  openMontageRun?: { runId: string; brief: string };
  openworkRun?: { runId: string; task: string };
  openscienceRun?: { runId: string; task: string };
  praxistRun?: { runId: string; task: string };
  inboxZeroRun?: { runId: string; task: string };
  vimaxRun?: { runId: string; brief: string };
  voxDirectorRun?: { runId: string; brief: string };
  moneyPrinterRun?: { runId: string; brief: string };
  legalRun?: { runId: string; task: string };
  wardrobeRun?: { runId: string; task: string };
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
  externalAgentStartedAt?: string;
  /** Model-selected worker state; observed invisibly by the Super Agent host. */
  delegatedAgentRun?: boolean;
  /** The Super Agent text that remains visible while its worker runs. */
  delegatedAgentPreamble?: string;
  /** Worker output returned to the Super Agent without replacing its message. */
  externalAgentResult?: string;
  externalAgentName?: string;
  /** Why the Super Agent selected this worker, used in plain-language failures. */
  delegatedAgentReason?: string;
  externalAgentActivity?: ExternalAgentActivityEntry[];
  externalAgentEdits?: ExternalAgentEdits;
  externalAgentState?: Record<string, unknown>;
}

const ChatSearchDialog = dynamic(
  () => import("@/app/components/hermes/chat-search-dialog"),
  { ssr: false },
);
const UploadsPanel = dynamic(
  () => import("@/app/components/hermes/uploads-panel"),
  { ssr: false },
);
const TerminalScheduledPanel = dynamic(
  () => import("@/app/components/hermes/terminal-scheduled-panel"),
  { ssr: false },
);
const HooksPanel = dynamic(
  () => import("@/app/components/hermes/hooks-panel"),
  {
    ssr: false,
  },
);
const ProcessesPanel = dynamic(
  () => import("@/app/components/hermes/processes-panel"),
  { ssr: false },
);

/** Everything the Terminal's rail offers except its artifact archive. */
const GARDEN_PANELS: readonly TerminalPanel[] = [
  "uploads",
  "scheduled",
  "hooks",
  "processes",
];

const PANEL_TITLES: Record<TerminalPanel, string> = {
  artifacts: "Artifacts",
  uploads: "Uploads",
  scheduled: "Scheduled chats",
  hooks: "Hooks",
  processes: "Processes",
};

const RAIL_WIDTH_KEY = "breadboard:garden-workspace:sidebar-width";
/** Read once, so a rail that was shut before it had a width comes back shut. */
const RAIL_COLLAPSED_KEY = "breadboard:garden-workspace:sidebar-collapsed";
const NO_MESSAGES: Message[] = [];

interface ChatSession {
  id: number;
  user_id?: number;
  /** Stable canonical id used by runtime-scoped capability endpoints. */
  conversationId?: string | null;
  title: string;
  created_at: string;
  updated_at: string;
  messages: Message[];
  ownerUsername?: string;
  isOwn?: boolean;
  /**
   * The rail's marks. They live on the canonical conversation behind this chat,
   * which is the row the Terminal's rail marks too — a chat pinned here is
   * pinned there.
   */
  pinned?: boolean;
  highlight?: string | null;
  /** A turn or an agent run is in flight in this chat right now. */
  active?: boolean;
  /** Changes whenever the newest durable assistant message changes. */
  latestAssistantVersion?: string | null;
}

/** One row of the rail's own feed: the chat without its transcript. */
interface ChatSessionSummary {
  id: number;
  conversationId?: string | null;
  title: string;
  created_at: string;
  updated_at: string;
  isOwn?: boolean;
  ownerUsername?: string;
  pinned: boolean;
  highlight: string | null;
  active: boolean;
  latestAssistantVersion: string | null;
}

function latestAssistantResponse(messages: readonly Message[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "assistant") continue;
    const response = message.externalAgentResult?.trim() || message.content.trim();
    if (response) return response;
  }
  return undefined;
}

interface ExternalAgentSelection {
  id: string;
  name: string;
}

/**
 * Retry branches are a reading of this transcript, not part of it: the chat row
 * stores the variant currently on screen, and the siblings live beside it in
 * this browser — the same arrangement the Terminal uses.
 */
const BRANCH_STORAGE_PREFIX = "breadboard:garden-conversation-branches:";

function loadBranchGroups(
  chatId: number,
): Record<string, ConversationBranchGroup<Message>> {
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(`${BRANCH_STORAGE_PREFIX}${chatId}`) ?? "{}",
    ) as Record<string, ConversationBranchGroup<Message>>;
    if (!parsed || typeof parsed !== "object") return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(([, group]) =>
        Boolean(
          group &&
          typeof group.id === "string" &&
          Number.isInteger(group.activeIndex) &&
          Array.isArray(group.variants) &&
          group.variants.length > 1,
        ),
      ),
    );
  } catch {
    return {};
  }
}

// ── Selected-text questions ("Ask in chat" / "Ask here") ─────────────────────
// The same feature the Terminal has, against this workspace's legacy chat
// store. Highlights and not-yet-asked selections live in localStorage per chat
// id; answered threads restore from the `textSelection` metadata each turn
// persists with its messages.

const INLINE_SELECTION_STORAGE_PREFIX =
  "breadboard:garden-chat-inline-selections:";
const DELETED_INLINE_SELECTION_STORAGE_PREFIX =
  "breadboard:garden-chat-deleted-inline-selections:";
const CHAT_HIGHLIGHT_STORAGE_PREFIX = "breadboard:garden-chat-highlights:";

interface SavedChatHighlight extends Omit<ChatTextSelectionReference, "mode"> {
  color: ChatHighlightColor;
}

interface InlineSelectionThread {
  selection: ChatTextSelectionReference;
  question?: string;
  answer?: string;
  pending: boolean;
  usage?: ChatTokenUsage;
  responseDurationMs?: number;
  startedAt?: string;
  /** The answer message's own id, so text inside the popover is selectable
   * and can host highlights and nested "Ask here" threads of its own. */
  answerMessageId?: string;
}

/**
 * The id selections anchor to. The checkpoint assigns the durable `msg_N` id
 * before any answer streams, so unlike the Terminal the stable id comes first.
 */
function messageSelectionSourceId(message: Message, messageIndex: number): string {
  return message.id ?? message.clientMessageId ?? `assistant-${messageIndex}`;
}

function loadInlineSelections(chatId: number): ChatTextSelectionReference[] {
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(
        `${INLINE_SELECTION_STORAGE_PREFIX}${chatId}`,
      ) ?? "[]",
    ) as unknown[];
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    return parsed.flatMap((value) => {
      const selection = normalizeChatTextSelectionReference(value);
      if (!selection || selection.mode !== "inline" || seen.has(selection.id)) {
        return [];
      }
      seen.add(selection.id);
      return [selection];
    });
  } catch {
    return [];
  }
}

function loadDeletedInlineSelectionIds(chatId: number): Set<string> {
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(
        `${DELETED_INLINE_SELECTION_STORAGE_PREFIX}${chatId}`,
      ) ?? "[]",
    ) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(
      parsed.filter(
        (value): value is string =>
          typeof value === "string" && value.length > 0 && value.length <= 160,
      ),
    );
  } catch {
    return new Set();
  }
}

function normalizeSavedChatHighlight(value: unknown): SavedChatHighlight | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const selection = normalizeChatTextSelectionReference({
    ...candidate,
    mode: "chat",
  });
  if (!selection) return null;
  return {
    id: selection.id,
    sourceMessageId: selection.sourceMessageId,
    start: selection.start,
    end: selection.end,
    quote: selection.quote,
    prefix: selection.prefix,
    suffix: selection.suffix,
    color: isChatHighlightColor(candidate.color)
      ? candidate.color
      : DEFAULT_CHAT_HIGHLIGHT_COLOR,
  };
}

function loadChatHighlights(chatId: number): SavedChatHighlight[] {
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(
        `${CHAT_HIGHLIGHT_STORAGE_PREFIX}${chatId}`,
      ) ?? "[]",
    ) as unknown;
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    return parsed.flatMap((value) => {
      const highlight = normalizeSavedChatHighlight(value);
      if (!highlight || seen.has(highlight.id)) return [];
      seen.add(highlight.id);
      return [highlight];
    });
  } catch {
    return [];
  }
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
  sourceMedia: string;
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

interface LinkImportTask {
  id: string;
  title: string;
  url: string;
  status: "importing" | "completed" | "failed";
  stage: string;
  startedAt: number;
  completedAt?: number;
  duplicate?: boolean;
  sourceRelPath?: string;
  capturedImages?: number;
  referencedImages?: number;
  error?: string;
}

type LearnSourceKind = "document" | "link" | "video" | "audio";

const LEARN_SOURCE_KINDS: LearnSourceKind[] = [
  "document",
  "link",
  "video",
  "audio",
];

function learnSourceKind(doc: DocInfo): LearnSourceKind {
  const sourceType = doc.sourceType.trim().toLowerCase();
  if (sourceType === "url" || sourceType === "link") return "link";
  if (sourceType.includes("audio")) return "audio";
  if (sourceType === "youtube" || sourceType.includes("video")) return "video";
  return "document";
}

interface GardenChatSourceAttachment extends AttachmentPreviewSource {
  slug: string;
}

/** Reconnect one selected Garden chip to the retained source it represents. */
function gardenChatSourceAttachment(
  clusterSlug: string,
  doc: DocInfo,
): GardenChatSourceAttachment | null {
  const name = doc.sourceFile.trim() || doc.title || doc.name;
  const aliases = [doc.title, doc.name, doc.sourceFile]
    .map((value) => value.trim())
    .filter((value, index, values) => value && values.indexOf(value) === index);
  const isPdf =
    doc.sourceType.trim().toLowerCase() === "pdf" || /\.pdf$/i.test(doc.sourceFile);
  if (isPdf && doc.sourcePdf) {
    return {
      slug: doc.slug,
      kind: "pdf",
      name,
      aliases,
      href: `/gardens/${encodeURIComponent(clusterSlug)}/pdf/${encodeURIComponent(doc.slug)}`,
    };
  }

  const declaredKind = learnSourceKind(doc);
  const kind =
    declaredKind !== "document"
      ? declaredKind
      : audioAttachmentFormat(doc.sourceFile)
        ? "audio"
        : videoAttachmentFormat(doc.sourceFile)
          ? "video"
          : declaredKind;
  if ((kind === "audio" || kind === "video") && doc.sourceMedia) {
    const videoFormat = kind === "video" ? videoAttachmentFormat(doc.sourceFile) : null;
    return {
      slug: doc.slug,
      kind,
      name,
      aliases,
      href: `/api/gardens/${encodeURIComponent(clusterSlug)}/media/${encodeURIComponent(doc.slug)}`,
      ...(kind === "video"
        ? { playable: videoFormat ? isPlayableVideoFormat(videoFormat) : true }
        : {}),
    };
  }
  return null;
}

function learnSourceKindLabel(kind: LearnSourceKind): string {
  switch (kind) {
    case "link":
      return "Links";
    case "video":
      return "Videos";
    case "audio":
      return "Audio";
    default:
      return "Documents";
  }
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
  | "paused"
  | "complete"
  | "failed"
  | "cancelled";

type LearnHumanizerStatus =
  | "ai"
  | "running"
  | "humanized"
  | "restoring_ai"
  | "failed";

interface LearnJobInfo {
  id: string;
  model: string;
  status: LearnStatus;
  mode: "plan" | "generate" | "repair" | "full_rebuild" | "update_sources";
  updatedAt?: string;
  currentStep?: string;
  progressPercent?: number;
  currentSectionTitle?: string;
  currentPageTitle?: string;
  error?: string;
  requiresReplan?: boolean;
  proposedLearningMapId?: string;
  confirmedLearningMapId?: string;
  userInstruction?: string;
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
    requestPolicy?: {
      model: string | null;
      reasoningEffort: string | null;
      reasoningSummary: string | null;
      observedCalls: number;
      consistent: boolean;
    };
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
  confirmedLearningMapModel?: string;
  latestTextbookVersionId?: string;
  humanizer?: {
    versionId: string;
    requested: boolean;
    activeCopy: "ai" | "humanized";
    status: LearnHumanizerStatus;
    reason?: string;
    error?: string;
    updatedAt: string;
  } | null;
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
  initialChatId?: string | null;
  /** Arrive with the Learn panel showing (a Learn notice's link, `?learn=1`). */
  initialLearnPanelOpen?: boolean;
  isOwner?: boolean;
  clusterVisibility: "private" | "organization" | "public";
  chatAccessible: boolean;
  forkAllowed: boolean;
  showNavbarFlowers: boolean;
}

const ACCEPTED =
  ".pdf,.jpg,.jpeg,.png,.webp,.txt,.md,.csv,.docx,.pptx,.xlsx,.zip";
const LEARN_USER_INSTRUCTION_MAX_CHARS = 4_000;
const LEARN_USER_INSTRUCTION_EXAMPLES = [
  {
    label: "Focus",
    text: "Explain boundary conditions in more depth.",
  },
  {
    label: "Include",
    text: "Include one worked example in every topic.",
  },
  {
    label: "Exclude",
    text: "Exclude antenna arrays from this course.",
  },
  {
    label: "Redo",
    text: "Redo only the topics after Maxwell's equations. Keep everything before that unchanged.",
  },
] as const;
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

function LearnModelPicker({
  value,
  groups,
  disabled,
  title,
  onOpen,
  onChange,
}: {
  value: string;
  groups: ReturnType<typeof groupAssistantModels>;
  disabled: boolean;
  title: string;
  onOpen: () => void;
  onChange: (model: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const optionRefs = useRef(new Map<string, HTMLButtonElement>());
  const options = groups.flatMap((group) => group.models);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => {
      optionRefs.current.get(value)?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open, value]);

  function openMenu() {
    if (disabled) return;
    onOpen();
    setOpen(true);
  }

  function choose(model: string) {
    setOpen(false);
    if (model !== value) onChange(model);
    triggerRef.current?.focus();
  }

  function moveFocus(current: string, direction: -1 | 1) {
    const currentIndex = Math.max(0, options.indexOf(current));
    const nextIndex = (currentIndex + direction + options.length) % options.length;
    optionRefs.current.get(options[nextIndex])?.focus();
  }

  return (
    <div className="relative flex min-w-0 max-w-44 items-baseline">
      <button
        ref={triggerRef}
        type="button"
        aria-label="Model for Learn"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        title={title}
        onPointerDown={onOpen}
        onFocus={onOpen}
        onClick={() => {
          if (open) setOpen(false);
          else setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            if (open) optionRefs.current.get(value)?.focus();
            else openMenu();
          }
        }}
        className="group flex w-full min-w-0 cursor-pointer items-center gap-1 bg-transparent p-0 font-mono tabular-nums text-gray-200 outline-none transition-colors hover:text-white focus-visible:ring-1 focus-visible:ring-gray-600 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span className="min-w-0 truncate">{formatAssistantModelName(value)}</span>
        <svg
          className={`h-3 w-3 shrink-0 text-gray-500 transition-transform group-hover:text-gray-300 ${open ? "rotate-180" : ""}`}
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

      {open ? (
        <ViewportPopover
          anchorRef={triggerRef}
          ariaLabel="Choose a model for Learn"
          className="neu-popover fixed z-[100] w-64 max-w-[calc(100vw-1.5rem)] overflow-y-auto overscroll-contain rounded-lg border border-gray-800 bg-gray-950 p-1.5 shadow-xl"
          onClose={() => setOpen(false)}
        >
          {groups.map((group) => (
            <div key={group.vendorId} role="group" aria-label={group.vendorLabel}>
              <div className="px-2 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wider text-gray-500 first:pt-1">
                <span
                  className="rounded-sm px-0.5"
                  style={{
                    background:
                      "linear-gradient(transparent 55%, color-mix(in srgb, var(--botanical-3) 35%, transparent) 55%)",
                  }}
                >
                  {group.vendorLabel}
                </span>
              </div>
              {group.models.map((item) => {
                const selected = item === value;
                return (
                  <button
                    key={item}
                    ref={(element) => {
                      if (element) optionRefs.current.set(item, element);
                      else optionRefs.current.delete(item);
                    }}
                    type="button"
                    role="menuitemradio"
                    aria-checked={selected}
                    title={item}
                    onClick={() => choose(item)}
                    onKeyDown={(event) => {
                      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                        event.preventDefault();
                        moveFocus(item, event.key === "ArrowDown" ? 1 : -1);
                      } else if (event.key === "Home" || event.key === "End") {
                        event.preventDefault();
                        const target = event.key === "Home" ? options[0] : options.at(-1);
                        if (target) optionRefs.current.get(target)?.focus();
                      }
                    }}
                    className={`flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left font-mono text-xs transition-colors hover:bg-gray-900 hover:text-white focus:bg-gray-900 focus:text-white focus:outline-none ${selected ? "bg-gray-900 text-white" : "text-gray-300"}`}
                  >
                    <span className="min-w-0 truncate">
                      {formatAssistantModelName(item)}
                    </span>
                    {selected ? (
                      <svg
                        className="h-3.5 w-3.5 shrink-0 text-white"
                        viewBox="0 0 20 20"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={1.8}
                        aria-hidden="true"
                      >
                        <path
                          d="m4.5 10.25 3.25 3.25 7.75-7.75"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ))}
        </ViewportPopover>
      ) : null}
    </div>
  );
}

function Spinner({ className = "w-4 h-4" }: { className?: string }) {
  return <BreadboardLoader className={className} />;
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
    status === "building_navigation" ||
    // A paused run still owns the garden: it can be resumed or stopped, but
    // nothing else may start while it holds its worker and lease.
    status === "paused"
  );
}

/** Phases the server will hold at a checkpoint. Scoped repair and publication
 * run as single atomic steps and offer Stop only. */
function isLearnPausable(status?: LearnStatus): boolean {
  return (
    status === "planning" ||
    status === "generating_learning_pages" ||
    status === "generating_textbook" ||
    status === "generating_visuals" ||
    status === "building_navigation"
  );
}

function hasRunningExternalAgent(message: Message): boolean {
  return (
    message.role === "assistant" &&
    Boolean(
      message.agentBrowserRun ||
      message.deepResearchRun ||
      message.maxResearchRun ||
      message.codexRun ||
      message.openCodeRun ||
      message.openPlanterRun ||
      message.agentReachRun ||
      message.getDocRun ||
      message.meetingNotesRun ||
      message.deepTutorRun ||
      message.careerOpsRun ||
      message.openExecutiveRun ||
      message.openGymRun ||
      message.tradingAgentsRun ||
      message.vibeTradingRun ||
      message.stockAnalystRun ||
      message.deerFlowRun ||
      message.socialsManagerRun ||
      message.hardwareBlueprintRun ||
      message.parametricCadRun ||
      message.hyperframesRun ||
      message.resource2SkillRun ||
      message.matraixRun ||
      message.boltSlidesRun ||
      message.classroomRun ||
      message.godsEyeRun ||
      message.openMontageRun ||
      message.openworkRun ||
      message.openscienceRun ||
      message.praxistRun ||
      message.inboxZeroRun ||
      message.vimaxRun ||
      message.voxDirectorRun ||
      message.moneyPrinterRun ||
      message.legalRun ||
      message.wardrobeRun ||
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
  /** What a blank chat greets with — resolved by the workspace, garden-aware. */
  greeting: ChatGreeting | null;
  greetingSuggestions: string[];
  /** An opener was picked: it fills the composer the workspace owns. */
  onSelectSuggestion: (prompt: string) => void;
  onGenerativeUiAction: (action: GenerativeUiAction) => void;
  activeProductComparison: {
    resourceId: string;
    productIds: readonly string[];
  } | null;
  chatSessionId: number | null;
  isStreaming: boolean;
  loadingChats: boolean;
  messages: Message[];
  gardenSourceAttachments: readonly GardenChatSourceAttachment[];
  activities: ActivityItem[];
  connection: ConnectionState;
  pendingPermission: PermissionPrompt | null;
  onPermissionDecision: (decision: "once" | "always" | "reject") => void;
  pendingClarification: ClarificationPrompt | null;
  onClarificationAnswer: (answer: string) => void;
  onEditMessage: (messageIndex: number, text: string) => void;
  /** Remove one exchange: this message and the answer it produced. */
  onDeleteMessage: (messageIndex: number) => void;
  onRetryAssistant: (messageIndex: number) => void;
  branchGroups: Record<string, ConversationBranchGroup<Message>>;
  onSwitchBranch: (groupId: string, direction: -1 | 1) => void;
  onExternalAgentTerminal: (
    runId: string,
    result: ExternalAgentTerminalResult,
  ) => void;
  /** Highlights and "Ask here" anchors, keyed by source message id. */
  annotationsByMessage: ReadonlyMap<string, ChatTextAnnotation[]>;
  /** Text was selected in an assistant message: offer the selection menu. */
  onTextSelection: (selection: ChatTextSelectionCandidate) => void;
  /** A painted highlight/answer anchor was clicked. */
  onOpenAnnotation: (annotationId: string, anchor: FloatingAnchorRect) => void;
  inlineArtifactRetireVersion: number;
  /**
   * A model-delegated worker is somewhere in its hand-off — queued behind the
   * turn that asked for it, starting, running, or finished and waiting to be
   * handed back. Passed in because for most of that span there is nothing in
   * the transcript to read it from: the run has no card, no chat connection,
   * and often no row of its own yet.
   */
  delegationInFlight: boolean;
  /** The scroller this transcript is drawn inside, owned by the workspace. */
  transcriptScrollRef: RefObject<HTMLElement | null>;
  transcriptVirtual: ChatVirtualBridge;
}

/**
 * A message paired with its position in the whole conversation. Rows that draw
 * nothing are dropped before they reach the virtualizer — a zero-height row
 * would still claim the spacing on both sides of itself — so the original index
 * has to travel with the message: editing, retrying, branching and the
 * newest-answer checks are all still expressed against it.
 */
type TranscriptRow = { index: number; message: Message };

/** Stable empty list so annotation-free rows keep their memoized markdown. */
const EMPTY_CHAT_ANNOTATIONS: readonly ChatTextAnnotation[] = [];

const transcriptRowKey = (row: TranscriptRow) =>
  chatRowKey(row.message, row.index);

const transcriptRowHeight = (row: TranscriptRow) =>
  estimateChatRowHeight(row.message, { minimum: 88 });

/**
 * The rows the virtualizer is given, in the order it draws them.
 *
 * Lifted out of the transcript because the message rail outside the scroller
 * has to speak the same indices: a tick names a *row*, and the hidden observer
 * turns dropped here are exactly what makes a row index differ from a message
 * index.
 */
function buildTranscriptRows(messages: readonly Message[]): TranscriptRow[] {
  const rows: TranscriptRow[] = [];
  const supersededDelegationAssistants =
    supersededDelegationAssistantIndices(messages);
  messages.forEach((storedMessage, index) => {
    // Only the hand-back is internal. The turn persists the flag on both of its
    // messages, so dropping every flagged row also dropped the answer the
    // person reads after a delegation — visible while it streamed, gone on the
    // next reload.
    if (
      (storedMessage.role === "user" &&
        storedMessage.internalAgentContinuation === true) ||
      (storedMessage.role === "user" &&
        isClarificationAnswerMessage(storedMessage)) ||
      // An "Ask here" turn is read inside its highlight's popover, not as
      // transcript rows.
      storedMessage.textSelection?.mode === "inline" ||
      supersededDelegationAssistants.has(index) ||
      (storedMessage.delegatedAgentRun === true &&
        !storedMessage.openGymRun &&
        !storedMessage.godsEyeRun &&
        messages[index + 1]?.internalAgentContinuation === true)
    ) {
      return;
    }
    rows.push({
      index,
      message:
        storedMessage.delegatedAgentRun === true
          ? {
              ...storedMessage,
              content: externalAgentCardContent(storedMessage),
            }
          : storedMessage,
    });
  });
  return rows;
}

const ChatTranscript = memo(function ChatTranscript({
  clusterName,
  clusterSlug,
  greeting,
  greetingSuggestions,
  onSelectSuggestion,
  onGenerativeUiAction,
  activeProductComparison,
  chatSessionId,
  isStreaming: turnStreaming,
  loadingChats,
  messages,
  gardenSourceAttachments,
  activities,
  connection,
  pendingPermission,
  onPermissionDecision,
  pendingClarification,
  onClarificationAnswer,
  onEditMessage,
  onDeleteMessage,
  onRetryAssistant,
  branchGroups,
  onSwitchBranch,
  onExternalAgentTerminal,
  annotationsByMessage,
  onTextSelection,
  onOpenAnnotation,
  inlineArtifactRetireVersion,
  delegationInFlight,
  transcriptScrollRef,
  transcriptVirtual,
}: ChatTranscriptProps) {
  // External launches show Thinking before their chat/run is marked streaming.
  // Keep response actions and the transcript busy for that preparation phase,
  // just as the terminal does for a submitting or connecting turn.
  const isStreaming =
    turnStreaming ||
    connection === "connecting" ||
    connection === "streaming" ||
    connection === "waiting";
  const copiedUserTimerRef = useRef<number | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [messageEditText, setMessageEditText] = useState("");
  const [copiedUserId, setCopiedUserId] = useState<string | null>(null);
  const [promptToSave, setPromptToSave] = useState<string | null>(null);
  const {
    confirm: confirmMessageDeletion,
    confirmDialog: messageDeleteDialog,
  } = useConfirmDialog();
  const lastAssistantIndex = messages.reduce(
    (lastIndex, message, index) =>
      message.role === "assistant" ? index : lastIndex,
    -1,
  );
  // Private worker cards remain mounted as runtime observers, but they are not
  // visible answers and must not take live status from the hand-off above.
  const lastVisibleAssistantIndex = messages.reduce(
    (lastIndex, message, index) =>
      message.role === "assistant" &&
      !(
        message.delegatedAgentRun === true &&
        !message.openGymRun &&
        !message.godsEyeRun
      )
        ? index
        : lastIndex,
    -1,
  );
  const newestAssistant =
    lastAssistantIndex >= 0 ? messages[lastAssistantIndex] : undefined;
  const newestAssistantVisibleContent = assistantVisibleContent(
    newestAssistant?.content ?? "",
  );
  const transcriptRevealKey = String(chatSessionId ?? "new");
  // The newest answer's text is revealed at a readable pace rather than drawn
  // straight from the buffer, so a reply that arrives in bursts (or whole)
  // still reads as a stream. Older messages render their content directly.
  const revealedAssistantContent = useSmoothStreamText(
    newestAssistantVisibleContent,
    isStreaming,
    transcriptRevealKey,
  );
  const timeSeparators = chatTimeSeparatorLabels(messages);

  // The worker result belongs to the hidden observer, not to the Super Agent's
  // visible assistant message — resolved there so a row's measured height and
  // its drawn height come from the same text.
  const transcriptRows = buildTranscriptRows(messages);

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

  /** The sibling answers this one shares a user message with, if any. */
  function branchForAssistant(
    message: Message,
    messageIndex: number,
  ): ConversationBranchGroup<Message> | null {
    if (message.role !== "assistant") return null;
    const userIndex = previousUserMessageIndex(messages, messageIndex);
    if (userIndex < 0) return null;
    const groupId =
      message.branchGroupId ?? messageBranchId(messages[userIndex], userIndex);
    const group = branchGroups[groupId];
    return group && group.variants.length > 1 ? group : null;
  }

  function saveMessageEdit(messageIndex: number) {
    const text = messageEditText.trim();
    if (!text) return;
    setEditingMessageId(null);
    setMessageEditText("");
    onEditMessage(messageIndex, text);
  }

  async function deleteMessageTurn(messageIndex: number) {
    if (isStreaming) return;
    const confirmed = await confirmMessageDeletion({
      title: "Delete this message?",
      body: "The message and the answer it produced will be permanently removed from this chat. This cannot be undone.",
      confirmLabel: "Delete message",
    });
    if (!confirmed) return;
    onDeleteMessage(messageIndex);
  }

  // The artifact query is part of opening a chat. Keeping this cover outside
  // the provider prevents any message row from painting before its file cards
  // can mount from the warmed cache in that same reveal.
  if (loadingChats) {
    return (
      <div className="flex items-center justify-center py-28 text-gray-700">
        <Spinner className="h-5 w-5" />
      </div>
    );
  }

  return (
    <InlineArtifactCardsProvider
      legacyChatSessionId={chatSessionId}
      gardenSlug={clusterSlug}
      retireVersion={inlineArtifactRetireVersion}
    >
      {/* w-full is load-bearing, not decoration: auto inline margins cancel a
        flex item's stretch, so this column is sized to its content — and every
        transcript row is absolutely positioned by the virtualizer, which
        contributes no content width at all. Without it the column collapses to
        zero and each message is drawn at its min-content width, one word per
        line, down the middle of the pane. */}
      <div className="w-full max-w-5xl mx-auto flex flex-col gap-6">
        {messages.length === 0 ? (
          // The same greeting empty state the terminals draw, with this
          // garden's name in its questions and openers. The Save page hint —
          // the one thing the old heading said that mattered — survives as
          // the footnote.
          <div className="py-16">
            <ChatGreetingEmptyState
              greeting={greeting}
              suggestions={greetingSuggestions}
              onSelectSuggestion={onSelectSuggestion}
              footnote={
                <>
                  After the conversation, hit{" "}
                  <span className="text-gray-500">Save page</span> to keep the
                  answer in your lessons
                </>
              }
            />
          </div>
        ) : null}

        {transcriptRows.length > 0 ? (
          <VirtualizedMessageList
            surface="garden-chat"
            className="w-full"
            items={transcriptRows}
            scrollRef={transcriptScrollRef}
            bridge={transcriptVirtual}
            // What `gap-6` drew between rows.
            gap={24}
            resetKey={chatSessionId}
            getItemKey={transcriptRowKey}
            estimateSize={transcriptRowHeight}
            renderItem={({ message: msg, index: i }) => {
              const messageInteractionId = msg.id ?? `user-message-${i}`;
              const externalRun =
                msg.agentBrowserRun ??
                msg.deepResearchRun ??
                msg.maxResearchRun ??
                msg.codexRun ??
                msg.openCodeRun ??
                msg.openPlanterRun ??
                msg.agentReachRun ??
                msg.getDocRun ??
                msg.meetingNotesRun ??
                msg.deepTutorRun ??
                msg.careerOpsRun ??
                msg.openExecutiveRun ??
                msg.openGymRun ??
                msg.tradingAgentsRun ??
                msg.vibeTradingRun ??
                msg.stockAnalystRun ??
                msg.deerFlowRun ??
                msg.socialsManagerRun ??
                msg.hardwareBlueprintRun ??
                msg.parametricCadRun ??
                msg.hyperframesRun ??
                msg.resource2SkillRun ??
                msg.matraixRun ??
                msg.boltSlidesRun ??
                msg.classroomRun ??
                msg.godsEyeRun ??
                msg.openMontageRun ??
                msg.openworkRun ??
                msg.openscienceRun ??
                msg.praxistRun ??
                msg.inboxZeroRun ??
                msg.vimaxRun ??
                msg.voxDirectorRun ??
                msg.moneyPrinterRun ??
                msg.legalRun ??
                msg.wardrobeRun ??
                msg.shortsRun ??
                msg.formsmithRun ??
                msg.videoUseRun ??
                msg.rufloRun;
              const isAgentContinuationResponse = Boolean(
                msg.role === "assistant" &&
                  messages[i - 1]?.internalAgentContinuation === true,
              );
              const continuationPreamble =
                delegatedContinuationPreamble(messages, i);
              const thinkingUpdates = delegatedThinkingUpdates(
                msg,
                continuationPreamble,
              );
              // Every earlier phase is hidden behind this row, so their time
              // belongs to this clock. Counting only the adjacent worker still
              // loses the Super Agent's orchestration phase.
              const carriedDurationMs =
                delegatedTurnCarriedDurationMs(messages, i);
              // The hidden phases' tokens are part of what this answer cost.
              const totalUsage = delegatedTurnTotalUsage(
                messages,
                i,
                msg.usage,
              );
              const storedAssistantContent = assistantVisibleContent(
                msg.content,
              );
              const visibleAssistantContent =
                i === lastAssistantIndex
                  ? revealedAssistantContent
                  : storedAssistantContent;
              const visibleUserContent = visibleChatMessageText(
                msg.content,
                msg.attachments,
                msg.attachmentNames,
              );
              // The hidden workers this row delegated to: the only record of
              // how the hand-off ended. Stopped or failed with no hand-back
              // used to read exactly like a finished answer.
              const delegatedWorkers = delegatedWorkersForMessage(messages, i);
              const delegatedWorkerOutcome =
                delegatedWorkersOutcome(delegatedWorkers);
              const delegatedAgentCompleted =
                delegatedAgentOutcomeLabelForMessage(
                  msg,
                  delegatedWorkerOutcome,
                ) ?? delegatedAgentCompletedLabelForMessage(msg);
              const delegatedAgentStartedAt =
                delegatedAgentStartedAtForMessage(msg);
              // A delegated worker owns no visible card, so this row is the
              // only sign the turn is still going — and it has to hold that
              // sign across the whole hand-off, not just the part with a run
              // row behind it. `delegationInFlight` covers the launch that has
              // not produced a run yet and the result not yet handed back;
              // both used to settle this row into its past tense and stop its
              // timer while the work carried on.
              const delegatedAgentActive =
                Boolean(
                  msg.delegatedAgentPreamble &&
                    externalRun &&
                    (msg.externalAgentOutcome ?? "running") === "running",
                ) ||
                (i === lastVisibleAssistantIndex && delegationInFlight) ||
                delegatedWorkerOutcome === "running";
              // Past tense while it runs read as an answer that had stopped
              // mid-thought.
              const delegatedAgentLabel = delegatedAgentActive
                ? delegatedAgentActivityLabelForMessage(msg) ??
                  delegatedAgentCompleted
                : delegatedAgentCompleted;
              // A row a hand-back has superseded never reaches this map —
              // buildTranscriptRows drops it — so the note is only ever for the
              // row that nothing followed.
              const delegatedOutcomeNote = !delegatedAgentActive
                ? delegatedWorkersOutcomeNote(delegatedWorkers)
                : undefined;
              const focusedSlugSet = new Set(msg.focusedDocumentSlugs ?? []);
              const focusedNameSet = new Set(msg.focusedDocumentNames ?? []);
              const focusedSourceAttachments = gardenSourceAttachments.filter(
                (source) =>
                  focusedSlugSet.has(source.slug) ||
                  (focusedSlugSet.size === 0 &&
                    [source.name, ...(source.aliases ?? [])].some((name) =>
                      focusedNameSet.has(name),
                    )),
              );
              return (
                <div className="flex w-full flex-col gap-3">
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
                          sourceAttachments={focusedSourceAttachments}
                          attachmentNames={[
                            ...new Set([
                              ...(msg.attachmentNames ?? []),
                              ...(msg.focusedDocumentNames ?? []),
                            ]),
                          ]}
                        />
                        <ChatVideoLinkEmbeds
                          text={msg.content}
                          attachments={msg.attachments}
                        />
                        {visibleUserContent ? (
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
                                onChange={(event) =>
                                  setMessageEditText(event.target.value)
                                }
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
                                  Math.max(
                                    2,
                                    messageEditText.split("\n").length,
                                  ),
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
                                  disabled={
                                    isStreaming || !messageEditText.trim()
                                  }
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
                              {msg.textSelection ? (
                                <QuotedChatSelection
                                  selection={msg.textSelection}
                                />
                              ) : null}
                              <div className="neu-chat-message neu-chat-message-user w-fit max-w-full rounded-2xl rounded-tr-sm px-4 py-3 text-sm">
                                <CollapsibleUserMessage
                                  messageKey={messageInteractionId}
                                >
                                  {splitLeadingCommandTokens(visibleUserContent) ? (
                                    <UserMessageText content={visibleUserContent} />
                                  ) : (
                                    <ChatMarkdown content={visibleUserContent} compact />
                                  )}
                                </CollapsibleUserMessage>
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
                                      <rect
                                        x="8"
                                        y="8"
                                        width="11"
                                        height="11"
                                        rx="2"
                                      />
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
                                    beginMessageEdit(msg, messageInteractionId)
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
                                <button
                                  type="button"
                                  onClick={() => deleteMessageTurn(i)}
                                  disabled={isStreaming}
                                  className="rounded-md p-1.5 text-[var(--ink-muted)] transition hover:bg-[var(--paper-strong)] hover:text-[var(--danger)] disabled:cursor-not-allowed disabled:opacity-35"
                                  title="Delete message"
                                  aria-label="Delete this message and its answer"
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
                                      d="M4 7h16M10 7V5.5A1.5 1.5 0 0 1 11.5 4h1A1.5 1.5 0 0 1 14 5.5V7m-7 0 .8 11.2A2 2 0 0 0 9.8 20h4.4a2 2 0 0 0 2-1.8L17 7"
                                    />
                                  </svg>
                                </button>
                              </div>
                            </>
                          )
                        ) : null}
                      </div>
                    ) : (
                      <div className="bb-garden-assistant-response flex w-full max-w-[90%] flex-col gap-2">
                        {/* Keep every response-owned surface in the same reading
                            lane as the prose. Artifact cards, generated UI, and
                            inline run widgets otherwise stretch to the full
                            virtualized row even though the answer stops at 90%. */}
                        <MessageActionsSlot
                          responseStartedAt={msg.createdAt}
                          responseDurationMs={msg.responseDurationMs}
                          responseCompletedAt={msg.responseCompletedAt}
                        >
                          {msg.delegatedAgentPreamble &&
                          !msg.openGymRun &&
                          !msg.godsEyeRun ? (
                            <ActivityPanel
                              activities={[]}
                              progressNotes={thinkingUpdates}
                              reasoning={msg.thinking}
                              answerContent={msg.content}
                              connection={
                                delegatedAgentActive ? "streaming" : "idle"
                              }
                              pendingPermission={null}
                              usage={msg.usage}
                              responseDurationMs={msg.responseDurationMs}
                              activePhaseStartedAt={delegatedAgentStartedAt}
                              onPermissionDecision={onPermissionDecision}
                              stateLabel={delegatedAgentLabel}
                              completedLabel={delegatedAgentCompleted}
                            />
                          ) : null}
                          {delegatedOutcomeNote ? (
                            <div
                              className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--ink-muted)]"
                              role="status"
                              data-testid="delegated-worker-outcome"
                            >
                              <span>{delegatedOutcomeNote}</span>
                              {!externalRun && !isStreaming ? (
                                <button
                                  type="button"
                                  onClick={() => onRetryAssistant(i)}
                                  className="rounded-full border border-[var(--line)] px-2.5 py-0.5 text-xs font-medium text-[var(--ink)] transition-colors hover:bg-[var(--paper-strong)]"
                                >
                                  Retry
                                </button>
                              ) : null}
                            </div>
                          ) : null}
                          {!externalRun ? (
                            <ActivityPanel
                              activities={
                                i === lastAssistantIndex ? activities : []
                              }
                              progressNotes={thinkingUpdates}
                              reasoning={msg.thinking}
                              answerContent={msg.content}
                              connection={
                                // A worker running behind this row keeps it
                                // alive even though the chat connection is
                                // idle: the turn is not over until its
                                // delegation is.
                                delegatedAgentActive
                                  ? "streaming"
                                  : i === lastAssistantIndex
                                    ? connection
                                    : "idle"
                              }
                              pendingPermission={
                                i === lastAssistantIndex
                                  ? pendingPermission
                                  : null
                              }
                              pendingClarification={
                                i === lastAssistantIndex
                                  ? pendingClarification
                                  : null
                              }
                              usage={totalUsage}
                              responseDurationMs={msg.responseDurationMs}
                              responseStartedAt={
                                delegatedAgentActive ||
                                isAgentContinuationResponse
                                  ? undefined
                                  : msg.createdAt
                              }
                              // The delegation's own clock, so the timer
                              // carries on from the turn instead of restarting.
                              activePhaseStartedAt={delegatedAgentStartedAt}
                              carriedDurationMs={carriedDurationMs}
                              onPermissionDecision={onPermissionDecision}
                              onClarificationAnswer={onClarificationAnswer}
                              completedLabel={delegatedAgentLabel}
                              stateLabel={
                                delegatedAgentActive && delegatedAgentLabel
                                  ? delegatedAgentLabel
                                  : isAgentContinuationResponse
                                    ? i === lastAssistantIndex && isStreaming
                                      ? "Synthesizing research"
                                      : "Research synthesized"
                                    : undefined
                              }
                            />
                          ) : null}
                          {externalRun ? (
                            <div
                              className={
                                msg.delegatedAgentRun &&
                                !msg.openGymRun &&
                                !msg.godsEyeRun
                                  ? "hidden"
                                  : "contents"
                              }
                              aria-hidden={
                                (msg.delegatedAgentRun &&
                                  !msg.openGymRun &&
                                  !msg.godsEyeRun) ||
                                undefined
                              }
                            >
                              {msg.agentBrowserRun ? (
                                <InlineAgentBrowserRun
                                  agentId={msg.agentBrowserRun.agentId}
                                  runId={msg.agentBrowserRun.runId}
                                  task={msg.agentBrowserRun.task}
                                  signInSurface="garden_chat"
                                  signInSessionId={chatSessionId}
                                  persistedContent={msg.content}
                                  persistedOutcome={msg.externalAgentOutcome}
                                  onRetry={
                                    i === lastAssistantIndex && !isStreaming
                                      ? () => onRetryAssistant(i)
                                      : undefined
                                  }
                                  onTerminal={(result) =>
                                    onExternalAgentTerminal(
                                      msg.agentBrowserRun!.runId,
                                      result,
                                    )
                                  }
                                />
                              ) : msg.maxResearchRun ? (
                                <InlineMaxResearchRun
                                  runId={msg.maxResearchRun.runId}
                                  query={msg.maxResearchRun.query}
                                  persistedContent={msg.content}
                                  persistedOutcome={msg.externalAgentOutcome}
                                  persistedDurationMs={msg.responseDurationMs}
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
                                    onExternalAgentTerminal(
                                      msg.deepResearchRun!.runId,
                                      result,
                                    )
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
                                  persistedUsage={msg.usage}
                                  onRetry={
                                    i === lastAssistantIndex && !isStreaming
                                      ? () => onRetryAssistant(i)
                                      : undefined
                                  }
                                  onTerminal={(result) =>
                                    onExternalAgentTerminal(
                                      msg.codexRun!.runId,
                                      result,
                                    )
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
                                  persistedUsage={msg.usage}
                                  onRetry={
                                    i === lastAssistantIndex && !isStreaming
                                      ? () => onRetryAssistant(i)
                                      : undefined
                                  }
                                  onTerminal={(result) =>
                                    onExternalAgentTerminal(
                                      msg.openCodeRun!.runId,
                                      result,
                                    )
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
                                    onExternalAgentTerminal(
                                      msg.openPlanterRun!.runId,
                                      result,
                                    )
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
                                    onExternalAgentTerminal(
                                      msg.agentReachRun!.runId,
                                      result,
                                    )
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
                                    onExternalAgentTerminal(
                                      msg.deepTutorRun!.runId,
                                      result,
                                    )
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
                                    onExternalAgentTerminal(
                                      msg.meetingNotesRun!.runId,
                                      result,
                                    )
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
                                    onExternalAgentTerminal(
                                      msg.getDocRun!.runId,
                                      result,
                                    )
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
                                    onExternalAgentTerminal(
                                      msg.tradingAgentsRun!.runId,
                                      result,
                                    )
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
                                    onExternalAgentTerminal(
                                      msg.vibeTradingRun!.runId,
                                      result,
                                    )
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
                                    onExternalAgentTerminal(
                                      msg.stockAnalystRun!.runId,
                                      result,
                                    )
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
                                    onExternalAgentTerminal(
                                      msg.deerFlowRun!.runId,
                                      result,
                                    )
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
                                    onExternalAgentTerminal(
                                      msg.careerOpsRun!.runId,
                                      result,
                                    )
                                  }
                                />
                              ) : msg.openExecutiveRun ? (
                                <InlineOpenExecutiveRun
                                  runId={msg.openExecutiveRun.runId}
                                  task={msg.openExecutiveRun.task}
                                  persistedContent={msg.content}
                                  persistedOutcome={msg.externalAgentOutcome}
                                  onRetry={
                                    i === lastAssistantIndex && !isStreaming
                                      ? () => onRetryAssistant(i)
                                      : undefined
                                  }
                                  onTerminal={(result) =>
                                    onExternalAgentTerminal(
                                      msg.openExecutiveRun!.runId,
                                      result,
                                    )
                                  }
                                />
                              ) : msg.openGymRun ? (
                                <InlineOpenGymRun
                                  runId={msg.openGymRun.runId}
                                  task={msg.openGymRun.task}
                                  quiet={
                                    msg.openGymRun.quiet === true ||
                                    msg.delegatedAgentRun === true
                                  }
                                  persistedContent={externalAgentCardContent(msg)}
                                  persistedOutcome={msg.externalAgentOutcome}
                                  onRetry={
                                    i === lastAssistantIndex && !isStreaming
                                      ? () => onRetryAssistant(i)
                                      : undefined
                                  }
                                  onTerminal={(result) =>
                                    onExternalAgentTerminal(msg.openGymRun!.runId, result)
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
                                    onExternalAgentTerminal(
                                      msg.socialsManagerRun!.runId,
                                      result,
                                    )
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
                                    onExternalAgentTerminal(
                                      msg.hardwareBlueprintRun!.runId,
                                      result,
                                    )
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
                                    onExternalAgentTerminal(
                                      msg.parametricCadRun!.runId,
                                      result,
                                    )
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
                                    onExternalAgentTerminal(
                                      msg.hyperframesRun!.runId,
                                      result,
                                    )
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
                                    onExternalAgentTerminal(
                                      msg.resource2SkillRun!.runId,
                                      result,
                                    )
                                  }
                                />
                              ) : msg.matraixRun ? (
                                <InlineMatraixRun
                                  runId={msg.matraixRun.runId}
                                  brief={msg.matraixRun.brief}
                                  persistedContent={msg.content}
                                  persistedOutcome={msg.externalAgentOutcome}
                                  persistedUsage={msg.usage}
                                  onRetry={
                                    i === lastAssistantIndex && !isStreaming
                                      ? () => onRetryAssistant(i)
                                      : undefined
                                  }
                                  onTerminal={(result) =>
                                    onExternalAgentTerminal(
                                      msg.matraixRun!.runId,
                                      result,
                                    )
                                  }
                                />
                              ) : msg.godsEyeRun ? (
                                <InlineGodsEyeRun
                                  runId={msg.godsEyeRun.runId}
                                  task={msg.godsEyeRun.task}
                                  quiet={
                                    msg.godsEyeRun.quiet === true ||
                                    msg.delegatedAgentRun === true
                                  }
                                  persistedContent={msg.content}
                                  persistedOutcome={msg.externalAgentOutcome}
                                  persistedUsage={msg.usage}
                                  onRetry={
                                    i === lastAssistantIndex && !isStreaming
                                      ? () => onRetryAssistant(i)
                                      : undefined
                                  }
                                  onTerminal={(result) =>
                                    onExternalAgentTerminal(
                                      msg.godsEyeRun!.runId,
                                      result,
                                    )
                                  }
                                />
                              ) : msg.classroomRun ? (
                                <InlineClassroomRun
                                  runId={msg.classroomRun.runId}
                                  brief={msg.classroomRun.brief}
                                  persistedContent={msg.content}
                                  persistedOutcome={msg.externalAgentOutcome}
                                  persistedUsage={msg.usage}
                                  onRetry={
                                    i === lastAssistantIndex && !isStreaming
                                      ? () => onRetryAssistant(i)
                                      : undefined
                                  }
                                  onTerminal={(result) =>
                                    onExternalAgentTerminal(
                                      msg.classroomRun!.runId,
                                      result,
                                    )
                                  }
                                />
                              ) : msg.boltSlidesRun ? (
                                <InlineBoltSlidesRun
                                  runId={msg.boltSlidesRun.runId}
                                  brief={msg.boltSlidesRun.brief}
                                  persistedContent={msg.content}
                                  persistedOutcome={msg.externalAgentOutcome}
                                  persistedUsage={msg.usage}
                                  onRetry={
                                    i === lastAssistantIndex && !isStreaming
                                      ? () => onRetryAssistant(i)
                                      : undefined
                                  }
                                  onTerminal={(result) =>
                                    onExternalAgentTerminal(
                                      msg.boltSlidesRun!.runId,
                                      result,
                                    )
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
                                    onExternalAgentTerminal(
                                      msg.openMontageRun!.runId,
                                      result,
                                    )
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
                                    onExternalAgentTerminal(
                                      msg.openworkRun!.runId,
                                      result,
                                    )
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
                                    onExternalAgentTerminal(
                                      msg.openscienceRun!.runId,
                                      result,
                                    )
                                  }
                                />
                              ) : msg.praxistRun ? (
                                <InlinePraxistRun
                                  runId={msg.praxistRun.runId}
                                  task={msg.praxistRun.task}
                                  persistedContent={msg.content}
                                  persistedOutcome={msg.externalAgentOutcome}
                                  onRetry={
                                    i === lastAssistantIndex && !isStreaming
                                      ? () => onRetryAssistant(i)
                                      : undefined
                                  }
                                  onTerminal={(result) =>
                                    onExternalAgentTerminal(
                                      msg.praxistRun!.runId,
                                      result,
                                    )
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
                                    onExternalAgentTerminal(
                                      msg.inboxZeroRun!.runId,
                                      result,
                                    )
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
                                    onExternalAgentTerminal(
                                      msg.vimaxRun!.runId,
                                      result,
                                    )
                                  }
                                />
                              ) : msg.voxDirectorRun ? (
                                <InlineVoxDirectorRun
                                  runId={msg.voxDirectorRun.runId}
                                  brief={msg.voxDirectorRun.brief}
                                  persistedContent={msg.content}
                                  persistedOutcome={msg.externalAgentOutcome}
                                  persistedUsage={msg.usage}
                                  onRetry={
                                    i === lastAssistantIndex && !isStreaming
                                      ? () => onRetryAssistant(i)
                                      : undefined
                                  }
                                  onTerminal={(result) =>
                                    onExternalAgentTerminal(
                                      msg.voxDirectorRun!.runId,
                                      result,
                                    )
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
                                    onExternalAgentTerminal(
                                      msg.moneyPrinterRun!.runId,
                                      result,
                                    )
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
                                    onExternalAgentTerminal(
                                      msg.legalRun!.runId,
                                      result,
                                    )
                                  }
                                />
                              ) : msg.wardrobeRun ? (
                                <InlineWardrobeRun
                                  runId={msg.wardrobeRun.runId}
                                  task={msg.wardrobeRun.task}
                                  persistedContent={msg.content}
                                  persistedOutcome={msg.externalAgentOutcome}
                                  onRetry={
                                    i === lastAssistantIndex && !isStreaming
                                      ? () => onRetryAssistant(i)
                                      : undefined
                                  }
                                  onTerminal={(result) =>
                                    onExternalAgentTerminal(
                                      msg.wardrobeRun!.runId,
                                      result,
                                    )
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
                                    onExternalAgentTerminal(
                                      msg.shortsRun!.runId,
                                      result,
                                    )
                                  }
                                />
                              ) : msg.formsmithRun ? (
                                <InlineFormsmithRun
                                  runId={msg.formsmithRun.runId}
                                  task={msg.formsmithRun.task}
                                  persistedContent={externalAgentCardContent(
                                    msg,
                                  )}
                                  persistedOutcome={msg.externalAgentOutcome}
                                  onTerminal={(result) =>
                                    onExternalAgentTerminal(
                                      msg.formsmithRun!.runId,
                                      result,
                                    )
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
                                    onExternalAgentTerminal(
                                      msg.videoUseRun!.runId,
                                      result,
                                    )
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
                                    onExternalAgentTerminal(
                                      msg.rufloRun!.runId,
                                      result,
                                    )
                                  }
                                />
                              ) : null}
                            </div>
                          ) : visibleAssistantContent ? (
                            <div className="w-full text-sm leading-relaxed text-gray-200">
                              <SelectableAssistantMarkdown
                                content={visibleAssistantContent}
                                sourceMessageId={messageSelectionSourceId(
                                  msg,
                                  i,
                                )}
                                annotations={
                                  annotationsByMessage.get(
                                    messageSelectionSourceId(msg, i),
                                  ) ?? EMPTY_CHAT_ANNOTATIONS
                                }
                                onSelection={onTextSelection}
                                onOpenAnnotation={onOpenAnnotation}
                              />
                            </div>
                          ) : null}
                          {msg.uiResources?.length ? (
                            <GenerativeUiRenderer
                              resources={msg.uiResources}
                              onAction={onGenerativeUiAction}
                              activeProductComparison={activeProductComparison}
                            />
                          ) : null}
                          {chatSessionId ? (
                            <InlineArtifactCards
                              ownerMessageId={
                                msg.artifactMessageId ?? msg.id ?? null
                              }
                            />
                          ) : null}
                          {!externalRun &&
                          !delegatedAgentActive &&
                          !visibleAssistantContent && !msg.uiResources?.length && !msg.artifactMessageId &&
                          i === lastAssistantIndex && !isStreaming && (connection === "idle" || connection === "error") ? (
                            <InlineArtifactEmptyState ownerMessageId={msg.artifactMessageId ?? msg.id ?? null}>
                              <AssistantResponseNotice kind={connection === "error" ? "failed" : "empty"} onRetry={() => onRetryAssistant(i)} />
                            </InlineArtifactEmptyState>
                          ) : null}
                          {!externalRun &&
                          !delegatedAgentActive &&
                          !visibleAssistantContent.trim() &&
                          !(isStreaming && i === lastAssistantIndex) ? (() => {
                            const branch = branchForAssistant(msg, i);
                            return branch ? <AssistantResponseBranchNavigation branch={{
                              current: branch.activeIndex + 1,
                              total: branch.variants.length,
                              onPrevious: () => onSwitchBranch(branch.id, -1),
                              onNext: () => onSwitchBranch(branch.id, 1),
                            }} /> : null;
                          })() : null}
                          {!externalRun &&
                          !delegatedAgentActive &&
                          Boolean(visibleAssistantContent.trim()) &&
                          !(isStreaming && i === lastAssistantIndex) ? (
                            <AssistantMessageActions
                              content={
                                msg.content ||
                                "Response unavailable"
                              }
                              verification={msg.verification}
                              branch={(() => {
                                const branch = branchForAssistant(msg, i);
                                return branch
                                  ? {
                                      current: branch.activeIndex + 1,
                                      total: branch.variants.length,
                                      onPrevious: () =>
                                        onSwitchBranch(branch.id, -1),
                                      onNext: () =>
                                        onSwitchBranch(branch.id, 1),
                                    }
                                  : undefined;
                              })()}
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
            }}
          />
        ) : null}
        {chatSessionId ? (
          <div className="bb-garden-assistant-response w-full max-w-[90%]">
            <InlineArtifactCards ownerMessageId={null} />
          </div>
        ) : null}
      </div>
      {promptToSave !== null ? (
        <SavePromptDialog
          content={promptToSave}
          onClose={() => setPromptToSave(null)}
        />
      ) : null}
      {messageDeleteDialog}
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
  initialChatId = null,
  initialLearnPanelOpen = false,
  isOwner = true,
  clusterVisibility,
  chatAccessible,
  forkAllowed,
  showNavbarFlowers,
}: Props) {
  const router = useRouter();
  const { toasts, addToast, dismissToast, dismissChatToasts, dismissLearnToasts } = useToast();
  // Every artifact entry point in this workspace—archive rows and inline chat
  // cards alike—opens into one overlay bounded by the workspace body. Keeping
  // the host below the header prevents the viewer from covering Garden nav.

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
  const [mediaExpanded, setMediaExpanded] = useState(false);
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [mediaDialogOpen, setMediaDialogOpen] = useState(false);
  const [artifactsExpanded, setArtifactsExpanded] = useState(false);
  const [savedLinks, setSavedLinks] = useState<SavedLinkInfo[]>([]);
  const [linksLoading, setLinksLoading] = useState(true);
  const [newLinkTitle, setNewLinkTitle] = useState("");
  const [newLinkUrl, setNewLinkUrl] = useState("");
  const [savingLink, setSavingLink] = useState(false);
  const [linkImportTasks, setLinkImportTasks] = useState<LinkImportTask[]>([]);
  const [selectedLinkImportId, setSelectedLinkImportId] = useState<string | null>(
    null,
  );
  const [linkImportClock, setLinkImportClock] = useState(() => Date.now());
  const [deletingLinkId, setDeletingLinkId] = useState<string | null>(null);
  const [sourceDocSearch, setSourceDocSearch] = useState("");

  // Left chat sidebar: width is the single source of truth, dragged by the
  // rail's own edge and clicked by the same edge between the icon rail and
  // whatever width it was last opened to.
  //
  // Drag-to-any-width was taken off this sidebar once, because it could be left
  // at a width where the chat list was unreadable but still rendered. That is
  // the reason for the floor and the threshold rather than for having no drag
  // at all: nothing between the icon rail and a readable list is a width the
  // sidebar can be released at, so the failure has no room left to happen in.
  const rail = useRailResize({
    ...CHAT_RAIL_RESIZE,
    storageKey: RAIL_WIDTH_KEY,
    legacyCollapsedKey: RAIL_COLLAPSED_KEY,
  });
  const railCollapsed = rail.collapsed;
  // Which panel is open beside the transcript, and whether search is up.
  const [sidePanel, setSidePanel] = useState<TerminalPanel | null>(null);
  const [productPanel, setProductPanel] = useState<ProductPanelSelection | null>(
    null,
  );
  const [chatAttachments, setChatAttachments] = useState<ChatAttachment[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [railError, setRailError] = useState<string | null>(null);
  // The rail's deletes ask in the app's own sheet; `confirmDialog` is rendered
  // beside the other dialogs at the foot of the page.
  const { confirm: confirmDestructive, confirmDialog } = useConfirmDialog();
  const [unreadChats, setUnreadChats] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
  const chatActivity = useRef<ReadonlyMap<string, boolean>>(new Map());
  const latestAssistantVersions = useRef<ReadonlyMap<string, string | null>>(
    new Map(),
  );
  // A local response emits immediately; its next durable rail cursor is only
  // an acknowledgement of that notice and must not create a second one.
  const locallyAnnouncedChatResponses = useRef<Set<string>>(new Set());
  const unreadRestored = useRef(false);
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
  // The chat this rail minted out of its own blank state, so an unsent draft
  // can follow it there and nowhere else. See useChatDraft.
  const [createdChatId, setCreatedChatId] = useState<number | null>(null);
  const activeChatIdRef = useRef<number | null>(null);
  // A reply written in a background-answer notice is handed to the normal
  // composer pipeline after that exact chat becomes the selected transcript.
  const pendingNotificationReplyRef = useRef<{
    chatId: number;
    message: string;
  } | null>(null);
  const openedRequestedChatRef = useRef<string | null>(null);
  // `null` initially means "pick the newest persisted chat". After the user
  // presses New chat it means something different: keep a blank, unsaved
  // draft selected until its first turn creates the real row. A ref keeps
  // background history reconciliation from reopening the previous chat.
  const pendingNewChatRef = useRef(false);
  // The person's own words, held here for the one gap where there is nowhere
  // else to put them: a first turn on a blank chat has to POST
  // /api/chat-sessions before any message has a session to be stored under,
  // and every write below is keyed by session id. Waiting for that round trip
  // is what made a typed message appear seconds after it was sent. The draft
  // renders in that gap and is dropped as soon as the real transcript exists.
  const [draftMessages, setDraftMessages] = useState<Message[] | null>(null);
  // As in the Terminal rail, history responses that overlapped a rename are
  // stale by definition. Dropping them prevents a slow refresh from briefly
  // restoring the old title over the optimistic one.
  const chatHistoryEpoch = useRef(0);
  // A full-history response is allowed to refresh every idle transcript, but
  // never the one this tab is actively streaming. The server only has the
  // durable checkpoint until the detached runtime finishes, so replacing the
  // local copy here would make a live answer disappear while it is arriving.
  const inFlightChatMessagesRef = useRef<Map<number, Message[]>>(new Map());
  // Transcript PATCHes replace the whole legacy message list. Serialize them
  // per chat and version their UI commits so an older edit/save cannot land
  // after a newer turn and roll the visible transcript backwards.
  const chatPersistenceChainsRef = useRef<Map<number, Promise<boolean>>>(
    new Map(),
  );
  const chatPersistenceVersionsRef = useRef<Map<number, number>>(new Map());
  // Chats whose delete has been sent but not yet acknowledged. The epoch guard
  // above only drops answers to requests that were already in flight; a reload
  // that starts while a delete is working would still list the chat and put its
  // row back. These ids are held out of the list until the server answers.
  const deletingChatIds = useRef<Set<number>>(new Set());
  // Retrying an answer opens a sibling branch here exactly as it does in the
  // Terminal: the transcript being replaced is kept as a variant of the same
  // user message instead of being resent underneath it.
  const [branchGroups, setBranchGroups] = useState<
    Record<string, ConversationBranchGroup<Message>>
  >({});
  const [branchStorageChatId, setBranchStorageChatId] = useState<number | null>(
    null,
  );
  // A retried external-agent turn re-enters through the launchers, which append
  // to whatever the transcript holds. This is how they learn the retried turn
  // is being replaced rather than followed — the Terminal does the same thing
  // inside its session hook.
  const retryBranchRef = useRef<{
    chatId: number;
    historyLength: number;
  } | null>(null);
  const [inlineArtifactRetireVersion, setInlineArtifactRetireVersion] =
    useState(0);
  const [loadingChats, setLoadingChats] = useState(true);
  const [viewPublicChats, setViewPublicChats] = useState(false);
  // Renaming and delete confirmation live inside the rail: it owns the input
  // and freezes its own order while one is open, and it asks before deleting.
  const [isForking, setIsForking] = useState(false);
  const [input, setInput] = useState("");
  // Unsent text outlives a reload, filed under the chat it was typed in and the
  // garden that chat belongs to.
  const draftSurface = `garden_workspace:${clusterSlug}`;
  useChatDraft({
    surface: draftSurface,
    sessionId: activeChatId === null ? null : String(activeChatId),
    createdSessionId: createdChatId === null ? null : String(createdChatId),
    value: input,
    onRestore: setInput,
  });
  const [agentBrowserAgent, setAgentBrowserAgent] =
    useState<ExternalAgentSelection | null>(null);
  const [deepResearchAgent, setDeepResearchAgent] =
    useState<ExternalAgentSelection | null>(null);
  const [openCodeAgent, setOpenCodeAgent] =
    useState<ExternalAgentSelection | null>(null);
  const [codexAgent, setCodexAgent] = useState<ExternalAgentSelection | null>(
    null,
  );
  const [openPlanterAgent, setOpenPlanterAgent] =
    useState<ExternalAgentSelection | null>(null);
  const [agentReachAgent, setAgentReachAgent] =
    useState<ExternalAgentSelection | null>(null);
  const [getDocAgent, setGetDocAgent] = useState<ExternalAgentSelection | null>(
    null,
  );
  const [meetingNotesAgent, setMeetingNotesAgent] =
    useState<ExternalAgentSelection | null>(null);
  const [deepTutorAgent, setDeepTutorAgent] =
    useState<ExternalAgentSelection | null>(null);
  const [careerOpsAgent, setCareerOpsAgent] =
    useState<ExternalAgentSelection | null>(null);
  const [openExecutiveAgent, setOpenExecutiveAgent] =
    useState<ExternalAgentSelection | null>(null);
  const [tradingAgentsAgent, setTradingAgentsAgent] =
    useState<ExternalAgentSelection | null>(null);
  const [vibeTradingAgent, setVibeTradingAgent] =
    useState<ExternalAgentSelection | null>(null);
  const [stockAnalystAgent, setStockAnalystAgent] =
    useState<ExternalAgentSelection | null>(null);
  const [deerFlowAgent, setDeerFlowAgent] =
    useState<ExternalAgentSelection | null>(null);
  // A pasted /agents:trading-agent command pre-fills the request form; it never
  // starts a run, because a symbol and a date are not a sentence.
  const [tradingAgentsSeed, setTradingAgentsSeed] =
    useState<Partial<TradingAgentsRequest> | null>(null);
  const [shortsAgent, setShortsAgent] = useState<ExternalAgentSelection | null>(
    null,
  );
  const [formsmithAgent, setFormsmithAgent] =
    useState<ExternalAgentSelection | null>(null);
  // Same contract for Shorts: a pasted command pre-fills the form, and a video
  // still has to be chosen before anything runs.
  const [shortsSeed, setShortsSeed] = useState<Partial<ShortsRequest> | null>(
    null,
  );
  const [rufloAgent, setRufloAgent] = useState<ExternalAgentSelection | null>(
    null,
  );
  const [launchingExternalAgent, setLaunchingExternalAgent] = useState<
    | "agent-browser"
    | "deep-research"
    | "max-research"
    | "codex"
    | "opencode"
    | "openplanter"
    | "agent-reach"
    | "get-doc"
    | "meeting-notes"
    | "deep-tutor"
    | "career-ops"
    | "openexecutive"
    | "open-gym"
    | "trading-agent"
    | "vibe-trading"
    | "stock-analyst"
    | "deer-flow"
    | "hardware-blueprint"
    | "parametric-cad"
    | "hyperframes"
    | "resource2skill"
    | "matraix"
    | "bolt-slides"
    | "classroom"
    | "gods-eye"
    | "openmontage"
    | "openwork"
    | "openscience"
    | "praxist"
    | "inbox-zero"
    | "vimax"
    | "vox-director"
    | "money-printer"
    | "legal"
    | "wardrobe"
    | "shorts"
    | "formsmith"
    | "socials-manager"
    | "ruflo"
    | null
  >(null);
  const externalAgentLaunchRef = useRef<
    | "agent-browser"
    | "deep-research"
    | "max-research"
    | "codex"
    | "opencode"
    | "openplanter"
    | "agent-reach"
    | "get-doc"
    | "meeting-notes"
    | "deep-tutor"
    | "career-ops"
    | "openexecutive"
    | "open-gym"
    | "trading-agent"
    | "vibe-trading"
    | "stock-analyst"
    | "deer-flow"
    | "hardware-blueprint"
    | "parametric-cad"
    | "hyperframes"
    | "resource2skill"
    | "matraix"
    | "bolt-slides"
    | "classroom"
    | "gods-eye"
    | "openmontage"
    | "openwork"
    | "openscience"
    | "praxist"
    | "inbox-zero"
    | "vimax"
    | "vox-director"
    | "money-printer"
    | "legal"
    | "wardrobe"
    | "shorts"
    | "formsmith"
    | "socials-manager"
    | "ruflo"
    | null
  >(null);
  const openGymRoutingRef = useRef(false);
  const [externalAgentStatus, setExternalAgentStatus] = useState("");
  const [streamingChatIds, setStreamingChatIds] = useState<Set<number>>(
    () => new Set(),
  );
  const streamingChatIdsRef = useRef<Set<number>>(new Set());
  const setChatStreaming = useCallback((sessionId: number, active: boolean) => {
    const next = new Set(streamingChatIdsRef.current);
    if (active) next.add(sessionId);
    else {
      next.delete(sessionId);
      inFlightChatMessagesRef.current.delete(sessionId);
    }
    streamingChatIdsRef.current = next;
    setStreamingChatIds(next);
  }, []);
  const agentActivity = useLegacyAgentActivity();
  const activeGardenTurnRef = useRef<{
    sessionId: number;
    clientMessageId: string;
    conversationId: string | null;
  } | null>(null);
  const stopActiveGardenTurn = useCallback(async () => {
    const turn = activeGardenTurnRef.current;
    await Promise.all([
      agentActivity.abort(turn?.conversationId),
      turn
        ? abortGardenTurnCheckpoint(turn.sessionId, turn.clientMessageId)
        : Promise.resolve(),
    ]);
  }, [agentActivity]);
  // The Thinking an external agent launch raises the moment its turn goes up.
  // It is owned by the launch rather than by any one runtime request, so it is
  // held here and put down wherever the launch's real rows land.
  const externalTurnSignalRef = useRef<AbortSignal | null>(null);
  const finishAgentActivity = agentActivity.finish;
  const settleExternalTurnActivity = useCallback(
    (failed = false) => {
      const signal = externalTurnSignalRef.current;
      if (!signal) return;
      externalTurnSignalRef.current = null;
      finishAgentActivity(failed, signal);
    },
    [finishAgentActivity],
  );
  // Every launcher clears `launchingExternalAgent` in its `finally`, so this is
  // the one place that catches a launch which ended without committing rows —
  // a bail-out before the run, or an error reported as status text instead of a
  // turn. Without it Thinking would shimmer on a row nothing is going to fill.
  useEffect(() => {
    if (launchingExternalAgent !== null) return;
    settleExternalTurnActivity();
  }, [launchingExternalAgent, settleExternalTurnActivity]);
  useEffect(() => {
    activeChatIdRef.current = activeChatId;
  }, [activeChatId]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const handleGenerativeUiAction = useCallback(
    (action: GenerativeUiAction) => {
      const product = productForAction(action);
      if (!product) return;

      if (action.type === "product.find-similar") {
        setInput(`Find products similar to ${product.title} from ${product.merchant}.`);
        setProductPanel(null);
        setChatAttachments((current) =>
          current.filter((attachment) => attachment.type !== "product"),
        );
        window.setTimeout(() => textareaRef.current?.focus(), 0);
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
            compareProductIds:
              current?.resource.id === action.resource.id
                ? current.compareProductIds
                : [],
          };
        }
        const prior = current?.resource.id === action.resource.id
          ? current.compareProductIds
          : [];
        const compareProductIds = prior.includes(action.productId)
          ? prior.filter((id) => id !== action.productId)
          : [...prior, action.productId].slice(-2);
        return {
          resource: action.resource,
          productId: action.productId,
          compareProductIds,
        };
      });
    },
    [],
  );
  useEffect(() => {
    if (!productPanel) return;
    const selectedProducts = productPanel.compareProductIds.flatMap((productId) => {
      const product = productForResource(productPanel.resource, productId);
      return product
        ? [{ type: "product" as const, name: product.title, product }]
        : [];
    });
    setChatAttachments((current) => [
      ...current.filter((attachment) => attachment.type !== "product"),
      ...selectedProducts,
    ]);
  }, [productPanel]);
  // The same greeting engine the terminals use, told which garden it is
  // standing in, so a blank garden chat opens on words about this garden
  // rather than a fixed heading.
  const greetingGarden = useMemo(
    () => ({ name: clusterName, slug: clusterSlug }),
    [clusterName, clusterSlug],
  );
  const chatGreeting = useChatGreeting({
    scope: "mine",
    temporary: false,
    garden: greetingGarden,
  });
  // An opener is a starting point, not a message: it fills the composer and
  // puts the caret at the end, the same contract the terminals settled on.
  const fillComposerWithPrompt = useCallback((prompt: string) => {
    setInput(prompt);
    window.setTimeout(() => {
      const composer = textareaRef.current;
      if (!composer) return;
      composer.focus();
      composer.setSelectionRange(composer.value.length, composer.value.length);
    }, 0);
  }, []);
  const activeSteerContextRef = useRef<{
    sessionId: number;
    messages: Message[];
  } | null>(null);

  useEffect(() => {
    const apply = ({ artifact, prompt }: ArtifactAiEditDetail) => {
      if (!artifact?.id || artifact.gardenId !== clusterSlug) return;
      setInput(
        `${interactiveVisualizerCommandForArtifact(artifact)}${prompt}`,
      );
      requestAnimationFrame(() => textareaRef.current?.focus());
    };
    const listener = (raw: Event) => apply((raw as CustomEvent<ArtifactAiEditDetail>).detail);
    const queued = consumeArtifactAiEdit({ surface: "garden_chat", gardenId: clusterSlug });
    const timer = queued ? window.setTimeout(() => apply(queued), 0) : null;
    window.addEventListener(ARTIFACT_AI_EDIT_EVENT, listener);
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      window.removeEventListener(ARTIFACT_AI_EDIT_EVENT, listener);
    };
  }, [clusterSlug]);

  // Upload modal
  const [showUpload, setShowUpload] = useState(false);
  // The upload dialog prints each file's failure under the file itself. While
  // it is open, a corner notice would only repeat what the person is reading;
  // an upload continued in the background is the case that needs one.
  const showUploadRef = useRef(false);
  useEffect(() => {
    showUploadRef.current = showUpload;
  }, [showUpload]);
  // Upload tasks live in a module-level store so they keep running and stay
  // visible when this page unmounts; navigation must never lose an upload.
  const allUploadTasks = useSyncExternalStore(
    subscribeGardenUploads,
    gardenUploadTasksSnapshot,
    gardenUploadTasksServerSnapshot,
  );
  const uploadTasks = useMemo(
    () => allUploadTasks.filter((task) => task.clusterSlug === clusterSlug),
    [allUploadTasks, clusterSlug],
  );
  const [selectedUploadTaskId, setSelectedUploadTaskId] = useState<string | null>(null);
  const selectedUploadTaskIdRef = useRef<string | null>(null);
  useEffect(() => {
    selectedUploadTaskIdRef.current = selectedUploadTaskId;
  }, [selectedUploadTaskId]);
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [uploadLabel, setUploadLabel] = useState("");
  const [isHandwriting, setIsHandwriting] = useState(false);
  const [parseWithVlm, setParseWithVlm] = useState(false);
  const [parseWithAnydoc, setParseWithAnydoc] = useState(false);
  const [generateMap, setGenerateMap] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const isUploading = uploadTasks.some((task) => task.state === "uploading");
  const [uploadClock, setUploadClock] = useState(() => Date.now());
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Chat attachments (per-message, sent directly to the AI)
  const [extractingAttachments, setExtractingAttachments] = useState(false);
  /** What a blocking document distillation is doing right now, or null. */
  const [attachmentDistillStatus, setAttachmentDistillStatus] = useState<
    string | null
  >(null);
  const chatFileInputRef = useRef<HTMLInputElement>(null);

  // Garden note generation
  const [isGenerating, setIsGenerating] = useState(false);

  // Learn pipeline
  const [learnState, setLearnState] = useState<LearnStatusResponse | null>(
    null,
  );
  const learnStatusClusterRef = useRef(clusterSlug);
  learnStatusClusterRef.current = clusterSlug;
  const learnStatusRequestRef = useRef<{
    clusterSlug: string;
    controller: AbortController;
    promise: Promise<LearnStatusResponse | null>;
  } | null>(null);
  const [learnBusy, setLearnBusy] = useState(false);
  const [learnCancelBusy, setLearnCancelBusy] = useState(false);
  const [learnPauseBusy, setLearnPauseBusy] = useState(false);
  // Set when the server rejects generation because the confirmed Learning Map
  // itself is unusable. Read by the primary action, which plans again rather
  // than leaving the Learn button permanently rejected.
  const learnRequiresReplanRef = useRef(false);
  const [learnPanelOpen, setLearnPanelOpen] = useState(initialLearnPanelOpen);
  const [gardenSettingsOpen, setGardenSettingsOpen] = useState(false);
  const [learnConfirmationAction, setLearnConfirmationAction] =
    useState<LearnDestructiveAction | null>(null);
  const [learnSourceOnly, setLearnSourceOnly] = useState(true);
  const [learnSkipManualReview, setLearnSkipManualReview] = useState(false);
  const [humanizerEnabled, setHumanizerEnabled] = useHumanizerMode();
  const [learnHumanizerRequestBusy, setLearnHumanizerRequestBusy] =
    useState(false);
  const previousHumanizerPreferenceRef = useRef(humanizerEnabled);
  const pendingFinishedLearnHumanizerRef = useRef<boolean | null>(null);
  const [learnIncludedSourceSlugs, setLearnIncludedSourceSlugs] = useState<
    string[] | null
  >(null);
  const [learnDocumentMenuOpen, setLearnDocumentMenuOpen] = useState(false);
  const learnDocumentMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  // Syllabus: the document Learn treats as the course study guide rather than as
  // subject matter. null means "no syllabus".
  const [learnSyllabusSlug, setLearnSyllabusSlug] = useState<string | null>(
    null,
  );
  const [learnSyllabusMenuOpen, setLearnSyllabusMenuOpen] = useState(false);
  const learnSyllabusMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const [learnSyllabusUploading, setLearnSyllabusUploading] = useState(false);
  // "I want to learn everything introductory about electronics" — a syllabus
  // written to order, for learners who have material but no course outline.
  const [learnSyllabusPrompt, setLearnSyllabusPrompt] = useState("");
  const [learnSyllabusGenerating, setLearnSyllabusGenerating] = useState(false);
  const learnSyllabusInputRef = useRef<HTMLInputElement | null>(null);
  const [learnUserInstruction, setLearnUserInstruction] = useState("");
  const [learnUserInstructionDraft, setLearnUserInstructionDraft] =
    useState("");
  const [learnUserInstructionOpen, setLearnUserInstructionOpen] =
    useState(false);
  const learnUserInstructionButtonRef = useRef<HTMLButtonElement | null>(null);
  const learnUserInstructionInputRef = useRef<HTMLTextAreaElement | null>(null);
  const [learnTimerNowMs, setLearnTimerNowMs] = useState(() => Date.now());
  const learnSkipManualReviewRef = useRef(false);
  const lastSyncedLearnSelectionRef = useRef<string | null>(null);
  const lastSyncedLearnSyllabusRef = useRef<string | null>(null);
  const autoConfirmingLearnJobRef = useRef<string | null>(null);
  const previousLearnHumanizerStatusRef = useRef<
    LearnHumanizerStatus | undefined
  >(undefined);
  const {
    model,
    setModel,
    reasoningEffort,
    setReasoningEffort,
    intelligenceModes,
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
      const detail = (
        raw as CustomEvent<{
          gardenId?: string;
          folder?: string;
        }>
      ).detail;
      if (detail?.gardenId !== clusterSlug) return;
      if (detail.folder) {
        setExpandedFolders((current) => new Set(current).add(detail.folder!));
      }
      setGraphRefreshVersion((current) => current + 1);
      void fetchDocuments();
    };
    window.addEventListener(
      GARDEN_DOCUMENTS_CHANGED_EVENT,
      handleGardenDocumentsChanged,
    );
    return () =>
      window.removeEventListener(
        GARDEN_DOCUMENTS_CHANGED_EVENT,
        handleGardenDocumentsChanged,
      );
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

  useEffect(() => {
    const refresh = (event: Event) => {
      if ((event as CustomEvent<{ gardenId?: string }>).detail?.gardenId !== clusterSlug) return;
      void fetchDocuments();
      void fetchSavedLinks();
      setGraphRefreshVersion((value) => value + 1);
    };
    window.addEventListener(GARDEN_SOURCE_IMPORTED_EVENT, refresh);
    return () => window.removeEventListener(GARDEN_SOURCE_IMPORTED_EVENT, refresh);
  }, [clusterSlug, fetchDocuments, fetchSavedLinks]);

  const fetchLearnStatus = useCallback((): Promise<LearnStatusResponse | null> => {
    const existing = learnStatusRequestRef.current;
    if (
      existing?.clusterSlug === clusterSlug &&
      !existing.controller.signal.aborted
    ) {
      return existing.promise;
    }
    existing?.controller.abort();

    const controller = new AbortController();
    const promise = (async () => {
      try {
        const res = await fetch(
          `/api/gardens/${encodeURIComponent(clusterSlug)}/learn/status`,
          { signal: controller.signal },
        );
        const data = (await res.json().catch(() => ({}))) as LearnStatusResponse;
        if (
          res.ok &&
          !controller.signal.aborted &&
          learnStatusClusterRef.current === clusterSlug
        ) {
          setLearnState(data);
          return data;
        }
      } catch {
        // Status polling should never interrupt the workspace.
      } finally {
        if (learnStatusRequestRef.current?.controller === controller) {
          learnStatusRequestRef.current = null;
        }
      }
      return null;
    })();
    learnStatusRequestRef.current = { clusterSlug, controller, promise };
    return promise;
  }, [clusterSlug]);

  useEffect(() => {
    const controller = new AbortController();
    for (const stored of runtimeIngestRecoveries(clusterSlug)) {
      // An upload loop still running in the module store owns this record;
      // attaching here too would double-stream and double-report the job.
      if (hasLiveGardenUploadRequest(stored.requestId)) continue;
      void (async () => {
        let record = stored;
        if (record.cancelRequested) {
          await cancelPendingRuntimeIngest(record.requestId, {
            signal: controller.signal,
          });
          const current = runtimeIngestRecoveryRecord(record.requestId);
          if (current && !current.jobId) {
            return;
          }
          if (!current) {
            await fetchDocuments();
            return;
          }
          record = current;
        }
        const outcome = await recoverRuntimeIngest(
          record,
          (event) => {
            if (event.type === "result") {
              if (record.purpose === "syllabus" && typeof event.slug === "string") {
                setLearnSyllabusSlug(event.slug);
                setLearnIncludedSourceSlugs((current) =>
                  current?.filter((slug) => slug !== event.slug) ?? null,
                );
              }
            } else if (
              event.type === "error" &&
              event.canceled !== true &&
              typeof event.error === "string"
            ) {
              if (!showUploadRef.current) {
                addToast(`${record.filename}: ${event.error}`);
              }
            }
          },
          { signal: controller.signal },
        );
        if (outcome?.terminalEvent) {
          await fetchDocuments();
          void fetchLearnStatus();
          setGraphRefreshVersion((value) => value + 1);
        }
      })().catch(() => undefined);
    }
    return () => controller.abort();
  }, [addToast, clusterSlug, fetchDocuments, fetchLearnStatus]);

  // Hand the module-level upload engine this page's notification and refresh
  // hooks while mounted. Toasts raised while the page was away are delivered
  // on registration.
  useEffect(() => {
    return registerGardenUploadSink(clusterSlug, {
      addToast: (toast) => addToast(toast.message, toast.type, toast.title),
      refreshAfterFile: () => {
        void fetchDocuments();
        setGraphRefreshVersion((value) => value + 1);
      },
      refreshAfterTask: () => {
        void fetchDocuments();
        void fetchLearnStatus();
        setSourceDocsExpanded(true);
        setGraphRefreshVersion((value) => value + 1);
      },
      isTaskStatusVisible: (taskId) =>
        showUploadRef.current && selectedUploadTaskIdRef.current === taskId,
    });
  }, [addToast, clusterSlug, fetchDocuments, fetchLearnStatus]);

  const switchFinishedLearnHumanizer = useCallback(
    async (enabled: boolean) => {
      const versionId = learnState?.latestTextbookVersionId;
      if (
        !versionId ||
        learnHumanizerRequestBusy ||
        isLearnActive(learnState?.job?.status)
      ) {
        return;
      }
      setLearnHumanizerRequestBusy(true);
      try {
        const res = await fetch(
          `/api/gardens/${encodeURIComponent(clusterSlug)}/learn/humanizer`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ enabled, expectedVersionId: versionId }),
          },
        );
        const data = (await res.json().catch(() => ({}))) as
          LearnStatusResponse & { error?: string; accepted?: boolean };
        if (!res.ok || data.error) {
          throw new Error(data.error ?? "Could not switch the finished Learn copy");
        }
        if (data.accepted === true) {
          await fetchLearnStatus();
          return;
        }
        setLearnState(data);
        await fetchDocuments();
        setGraphRefreshVersion((value) => value + 1);
        addToast(
          enabled
            ? "Finished lessons rewritten naturally"
            : "Switched lessons back to the AI copy",
          "success",
        );
      } catch (error) {
        await fetchLearnStatus();
        addToast(
          error instanceof Error
            ? error.message
            : "Could not switch the finished Learn copy",
        );
      } finally {
        setLearnHumanizerRequestBusy(false);
      }
    },
    [
      addToast,
      clusterSlug,
      fetchDocuments,
      fetchLearnStatus,
      learnHumanizerRequestBusy,
      learnState?.job?.status,
      learnState?.latestTextbookVersionId,
    ],
  );

  useEffect(() => {
    if (previousHumanizerPreferenceRef.current !== humanizerEnabled) {
      previousHumanizerPreferenceRef.current = humanizerEnabled;
      pendingFinishedLearnHumanizerRef.current = humanizerEnabled;
    }
    const desired = pendingFinishedLearnHumanizerRef.current;
    if (
      desired === null ||
      !learnState?.latestTextbookVersionId ||
      learnHumanizerRequestBusy ||
      isLearnActive(learnState?.job?.status) ||
      learnState?.job?.status === "awaiting_confirmation" ||
      learnState?.humanizer?.status === "running" ||
      learnState?.humanizer?.status === "restoring_ai"
    ) {
      return;
    }
    pendingFinishedLearnHumanizerRef.current = null;
    void switchFinishedLearnHumanizer(desired);
  }, [
    humanizerEnabled,
    learnHumanizerRequestBusy,
    learnState?.humanizer?.status,
    learnState?.job?.status,
    learnState?.latestTextbookVersionId,
    switchFinishedLearnHumanizer,
  ]);

  useEffect(() => {
    void fetchLearnStatus();
    return () => {
      const request = learnStatusRequestRef.current;
      if (request?.clusterSlug === clusterSlug) {
        learnStatusRequestRef.current = null;
        request.controller.abort();
      }
    };
  }, [clusterSlug, fetchLearnStatus]);

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
    const instruction = learnState?.job?.userInstruction?.trim();
    if (!instruction) return;
    setLearnUserInstruction(instruction);
    if (!learnUserInstructionOpen) {
      setLearnUserInstructionDraft(instruction);
    }
  }, [
    learnState?.job?.id,
    learnState?.job?.userInstruction,
    learnUserInstructionOpen,
  ]);

  useEffect(() => {
    if (!learnUserInstructionOpen) return;
    const frame = window.requestAnimationFrame(() => {
      learnUserInstructionInputRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [learnUserInstructionOpen]);

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
      isLearnActive(learnState?.job?.status) ||
      learnState?.humanizer?.status === "running" ||
      learnState?.humanizer?.status === "restoring_ai" ||
      learnHumanizerRequestBusy ||
      learnBusy ||
      learnCancelBusy;
    if (!active) return;
    void fetchLearnStatus();
    const id = window.setInterval(() => {
      void fetchLearnStatus();
    }, 2000);
    return () => window.clearInterval(id);
  }, [
    fetchLearnStatus,
    learnBusy,
    learnCancelBusy,
    learnHumanizerRequestBusy,
    learnState?.humanizer?.status,
    learnState?.job?.status,
  ]);

  useEffect(() => {
    const current = learnState?.humanizer?.status;
    const previous = previousLearnHumanizerStatusRef.current;
    previousLearnHumanizerStatusRef.current = current;
    if (previous !== "running" && previous !== "restoring_ai") return;
    if (current === "running" || current === "restoring_ai") return;
    if (current === "failed") {
      addToast(
        learnState?.humanizer?.error ||
          "The finished Learn copy could not be switched",
      );
      return;
    }
    void fetchDocuments();
    setGraphRefreshVersion((value) => value + 1);
    addToast(
      current === "humanized"
        ? "Finished lessons rewritten naturally"
        : "Switched lessons back to the AI copy",
      "success",
    );
  }, [
    addToast,
    fetchDocuments,
    learnState?.humanizer?.error,
    learnState?.humanizer?.status,
  ]);

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
      const sessions = ((data.sessions ?? []) as ChatSession[]).filter(
        (session) => !deletingChatIds.current.has(session.id),
      );
      if (chatHistoryEpoch.current !== epoch) return;
      setChatSessions((previous) => {
        // The rail's marks come from its own feed and are not in this answer,
        // so whatever it already established stays put.
        const cached = new Map(previous.map((item) => [item.id, item]));
        return sessions.map((session) => ({
          ...session,
          messages:
            inFlightChatMessagesRef.current.get(session.id) ?? session.messages,
          pinned: cached.get(session.id)?.pinned ?? false,
          highlight: cached.get(session.id)?.highlight ?? null,
          active: session.active ?? cached.get(session.id)?.active ?? false,
        }));
      });
      // Landing on the newest chat because the list loaded is not a creation:
      // whatever is in the composer belongs to the blank chat it was typed in,
      // not to this one.
      setCreatedChatId(null);
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

  /**
   * Re-read one server-owned transcript without loading every chat in the
   * garden. This is the return/reload path for a detached Garden run: its user
   * checkpoint is visible immediately, and its finalized answer replaces that
   * checkpoint as soon as the background pump persists it.
   */
  const refreshChatSession = useCallback(async (sessionId: number) => {
    try {
      const params = new URLSearchParams({
        clusterSlug,
        sessionId: String(sessionId),
      });
      if (canViewPublicChats && viewPublicChats)
        params.set("includePublicChats", "1");
      const res = await fetch(`/api/chat-sessions?${params.toString()}`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = (await res.json()) as { sessions?: ChatSession[] };
      const refreshed = data.sessions?.[0];
      if (!refreshed || deletingChatIds.current.has(refreshed.id)) return;
      setChatSessions((previous) =>
        previous.map((session) => {
          if (session.id !== refreshed.id) return session;
          const inFlight = inFlightChatMessagesRef.current.get(refreshed.id);
          return {
            ...refreshed,
            messages: inFlight ?? refreshed.messages,
            pinned: session.pinned ?? false,
            highlight: session.highlight ?? null,
          };
        }),
      );
    } catch {
      // The rail keeps polling. A transient reconciliation failure must not
      // turn a healthy background run into a visible chat error.
    }
  }, [canViewPublicChats, clusterSlug, viewPublicChats]);

  /**
   * The rail's own feed: rows only, polled.
   *
   * A different request from the full read above on purpose — that one carries
   * every message of every chat, which is affordable when a garden opens and
   * not at all every ten seconds. This one answers with the title, the time,
   * and the three marks the rail draws: pinned, highlighted, working.
   */
  const refreshRail = useCallback(async () => {
    const epoch = chatHistoryEpoch.current;
    try {
      const params = new URLSearchParams({ clusterSlug, summary: "1" });
      if (canViewPublicChats && viewPublicChats)
        params.set("includePublicChats", "1");
      const res = await fetch(`/api/chat-sessions?${params.toString()}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error("Chats could not be loaded.");
      const data = (await res.json()) as { sessions?: ChatSessionSummary[] };
      if (chatHistoryEpoch.current !== epoch) return;
      const rows = Array.isArray(data.sessions) ? data.sessions : [];
      setChatSessions((previous) => {
        const cached = new Map(previous.map((item) => [item.id, item]));
        return rows.map((row) => ({
          // A chat whose transcript has not been read yet keeps one shared
          // empty array, so its identity is stable between polls.
          ...(cached.get(row.id) ?? { messages: NO_MESSAGES }),
          id: row.id,
          conversationId:
            row.conversationId ??
            cached.get(row.id)?.conversationId ??
            null,
          title: row.title,
          created_at: row.created_at,
          updated_at: row.updated_at,
          isOwn: row.isOwn,
          ownerUsername: row.ownerUsername,
          pinned: row.pinned,
          highlight: row.highlight,
          active: row.active,
        }));
      });
      setRailError(null);
    } catch {
      setRailError("Chats could not be loaded.");
    }
  }, [canViewPublicChats, clusterSlug, viewPublicChats]);

  useEffect(() => {
    // Once on arrival, so the marks are on the rows at first paint rather than
    // ten seconds into looking at them.
    void refreshRail();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshRail();
    }, 10_000);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void refreshRail();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [refreshRail]);

  // The rail's rows. Ids are strings because that is what the shared rail and
  // its search, upload and process controls all speak; this surface's chats are
  // numbered, so the number is carried as its own decimal string throughout.
  const sidebarChats: TerminalSidebarChat[] = chatSessions.map((session) => ({
    id: String(session.id),
    title: session.title,
    updatedAt: session.updated_at,
    // The poll is ten seconds behind a turn this tab is running, so a chat
    // streaming here speaks for itself.
    active: session.active === true || streamingChatIds.has(session.id),
    pinned: session.pinned === true,
    highlight: session.highlight ?? null,
    unread: unreadChats.has(String(session.id)),
  }));
  // The first turn creates the durable garden chat, but the draft already
  // represents a conversation to the person typing it. Show that selected row
  // immediately; sending replaces it with the real numbered chat.
  const pendingChatVisible =
    activeChatId === null && (input.trim().length > 0 || draftMessages !== null);
  const railChats: TerminalSidebarChat[] = pendingChatVisible
    ? [
        {
          id: PENDING_CHAT_ROW_ID,
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

  // A chat counts as read while its transcript is the one on screen.
  const viewingChatId = activeChatId === null ? null : String(activeChatId);

  useEffect(() => {
    if (!viewingChatId) return;
    recordLastOpenedChat(
      window.localStorage,
      "garden_chat",
      viewingChatId,
      clusterSlug,
    );
  }, [clusterSlug, viewingChatId]);

  useEffect(() => {
    setUnreadChats(readUnreadChats(window.localStorage, clusterSlug));
    unreadRestored.current = false;
    chatActivity.current = new Map();
    latestAssistantVersions.current = new Map();
    locallyAnnouncedChatResponses.current.clear();
  }, [clusterSlug]);

  // The rows are rebuilt on every render, so the pass below is keyed on what it
  // actually reads: which chats are working and which assistant message is
  // their newest durable answer.
  const latestAssistantVersionByChat = new Map(
    chatSessions.map((session) => [
      String(session.id),
      session.latestAssistantVersion ?? null,
    ]),
  );
  const railActivityKey = sidebarChats
    .map(
      (chat) =>
        `${chat.id}:${chat.active ? 1 : 0}:${latestAssistantVersionByChat.get(chat.id) ?? ""}`,
    )
    .join(",");

  const notifyFinishedGardenChat = useCallback(async (
    chatId: string,
    title: string,
  ) => {
    let response: string | undefined;
    try {
      const params = new URLSearchParams({
        clusterSlug,
        sessionId: chatId,
      });
      const result = await fetch(`/api/chat-sessions?${params.toString()}`, {
        cache: "no-store",
      });
      if (result.ok) {
        const data = (await result.json()) as { sessions?: ChatSession[] };
        response = latestAssistantResponse(data.sessions?.[0]?.messages ?? []);
      }
    } catch {
      // The completion itself is still worth announcing. Opening the chat will
      // load the transcript even if this small preview request was interrupted.
    }
    notifyChatResponseReady(title, {
      chatId,
      activeChatId: activeChatIdRef.current,
      response,
    });
  }, [clusterSlug]);

  // One pass per refresh of the rail: raise the dot on every chat that stopped
  // running out of sight, and take it off the one being read.
  useEffect(() => {
    const previousActive = chatActivity.current;
    chatActivity.current = chatActivityById(sidebarChats);
    const previousAssistantVersions = latestAssistantVersions.current;
    const currentAssistantVersions = new Map(
      sidebarChats.map((chat) => [
        chat.id,
        latestAssistantVersionByChat.get(chat.id) ?? null,
      ]),
    );
    latestAssistantVersions.current = currentAssistantVersions;
    for (const chat of sidebarChats) {
      const currentVersion = currentAssistantVersions.get(chat.id);
      const assistantChanged =
        previousAssistantVersions.has(chat.id) &&
        Boolean(currentVersion) &&
        previousAssistantVersions.get(chat.id) !== currentVersion;
      if (!assistantChanged) continue;
      if (locallyAnnouncedChatResponses.current.delete(chat.id)) continue;
      if (chat.active || chat.id === viewingChatId) continue;
      const session = chatSessions.find(
        (candidate) => String(candidate.id) === chat.id,
      );
      if (session?.isOwn === false) continue;
      // Detached/server-owned Garden turns can finish without the stream that
      // launched them still being mounted. The message cursor catches even a
      // fast turn that starts and finishes between two activity polls.
      void notifyFinishedGardenChat(chat.id, chat.title);
    }
    setUnreadChats((current) => {
      const next = nextUnreadChats({
        unread: current,
        previousActive,
        chats: sidebarChats,
        viewingChatId,
      });
      return sameChatIds(current, next) ? current : next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [railActivityKey, viewingChatId]);

  // A notice is only an invitation to visit an unseen answer. Selecting that
  // conversation by any route makes every notice belonging to it disappear.
  useEffect(() => {
    const target: ChatNotificationTarget | null = viewingChatId
      ? {
          surface: "garden_chat",
          gardenSlug: clusterSlug,
          chatId: viewingChatId,
        }
      : null;
    setActiveChatNotificationTarget(target);
    if (target) dismissChatToasts(target);
    return () => setActiveChatNotificationTarget(null);
  }, [clusterSlug, dismissChatToasts, viewingChatId]);

  // The Learn panel shows the run's stage, progress and outcome itself, so a
  // Learn notice for this Garden must not repeat it in the corner while the
  // panel is open. Closing the panel makes later updates announceable again.
  useEffect(() => {
    if (!learnPanelOpen) return;
    setActiveLearnNotificationGarden(clusterSlug);
    dismissLearnToasts(clusterSlug);
    return () => setActiveLearnNotificationGarden(null);
  }, [clusterSlug, dismissLearnToasts, learnPanelOpen]);

  useEffect(() => {
    if (!unreadRestored.current) {
      // The first commit carries the empty starting value rather than anything
      // that happened, and the restore above has not landed yet: writing it
      // would erase the dots this browser was still holding.
      unreadRestored.current = true;
      return;
    }
    writeUnreadChats(window.localStorage, unreadChats, clusterSlug);
  }, [unreadChats, clusterSlug]);

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

  /** Open a chat by the id every rail control hands back. */
  const openChatById = useCallback((chatId: string) => {
    const id = Number(chatId);
    if (!Number.isInteger(id)) return;
    dismissChatToasts({
      surface: "garden_chat",
      gardenSlug: clusterSlug,
      chatId,
    });
    pendingNewChatRef.current = false;
    setProductPanel(null);
    setSidePanel(null);
    setActiveChatId(id);
    // An existing chat, so nothing typed in the blank composer belongs to it.
    setCreatedChatId(null);
    setDraftMessages(null);
  }, [clusterSlug, dismissChatToasts]);

  useEffect(() => {
    const requested = initialChatId?.trim() ?? "";
    if (!requested || openedRequestedChatRef.current === requested) return;
    openedRequestedChatRef.current = requested;
    openChatById(requested);
  }, [initialChatId, openChatById]);

  const openChatFromNotification = useCallback((
    target: ChatNotificationTarget,
  ) => {
    if (target.gardenSlug !== clusterSlug) return false;
    if (target.surface === "garden_learn") {
      // A Learn notice for the Garden already on screen opens its panel in
      // place; navigating would only reload the page to arrive here.
      setLearnPanelOpen(true);
      return true;
    }
    if (target.surface !== "garden_chat") return false;
    openChatById(target.chatId);
    return true;
  }, [clusterSlug, openChatById]);

  // The server names a chat from its first prompt, the same way it names a
  // Terminal one. The Terminal sees that name arrive through its history poll;
  // this rail loads once, so pull the names back after a first turn instead.
  // Only titles are merged: replacing the whole session list would drop the
  // in-flight transcript of any chat still streaming in another tab of the rail.
  const refreshChatTitles = useCallback(async () => {
    const epoch = chatHistoryEpoch.current;
    try {
      const params = new URLSearchParams({ clusterSlug });
      if (canViewPublicChats && viewPublicChats)
        params.set("includePublicChats", "1");
      const res = await fetch(`/api/chat-sessions?${params.toString()}`);
      if (!res.ok) return;
      const data = await res.json();
      const sessions = (data.sessions ?? []) as ChatSession[];
      // A rename or delete that landed while this was in flight owns the title
      // now, exactly as it does for the full reload above.
      if (chatHistoryEpoch.current !== epoch) return;
      const titles = new Map(
        sessions.map((session) => [session.id, session.title]),
      );
      setChatSessions((previous) =>
        previous.map((session) => {
          const title = titles.get(session.id);
          return title && title !== session.title
            ? { ...session, title }
            : session;
        }),
      );
    } catch {
      // An unnamed chat is cosmetic; the next load of the rail picks it up.
    }
  }, [canViewPublicChats, clusterSlug, viewPublicChats]);

  useEffect(() => {
    fetchChatSessions();
  }, [fetchChatSessions]);
  useEffect(() => {
    if (!canViewPublicChats) setViewPublicChats(false);
  }, [canViewPublicChats]);

  const activeChat = chatSessions.find((s) => s.id === activeChatId) ?? null;
  const persistedMessages = activeChat?.messages ?? EMPTY_MESSAGES;
  // The draft only ever stands in for an empty transcript, so a real message
  // arriving retires it without a frame where both could be on screen.
  const showingDraft = persistedMessages.length === 0 && draftMessages !== null;
  const messages = useMemo(() => {
    const selectedMessages =
      showingDraft && draftMessages ? draftMessages : persistedMessages;
    // On a reopened tab the browser no longer owns the original response
    // stream, but the rail can prove the durable runtime is still active. Draw
    // the same pending assistant row from the last user's original timestamp
    // so Thinking continues instead of looking interrupted or restarting.
    const lastSelectedMessage = selectedMessages.at(-1);
    const recoveredAssistantMessage: Message | null =
      activeChat?.active === true && lastSelectedMessage?.role === "user"
        ? {
            role: "assistant",
            content: "",
            createdAt: lastSelectedMessage.createdAt,
            sources: [],
            thinking: "",
          }
        : null;
    return recoveredAssistantMessage
      ? [...selectedMessages, recoveredAssistantMessage]
      : selectedMessages;
  }, [activeChat?.active, draftMessages, persistedMessages, showingDraft]);
  useEffect(() => {
    retryBranchRef.current = null;
    if (activeChatId === null) {
      setBranchGroups({});
      setBranchStorageChatId(null);
      return;
    }
    setBranchGroups(loadBranchGroups(activeChatId));
    setBranchStorageChatId(activeChatId);
  }, [activeChatId]);

  useEffect(() => {
    if (activeChatId === null || branchStorageChatId !== activeChatId) return;
    try {
      window.localStorage.setItem(
        `${BRANCH_STORAGE_PREFIX}${activeChatId}`,
        JSON.stringify(branchGroups),
      );
    } catch {
      // Branch switching still works for this page even if storage is full.
    }
  }, [activeChatId, branchGroups, branchStorageChatId]);

  // Selecting a chat is enough to ask for its artifacts; waiting for the
  // transcript to mount its cards is what made them appear a beat late.
  const inlineArtifactsReady = useInlineArtifactPrefetch({
    legacyChatSessionId: activeChatId,
    gardenSlug: clusterSlug,
  });
  const visibleChatJustCreated =
    activeChatId !== null && activeChatId === createdChatId;
  const chatContentLoading =
    loadingChats || (!visibleChatJustCreated && !inlineArtifactsReady);
  const hasRunningExternalAgentInActiveChat = messages.some(
    hasRunningExternalAgent,
  );
  // Agent selection/health checks happen before the concrete launcher's flag
  // rises. Keep the originating assistant turn active across that whole gap.
  const [delegatedAgentLaunching, setDelegatedAgentLaunching] = useState(false);
  const [pendingImmediateInlineQuestion, setPendingImmediateInlineQuestion] =
    useState<{
      chatId: number | null;
      question: string;
      selection: ChatTextSelectionReference;
    } | null>(null);
  const [stoppingForInlineQuestion, setStoppingForInlineQuestion] =
    useState(false);
  const [inlineSelectionRunId, setInlineSelectionRunId] = useState<
    string | null
  >(null);
  // A drafted turn is already under way even though no session id exists yet
  // to mark as streaming, so the thinking row comes up with the message rather
  // than after the chat has been created.
  const chatTurnStreaming =
    showingDraft ||
    (activeChatId !== null && streamingChatIds.has(activeChatId)) ||
    activeChat?.active === true;
  const isStreaming =
    chatTurnStreaming || hasRunningExternalAgentInActiveChat;
  const respondingToInlineSelection =
    chatTurnStreaming &&
    (inlineSelectionRunId !== null ||
      messages.at(-1)?.textSelection?.mode === "inline");
  // Inline answers live in their highlight cards. They must not seize the
  // transcript's follow mode or make the main dialogue look like it is the
  // surface producing the answer.
  const transcriptResponding = isStreaming && !respondingToInlineSelection;

  useEffect(() => {
    let pending = pendingNotificationReplyRef.current;
    if (
      !pending &&
      activeChatId !== null &&
      !chatContentLoading &&
      !isStreaming &&
      launchingExternalAgent === null
    ) {
      const message = takeChatNotificationReply(window.sessionStorage, {
        surface: "garden_chat",
        gardenSlug: clusterSlug,
        chatId: String(activeChatId),
      });
      if (message) pending = { chatId: activeChatId, message };
    }
    if (
      !pending ||
      pending.chatId !== activeChatId ||
      chatContentLoading ||
      isStreaming ||
      launchingExternalAgent !== null
    ) {
      return;
    }
    pendingNotificationReplyRef.current = null;
    void handleSubmit(pending.message);
    // `handleSubmit` reads the selected transcript from this render. Depending
    // on its new function identity would rerun this hand-off on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeChatId,
    chatContentLoading,
    clusterSlug,
    isStreaming,
    launchingExternalAgent,
  ]);
  const visibleAgentConnection: ConnectionState =
    activeChat?.active === true && agentActivity.connection === "idle"
      ? "streaming"
      : agentActivity.connection;
  const transcriptVirtual = useChatVirtualBridge();
  const composerInset = useComposerInset();
  const {
    ref: transcriptScrollRef,
    awayFromBottom: transcriptAwayFromBottom,
    scrollToBottom: jumpToNewestMessage,
  } = useChatAutoScroll<HTMLElement>({
    isResponding: transcriptResponding,
    responseKey: chatAutoScrollResponseKey(messages),
    contentKey: chatAutoScrollContentKey(messages),
    // Cached rows can arrive behind the loading state. Wait until the
    // transcript is mounted so opening a chat always has a bottom to land on.
    enabled: !chatContentLoading,
    conversationKey: activeChatId,
    virtual: transcriptVirtual,
  });

  // One tick per question asked. Ticks name rows, not messages, so they are read
  // off the same list the virtualizer draws — the observer turns it drops would
  // otherwise slide every tick after them onto the wrong message.
  const railItems = useMemo<ChatMessageRailItem[]>(
    () =>
      buildTranscriptRows(messages).flatMap((row, rowIndex) =>
        row.message.role === "user"
          ? [{ rowIndex, label: row.message.content }]
          : [],
      ),
    [messages],
  );

  // What the composer's arrow keys recall. Built off the drawn rows for the
  // same reason as the rail: pressing Up should only return sentences this
  // person actually typed, never a turn the app inserted on their behalf.
  const sentMessages = useMemo(
    () =>
      buildTranscriptRows(messages).flatMap((row) =>
        row.message.role === "user" ? [row.message.content] : [],
      ),
    [messages],
  );

  // ── Selected-text questions ("Ask in chat" / "Ask here") ───────────────────
  const [selectionMenu, setSelectionMenu] =
    useState<ChatTextSelectionCandidate | null>(null);
  const [composerSelection, setComposerSelection] =
    useState<ChatTextSelectionReference | null>(null);
  const [savedInlineSelections, setSavedInlineSelections] = useState<
    ChatTextSelectionReference[]
  >([]);
  const [savedChatHighlights, setSavedChatHighlights] = useState<
    SavedChatHighlight[]
  >([]);
  const [deletedInlineSelectionIds, setDeletedInlineSelectionIds] = useState<
    Set<string>
  >(() => new Set());
  const [selectionStorageChatId, setSelectionStorageChatId] = useState<
    number | null
  >(null);
  const [openInlineAnswers, setOpenInlineAnswers] = useState<Array<{
    id: string;
    anchor: FloatingAnchorRect;
  }>>([]);
  // A shared chat can be read but not asked into; the menu still highlights.
  const canAskSelection = activeChat?.isOwn !== false;

  useEffect(() => {
    setSelectionMenu(null);
    setComposerSelection(null);
    setPendingImmediateInlineQuestion(null);
    setInlineSelectionRunId(null);
    setOpenInlineAnswers([]);
    if (activeChatId === null) {
      setSavedInlineSelections([]);
      setSavedChatHighlights([]);
      setDeletedInlineSelectionIds(new Set());
      setSelectionStorageChatId(null);
      return;
    }
    const deletedIds = loadDeletedInlineSelectionIds(activeChatId);
    setDeletedInlineSelectionIds(deletedIds);
    setSavedInlineSelections(
      loadInlineSelections(activeChatId).filter(
        (selection) => !deletedIds.has(selection.id),
      ),
    );
    setSavedChatHighlights(loadChatHighlights(activeChatId));
    setSelectionStorageChatId(activeChatId);
  }, [activeChatId]);

  useEffect(() => {
    if (activeChatId === null || selectionStorageChatId !== activeChatId) {
      return;
    }
    try {
      window.localStorage.setItem(
        `${INLINE_SELECTION_STORAGE_PREFIX}${activeChatId}`,
        JSON.stringify(savedInlineSelections),
      );
      window.localStorage.setItem(
        `${DELETED_INLINE_SELECTION_STORAGE_PREFIX}${activeChatId}`,
        JSON.stringify([...deletedInlineSelectionIds]),
      );
      window.localStorage.setItem(
        `${CHAT_HIGHLIGHT_STORAGE_PREFIX}${activeChatId}`,
        JSON.stringify(savedChatHighlights),
      );
    } catch {
      // The message metadata still restores completed inline answers.
    }
  }, [
    activeChatId,
    deletedInlineSelectionIds,
    savedChatHighlights,
    savedInlineSelections,
    selectionStorageChatId,
  ]);

  // Selections persisted with their turns come back on reload even where
  // localStorage did not survive.
  useEffect(() => {
    const restored = messages.flatMap((message) => {
      const selection = normalizeChatTextSelectionReference(
        message.textSelection,
      );
      return selection?.mode === "inline" &&
        !deletedInlineSelectionIds.has(selection.id)
        ? [selection]
        : [];
    });
    if (restored.length === 0) return;
    setSavedInlineSelections((current) => {
      const next = new Map(
        current.map((selection) => [selection.id, selection]),
      );
      let changed = false;
      for (const selection of restored) {
        if (next.has(selection.id)) continue;
        next.set(selection.id, selection);
        changed = true;
      }
      return changed ? [...next.values()] : current;
    });
  }, [deletedInlineSelectionIds, messages]);

  const inlineSelectionThreads = useMemo(() => {
    const byId = new Map<string, InlineSelectionThread>();
    for (const selection of savedInlineSelections) {
      if (deletedInlineSelectionIds.has(selection.id)) continue;
      byId.set(selection.id, { selection, pending: false });
    }
    messages.forEach((message, messageIndex) => {
      // An answer reserved before the stream may not carry the selection
      // itself if the tab died mid-turn; adjacency to its question recovers
      // it, since a turn's two halves are always reserved together.
      const inherited =
        message.role === "assistant" &&
        messages[messageIndex - 1]?.role === "user"
          ? messages[messageIndex - 1]?.textSelection
          : undefined;
      const selection = message.textSelection ?? inherited;
      if (
        !selection ||
        selection.mode !== "inline" ||
        deletedInlineSelectionIds.has(selection.id)
      ) {
        return;
      }
      const current = byId.get(selection.id) ?? { selection, pending: false };
      if (message.role === "user") {
        current.question = message.content;
        // Pending from the moment the question is sent, not from the moment
        // its answer row exists, so a re-asked question never flashes its
        // predecessor's answer.
        if (isStreaming && messageIndex === messages.length - 1) {
          current.pending = true;
          current.answer = undefined;
          current.usage = undefined;
          current.responseDurationMs = undefined;
          current.startedAt = message.createdAt;
        }
      } else {
        current.answer = message.content || undefined;
        current.pending = isStreaming && messageIndex === messages.length - 1;
        current.usage = message.usage;
        current.responseDurationMs = message.responseDurationMs;
        current.startedAt = message.createdAt;
        current.answerMessageId = messageSelectionSourceId(
          message,
          messageIndex,
        );
      }
      byId.set(selection.id, current);
    });
    return byId;
  }, [deletedInlineSelectionIds, isStreaming, messages, savedInlineSelections]);

  const annotationsByMessage = useMemo(() => {
    const byMessage = new Map<string, ChatTextAnnotation[]>();
    for (const thread of inlineSelectionThreads.values()) {
      const entries = byMessage.get(thread.selection.sourceMessageId) ?? [];
      entries.push({ ...thread.selection, kind: "answer" });
      byMessage.set(thread.selection.sourceMessageId, entries);
    }
    for (const highlight of savedChatHighlights) {
      const entries = byMessage.get(highlight.sourceMessageId) ?? [];
      entries.push({ ...highlight, kind: "highlight", color: highlight.color });
      byMessage.set(highlight.sourceMessageId, entries);
    }
    return byMessage;
  }, [inlineSelectionThreads, savedChatHighlights]);

  const selectionIsHighlighted = Boolean(
    selectionMenu &&
      savedChatHighlights.some(
        (highlight) =>
          highlight.sourceMessageId === selectionMenu.sourceMessageId &&
          chatTextSelectionsOverlap(highlight, selectionMenu),
      ),
  );
  const selectionHighlightColor = selectionMenu
    ? savedChatHighlights.find(
        (highlight) =>
          highlight.sourceMessageId === selectionMenu.sourceMessageId &&
          chatTextSelectionsOverlap(highlight, selectionMenu),
      )?.color
    : undefined;

  const receiveTextSelection = useCallback(
    (selection: ChatTextSelectionCandidate) => {
      if (chatContentLoading) return;
      const overlapping = (
        annotationsByMessage.get(selection.sourceMessageId) ?? []
      ).find((annotation) => chatTextSelectionsOverlap(annotation, selection));
      if (overlapping?.kind === "answer") {
        setSelectionMenu(null);
        const thread = inlineSelectionThreads.get(overlapping.id);
        setOpenInlineAnswers((current) => {
          const parentIndex = current.findIndex(
            (openAnswer) =>
              inlineSelectionThreads.get(openAnswer.id)?.answerMessageId ===
              thread?.selection.sourceMessageId,
          );
          return parentIndex >= 0
            ? [
                ...current.slice(0, parentIndex + 1),
                { id: overlapping.id, anchor: selection.anchor },
              ]
            : [{ id: overlapping.id, anchor: selection.anchor }];
        });
        window.getSelection()?.removeAllRanges();
        return;
      }
      // A selection made inside the open "Ask here" answer keeps its popover
      // on screen: the menu floats above the very answer it is about, which
      // is what lets a follow-up be asked from an answer, recursively.
      setOpenInlineAnswers((current) => {
        const parentIndex = current.findIndex(
          (openAnswer) =>
            inlineSelectionThreads.get(openAnswer.id)?.answerMessageId ===
            selection.sourceMessageId,
        );
        return parentIndex >= 0 ? current.slice(0, parentIndex + 1) : [];
      });
      setSelectionMenu(selection);
    },
    [annotationsByMessage, chatContentLoading, inlineSelectionThreads],
  );

  function applySelectionHighlight(color: ChatHighlightColor) {
    if (!selectionMenu) return;
    setSavedChatHighlights((current) => {
      const withoutOverlap = current.filter(
        (highlight) =>
          highlight.sourceMessageId !== selectionMenu.sourceMessageId ||
          !chatTextSelectionsOverlap(highlight, selectionMenu),
      );
      return [
        ...withoutOverlap,
        {
          id: crypto.randomUUID(),
          sourceMessageId: selectionMenu.sourceMessageId,
          start: selectionMenu.start,
          end: selectionMenu.end,
          quote: selectionMenu.quote,
          prefix: selectionMenu.prefix,
          suffix: selectionMenu.suffix,
          color,
        },
      ];
    });
    setSelectionMenu(null);
    window.getSelection()?.removeAllRanges();
  }

  function removeSelectionHighlight() {
    if (!selectionMenu) return;
    setSavedChatHighlights((current) =>
      current.filter(
        (highlight) =>
          highlight.sourceMessageId !== selectionMenu.sourceMessageId ||
          !chatTextSelectionsOverlap(highlight, selectionMenu),
      ),
    );
    setSelectionMenu(null);
    window.getSelection()?.removeAllRanges();
  }

  function beginSelectionQuestion(mode: "chat" | "inline") {
    if (!selectionMenu) return;
    const selection: ChatTextSelectionReference = {
      id: crypto.randomUUID(),
      mode,
      sourceMessageId: selectionMenu.sourceMessageId,
      start: selectionMenu.start,
      end: selectionMenu.end,
      quote: selectionMenu.quote,
      prefix: selectionMenu.prefix,
      suffix: selectionMenu.suffix,
    };
    if (mode === "inline") {
      setSavedChatHighlights((current) =>
        current.filter(
          (highlight) =>
            highlight.sourceMessageId !== selection.sourceMessageId ||
            !chatTextSelectionsOverlap(highlight, selection),
        ),
      );
      setSavedInlineSelections((current) => [...current, selection]);
    }
    setComposerSelection(selection);
    setSelectionMenu(null);
    if (mode === "chat") setOpenInlineAnswers([]);
    window.getSelection()?.removeAllRanges();
    window.setTimeout(() => textareaRef.current?.focus(), 0);
  }

  function cancelSelectionQuestion() {
    const selection = composerSelection;
    setComposerSelection(null);
    if (
      selection?.mode === "inline" &&
      !messages.some((message) => message.textSelection?.id === selection.id)
    ) {
      setSavedInlineSelections((current) =>
        current.filter((candidate) => candidate.id !== selection.id),
      );
    }
  }

  const openAnnotation = useCallback(
    (annotationId: string, anchor: FloatingAnchorRect) => {
      const highlight = savedChatHighlights.find(
        (candidate) => candidate.id === annotationId,
      );
      if (highlight) {
        setOpenInlineAnswers((current) => {
          const parentIndex = current.findIndex(
            (openAnswer) =>
              inlineSelectionThreads.get(openAnswer.id)?.answerMessageId ===
              highlight.sourceMessageId,
          );
          return parentIndex >= 0 ? current.slice(0, parentIndex + 1) : [];
        });
        setSelectionMenu({ ...highlight, anchor });
        window.getSelection()?.removeAllRanges();
        return;
      }
      const thread = inlineSelectionThreads.get(annotationId);
      if (!thread) return;
      if (!thread.question) {
        setComposerSelection(thread.selection);
        window.setTimeout(() => textareaRef.current?.focus(), 0);
        return;
      }
      setOpenInlineAnswers((current) => {
        const openIndex = current.findIndex(
          (openAnswer) => openAnswer.id === annotationId,
        );
        if (openIndex >= 0) return current.slice(0, openIndex);
        const parentIndex = current.findIndex(
          (openAnswer) =>
            inlineSelectionThreads.get(openAnswer.id)?.answerMessageId ===
            thread.selection.sourceMessageId,
        );
        return parentIndex >= 0
          ? [
              ...current.slice(0, parentIndex + 1),
              { id: annotationId, anchor },
            ]
          : [{ id: annotationId, anchor }];
      });
    },
    [inlineSelectionThreads, savedChatHighlights],
  );

  function deleteInlineSelection(annotationId: string) {
    setOpenInlineAnswers((current) => {
      const openIndex = current.findIndex(
        (openAnswer) => openAnswer.id === annotationId,
      );
      return openIndex >= 0 ? current.slice(0, openIndex) : current;
    });
    setSelectionMenu(null);
    setComposerSelection((current) =>
      current?.id === annotationId ? null : current,
    );
    setSavedInlineSelections((current) =>
      current.filter((selection) => selection.id !== annotationId),
    );
    setDeletedInlineSelectionIds((current) => {
      const next = new Set(current);
      next.add(annotationId);
      return next;
    });
  }

  // Retry and edit are one path: both send the question again against the
  // same highlight, and the thread map keeps the newest question/answer pair.
  function askInlineSelectionAgain(
    selection: ChatTextSelectionReference,
    question: string,
  ) {
    const trimmed = question.trim();
    if (!trimmed || isStreaming || chatContentLoading || !canAskSelection) {
      return;
    }
    setInlineSelectionRunId(selection.id);
    void handleSubmit(trimmed, undefined, [], false, undefined, {
      textSelection: selection,
    });
  }

  /** The composer's submit: a held selected-text question rides the turn. */
  function submitComposer() {
    if (!composerSelection || !canAskSelection) {
      void handleSubmit();
      return;
    }
    const question = input.trim();
    if (!question || chatContentLoading) return;
    const replacesActiveTurn =
      composerSelection.mode === "inline" &&
      steerableTurnActive &&
      !externalRunHoldsQueue;
    if (isStreaming && !replacesActiveTurn) return;
    const selection = composerSelection;
    setComposerSelection(null);
    setSelectionMenu(null);
    if (selection.mode === "chat") setOpenInlineAnswers([]);
    if (selection.mode === "inline") setInlineSelectionRunId(selection.id);
    setInput("");
    if (replacesActiveTurn) {
      setPendingImmediateInlineQuestion({
        chatId: activeChatId,
        question,
        selection,
      });
      setStoppingForInlineQuestion(true);
      void stopActiveGardenTurn().finally(() =>
        setStoppingForInlineQuestion(false),
      );
      return;
    }
    void handleSubmit(question, undefined, [], false, undefined, {
      textSelection: selection,
    });
  }

  // Runtime agents a Super Agent turn asked for. Each gets a distinct hidden
  // transcript turn, allowing several workers to run and report independently.
  interface AwaitedLaunch {
    agentName: string;
    reason: string;
    requestId: string;
    workerClientMessageId: string;
    runId: string | null;
  }
  const awaitedLaunchesRef = useRef(new Map<string, AwaitedLaunch>());
  const launchHopsRef = useRef(0);
  const launchRoundOriginsRef = useRef(new Set<string>());
  const continuedDelegatedRunsRef = useRef(new Set<string>());
  const delegatedAgentLaunchRef = useRef<AgentLaunchRequestPayload | null>(
    null,
  );
  const [pendingLaunchContinuations, setPendingLaunchContinuations] = useState<
    string[]
  >([]);

  /**
   * The composer's agent chip is the person's own choice. A delegated launch
   * has to resolve a runtime through the same `select*` pickers the chip is
   * driven by, so starting one leaves that agent selected in the composer and
   * routes the next thing typed into it. Snapshot the selection around the
   * launch and put it back.
   */
  function readComposerAgentSelection() {
    return {
      agentBrowser: agentBrowserAgent,
      deepResearch: deepResearchAgent,
      openCode: openCodeAgent,
      codex: codexAgent,
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
      ruflo: rufloAgent,
    };
  }

  function restoreComposerAgentSelection(
    snapshot: ReturnType<typeof readComposerAgentSelection>,
  ) {
    setAgentBrowserAgent(snapshot.agentBrowser);
    setDeepResearchAgent(snapshot.deepResearch);
    setOpenCodeAgent(snapshot.openCode);
    setCodexAgent(snapshot.codex);
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
    setRufloAgent(snapshot.ruflo);
  }

  async function launchDelegatedAgent(
    request: AgentLaunchRequestPayload,
  ): Promise<void> {
    const workerClientMessageId = agentLaunchWorkerClientMessageId(request);
    if (!request.originClientMessageId?.trim()) {
      awaitedLaunchesRef.current.delete(workerClientMessageId);
      setExternalAgentStatus(
        `${request.agentName} could not start because the originating assistant message is missing.`,
      );
      return;
    }
    if (request.startedRun?.kind === "max_research") {
      // The tool boundary already owns this launch. Mirror its durable run into
      // the open Garden transcript so the hidden observer can stream the result
      // and hand it back, without launching a second worker.
      delegatedAgentLaunchRef.current = request;
      setDelegatedAgentLaunching(true);
      try {
        const prepared = await prepareExternalAgentSession("");
        if (!prepared) return;
        setChatStreaming(prepared.session.id, true);
        await commitExternalAgentTurn(
          prepared.session,
          "",
          {
            role: "assistant",
            content: "",
            maxResearchRun: {
              runId: request.startedRun.runId,
              query: request.startedRun.query,
            },
            externalAgentOutcome: "running",
          },
        );
      } catch (error) {
        setExternalAgentStatus(
          error instanceof Error
            ? error.message
            : `${request.agentName} started, but this view could not attach its observer.`,
        );
      } finally {
        if (delegatedAgentLaunchRef.current?.requestId === request.requestId) {
          delegatedAgentLaunchRef.current = null;
        }
        setDelegatedAgentLaunching(false);
      }
      return;
    }
    const composerSelection = readComposerAgentSelection();
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
          // Deliberately not selected. `launchDeepResearch` needs nothing from
          // the chip, so selecting would only put `/agents:deep-research` in
          // the composer — and the snapshot below cannot take it back until the
          // whole launch settles, which is long enough for the person to type
          // into it and have their next message routed into Deep Research.
          await launchDeepResearch(request.brief);
          return;
        case "max-research":
          // Same reasoning as Deep Research: nothing is needed from the chip.
          await launchMaxResearch(request.brief);
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
        case "openexecutive":
          if (!openExecutiveAgent) await selectOpenExecutive();
          await launchOpenExecutive(request.brief);
          return;
        case "open-gym":
          await launchOpenGym(request.brief, { quiet: true });
          return;
        case "trading-agent": {
          const parsed = tradingAgentsRequestFromBrief(request.brief);
          if (!parsed.ok) {
            setExternalAgentStatus(parsed.error);
            const prepared = await prepareExternalAgentSession("");
            if (prepared) {
              await commitExternalAgentTurn(prepared.session, "", {
                role: "assistant",
                content: parsed.error,
                externalAgentOutcome: "failed",
              });
            }
            return;
          }
          if (!tradingAgentsAgent) await selectTradingAgents();
          await launchTradingAgents(parsed.request);
          return;
        }
        case "vibe-trading":
          if (!vibeTradingAgent) await selectVibeTrading();
          await launchVibeTrading(request.brief);
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
        case "matraix":
          await launchMatraix(request.brief);
          return;
        case "bolt-slides":
          await launchBoltSlides(request.brief);
          return;
        case "classroom":
          await launchClassroom(request.brief, []);
          return;
        case "gods-eye":
          await launchGodsEye(request.brief, { quiet: true });
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
        case "praxist":
          await launchPraxist(request.brief);
          return;
        case "inbox-zero":
          await launchInboxZero(request.brief);
          return;
        case "vimax":
          await launchVimax(request.brief);
          return;
        case "vox-director":
          await launchVoxDirector(request.brief);
          return;
        case "money-printer":
          await launchMoneyPrinter(request.brief);
          return;
        default:
          setExternalAgentStatus(
            `${request.agentName} cannot be launched from this chat.`,
          );
      }
    } finally {
      restoreComposerAgentSelection(composerSelection);
      if (delegatedAgentLaunchRef.current?.requestId === request.requestId) {
        delegatedAgentLaunchRef.current = null;
      }
      setDelegatedAgentLaunching(false);
    }
  }

  const agentLaunchQueue = useAgentLaunchQueue({
    submit: (request) => void launchDelegatedAgent(request),
    scopeKey: activeChatId,
    ready:
      !chatContentLoading &&
      !delegatedAgentLaunching &&
      launchingExternalAgent === null &&
      agentActivity.connection !== "connecting" &&
      agentActivity.connection !== "streaming" &&
      agentActivity.connection !== "waiting",
    onLaunched: (request) => {
      // openGym presents its own visible result. Waiting for a private hand-back
      // would append a second Thinking/synthesis row after the card finishes.
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
        const workerClientMessageId = agentLaunchWorkerClientMessageId(request);
        awaitedLaunchesRef.current.set(workerClientMessageId, {
          agentName: request.agentName,
          reason: request.reason,
          requestId: request.requestId,
          workerClientMessageId,
          runId: null,
        });
      }
    },
    onDismissed: (request) => {
      awaitedLaunchesRef.current.delete(
        agentLaunchWorkerClientMessageId(request),
      );
      setExternalAgentStatus("");
    },
  });
  const agentLaunchScopeRef = useRef(activeChatId);
  useEffect(() => {
    if (agentLaunchScopeRef.current === activeChatId) return;
    agentLaunchScopeRef.current = activeChatId;
    awaitedLaunchesRef.current.clear();
    launchRoundOriginsRef.current.clear();
    continuedDelegatedRunsRef.current.clear();
    setPendingLaunchContinuations([]);
  }, [activeChatId]);

  // Messages typed while this chat is working — a streaming turn or an
  // external agent run — queue above the composer instead of being dropped. A
  // steerable chat turn can take one as a mid-run correction; anything still
  // queued when the run settles is sent as an ordinary follow-up.
  // Every moment of a delegation the person cannot see: queued behind the turn
  // that asked for it, starting, and finished but not yet handed back. The
  // worker's own run is covered separately, by the transcript.
  const delegationInFlight =
    agentLaunchQueue.queued ||
    delegatedAgentLaunching ||
    messages.some(
      (message) =>
        message.delegatedAgentRun === true && hasRunningExternalAgent(message),
    ) ||
    awaitedLaunchesRef.current.size > 0 ||
    pendingLaunchContinuations.length > 0;
  const externalRunHoldsQueue =
    hasRunningExternalAgentInActiveChat ||
    delegationInFlight ||
    launchingExternalAgent !== null;
  // A Hermes chat turn this tab is streaming — the one thing a queued message
  // can steer, and the one thing the composer's stop square can abort. An
  // external agent run is neither: its card owns its own stop, so while only
  // an agent is working the composer keeps its send button and queues.
  const steerableTurnActive =
    agentActivity.connection === "connecting" ||
    agentActivity.connection === "streaming" ||
    agentActivity.connection === "waiting";
  const { queueFollowUp, headerContent: queuedFollowUpsHeader } =
    useQueuedFollowUps({
      conversationKey: activeChatId === null ? null : String(activeChatId),
      runInFlight: isStreaming || externalRunHoldsQueue,
      steerableRunActive: steerableTurnActive,
      externalRunActive: externalRunHoldsQueue,
      onSteer: steerActiveResponse,
      onRestoreDraft: (text, attachments) => {
        restoreQueuedFollowUpDraft(text, setInput, textareaRef);
        setChatAttachments([...attachments]);
      },
      onSendQueued: async (text, attachments) => {
        await handleSubmit(text, undefined, attachments);
      },
    });

  // An inline question is a new turn, not a queued follow-up or a correction
  // to the response it quotes. Once that response is fully stopped, dispatch
  // the held question with its selection metadata intact.
  useEffect(() => {
    if (
      !pendingImmediateInlineQuestion ||
      stoppingForInlineQuestion ||
      isStreaming ||
      chatContentLoading
    ) {
      return;
    }
    if (pendingImmediateInlineQuestion.chatId !== activeChatId) {
      setPendingImmediateInlineQuestion(null);
      return;
    }
    const { question, selection } = pendingImmediateInlineQuestion;
    setPendingImmediateInlineQuestion(null);
    void handleSubmit(question, undefined, [], false, undefined, {
      textSelection: selection,
    });
    // handleSubmit is a render-local dispatcher; the readiness flags above are
    // the only values that should retry this one-shot handoff.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeChatId,
    chatContentLoading,
    isStreaming,
    pendingImmediateInlineQuestion,
    stoppingForInlineQuestion,
  ]);

  useEffect(() => {
    if (
      isStreaming ||
      pendingImmediateInlineQuestion ||
      stoppingForInlineQuestion
    ) {
      return;
    }
    setInlineSelectionRunId(null);
  }, [isStreaming, pendingImmediateInlineQuestion, stoppingForInlineQuestion]);

  // Bind the launch to the run it started. The queue never has two in flight, so
  // the first run id that was not already in the transcript is this one's — and
  // binding by id means a run the user started themselves can never be mistaken
  // for the chain's next step.
  useLayoutEffect(() => {
    if (chatContentLoading) return;
    const continuedKeys = new Set<string>();
    for (const message of messages) {
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
      reason?: string;
      outcome: "completed" | "failed";
      content: string;
    }> = [];
    let runningWorkers = 0;
    for (let index = 0; index < messages.length; index += 1) {
      const message = messages[index];
      if (message?.role !== "assistant" || message.delegatedAgentRun !== true) {
        continue;
      }
      const runId = assistantExternalAgentRunId(message);
      const continuationKey =
        message.clientMessageId ?? runId ?? message.id ?? `delegated-${index}`;
      if (message.openGymRun) {
        continuedDelegatedRunsRef.current.add(continuationKey);
        awaitedLaunchesRef.current.delete(continuationKey);
        continue;
      }
      const agentName = message.externalAgentName ?? "The delegated agent";
      if (message.externalAgentOutcome === "aborted") {
        continuedDelegatedRunsRef.current.add(continuationKey);
        awaitedLaunchesRef.current.delete(continuationKey);
        continue;
      }
      if ((message.externalAgentOutcome ?? "running") === "running") {
        runningWorkers += 1;
        if (runId) {
          awaitedLaunchesRef.current.set(continuationKey, {
            agentName,
            reason: message.delegatedAgentReason ?? "",
            requestId: continuationKey,
            workerClientMessageId: continuationKey,
            runId,
          });
        }
        continue;
      }
      awaitedLaunchesRef.current.delete(continuationKey);
      if (
        continuedKeys.has(continuationKey) ||
        continuedDelegatedRunsRef.current.has(continuationKey)
      ) {
        continuedDelegatedRunsRef.current.add(continuationKey);
        continue;
      }
      continuedDelegatedRunsRef.current.add(continuationKey);
      terminalResults.push({
        continuationKey,
        agentName,
        reason: message.delegatedAgentReason,
        outcome:
          message.externalAgentOutcome === "completed" ? "completed" : "failed",
        content: externalAgentCardContent(message),
      });
    }
    if (terminalResults.length === 0) return;
    launchHopsRef.current = Math.max(1, launchHopsRef.current);
    setPendingLaunchContinuations((current) => [
      ...current,
      ...terminalResults.map((result, index) =>
        agentLaunchContinuationMessage({
          continuationId: result.continuationKey,
          agentName: result.agentName,
          reason: result.reason,
          outcome: result.outcome,
          content: result.content,
          remaining: runningWorkers + terminalResults.length - index - 1,
        }),
      ),
    ]);
  }, [chatContentLoading, messages]);

  // The result of a finished run, handed back as a new turn. It has to wait for
  // the surface to go idle: React has not yet cleared the streaming flags when
  // the run's card reports its outcome, and a submit made then is dropped.
  const pendingLaunchContinuation = pendingLaunchContinuations[0] ?? null;
  useEffect(() => {
    if (
      !pendingLaunchContinuation ||
      steerableTurnActive ||
      delegatedAgentLaunching ||
      launchingExternalAgent !== null
    )
      return;
    const continuation = pendingLaunchContinuation;
    const timer = window.setTimeout(() => {
      void handleSubmit(
        continuation,
        undefined,
        undefined,
        true,
        () =>
          setPendingLaunchContinuations((current) =>
            current[0] === continuation
              ? current.slice(1)
              : current.filter((item) => item !== continuation),
          ),
      );
    }, 0);
    return () => window.clearTimeout(timer);
    // handleSubmit is redeclared every render and reads current state when it
    // runs; depending on it here would reschedule this timer on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    pendingLaunchContinuation,
    steerableTurnActive,
    delegatedAgentLaunching,
    launchingExternalAgent,
  ]);

  // Garden runtime and external-agent turns are server-owned. Reconcile only
  // the active transcripts while visible; this keeps background work alive
  // across page/chat switches without repeatedly loading every chat in a large
  // garden.
  const activeServerChatIds = chatSessions
    .filter((session) => session.active === true)
    .map((session) => session.id);
  const activeServerChatKey = activeServerChatIds.join(",");
  useEffect(() => {
    if (!activeServerChatKey) return;
    const reconcile = () => {
      if (document.visibilityState !== "visible") return;
      for (const sessionId of activeServerChatIds) {
        void refreshChatSession(sessionId);
      }
    };
    reconcile();
    const timer = window.setInterval(reconcile, 2_000);
    document.addEventListener("visibilitychange", reconcile);
    window.addEventListener("focus", reconcile);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", reconcile);
      window.removeEventListener("focus", reconcile);
    };
    // The key is the stable identity of the active set. Depending on the array
    // itself would tear down this poll on every transcript delta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeServerChatKey, refreshChatSession]);

  // One lightweight clock drives elapsed time for every concurrent upload.
  useEffect(() => {
    if (!isUploading) return;
    const id = setInterval(() => {
      setUploadClock(Date.now());
    }, 100);
    return () => clearInterval(id);
  }, [isUploading]);

  useEffect(() => {
    if (!linkImportTasks.some((task) => task.status === "importing")) return;
    const id = window.setInterval(() => setLinkImportClock(Date.now()), 1_000);
    return () => window.clearInterval(id);
  }, [linkImportTasks]);

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
    const title = newLinkTitle.trim() || newLinkUrl.trim();
    const url = newLinkUrl.trim();
    const taskId = crypto.randomUUID();
    const startedAt = Date.now();
    setLinkImportTasks((current) => [
      {
        id: taskId,
        title,
        url,
        status: "importing",
        stage: "Fetching and converting page to Markdown…",
        startedAt,
      },
      ...current,
    ]);
    setLinkImportClock(startedAt);
    setLinksExpanded(true);
    // Leave the add form immediately. The dedicated status dialog owns the
    // in-flight work, while its compact row remains beneath Links.
    setLinkDialogOpen(false);
    setSelectedLinkImportId(taskId);
    setSavingLink(true);
    try {
      const res = await fetch(
        `/api/gardens/${encodeURIComponent(clusterSlug)}/links`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: newLinkTitle.trim(),
            url,
          }),
        },
      );
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        links?: SavedLinkInfo[];
        duplicate?: boolean;
        source?: { sourceTitle?: string; sourceRelPath?: string };
        capturedImages?: number;
        referencedImages?: number;
      };
      if (!res.ok) {
        const error = data.error ?? "Failed to save link";
        setLinkImportTasks((current) =>
          current.map((task) =>
            task.id === taskId
              ? {
                  ...task,
                  status: "failed",
                  stage: "Import failed",
                  completedAt: Date.now(),
                  error,
                }
              : task,
          ),
        );
        addToast(error);
        return;
      }
      setSavedLinks(Array.isArray(data.links) ? data.links : []);
      setLinkImportTasks((current) =>
        current.map((task) =>
          task.id === taskId
            ? {
                ...task,
                status: "completed",
                stage: data.duplicate ? "Source already available" : "Source ready",
                completedAt: Date.now(),
                duplicate: data.duplicate,
                sourceRelPath: data.source?.sourceRelPath,
                capturedImages: data.capturedImages,
                referencedImages: data.referencedImages,
              }
            : task,
          ),
      );
      setNewLinkTitle("");
      setNewLinkUrl("");
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
      setLinkImportTasks((current) =>
        current.map((task) =>
          task.id === taskId
            ? {
                ...task,
                status: "failed",
                stage: "Import failed",
                completedAt: Date.now(),
                error: "Failed to save link",
              }
            : task,
        ),
      );
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

  function handleMediaSourceCreated(info: {
    jobId: string;
    sourceTitle: string;
    sourceRelPath: string;
    sourceSlug: string;
    mediaKind: "audio" | "video";
  }) {
    // The transcript is now a regular source: refresh the tree and graph so it
    // appears immediately, and surface a Garden Chat system message.
    setSourceDocsExpanded(true);
    void fetchDocuments();
    setGraphRefreshVersion((value) => value + 1);
    const mediaLabel = info.mediaKind === "audio" ? "Audio" : "Video";
    addToast(`${mediaLabel} transcribed: ${info.sourceTitle}`, "success");
    if (activeChatId) {
      updateChatMessages(activeChatId, (previous) => [
        ...previous,
        {
          role: "assistant",
          content: `${mediaLabel} transcription completed. New source available: **${info.sourceTitle}** (\`${info.sourceRelPath}\`). You can now ask questions about it in this chat.`,
        },
      ]);
    }
  }

  function openUploadModal() {
    // The add action always opens a fresh draft. Running uploads remain
    // independent rows under Documents and can be reopened from those rows.
    selectedUploadTaskIdRef.current = null;
    setSelectedUploadTaskId(null);
    setUploadFiles([]);
    setUploadLabel("");
    setIsHandwriting(false);
    setParseWithVlm(false);
    setParseWithAnydoc(false);
    setGenerateMap(true);
    setIsDragging(false);
    setShowUpload(true);
  }

  function openUploadTask(taskId: string) {
    selectedUploadTaskIdRef.current = taskId;
    setSelectedUploadTaskId(taskId);
    setShowUpload(true);
  }

  function cancelUploadTask(taskId: string) {
    cancelGardenUploadTask(taskId);
    setShowUpload(false);
  }

  function closeUploadModal() {
    if (selectedUploadTaskId) {
      const task = uploadTasks.find((candidate) => candidate.id === selectedUploadTaskId);
      if (task?.state === "uploading") {
        cancelUploadTask(selectedUploadTaskId);
        return;
      }
      removeGardenUploadTask(selectedUploadTaskId);
    }
    selectedUploadTaskIdRef.current = null;
    setSelectedUploadTaskId(null);
    setShowUpload(false);
  }

  function continueUploadInBackground() {
    if (!selectedUploadTaskId) return;
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
    setUploadFiles((prev) => prev.filter((_, i) => i !== index));
  }

  function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (uploadFiles.length === 0) return;

    const taskId = startGardenUploadTask({
      clusterSlug,
      files: uploadFiles,
      options: {
        label: uploadLabel.trim(),
        handwriting: isHandwriting,
        parseWithVlm: parseWithVlm && vlmStatus.available,
        parseWithAnydoc: parseWithAnydoc && anydocStatus.available,
        generateMap,
      },
    });
    selectedUploadTaskIdRef.current = taskId;
    setSelectedUploadTaskId(taskId);
    setSourceDocsExpanded(true);
  }

  // ── Chat attachments ────────────────────────────────────────────────────────

  async function attachChatFiles(files: File[]) {
    if (files.length === 0) return;

    setExtractingAttachments(true);
    try {
      const extracted = await extractChatAttachments(files, {
        isHandwriting: (file) =>
          isHandwriting && HANDWRITING_FILE_RE.test(file.name),
      });
      for (const message of [...extracted.warnings, ...extracted.errors]) {
        addToast(message);
      }
      setChatAttachments((prev) => [...prev, ...extracted.attachments]);
      // A document too large to paste into every turn becomes a book-to-skill
      // skill now, while the user is still typing. The turn builds it too if it
      // has to, but by then this has almost always already cached it.
      const distillErrors = await distillAttachments(extracted.attachments, {
        clusterSlug,
        onStatus: (status) => setAttachmentDistillStatus(status),
      });
      for (const message of distillErrors) addToast(message);
    } finally {
      setAttachmentDistillStatus(null);
      setExtractingAttachments(false);
    }
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
    const removed = chatAttachments[index];
    setChatAttachments((prev) => prev.filter((_, i) => i !== index));
    if (removed?.type === "product") {
      setProductPanel((current) => current
        ? {
            ...current,
            compareProductIds: current.compareProductIds.filter(
              (productId) => productId !== removed.product.id,
            ),
          }
        : current);
    }
  }

  function toggleSelectedDocument(slug: string) {
    let selecting = false;
    setSelectedDocumentSlugs((prev) => {
      selecting = !prev.includes(slug);
      return selecting ? [...prev, slug] : prev.filter((item) => item !== slug);
    });
    const selectedDocument = documents.find((document) => document.slug === slug);
    const selectedKind = selectedDocument
      ? learnSourceKind(selectedDocument)
      : null;
    // Recordings have their own selection contracts: video selects Watch on the
    // next turn, while audio is supplied as transcript Markdown. Only ordinary
    // documents should start the book-to-skill distillation here.
    if (selecting && selectedKind !== "audio" && selectedKind !== "video") {
      void distillGardenDocument(slug);
    }
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
      addToast(isSource ? "Source deleted" : "Document deleted", "success");
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
        if (streamingChatIdsRef.current.has(sessionId)) {
          inFlightChatMessagesRef.current.set(sessionId, nextMessages);
        }
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
      setCreatedChatId(session.id);
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
    options: { updateLocal?: boolean } = {},
  ): Promise<boolean> {
    const body: { messages: Message[]; title?: string } = {
      messages: nextMessages,
    };
    if (title) body.title = title;
    const version = (chatPersistenceVersionsRef.current.get(sessionId) ?? 0) + 1;
    chatPersistenceVersionsRef.current.set(sessionId, version);
    const previous = chatPersistenceChainsRef.current.get(sessionId) ??
      Promise.resolve(true);
    const write = previous.catch(() => false).then(async () => {
      try {
        const res = await fetch(`/api/chat-sessions/${sessionId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error("Failed to save chat");
        if (
          options.updateLocal !== false &&
          chatPersistenceVersionsRef.current.get(sessionId) === version
        ) {
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
        }
        return true;
      } catch {
        addToast("Chat was not saved");
        return false;
      }
    });
    chatPersistenceChainsRef.current.set(sessionId, write);
    void write.finally(() => {
      if (chatPersistenceChainsRef.current.get(sessionId) === write) {
        chatPersistenceChainsRef.current.delete(sessionId);
      }
    });
    return write;
  }

  function handleNewChat() {
    // Match Terminal: switching to a fresh chat is local and immediate. The
    // durable session is created by the first message, so repeatedly pressing
    // New chat never leaves empty rows in Recents.
    pendingNewChatRef.current = true;
    chatHistoryEpoch.current += 1;
    setActiveChatId(null);
    setCreatedChatId(null);
    setDraftMessages(null);
    setSidePanel(null);
    setInput("");
    // The unstarted chat's draft is deliberately left alone. It is only ever
    // written by someone typing into a blank composer and never sending, and
    // since a send clears it explicitly, anything still in it is an unsent
    // message — the one kind of text nothing else has a copy of. Clearing it
    // here used to be harmless because an unsent draft was carried onto
    // whichever chat opened next; now that it stays where it was written,
    // this was the only thing that could destroy it.
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
    setOpenExecutiveAgent(null);
    setTradingAgentsAgent(null);
    setVibeTradingAgent(null);
    setStockAnalystAgent(null);
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

  function canDeleteChat(sessionId: number): boolean {
    const targetSession = chatSessions.find((s) => s.id === sessionId);
    return Boolean(targetSession) && (targetSession?.isOwn !== false || isOwner);
  }

  /**
   * Send one delete and report whether it committed.
   *
   * The row is already gone from the rail by the time this runs — callers own
   * the list — so this is only the round trip and its aftermath. The chat is
   * held out of any reload that overlaps the request: the epoch guard drops
   * answers to reloads already in flight, but one that starts while the delete
   * is working would still list the chat and put its row back.
   */
  async function sendChatDelete(targetId: number): Promise<boolean> {
    deletingChatIds.current.add(targetId);
    try {
      const res = await fetch(`/api/chat-sessions/${targetId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete chat");
      // The chat is really gone, so its local traces can go too. Doing this
      // only on success keeps a failed delete from taking the unsent draft
      // with it.
      forgetChatDrafts(window.localStorage, draftSurface, [String(targetId)]);
      forgetUnreadChats([String(targetId)]);
      return true;
    } catch {
      addToast("Failed to delete chat");
      // The chat survived; reload so it comes back where it belongs.
      fetchChatSessions();
      return false;
    } finally {
      deletingChatIds.current.delete(targetId);
    }
  }

  // A streaming chat can be deleted: the route cancels the turn and any agent
  // run it started before it removes the rows. All of that stopping is round
  // trips, so the row leaves on the click and the request runs behind it, and
  // the chat comes back only if the server refuses.
  async function handleDeleteChat(sessionId?: number): Promise<boolean> {
    const targetId = sessionId ?? activeChatId;
    if (!targetId || !canDeleteChat(targetId)) return false;
    chatHistoryEpoch.current += 1;
    const remaining = chatSessions.filter((s) => s.id !== targetId);
    setChatSessions(remaining);
    if (activeChatId === targetId) setActiveChatId(remaining[0]?.id ?? null);
    return sendChatDelete(targetId);
  }

  async function deleteChatFromRail(chat: TerminalSidebarChat) {
    const confirmed = await confirmDestructive({
      title: "Delete this chat?",
      subject: `“${chat.title}”`,
      body: "Anything it is still running is stopped, and its messages are removed for good.",
      confirmLabel: "Delete chat",
    });
    if (!confirmed) return;
    setRailError(null);
    if (!(await handleDeleteChat(Number(chat.id)))) {
      setRailError("This chat could not be deleted.");
    }
  }

  async function deleteChatsFromRail(chats: TerminalSidebarChat[]) {
    if (chats.length === 0) return;
    const single = chats.length === 1;
    const confirmed = await confirmDestructive({
      title: single ? "Delete this chat?" : `Delete ${chats.length} chats?`,
      subject: single ? `“${chats[0].title}”` : null,
      body: single
        ? "Anything it is still running is stopped, and its messages are removed for good."
        : "Anything they are still running is stopped, and their messages are removed for good.",
      confirmLabel: single ? "Delete chat" : `Delete ${chats.length} chats`,
    });
    if (!confirmed) return;
    setRailError(null);
    // Every row leaves at once. Deleting them through handleDeleteChat one at a
    // time would empty the rail one row per round trip — ten chats would look
    // like ten small waits — and each of those calls would rebuild the list
    // from this render's chats, putting the rows still queued behind it back.
    const targets = chats
      .map((chat) => Number(chat.id))
      .filter((id) => canDeleteChat(id));
    const targetIds = new Set(targets);
    chatHistoryEpoch.current += 1;
    const remaining = chatSessions.filter((s) => !targetIds.has(s.id));
    setChatSessions(remaining);
    if (activeChatId !== null && targetIds.has(activeChatId))
      setActiveChatId(remaining[0]?.id ?? null);
    // Chats this reader may not delete never left the rail, so they count as
    // failures without a request being sent.
    let failed = chats.length - targets.length;
    // The requests still go one at a time: each delete stops that chat's live
    // work before removing its rows, so a partial result is possible and has
    // to be reported.
    for (const id of targets) {
      if (!(await sendChatDelete(id))) failed += 1;
    }
    if (failed > 0) {
      setRailError(
        failed === 1 && chats.length === 1
          ? "This chat could not be deleted."
          : `${failed} of ${chats.length} chats could not be deleted.`,
      );
    }
  }

  /**
   * Pin or highlight one chat, applied to the row before the round trip.
   *
   * Marking six chats is six clicks; waiting for the server between them would
   * make the pen feel stuck. The epoch guard keeps the next reconcile from
   * answering with a snapshot taken before the change.
   */
  async function patchChatMark(
    chat: TerminalSidebarChat,
    body: { pinned?: boolean; highlight?: string | null },
    failure: string,
  ) {
    const id = Number(chat.id);
    setRailError(null);
    chatHistoryEpoch.current += 1;
    let original: ChatSession | undefined;
    setChatSessions((current) =>
      current.map((session) => {
        if (session.id !== id) return session;
        original = session;
        return { ...session, ...body };
      }),
    );
    try {
      const res = await fetch(`/api/chat-sessions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(failure);
    } catch {
      setRailError(failure);
      if (!original) return;
      const before = original;
      // Roll back only the fields this call wrote, and only where the row still
      // holds what it wrote — a later edit is the newer truth and keeps it.
      setChatSessions((current) =>
        current.map((session) =>
          session.id === id
            ? {
                ...session,
                ...(body.pinned !== undefined && session.pinned === body.pinned
                  ? { pinned: before.pinned }
                  : {}),
                ...(body.highlight !== undefined &&
                session.highlight === body.highlight
                  ? { highlight: before.highlight }
                  : {}),
              }
            : session,
        ),
      );
    }
  }

  // ── Garden note generation ──────────────────────────────────────────────────

  /** The rail hands back the typed title; a public chat is never renamed here. */
  function renameChatFromRail(chat: TerminalSidebarChat, title: string) {
    const session = chatSessions.find((item) => item.id === Number(chat.id));
    if (!session || session.isOwn === false) return;
    const cleaned = title.trim().replace(/\s+/g, " ");
    if (!cleaned || cleaned === session.title) return;
    void renameChatSession(session, cleaned);
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
        | "cancel"
        | "pause"
        | "resume",
      body: Record<string, unknown> = {},
    ) => {
      const isCancel = endpoint === "cancel";
      // Pause and Resume act on the run already on screen, so they neither open
      // the panel nor claim the Learn-start busy flag.
      const isPauseAction = endpoint === "pause" || endpoint === "resume";
      if (!isCancel && !isPauseAction) {
        setLearnPanelOpen(true);
      }
      if (isCancel) {
        setLearnCancelBusy(true);
      } else if (isPauseAction) {
        setLearnPauseBusy(true);
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
              // Send the resolved selection explicitly. `null` is the UI's
              // not-yet-synchronized sentinel for sources, so omitting these
              // fields would let an interrupted request become the server's
              // legacy all-documents/no-syllabus default.
              includedSourceIds: (
                learnIncludedSourceSlugs ??
                documents
                  .filter((document) => document.type === "source-document")
                  .map((document) => document.slug)
              ).filter((sourceSlug) => sourceSlug !== learnSyllabusSlug),
              syllabusSourceId: learnSyllabusSlug,
              includeSourceSnapshots: false,
              // Keep planning interruptible from the UI. The live checkbox is
              // evaluated when the proposed map reaches the review boundary.
              skipManualReview:
                endpoint === "plan" ? false : learnSkipManualReviewRef.current,
              userInstruction: learnUserInstruction.trim() || undefined,
              ...body,
            }),
          },
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.error) {
          learnRequiresReplanRef.current = data.requiresReplan === true;
          throw new Error(data.error ?? "Learn action failed");
        }
        learnRequiresReplanRef.current = false;

        if (isPauseAction) {
          await fetchLearnStatus();
          addToast(
            endpoint === "pause"
              ? "Pausing after the current step"
              : "Learn run resumed",
            "success",
          );
          return true;
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
          setLearnUserInstruction("");
          setLearnUserInstructionDraft("");
          setLearnUserInstructionOpen(false);
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
        const refreshed = await fetchLearnStatus();
        const message =
          error instanceof Error ? error.message : "Learn action failed";
        // Cancel, Pause/Resume, and Clear are direct user commands whose
        // refusals must be spoken. So must a start the server refused outright:
        // that never creates a job, so the panel has no failure to show and the
        // button simply looks dead. A generation that ran and failed does leave
        // a failed job, and stays in the panel as before.
        if (
          isCancel ||
          isPauseAction ||
          endpoint === "clear" ||
          refreshed?.job?.status !== "failed"
        ) {
          addToast(message);
        }
        return false;
      } finally {
        if (isCancel) {
          setLearnCancelBusy(false);
        } else if (isPauseAction) {
          setLearnPauseBusy(false);
        } else {
          setLearnBusy(false);
        }
      }
    },
    [
      addToast,
      clusterSlug,
      documents,
      fetchDocuments,
      fetchLearnStatus,
      learnIncludedSourceSlugs,
      learnSourceOnly,
      learnSyllabusSlug,
      learnUserInstruction,
    ],
  );

  const hasExistingLearnContent = Boolean(
    learnState?.latestTextbookVersionId || learnState?.hasTextbook,
  );
  const learnPanelAvailable = Boolean(
    learnState?.hasSources || hasExistingLearnContent,
  );
  const shouldRestartCancelledPlanning =
    learnState?.job?.status === "cancelled" &&
    learnState.job.mode === "plan" &&
    !learnState.job.proposedLearningMapId?.trim() &&
    !hasExistingLearnContent;
  const shouldRestartFailedPlanning =
    learnState?.job?.status === "failed" &&
    !hasExistingLearnContent &&
    ((learnState.job.mode === "plan" &&
      !learnState.job.proposedLearningMapId?.trim()) ||
      learnState.job.requiresReplan === true);
  const shouldReplanStaleMapBinding =
    !hasExistingLearnContent &&
    learnState?.sourceSetChanged === true;

  async function handleCancelLearn() {
    const status = learnState?.job?.status;
    if (
      learnCancelBusy ||
      (!isLearnActive(status) && status !== "awaiting_confirmation")
    )
      return;
    await postLearnAction("cancel", { expectedJobId: learnState?.job?.id });
  }

  async function handlePauseLearn() {
    const status = learnState?.job?.status;
    if (learnPauseBusy || learnCancelBusy || !isLearnPausable(status)) return;
    await postLearnAction("pause", { expectedJobId: learnState?.job?.id });
  }

  async function handleResumeLearn() {
    if (
      learnPauseBusy ||
      learnCancelBusy ||
      learnState?.job?.status !== "paused"
    )
      return;
    await postLearnAction("resume", { expectedJobId: learnState?.job?.id });
  }

  async function handleLearnPrimary() {
    if (learnBusy || learnCancelBusy || isLearnActive(learnState?.job?.status))
      return;
    if (learnUserInstruction.trim() && hasExistingLearnContent) {
      await postLearnAction("plan");
      return;
    }
    if (learnState?.job?.status === "awaiting_confirmation") {
      if (
        hasExistingLearnContent &&
        learnState.job.mode !== "update_sources"
      ) {
        await handleRepairIssues();
        return;
      }
      if (shouldReplanStaleMapBinding) {
        addToast("Planning a new Learning Map for the changed sources");
        await postLearnAction("plan");
        return;
      }
      setLearnPanelOpen(true);
      return;
    }
    // A source-update job resumes its exact confirmed map when possible, or
    // replans the additive merge. Unchanged existing content still uses the
    // bounded repair path.
    if (hasExistingLearnContent) {
      if (
        learnState?.job?.mode === "update_sources" &&
        learnState.job.status === "failed" &&
        !learnState.job.requiresReplan &&
        learnState.job.confirmedLearningMapId ===
          learnState.confirmedLearningMapId &&
        learnState.confirmedLearningMapId &&
        learnState.confirmedLearningMapModel
      ) {
        await postLearnAction("generate", {
          confirmedLearningMapId: learnState.confirmedLearningMapId,
          expectedModel: learnState.confirmedLearningMapModel,
        });
      } else if (
        shouldAddNewLearnMaterial ||
        learnState?.job?.mode === "update_sources"
      ) {
        addToast("Planning where the new material fits in the current lessons");
        await postLearnAction("plan");
      } else {
        await postLearnAction("regenerate", { mode: "repair" });
      }
      return;
    }
    // Cancellation rolls an unfinished planning run back to its last safe
    // checkpoint. With no proposed map to confirm and no published Learn
    // content to repair, an older confirmed map is historical state rather
    // than a valid continuation target.
    if (shouldRestartCancelledPlanning) {
      addToast("Restarting Learning Map planning for the current sources");
      await postLearnAction("plan");
      return;
    }
    // A failed planning run is rolled back without erasing older confirmed-map
    // history, while a failed generation can explicitly invalidate its map.
    // Both states require fresh planning before historical map state is
    // considered; an ordinary failed generation still retries that exact map.
    if (shouldRestartFailedPlanning) {
      addToast("Planning a new Learning Map for these sources");
      await postLearnAction("plan");
      return;
    }
    // Status computes this from the durable map/source binding, including
    // source hashes and rollback identity. Do not probe a map the server has
    // already declared stale: generation may durably start before discovering
    // the same mismatch, while fresh planning is the only useful recovery.
    if (shouldReplanStaleMapBinding) {
      addToast("Planning a new Learning Map for the changed sources");
      await postLearnAction("plan");
      return;
    }
    if (learnState?.confirmedLearningMapId) {
      const expectedModel = learnState.confirmedLearningMapModel?.trim();
      if (!expectedModel) {
        addToast(
          "This confirmed Learning Map has no verifiable planning model. Planning a new map for the current sources.",
        );
        await postLearnAction("plan");
        return;
      }
      const generated = await postLearnAction("generate", {
        confirmedLearningMapId: learnState.confirmedLearningMapId,
        expectedModel,
      });
      // The confirmed map no longer matches the sources it was planned from, so
      // generation can never succeed from it. Planning again is the documented
      // recovery and the only one reachable from this button.
      if (generated || !learnRequiresReplanRef.current) return;
      addToast("Planning a new Learning Map for these sources");
    }
    await postLearnAction("plan");
  }

  async function handleConfirmAndGenerate() {
    if (learnBusy || isLearnActive(learnState?.job?.status)) return;
    if (
      hasExistingLearnContent &&
      learnState?.job?.mode !== "update_sources"
    ) {
      await handleRepairIssues();
      return;
    }
    if (shouldReplanStaleMapBinding) {
      addToast("Planning a new Learning Map for the changed sources");
      await postLearnAction("plan");
      return;
    }
    const proposedLearningMapId =
      learnState?.job?.proposedLearningMapId?.trim();
    const expectedModel = learnState?.job?.model?.trim();
    if (
      learnState?.job?.status !== "awaiting_confirmation" ||
      !proposedLearningMapId ||
      !expectedModel
    ) {
      addToast(
        "This Learning Map is no longer the current proposal. Refresh and review the latest map before confirming.",
        "error",
      );
      await fetchLearnStatus();
      return;
    }
    await postLearnAction("confirm", {
      learningMapId: proposedLearningMapId,
      expectedModel,
      generate: true,
    });
  }

  async function handleRegenerateLearningMap() {
    if (learnBusy || isLearnActive(learnState?.job?.status)) return;
    await postLearnAction("plan");
  }

  async function handleRepairIssues() {
    if (learnBusy || learnCancelBusy || isLearnActive(learnState?.job?.status))
      return;
    if (learnUserInstruction.trim() && hasExistingLearnContent) {
      await postLearnAction("plan");
      return;
    }
    if (learnState?.job?.status === "awaiting_confirmation") {
      const cancelled = await postLearnAction("cancel", {
        expectedJobId: learnState.job.id,
      });
      if (!cancelled) return;
    }
    await postLearnAction("regenerate", { mode: "repair" });
  }

  async function handleGuidedLearnRun() {
    const instruction = learnUserInstructionDraft.trim();
    if (
      !instruction ||
      learnBusy ||
      learnCancelBusy ||
      isLearnActive(learnState?.job?.status)
    ) {
      return;
    }
    setLearnUserInstruction(instruction);
    setLearnUserInstructionDraft(instruction);
    setLearnUserInstructionOpen(false);
    if (hasExistingLearnContent) {
      await postLearnAction("plan", { userInstruction: instruction });
      return;
    }
    await postLearnAction("plan", { userInstruction: instruction });
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
  const autoConfirmLearningMapId =
    learnState?.job?.proposedLearningMapId?.trim();
  const autoConfirmLearnModel = learnState?.job?.model?.trim();
  useEffect(() => {
    if (
      !learnSkipManualReview ||
      learnBusy ||
      (hasExistingLearnContent &&
        learnState?.job?.mode !== "update_sources") ||
      shouldReplanStaleMapBinding ||
      autoConfirmLearnJobStatus !== "awaiting_confirmation" ||
      !autoConfirmLearnJobId ||
      !autoConfirmLearningMapId ||
      !autoConfirmLearnModel ||
      autoConfirmingLearnJobRef.current === autoConfirmLearnJobId
    ) {
      return;
    }
    autoConfirmingLearnJobRef.current = autoConfirmLearnJobId;
    void postLearnAction("confirm", {
      learningMapId: autoConfirmLearningMapId,
      expectedModel: autoConfirmLearnModel,
      generate: true,
    });
  }, [
    autoConfirmLearnJobId,
    autoConfirmLearnJobStatus,
    autoConfirmLearningMapId,
    autoConfirmLearnModel,
    hasExistingLearnContent,
    learnState?.job?.mode,
    learnBusy,
    learnSkipManualReview,
    postLearnAction,
    shouldReplanStaleMapBinding,
  ]);

  /**
   * Retrying does not resend the question underneath the answer it is meant to
   * replace. As in the Terminal, the transcript on screen becomes one variant
   * of this user message and the new attempt becomes another, so nothing is
   * lost and nothing is duplicated.
   */
  function handleRetryAssistant(messageIndex: number) {
    if (isStreaming || !activeChat) return;
    const userIndex = retryTargetUserMessageIndex(messages, messageIndex);
    const previousUser = messages[userIndex];
    if (!previousUser || previousUser.role !== "user") return;
    const retryAttachments = reusableChatAttachments(previousUser.attachments);
    const retryFocusedDocumentNames = normalizeFocusedDocumentNames(
      previousUser.focusedDocumentNames,
    );
    const legacyFocusedNames = new Set(retryFocusedDocumentNames);
    const retryFocusedDocumentSlugs = normalizeFocusedDocumentSlugs(
      previousUser.focusedDocumentSlugs?.length
        ? previousUser.focusedDocumentSlugs
        : documents
            .filter(
              (document) =>
                document.type === "source-document" &&
                legacyFocusedNames.has(document.title || document.name),
            )
            .map((document) => document.slug),
    );
    const failedAttempt = messages[messageIndex];
    const attemptDiedEmpty =
      failedAttempt?.role === "assistant" &&
      !failedAttempt.content?.trim() &&
      !assistantExternalAgentRunId(failedAttempt) &&
      messageIndex === messages.length - 1;
    // An attempt that produced no words at all is not worth keeping: re-run
    // the turn in place rather than parking a blank variant the switcher would
    // keep offering. Only safe for the last message, since retrying an earlier
    // one relies on the snapshot to preserve everything after it.
    if (!attemptDiedEmpty) {
      const branch = createConversationBranch<Message>({
        messages,
        branchGroups,
        userMessageIndex: userIndex,
        content: previousUser.content,
        createId: () => crypto.randomUUID(),
        createAssistantPlaceholder: (seed) => ({
          ...seed,
          role: "assistant",
          content: "",
          sources: [],
        }),
      });
      setBranchGroups((current) => ({
        ...current,
        [branch.groupId]: branch.group,
      }));
    }
    // External agents re-enter through their launchers, which know nothing
    // about this history argument; the ref is how they learn to replace the
    // retried turn instead of appending after it.
    retryBranchRef.current = {
      chatId: activeChat.id,
      historyLength: userIndex,
    };
    setInlineArtifactRetireVersion((current) => current + 1);
    void handleSubmit(
      previousUser.content,
      messages.slice(0, userIndex),
      retryAttachments,
      false,
      undefined,
      {
        focusedDocumentNames: retryFocusedDocumentNames,
        focusedDocumentSlugs: retryFocusedDocumentSlugs,
      },
    );
  }

  /** The transcript a retried turn is appended to, with the replaced turn gone. */
  function transcriptForRetriedTurn(session: ChatSession): Message[] {
    const pending = retryBranchRef.current;
    if (!pending || pending.chatId !== session.id) return session.messages;
    return session.messages.slice(0, pending.historyLength);
  }

  function switchBranch(groupId: string, direction: -1 | 1) {
    if (isStreaming || !activeChat) return;
    const group = branchGroups[groupId];
    if (!group) return;
    const targetIndex = Math.min(
      group.variants.length - 1,
      Math.max(0, group.activeIndex + direction),
    );
    if (targetIndex === group.activeIndex) return;

    const variants = group.variants.map((variant) => cloneMessages(variant));
    variants[group.activeIndex] = cloneMessages(messages);
    setBranchGroups((current) => ({
      ...current,
      [groupId]: { ...group, activeIndex: targetIndex, variants },
    }));
    const nextMessages = applyBranchVariant({
      messages,
      variant: variants[targetIndex],
      groupId,
    });
    setInlineArtifactRetireVersion((current) => current + 1);
    updateChatMessages(activeChat.id, nextMessages);
    void persistChatSession(activeChat.id, nextMessages);
  }

  /**
   * Remove one exchange: the message and the answer beneath it, up to the next
   * thing the person said.
   *
   * A garden chat is persisted as a whole transcript rather than row by row, so
   * the delete is the same write as a branch switch — replace the message list.
   * The branch group goes with it: its variants are snapshots of a transcript
   * that no longer exists, and keeping them would offer a switcher that puts
   * the deleted exchange back.
   */
  function handleDeleteUserMessage(messageIndex: number) {
    if (isStreaming || !activeChat) return;
    const target = messages[messageIndex];
    if (!target || target.role !== "user") return;
    let end = messageIndex + 1;
    while (end < messages.length && messages[end]?.role === "assistant") {
      end += 1;
    }
    const nextMessages = [
      ...messages.slice(0, messageIndex),
      ...messages.slice(end),
    ];
    const groupId = messageBranchId(target, messageIndex);
    setBranchGroups((current) => {
      if (!(groupId in current)) return current;
      const next = { ...current };
      delete next[groupId];
      return next;
    });
    updateChatMessages(activeChat.id, nextMessages);
    void persistChatSession(activeChat.id, nextMessages);
  }

  function handleEditUserMessage(messageIndex: number, text: string) {
    if (isStreaming || !activeChat) return;
    const previousUser = messages[messageIndex];
    if (!previousUser || previousUser.role !== "user") return;
    const editedAttachments = reusableChatAttachments(previousUser.attachments);
    setInlineArtifactRetireVersion((current) => current + 1);
    void handleSubmit(text, messages.slice(0, messageIndex), editedAttachments);
  }

  // Applies one queued message to the active chat turn as a course
  // correction. Resolves false when no steerable turn is active — an external
  // agent run, or a turn that finished first — so the message stays queued
  // and sends as an ordinary follow-up when the queue drains.
  async function steerActiveResponse(
    text: string,
    attachments: readonly ChatAttachment[],
  ): Promise<boolean> {
    const correction = text.trim() || attachmentOnlyMessageText(attachments);
    const context = activeSteerContextRef.current;
    if (!correction || !context) return false;

    let accepted = false;
    try {
      accepted = await agentActivity.steer(correction, attachments);
    } catch (error) {
      addToast(
        error instanceof Error
          ? error.message
          : "Could not steer the active response.",
      );
      return false;
    }
    if (!accepted || activeSteerContextRef.current !== context) return false;

    const correctionMessage: Message = {
      role: "user",
      content: correction,
      createdAt: new Date().toISOString(),
      ...(attachments.length > 0
        ? {
            attachmentNames: attachments.map((attachment) => attachment.name),
            attachments: chatMessageAttachments(attachments),
          }
        : {}),
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
    return true;
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
        error instanceof Error
          ? error.message
          : "Agent Browser is unavailable.",
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
      const selected = {
        id: MEETING_NOTES_AGENT_ID,
        name: MEETING_NOTES_AGENT_NAME,
      };
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
        error instanceof Error
          ? error.message
          : "Meeting Notes is unavailable.",
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
      setExternalAgentStatus(
        error instanceof Error ? error.message : "Formsmith is unavailable.",
      );
      return null;
    }
  }

  useEffect(() => {
    if (!formsmithAgent) return;
    if (
      agentBrowserAgent ||
      deepResearchAgent ||
      codexAgent ||
      openCodeAgent ||
      openPlanterAgent ||
      rufloAgent ||
      agentReachAgent ||
      getDocAgent ||
      meetingNotesAgent ||
      deepTutorAgent ||
      careerOpsAgent ||
      tradingAgentsAgent ||
      vibeTradingAgent ||
      deerFlowAgent ||
      shortsAgent
    ) {
      // This synchronizes a newly added selector with the older selector states.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFormsmithAgent(null);
    }
  }, [
    agentBrowserAgent,
    agentReachAgent,
    careerOpsAgent,
    codexAgent,
    deepResearchAgent,
    deepTutorAgent,
    deerFlowAgent,
    formsmithAgent,
    getDocAgent,
    meetingNotesAgent,
    openCodeAgent,
    openPlanterAgent,
    rufloAgent,
    shortsAgent,
    tradingAgentsAgent,
    vibeTradingAgent,
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
        error instanceof Error
          ? error.message
          : "Trading Agent is unavailable.",
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

  async function selectOpenExecutive(): Promise<ExternalAgentSelection | null> {
    setExternalAgentStatus("");
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
      setOpenExecutiveAgent(selected);
      if (data.available !== true && typeof data.reason === "string") {
        setExternalAgentStatus(data.reason);
      }
      return selected;
    } catch (error) {
      setExternalAgentStatus(
        error instanceof Error ? error.message : "OpenExecutive is unavailable.",
      );
      return null;
    }
  }

  // Other selectors predate OpenExecutive; this keeps their existing mutual
  // exclusion behavior without rewriting every selection path.
  useEffect(() => {
    if (!openExecutiveAgent) return;
    if (
      agentBrowserAgent ||
      deepResearchAgent ||
      codexAgent ||
      openCodeAgent ||
      openPlanterAgent ||
      rufloAgent ||
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
      formsmithAgent
    ) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOpenExecutiveAgent(null);
    }
  }, [
    agentBrowserAgent,
    agentReachAgent,
    careerOpsAgent,
    codexAgent,
    deepResearchAgent,
    deepTutorAgent,
    deerFlowAgent,
    formsmithAgent,
    getDocAgent,
    meetingNotesAgent,
    openCodeAgent,
    openExecutiveAgent,
    openPlanterAgent,
    rufloAgent,
    shortsAgent,
    stockAnalystAgent,
    tradingAgentsAgent,
    vibeTradingAgent,
  ]);

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
            explainCodexError(
              data.reason ?? data.error,
              "Codex is unavailable.",
            ),
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
            explainRufloError(
              data.reason ?? data.error,
              "Ruflo is unavailable.",
            ),
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

  // Where a launch is made durable on the server, the route that records the
  // turn owns first-prompt title generation, and this returns no title. The
  // rest of the agents here write their turn through the legacy session writer,
  // which reaches no such route, so the name is requested from the same
  // title-only completion and handed to `commitExternalAgentTurn` to persist —
  // a canonical rename, so the Terminal's view of the chat is renamed too.
  async function prepareExternalAgentSession(
    userContent: string,
    userMessageFields: Pick<Message, "attachmentNames" | "attachments"> = {},
    options: { serverNamesTheChat?: boolean } = {},
  ) {
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
    // A launch is the slowest send in the app: naming the chat, a health probe
    // and creating the run all happen before a single row is committed. Put the
    // whole turn up first — the question *and* the empty answer whose Activity
    // panel draws Thinking — so a send never reads as one that went nowhere.
    // Delegated launches never reach here, so the `/agents:*` bubble they exist
    // to avoid is still never drawn.
    const pendingTurn = (): Message[] => {
      const createdAt = new Date().toISOString();
      return [
        { role: "user", content: userContent, createdAt, ...userMessageFields },
        {
          role: "assistant",
          content: "",
          createdAt,
          sources: [],
          thinking: "",
        },
      ];
    };
    // Thinking belongs to the turn rather than to the run that answers it, so
    // it is raised with the turn and not when the request goes out — the launch
    // itself is what is being waited on, and creating the chat is already part
    // of it. Raised before the rows so both land in one render, or the empty
    // answer draws a finished "Thought" for as long as the chat takes to exist.
    externalTurnSignalRef.current = agentActivity.start();
    // A blank chat has no session to write to yet, so the stand-in carries the
    // turn until one exists.
    if (!writableActiveChat) setDraftMessages(pendingTurn());
    const session = writableActiveChat ?? (await createChatSession());
    if (!session) {
      setDraftMessages(null);
      settleExternalTurnActivity();
      // No turn will be written, so a retry waiting to replace one must not be
      // left pending for whatever launches next.
      retryBranchRef.current = null;
      return null;
    }
    updateChatMessages(session.id, [
      ...transcriptForRetriedTurn(session),
      ...pendingTurn(),
    ]);
    // The real transcript now holds this turn; the stand-in has done its job.
    setDraftMessages(null);
    return {
      session,
      // Only the turn that opens a chat names it; a launch into a chat that
      // already holds messages leaves the existing name alone.
      title:
        session.messages.length === 0 && !options.serverNamesTheChat
          ? ((await requestChatTitleFromFirstMessage(userContent, model)) ??
            undefined)
          : undefined,
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
    // The rows below replace the pending turn, so the Thinking it raised is
    // spent — whether this commit carries a run card or a failure to start.
    settleExternalTurnActivity();
    if (delegatedAgentLaunchRef.current) {
      const delegatedRequest = delegatedAgentLaunchRef.current;
      const delegatedMessages =
        inFlightChatMessagesRef.current.get(session.id) ?? session.messages;
      const workerClientMessageId = delegatedRequest.workerClientMessageId;
      if (workerClientMessageId) {
        const delegatedResult =
          (assistantMessage.externalAgentOutcome &&
            assistantMessage.externalAgentOutcome !== "running") ||
          (!assistantExternalAgentRunId(assistantMessage) &&
            assistantMessage.content.trim())
            ? assistantMessage.content
            : undefined;
        const delegatedAssistant: Message = {
          ...assistantMessage,
          role: "assistant",
          content: "",
          clientMessageId: workerClientMessageId,
          delegatedAgentRun: true,
          externalAgentName: delegatedRequest.agentName,
          externalAgentStartedAt:
            assistantMessage.externalAgentStartedAt ?? createdAt,
          externalAgentOutcome:
            assistantMessage.externalAgentOutcome ??
            (delegatedResult !== undefined ? "failed" : "running"),
          ...(delegatedResult !== undefined
            ? { externalAgentResult: delegatedResult }
            : {}),
          createdAt: assistantMessage.createdAt ?? createdAt,
        };
        const existingAssistantIndex = delegatedMessages.findIndex(
          (message) =>
            message.role === "assistant" &&
            message.clientMessageId === workerClientMessageId,
        );
        const nextMessages: Message[] =
          existingAssistantIndex >= 0
            ? delegatedMessages.map((message, index) =>
                index === existingAssistantIndex
                  ? { ...message, ...delegatedAssistant }
                  : message,
              )
            : [
                ...delegatedMessages,
                {
                  role: "user",
                  content: delegatedRequest.brief,
                  clientMessageId: workerClientMessageId,
                  internalAgentContinuation: true,
                  createdAt,
                },
                delegatedAssistant,
              ];
        const runId = assistantExternalAgentRunId(delegatedAssistant);
        const awaited = awaitedLaunchesRef.current.get(workerClientMessageId);
        if (awaited && runId) awaited.runId = runId;
        updateChatMessages(session.id, nextMessages);
        await persistChatSession(session.id, nextMessages);
        return;
      }
      let assistantIndex = -1;
      for (let index = delegatedMessages.length - 1; index >= 0; index -= 1) {
        if (delegatedMessages[index]?.role === "assistant") {
          assistantIndex = index;
          break;
        }
      }
      if (assistantIndex < 0) {
        throw new Error(
          "The assistant message for this delegated run was not found.",
        );
      }
      const delegatedResult =
        (assistantMessage.externalAgentOutcome &&
          assistantMessage.externalAgentOutcome !== "running") ||
        (!assistantExternalAgentRunId(assistantMessage) &&
          assistantMessage.content.trim())
          ? assistantMessage.content
          : undefined;
      const nextMessages = delegatedMessages.map((message, index) =>
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
                  : (message.externalAgentOutcome ?? "running")),
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
                ? {
                    externalAgentName:
                      delegatedAgentLaunchRef.current.agentName,
                  }
                : {}),
              ...(delegatedAgentLaunchRef.current?.reason
                ? {
                    delegatedAgentReason:
                      delegatedAgentLaunchRef.current.reason,
                  }
                : {}),
              externalAgentStartedAt:
                message.externalAgentStartedAt ?? createdAt,
              createdAt: message.createdAt ?? createdAt,
            }
          : message,
      );
      updateChatMessages(session.id, nextMessages);
      await persistChatSession(session.id, nextMessages);
      return;
    }
    const nextMessages: Message[] = [
      ...transcriptForRetriedTurn(session),
      { role: "user", content: userContent, createdAt, ...userMessageFields },
      { ...assistantMessage, createdAt },
    ];
    // The retried turn now has its replacement; a later launch appends again.
    retryBranchRef.current = null;
    updateChatMessages(session.id, nextMessages);
    await persistChatSession(session.id, nextMessages, title);
  }

  async function runWorkflowAutomation(
    workflow: LocalWorkflowSummary,
    workflowInput: string,
  ) {
    const request = workflowInput.trim();
    const userContent = request
      ? `Run the ${workflow.name} automation\n\n${request}`
      : `Run the ${workflow.name} automation`;
    const prepared = await prepareExternalAgentSession(userContent);
    if (!prepared) return;
    setChatStreaming(prepared.session.id, true);
    try {
      const response = await fetch(
        `/api/workflows/local/${encodeURIComponent(workflow.id)}/run`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ input: workflowInput }),
        },
      );
      const payload = (await response
        .json()
        .catch(() => ({}))) as Partial<WorkflowRunResponse> & {
        error?: string;
      };
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
      const message =
        cause instanceof Error
          ? cause.message
          : `${workflow.name} could not be run.`;
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
    const runtimeRequestId = crypto.randomUUID();
    const prepared = await prepareExternalAgentSession(userContent);
    if (!prepared) {
      externalAgentLaunchRef.current = null;
      setLaunchingExternalAgent(null);
      return;
    }
    try {
      const usesDesktopBrowser = desktopTabsBridge() !== undefined;
      const response = await fetch(
        `/api/agent-browser/agents/${encodeURIComponent(selection.id)}/runs`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            task,
            requestId: runtimeRequestId,
            browserMode: usesDesktopBrowser ? "desktop" : "external",
          }),
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.run?.runId) {
        throw new Error(agentBrowserStartFailure(data?.error));
      }
      if (usesDesktopBrowser) {
        await openBrowserAgentRunInDesktop(String(data.run.runId));
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

  /**
   * Max Research, from Garden.
   *
   * The card was already rendered here and the agent was already listed as
   * something the model may delegate to on this surface — but there was no
   * launcher and no dispatch case, so a delegated run fell to `default:` and
   * the turn said only that it had been delegated. Written against the same
   * shape as Deep Research above so the two stay legible side by side.
   */
  async function launchMaxResearch(task: string, userContentOverride?: string) {
    if (externalAgentLaunchRef.current) return;
    const question = task.trim();
    if (!question) {
      setExternalAgentStatus("Type a question for Max Research.");
      return;
    }
    externalAgentLaunchRef.current = "max-research";
    setLaunchingExternalAgent("max-research");
    setExternalAgentStatus("");
    const userContent = userContentOverride?.trim() || maxResearchUserMessage(question);
    const prepared = await prepareExternalAgentSession(userContent);
    if (!prepared) {
      externalAgentLaunchRef.current = null;
      setLaunchingExternalAgent(null);
      return;
    }
    try {
      const response = await fetch("/api/max-research/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question, model, reasoningEffort }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.run?.runId) {
        throw new Error(
          typeof data?.error === "string"
            ? data.error
            : "The Max Research run could not start.",
        );
      }
      setChatStreaming(prepared.session.id, true);
      await commitExternalAgentTurn(
        prepared.session,
        userContent,
        {
          role: "assistant",
          content: "",
          maxResearchRun: { runId: String(data.run.runId), query: question },
          externalAgentOutcome: "running" as const,
        },
        prepared.title,
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "The Max Research run could not start.";
      await commitExternalAgentTurn(
        prepared.session,
        userContent,
        { role: "assistant", content: `The Max Research run could not start: ${message}` },
        prepared.title,
      );
    } finally {
      externalAgentLaunchRef.current = null;
      setLaunchingExternalAgent(null);
      textareaRef.current?.focus();
    }
  }

  async function launchDeepResearch(
    task: string,
    userContentOverride?: string,
  ) {
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
    const userContent =
      userContentOverride?.trim() || deepResearchUserMessage(task);
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
        body: JSON.stringify({
          ...request,
          // Read-only here: the turn is committed below, and this only lets
          // the run see the chat it was launched from.
          chatSessionId: prepared.session.id,
        }),
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
        error instanceof Error
          ? error.message
          : "The research run could not start.";
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
        body: JSON.stringify({
          task,
          model,
          reasoningEffort,
          // Read-only here: the turn is committed below, and this only lets
          // the run see the chat it was launched from.
          chatSessionId: prepared.session.id,
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
      if (!task)
        setExternalAgentStatus("Describe the paper you are looking for.");
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
        body: JSON.stringify({
          task,
          model,
          reasoningEffort,
          // Read-only here: the turn is committed below, and this only lets
          // the run see the chat it was launched from.
          chatSessionId: prepared.session.id,
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
      if (!task)
        setExternalAgentStatus("Ask Deep Tutor something about this Garden.");
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
          // Read-only here: the turn is committed below, and this only lets
          // the run see the chat it was launched from.
          chatSessionId: prepared.session.id,
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
        body: JSON.stringify({
          task,
          model,
          reasoningEffort,
          // Read-only here: the turn is committed below, and this only lets
          // the run see the chat it was launched from.
          chatSessionId: prepared.session.id,
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

  async function selectDeerFlow(): Promise<ExternalAgentSelection> {
    setExternalAgentStatus("");
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
    try {
      const response = await fetch("/api/deer-flow/health");
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.cloned !== true) {
        setExternalAgentStatus(
          typeof data?.reason === "string"
            ? data.reason
            : typeof data?.error === "string"
              ? data.error
              : "DeerFlow is unavailable.",
        );
      } else if (data.available !== true && typeof data.reason === "string") {
        // Health is advisory only. Keep the mandatory agent selected so its
        // first real run can ask Runtime V2 to start it or return a truthful
        // setup/resource error.
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
      return selected;
    }
  }

  async function selectVibeTrading(): Promise<ExternalAgentSelection> {
    setExternalAgentStatus("");
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
    try {
      const response = await fetch("/api/vibe-trading/health");
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.cloned !== true) {
        setExternalAgentStatus(
          typeof data?.reason === "string"
            ? data.reason
            : typeof data?.error === "string"
              ? data.error
              : "Vibe Trading is unavailable.",
        );
      } else if (data.available !== true && typeof data.reason === "string") {
        // Observing a missing/stopped service must not hide the agent. The run
        // owns startup admission and reports any setup/resource failure.
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
      return selected;
    }
  }

  async function selectStockAnalyst(): Promise<ExternalAgentSelection> {
    setExternalAgentStatus("");
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
    try {
      const response = await fetch("/api/stock-analyst/health");
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.cloned !== true) {
        setExternalAgentStatus(
          typeof data?.reason === "string"
            ? data.reason
            : typeof data?.error === "string"
              ? data.error
              : "Stock Analyst is unavailable.",
        );
      } else if (data.available !== true && typeof data.reason === "string") {
        // Selection remains available even when setup is incomplete. Runtime
        // V2 makes the start attempt only when the user sends a real request.
        setExternalAgentStatus(data.reason);
      } else if (data.serviceRunning !== true) {
        setExternalAgentStatus(
          "Stock Analyst selected. Its backend starts with the first question, which takes about a minute.",
        );
      }
      return selected;
    } catch (error) {
      setExternalAgentStatus(
        error instanceof Error
          ? error.message
          : "Stock Analyst is unavailable.",
      );
      return selected;
    }
  }

  // Selectors written before Stock Analyst do not know its state, so fold it
  // into the same one-runtime-at-a-time contract here.
  useEffect(() => {
    if (!stockAnalystAgent) return;
    if (
      agentBrowserAgent ||
      deepResearchAgent ||
      codexAgent ||
      openCodeAgent ||
      openPlanterAgent ||
      rufloAgent ||
      agentReachAgent ||
      getDocAgent ||
      meetingNotesAgent ||
      deepTutorAgent ||
      careerOpsAgent ||
      tradingAgentsAgent ||
      vibeTradingAgent ||
      deerFlowAgent ||
      shortsAgent ||
      formsmithAgent
    ) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStockAnalystAgent(null);
    }
  }, [
    agentBrowserAgent,
    agentReachAgent,
    careerOpsAgent,
    codexAgent,
    deepResearchAgent,
    deepTutorAgent,
    deerFlowAgent,
    formsmithAgent,
    getDocAgent,
    meetingNotesAgent,
    openCodeAgent,
    openPlanterAgent,
    rufloAgent,
    shortsAgent,
    stockAnalystAgent,
    tradingAgentsAgent,
    vibeTradingAgent,
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
        body: JSON.stringify({
          request,
          model,
          chatSessionId: prepared.session.id,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.run?.runId) {
        throw new Error(
          typeof data?.error === "string"
            ? data.error
            : "The clips could not start.",
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
        throw new Error(
          typeof data?.error === "string"
            ? data.error
            : "The reconstruction could not start.",
        );
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
        body: JSON.stringify({
          task,
          model,
          reasoningEffort,
          // Read-only here: the turn is committed below, and this only lets
          // the run see the chat it was launched from.
          chatSessionId: prepared.session.id,
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

  async function launchOpenExecutive(task: string) {
    if (!task || externalAgentLaunchRef.current) {
      if (!task) {
        setExternalAgentStatus(
          "Describe the decision, problem, or initiative for the executive team.",
        );
      }
      return;
    }
    externalAgentLaunchRef.current = "openexecutive";
    setLaunchingExternalAgent("openexecutive");
    setExternalAgentStatus("");
    const userContent = openExecutiveUserMessage(task);
    const prepared = await prepareExternalAgentSession(userContent);
    if (!prepared) {
      externalAgentLaunchRef.current = null;
      setLaunchingExternalAgent(null);
      return;
    }
    try {
      const response = await fetch("/api/openexecutive/runs", {
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
              : "The OpenExecutive run could not start.",
        );
      }
      setChatStreaming(prepared.session.id, true);
      await commitExternalAgentTurn(
        prepared.session,
        userContent,
        {
          role: "assistant",
          content: "",
          openExecutiveRun: {
            runId: String(data.run.runId),
            task: typeof data.task === "string" ? data.task : task,
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
          content: `The OpenExecutive task could not start: ${
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
        body: JSON.stringify({
          task,
          model,
          reasoningEffort,
          // Read-only here: the turn is committed below, and this only lets
          // the run see the chat it was launched from.
          chatSessionId: prepared.session.id,
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
        body: JSON.stringify({
          task,
          model,
          // Read-only here: the turn is committed below, and this only lets
          // the run see the chat it was launched from.
          chatSessionId: prepared.session.id,
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
      const requestId = crypto.randomUUID();
      const response = await fetch("/api/deer-flow/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          task,
          model,
          reasoningEffort,
          clientMessageId: requestId,
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
      if (!brief)
        setExternalAgentStatus(
          "Tell the Socials Manager what the post is about.",
        );
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
      ...transcriptForRetriedTurn(prepared.session),
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
      if (!brief)
        setExternalAgentStatus("Tell Hardware Blueprint what to build.");
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
      ...transcriptForRetriedTurn(prepared.session),
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

  /**
   * God's Eye carries the tasking in the command. A quiet launch (a Super
   * Agent delegation) keeps the run's card chrome hidden and lets the framed
   * globe stand as the answer.
   */
  async function launchGodsEye(
    task: string,
    options: { userContent?: string; quiet?: boolean } = {},
  ) {
    if (!task || externalAgentLaunchRef.current) {
      if (!task) setExternalAgentStatus("Tell God's Eye where to look.");
      return;
    }
    externalAgentLaunchRef.current = "gods-eye";
    setLaunchingExternalAgent("gods-eye");
    setExternalAgentStatus("");
    const normalizedTask = task.trim();
    const userContent =
      options.userContent?.trim() || godsEyeUserMessage(normalizedTask);
    const launchClientMessageId = crypto.randomUUID();
    const prepared = await prepareExternalAgentSession(userContent);
    if (!prepared) {
      externalAgentLaunchRef.current = null;
      setLaunchingExternalAgent(null);
      return;
    }
    updateChatMessages(prepared.session.id, [
      ...transcriptForRetriedTurn(prepared.session),
      {
        id: `gods-eye-pending-${crypto.randomUUID()}`,
        role: "user",
        content: userContent,
        createdAt: new Date().toISOString(),
      },
    ]);
    try {
      const response = await fetch("/api/gods-eye/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          task: normalizedTask,
          model,
          chatSessionId: prepared.session.id,
          clientMessageId: launchClientMessageId,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.run?.runId) {
        throw new Error(typeof data?.error === "string" ? data.error : "The God's Eye run could not start.");
      }
      setChatStreaming(prepared.session.id, true);
      await commitExternalAgentTurn(
        prepared.session,
        userContent,
        {
          role: "assistant",
          content: "",
          godsEyeRun: {
            runId: String(data.run.runId),
            task: normalizedTask,
            ...(options.quiet === true ? { quiet: true } : {}),
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
          content:
            "God's Eye could not be started: " +
            (error instanceof Error ? error.message : "unknown error"),
        },
        prepared.title,
      );
    } finally {
      externalAgentLaunchRef.current = null;
      setLaunchingExternalAgent(null);
      textareaRef.current?.focus();
    }
  }

  async function launchOpenGym(
    task: string,
    options: { userContent?: string; quiet?: boolean } = {},
  ) {
    if (!task || externalAgentLaunchRef.current) {
      if (!task) setExternalAgentStatus("Tell openGym what exercise or program you need.");
      return;
    }
    externalAgentLaunchRef.current = "open-gym";
    setLaunchingExternalAgent("open-gym");
    setExternalAgentStatus("");
    const normalizedTask = task.trim();
    const userContent =
      options.userContent?.trim() || openGymUserMessage(normalizedTask);
    const launchClientMessageId = crypto.randomUUID();
    const prepared = await prepareExternalAgentSession(userContent);
    if (!prepared) {
      externalAgentLaunchRef.current = null;
      setLaunchingExternalAgent(null);
      return;
    }
    updateChatMessages(prepared.session.id, [
      ...transcriptForRetriedTurn(prepared.session),
      {
        id: `open-gym-pending-${crypto.randomUUID()}`,
        role: "user",
        content: userContent,
        createdAt: new Date().toISOString(),
      },
    ]);
    try {
      const response = await fetch("/api/open-gym/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          task: normalizedTask,
          model,
          reasoningEffort,
          chatSessionId: prepared.session.id,
          clientMessageId: launchClientMessageId,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.run?.runId) {
        throw new Error(typeof data?.error === "string" ? data.error : "The openGym run could not start.");
      }
      setChatStreaming(prepared.session.id, true);
      await commitExternalAgentTurn(
        prepared.session,
        userContent,
        {
          role: "assistant",
          content: "",
          openGymRun: {
            runId: String(data.run.runId),
            task: normalizedTask,
            ...(options.quiet === true ? { quiet: true } : {}),
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
          content: `openGym could not start: ${error instanceof Error ? error.message : "unknown error"}`,
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
      if (!brief)
        setExternalAgentStatus("Tell Parametric CAD what part to design.");
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
      ...transcriptForRetriedTurn(prepared.session),
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
      ...transcriptForRetriedTurn(prepared.session),
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
   * Vox Director turns a topic into a narrated paper-collage explainer: a beat
   * map, a poster per beat, cut-out pieces animated locally, and an MP4. The run
   * is long and entirely local, so the turn is recorded as soon as it starts and
   * the card streams into it.
   */
  async function launchVoxDirector(brief: string) {
    if (!brief || externalAgentLaunchRef.current) {
      if (!brief) setExternalAgentStatus("Tell Vox Director what to explain.");
      return;
    }
    externalAgentLaunchRef.current = "vox-director";
    setLaunchingExternalAgent("vox-director");
    setExternalAgentStatus("");
    const userContent = voxDirectorUserMessage(brief);
    const prepared = await prepareExternalAgentSession(userContent);
    if (!prepared) {
      externalAgentLaunchRef.current = null;
      setLaunchingExternalAgent(null);
      return;
    }
    updateChatMessages(prepared.session.id, [
      ...transcriptForRetriedTurn(prepared.session),
      {
        id: `vox-director-pending-${crypto.randomUUID()}`,
        role: "user",
        content: userContent,
        createdAt: new Date().toISOString(),
      },
    ]);
    try {
      const response = await fetch("/api/vox-director/runs", {
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
              : "The explainer could not start.",
        );
      }
      setChatStreaming(prepared.session.id, true);
      await commitExternalAgentTurn(
        prepared.session,
        userContent,
        {
          role: "assistant",
          content: "",
          voxDirectorRun: { runId: String(data.run.runId), brief },
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
          content: `The explainer could not start: ${
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
  async function launchLegal(
    task: string,
    attachments: readonly ChatAttachment[],
  ) {
    if (!task || externalAgentLaunchRef.current) {
      if (!task)
        setExternalAgentStatus("Tell the Legal Agent what the assignment is.");
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
      ...transcriptForRetriedTurn(prepared.session),
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
          legalRun: {
            runId: String(data.run.runId),
            task: legalRunLabel({ task }),
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
   * Wardrobe works on the photographs attached to the message: they are the
   * request, not decoration on it, so a bare command with pictures is a
   * complete instruction and the typed text is only direction for the
   * generator. Every cutout and modeled photo comes back as an artifact of this
   * Garden's chat.
   */
  async function launchWardrobe(
    direction: string,
    attachments: readonly ChatAttachment[],
  ) {
    if (externalAgentLaunchRef.current) return;
    if (!attachments.some((attachment) => attachment.type === "image")) {
      setExternalAgentStatus("Attach photos of the clothes you want imported.");
      return;
    }
    externalAgentLaunchRef.current = "wardrobe";
    setLaunchingExternalAgent("wardrobe");
    setExternalAgentStatus("");
    const userContent = wardrobeUserMessage(direction);
    const prepared = await prepareExternalAgentSession(userContent);
    if (!prepared) {
      externalAgentLaunchRef.current = null;
      setLaunchingExternalAgent(null);
      return;
    }
    updateChatMessages(prepared.session.id, [
      ...transcriptForRetriedTurn(prepared.session),
      {
        id: `wardrobe-pending-${crypto.randomUUID()}`,
        role: "user",
        content: userContent,
        createdAt: new Date().toISOString(),
        attachments: chatMessageAttachments(attachments),
      },
    ]);
    try {
      const response = await fetch("/api/wardrobe/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          task: direction,
          model,
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
              : "The import could not start.",
        );
      }
      setChatStreaming(prepared.session.id, true);
      await commitExternalAgentTurn(
        prepared.session,
        userContent,
        {
          role: "assistant",
          content: "",
          wardrobeRun: {
            runId: String(data.run.runId),
            task: wardrobeRunLabel({
              photos: attachments.filter((item) => item.type === "image")
                .length,
              direction,
            }),
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
          content: `The import could not start: ${
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
      if (!brief)
        setExternalAgentStatus(
          "Tell MoneyPrinter what the video should be about.",
        );
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
      ...transcriptForRetriedTurn(prepared.session),
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
      if (!task)
        setExternalAgentStatus("Tell OpenWork what to do in your workspace.");
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
      ...transcriptForRetriedTurn(prepared.session),
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
      if (!task)
        setExternalAgentStatus("Tell Inbox Zero what to do with your email.");
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
      ...transcriptForRetriedTurn(prepared.session),
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
      if (!task)
        setExternalAgentStatus("Tell OpenScience what to investigate.");
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
      ...transcriptForRetriedTurn(prepared.session),
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

  async function launchPraxist(task: string) {
    const taskPath = parsePraxistTaskPath(task);
    if (!taskPath || externalAgentLaunchRef.current) {
      if (!taskPath) setExternalAgentStatus("Add the absolute Praxist task-project directory.");
      return;
    }
    externalAgentLaunchRef.current = "praxist";
    setLaunchingExternalAgent("praxist");
    setExternalAgentStatus("");
    const userContent = praxistUserMessage(taskPath);
    const prepared = await prepareExternalAgentSession(userContent);
    if (!prepared) {
      externalAgentLaunchRef.current = null;
      setLaunchingExternalAgent(null);
      return;
    }
    updateChatMessages(prepared.session.id, [
      ...transcriptForRetriedTurn(prepared.session),
      {
        id: `praxist-pending-${crypto.randomUUID()}`,
        role: "user",
        content: userContent,
        createdAt: new Date().toISOString(),
      },
    ]);
    try {
      const response = await fetch("/api/praxist/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ task: taskPath, model, chatSessionId: prepared.session.id }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.run?.runId) {
        throw new Error(typeof data?.error === "string" ? data.error : "The Praxist run could not start.");
      }
      setChatStreaming(prepared.session.id, true);
      await commitExternalAgentTurn(
        prepared.session,
        userContent,
        {
          role: "assistant",
          content: "",
          praxistRun: { runId: String(data.run.runId), task: taskPath },
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
          content: `The Praxist run could not start: ${error instanceof Error ? error.message : "unknown error"}`,
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
      if (!brief)
        setExternalAgentStatus("Tell HyperFrames what video to make.");
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
      ...transcriptForRetriedTurn(prepared.session),
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
      if (!brief)
        setExternalAgentStatus(
          "Describe the artifact Resource2Skill should build.",
        );
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
      ...transcriptForRetriedTurn(prepared.session),
      {
        id: `resource2skill-pending-${crypto.randomUUID()}`,
        role: "user",
        content: userContent,
        createdAt: new Date().toISOString(),
      },
    ]);
    try {
      const response = await fetch("/api/resource2skill/runs", {
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
              : "The Resource2Skill run could not start.",
        );
      }
      setChatStreaming(prepared.session.id, true);
      await commitExternalAgentTurn(
        prepared.session,
        userContent,
        {
          role: "assistant",
          content: "",
          resource2SkillRun: { runId: String(data.run.runId), brief },
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
          content: `The Resource2Skill run could not start: ${error instanceof Error ? error.message : "unknown error"}`,
        },
        prepared.title,
      );
    } finally {
      externalAgentLaunchRef.current = null;
      setLaunchingExternalAgent(null);
      textareaRef.current?.focus();
    }
  }

  async function launchMatraix(brief: string) {
    if (!brief || externalAgentLaunchRef.current) {
      if (!brief)
        setExternalAgentStatus("Tell MatrAIx what to put to a simulated population.");
      return;
    }
    externalAgentLaunchRef.current = "matraix";
    setLaunchingExternalAgent("matraix");
    setExternalAgentStatus("");
    const userContent = matraixUserMessage(brief);
    const prepared = await prepareExternalAgentSession(userContent);
    if (!prepared) {
      externalAgentLaunchRef.current = null;
      setLaunchingExternalAgent(null);
      return;
    }
    updateChatMessages(prepared.session.id, [
      ...transcriptForRetriedTurn(prepared.session),
      {
        id: `matraix-pending-${crypto.randomUUID()}`,
        role: "user",
        content: userContent,
        createdAt: new Date().toISOString(),
      },
    ]);
    try {
      const response = await fetch("/api/matraix/runs", {
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
              : "The MatrAIx study could not start.",
        );
      }
      setChatStreaming(prepared.session.id, true);
      await commitExternalAgentTurn(
        prepared.session,
        userContent,
        {
          role: "assistant",
          content: "",
          matraixRun: { runId: String(data.run.runId), brief },
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
          content: `The MatrAIx study could not start: ${error instanceof Error ? error.message : "unknown error"}`,
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
   * Classroom carries the lesson in the command and takes the attachments as
   * its material. The classroom itself lives on OpenMAIC's local server and
   * comes back as a link and an artifact of this Garden's chat.
   */
  async function launchClassroom(brief: string, attachments: readonly ChatAttachment[]) {
    if (!brief || externalAgentLaunchRef.current) {
      if (!brief) setExternalAgentStatus("Tell Classroom what to teach.");
      return;
    }
    externalAgentLaunchRef.current = "classroom";
    setLaunchingExternalAgent("classroom");
    setExternalAgentStatus("");
    const userContent = classroomUserMessage(brief);
    const prepared = await prepareExternalAgentSession(userContent);
    if (!prepared) {
      externalAgentLaunchRef.current = null;
      setLaunchingExternalAgent(null);
      return;
    }
    updateChatMessages(prepared.session.id, [
      ...transcriptForRetriedTurn(prepared.session),
      {
        id: "classroom-pending-" + crypto.randomUUID(),
        role: "user",
        content: userContent,
        createdAt: new Date().toISOString(),
        attachments: chatMessageAttachments(attachments),
      },
    ]);
    try {
      const response = await fetch("/api/classroom/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          brief,
          model,
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
              : "The classroom could not be started.",
        );
      }
      setChatStreaming(prepared.session.id, true);
      await commitExternalAgentTurn(
        prepared.session,
        userContent,
        {
          role: "assistant",
          content: "",
          classroomRun: { runId: String(data.run.runId), brief },
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
          content:
            "The classroom could not be started: " +
            (error instanceof Error ? error.message : "unknown error"),
        },
        prepared.title,
      );
    } finally {
      externalAgentLaunchRef.current = null;
      setLaunchingExternalAgent(null);
      textareaRef.current?.focus();
    }
  }

  async function launchBoltSlides(brief: string) {
    if (!brief || externalAgentLaunchRef.current) {
      if (!brief) setExternalAgentStatus("Tell Bolt Slides what the deck is about.");
      return;
    }
    externalAgentLaunchRef.current = "bolt-slides";
    setLaunchingExternalAgent("bolt-slides");
    setExternalAgentStatus("");
    const userContent = boltSlidesUserMessage(brief);
    const prepared = await prepareExternalAgentSession(userContent);
    if (!prepared) {
      externalAgentLaunchRef.current = null;
      setLaunchingExternalAgent(null);
      return;
    }
    updateChatMessages(prepared.session.id, [
      ...transcriptForRetriedTurn(prepared.session),
      {
        id: `bolt-slides-pending-${crypto.randomUUID()}`,
        role: "user",
        content: userContent,
        createdAt: new Date().toISOString(),
      },
    ]);
    try {
      const response = await fetch("/api/bolt-slides/runs", {
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
              : "The deck could not be started.",
        );
      }
      setChatStreaming(prepared.session.id, true);
      await commitExternalAgentTurn(
        prepared.session,
        userContent,
        {
          role: "assistant",
          content: "",
          boltSlidesRun: { runId: String(data.run.runId), brief },
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
          content: `The deck could not be started: ${error instanceof Error ? error.message : "unknown error"}`,
        },
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
      if (!brief)
        setExternalAgentStatus("Tell OpenMontage what video to produce.");
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
      ...transcriptForRetriedTurn(prepared.session),
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
      delegatedRequest
        ? agentLaunchWorkerClientMessageId(delegatedRequest)
        : crypto.randomUUID();
    const persistedAttachments = chatMessageAttachments(attachments);
    const userMessageFields = persistedAttachments.length
      ? {
          attachmentNames: persistedAttachments.map(
            (attachment) => attachment.name,
          ),
          attachments: persistedAttachments,
        }
      : {};
    const prepared = await prepareExternalAgentSession(
      userContent,
      userMessageFields,
      // The runs route records this turn durably and names the chat from it.
      { serverNamesTheChat: true },
    );
    if (!prepared) {
      externalAgentLaunchRef.current = null;
      setLaunchingExternalAgent(null);
      return;
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
          attachToExistingTurn: Boolean(
            delegatedRequest && !delegatedRequest.workerClientMessageId,
          ),
          delegatedAgentRun: Boolean(delegatedRequest?.workerClientMessageId),
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
            explainCodexError(data?.error, "The Codex task could not start."),
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
          settleExternalTurnActivity();
          updateChatMessages(prepared.session.id, [
            ...transcriptForRetriedTurn(prepared.session),
            {
              role: "user",
              content: userContent,
              createdAt,
              ...userMessageFields,
            },
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
          attachmentNames: persistedAttachments.map(
            (attachment) => attachment.name,
          ),
          attachments: persistedAttachments,
        }
      : {};
    const prepared = await prepareExternalAgentSession(
      userContent,
      userMessageFields,
    );
    if (!prepared) {
      externalAgentLaunchRef.current = null;
      setLaunchingExternalAgent(null);
      return;
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
          // Read-only here: the turn is committed below, and this only lets the
          // run see the chat it was launched from.
          chatSessionId: prepared.session.id,
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
      if (!task)
        setExternalAgentStatus("Type an objective for the Ruflo swarm.");
      return;
    }
    externalAgentLaunchRef.current = "ruflo";
    setLaunchingExternalAgent("ruflo");
    setExternalAgentStatus("");
    const userContent = rufloUserMessage(task);
    const persistedAttachments = chatMessageAttachments(attachments);
    const userMessageFields = persistedAttachments.length
      ? {
          attachmentNames: persistedAttachments.map(
            (attachment) => attachment.name,
          ),
          attachments: persistedAttachments,
        }
      : {};
    const prepared = await prepareExternalAgentSession(
      userContent,
      userMessageFields,
    );
    if (!prepared) {
      externalAgentLaunchRef.current = null;
      setLaunchingExternalAgent(null);
      return;
    }
    try {
      const response = await fetch("/api/ruflo/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          task,
          gardenSlug: clusterSlug,
          // Read-only here: the turn is committed below, and this only lets the
          // swarm see the chat it was launched from.
          chatSessionId: prepared.session.id,
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
    // Several workers can settle in the same render. Merge into the latest
    // in-flight transcript rather than each callback's render-time snapshot,
    // or the second completion would overwrite the first one.
    const baseMessages =
      inFlightChatMessagesRef.current.get(session.id) ?? session.messages;
    const completedAtMs = Date.now();
    const nextMessages = baseMessages.map((message) => {
      if (!ownsRun(message)) return message;
      const responseDurationMs = externalAgentResponseDurationMs({
        baseDurationMs: message.responseDurationMs,
        startedAt: message.externalAgentStartedAt,
        endedAtMs: completedAtMs,
      });
      return {
        ...message,
        content:
          message.delegatedAgentRun === true
            ? message.content
            : result.content,
        ...(message.delegatedAgentRun === true
          ? { externalAgentResult: result.content }
          : {}),
        externalAgentOutcome: result.outcome,
        ...(responseDurationMs !== undefined ? { responseDurationMs } : {}),
        responseCompletedAt: new Date(completedAtMs).toISOString(),
        ...(result.usage ? { usage: result.usage } : {}),
        ...(result.activity?.length
          ? { externalAgentActivity: result.activity }
          : {}),
        ...(result.edits ? { externalAgentEdits: result.edits } : {}),
        ...(result.state ? { externalAgentState: result.state } : {}),
      };
    });
    setChatStreaming(
      session.id,
      steerableTurnActive ||
        nextMessages.some(
          (message) =>
            message.role === "assistant" &&
            assistantExternalAgentRunId(message) !== null &&
            (message.externalAgentOutcome ?? "running") === "running",
        ),
    );
    updateChatMessages(session.id, nextMessages);
    void persistChatSession(session.id, nextMessages);

    const owner = baseMessages.find(
      (message) => ownsRun(message) && message.role === "assistant",
    );
    const continuationKey = owner?.clientMessageId ?? runId;
    if (owner?.openGymRun) {
      continuedDelegatedRunsRef.current.add(continuationKey);
      awaitedLaunchesRef.current.delete(continuationKey);
      return;
    }

    // If the assistant started this run and asked to hear how it went, hand the
    // outcome back as a new turn. Matching on the bound run id keeps a run the
    // user started themselves out of the chain.
    const awaitedEntry = [...awaitedLaunchesRef.current.entries()].find(
      ([, awaited]) => awaited.runId === runId,
    );
    if (!awaitedEntry) return;
    const [workerClientMessageId, awaited] = awaitedEntry;
    awaitedLaunchesRef.current.delete(workerClientMessageId);
    if (continuedDelegatedRunsRef.current.has(workerClientMessageId)) return;
    continuedDelegatedRunsRef.current.add(workerClientMessageId);
    if (launchHopsRef.current >= MAX_AGENT_LAUNCH_HOPS) {
      setExternalAgentStatus(
        `${awaited.agentName} finished. The assistant has handed off ${launchHopsRef.current} times in a row, so it is waiting for you before going further.`,
      );
      return;
    }
    setPendingLaunchContinuations((current) => [
      ...current,
      agentLaunchContinuationMessage({
        continuationId: workerClientMessageId,
        agentName: awaited.agentName,
        reason: awaited.reason,
        outcome: result.outcome,
        content: result.content,
        remaining: awaitedLaunchesRef.current.size,
      }),
    ]);
  }

  async function handleSubmit(
    textOverride?: string,
    historyOverride?: Message[],
    attachmentOverride?: readonly ChatAttachment[],
    internalAgentContinuation = false,
    onTurnStarted?: () => void,
    turnOptions?: {
      textSelection?: ChatTextSelectionReference;
      focusedDocumentNames?: string[];
      focusedDocumentSlugs?: string[];
    },
  ) {
    const textSelection = turnOptions?.textSelection;
    // Only a retry sets the branch it is replacing, and only a retry passes a
    // history. Anything else that reaches a launcher appends as usual.
    if (historyOverride === undefined) retryBranchRef.current = null;
    const text = (textOverride ?? input).trim();
    const pendingAttachments: ChatAttachment[] = attachmentOverride
      ? [...attachmentOverride]
      : textOverride === undefined
        ? chatAttachments
        : [];
    if (
      (!text && pendingAttachments.length === 0) ||
      (internalAgentContinuation ? steerableTurnActive : isStreaming) ||
      launchingExternalAgent ||
      openGymRoutingRef.current
    )
      return;

    // Only the composer calls this with no override, so this is the one place
    // that knows a human is speaking: it ends whatever hand-off chain was
    // running and drops any launch still waiting to be confirmed.
    if (textOverride === undefined) {
      launchHopsRef.current = 0;
      launchRoundOriginsRef.current.clear();
      awaitedLaunchesRef.current.clear();
      setPendingLaunchContinuations([]);
      agentLaunchQueue.reset();
    }

    // A private worker result belongs to Hermes, regardless of which runtime
    // agent the person's composer currently has selected. Letting it enter the
    // routing cascade below can send the hand-back into that agent instead of
    // starting the Super Agent synthesis, leaving the delegating row terminal.
    // A selected-text question is likewise bound to its excerpt: it is always
    // answered here, never routed into a launcher or an external agent.
    if (!internalAgentContinuation && !textSelection) {
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
        (openExecutiveAgent && "openexecutive") ||
        (tradingAgentsAgent && "trading-agent") ||
        (shortsAgent && "shorts") ||
        (formsmithAgent && "formsmith") ||
        (vibeTradingAgent && "vibe-trading") ||
        (stockAnalystAgent && "stock-analyst") ||
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
            codexTask ||
              "Review the attached screenshot and implement the requested fix.",
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
            rufloTask ||
              "Review the attached screenshot and implement the requested fix.",
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
            openCodeTask ||
              "Review the attached screenshot and implement the requested fix.",
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

    const godsEyeTask = taskFromGodsEyeCommand(text);
    if (godsEyeTask !== null) {
      setInput("");
      setChatAttachments([]);
      void launchGodsEye(godsEyeTask);
      return;
    }

    const openGymTask = taskFromOpenGymCommand(text);
    if (openGymTask !== null) {
      setInput("");
      setChatAttachments([]);
      void launchOpenGym(openGymTask);
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

    const matraixBrief = taskFromMatraixCommand(text);
    if (matraixBrief !== null) {
      setInput("");
      setChatAttachments([]);
      void launchMatraix(matraixBrief);
      return;
    }

    const boltSlidesBrief = taskFromBoltSlidesCommand(text);
    if (boltSlidesBrief !== null) {
      setInput("");
      setChatAttachments([]);
      void launchBoltSlides(boltSlidesBrief);
      return;
    }

    // Classroom reads the attachments as its material, so they go with it.
    const classroomBrief = taskFromClassroomCommand(text);
    if (classroomBrief !== null) {
      const classroomMaterial = pendingAttachments;
      setInput("");
      setChatAttachments([]);
      void launchClassroom(classroomBrief, classroomMaterial);
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
    const openExecutiveTask = taskFromOpenExecutiveCommand(text);
    if (openExecutiveTask !== null) {
      setInput("");
      setChatAttachments([]);
      void (async () => {
        const selected =
          openExecutiveAgent ?? (await selectOpenExecutive());
        if (selected && openExecutiveTask) {
          await launchOpenExecutive(openExecutiveTask);
        }
      })();
      return;
    }

    const praxistTask = taskFromPraxistCommand(text);
    if (praxistTask !== null) {
      setInput("");
      setChatAttachments([]);
      void launchPraxist(praxistTask);
      return;
    }

    const inboxZeroTask = taskFromInboxZeroCommand(text);
    if (inboxZeroTask !== null) {
      setInput("");
      setChatAttachments([]);
      void launchInboxZero(inboxZeroTask);
      return;
    }

    const explainerBrief = briefFromVoxDirectorCommand(text);
    if (explainerBrief !== null) {
      setExternalAgentStatus("");
      if (explainerBrief) {
        void launchVoxDirector(explainerBrief);
      }
      return true;
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

    // Same for Wardrobe, whose attachments are the photographs it reads.
    const wardrobeDirection = taskFromWardrobeCommand(text);
    if (wardrobeDirection !== null) {
      const wardrobePhotos = pendingAttachments;
      setInput("");
      setChatAttachments([]);
      void launchWardrobe(wardrobeDirection, wardrobePhotos);
      return;
    }

    const deepResearchInvocation = directDeepResearchInvocation(text, false);
    if (deepResearchInvocation) {
      setInput("");
      setChatAttachments([]);
      void (async () => {
        if (deepResearchInvocation.selectAgent && !deepResearchAgent) {
          await selectDeepResearch();
        }
        await launchDeepResearch(
          deepResearchInvocation.task,
          deepResearchInvocation.selectAgent ? undefined : text,
        );
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
        text ||
          "Review the attached screenshot and implement the requested fix.",
        pendingAttachments,
      );
      return;
    }
    if (codexAgent) {
      setInput("");
      setChatAttachments([]);
      void launchCodex(
        text ||
          "Review the attached screenshot and implement the requested fix.",
        pendingAttachments,
      );
      return;
    }
    if (openCodeAgent) {
      setInput("");
      setChatAttachments([]);
      void launchOpenCode(
        text ||
          "Review the attached screenshot and implement the requested fix.",
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
    if (openExecutiveAgent) {
      setInput("");
      setChatAttachments([]);
      void launchOpenExecutive(text);
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

    // Super Agent cannot opt out of a registered exercise presentation. Resolve
    // likely form/program requests before the model turn; a catalogue match
    // starts the quiet openGym result while preserving the user's own wording
    // in the transcript. Internal hand-back turns and attachment workflows are
    // excluded so this routing boundary cannot consume another capability.
    if (
      !internalAgentContinuation &&
      isSuperAgentEnabled() &&
      text &&
      pendingAttachments.length === 0
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
        setChatAttachments([]);
        await launchOpenGym(text, { userContent: text, quiet: true });
        return;
      }
    }
    }

    const responseStartedAt = performance.now();

    // Snapshot uploaded attachments and Garden documents together with this
    // question. Garden focus remains a separate metadata field so the chips
    // survive a reload without pretending those existing documents are new
    // uploads elsewhere in the app.
    const attachmentNames = pendingAttachments.map((a) => a.name);
    const focusedDocumentSlugs = internalAgentContinuation
      ? []
      : normalizeFocusedDocumentSlugs(
          turnOptions?.focusedDocumentSlugs ?? selectedDocumentSlugs,
        );
    const focusedSlugSet = new Set(focusedDocumentSlugs);
    const focusedDocumentNames = internalAgentContinuation
      ? []
      : normalizeFocusedDocumentNames(
          turnOptions?.focusedDocumentNames?.length
            ? turnOptions.focusedDocumentNames
            : documents
                .filter(
                  (document) =>
                    document.type === "source-document" &&
                    focusedSlugSet.has(document.slug),
                )
                .map((document) => document.title || document.name),
        );

    const displayText =
      text ||
      (attachmentNames.length > 0
        ? `Attached: ${attachmentNames.join(", ")}`
        : "");
    const turnCreatedAt = new Date().toISOString();
    const clientMessageId = crypto.randomUUID();
    const userMsg: Message = {
      clientMessageId,
      role: "user",
      content: displayText,
      createdAt: turnCreatedAt,
      ...(internalAgentContinuation ? { internalAgentContinuation: true } : {}),
      ...(textSelection ? { textSelection } : {}),
      ...(attachmentNames.length > 0 ? { attachmentNames } : {}),
      ...(pendingAttachments.length > 0
        ? { attachments: chatMessageAttachments(pendingAttachments) }
        : {}),
      ...(focusedDocumentNames.length > 0 ? { focusedDocumentNames } : {}),
      ...(focusedDocumentSlugs.length > 0 ? { focusedDocumentSlugs } : {}),
    };

    // Nothing below can run until the chat exists, and on a blank chat that is
    // a round trip. Empty the composer and put the message up first so a send
    // reads as instant; both are undone if the turn never starts.
    const writableActiveChat = activeChat?.isOwn === false ? null : activeChat;
    const composerSend = textOverride === undefined;
    const showedDraft = !writableActiveChat && !internalAgentContinuation;
    if (composerSend) {
      setInput("");
      setChatAttachments([]);
    }
    // The empty assistant row rides along so the answer's own bubble, and the
    // thinking indicator inside it, is up as early as the question is. Thinking
    // belongs to the turn rather than to the response, so the activity starts
    // here instead of when the runtime request goes out.
    let agentSignal: AbortSignal | undefined;
    if (showedDraft) {
      setDraftMessages([
        userMsg,
        {
          clientMessageId,
          role: "assistant",
          content: "",
          createdAt: turnCreatedAt,
          sources: [],
          thinking: "",
        },
      ]);
      // A draft is only used while the new chat does not exist yet. The local
      // abort signal still lets Stop win that creation race; the exact durable
      // turn identity is bound as soon as the session/checkpoint is returned.
      activeGardenTurnRef.current = null;
      agentSignal = agentActivity.start();
    }
    const abandonTurn = () => {
      if (showedDraft) setDraftMessages(null);
      if (agentSignal) agentActivity.finish(false, agentSignal);
      if (composerSend) {
        setInput(text);
        setChatAttachments(pendingAttachments);
      }
    };

    const session = writableActiveChat ?? (await createChatSession());
    if (!session) {
      abandonTurn();
      return;
    }

    const sessionId = session.id;
    activeGardenTurnRef.current = {
      sessionId,
      clientMessageId,
      conversationId: session.conversationId ?? null,
    };
    agentActivity.bindSession(session.conversationId ?? null);
    // Stop may have been clicked while a new chat was being created. There is
    // no checkpoint to cancel yet, and the aborted viewer must not dispatch it.
    if (agentSignal?.aborted) {
      activeGardenTurnRef.current = null;
      abandonTurn();
      return;
    }
    if (
      streamingChatIdsRef.current.has(sessionId) &&
      !internalAgentContinuation
    ) {
      abandonTurn();
      return;
    }
    // Past every launcher: this turn is answered here, and the history above
    // already excludes the retried turn, so the launcher hand-off is spent.
    retryBranchRef.current = null;
    const history =
      historyOverride ??
      (internalAgentContinuation
        ? (inFlightChatMessagesRef.current.get(sessionId) ?? session.messages)
        : session.messages);
    // The canonical first-turn pipeline replaces "New chat" with the title
    // returned by its dedicated plain-LLM request. Do not race it with a
    // browser-side heuristic when this transcript is persisted.
    const title: string | undefined = undefined;
    const steerContext = { sessionId, messages: [] as Message[] };
    activeSteerContextRef.current = steerContext;

    const nextMessages = [...history, userMsg];
    const assistantMsg: Message = {
      clientMessageId,
      role: "assistant",
      content: "",
      createdAt: turnCreatedAt,
      sources: [],
      thinking: "",
      // The answer of an "Ask here" turn belongs to its highlight, not to the
      // transcript; carrying the anchor is what routes it into the popover.
      ...(textSelection ? { textSelection } : {}),
    };
    const messagesWithAssistant = () => {
      const composed = [
        ...nextMessages,
        ...steerContext.messages,
        { ...assistantMsg },
      ];
      // A background worker can finish while Hermes streams an interim
      // synthesis. Preserve the worker's latest terminal metadata whenever the
      // stream republishes its own snapshot of the transcript.
      const liveTranscript = inFlightChatMessagesRef.current.get(sessionId);
      if (!liveTranscript) return composed;
      const liveExternalByRunId = new Map(
        liveTranscript.flatMap((message) => {
          const runId = assistantExternalAgentRunId(message);
          return message.role === "assistant" && runId
            ? [[runId, message] as const]
            : [];
        }),
      );
      return composed.map((message) => {
        const runId = assistantExternalAgentRunId(message);
        const live = runId ? liveExternalByRunId.get(runId) : undefined;
        return live ? { ...message, ...live } : message;
      });
    };
    let finalMessages = messagesWithAssistant();

    setInput("");
    setChatAttachments([]);
    setChatStreaming(sessionId, true);
    chatHistoryEpoch.current += 1;
    updateChatMessages(sessionId, finalMessages);
    // Both halves of the turn must exist in one durable commit before any
    // attachment, skill, model, or runtime preparation starts. A service
    // restart can now either resume this answer or terminalize it; it can no
    // longer restore the question alone.
    let checkpointSaved = false;
    try {
      const checkpoint = await reserveGardenTurnCheckpoint(
        sessionId,
        clientMessageId,
        textSelection
          ? { ...userMsg, selectedText: textSelection.quote }
          : userMsg,
      );
      userMsg.id = checkpoint.userMessageId;
      assistantMsg.id = checkpoint.assistantMessageId;
      activeGardenTurnRef.current = {
        sessionId,
        clientMessageId,
        conversationId:
          checkpoint.conversationId ?? session.conversationId ?? null,
      };
      agentActivity.bindSession(
        checkpoint.conversationId ?? session.conversationId ?? null,
      );
      checkpointSaved = true;
    } catch {
      addToast("Chat was not saved");
    }
    if (!checkpointSaved) {
      setChatStreaming(sessionId, awaitedLaunchesRef.current.size > 0);
      updateChatMessages(sessionId, history);
      if (activeSteerContextRef.current === steerContext) {
        activeSteerContextRef.current = null;
      }
      abandonTurn();
      return;
    }
    if (agentSignal?.aborted) {
      // Stop can race the checkpoint POST itself. The first DELETE may have
      // arrived before the row existed, so seal it once more now that the
      // reservation is authoritative and never enter the model pipeline.
      await abortGardenTurnCheckpoint(sessionId, clientMessageId);
      assistantMsg.content = "(stopped)";
      assistantMsg.responseDurationMs = Math.round(
        performance.now() - responseStartedAt,
      );
      assistantMsg.responseCompletedAt = new Date().toISOString();
      updateChatMessages(sessionId, messagesWithAssistant());
      setChatStreaming(sessionId, false);
      activeGardenTurnRef.current = null;
      return;
    }
    try {
      onTurnStarted?.();
    } catch {
      // The chat turn is already visible and owns the stream. An optional
      // hand-off bookkeeping callback cannot be allowed to cancel it.
    }
    // The real transcript now holds this turn; the stand-in has done its job.
    if (showedDraft) setDraftMessages(null);
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
        // Answered without the runtime, so the Thinking a drafted turn raised
        // has to be put down here.
        if (agentSignal) agentActivity.finish(false, agentSignal);
        assistantMsg.responseDurationMs = Math.round(
          performance.now() - responseStartedAt,
        );
        assistantMsg.responseCompletedAt = new Date().toISOString();
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
        // These branches answer without the runtime, so the Thinking a drafted
        // turn raised has to be put down here.
        if (agentSignal) agentActivity.finish(false, agentSignal);
        assistantMsg.responseDurationMs = Math.round(
          performance.now() - responseStartedAt,
        );
        assistantMsg.responseCompletedAt = new Date().toISOString();
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
    // Once the server has accepted a Garden turn, the response belongs to its
    // detached pump. A browser stream disappearing only retires this viewer; it
    // is not an assistant answer and must never be written into the transcript.
    let viewerDetached = false;
    // The checkpoint above and the Garden adapter both reserve this turn by
    // clientMessageId. They must see the same user content or an attachment-only
    // turn (and every selected-text turn) looks like an idempotency collision.
    // Attachments and selected-text context already travel in their dedicated
    // request fields, so the model does not need a rewritten last user message.
    try {
      // A drafted turn already raised Thinking when the message went up.
      agentSignal =
        agentSignal ?? agentActivity.start(session.conversationId ?? null);
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // For the last user message, send the real typed text (attachments add context separately)
          messages: nextMessages.map(({ role, content }) => ({ role, content })),
          clusterSlug,
          chatSessionId: sessionId,
          clientMessageId,
          model,
          reasoningEffort,
          attachments: pendingAttachments,
          selectedDocumentSlugs: focusedDocumentSlugs,
          ...(textSelection
            ? {
                selectedTextContext: {
                  requestId: textSelection.id,
                  highlightId: textSelection.id,
                  mode: textSelection.mode,
                  text: textSelection.quote,
                  prefix: textSelection.prefix,
                  suffix: textSelection.suffix,
                },
              }
            : {}),
          adhdMode: isDirectModeEnabled(),
          personalize: isPersonalizeEnabled(),
          // A worker's result is handed back on a hidden turn, and that turn is
          // the visible answer. Say so, or its evidence panel cannot name the
          // agent whose run it is reporting.
          ...(internalAgentContinuation
            ? { internalAgentContinuation: true }
            : {}),
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
              | { type: "provisional"; text: string }
              | { type: "replace"; text: string }
              | { type: "segment"; text: string; streamed: boolean }
              | { type: "thinking"; text: string; detailMode?: "append" | "replace" }
              | {
                  type: "tool";
                  toolName?: string;
                  status?: string;
                  details?: unknown;
                  uiResources?: unknown;
                }
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
            } else if (event.type === "tool" && event.status === "completed") {
              if (event.toolName === "garden_import_source") handleGardenSourceImportResult(event.details);
              const resources = normalizeGenerativeUiResources(event.uiResources);
              if (resources.length) {
                assistantMsg.uiResources = [
                  ...(assistantMsg.uiResources ?? []).filter(
                    (current) => !resources.some((next) => next.id === current.id),
                  ),
                  ...resources,
                ];
                finalMessages = messagesWithAssistant();
                updateChatMessages(sessionId, finalMessages);
              }
            } else if (event.type === "delta" || event.type === "thinking") {
              Object.assign(
                assistantMsg,
                applyGardenStableTextEvent(assistantMsg, event),
              );
              finalMessages = messagesWithAssistant();
              updateChatMessages(sessionId, finalMessages);
            } else if (event.type === "provisional") {
              Object.assign(
                assistantMsg,
                applyGardenStableTextEvent(assistantMsg, event),
              );
              finalMessages = messagesWithAssistant();
              updateChatMessages(sessionId, finalMessages);
            } else if (event.type === "replace") {
              Object.assign(
                assistantMsg,
                applyGardenStableTextEvent(assistantMsg, event),
              );
              finalMessages = messagesWithAssistant();
              updateChatMessages(sessionId, finalMessages);
            } else if (event.type === "segment") {
              Object.assign(
                assistantMsg,
                applyGardenStableTextEvent(assistantMsg, event),
              );
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
              window.dispatchEvent(
                new CustomEvent(ARTIFACT_BROWSER_EVENT, { detail: event }),
              );
            }
          } catch {
            // malformed event — skip
          }
        }
      }
    } catch (error) {
      const aborted = error instanceof Error && error.name === "AbortError";
      viewerDetached = isRecoverableAgentStreamDisconnect(error);
      if (!viewerDetached) {
        agentFailed = !aborted;
        assistantMsg.content = aborted
          ? assistantMsg.content || "(stopped)"
          : error instanceof Error && error.message.trim()
            ? error.message
            : "Something went wrong. Please try again.";
        finalMessages = messagesWithAssistant();
        updateChatMessages(sessionId, finalMessages);
      }
    } finally {
      agentActivity.finish(agentFailed, agentSignal);
      if (viewerDetached) {
        // Drop the stale browser snapshot before reconciling. Keeping it in the
        // in-flight map would hide the server-owned checkpoint and, eventually,
        // the real completed answer.
        setChatStreaming(sessionId, false);
        await refreshChatSession(sessionId);
        void refreshRail();
      } else {
        assistantMsg.responseDurationMs = Math.round(
          performance.now() - responseStartedAt,
        );
        assistantMsg.responseCompletedAt = new Date().toISOString();
        finalMessages = messagesWithAssistant();
        updateChatMessages(sessionId, finalMessages);
        await persistChatSession(sessionId, finalMessages, title);
      }
      // Only a first turn names a chat, and the name it gets is generated on
      // the server during that turn, so this is the one send worth asking for.
      if (history.length === 0) void refreshChatTitles();
      if (!viewerDetached) {
        setChatStreaming(sessionId, awaitedLaunchesRef.current.size > 0);
      }
      if (
        agentCompleted &&
        !agentReportedError &&
        assistantMsg.content.trim()
      ) {
        locallyAnnouncedChatResponses.current.add(String(sessionId));
        notifyChatResponseReady(displayText, {
          chatId: sessionId,
          activeChatId: activeChatIdRef.current,
          response: assistantMsg.content,
        });
      } else if (agentFailed || agentReportedError) {
        notifyChatResponseFailed(displayText, {
          chatId: sessionId,
          activeChatId: activeChatIdRef.current,
        });
      }
      if (activeSteerContextRef.current === steerContext) {
        activeSteerContextRef.current = null;
      }
      if (activeGardenTurnRef.current?.clientMessageId === clientMessageId) {
        activeGardenTurnRef.current = null;
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
  const selectedUploadTask = selectedUploadTaskId
    ? (uploadTasks.find((task) => task.id === selectedUploadTaskId) ?? null)
    : null;
  const isViewingUploadTask = selectedUploadTask !== null;
  const modalUploadFiles = selectedUploadTask?.files ?? uploadFiles;
  const modalUploadStatuses = selectedUploadTask?.statuses ?? {};
  const modalUploadErrors = selectedUploadTask?.errors ?? {};
  const modalUploadSteps = selectedUploadTask?.steps ?? {};
  const modalUploadTokenUsage = selectedUploadTask?.tokenUsage ?? {};
  const modalUploadVisionErrors = selectedUploadTask?.visionErrors ?? {};
  const modalIsUploading = selectedUploadTask?.state === "uploading";
  const modalUploadElapsedMs = selectedUploadTask
    ? Math.max(
        0,
        (selectedUploadTask.completedAt ?? uploadClock) -
          selectedUploadTask.startedAt,
      )
    : 0;
  const activeUploadTasks = uploadTasks.filter(
    (task) => task.state === "uploading",
  );
  const activeLinkImportTasks = linkImportTasks.filter(
    (task) => task.status === "importing",
  );
  const selectedLinkImportTask = selectedLinkImportId
    ? (linkImportTasks.find((task) => task.id === selectedLinkImportId) ?? null)
    : null;
  const allDoneOrError =
    modalUploadFiles.length > 0 &&
    modalUploadFiles.every((f) => {
      const s = modalUploadStatuses[fileKey(f)];
      return s === "done" || s === "error";
    });
  const ingestionTokenUsage = sumIngestTokenUsage(
    Object.values(modalUploadTokenUsage),
  );
  const ingestionVisionErrors = Object.values(modalUploadVisionErrors).filter(
    (error) => error.trim().length > 0,
  );

  const sourceDocuments = documents.filter(
    (doc) => doc.type === "source-document",
  );
  const gardenSourceAttachments = sourceDocuments.flatMap(
    (doc): GardenChatSourceAttachment[] => {
      const source = gardenChatSourceAttachment(clusterSlug, doc);
      return source ? [source] : [];
    },
  );
  const mediaSourceDocuments = sourceDocuments.filter((doc) => {
    const kind = learnSourceKind(doc);
    return kind === "audio" || kind === "video";
  });
  const documentSourceDocuments = sourceDocuments.filter((doc) => {
    const kind = learnSourceKind(doc);
    return kind !== "audio" && kind !== "video";
  });
  const gardenMediaSources = mediaSourceDocuments.map((doc) => ({
    slug: doc.slug,
    title: doc.title,
    description: doc.description,
    originalFilename: doc.sourceFile,
    sourceType: doc.sourceType,
    sourceMedia: doc.sourceMedia,
    href: gardenDocumentHref(clusterSlug, doc),
    wordCount: doc.wordCount,
    flagColor: doc.flagColor,
  }));
  const sourceDocSearchTerms = normalizedSearchText(sourceDocSearch)
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const filteredSourceDocuments =
    sourceDocSearchTerms.length === 0
      ? documentSourceDocuments
      : documentSourceDocuments.filter((doc) => {
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
  const learnEligibleSourceGroups = LEARN_SOURCE_KINDS.map((kind) => ({
    kind,
    label: learnSourceKindLabel(kind),
    sources: sourceDocuments.filter((doc) => learnSourceKind(doc) === kind),
  })).filter((group) => group.sources.length > 0);
  const effectiveLearnIncludedSourceSlugs =
    learnIncludedSourceSlugs === null
      ? learnEligibleSourceDocuments.map((doc) => doc.slug)
      : learnIncludedSourceSlugs.filter(
          (sourceSlug) =>
            availableLearnSourceSlugSet.has(sourceSlug) &&
            sourceSlug !== learnSyllabusSlug,
        );
  const effectiveLearnIncludedSourceSlugSet = new Set(
    effectiveLearnIncludedSourceSlugs,
  );
  const persistedLearnTeachingSourceSlugSet = new Set(
    (learnState?.selectedSourceIds ?? []).filter(
      (sourceSlug) => sourceSlug !== learnState?.syllabusSourceId,
    ),
  );
  // Status can detect changed bytes for the persisted selection, but the
  // checkbox state is local until Plan is posted. Include locally-added source
  // ids so selecting a newly uploaded document immediately chooses the
  // additive path instead of the old scoped-repair action.
  const hasLocallyAddedLearnMaterial =
    Array.isArray(learnState?.selectedSourceIds) &&
    effectiveLearnIncludedSourceSlugs.some(
      (sourceSlug) => !persistedLearnTeachingSourceSlugSet.has(sourceSlug),
    );
  const shouldAddNewLearnMaterial =
    hasExistingLearnContent &&
    (learnState?.sourceSetChanged === true || hasLocallyAddedLearnMaterial);

  const learnSyllabusDocument =
    sourceDocuments.find((doc) => doc.slug === learnSyllabusSlug) ?? null;
  // Only meaningful for the syllabus the last run actually read; a freshly
  // picked one has no coverage until Learn runs again.
  const learnSyllabusCoverage =
    learnSyllabusDocument && learnState?.syllabusSourceId === learnSyllabusSlug
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
    const requestId = crypto.randomUUID();
    beginRuntimeIngestRecovery({
      requestId,
      clusterSlug,
      filename: file.name,
      fileKey: fileKey(file),
      startedAt: Date.now(),
      purpose: "syllabus",
    });
    const continueSyllabusRecovery = () => {
      const record = runtimeIngestRecoveryRecord(requestId);
      if (!record) return;
      void recoverRuntimeIngest(record, (event) => {
        if (event.type !== "result" || typeof event.slug !== "string") return;
        chooseLearnSyllabusDocument(event.slug);
        setLearnSyllabusMenuOpen(false);
      })
        .then(async (outcome) => {
          if (!outcome?.terminalEvent) return;
          await fetchDocuments();
        })
        .catch(() => undefined);
    };
    try {
      const formData = new FormData();
      formData.append("clusterSlug", clusterSlug);
      formData.append("file", file);
      formData.append("sourceLabel", "Syllabus");
      formData.append("isHandwriting", "false");
      formData.append("generateMap", "false");

      const res = await fetch("/api/ingest", {
        method: "POST",
        headers: {
          "X-Breadboard-Ingest-Cluster-Slug": clusterSlug,
          "X-Breadboard-Ingest-File-Size": String(file.size),
          "X-Breadboard-Ingest-Request-Id": requestId,
        },
        body: formData,
      });
      bindRuntimeIngestResponse(requestId, res);
      if (!res.ok || !res.body) {
        forgetRuntimeIngestRecovery(requestId);
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
        if (streamError) forgetRuntimeIngestRecovery(requestId);
        throw new Error(streamError || "Syllabus upload failed");
      }
      forgetRuntimeIngestRecovery(requestId);
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
      if (runtimeIngestRecoveryRecord(requestId)) {
        continueSyllabusRecovery();
        return;
      }
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
      const data = await res
        .json()
        .catch(() => ({}) as Record<string, unknown>);
      if (!res.ok || data?.success !== true) {
        throw new Error(
          typeof data?.error === "string" && data.error.trim()
            ? data.error.trim()
            : "Could not write a syllabus",
        );
      }
      const slug = typeof data.slug === "string" ? data.slug : "";
      if (!slug) {
        throw new Error(
          "The syllabus was written but no document slug came back",
        );
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
    const hasLearnUserInstruction = Boolean(learnUserInstruction.trim());
    const learnHumanizerStatus = learnState?.humanizer?.status;
    const learnHumanizerRunning = learnHumanizerStatus === "running";
    const learnHumanizerRestoring = learnHumanizerStatus === "restoring_ai";
    const learnHumanizerActive =
      learnHumanizerRequestBusy ||
      learnHumanizerRunning ||
      learnHumanizerRestoring;
    const learnHumanizerStatusMessage = learnHumanizerRunning
      ? "Humanizing completed lessons..."
      : learnHumanizerRestoring
        ? "Restoring the original AI lesson copy..."
        : learnHumanizerRequestBusy
          ? humanizerEnabled
            ? "Starting Humanize..."
            : "Starting AI-copy restore..."
          : null;
    const learnStatusBarActive = active || learnHumanizerActive;
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
    const displayProgress = learnHumanizerActive
      ? 100
      : startingLearnAction
        ? 2
        : status === "complete" || status === "failed"
          ? 100
          : progress;
    const learnTeachingSourceSlugs = effectiveLearnIncludedSourceSlugs;
    const hasSelectedLearnSources = learnTeachingSourceSlugs.length > 0;
    const paused = status === "paused";
    // Kept mounted across the request so the control does not flicker away
    // between the click and the next status poll.
    const showPauseControl = paused || isLearnPausable(status);
    // While a run is in flight the chip must name the model actually placing
    // the calls, which is fixed for the life of that run. Once it settles the
    // chip names the model the next run will use, so changing the Intelligence
    // picker in the chat bar is reflected here immediately instead of leaving
    // the last run's model on screen.
    const learnPanelModel = active ? (job?.model ?? model) : model;
    const learnPanelModelGroups = groupAssistantModels(
      Array.from(new Set([learnPanelModel, ...models])),
    );
    const learnSelectionOwnerKey =
      learnState?.job?.id ?? learnState?.confirmedLearningMapId ?? "idle";
    const learnSelectionHydrated =
      Array.isArray(learnState?.selectedSourceIds) &&
      learnState.syllabusSourceId !== undefined &&
      lastSyncedLearnSelectionRef.current ===
        `${learnSelectionOwnerKey}:${learnState.selectedSourceIds.join("|")}` &&
      lastSyncedLearnSyllabusRef.current ===
        `${learnSelectionOwnerKey}:${learnState.syllabusSourceId ?? ""}`;
    const canStart =
      Boolean(learnState?.hasSources) &&
      learnSelectionHydrated &&
      hasSelectedLearnSources &&
      !learnBusy &&
      !learnCancelBusy &&
      !active;
    const shouldShowPanel = learnPanelOpen;
    const panelExpanded = learnPanelOpen;
    const staleReviewForExistingGarden =
      status === "awaiting_confirmation" &&
      hasExistingLearnContent &&
      job?.mode !== "update_sources";
    const shouldRepairFailedJob =
      status === "failed" &&
      hasExistingLearnContent &&
      job?.mode !== "update_sources";
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
    // Shared with the corner notices and the Hermes process-status tool, so
    // every surface describes a Learn stage with the same words.
    const activeStageMessage: Partial<Record<LearnStatus, string>> =
      LEARN_ACTIVE_STAGE_LABELS;
    const statusMessage = active
      ? null
      : status === "complete"
        ? null
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
      : status === "failed" ||
          status === "cancelled" ||
          staleReviewForExistingGarden
        ? ""
        : job?.currentStep ||
          activeStageMessage[status] ||
          (active ? "Creating lessons" : "");
    const statusDetails = status === "complete"
      ? []
      : [
          stageMessage || null,
          job?.currentSectionTitle ? `Section: ${job.currentSectionTitle}.` : null,
          job?.currentPageTitle ? `Page: ${job.currentPageTitle}.` : null,
          !hasSelectedLearnSources
            ? learnSyllabusDocument
              ? "The syllabus is reserved for planning; select at least one other source to teach from."
              : `No sources selected from ${sourceDocuments.length} available.`
            : null,
          status === "awaiting_confirmation" && !staleReviewForExistingGarden
            ? "Pipeline paused for review; timer stopped."
            : null,
          paused
            ? "Timer stopped. Everything written so far is kept and the run continues from here."
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
    const learnTimerPaused = status === "awaiting_confirmation" || paused;
    const hasLearnTokenActivity = (learnTokenUsage?.startedCalls ?? 0) > 0;
    const showLearnTokenUsage = Boolean(
      learnTokenUsage && (active || hasLearnTokenActivity),
    );

    if (
      !isOwner ||
      (!learnState?.hasSources && status !== "failed" && !hasLearnData)
    )
      return null;
    if (!shouldShowPanel) return null;

    return (
      <section className="bb-neu-learn-tray neu-surface-raised mx-auto mt-4 max-h-[55vh] w-[calc(100%_-_2rem)] max-w-7xl shrink-0 overflow-y-auto rounded-lg border border-gray-800 bg-gray-950/70 p-3">
        <div className="flex flex-col gap-2">
          <div className="flex min-h-8 items-start justify-between gap-3">
            <div className="flex h-8 shrink-0 items-center gap-2">
              <p className="text-sm font-medium text-white">Learn</p>
            </div>

            <div className="flex min-w-0 flex-1 items-start gap-2">
              <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-x-2 gap-y-1.5 md:flex-nowrap">
                <div className="relative">
                  <button
                    ref={learnDocumentMenuButtonRef}
                    type="button"
                    onClick={() => {
                      setLearnSyllabusMenuOpen(false);
                      setLearnUserInstructionOpen(false);
                      setLearnDocumentMenuOpen((open) => !open);
                    }}
                    className="neu-button flex h-[30px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-gray-800 px-2 text-xs text-gray-400 transition-colors hover:border-gray-700 hover:text-gray-200"
                    aria-expanded={learnDocumentMenuOpen}
                    aria-haspopup="menu"
                    title="Choose which documents, links, videos, and audio Learn may use"
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
                    Sources {learnTeachingSourceSlugs.length}/
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
                      ariaLabel="Sources included in Learn"
                      className="neu-popover fixed z-[100] w-80 max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-lg border border-gray-800 bg-gray-950 p-2"
                      onClose={() => setLearnDocumentMenuOpen(false)}
                    >
                      <div className="mb-2 flex items-center justify-between border-b border-gray-800 pb-2">
                        <div>
                          <p className="text-xs font-medium text-gray-200">
                            Sources for Learn
                          </p>
                          <p className="mt-0.5 text-[10px] text-gray-600">
                            Select documents, links, video transcripts, and
                            audio transcripts. Unchecked sources are excluded.
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
                      <div className="max-h-64 space-y-2 overflow-y-auto">
                        {learnEligibleSourceGroups.map((group) => (
                          <div key={group.kind}>
                            <p className="px-2 pb-0.5 text-[10px] font-medium uppercase tracking-wider text-gray-600">
                              {group.label}
                            </p>
                            <div className="space-y-1">
                              {group.sources.map((doc) => {
                                const isSyllabus = doc.slug === learnSyllabusSlug;
                                const checked =
                                  effectiveLearnIncludedSourceSlugSet.has(doc.slug);
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
                                        ? "Used as the syllabus and excluded from teaching sources"
                                        : `${learnSourceKindLabel(group.kind).replace(/s$/, "")} source`
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
                          </div>
                        ))}
                      </div>
                      {learnDocumentSelectionLocked ? (
                        <p className="mt-2 border-t border-gray-800 pt-2 text-[10px] text-gray-600">
                          This selection is locked for the current Learning Map.
                        </p>
                      ) : null}
                    </ViewportPopover>
                  ) : null}
                </div>
                <div className="relative min-w-0">
                  <button
                    ref={learnSyllabusMenuButtonRef}
                    type="button"
                    onClick={() => {
                      setLearnDocumentMenuOpen(false);
                      setLearnUserInstructionOpen(false);
                      setLearnSyllabusMenuOpen((open) => !open);
                    }}
                    className="neu-button flex h-[30px] w-full min-w-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-gray-800 px-2 text-xs text-gray-400 transition-colors hover:border-gray-700 hover:text-gray-200"
                    aria-expanded={learnSyllabusMenuOpen}
                    aria-haspopup="menu"
                    title="Choose a syllabus or study guide for Learn to plan against"
                  >
                    <svg
                      className="h-3.5 w-3.5 shrink-0"
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
                      className="min-w-0 flex-1 max-w-28 truncate sm:max-w-32"
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
                      className={`h-3 w-3 shrink-0 transition-transform ${learnSyllabusMenuOpen ? "rotate-180" : ""}`}
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
                          A study guide Learn plans against: it sets which
                          topics to cover, in what order, and how deep. It is
                          not taught as source material.
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
                            {learnSyllabusCoverage.unitCount === 1
                              ? ""
                              : "s"}{" "}
                            and {learnSyllabusCoverage.materialCount} assigned
                            material
                            {learnSyllabusCoverage.materialCount === 1
                              ? ""
                              : "s"}
                            ; {learnSyllabusCoverage.availableCount} matched a
                            document in this garden.
                          </p>
                          {learnSyllabusCoverage.missingCount > 0 ? (
                            <>
                              <p className="mt-1 text-[10px] text-amber-300">
                                {learnSyllabusCoverage.missingCount} assigned
                                work
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
                          garden, then saved to Documents like any other
                          syllabus. It assigns no outside readings, so every
                          unit is one your material can teach.
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
                          Uploaded syllabi are added to Documents so you can
                          reuse them later.
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
                <div className="relative shrink-0">
                  <button
                    ref={learnUserInstructionButtonRef}
                    type="button"
                    onClick={() => {
                      setLearnDocumentMenuOpen(false);
                      setLearnSyllabusMenuOpen(false);
                      setLearnUserInstructionDraft(learnUserInstruction);
                      setLearnUserInstructionOpen((open) => !open);
                    }}
                    disabled={learnBusy || active}
                    className={`neu-button relative flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-md border transition-[color,border-color,transform] active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40 ${
                      hasLearnUserInstruction
                        ? "border-emerald-700/70 text-emerald-300 hover:border-emerald-600 hover:text-emerald-200"
                        : "border-gray-800 text-gray-500 hover:border-gray-700 hover:text-gray-200"
                    }`}
                    aria-label={
                      hasLearnUserInstruction
                        ? "Edit Learn request"
                        : "Guide Learn with a request"
                    }
                    aria-expanded={learnUserInstructionOpen}
                    aria-haspopup="dialog"
                    title={
                      active
                        ? "A Learn run is already in progress"
                        : hasLearnUserInstruction
                          ? "Edit the request attached to Learn"
                          : "Tell Learn what to focus on, include, exclude, or redo"
                    }
                  >
                    <svg
                      className="h-4 w-4"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={1.8}
                      aria-hidden="true"
                    >
                      <circle cx="12" cy="12" r="8.75" />
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M9.8 9.25a2.35 2.35 0 1 1 3.45 2.08c-.8.42-1.25.9-1.25 1.92M12 16.55h.01"
                      />
                    </svg>
                    {hasLearnUserInstruction ? (
                      <span
                        className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-emerald-400 ring-2 ring-gray-950"
                        aria-hidden="true"
                      />
                    ) : null}
                  </button>
                  {learnUserInstructionOpen ? (
                    <ViewportPopover
                      anchorRef={learnUserInstructionButtonRef}
                      ariaLabel="Guide Learn"
                      role="dialog"
                      className="neu-popover fixed z-[100] w-[390px] max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-xl border border-gray-800 bg-gray-950 p-3"
                      onClose={() => setLearnUserInstructionOpen(false)}
                    >
                      <div className="flex items-start justify-between gap-3 border-b border-gray-800 pb-2.5">
                        <div>
                          <p className="text-xs font-semibold text-gray-100">
                            Guide Learn
                          </p>
                          <p className="mt-1 text-[11px] leading-4 text-gray-500">
                            Give the pipeline one natural-language request. It
                            can change scope, emphasis, order, or what gets
                            redone.
                          </p>
                        </div>
                        {hasLearnUserInstruction ? (
                          <span className="shrink-0 rounded-full border border-emerald-800/70 bg-emerald-950/40 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
                            Attached
                          </span>
                        ) : null}
                      </div>

                      <div className="mt-2.5 grid grid-cols-2 gap-1.5">
                        {LEARN_USER_INSTRUCTION_EXAMPLES.map((example) => (
                          <button
                            key={example.label}
                            type="button"
                            onClick={() =>
                              setLearnUserInstructionDraft(example.text)
                            }
                            className="neu-button min-w-0 rounded-lg border border-gray-800 px-2.5 py-2 text-left transition-[border-color,transform] hover:border-gray-700 active:scale-[0.98]"
                          >
                            <span className="block text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-500">
                              {example.label}
                            </span>
                            <span className="mt-0.5 block truncate text-[11px] text-gray-300">
                              {example.text}
                            </span>
                          </button>
                        ))}
                      </div>

                      <label
                        htmlFor="learn-user-instruction"
                        className="mt-3 block text-[10px] font-medium uppercase tracking-[0.08em] text-gray-500"
                      >
                        Your request
                      </label>
                      <textarea
                        ref={learnUserInstructionInputRef}
                        id="learn-user-instruction"
                        value={learnUserInstructionDraft}
                        onChange={(event) =>
                          setLearnUserInstructionDraft(event.target.value)
                        }
                        onKeyDown={(event) => {
                          if (
                            (event.metaKey || event.ctrlKey) &&
                            event.key === "Enter"
                          ) {
                            event.preventDefault();
                            void handleGuidedLearnRun();
                          }
                        }}
                        maxLength={LEARN_USER_INSTRUCTION_MAX_CHARS}
                        rows={4}
                        placeholder="For example: Redo only the topics after Maxwell's equations, and keep everything before that unchanged."
                        aria-describedby="learn-user-instruction-help"
                        className="neu-control mt-1.5 min-h-24 w-full resize-y rounded-lg border border-gray-800 bg-gray-950 px-3 py-2.5 text-xs leading-5 text-gray-200 outline-none transition-colors placeholder:text-gray-700 focus:border-gray-600"
                      />
                      <div
                        id="learn-user-instruction-help"
                        className="mt-1.5 flex items-start justify-between gap-3 text-[10px] leading-4 text-gray-600"
                      >
                        <span>
                          Source and syllabus limits still apply. Press Ctrl/⌘
                          + Enter to run.
                        </span>
                        <span className="shrink-0 tabular-nums">
                          {learnUserInstructionDraft.length}/
                          {LEARN_USER_INSTRUCTION_MAX_CHARS.toLocaleString()}
                        </span>
                      </div>

                      {hasExistingLearnContent ? (
                        <p className="mt-2 rounded-lg border border-gray-800 bg-gray-900/60 px-2.5 py-2 text-[10px] leading-4 text-gray-500">
                          This garden already has lessons. Learn will preserve
                          their units and prose, then place new material where it
                          fits in the existing teaching order.
                        </p>
                      ) : null}

                      <div className="mt-3 flex items-center justify-between border-t border-gray-800 pt-2.5">
                        <button
                          type="button"
                          onClick={() => {
                            setLearnUserInstruction("");
                            setLearnUserInstructionDraft("");
                          }}
                          disabled={
                            !learnUserInstructionDraft &&
                            !learnUserInstruction
                          }
                          className="text-[11px] font-medium text-gray-500 transition-colors hover:text-gray-200 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Clear
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleGuidedLearnRun()}
                          disabled={
                            !learnUserInstructionDraft.trim() || !canStart
                          }
                          className="neu-button-primary flex h-8 items-center gap-1.5 rounded-lg bg-white px-3 text-xs font-semibold text-gray-950 transition-[background-color,transform] hover:bg-gray-100 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {hasExistingLearnContent
                            ? "Add to lessons"
                            : "Run request"}
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
                              d="m9 5 7 7-7 7"
                            />
                          </svg>
                        </button>
                      </div>
                    </ViewportPopover>
                  ) : null}
                </div>
                <label className="flex h-[30px] shrink-0 items-center gap-1.5 whitespace-nowrap text-xs text-gray-500">
                  <input
                    type="checkbox"
                    checked={learnSourceOnly}
                    onChange={(event) =>
                      setLearnSourceOnly(event.target.checked)
                    }
                    disabled={learnBusy || active}
                    className="h-3.5 w-3.5 rounded border-gray-700 bg-gray-950 accent-white disabled:opacity-40"
                  />
                  Source-only
                </label>
                <label
                  className="flex h-[30px] shrink-0 items-center gap-1.5 whitespace-nowrap text-xs text-gray-500"
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
                    onClick={
                      shouldAddNewLearnMaterial || hasLearnUserInstruction
                        ? handleLearnPrimary
                        : handleRepairIssues
                    }
                    disabled={!canStart}
                    title={
                      hasLearnUserInstruction
                        ? "Apply the request while preserving existing lesson units and prose"
                        : shouldAddNewLearnMaterial
                          ? "Fit newly selected material into the existing lessons"
                          : "Repairs only failing pages and components; unaffected content is preserved"
                    }
                    className="neu-button-primary flex h-[30px] shrink-0 items-center gap-1.5 whitespace-nowrap px-3 text-sm bg-white text-gray-950 font-medium rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
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
                    {learnBusy
                      ? hasLearnUserInstruction || shouldAddNewLearnMaterial
                        ? "Starting..."
                        : "Repairing..."
                      : hasLearnUserInstruction
                        ? "Run request"
                        : shouldAddNewLearnMaterial
                          ? "Add new material"
                          : "Repair issues"}
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
                      className="neu-button-destructive h-[30px] shrink-0 whitespace-nowrap rounded-lg border border-red-900/70 px-3 text-xs text-red-300 transition hover:border-red-700 hover:text-red-200 disabled:cursor-not-allowed disabled:opacity-40"
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
                    className="neu-button-destructive h-[30px] shrink-0 whitespace-nowrap rounded-lg border border-red-900/70 px-3 text-xs text-red-300 transition hover:border-red-700 hover:text-red-200 disabled:cursor-not-allowed disabled:opacity-40"
                    title="Destructive: remove generated Learn content and Learn history while preserving sources and non-Learn notes"
                  >
                    Clear data
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
                    className="neu-button-primary flex h-[30px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg bg-white px-3 text-sm font-medium text-gray-950 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {learnBusy || active ? (
                      <Spinner className="h-3.5 w-3.5" />
                    ) : null}
                    {hasLearnUserInstruction && hasExistingLearnContent
                      ? learnBusy
                        ? "Starting..."
                        : "Run request"
                      : shouldRepairFromPrimaryAction
                        ? learnBusy
                          ? "Repairing..."
                          : "Repair issues"
                      : status === "failed"
                        ? learnBusy
                          ? shouldRestartFailedPlanning ||
                            shouldReplanStaleMapBinding
                            ? "Planning..."
                            : "Retrying..."
                          : shouldRestartFailedPlanning ||
                              shouldReplanStaleMapBinding
                            ? "Restart planning"
                            : "Retry Learn"
                        : status === "cancelled"
                          ? learnBusy
                            ? hasExistingLearnContent &&
                              job?.mode !== "update_sources"
                              ? "Repairing..."
                              : job?.mode === "update_sources" ||
                                  shouldRestartCancelledPlanning ||
                                  shouldReplanStaleMapBinding
                                ? "Planning..."
                                : "Generating..."
                            : hasExistingLearnContent &&
                                job?.mode !== "update_sources"
                              ? "Repair issues"
                              : job?.mode === "update_sources" ||
                                  shouldRestartCancelledPlanning ||
                                  shouldReplanStaleMapBinding
                                ? "Restart planning"
                                : "Generate"
                          : status === "awaiting_confirmation" &&
                              shouldReplanStaleMapBinding
                            ? learnBusy
                              ? "Planning..."
                              : "Restart planning"
                            : (learnState?.buttonLabel ?? "Learn")}
                  </button>
                )}
                {active && showPauseControl && (
                  <button
                    type="button"
                    onClick={paused ? handleResumeLearn : handlePauseLearn}
                    disabled={learnPauseBusy || learnCancelBusy}
                    className={
                      paused
                        ? "neu-button-primary flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg bg-white text-gray-950 transition-colors hover:bg-gray-100 disabled:cursor-wait disabled:opacity-60"
                        : "neu-button flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg border border-gray-800 text-gray-300 transition-colors hover:border-gray-700 hover:text-gray-100 disabled:cursor-wait disabled:opacity-60"
                    }
                    aria-label={
                      learnPauseBusy
                        ? paused
                          ? "Resuming Learn run"
                          : "Pausing Learn run"
                        : paused
                          ? "Resume Learn run"
                          : "Pause Learn run"
                    }
                    title={
                      paused
                        ? "Resume this Learn run from the checkpoint it stopped at"
                        : "Hold this Learn run at the next checkpoint. Nothing is discarded and the timer stops."
                    }
                  >
                    {learnPauseBusy ? (
                      <Spinner className="h-3.5 w-3.5" />
                    ) : paused ? (
                      <svg
                        className="h-3.5 w-3.5"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        aria-hidden="true"
                      >
                        <path d="M8 5.14v13.72a1 1 0 0 0 1.53.85l10.7-6.86a1 1 0 0 0 0-1.7L9.53 4.29A1 1 0 0 0 8 5.14Z" />
                      </svg>
                    ) : (
                      <svg
                        className="h-3.5 w-3.5"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        aria-hidden="true"
                      >
                        <rect x="6" y="4.5" width="4" height="15" rx="1" />
                        <rect x="14" y="4.5" width="4" height="15" rx="1" />
                      </svg>
                    )}
                  </button>
                )}
                {active && (
                  <button
                    type="button"
                    onClick={handleCancelLearn}
                    disabled={learnCancelBusy}
                    className="neu-button-destructive flex h-[30px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-red-900/60 bg-red-950/30 px-3 text-sm font-medium text-red-300 transition-colors hover:border-red-700 hover:text-red-200 disabled:cursor-wait disabled:opacity-60"
                    title="Cancel this Learn run and roll back what it wrote"
                  >
                    {learnCancelBusy ? (
                      <Spinner className="h-3.5 w-3.5" />
                    ) : null}
                    {learnCancelBusy ? "Cancelling..." : "Cancel"}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {!hasSelectedLearnSources ? (
          <p className="mt-2 text-xs text-amber-400">
            Select at least one teaching document before starting Learn.
          </p>
        ) : null}

        {(learnStatusBarActive || status === "complete" || status === "failed") && (
          <div className="mt-3">
            <div
              className="neu-progress-track h-1.5 overflow-hidden rounded-full bg-gray-800"
              role="progressbar"
              aria-label="Learn status"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={learnHumanizerActive ? undefined : displayProgress}
              aria-valuetext={learnHumanizerStatusMessage ?? undefined}
            >
              <div
                className={[
                  "h-full rounded-full transition-all",
                  learnStatusBarActive ? "learn-progress-pulse" : "",
                  showFailedState
                    ? "bg-red-500"
                    : learnHumanizerActive
                      ? "bg-emerald-300"
                      : status === "complete"
                        ? "bg-emerald-400"
                        : "bg-white",
                ].join(" ")}
                style={{ width: `${displayProgress}%` }}
              />
            </div>
            {learnHumanizerStatusMessage ? (
              <p
                className="mt-2 text-xs text-emerald-300"
                aria-live="polite"
              >
                {learnHumanizerStatusMessage}
              </p>
            ) : status === "complete" ? (
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

        <div
          className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-gray-800 pt-2 text-[11px]"
          aria-label="Learn token usage"
        >
          <span className="font-medium text-gray-300">Tokens</span>
          {showLearnTokenUsage && learnTokenUsage ? (
            <>
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
                  <div key={metric.label} className="flex items-baseline gap-1">
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
                ))}
              </dl>
            ) : (
              <span className="text-gray-600">Waiting for usage</span>
            )}

            </>
          ) : (
            <span className="text-gray-600">Waiting for usage</span>
          )}
          {learnPanelModel ? (
            <div className="flex items-baseline gap-1">
              <span className="text-gray-600">Model:</span>
              <LearnModelPicker
                value={learnPanelModel}
                groups={learnPanelModelGroups}
                onOpen={loadModels}
                onChange={setModel}
                disabled={learnDocumentSelectionLocked}
                title={
                  active
                    ? `Model making these calls: ${learnPanelModel}`
                    : `Model the next Learn run will use: ${learnPanelModel}. Click to change it.`
                }
              />
            </div>
          ) : null}
          <button
            type="button"
            role="switch"
            aria-checked={humanizerEnabled}
            aria-busy={learnHumanizerActive}
            disabled={learnHumanizerActive}
            onClick={() => setHumanizerEnabled(!humanizerEnabled)}
            className="ml-auto flex shrink-0 items-center gap-1.5 whitespace-nowrap text-gray-400 transition-colors hover:text-gray-200 disabled:cursor-wait disabled:opacity-60"
            title={
              learnHumanizerRunning
                ? "Rewriting the completed lessons naturally"
                : learnHumanizerRestoring
                  ? "Restoring the original AI lesson copy"
                  : "After a full Learn build passes its checks, rewrite only the learner-facing prose locally and keep the original if any safety check fails"
            }
          >
            <span>
              {learnHumanizerRunning
                ? "Rewriting naturally..."
                : learnHumanizerRestoring
                  ? "Restoring AI copy..."
                  : "Rewrite naturally"}
            </span>
            <span
              aria-hidden
              className={`neu-inset relative h-4 w-7 rounded-full transition-colors duration-200 ${
                humanizerEnabled ? "bg-emerald-500/80" : "bg-gray-700"
              }`}
            >
              <span
                className={`neu-surface-raised absolute left-0.5 top-0.5 h-3 w-3 rounded-full bg-white transition-transform duration-200 ${
                  humanizerEnabled ? "translate-x-3" : "translate-x-0"
                }`}
              />
            </span>
          </button>
        </div>

        {panelExpanded &&
          proposedMap &&
          status === "awaiting_confirmation" &&
          !staleReviewForExistingGarden &&
          !shouldReplanStaleMapBinding && (
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
                    disabled={learnBusy || !job?.proposedLearningMapId}
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
            <LinkContextMenu href={`/garden/${clusterSlug}`} label="Lessons">
              <Link
                href={`/garden/${clusterSlug}`}
                className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs text-gray-300 transition hover:border-gray-500 hover:text-white"
              >
                Open lessons
              </Link>
            </LinkContextMenu>
          </div>
        )}
      </section>
    );
  }

  function handleDocumentColorButtonClick(
    slug: string,
    selectableForChat: boolean,
  ) {
    if (!selectableForChat) {
      setOpenFlagPaletteSlug((openSlug) => (openSlug === slug ? null : slug));
      return;
    }

    const pendingTimer = documentColorClickTimersRef.current.get(slug);
    if (pendingTimer !== undefined) {
      window.clearTimeout(pendingTimer);
      documentColorClickTimersRef.current.delete(slug);
      setOpenFlagPaletteSlug((openSlug) => (openSlug === slug ? null : slug));
      return;
    }

    const timer = window.setTimeout(() => {
      documentColorClickTimersRef.current.delete(slug);
      setOpenFlagPaletteSlug(null);
      toggleSelectedDocument(slug);
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
          const rowKey = `${doc.slug}:${doc.type}:${index}`;
          const row = (
            <li
              key={rowKey}
              className={[
                "group flex items-start gap-2.5 border-b border-gray-800/50 px-3 py-2 transition-colors last:border-b-0",
                isSelectedForChat
                  ? "border-l-2 border-l-[var(--botanical)] bg-[color-mix(in_srgb,var(--botanical)_8%,transparent)]"
                  : "",
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
                    "flex items-center justify-center transition-[border-color,transform,opacity] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:border-gray-500 active:scale-[0.96]",
                    savingFlagSlug === doc.slug
                      ? "opacity-50 cursor-wait"
                      : "cursor-pointer",
                  ].join(" ")}
                  title={`${doc.flagColor ? `Flagged ${doc.flagColor}. ` : ""}${
                    isSource
                      ? isSelectedForChat
                        ? "Selected for chat; click once to remove. Double-click to choose a color."
                        : "Click once to select for chat. Double-click to choose a color."
                      : "Click once to choose a color."
                  }`}
                  aria-label={
                    isSource
                      ? isSelectedForChat
                        ? "Document color; selected for chat; click once to remove or twice to choose a color"
                        : "Document color; click once to select for chat or twice to choose a color"
                      : "Document color"
                  }
                  aria-pressed={isSource ? isSelectedForChat : undefined}
                  aria-expanded={openFlagPaletteSlug === doc.slug}
                >
                  <span
                    className="relative flex h-3 w-3 items-center justify-center rounded-sm border border-gray-800"
                    style={{ backgroundColor: doc.flagColor || "transparent" }}
                  >
                    {isSelectedForChat ? (
                      <svg
                        className="pointer-events-none absolute inset-0 h-3 w-3"
                        viewBox="0 0 12 12"
                        fill="none"
                        aria-hidden="true"
                      >
                        <path
                          d="m2 6.25 2.6 2.6L10 3.35"
                          stroke="rgb(3 7 18)"
                          strokeWidth={4}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                        <path
                          d="m2 6.25 2.6 2.6L10 3.35"
                          stroke="white"
                          strokeWidth={2}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    ) : null}
                  </span>
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
                            "h-4 w-4 rounded border transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:scale-110 active:scale-[0.96]",
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
                        className="mt-2 w-full rounded border border-gray-800 px-2 py-1 text-[10px] text-gray-500 transition-[border-color,color,transform] duration-150 hover:border-gray-700 hover:text-white active:scale-[0.97]"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <Link
                  href={documentHref}
                  className={[
                    "block text-xs transition-colors",
                    isSource
                      ? "font-medium text-gray-300 hover:text-white"
                      : "text-gray-300 hover:text-white",
                  ].join(" ")}
                  title={isPdfSource ? "Open PDF viewer" : "Open note"}
                >
                  <OverflowMarquee>{displayTitle}</OverflowMarquee>
                </Link>
                {isSource && sourceDescription && (
                  <p
                    className="mt-0.5 line-clamp-2 text-[10px] leading-4 text-gray-500"
                    title={sourceDescription}
                  >
                    {sourceDescription}
                  </p>
                )}
                <p
                  className="text-[10px] text-gray-600 mt-0.5"
                  title={documentUploadTimeTitle(doc.date)}
                >
                  {isPdf
                    ? "PDF source"
                    : isSource
                      ? "full source content"
                      : markdownTypeLabel(doc)}{" "}
                  &middot; {formatDocumentUploadTime(doc.date)}
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
          return isSource ? (
            <DocumentContextMenu
              key={rowKey}
              documentTitle={displayTitle}
              pdfHref={isPdfSource ? documentHref : null}
            >
              {row}
            </DocumentContextMenu>
          ) : (
            row
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
        <LinkContextMenu
          href={`/garden/${clusterSlug}?note=${encodeURIComponent(
            doc.relPath ? doc.relPath.replace(/\.md$/i, "") : doc.slug,
          )}`}
          label={`Note ${doc.title ?? doc.name}`}
        >
          <Link
            href={`/garden/${clusterSlug}?note=${encodeURIComponent(
              doc.relPath ? doc.relPath.replace(/\.md$/i, "") : doc.slug,
            )}`}
            className="block text-xs text-gray-300 hover:text-white truncate transition-colors"
          >
            {doc.title ?? doc.name}
          </Link>
        </LinkContextMenu>
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
          className={`bb-neu-accordion w-full flex items-center justify-between px-4 py-3 text-xs font-medium text-gray-500 hover:text-white transition-colors ${sourceDocsExpanded ? "bb-neu-accordion-open" : ""}`}
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
            {documentSourceDocuments.length > 0
              ? sourceDocSearchTerms.length > 0
                ? ` (${filteredSourceDocuments.length}/${documentSourceDocuments.length})`
                : ` (${documentSourceDocuments.length})`
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
            {!loadingDocs && documentSourceDocuments.length > 0 && (
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
              {activeUploadTasks.length > 0 && (
                <div className="border-b border-gray-800/70 py-1">
                  {activeUploadTasks.flatMap((task) =>
                    task.files.map((file) => {
                      const key = fileKey(file);
                      const status = task.statuses[key] ?? "pending";
                      const step = task.steps[key];
                      const error = task.errors[key];
                      return (
                        <button
                          key={`${task.id}:${key}`}
                          type="button"
                          onClick={() => openUploadTask(task.id)}
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
                            <OverflowMarquee className="text-xs text-gray-300 group-hover:text-white">
                              {file.name}
                            </OverflowMarquee>
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
                    }),
                  )}
                </div>
              )}
              {loadingDocs ? (
                <div className="flex justify-center py-6">
                  <Spinner className="w-4 h-4 text-gray-700" />
                </div>
              ) : documentSourceDocuments.length === 0 ? (
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
        <div
          className={`bb-neu-accordion flex w-full items-center text-xs font-medium text-gray-500 transition-colors hover:text-white ${linksExpanded ? "bb-neu-accordion-open" : ""}`}
        >
          <button
            type="button"
            onClick={() => setLinksExpanded((value) => !value)}
            className="flex min-w-0 flex-1 items-center gap-2 px-4 py-3 text-left focus-visible:outline-none"
            aria-expanded={linksExpanded}
            aria-controls="garden-links-panel"
          >
            <svg
              className="h-3.5 w-3.5 shrink-0"
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
          </button>
          <div className="flex shrink-0 items-center gap-1.5 pr-4">
            {isOwner ? (
              <button
                type="button"
                onClick={() => setLinkDialogOpen(true)}
                className="rounded p-1 text-gray-600 transition-colors hover:bg-gray-800 hover:text-white focus-visible:outline-none focus-visible:text-[var(--botanical)]"
                aria-haspopup="dialog"
                aria-label="Open links dialog"
                title="Add link"
              >
                <svg
                  className="h-3.5 w-3.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 4.5v15m7.5-7.5h-15"
                  />
                </svg>
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setLinksExpanded((value) => !value)}
              className="-m-1 p-1 text-gray-600 transition-colors hover:text-white focus-visible:outline-none focus-visible:text-[var(--botanical)]"
              aria-label={linksExpanded ? "Collapse links" : "Expand links"}
              aria-expanded={linksExpanded}
              aria-controls="garden-links-panel"
            >
              <svg
                className={`h-3.5 w-3.5 transition-transform duration-200 ${linksExpanded ? "" : "rotate-180"}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="m4.5 15.75 7.5-7.5 7.5 7.5"
                />
              </svg>
            </button>
          </div>
        </div>
        {linksExpanded ? (
          <div
            id="garden-links-panel"
            className="bb-neu-accordion-panel border-t border-gray-800/70"
          >
            {activeLinkImportTasks.length > 0 ? (
              <div className="border-b border-gray-800/70 py-1">
                {activeLinkImportTasks.map((task) => (
                  <button
                    key={task.id}
                    type="button"
                    onClick={() => setSelectedLinkImportId(task.id)}
                    className="group flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-gray-800/50"
                    aria-label={`View link import progress for ${task.title}`}
                    title="View link import progress"
                  >
                    <Spinner className="h-4 w-4 shrink-0 text-gray-500" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs text-gray-300 group-hover:text-white">
                        {task.title}
                      </span>
                      <span className="block truncate text-[11px] text-gray-600">
                        {task.stage}
                      </span>
                    </span>
                    <span className="shrink-0 text-[11px] tabular-nums text-gray-600">
                      {formatElapsed(
                        Math.max(0, linkImportClock - task.startedAt),
                      )}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
            {linksLoading ? (
              <div className="flex justify-center py-6">
                <Spinner className="h-4 w-4 text-gray-700" />
              </div>
            ) : savedLinks.length === 0 ? (
              <div className="px-4 py-4 text-center">
                <p className="text-xs text-gray-600">No saved links yet.</p>
              </div>
            ) : (
              <ul className="divide-y divide-gray-800/70">
                {savedLinks.map((link) => (
                  <li
                    key={link.id}
                    className="group flex items-center gap-2 px-3 py-2.5"
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
                        aria-hidden="true"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125v-9.75c0-.621.504-1.125 1.125-1.125H8.25m2.25-6.75h8.625c.621 0 1.125.504 1.125 1.125v8.625c0 .621-.504 1.125-1.125 1.125H10.5a1.125 1.125 0 0 1-1.125-1.125V4.125c0-.621.504-1.125 1.125-1.125Z"
                        />
                      </svg>
                    </button>
                    {isOwner ? (
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
                            aria-hidden="true"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M6 18 18 6M6 6l12 12"
                            />
                          </svg>
                        )}
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </div>

      <div className="border-t border-gray-800 shrink-0">
        <div
          className={`bb-neu-accordion flex w-full items-center text-xs font-medium text-gray-500 transition-colors hover:text-white ${mediaExpanded ? "bb-neu-accordion-open" : ""}`}
        >
          <button
            type="button"
            onClick={() => setMediaExpanded((value) => !value)}
            className="flex min-w-0 flex-1 items-center gap-2 px-4 py-3 text-left focus-visible:outline-none"
            aria-expanded={mediaExpanded}
            aria-controls="garden-media-items"
          >
            <svg
              className="h-3.5 w-3.5 shrink-0"
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
            Video &amp; audio
            {gardenMediaSources.length > 0 ? ` (${gardenMediaSources.length})` : ""}
          </button>
          <div className="flex shrink-0 items-center gap-1.5 pr-4">
            {isOwner ? (
              <button
                type="button"
                onClick={() => setMediaDialogOpen(true)}
                className="rounded p-1 text-gray-600 transition-colors hover:bg-gray-800 hover:text-white focus-visible:outline-none focus-visible:text-[var(--botanical)]"
                aria-haspopup="dialog"
                aria-label="Open video and audio dialog"
                title="Add video or audio"
              >
                <svg
                  className="h-3.5 w-3.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 4.5v15m7.5-7.5h-15"
                  />
                </svg>
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setMediaExpanded((value) => !value)}
              className="-m-1 p-1 text-gray-600 transition-colors hover:text-white focus-visible:outline-none focus-visible:text-[var(--botanical)]"
              aria-label={
                mediaExpanded ? "Collapse video and audio" : "Expand video and audio"
              }
              aria-expanded={mediaExpanded}
              aria-controls="garden-media-items"
            >
              <svg
                className={`h-3.5 w-3.5 transition-transform duration-200 ${mediaExpanded ? "" : "rotate-180"}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="m4.5 15.75 7.5-7.5 7.5 7.5"
                />
              </svg>
            </button>
          </div>
        </div>
        <GardenVideoImport
          clusterSlug={clusterSlug}
          isOwner={isOwner}
          open={mediaDialogOpen}
          expanded={mediaExpanded}
          mediaSources={gardenMediaSources}
          deletingSourceSlug={deletingDocumentSlug}
          selectedSourceSlugs={selectedDocumentSlugs}
          flagColors={FLAG_COLORS}
          openFlagPaletteSlug={openFlagPaletteSlug}
          savingFlagSlug={savingFlagSlug}
          onClose={() => setMediaDialogOpen(false)}
          onExpand={() => setMediaExpanded(true)}
          onColorButtonClick={(sourceSlug) =>
            handleDocumentColorButtonClick(sourceSlug, true)
          }
          onFlagSource={(sourceSlug, flagColor) => {
            setOpenFlagPaletteSlug(null);
            void handleDocumentFlag(sourceSlug, flagColor);
          }}
          onDeleteSource={(sourceSlug) => {
            const source = mediaSourceDocuments.find(
              (document) => document.slug === sourceSlug,
            );
            if (source) void handleDocumentDelete(source);
          }}
          onSourceCreated={handleMediaSourceCreated}
        />
      </div>

      <div className="border-t border-gray-800 shrink-0">
        <button
          type="button"
          onClick={() => setArtifactsExpanded((value) => !value)}
          className={`bb-neu-accordion w-full flex items-center justify-between px-4 py-3 text-xs font-medium text-gray-500 hover:text-white transition-colors ${artifactsExpanded ? "bb-neu-accordion-open" : ""}`}
          aria-expanded={artifactsExpanded}
          aria-controls="garden-artifacts-panel"
        >
          <div className="flex items-center gap-2">
            <ArtifactArchiveIcon className="h-3.5 w-3.5 shrink-0" />
            Artifacts
          </div>
          <svg
            className={`w-3.5 h-3.5 transition-transform duration-200 ${artifactsExpanded ? "" : "rotate-180"}`}
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
        {artifactsExpanded ? (
          <div
            id="garden-artifacts-panel"
            className="bb-neu-accordion-panel h-[min(58vh,620px)] border-t border-gray-800"
          >
            <ArtifactPanel
              compact
              hideHeader
              gardenSlug={clusterSlug}
              sourceSurface="garden_chat"
            />
          </div>
        ) : null}
      </div>
    </>
  );

  return (
    <div className="h-screen bg-gray-950 text-white flex flex-col overflow-hidden">
      {/* Header */}
      <header className="bb-neu-toolbar breadboard-flower-navbar neu-surface-subtle relative flex items-center justify-between px-6 py-3.5 border-b border-gray-800 shrink-0">
        <NavbarFlowerWind showFlowers={showNavbarFlowers} />
        <div className="relative z-10 flex items-center gap-3">
          {/* Garden chat is the top of its own surface: always leave to the
              dashboard. Routing it through the nav trail made it and the Quartz
              garden each other's back target, which is a loop with no exit. */}
          {/* This is deliberately a native anchor instead of Next's Link. The
              workspace owns many long-lived streams and observers; handing its
              teardown to a client transition can leave the first click waiting
              on that tree. A document navigation leaves on the first click and
              still gives modified clicks normal browser behavior. */}
          <LinkContextMenu href="/dashboard" label="Dashboard">
          <a
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
          </a>
          </LinkContextMenu>
          <span className="text-gray-700">/</span>
          <LinkContextMenu
            href={
              primarySourceDocument
                ? gardenDocumentHref(clusterSlug, primarySourceDocument)
                : `/garden/${clusterSlug}`
            }
            label={`Garden ${clusterName}`}
          >
          <Link
            href={
              primarySourceDocument
                ? gardenDocumentHref(clusterSlug, primarySourceDocument)
                : `/garden/${clusterSlug}`
            }
            className="text-sm font-semibold text-white truncate max-w-xs hover:text-cyan-100 transition-colors"
            title={
              primarySourceDocument
                ? `Open full source note: ${primarySourceDocument.title}`
                : "Open garden"
            }
          >
            {clusterName}
          </Link>
          </LinkContextMenu>
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
              disabled={!learnPanelAvailable}
              title={
                learnPanelAvailable
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
          <button
            type="button"
            onClick={() => setGardenSettingsOpen(true)}
            title="Garden settings"
            aria-label="Garden settings"
            className="neu-button flex items-center justify-center rounded-lg border border-gray-700 p-1.5 text-gray-300 transition-colors hover:border-gray-500 hover:text-white"
          >
            <GardenSettingsIcon className="h-4 w-4" />
          </button>
        </div>
      </header>

      {gardenSettingsOpen ? (
        <GardenSettingsDialog
          gardenSlug={clusterSlug}
          onClose={() => setGardenSettingsOpen(false)}
        />
      ) : null}

      {/* Body */}
      <div className="relative flex flex-1 min-h-0">
        <GardenArtifactDock>
        {/* Left sidebar: chat sessions */}
        {/* The Terminal's rail, garden-scoped: this garden's chats, its
            uploads, its schedules, its hooks and its live work. The Terminal
            keeps the same rail pointed at everything. */}
        <TerminalSidebar
          surface="tinted"
          collapsed={railCollapsed}
          onToggleCollapsed={rail.toggle}
          resize={rail}
          chats={railChats}
          loading={loadingChats}
          error={railError}
          activeChatId={
            pendingChatVisible
              ? PENDING_CHAT_ROW_ID
              : activeChatId === null
                ? null
                : String(activeChatId)
          }
          openPanel={sidePanel}
          panels={GARDEN_PANELS}
          onNewChat={handleNewChat}
          onTogglePanel={(panel) => {
            setProductPanel(null);
            setSidePanel((current) => (current === panel ? null : panel));
          }}
          onOpenSearch={() => setSearchOpen(true)}
          onOpenChat={(chat) => {
            if (chat.pending) {
              setSidePanel(null);
              textareaRef.current?.focus();
              return;
            }
            openChatById(chat.id);
          }}
          onRenameChat={renameChatFromRail}
          onTogglePin={(chat) =>
            void patchChatMark(
              chat,
              { pinned: !chat.pinned },
              chat.pinned
                ? "This chat could not be unpinned."
                : "This chat could not be pinned.",
            )
          }
          onDeleteChat={(chat) => void deleteChatFromRail(chat)}
          onDeleteChats={(selected) => void deleteChatsFromRail(selected)}
          onHighlightChat={(chat, highlight) =>
            void patchChatMark(
              chat,
              { highlight },
              "This chat could not be highlighted.",
            )
          }
          recentsAction={
            canViewPublicChats ? (
              <button
                type="button"
                onClick={() => setViewPublicChats((value) => !value)}
                aria-pressed={viewPublicChats}
                className={`mr-1 shrink-0 rounded-md px-1.5 py-0.5 text-[10px] transition ${
                  viewPublicChats
                    ? "text-[var(--botanical)]"
                    : "text-[var(--ink-muted)] hover:text-[var(--ink)]"
                }`}
              >
                Public {viewPublicChats ? "on" : "off"}
              </button>
            ) : null
          }
        />

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

        {/* Chat area — warm paper surface so the green sidebars read as a frame */}
        {/* min-w-0: without it the column keeps its ~1056px min-content width and
            a widened map panel is pushed off-screen (clipped by the root overflow). */}
        <div
          className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-gray-900"
          style={composerInset.style}
        >
          {renderLearnPanel()}
          {/* Positioning context for the jump control, so it floats at the foot
              of the transcript rather than below the composer. */}
          <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
            <main
              ref={transcriptScrollRef}
              className="bb-chat-scroller bb-chat-scroll-tail flex flex-1 flex-col overflow-y-auto px-4 py-6"
            >
              <ChatTranscript
                clusterName={clusterName}
                clusterSlug={clusterSlug}
                greeting={chatGreeting.greeting}
                greetingSuggestions={chatGreeting.suggestions}
                onSelectSuggestion={fillComposerWithPrompt}
                onGenerativeUiAction={handleGenerativeUiAction}
                activeProductComparison={productPanel?.compareProductIds.length
                  ? {
                      resourceId: productPanel.resource.id,
                      productIds: productPanel.compareProductIds,
                    }
                  : null}
                chatSessionId={activeChatId}
                isStreaming={transcriptResponding || delegationInFlight}
                loadingChats={chatContentLoading}
                messages={messages}
                gardenSourceAttachments={gardenSourceAttachments}
                activities={agentActivity.activities}
                connection={visibleAgentConnection}
                pendingPermission={agentActivity.pendingPermission}
                onPermissionDecision={(decision) =>
                  void agentActivity.respondToPermission(decision)
                }
                pendingClarification={agentActivity.pendingClarification}
                onClarificationAnswer={(answer) =>
                  void agentActivity.respondToClarification(answer)
                }
                onEditMessage={handleEditUserMessage}
                onDeleteMessage={handleDeleteUserMessage}
                onRetryAssistant={handleRetryAssistant}
                branchGroups={branchGroups}
                onSwitchBranch={switchBranch}
                onExternalAgentTerminal={handleExternalAgentTerminal}
                annotationsByMessage={annotationsByMessage}
                onTextSelection={receiveTextSelection}
                onOpenAnnotation={openAnnotation}
                inlineArtifactRetireVersion={inlineArtifactRetireVersion}
                delegationInFlight={delegationInFlight}
                transcriptScrollRef={transcriptScrollRef}
                transcriptVirtual={transcriptVirtual}
              />
              {messages.length > 0 ? <ChatDisclaimer /> : null}
            </main>
            <ChatMessageRail
              surface="garden-chat"
              items={railItems}
              scrollRef={transcriptScrollRef}
              bridge={transcriptVirtual}
            />
            <ChatJumpToBottom
              visible={transcriptAwayFromBottom}
              busy={
                transcriptResponding ||
                agentLaunchQueue.queued ||
                delegatedAgentLaunching
              }
              onJump={jumpToNewestMessage}
            />
          </div>

          {selectionMenu ? (
            <ChatSelectionMenu
              selection={selectionMenu}
              highlighted={selectionIsHighlighted}
              highlightColor={selectionHighlightColor}
              onHighlightColor={applySelectionHighlight}
              onRemoveHighlight={removeSelectionHighlight}
              onAskInChat={
                canAskSelection
                  ? () => beginSelectionQuestion("chat")
                  : undefined
              }
              onAskHere={
                canAskSelection
                  ? () => beginSelectionQuestion("inline")
                  : undefined
              }
              onClose={() => setSelectionMenu(null)}
            />
          ) : null}
          {openInlineAnswers.map((openAnswer) => {
            const thread = inlineSelectionThreads.get(openAnswer.id);
            if (!thread) return null;
            return (
              <InlineSelectionAnswerPopover
                key={openAnswer.id}
                anchor={openAnswer.anchor}
                question={thread.question}
                answer={thread.answer}
                pending={thread.pending}
                usage={thread.usage}
                responseDurationMs={thread.responseDurationMs}
                startedAt={thread.startedAt}
                answerMessageId={thread.answerMessageId}
                annotations={
                  thread.answerMessageId
                    ? annotationsByMessage.get(thread.answerMessageId)
                    : undefined
                }
                onSelection={receiveTextSelection}
                onOpenAnnotation={openAnnotation}
                onClose={() =>
                  setOpenInlineAnswers((current) => {
                    const openIndex = current.findIndex(
                      (candidate) => candidate.id === openAnswer.id,
                    );
                    return openIndex >= 0
                      ? current.slice(0, openIndex)
                      : current;
                  })
                }
                onDelete={() => deleteInlineSelection(thread.selection.id)}
                onStop={
                  thread.pending && steerableTurnActive
                    ? stopActiveGardenTurn
                    : undefined
                }
                onAskAgain={
                  canAskSelection && !isStreaming && !chatContentLoading
                    ? (question: string) =>
                        askInlineSelectionAgain(thread.selection, question)
                    : undefined
                }
              />
            );
          })}

          {/* Input area */}
          <div
            ref={composerInset.ref}
            className="bb-composer-overlay px-4 pb-3"
          >
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
                {selectedChatDocuments.map((doc) => {
                  const preview = gardenChatSourceAttachment(clusterSlug, doc);
                  const label = doc.title ?? doc.name;
                  return (
                    <span
                      key={doc.slug}
                      className="flex max-w-[220px] items-center gap-1.5 rounded-lg border border-cyan-900/60 bg-cyan-950/20 px-2.5 py-1 text-xs text-cyan-100"
                    >
                      {preview ? (
                        <AttachmentPreviewDialog
                          source={{ ...preview, name: label }}
                          className="min-w-0 flex-1 truncate text-left transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
                          title={`Open ${label}`}
                        >
                          {label}
                        </AttachmentPreviewDialog>
                      ) : (
                        <span className="truncate">{label}</span>
                      )}
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
                  );
                })}
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

            {composerSelection ? (
              <SelectionComposerContext
                selection={composerSelection}
                onCancel={cancelSelectionQuestion}
                widthClassName="max-w-5xl"
              />
            ) : null}
            <AssistantComposer
              capabilitySessionId={activeChat?.conversationId ?? null}
              capabilitySurface="garden_chat"
              capabilityGardenSlug={clusterSlug}
              className="mx-auto w-full max-w-5xl"
              value={input}
              onChange={setInput}
              onSubmit={submitComposer}
              onSubmitDuringRun={
                composerSelection?.mode === "inline" &&
                steerableTurnActive &&
                !externalRunHoldsQueue
                  ? submitComposer
                  : undefined
              }
              onRunWorkflow={runWorkflowAutomation}
              history={sentMessages}
              onPaste={handleChatPaste}
              textareaRef={textareaRef}
              placeholder="Ask about your documents…"
              disabled={chatContentLoading}
              isSending={
                (isStreaming && !respondingToInlineSelection) ||
                launchingExternalAgent !== null
              }
              externalRunActive={
                externalRunHoldsQueue || respondingToInlineSelection
              }
              headerContent={queuedFollowUpsHeader}
              canSubmit={Boolean(input.trim() || chatAttachments.length > 0)}
              model={model}
              models={models}
              modelsLoading={modelsLoading}
              onLoadModels={() => void loadModels()}
              onModelChange={setModel}
              reasoningEffort={reasoningEffort}
              onReasoningEffortChange={setReasoningEffort}
              intelligenceModes={intelligenceModes}
              onAddDocuments={() => chatFileInputRef.current?.click()}
              isAddingDocuments={extractingAttachments}
              attachments={chatAttachments}
              onRemoveAttachment={removeChatAttachment}
              voiceMessages={messages}
              runState={
                !isStreaming || respondingToInlineSelection
                  ? "idle"
                  : visibleAgentConnection === "waiting"
                    ? "waiting_for_permission"
                    : visibleAgentConnection === "connecting"
                      ? "connecting"
                      : "running"
              }
              onQueueSteer={queueFollowUp}
              onStop={
                steerableTurnActive && !respondingToInlineSelection
                  ? stopActiveGardenTurn
                  : undefined
              }
              permissionPending={Boolean(agentActivity.pendingPermission)}
              clarificationPending={Boolean(agentActivity.pendingClarification)}
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
              onSelectOpenGym={() => {}}
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
              onSelectInboxZero={() => {}}
              onSelectVimax={() => {}}
              onSelectVoxDirector={() => {}}
              onSelectMoneyPrinter={() => {}}
              onSelectLegal={() => {}}
              onSelectWardrobe={() => {}}
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
              meetingNotesAgent={meetingNotesAgent}
              onSelectMeetingNotes={() => void selectMeetingNotes()}
              onClearMeetingNotes={() => {
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
              openExecutiveAgent={openExecutiveAgent}
              onSelectOpenExecutive={() => void selectOpenExecutive()}
              onClearOpenExecutive={() => {
                setOpenExecutiveAgent(null);
                setExternalAgentStatus("");
              }}
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
              onSubmitTradingAgents={(request) =>
                void launchTradingAgents(request)
              }
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

        {productPanel ? (
          <SidePanelDock
            label="Product details"
            defaultWidth={460}
            storageKey="breadboard:garden-workspace:panel-width"
          >
            <ProductDetailsPanel
              selection={productPanel}
              onClose={() => setProductPanel(null)}
              onAction={handleGenerativeUiAction}
            />
          </SidePanelDock>
        ) : sidePanel ? (
          <SidePanelDock
            label={PANEL_TITLES[sidePanel]}
            defaultWidth={460}
            storageKey="breadboard:garden-workspace:panel-width"
          >
            {sidePanel === "uploads" ? (
              <UploadsPanel
                activeSurface="garden_chat"
                gardenSlug={clusterSlug}
                onOpenChat={openChatById}
              />
            ) : sidePanel === "scheduled" ? (
              <TerminalScheduledPanel
                surface="garden_chat"
                gardenSlug={clusterSlug}
              />
            ) : sidePanel === "hooks" ? (
              <HooksPanel gardenSlug={clusterSlug} />
            ) : (
              <ProcessesPanel
                gardenSlug={clusterSlug}
                onOpenChat={openChatById}
                onOpenPanel={(panel) => setSidePanel(panel)}
              />
            )}
          </SidePanelDock>
        ) : null}

        <KnowledgeGraph
          clusterSlug={clusterSlug}
          refreshKey={graphRefreshKey}
          sourceLibrary={renderDocumentLibrary()}
          showInternalConceptGraph={showInternalConceptGraph}
          savedLinkCount={savedLinks.length}
        />
        </GardenArtifactDock>
      </div>

      {searchOpen ? (
        <ChatSearchDialog
          surface="garden_chat"
          gardenSlug={clusterSlug}
          recents={sidebarChats}
          onClose={() => setSearchOpen(false)}
          onSelect={openChatById}
        />
      ) : null}

      {linkDialogOpen ? (
        <div
          className="bb-modal-backdrop fixed inset-0 z-50 flex items-center justify-center px-4"
          onClick={(event) => {
            if (event.target === event.currentTarget) setLinkDialogOpen(false);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="garden-link-composer-title"
            className="bb-modal-panel neu-dialog flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border"
          >
            <div className="flex shrink-0 items-center justify-between border-b border-gray-800 px-5 py-3.5">
              <div>
                <h2
                  id="garden-link-composer-title"
                  className="text-base font-semibold text-white"
                >
                  Add link
                </h2>
                <p className="mt-0.5 text-xs text-gray-500">
                  Save a web source in {clusterName}.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setLinkDialogOpen(false)}
                className="neu-button-icon rounded-full p-1.5 text-gray-500"
                aria-label="Close link dialog"
              >
                <svg
                  className="h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M6 18 18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>
            <div className="min-h-0 overflow-y-auto">
              {isOwner ? (
                <form
                  onSubmit={handleSaveLink}
                  className="space-y-4 px-5 py-4"
                >
                  <label className="block space-y-1.5">
                    <span className="text-xs font-medium text-gray-400">
                      Name
                    </span>
                    <input
                      type="text"
                      value={newLinkTitle}
                      onChange={(event) => setNewLinkTitle(event.target.value)}
                      placeholder="Link name"
                      autoFocus
                      className="neu-control h-10 w-full rounded-lg border border-gray-800 bg-gray-950 px-3 text-sm text-gray-200 outline-none transition-colors placeholder:text-gray-700 focus:border-gray-600"
                      aria-label="Link name"
                    />
                  </label>
                  <label className="block space-y-1.5">
                    <span className="text-xs font-medium text-gray-400">
                      URL
                    </span>
                    <input
                      type="url"
                      value={newLinkUrl}
                      onChange={(event) => setNewLinkUrl(event.target.value)}
                      placeholder="https://..."
                      required
                      className="neu-control h-10 w-full rounded-lg border border-gray-800 bg-gray-950 px-3 text-sm text-gray-200 outline-none transition-colors placeholder:text-gray-700 focus:border-gray-600"
                      aria-label="Link URL"
                    />
                  </label>
                  {savingLink ? (
                    <p className="text-xs text-gray-500">
                      Converting link to Markdown...
                    </p>
                  ) : null}
                  <div className="flex justify-end">
                    <button
                      type="submit"
                      disabled={!newLinkUrl.trim() || savingLink}
                      className="neu-button-primary flex items-center gap-2 px-4 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {savingLink ? (
                        <Spinner className="h-3.5 w-3.5" />
                      ) : null}
                      Save link
                    </button>
                  </div>
                </form>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}

      {selectedLinkImportTask ? (
        <div
          className="bb-modal-backdrop fixed inset-0 z-50 flex items-center justify-center px-4"
          onClick={(event) => {
            if (event.target === event.currentTarget) setSelectedLinkImportId(null);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="garden-link-status-title"
            className="bb-modal-panel neu-dialog flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border"
          >
            <div className="flex shrink-0 items-center justify-between border-b border-gray-800 px-5 py-3.5">
              <div className="min-w-0">
                <h2
                  id="garden-link-status-title"
                  className="text-base font-semibold text-white"
                >
                  Link import status
                </h2>
                <p
                  className="mt-0.5 truncate text-xs text-gray-500"
                  title={selectedLinkImportTask.title}
                >
                  {selectedLinkImportTask.title}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedLinkImportId(null)}
                className="neu-button-icon ml-3 shrink-0 rounded-full p-1.5 text-gray-500"
                aria-label="Close link import status"
              >
                <svg
                  className="h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M6 18 18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            <div className="min-h-0 space-y-5 overflow-y-auto px-5 py-4">
              <div className="rounded-lg bg-gray-800/50 px-3 py-3">
                <div className="flex items-center gap-2.5">
                  {selectedLinkImportTask.status === "importing" ? (
                    <Spinner className="h-4 w-4 shrink-0 text-[var(--botanical)]" />
                  ) : selectedLinkImportTask.status === "completed" ? (
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--botanical)_18%,transparent)] text-xs text-[var(--botanical)]">
                      ✓
                    </span>
                  ) : (
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center text-sm font-semibold text-red-400">
                      !
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-gray-300">
                      {selectedLinkImportTask.stage}
                    </p>
                    <p className="mt-0.5 truncate text-[11px] text-gray-600" title={selectedLinkImportTask.url}>
                      {selectedLinkImportTask.url}
                    </p>
                  </div>
                </div>
                {selectedLinkImportTask.status === "importing" ? (
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-gray-800" role="progressbar" aria-label="Link import progress">
                    <div className="h-full w-2/3 animate-pulse rounded-full bg-[var(--botanical)]" />
                  </div>
                ) : null}
              </div>

              <div>
                <h3 className="text-xs font-medium text-gray-400">What is happening</h3>
                <p className="mt-1.5 text-xs leading-5 text-gray-600">
                  {selectedLinkImportTask.status === "importing"
                    ? "The page is being fetched, converted to Markdown, enriched with its available images, and indexed as a Garden source."
                    : selectedLinkImportTask.status === "completed"
                      ? selectedLinkImportTask.duplicate
                        ? "This page was already available. The existing source has been linked to this Garden."
                        : "The page has been converted and is ready to use as a Garden source."
                      : "The page could not be converted into a Garden source."}
                </p>
              </div>

              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 border-t border-gray-800 pt-4 text-xs">
                <dt className="text-gray-600">Started</dt>
                <dd className="text-right text-gray-400">
                  {new Date(selectedLinkImportTask.startedAt).toLocaleString()}
                </dd>
                <dt className="text-gray-600">Elapsed</dt>
                <dd className="text-right tabular-nums text-gray-400">
                  {formatElapsed(
                    Math.max(
                      0,
                      (selectedLinkImportTask.completedAt ?? linkImportClock) -
                        selectedLinkImportTask.startedAt,
                    ),
                  )}
                </dd>
                {selectedLinkImportTask.sourceRelPath ? (
                  <>
                    <dt className="text-gray-600">Source</dt>
                    <dd
                      className="min-w-0 truncate text-right text-gray-400"
                      title={selectedLinkImportTask.sourceRelPath}
                    >
                      {selectedLinkImportTask.sourceRelPath}
                    </dd>
                  </>
                ) : null}
                {selectedLinkImportTask.capturedImages !== undefined ? (
                  <>
                    <dt className="text-gray-600">Images saved</dt>
                    <dd className="text-right text-gray-400">
                      {selectedLinkImportTask.capturedImages}
                    </dd>
                  </>
                ) : null}
              </dl>

              {selectedLinkImportTask.error ? (
                <p className="rounded-lg border border-red-900/40 bg-red-950/20 px-3 py-2 text-xs leading-5 text-red-300">
                  {selectedLinkImportTask.error}
                </p>
              ) : null}
            </div>

            <div className="shrink-0 border-t border-gray-800 px-5 py-4">
              <button
                type="button"
                onClick={() => setSelectedLinkImportId(null)}
                className="neu-button-primary w-full py-2.5 text-sm"
              >
                {selectedLinkImportTask.status === "importing"
                  ? "Continue in background"
                  : "Close"}
              </button>
            </div>
          </section>
        </div>
      ) : null}

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
            if (modalIsUploading) continueUploadInBackground();
            else closeUploadModal();
          }}
        >
          <div className="bb-modal-panel neu-dialog w-full max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain rounded-2xl border p-6">
            <div className="mb-5">
              <h2 className="text-lg font-semibold">
                {isViewingUploadTask ? "Upload status" : "Add documents"}
              </h2>
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
                  if (isViewingUploadTask) return;
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => {
                  if (isViewingUploadTask) {
                    e.preventDefault();
                    return;
                  }
                  handleFileDrop(e);
                }}
                className={[
                  "rounded-xl border-2 border-dashed transition-colors",
                  isDragging ? "border-white/40 bg-white/5" : "border-gray-800",
                ].join(" ")}
              >
                {modalUploadFiles.length === 0 ? (
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
                    {modalUploadFiles.map((f, i) => {
                      const key = fileKey(f);
                      const status = modalUploadStatuses[key];
                      const error = modalUploadErrors[key];
                      const step = modalUploadSteps[key];
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
                            {!isViewingUploadTask && (
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
                    {!isViewingUploadTask && !allDoneOrError && (
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

              {(modalIsUploading || ingestionTokenUsage.startedCalls > 0) && (
                <DocumentIngestionTokenUsage
                  usage={ingestionTokenUsage}
                  pending={modalIsUploading}
                />
              )}

              {/* Parse using VLM (local HunyuanOCR GGUF) */}
              {!isViewingUploadTask && hasVlmCompatibleFile && !allDoneOrError && (
                <VlmParseOption
                  checked={parseWithVlm}
                  onChange={(next) => {
                    setParseWithVlm(next);
                    // Handwriting OCR remains an alternative to the visual VLM.
                    if (next) setIsHandwriting(false);
                  }}
                  disabled={false}
                  status={vlmStatus}
                  loading={vlmStatusLoading}
                />
              )}

              {/* Parse with anydoc (local document → Markdown converter) */}
              {!isViewingUploadTask &&
                hasAnydocCompatibleFile &&
                !allDoneOrError && (
                <AnydocParseOption
                  checked={parseWithAnydoc}
                  onChange={setParseWithAnydoc}
                  disabled={false}
                  status={anydocStatus}
                  loading={anydocStatusLoading}
                  combinedWithVlm={vlmUploadEnabled}
                />
              )}

              {/* Handwriting checkbox */}
              {!isViewingUploadTask &&
                hasHandwritingCompatibleFile &&
                !allDoneOrError && (
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
                    disabled={vlmUploadEnabled}
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
              {!isViewingUploadTask && !allDoneOrError && (
                <label className="flex items-center gap-2.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={handwritingUploadEnabled || generateMap}
                    onChange={(e) => setGenerateMap(e.target.checked)}
                    disabled={handwritingUploadEnabled}
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
              {!isViewingUploadTask && !allDoneOrError && (
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
                    className="w-full bg-gray-950 border border-gray-800 rounded-lg px-4 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-gray-600 transition-colors disabled:opacity-50"
                  />
                </div>
              )}

              {/* Elapsed timer */}
              {(modalIsUploading ||
                (allDoneOrError && modalUploadElapsedMs > 0)) && (
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
                    {modalIsUploading ? "Elapsed" : "Done in"}{" "}
                    {formatElapsed(modalUploadElapsedMs)}
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
                    {modalIsUploading
                      ? "Cancel upload"
                      : isViewingUploadTask
                        ? "Close"
                        : "Cancel"}
                  </button>
                  {!isViewingUploadTask && (
                    <button
                      type="submit"
                      disabled={uploadFiles.length === 0}
                      className="neu-button-primary flex flex-1 items-center justify-center gap-2 py-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {`Upload ${uploadFiles.length > 0 ? `${uploadFiles.length} file${uploadFiles.length > 1 ? "s" : ""}` : ""}`}
                    </button>
                  )}
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {learnConfirmationAction ? (
        <LearnConfirmationDialog
          action={learnConfirmationAction}
          request={
            learnConfirmationAction === "full_rebuild"
              ? learnUserInstruction.trim() || undefined
              : undefined
          }
          onCancel={() => setLearnConfirmationAction(null)}
          onConfirm={() => void handleConfirmLearnDestructiveAction()}
        />
      ) : null}

      {confirmDialog}

      <Toaster
        toasts={toasts}
        onDismiss={dismissToast}
        onOpenChat={openChatFromNotification}
      />
    </div>
  );
}
