"use client";

// The Wardrobe setup panel.
//
// Two things stand between a fresh clone and a working wardrobe, and both are
// here: the clone's own dependencies, and a photograph of the person. The second
// is the unusual one. It is not an optional nicety — the app refuses to accept a
// photo of clothes at all until an identity reference exists, because every
// import it knows how to do ends in a picture of you wearing the piece.
//
// That photo never leaves this machine except as a reference on the image call
// it exists for, and the panel says so, because "upload a picture of yourself"
// is a request that deserves an answer to "and then what".

import { useCallback, useEffect, useRef, useState } from "react";
import AgentRunDefaults from "@/app/components/agents/agent-run-defaults";
import { WARDROBE_AGENT_ID } from "@/lib/wardrobe/identity.ts";

interface SetupStatus {
  ready: boolean;
  reason: string;
  clone: { found: boolean; path: string };
  dependencies: { installed: boolean; vite: boolean; sharp: boolean };
  identity: { found: boolean; path: string };
  dataDir: string;
}

const MAX_PHOTO_BYTES = 20 * 1024 * 1024;

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
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 3.5 5 6v4l2-.6V21h10V9.4l2 .6V6l-4-2.5a3 3 0 0 1-6 0Z"
      />
    </svg>
  );
}

export { StatusIcon as WardrobeSettingsIcon };

