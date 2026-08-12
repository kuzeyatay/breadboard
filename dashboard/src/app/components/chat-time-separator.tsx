export default function ChatTimeSeparator({
  label,
  dateTime,
}: {
  label: string;
  dateTime?: string;
}) {
  return (
    <div
      role="separator"
      aria-label={label}
      className="flex items-center justify-center py-1"
    >
      <time
        dateTime={dateTime}
        className="text-xs font-normal text-[var(--ink-muted)]"
      >
        {label}
      </time>
    </div>
  );
}
