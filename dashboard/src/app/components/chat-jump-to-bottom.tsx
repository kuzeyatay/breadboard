"use client";

/**
 * The one control a transcript floats over itself once the reader drifts away
 * from the newest message. It has two faces, and deliberately only one body:
 * three pulsing dots while the answer is still being written, a chevron once it
 * has landed. Keeping it a single button means the change reads as "the work
 * finished" rather than as one control being swapped for another, and a click
 * means the same thing in both states — take me back down.
 */

type ChatJumpToBottomProps = {
  /** The newest content is below the fold, so the control has something to do. */
  visible: boolean;
  /** An answer is still arriving; the control wears its three-dot face. */
  busy: boolean;
  onJump: () => void;
};

export default function ChatJumpToBottom({
  visible,
  busy,
  onJump,
}: ChatJumpToBottomProps) {
  const label = busy
    ? "Still responding — jump to the newest message"
    : "Jump to the newest message";

  return (
    // The control floats clear of the composer, which is laid over the foot of
    // the transcript rather than sitting below it. `--bb-composer-inset` is the
    // measured height of that bar; on a surface that has not published one the
    // fallback leaves the control where it always sat.
    <div
      className="pointer-events-none absolute inset-x-0 z-30 flex justify-center"
      style={{ bottom: "calc(var(--bb-composer-inset, 0px) + 0.75rem)" }}
    >
      <button
        type="button"
        onClick={onJump}
        aria-label={label}
        title={label}
        aria-hidden={visible ? undefined : true}
        tabIndex={visible ? 0 : -1}
        className={`neu-button-icon bb-chat-jump-control grid h-9 w-9 place-items-center rounded-full border text-[var(--ink-muted)] hover:text-[var(--ink)] ${
          visible
            ? "pointer-events-auto translate-y-0 scale-100 opacity-100"
            : "pointer-events-none translate-y-3 scale-75 opacity-0"
        }`}
      >
        {/* Both faces share one box and one grid cell, so they cross-fade in
            place instead of nudging the button's size as they swap. */}
        <span className="grid h-4 w-4 place-items-center" aria-hidden>
          <span
            className={`col-start-1 row-start-1 flex items-center gap-[2px] transition duration-200 ease-out ${
              busy ? "scale-100 opacity-100" : "scale-50 opacity-0"
            }`}
          >
            {[0, 1, 2].map((index) => (
              <span
                key={index}
                className={`h-1 w-1 rounded-full bg-current ${
                  busy ? "bb-chat-jump-dot" : ""
                }`}
                style={{ animationDelay: `${index * 0.16}s` }}
              />
            ))}
          </span>
          <svg
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            className={`col-start-1 row-start-1 h-4 w-4 transition duration-200 ease-out ${
              busy ? "-rotate-90 scale-50 opacity-0" : "rotate-0 scale-100 opacity-100"
            }`}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M10 4.5v11m0 0 4.5-4.5M10 15.5 5.5 11"
            />
          </svg>
        </span>
      </button>
    </div>
  );
}
