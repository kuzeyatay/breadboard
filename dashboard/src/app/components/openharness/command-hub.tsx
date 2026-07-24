"use client";

/* eslint-disable react/no-unescaped-entities -- user-facing possessives in compact JSX */

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
import type { OpenHarnessSurface } from "@/lib/openharness/config.ts";
import SkillsCatalogPanel from "./skills-catalog-panel";

const LEGACY_PROMPTS_KEY = "sb_prompts_v1";
const RECENTS_KEY = "breadboard:command-hub:recents:v1";
const FAVORITES_KEY = "breadboard:command-hub:favorites:v1";
const MIGRATION_KEY = "breadboard:prompt-library:server-migrated:v1";

type PaletteTab = "skill" | "mcp" | "prompt" | "agent";
type DetailView = "add-connection" | "manage-connections" | "new-prompt" | "manage-prompts" | null;

type CommandResponse = {
  groups: {
    skills: CommandHubItem[];
    mcp: CommandHubItem[];
    prompts: CommandHubItem[];
    agents: CommandHubItem[];
  };
  capability: {
    mode: "knowledge" | "technical_read" | "scoped_implementation";
    expiresAt: string | null;
    taskScoped: boolean;
  };
  notices?: { connections?: string | null; agents?: string | null };
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
  sessionId?: string | number | null;
  surface?: OpenHarnessSurface;
  requestedOutcome?: string;
}

function storedList(key: string): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? "[]") as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string").slice(0, 30)
      : [];
  } catch {
    return [];
  }
}

function itemIdentity(item: Pick<CommandHubItem, "kind" | "id">): string {
  return `${item.kind}:${item.id}`;
}

function storedIncludes(values: string[], item: Pick<CommandHubItem, "kind" | "id">): boolean {
  return values.includes(itemIdentity(item)) || values.includes(item.id);
}

async function migrateLegacyPrompts(): Promise<void> {
  if (localStorage.getItem(MIGRATION_KEY) === "complete") return;
  const raw = localStorage.getItem(LEGACY_PROMPTS_KEY);
  if (!raw) {
    localStorage.setItem(MIGRATION_KEY, "complete");
    return;
  }
  try {
    const prompts = JSON.parse(raw) as unknown;
    if (!Array.isArray(prompts)) return;
    const response = await fetch("/api/openharness/prompts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "import_legacy", prompts }),
    });
    if (response.ok) localStorage.setItem(MIGRATION_KEY, "complete");
  } catch {
    // The recovery copy remains in localStorage and migration retries later.
  }
}

function CapabilityIcon({ kind }: { kind: CommandHubItemKind }) {
  if (kind === "agent") {
    return (
      <svg aria-hidden className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
        <circle cx="12" cy="8" r="3.25" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M5.75 19c.7-3.1 3-5 6.25-5s5.55 1.9 6.25 5M18.4 7.1l.8.3.3.8-.3.8-.8.3-.8-.3-.3-.8.3-.8.8-.3Z" />
      </svg>
    );
  }
  if (kind === "mcp") {
    return (
      <svg aria-hidden className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
        <path strokeLinecap="round" strokeLinejoin="round" d="M8.5 12a3.5 3.5 0 0 1 3.5-3.5h3.5a3.5 3.5 0 1 1 0 7H14m1.5-3.5A3.5 3.5 0 0 1 12 15.5H8.5a3.5 3.5 0 1 1 0-7H10" />
      </svg>
    );
  }
  if (kind === "prompt") {
    return (
      <svg aria-hidden className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
        <path strokeLinecap="round" strokeLinejoin="round" d="M7 4.75h10A2.25 2.25 0 0 1 19.25 7v7A2.25 2.25 0 0 1 17 16.25h-5.5L7 19.5v-3.25A2.25 2.25 0 0 1 4.75 14V7A2.25 2.25 0 0 1 7 4.75Z" />
        <path strokeLinecap="round" d="M8.25 9h7.5M8.25 12h4.5" />
      </svg>
    );
  }
  return null;
}

function LoadingRows() {
  return (
    <div className="space-y-2 p-2" aria-label="Loading capabilities">
      {[0, 1, 2].map((item) => (
        <div key={item} className="flex animate-pulse items-center gap-3 rounded-xl px-3 py-3 motion-reduce:animate-none">
          <span className="h-9 w-9 rounded-xl bg-[var(--paper-strong)]" />
          <span className="min-w-0 flex-1 space-y-2">
            <span className="block h-3 w-2/5 rounded bg-[var(--paper-strong)]" />
            <span className="block h-2.5 w-4/5 rounded bg-[var(--paper-strong)]" />
          </span>
        </div>
      ))}
    </div>
  );
}

