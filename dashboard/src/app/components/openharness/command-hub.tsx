"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import type { KeyboardEvent } from "react";
import type {
  CommandHubItem,
  CommandHubItemKind,
} from "@/lib/openharness/commands.ts";
import SkillReviewPanel from "./skill-review-panel";

const LEGACY_PROMPTS_KEY = "sb_prompts_v1";
const RECENTS_KEY = "breadboard:command-hub:recents:v1";
const FAVORITES_KEY = "breadboard:command-hub:favorites:v1";
const MIGRATION_KEY = "breadboard:prompt-library:server-migrated:v1";

type CommandResponse = {
  groups: {
    skills: CommandHubItem[];
    mcp: CommandHubItem[];
    prompts: CommandHubItem[];
  };
  runtime: { healthy: boolean; error?: string };
  system: {
    filesystemMode: "restricted" | "full";
    activeDirectory: string;
    memoryHealthy: boolean;
    memoryStatus: string;
  };
};

type ManagedMcp = {
  id: number;
  slug: string;
  displayName: string;
  transport: "local" | "remote";
  enabled: boolean;
  status: { status?: string };
  toolCount: number;
};

type ManagedPrompt = {
  id: string;
  slug: string;
  title: string;
  content: string;
  category: string;
  favorite: boolean;
  isDefault: boolean;
};

type FilesystemSettings = {
  filesystemMode: "restricted" | "full";
  lastActiveDirectory: string | null;
  accessibleRoots: string[];
  note: string;
};

type McpForm = {
  transport: "remote" | "local";
  displayName: string;
  executable: string;
  args: string;
  cwd: string;
  environmentNames: string;
  url: string;
  oauth: boolean;
  headerEnvironment: string;
  timeout: string;
  approved: boolean;
};

const EMPTY_MCP_FORM: McpForm = {
  transport: "remote",
  displayName: "",
  executable: "",
  args: "",
  cwd: "",
  environmentNames: "",
  url: "",
  oauth: true,
  headerEnvironment: "",
  timeout: "10000",
  approved: false,
};

export interface CommandHubHandle {
  handleKeyDown: (event: KeyboardEvent<HTMLElement>) => boolean;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (item: CommandHubItem) => void;
  disabled?: boolean;
  compact?: boolean;
}

function storedList(key: string): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(parsed)
      ? parsed
          .filter((item): item is string => typeof item === "string")
          .slice(0, 20)
      : [];
  } catch {
    return [];
  }
}

async function migrateLegacyPrompts(): Promise<boolean> {
  if (localStorage.getItem(MIGRATION_KEY) === "complete") return false;
  const raw = localStorage.getItem(LEGACY_PROMPTS_KEY);
  if (!raw) {
    localStorage.setItem(MIGRATION_KEY, "complete");
    return false;
  }
  let prompts: unknown;
  try {
    prompts = JSON.parse(raw);
  } catch {
    return false;
  }
  if (!Array.isArray(prompts)) return false;
  const response = await fetch("/api/openharness/prompts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "import_legacy", prompts }),
  });
  if (!response.ok) return false;
  // Keep the legacy value as a recovery copy. The marker is written only after
  // the server confirms the idempotent import.
  localStorage.setItem(MIGRATION_KEY, "complete");
  return true;
}

