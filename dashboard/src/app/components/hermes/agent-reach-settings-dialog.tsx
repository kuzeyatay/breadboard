"use client";

// Agent Reach settings. Mirrors the Socials Manager settings dialog: one button beside
// the agent in the Agents tab, one panel that shows what works, installs what can
// be installed, takes the credentials that only the user can supply, and holds
// the defaults a run starts from.

import { useCallback, useEffect, useMemo, useState } from "react";
import AgentRunDefaults from "@/app/components/agents/agent-run-defaults";

interface Channel {
  channel: string;
  status: "ok" | "warn" | "off" | "error";
  tier: number;
  backends?: string[];
  activeBackend: string | null;
  message: string;
}

interface InstallTarget {
  id: string;
  label: string;
  unlocks: string;
  channels: string[];
  available: boolean;
  manual?: string;
}

interface CredentialField {
  key: string;
  label: string;
  channels: string[];
  hint: string;
  source?: string;
}

interface SetupResponse {
  ok: boolean;
  available?: boolean;
  cloned?: boolean;
  reason?: string | null;
  channels?: Channel[];
  installs?: InstallTarget[];
  credentials?: CredentialField[];
  browsers?: string[];
  platforms?: string[];
  error?: string;
}

// Doctor speaks Chinese; the channel key is the stable identifier, so the panel
// labels them in English rather than surfacing the localized display name.
const CHANNEL_LABELS: Record<string, string> = {
  web: "Any web page",
  rss: "RSS / Atom feeds",
  v2ex: "V2EX",
  youtube: "YouTube",
  bilibili: "Bilibili",
  github: "GitHub",
  twitter: "Twitter / X",
  reddit: "Reddit",
  exa_search: "Web search (Exa)",
  xiaohongshu: "XiaoHongShu",
  facebook: "Facebook",
  instagram: "Instagram",
  linkedin: "LinkedIn",
  xueqiu: "Xueqiu",
  xiaoyuzhou: "Xiaoyuzhou podcasts",
};

interface ChannelGuide {
  description: string;
  capabilities: string;
  setup: string;
  links?: Array<{ label: string; href: string }>;
}

const OPENCLI_EXTENSION_URL =
  "https://chromewebstore.google.com/detail/opencli/ildkmabpimmkaediidaifkhjpohdnifk";

