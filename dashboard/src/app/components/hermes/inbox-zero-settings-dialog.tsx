"use client";

// The Inbox Zero setup panel.
//
// This agent has the longest setup of any of them, and pretending otherwise
// would be the wrong kindness. Reading someone's mail needs four things, and
// they fail in a strict order: the clone, a container engine, an OAuth client
// that only the user can create, and a mailbox they connect themselves in a real
// browser. The panel is built as that ordered checklist, because the useful
// answer to "why isn't it working" is always "the first row that is not green".
//
// The OAuth client is the one input Breadboard asks for and cannot generate.
// Secrets are write-only here: the panel shows whether one is set, never what it
// is, and submitting an empty field leaves the stored value alone rather than
// wiping a secret the person could not see to retype.

import { useCallback, useEffect, useState } from "react";
import AgentRunDefaults from "@/app/components/agents/agent-run-defaults";
import { INBOX_ZERO_AGENT_ID } from "@/lib/inbox-zero/identity.ts";

type SetupStep =
  | "clone_missing"
  | "docker_unavailable"
  | "oauth_client_missing"
  | "stack_not_running"
  | "mailbox_not_connected"
  | "ready";

interface Health {
  installed: boolean;
  baseUrl: string;
  cloneRoot: string;
  oauth: { google: boolean; microsoft: boolean; configured: boolean };
  setup: {
    step: SetupStep;
    ready: boolean;
    message: string;
    url?: string;
    mailboxes?: Array<{ email: string; provider: string }>;
  };
}

/** The order the steps are satisfied in. Used to colour rows above the current one. */
const ORDER: SetupStep[] = [
  "clone_missing",
  "docker_unavailable",
  "oauth_client_missing",
  "stack_not_running",
  "mailbox_not_connected",
  "ready",
];

function StatusIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg
      aria-hidden
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 7.5A1.5 1.5 0 0 1 4.5 6h15A1.5 1.5 0 0 1 21 7.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 16.5z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="m3.6 7 8.4 6 8.4-6" />
    </svg>
  );
}

export { StatusIcon as InboxZeroSettingsIcon };

