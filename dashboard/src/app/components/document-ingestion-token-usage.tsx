import { formatExactTokenCount, formatTokenCount } from "@/lib/chat-token-usage";
import type { IngestTokenUsage } from "@/lib/ingest-token-usage";

function formatTotalTokenCount(value: number): string {
  const count = Math.max(0, Math.trunc(value));
  return count < 1_000 ? String(count) : `${(count / 1_000).toFixed(1)}k`;
}

export default function DocumentIngestionTokenUsage({
  usage,
  fileName,
  pending = false,
}: {
  usage?: IngestTokenUsage;
  fileName?: string;
  pending?: boolean;
}) {
  if (!usage || (!pending && usage.startedCalls === 0)) return null;

  const calls = [
    `${usage.reportedCalls} ${usage.reportedCalls === 1 ? "call" : "calls"}`,
    usage.inFlightCalls > 0 ? `${usage.inFlightCalls} active` : "",
    usage.unreportedCalls > 0 ? `${usage.unreportedCalls} unreported` : "",
  ].filter(Boolean).join(" · ");
  const metrics = [
    { label: "Input", value: usage.inputTokens },
    { label: "Output", value: usage.outputTokens },
    { label: "Reasoning", value: usage.reasoningTokens },
    { label: "Total", value: usage.totalTokens },
  ];

  return (
    <div
      className="my-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-y border-gray-700/70 py-2 text-[11px] text-gray-500"
      aria-label={fileName
        ? `Document ingestion token usage for ${fileName}`
        : "Document ingestion token usage"}
    >
      <span className="font-medium text-gray-400">Tokens</span>
      {usage.reportedCalls > 0 ? metrics.map((metric) => (
        <span key={metric.label} className="flex items-baseline gap-1">
          <span>{metric.label}</span>
          <span
            className="font-mono tabular-nums text-gray-300"
            title={`${formatExactTokenCount(metric.value)} ${metric.label.toLowerCase()} tokens`}
          >
            {usage.estimated ? "~" : ""}
            {metric.label === "Total"
              ? formatTotalTokenCount(metric.value)
              : formatTokenCount(metric.value).toLowerCase()}
          </span>
        </span>
      )) : (
        <span>Waiting for usage</span>
      )}
      <span className="ml-auto">{calls}</span>
    </div>
  );
}
