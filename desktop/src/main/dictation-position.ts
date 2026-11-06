// The visible pill is 96 x 32. The transparent native surface stays larger than
// Windows' minimum tracking size so crossing monitors cannot grow the pill.
export const DICTATION_WINDOW_SIZE = { width: 320, height: 100 };
export const DICTATION_PILL_SIZE = { width: 96, height: 32 };
export type DictationAnchor = { x: number; y: number; width: number; height: number };

/** Place the visible pill above the caret. All inputs are Electron DIPs. */
export function dictationPosition(caret: DictationAnchor, area: DictationAnchor) {
  const padding = 8, gap = 8;
  const { width, height } = DICTATION_PILL_SIZE;
  const left = Math.max(area.x + 4, Math.min(caret.x + caret.width / 2 - width / 2, area.x + area.width - width - 4));
  const above = caret.y - height - gap;
  const preferredTop = above >= area.y + 4 ? above : caret.y + caret.height + gap;
  const top = Math.max(area.y + 4, Math.min(preferredTop, area.y + area.height - height - 4));
  // Clamp the visible pill, not the empty part of the native window.
  return { x: Math.round(left - padding), y: Math.round(top - padding) };
}