function Row({
  label,
  detail,
  state,
  children,
}: {
  label: string;
  detail: string;
  state: "done" | "current" | "pending";
  children?: React.ReactNode;
}) {
  return (
    <li className="flex items-start gap-3 px-2 py-3">
      <span
        className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
          state === "done"
            ? "bg-[var(--botanical)]"
            : state === "current"
              ? "bg-amber-500"
              : "bg-[color-mix(in_srgb,var(--line)_80%,transparent)]"
        }`}
      />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-[var(--ink-heading)]">{label}</span>
        <span className="mt-0.5 block break-all text-xs leading-5 text-[var(--ink-muted)]">
          {detail}
        </span>
      </span>
      {children}
    </li>
  );
}

export default function InboxZeroSettingsDialog({ onClose }: { onClose: () => void }) {
  const [health, setHealth] = useState<Health | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [googleId, setGoogleId] = useState("");
  const [googleSecret, setGoogleSecret] = useState("");

  // No setState before the first await: the mount effect calls this, and a
  // synchronous state write there is a cascading render.
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/inbox-zero/health", { cache: "no-store" });
      const data = (await response.json().catch(() => ({}))) as Health & { error?: string };
      if (!response.ok || !data.setup) {
        throw new Error(data.error || "Inbox Zero could not be checked.");
      }
      setHealth(data);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Inbox Zero could not be checked.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const post = useCallback(
    async (body: Record<string, unknown>, pending: string) => {
      setBusy(true);
      setNotice(pending);
      try {
        const response = await fetch("/api/inbox-zero/setup", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = (await response.json().catch(() => ({}))) as {
          ok?: boolean;
          reason?: string | null;
          restartRequired?: boolean;
          revoked?: number;
          error?: string;
        };
        setNotice(
          data.error ??
            data.reason ??
            (data.restartRequired
              ? "Saved. Start Inbox Zero — it reads this when it boots."
              : data.ok
                ? "Done."
                : "That did not work."),
        );
        await load();
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "That did not work.");
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  const step = health?.setup.step ?? "clone_missing";
  const reached = ORDER.indexOf(step);
  const stateFor = (target: SetupStep): "done" | "current" | "pending" => {
    const index = ORDER.indexOf(target);
    if (reached > index) return "done";
    return reached === index ? "current" : "pending";
  };
  const mailboxes = health?.setup.mailboxes ?? [];

  return (
    <div
      className="bb-modal-backdrop fixed inset-0 z-[150] flex items-center justify-center px-4 py-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="inbox-zero-settings-title"
        className="bb-modal-panel neu-dialog flex max-h-[min(48rem,94vh)] w-full max-w-[min(44rem,94vw)] flex-col overflow-hidden rounded-2xl border text-[var(--ink)]"
      >
        <header className="flex items-start gap-4 border-b border-[var(--line)] px-5 py-4">
          <span className="neu-button-icon flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[var(--botanical)]">
            <StatusIcon />
          </span>
          <span className="min-w-0 flex-1">
            <h2
              id="inbox-zero-settings-title"
              className="font-serif text-lg text-[var(--ink-heading)]"
            >
              Inbox Zero setup
            </h2>
            <p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">
              Runs the real Inbox Zero on your machine and connects it to your own mailbox.
              Its AI runs on ChatMock, so no separate model key is needed — but Google or
              Microsoft still has to let it read your mail, and only you can grant that.
            </p>
          </span>
          <button
            type="button"
            onClick={onClose}
            className="neu-button-icon flex h-9 w-9 items-center justify-center rounded-full"
            aria-label="Close Inbox Zero setup"
          >
            <svg
              aria-hidden
              className="h-4 w-4"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path strokeLinecap="round" d="m4 4 8 8m0-8-8 8" />
            </svg>
          </button>
        </header>

        <div className="border-b border-[var(--line)] px-5 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="neu-inset inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs text-[var(--ink-muted)]">
              <span
                className={`h-2 w-2 rounded-full ${
                  health?.setup.ready ? "bg-[var(--botanical)]" : "bg-amber-500"
                }`}
              />
              {health?.setup.ready ? "Ready to run" : loading ? "Checking…" : "Setup needed"}
            </span>
            <button
              type="button"
              onClick={() => {
                setLoading(true);
                void load();
              }}
              disabled={loading || busy}
              className="neu-button ml-auto rounded-lg px-3 py-1.5 text-xs disabled:opacity-50"
            >
              Refresh
            </button>
          </div>
          {notice || health?.setup.message ? (
            <p className="mt-2 text-xs leading-5 text-[var(--ink-muted)]" role="status">
              {notice ?? health?.setup.message}
            </p>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-2">
          {loading && !health ? (
            <div className="px-4 py-16 text-center text-sm text-[var(--ink-muted)]">
              Checking Inbox Zero…
            </div>
          ) : health ? (
            <>
              <ul className="divide-y divide-[var(--line)]">
                <Row
                  label="Inbox Zero clone"
                  state={stateFor("clone_missing")}
                  detail={
                    health.installed
                      ? health.cloneRoot
                      : `Not found at ${health.cloneRoot}. Clone elie222/inbox-zero there.`
                  }
                />
                <Row
                  label="Container engine"
                  state={stateFor("docker_unavailable")}
                  detail={
                    stateFor("docker_unavailable") === "current"
                      ? "No engine is running. Inbox Zero runs as containers — Docker Desktop, Podman, Colima or OrbStack all work, and Breadboard starts one it can find."
                      : "A container engine is available. Breadboard starts the containers itself."
                  }
                />
                <Row
                  label="Google or Microsoft OAuth client"
                  state={stateFor("oauth_client_missing")}
                  detail={
                    health.oauth.configured
                      ? `Saved${health.oauth.google ? " · Google" : ""}${health.oauth.microsoft ? " · Microsoft" : ""}. Breadboard never shows it back.`
                      : "Create an OAuth client in Google Cloud with the Gmail scopes, and add its redirect URI below. This is yours — nothing can generate it for you."
                  }
                >
                  {health.oauth.configured ? (
                    <button
                      type="button"
                      onClick={() => void post({ action: "clear_oauth" }, "Removing the client.")}
                      disabled={busy}
                      className="neu-button shrink-0 rounded-lg px-3 py-1.5 text-xs disabled:opacity-50"
                    >
                      Remove
                    </button>
                  ) : null}
                </Row>
                <Row
                  label="The stack"
                  state={stateFor("stack_not_running")}
                  detail={
                    health.setup.ready || stateFor("stack_not_running") === "done"
                      ? `Running at ${health.baseUrl}.`
                      : `Not running. Starting it the first time pulls its images and migrates its database, so give it a few minutes. It will be at ${health.baseUrl}.`
                  }
                >
                  <button
                    type="button"
                    onClick={() =>
                      void post(
                        { action: stateFor("stack_not_running") === "done" ? "stop" : "start" },
                        stateFor("stack_not_running") === "done"
                          ? "Stopping Inbox Zero."
                          : "Starting Inbox Zero. The first start pulls its images.",
                      )
                    }
                    disabled={busy || !health.installed}
                    className="neu-button shrink-0 rounded-lg px-3 py-1.5 text-xs disabled:opacity-50"
                  >
                    {busy ? "Working…" : stateFor("stack_not_running") === "done" ? "Stop" : "Start"}
                  </button>
                </Row>
                <Row
                  label="Your mailbox"
                  state={stateFor("mailbox_not_connected")}
                  detail={
                    mailboxes.length
                      ? mailboxes.map((mailbox) => `${mailbox.email} (${mailbox.provider})`).join(", ")
                      : "Sign in to Inbox Zero in your browser and connect the account you want the agent to work on. This is the step that grants access to your mail, and it is deliberately yours to take."
                  }
                >
                  {health.setup.url ? (
                    <a
                      href={health.setup.url}
                      target="_blank"
                      rel="noreferrer"
                      className="neu-button shrink-0 rounded-lg px-3 py-1.5 text-xs"
                    >
                      Open
                    </a>
                  ) : null}
                </Row>
              </ul>

              <div className="space-y-3 px-2 pb-3 pt-2">
                <p className="text-xs font-medium text-[var(--ink-heading)]">
                  Google OAuth client
                </p>
                <p className="text-xs leading-5 text-[var(--ink-muted)]">
                  Add{" "}
                  <code className="font-mono">{health.baseUrl}/api/auth/callback/google</code>{" "}
                  as an authorised redirect URI on the client, or sign-in will be refused before
                  it reaches Inbox Zero. Leave a field blank to keep what is already saved.
                </p>
                <label className="block text-xs font-medium text-[var(--ink-heading)]">
                  Client ID
                  <input
                    value={googleId}
                    onChange={(event) => setGoogleId(event.target.value)}
                    placeholder={health.oauth.google ? "Saved — leave blank to keep" : "…apps.googleusercontent.com"}
                    className="neu-control mt-1.5 w-full rounded-xl border border-[var(--line)] bg-[var(--paper-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--botanical)]"
                  />
                </label>
                <label className="block text-xs font-medium text-[var(--ink-heading)]">
                  Client secret
                  <input
                    type="password"
                    value={googleSecret}
                    onChange={(event) => setGoogleSecret(event.target.value)}
                    placeholder={health.oauth.google ? "Saved — leave blank to keep" : "GOCSPX-…"}
                    className="neu-control mt-1.5 w-full rounded-xl border border-[var(--line)] bg-[var(--paper-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--botanical)]"
                  />
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={busy || (!googleId.trim() && !googleSecret.trim())}
                    onClick={() => {
                      void post(
                        {
                          action: "save_oauth",
                          googleClientId: googleId.trim(),
                          googleClientSecret: googleSecret.trim(),
                        },
                        "Saving the client.",
                      ).then(() => {
                        setGoogleId("");
                        setGoogleSecret("");
                      });
                    }}
                    className="neu-button-accent rounded-xl bg-[var(--botanical)] px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
                  >
                    Save client
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void post({ action: "disconnect" }, "Revoking Breadboard's access.")
                    }
                    className="neu-button rounded-lg px-3 py-2 text-xs disabled:opacity-50"
                  >
                    Revoke Breadboard&rsquo;s access
                  </button>
                </div>
                <p className="text-xs leading-5 text-[var(--ink-muted)]">
                  Revoking drops the sessions Breadboard minted against your Inbox Zero. Your own
                  sign-in and your connected mailbox are untouched — this only stops the agent.
                </p>
              </div>

              <AgentRunDefaults agentId={INBOX_ZERO_AGENT_ID} />
            </>
          ) : null}
        </div>
      </section>
    </div>
  );
}
