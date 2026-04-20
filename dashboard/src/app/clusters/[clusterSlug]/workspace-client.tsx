"use client";

import {
  memo,
  useState,
  useRef,
  useEffect,
  useCallback,
  type RefObject,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { forkCluster } from "@/app/actions/clusters";
import ChatMarkdown from "@/app/components/chat-markdown";
import KnowledgeGraph from "@/app/components/knowledge-graph";
import { useToast, Toaster } from "@/app/components/toast";

interface Message {
  role: "user" | "assistant";
  content: string;
  sources?: string[];
  thinking?: string;
  attachmentNames?: string[];
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
  title: string;
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

interface GeneratedNoteResult {
  slug: string;
  title: string;
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

function markdownTypeLabel(doc: DocInfo): string {
  if (doc.type === "generated-note") return "chat note";
  if (doc.type === "knowledge-topic") return "topic";
  if (doc.type === "source-document") return doc.sourceType || "source";
  return doc.type || "note";
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
    <div className="max-w-2xl mx-auto flex flex-col gap-6">
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
              <span className="text-gray-500">Generate notes</span> to save
              insights to your garden
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
      "Summarize the key points from all documents in this cluster into a concise, structured overview with clear headings.",
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
      "Generate 8 quiz questions based on the content in this cluster to test my understanding. Mix multiple choice and open questions. Include correct answers at the end.",
    category: "Study",
    isDefault: true,
  },
  {
    id: "dp-4",
    title: "Explain like I'm a beginner",
    content:
      "Explain the main concepts in this cluster as if I have no prior background in the subject. Use simple language, analogies, and real-world examples.",
    category: "Study",
    isDefault: true,
  },
  {
    id: "dp-5",
    title: "Find connections",
    content:
      "Identify and explain the key connections, relationships, and dependencies between the topics and documents in this cluster. Show how ideas link together.",
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
  const { toasts, addToast } = useToast();

  // Documents sidebar
  const [documents, setDocuments] = useState<DocInfo[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(true);
  const [graphRefreshVersion, setGraphRefreshVersion] = useState(0);
  const [docsExpanded, setDocsExpanded] = useState(false);
  const [sourceDocsExpanded, setSourceDocsExpanded] = useState(true);
  const [leftSidebarOpen, setLeftSidebarOpen] = useState(true);
  const [savingFlagSlug, setSavingFlagSlug] = useState<string | null>(null);
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
  const [uploadLabel, setUploadLabel] = useState("");
  const [isHandwriting, setIsHandwriting] = useState(false);
  const [generateMap, setGenerateMap] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Chat attachments (per-message, sent directly to the AI)
  type ChatAttachment =
    | { type: "text"; text: string; name: string }
    | { type: "image"; dataUrl: string; name: string };
  const [chatAttachments, setChatAttachments] = useState<ChatAttachment[]>([]);
  const [extractingAttachments, setExtractingAttachments] = useState(false);
  const chatFileInputRef = useRef<HTMLInputElement>(null);

  // Garden note generation
  const [isGenerating, setIsGenerating] = useState(false);

  // Thinking mode
  const [thinkingMode, setThinkingMode] = useState(false);

  // Prompts
  const [prompts, setPrompts] = useState<SavedPrompt[]>([]);
  const [showPrompts, setShowPrompts] = useState(false);
  const [promptSearch, setPromptSearch] = useState("");
  const [promptCategory, setPromptCategory] = useState("All");
  const [editingPrompt, setEditingPrompt] = useState<SavedPrompt | null>(null);

  // New markdown note modal
  const [showNewNote, setShowNewNote] = useState(false);
  const [newNoteTitle, setNewNoteTitle] = useState("");
  const [newNoteContent, setNewNoteContent] = useState("");
  const [isSavingNote, setIsSavingNote] = useState(false);

  // Model selector
  const [model, setModel] = useState("gpt-5.4");
  const [models, setModels] = useState<string[]>(["gpt-5.4"]);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [showUsage, setShowUsage] = useState(false);
  const [usageData, setUsageData] = useState<Record<string, unknown> | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const canViewPublicChats =
    isOwner && clusterVisibility === "public" && chatAccessible;
  const canForkCluster =
    !isOwner && clusterVisibility === "public" && chatAccessible && forkAllowed;

  useEffect(() => {
    setPrompts(loadPrompts());
  }, []);

  useEffect(() => {
    fetch("/api/models")
      .then((r) => r.json())
      .then((data) => {
        const ids: string[] = (data.data ?? []).map(
          (m: { id: string }) => m.id,
        );
        if (ids.length > 0) setModels(Array.from(new Set(["gpt-5.4", ...ids])));
      })
      .catch(() => {});
  }, []);

  const fetchDocuments = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/documents?clusterSlug=${encodeURIComponent(clusterSlug)}`,
      );
      if (res.ok) {
        const data = await res.json();
        setDocuments(data.documents ?? []);
      }
    } catch {
      // ignore
    } finally {
      setLoadingDocs(false);
    }
  }, [clusterSlug]);

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

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

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ── New markdown note ────────────────────────────────────────────────────────

  function openNewNoteModal() {
    setNewNoteTitle("");
    setNewNoteContent("");
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
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        addToast(data.error ?? "Failed to save note");
        return;
      }
      setShowNewNote(false);
      await fetchDocuments();
      addToast("Note saved");
    } catch {
      addToast("Failed to save note");
    } finally {
      setIsSavingNote(false);
    }
  }

  // ── Upload modal ────────────────────────────────────────────────────────────

  function openUploadModal() {
    setUploadFiles([]);
    setUploadStatuses({});
    setUploadLabel("");
    setIsHandwriting(false);
    setGenerateMap(true);
    setIsDragging(false);
    setShowUpload(true);
  }

  function closeUploadModal() {
    if (isUploading) return;
    setShowUpload(false);
  }

  function handleFileDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    const dropped = Array.from(e.dataTransfer.files);
    if (dropped.length) setUploadFiles((prev) => [...prev, ...dropped]);
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length) setUploadFiles((prev) => [...prev, ...files]);
    e.target.value = "";
  }

  function removeUploadFile(index: number) {
    setUploadFiles((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (uploadFiles.length === 0 || isUploading) return;

    setIsUploading(true);
    const initial: Record<string, FileStatus> = {};
    uploadFiles.forEach((f) => {
      initial[fileKey(f)] = "pending";
    });
    setUploadStatuses(initial);

    let successCount = 0;
    let snapshotCount = 0;
    const screenshotWarnings: string[] = [];

    for (const file of uploadFiles) {
      const key = fileKey(file);
      setUploadStatuses((prev) => ({ ...prev, [key]: "uploading" }));

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
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          setUploadStatuses((prev) => ({ ...prev, [key]: "error" }));
          addToast(`${file.name}: ${data.error ?? "Upload failed"}`);
        } else {
          setUploadStatuses((prev) => ({ ...prev, [key]: "done" }));
          successCount++;
          snapshotCount +=
            typeof data.imageCount === "number" ? data.imageCount : 0;
          if (typeof data.screenshotWarning === "string") {
            screenshotWarnings.push(`${file.name}: ${data.screenshotWarning}`);
          }
        }
      } catch {
        setUploadStatuses((prev) => ({ ...prev, [key]: "error" }));
        addToast(`${file.name}: Network error`);
      }
    }

    if (successCount > 0) {
      addToast(
        `Added ${successCount} file${successCount > 1 ? "s" : ""} with ${isHandwriting && hasHandwritingCompatibleFile ? "handwriting OCR and map generation" : generateMap ? "map generation" : "no map generation"}${snapshotCount > 0 ? ` and ${snapshotCount} source snapshot${snapshotCount === 1 ? "" : "s"}` : ""}`,
      );
      for (const warning of screenshotWarnings) addToast(warning);
      fetchDocuments();
      setSourceDocsExpanded(true);
      setGraphRefreshVersion((v) => v + 1);
    }

    setIsUploading(false);
  }

  // ── Chat attachments ────────────────────────────────────────────────────────

  async function handleChatFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
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
          const res = await fetch("/api/extract-text", {
            method: "POST",
            body: fd,
          });
          const data = await res.json();
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
          const res = await fetch("/api/extract-text", {
            method: "POST",
            body: fd,
          });
          const data = await res.json();
          if (data.error) throw new Error(data.error);
          results.push({ type: "text", text: data.text, name: file.name });
        }
      } catch {
        addToast(`Could not read ${file.name}`);
      }
    }

    setChatAttachments((prev) => [...prev, ...results]);
    setExtractingAttachments(false);
  }

  function removeChatAttachment(index: number) {
    setChatAttachments((prev) => prev.filter((_, i) => i !== index));
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
      ? `Delete "${doc.title ?? doc.name}" and all generated notes from this source?`
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
      addToast(isSource ? "Source PDF deleted" : "Document deleted");
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
      addToast("Forked into your private clusters");
      router.push(`/clusters/${forked.slug}`);
      router.refresh();
    } catch (err) {
      addToast(err instanceof Error ? err.message : "Failed to fork cluster");
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
      throw new Error(data.error ?? "Failed to generate notes");
    }
    return (data.notes ?? []) as GeneratedNoteResult[];
  }

  async function handleGenerateNotes() {
    if (messages.length === 0 || isGenerating) return;
    setIsGenerating(true);
    try {
      const notes = await generateGardenNotes(messages);
      const count = notes.length;
      addToast(
        count > 0
          ? `Generated ${count} garden note${count === 1 ? "" : "s"} from this conversation`
          : "No new notes could be extracted from this conversation",
      );
      if (count > 0) {
        await fetchDocuments();
        setDocsExpanded(true);
        setGraphRefreshVersion((v) => v + 1);
      }
    } catch (err) {
      addToast(err instanceof Error ? err.message : "Failed to generate notes");
    } finally {
      setIsGenerating(false);
    }
  }

  // ── Chat submit ─────────────────────────────────────────────────────────────

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
          thinking: thinkingMode,
          attachments: pendingAttachments,
        }),
      });

      if (!res.ok || !res.body) throw new Error("Bad response");

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
              | { type: "thinking"; text: string };

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
            }
          } catch {
            // malformed event — skip
          }
        }
      }
    } catch {
      assistantMsg.content = "Something went wrong. Please try again.";
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

  const sourceDocuments = documents.filter(
    (doc) => doc.type === "source-document",
  );
  const markdownDocuments = documents.filter(
    (doc) => doc.type !== "source-document",
  );
  const primarySourceDocument = sourceDocuments[0];

  const graphRefreshKey = `${graphRefreshVersion}:${documents
    .map((d) => `${d.slug}:${d.linkCount}:${d.wordCount}`)
    .join("|")}`;

  function renderMarkdownRows(items: DocInfo[]) {
    return (
      <ul className="py-1">
        {items.map((doc, index) => {
          const isSource = doc.type === "source-document";
          const isPdfSource =
            isSource &&
            doc.sourceType?.toLowerCase() === "pdf" &&
            Boolean(doc.sourcePdf);
          const documentHref = isPdfSource
            ? `/clusters/${clusterSlug}/pdf/${encodeURIComponent(doc.slug)}`
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
                  {doc.title ?? doc.name}
                </Link>
                <p className="text-[10px] text-gray-600 mt-0.5">
                  {isPdfSource
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
                    ? "Delete source PDF and generated notes"
                    : "Delete document"
                }
                aria-label={
                  isSource
                    ? "Delete source PDF and generated notes"
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

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="h-screen bg-gray-950 text-white flex flex-col overflow-hidden">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-3.5 border-b border-gray-800 shrink-0">
        <div className="flex items-center gap-3">
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

        <div className="flex items-center gap-2">
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
                  Fork cluster
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
          <button
            onClick={handleGenerateNotes}
            disabled={messages.length === 0 || isGenerating}
            title="Extract knowledge from this conversation and save as garden notes"
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-300 border border-gray-700 rounded-lg hover:border-gray-500 hover:text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isGenerating ? (
              <>
                <Spinner className="w-3.5 h-3.5" />
                Generating…
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
                Generate markdown
              </>
            )}
          </button>
        </div>
      </header>

      {/* Body */}
      <div className="flex flex-1 min-h-0">
        {/* Left sidebar: chat sessions + collapsible documents */}
        {leftSidebarOpen ? (
          <aside className="w-64 shrink-0 border-r border-gray-800 flex flex-col bg-gray-950">
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
              <button
                onClick={() => setLeftSidebarOpen(false)}
                title="Close sidebar"
                className="shrink-0 h-10 w-10 flex items-center justify-center rounded-lg border border-gray-800 text-gray-500 hover:bg-gray-900 hover:text-white hover:border-gray-700 transition-colors"
                aria-label="Close sidebar"
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
                    d="M20.25 5.25H3.75M20.25 12H3.75M20.25 18.75H3.75M8.25 8.25 4.5 12l3.75 3.75"
                  />
                </svg>
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
                        return (
                          <li key={session.id} className="relative group">
                            <button
                              onClick={() =>
                                !isStreaming && setActiveChatId(session.id)
                              }
                              className={[
                                "w-full text-left px-3 py-2 pr-9 text-sm rounded-lg transition-colors flex items-center gap-2",
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
                            ) : canDeleteSession ? (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setConfirmDeleteChatId(session.id);
                                }}
                                disabled={isStreaming}
                                className="absolute right-2 top-1/2 shrink-0 -translate-y-1/2 p-0.5 text-gray-600 opacity-0 transition-colors hover:text-red-400 disabled:hidden group-hover:opacity-100"
                                aria-label="Delete chat"
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
            <div className="border-t border-gray-800 shrink-0">
              <button
                onClick={() => setSourceDocsExpanded((v) => !v)}
                className="w-full flex items-center justify-between px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider hover:text-white transition-colors"
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
                    ? ` (${sourceDocuments.length})`
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
                <div className="max-h-44 overflow-y-auto border-t border-gray-800">
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
                  ) : (
                    renderMarkdownRows(sourceDocuments)
                  )}
                </div>
              )}
            </div>

            <div className="border-t border-gray-800 shrink-0">
              <button
                onClick={() => setDocsExpanded((v) => !v)}
                className="w-full flex items-center justify-between px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider hover:text-white transition-colors"
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
                  Markdown
                  {markdownDocuments.length > 0
                    ? ` (${markdownDocuments.length})`
                    : ""}
                </div>
                <div className="flex items-center gap-1.5">
                  <span
                    role="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      openNewNoteModal();
                    }}
                    className="p-1 rounded hover:bg-gray-800 text-gray-600 hover:text-white transition-colors"
                    aria-label="New markdown note"
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
                  ) : markdownDocuments.length === 0 ? (
                    <div className="flex flex-col items-center py-6 px-4 text-center">
                      <p className="text-xs text-gray-600 mb-2">
                        No markdown notes yet
                      </p>
                      <button
                        onClick={openUploadModal}
                        className="text-xs text-gray-500 hover:text-white underline underline-offset-2 transition-colors"
                      >
                        Upload your first
                      </button>
                    </div>
                  ) : (
                    <ul className="py-1">
                      {markdownDocuments.map((doc, index) => (
                        <li
                          key={`${doc.slug}:${doc.type}:${index}`}
                          className="group flex items-start gap-2.5 px-4 py-2 hover:bg-gray-900 transition-colors"
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
                              title={
                                doc.flagColor
                                  ? `Flagged ${doc.flagColor}`
                                  : "Flag note"
                              }
                              aria-label="Flag note"
                              aria-expanded={openFlagPaletteSlug === doc.slug}
                            >
                              <span
                                className="h-3 w-3 rounded-sm border border-gray-800"
                                style={{
                                  backgroundColor:
                                    doc.flagColor || "transparent",
                                }}
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
                              href={`/garden/${clusterSlug}?note=${encodeURIComponent(doc.slug)}`}
                              className="block text-xs text-gray-300 hover:text-white truncate transition-colors"
                            >
                              {doc.title ?? doc.name}
                            </Link>
                            <p className="text-[10px] text-gray-600 mt-0.5">
                              {markdownTypeLabel(doc)} &middot; {doc.wordCount}w
                            </p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          </aside>
        ) : (
          <aside className="w-12 shrink-0 border-r border-gray-800 flex flex-col items-center bg-gray-950 py-3">
            <button
              onClick={() => setLeftSidebarOpen(true)}
              title="Open sidebar"
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-gray-800 text-gray-500 hover:border-gray-700 hover:bg-gray-900 hover:text-white transition-colors"
              aria-label="Open sidebar"
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
                  d="M20.25 5.25H3.75M20.25 12H3.75M20.25 18.75H3.75M8.25 8.25 4.5 12l3.75 3.75"
                />
              </svg>
            </button>
            <button
              onClick={handleNewChat}
              disabled={isStreaming || loadingChats}
              title="New chat"
              className="mt-3 flex h-9 w-9 items-center justify-center rounded-lg text-gray-600 hover:bg-gray-900 hover:text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
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
            <button
              onClick={openUploadModal}
              title="Add documents"
              className="mt-2 flex h-9 w-9 items-center justify-center rounded-lg text-gray-600 hover:bg-gray-900 hover:text-white transition-colors"
              aria-label="Add documents"
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
                  d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m3.75 9.375v6m3-3H9"
                />
              </svg>
            </button>
          </aside>
        )}

        {/* Chat area */}
        <div className="flex-1 flex flex-col min-h-0">
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
            {chatAttachments.length > 0 && (
              <div className="max-w-2xl mx-auto mb-2 flex flex-wrap gap-1.5">
                {chatAttachments.map((a, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-1.5 px-2.5 py-1 bg-gray-800 border border-gray-700 rounded-lg text-xs text-gray-300 max-w-[200px]"
                  >
                    {a.type === "image" ? (
                      <svg
                        className="w-3 h-3 shrink-0 text-blue-400"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={1.5}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Zm10.5-11.25h.008v.008h-.008V8.25Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z"
                        />
                      </svg>
                    ) : (
                      <svg
                        className="w-3 h-3 shrink-0 text-gray-500"
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
                    )}
                    <span className="truncate">{a.name}</span>
                    <button
                      onClick={() => removeChatAttachment(i)}
                      className="shrink-0 text-gray-600 hover:text-white transition-colors"
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
                          d="M6 18 18 6M6 6l12 12"
                        />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Hidden file input for chat attachments */}
            <input
              ref={chatFileInputRef}
              type="file"
              accept={ACCEPTED}
              multiple
              onChange={handleChatFileInput}
              className="hidden"
            />

            <div className="max-w-2xl mx-auto flex items-end gap-2">
              {/* Prompts button */}
              <button
                onClick={() => {
                  setShowPrompts((v) => !v);
                  setPromptSearch("");
                  setPromptCategory("All");
                }}
                title="Prompt library"
                className={[
                  "shrink-0 w-9 h-9 flex items-center justify-center rounded-lg border transition-colors",
                  showPrompts
                    ? "text-amber-400 bg-amber-950/30 border-amber-800/50"
                    : "text-gray-600 hover:text-gray-300 hover:bg-gray-800 border-transparent hover:border-gray-700",
                ].join(" ")}
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
                    d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 0 1 0 3.75H5.625a1.875 1.875 0 0 1 0-3.75Z"
                  />
                </svg>
              </button>

              {/* Attachment button — attaches to THIS message only */}
              <button
                onClick={() => chatFileInputRef.current?.click()}
                disabled={isStreaming || extractingAttachments}
                title="Attach file to this message"
                className={[
                  "shrink-0 w-9 h-9 flex items-center justify-center rounded-lg border transition-colors",
                  chatAttachments.length > 0
                    ? "text-blue-400 bg-blue-950/30 border-blue-800/50"
                    : "text-gray-600 hover:text-gray-300 hover:bg-gray-800 border-transparent hover:border-gray-700",
                  "disabled:opacity-40",
                ].join(" ")}
              >
                {extractingAttachments ? (
                  <Spinner className="w-4 h-4" />
                ) : (
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
                      d="m18.375 12.739-7.693 7.693a4.5 4.5 0 0 1-6.364-6.364l10.94-10.94A3 3 0 1 1 19.5 7.372L8.552 18.32m.009-.01-.01.01m5.699-9.941-7.81 7.81a1.5 1.5 0 0 0 2.112 2.13"
                    />
                  </svg>
                )}
              </button>

              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                rows={1}
                placeholder="Ask about your documents…"
                disabled={isStreaming || loadingChats}
                className="flex-1 resize-none bg-gray-900 border border-gray-800 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-gray-700 transition-colors disabled:opacity-50 max-h-40 overflow-y-auto"
                style={{ fieldSizing: "content" } as React.CSSProperties}
              />
              <button
                onClick={handleSubmit}
                disabled={
                  isStreaming ||
                  loadingChats ||
                  (!input.trim() && chatAttachments.length === 0)
                }
                className="shrink-0 w-9 h-9 flex items-center justify-center bg-white text-gray-950 rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                aria-label="Send"
              >
                {isStreaming ? (
                  <svg
                    className="w-4 h-4 animate-spin"
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
                ) : (
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
                      d="M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5"
                    />
                  </svg>
                )}
              </button>
            </div>

            {/* Toolbar */}
            <div className="max-w-2xl mx-auto mt-2 flex items-center justify-between">
              <p className="text-xs text-gray-700">
                Enter to send · Shift+Enter for new line
              </p>
              <div className="flex items-center gap-1.5">
                {/* Usage limits */}
                <div className="relative">
                  <button
                    onClick={() => {
                      if (showUsage) { setShowUsage(false); return; }
                      setShowUsage(true);
                      setUsageLoading(true);
                      fetch('/api/usage-limits')
                        .then((r) => r.json())
                        .then((d) => setUsageData(d))
                        .catch(() => setUsageData(null))
                        .finally(() => setUsageLoading(false));
                    }}
                    title="View usage limits"
                    className={[
                      "flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs transition-colors border",
                      showUsage
                        ? "text-blue-400 border-blue-800/60 bg-blue-950/30"
                        : "text-gray-600 border-transparent hover:text-gray-300 hover:bg-gray-800",
                    ].join(" ")}
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
                    </svg>
                    Usage
                  </button>
                  {showUsage && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setShowUsage(false)} />
                      <div className="absolute bottom-full right-0 mb-1.5 z-20 w-72 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl p-4 text-xs">
                        <p className="text-gray-400 font-semibold mb-3">Usage Limits</p>
                        {usageLoading ? (
                          <p className="text-gray-500">Loading…</p>
                        ) : !usageData || !usageData.available ? (
                          <p className="text-gray-500">No data yet — send a message first.</p>
                        ) : (
                          <div className="space-y-3">
                            {(usageData.captured_at as string) && (
                              <p className="text-gray-600">Updated: {new Date(usageData.captured_at as string).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                            )}
                            {(['primary', 'secondary'] as const).map((key) => {
                              const w = usageData[key] as { used_percent: number; window_minutes?: number; resets_in_seconds?: number } | undefined;
                              if (!w) return null;
                              const used = Math.min(100, Math.max(0, w.used_percent));
                              const left = Math.max(0, 100 - used);
                              const label = key === 'primary' ? '⚡ 5-hour limit' : '📅 Weekly limit';
                              const color = used >= 90 ? 'bg-red-500' : used >= 60 ? 'bg-yellow-500' : 'bg-green-500';
                              let resetStr = '';
                              if (w.resets_in_seconds != null) {
                                const s = w.resets_in_seconds;
                                const d = Math.floor(s / 86400);
                                const h = Math.floor((s % 86400) / 3600);
                                const m = Math.floor((s % 3600) / 60);
                                resetStr = [d && `${d}d`, h && `${h}h`, m && `${m}m`].filter(Boolean).join(' ') || '<1m';
                              }
                              return (
                                <div key={key}>
                                  <div className="flex justify-between text-gray-400 mb-1">
                                    <span>{label}</span>
                                    <span>{used.toFixed(1)}% used · {left.toFixed(1)}% left</span>
                                  </div>
                                  <div className="w-full h-1.5 bg-gray-800 rounded-full overflow-hidden">
                                    <div className={`h-full rounded-full ${color}`} style={{ width: `${used}%` }} />
                                  </div>
                                  {resetStr && <p className="text-gray-600 mt-1">⏳ Resets in {resetStr}</p>}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>

                {/* Thinking toggle */}
                <button
                  onClick={() => setThinkingMode((v) => !v)}
                  title="Extended thinking — AI reasons step by step before answering"
                  className={[
                    "flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs transition-colors border",
                    thinkingMode
                      ? "text-purple-400 border-purple-800/60 bg-purple-950/30 hover:bg-purple-950/50"
                      : "text-gray-600 border-transparent hover:text-gray-300 hover:bg-gray-800",
                  ].join(" ")}
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
                      d="M12 18v-5.25m0 0a6.01 6.01 0 0 0 1.5-.189m-1.5.189a6.01 6.01 0 0 1-1.5-.189m3.75 7.478a12.06 12.06 0 0 1-4.5 0m3.75 2.383a14.406 14.406 0 0 1-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 1 0-7.517 0c.85.493 1.509 1.333 1.509 2.316V18"
                    />
                  </svg>
                  Think
                </button>

                {/* Model picker */}
                <div className="relative">
                  <button
                    onClick={() => setShowModelPicker((v) => !v)}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs text-gray-500 hover:text-gray-300 hover:bg-gray-800 transition-colors border border-transparent hover:border-gray-700"
                  >
                    <svg
                      className="w-3 h-3"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={1.5}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M8.25 3v1.5M4.5 8.25H3m18 0h-1.5M4.5 12H3m18 0h-1.5m-15 3.75H3m18 0h-1.5M8.25 19.5V21M12 3v1.5m0 15V21m3.75-18v1.5m0 15V21m-9-1.5h10.5a2.25 2.25 0 0 0 2.25-2.25V6.75a2.25 2.25 0 0 0-2.25-2.25H6.75A2.25 2.25 0 0 0 4.5 6.75v10.5a2.25 2.25 0 0 0 2.25 2.25Zm.75-12h9v9h-9v-9Z"
                      />
                    </svg>
                    {model}
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
                        d="m19.5 8.25-7.5 7.5-7.5-7.5"
                      />
                    </svg>
                  </button>

                  {showModelPicker && (
                    <>
                      <div
                        className="fixed inset-0 z-10"
                        onClick={() => setShowModelPicker(false)}
                      />
                      <div className="absolute bottom-full right-0 mb-1.5 z-20 min-w-48 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl overflow-hidden py-1">
                        {models.map((m) => (
                          <button
                            key={m}
                            onClick={() => {
                              setModel(m);
                              setShowModelPicker(false);
                            }}
                            className={[
                              "w-full text-left px-3 py-2 text-sm transition-colors flex items-center justify-between gap-3",
                              m === model
                                ? "text-white bg-gray-800"
                                : "text-gray-400 hover:text-white hover:bg-gray-800",
                            ].join(" ")}
                          >
                            {m}
                            {m === model && (
                              <svg
                                className="w-3.5 h-3.5 text-white shrink-0"
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
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        <KnowledgeGraph
          clusterSlug={clusterSlug}
          refreshKey={graphRefreshKey}
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
            className="relative w-full max-w-2xl bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl flex flex-col max-h-[80vh] overflow-hidden"
          >
            <div className="flex items-center justify-between px-4 py-3.5 border-b border-gray-800 shrink-0">
              <h2 className="text-sm font-semibold text-white">
                New markdown note
              </h2>
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
            <div className="flex flex-col gap-3 px-4 py-4 overflow-y-auto flex-1">
              <input
                type="text"
                value={newNoteTitle}
                onChange={(e) => setNewNoteTitle(e.target.value)}
                placeholder="Note title"
                autoFocus
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-gray-600 transition-colors"
              />
              <textarea
                value={newNoteContent}
                onChange={(e) => setNewNoteContent(e.target.value)}
                placeholder="Write your markdown here…"
                rows={16}
                className="w-full flex-1 resize-none bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-gray-600 transition-colors font-mono"
              />
            </div>
            <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-gray-800 shrink-0">
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
                      return (
                        <div
                          key={key}
                          className="flex items-center gap-2 px-3 py-2 bg-gray-800/50 rounded-lg"
                        >
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
                            <svg
                              className="w-3.5 h-3.5 text-red-400 shrink-0"
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
                          {!isUploading && (
                            <button
                              type="button"
                              onClick={() => removeUploadFile(i)}
                              className="p-0.5 text-gray-600 hover:text-white transition-colors shrink-0"
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
                      generating the map.
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
                      Generate knowledge map
                    </span>
                    <p className="text-[11px] text-gray-600 mt-0.5">
                      {handwritingUploadEnabled
                        ? "Required for handwritten uploads so the map is built from OCR text."
                        : "Extract topics and links for the graph - slower but richer"}
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

              {/* Actions */}
              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={closeUploadModal}
                  disabled={isUploading}
                  className="flex-1 py-2.5 text-sm text-gray-400 border border-gray-800 rounded-lg hover:border-gray-600 hover:text-white transition-colors disabled:opacity-40"
                >
                  {allDoneOrError ? "Close" : "Cancel"}
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

      <Toaster toasts={toasts} />
    </div>
  );
}
