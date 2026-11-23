import { MIN_VISUAL_SEGMENT_SECONDS } from "../config/editor.js";

const EPSILON = 0.000001;

function rateOf(segment) {
  return segment?.type === "video"
    ? Math.max(0.25, Math.min(4, Number(segment.playbackRate) || 1))
    : 1;
}

function sourceSpanOf(segment) {
  return Math.max(0, Number(segment?.sourceDuration) || (Number(segment?.duration) || 0) * rateOf(segment));
}

function sourceLimitOf(segment) {
  const sourceStart = Math.max(0, Number(segment?.sourceStart) || 0);
  const sourceEnd = sourceStart + sourceSpanOf(segment);
  return Math.max(sourceEnd, Number(segment?.trackFrameDuration) || 0);
}

export function getVisualSlipBounds(segment) {
  if (segment?.type !== "video") return { minimum: 0, maximum: 0 };
  const rate = rateOf(segment);
  const sourceStart = Math.max(0, Number(segment.sourceStart) || 0);
  const sourceEnd = sourceStart + sourceSpanOf(segment);
  return {
    minimum: -sourceStart / rate,
    maximum: Math.max(0, sourceLimitOf(segment) - sourceEnd) / rate,
  };
}

export function slipVisualSegment(segments, index, requestedDelta) {
  const segment = segments[index];
  const bounds = getVisualSlipBounds(segment);
  const delta = Math.max(bounds.minimum, Math.min(bounds.maximum, Number(requestedDelta) || 0));
  if (!segment || segment.type !== "video" || Math.abs(delta) < EPSILON) return { segments, delta: 0, bounds };
  const rate = rateOf(segment);
  return {
    bounds,
    delta,
    segments: segments.map((item, position) => position === index
      ? { ...item, sourceStart: Math.max(0, (Number(item.sourceStart) || 0) + delta * rate) }
      : item),
  };
}

export function getVisualBoundaryBounds(segments, boundaryIndex) {
  const previous = segments[boundaryIndex - 1];
  const next = segments[boundaryIndex];
  if (!previous || !next) return { minimum: 0, maximum: 0 };
  const previousRate = rateOf(previous);
  const nextRate = rateOf(next);
  let minimum = -(Math.max(MIN_VISUAL_SEGMENT_SECONDS, Number(previous.duration) || 0) - MIN_VISUAL_SEGMENT_SECONDS);
  let maximum = Math.max(MIN_VISUAL_SEGMENT_SECONDS, Number(next.duration) || 0) - MIN_VISUAL_SEGMENT_SECONDS;
  if (next.type === "video") minimum = Math.max(minimum, -(Math.max(0, Number(next.sourceStart) || 0) / nextRate));
  if (previous.type === "video") {
    const previousSourceEnd = Math.max(0, Number(previous.sourceStart) || 0) + sourceSpanOf(previous);
    maximum = Math.min(maximum, Math.max(0, sourceLimitOf(previous) - previousSourceEnd) / previousRate);
  }
  return { minimum, maximum };
}

export function rollVisualBoundary(segments, boundaryIndex, requestedDelta) {
  const previous = segments[boundaryIndex - 1];
  const next = segments[boundaryIndex];
  const bounds = getVisualBoundaryBounds(segments, boundaryIndex);
  const delta = Math.max(bounds.minimum, Math.min(bounds.maximum, Number(requestedDelta) || 0));
  if (!previous || !next || Math.abs(delta) < EPSILON) return { segments, delta: 0, bounds };
  const previousRate = rateOf(previous);
  const nextRate = rateOf(next);
  return {
    bounds,
    delta,
    segments: segments.map((item, position) => {
      if (position === boundaryIndex - 1) return {
        ...item,
        duration: (Number(item.duration) || 0) + delta,
        ...(item.type === "video" ? { sourceDuration: sourceSpanOf(item) + delta * previousRate } : {}),
      };
      if (position !== boundaryIndex) return item;
      return {
        ...item,
        duration: (Number(item.duration) || 0) - delta,
        ...(item.type === "video" ? {
          sourceStart: Math.max(0, (Number(item.sourceStart) || 0) + delta * nextRate),
          sourceDuration: sourceSpanOf(item) - delta * nextRate,
        } : {}),
      };
    }),
  };
}

export function getVisualSlideBounds(segments, index) {
  if (index <= 0 || index >= segments.length - 1) return { minimum: 0, maximum: 0 };
  return getVisualBoundaryBounds([segments[index - 1], segments[index + 1]], 1);
}

export function slideVisualSegment(segments, index, requestedDelta) {
  if (index <= 0 || index >= segments.length - 1) return { segments, delta: 0, bounds: { minimum: 0, maximum: 0 } };
  const bounds = getVisualSlideBounds(segments, index);
  const delta = Math.max(bounds.minimum, Math.min(bounds.maximum, Number(requestedDelta) || 0));
  if (Math.abs(delta) < EPSILON) return { segments, delta: 0, bounds };
  const previous = segments[index - 1];
  const next = segments[index + 1];
  const previousRate = rateOf(previous);
  const nextRate = rateOf(next);
  return {
    bounds,
    delta,
    segments: segments.map((item, position) => {
      if (position === index - 1) return {
        ...item,
        duration: (Number(item.duration) || 0) + delta,
        ...(item.type === "video" ? { sourceDuration: sourceSpanOf(item) + delta * previousRate } : {}),
      };
      if (position !== index + 1) return item;
      return {
        ...item,
        duration: (Number(item.duration) || 0) - delta,
        ...(item.type === "video" ? {
          sourceStart: Math.max(0, (Number(item.sourceStart) || 0) + delta * nextRate),
          sourceDuration: sourceSpanOf(item) - delta * nextRate,
        } : {}),
      };
    }),
  };
}
