"use client";

import {
  memo,
  useState,
  useRef,
  useEffect,
  useCallback,
  type RefObject,
  type PointerEvent as ReactPointerEvent,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { forkCluster } from "@/app/actions/clusters";
import AssistantComposer from "@/app/components/assistant-composer";
import ChatMarkdown from "@/app/components/chat-markdown";
import DocumentIngestionTokenUsage from "@/app/components/document-ingestion-token-usage";
import DocumentIngestionVisionError from "@/app/components/document-ingestion-vision-error";
import KnowledgeGraph from "@/app/components/knowledge-graph";
import NavbarFlowerWind from "@/app/components/navbar-flower-wind";
import { useToast, Toaster } from "@/app/components/toast";
import { startNavigationProgress } from "@/app/components/navigation-progress";
import {
  DEFAULT_ASSISTANT_MODELS,
  DEFAULT_MODEL,
  mergeAssistantModels,
} from "@/lib/ai-models";
import {
  DEFAULT_ASSISTANT_REASONING_EFFORT,
  type AssistantReasoningEffort,
} from "@/lib/assistant-reasoning";
import {
  formatExactTokenCount,
  formatTokenCount,
  normalizeChatTokenUsage,
  summarizeChatTokenUsage,
  type ChatTokenUsage,
} from "@/lib/chat-token-usage";
import {
  currentLearnElapsedMs,
  formatLearnElapsedTime,
} from "@/lib/learn-timer";
import {
  sumIngestTokenUsage,
  type IngestTokenUsage,
} from "@/lib/ingest-token-usage";

interface Message {
  role: "user" | "assistant";
  content: string;
  sources?: string[];
  thinking?: string;
  attachmentNames?: string[];
  usage?: ChatTokenUsage;
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
  hasTextbook?: boolean;
  sourceSetChanged?: boolean;
  buttonLabel?: string;
  validationReport?: LearnValidationReportInfo | null;
  error?: string;
}

interface LearnCouncilDetail {
  councilMode?: string;
  taskType?: string;
  reasoning?: string;
  output?: string;
  candidateReasonings?: string[];
  error?: string;
}

interface LearnEventLine {
  at: string;
  type: string;
  line: string;
  jobId?: string;
  councilRunId?: string;
  detail?: LearnCouncilDetail | null;
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
const LEARN_SETTLED_INDICATOR_VISIBLE_MS = 2 * 60 * 1000;

function formatLearnTotalTokenCount(value: number): string {
  const count = Math.max(0, Math.trunc(value));
  return count < 1_000 ? String(count) : `${(count / 1_000).toFixed(1)}k`;
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

function chatTitleFrom(text: string): string {
  const compact = text.trim().replace(/\s+/g, " ");
  if (!compact) return "New chat";
  return compact.length > 48 ? `${compact.slice(0, 47)}...` : compact;
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
    status === "generating_learning_pages" ||
    status === "generating_textbook" ||
    status === "generating_visuals" ||
    status === "writing_quartz" ||
    status === "building_navigation"
  );
}

interface ChatTranscriptProps {
  clusterName: string;
  isStreaming: boolean;
  loadingChats: boolean;
  messages: Message[];
  messagesEndRef: RefObject<HTMLDivElement | null>;
}

const ChatTranscript = memo(function ChatTranscript({
  clusterName,
  isStreaming,
  loadingChats,
  messages,
  messagesEndRef,
}: ChatTranscriptProps) {
  return (
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

      {messages.map((msg, i) => (
        <div
          key={i}
          className={`flex flex-col gap-2 ${msg.role === "user" ? "items-end" : "items-start"}`}
        >
          {msg.role === "user" ? (
            <div className="flex flex-col items-end gap-1 max-w-[80%]">
              {msg.attachmentNames && msg.attachmentNames.length > 0 && (
                <div className="flex flex-wrap gap-1 justify-end">
                  {msg.attachmentNames.map((name) => (
                    <span
                      key={name}
                      className="flex items-center gap-1 px-2 py-0.5 bg-gray-900 border border-gray-700 rounded-md text-xs text-gray-400"
                    >
                      <svg
                        className="w-3 h-3 shrink-0"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={1.5}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="m18.375 12.739-7.693 7.693a4.5 4.5 0 0 1-6.364-6.364l10.94-10.94A3 3 0 1 1 19.5 7.372L8.552 18.32m.009-.01-.01.01m5.699-9.941-7.81 7.81a1.5 1.5 0 0 0 2.112 2.13"
                        />
                      </svg>
                      {name}
                    </span>
                  ))}
                </div>
              )}
              {msg.content && (
                <div className="w-full bg-gray-800 border border-gray-700 rounded-2xl rounded-tr-sm px-4 py-3 text-sm text-white">
                  <ChatMarkdown content={msg.content} compact />
                </div>
              )}
            </div>
          ) : (
            <div className="w-full flex flex-col gap-2">
              {msg.thinking && (
                <details className="w-full text-xs border border-gray-800/80 rounded-xl bg-gray-900/30 overflow-hidden">
                  <summary className="px-3.5 py-2.5 cursor-pointer select-none list-none flex items-center gap-2 text-gray-500 hover:text-gray-400 transition-colors">
                    <svg
                      className="w-3.5 h-3.5 shrink-0"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={1.5}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M12 18v-5.25m0 0a6.01 6.01 0 0 0 1.5-.189m-1.5.189a6.01 6.01 0 0 1-1.5-.189m3.75 7.478a12.06 12.06 0 0 1-4.5 0m3.75 2.383a14.406 14.406 0 0 1-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 1 0-7.517 0c.85.493 1.509 1.333 1.509 2.316V18"
                      />
                    </svg>
                    <span>Thinking</span>
                    {isStreaming && i === messages.length - 1 && (
                      <span className="inline-block w-1 h-3 bg-gray-600 ml-0.5 animate-pulse align-text-bottom" />
                    )}
                  </summary>
                  <div className="px-3.5 py-3 text-gray-600 whitespace-pre-wrap leading-relaxed border-t border-gray-800/80 font-mono text-[11px]">
                    {msg.thinking}
                  </div>
                </details>
              )}

              <div className="max-w-[90%] text-sm text-gray-200 leading-relaxed">
                <ChatMarkdown content={msg.content} />
                {isStreaming && i === messages.length - 1 && !msg.thinking && (
                  <span className="inline-block w-1.5 h-4 bg-gray-400 ml-0.5 animate-pulse align-text-bottom" />
                )}
                {isStreaming &&
                  i === messages.length - 1 &&
                  msg.thinking &&
                  msg.content && (
                    <span className="inline-block w-1.5 h-4 bg-gray-400 ml-0.5 animate-pulse align-text-bottom" />
                  )}
              </div>
            </div>
          )}
        </div>
      ))}
      <div ref={messagesEndRef} />
    </div>
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
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [draggingSlug, setDraggingSlug] = useState<string | null>(null);
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null);
  const [movingSlug, setMovingSlug] = useState<string | null>(null);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [loadingDocs, setLoadingDocs] = useState(true);
  const [graphRefreshVersion, setGraphRefreshVersion] = useState(0);
  const [docsExpanded, setDocsExpanded] = useState(false);
  const [sourceDocsExpanded, setSourceDocsExpanded] = useState(false);
  const [linksExpanded, setLinksExpanded] = useState(true);
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
  const [leftSidebarWidth, setLeftSidebarWidth] = useState(LEFT_SIDEBAR_DEFAULT);
  const [leftSidebarResizing, setLeftSidebarResizing] = useState(false);
  const leftSidebarOpen = leftSidebarWidth >= LEFT_SIDEBAR_THRESHOLD;

  // Window listeners (not pointer capture) so the drag survives the sidebar
  // swapping between its open and rail render at the collapse threshold.
  function handleLeftSidebarResizeStart(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = leftSidebarOpen ? leftSidebarWidth : LEFT_SIDEBAR_RAIL;
    setLeftSidebarResizing(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const handleMove = (e: PointerEvent) => {
      const next = startWidth + (e.clientX - startX);
      setLeftSidebarWidth(
        Math.min(LEFT_SIDEBAR_MAX, Math.max(LEFT_SIDEBAR_RAIL, Math.round(next))),
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
          leftSidebarResizing ? "bg-gray-400" : "bg-gray-700 group-hover:bg-gray-500"
        }`}
      />
    </div>
  );
  const [savingFlagSlug, setSavingFlagSlug] = useState<string | null>(null);
  const [selectedDocumentSlugs, setSelectedDocumentSlugs] = useState<string[]>(
    [],
  );
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
  const [loadingChats, setLoadingChats] = useState(true);
  const [viewPublicChats, setViewPublicChats] = useState(false);
  const [confirmDeleteChatId, setConfirmDeleteChatId] = useState<number | null>(
    null,
  );
  const [editingChatId, setEditingChatId] = useState<number | null>(null);
  const [editingChatTitle, setEditingChatTitle] = useState("");
  const [savingChatTitleId, setSavingChatTitleId] = useState<number | null>(
    null,
  );
  const [isForking, setIsForking] = useState(false);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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
  const [generateMap, setGenerateMap] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadElapsedMs, setUploadElapsedMs] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadAbortControllerRef = useRef<AbortController | null>(null);
  const uploadCanceledRef = useRef(false);

  // Chat attachments (per-message, sent directly to the AI)
  type ChatAttachment =
    | { type: "text"; text: string; name: string }
    | { type: "image"; dataUrl: string; name: string };
  const [chatAttachments, setChatAttachments] = useState<ChatAttachment[]>([]);
  const [extractingAttachments, setExtractingAttachments] = useState(false);
  const chatFileInputRef = useRef<HTMLInputElement>(null);

  // Garden note generation
  const [isGenerating, setIsGenerating] = useState(false);

  // Learn pipeline
  const [learnState, setLearnState] = useState<LearnStatusResponse | null>(null);
  const [learnBusy, setLearnBusy] = useState(false);
  const [learnCancelBusy, setLearnCancelBusy] = useState(false);
  const [learnPanelOpen, setLearnPanelOpen] = useState(false);
  const [learnSourceOnly, setLearnSourceOnly] = useState(true);
  const [learnSkipManualReview, setLearnSkipManualReview] = useState(false);
  const [learnTimerNowMs, setLearnTimerNowMs] = useState(() => Date.now());
  const [showSettledLearnIndicator, setShowSettledLearnIndicator] = useState(false);
  const [learnEvents, setLearnEvents] = useState<LearnEventLine[]>([]);
  const learnEventsScrollRef = useRef<HTMLDivElement | null>(null);
  const learnSkipManualReviewRef = useRef(false);
  const autoConfirmingLearnJobRef = useRef<string | null>(null);
  // Reasoning effort
  const [reasoningEffort, setReasoningEffort] = useState<AssistantReasoningEffort>(
    DEFAULT_ASSISTANT_REASONING_EFFORT,
  );

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
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [models, setModels] = useState<string[]>([...DEFAULT_ASSISTANT_MODELS]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const canViewPublicChats =
    isOwner && clusterVisibility === "public" && chatAccessible;
  const canForkCluster =
    !isOwner && clusterVisibility === "public" && chatAccessible && forkAllowed;

  useEffect(() => {
    setPrompts(loadPrompts());
  }, []);

  const loadModels = useCallback(async () => {
    if (modelsLoading || modelsLoaded) return;
    setModelsLoading(true);
    try {
      const response = await fetch("/api/models");
      const data = await response.json().catch(() => ({}));
      const ids = Array.isArray(data.data)
        ? data.data
            .map((item: { id?: unknown }) =>
              typeof item?.id === "string" ? item.id : null,
            )
            .filter((id: string | null): id is string => Boolean(id))
        : [];
      if (ids.length > 0) {
        setModels(mergeAssistantModels(ids));
      }
      setModelsLoaded(true);
    } catch {
      // Keep the default model when the model list cannot be loaded.
    } finally {
      setModelsLoading(false);
    }
  }, [modelsLoaded, modelsLoading]);

  const fetchDocuments = useCallback(async () => {
    try {
      const params = new URLSearchParams({ clusterSlug });
      if (showInternalConceptGraph) params.set("includeInternalConcepts", "1");
      const res = await fetch(`/api/documents?${params.toString()}`);
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

  const fetchLearnEvents = useCallback(async () => {
    const jobId = learnState?.job?.id ?? "";
    try {
      const params = jobId ? `?jobId=${encodeURIComponent(jobId)}` : "";
      const res = await fetch(
        `/api/gardens/${encodeURIComponent(clusterSlug)}/learn/events${params}`,
      );
      const data = (await res.json().catch(() => ({}))) as { events?: LearnEventLine[] };
      if (res.ok && Array.isArray(data.events)) setLearnEvents(data.events);
    } catch {
      // The activity log must never interrupt the workspace.
    }
  }, [clusterSlug, learnState?.job?.id]);

  useEffect(() => {
    const active = isLearnActive(learnState?.job?.status) || learnBusy;
    if (!active) return;
    void fetchLearnEvents();
    const id = window.setInterval(() => {
      void fetchLearnStatus();
      void fetchLearnEvents();
    }, 2000);
    return () => window.clearInterval(id);
  }, [fetchLearnStatus, fetchLearnEvents, learnBusy, learnState?.job?.status]);

  useEffect(() => {
    setLearnTimerNowMs(Date.now());
    if (!learnState?.job?.timerStartedAt) return;
    const id = window.setInterval(() => setLearnTimerNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [learnState?.job?.id, learnState?.job?.timerStartedAt]);

  useEffect(() => {
    const job = learnState?.job;
    const active = learnBusy || isLearnActive(job?.status);
    if (active) {
      setShowSettledLearnIndicator(true);
      return;
    }
    if (!job) {
      setShowSettledLearnIndicator(false);
      return;
    }

    const updatedAtMs = Date.parse(job.updatedAt ?? "");
    const settledAgeMs = Number.isFinite(updatedAtMs)
      ? Math.max(0, Date.now() - updatedAtMs)
      : 0;
    const remainingMs = Math.max(
      0,
      LEARN_SETTLED_INDICATOR_VISIBLE_MS - settledAgeMs,
    );
    setShowSettledLearnIndicator(remainingMs > 0);
    if (remainingMs === 0) return;

    const id = window.setTimeout(
      () => setShowSettledLearnIndicator(false),
      remainingMs,
    );
    return () => window.clearTimeout(id);
  }, [learnBusy, learnState?.job]);

  // Keep the council activity log pinned to the newest line.
  useEffect(() => {
    const box = learnEventsScrollRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [learnEvents]);

  const fetchChatSessions = useCallback(async () => {
    try {
      const params = new URLSearchParams({ clusterSlug });
      if (canViewPublicChats && viewPublicChats)
        params.set("includePublicChats", "1");
      const res = await fetch(`/api/chat-sessions?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to load chats");
      const data = await res.json();
      const sessions = (data.sessions ?? []) as ChatSession[];
      setConfirmDeleteChatId(null);
      setChatSessions(sessions);
      setActiveChatId((current) => {
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
  const tokenUsage = summarizeChatTokenUsage(messages);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

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

  function openUploadModal() {
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
    let mapGeneratedCount = 0;
    const screenshotWarnings: string[] = [];
    const mapWarnings: string[] = [];

    for (const file of uploadFiles) {
      if (uploadCanceledRef.current || abortController.signal.aborted) break;

      const key = fileKey(file);
      setUploadStatuses((prev) => ({ ...prev, [key]: "uploading" }));
      setUploadSteps((prev) => ({ ...prev, [key]: "Starting…" }));

      const usesHandwriting =
        isHandwriting && HANDWRITING_FILE_RE.test(file.name);
      const formData = new FormData();
      formData.append("file", file);
      formData.append("clusterSlug", clusterSlug);
      if (uploadLabel.trim())
        formData.append("sourceLabel", uploadLabel.trim());
      formData.append("isHandwriting", String(usesHandwriting));
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
                setUploadTokenUsage((prev) => ({ ...prev, [key]: event.tokenUsage! }));
              }
              if (typeof event.visionError === "string" && event.visionError.trim()) {
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
                  typeof event.error === "string" ? event.error : "Upload failed";
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
            addToast(`${file.name} is already in Documents; duplicate upload skipped`);
          } else {
            successCount++;
            snapshotCount +=
              typeof result.imageCount === "number" ? result.imageCount : 0;
            if (result.mapGenerated === true) {
              mapGeneratedCount++;
            }
            if (typeof result.screenshotWarning === "string") {
              screenshotWarnings.push(`${file.name}: ${result.screenshotWarning}`);
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
        const message = error instanceof Error ? error.message : "Network error";
        setUploadErrors((prev) => ({ ...prev, [key]: message }));
        addToast(`${file.name}: ${message}`);
      }
    }

    const canceled = uploadCanceledRef.current || abortController.signal.aborted;

    if (!canceled && (successCount > 0 || duplicateCount > 0)) {
      const generationLabel = !generateMap
        ? "no map generation"
        : mapWarnings.length > 0 && mapGeneratedCount === 0
          ? "source saving; map generation needs retry"
          : mapWarnings.length > 0
            ? "partial map generation"
            : isHandwriting && hasHandwritingCompatibleFile
              ? "handwriting OCR and map generation"
              : "map generation";
      if (successCount > 0) {
        addToast(
          `Added ${successCount} file${successCount > 1 ? "s" : ""} with ${generationLabel}${snapshotCount > 0 ? ` and ${snapshotCount} source snapshot${snapshotCount === 1 ? "" : "s"}` : ""}`,
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
        if (["jpg", "jpeg", "png", "webp"].includes(ext)) {
          // Extract via API (handles vision / OCR)
          const fd = new FormData();
          fd.append("file", file);
          fd.append("isHandwriting", String(isHandwriting && HANDWRITING_FILE_RE.test(file.name)));
          const res = await fetch("/api/extract-text", {
            method: "POST",
            body: fd,
          });
          const data = await res.json();
          if (!res.ok || data.error) throw new Error(data.error ?? "Extraction failed");
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
          fd.append("isHandwriting", String(isHandwriting && HANDWRITING_FILE_RE.test(file.name)));
          const res = await fetch("/api/extract-text", {
            method: "POST",
            body: fd,
          });
          const data = await res.json();
          if (!res.ok || data.error) throw new Error(data.error ?? "Extraction failed");
          if (data.warning) addToast(`${file.name}: ${data.warning}`);
          results.push({ type: "text", text: data.text, name: file.name });
        }
      } catch (error) {
        addToast(error instanceof Error ? `${file.name}: ${error.message}` : `Could not read ${file.name}`);
      }
    }

    setChatAttachments((prev) => [...prev, ...results]);
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
      addToast(
        `Pasted ${pastedImages.length} screenshot${pastedImages.length === 1 ? "" : "s"}`,
      );
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
    setSelectedDocumentSlugs((prev) =>
      prev.includes(slug)
        ? prev.filter((item) => item !== slug)
        : [...prev, slug],
    );
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

  async function handleNewChat() {
    if (isStreaming) return;
    await createChatSession();
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

  async function handleDeleteChat(sessionId?: number) {
    const targetId = sessionId ?? activeChatId;
    if (!targetId || isStreaming) return;
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
    if (isStreaming || session.isOwn === false) return;
    setConfirmDeleteChatId(null);
    setEditingChatId(session.id);
    setEditingChatTitle(session.title);
  }

  function cancelRenameChat() {
    setEditingChatId(null);
    setEditingChatTitle("");
  }

  async function saveChatTitle(sessionId: number) {
    const title = editingChatTitle.trim().replace(/\s+/g, " ");
    if (!title) {
      addToast("Chat name cannot be empty");
      return;
    }

    const session = chatSessions.find((item) => item.id === sessionId);
    if (!session || session.isOwn === false) return;

    const previousSessions = chatSessions;
    setSavingChatTitleId(sessionId);
    setChatSessions((prev) =>
      prev.map((item) => (item.id === sessionId ? { ...item, title } : item)),
    );

    try {
      const res = await fetch(`/api/chat-sessions/${sessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.error ?? "Failed to rename chat");
      }
      cancelRenameChat();
    } catch (err) {
      setChatSessions(previousSessions);
      addToast(err instanceof Error ? err.message : "Failed to rename chat");
    } finally {
      setSavingChatTitleId(null);
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
        messages: sourceMessages.map(({ role, content }) => ({ role, content })),
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
      const mergedCount = notes.filter((note) => note.action === "merged").length;
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
      addToast(err instanceof Error ? err.message : "Failed to save lesson page");
    } finally {
      setIsGenerating(false);
    }
  }

  // ── Chat submit ─────────────────────────────────────────────────────────────

  const postLearnAction = useCallback(async (
    endpoint: "plan" | "confirm" | "generate" | "regenerate" | "cancel",
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
            model,
            sourceOnly: learnSourceOnly,
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

      await fetchLearnStatus();
      await fetchDocuments();
      setGraphRefreshVersion((value) => value + 1);

      if (endpoint === "plan") {
        if (!learnSkipManualReviewRef.current) {
          addToast("Learning map ready to review", "success");
        }
      } else if (endpoint === "regenerate" && data.planning) {
        if (!learnSkipManualReviewRef.current) {
          addToast("Learning map ready to review", "success");
        }
      } else if (
        endpoint === "confirm" ||
        endpoint === "generate" ||
        endpoint === "regenerate"
      ) {
        addToast("Lessons generated", "success");
      } else if (endpoint === "cancel") {
        setLearnPanelOpen(false);
        addToast("Learn job cancelled");
      }
    } catch (error) {
      await fetchLearnStatus();
      const message = error instanceof Error ? error.message : "Learn action failed";
      if (isCancel) {
        addToast(message);
      }
    } finally {
      if (isCancel) {
        setLearnCancelBusy(false);
      } else {
        setLearnBusy(false);
      }
    }
  }, [
    addToast,
    clusterSlug,
    fetchDocuments,
    fetchLearnStatus,
    learnSourceOnly,
    model,
  ]);

  async function handleCancelLearn() {
    const status = learnState?.job?.status;
    if (learnCancelBusy || (!isLearnActive(status) && status !== "awaiting_confirmation")) return;
    await postLearnAction("cancel");
  }

  async function handleLearnPrimary() {
    if (learnBusy || isLearnActive(learnState?.job?.status)) return;
    if (learnState?.job?.status === "awaiting_confirmation") {
      setLearnPanelOpen(true);
      return;
    }
    if (learnState?.confirmedLearningMapId) {
      await postLearnAction(
        learnState.latestTextbookVersionId || learnState.hasTextbook
          ? "regenerate"
          : "generate",
        { confirmedLearningMapId: learnState.confirmedLearningMapId },
      );
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

  async function handleRegenerateLessons() {
    if (learnBusy || isLearnActive(learnState?.job?.status)) return;
    await postLearnAction("regenerate");
  }

  async function handleGenerateAfterCancellation() {
    if (learnBusy || isLearnActive(learnState?.job?.status)) return;
    await postLearnAction("plan");
  }

  const autoConfirmLearnJobId = learnState?.job?.id;
  const autoConfirmLearnJobStatus = learnState?.job?.status;
  useEffect(() => {
    if (
      !learnSkipManualReview ||
      learnBusy ||
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
    learnBusy,
    learnSkipManualReview,
    postLearnAction,
  ]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!isStreaming && (input.trim() || chatAttachments.length > 0))
        handleSubmit();
    }
  }

  async function handleSubmit() {
    const text = input.trim();
    if ((!text && chatAttachments.length === 0) || isStreaming) return;

    const writableActiveChat = activeChat?.isOwn === false ? null : activeChat;
    const session =
      writableActiveChat ?? (await createChatSession(chatTitleFrom(text)));
    if (!session) return;

    const sessionId = session.id;
    const title =
      session.messages.length === 0 ? chatTitleFrom(text) : undefined;

    // Snapshot attachments and clear them immediately
    const pendingAttachments = chatAttachments;
    const attachmentNames = pendingAttachments.map((a) => a.name);

    const displayText =
      text ||
      (attachmentNames.length > 0
        ? `Attached: ${attachmentNames.join(", ")}`
        : "");
    const userMsg: Message = {
      role: "user",
      content: displayText,
      ...(attachmentNames.length > 0 ? { attachmentNames } : {}),
    };
    const nextMessages = [...session.messages, userMsg];
    const assistantMsg: Message = {
      role: "assistant",
      content: "",
      sources: [],
      thinking: "",
    };
    let finalMessages = [...nextMessages, assistantMsg];

    setInput("");
    setChatAttachments([]);
    setIsStreaming(true);
    updateChatMessages(sessionId, finalMessages);
    if (title) {
      setChatSessions((prev) =>
        prev.map((item) => (item.id === sessionId ? { ...item, title } : item)),
      );
    }

    if (isGardenSaveCommand(text)) {
      try {
        const sourceMessages = session.messages.filter((message) =>
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
        finalMessages = [...nextMessages, { ...assistantMsg }];
        updateChatMessages(sessionId, finalMessages);
        await persistChatSession(sessionId, finalMessages, title);
        setIsStreaming(false);
        textareaRef.current?.focus();
      }
      return;
    }

    if (isMarkdownTagCommand(text, session.messages)) {
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
        finalMessages = [...nextMessages, { ...assistantMsg }];
        updateChatMessages(sessionId, finalMessages);
        await persistChatSession(sessionId, finalMessages, title);
        setIsStreaming(false);
        textareaRef.current?.focus();
      }
      return;
    }

    const responseStartedAt = performance.now();
    try {
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
          model,
          reasoningEffort,
          attachments: pendingAttachments,
          selectedDocumentSlugs,
        }),
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
          if (payload === "[DONE]") break;

          try {
            const event = JSON.parse(payload) as
              | { type: "sources"; sources: string[] }
              | { type: "delta"; text: string }
              | { type: "thinking"; text: string }
              | { type: "usage"; usage: unknown };

            if (event.type === "sources") {
              assistantMsg.sources = event.sources;
              finalMessages = [...nextMessages, { ...assistantMsg }];
              updateChatMessages(sessionId, finalMessages);
            } else if (event.type === "delta") {
              assistantMsg.content += event.text;
              finalMessages = [...nextMessages, { ...assistantMsg }];
              updateChatMessages(sessionId, finalMessages);
            } else if (event.type === "thinking") {
              assistantMsg.thinking =
                (assistantMsg.thinking ?? "") + event.text;
              finalMessages = [...nextMessages, { ...assistantMsg }];
              updateChatMessages(sessionId, finalMessages);
            } else if (event.type === "usage") {
              const usage = normalizeChatTokenUsage(event.usage);
              if (usage) {
                assistantMsg.usage = {
                  ...usage,
                  responseDurationMs: Math.round(performance.now() - responseStartedAt),
                };
                finalMessages = [...nextMessages, { ...assistantMsg }];
                updateChatMessages(sessionId, finalMessages);
              }
            }
          } catch {
            // malformed event — skip
          }
        }
      }
    } catch (error) {
      assistantMsg.content =
        error instanceof Error && error.message.trim()
          ? error.message
          : "Something went wrong. Please try again.";
      finalMessages = [...nextMessages, { ...assistantMsg }];
      updateChatMessages(sessionId, finalMessages);
    } finally {
      await persistChatSession(sessionId, finalMessages, title);
      setIsStreaming(false);
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

  const graphRefreshKey = `${graphRefreshVersion}:${documents
    .map((d) => `${d.slug}:${d.linkCount}:${d.wordCount}`)
    .join("|")}`;
  function renderLearnPanel() {
    const job = learnState?.job ?? null;
    const status = job?.status ?? "idle";
    const active = isLearnActive(status);
    const proposedMap = learnState?.proposedLearningMap ?? null;
    const progress = Math.max(0, Math.min(100, job?.progressPercent ?? 0));
    const displayProgress = status === "complete" || status === "failed" ? 100 : progress;
    const canStart = Boolean(learnState?.hasSources) && !learnBusy && !active;
    const shouldShowPanel = learnPanelOpen;
    const panelExpanded = learnPanelOpen;
    const canClosePanel =
      !active && (status === "complete" || status === "failed" || status === "cancelled");
    const showPrimaryAction =
      !canClosePanel || status === "failed" || status === "cancelled";
    const statusMessage = active
      ? job?.currentStep || "Working"
      : status === "complete"
        ? job?.currentStep || "Lessons complete"
        : status === "failed"
          ? "Learn failed before lessons were finished."
          : status === "cancelled"
            ? job?.currentStep || "Learn stopped and generated files were cleaned up."
            : status === "awaiting_confirmation"
              ? "Confirm the section order to generate your lessons."
              : learnState?.hasTextbook
                ? "Refresh the generated lessons from the current sources."
                : "Generate structured lessons from your sources.";
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

    if (!isOwner || (!learnState?.hasSources && status !== "failed")) return null;
    if (!shouldShowPanel) return null;

    return (
      <section className="mx-auto mt-4 max-h-[55vh] w-[calc(100%_-_2rem)] max-w-5xl shrink-0 overflow-y-auto rounded-lg border border-gray-800 bg-gray-950/70 p-3 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-white">Learn</p>
              {learnState?.sourceSetChanged && (
                <span className="rounded-md border border-amber-700/50 bg-amber-950/30 px-2 py-0.5 text-[10px] font-medium text-amber-300">
                  New sources
                </span>
              )}
            </div>
            <p className="mt-1 text-xs text-gray-500">{statusMessage}</p>
            {job?.currentSectionTitle || job?.currentPageTitle ? (
              <p className="mt-1 truncate text-xs text-gray-600">
                {[job.currentSectionTitle, job.currentPageTitle].filter(Boolean).join(" / ")}
              </p>
            ) : null}
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
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
                onClick={handleRegenerateLessons}
                disabled={!canStart}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-white text-gray-950 font-medium rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
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
                {learnBusy ? "Regenerating..." : "Regenerate"}
              </button>
            )}
            {showPrimaryAction && (
              <button
                type="button"
                onClick={
                  status === "failed"
                    ? handleRegenerateLessons
                    : status === "cancelled"
                      ? handleGenerateAfterCancellation
                      : handleLearnPrimary
                }
                disabled={!canStart && status !== "awaiting_confirmation"}
                className="flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-gray-950 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {learnBusy || active ? <Spinner className="h-3.5 w-3.5" /> : null}
                {status === "failed"
                  ? learnBusy
                    ? "Regenerating..."
                    : "Regenerate"
                  : status === "cancelled"
                    ? learnBusy
                      ? "Generating..."
                      : "Generate"
                  : learnState?.buttonLabel ?? "Learn"}
              </button>
            )}
            {active && (
              <button
                type="button"
                onClick={handleCancelLearn}
                disabled={learnCancelBusy}
                className="flex items-center gap-1.5 rounded-lg border border-red-900/60 bg-red-950/30 px-3 py-1.5 text-sm font-medium text-red-300 transition-colors hover:border-red-700 hover:text-red-200 disabled:cursor-wait disabled:opacity-60"
                title="Stop this Learn run"
              >
                {learnCancelBusy ? <Spinner className="h-3.5 w-3.5" /> : null}
                {learnCancelBusy ? "Stopping..." : "Stop"}
              </button>
            )}
            {!active && status !== "awaiting_confirmation" && (
              <button
                type="button"
                onClick={() => setLearnPanelOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-800 text-gray-500 transition-colors hover:border-gray-700 hover:text-gray-300"
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
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {(active || status === "complete" || status === "failed") && (
          <div className="mt-3">
            <div className="h-1.5 overflow-hidden rounded-full bg-gray-800">
              <div
                className={[
                  "h-full rounded-full transition-all",
                  active ? "learn-progress-pulse" : "",
                  status === "failed"
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
            {status === "failed" && job?.error ? (
              <p className="mt-2 text-xs text-red-300">{job.error}</p>
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
                  <div key={metric.label} className="flex items-baseline gap-1">
                    <dt className="text-gray-600">{metric.label}</dt>
                    <dd
                      className="font-mono tabular-nums text-gray-200"
                      title={metric.title}
                    >
                      {learnTokenUsage.estimated ? "~" : ""}
                      {metric.label === "Total"
                        ? formatLearnTotalTokenCount(metric.value)
                        : formatTokenCount(metric.value).toLowerCase()}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : (
              <span className="text-gray-600">Waiting for usage</span>
            )}

            {learnUsageCallSummary ? (
              <span className="ml-auto text-gray-600">{learnUsageCallSummary}</span>
            ) : null}
          </div>
        ) : null}

        {(active || (learnEvents.length > 0 && (status === "complete" || status === "failed"))) && (
          <div className="mt-3">
            <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-gray-600">
              Council activity
            </p>
            <div
              ref={learnEventsScrollRef}
              className="max-h-40 overflow-y-auto rounded-lg border border-gray-800 bg-gray-950/80 px-3 py-2 font-mono text-[11px] leading-5 text-gray-400"
            >
              {learnEvents.length === 0 ? (
                <p className="text-gray-600">Waiting for the first council event…</p>
              ) : (
                learnEvents.map((event, index) => {
                  return (
                    <div key={`${event.at}-${event.type}-${index}`}>
                      <p
                        className={
                          /fallback|failed|timed out|rejected|dropped/i.test(event.line)
                            ? "text-amber-400/90"
                            : undefined
                        }
                      >
                        <span className="text-gray-600">
                          {event.at ? new Date(event.at).toLocaleTimeString() : "--:--:--"}
                        </span>{" "}
                        {event.line}
                      </p>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {panelExpanded && proposedMap && status === "awaiting_confirmation" && (
          <div className="mt-4 border-t border-gray-800 pt-3">
            <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-medium text-gray-100">{proposedMap.title}</p>
                {proposedMap.summary ? (
                  <p className="mt-0.5 text-xs text-gray-500">{proposedMap.summary}</p>
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
                  {learnCancelBusy ? <Spinner className="h-3.5 w-3.5" /> : null}
                  {learnCancelBusy ? "Cancelling..." : "Cancel"}
                </button>
              </div>
            </div>

            <ol className="max-h-72 space-y-2 overflow-y-auto pr-1">
              {proposedMap.sections.map((section, sectionIndex) => (
                <li key={`${section.title}-${sectionIndex}`} className="rounded-lg border border-gray-800 bg-gray-900/50 p-3">
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-gray-800 text-[11px] font-medium text-gray-300">
                      {sectionIndex + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-gray-100">{section.title}</p>
                      {section.purpose ? (
                        <p className="mt-1 text-xs leading-5 text-gray-500">{section.purpose}</p>
                      ) : null}
                      <ul className="mt-2 space-y-1">
                        {section.subsections.map((subsection, subsectionIndex) => (
                          <li key={`${subsection.title}-${subsectionIndex}`} className="text-xs text-gray-400">
                            <span className="text-gray-600">
                              {sectionIndex + 1}.{subsectionIndex + 1}
                            </span>{" "}
                            {subsection.title}
                            {subsection.visualOpportunities && subsection.visualOpportunities.length > 0 ? (
                              <span className="ml-2 text-cyan-500">
                                {subsection.visualOpportunities.length} visual
                                {subsection.visualOpportunities.length === 1 ? "" : "s"}
                              </span>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
            {proposedMap.warnings && proposedMap.warnings.length > 0 ? (
              <div className="mt-3 rounded-lg border border-amber-900/50 bg-amber-950/20 px-3 py-2">
                {proposedMap.warnings.map((warning, index) => (
                  <p key={`${warning}-${index}`} className="text-xs text-amber-200">
                    {warning}
                  </p>
                ))}
              </div>
            ) : null}
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

  function renderCollapsedLearnIndicator() {
    const job = learnState?.job;
    if (!isOwner || learnPanelOpen || (!job && !learnBusy)) return null;

    const status = job?.status;
    const active = learnBusy || isLearnActive(status);
    if (!active && !showSettledLearnIndicator) return null;
    const label = active
      ? job?.currentStep || "Learn is running"
      : status === "complete"
        ? "Learn finished"
        : status === "failed"
          ? "Learn failed"
          : status === "awaiting_confirmation"
            ? "Learning map is waiting for review"
            : status === "cancelled"
              ? "Learn was cancelled"
              : "Open Learn panel";
    const tone = status === "complete"
      ? "border-gray-700 bg-gray-900 text-[#4f8a62]"
      : status === "failed"
        ? "border-gray-700 bg-gray-900 text-[#b85c5c]"
        : status === "awaiting_confirmation"
          ? "border-[#a77f2b] bg-[#c59a3d] text-[var(--paper-raised)]"
          : "border-gray-700 bg-gray-900 text-gray-400";

    return (
      <button
        type="button"
        onClick={() => setLearnPanelOpen(true)}
        className={`absolute right-4 top-4 z-20 flex h-10 w-10 items-center justify-center rounded-full border shadow-md transition hover:scale-105 ${tone}`}
        aria-label={`Open Learn panel. ${label}`}
        title={`${label}. Open Learn panel`}
      >
        {active ? (
          <Spinner className="h-5 w-5" />
        ) : status === "complete" || status === "failed" ? (
          <span
            className="h-5 w-5 rounded-full border-[3px] border-current"
            aria-hidden="true"
          />
        ) : status === "awaiting_confirmation" ? (
          <svg
            className="h-5 w-5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.1}
            aria-hidden="true"
          >
            <path strokeLinecap="round" d="M9.5 8.5v7M14.5 8.5v7" />
          </svg>
        ) : (
          <span className="h-3 w-3 rounded-full border-2 border-current" aria-hidden="true" />
        )}
      </button>
    );
  }

  function renderMarkdownRows(items: DocInfo[]) {
    return (
      <ul className="py-1">
        {items.map((doc, index) => {
          const isSource = doc.type === "source-document";
          const isPdf = isSource && doc.sourceType?.toLowerCase() === "pdf";
          const isPdfSource =
            isPdf && Boolean(doc.sourcePdf);
          const displayTitle =
            (isPdf ? doc.sourceFile?.trim() : "") || doc.title || doc.name;
          // Existing PDF notes predate the explicit description field and have
          // the generated description in `title`. Preserve it as a UI fallback
          // so they also adopt the filename-first presentation immediately.
          const storedDescription = doc.description?.trim() || "";
          const sourceDescription =
            (storedDescription !== displayTitle ? storedDescription : "") ||
            (isPdf && doc.title?.trim() !== displayTitle ? doc.title.trim() : "");
          const documentHref = isPdfSource
            ? `/gardens/${clusterSlug}/pdf/${encodeURIComponent(doc.slug)}`
            : `/garden/${clusterSlug}?note=${encodeURIComponent(doc.slug)}`;
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
              {isSource && (
                <label
                  className="mt-0.5 flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center"
                  title={
                    selectedDocumentSlugs.includes(doc.slug)
                      ? "Selected for chat context"
                      : "Select this document for chat"
                  }
                  aria-label="Select document for chat"
                >
                  <input
                    type="checkbox"
                    checked={selectedDocumentSlugs.includes(doc.slug)}
                    onChange={() => toggleSelectedDocument(doc.slug)}
                    className="h-3.5 w-3.5 rounded border-gray-700 bg-gray-950 accent-cyan-300"
                  />
                </label>
              )}
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
                  title={
                    doc.flagColor ? `Flagged ${doc.flagColor}` : "Flag note"
                  }
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
    const root: FolderTreeNode = { path: "", name: "", childFolders: [], files: [] };
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
                    doc.flagColor === color ? "border-white" : "border-gray-800",
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
            <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
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
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
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
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}>
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
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}>
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166M19.228 5.79 18.16 19.673A2.25 2.25 0 0 1 15.916 21.75H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .563c.34-.059.68-.114 1.022-.166m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
              />
            </svg>
          </span>
        </div>
        {isExpanded && (node.childFolders.length > 0 || node.files.length > 0) && (
          <ul>
            {node.childFolders.map((child) => renderFolderTree(child, depth + 1))}
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
        className={isRootDrop ? "ring-1 ring-inset ring-cyan-400/40 bg-cyan-950/10" : ""}
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

      <div className="border-t border-gray-800 shrink-0">
        <button
          onClick={() => setLinksExpanded((v) => !v)}
          className="w-full flex items-center justify-between px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider hover:text-white transition-colors"
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
          <div className="border-t border-gray-800">
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
                  className="h-8 w-full rounded-md border border-gray-800 bg-gray-950 px-2.5 text-xs text-gray-200 outline-none transition-colors placeholder:text-gray-700 focus:border-gray-600"
                  aria-label="Link name"
                />
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newLinkUrl}
                    onChange={(e) => setNewLinkUrl(e.target.value)}
                    placeholder="https://..."
                    className="h-8 min-w-0 flex-1 rounded-md border border-gray-800 bg-gray-950 px-2.5 text-xs text-gray-200 outline-none transition-colors placeholder:text-gray-700 focus:border-gray-600"
                    aria-label="Link URL"
                  />
                  <button
                    type="submit"
                    disabled={!newLinkUrl.trim() || savingLink}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-gray-800 text-gray-500 transition-colors hover:border-gray-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
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
                    <li key={link.id} className="group flex items-center gap-2 px-3 py-2">
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
    </>
  );

  return (
    <div className="h-screen bg-gray-950 text-white flex flex-col overflow-hidden">
      {/* Header */}
      <header className="relative flex items-center justify-between px-6 py-3.5 border-b border-gray-800 shrink-0">
        <NavbarFlowerWind />
        <div className="relative z-10 flex items-center gap-3">
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
            Dashboard
          </Link>
          <span className="text-gray-700">/</span>
          <Link
            href={`/garden/${clusterSlug}${primarySourceDocument ? `?note=${encodeURIComponent(primarySourceDocument.slug)}` : ""}`}
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
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-300 border border-gray-700 rounded-lg hover:border-gray-500 hover:text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
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
          <Link
            href={`/garden/${clusterSlug}`}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-300 border border-gray-700 rounded-lg hover:border-gray-500 hover:text-white transition-colors"
          >
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
                d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
              />
            </svg>
            View garden
          </Link>
          {isOwner && (
            <button
              type="button"
              onClick={() => setLearnPanelOpen((open) => !open)}
              disabled={!learnState?.hasSources}
              title={
                learnState?.hasSources
                  ? learnPanelOpen
                    ? "Close Learn panel"
                    : "Open Learn panel"
                  : "Upload sources before learning"
              }
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-white text-gray-950 font-medium rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
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
                  d="M12 6.75v10.5m0-10.5c-1.5-1-3.5-1.5-6-1.5v10.5c2.5 0 4.5.5 6 1.5m0-10.5c1.5-1 3.5-1.5 6-1.5v10.5c-2.5 0-4.5.5-6 1.5"
                />
              </svg>
              {learnPanelOpen ? "Close Learn panel" : "Open Learn panel"}
            </button>
          )}
          <button
            onClick={handleGenerateNotes}
            disabled={messages.length === 0 || isGenerating}
            title="Save the latest assistant response as a lesson page"
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-300 border border-gray-700 rounded-lg hover:border-gray-500 hover:text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
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
            className="relative shrink-0 border-r border-gray-800 flex flex-col bg-gray-950"
          >
            {leftSidebarResizeHandle}
            {/* New chat */}
            <div className="px-3 pt-3 pb-2 shrink-0 flex items-center gap-2">
              <button
                onClick={handleNewChat}
                disabled={isStreaming || loadingChats}
                className="flex-1 min-w-0 flex items-center gap-2 px-3 py-2.5 text-sm text-gray-300 rounded-lg border border-gray-800 hover:bg-gray-900 hover:text-white hover:border-gray-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
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
                              <form
                                onSubmit={(e) => {
                                  e.preventDefault();
                                  void saveChatTitle(session.id);
                                }}
                                className={[
                                  "flex items-center gap-1 rounded-lg px-2 py-1.5",
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
                                  onKeyDown={(e) => {
                                    if (e.key === "Escape") {
                                      e.preventDefault();
                                      cancelRenameChat();
                                    }
                                  }}
                                  autoFocus
                                  disabled={savingChatTitleId === session.id}
                                  className="min-w-0 flex-1 rounded-md border border-gray-700 bg-gray-950 px-2 py-1 text-xs text-white outline-none focus:border-gray-500 disabled:opacity-50"
                                />
                                <button
                                  type="submit"
                                  disabled={savingChatTitleId === session.id}
                                  className="shrink-0 rounded p-1 text-gray-500 transition-colors hover:bg-gray-800 hover:text-white disabled:opacity-40"
                                  aria-label="Save chat name"
                                  title="Save"
                                >
                                  {savingChatTitleId === session.id ? (
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
                                        d="m4.5 12.75 6 6 9-13.5"
                                      />
                                    </svg>
                                  )}
                                </button>
                                <button
                                  type="button"
                                  onClick={cancelRenameChat}
                                  disabled={savingChatTitleId === session.id}
                                  className="shrink-0 rounded p-1 text-gray-600 transition-colors hover:bg-gray-800 hover:text-white disabled:opacity-40"
                                  aria-label="Cancel rename"
                                  title="Cancel"
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
                              </form>
                            ) : (
                              <button
                                onClick={() =>
                                  !isStreaming && setActiveChatId(session.id)
                                }
                                onDoubleClick={() => startRenameChat(session)}
                                className={[
                                  "w-full text-left px-3 py-2 pr-14 text-sm rounded-lg transition-colors flex items-center gap-2",
                                  session.id === activeChatId
                                    ? "bg-gray-800 text-white"
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
                              <div className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-1.5 rounded-lg border border-gray-700 bg-gray-900 px-2 py-1 shadow-lg">
                                <span className="text-[10px] text-gray-400">
                                  Delete?
                                </span>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDeleteChat(session.id);
                                  }}
                                  disabled={isStreaming}
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
                                    disabled={isStreaming}
                                    className="shrink-0 p-0.5 text-gray-600 transition-colors hover:text-white disabled:hidden"
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
                                    disabled={isStreaming}
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
            className="relative shrink-0 border-r border-gray-800 flex flex-col items-center bg-gray-950 py-3"
          >
            {leftSidebarResizeHandle}
            <button
              onClick={handleNewChat}
              disabled={isStreaming || loadingChats}
              title="New chat"
              className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-600 hover:bg-gray-900 hover:text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
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
        <div className="relative flex-1 flex flex-col min-h-0 bg-gray-900">
          {renderLearnPanel()}
          {renderCollapsedLearnIndicator()}
          <main className="flex-1 overflow-y-auto px-4 py-6">
            <ChatTranscript
              clusterName={clusterName}
              isStreaming={isStreaming}
              loadingChats={loadingChats}
              messages={messages}
              messagesEndRef={messagesEndRef}
            />
          </main>

          {/* Input area */}
          <div className="shrink-0 border-t border-gray-800 px-4 py-4">
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

            <input
              ref={chatFileInputRef}
              type="file"
              accept={ACCEPTED}
              multiple
              onChange={handleChatFileInput}
              className="hidden"
            />

            <AssistantComposer
              className="mx-auto w-full max-w-5xl"
              value={input}
              onChange={setInput}
              onSubmit={handleSubmit}
              onKeyDown={handleKeyDown}
              onPaste={handleChatPaste}
              textareaRef={textareaRef}
              textareaStyle={{ fieldSizing: "content" } as React.CSSProperties}
              placeholder="Ask about your documents…"
              disabled={isStreaming || loadingChats}
              isSending={isStreaming}
              canSubmit={Boolean(input.trim() || chatAttachments.length > 0)}
              model={model}
              models={models}
              modelsLoading={modelsLoading}
              onLoadModels={() => void loadModels()}
              onModelChange={setModel}
              reasoningEffort={reasoningEffort}
              onReasoningEffortChange={setReasoningEffort}
              onAddDocuments={() => chatFileInputRef.current?.click()}
              isAddingDocuments={extractingAttachments}
              attachments={chatAttachments}
              onRemoveAttachment={removeChatAttachment}
              tokenUsage={tokenUsage}
              tokenUsagePending={isStreaming}
              utilityActions={
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setShowPrompts((value) => !value);
                      setPromptSearch("");
                      setPromptCategory("All");
                    }}
                    className={`flex h-11 w-11 items-center justify-center rounded-full transition ${
                      showPrompts
                        ? "bg-[var(--paper-strong)] text-[#8a6f00]"
                        : "text-[var(--ink-muted)] hover:bg-[var(--paper-strong)] hover:text-[var(--ink)]"
                    }`}
                    title="Prompt library"
                    aria-label="Prompt library"
                  >
                    <svg className="h-4.5 w-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 0 1 0 3.75H5.625a1.875 1.875 0 0 1 0-3.75Z" />
                    </svg>
                  </button>
                </>
              }
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
          className="fixed inset-0 z-40 flex items-center justify-center p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowNewNote(false);
          }}
        >
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setShowNewNote(false)}
          />
          <form
            onSubmit={handleSaveNewNote}
            className="relative w-full max-w-4xl h-[85vh] bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
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
                className="p-1.5 text-gray-500 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
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
                className="px-3 py-1.5 text-sm text-gray-400 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!newNoteTitle.trim() || isSavingNote}
                className="flex items-center gap-1.5 px-4 py-1.5 text-sm bg-white text-gray-950 font-medium rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
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
          className="fixed inset-0 z-40 flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowPrompts(false);
          }}
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setShowPrompts(false)}
          />

          <div className="relative w-full sm:max-w-2xl bg-gray-900 border border-gray-700 rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[80vh] overflow-hidden">
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
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-white text-gray-950 font-medium rounded-lg hover:bg-gray-100 transition-colors"
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
                  className="p-1.5 text-gray-500 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
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
                          className="p-1.5 text-gray-500 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
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
                            className="p-1.5 text-gray-500 hover:text-red-400 hover:bg-red-950/30 rounded-lg transition-colors"
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
                          className="px-3 py-1.5 text-xs bg-white text-gray-950 font-medium rounded-lg hover:bg-gray-100 transition-colors"
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
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setEditingPrompt(null);
          }}
        >
          <div className="w-full max-w-lg bg-gray-900 border border-gray-800 rounded-2xl p-6 shadow-2xl">
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
                  className="flex-1 py-2.5 text-sm text-gray-400 border border-gray-800 rounded-lg hover:border-gray-600 hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={
                    !editingPrompt.title.trim() || !editingPrompt.content.trim()
                  }
                  className="flex-1 py-2.5 text-sm bg-white text-gray-950 font-medium rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeUploadModal();
          }}
        >
          <div className="w-full max-w-md bg-gray-900 border border-gray-800 rounded-2xl p-6 shadow-2xl">
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

              {/* Handwriting checkbox */}
              {hasHandwritingCompatibleFile && !allDoneOrError && (
                <label className="flex items-start gap-2.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={isHandwriting}
                    onChange={(e) => {
                      setIsHandwriting(e.target.checked);
                      if (e.target.checked) setGenerateMap(true);
                    }}
                    disabled={isUploading}
                    className="mt-0.5 w-4 h-4 rounded border-gray-700 bg-gray-950 accent-white disabled:opacity-50"
                  />
                  <span>
                    <span className="block text-sm text-gray-400">
                      Handwritten or scanned pages
                    </span>
                    <span className="block text-[11px] text-gray-600 mt-0.5">
                      Uses vision OCR on each PDF page or image before
                      generating the Learning Map.
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
                    {isUploading ? "Elapsed" : "Done in"} {formatElapsed(uploadElapsedMs)}
                  </span>
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={closeUploadModal}
                  className="flex-1 py-2.5 text-sm text-gray-400 border border-gray-800 rounded-lg hover:border-gray-600 hover:text-white transition-colors disabled:opacity-40"
                >
                  {allDoneOrError ? "Close" : isUploading ? "Cancel upload" : "Cancel"}
                </button>
                {!allDoneOrError && (
                  <button
                    type="submit"
                    disabled={uploadFiles.length === 0 || isUploading}
                    className="flex-1 py-2.5 text-sm bg-white text-gray-950 font-medium rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {isUploading && <Spinner />}
                    {isUploading
                      ? `Uploading… (${Object.values(uploadStatuses).filter((s) => s === "done").length}/${uploadFiles.length})`
                      : `Upload ${uploadFiles.length > 0 ? `${uploadFiles.length} file${uploadFiles.length > 1 ? "s" : ""}` : ""}`}
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>
      )}

      <Toaster toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
