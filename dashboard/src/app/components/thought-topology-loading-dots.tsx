interface ThoughtTopologyLoadingDotsProps {
  label?: string;
}

export default function ThoughtTopologyLoadingDots({
  label,
}: ThoughtTopologyLoadingDotsProps) {
  return (
    <div
      className="thought-topology-loading-dots"
      role={label ? "status" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <span aria-hidden="true" />
      <span aria-hidden="true" />
      <span aria-hidden="true" />
      <span aria-hidden="true" />
    </div>
  );
}
