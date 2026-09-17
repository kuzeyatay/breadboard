/** Locate the spoken script in rendered prose, independently of its height.
 * Voice may read only a prefix of an answer; widgets, tables and code can also
 * occupy several screens without contributing any words to that script.
 */
export function createReadingPosition(root: HTMLElement, spoken: string): (progress: number) => DOMRect | null {
  const excluded = '.voice-response-resources, .chat-weather-results, .chat-image-results, .chat-code-block, pre, table, .katex, button, [data-selection-exclude], [aria-hidden="true"]';
  const points: { node: Text; offset: number; length: number }[] = [];
  let rendered = '';
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      return node.parentElement?.closest(excluded) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    },
  });
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    for (const match of node.data.matchAll(/[\p{L}\p{N}]/gu)) {
      const normalized = match[0].toLowerCase();
      rendered += normalized;
      for (let index = 0; index < normalized.length; index++) {
        points.push({ node, offset: match.index, length: match[0].length });
      }
    }
  }

  const words: { offset: number; start: number; end: number }[] = [];
  let cursor = 0;
  // Preserve speech offsets while skipping the labels used for omitted blocks.
  const prose = spoken.replace(/\((?:code|formula) omitted\)/g, label => ' '.repeat(label.length));
  for (const match of prose.matchAll(/[\p{L}\p{N}]+/gu)) {
    const word = match[0].toLowerCase();
    const start = rendered.indexOf(word, cursor);
    if (start < 0) continue;
    const end = start + word.length - 1;
    words.push({ offset: match.index, start, end });
    cursor = end + 1;
  }

  const range = document.createRange();
  return progress => {
    if (!words.length) return null;
    const offset = Math.max(0, Math.min(1, progress)) * spoken.length;
    let low = 0;
    let high = words.length;
    while (low + 1 < high) {
      const middle = Math.floor((low + high) / 2);
      if (words[middle].offset <= offset) low = middle;
      else high = middle;
    }
    const word = words[low];
    const start = points[word.start];
    const end = points[word.end];
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset + end.length);
    // Measure at playback time so fullscreen/resizing uses the current wrapping.
    return range.getClientRects()[0] ?? null;
  };
}
