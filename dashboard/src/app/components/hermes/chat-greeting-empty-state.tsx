"use client";

import type { ChatGreeting } from "@/lib/hermes/chat-greeting";

interface Props {
  greeting: ChatGreeting | null;
  suggestions: string[];
  /**
   * An opener was picked. It goes into the composer rather than straight to the
   * runtime: these are starting points, and most of them want a subject filled
   * in before they are worth sending.
   */
  onSelectSuggestion: (prompt: string) => void;
  disabled?: boolean;
}

/**
 * What a blank chat shows: a greeting that knows roughly what time it is and
 * roughly what you have been doing, and four openers drawn from the same
 * reading. Both step forward every hour.
 *
 * Shared by the runtime terminal and the legacy one so the two cannot drift.
 * The greeting is held back until the clock and the activity signals have both
 * landed, and then faded in, because a heading that appears and then rewrites
 * itself a frame later reads as a bug.
 */
export default function ChatGreetingEmptyState({
  greeting,
  suggestions,
  onSelectSuggestion,
  disabled = false,
}: Props) {
  return (
    <div className="flex min-h-[16rem] flex-col items-center justify-center gap-6 py-8 text-center">
      <div
        className={`transition-opacity duration-500 motion-reduce:transition-none ${
          greeting ? "opacity-100" : "opacity-0"
        }`}
      >
        {/* The placeholders are non-breaking spaces, not empty strings: the
            two lines still have to take their height while the greeting is on
            its way, or the block grows the moment it lands. */}
        <p className="text-2xl font-medium leading-tight text-white sm:text-3xl">
          {greeting?.lead ?? " "}
          {greeting?.name ? <span className="text-gray-500">, {greeting.name}</span> : null}
        </p>
        <p className="mt-1 text-2xl font-medium leading-tight text-white sm:text-3xl">
          {greeting?.question ?? " "}
        </p>
      </div>
      <div className="grid w-full max-w-xl gap-2 sm:grid-cols-2">
        {suggestions.map((prompt) => (
          <button
            type="button"
            key={prompt}
            onClick={() => onSelectSuggestion(prompt)}
            disabled={disabled}
            className="bb-terminal-suggestion neu-button rounded-lg border border-gray-800 bg-gray-900/40 px-3 py-2.5 text-left text-sm text-gray-300 transition hover:border-gray-600 hover:bg-gray-900 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {prompt}
          </button>
        ))}
      </div>
    </div>
  );
}