/** Friendly, stable copy; Doctor's raw diagnostic remains available below it. */
const CHANNEL_GUIDES: Record<string, ChannelGuide> = {
  web: {
    description: "Read a public URL as clean, distraction-free text.",
    capabilities: "Articles, documentation, blogs, and public pages",
    setup: "No account, key, or installation is required.",
  },
  rss: {
    description: "Follow sites that publish RSS or Atom feeds.",
    capabilities: "Feed discovery, recent entries, titles, links, and summaries",
    setup: "No account or key is required.",
  },
  v2ex: {
    description: "Explore the V2EX technology community through its public API.",
    capabilities: "Hot topics, nodes, replies, and public user profiles",
    setup: "No account or key is required.",
  },
  youtube: {
    description: "Search videos and read metadata or available subtitles.",
    capabilities: "Video search, metadata, subtitles, and supported video sites",
    setup: "Install yt-dlp. Cookies are optional and only needed for restricted videos.",
    links: [{ label: "Open YouTube", href: "https://www.youtube.com" }],
  },
  bilibili: {
    description: "Search Bilibili and inspect video details without signing in.",
    capabilities: "Search, rankings, video details, audio, and optional subtitles",
    setup: "Install bili-cli for full access; OpenCLI can add subtitle support.",
    links: [{ label: "Open Bilibili", href: "https://www.bilibili.com" }],
  },
  github: {
    description: "Research repositories and activity with GitHub's official CLI.",
    capabilities: "Repositories, code, issues, pull requests, and releases",
    setup: "Install GitHub CLI. Public content works immediately; a token adds signed-in access.",
    links: [{ label: "Create a GitHub token", href: "https://github.com/settings/tokens" }],
  },
  twitter: {
    description: "Search and read posts, timelines, threads, and articles on X.",
    capabilities: "Search, posts, profiles, timelines, threads, and articles",
    setup: "Install twitter-cli and import cookies, or connect OpenCLI to a signed-in browser.",
    links: [
      { label: "Install OpenCLI extension", href: OPENCLI_EXTENSION_URL },
      { label: "Open X and sign in", href: "https://x.com" },
    ],
  },
  reddit: {
    description: "Search Reddit and read complete discussions with comments.",
    capabilities: "Search, posts, comments, communities, and user activity",
    setup: "Reddit requires a logged-in session. OpenCLI is the easiest desktop route.",
    links: [
      { label: "Install OpenCLI extension", href: OPENCLI_EXTENSION_URL },
      { label: "Open Reddit and sign in", href: "https://www.reddit.com" },
    ],
  },
  facebook: {
    description: "Read Facebook search results, profiles, feeds, and group lists.",
    capabilities: "Search, profiles, feed items, pages, and group lists",
    setup: "Install OpenCLI, add its browser extension, and sign in to Facebook in that browser.",
    links: [
      { label: "Install OpenCLI extension", href: OPENCLI_EXTENSION_URL },
      { label: "Open Facebook and sign in", href: "https://www.facebook.com" },
    ],
  },
  instagram: {
    description: "Research public Instagram users and recent posts.",
    capabilities: "User search, profiles, recent posts, and Explore",
    setup: "Install OpenCLI, add its browser extension, and sign in to Instagram in that browser.",
    links: [
      { label: "Install OpenCLI extension", href: OPENCLI_EXTENSION_URL },
      { label: "Open Instagram and sign in", href: "https://www.instagram.com" },
    ],
  },
  xiaohongshu: {
    description: "Search and read XiaoHongShu notes and their comments.",
    capabilities: "Search, notes, authors, engagement, and comments",
    setup: "Use OpenCLI with a signed-in browser, or import a dedicated cookie export.",
    links: [
      { label: "Install OpenCLI extension", href: OPENCLI_EXTENSION_URL },
      { label: "Open XiaoHongShu and sign in", href: "https://www.xiaohongshu.com" },
    ],
  },
  linkedin: {
    description: "Read public LinkedIn pages, with an optional MCP for richer research.",
    capabilities: "Public pages; with MCP: profiles, companies, and job search",
    setup: "Public URLs work through the web reader. Full access needs linkedin-scraper-mcp.",
    links: [
      {
        label: "LinkedIn MCP setup guide",
        href: "https://github.com/stickerdaniel/linkedin-mcp-server",
      },
    ],
  },
  xueqiu: {
    description: "Research Chinese and international markets through Xueqiu.",
    capabilities: "Quotes, company search, trending posts, and popular stocks",
    setup: "Import a cookie from a browser where you are already signed in to Xueqiu.",
    links: [{ label: "Open Xueqiu and sign in", href: "https://xueqiu.com" }],
  },
  xiaoyuzhou: {
    description: "Turn Xiaoyuzhou podcast episodes into searchable transcripts.",
    capabilities: "Audio download, conversion, chunking, and Whisper transcription",
    setup: "Install ffmpeg and add a free Groq API key for transcription.",
    links: [{ label: "Create a free Groq key", href: "https://console.groq.com/keys" }],
  },
  exa_search: {
    description: "Search the open web by meaning rather than exact keywords.",
    capabilities: "Semantic web search, discovery, and domain-filtered research",
    setup: "Install the Exa MCP connection. No API key is required.",
  },
};

function guideFor(channel: string): ChannelGuide {
  return (
    CHANNEL_GUIDES[channel] ?? {
      description: "Read and search this platform through Agent Reach.",
      capabilities: "Platform-specific search and reading",
      setup: "Open the setup details to see what this channel needs.",
    }
  );
}

function statusLabel(channel: Channel): string {
  if (channel.status === "ok") return "Working";
  if (channel.status === "warn") return channel.activeBackend ? "Needs attention" : "Setup needed";
  if (channel.status === "error") return "Check failed";
  return "Not installed";
}

