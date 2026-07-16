export default function DocumentIngestionVisionError({
  errors,
}: {
  errors: string[];
}) {
  if (errors.length === 0) return null;

  return (
    <div
      role="alert"
      aria-live="polite"
      className="flex items-start gap-2.5 rounded-lg border border-red-300/35 bg-red-950/70 px-3 py-2.5 text-[11px] leading-4 text-red-300"
    >
      <span
        aria-hidden="true"
        className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-red-300/60 text-[10px] font-semibold"
      >
        !
      </span>
      <div className="min-w-0">
        <p className="font-medium">ChatMock vision could not fully read this upload.</p>
        <p className="mt-0.5 text-red-300/90">
          The affected text, formulas, or figures may be incomplete in the
          Learning Map and generated lessons.
        </p>
        <ul className="mt-1 list-disc space-y-0.5 pl-4">
          {errors.map((error) => (
            <li key={error} className="break-words">
              {error}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
