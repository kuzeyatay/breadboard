"use client";

// The firmware tab: file tree on the left, source on the right.
//
// Source is rendered through Breadboard's existing chat code block, so it gets
// the same styling and the same per-file copy button as code everywhere else in
// the app rather than a second, divergent viewer.

import { useState } from "react";
import ChatMarkdown from "@/app/components/chat-markdown";
import type { FirmwareProject } from "@/lib/hardware/types";

function fenceLanguage(language: string): string {
  if (language === "cpp" || language === "c") return "cpp";
  if (language === "ini") return "ini";
  if (language === "markdown") return "markdown";
  return "text";
}

export default function FirmwareView({
  firmware,
  onDownloadFile,
  onDownloadProject,
}: {
  firmware: FirmwareProject | undefined;
  onDownloadFile: (path: string, content: string) => void;
  onDownloadProject: () => void;
}) {
  const [activePath, setActivePath] = useState(firmware?.entryFile ?? "");
  const [copied, setCopied] = useState("");

  if (!firmware || !firmware.files.length) {
    return (
      <p className="rounded-xl border border-[var(--line)] bg-[var(--paper-strong)] p-4 text-sm text-[var(--ink-muted)]">
        No firmware was generated for this design.
      </p>
    );
  }

  const active =
    firmware.files.find((file) => file.path === activePath) ?? firmware.files[0];

  const copy = async (label: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(""), 1600);
    } catch {
      setCopied("");
    }
  };

  const allFiles = firmware.files
    .map((file) => `// ===== ${file.path} =====\n${file.content}`)
    .join("\n\n");

  const buttonClass =
    "neu-button rounded-lg border border-[var(--line)] bg-[var(--paper-strong)] px-2.5 py-1 text-xs text-[var(--ink-heading)]";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={buttonClass} onClick={() => void copy("all", allFiles)}>
          {copied === "all" ? "All files copied" : "Copy all files"}
        </button>
        <button
          type="button"
          className={buttonClass}
          onClick={() => onDownloadFile(active.path, active.content)}
        >
          Download {active.path.split("/").pop()}
        </button>
        <button type="button" className={buttonClass} onClick={onDownloadProject}>
          Download project ZIP
        </button>
      </div>

      <div className="grid gap-3 md:grid-cols-[14rem_minmax(0,1fr)]">
        <nav aria-label="Firmware files" className="rounded-xl border border-[var(--line)] bg-[var(--paper-strong)] p-2">
          <ul className="space-y-0.5">
            {firmware.files.map((file) => (
              <li key={file.path}>
                <button
                  type="button"
                  onClick={() => setActivePath(file.path)}
                  aria-current={file.path === active.path}
                  className={`w-full truncate rounded-lg px-2 py-1.5 text-left font-mono text-xs ${
                    file.path === active.path
                      ? "bg-[var(--paper-raised)] font-semibold text-[var(--ink-heading)]"
                      : "text-[var(--ink)] hover:bg-[var(--paper-raised)]"
                  }`}
                  title={file.path}
                >
                  {file.path}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <div className="min-w-0">
          <ChatMarkdown
            content={`\`\`\`${fenceLanguage(active.language)}\n${active.content.replace(/```/g, "\\`\\`\\`")}\n\`\`\``}
          />
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <section className="rounded-xl border border-[var(--line)] bg-[var(--paper-strong)] p-3">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">Build</h4>
          <ol className="mt-2 list-decimal space-y-1 pl-4 text-sm text-[var(--ink)]">
            {firmware.buildInstructions.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ol>
        </section>
        <section className="rounded-xl border border-[var(--line)] bg-[var(--paper-strong)] p-3">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">Upload</h4>
          <ol className="mt-2 list-decimal space-y-1 pl-4 text-sm text-[var(--ink)]">
            {firmware.uploadInstructions.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ol>
        </section>
        <section className="rounded-xl border border-[var(--line)] bg-[var(--paper-strong)] p-3">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
            Expected serial output
          </h4>
          <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-xs text-[var(--ink)]">
            {firmware.expectedSerialOutput ?? "—"}
          </pre>
          {firmware.dependencies.length ? (
            <p className="mt-3 text-xs text-[var(--ink-muted)]">
              Libraries: {firmware.dependencies.map((entry) => entry.name).join(", ")}
            </p>
          ) : null}
        </section>
      </div>
    </div>
  );
}
