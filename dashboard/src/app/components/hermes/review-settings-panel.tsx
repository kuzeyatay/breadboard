"use client";

// Spaced repetition inside the floating garden chat panel.
//
// The compact, dark twin of the workspace header's settings dialog. Both read
// and write through ./use-review-settings, so only the markup differs — this one
// has a 480px column and the chat's palette to live in, and it leans on the
// dialog for the delivery preferences rather than repeating every slider in a
// space this narrow.

import ReviewSettingsFields from "./review-settings-fields";
import { useReviewSettings } from "./use-review-settings";

interface Props {
  gardenSlug: string;
  onClose?: () => void;
}

export default function ReviewSettingsPanel({ gardenSlug, onClose }: Props) {
  const review = useReviewSettings(gardenSlug);
  const control =
    "neu-button rounded-md border border-gray-700 bg-gray-900 px-2 py-1 text-[11px] text-gray-200";

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
      <div className="flex items-center justify-between px-1 pb-2">
        <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-gray-600">
          Spaced repetition
        </span>
        {onClose ? (
          <button type="button" onClick={onClose} className={`${control} px-1.5 py-0.5`}>
            Done
          </button>
        ) : null}
      </div>

      {review.error ? (
        <p className="mb-2 px-1 text-[11px] text-[#a45f56]">{review.error}</p>
      ) : null}

      {review.loading && !review.data ? (
        <p className="py-8 text-center text-xs text-gray-500">Loading…</p>
      ) : review.data ? (
        <ReviewSettingsFields review={review} data={review.data} />
      ) : null}
    </div>
  );
}
