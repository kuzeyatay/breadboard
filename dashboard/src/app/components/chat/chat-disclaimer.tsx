// The transcript's closing line: "Bread can make mistakes…".
//
// It is part of the conversation, not part of the composer, and it has two
// homes, both given by `mt-auto` inside the transcript's full-height column:
// while the conversation is shorter than the viewport the auto margin soaks
// up the free space and the line waits at the bottom, just above the pill —
// where the reference keeps it on a fresh chat. Once the conversation
// overflows there is no free space left, the auto margin is zero, and the
// line trails the last message: it leaves when the reader scrolls up and is
// revealed by the tail's last stretch of travel. The padding is the minimum
// gap under the last message in that second life.
export default function ChatDisclaimer() {
  return (
    <p className="mt-auto select-none text-balance pt-12 text-center text-[11.5px] font-medium leading-snug text-[var(--ink-muted)]">
      Bread can make mistakes, different models give different answers. Check
      important info.
    </p>
  );
}
