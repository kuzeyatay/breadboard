"use client";

interface LearnErrorDialogProps {
  message: string;
  currentStep?: string;
  currentSectionTitle?: string;
  currentPageTitle?: string;
  validationReport?: {
    relativePath?: string;
    url?: string;
    markdown?: string;
    truncated?: boolean;
    accepted?: boolean;
    generatedAt?: string;
  } | null;
  onDismiss: () => void;
  onOpenPanel?: () => void;
  openPanelLabel?: string;
}

export default function LearnErrorDialog({
  message,
  currentStep,
  currentSectionTitle,
  currentPageTitle,
  validationReport,
  onDismiss,
  onOpenPanel,
  openPanelLabel = "Open Learn panel",
}: LearnErrorDialogProps) {
  const details = [
    currentStep ? ["Step", currentStep] : null,
    currentSectionTitle ? ["Section", currentSectionTitle] : null,
    currentPageTitle ? ["Page", currentPageTitle] : null,
  ].filter(Boolean) as [string, string][];

  return (
    <div className="bb-modal-backdrop fixed inset-0 z-[120] flex items-center justify-center px-4">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="learn-error-title"
        aria-describedby="learn-error-description"
        className="bb-modal-panel neu-dialog w-full max-w-2xl rounded-2xl border border-red-700 p-5 text-[var(--ink)]"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-red-800 bg-red-950/40 text-red-300">
              <svg
                className="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.8}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v4m0 4h.01M10.3 4.7 2.9 17.5A2 2 0 0 0 4.6 20h14.8a2 2 0 0 0 1.7-2.5L13.7 4.7a2 2 0 0 0-3.4 0Z"
                />
              </svg>
            </span>
            <div className="min-w-0">
              <h2 id="learn-error-title" className="text-base font-semibold text-white">
                Learn section failed
              </h2>
              <p id="learn-error-description" className="mt-1 text-sm leading-6 text-gray-400">
                A section could not be created. Once closed, this dialog stays hidden for this
                failed attempt.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onDismiss}
            className="neu-button-icon flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-gray-800 text-gray-500 transition hover:border-gray-700 hover:text-gray-200"
            aria-label="Close Learn error"
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
        </div>

        {details.length > 0 ? (
          <dl className="mt-4 grid gap-2 rounded-md border border-gray-800 bg-gray-900/60 p-3 text-xs">
            {details.map(([label, value]) => (
              <div key={label} className="grid gap-1 sm:grid-cols-[80px_1fr]">
                <dt className="font-medium text-gray-500">{label}</dt>
                <dd className="min-w-0 break-words text-gray-300">{value}</dd>
              </div>
            ))}
          </dl>
        ) : null}

        <div className="mt-4 max-h-56 overflow-y-auto rounded-md border border-red-900/60 bg-red-950/20 p-3">
          <p className="whitespace-pre-wrap break-words text-sm leading-6 text-red-200">
            {message}
          </p>
        </div>

        {validationReport?.markdown ? (
          <section className="mt-4 rounded-md border border-gray-800 bg-gray-900/60">
            <div className="flex flex-col gap-2 border-b border-gray-800 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <h3 className="text-sm font-medium text-gray-100">Validation report</h3>
                <p className="mt-0.5 break-words text-xs text-gray-500">
                  {validationReport.relativePath ?? ".breadboard/validation-report.md"}
                  {validationReport.generatedAt ? ` - ${validationReport.generatedAt}` : ""}
                  {typeof validationReport.accepted === "boolean"
                    ? ` - Accepted: ${validationReport.accepted ? "yes" : "no"}`
                    : ""}
                </p>
              </div>
              {validationReport.url ? (
                <a
                  href={validationReport.url}
                  target="_blank"
                  rel="noreferrer"
                  className="neu-button inline-flex shrink-0 items-center rounded-lg border px-3 py-1.5 text-xs"
                >
                  Open full report
                </a>
              ) : null}
            </div>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words p-3 text-xs leading-5 text-gray-300">
              {validationReport.markdown}
            </pre>
          </section>
        ) : null}

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onDismiss}
            className="neu-button rounded-md border border-gray-800 px-3 py-2 text-sm text-gray-300 transition hover:border-gray-700 hover:text-white"
          >
            Close
          </button>
          {onOpenPanel ? (
            <button
              type="button"
              onClick={onOpenPanel}
              className="neu-button-primary rounded-md bg-white px-3 py-2 text-sm font-medium text-gray-950 transition hover:bg-gray-100"
            >
              {openPanelLabel}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
