interface BreadboardLoaderProps {
  /** Announced to screen readers when the icon is not inside a labelled status. */
  label?: string;
  className?: string;
}

/**
 * Breadboard's generic circular loading mark. The motion is the whole visible
 * signal, so loading copy belongs in an accessible label rather than beside it.
 */
export default function BreadboardLoader({
  label,
  className = "h-3.5 w-3.5",
}: BreadboardLoaderProps) {
  return (
    <svg
      role={label ? "status" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      viewBox="0 0 24 24"
      fill="none"
      className={`animate-spin ${className}`}
    >
      <circle
        cx="12"
        cy="12"
        r="8.5"
        stroke="currentColor"
        strokeWidth="2.25"
        opacity="0.22"
      />
      <path
        d="M12 3.5a8.5 8.5 0 0 1 8.5 8.5"
        stroke="currentColor"
        strokeWidth="2.25"
        strokeLinecap="round"
      />
    </svg>
  );
}
