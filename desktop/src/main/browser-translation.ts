import { randomUUID } from "node:crypto";
import type { WebContents, WebFrameMain } from "electron";
import { isTranslationLanguage, translationSite, type BrowserTranslationState } from "../shared/browser-preferences";
import { translationDocumentScript } from "./browser-translation-dom";
import { BrowserTranslationCache } from "./browser-translation-cache";

export interface TranslationSegment { id: number; text: string; context: string }
export type TranslatePageBatch = (segments: TranslationSegment[], language: string, signal: AbortSignal) => Promise<Array<{ id: number; text: string }>>;

export interface TranslationPreferences {
  languageFor(url: string): string | undefined;
  remember(url: string, language: string | null): void;
}

export class BrowserTranslation {
  state: BrowserTranslationState = { status: "original", language: "en", translated: 0 };
  private key = "";
  private generation = 0;
  private controller: AbortController | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private documents = new Set<WebFrameMain>();
  private characters = 0;
  private navigating = false;
  private readonly cache = new BrowserTranslationCache();
  constructor(private readonly contents: WebContents, private readonly translate: TranslatePageBatch, private readonly changed: () => void,
    private readonly preferences?: TranslationPreferences) {
    contents.on("did-start-navigation", (_event, _url, inPlace, mainFrame) => {
      if (mainFrame && !inPlace) {
        // Do not execute scripts in a frame while Chromium is tearing it down.
        // Keep originals until commit so a cancelled navigation can still restore.
        this.generation++;
        this.navigating = true;
        clearTimeout(this.timer);
        this.controller?.abort();
      }
    });
    contents.on("did-navigate", () => { this.reset(); });
    // Electron queues isolated scripts until loading finishes. Wait here so a
    // cancelled load cannot leave a queued collector targeting the next document.
    contents.on("did-finish-load", () => { this.navigating = false; this.autoTranslate(); });
    contents.on("did-navigate-in-page", (_event, _url, mainFrame) => {
      if (mainFrame) { this.characters = 0; this.autoTranslate(); }
    });
    contents.on("did-stop-loading", () => {
      const interrupted = this.navigating;
      this.navigating = false;
      this.autoTranslate(interrupted);
      if (interrupted && this.key && this.controller?.signal.aborted) this.publish({
        ...this.state, status: "error", error: "Translation paused when navigation stopped. Retry to continue.",
      });
    });
    contents.once("destroyed", () => { this.reset(); this.cache.clear(); });
    // A popup can already have its first document when it is adopted by a tab.
    queueMicrotask(() => {
      if (!contents.isDestroyed() && !contents.isLoadingMainFrame()) this.autoTranslate();
    });
  }
  private autoTranslate(resume = false): void {
    if (this.contents.isDestroyed() || this.navigating || (this.key && (!resume || !this.controller?.signal.aborted))) return;
    const language = this.preferences?.languageFor(this.contents.getURL());
    if (language) void this.start(language, false);
  }
  private publish(next: BrowserTranslationState) { this.state = next; this.changed(); }
  private reset() {
    this.generation++;
    clearTimeout(this.timer);
    this.controller?.abort();
    this.documents.clear();
    this.key = "";
    this.characters = 0;
    this.publish({ status: "original", language: this.state.language, translated: 0 });
  }
  private async execute(frame: WebFrameMain, operation: "collect" | "apply" | "restore", payload?: unknown, key = this.key): Promise<unknown> {
    const script = translationDocumentScript(key, operation, payload);
    return frame === this.contents.mainFrame
      ? this.contents.executeJavaScriptInIsolatedWorld(1004, [{ code: script }])
      : frame.executeJavaScript(script);
  }
  async restore(): Promise<void> {
    if (!this.contents.isDestroyed()) this.preferences?.remember(this.contents.getURL(), null);
    await this.restorePage();
  }
  private async restorePage(): Promise<void> {
    const frames = [...this.documents], key = this.key;
    this.reset();
    if (!key || this.contents.isDestroyed()) return;
    await Promise.allSettled(frames.map(frame => this.execute(frame, "restore", undefined, key)));
  }
  async start(language: string, remember = true): Promise<void> {
    if (this.contents.isDestroyed() || !isTranslationLanguage(language)) return;
    if (remember) this.preferences?.remember(this.contents.getURL(), language);
    const generation = this.generation + 1;
    await this.restorePage();
    if (this.contents.isDestroyed() || this.navigating || this.generation !== generation) return;
    this.key = `__breadboard_translation_${randomUUID().replace(/-/g, "")}`;
    this.controller = new AbortController();
    this.publish({ status: "translating", language, translated: 0 });
    void this.tick(this.generation);
  }
  private async tick(generation: number): Promise<void> {
    const signal = this.controller!.signal;
    const live = () => generation === this.generation && !this.contents.isDestroyed() && !signal.aborted;
    const fail = (error: unknown) => {
      if (!live()) return;
      // Invalidate siblings before publishing failure; late results cannot overwrite it.
      this.generation++;
      this.controller?.abort();
      this.publish({ ...this.state, status: "error", error: error instanceof Error ? error.message : "Translation failed. Try again." });
    };
    try {
      const frames = this.contents.mainFrame.framesInSubtree;
      const exhausted = new Set<WebFrameMain>();
      let cursor = 0;
      for (const frame of this.documents) if (!frames.includes(frame)) this.documents.delete(frame);
      const nextBatch = async () => {
        // Collection stays serialized so batches are disjoint. Rotate through
        // frames even when the main document has a long translation backlog.
        for (let checked = 0; checked < frames.length; checked++) {
          if (!live()) return;
          const frame = frames[cursor++ % frames.length]!;
          if (exhausted.has(frame)) continue;
          // Include same-origin and cross-origin embedded documents, never local files.
          if (!/^https?:/.test(frame.url) && !/^about:(blank|srcdoc)$/.test(frame.url)) continue;
          this.documents.add(frame);
          let data: unknown;
          try { data = await this.execute(frame, "collect", { initial: this.characters === 0 }); }
          catch { exhausted.add(frame); continue; }
          if (!live()) return;
          if (!Array.isArray(data) || data.length > 40) { exhausted.add(frame); continue; }
          const batch = data as TranslationSegment[];
          if (!batch.every(value => value && Number.isSafeInteger(value.id) && typeof value.text === "string" && value.text.length <= 12000 && typeof value.context === "string" && value.context.length <= 300)) { exhausted.add(frame); continue; }
          if (!batch.length) { exhausted.add(frame); continue; }
          this.characters += batch.reduce((size, value) => size + value.text.length, 0);
          if (this.characters > 500_000) throw new Error("This page has reached the translation limit. Show original and translate again to continue.");
          return { frame, batch };
        }
      };
      const active = new Set<Promise<void>>();
      while (live()) {
        // Refill each free slot immediately; one slow request must not hold up
        // all later text. Keep the existing three-request provider limit.
        while (active.size < 3 && live()) {
          const next = await nextBatch();
          if (!next || !live()) break;
          const { frame, batch } = next;
          if (this.state.status !== "translating") this.publish({ ...this.state, status: "translating" });
          const job = (async () => {
            const result = await this.cache.translate(batch, this.state.language, translationSite(frame.url) ?? frame.url, signal, this.translate);
            if (!live()) return;
            let count: unknown;
            try { count = await this.execute(frame, "apply", result); } catch { return; }
            if (!live()) return;
            this.publish({ ...this.state, translated: this.state.translated + (typeof count === "number" ? count : 0) });
          })().catch(fail).finally(() => { active.delete(job); });
          active.add(job);
        }
        if (!active.size) break;
        await Promise.race(active);
      }
      if (!live()) return;
      this.publish({ ...this.state, status: "translated" });
      this.timer = setTimeout(() => { void this.tick(generation); }, 1000);
      this.timer.unref();
    } catch (error) {
      fail(error);
    }
  }
}
