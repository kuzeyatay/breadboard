function finiteDuration(segment) {
  const duration = Number(segment?.duration);
  return Number.isFinite(duration) && duration > 0 ? duration : 0;
}

export function getVisualInsertionHover(target, clientX) {
  const element = target instanceof Element ? target.closest("[data-timeline-segment-index]") : null;
  if (!(element instanceof HTMLElement)) return null;
  const index = Number(element.dataset.timelineSegmentIndex);
  if (!Number.isInteger(index) || index < 0) return null;
  const rect = element.getBoundingClientRect();
  return {
    index,
    after: Number(clientX) >= rect.left + rect.width / 2,
  };
}

export function resolveVisualInsertion({
  segments = [],
  percent = 100,
  timelineDuration = 0,
  hover = null,
} = {}) {
  const safeSegments = Array.isArray(segments) ? segments : [];
  if (!safeSegments.length) return { index: 0, time: 0 };

  let index;
  if (Number.isInteger(hover?.index) && hover.index >= 0 && hover.index < safeSegments.length) {
    index = Math.min(safeSegments.length, hover.index + (hover.after ? 1 : 0));
  } else {
    const total = safeSegments.reduce((sum, segment) => sum + finiteDuration(segment), 0);
    const horizon = Math.max(total, Number(timelineDuration) || 0, 0.001);
    const dropTime = Math.max(0, Math.min(horizon, (Number(percent) || 0) / 100 * horizon));
    let cursor = 0;
    index = safeSegments.length;
    for (let position = 0; position < safeSegments.length; position += 1) {
      const duration = finiteDuration(safeSegments[position]);
      if (dropTime < cursor + duration / 2) {
        index = position;
        break;
      }
      cursor += duration;
    }
  }

  const time = safeSegments.slice(0, index).reduce((sum, segment) => sum + finiteDuration(segment), 0);
  return { index, time };
}
