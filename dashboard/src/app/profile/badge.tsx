"use client";

// One small pill, used by the profile panels to label state.
//
// The tones are a vocabulary, not decoration: `derived` is the only one that
// means "a machine worked this out" — a contact the calendar filed on its own,
// a sync time nobody typed — and it is the only one that carries the mark. If
// everything glows, nothing does, so the plain state of a thing stays neutral.

export type BadgeTone = "neutral" | "active" | "derived" | "warn";

const TONES: Record<BadgeTone, string> = {
  neutral: "border-gray-800 text-gray-400",
  active: "border-[var(--botanical)]/45 text-[var(--botanical)]",
  derived: "border-[var(--botanical)]/30 text-gray-300",
  warn: "border-[#a45f56]/45 text-[#a45f56]",
};

export default function Badge({
  tone = "neutral",
  title,
  children,
}: {
  tone?: BadgeTone;
  /** Native tooltip. Worth setting whenever the label alone is a shorthand. */
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      title={title}
      className={`neu-surface inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-medium leading-none ${TONES[tone]}`}
    >
      {tone === "derived" ? (
        <span
          aria-hidden
          className="block h-1.5 w-1.5 rounded-full"
          style={{
            background:
              "radial-gradient(circle at 30% 30%, var(--botanical), transparent 70%), var(--botanical)",
          }}
        />
      ) : null}
      {children}
    </span>
  );
}
