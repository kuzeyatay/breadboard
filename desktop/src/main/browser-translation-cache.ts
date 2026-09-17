import type { TranslatePageBatch, TranslationSegment } from "./browser-translation";

/** Text stays in this tab's memory, bounded across navigations and cleared on close. */
export class BrowserTranslationCache {
  private entries = new Map<string, string>();
  private size = 0;
  clear(): void { this.entries.clear(); this.size = 0; }

  async translate(batch: TranslationSegment[], language: string, site: string, signal: AbortSignal, translate: TranslatePageBatch) {
    signal.throwIfAborted();
    const keys = batch.map(segment => JSON.stringify([site, language, segment.text, segment.context]));
    const values = new Map<string, string>();
    const missing = new Map<string, TranslationSegment>();
    for (const [index, key] of keys.entries()) {
      const cached = this.entries.get(key);
      if (cached !== undefined) {
        this.entries.delete(key);
        this.entries.set(key, cached);
        values.set(key, cached);
      } else if (!missing.has(key)) missing.set(key, batch[index]!);
    }
    if (missing.size) {
      const segments = [...missing.values()];
      const result = await translate(segments, language, signal);
      signal.throwIfAborted();
      if (result.length !== segments.length || !result.every((value, index) => value.id === segments[index]!.id &&
          typeof value.text === "string" && value.text.trim() && value.text.length <= 36000)) {
        throw new Error("The translation response was incomplete. Try again.");
      }
      [...missing.keys()].forEach((key, index) => {
        const text = result[index]!.text;
        values.set(key, text);
        const previous = this.entries.get(key);
        if (previous !== undefined) this.size -= key.length + previous.length;
        this.entries.delete(key);
        this.entries.set(key, text);
        this.size += key.length + text.length;
      });
      while (this.entries.size > 2000 || this.size > 2_000_000) {
        const [key, text] = this.entries.entries().next().value!;
        this.entries.delete(key);
        this.size -= key.length + text.length;
      }
    }
    signal.throwIfAborted();
    return batch.map((segment, index) => ({ id: segment.id, text: values.get(keys[index]!)! }));
  }
}
