// Import the text-only entry; the package root also loads Node streams.
import readingTime from "reading-time/lib/reading-time.js"

export const handwritingWordsPerMinute = 20

export function contentMetadata(texts: Iterable<string>) {
  let time = 0
  let words = 0
  for (const text of texts) {
    const stats = readingTime(text)
    time += stats.time
    words += stats.words
  }
  return {
    words,
    readingTimeMs: time,
    readingMinutes: Math.ceil(time / 60_000),
    handwritingMinutes: Math.ceil(words / handwritingWordsPerMinute),
  }
}