export const CommandHub = forwardRef<CommandHubHandle, Props>(
  function CommandHub(
    {
      open,
      onOpenChange,
      onSelect,
      disabled = false,
      compact = false,
      sessionId,
      surface = "dashboard_terminal",
      requestedOutcome = "",
    },
    ref,
  ) {
    const [data, setData] = useState<CommandResponse | null>(null);
    const [tab, setTab] = useState<PaletteTab>("skill");
    const [detail, setDetail] = useState<DetailView>(null);
    const [query, setQuery] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [activeIndex, setActiveIndex] = useState(0);
    const [agentDirectoryOpen, setAgentDirectoryOpen] = useState(false);
    const [recents, setRecents] = useState<string[]>([]);
    const [favorites, setFavorites] = useState<string[]>([]);
    const [detailMessage, setDetailMessage] = useState<string | null>(null);
    const [connectionKind, setConnectionKind] = useState<"remote" | "local">("remote");
    const [connectionName, setConnectionName] = useState("");
    const [connectionUrl, setConnectionUrl] = useState("");
    const [connectionExecutable, setConnectionExecutable] = useState("");
    const [connectionArgs, setConnectionArgs] = useState("");
    const [connectionCwd, setConnectionCwd] = useState("");
    const [connectionOauth, setConnectionOauth] = useState(true);
    const [remoteHeader, setRemoteHeader] = useState("");
    const [remoteEnvironmentName, setRemoteEnvironmentName] = useState("");
    const [localEnvironmentNames, setLocalEnvironmentNames] = useState("");
    const [localApproved, setLocalApproved] = useState(false);
    const [promptTitle, setPromptTitle] = useState("");
    const [promptCategory, setPromptCategory] = useState("Custom");
    const [promptContent, setPromptContent] = useState("");
    const [editingPromptId, setEditingPromptId] = useState<string | null>(null);
    const searchRef = useRef<HTMLInputElement>(null);
    const agentSearchRef = useRef<HTMLInputElement>(null);

    async function loadPalette() {
      setLoading(true);
      setError(null);
      try {
        await migrateLegacyPrompts();
        const parameters = new URLSearchParams({ surface });
        if (sessionId) parameters.set("sessionId", String(sessionId));
        if (requestedOutcome.trim()) parameters.set("outcome", requestedOutcome.slice(0, 4_000));
        const response = await fetch(`/api/openharness/commands?${parameters}`, { cache: "no-store" });
        if (!response.ok) throw new Error(response.status === 401 ? "Sign in to use capabilities." : "Capabilities could not be loaded.");
        setData((await response.json()) as CommandResponse);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Capabilities could not be loaded.");
      } finally {
        setLoading(false);
      }
    }

    useEffect(() => {
      setRecents(storedList(RECENTS_KEY));
      setFavorites(storedList(FAVORITES_KEY));
    }, []);

    useEffect(() => {
      if (!open) return;
      setDetail(null);
      setAgentDirectoryOpen(false);
      setQuery("");
      setActiveIndex(0);
      void loadPalette();
      window.setTimeout(() => searchRef.current?.focus(), 0);
      // Palette state intentionally refreshes each time so expired task-scoped
      // implementation skills disappear immediately.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, sessionId, surface, requestedOutcome]);

    useEffect(() => {
      if (!data) return;
      const allItems = [
        ...data.groups.skills,
        ...data.groups.mcp,
        ...data.groups.prompts,
        ...(data.groups.agents ?? []),
      ];
      const migrate = (values: string[]) => {
        const migrated = values.map((value) => {
          if (value.includes(":") && allItems.some((item) => itemIdentity(item) === value)) {
            return value;
          }
          const matches = allItems.filter((item) => item.id === value);
          return matches.length === 1 ? itemIdentity(matches[0]) : value;
        });
        return [...new Set(migrated)].slice(0, 30);
      };
      setRecents((current) => {
        const next = migrate(current);
        localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
        return next;
      });
      setFavorites((current) => {
        const next = migrate(current);
        localStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
        return next;
      });
    }, [data]);

    const tabItems = useMemo(() => {
      if (!data) return [];
      const source =
        tab === "skill"
          ? data.groups.skills
          : tab === "mcp"
            ? data.groups.mcp
            : tab === "prompt"
              ? data.groups.prompts
              : data.groups.agents ?? [];
      const normalized = query.trim().toLowerCase();
      const filtered = normalized
        ? source.filter((item) =>
            `${item.name} ${item.description} ${item.category ?? ""} ${item.source ?? ""} ${item.searchTerms ?? ""}`
              .toLowerCase()
              .includes(normalized),
          )
        : source;
      return [...filtered].sort((left, right) => {
        const favoriteDifference =
          Number(storedIncludes(favorites, right)) -
          Number(storedIncludes(favorites, left));
        if (favoriteDifference) return favoriteDifference;
        const leftRecent = recents.findIndex((value) =>
          value === itemIdentity(left) || value === left.id,
        );
        const rightRecent = recents.findIndex((value) =>
          value === itemIdentity(right) || value === right.id,
        );
        return (leftRecent < 0 ? 999 : leftRecent) - (rightRecent < 0 ? 999 : rightRecent);
      });
    }, [data, favorites, query, recents, tab]);

    useEffect(() => {
      setActiveIndex((index) => Math.min(index, Math.max(0, tabItems.length - 1)));
    }, [tabItems.length]);

    function choose(item: CommandHubItem) {
      if (!item.enabled || !item.healthy) return;
      const identity = itemIdentity(item);
      const next = [
        identity,
        ...recents.filter((value) => value !== identity && value !== item.id),
      ].slice(0, 20);
      setRecents(next);
      localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
      onSelect(item);
      setQuery("");
      onOpenChange(false);
    }

    function chooseCatalogSkill(skill: {
      upstreamId: string;
      slashCommand: string;
      command: string;
      name: string;
      description: string;
      source: string;
      approvedHash: string | null;
    }) {
      const registered = data?.groups.skills.find((item) => item.id === skill.upstreamId);
      if (registered) {
        choose(registered);
        return;
      }
      onSelect({
        id: skill.upstreamId,
        kind: "skill",
        slug: skill.slashCommand,
        token: skill.slashCommand,
        name: skill.name,
        description: skill.description,
        source: skill.source,
        installed: true,
        enabled: true,
        healthy: true,
        contentHash: skill.approvedHash ?? undefined,
        trustLabel: "Reviewed and pinned",
      });
      onOpenChange(false);
    }

    function handleKeyDown(event: KeyboardEvent<HTMLElement>): boolean {
      if (!open) return false;
      if (event.key === "Escape") {
        event.preventDefault();
        if (agentDirectoryOpen) {
          setAgentDirectoryOpen(false);
          setQuery("");
          setActiveIndex(0);
          window.setTimeout(
            () => document.getElementById("agency-agents-directory")?.focus(),
            0,
          );
        } else if (detail) {
          setDetail(null);
          window.setTimeout(() => searchRef.current?.focus(), 0);
        } else onOpenChange(false);
        return true;
      }
      if (detail || tab === "skill" || (tab === "agent" && !agentDirectoryOpen)) {
        return false;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const direction = event.key === "ArrowDown" ? 1 : -1;
        setActiveIndex((index) => tabItems.length ? (index + direction + tabItems.length) % tabItems.length : 0);
        return true;
      }
      if (event.key === "Enter" && tabItems[activeIndex]) {
        event.preventDefault();
        choose(tabItems[activeIndex]);
        return true;
      }
      return false;
    }

    useImperativeHandle(ref, () => ({ handleKeyDown }));

    function toggleFavorite(item: CommandHubItem, taskScoped = false) {
      const conditional = data?.groups.skills.some(
        (candidate) =>
          candidate.id === item.id &&
          candidate.requiredCapabilityMode === "scoped_implementation",
      );
      if (taskScoped || conditional) return;
      const identity = itemIdentity(item);
      const next = storedIncludes(favorites, item)
        ? favorites.filter((value) => value !== identity && value !== item.id)
        : [identity, ...favorites].slice(0, 30);
      setFavorites(next);
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
    }

    async function saveConnection() {
      setDetailMessage("Saving connection…");
      try {
        const body = connectionKind === "remote"
          ? { transport: "remote", displayName: connectionName, url: connectionUrl, oauth: connectionOauth, headerEnvironment: remoteHeader.trim() && remoteEnvironmentName.trim() ? [{ header: remoteHeader.trim(), environmentName: remoteEnvironmentName.trim() }] : [], timeout: 10_000 }
          : { transport: "local", displayName: connectionName, executable: connectionExecutable, args: connectionArgs.split(/\s+/).filter(Boolean), cwd: connectionCwd || undefined, environmentNames: localEnvironmentNames.split(",").map((value) => value.trim()).filter(Boolean), timeout: 10_000, approved: localApproved };
        const response = await fetch("/api/openharness/mcp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const payload = (await response.json().catch(() => ({}))) as { message?: string; error?: string; status?: { status?: string } };
        if (!response.ok) throw new Error(payload.message ?? payload.error ?? "The connection could not be saved.");
        setConnectionName("");
        setConnectionUrl("");
        setConnectionExecutable("");
        setConnectionArgs("");
        setConnectionCwd("");
        setRemoteHeader("");
        setRemoteEnvironmentName("");
        setLocalEnvironmentNames("");
        setLocalApproved(false);
        await loadPalette();
        setTab("mcp");
        setDetailMessage(
          payload.status?.status === "connected"
            ? "Connection verified. Its available tools will appear only when selected."
            : "Connection saved, but the server could not verify it. Review the settings and try again.",
        );
      } catch (cause) {
        setDetailMessage(cause instanceof Error ? cause.message : "The connection could not be saved.");
      }
    }

    async function manageConnection(
      item: CommandHubItem,
      action: "test" | "authenticate" | "toggle" | "remove",
    ) {
      const id = item.id.replace(/^mcp:/, "");
      if (!/^\d+$/.test(id)) return;
      setDetailMessage(`${action === "remove" ? "Removing" : "Checking"} connection…`);
      try {
        const response = await fetch(`/api/openharness/mcp/${id}`, {
          method: action === "remove" ? "DELETE" : "PATCH",
          headers: action === "remove" ? undefined : { "Content-Type": "application/json" },
          body:
            action === "remove"
              ? undefined
              : JSON.stringify(
                  action === "toggle"
                    ? { enabled: !item.enabled }
                    : { action },
                ),
        });
        const payload = (await response.json().catch(() => ({}))) as {
          authorizationUrl?: string;
          status?: { status?: string };
          tools?: string[];
          message?: string;
          error?: string;
        };
        if (!response.ok) {
          throw new Error(payload.message ?? payload.error ?? "The connection action failed.");
        }
        if (payload.authorizationUrl) {
          window.open(payload.authorizationUrl, "_blank", "noopener,noreferrer");
          setDetailMessage("Secure sign-in opened in a new tab. Test the connection after completing it.");
        } else if (action === "test") {
          setDetailMessage(
            payload.status?.status === "connected"
              ? `Connection verified. ${payload.tools?.length ?? 0} tool${payload.tools?.length === 1 ? "" : "s"} discovered.`
              : "The server did not verify this connection.",
          );
        } else {
          setDetailMessage(action === "remove" ? "Connection removed." : "Connection setting updated.");
        }
        await loadPalette();
        setTab("mcp");
        setDetail("manage-connections");
      } catch (cause) {
        setDetailMessage(cause instanceof Error ? cause.message : "The connection action failed.");
      }
    }

    async function savePrompt() {
      setDetailMessage("Saving prompt…");
      try {
        const response = await fetch(
          editingPromptId
            ? `/api/openharness/prompts/${encodeURIComponent(editingPromptId)}`
            : "/api/openharness/prompts",
          {
            method: editingPromptId ? "PATCH" : "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: promptTitle, category: promptCategory, content: promptContent }),
          },
        );
        const payload = (await response.json().catch(() => ({}))) as { message?: string; error?: string };
        if (!response.ok) throw new Error(payload.message ?? payload.error ?? "The prompt could not be saved.");
        setPromptTitle("");
        setPromptCategory("Custom");
        setPromptContent("");
        setEditingPromptId(null);
        await loadPalette();
        setTab("prompt");
        setDetail("manage-prompts");
        setDetailMessage("Prompt saved.");
      } catch (cause) {
        setDetailMessage(cause instanceof Error ? cause.message : "The prompt could not be saved.");
      }
    }

    function editPrompt(item: CommandHubItem) {
      setEditingPromptId(item.isDefault ? null : item.id);
      setPromptTitle(item.name);
      setPromptCategory(item.category ?? "Custom");
      setPromptContent(item.content ?? item.description);
      setDetail("new-prompt");
      setDetailMessage(
        item.isDefault
          ? "This Breadboard prompt will be duplicated as a custom prompt."
          : null,
      );
    }

    function duplicatePrompt(item: CommandHubItem) {
      setEditingPromptId(null);
      setPromptTitle(`${item.name} copy`);
      setPromptCategory(item.category ?? "Custom");
      setPromptContent(item.content ?? item.description);
      setDetail("new-prompt");
      setDetailMessage("Review the copy, then save it as a new prompt.");
    }

    async function deleteSavedPrompt(item: CommandHubItem) {
      if (item.isDefault || !item.id.startsWith("user-")) return;
      setDetailMessage("Deleting prompt…");
      try {
        const response = await fetch(
          `/api/openharness/prompts/${encodeURIComponent(item.id)}`,
          { method: "DELETE" },
        );
        if (!response.ok) throw new Error("The prompt could not be deleted.");
        await loadPalette();
        setTab("prompt");
        setDetail("manage-prompts");
        setDetailMessage("Prompt deleted.");
      } catch (cause) {
        setDetailMessage(
          cause instanceof Error ? cause.message : "The prompt could not be deleted.",
        );
      }
    }

    const tabs: Array<{ id: PaletteTab; label: string }> = [
      { id: "skill", label: "Skills" },
      { id: "mcp", label: "Connections" },
      { id: "prompt", label: "Prompts" },
      { id: "agent", label: "Agents" },
    ];

    function selectTab(nextTab: PaletteTab) {
      setTab(nextTab);
      setAgentDirectoryOpen(false);
      setQuery("");
      setActiveIndex(0);
    }

    function openAgentDirectory() {
      setAgentDirectoryOpen(true);
      setQuery("");
      setActiveIndex(0);
      window.setTimeout(() => agentSearchRef.current?.focus(), 0);
    }

    function moveTabFocus(current: PaletteTab, direction: -1 | 1) {
      const index = tabs.findIndex((item) => item.id === current);
      const next = tabs[(index + direction + tabs.length) % tabs.length];
      selectTab(next.id);
      window.setTimeout(
        () => document.getElementById(`command-hub-tab-${next.id}`)?.focus(),
        0,
      );
    }

    return (
      <div className="relative shrink-0">
        <button
          type="button"
          onClick={() => onOpenChange(!open)}
          disabled={disabled}
          className={`neu-button-icon flex items-center justify-center rounded-full font-mono text-lg text-[var(--ink)] transition hover:bg-[var(--paper-strong)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--botanical)] disabled:opacity-40 ${compact ? "h-9 w-9" : "h-11 w-11"}`}
          title="Use a capability"
          aria-label="Open capabilities"
          aria-expanded={open}
          aria-haspopup="dialog"
        >
          /
        </button>
        {open ? (
          <>
            <button type="button" className="fixed inset-0 z-30 cursor-default bg-transparent" onClick={() => onOpenChange(false)} aria-label="Close capabilities" />
            <section
              role="dialog"
              aria-modal="true"
              aria-labelledby="capability-palette-title"
              className="neu-popover fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+0.75rem)] z-40 flex max-h-[min(82dvh,680px)] flex-col overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--paper-raised)] sm:absolute sm:inset-x-auto sm:bottom-full sm:left-0 sm:mb-3 sm:h-[min(620px,72vh)] sm:w-[min(600px,calc(100vw-2rem))]"
              onKeyDown={handleKeyDown}
            >
              <header className="border-b border-[var(--line)] px-4 pb-3 pt-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 id="capability-palette-title" className="text-base font-semibold text-[var(--ink-heading)]">Use a capability</h2>
                    {data?.capability.taskScoped ? <p className="mt-0.5 text-[11px] text-[var(--ink-muted)]">Implementation capabilities shown here are task-scoped.</p> : null}
                  </div>
                  <button type="button" onClick={() => onOpenChange(false)} className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--ink-muted)] hover:bg-[var(--paper-strong)] focus-visible:outline-2 focus-visible:outline-[var(--botanical)]" aria-label="Close capabilities">×</button>
                </div>
                {tab !== "skill" && tab !== "agent" && !detail ? (
                  <div className="relative mt-3">
                    <svg aria-hidden className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ink-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="11" cy="11" r="6.5" /><path strokeLinecap="round" d="m16 16 4 4" /></svg>
                    <input ref={searchRef} value={query} onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); }} placeholder="Search connections and prompts" className="neu-control w-full rounded-xl border border-[var(--line)] bg-[var(--paper-surface)] py-2.5 pl-9 pr-3 text-sm text-[var(--ink)] outline-none focus:border-[var(--botanical)]" aria-label="Search capabilities" />
                  </div>
                ) : null}
              </header>

              {!detail ? (
                <nav className="flex items-center gap-1 border-b border-[var(--line)] px-3 pt-2" role="tablist" aria-label="Capability types">
                  {tabs.map((item) => (
                    <button
                      id={`command-hub-tab-${item.id}`}
                      key={item.id}
                      type="button"
                      role="tab"
                      aria-selected={tab === item.id}
                      tabIndex={tab === item.id ? 0 : -1}
                      onClick={() => selectTab(item.id)}
                      onKeyDown={(event) => {
                        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                          event.preventDefault();
                          moveTabFocus(item.id, event.key === "ArrowLeft" ? -1 : 1);
                        }
                      }}
                      className={`relative px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-[var(--botanical)] ${tab === item.id ? "font-medium text-[var(--ink-heading)] after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-[var(--botanical)]" : "text-[var(--ink-muted)] hover:text-[var(--ink)]"}`}
                    >
                      {item.label}
                    </button>
                  ))}
                  <span className="flex-1" />
                  {tab === "mcp" || tab === "prompt" ? <button type="button" onClick={() => { const nextDetail = tab === "mcp" ? "add-connection" : "new-prompt"; if (nextDetail === "new-prompt") { setEditingPromptId(null); setPromptTitle(""); setPromptCategory("Custom"); setPromptContent(""); } setDetail(nextDetail); setDetailMessage(null); }} className="mb-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-[var(--botanical)] hover:bg-[var(--paper-strong)] focus-visible:outline-2 focus-visible:outline-[var(--botanical)]">{tab === "mcp" ? "Add connection" : "New prompt"}</button> : null}
                </nav>
              ) : null}

              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
                {tab === "skill" && !detail ? (
                  <SkillsCatalogPanel
                    runtimeSessionId={sessionId ?? null}
                    surface={surface}
                    onUse={chooseCatalogSkill}
                    onInstalledChange={loadPalette}
                  />
                ) : loading ? <LoadingRows /> : error ? (
                  <div className="flex min-h-48 flex-col items-center justify-center px-6 text-center"><p className="text-sm text-[var(--ink)]">{error}</p><button type="button" onClick={() => void loadPalette()} className="mt-3 rounded-lg bg-[var(--botanical)] px-3 py-2 text-xs font-medium text-white">Try again</button></div>
                ) : tab === "agent" && !detail ? (
                  <div className="p-2">
                    <button
                      id="agency-agents-directory"
                      type="button"
                      onClick={openAgentDirectory}
                      aria-haspopup="dialog"
                      aria-expanded={agentDirectoryOpen}
                      className={`group flex w-full items-center gap-3 rounded-xl border px-3 py-3.5 text-left transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--botanical)] ${
                        agentDirectoryOpen
                          ? "border-[var(--line-strong)] bg-[var(--paper-surface)]"
                          : "border-transparent hover:border-[var(--line)] hover:bg-[var(--paper-surface)]"
                      }`}
                    >
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--paper-strong)] text-[var(--botanical)]">
                        <svg aria-hidden className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 7.5h6l1.5 2h9v8.75A1.75 1.75 0 0 1 19.5 20h-15a1.75 1.75 0 0 1-1.75-1.75v-9A1.75 1.75 0 0 1 4.5 7.5Z" />
                          <path strokeLinecap="round" d="M3.75 10h16.5" />
                        </svg>
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="text-sm font-medium text-[var(--ink-heading)]">Agency agents</span>
                          <span className="rounded-full bg-[var(--paper-strong)] px-2 py-0.5 text-[10px] tabular-nums text-[var(--ink-muted)]">
                            {data?.groups.agents.length ?? 0}
                          </span>
                        </span>
                        <span className="mt-1 block text-xs leading-5 text-[var(--ink-muted)]">
                          Browse specialist personas for design, engineering, marketing, strategy, and more.
                        </span>
                      </span>
                      <svg aria-hidden className="h-4 w-4 shrink-0 text-[var(--ink-muted)] transition group-hover:translate-x-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m9 5 7 7-7 7" />
                      </svg>
                    </button>
                  </div>
                ) : detail === "manage-connections" ? (
                  <div className="p-3">
                    <div className="flex items-center gap-3"><button type="button" onClick={() => setDetail(null)} className="text-xs text-[var(--botanical)]">← Back</button><h3 className="font-semibold text-[var(--ink-heading)]">Manage connections</h3><button type="button" onClick={() => { setDetail("add-connection"); setDetailMessage(null); }} className="ml-auto text-xs font-medium text-[var(--botanical)]">Add connection</button></div>
                    {detailMessage ? <p role="status" className="mt-3 text-xs text-[#8a6f00]">{detailMessage}</p> : null}
                    <ul className="mt-3 space-y-2">{data?.groups.mcp.map((item) => <li key={item.id} className="rounded-xl bg-[var(--paper-surface)] p-3"><div className="flex items-start gap-3"><div className="min-w-0 flex-1"><p className="text-sm font-medium text-[var(--ink-heading)]">{item.name}</p><p className="mt-1 text-xs text-[var(--ink-muted)]">{item.description}</p><p className="mt-2 text-[10px] text-[var(--ink-muted)]">{item.connected ? "Connected" : item.unavailableReason ?? "Not connected"}</p></div><div className="flex shrink-0 flex-wrap justify-end gap-1"><button type="button" onClick={() => void manageConnection(item, "test")} className="rounded-lg px-2 py-1 text-xs text-[var(--botanical)]">Test</button>{item.source === "Remote MCP" ? <button type="button" onClick={() => void manageConnection(item, "authenticate")} className="rounded-lg px-2 py-1 text-xs text-[var(--botanical)]">Sign in</button> : null}<button type="button" onClick={() => void manageConnection(item, "toggle")} className="rounded-lg px-2 py-1 text-xs text-[var(--botanical)]">{item.enabled ? "Disable" : "Enable"}</button><button type="button" onClick={() => void manageConnection(item, "remove")} className="rounded-lg px-2 py-1 text-xs text-[#9a4438]">Remove</button></div></div></li>)}</ul>
                  </div>
                ) : detail === "add-connection" ? (
                  <div className="p-3">
                    <div className="flex items-center gap-3"><button type="button" onClick={() => setDetail(null)} className="text-xs text-[var(--botanical)]">← Back</button><h3 className="font-semibold text-[var(--ink-heading)]">Add a connection</h3><button type="button" onClick={() => setDetail("manage-connections")} className="ml-auto text-xs text-[var(--botanical)]">Manage connections</button></div>
                    <div className="neu-segmented mt-4 grid grid-cols-2 rounded-xl bg-[var(--paper-surface)] p-1">{(["remote", "local"] as const).map((kind) => <button key={kind} type="button" aria-pressed={connectionKind === kind} onClick={() => { setConnectionKind(kind); setLocalApproved(false); }} className={`rounded-lg px-3 py-2 text-sm capitalize ${connectionKind === kind ? "bg-[var(--paper-raised)] font-medium" : "text-[var(--ink-muted)]"}`}>{kind}</button>)}</div>
                    <label className="mt-4 block text-xs font-medium">Connection name<input value={connectionName} onChange={(event) => setConnectionName(event.target.value)} className="neu-control mt-1.5 w-full rounded-xl border border-[var(--line)] bg-[var(--paper-surface)] px-3 py-2.5 text-sm outline-none focus:border-[var(--botanical)]" placeholder="Google Drive" /></label>
                    {connectionKind === "remote" ? <><label className="mt-3 block text-xs font-medium">Secure service URL<input value={connectionUrl} onChange={(event) => setConnectionUrl(event.target.value)} className="mt-1.5 w-full rounded-xl border border-[var(--line)] bg-[var(--paper-surface)] px-3 py-2.5 text-sm outline-none focus:border-[var(--botanical)]" placeholder="https://service.example/mcp" /></label><label className="mt-3 flex items-start gap-2 text-xs"><input type="checkbox" checked={connectionOauth} onChange={(event) => setConnectionOauth(event.target.checked)} className="mt-0.5" /><span>Use the service's secure sign-in flow when available.</span></label><div className="mt-3 grid grid-cols-2 gap-2"><label className="block text-xs font-medium">Optional header<input value={remoteHeader} onChange={(event) => setRemoteHeader(event.target.value)} className="mt-1.5 w-full rounded-xl border border-[var(--line)] bg-[var(--paper-surface)] px-3 py-2.5 text-sm" placeholder="Authorization" /></label><label className="block text-xs font-medium">Credential variable name<input value={remoteEnvironmentName} onChange={(event) => setRemoteEnvironmentName(event.target.value)} className="mt-1.5 w-full rounded-xl border border-[var(--line)] bg-[var(--paper-surface)] px-3 py-2.5 text-sm" placeholder="SERVICE_TOKEN" /></label></div><p className="mt-2 text-[11px] text-[var(--ink-muted)]">Breadboard reads the named variable on the server. Do not paste the secret value here.</p></> : <><div className="mt-3 rounded-xl bg-[#fff7df] p-3 text-xs text-[#7a5a00]">Local connections can start a program on this device. Review the executable and working folder carefully.</div><label className="mt-3 block text-xs font-medium">Executable<input value={connectionExecutable} onChange={(event) => setConnectionExecutable(event.target.value)} className="mt-1.5 w-full rounded-xl border border-[var(--line)] bg-[var(--paper-surface)] px-3 py-2.5 text-sm" /></label><label className="mt-3 block text-xs font-medium">Arguments<input value={connectionArgs} onChange={(event) => setConnectionArgs(event.target.value)} className="mt-1.5 w-full rounded-xl border border-[var(--line)] bg-[var(--paper-surface)] px-3 py-2.5 text-sm" /></label><label className="mt-3 block text-xs font-medium">Working folder<input value={connectionCwd} onChange={(event) => setConnectionCwd(event.target.value)} className="mt-1.5 w-full rounded-xl border border-[var(--line)] bg-[var(--paper-surface)] px-3 py-2.5 text-sm" /></label><label className="mt-3 block text-xs font-medium">Required variable names<input value={localEnvironmentNames} onChange={(event) => setLocalEnvironmentNames(event.target.value)} className="mt-1.5 w-full rounded-xl border border-[var(--line)] bg-[var(--paper-surface)] px-3 py-2.5 text-sm" placeholder="SERVICE_TOKEN, WORKSPACE_ID" /></label><p className="mt-2 text-[11px] text-[var(--ink-muted)]">Enter names only, separated by commas. Values remain on the server.</p><label className="mt-3 flex items-start gap-2 text-xs"><input type="checkbox" checked={localApproved} onChange={(event) => setLocalApproved(event.target.checked)} className="mt-0.5" /><span>I reviewed this local program and authorize Breadboard to save its configuration.</span></label></>}
                    {detailMessage ? <p role="status" className="mt-3 text-xs text-[#8a6f00]">{detailMessage}</p> : null}
                    <button type="button" disabled={!connectionName.trim() || (connectionKind === "remote" ? !connectionUrl.trim() : !connectionExecutable.trim() || !localApproved)} onClick={() => void saveConnection()} className="neu-button-accent mt-4 rounded-xl bg-[var(--botanical)] px-4 py-2.5 text-sm font-medium text-white disabled:opacity-40">Save connection</button>
                  </div>
                ) : detail === "manage-prompts" ? (
                  <div className="p-3">
                    <div className="flex items-center gap-3"><button type="button" onClick={() => setDetail(null)} className="text-xs text-[var(--botanical)]">← Back</button><h3 className="font-semibold text-[var(--ink-heading)]">Manage prompts</h3><button type="button" onClick={() => { setEditingPromptId(null); setPromptTitle(""); setPromptCategory("Custom"); setPromptContent(""); setDetail("new-prompt"); setDetailMessage(null); }} className="ml-auto text-xs font-medium text-[var(--botanical)]">New prompt</button></div>
                    {detailMessage ? <p role="status" className="mt-3 text-xs text-[#8a6f00]">{detailMessage}</p> : null}
                    <ul className="mt-3 space-y-2">{data?.groups.prompts.map((item) => <li key={item.id} className="rounded-xl bg-[var(--paper-surface)] p-3"><div className="flex items-start gap-3"><div className="min-w-0 flex-1"><p className="text-sm font-medium text-[var(--ink-heading)]">{item.name}</p><p className="mt-1 line-clamp-3 text-xs text-[var(--ink-muted)]">{item.content ?? item.description}</p><p className="mt-2 text-[10px] text-[var(--ink-muted)]">{item.category ?? "Custom"} · {item.isDefault ? "Breadboard default" : "Your prompt"}</p></div><div className="flex shrink-0 gap-1"><button type="button" onClick={() => editPrompt(item)} className="rounded-lg px-2 py-1 text-xs text-[var(--botanical)]">{item.isDefault ? "Use as copy" : "Edit"}</button><button type="button" onClick={() => duplicatePrompt(item)} className="rounded-lg px-2 py-1 text-xs text-[var(--botanical)]">Duplicate</button>{item.isDefault ? null : <button type="button" onClick={() => void deleteSavedPrompt(item)} className="rounded-lg px-2 py-1 text-xs text-[#9a4438]">Delete</button>}</div></div></li>)}</ul>
                  </div>
                ) : detail === "new-prompt" ? (
                  <div className="p-3">
                    <div className="flex items-center gap-3"><button type="button" onClick={() => setDetail("manage-prompts")} className="text-xs text-[var(--botanical)]">← Back</button><h3 className="font-semibold text-[var(--ink-heading)]">{editingPromptId ? "Edit prompt" : "Create a prompt"}</h3><button type="button" onClick={() => setDetail("manage-prompts")} className="ml-auto text-xs text-[var(--botanical)]">Manage prompts</button></div>
                    <label className="mt-4 block text-xs font-medium">Title<input autoFocus value={promptTitle} onChange={(event) => setPromptTitle(event.target.value)} className="neu-control mt-1.5 w-full rounded-xl border border-[var(--line)] bg-[var(--paper-surface)] px-3 py-2.5 text-sm outline-none focus:border-[var(--botanical)]" placeholder="Research synthesis" /></label>
                    <label className="mt-3 block text-xs font-medium">Category<input value={promptCategory} onChange={(event) => setPromptCategory(event.target.value)} className="neu-control mt-1.5 w-full rounded-xl border border-[var(--line)] bg-[var(--paper-surface)] px-3 py-2.5 text-sm" /></label>
                    <label className="mt-3 block text-xs font-medium">Prompt<textarea value={promptContent} onChange={(event) => setPromptContent(event.target.value)} rows={7} className="mt-1.5 w-full resize-y rounded-xl border border-[var(--line)] bg-[var(--paper-surface)] px-3 py-2.5 text-sm outline-none focus:border-[var(--botanical)]" placeholder="Describe the reusable instruction…" /></label>
                    <p className="mt-2 text-[11px] text-[var(--ink-muted)]">Prompts organize instructions but never grant tools, connections, or implementation capability.</p>
                    {detailMessage ? <p role="status" className="mt-3 text-xs text-[#8a6f00]">{detailMessage}</p> : null}
                    <button type="button" disabled={!promptTitle.trim() || !promptContent.trim()} onClick={() => void savePrompt()} className="neu-button-accent mt-4 rounded-xl bg-[var(--botanical)] px-4 py-2.5 text-sm font-medium text-white disabled:opacity-40">Save prompt</button>
                  </div>
                ) : tabItems.length ? (
                  <ul
                    role="listbox"
                    aria-label={tabs.find((item) => item.id === tab)?.label}
                    className="space-y-0.5"
                  >
                    {tabItems.map((item, index) => {
                      const enabled = Boolean(item.enabled && item.healthy);
                      const favorite = storedIncludes(favorites, item) || item.favorite;
                      const recent = storedIncludes(recents, item);
                      return (
                        <li key={itemIdentity(item)} role="option" aria-selected={index === activeIndex}>
                          <div className={`group flex items-center gap-2 rounded-xl ${index === activeIndex ? "bg-[var(--paper-surface)]" : "hover:bg-[var(--paper-surface)]"}`}>
                            <button
                              type="button"
                              disabled={!enabled}
                              onMouseEnter={() => setActiveIndex(index)}
                              onClick={() => choose(item)}
                              className="flex min-w-0 flex-1 items-start gap-3 px-3 py-3 text-left focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[var(--botanical)] disabled:cursor-not-allowed disabled:opacity-55"
                            >
                              <span
                                className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[var(--paper-strong)] text-[var(--botanical)]"
                                style={item.kind === "agent" && item.divisionColor ? { color: item.divisionColor } : undefined}
                              >
                                {item.kind === "agent" && item.emoji
                                  ? <span aria-hidden className="text-base">{item.emoji}</span>
                                  : <CapabilityIcon kind={item.kind} />}
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="flex items-center gap-2">
                                  <span className="truncate text-sm font-medium text-[var(--ink-heading)]">{item.name}</span>
                                  {recent ? <span className="text-[9px] uppercase tracking-wide text-[var(--ink-muted)]">Recent</span> : null}
                                </span>
                                <span className={`mt-0.5 block text-xs text-[var(--ink-muted)] ${item.kind === "agent" ? "line-clamp-2" : "truncate"}`}>{item.description}</span>
                                {item.kind === "agent" && item.vibe ? (
                                  <span className="mt-1 block truncate text-[10px] italic text-[var(--ink-muted)]">{item.vibe}</span>
                                ) : null}
                                {item.kind === "agent" && item.services?.length ? (
                                  <span className="mt-1.5 flex flex-wrap gap-1">
                                    {item.services.slice(0, 3).map((service) => (
                                      <span key={`${item.id}:${service.name}`} className="rounded-full bg-[var(--paper-strong)] px-1.5 py-0.5 text-[9px] text-[var(--ink-muted)]">
                                        {service.name}
                                      </span>
                                    ))}
                                    {item.services.length > 3 ? <span className="text-[9px] text-[var(--ink-muted)]">+{item.services.length - 3}</span> : null}
                                  </span>
                                ) : null}
                                <span className="mt-1 block truncate text-[10px] text-[var(--ink-muted)]">
                                  {item.category ?? (item.kind === "mcp" ? "Connection" : item.kind === "prompt" ? "Prompt" : item.kind === "agent" ? "Agent" : "Skill")}
                                  {" · "}
                                  {item.requiredCapabilityMode === "scoped_implementation" ? "Task-scoped" : item.trustLabel ?? item.source ?? "Available"}
                                  {!enabled && item.unavailableReason ? ` · ${item.unavailableReason}` : ""}
                                </span>
                              </span>
                            </button>
                            <button
                              type="button"
                              onClick={() => toggleFavorite(item)}
                              className="mr-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--ink-muted)] opacity-70 hover:bg-[var(--paper-strong)] hover:opacity-100 focus-visible:outline-2 focus-visible:outline-[var(--botanical)]"
                              aria-label={`${favorite ? "Remove" : "Add"} ${item.name} ${favorite ? "from" : "to"} favorites`}
                            >
                              {favorite ? "★" : "☆"}
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <div className="flex min-h-48 flex-col items-center justify-center px-6 text-center">
                    <span className="text-[var(--botanical)]"><CapabilityIcon kind={tab} /></span>
                    <p className="mt-3 text-sm font-medium text-[var(--ink-heading)]">
                      {query
                        ? "No matching capabilities"
                        : tab === "mcp"
                          ? "No connections yet"
                          : tab === "agent"
                            ? "No agents available"
                            : "No prompts yet"}
                    </p>
                    <p className="mt-1 max-w-xs text-xs text-[var(--ink-muted)]">
                      {query
                        ? "Try a different search."
                        : tab === "mcp"
                          ? "Add a service you want to work with."
                          : tab === "agent"
                            ? data?.notices?.agents ?? "Configure a local Agency Agents catalog to use personas."
                            : "Create a reusable instruction for your work."}
                    </p>
                  </div>
                )}
              </div>
              {data?.notices?.connections && tab === "mcp" && !detail ? <p className="border-t border-[var(--line)] px-4 py-2 text-[11px] text-[#8a6f00]">{data.notices.connections}</p> : null}
              {data?.notices?.agents && tab === "agent" && !detail ? <p className="border-t border-[var(--line)] px-4 py-2 text-[11px] text-[#8a6f00]">{data.notices.agents}</p> : null}
            </section>
            {agentDirectoryOpen && tab === "agent" && !detail ? (
              <aside
                role="dialog"
                aria-modal="false"
                aria-labelledby="agency-agents-directory-title"
                onKeyDown={handleKeyDown}
                className="neu-popover fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+0.75rem)] z-50 flex max-h-[min(82dvh,680px)] flex-col overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--paper-raised)] sm:absolute sm:inset-x-auto sm:bottom-full sm:left-[calc(min(600px,calc(100vw-2rem))+0.5rem)] sm:mb-3 sm:h-[min(620px,72vh)] sm:w-[min(380px,calc(100vw-2rem))]"
              >
                <header className="border-b border-[var(--line)] px-4 pb-3 pt-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 id="agency-agents-directory-title" className="text-sm font-semibold text-[var(--ink-heading)]">
                        Agency agents
                      </h3>
                      <p className="mt-1 text-[11px] leading-4 text-[var(--ink-muted)]">
                        Choose a specialist persona for this conversation.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setAgentDirectoryOpen(false);
                        setQuery("");
                        setActiveIndex(0);
                        window.setTimeout(
                          () => document.getElementById("agency-agents-directory")?.focus(),
                          0,
                        );
                      }}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--ink-muted)] hover:bg-[var(--paper-strong)] focus-visible:outline-2 focus-visible:outline-[var(--botanical)]"
                      aria-label="Close Agency agents"
                    >
                      Ã—
                    </button>
                  </div>
                  <div className="relative mt-3">
                    <svg aria-hidden className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ink-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <circle cx="11" cy="11" r="6.5" />
                      <path strokeLinecap="round" d="m16 16 4 4" />
                    </svg>
                    <input
                      ref={agentSearchRef}
                      value={query}
                      onChange={(event) => {
                        setQuery(event.target.value);
                        setActiveIndex(0);
                      }}
                      placeholder="Search Agency agents"
                      className="neu-control w-full rounded-xl border border-[var(--line)] bg-[var(--paper-surface)] py-2.5 pl-9 pr-3 text-sm text-[var(--ink)] outline-none focus:border-[var(--botanical)]"
                      aria-label="Search Agency agents"
                    />
                  </div>
                </header>
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
                  {tabItems.length ? (
                    <ul role="listbox" aria-label="Agency agents" className="space-y-0.5">
                      {tabItems.map((item, index) => {
                        const enabled = Boolean(item.enabled && item.healthy);
                        const favorite = storedIncludes(favorites, item) || item.favorite;
                        const recent = storedIncludes(recents, item);
                        return (
                          <li key={itemIdentity(item)} role="option" aria-selected={index === activeIndex}>
                            <div className={`group flex items-center gap-1 rounded-xl ${index === activeIndex ? "bg-[var(--paper-surface)]" : "hover:bg-[var(--paper-surface)]"}`}>
                              <button
                                type="button"
                                disabled={!enabled}
                                onMouseEnter={() => setActiveIndex(index)}
                                onClick={() => choose(item)}
                                className="flex min-w-0 flex-1 items-start gap-3 px-3 py-3 text-left focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[var(--botanical)] disabled:cursor-not-allowed disabled:opacity-55"
                              >
                                <span
                                  className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--paper-strong)] text-[var(--botanical)]"
                                  style={item.divisionColor ? { color: item.divisionColor } : undefined}
                                >
                                  {item.emoji ? <span aria-hidden className="text-base">{item.emoji}</span> : <CapabilityIcon kind="agent" />}
                                </span>
                                <span className="min-w-0 flex-1">
                                  <span className="flex items-center gap-2">
                                    <span className="truncate text-sm font-medium text-[var(--ink-heading)]">{item.name}</span>
                                    {recent ? <span className="text-[9px] uppercase tracking-wide text-[var(--ink-muted)]">Recent</span> : null}
                                  </span>
                                  <span className="mt-0.5 line-clamp-2 block text-xs leading-4 text-[var(--ink-muted)]">{item.description}</span>
                                  <span className="mt-1 flex items-center gap-1.5 text-[10px] text-[var(--ink-muted)]">
                                    {item.divisionIcon ? <span aria-hidden>{item.divisionIcon}</span> : null}
                                    <span className="truncate">{item.divisionLabel ?? item.category ?? "Agency agent"}</span>
                                  </span>
                                </span>
                              </button>
                              <button
                                type="button"
                                onClick={() => toggleFavorite(item)}
                                className="mr-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--ink-muted)] opacity-70 hover:bg-[var(--paper-strong)] hover:opacity-100 focus-visible:outline-2 focus-visible:outline-[var(--botanical)]"
                                aria-label={`${favorite ? "Remove" : "Add"} ${item.name} ${favorite ? "from" : "to"} favorites`}
                              >
                                {favorite ? "â˜…" : "â˜†"}
                              </button>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <div className="flex min-h-48 flex-col items-center justify-center px-5 text-center">
                      <span className="text-[var(--botanical)]"><CapabilityIcon kind="agent" /></span>
                      <p className="mt-3 text-sm font-medium text-[var(--ink-heading)]">
                        {query ? "No matching agents" : "No Agency agents available"}
                      </p>
                      <p className="mt-1 max-w-xs text-xs leading-5 text-[var(--ink-muted)]">
                        {query ? "Try a different search." : data?.notices?.agents ?? "Configure the local Agency Agents catalog to browse personas."}
                      </p>
                    </div>
                  )}
                </div>
                <p className="border-t border-[var(--line)] px-4 py-2.5 text-[10px] leading-4 text-[var(--ink-muted)]">
                  Selecting an agent applies its persona to this conversation. It does not grant extra tools or permissions.
                </p>
              </aside>
            ) : null}
          </>
        ) : null}
      </div>
    );
  },
);
