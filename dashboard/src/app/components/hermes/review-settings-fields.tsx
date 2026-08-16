"use client";

// The chat panel's spaced-repetition controls, split out so the panel shell
// stays a shell. Dark palette, one narrow column — the workspace dialog has its
// own presentation of the same state in the neumorphic idiom.

import type { ReviewSettingsPayload, UseReviewSettings } from "./use-review-settings";

const CHANNEL_LABEL: Record<string, string> = {
  off: "not set",
  whatsapp: "WhatsApp",
  telegram: "Telegram",
};

export default function ReviewSettingsFields({
  review,
  data,
}: {
  review: UseReviewSettings;
  data: ReviewSettingsPayload;
}) {
  const label = "text-[11px] text-gray-400";
  const control =
    "neu-button rounded-md border border-gray-700 bg-gray-900 px-2 py-1 text-[11px] text-gray-200";

  return (
    <div className="space-y-3">
      <section className="rounded-lg border border-gray-800 bg-gray-900/50 p-3">
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            checked={data.garden.enabled}
            disabled={review.saving}
            onChange={(event) => void review.patchGarden({ enabled: event.target.checked })}
            className="mt-0.5"
          />
          <span>
            <span className="block text-xs text-gray-200">Ask me about this garden</span>
            <span className={`block ${label}`}>
              Questions are scheduled with FSRS and sent to you between reviews.
            </span>
          </span>
        </label>

        {data.garden.enabled && data.user.channel === "off" ? (
          // The one genuinely confusing state: on, but with nowhere to go.
          <p className="mt-2 rounded-md border border-amber-900/60 bg-amber-950/30 p-2 text-[11px] text-amber-300">
            No delivery channel is set, so nothing will be sent. Choose WhatsApp or Telegram
            from the gear in the garden header, or on your profile page.
          </p>
        ) : null}
      </section>

      <section className="rounded-lg border border-gray-800 bg-gray-900/50 p-3">
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-300">Cards from this garden</span>
          <span className="text-[11px] text-gray-500">
            {data.stats.total} total · {data.stats.due} due
          </span>
        </div>
        <div className="mt-1 grid grid-cols-3 gap-2 text-center">
          <Stat label="new" value={data.stats.newCards} />
          <Stat label="learning" value={data.stats.learning} />
          <Stat label="review" value={data.stats.review} />
        </div>
        <button
          type="button"
          onClick={() => void review.seed()}
          disabled={review.seeding}
          className={`${control} mt-2 w-full disabled:opacity-50`}
        >
          {review.seeding
            ? "Reading pages and writing questions…"
            : data.garden.cardCount === 0
              ? "Build cards from this garden"
              : "Refresh cards from this garden"}
        </button>
        {review.notice ? <p className={`mt-1 ${label}`}>{review.notice}</p> : null}
        {data.garden.lastSeededAt ? (
          <p className={`mt-1 ${label}`}>
            Last built {new Date(data.garden.lastSeededAt).toLocaleString()}
          </p>
        ) : null}
      </section>

      <section className="rounded-lg border border-gray-800 bg-gray-900/50 p-3">
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-300">Daily share</span>
          <span className="text-[11px] text-gray-500">
            {data.garden.dailyLimit} / day from here
          </span>
        </div>
        <input
          type="range"
          min={1}
          max={20}
          value={data.garden.dailyLimit}
          disabled={review.saving}
          onChange={(event) => void review.patchGarden({ dailyLimit: Number(event.target.value) })}
          className="mt-2 w-full"
        />
        <p className={label}>
          Capped by your overall daily limit of {data.user.dailyLimit}. Questions arrive on{" "}
          {CHANNEL_LABEL[data.user.channel] ?? data.user.channel}.
        </p>
      </section>

      {data.stats.answered30d > 0 ? (
        <section className="rounded-lg border border-gray-800 bg-gray-900/50 p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-300">Last 30 days</span>
            <span className="text-[11px] text-gray-500">{data.stats.answered30d} answered</span>
          </div>
          <p className={`mt-1 ${label}`}>
            {data.stats.retention30d === null
              ? "No graded answers yet."
              : `${Math.round(data.stats.retention30d * 100)}% recalled on first ask.`}
          </p>
        </section>
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-gray-800 bg-gray-950/60 py-1.5">
      <div className="text-sm text-gray-200">{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-gray-600">{label}</div>
    </div>
  );
}
