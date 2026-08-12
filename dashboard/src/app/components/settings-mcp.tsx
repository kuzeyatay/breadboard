"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { invalidateCommandResponseCache } from "@/lib/hermes/command-client-cache";
import {
  fetchCachedSettings,
  invalidateSettingsCache,
} from "@/lib/settings-client-cache";

const MCP_SETTINGS_URL = "/api/hermes/mcp";

type McpConnection = {
  id: number;
  slug: string;
  displayName: string;
  transport: "remote" | "local";
  enabled: boolean;
  status?: { status?: string; error?: string };
  toolCount?: number;
};

type McpPayload = {
  connections?: McpConnection[];
  message?: string;
  error?: string;
};

export default function SettingsMcp() {
  const [connections, setConnections] = useState<McpConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [kind, setKind] = useState<"remote" | "local">("remote");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [oauth, setOauth] = useState(true);
  const [remoteHeader, setRemoteHeader] = useState("");
  const [remoteEnvironmentName, setRemoteEnvironmentName] = useState("");
  const [executable, setExecutable] = useState("");
  const [args, setArgs] = useState("");
  const [cwd, setCwd] = useState("");
  const [environmentNames, setEnvironmentNames] = useState("");
  const [localApproved, setLocalApproved] = useState(false);

  const load = useCallback(async (force = false) => {
    setLoading(true);
    try {
      const response = await fetchCachedSettings(MCP_SETTINGS_URL, { force });
      const payload = (await response.json().catch(() => ({}))) as McpPayload;
      if (!response.ok) {
        throw new Error(payload.message ?? payload.error ?? "MCP servers could not be loaded.");
      }
      setConnections(Array.isArray(payload.connections) ? payload.connections : []);
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "MCP servers could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const visibleConnections = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return connections;
    return connections.filter((connection) =>
      `${connection.displayName} ${connection.slug} ${connection.transport}`
        .toLowerCase()
        .includes(normalized),
    );
  }, [connections, query]);

  function clearForm() {
    setName("");
    setUrl("");
    setOauth(true);
    setRemoteHeader("");
    setRemoteEnvironmentName("");
    setExecutable("");
    setArgs("");
    setCwd("");
    setEnvironmentNames("");
    setLocalApproved(false);
  }

  async function refreshAfterMutation(message: string) {
    invalidateSettingsCache(MCP_SETTINGS_URL);
    invalidateCommandResponseCache();
    await load(true);
    setNotice(message);
  }

  async function saveConnection() {
    setBusy("save");
    setNotice("Saving MCP server…");
    try {
      const body = kind === "remote"
        ? {
            transport: "remote",
            displayName: name,
            url,
            oauth,
            headerEnvironment:
              remoteHeader.trim() && remoteEnvironmentName.trim()
                ? [{
                    header: remoteHeader.trim(),
                    environmentName: remoteEnvironmentName.trim(),
                  }]
                : [],
            timeout: 10_000,
          }
        : {
            transport: "local",
            displayName: name,
            executable,
            args: args.split(/\s+/).filter(Boolean),
            cwd: cwd || undefined,
            environmentNames: environmentNames
              .split(",")
              .map((value) => value.trim())
              .filter(Boolean),
            timeout: 10_000,
            approved: localApproved,
          };
      const response = await fetch(MCP_SETTINGS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        status?: { status?: string };
        message?: string;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.message ?? payload.error ?? "The MCP server could not be saved.");
      }
      clearForm();
      setAdding(false);
      await refreshAfterMutation(
        payload.status?.status === "connected"
          ? "MCP server saved and verified. Its commands are ready in the slash menu."
          : "MCP server saved. Test it after its service is available.",
      );
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "The MCP server could not be saved.");
    } finally {
      setBusy(null);
    }
  }

  async function manageConnection(
    connection: McpConnection,
    action: "test" | "authenticate" | "toggle" | "remove",
  ) {
    if (
      action === "remove" &&
      !window.confirm(`Remove ${connection.displayName} from Breadboard?`)
    ) return;
    setBusy(`${connection.id}:${action}`);
    setNotice(`${action === "remove" ? "Removing" : "Checking"} MCP server…`);
    try {
      const response = await fetch(`${MCP_SETTINGS_URL}/${connection.id}`, {
        method: action === "remove" ? "DELETE" : "PATCH",
        headers: action === "remove" ? undefined : { "Content-Type": "application/json" },
        body: action === "remove"
          ? undefined
          : JSON.stringify(
              action === "toggle"
                ? { enabled: !connection.enabled }
                : { action },
            ),
      });
      const payload = response.status === 204
        ? {}
        : await response.json().catch(() => ({})) as {
            authorizationUrl?: string;
            status?: { status?: string };
            tools?: string[];
            message?: string;
            error?: string;
          };
      if (!response.ok) {
        throw new Error(payload.message ?? payload.error ?? "The MCP action failed.");
      }
      if (payload.authorizationUrl) {
        window.open(payload.authorizationUrl, "_blank", "noopener,noreferrer");
        setNotice("Secure sign-in opened. Test the MCP server after completing it.");
      } else {
        await refreshAfterMutation(
          action === "test"
            ? payload.status?.status === "connected"
              ? `Connection verified. ${payload.tools?.length ?? 0} tool${payload.tools?.length === 1 ? "" : "s"} discovered.`
              : "The MCP server did not verify successfully."
            : action === "remove"
              ? "MCP server removed."
              : "MCP server setting updated.",
        );
      }
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "The MCP action failed.");
    } finally {
      setBusy(null);
    }
  }

  if (adding) {
    const canSave = Boolean(
      name.trim() &&
      (kind === "remote" ? url.trim() : executable.trim() && localApproved),
    );
    return (
      <div>
        <div className="flex items-center justify-between gap-3">
          <button type="button" onClick={() => setAdding(false)} className="text-xs font-medium text-[var(--botanical)]">← MCP servers</button>
          <span className="text-xs text-[var(--ink-muted)]">Credentials stay outside chat.</span>
        </div>
        <div className="neu-segmented mt-4 grid grid-cols-2 rounded-xl p-1">
          {(["remote", "local"] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={kind === option}
              onClick={() => {
                setKind(option);
                setLocalApproved(false);
              }}
              className={`rounded-lg px-3 py-2 text-sm capitalize ${kind === option ? "bg-[var(--paper-raised)] font-medium text-[var(--ink-heading)]" : "text-[var(--ink-muted)]"}`}
            >
              {option}
            </button>
          ))}
        </div>
        <label className="mt-4 block text-xs font-medium text-[var(--ink)]">Server name<input value={name} onChange={(event) => setName(event.target.value)} className="neu-control mt-1.5 w-full rounded-xl border border-[var(--line)] bg-[var(--paper-surface)] px-3 py-2.5 text-sm" placeholder="Local tools" /></label>
        {kind === "remote" ? (
          <>
            <label className="mt-3 block text-xs font-medium text-[var(--ink)]">Secure service URL<input value={url} onChange={(event) => setUrl(event.target.value)} className="neu-control mt-1.5 w-full rounded-xl border border-[var(--line)] bg-[var(--paper-surface)] px-3 py-2.5 text-sm" placeholder="https://service.example/mcp" /></label>
            <label className="mt-3 flex items-start gap-2 text-xs text-[var(--ink)]"><input type="checkbox" checked={oauth} onChange={(event) => setOauth(event.target.checked)} className="mt-0.5" /><span>Use the service&apos;s secure sign-in flow when available.</span></label>
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <label className="text-xs font-medium text-[var(--ink)]">Optional header<input value={remoteHeader} onChange={(event) => setRemoteHeader(event.target.value)} className="neu-control mt-1.5 w-full rounded-xl border border-[var(--line)] bg-[var(--paper-surface)] px-3 py-2.5 text-sm" placeholder="Authorization" /></label>
              <label className="text-xs font-medium text-[var(--ink)]">Credential variable name<input value={remoteEnvironmentName} onChange={(event) => setRemoteEnvironmentName(event.target.value)} className="neu-control mt-1.5 w-full rounded-xl border border-[var(--line)] bg-[var(--paper-surface)] px-3 py-2.5 text-sm" placeholder="SERVICE_TOKEN" /></label>
            </div>
            <p className="mt-2 text-[11px] text-[var(--ink-muted)]">Enter the variable name only. Never paste its secret value here.</p>
          </>
        ) : (
          <>
            <div className="mt-3 rounded-xl border border-[var(--line)] bg-[var(--paper-surface)] p-3 text-xs text-[var(--ink-muted)]">Local MCP servers can start a program on this device. Review the executable and working folder carefully.</div>
            <label className="mt-3 block text-xs font-medium text-[var(--ink)]">Executable<input value={executable} onChange={(event) => setExecutable(event.target.value)} className="neu-control mt-1.5 w-full rounded-xl border border-[var(--line)] bg-[var(--paper-surface)] px-3 py-2.5 text-sm" /></label>
            <label className="mt-3 block text-xs font-medium text-[var(--ink)]">Arguments<input value={args} onChange={(event) => setArgs(event.target.value)} className="neu-control mt-1.5 w-full rounded-xl border border-[var(--line)] bg-[var(--paper-surface)] px-3 py-2.5 text-sm" /></label>
            <label className="mt-3 block text-xs font-medium text-[var(--ink)]">Working folder<input value={cwd} onChange={(event) => setCwd(event.target.value)} className="neu-control mt-1.5 w-full rounded-xl border border-[var(--line)] bg-[var(--paper-surface)] px-3 py-2.5 text-sm" /></label>
            <label className="mt-3 block text-xs font-medium text-[var(--ink)]">Required variable names<input value={environmentNames} onChange={(event) => setEnvironmentNames(event.target.value)} className="neu-control mt-1.5 w-full rounded-xl border border-[var(--line)] bg-[var(--paper-surface)] px-3 py-2.5 text-sm" placeholder="SERVICE_TOKEN, WORKSPACE_ID" /></label>
            <label className="mt-3 flex items-start gap-2 text-xs text-[var(--ink)]"><input type="checkbox" checked={localApproved} onChange={(event) => setLocalApproved(event.target.checked)} className="mt-0.5" /><span>I reviewed this local program and authorize Breadboard to save it.</span></label>
          </>
        )}
        {notice ? <p role="status" className="mt-3 text-xs text-[var(--botanical)]">{notice}</p> : null}
        <button type="button" disabled={!canSave || busy === "save"} onClick={() => void saveConnection()} className="neu-button-accent mt-4 rounded-xl bg-[var(--botanical)] px-4 py-2.5 text-sm font-medium text-white disabled:opacity-40">{busy === "save" ? "Saving…" : "Save MCP server"}</button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <p className="max-w-lg text-xs leading-5 text-[var(--ink-muted)]">MCP servers connect approved tools to Breadboard. Once a server is enabled and healthy, its command appears in the direct slash menu.</p>
        <button type="button" onClick={() => { setAdding(true); setNotice(null); }} className="neu-button shrink-0 rounded-xl px-3 py-2 text-xs font-medium text-[var(--botanical)]">Add MCP</button>
      </div>
      <div className="relative">
        <svg aria-hidden className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ink-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="11" cy="11" r="6.5" /><path strokeLinecap="round" d="m16 16 4 4" /></svg>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search MCP servers" aria-label="Search MCP servers" className="neu-control w-full rounded-xl border border-[var(--line)] bg-[var(--paper-surface)] py-2.5 pl-9 pr-3 text-sm" />
      </div>
      {notice ? <p role="status" className="px-1 text-xs text-[var(--botanical)]">{notice}</p> : null}
      {loading && !connections.length ? (
        <div className="space-y-2" aria-label="Loading MCP servers">{[0, 1].map((row) => <div key={row} className="h-20 animate-pulse rounded-xl bg-[var(--paper-strong)] motion-reduce:animate-none" />)}</div>
      ) : visibleConnections.length ? (
        <ul className="space-y-2" aria-label="Configured MCP servers">
          {visibleConnections.map((connection) => {
            const status = connection.status?.status ?? "not loaded";
            const connected = status === "connected";
            return (
              <li key={connection.id} className="neu-card rounded-xl border border-[var(--line)] bg-[var(--paper-surface)] p-3">
                <div className="flex flex-wrap items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-[var(--ink-heading)]">{connection.displayName}</p>
                    <p className="mt-1 text-xs text-[var(--ink-muted)]">{connection.transport === "remote" ? "Remote MCP" : "Local MCP"} · {connected ? `Connected · ${connection.toolCount ?? 0} tools` : status.replaceAll("_", " ")}</p>
                  </div>
                  <div className="flex flex-wrap justify-end gap-1">
                    <button type="button" disabled={Boolean(busy)} onClick={() => void manageConnection(connection, "test")} className="rounded-lg px-2 py-1 text-xs text-[var(--botanical)] disabled:opacity-40">Test</button>
                    {connection.transport === "remote" ? <button type="button" disabled={Boolean(busy)} onClick={() => void manageConnection(connection, "authenticate")} className="rounded-lg px-2 py-1 text-xs text-[var(--botanical)] disabled:opacity-40">Sign in</button> : null}
                    <button type="button" disabled={Boolean(busy)} onClick={() => void manageConnection(connection, "toggle")} className="rounded-lg px-2 py-1 text-xs text-[var(--botanical)] disabled:opacity-40">{connection.enabled ? "Disable" : "Enable"}</button>
                    <button type="button" disabled={Boolean(busy)} onClick={() => void manageConnection(connection, "remove")} className="rounded-lg px-2 py-1 text-xs text-[#9a4438] disabled:opacity-40">Remove</button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="rounded-xl border border-dashed border-[var(--line)] px-4 py-8 text-center">
          <p className="text-sm font-medium text-[var(--ink-heading)]">{query ? "No MCP servers match" : "No MCP servers yet"}</p>
          <p className="mt-1 text-xs text-[var(--ink-muted)]">{query ? "Try a different search." : "Add a remote service or an approved local tool server."}</p>
        </div>
      )}
    </div>
  );
}