function label(channel: string): string {
  return CHANNEL_LABELS[channel] ?? channel;
}

function SettingsIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg aria-hidden className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.6 4.1c.1-.6.6-1.1 1.3-1.1h2.2c.7 0 1.2.5 1.3 1.1l.2 1.1c.1.4.3.7.7.9l.8.5c.3.2.8.2 1.1.1l1.1-.4c.6-.2 1.3 0 1.6.6l1.1 2c.3.6.2 1.3-.3 1.7l-.9.7c-.3.3-.5.7-.4 1.1v.9c0 .4.1.8.4 1.1l.9.7c.5.4.6 1.1.3 1.7l-1.1 2c-.3.6-1 .8-1.6.6l-1.1-.4c-.4-.1-.8-.1-1.1.1l-.8.5c-.3.2-.6.5-.7.9l-.2 1.1c-.1.6-.6 1.1-1.3 1.1h-2.2c-.7 0-1.2-.5-1.3-1.1l-.2-1.1c-.1-.4-.3-.7-.7-.9l-.8-.5c-.3-.2-.8-.2-1.1-.1l-1.1.4c-.6.2-1.3 0-1.6-.6l-1.1-2c-.3-.6-.2-1.3.3-1.7l.9-.7c.3-.3.5-.7.4-1.1v-.9c0-.4-.1-.8-.4-1.1l-.9-.7c-.5-.4-.6-1.1-.3-1.7l1.1-2c.3-.6 1-.8 1.6-.6l1.1.4c.4.1.8.1 1.1-.1l.8-.5c.3-.2.6-.5.7-.9l.2-1.1Z" />
      <circle cx="12" cy="12" r="2.7" />
    </svg>
  );
}

export { SettingsIcon as AgentReachSettingsIcon };

