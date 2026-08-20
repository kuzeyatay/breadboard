import BreadboardLoader from "./breadboard-loader";

/**
 * What a route shows while its server half is still working.
 *
 * Next renders a segment's `loading.tsx` the instant navigation starts, so
 * without one every page that reads the database before it can paint leaves
 * the window on its own flat background — a blank pane the colour of nothing,
 * which reads as a crash rather than as a wait.
 *
 * Deliberately almost empty. A skeleton of the page that is coming would be a
 * second copy of every layout to keep in step, and a spinner that names where
 * you are going answers the only question anyone has in the half-second it is
 * up. The mark carries the motion; the line carries the meaning.
 */
export default function RouteLoading({
  label,
  hint,
}: {
  /** Where the reader is going, in two or three words. */
  label: string;
  /** One short line under it, when the wait has a reason worth naming. */
  hint?: string;
}) {
  return (
    <div
      className="flex min-h-screen w-full flex-col items-center justify-center gap-3 bg-[var(--background)] px-6 text-center"
      role="status"
      aria-live="polite"
    >
      <BreadboardLoader className="h-5 w-5 text-gray-500" />
      <p className="text-sm font-medium text-gray-300">{label}</p>
      {hint ? (
        <p className="max-w-xs text-xs leading-relaxed text-gray-500">{hint}</p>
      ) : null}
    </div>
  );
}