export const CommandHub = forwardRef<CommandHubHandle, Props>(
  function CommandHub(
    { open, onOpenChange, onSelect, disabled = false, compact = false },
    ref,
  ) {
    const [data, setData] = useState<CommandResponse | null>(null);
    const [query, setQuery] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [activeIndex, setActiveIndex] = useState(0);
    const [recents, setRecents] = useState<string[]>([]);
    const [favorites, setFavorites] = useState<string[]>([]);
    const [systemMessage, setSystemMessage] = useState<string | null>(null);
    const [skillPanel, setSkillPanel] = useState(false);
    const [mcpPanel, setMcpPanel] = useState(false);
    const [managedMcp, setManagedMcp] = useState<ManagedMcp[]>([]);
    const [mcpForm, setMcpForm] = useState<McpForm>(EMPTY_MCP_FORM);
    const [mcpMessage, setMcpMessage] = useState<string | null>(null);
    const [promptPanel, setPromptPanel] = useState(false);
    const [managedPrompts, setManagedPrompts] = useState<ManagedPrompt[]>([]);
    const [editingPrompt, setEditingPrompt] = useState<ManagedPrompt | null>(
      null,
    );
    const [promptMessage, setPromptMessage] = useState<string | null>(null);
    const [filesystemPanel, setFilesystemPanel] = useState(false);
    const [filesystemSettings, setFilesystemSettings] =
      useState<FilesystemSettings | null>(null);
    const [directoryInput, setDirectoryInput] = useState("");
    const searchRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
      setRecents(storedList(RECENTS_KEY));
      setFavorites(storedList(FAVORITES_KEY));
    }, []);

    useEffect(() => {
      if (!open) return;
      let cancelled = false;
      const load = async () => {
        setLoading(true);
        setError(null);
        try {
          const migrated = await migrateLegacyPrompts();
          const response = await fetch("/api/openharness/commands", {
            cache: "no-store",
          });
          if (!response.ok)
            throw new Error(
              response.status === 401
                ? "Sign in to use commands."
                : "Could not load commands.",
            );
          const payload = (await response.json()) as CommandResponse;
          if (!cancelled) {
            setData(payload);
            if (migrated) setQuery("");
          }
        } catch (cause) {
          if (!cancelled)
            setError(
              cause instanceof Error
                ? cause.message
                : "Could not load commands.",
            );
        } finally {
          if (!cancelled) setLoading(false);
        }
      };
      void load();
      window.setTimeout(() => searchRef.current?.focus(), 0);
      return () => {
        cancelled = true;
      };
    }, [open]);

    const allItems = useMemo(
      () =>
        data
          ? [...data.groups.skills, ...data.groups.mcp, ...data.groups.prompts]
          : [],
      [data],
    );
    const filtered = useMemo(() => {
      const normalized = query.trim().toLowerCase();
      const matches = normalized
        ? allItems.filter((item) =>
            `${item.name} ${item.slug} ${item.description} ${item.source ?? ""}`
              .toLowerCase()
              .includes(normalized),
          )
        : allItems;
      const recentRank = new Map(recents.map((id, index) => [id, index]));
      const favoriteSet = new Set(favorites);
      return [...matches].sort((left, right) => {
        const favoriteDifference =
          Number(favoriteSet.has(right.id)) - Number(favoriteSet.has(left.id));
        if (favoriteDifference) return favoriteDifference;
        return (
          (recentRank.get(left.id) ?? 999) - (recentRank.get(right.id) ?? 999)
        );
      });
    }, [allItems, favorites, query, recents]);

    useEffect(() => {
      if (activeIndex >= filtered.length)
        setActiveIndex(Math.max(0, filtered.length - 1));
    }, [activeIndex, filtered.length]);

    function choose(item: CommandHubItem) {
      if (!item.enabled || !item.healthy) return;
      const next = [item.id, ...recents.filter((id) => id !== item.id)].slice(
        0,
        12,
      );
      setRecents(next);
      localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
      onSelect(item);
      setQuery("");
      setSkillPanel(false);
      setMcpPanel(false);
      setPromptPanel(false);
      setFilesystemPanel(false);
      onOpenChange(false);
    }

    function handleKeyDown(event: KeyboardEvent<HTMLElement>): boolean {
      if (!open) return false;
      if (event.key === "Escape") {
        event.preventDefault();
        onOpenChange(false);
        return true;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const direction = event.key === "ArrowDown" ? 1 : -1;
        setActiveIndex((index) =>
          filtered.length
            ? (index + direction + filtered.length) % filtered.length
            : 0,
        );
        return true;
      }
      if (event.key === "Enter" && filtered[activeIndex]) {
        event.preventDefault();
        choose(filtered[activeIndex]);
        return true;
      }
      return false;
    }

    useImperativeHandle(ref, () => ({ handleKeyDown }));

    function toggleFavorite(id: string) {
      const next = favorites.includes(id)
        ? favorites.filter((item) => item !== id)
        : [id, ...favorites].slice(0, 30);
      setFavorites(next);
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
    }

    async function loadFilesystemSettings() {
      setSkillPanel(false);
      setMcpPanel(false);
      setPromptPanel(false);
      setFilesystemPanel(true);
      setSystemMessage("Loading filesystem settings…");
      try {
        const response = await fetch("/api/openharness/settings", {
          cache: "no-store",
        });
        if (!response.ok)
          throw new Error("Could not load filesystem settings.");
        const payload = (await response.json()) as FilesystemSettings;
        setFilesystemSettings(payload);
        setDirectoryInput(
          payload.lastActiveDirectory ?? data?.system.activeDirectory ?? "",
        );
        setSystemMessage(null);
      } catch (cause) {
        setSystemMessage(
          cause instanceof Error
            ? cause.message
            : "Could not load filesystem settings.",
        );
      }
    }

    async function saveFilesystemSettings(
      update: Partial<
        Pick<FilesystemSettings, "filesystemMode" | "lastActiveDirectory">
      >,
    ) {
      setSystemMessage("Saving…");
      try {
        const response = await fetch("/api/openharness/settings", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...(update.filesystemMode
              ? { filesystemMode: update.filesystemMode }
              : {}),
            ...(update.lastActiveDirectory !== undefined
              ? { activeDirectory: update.lastActiveDirectory }
              : {}),
          }),
        });
        const payload = (await response.json().catch(() => ({}))) as
          FilesystemSettings | { error?: string; message?: string };
        if (!response.ok) {
          throw new Error(
            "error" in payload && typeof payload.error === "string"
              ? payload.error
              : "message" in payload && typeof payload.message === "string"
              ? payload.message
              : "Could not update filesystem settings.",
          );
        }
        const settings = payload as FilesystemSettings;
        setFilesystemSettings(settings);
        setDirectoryInput(settings.lastActiveDirectory ?? "");
        setData((current) =>
          current
            ? {
                ...current,
                system: {
                  ...current.system,
                  filesystemMode: settings.filesystemMode,
                  activeDirectory:
                    settings.lastActiveDirectory ??
                    current.system.activeDirectory,
                },
              }
            : current,
        );
        setSystemMessage(
          "Saved. Start a new chat session to apply this setting.",
        );
      } catch (cause) {
        setSystemMessage(
          cause instanceof Error
            ? cause.message
            : "Could not update filesystem settings.",
        );
      }
    }

    async function loadManagedMcp() {
      setSkillPanel(false);
      setPromptPanel(false);
      setFilesystemPanel(false);
      setMcpPanel(true);
      setMcpMessage("Loading connections…");
      try {
        const response = await fetch("/api/openharness/mcp", {
          cache: "no-store",
        });
        if (!response.ok) throw new Error("Could not load MCP connections.");
        const payload = (await response.json()) as {
          connections?: ManagedMcp[];
        };
        setManagedMcp(
          Array.isArray(payload.connections) ? payload.connections : [],
        );
        setMcpMessage(null);
      } catch (cause) {
        setMcpMessage(
          cause instanceof Error
            ? cause.message
            : "Could not load MCP connections.",
        );
      }
    }

    async function reloadHub() {
      const response = await fetch("/api/openharness/commands", {
        cache: "no-store",
      });
      if (response.ok) setData((await response.json()) as CommandResponse);
    }

    async function saveMcp() {
      setMcpMessage("Saving and testing connection…");
      const headerEnvironment = mcpForm.headerEnvironment
        .split(/\r?\n/)
        .flatMap((line) => {
          const separator = line.indexOf("=");
          return separator > 0
            ? [
                {
                  header: line.slice(0, separator).trim(),
                  environmentName: line.slice(separator + 1).trim(),
                },
              ]
            : [];
        });
      const body =
        mcpForm.transport === "local"
          ? {
              transport: "local",
              displayName: mcpForm.displayName,
              executable: mcpForm.executable,
              args: mcpForm.args
                .split(/\r?\n/)
                .map((value) => value.trim())
                .filter(Boolean),
              cwd: mcpForm.cwd || undefined,
              environmentNames: mcpForm.environmentNames
                .split(",")
                .map((value) => value.trim())
                .filter(Boolean),
              timeout: Number(mcpForm.timeout),
              approved: mcpForm.approved,
            }
          : {
              transport: "remote",
              displayName: mcpForm.displayName,
              url: mcpForm.url,
              oauth: mcpForm.oauth,
              headerEnvironment,
              timeout: Number(mcpForm.timeout),
            };
      try {
        const response = await fetch("/api/openharness/mcp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok)
          throw new Error(
            typeof payload.error === "string"
              ? payload.error
              : "Could not save MCP connection.",
          );
        setMcpForm(EMPTY_MCP_FORM);
        setMcpMessage("Connection saved. Runtime health was refreshed.");
        await Promise.all([loadManagedMcp(), reloadHub()]);
      } catch (cause) {
        setMcpMessage(
          cause instanceof Error
            ? cause.message
            : "Could not save MCP connection.",
        );
      }
    }

    async function manageMcp(
      connection: ManagedMcp,
      action: "test" | "authenticate" | "toggle" | "delete",
    ) {
      if (
        action === "delete" &&
        !window.confirm(
          `Remove ${connection.displayName}? External service data and durable memory will not be deleted.`,
        )
      )
        return;
      setMcpMessage(
        `${action === "delete" ? "Removing" : action === "toggle" ? "Updating" : action === "authenticate" ? "Starting authentication for" : "Testing"} ${connection.displayName}…`,
      );
      try {
        const response = await fetch(`/api/openharness/mcp/${connection.id}`, {
          method: action === "delete" ? "DELETE" : "PATCH",
          ...(action === "delete"
            ? {}
            : {
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(
                  action === "toggle"
                    ? { enabled: !connection.enabled }
                    : { action },
                ),
              }),
        });
        const payload =
          response.status === 204
            ? {}
            : await response.json().catch(() => ({}));
        if (!response.ok)
          throw new Error(
            typeof payload.error === "string"
              ? payload.error
              : `Could not ${action} the connection.`,
          );
        if (
          action === "authenticate" &&
          typeof payload.authorizationUrl === "string"
        ) {
          window.open(
            payload.authorizationUrl,
            "_blank",
            "noopener,noreferrer",
          );
        }
        await Promise.all([loadManagedMcp(), reloadHub()]);
        setMcpMessage(
          action === "delete"
            ? "Connection removed. External data was left untouched."
            : "Connection status refreshed.",
        );
      } catch (cause) {
        setMcpMessage(
          cause instanceof Error
            ? cause.message
            : `Could not ${action} the connection.`,
        );
      }
    }

    async function loadManagedPrompts() {
      setPromptPanel(true);
      setSkillPanel(false);
      setMcpPanel(false);
      setFilesystemPanel(false);
      setPromptMessage("Loading prompts…");
      try {
        const response = await fetch("/api/openharness/prompts", {
          cache: "no-store",
        });
        if (!response.ok) throw new Error("Could not load prompts.");
        const payload = (await response.json()) as {
          prompts?: ManagedPrompt[];
        };
        setManagedPrompts(
          Array.isArray(payload.prompts) ? payload.prompts : [],
        );
        setPromptMessage(null);
      } catch (cause) {
        setPromptMessage(
          cause instanceof Error ? cause.message : "Could not load prompts.",
        );
      }
    }

    async function savePrompt() {
      if (!editingPrompt) return;
      setPromptMessage("Saving prompt…");
      try {
        const isNew = editingPrompt.id === "new";
        const response = await fetch(
          isNew
            ? "/api/openharness/prompts"
            : `/api/openharness/prompts/${editingPrompt.id}`,
          {
            method: isNew ? "POST" : "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              title: editingPrompt.title,
              content: editingPrompt.content,
              category: editingPrompt.category,
              favorite: editingPrompt.favorite,
            }),
          },
        );
        const payload = await response.json().catch(() => ({}));
        if (!response.ok)
          throw new Error(
            typeof payload.error === "string"
              ? payload.error
              : "Could not save prompt.",
          );
        setEditingPrompt(null);
        await Promise.all([loadManagedPrompts(), reloadHub()]);
        setPromptMessage("Prompt saved.");
      } catch (cause) {
        setPromptMessage(
          cause instanceof Error ? cause.message : "Could not save prompt.",
        );
      }
    }

    async function removePrompt(prompt: ManagedPrompt) {
      if (
        prompt.isDefault ||
        !window.confirm(`Delete the custom prompt “${prompt.title}”?`)
      )
        return;
      setPromptMessage("Deleting prompt…");
      try {
        const response = await fetch(`/api/openharness/prompts/${prompt.id}`, {
          method: "DELETE",
        });
        if (!response.ok) throw new Error("Could not delete prompt.");
        await Promise.all([loadManagedPrompts(), reloadHub()]);
        setPromptMessage("Prompt deleted.");
      } catch (cause) {
        setPromptMessage(
          cause instanceof Error ? cause.message : "Could not delete prompt.",
        );
      }
    }

    const groupOrder: Array<{ kind: CommandHubItemKind; label: string }> = [
      { kind: "skill", label: "Skills" },
      { kind: "mcp", label: "MCP connections" },
      { kind: "prompt", label: "Prompt library" },
    ];

    return (
      <div className="relative shrink-0">
        <button
          type="button"
          onClick={() => onOpenChange(!open)}
          disabled={disabled}
          className={`flex items-center justify-center rounded-full font-mono text-lg text-[var(--ink)] transition hover:bg-[var(--paper-strong)] disabled:opacity-40 ${compact ? "h-9 w-9" : "h-11 w-11"}`}
          title="Commands"
          aria-label="Open command hub"
          aria-expanded={open}
        >
          /
        </button>
        {open ? (
          <>
            <button
              type="button"
              className="fixed inset-0 z-30 cursor-default"
              onClick={() => onOpenChange(false)}
              aria-label="Close command hub"
            />
            <div className="absolute bottom-full left-0 z-40 mb-2 flex max-h-[min(540px,70vh)] w-[min(430px,90vw)] flex-col overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--paper-raised)] shadow-[0_22px_70px_rgba(15,32,27,0.2)]">
              <div className="flex gap-2 border-b border-[var(--line)] p-3">
                <label className="sr-only" htmlFor="command-hub-search">
                  Search commands
                </label>
                <input
                  id="command-hub-search"
                  ref={searchRef}
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setActiveIndex(0);
                  }}
                  onKeyDown={handleKeyDown}
                  placeholder="Search skills, MCP, and prompts…"
                  className="min-w-0 flex-1 rounded-xl border border-[var(--line)] bg-[var(--paper-surface)] px-3 py-2 text-sm text-[var(--ink)] outline-none focus:border-[var(--line-strong)]"
                />
                <button
                  type="button"
                  onClick={() => {
                    setPromptPanel(false);
                    setFilesystemPanel(false);
                    if (mcpPanel) setMcpPanel(false);
                    else void loadManagedMcp();
                  }}
                  className="rounded-xl border border-[var(--line)] px-2.5 text-xs text-[var(--ink)] hover:bg-[var(--paper-strong)]"
                >
                  {mcpPanel ? "Commands" : "MCP"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMcpPanel(false);
                    setFilesystemPanel(false);
                    if (promptPanel) setPromptPanel(false);
                    else void loadManagedPrompts();
                  }}
                  className="rounded-xl border border-[var(--line)] px-2.5 text-xs text-[var(--ink)] hover:bg-[var(--paper-strong)]"
                >
                  {promptPanel ? "Commands" : "Prompts"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMcpPanel(false);
                    setPromptPanel(false);
                    setFilesystemPanel(false);
                    setSkillPanel((current) => !current);
                  }}
                  className="rounded-xl border border-[var(--line)] px-2.5 text-xs text-[var(--ink)] hover:bg-[var(--paper-strong)]"
                >
                  {skillPanel ? "Commands" : "Skills"}
                </button>
              </div>
              <div className="min-h-24 overflow-y-auto p-2">
                {filesystemPanel ? (
                  <div className="space-y-3 p-1 text-xs">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h3 className="font-semibold text-[var(--ink-heading)]">
                          Filesystem access
                        </h3>
                        <p className="mt-0.5 text-[10px] text-[var(--ink-muted)]">
                          Changes apply only to new chat sessions.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setFilesystemPanel(false)}
                        className="rounded border border-[var(--line)] px-2 py-1"
                      >
                        Commands
                      </button>
                    </div>
                    {filesystemSettings ? (
                      <>
                        <section className="rounded-xl border border-[var(--line)] p-3">
                          <h4 className="font-medium text-[var(--ink-heading)]">
                            Access mode
                          </h4>
                          <div className="mt-2 grid grid-cols-2 gap-2">
                            {(["restricted", "full"] as const).map((mode) => (
                              <button
                                key={mode}
                                type="button"
                                onClick={() =>
                                  void saveFilesystemSettings({
                                    filesystemMode: mode,
                                  })
                                }
                                className={`rounded-lg border px-3 py-2 text-left ${filesystemSettings.filesystemMode === mode ? "border-[var(--botanical)] bg-[var(--paper-strong)]" : "border-[var(--line)]"}`}
                              >
                                <span className="block font-medium capitalize">
                                  {mode}
                                </span>
                                <span className="mt-0.5 block text-[10px] text-[var(--ink-muted)]">
                                  {mode === "restricted"
                                    ? "Isolated session workspace"
                                    : "OS-accessible directories"}
                                </span>
                              </button>
                            ))}
                          </div>
                          <p className="mt-2 text-[10px] text-[var(--ink-muted)]">
                            {filesystemSettings.note}
                          </p>
                        </section>
                        <section className="rounded-xl border border-[var(--line)] p-3">
                          <label
                            htmlFor="openharness-active-directory"
                            className="font-medium text-[var(--ink-heading)]"
                          >
                            Active directory
                          </label>
                          <p className="mt-0.5 text-[10px] text-[var(--ink-muted)]">
                            Enter an absolute, readable folder path. The server
                            validates and canonicalizes it before saving.
                          </p>
                          <div className="mt-2 flex gap-2">
                            <input
                              id="openharness-active-directory"
                              value={directoryInput}
                              onChange={(event) =>
                                setDirectoryInput(event.target.value)
                              }
                              placeholder="C:\\path\\to\\project"
                              className="min-w-0 flex-1 rounded border border-[var(--line)] bg-[var(--paper-surface)] px-2 py-1.5 font-mono text-[11px]"
                            />
                            <button
                              type="button"
                              disabled={!directoryInput.trim()}
                              onClick={() =>
                                void saveFilesystemSettings({
                                  lastActiveDirectory: directoryInput.trim(),
                                })
                              }
                              className="rounded bg-[var(--botanical)] px-3 py-1.5 text-white disabled:opacity-40"
                            >
                              Use path
                            </button>
                          </div>
                          {filesystemSettings.accessibleRoots.length ? (
                            <div className="mt-2 flex flex-wrap items-center gap-1.5">
                              <span className="text-[10px] text-[var(--ink-muted)]">
                                Detected roots:
                              </span>
                              {filesystemSettings.accessibleRoots.map(
                                (root) => (
                                  <button
                                    key={root}
                                    type="button"
                                    onClick={() => setDirectoryInput(root)}
                                    className="rounded border border-[var(--line)] px-2 py-1 font-mono text-[10px]"
                                  >
                                    {root}
                                  </button>
                                ),
                              )}
                            </div>
                          ) : null}
                        </section>
                      </>
                    ) : (
                      <p className="rounded-xl border border-[var(--line)] p-3 text-[var(--ink-muted)]">
                        Loading filesystem settings…
                      </p>
                    )}
                  </div>
                ) : null}
                {skillPanel ? (
                  <SkillReviewPanel
                    runtimeSessionId={null}
                    appearance="embedded"
                    onClose={() => setSkillPanel(false)}
                    onApproved={reloadHub}
                  />
                ) : null}
                {mcpPanel ? (
                  <div className="space-y-3 p-1">
                    <section className="rounded-xl border border-[var(--line)] p-3">
                      <div className="flex items-center justify-between">
                        <h3 className="text-xs font-semibold text-[var(--ink-heading)]">
                          Configured MCP
                        </h3>
                        <span className="text-[10px] text-[var(--ink-muted)]">
                          {managedMcp.length}
                        </span>
                      </div>
                      {managedMcp.length ? (
                        <ul className="mt-2 space-y-2">
                          {managedMcp.map((connection) => (
                            <li
                              key={connection.id}
                              className="rounded-lg bg-[var(--paper-surface)] p-2 text-xs"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="truncate font-medium">
                                  {connection.displayName}
                                </span>
                                <span className="text-[10px] text-[var(--ink-muted)]">
                                  {connection.status?.status || "not loaded"} ·{" "}
                                  {connection.toolCount} tools
                                </span>
                              </div>
                              <div className="mt-2 flex flex-wrap gap-1.5">
                                <button
                                  type="button"
                                  onClick={() =>
                                    void manageMcp(connection, "test")
                                  }
                                  className="rounded border border-[var(--line)] px-2 py-1"
                                >
                                  Test
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    void manageMcp(connection, "toggle")
                                  }
                                  className="rounded border border-[var(--line)] px-2 py-1"
                                >
                                  {connection.enabled ? "Disable" : "Enable"}
                                </button>
                                {connection.transport === "remote" ? (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      void manageMcp(connection, "authenticate")
                                    }
                                    className="rounded border border-[var(--line)] px-2 py-1"
                                  >
                                    Authenticate
                                  </button>
                                ) : null}
                                <button
                                  type="button"
                                  onClick={() =>
                                    void manageMcp(connection, "delete")
                                  }
                                  className="rounded border border-red-300 px-2 py-1 text-red-700"
                                >
                                  Remove
                                </button>
                              </div>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mt-2 text-xs text-[var(--ink-muted)]">
                          No saved connections. GBrain remains Not configured
                          until setup succeeds.
                        </p>
                      )}
                    </section>
                    <section className="rounded-xl border border-[var(--line)] p-3 text-xs">
                      <h3 className="font-semibold text-[var(--ink-heading)]">
                        Add MCP connection
                      </h3>
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <select
                          value={mcpForm.transport}
                          onChange={(event) =>
                            setMcpForm({
                              ...mcpForm,
                              transport: event.target.value as
                                "local" | "remote",
                              approved: false,
                            })
                          }
                          className="rounded border border-[var(--line)] bg-[var(--paper-surface)] px-2 py-1.5"
                        >
                          <option value="remote">Remote</option>
                          <option value="local">Local command</option>
                        </select>
                        <input
                          value={mcpForm.displayName}
                          onChange={(event) =>
                            setMcpForm({
                              ...mcpForm,
                              displayName: event.target.value,
                            })
                          }
                          placeholder="Display name"
                          className="rounded border border-[var(--line)] bg-[var(--paper-surface)] px-2 py-1.5"
                        />
                      </div>
                      {mcpForm.transport === "remote" ? (
                        <div className="mt-2 space-y-2">
                          <input
                            value={mcpForm.url}
                            onChange={(event) =>
                              setMcpForm({
                                ...mcpForm,
                                url: event.target.value,
                              })
                            }
                            placeholder="https://server.example/mcp"
                            className="w-full rounded border border-[var(--line)] bg-[var(--paper-surface)] px-2 py-1.5"
                          />
                          <textarea
                            value={mcpForm.headerEnvironment}
                            onChange={(event) =>
                              setMcpForm({
                                ...mcpForm,
                                headerEnvironment: event.target.value,
                              })
                            }
                            placeholder={
                              "Header=ENV_NAME (one per line; no secret values)"
                            }
                            rows={2}
                            className="w-full resize-none rounded border border-[var(--line)] bg-[var(--paper-surface)] px-2 py-1.5"
                          />
                          <label className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={mcpForm.oauth}
                              onChange={(event) =>
                                setMcpForm({
                                  ...mcpForm,
                                  oauth: event.target.checked,
                                })
                              }
                            />{" "}
                            Use OAuth auto-detection
                          </label>
                        </div>
                      ) : (
                        <div className="mt-2 space-y-2">
                          <input
                            value={mcpForm.executable}
                            onChange={(event) =>
                              setMcpForm({
                                ...mcpForm,
                                executable: event.target.value,
                              })
                            }
                            placeholder="Executable"
                            className="w-full rounded border border-[var(--line)] bg-[var(--paper-surface)] px-2 py-1.5"
                          />
                          <textarea
                            value={mcpForm.args}
                            onChange={(event) =>
                              setMcpForm({
                                ...mcpForm,
                                args: event.target.value,
                              })
                            }
                            placeholder="One argument per line"
                            rows={2}
                            className="w-full resize-none rounded border border-[var(--line)] bg-[var(--paper-surface)] px-2 py-1.5"
                          />
                          <input
                            value={mcpForm.cwd}
                            onChange={(event) =>
                              setMcpForm({
                                ...mcpForm,
                                cwd: event.target.value,
                              })
                            }
                            placeholder="Working directory (optional)"
                            className="w-full rounded border border-[var(--line)] bg-[var(--paper-surface)] px-2 py-1.5"
                          />
                          <input
                            value={mcpForm.environmentNames}
                            onChange={(event) =>
                              setMcpForm({
                                ...mcpForm,
                                environmentNames: event.target.value,
                              })
                            }
                            placeholder="Required ENV_NAMEs, comma separated"
                            className="w-full rounded border border-[var(--line)] bg-[var(--paper-surface)] px-2 py-1.5"
                          />
                          <label className="flex items-start gap-2 text-amber-800">
                            <input
                              type="checkbox"
                              checked={mcpForm.approved}
                              onChange={(event) =>
                                setMcpForm({
                                  ...mcpForm,
                                  approved: event.target.checked,
                                })
                              }
                              className="mt-0.5"
                            />{" "}
                            I approve saving and executing this local command.
                          </label>
                        </div>
                      )}
                      <div className="mt-2 flex items-center gap-2">
                        <input
                          value={mcpForm.timeout}
                          onChange={(event) =>
                            setMcpForm({
                              ...mcpForm,
                              timeout: event.target.value,
                            })
                          }
                          aria-label="Timeout milliseconds"
                          className="w-24 rounded border border-[var(--line)] bg-[var(--paper-surface)] px-2 py-1.5"
                        />
                        <span className="text-[10px] text-[var(--ink-muted)]">
                          timeout ms
                        </span>
                        <button
                          type="button"
                          onClick={() => void saveMcp()}
                          className="ml-auto rounded bg-[var(--botanical)] px-3 py-1.5 text-white"
                        >
                          Save & test
                        </button>
                      </div>
                    </section>
                    {mcpMessage ? (
                      <p className="px-1 text-xs text-amber-700">
                        {mcpMessage}
                      </p>
                    ) : null}
                  </div>
                ) : null}
                {promptPanel ? (
                  <div className="space-y-3 p-1">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-semibold text-[var(--ink-heading)]">
                        Prompt library
                      </h3>
                      <button
                        type="button"
                        onClick={() =>
                          setEditingPrompt({
                            id: "new",
                            slug: "",
                            title: "",
                            content: "",
                            category: "Custom",
                            favorite: false,
                            isDefault: false,
                          })
                        }
                        className="rounded bg-[var(--botanical)] px-2.5 py-1 text-xs text-white"
                      >
                        New prompt
                      </button>
                    </div>
                    {editingPrompt ? (
                      <section className="space-y-2 rounded-xl border border-[var(--line)] p-3 text-xs">
                        <input
                          value={editingPrompt.title}
                          onChange={(event) =>
                            setEditingPrompt({
                              ...editingPrompt,
                              title: event.target.value,
                            })
                          }
                          placeholder="Prompt title"
                          className="w-full rounded border border-[var(--line)] bg-[var(--paper-surface)] px-2 py-1.5"
                        />
                        <input
                          value={editingPrompt.category}
                          onChange={(event) =>
                            setEditingPrompt({
                              ...editingPrompt,
                              category: event.target.value,
                            })
                          }
                          placeholder="Category"
                          className="w-full rounded border border-[var(--line)] bg-[var(--paper-surface)] px-2 py-1.5"
                        />
                        <textarea
                          value={editingPrompt.content}
                          onChange={(event) =>
                            setEditingPrompt({
                              ...editingPrompt,
                              content: event.target.value,
                            })
                          }
                          placeholder="Prompt template"
                          rows={6}
                          className="w-full resize-y rounded border border-[var(--line)] bg-[var(--paper-surface)] px-2 py-1.5"
                        />
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={editingPrompt.favorite}
                            onChange={(event) =>
                              setEditingPrompt({
                                ...editingPrompt,
                                favorite: event.target.checked,
                              })
                            }
                          />{" "}
                          Favorite
                        </label>
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setEditingPrompt(null)}
                            className="rounded border border-[var(--line)] px-2.5 py-1"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => void savePrompt()}
                            disabled={
                              !editingPrompt.title.trim() ||
                              !editingPrompt.content.trim()
                            }
                            className="rounded bg-[var(--botanical)] px-2.5 py-1 text-white disabled:opacity-40"
                          >
                            Save
                          </button>
                        </div>
                      </section>
                    ) : (
                      <ul className="space-y-1.5">
                        {managedPrompts.map((prompt) => (
                          <li
                            key={prompt.id}
                            className="flex items-start gap-2 rounded-xl bg-[var(--paper-surface)] p-2.5 text-xs"
                          >
                            <button
                              type="button"
                              onClick={() =>
                                choose({
                                  id: prompt.id,
                                  kind: "prompt",
                                  slug: prompt.slug,
                                  name: prompt.title,
                                  description: `${prompt.category} prompt`,
                                  enabled: true,
                                  healthy: true,
                                })
                              }
                              className="min-w-0 flex-1 text-left"
                            >
                              <span className="block truncate font-medium text-[var(--ink-heading)]">
                                {prompt.favorite ? "★ " : ""}
                                {prompt.title}
                              </span>
                              <span className="mt-0.5 block line-clamp-2 text-[10px] text-[var(--ink-muted)]">
                                {prompt.content}
                              </span>
                            </button>
                            {!prompt.isDefault ? (
                              <div className="flex shrink-0 gap-1">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setEditingPrompt({ ...prompt })
                                  }
                                  className="rounded border border-[var(--line)] px-1.5 py-1"
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void removePrompt(prompt)}
                                  className="rounded border border-red-300 px-1.5 py-1 text-red-700"
                                >
                                  Delete
                                </button>
                              </div>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    )}
                    {promptMessage ? (
                      <p className="px-1 text-xs text-amber-700">
                        {promptMessage}
                      </p>
                    ) : null}
                  </div>
                ) : null}
                {!skillPanel &&
                !mcpPanel &&
                !promptPanel &&
                !filesystemPanel &&
                loading ? (
                  <p className="px-3 py-8 text-center text-sm text-[var(--ink-muted)]">
                    Loading commands…
                  </p>
                ) : null}
                {!skillPanel &&
                !mcpPanel &&
                !promptPanel &&
                !filesystemPanel &&
                !loading &&
                error ? (
                  <p className="px-3 py-8 text-center text-sm text-red-700">
                    {error}
                  </p>
                ) : null}
                {!skillPanel &&
                !mcpPanel &&
                !promptPanel &&
                !filesystemPanel &&
                !loading &&
                !error &&
                filtered.length === 0 ? (
                  <p className="px-3 py-8 text-center text-sm text-[var(--ink-muted)]">
                    No commands match this search.
                  </p>
                ) : null}
                {!skillPanel &&
                !mcpPanel &&
                !promptPanel &&
                !filesystemPanel &&
                !loading &&
                !error
                  ? groupOrder.map((group) => {
                      const items = filtered.filter(
                        (item) => item.kind === group.kind,
                      );
                      if (!items.length) return null;
                      return (
                        <section key={group.kind} className="mb-2 last:mb-0">
                          <h3 className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                            {group.label}
                          </h3>
                          {items.map((item) => {
                            const globalIndex = filtered.indexOf(item);
                            const available =
                              item.enabled !== false && item.healthy !== false;
                            return (
                              <div
                                key={item.id}
                                className={`flex items-center rounded-xl ${globalIndex === activeIndex ? "bg-[var(--paper-strong)]" : ""}`}
                              >
                                <button
                                  type="button"
                                  onMouseEnter={() =>
                                    setActiveIndex(globalIndex)
                                  }
                                  onClick={() => choose(item)}
                                  disabled={!available}
                                  className="min-w-0 flex-1 px-3 py-2 text-left disabled:cursor-not-allowed disabled:opacity-55"
                                >
                                  <span className="flex items-center gap-2">
                                    <span className="truncate text-sm font-medium text-[var(--ink-heading)]">
                                      {item.name}
                                    </span>
                                    <code className="truncate text-[10px] text-[var(--ink-muted)]">
                                      /{item.kind}:{item.slug}
                                    </code>
                                  </span>
                                  <span className="mt-0.5 block truncate text-[11px] text-[var(--ink-muted)]">
                                    {available
                                      ? item.description
                                      : item.unavailableReason || "Unavailable"}
                                  </span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => toggleFavorite(item.id)}
                                  className="mr-2 rounded-lg p-1.5 text-[var(--ink-muted)] hover:bg-[var(--paper-surface)]"
                                  aria-label={
                                    favorites.includes(item.id)
                                      ? `Unfavorite ${item.name}`
                                      : `Favorite ${item.name}`
                                  }
                                >
                                  {favorites.includes(item.id) ? "★" : "☆"}
                                </button>
                              </div>
                            );
                          })}
                        </section>
                      );
                    })
                  : null}
              </div>
              {data ? (
                <div className="border-t border-[var(--line)] px-3 py-2 text-[10px] text-[var(--ink-muted)]">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span>
                      Runtime:{" "}
                      {data.runtime.healthy
                        ? "available"
                        : data.runtime.error || "unavailable"}
                    </span>
                    <span>Memory: {data.system.memoryStatus}</span>
                    <button
                      type="button"
                      onClick={() => void loadFilesystemSettings()}
                      className="underline underline-offset-2 hover:text-[var(--ink)]"
                    >
                      Filesystem: {data.system.filesystemMode} (configure)
                    </button>
                  </div>
                  <p
                    className="mt-1 truncate"
                    title={data.system.activeDirectory}
                  >
                    {data.system.activeDirectory}
                  </p>
                  {systemMessage ? (
                    <p className="mt-1 text-amber-700">{systemMessage}</p>
                  ) : null}
                  <p className="mt-1">
                    Select inserts a token; it does not send.
                  </p>
                </div>
              ) : null}
            </div>
          </>
        ) : null}
      </div>
    );
  },
);
