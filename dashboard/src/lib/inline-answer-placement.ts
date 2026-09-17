export interface AnswerRect { left: number; top: number; right: number; bottom: number }
export interface AnswerPlacement { left: number; top: number; width: number; maxHeight: number }

const GAP = 14;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** Find nearby free space outside earlier cards. Earlier answers never chase their children. */
export function placeNestedInlineAnswer({ anchor, bounds, occupied, desiredHeight }: {
  anchor: AnswerRect;
  bounds: AnswerRect;
  occupied: AnswerRect[];
  desiredHeight: number;
}): AnswerPlacement {
  const width = Math.min(580, bounds.right - bounds.left);
  const height = Math.min(desiredHeight, 520, bounds.bottom - bounds.top);
  let spaces = [bounds];
  for (const card of occupied) {
    const obstacle = { left: card.left - GAP, right: card.right + GAP,
      top: card.top - GAP, bottom: card.bottom + GAP };
    spaces = spaces.flatMap(space => {
      if (obstacle.right <= space.left || obstacle.left >= space.right ||
          obstacle.bottom <= space.top || obstacle.top >= space.bottom) return [space];
      return [
        { ...space, right: Math.min(space.right, obstacle.left) },
        { ...space, left: Math.max(space.left, obstacle.right) },
        { ...space, bottom: Math.min(space.bottom, obstacle.top) },
        { ...space, top: Math.max(space.top, obstacle.bottom) },
      ].filter(rect => rect.right - rect.left >= Math.min(340, width) &&
        rect.bottom - rect.top >= Math.min(180, height));
    });
    spaces = spaces.filter((space, index, all) => !all.some((other, otherIndex) =>
      otherIndex !== index && other.left <= space.left && other.right >= space.right &&
      other.top <= space.top && other.bottom >= space.bottom &&
      (otherIndex < index || other.left < space.left || other.right > space.right ||
        other.top < space.top || other.bottom > space.bottom)));
  }
  const candidates = spaces.map(space => {
    const candidateWidth = Math.min(width, space.right - space.left);
    const candidateHeight = Math.min(height, space.bottom - space.top);
    const left = clamp(anchor.left - 24, space.left, space.right - candidateWidth);
    const top = clamp(anchor.top - 24, space.top, space.bottom - candidateHeight);
    const distance = Math.hypot(Math.max(left - anchor.right, anchor.left - left - candidateWidth, 0),
      Math.max(top - anchor.bottom, anchor.top - top - candidateHeight, 0));
    return { left, top, width: candidateWidth, maxHeight: candidateHeight,
      score: distance + (width - candidateWidth) * 1.2 + (height - candidateHeight) * 0.6 };
  });
  candidates.sort((a, b) => a.score - b.score);
  if (candidates[0]) return candidates[0];

  // A narrow/short viewport cannot fit every card. Expose earlier headers in a
  // staggered stack; the move handle lets the reader arrange them as needed.
  const previous = occupied.at(-1) ?? anchor;
  const top = clamp(previous.top + 56, bounds.top, Math.max(bounds.top, bounds.bottom - 180));
  return { left: clamp(previous.left + 40, bounds.left, bounds.right - width), top,
    width, maxHeight: Math.min(height, bounds.bottom - top) };
}
