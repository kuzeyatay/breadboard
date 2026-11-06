export default function LoadingRows({ label = "Loading capabilities" }: { label?: string }) {
  return (
    <div className="space-y-2 p-2" role="status" aria-label={label}>
      {[0, 1, 2].map((item) => (
        <div key={item} aria-hidden="true" className="animate-pulse rounded-xl px-3 py-3 motion-reduce:animate-none">
          <span className="block min-w-0 space-y-2">
            <span className="block h-3 w-2/5 rounded bg-[var(--paper-strong)]" />
            <span className="block h-2.5 w-4/5 rounded bg-[var(--paper-strong)]" />
          </span>
        </div>
      ))}
    </div>
  );
}
