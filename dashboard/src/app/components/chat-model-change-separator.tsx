const WAVE_PATH = `M 0 4 ${"q 4 -4 8 0 t 8 0 ".repeat(125)}`;

function Wave() {
  return (
    <svg
      aria-hidden="true"
      className="h-2 min-w-0 flex-1 text-[var(--line-strong)]"
      viewBox="0 0 2000 8"
      preserveAspectRatio="xMinYMid slice"
    >
      <path
        d={WAVE_PATH}
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/** A durable, content-free boundary between answers made by different models. */
export default function ChatModelChangeSeparator({
  modelName,
}: {
  modelName: string;
}) {
  const label = `Switched to ${modelName}`;
  return (
    <div
      role="separator"
      aria-label={label}
      className="flex items-center gap-3 py-2"
    >
      <Wave />
      <span className="shrink-0 text-xs font-normal text-[var(--ink-muted)]">
        {label}
      </span>
      <Wave />
    </div>
  );
}