function Row({
  label,
  detail,
  ok,
  optional,
  children,
}: {
  label: string;
  detail: string;
  ok: boolean;
  optional?: string;
  children?: React.ReactNode;
}) {
  return (
    <li className="flex items-start gap-3 px-2 py-3">
      <span
        className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
          ok ? "bg-[var(--botanical)]" : optional ? "bg-amber-500" : "bg-[var(--danger)]"
        }`}
      />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-[var(--ink-heading)]">{label}</span>
        <span className="mt-0.5 block break-all text-xs leading-5 text-[var(--ink-muted)]">
          {ok ? detail : (optional ?? detail)}
        </span>
      </span>
      {children}
    </li>
  );
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("That file could not be read."));
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.readAsDataURL(file);
  });
}

export default function WardrobeSettingsDialog({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // No setState before the first await: the mount effect calls this, and a
  // synchronous state write there is a cascading render.
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/wardrobe/health", { cache: "no-store" });
      const data = (await response.json().catch(() => ({}))) as {
        setup?: SetupStatus;
        error?: string;
      };
      if (!response.ok || !data.setup) {
        throw new Error(data.error || "Wardrobe could not be checked.");
      }
      setStatus(data.setup);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Wardrobe could not be checked.");
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
        const response = await fetch("/api/wardrobe/setup", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = (await response.json().catch(() => ({}))) as {
          message?: string;
          status?: SetupStatus;
          error?: string;
        };
        if (data.status) setStatus(data.status);
        setNotice(data.message || data.error || "Wardrobe could not be set up.");
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Wardrobe could not be set up.");
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  async function chooseIdentity(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_PHOTO_BYTES) {
      setNotice("That photo is too large — 20 MB is the limit.");
      return;
    }
    try {
      const dataUrl = await readAsDataUrl(file);
      await post({ action: "identity", dataUrl }, "Saving your photo.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "That photo could not be read.");
    }
  }

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
        aria-labelledby="wardrobe-settings-title"
        className="bb-modal-panel neu-dialog flex max-h-[min(48rem,94vh)] w-full max-w-[min(44rem,94vw)] flex-col overflow-hidden rounded-2xl border text-[var(--ink)]"
      >
        <header className="flex items-start gap-4 border-b border-[var(--line)] px-5 py-4">
          <span className="neu-button-icon flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[var(--botanical)]">
            <StatusIcon />
          </span>
          <span className="min-w-0 flex-1">
            <h2
              id="wardrobe-settings-title"
              className="font-serif text-lg text-[var(--ink-heading)]"
            >
              Wardrobe setup
            </h2>
            <p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">
              Wardrobe reads photos of your clothes, cuts each garment out, and makes a
              photo of you wearing it — on ChatMock, into a wardrobe held on this machine.
            </p>
          </span>
          <button
            type="button"
            onClick={onClose}
            className="neu-button-icon flex h-9 w-9 items-center justify-center rounded-full"
            aria-label="Close Wardrobe setup"
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
                  status?.ready ? "bg-[var(--botanical)]" : "bg-amber-500"
                }`}
              />
              {status?.ready ? "Ready to run" : loading ? "Checking…" : "Setup needed"}
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
          {notice || status?.reason ? (
            <p className="mt-2 text-xs leading-5 text-[var(--ink-muted)]" role="status">
              {notice ?? status?.reason}
            </p>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-2">
          {loading && !status ? (
            <div className="px-4 py-16 text-center text-sm text-[var(--ink-muted)]">
              Checking Wardrobe…
            </div>
          ) : status ? (
            <>
              <ul className="divide-y divide-[var(--line)]">
                <Row
                  label="Wardrobe clone"
                  ok={status.clone.found}
                  detail={status.clone.path}
                  optional="Not found. Clone tandpfun/wardrobe next to the dashboard."
                />
                <Row
                  label="Dependencies"
                  ok={status.dependencies.installed}
                  detail="Installed."
                  optional={
                    status.dependencies.vite
                      ? "The image toolchain (sharp) is missing, which is what trims and clears the background on every cutout."
                      : "Not installed. Breadboard runs npm install in the clone; it takes a couple of minutes the first time."
                  }
                >
                  <button
                    type="button"
                    onClick={() =>
                      void post({ action: "install" }, "Installing. This takes a couple of minutes.")
                    }
                    disabled={busy || !status.clone.found}
                    className="neu-button shrink-0 rounded-lg px-3 py-1.5 text-xs disabled:opacity-50"
                  >
                    {busy ? "Working…" : status.dependencies.installed ? "Reinstall" : "Install"}
                  </button>
                </Row>
                <Row
                  label="Your photo"
                  ok={status.identity.found}
                  detail={status.identity.path}
                  optional="Wardrobe cannot import anything without one — every piece it files ends in a photo of you wearing it. A clear, front-on picture works best. It stays in the folder below and is only ever sent as a reference on the image call it exists for."
                >
                  <span className="flex shrink-0 items-center gap-2">
                    <input
                      ref={fileRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.target.value = "";
                        void chooseIdentity(file);
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => fileRef.current?.click()}
                      disabled={busy || !status.clone.found}
                      className="neu-button rounded-lg px-3 py-1.5 text-xs disabled:opacity-50"
                    >
                      {status.identity.found ? "Replace" : "Choose"}
                    </button>
                    {status.identity.found ? (
                      <button
                        type="button"
                        onClick={() =>
                          void post({ action: "identity-remove" }, "Removing your photo.")
                        }
                        disabled={busy}
                        className="neu-button rounded-lg px-3 py-1.5 text-xs disabled:opacity-50"
                      >
                        Remove
                      </button>
                    ) : null}
                  </span>
                </Row>
                <Row
                  label="Wardrobe folder"
                  ok={Boolean(status.dataDir)}
                  detail={`${status.dataDir} — your library, the cutouts and the modeled photos. Upstream keeps this out of version control.`}
                />
              </ul>
              <div className="px-2 pb-2 pt-1">
                <button
                  type="button"
                  onClick={() => void post({ action: "restart" }, "Stopping the server.")}
                  disabled={busy}
                  className="neu-button rounded-lg px-3 py-1.5 text-xs disabled:opacity-50"
                >
                  Restart the wardrobe server
                </button>
                <p className="mt-1.5 text-xs leading-5 text-[var(--ink-muted)]">
                  The server reads its settings once at boot. Restart it after changing your
                  background model or the image quality below.
                </p>
              </div>
              <AgentRunDefaults agentId={WARDROBE_AGENT_ID} />
            </>
          ) : null}
        </div>
      </section>
    </div>
  );
}