export default function AgentReachSettingsDialog({ onClose }: { onClose: () => void }) {
  const [settings, setSettings] = useState<SetupResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [expandedChannel, setExpandedChannel] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [cookieBrowser, setCookieBrowser] = useState("chrome");
  const [cookiePlatform, setCookiePlatform] = useState("bilibili");

  const load = useCallback(async (refresh = false) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/agent-reach/setup${refresh ? "?refresh=1" : ""}`);
      const data = (await response.json().catch(() => ({}))) as SetupResponse;
      setSettings(data);
      if (!response.ok) setNotice(data.reason ?? data.error ?? "Agent Reach setup is unavailable.");
    } catch {
      setNotice("Agent Reach setup could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const act = useCallback(
    async (key: string, body: Record<string, unknown>, success: string) => {
      setBusy(key);
      setNotice(null);
      setDetail(null);
      try {
        const response = await fetch("/api/agent-reach/setup", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = (await response.json().catch(() => ({}))) as SetupResponse & {
          output?: string;
        };
        if (Array.isArray(data.channels)) {
          setSettings((current) => (current ? { ...current, channels: data.channels } : current));
        }
        if (response.ok && data.ok) {
          setNotice(success);
          return true;
        }
        setNotice(data.reason ?? data.error ?? "That step did not complete.");
        if (data.output) setDetail(data.output);
        return false;
      } catch {
        setNotice("That step could not be started.");
        return false;
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  const channels = useMemo(() => settings?.channels ?? [], [settings]);
  const byChannel = useMemo(
    () => new Map(channels.map((channel) => [channel.channel, channel])),
    [channels],
  );
  const working = channels.filter((channel) => channel.status === "ok").length;
  const needsSetup = Math.max(0, channels.length - working);

  /** Best state among the channels an install/credential affects. */
  const stateFor = (keys: string[]): Channel["status"] | null => {
    const states = keys.map((key) => byChannel.get(key)?.status).filter(Boolean) as Channel["status"][];
    if (!states.length) return null;
    if (states.includes("ok")) return "ok";
    if (states.includes("warn")) return "warn";
    return "off";
  };

  return (
    <div
      // bb-modal-backdrop / bb-modal-panel are the shared modal surfaces (they
      // carry the panel background and the dark-theme overrides). Rolling a
      // background by hand here is what left the panel transparent.
      className="bb-modal-backdrop fixed inset-0 z-[150] flex items-center justify-center px-4 py-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="agent-reach-settings-title"
        className="bb-modal-panel neu-dialog flex max-h-[min(54rem,94vh)] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border text-[var(--ink)]"
      >
        <header className="flex items-start gap-4 border-b border-[var(--line)] px-5 py-4">
          <span className="neu-button-icon flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[var(--botanical)]">
            <SettingsIcon className="h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1">
            <h2 id="agent-reach-settings-title" className="font-serif text-lg text-[var(--ink-heading)]">
              Agent Reach channels
            </h2>
            <p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">
              Choose a platform to see what it can do and finish its setup step by step. Breadboard
              installs supported tools for you; keys and browser sessions stay on this machine and
              are only used when Agent Reach talks to that service.
            </p>
          </span>
          <button
            type="button"
            onClick={onClose}
            className="neu-button-icon flex h-9 w-9 items-center justify-center rounded-full"
            aria-label="Close Agent Reach settings"
          >
            <svg aria-hidden className="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path strokeLinecap="round" d="m4 4 8 8m0-8-8 8" />
            </svg>
          </button>
        </header>

        <div className="border-b border-[var(--line)] px-5 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="neu-inset inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs text-[var(--ink-muted)]">
              <span
                className={`h-2 w-2 rounded-full ${
                  settings?.available ? "bg-[var(--botanical)]" : "bg-amber-500"
                }`}
              />
              {settings?.available ? "Agent Reach ready" : loading ? "Checking…" : "Not prepared"}
            </span>
            <span className="text-xs text-[var(--ink-muted)]">
              {working} of {channels.length || "–"} working
              {needsSetup ? ` · ${needsSetup} need attention` : ""}
            </span>
            <button
              type="button"
              onClick={() => void load(true)}
              disabled={loading || busy !== null}
              className="neu-button ml-auto rounded-lg px-3 py-1.5 text-xs disabled:opacity-50"
            >
              {loading ? "Checking…" : "Re-check"}
            </button>
          </div>
          {channels.length ? (
            <div
              className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--paper-strong)]"
              role="progressbar"
              aria-label="Working Agent Reach platforms"
              aria-valuemin={0}
              aria-valuemax={channels.length}
              aria-valuenow={working}
            >
              <span
                className="block h-full rounded-full bg-[var(--botanical)] transition-[width]"
                style={{ width: `${(working / channels.length) * 100}%` }}
              />
            </div>
          ) : null}
          {notice || settings?.reason ? (
            <p className="mt-2 text-xs leading-5 text-[var(--ink-muted)]" role="status">
              {notice ?? settings?.reason}
            </p>
          ) : null}
          {detail ? (
            <pre className="neu-inset mt-2 max-h-32 overflow-auto whitespace-pre-wrap rounded-xl px-3 py-2 text-[10px] leading-4 text-[var(--ink-muted)]">
              {detail}
            </pre>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
          {loading && !settings ? (
            <div className="py-16 text-center text-sm text-[var(--ink-muted)]">
              Asking agent-reach doctor which platforms are reachable…
            </div>
          ) : (
            <>
              <section>
                <h3 className="text-xs font-semibold uppercase tracking-[0.13em] text-[var(--ink-muted)]">
                  Platforms
                </h3>
                <p className="mt-1 text-[11px] leading-4 text-[var(--ink-muted)]">
                  Open any card for a plain-language checklist. Technical diagnostics are kept
                  behind “Doctor details” when you need them.
                </p>
                <ul className="mt-3 grid grid-cols-1 items-start gap-2 sm:grid-cols-2">
                  {channels.map((channel) => {
                    const guide = guideFor(channel.channel);
                    const expanded = expandedChannel === channel.channel;
                    const installs = (settings?.installs ?? []).filter((target) =>
                      target.channels.includes(channel.channel),
                    );
                    const credentials = (settings?.credentials ?? []).filter((field) =>
                      field.channels.includes(channel.channel),
                    );
                    const canImportCookies = (settings?.platforms ?? []).includes(channel.channel);

                    return (
                      <li
                        key={channel.channel}
                        className="neu-inset overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--paper-surface)]"
                      >
                        <div className="p-3.5">
                          <div className="flex items-start gap-2.5">
                            <span
                              className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${
                                channel.status === "ok"
                                  ? "bg-[var(--botanical)]"
                                  : channel.status === "warn"
                                    ? "bg-amber-500"
                                    : channel.status === "error"
                                      ? "bg-[var(--danger)]"
                                      : "bg-[var(--ink-muted)]/40"
                              }`}
                              aria-hidden
                            />
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <h4 className="text-sm font-medium text-[var(--ink-heading)]">
                                  {label(channel.channel)}
                                </h4>
                                <span
                                  className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                                    channel.status === "ok"
                                      ? "bg-[color-mix(in_srgb,var(--botanical)_12%,var(--paper-raised))] text-[var(--botanical)]"
                                      : channel.status === "warn"
                                        ? "bg-amber-500/10 text-amber-700"
                                        : channel.status === "error"
                                          ? "bg-[color-mix(in_srgb,var(--danger)_10%,var(--paper-raised))] text-[var(--danger)]"
                                          : "bg-[var(--paper-strong)] text-[var(--ink-muted)]"
                                  }`}
                                >
                                  {statusLabel(channel)}
                                </span>
                              </div>
                              <p className="mt-1 text-[11px] leading-4 text-[var(--ink-muted)]">
                                {guide.description}
                              </p>
                              <p className="mt-1 text-[10px] leading-4 text-[var(--ink-muted)]">
                                <span className="font-medium text-[var(--ink)]">Can do:</span>{" "}
                                {guide.capabilities}
                              </p>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedChannel((current) =>
                                current === channel.channel ? null : channel.channel,
                              )
                            }
                            className="neu-button mt-3 flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs font-medium text-[var(--ink)]"
                            aria-expanded={expanded}
                            aria-controls={`agent-reach-${channel.channel}-setup`}
                          >
                            <span>{channel.status === "ok" ? "View details" : "Set up this platform"}</span>
                            <span
                              className={`text-[var(--ink-muted)] transition-transform ${expanded ? "rotate-180" : ""}`}
                              aria-hidden
                            >
                              ⌄
                            </span>
                          </button>
                        </div>

                        {expanded ? (
                          <div
                            id={`agent-reach-${channel.channel}-setup`}
                            className="space-y-3 border-t border-[var(--line)] bg-[var(--paper-raised)] px-3.5 py-3"
                          >
                            <div>
                              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--ink-muted)]">
                                Recommended setup
                              </p>
                              <p className="mt-1 text-xs leading-5 text-[var(--ink)]">{guide.setup}</p>
                            </div>

                            {installs.map((target) => (
                              <div
                                key={target.id}
                                className="rounded-xl border border-[var(--line)] bg-[var(--paper-surface)] p-3"
                              >
                                <div className="flex items-start gap-3">
                                  <span className="min-w-0 flex-1">
                                    <span className="block text-xs font-medium text-[var(--ink-heading)]">
                                      {target.label}
                                    </span>
                                    <span className="mt-0.5 block text-[10px] leading-4 text-[var(--ink-muted)]">
                                      {target.unlocks}
                                    </span>
                                  </span>
                                  <button
                                    type="button"
                                    disabled={busy !== null || !target.available}
                                    onClick={() =>
                                      void act(
                                        target.id,
                                        { action: "install", target: target.id },
                                        `${target.label} is installed. Re-checking may take a moment.`,
                                      )
                                    }
                                    className="neu-button shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium text-[var(--botanical)] disabled:opacity-45"
                                  >
                                    {busy === target.id
                                      ? "Installing…"
                                      : !target.available
                                        ? "Manual"
                                        : channel.status === "ok"
                                          ? "Reinstall"
                                          : "Install"}
                                  </button>
                                </div>
                                {target.manual ? (
                                  <p className="mt-2 text-[10px] leading-4 text-[var(--ink-muted)]">
                                    After installing: {target.manual}
                                  </p>
                                ) : null}
                              </div>
                            ))}

                            {credentials.map((field) => (
                              <div
                                key={field.key}
                                className="flex items-start gap-3 rounded-xl border border-[var(--line)] bg-[var(--paper-surface)] p-3"
                              >
                                <span className="min-w-0 flex-1">
                                  <span className="block text-xs font-medium text-[var(--ink-heading)]">
                                    {field.label}
                                  </span>
                                  <span className="mt-0.5 block text-[10px] leading-4 text-[var(--ink-muted)]">
                                    {field.hint}
                                  </span>
                                </span>
                                <button
                                  type="button"
                                  disabled={busy !== null}
                                  onClick={() => {
                                    setEditing(field.key);
                                    window.requestAnimationFrame(() =>
                                      document
                                        .getElementById(`agent-reach-credential-${field.key}`)
                                        ?.scrollIntoView({ behavior: "smooth", block: "center" }),
                                    );
                                  }}
                                  className="neu-button shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium text-[var(--botanical)] disabled:opacity-45"
                                >
                                  Add
                                </button>
                              </div>
                            ))}

                            {canImportCookies ? (
                              <div className="rounded-xl border border-[var(--line)] bg-[var(--paper-surface)] p-3">
                                <p className="text-xs font-medium text-[var(--ink-heading)]">
                                  Import an existing browser session
                                </p>
                                <p className="mt-0.5 text-[10px] leading-4 text-[var(--ink-muted)]">
                                  Breadboard reads cookies only for {label(channel.channel)}, only
                                  after you press Import.
                                </p>
                                <div className="mt-2 flex items-center gap-2">
                                  <select
                                    value={cookieBrowser}
                                    onChange={(event) => setCookieBrowser(event.target.value)}
                                    className="neu-control min-w-0 flex-1 rounded-lg border border-[var(--line)] bg-[var(--paper-surface)] px-3 py-2 text-xs text-[var(--ink)]"
                                    aria-label={`Browser for ${label(channel.channel)} cookies`}
                                  >
                                    {(settings?.browsers ?? []).map((browser) => (
                                      <option key={browser} value={browser}>
                                        {browser}
                                      </option>
                                    ))}
                                  </select>
                                  <button
                                    type="button"
                                    disabled={busy !== null}
                                    onClick={() =>
                                      void act(
                                        `cookies:${channel.channel}`,
                                        {
                                          action: "import-cookies",
                                          browser: cookieBrowser,
                                          platform: channel.channel,
                                        },
                                        `Imported ${label(channel.channel)} cookies from ${cookieBrowser}.`,
                                      )
                                    }
                                    className="neu-button rounded-lg px-3 py-1.5 text-xs font-medium text-[var(--botanical)] disabled:opacity-45"
                                  >
                                    {busy === `cookies:${channel.channel}` ? "Importing…" : "Import"}
                                  </button>
                                </div>
                              </div>
                            ) : null}

                            {guide.links?.length ? (
                              <div className="flex flex-wrap gap-2">
                                {guide.links.map((link) => (
                                  <a
                                    key={link.href}
                                    href={link.href}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="neu-button rounded-lg px-3 py-1.5 text-xs font-medium text-[var(--botanical)]"
                                  >
                                    {link.label} ↗
                                  </a>
                                ))}
                              </div>
                            ) : null}

                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => void load(true)}
                                disabled={loading || busy !== null}
                                className="neu-button rounded-lg px-3 py-1.5 text-xs disabled:opacity-50"
                              >
                                {loading ? "Checking…" : "Check again"}
                              </button>
                              {channel.activeBackend ? (
                                <span className="text-[10px] text-[var(--ink-muted)]">
                                  Using {channel.activeBackend}
                                </span>
                              ) : null}
                            </div>

                            <details className="text-[10px] leading-4 text-[var(--ink-muted)]">
                              <summary className="cursor-pointer select-none font-medium text-[var(--ink)]">
                                Doctor details
                              </summary>
                              {channel.backends?.length ? (
                                <p className="mt-1">Supported backends: {channel.backends.join(", ")}</p>
                              ) : null}
                              <pre className="mt-1 whitespace-pre-wrap font-sans">{channel.message}</pre>
                            </details>
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </section>

              <section className="mt-5">
                <h3 className="text-xs font-semibold uppercase tracking-[0.13em] text-[var(--ink-muted)]">
                  All installable tools
                </h3>
                <p className="mt-1 text-[11px] leading-4 text-[var(--ink-muted)]">
                  Shared tools can unlock several platforms at once. Reinstalling is safe when a
                  tool is present but unhealthy.
                </p>
                <ul className="mt-2 divide-y divide-[var(--line)]">
                  {(settings?.installs ?? []).map((target) => {
                    const state = stateFor(target.channels);
                    return (
                      <li key={target.id} className="flex items-start gap-3 py-3">
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium text-[var(--ink-heading)]">
                              {target.label}
                            </span>
                            {state === "ok" ? (
                              <span className="rounded-full bg-[var(--paper-strong)] px-2 py-0.5 text-[10px] text-[var(--botanical)]">
                                Working
                              </span>
                            ) : state === "warn" ? (
                              <span className="rounded-full bg-[var(--paper-strong)] px-2 py-0.5 text-[10px] text-amber-600">
                                Installed
                              </span>
                            ) : null}
                          </span>
                          <span className="mt-0.5 block text-[11px] leading-4 text-[var(--ink-muted)]">
                            {target.unlocks}
                          </span>
                          <span className="mt-1 block text-[10px] text-[var(--ink-muted)]">
                            Helps: {target.channels.map(label).join(", ")}
                          </span>
                          {target.manual ? (
                            <span className="mt-1 block text-[10px] leading-4 text-[var(--ink-muted)]">
                              Manual follow-up: {target.manual}
                            </span>
                          ) : null}
                        </span>
                        <button
                          type="button"
                          disabled={busy !== null || !target.available}
                          onClick={() =>
                            void act(
                              target.id,
                              { action: "install", target: target.id },
                              `${target.label} is installed.`,
                            )
                          }
                          className="neu-button shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium text-[var(--botanical)] disabled:opacity-45"
                          title={target.available ? undefined : "Install this one yourself"}
                        >
                          {busy === target.id
                            ? "Installing…"
                            : !target.available
                              ? "Manual"
                              : state === "ok" || state === "warn"
                                ? "Reinstall"
                                : "Install"}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>

              <section className="mt-5">
                <h3 className="text-xs font-semibold uppercase tracking-[0.13em] text-[var(--ink-muted)]">
                  Logins and keys
                </h3>
                <p className="mt-1 text-[11px] leading-4 text-[var(--ink-muted)]">
                  Stored by Agent Reach on this machine. Breadboard writes them and never reads them
                  back.
                </p>
                <ul className="mt-2 divide-y divide-[var(--line)]">
                  {(settings?.credentials ?? []).map((field) => (
                    <li
                      key={field.key}
                      id={`agent-reach-credential-${field.key}`}
                      className="scroll-mt-4 py-3"
                    >
                      <div className="flex items-start gap-3">
                        <span className="min-w-0 flex-1">
                          <span className="text-sm font-medium text-[var(--ink-heading)]">
                            {field.label}
                          </span>
                          <span className="mt-0.5 block text-[11px] leading-4 text-[var(--ink-muted)]">
                            {field.hint}
                            {field.source ? (
                              <>
                                {" "}
                                <a
                                  href={field.source.split(" ")[0]}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-[var(--botanical)] hover:underline"
                                >
                                  Get one
                                </a>
                              </>
                            ) : null}
                          </span>
                        </span>
                        <button
                          type="button"
                          onClick={() => setEditing((current) => (current === field.key ? null : field.key))}
                          disabled={busy !== null}
                          className="neu-button shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium text-[var(--botanical)] disabled:opacity-45"
                        >
                          {editing === field.key ? "Cancel" : "Set"}
                        </button>
                      </div>
                      {editing === field.key ? (
                        <form
                          className="neu-inset mt-2 rounded-xl p-3"
                          onSubmit={(event) => {
                            event.preventDefault();
                            void act(
                              field.key,
                              { action: "configure", key: field.key, value: values[field.key] ?? "" },
                              `${field.label} saved.`,
                            ).then((ok) => {
                              if (!ok) return;
                              setValues((current) => ({ ...current, [field.key]: "" }));
                              setEditing(null);
                            });
                          }}
                        >
                          <input
                            type="password"
                            value={values[field.key] ?? ""}
                            onChange={(event) =>
                              setValues((current) => ({ ...current, [field.key]: event.target.value }))
                            }
                            className="neu-control w-full rounded-lg border border-[var(--line)] bg-[var(--paper-raised)] px-3 py-2 text-sm text-[var(--ink)] outline-none focus:border-[var(--botanical)]"
                            placeholder={field.label}
                            autoComplete="off"
                            required
                          />
                          <div className="mt-2 flex justify-end">
                            <button
                              type="submit"
                              disabled={busy !== null}
                              className="neu-button-primary rounded-lg px-3 py-1.5 text-xs disabled:opacity-50"
                            >
                              {busy === field.key ? "Saving…" : "Save"}
                            </button>
                          </div>
                        </form>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>

              <section className="mt-5">
                <h3 className="text-xs font-semibold uppercase tracking-[0.13em] text-[var(--ink-muted)]">
                  Import cookies from a browser
                </h3>
                <p className="mt-1 text-[11px] leading-4 text-[var(--ink-muted)]">
                  Reads the cookies for one platform you name, from one browser you name. Nothing is
                  read until you press Import.
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <select
                    value={cookiePlatform}
                    onChange={(event) => setCookiePlatform(event.target.value)}
                    className="neu-control rounded-lg border border-[var(--line)] bg-[var(--paper-surface)] px-3 py-2 text-xs text-[var(--ink)]"
                    aria-label="Platform to import cookies for"
                  >
                    {(settings?.platforms ?? []).map((platform) => (
                      <option key={platform} value={platform}>
                        {label(platform)}
                      </option>
                    ))}
                  </select>
                  <span className="text-xs text-[var(--ink-muted)]">from</span>
                  <select
                    value={cookieBrowser}
                    onChange={(event) => setCookieBrowser(event.target.value)}
                    className="neu-control rounded-lg border border-[var(--line)] bg-[var(--paper-surface)] px-3 py-2 text-xs text-[var(--ink)]"
                    aria-label="Browser to import cookies from"
                  >
                    {(settings?.browsers ?? []).map((browser) => (
                      <option key={browser} value={browser}>
                        {browser}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() =>
                      void act(
                        "cookies",
                        { action: "import-cookies", browser: cookieBrowser, platform: cookiePlatform },
                        `Imported ${label(cookiePlatform)} cookies from ${cookieBrowser}.`,
                      )
                    }
                    className="neu-button rounded-lg px-3 py-1.5 text-xs font-medium text-[var(--botanical)] disabled:opacity-45"
                  >
                    {busy === "cookies" ? "Importing…" : "Import"}
                  </button>
                </div>
              </section>

              <p className="mt-5 text-[11px] leading-4 text-[var(--ink-muted)]">
                Facebook, Instagram, and XiaoHongShu read through OpenCLI, which reuses a Chrome
                session you are already signed in to. Install its extension and sign in there —
                Agent Reach never signs in for you.
              </p>
            </>
          )}

          {/* One settings button per agent means the run defaults live here too,
              below the platforms rather than behind a second button. */}
          <section className="mt-6 border-t border-[var(--line)] pt-4">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--ink-muted)]">
              Defaults
            </h3>
            <div className="mt-2">
              <AgentRunDefaults agentId="agent-reach" />
            </div>
          </section>
        </div>
      </section>
    </div>
  );
}
