import BreadboardLoader from "@/app/components/breadboard-loader";

/**
 * Buzz's own loading screen, rather than the shared one.
 *
 * The page reads the rooms, their rosters, the unread counts and the agent
 * catalogue before it can paint, so there is a real wait here — and it used to
 * be spent on Breadboard's flat background, which is neither Buzz's colour nor
 * a signal that anything is happening.
 *
 * It paints Buzz's own gradient instead, so the wait and the room that follows
 * it are the same surface: nothing changes colour underneath the reader when
 * the page arrives. Light only — the stored theme is read in the browser, and
 * a server render that guessed dark would flash the wrong one at everybody who
 * had not chosen it. Light is Buzz's own default, so the guess is free.
 */
export default function Loading() {
  return (
    <div
      className="buzz-root relative flex h-screen w-full items-center justify-center overflow-hidden"
      data-buzz-sidebar
      role="status"
      aria-live="polite"
    >
      <div
        aria-hidden="true"
        className="buzz-theme-gradient-layer pointer-events-none absolute inset-0 -z-10"
      >
        <div className="buzz-theme-gradient-underlay absolute inset-0" />
        <div className="buzz-theme-gradient-layer-light absolute inset-0" />
      </div>

      <div className="flex flex-col items-center gap-3 text-center">
        <BreadboardLoader className="h-5 w-5 text-buzz-foreground/50" />
        <p className="text-sm font-medium text-buzz-foreground/80">Opening Chat</p>
        <p className="max-w-xs text-xs leading-relaxed text-buzz-foreground/50">
          Reading your rooms and who is in them.
        </p>
      </div>
    </div>
  );
}
