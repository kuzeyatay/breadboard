type WorkflowSourceIconProps = {
  source?: "canvas" | "demonstration";
  className?: string;
};

/** A taught workflow is recognisable by the microphone used to demonstrate it. */
export function WorkflowSourceIcon({
  source = "canvas",
  className = "h-5 w-5",
}: WorkflowSourceIconProps) {
  if (source === "demonstration") {
    return (
      <svg
        aria-hidden
        className={className}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
      >
        <rect x="9" y="3" width="6" height="10" rx="3" />
        <path strokeLinecap="round" d="M6.5 10a5.5 5.5 0 0 0 11 0M12 15.5V20M8.5 20h7" />
      </svg>
    );
  }

  return (
    <svg
      aria-hidden
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
    >
      <circle cx="6" cy="6" r="2.25" />
      <circle cx="18" cy="12" r="2.25" />
      <circle cx="6" cy="18" r="2.25" />
      <path
        strokeLinecap="round"
        d="M8.2 6h2.3a3 3 0 0 1 3 3v0a3 3 0 0 0 3 3M8.2 18h2.3a3 3 0 0 0 3-3v0a3 3 0 0 1 3-3"
      />
    </svg>
  );
}
