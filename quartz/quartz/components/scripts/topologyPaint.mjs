export function mapTone(topicIndex, gardenIndex) {
  return (topicIndex ?? gardenIndex ?? 0) % 8;
}

export function mapPointSize(isFolder, selected) {
  return (isFolder ? 10 : 6) + (selected ? 4 : 0);
}

export function mapThreadOpacity(structural, strength) {
  return structural ? 0.12 : 0.14 + 0.15 * Math.max(0, Math.min(1, strength));
}
